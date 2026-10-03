# System Design Case Study: High-Concurrency E-Commerce Checkout & Flash Sale Inventory

## 1. What is it?
A **High-Concurrency E-Commerce Checkout & Flash Sale Inventory System** (exemplified by Amazon Prime Day, Flipkart Big Billion Days, Ticketmaster, and Nike SNKRS) is a transaction-critical distributed architecture engineered to handle extreme traffic surges (e.g., 500,000 users attempting to purchase 10,000 limited-edition items within a 5-second window).

Unlike standard low-concurrency shopping carts where database updates occur sequentially, flash sales introduce intense lock contention and race conditions. The core mission of this architecture is to **guarantee absolute inventory correctness (never oversell or undersell)**, provide fair allocation, decouple payment processing from inventory locking, and handle third-party payment webhooks idempotently with zero financial discrepancies.

```
                    FLASH SALE CHECKOUT TRANSACTION LIFECYCLE
                    
    [ 500,000 Users ]
           │ 1. Checkout Click (POST /api/v1/checkout)
           ▼
    ┌──────────────────────────────────────────────┐
    │ Virtual Waiting Room & Token Bucket Limiter  │
    └──────────────────────┬───────────────────────┘
                           │ 2. Filtered Ingress (10,000 QPS)
                           ▼
    ┌──────────────────────────────────────────────┐
    │ Redis Cluster (Atomic Lua Inventory Script)  │
    │ • Atomic Check & Decrement Stock             │
    │ • Generate 15-Minute Soft Reservation Token  │
    └──────────────────────┬───────────────────────┘
                           │ 3. If Stock Available
                           ▼
    ┌──────────────────────────────────────────────┐
    │ Order Creation & Saga Orchestrator           │
    │ Status: `PAYMENT_PENDING` (PostgreSQL)       │
    └──────────────────────┬───────────────────────┘
                           │ 4. Client completes payment
                           ▼
    ┌──────────────────────────────────────────────┐
    │ Payment Gateway (Stripe / Razorpay)          │
    └──────────────────────┬───────────────────────┘
                           │ 5. Asynchronous Webhook (`payment.succeeded`)
                           ▼
    ┌──────────────────────────────────────────────┐
    │ Webhook Ingestion & Idempotency Engine       │
    │ Status: `ORDER_CONFIRMED`                    │
    │ Finalizes inventory decrement permanently    │
    └──────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Relying on traditional database transactions and relational locks during a flash sale results in immediate systemic collapse:

1. **The Overselling Catastrophe (Race Conditions)**: If two concurrent HTTP requests read `stock = 1` simultaneously, both validate the purchase, decrement stock, and commit. The database ends up with `stock = -1`, resulting in canceled orders, customer outrage, and brand damage.
2. **Database Deadlocks & Connection Starvation**: Executing `SELECT stock FROM products WHERE id = 1 FOR UPDATE` locks that row. When 50,000 concurrent database connections attempt to acquire the same row lock simultaneously, database thread pools exhaust, query queues overflow, and the entire relational database crashes.
3. **The Abandoned Cart Problem (Inventory Lockup)**: If a user places an item in their cart but closes their browser, the inventory remains locked forever unless an automatic, reliable expiration mechanism releases the soft reservation back into the pool.
4. **Third-Party Payment Latency**: External payment providers (Stripe, PayPal, Banks) take 2 to 10 seconds to authorize cards. Holding database transactions or row locks open while waiting for an external HTTP payment response will freeze backend application servers within seconds.

---

## 3. Step 1: Requirements Clarification

### Functional Requirements
1. **Flash Sale Inventory Reservation**: Atomically check and reserve stock for an item in $< 5\text{ms}$.
2. **Soft Reservation Expiry**: Hold reserved inventory for exactly **15 minutes**. If the user fails to complete payment within 15 minutes, the stock automatically rolls back into the available pool.
3. **Order State Machine**: Enforce strict order lifecycle states: `INITIATED` $\rightarrow$ `RESERVED` $\rightarrow$ `PAYMENT_PENDING` $\rightarrow$ `CONFIRMED` (or `EXPIRED` / `CANCELLED`).
4. **Reliable Webhook Processing**: Idempotently handle asynchronous payment status webhooks from payment gateways.

### Non-Functional Requirements
1. **Zero Overselling (Hard Constraint)**: Stock count must never drop below zero under any concurrency level.
2. **High Throughput & Low Latency**: Ingestion API must sustain **50,000 QPS** at peak with P99 checkout latency $< 100\text{ms}$.
3. **High Availability**: 99.99% uptime. Failure of payment webhooks must not cause loss of order state.
4. **Auditability & Reconciliation**: Every inventory decrement, increment, and payment transaction must be recorded in an immutable ledger table.

---

## 4. Step 2: Capacity Estimation & Back-of-the-Envelope Math

### A. Traffic & QPS Sizing
- **Flash Sale Event**: 100,000 units of a flagship smartphone on sale at 12:00 PM.
- **Active Participants**: 1,000,000 users active on the product page.
- **Peak Checkout Initiation**: 50% of users click "Buy Now" within the first 10 seconds.
  $$\text{Total Ingress Requests} = 500,000 \text{ requests in 10 seconds}$$
  $$\text{Peak Ingress QPS} = \mathbf{50,000 \text{ checkout requests / second}}$$
  *Insight*: A single PostgreSQL instance typically maxes out at 3,000–5,000 write TPS. Hitting PostgreSQL with 50,000 concurrent transactional writes will cause immediate connection pool exhaustion and crash the database. An in-memory distributed cache (Redis) must absorb the write shock.

### B. Storage Sizing
- **Orders Generated**: 100,000 successful orders + 400,000 failed/attempted orders.
- **Order Record Size**: $\approx 1\text{ KB}$ (Order details, customer UUID, line items, timestamps, state history).
- **Storage Added per Sale**: $500,000 \times 1\text{ KB} \approx \mathbf{500 \text{ Megabytes}}$. Storage volume is negligible; the primary challenge is **pure lock contention and write concurrency**.

---

## 5. Step 3: High-Level Architecture & End-to-End Flow

```
                 END-TO-END CHECKOUT & FLASH SALE ARCHITECTURE

 [ 500,000 Concurrent Mobile & Web Clients ]
                     │
                     ▼ (HTTPS POST /checkout)
 ┌──────────────────────────────────────────────────────────────┐
 │ Edge Layer: Cloudflare Virtual Waiting Room & WAF            │
 │ • Filters bot traffic & enforces Token Bucket rate limits    │
 └───────────────────┬──────────────────────────────────────────┘
                     │ 50,000 QPS
                     ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ Checkout Ingestion API Fleet (Stateless Node.js Instances)   │
 └───────────────────┬──────────────────────────────────────────┘
                     │
                     ├── 1. Atomic Lua Script Execution
                     ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ Distributed Cache: Redis Cluster (In-Memory Master)          │
 │ • Key: `stock:item_99` = 100000                              │
 │ • Atomically checks: if stock > 0 then decrement and return  │
 │ • Creates temporary hold key: `hold:order_123` TTL=900s      │
 └───────────────────┬──────────────────────────────────────────┘
                     │
         ┌───────────┴────────────────────────┐
   [ Stock Available ]                  [ Stock Exhausted ]
         │                                    │
         ▼                                    ▼
 ┌─────────────────────────────────┐   ┌────────────────────────┐
 │ 2. Publish Order Event to Kafka │   │ Return HTTP 409        │
 │ Topic: `orders.pending`         │   │ "Item Sold Out"        │
 └───────────────┬─────────────────┘   └────────────────────────┘
                 │
                 ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ Order Processing Consumer Workers                            │
 │ • Inserts Order into PostgreSQL (status = 'PAYMENT_PENDING') │
 │ • Generates Payment Intent via Stripe API                    │
 │ • Returns client_secret to Frontend for Payment Sheet        │
 └──────────────────────────────────────────────────────────────┘
