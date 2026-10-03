# Full-Stack One-Day Emergency Placement Revision Guide

---

## 1. What is it?

The Full-Stack One-Day Emergency Placement Revision Guide is an ultra-dense, comprehensive technical synthesis designed for final-round revision the night or morning before a tier-1 software engineering interview. It distills the fundamental architecture of modern full-stack web engineering—from **React Fiber reconciliation and Next.js RSC wire protocols** to **Node.js Libuv event loop mechanics, PostgreSQL B-Tree indexing, OAuth2/OIDC token lifecycles, and distributed system trade-offs (CAP/PACELC)**—into a unified, rapid-retrieval cognitive framework.

```
+-----------------------------------------------------------------------------------+
|                   The End-to-End Full-Stack Request Highway                       |
+-----------------------------------------------------------------------------------+
| 1. CLIENT (Browser): DOM Event -> React Fiber -> Virtual DOM Diff -> State Update  |
| 2. EDGE / CDN:       Anycast DNS -> TLS Termination -> Cloudflare Edge Cache / WAF |
| 3. GATEWAY / PROXY:  Nginx / Envoy -> Load Balancer (L7) -> Rate Limiting (Token)  |
| 4. RUNTIME (Node):   Libuv Event Loop -> Microtask Queue -> Express Middleware     |
| 5. DATA (Database):  PgBouncer -> PostgreSQL Engine -> B-Tree Index -> WAL -> Disk |
| 6. ASYNC (Broker):   Kafka / Redis PubSub -> Background Workers -> Notifications   |
+-----------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

During placement season, candidates often suffer from cognitive overload after studying dozens of isolated libraries, frameworks, and syntax rules. When interviewers ask cross-cutting architectural questions—such as *"What happens under the hood when a user submits an order form from a React client to a PostgreSQL database?"*—candidates frequently give fragmented answers.

This guide exists to:
1. **Connect the Full-Stack Chain:** Provide an unbroken, coherent narrative spanning the browser runtime, network transmission, server execution, database persistence, and distributed coordination.
2. **Prevent Last-Minute Panic:** Consolidate high-frequency formulas, status codes, algorithms, and gotchas into a single high-density checklist.
3. **Calibrate Senior Engineering Intuition:** Reinforce the core design trade-offs (Consistency vs Latency, Memory vs CPU, Normalization vs Read Speed).

---

## 3. Mental Model

To master cross-cutting placement interviews, visualize the entire full-stack ecosystem as **State Transitions Across Physical Boundaries**:

```
[ Browser Memory (JS Heap) ]
       |  (JSON / RSC Serialization over TLS 1.3 TCP Socket)
       v
[ Edge & Gateway Network Sockets ]
       |  (HTTP Chunked Transfer / Multiplexed Stream)
       v
[ Node.js V8 Engine Heap & Libuv Thread Pool ]
       |  (Binary Wire Protocol over Persistent TCP Pool)
       v
[ PostgreSQL Shared Buffers (RAM) & Write-Ahead Log (NVMe Disk) ]
```

* **Frontend:** Manages asynchronous user interaction, optimistic local state, and tree reconciliation.
* **Network & Gateway:** Validates security headers, terminates TLS, enforces rate limits, and load balances.
* **Backend Runtime:** Executes business logic in a single-threaded non-blocking event loop, delegating I/O to the kernel or thread pool.
* **Persistence:** Enforces ACID invariants, indexes search keys via B-Trees, and commits append-only WAL logs to non-volatile storage.

---

## 4. Basic Example

### The Full-Stack Contract: Type-Safe Request, Mutation, and Response

```typescript
// shared/types.ts
export interface CreateOrderDTO {
  productId: string;
  quantity: number;
}

export interface OrderResponse {
  orderId: string;
  status: "CONFIRMED" | "FAILED";
  totalAmountCents: number;
}

// client/useCreateOrder.ts (React Hook)
export function useCreateOrder() {
  const [loading, setLoading] = useState(false);

  const placeOrder = async (dto: CreateOrderDTO): Promise<OrderResponse> => {
    setLoading(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dto),
      });
      if (!res.ok) throw new Error("Order creation failed");
      return await res.json();
    } finally {
      setLoading(false);
    }
  };

  return { placeOrder, loading };
}
```

---

## 5. Real Example

### End-to-End Transactional Controller with In-Memory Idempotency & DB Locking

```typescript
// server/controllers/orderController.ts
import { Request, Response } from "express";
import { z } from "zod";
import { pool } from "@/lib/db";
import { redis } from "@/lib/redis";

const OrderSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
});

export async function createOrderHandler(req: Request, res: Response) {
  // 1. Validate Schema
  const parseResult = OrderSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: "Invalid payload", details: parseResult.error.format() });
  }
  const { productId, quantity, idempotencyKey } = parseResult.data;

  // 2. Distributed Idempotency Guard (Redis SETNX with 60s TTL)
  const isNew = await redis.set(`idemp:${idempotencyKey}`, "PROCESSING", { NX: true, EX: 60 });
  if (!isNew) {
    return res.status(409).json({ error: "Duplicate request detected or currently in-flight." });
  }

  const client = await pool.connect();
  try {
    // 3. ACID Transaction with Row-Level Lock
    await client.query("BEGIN;");

    // Lock product row to prevent race conditions during inventory decrement
    const prodRes = await client.query(
      "SELECT id, price_cents, stock_count FROM products WHERE id = $1 FOR UPDATE;",
      [productId]
    );

    if (prodRes.rows.length === 0) {
      await client.query("ROLLBACK;");
      return res.status(404).json({ error: "Product not found" });
    }

    const product = prodRes.rows[0];
    if (product.stock_count < quantity) {
      await client.query("ROLLBACK;");
      return res.status(422).json({ error: "Insufficient inventory" });
    }

    // Decrement stock
    await client.query(
      "UPDATE products SET stock_count = stock_count - $1 WHERE id = $2;",
      [quantity, productId]
    );

    // Create Order Record
    const totalAmount = product.price_cents * quantity;
    const orderRes = await client.query(
      "INSERT INTO orders (product_id, quantity, total_amount, status) VALUES ($1, $2, $3, 'CONFIRMED') RETURNING id;",
      [productId, quantity, totalAmount]
    );

    await client.query("COMMIT;");

    // Update Redis idempotency key with finished status
    await redis.set(`idemp:${idempotencyKey}`, "COMPLETED", { EX: 86400 });

    return res.status(201).json({
      orderId: orderRes.rows[0].id,
      status: "CONFIRMED",
      totalAmountCents: totalAmount,
    });
  } catch (err: any) {
    await client.query("ROLLBACK;");
    await redis.del(`idemp:${idempotencyKey}`); // Release idempotency lock on crash
    console.error("[Order Creation Error]:", err);
    return res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release(); // Crucial: return connection to pool
  }
}
```

---

## 6. Under the Hood

### The Complete End-to-End Journey of an HTTP Request

```
[ User Browser ]
  | 1. DNS Resolution (Browser cache -> OS hosts -> Recursive DNS -> Authoritative)
  | 2. TCP 3-Way Handshake (SYN -> SYN-ACK -> ACK)
  | 3. TLS 1.3 Negotiation (ClientHello -> ServerHello + Certificate -> Finished)
  | 4. HTTP/2 or HTTP/3 Multiplexed Stream Frame sent
  v
[ Cloudflare / CDN Edge ]
  | 5. DDoS Inspection & WAF check (block SQLi, XSS, rate-limit check)
  | 6. Cache check: If static asset or cached API -> Return 200 OK immediately
  v
[ Nginx Reverse Proxy / Load Balancer ]
  | 7. SSL Termination (Decodes TLS, reads X-Forwarded-For)
  | 8. Round Robin / Least Connections routing to healthy upstream Node pod
  v
[ Node.js Runtime & Express ]
  | 9. Libuv Poll Phase reads bytes from socket, constructs IncomingMessage
  | 10. Express Middleware pipeline: CORS -> Helmet -> Body-parser -> Route Handler
  v
[ Database Layer (PostgreSQL) ]
  | 11. PgBouncer routes query over pre-warmed connection pool
  | 12. Query Optimizer plans execution (Index Scan vs Seq Scan)
  | 13. Engine locks row (`FOR UPDATE`), writes delta to WAL buffer, updates Heap
  v
[ Response Trip ]
  | 14. PostgreSQL acknowledges commit -> Node receives row -> Serializes JSON
  | 15. Nginx buffers -> Browser receives stream -> React updates UI state
