# Capstone Project 3: E-Commerce Store & High-Reliability Payment Engine

## 1. What is it?
A **High-Reliability E-Commerce Store & Payment Engine** (exemplified by Shopify, Amazon, and Stripe-integrated platforms) is a business-critical full-stack distributed system designed to handle catalog exploration, lightning-fast product search, shopping cart management, payment processing, and ACID-compliant order fulfillment.

In senior engineering interviews, an e-commerce platform is the definitive test of financial integrity and system resilience:
1. **Full-Text Product Search**: Sub-50ms catalog querying across millions of SKUs using PostgreSQL **`tsvector` / `tsquery`** with weighted relevance ranking and fuzzy matching.
2. **Ephemeral Shopping Carts**: High-speed, multi-device cart synchronization backed by in-memory **Redis Hashes** with automated TTL expiration.
3. **ACID Inventory Locking**: Preventing double-booking or overselling under high concurrency using database row-level locking (**`SELECT FOR UPDATE`**) and check constraints.
4. **Idempotent Payment Webhook Ingestion**: Processing third-party payment gateway events (Stripe / Razorpay) with HMAC-SHA256 signature verification, deduplication tables, and transactional outbox state machines.

```
                    E-COMMERCE CHECKOUT & PAYMENT ENGINE
                    
 [ User Browser ] ──► 1. POST /api/checkout/create-intent ──► [ Node.js Express API ]
        │                                                              │
        │                                            2. Verify Stock & Lock:
        │                                               `SELECT stock FROM products ... FOR UPDATE`
        │                                            3. Create Stripe PaymentIntent
        │ ◄───4. Returns `client_secret` (Stripe)──────────────────────┤
        │
        ▼ 5. User Enters Card Details Directly on Stripe Elements Modal
 ┌────────────────────────────────────────────────────────┐
 │ Stripe Payment Gateway Network                         │
 └──────────────────────────┬─────────────────────────────┘
                            │
                            │ 6. Asynchronous Webhook (`payment_intent.succeeded`)
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │ Webhook Ingestion Controller                           │
 │ • Verifies HMAC-SHA256 Signature using raw body buffer │
 │ • Checks Idempotency Table: `processed_webhooks`       │
 │ • Inside DB Transaction:                               │
 │   - Transitions Order: `PENDING` ──► `PAID`            │
 │   - Decrements physical stock permanently              │
 │   - Emits OrderConfirmed event to Kafka / BullMQ       │
 └────────────────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Unlike social media feeds or blog platforms where an eventual-consistency glitch is harmless, e-commerce involves **real financial transactions and physical inventory**. Naive architectures lead to catastrophic financial discrepancies:

1. **The Double-Charge Problem**: A user clicks "Pay Now" twice on an unstable mobile connection. Without an **Idempotency Key**, the backend charges their credit card twice for a single order.
2. **The "Ghost Stock" Overselling Disaster**: If two users attempt to purchase the last pair of sneakers at the same millisecond, non-atomic database reads allow both transactions to succeed, forcing the company to cancel orders and refund angry customers.
3. **Webhook Dropped Packet Failure**: If your backend experiences a 5-second restart when Stripe sends the `payment.succeeded` webhook, the order remains stuck in `PENDING` forever unless you design an idempotent, replayable webhook ingestion pipeline.
4. **Slow Un-Indexed Catalog Queries**: A catalog with 500,000 products searched via naive SQL `LIKE '%laptop%'` forces full sequential table scans that take 4 seconds, crashing database CPUs under load.

---

## 3. Mental Model
Think of the e-commerce payment engine like a high-end jewelry store:
- You browse the display cases freely (Fast, cached product catalog & search).
- When you want to buy a rare watch, the clerk takes the physical watch out of the case and holds it behind the counter for you for 15 minutes (ACID soft inventory lock).
- You walk over to the bank teller window to hand over cash (Stripe payment processing).
- The teller stamps the receipt with a unique serial number (Idempotency key). If someone else tries to bring in a duplicate receipt, the teller stamps it "ALREADY PROCESSED".
- Only when the cash is verified does the clerk hand you the watch box and update the store ledger (Order Confirmed).

---

## 4. Basic Example: Naive Webhook Handling vs. Idempotent Processing

```typescript
// ❌ NAIVE WEBHOOK HANDLER: Dangerous & Vulnerable to Double-Fulfillment
app.post('/webhook', express.json(), async (req, res) => {
  const event = req.body; // Unverified raw JSON! Attacker can spoof events!
  if (event.type === 'payment.succeeded') {
    // If Stripe retries this webhook 3 times, stock is decremented 3 times!
    await db.query('UPDATE inventory SET stock = stock - 1 WHERE id = $1', [event.data.productId]);
  }
  res.send('OK');
});
```

```typescript
// ✅ PRODUCTION PATTERN: Cryptographically Verified & Idempotent
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  // 1. Verify HMAC Signature using RAW unparsed buffer
  const sig = req.headers['stripe-signature'];
  const event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);

  // 2. Atomic Deduplication Lock via Database / Redis
  const isProcessed = await markWebhookProcessed(event.id);
  if (!isProcessed) {
    return res.status(200).json({ message: 'Webhook already processed' });
  }

  // 3. Process business logic inside ACID transaction
  await fulfillOrder(event.data.object);
  res.status(200).json({ received: true });
});
```

---

## 5. Real Example: Enterprise Relational Schema & Full-Text Search Engine

### A. Production PostgreSQL Schema (`schema.sql`)
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Products Catalog with Full-Text Search Vector
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    price_cents INT NOT NULL, -- Store money in integer cents to eliminate float rounding errors!
    stock INT NOT NULL DEFAULT 0,
    search_vector TSVECTOR, -- Precomputed search vector for fast indexing
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT check_stock_positive CHECK (stock >= 0) -- Defensive check constraint!
);

-- Generalized Inverted Index (GIN) for instant Full-Text Search:
CREATE INDEX idx_products_search ON products USING GIN (search_vector);

-- Trigger to automatically update search_vector on product create/update:
CREATE OR REPLACE FUNCTION update_product_search_vector() RETURNS trigger AS $$
BEGIN
    NEW.search_vector := 
        setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B');
    RETURN NEW;
END
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_update_search_vector 
BEFORE INSERT OR UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION update_product_search_vector();

-- 2. Orders Table
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    total_amount_cents INT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PAYMENT_PENDING', -- PENDING, PAID, FAILED, CANCELLED
    stripe_payment_intent_id VARCHAR(120) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_orders_user ON orders (user_id, created_at DESC);

-- 3. Idempotency & Webhook Deduplication Store
CREATE TABLE processed_webhooks (
    event_id VARCHAR(120) PRIMARY KEY,
    event_type VARCHAR(64) NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### B. High-Performance Full-Text Search Query
```sql
-- Sub-5ms Ranked Full-Text Search with Prefix Matching
SELECT id, title, price_cents, stock,
       ts_rank(search_vector, query) AS relevance