```

---

## 6. Step 4: Deep Dive & Technical Bottlenecks

### Deep Dive 1: Concurrency Control Mechanisms Comparison

```
┌─────────────────────────────────┬──────────────────────────────────┬─────────────────────────────────┐
│ Pessimistic DB Locking          │ Optimistic DB Locking            │ Redis Atomic In-Memory Locking  │
├─────────────────────────────────┼──────────────────────────────────┼─────────────────────────────────┤
│ `SELECT ... FOR UPDATE`         │ `UPDATE ... WHERE version = 3`   │ Lua Script with atomic `DECR`   │
│ Locks database row during tx.   │ Checks version on write.         │ Single-threaded memory mutation.│
│ Safe, but causes deadlocks and  │ High failure rate under extreme  │ **Sustains 100,000+ QPS**;      │
│ pool starvation at >3,000 QPS.  │ contention (aborts 99% writes).  │ zero database lock contention.  │
└─────────────────────────────────┴──────────────────────────────────┴─────────────────────────────────┘
```

**Why Redis Lua Scripting Wins**:
Redis is single-threaded per event loop. A Lua script executes **atomically**: no other Redis command can run in the middle of the script. This guarantees that checking stock and decrementing it happens as an atomic, indivisible operation in sub-millisecond time.

```lua
-- check_and_reserve_stock.lua
-- KEYS[1]: product_stock_key (e.g., "stock:item_42")
-- KEYS[2]: user_reservation_key (e.g., "reservation:order_123")
-- ARGV[1]: requested_quantity (e.g., "1")
-- ARGV[2]: reservation_ttl_seconds (e.g., "900")