```

---

## 7. Important Rules

1. **The Rule of Single Source of Truth:** Never store duplicate state across multiple tiers without an explicit synchronization strategy. If the database is the source of truth, caches must be invalidated immediately upon mutation (Cache-Aside: update DB, then delete cache).
2. **The Rule of Defense-in-Depth:** Never rely solely on client-side validation. HTML5 `required` or React hook validations are UX conveniences; every single parameter must be strictly re-validated on the backend (using Zod/Joi) and constrained in the database schema (`CHECK`, `NOT NULL`, `FOREIGN KEY`).
3. **The Rule of Asynchronous Boundaries:** Never execute CPU-heavy calculations (image encoding, PDF generation, cryptographic mining) or slow third-party calls (email dispatch) on the main HTTP request thread. Offload to asynchronous job queues (BullMQ/Kafka).
4. **The Rule of Least Privilege:** Database application credentials should never have `DROP TABLE`, `ALTER TABLE`, or superuser permissions. Web users should only have row-level grants strictly scoped to their tenant or user ID.

---

## 8. Common Mistakes

### Mistake 1: Relying on In-Memory State in Distributed Deployments
Storing user sessions, rate-limiting counts, or WebSocket connections in Node.js process memory (`const sessions = {}`). The moment traffic scales to 2 or more instances behind a load balancer, subsequent requests fail because instances do not share RAM. Always use **Redis**.

### Mistake 2: Missing Cleanup in Asynchronous Operations
Forgetting `finally { client.release(); }` when querying database connection pools, or forgetting `return () => clearTimeout(timer)` in React `useEffect`. This silently leaks connections and memory, eventually crashing production containers.

### Mistake 3: Unindexed Foreign Keys in Relational Databases
Assuming that creating a `FOREIGN KEY (user_id) REFERENCES users(id)` automatically creates an index on `user_id`. It does not! Deleting a user triggers an unindexed sequential table scan across millions of dependent rows, locking the entire table.

---

## 9. Best Practices

1. **Structured JSON Logging with Correlation IDs:** Every request must generate or propagate an `X-Correlation-Id` header across all microservices, databases, and logs for unified distributed tracing.
2. **Graceful Shutdown Protocol:** Capture `SIGTERM` and `SIGINT`, stop accepting new HTTP traffic via `server.close()`, wait for inflight queries to complete (with a 10s timeout), close database pools, and exit cleanly.
3. **Idempotency Keys on All Mutations:** Support an `Idempotency-Key` header on all non-safe HTTP methods (`POST`, `PATCH`) to safely survive client retries and network drops without duplicate charges or writes.
4. **Strict Content Security Policy & Cookie Hardening:** Use `HttpOnly`, `Secure`, `SameSite=Lax`, and `__Host-` cookie prefixes to make session cookies immune to JavaScript theft and CSRF.

---

## 10. Performance Considerations

* **The Critical Rendering Path:** Minimize render-blocking CSS/JS. Use `next/font` for zero CLS font loading, `next/image` for responsive AVIF/WebP image formats, and code-split heavy components with dynamic imports (`React.lazy`).
* **Database Buffer Pool Sizing:** Ensure PostgreSQL `shared_buffers` is configured to 25% of system RAM. Monitor cache hit ratios using `pg_statio_user_tables`; a healthy OLTP production database must maintain a **>99% cache hit ratio**.
* **Stream Piping over Memory Buffering:** Never load 50MB files into V8 RAM with `fs.readFile()`. Stream directly using `stream.pipeline(readStream, transformStream, res)` to keep heap memory flat under 30MB.

---

## 11. Security Considerations

* **OWASP Top 10 Rapid Checklist:**
  1. *Injection:* Solved via Parameterized SQL queries ($1, $2).
  2. *Broken Auth:* Solved via Argon2id password hashing, MFA, HttpOnly cookies, and Refresh Token Rotation.
  3. *Sensitive Data Exposure:* Solved via TLS 1.3 everywhere, AES-256 encryption at rest, and secret masking in logs.
  4. *XML/JSON Entities / SSRF:* Solved by validating all user-provided URLs against internal RFC 1918 private IP ranges before fetching.
  5. *Broken Access Control (IDOR):* Solved by enforcing ownership checks (`WHERE id = $1 AND user_id = $2`) or PostgreSQL Row-Level Security.

---

## 12. Alternatives

| Layer / Technology | Standard Choice | Modern Alternative | When to Switch |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | React 18/19 (SPA) | Next.js App Router (RSC) | Need SEO, zero-bundle server logic, instant initial page load |
| **Backend Runtime** | Node.js (Express) | Go (Gin) or Fastify | Request throughput exceeds 50,000 req/sec or low memory footprint required |
| **Primary Database** | PostgreSQL | MongoDB / ScyllaDB | Semi-structured documents or massive write-heavy append-only scale |
| **Caching Layer** | Redis | Dragonfly / KeyDB | Single-threaded Redis CPU saturation under millions of concurrent IOPS |

---

## 13. Trade-offs

* **Developer Velocity vs Maximum Throughput:** Node.js and TypeScript provide maximum code-sharing velocity and rapid prototyping, but consume more RAM (~100MB per pod) and have lower raw CPU performance than compiled languages like Go or Rust.
* **Denormalization vs Data Integrity:** Denormalizing data into cached views or document stores speeds up read queries to under 2ms, but requires complex multi-step synchronization logic to avoid stale data during updates.

---

## 14. Real-World Usage

* **Stripe Payment Gateway:** Uses idempotency keys on every POST endpoint, dual-write database migrations with zero downtime, and strict RS256 webhook signatures.
* **Uber Dispatch System:** Uses consistent hashing rings (Ringpop) and geospatial H3 indexing to assign drivers in real time with sub-100ms latency.

---

## 15. Placement Interview Questions & Core Rapid Q&A

### Basic Level
1. **Explain the difference between SSR, SSG, ISR, and CSR.**
   * *Answer:*
     - *CSR (Client-Side Rendering):* Browser receives empty HTML shell, downloads JS bundle, fetches data via AJAX, and renders UI. Slow FCP/LCP, poor SEO, zero server load.
     - *SSR (Server-Side Rendering):* Server executes components and fetches data on *every incoming request*, returning fully rendered HTML. Fast FCP, high TTFB, high server load.
     - *SSG (Static Site Generation):* HTML is rendered once *at build time* and served instantly from CDN edge nodes. Fastest possible TTFB, but cannot handle dynamic user-specific data.
     - *ISR (Incremental Static Regeneration):* Static pages are served from cache; after a configured revalidation time (e.g., 60s), Next.js regenerates the page in the background upon the next request (Stale-While-Revalidate).

2. **What is the difference between `null` and `undefined` in JavaScript/TypeScript?**
   * *Answer:* `undefined` means a variable has been declared but has not yet been assigned a value (or a function has no return value). It is the runtime default. `null` is an intentional assignment representing the explicit absence of any object value. In `typeof`, `typeof undefined === 'undefined'`, whereas `typeof null === 'object'` (a historical JavaScript bug).

3. **What is CORS and why does it exist?**
   * *Answer:* Cross-Origin Resource Sharing is a browser-enforced security mechanism based on the Same-Origin Policy (SOP). It prevents malicious scripts on `evil.com` from making unauthorized authenticated AJAX requests to `bank.com` and reading sensitive responses. The server uses headers (`Access-Control-Allow-Origin`) to inform the browser which external domains are permitted.

4. **What are HTTP Preflight requests?**
   * *Answer:* When a client makes a "non-simple" cross-origin HTTP request (e.g., using methods other than GET/POST/HEAD, or using custom headers like `Authorization`, or `Content-Type: application/json`), the browser automatically sends an initial `OPTIONS` request (preflight). The server must respond with permitted methods and headers before the browser dispatches the actual request.

5. **What is an Index in a database and what is its primary data structure?**
   * *Answer:* An index is an auxiliary data structure that improves the speed of data retrieval operations on a database table at the cost of additional write time and storage space. The dominant structure is the **B-Tree** (or B+ Tree), which maintains sorted keys in hierarchical nodes with high fan-out, providing $O(\log N)$ search, insert, and range query complexity.

---

### Conceptual Level
6. **Walk me through the JavaScript Event Loop order of operations.**
   * *Answer:*
     1. Execute synchronous code on Call Stack until empty.
     2. Drain the entire **Microtask Queue** (first `process.nextTick` queue in Node, followed by `Promise.then` / `catch` / `finally` callbacks).
     3. Render DOM changes (in browser).
     4. Pick ONE macrotask from the Macrotask Queue (e.g., `setTimeout`, `setInterval`, I/O, `setImmediate` in Node).
     5. Repeat: after that single macrotask finishes, immediately drain the entire Microtask Queue again before taking the next macrotask.

7. **How does React 18/19 Fiber Architecture enable Concurrent Rendering?**
   * *Answer:* In legacy React (Stack Reconciler), reconciliation was recursive and synchronous; once started, it could not be paused, causing dropped frames on complex updates. Fiber reimagined the reconciler as a virtual stack frame represented by a linked list of "Fiber nodes". This allows React to pause rendering work, yield execution back to the browser to handle high-priority user interactions (typing, clicks), and resume or discard low-priority rendering work later.

8. **What is Database Normalization (1NF, 2NF, 3NF, BCNF) and when should you denormalize?**
   * *Answer:*
     - *1NF:* Atomic column values (no multi-valued lists or arrays) and unique primary key.
     - *2NF:* 1NF + No partial functional dependencies (all non-key attributes fully depend on the entire primary key).
     - *3NF:* 2NF + No transitive dependencies (non-key attributes depend *only* on the primary key, not on other non-key attributes).
     - *Denormalization:* Deliberately violating 3NF by duplicating data (e.g., caching `user_name` directly in `orders` table) to eliminate expensive `JOIN` operations on high-frequency read paths.

9. **Explain the difference between Optimistic Concurrency Control (OCC) and Pessimistic Concurrency Control (PCC).**
   * *Answer:*
     - *Pessimistic Locking:* Assumes conflicts will happen. Locks records immediately upon reading (`SELECT ... FOR UPDATE`). Other transactions must wait. Safe, but degrades concurrency and risks deadlocks.
     - *Optimistic Locking:* Assumes conflicts are rare. Reads data without locking, noting a `version` number. When updating (`UPDATE ... WHERE id = 1 AND version = 4`), checks if the version has changed. If rows affected == 0, another transaction updated it first; the transaction aborts and retries. Best for read-heavy workloads.

10. **Explain the CAP Theorem and why "CA" distributed systems do not exist in reality.**
    * *Answer:* The CAP Theorem states that in the event of a network Partition (P), a distributed system must choose between Consistency (C) and Availability (A). "CA" systems (Consistent and Available without Partition tolerance) do not exist in real-world distributed architectures because physical networks cannot guarantee 100% partition-free operation. Network switches fail, fiber cables get cut, and cloud availability zones disconnect; therefore, every distributed system MUST tolerate partitions (P) and choose between C (refuse writes to maintain data accuracy) or A (accept writes to remain online, risking divergent stale data).

---

### Implementation & Debugging Rapid Fire
11. **How do you resolve a circular dependency between two TypeScript modules?**
    * *Answer:* Extract the shared interface, type, or utility function into a third independent module (`types.ts` or `shared.ts`) that both modules import, or use dependency injection.

12. **Why does `0.1 + 0.2 !== 0.3` in JavaScript, and how do you handle money in full-stack applications?**
    * *Answer:* JavaScript uses IEEE 754 double-precision floating-point format (base 2 binary fractions). Numbers like 0.1 and 0.2 cannot be represented precisely in binary, resulting in rounding errors (`0.30000000000000004`).
    * *Rule for Money:* **Never use floating-point numbers for currency.** Always store monetary amounts as **integers in the smallest unit (e.g., cents, paise: $10.50 -> 1050)** or use PostgreSQL `NUMERIC(12, 2)` / libraries like `decimal.js`.

13. **How do you fix `UnhandledPromiseRejection` in an Express 4 application?**
    * *Answer:* Wrap async route handlers in a utility wrapper (`const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)`) or upgrade to Express 5 (which supports native async error forwarding).

14. **How do you diagnose why a PostgreSQL query is ignoring an index?**
    * *Answer:* Run `EXPLAIN (ANALYZE, BUFFERS) <query>;`. Check if:
      - The table is very small (sequential scan is faster).
      - Table statistics are stale (run `ANALYZE table_name;`).
      - Query uses functions on the indexed column (`WHERE LOWER(email) = ...` requires a functional index: `CREATE INDEX ON users(LOWER(email))`).
      - Data types mismatch, causing implicit type casting.

15. **What is the difference between `git merge` and `git rebase`?**
    * *Answer:* `git merge` combines branches by creating a new 3-way merge commit, preserving complete historical branching context. `git rebase` rewrites commit history by moving the base of your branch onto the tip of the target branch, creating a completely linear, clean commit history. Never rebase shared public branches!

---

## 16. Coding Questions: High-Frequency Algorithms

### Coding Challenge 1: Custom Deep Equality Comparator (`isDeepEqual`)

```typescript
export function isDeepEqual(objA: any, objB: any): boolean {
  if (Object.is(objA, objB)) return true;

  if (
    typeof objA !== "object" ||
    objA === null ||
    typeof objB !== "object" ||
    objB === null
  ) {
    return false;
  }

  // Handle Dates
  if (objA instanceof Date && objB instanceof Date) {
    return objA.getTime() === objB.getTime();
  }

  // Handle RegExps
  if (objA instanceof RegExp && objB instanceof RegExp) {
    return objA.toString() === objB.toString();
  }

  // Handle Arrays and Objects
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
    if (!isDeepEqual(objA[key], objB[key])) return false;
  }

  return true;
}
```

### Coding Challenge 2: Debounce Function with Immediate (`leading`) Option

```typescript
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  delayMs: number,
  immediate = false
): (...args: Parameters<T>) => void {
  let timerId: NodeJS.Timeout | null = null;

  return function (this: any, ...args: Parameters<T>) {
    const callNow = immediate && !timerId;

    if (timerId) clearTimeout(timerId);

    timerId = setTimeout(() => {
      timerId = null;
      if (!immediate) {
        fn.apply(this, args);
      }
    }, delayMs);

    if (callNow) {
      fn.apply(this, args);
    }
  };
}
```

---

## 17. Common Interview Traps

* **The Trap:** The interviewer asks: *"What is the time complexity of searching for an item in a JavaScript `Set` or `Map`?"*
  * **How candidates fail:** Saying "It's always $O(1)$ constant time."
  * **The Winning Answer:** Average case time complexity is $O(1)$ constant time. However, in the worst-case scenario where multiple keys produce identical hash collisions within internal hash buckets, time complexity can degrade to $O(N)$ (or $O(\log N)$ in engines that convert collision buckets to balanced binary search trees).
* **The Trap:** *"If you add an index to every column in your SQL table, will all queries run at maximum speed?"*
  * **How candidates fail:** Saying "Yes, every column will have an index to search with."
  * **The Winning Answer:** No! Every index adds severe write amplification overhead ($O(K)$ additional index writes per `INSERT`/`UPDATE`/`DELETE`), consumes physical RAM in the database buffer cache, and can actually degrade read performance by bloating memory and confusing the query planner. Indexes must be created selectively based on real query workload analysis.

---

## 18. Revision Summary

```
+-----------------------------------------------------------------------------------+
|               Full-Stack Emergency Night-Before Revision Matrix                   |
+-----------------------------------------------------------------------------------+
| Frontend:       Fiber Reconciler; useState functional updates; push "use client"  |
| Event Loop:     Sync Stack -> Microtasks (Promise/nextTick) -> 1 Macrotask        |
| Networking:     CORS preflight (OPTIONS); TLS 1.3; HTTP/2 multiplexing streams    |
| Persistence:    B-Tree ($O(\log N)$); MVCC xmin/xmax; Cache-Aside (DB then del)   |
| Security:       HttpOnly + SameSite=Lax cookies; Argon2id; Parameterized SQL      |
| Architecture:   Stateless servers; Idempotency Keys; Circuit Breakers; Outbox    |
+-----------------------------------------------------------------------------------+
```

---

## 19. Quick Reference

* **200 OK:** Successful request.
* **201 Created:** Successful resource creation.
* **204 No Content:** Successful action, zero body returned.
* **400 Bad Request:** Malformed payload / validation failure.
* **401 Unauthorized:** Missing or invalid authentication token.
* **403 Forbidden:** Authenticated, but lacking authorization/permission.
* **404 Not Found:** Resource does not exist.
* **409 Conflict:** State conflict (e.g., duplicate unique key).
* **422 Unprocessable Entity:** Semantic validation failure (Zod error).
* **429 Too Many Requests:** Rate limit exceeded.
* **500 Internal Server Error:** Unhandled server exception.
* **502 Bad Gateway:** Upstream app server crashed / unresponsive.
* **503 Service Unavailable:** Server overloaded or under maintenance.
* **504 Gateway Timeout:** Upstream app took too long to respond.