FROM products, 
     to_tsquery('english', 'wireless & headphones:*') query
WHERE search_vector @@ query AND stock > 0
ORDER BY relevance DESC, created_at DESC
LIMIT 20;
```

---

## 6. Under the Hood: The Payment Webhook State Machine & Lock Contention

### A. The Payment State Machine Transitions
An order must follow a strict directed acyclic graph (DAG) of state transitions:

```
                  ORDER PAYMENT STATE MACHINE
                  
                        [ INITIATED ]
                              │
                              ▼
                     [ PAYMENT_PENDING ]
                              │
            ┌─────────────────┴─────────────────┐
            │ Webhook: `succeeded`              │ Webhook: `payment_failed` OR Timeout
            ▼                                   ▼
        [ PAID ]                            [ FAILED / EXPIRED ]
            │                                   │
            ▼                                   ▼
    Trigger Shipment                   Release Soft Stock Lock
```
- **Rule of Non-Reversible Transitions**: Once an order transitions to `PAID`, a delayed or duplicate `payment_intent.payment_failed` webhook must be **rejected**. The state machine enforces:
  `UPDATE orders SET status = 'PAID' WHERE id = $1 AND status = 'PAYMENT_PENDING'`.

### B. Pessimistic Row Locking Mechanics (`SELECT FOR UPDATE`)
When multiple concurrent requests attempt to check out the same product:
1. Transaction A executes: `SELECT stock FROM products WHERE id = 42 FOR UPDATE;`
2. PostgreSQL places an exclusive **Row-Level Lock** on that row.
3. Transaction B attempts to execute the same query simultaneously; PostgreSQL **blocks Transaction B** and puts it in a wait queue.
4. Transaction A verifies `stock >= 1`, decrements stock, and issues `COMMIT`.
5. Transaction B unblocks, reads the newly decremented stock (`stock = 0`), discovers the item is sold out, and aborts safely.

---

## 7. Important Rules

1. **Always Store Currency Values in Integer Cents**:
   Never use floating-point types (`FLOAT`, `DOUBLE`, `REAL`) for prices. In IEEE 754 floating-point arithmetic, `0.1 + 0.2 === 0.30000000000000004`. Storing money as floats causes accumulated rounding errors that break accounting ledgers. Always store money as integer cents (`$19.99` $\rightarrow$ `1999`).
2. **Verify Webhooks Using Raw Unparsed Buffers**:
   Cryptographic HMAC signatures are computed against the exact, byte-for-byte raw payload string. If your Express app runs `express.json()` before the webhook verifier, JSON parsers re-order keys and strip whitespace, altering the byte string and causing signature verification to fail with `Webhook Error: Signature verification failed`.
3. **Enforce Database Check Constraints**:
   Add `CONSTRAINT check_stock_positive CHECK (stock >= 0)`. Even if an application bug attempts to decrement stock below zero, the database engine physically rejects the transaction.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Fulfilling Orders on Frontend Redirects
Relying on the browser frontend redirecting to `/checkout/success` to mark an order as paid.
**Why it fails**: If the user closes their laptop or loses cellular connection the moment payment finishes, the redirect never fires. The customer is charged by their bank, but your database still lists the order as `PENDING`. **Rule**: Order fulfillment must occur exclusively via server-to-server **asynchronous webhooks**.

### 2. Executing External API Calls Inside Database Transactions
```typescript
// ❌ CRITICAL PERFORMANCE ANTI-PATTERN:
await db.transaction(async (tx) => {
  await tx.query('SELECT ... FOR UPDATE');
  // Holding a database lock while waiting for a 3-second Stripe HTTP call!
  const stripeCharge = await stripe.charges.create(...); 
  await tx.query('UPDATE orders SET status = "PAID"');
});
```
**Impact**: If Stripe takes 3 seconds, that database row lock remains held for 3 seconds, blocking hundreds of other database connections and freezing the connection pool. Execute external API calls *outside* database transactions.

---

## 9. Best Practices

- **Redis Cart Synchronization with Hash Data Types**:
  Store shopping carts in Redis using Hash structures (`HSET cart:usr_42 item_99 2`). This allows adding, updating, and removing individual cart line items in $O(1)$ time with an automatic 30-day TTL.
- **Client-Side Stripe Elements**:
  Never accept raw credit card numbers on your backend servers. Using **Stripe Elements** ensures credit card inputs are hosted in isolated iframes managed by Stripe. Card numbers are sent directly to Stripe's PCI-DSS compliant vault, and your backend only ever handles non-sensitive `PaymentMethod` tokens, drastically reducing PCI compliance scope.

---

## 10. Performance Considerations

- **Database Connection Pool Multiplexing (PgBouncer)**: E-commerce traffic spikes (such as Black Friday sales) create thousands of concurrent connections. Use PgBouncer in transaction pooling mode to multiplex traffic over a stable pool of 50 physical PostgreSQL connections.
- **GIN Index Search Optimization**: GIN indexes in PostgreSQL provide instant search results, but incur write overhead during heavy product updates. For catalogs with tens of millions of products, consider offloading search to a dedicated search engine (**Meilisearch** or **Elasticsearch**).

---

## 11. Security Considerations

- **Idempotency Key Validation**: Accept an `Idempotency-Key` HTTP header on `/api/checkout`. If a network glitch causes the client to retry the request with the same key, return the cached result of the initial transaction without re-executing payment.
- **Webhook Timestamp Verification**: Stripe signatures include a timestamp (`t=1609459200`). Sentry/Stripe SDKs reject any webhook whose timestamp is older than 5 minutes to prevent **Replay Attacks** where an attacker re-transmits an intercepted webhook.

---

## 12. Alternatives

| Component | Selected Approach | Alternative | Trade-off Analysis |
|---|---|---|---|
| **Product Search** | PostgreSQL GIN (`tsvector`) | Elasticsearch / Algolia | Postgres GIN requires zero extra infrastructure; Algolia is faster but expensive. |
| **Cart Storage** | Redis In-Memory Hashes | PostgreSQL Tables | Redis provides sub-millisecond cart updates and automated TTL expiration. |
| **Inventory Concurrency** | PostgreSQL `SELECT FOR UPDATE` | Redis Atomic Lua (`DECRBY`) | DB row locks provide ACID guarantees; Redis is preferred for extreme flash sales (>10k QPS). |

---

## 13. Trade-offs

- **Strict ACID Database Locks vs. Checkout Throughput**:
  Using `SELECT FOR UPDATE` ensures absolute inventory consistency and zero overselling, but serializes checkout requests for identical SKUs. For extreme flash sales (100,000 users buying 500 items in 5 seconds), this causes lock contention. Under extreme traffic, offload soft-reservation gating to Redis Lua scripts (as covered in Module 21).

---

## 14. Real-World Usage & Implementation Example: Complete Checkout & Webhook Service

```typescript
// checkout-engine.ts
import { Pool } from 'pg';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_mock', {
  apiVersion: '2023-10-16',
});