local current_stock = tonumber(redis.call('GET', KEYS[1]) or 0)
local requested_qty = tonumber(ARGV[1])

if current_stock >= requested_qty then
    -- 1. Deduct stock atomically
    redis.call('DECRBY', KEYS[1], requested_qty)
    -- 2. Store user reservation with 15-minute expiration
    redis.call('SET', KEYS[2], requested_qty, 'EX', tonumber(ARGV[2]))
    return 1 -- SUCCESS: Stock reserved
else
    return 0 -- FAILED: Out of stock
end
```

---

### Deep Dive 2: Soft Reservation Expiry & Rollback Architecture
What happens if 10,000 users reserve stock but abandon checkout at the payment step?
If those items are not released, the company loses 10,000 sales ("artificial inventory dry-up").

```
             SOFT RESERVATION EXPIRATION & RECONCILIATION
             
     User initiates checkout
                │
                ▼
     Redis Reservation Key set with TTL = 900 seconds (15 mins)
                │
         ┌──────┴─────────────────────────────────┐
  [ Payment Succeeded ]                    [ 15 Minutes Expire ]
         │                                        │
         ▼                                        ▼
  Delete hold key;                 Redis Keyspace Notification OR
  Confirm permanent DB             Scheduled Sweeper Worker detects
  inventory reduction.             expired reservation.
                                                  │
                                                  ▼
                                   Atomically increment Redis stock:
                                   `INCRBY stock:item_42 1`
                                   Mark Order in DB as `EXPIRED`.
```

**Implementation Options for Releasing Stock**:
1. **Redis Keyspace Notifications (`__keyevent@0__:expired`)**:
   Redis emits a pub/sub event when `reservation:order_123` expires. A worker listens to this event and calls `INCRBY stock:item_42 1`. *(Caution: Redis does not guarantee real-time delivery of expired events if under heavy load).*
2. **Scheduled Reconciliation Sweeper (Production Recommended)**:
   A lightweight background cron job queries the DB:
   ```sql
   SELECT order_id, product_id, quantity FROM orders 
   WHERE status = 'PAYMENT_PENDING' 
     AND created_at < NOW() - INTERVAL '15 minutes'
   FOR UPDATE SKIP LOCKED;
   ```
   For each expired record:
   - Sets `status = 'EXPIRED'`.
   - Executes `INCRBY stock:product_id quantity` in Redis.
   - Commits the transaction.

---

### Deep Dive 3: Reliable Payment Webhook Ingestion & Idempotency
Payment providers (Stripe, Adyen, Razorpay) deliver payment status updates via HTTP webhooks (`payment_intent.succeeded`). Because networks are unreliable, payment gateways retry webhooks multiple times.

```
Incoming Webhook ──► 1. Verify Cryptographic Signature (HMAC SHA-256)
                            │
                            ▼
                     2. Query Idempotency Store:
                        INSERT INTO processed_webhooks (event_id, processed_at)
                        VALUES ('evt_stripe_98432', NOW())
                        ON CONFLICT (event_id) DO NOTHING;
                            │
             ┌──────────────┴──────────────┐
             │ Conflict (Row not inserted) │ Success (Row inserted)
             ▼                             ▼
     Duplicate Event!              3. Open Database Transaction:
     Return HTTP 200 OK            • UPDATE orders SET status = 'CONFIRMED'
     (Do not re-process)           • INSERT INTO order_audit_logs ...
                                   4. Return HTTP 200 OK
