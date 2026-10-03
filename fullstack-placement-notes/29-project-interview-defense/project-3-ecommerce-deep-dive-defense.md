# Project 3: High-Concurrency E-Commerce & Flash Sale Defense Guide

## 1. What is it?
The **High-Concurrency E-Commerce & Flash Sale Platform** is a full-stack, distributed transactional commerce system engineered to handle massive, concurrent traffic spikes (such as Black Friday or limited-quantity flash sales with 50,000+ requests per second) without **overselling inventory**, experiencing database deadlocks, or dropping payment transactions.

In placement interviews, candidates present this project to demonstrate:
- Concurrency control and anti-overselling algorithms (Pessimistic Locking, Optimistic Concurrency Control, and Redis Atomic Decrements).
- Distributed payment webhook processing with strict **Idempotency Guarantees**.
- Asynchronous checkout queues and traffic shedding via BullMQ and Redis.
- High-performance catalog caching and search indexing with Elasticsearch/PostgreSQL.

```
       HIGH-CONCURRENCY FLASH SALE CHECKOUT PIPELINE
       
   50,000 Users Clicking "Buy Now"
                │
                ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ API GATEWAY & RATE LIMITER (Nginx / Cloudflare)             │
   │  - Drops illegitimate bot traffic & malicious bursts        │
   └───────────────┬─────────────────────────────────────────────┘
                   │ Allowed Traffic
                   ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ REDIS INVENTORY RESERVATION ENGINE (Atomic Lua Script)      │
   │                                                             │
   │  if redis.call('GET', stockKey) >= qty then                 │
   │     redis.call('DECRBY', stockKey, qty)                     │
   │     return ALLOW_CHECKOUT                                   │
   │  else                                                       │
   │     return OUT_OF_STOCK                                     │
   └───────────────┬─────────────────────────────────────────────┘
                   │ Inventory Reserved (Sub-millisecond)
                   ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ ASYNC ORDER MESSAGE QUEUE (BullMQ / RabbitMQ)               │
   │  - Buffers spikes; drains writes at steady DB ingestion rate│
   └───────────────┬─────────────────────────────────────────────┘
                   │ Steady Worker Processing
                   ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ POSTGRESQL PRIMARY (ACID Ledger & Final Order Persistence)  │
   └─────────────────────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Standard e-commerce architectures fail under flash sale conditions:
1. **The Overselling Catastrophe:** 10,000 shoppers submit checkouts at the same second for 50 remaining iPhones. A naive `SELECT stock FROM products` reads 50 for all 10,000 users, issuing 10,000 successful orders for 50 physical items.
2. **Database Connection Saturation:** Relational databases choke when 50,000 simultaneous connections contend for row locks on the same inventory record, triggering query timeouts and full database crashes.
3. **Double Charges on Payment Webhooks:** Network retries from Stripe/PayPal deliver duplicate webhook events, charging customers twice or creating duplicate orders.

---

## 3. Mental Model
Think of the flash sale system as a **Concert Ticket Box Office with a Ticket Token Dispenser**:

```
                       CONCERT BOX OFFICE ANALOGY
                       
  ❌ The Naive Database Approach (The Free-For-All):
     - 50,000 fans rush into the small box office door simultaneously.
     - The clerk faints (Database CPU hits 100%), and everyone grabs tickets off the desk.
     
  ✅ The Redis Reservation Token Dispenser:
     - Fans wait outside in line.
     - An automated high-speed turnstile dispenses exactly 50 physical numbered tokens
       in 2 milliseconds (Atomic Redis DECRBY).
     - Fans without a token are turned away immediately at the door ("Sold Out").
     - The 50 token holders are walked into the box office one by one to pay and finalize
       their paperwork in peace (Asynchronous DB Queue).