export class CheckoutEngine {
  private db: Pool;

  constructor(dbPool: Pool) {
    this.db = dbPool;
  }

  /**
   * 1. Initiates Checkout: Checks stock, creates Order, generates Stripe Intent
   */
  async createCheckoutIntent(userId: string, productId: string, quantity: number) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      // Pessimistic Row Lock: Protect against overselling race conditions!
      const productRes = await client.query(
        'SELECT id, title, price_cents, stock FROM products WHERE id = $1 FOR UPDATE',
        [productId]
      );

      if (productRes.rows.length === 0) {
        throw new Error('Product not found');
      }

      const product = productRes.rows[0];
      if (product.stock < quantity) {
        throw new Error('Insufficient inventory available');
      }

      const totalAmountCents = product.price_cents * quantity;

      // Create Order in PENDING status
      const orderRes = await client.query(
        `INSERT INTO orders (user_id, total_amount_cents, status)
         VALUES ($1, $2, 'PAYMENT_PENDING') RETURNING id`,
        [userId, totalAmountCents]
      );
      const orderId = orderRes.rows[0].id;

      await client.query('COMMIT');

      // Create Stripe PaymentIntent OUTSIDE the database transaction
      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalAmountCents,
        currency: 'usd',
        metadata: {
          orderId,
          productId,
          quantity: quantity.toString(),
        },
      });

      // Associate Payment Intent ID with Order
      await this.db.query(
        'UPDATE orders SET stripe_payment_intent_id = $1 WHERE id = $2',
        [paymentIntent.id, orderId]
      );

      return {
        orderId,
        clientSecret: paymentIntent.client_secret,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * 2. Idempotent Webhook Handler: Fulfills Order & Decrements Stock Atomically
   */
  async handlePaymentSucceededWebhook(event: Stripe.Event) {
    const paymentIntent = event.data.object as Stripe.PaymentIntent;
    const { orderId, productId, quantity } = paymentIntent.metadata;
    const qty = parseInt(quantity, 10);

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      // Step A: Idempotency Check (Has this webhook already been processed?)
      const idempRes = await client.query(
        `INSERT INTO processed_webhooks (event_id, event_type)
         VALUES ($1, $2)
         ON CONFLICT (event_id) DO NOTHING`,
        [event.id, event.type]
      );

      if (idempRes.rowCount === 0) {
        console.warn(`[DUPLICATE WEBHOOK]: Event ${event.id} already processed. Skipping.`);
        await client.query('ROLLBACK');
        return { status: 'ALREADY_PROCESSED' };
      }

      // Step B: Atomically Transition Order State
      const orderRes = await client.query(
        `UPDATE orders 
         SET status = 'PAID', updated_at = NOW() 
         WHERE id = $1 AND status = 'PAYMENT_PENDING'`,
        [orderId]
      );

      if (orderRes.rowCount === 0) {
        console.warn(`[INVALID STATE TRANSITION]: Order ${orderId} not in PAYMENT_PENDING state.`);
        await client.query('COMMIT');
        return { status: 'INVALID_STATE' };
      }

      // Step C: Decrement Physical Inventory Permanently
      await client.query(
        `UPDATE products 
         SET stock = stock - $1 
         WHERE id = $2 AND stock >= $1`,
        [qty, productId]
      );

      await client.query('COMMIT');
      console.log(`✅ [ORDER FULFILLED]: Order ${orderId} marked PAID. Inventory deducted.`);
      return { status: 'FULFILLED' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: Why should monetary values always be stored as integers instead of floating-point numbers?
**Answer**:
Computers represent floating-point numbers using binary fractions (IEEE 754 standard). Certain decimal fractions like `0.1` or `0.2` cannot be represented precisely in binary, leading to rounding inaccuracies (e.g., `0.1 + 0.2 = 0.30000000000000004`). In financial transactions and e-commerce, accumulated rounding discrepancies cause discrepancies between bank settlement amounts, customer receipts, and database ledgers. Storing currency as **integer cents** (`$19.99` $\rightarrow$ `1999`) ensures arithmetic operations are 100% exact.

### 2. Conceptual: Explain how an Idempotency Key prevents duplicate credit card charges.
**Answer**:
When an unstable network drops a connection after the client sends a payment request, the client cannot know if the server processed the charge. 
1. The client generates a unique UUID (**Idempotency Key**) and transmits it in the request header (`Idempotency-Key: e8f9b2d1-...`).
2. When the backend receives the request, it checks whether that key exists in an idempotency table.
3. If it is the first time the key is seen, the server saves the key in a `PROCESSING` state, executes the charge, saves the response, and returns the result.
4. If a retry with the exact same key arrives 2 seconds later, the server immediately returns the cached response without re-executing the payment charge, guaranteeing that the customer is billed exactly once.

### 3. Implementation: How does PostgreSQL's Full-Text Search (`tsvector` & `tsquery`) work under the hood?
**Answer**:
PostgreSQL implements Full-Text Search using two primitives:
- **`to_tsvector('english', text)`**: Parses raw text, removes stop words ("the", "is", "a"), and reduces words to their linguistic base stems (e.g., "running", "runs", "ran" all reduce to the root stem `'run'`).
- **`to_tsquery('english', 'running & shoes')`**: Converts a user search query into boolean search tokens.
- **GIN (Generalized Inverted Index)**: Indexes each distinct lexeme stem pointing to a list of matching row pointers (TIDs). When searching, PostgreSQL looks up the stems in the GIN index in $O(\log N)$ time, eliminating slow full-table scans.

### 4. Debugging: A webhook endpoint is returning `Signature verification failed` even though the Stripe webhook secret is 100% correct. What is the cause?
**Answer**:
The Express application used `express.json()` middleware **before** passing the request to the webhook verifier. 
Stripe's cryptographic signature is computed over the exact, un-parsed binary byte stream. When `express.json()` parses the request, it decodes JSON strings, re-orders object keys, and strips whitespace. Even a single changed whitespace character alters the computed SHA-256 hash. 
**Fix**: Configure the webhook route to use **`express.raw({ type: 'application/json' })`** so the verifier receives the pristine, untouched Buffer directly from the network socket.

### 5. Scenario: What happens if a payment webhook arrives BEFORE the checkout API route finishes creating the order in the database?
**Answer**:
This is the classic **Asynchronous Out-of-Order Webhook Race Condition**:
1. Stripe processes a payment in 200ms and fires the webhook immediately.
2. If the application server handling the initial checkout creation is experiencing a temporary database slowdown, the webhook may hit the server *before* the order row is committed.
3. The webhook query (`SELECT * FROM orders WHERE stripe_payment_intent_id = $1`) returns 0 rows.
4. **Remediation**:
   - If the order is not found, return **HTTP 500 or HTTP 404** to Stripe. Stripe automatically retries failed webhooks with exponential backoff (retrying at 5s, 1m, 15m, 1h).
   - On the retry, the database record will be present, and the order will fulfill normally.

### 6. Advanced: How do you implement inventory reservations during checkout without leaving items locked forever if the user abandons the payment modal?
**Answer**:
Implement **Soft Reservations with Time-To-Live (TTL)**:
1. When the user initiates checkout, do not permanently delete stock. Move the quantity into a `reserved_stock` column and record an expiration timestamp (`expires_at = NOW() + INTERVAL '15 minutes'`).
2. Run a lightweight scheduled background worker every 60 seconds:
   ```sql
   UPDATE products p
   SET stock = p.stock + o.quantity,
       reserved_stock = p.reserved_stock - o.quantity
   FROM orders o
   WHERE o.product_id = p.id 
     AND o.status = 'PAYMENT_PENDING' 
     AND o.created_at < NOW() - INTERVAL '15 minutes';
   
   UPDATE orders SET status = 'EXPIRED' 
   WHERE status = 'PAYMENT_PENDING' AND created_at < NOW() - INTERVAL '15 minutes';
   ```
3. This guarantees that abandoned shopping carts automatically return stock to the available pool for other shoppers.

---

## 16. Coding Questions & Practical Challenges

1. **PostgreSQL Full-Text Search Builder**: Write a TypeScript function that sanitizes raw user search input, handles prefix queries (e.g., `"headph*"`), and constructs a safe, parameterized SQL query using `to_tsquery`.
2. **Idempotency Decorator**: Implement a TypeScript function decorator or middleware that intercepts an Express endpoint, checks an in-memory Redis idempotency key, and caches responses for 24 hours.
3. **Cart Total Calculator with Tax & Discounts**: Write a pure function that takes an array of cart items, validates prices against a database price catalog (ignoring client-provided prices), applies discount coupon rules, and calculates sales tax using integer cents.

---

## 17. Common Interview Traps

- **Trap 1: Trusting prices sent from the client frontend**: Accepting `{ productId: 123, price: 10.00 }` from `req.body`. An attacker can modify the HTTP payload in Burp Suite and purchase a $1,000 laptop for $0.01. Always look up prices on the server using immutable database product IDs.
- **Trap 2: Forgetting to handle Webhook duplicate retries**: Stripe guarantees **at-least-once delivery**. A webhook *will* be sent multiple times if network packets drop. Without a `processed_webhooks` deduplication table, you risk shipping products twice or fulfilling orders multiple times.
- **Trap 3: Using client-side redirects for order confirmation**: Marking an order as `PAID` because the browser landed on `/success` will cause lost orders whenever users close their browsers prematurely.

---

## 18. Revision Summary

- **Financial Safety**: Store currency as integer cents; never use floating-point types.
- **Concurrency & Inventory**: Protect inventory using `SELECT FOR UPDATE` and database constraints (`CHECK stock >= 0`).
- **Webhook Integrity**: Validate HMAC SHA-256 signatures using raw request buffers; enforce idempotency via deduplication tables.
- **Search Efficiency**: Use PostgreSQL GIN indexes on `tsvector` columns for sub-5ms catalog queries.
- **Cart Management**: Use Redis Hashes with TTLs for fast, ephemeral shopping cart synchronization.

---

## 19. Quick Reference Cheatsheet

```sql
-- Full-Text Search GIN Index
CREATE INDEX idx_products_search ON products USING GIN (search_vector);

-- Atomic Inventory Deduction
UPDATE products 
SET stock = stock - $1 
WHERE id = $2 AND stock >= $1;

-- Webhook Deduplication Insert
INSERT INTO processed_webhooks (event_id, event_type)
VALUES ($1, $2)
ON CONFLICT (event_id) DO NOTHING;
```