```

---

### Deep Dive 4: Synchronizing Redis In-Memory Stock with Database Stock
Redis is an in-memory cache used for high-speed concurrency gating. The ultimate source of truth is the **PostgreSQL relational database**.

**The Async Sync Pipeline (Transactional Outbox)**:
1. When Redis reserves stock, an event is placed onto an Apache Kafka topic: `inventory.reservations`.
2. A consumer group processes events in batches of 500:
   - Executes a batch update against PostgreSQL:
     ```sql
     UPDATE products 
     SET reserved_stock = reserved_stock + batch.qty 
     WHERE id = batch.product_id;
     ```
3. When the payment webhook confirms the purchase:
   - Decrements physical stock and decrements reserved stock atomically:
     ```sql
     UPDATE products 
     SET stock = stock - 1, 
         reserved_stock = reserved_stock - 1 
     WHERE id = 42;
     ```

---

## 7. Important Rules

1. **Never Trust Frontend Prices or Quantities**: Always look up item prices and available inventory caps on the backend using immutable product IDs.
2. **Never Execute External API Calls Inside Database Transactions**: Invoking Stripe API or bank gateways while holding an active PostgreSQL transaction locks database connections for several seconds, leading to connection exhaustion.
3. **Decouple Reservation from Billing**: Soft-reserve inventory first (Redis), return a reservation token to the client, and only then instruct the client to open the payment modal.
4. **Enforce Database-Level Check Constraints**: Add a defensive check constraint on the relational database:
   ```sql
   ALTER TABLE products ADD CONSTRAINT stock_cannot_be_negative CHECK (stock >= 0);
   ```
   Even if a bug exists in the application code, the database engine will reject any transaction that attempts to set stock to a negative number.

---

## 8. Common Mistakes & Anti-Patterns

### 1. The Check-Then-Act Race Condition
```typescript
// ❌ FATAL ANTI-PATTERN: Separate read and write!
const item = await db.query('SELECT stock FROM products WHERE id = 1');
if (item.stock > 0) {
  // Between the SELECT and the UPDATE, 500 other threads read stock = 1!
  await db.query('UPDATE products SET stock = stock - 1 WHERE id = 1');
}
```
**Fix**: Use atomic updates (`UPDATE products SET stock = stock - 1 WHERE id = 1 AND stock > 0`) or Redis Lua scripts.

### 2. Failing to Handle Webhook Out-of-Order Delivery
A `payment.failed` webhook can arrive after a `payment.succeeded` webhook due to network routing. The order state machine must reject invalid transitions (e.g., an order in state `CONFIRMED` must never transition to `FAILED`).

---

## 9. Best Practices

- **Virtual Waiting Room**: Under peak flash sales, route excess traffic to a virtual queue (e.g., Cloudflare Waiting Room or AWS SQS-backed token issuer) to rate-limit traffic to what backend services can comfortably process.
- **Client Polling with Exponential Jitter**: When waiting for payment confirmation, have the frontend poll `GET /api/v1/orders/:id/status` using exponential backoff with randomized jitter to prevent thundering herd spikes on the backend.
- **Pre-warming Redis & Database Pools**: 15 minutes before the flash sale launch, pre-warm Redis instances, initialize database connection pools to their maximum size, and cache all product metadata across CDN edge nodes.

---

## 10. Performance Considerations

- **Redis Master-Replica Read Decoupling**: Serve product detail and stock display views (`GET /products/42`) from Redis read replicas, reserving the Redis master exclusively for executing atomic Lua reservation scripts.
- **Connection Pooling Optimization**: Configure PgBouncer in front of PostgreSQL using **Transaction Pooling mode** to allow 10,000 application worker processes to multiplex over 100 physical database connections.
- **Database Indexing**: Index `orders (user_id, status)` and `orders (created_at) WHERE status = 'PAYMENT_PENDING'` to make timeout sweeper queries execute in $< 2\text{ms}$.

---

## 11. Security Considerations

- **Bot Mitigation**: Integrate CAPTCHAs (Cloudflare Turnstile) on the final checkout button to prevent scalper bots from draining inventory using automated scripts.
- **Cart Hoarding Protection**: Limit a single user account / IP address to reserving a maximum of **1 item** during the flash sale window.
- **Payment Signature Verification**: Verify webhook signatures using raw request bodies (prior to JSON body parsing) using constant-time string comparison (`crypto.timingSafeEqual`) to prevent timing attacks.

---

## 12. Alternatives

| Strategy | Selected Approach | Alternative | Trade-off Analysis |
|---|---|---|---|
| **Inventory Gating** | In-Memory Redis Lua | Database `SELECT FOR UPDATE` | Redis handles 100k+ QPS; DB row locks crash above 3k QPS. |
| **Payment Handling** | Asynchronous Webhook | Synchronous Blocking HTTP | Webhooks avoid tying up web server connections while waiting for bank processing. |
| **Traffic Shaping** | Virtual Waiting Room | Direct Auto-Scaling | Waiting room guarantees server stability; auto-scaling takes 3-5 minutes to react to a sudden traffic spike. |

---

## 13. Trade-offs

- **Redis Cache Loss vs. Speed**:
  Relying on Redis for inventory reservation provides extreme speed, but if the Redis master crashes before replicating to its replica, a small window of reservation state could be lost. We mitigate this using Redis AOF (Append-Only File) persistence with `fsync everysec` and asynchronous database event streaming.
- **Strict FIFO Fairness vs. Throughput**:
  Enforcing strict global FIFO (First-In, First-Out) ordering across 500,000 concurrent users requires global sequence locks that bottleneck throughput. We provide approximate fairness using distributed token buckets.

---

## 14. Real-World Usage & Implementation Example

Here is a complete, production-grade TypeScript implementation of an **Atomic Flash Sale Reservation Manager** and **Idempotent Webhook Handler**:

```typescript
// flash-sale-checkout.ts
import { Redis } from 'ioredis';
import crypto from 'crypto';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// 1. Lua Script for Atomic Inventory Check & Reservation
const RESERVE_STOCK_LUA = `
local stock_key = KEYS[1]
local reservation_key = KEYS[2]
local req_qty = tonumber(ARGV[1])
local ttl_seconds = tonumber(ARGV[2])

local current_stock = tonumber(redis.call('GET', stock_key) or 0)

if current_stock >= req_qty then
    redis.call('DECRBY', stock_key, req_qty)
    redis.call('SET', reservation_key, req_qty, 'EX', ttl_seconds)
    return 1
else
    return 0
end
`;