```

---

## 4. Basic Example: The Race Condition in Inventory Decrement

### The Buggy Naive Approach
```typescript
// ❌ CRITICAL BUG: Allows massive overselling under concurrency!
app.post('/api/checkout', async (req, res) => {
  const { productId, quantity } = req.body;

  // 1. Read current stock
  const { rows } = await db.query('SELECT stock FROM products WHERE id = $1', [productId]);
  const currentStock = rows[0].stock;

  // 2. Condition check
  if (currentStock >= quantity) {
    // Context switch / race condition happens right here!
    // 500 concurrent threads pass this IF check simultaneously!
    
    // 3. Write back decremented stock
    await db.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [quantity, productId]);
    
    await createOrder(req.user.id, productId, quantity);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Out of stock' });
  }
});
```

---

## 5. Real Example: 3 Concurrency Strategies Compared

### Strategy 1: SQL Single-Statement Atomic Decrement (Good for Moderate Load)
Eliminates application-level read-modify-write race conditions using PostgreSQL's row-level lock.

```sql
-- Atomic SQL Guard: Stock can NEVER drop below zero!
UPDATE products 
SET stock = stock - $quantity 
WHERE id = $product_id AND stock >= $quantity
RETURNING id, stock;

-- If rowCount === 0: Stock was insufficient! Abort transaction.
```

### Strategy 2: Pessimistic Locking with `SELECT FOR UPDATE`
```typescript
async function purchaseWithPessimisticLock(productId: string, quantity: number, client: any) {
  await client.query('BEGIN');
  
  try {
    // Explicit row-level lock: blocks all other transactions until COMMIT
    const { rows } = await client.query(
      'SELECT stock FROM products WHERE id = $1 FOR UPDATE',
      [productId]
    );

    if (rows[0].stock < quantity) {
      await client.query('ROLLBACK');
      return { success: false, reason: 'OUT_OF_STOCK' };
    }

    await client.query(
      'UPDATE products SET stock = stock - $1 WHERE id = $2',
      [quantity, productId]
    );

    await client.query('COMMIT');
    return { success: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
```

### Strategy 3: Distributed Redis Atomic Reservation (Production Flash Sale standard)
Protects the database from all excess traffic. Only successful reservations hit PostgreSQL.

```typescript
import Redis from 'ioredis';
const redis = new Redis();

const reserveStockLua = `
  local stockKey = KEYS[1]
  local qty = tonumber(ARGV[1])
  local currentStock = tonumber(redis.call('GET', stockKey) or '0')

  if currentStock >= qty then
    redis.call('DECRBY', stockKey, qty)
    return 1 -- Success
  else
    return 0 -- Insufficient Stock
  end
`;

export async function reserveFlashSaleStock(productId: string, quantity: number): Promise<boolean> {
  const result = await redis.eval(
    reserveStockLua,
    1,
    `stock:${productId}`,
    quantity
  );
  return result === 1;
}
```

---

## 6. Under the Hood: Stripe Webhook Idempotency Architecture

```
         STRIPE WEBHOOK IDEMPOTENT PROCESSING PIPELINE
         
   Stripe Server                              Your Node.js Webhook Endpoint
        │                                                  │
        │ ── POST /api/webhooks/stripe ──────────────────► │
        │    Header: Stripe-Signature                     │
        │    Payload: { id: "evt_101", type: "charge" }   │
        │                                                  │
        │                                                  ├── 1. Verify HMAC Signature
        │                                                  │
        │                                                  ├── 2. BEGIN SQL Transaction
        │                                                  │
        │                                                  ├── 3. INSERT INTO processed_events 
        │                                                  │      (event_id) VALUES ('evt_101')
        │                                                  │      ON CONFLICT DO NOTHING
        │                                                  │
        │                                                  ├── 4. Did insert succeed?
        │                                                  │      NO (Already processed) ──► Return 200 OK immediately!
        │                                                  │      YES (First time) ───────► Fulfill order & send email
        │                                                  │
        │                                                  ├── 5. COMMIT Transaction
        │                                                  │
        │ ◄── 200 OK Response ──────────────────────────── │
```

---

## 7. Important Rules

1. **Verify Webhook Signatures with Raw Bodies:** Never use parsed JSON to verify Stripe/PayPal webhook signatures. You must use the raw unparsed `Buffer` payload to match cryptographic HMAC signatures.
2. **Never Rely on Client Prices:** The client sends only `productId` and `quantity`. Prices must always be queried from the database or authoritative Redis cache on the server.
3. **Inventory Reservation Expiry:** Temporary reservations (e.g. held in cart for 10 minutes) must have an automated TTL in Redis or a scheduled task to release reserved stock if payment is abandoned.

---

## 8. Common Mistakes

- **Mistake 1:** Performing external HTTP calls (like Stripe API requests) inside an open SQL transaction. This holds database connection locks open across network latency, exhausting connection pools.
- **Mistake 2:** Missing database unique constraints on `(order_id, event_id)` for payment receipts.
- **Mistake 3:** Synchronously processing PDF invoice generation and order confirmation emails in the main checkout HTTP response.

---

## 9. Best Practices

1. **Idempotency Keys:** Require an `Idempotency-Key` header on all checkout POST requests. Cache the response in Redis for 24 hours so network retries receive identical responses without creating duplicate orders.
2. **Dead-Letter Queues (DLQ):** Route failed order processing jobs to a DLQ after 3 exponential backoff attempts for manual review.
3. **Database Read Replicas:** Route catalog browsing (`GET /products`) to Read Replicas, reserving the Primary instance strictly for order transactions.

---

## 10. Performance Considerations

| Concurrency Method | Max Throughput (ops/sec) | Latency | Database Load |
|---|---|---|---|
| **Pessimistic Lock (`FOR UPDATE`)** | ~800 ops/sec | High (Contention queues) | 100% (High CPU) |
| **Atomic Single SQL (`stock >= qty`)** | ~2,500 ops/sec | Moderate | 60% |
| **Redis Lua Atomic Reservation** | 75,000+ ops/sec | Sub-millisecond | Negligible (DB shielded) |

---

## 11. Security Considerations
- **Price Manipulation:** Always calculate line-item totals on the server.
- **Race Condition Coupon Exploit:** Ensure promo codes with maximum usage limits (e.g. "FIRST50") decrement their usage counter atomically, preventing thousands of users from applying a limited coupon simultaneously.

---

## 12. Alternatives
1. **Saga Pattern (Orchestration vs Choreography):** For distributed microservices where Inventory, Payment, and Shipping live in separate databases.
2. **Two-Phase Commit (2PC):** Traditional distributed transactions (rarely used in modern web scale due to coordinator blocking).

---

## 13. Trade-offs

| Strategy | Advantages | Trade-offs |
|---|---|---|
| **Redis Inventory Pre-Allocation** | Extreme throughput; shields relational DB | Eventual consistency; requires compensating transactions on reconciliation failures |
| **Strict ACID DB Locking** | 100% immediate consistency | Bottleneck on single row updates; cannot handle flash sales |

---

## 14. Real-World Usage
- **Amazon & Shopify:** Uses distributed reservation caches with temporary lock timers during checkout.
- **Ticketmaster:** Places users in a virtual waiting room, reserving seat inventory for 8 minutes via Redis TTLs while users complete payment details.

---

## 15. Placement Interview Questions (Defense & System Design)

### Basic
1. *What is Idempotency in payment processing, and why is it critical?*
   - **Answer:** Idempotency ensures that performing an operation multiple times produces the exact same outcome as performing it once. If a user clicks "Submit Payment" twice or the network drops and retries, an idempotent API ensures the customer is only charged once.

### Conceptual
2. *Why does `SELECT stock FROM products` followed by `UPDATE products` fail during flash sales?*
   - **Answer:** It creates a classic Race Condition (Time-of-Check to Time-of-Use - TOCTOU). Multiple threads execute the check concurrently before any thread executes the update, reading outdated stock numbers and causing overselling.

### Implementation
3. *How do you handle expired cart reservations in Redis?*
   - **Answer:** Store reservations in Redis with a 10-minute TTL (`SETEX reservation:orderId 600 stock`). If payment succeeds, delete the key. If it expires, listen to Redis Keyspace Notifications (`__keyevent@0__:expired`) or run a background worker to return the stock back to the main inventory pool.

### Debugging
4. *Your database reports deadlocks during high-volume checkouts involving multiple items in a cart. How do you resolve this?*
   - **Answer:** Deadlocks occur when Transaction 1 locks Product A and waits for Product B, while Transaction 2 locks Product B and waits for Product A. To fix, always acquire row locks in **deterministic sorted order by ID** (e.g., sort cart item product IDs in ascending alphanumeric order before querying `FOR UPDATE`).

### Scenario
5. *How would you design a flash sale system where 100,000 users attempt to purchase 1,000 gaming consoles in 10 seconds?*
   - **Answer:**
     1. Shield backend with Cloudflare rate limiting and edge caching for product details.
     2. Pre-load inventory into Redis (`stock:console = 1000`).
     3. Decrement stock atomically via Redis Lua script. The first 1,000 requests succeed; the remaining 99,000 receive an instant "Sold Out" response without touching PostgreSQL.
     4. Enqueue the 1,000 successful reservation tokens into a BullMQ message queue.
     5. Background workers process orders sequentially against PostgreSQL and Stripe.

---

## 16. Coding Questions

### Problem: Stripe Webhook Idempotency Handler
Write a TypeScript Express route that processes Stripe checkout events idempotently.

```typescript
import { Request, Response } from 'express';
import Stripe from 'stripe';
import { pool } from '../db';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2023-10-16' });

export async function handleStripeWebhook(req: Request, res: Response) {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;

  try {
    // 1. Verify cryptographic HMAC signature using RAW body buffer
    event = stripe.webhooks.constructEvent(
      req.body, // Must be raw Buffer (via express.raw({ type: 'application/json' }))
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err: any) {
    return res.status(400).send(`Webhook Signature Verification Error: ${err.message}`);
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 2. Idempotency Guard: Insert event ID into ledger table
    const dedupeQuery = `
      INSERT INTO processed_events (event_id, event_type, created_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (event_id) DO NOTHING
      RETURNING event_id;
    `;
    const dedupeResult = await client.query(dedupeQuery, [event.id, event.type]);

    // If rowCount === 0, event was ALREADY processed in a previous delivery attempt
    if (dedupeResult.rowCount === 0) {
      await client.query('ROLLBACK');
      console.log(`Duplicate event ${event.id} ignored.`);
      return res.status(200).json({ received: true, status: 'duplicate_ignored' });
    }

    // 3. Process business logic based on event type
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.orderId;

      await client.query(
        'UPDATE orders SET payment_status = $1, updated_at = NOW() WHERE id = $2',
        ['PAID', orderId]
      );
    }

    await client.query('COMMIT');
    return res.status(200).json({ received: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Webhook processing failure:', error);
    // Return 500 so Stripe will retry with exponential backoff
    return res.status(500).json({ error: 'Webhook processing failed' });
  } finally {
    client.release();
  }
}
```

---

## 17. Common Interview Traps
- **Trap 1:** Relying on frontend cart state for price calculation.
  *Reality:* Any user can edit their cart in DevTools and submit an order with a price of `$0.01`. Always recalculate prices server-side from primary database records.
- **Trap 2:** Confusing Optimistic Locking with Pessimistic Locking.
  *Reality:* Pessimistic locking acquires database row locks upfront (`FOR UPDATE`), blocking competitors. Optimistic locking does not lock rows; it validates a `version` column on update and aborts/retries if another transaction committed first.

---

## 18. Revision Summary
- **Anti-Overselling:** Use atomic SQL decrements (`WHERE stock >= qty`) or Redis Lua scripts (`DECRBY`) to guarantee zero overselling.
- **Flash Sale Architecture:** Redis for sub-millisecond stock reservations + message queues to throttle database writes.
- **Payment Safety:** Enforce idempotency using unique database event ledgers and verify webhook signatures with raw body buffers.
- **Deadlock Defense:** Always lock multiple cart items in deterministic sorted order.

---

## 19. Quick Reference

```
┌─────────────────────────────────┬───────────────────────────────────────────────┐
│ E-COMMERCE CHALLENGE            │ PRODUCTION REMEDY                             │
├─────────────────────────────────┼───────────────────────────────────────────────┤
│ Overselling Prevention          │ Atomic UPDATE WHERE stock >= qty OR Redis Lua │
│ Flash Sale DB Protection        │ In-Memory Redis Reservation + BullMQ Workers  │
│ Duplicate Payment Webhooks      │ Idempotent Event Ledger Table (ON CONFLICT)   │
│ Multi-Item Cart Deadlocks       │ Sort product IDs alphanumerically before locks│
│ Expired Cart Stock Release      │ Redis Key TTLs + Keyspace Expiry Listener     │
│ Webhook Signature Failure       │ Use unparsed Buffer payload (not parsed JSON) │
└─────────────────────────────────┴───────────────────────────────────────────────┘
```