export class FlashSaleService {
  /**
   * Attempts to reserve inventory for 15 minutes atomically
   */
  async reserveItem(productId: string, orderId: string, quantity: number = 1): Promise<boolean> {
    const stockKey = `stock:${productId}`;
    const reservationKey = `reservation:${orderId}`;
    const reservationTtl = 900; // 15 minutes

    const result = await redis.eval(
      RESERVE_STOCK_LUA,
      2,
      stockKey,
      reservationKey,
      quantity.toString(),
      reservationTtl.toString()
    );

    return result === 1;
  }

  /**
   * Rolls back stock if payment fails or user cancels
   */
  async releaseReservation(productId: string, orderId: string): Promise<void> {
    const stockKey = `stock:${productId}`;
    const reservationKey = `reservation:${orderId}`;

    const reservedQty = await redis.get(reservationKey);
    if (reservedQty) {
      const pipeline = redis.pipeline();
      pipeline.incrby(stockKey, parseInt(reservedQty, 10));
      pipeline.del(reservationKey);
      await pipeline.exec();
      console.log(`[INVENTORY RELEASED]: Restored ${reservedQty} units for product ${productId}`);
    }
  }
}

// 2. Idempotent Payment Webhook Processor
export class WebhookProcessor {
  private flashSaleService = new FlashSaleService();

  /**
   * Processes payment webhooks idempotently
   */
  async handleStripeWebhook(rawPayload: string, signature: string, secret: string): Promise<{ success: boolean; message: string }> {
    // Step A: Cryptographic Signature Verification (Simulated)
    const expectedSignature = crypto.createHmac('sha256', secret).update(rawPayload).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      throw new Error('Invalid webhook signature');
    }

    const event = JSON.parse(rawPayload);
    const eventId = event.id; // e.g., 'evt_3MswQ2LkdIwHu7ix0snNqGNF'

    // Step B: Idempotency Lock using Redis (Atomic SET NX)
    const idempotencyKey = `webhook:processed:${eventId}`;
    const isFirstTimeSeen = await redis.set(idempotencyKey, 'SUCCESS', 'EX', 86400 * 7, 'NX');

    if (!isFirstTimeSeen) {
      console.warn(`[DUPLICATE WEBHOOK]: Event ${eventId} was already processed. Skipping.`);
      return { success: true, message: 'Already processed' };
    }

    // Step C: Process Business Logic based on event type
    const { orderId, productId } = event.data.object.metadata;

    if (event.type === 'payment_intent.succeeded') {
      // Finalize Order in Database
      console.log(`[ORDER CONFIRMED]: Finalizing order ${orderId} in database.`);
      // Delete temporary soft hold in Redis (since purchase is now final)
      await redis.del(`reservation:${orderId}`);
    } else if (event.type === 'payment_intent.payment_failed') {
      console.log(`[ORDER PAYMENT FAILED]: Releasing reserved stock for order ${orderId}.`);
      await this.flashSaleService.releaseReservation(productId, orderId);
    }

    return { success: true, message: 'Processed successfully' };
  }
}
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: What is the difference between optimistic and pessimistic locking in databases?
**Answer**:
- **Pessimistic Locking (`SELECT FOR UPDATE`)**: Assumes conflicts will occur. Locks the selected record at the start of the transaction, blocking any other transaction from reading or writing until the lock is released on commit. Guarantees safety but severely kills concurrency.
- **Optimistic Locking (`version` column)**: Assumes conflicts are rare. Reads the row without locking. When updating, it checks `WHERE version = read_version`. If another transaction modified the row, the update affects 0 rows, and the application must retry or abort. In a flash sale with 50,000 users competing for 1 row, optimistic locking causes 99.9% of transactions to abort, wasting CPU.

### 2. Conceptual: Why is Redis preferred over PostgreSQL for flash sale inventory reservation?
**Answer**:
PostgreSQL commits data to disk and relies on write-ahead logging (WAL) and row-level locks, capping a single node at roughly 3,000–5,000 write operations per second. Flash sales generate 50,000–100,000 requests per second. Redis operates entirely in RAM and executes single-threaded Lua scripts, enabling over 100,000 atomic transactions per second without lock overhead. Redis acts as a high-speed concurrency gate, protecting the database from catastrophic overload.

### 3. Implementation: How do you prevent inventory from being locked indefinitely if a user reserves an item but abandons checkout?
**Answer**:
By implementing **Soft Reservations with Time-To-Live (TTL)**:
1. When reserving stock in Redis, assign a 15-minute expiration to the reservation key (`SET reservation:order_id 1 EX 900`).
2. Run a background sweeper query every 60 seconds against PostgreSQL looking for orders where `status = 'PAYMENT_PENDING'` and `created_at < NOW() - 15 minutes`.
3. The sweeper transitions the order to `EXPIRED` and atomically restores the stock in Redis (`INCRBY stock:item_id 1`).

### 4. Debugging: An e-commerce platform accidentally sold 105 units of a product that only had 100 units in stock. What was the likely cause?
**Answer**:
Possible root causes:
1. **Non-Atomic Read-Then-Write**: Application code checked stock (`if (stock > 0)`) and then issued `UPDATE products SET stock = stock - 1` in two separate operations, allowing a race condition.
2. **Missing Database Check Constraint**: The database column lacked `CHECK (stock >= 0)`.
3. **Out-of-Order Webhook Processing**: A failed payment webhook released stock back to the pool, but a subsequent delayed success webhook arrived and confirmed the order without re-verifying available stock.

### 5. Scenario: If Stripe takes 5 seconds to process a payment, how do you keep your backend servers from freezing?
**Answer**:
Decouple payment processing from application threads:
1. Reserve inventory in Redis ($< 5\text{ms}$).
2. Create an order record in `PAYMENT_PENDING` status.
3. Generate a Stripe PaymentIntent and return the `client_secret` to the frontend.
4. The client browser communicates **directly with Stripe's servers** to process the credit card.
5. The application backend does not hold any open thread or database connection. When Stripe finishes, it notifies the backend asynchronously via a webhook (`payment_intent.succeeded`).

### 6. Advanced: How do you handle Redis master node failure during an active flash sale without losing reservation state?
**Answer**:
1. Configure Redis with **Redis Sentinel or Redis Cluster** for automatic failover within 3 seconds.
2. Enable Redis AOF (Append-Only File) with `appendfsync everysec` to limit data loss to at most 1 second of transactions.
3. Run an asynchronous reconciliation consumer: every time a reservation succeeds in Redis, publish an event to an Apache Kafka topic with persistent replication across 3 Availability Zones. If the Redis master crashes, a startup reconciliation script rebuilds the in-memory stock count from the Kafka topic and PostgreSQL confirmed orders.

---

## 16. Coding Questions & Practical Challenges

1. **Redis Atomic Decrement Script**: Write a Lua script that accepts an array of product IDs and quantities, verifies that *all* products have sufficient stock, and decrements them atomically (all-or-nothing transaction).
2. **Webhook Signature Verifier**: Implement a robust middleware function in TypeScript that computes the HMAC SHA-256 signature of an incoming raw request buffer and validates it against the `Stripe-Signature` header using constant-time comparison.
3. **Optimistic Locking Retry Loop**: Write a TypeScript function that performs an update on a PostgreSQL row with optimistic locking and retries up to 3 times with exponential backoff if a version conflict occurs.

---

## 17. Common Interview Traps

- **Trap 1: Decrementing database stock permanently upon adding to cart**: Adding an item to a shopping cart must not permanently decrease physical inventory. Only initiate soft reservation when the user clicks "Proceed to Checkout", and release it if payment is not completed within 15 minutes.
- **Trap 2: Parsing request body to JSON before checking webhook signatures**: Cryptographic HMAC signatures are calculated over the exact raw byte string of the payload. Parsing to JSON and stringifying changes whitespace and key order, causing signature validation to fail. Always pass the raw request buffer to signature verifiers.
- **Trap 3: Believing Kafka alone prevents race conditions**: While Kafka partitions enforce FIFO ordering per partition key, it does not provide instant atomic check-and-decrement capabilities across distributed consumers. Redis Lua is required for instantaneous validation.

---

## 18. Revision Summary

- **Core Problem**: High concurrency (50k+ QPS) causes database deadlocks and overselling race conditions under relational locks.
- **Solution Architecture**:
  - **Front Gating**: Virtual Waiting Room & Edge Rate Limiting.
  - **Inventory Layer**: In-Memory Redis Cluster executing atomic Lua scripts (`DECRBY`).
  - **Decoupled Billing**: Soft reservation token valid for 15 minutes; payment processed asynchronously via Stripe client SDK + Webhooks.
  - **Webhook Idempotency**: Atomic deduplication table in PostgreSQL / Redis prevents double-processing.
  - **Reconciliation**: Background sweepers release stock for abandoned checkouts.

---

## 19. Quick Reference Cheatsheet

```sql
-- Database Check Constraint (Defense-in-Depth)
ALTER TABLE products ADD CONSTRAINT check_stock_positive CHECK (stock >= 0);

-- Atomic SQL Decrement (Fallback for low-concurrency systems)
UPDATE products 
SET stock = stock - 1 
WHERE id = 42 AND stock >= 1;

-- Sweeper Query for Abandoned Orders
SELECT id, product_id, quantity FROM orders 
WHERE status = 'PAYMENT_PENDING' 
  AND created_at < NOW() - INTERVAL '15 minutes'
FOR UPDATE SKIP LOCKED;
```

```bash
# Redis Keys Layout
stock:<product_id>               # Integer: Current available stock
reservation:<order_id>           # Integer: Reserved quantity (TTL = 900s)
webhook:processed:<event_id>     # String: 'SUCCESS' (TTL = 7 days)
```
