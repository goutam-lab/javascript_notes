# HTTP Methods: Semantics, Safety, and Idempotency Keys

## 1. What is it?
HTTP Methods (also known as HTTP Verbs) define the desired operational action to be performed on a specified resource. In the HTTP/1.1 specification (RFC 7231 / RFC 9110), methods are formally categorized by two fundamental properties:
1. **Safety:** An HTTP method is **Safe** if it does not alter the state of the server. Safe methods are essentially read-only operations that can be invoked repeatedly without causing side effects.
2. **Idempotency:** An HTTP method is **Idempotent** if making multiple identical requests has the exact same side-effect on the server as making a single request:
   $$f(f(x)) = f(x)$$

```
+-----------------------------------------------------------------------------------------------+
|                                  HTTP METHODS PROPERTIES MATRIX                               |
+-----------+---------------+---------------+---------------+-------------------+---------------+
| Method    | Safe?         | Idempotent?   | Cacheable?    | Request Body?     | Semantic Role |
+-----------+---------------+---------------+---------------+-------------------+---------------+
| `GET`     | ✅ YES        | ✅ YES        | ✅ YES        | ❌ Optional/Ignore| Retrieve data |
| `HEAD`    | ✅ YES        | ✅ YES        | ✅ YES        | ❌ No             | Headers only  |
| `OPTIONS` | ✅ YES        | ✅ YES        | ❌ No         | ❌ Optional       | Preflight/Caps|
| `PUT`     | ❌ NO         | ✅ YES        | ❌ No         | ✅ Mandatory      | Full replace  |
| `DELETE`  | ❌ NO         | ✅ YES        | ❌ No         | ⚠️ Optional       | Remove record |
| `POST`    | ❌ NO         | ❌ NO         | ⚠️ Conditional| ✅ Mandatory      | Create / Proc |
| `PATCH`   | ❌ NO         | ⚠️ Conditional| ❌ No         | ✅ Mandatory      | Partial delta |
+-----------+---------------+---------------+---------------+-------------------+---------------+
```

---

## 2. Why does it exist?
Distributed networks are fundamentally unreliable:
- Packets are dropped, Wi-Fi connections drop out, and servers encounter timeout deadlocks.
- When a client sends a payment request and experiences a network timeout, the client has **no idea** whether the server processed the payment and died before returning the receipt, or died before receiving the request.
- If the client retries a non-idempotent `POST /payments` request, the customer could be charged twice!

Understanding method semantics and implementing **Idempotency Keys** allows distributed systems to retry failed network requests safely without causing duplicate charges or corrupting data.

---

## 3. Mental Model
Think of HTTP Method Properties as **Electrical Switches and Mailboxes**:
- **Safe Method (The Light Meter):** Reading a light meter on the wall (`GET`) does not consume electricity or change the lights in the room. You can look at the meter 100 times without affecting the power grid.
- **Idempotent Method (The "Set Thermostat to 72°F" Switch):** If you press the button "Set to 72°F" (`PUT`), the room temperature adjusts to 72°F. If you mash the button 10 times in a row, the room remains at 72°F. The end state is identical.
- **Non-Idempotent Method (The "Dispense 1 Soda Can" Button):** Every time you press the button (`POST`), the machine dispenses a can. If you press it 5 times, you receive 5 cans and your balance decreases by $10. Retrying this blindly causes duplicate side effects.

---

## 4. Basic Example

### PUT vs. PATCH Semantic Differences
```typescript
// Initial Database State:
// User #42: { id: 42, name: 'Alice', email: 'alice@example.com', role: 'admin' }

// 1. PUT /users/42 (FULL REPLACEMENT)
// Payload sent: { name: 'Alice Smith' }
// Resulting Database State:
// { id: 42, name: 'Alice Smith', email: null, role: null }
// Notice: Any property omitted from the PUT payload is reset to null/default!

// 2. PATCH /users/42 (PARTIAL DELTA UPDATE)
// Payload sent: { name: 'Alice Smith' }
// Resulting Database State:
// { id: 42, name: 'Alice Smith', email: 'alice@example.com', role: 'admin' }
// Notice: Only the specified property is mutated; untouched properties remain preserved!
```

---

## 5. Real Example

### Production Idempotency Key Middleware for Financial APIs (Express + Redis)
```typescript
// middleware/idempotency.ts
import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export function idempotencyMiddleware(ttlSeconds: number = 86400) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Only enforce idempotency on state-mutating non-idempotent verbs (POST)
    if (req.method !== 'POST') {
      return next();
    }

    const idempotencyKey = req.headers['idempotency-key'] as string;

    if (!idempotencyKey) {
      // In financial APIs, reject requests lacking the idempotency key
      return res.status(400).json({
        error: {
          code: 'MISSING_IDEMPOTENCY_KEY',
          message: 'Header "Idempotency-Key" is strictly mandatory for payment operations',
        },
      });
    }

    const redisKey = `idempotency:${idempotencyKey}`;

    // 1. Check if this key was already processed or is currently in-flight
    const cachedRecord = await redis.get(redisKey);

    if (cachedRecord) {
      const parsed = JSON.parse(cachedRecord);

      // State A: In-flight request lock
      if (parsed.status === 'PROCESSING') {
        return res.status(409).json({
          error: {
            code: 'CONCURRENT_REQUEST',
            message: 'A request with this Idempotency-Key is currently being processed. Please wait.',
          },
        });
      }

      // State B: Completed request; return exact cached response!
      res.setHeader('X-Cache-Lookup', 'IDEMPOTENT_HIT');
      return res.status(parsed.statusCode).json(parsed.body);
    }

    // 2. Acquire atomic distributed lock (Lock for 30 seconds to prevent race conditions)
    const acquired = await redis.set(
      redisKey,
      JSON.stringify({ status: 'PROCESSING' }),
      'EX',
      30,
      'NX' // Set if Not eXists
    );

    if (!acquired) {
      return res.status(409).json({
        error: { code: 'CONCURRENT_REQUEST', message: 'Concurrent execution locked' },
      });
    }

    // 3. Intercept res.json to capture response and store in Redis permanently
    const originalJson = res.json.bind(res);

    res.json = (body: any) => {
      // Save completed response to Redis with full TTL (e.g. 24 hours)
      redis.set(
        redisKey,
        JSON.stringify({
          status: 'COMPLETED',
          statusCode: res.statusCode,
          body,
        }),
        'EX',
        ttlSeconds
      );

      return originalJson(body);
    };

    next();
  };
}
```

---

## 6. Under the Hood

### 1. Why `DELETE` is Idempotent Even If Status Codes Differ
A common interview dispute is:
- Call 1: `DELETE /users/10` -> Server deletes record -> Returns `204 No Content`.
- Call 2: `DELETE /users/10` -> Record already gone -> Returns `404 Not Found`.
- **Question:** Does returning `404` violate idempotency?
- **Answer:** **NO!** Idempotency applies to the **state of the resource on the server**, NOT the HTTP status code returned. In both Call 1 and Call 2, the end state on the database is identical: User 10 does not exist.

### 2. Is `PATCH` Idempotent?
`PATCH` is **not guaranteed to be idempotent** by specification:
- If a patch contains `{ "name": "Alice" }`, it is idempotent (applying it 10 times sets the name to Alice).
- If a patch contains an operational JSON-Patch delta `{ "op": "increment", "path": "/balance", "value": 10 }`, running it 5 times adds $50, making it **non-idempotent**!

---

## 7. Important Rules
1. **Never Perform Mutations in `GET` / `HEAD` / `OPTIONS`:** Browsers, crawlers, and CDNs assume safe methods have zero side-effects and will pre-fetch or replay them aggressively.
2. **`Idempotency-Key` Must Be Scoped to User / Tenant:** Never store keys globally as `idempotency:KEY`. Prefix with user/tenant ID (`idempotency:user_123:KEY`) to prevent one user from accidentally or maliciously colliding with another user's key.
3. **Payload Hash Matching:** When returning a cached idempotent response, verify that the incoming request payload matches the original request payload. If an attacker sends the same key with a completely different payload, reject it with `422 Unprocessable Entity` or `400 Bad Request`.
4. **Use UUID v4 for Client Idempotency Keys:** Clients should generate cryptographically random UUID v4 keys per user intent.

---

## 8. Common Mistakes

### Mistake 1: Relying on `POST` for Resource Replacement
```typescript
// ❌ WRONG: Using POST to replace an existing resource
POST /api/users/42
{ "name": "Alice", "role": "admin" }

// ✅ FIXED: Use PUT for full resource replacement
PUT /api/users/42
{ "name": "Alice", "role": "admin" }
```

### Mistake 2: Failing to Handle In-Flight Locks for Idempotent Requests
```
Client sends Request A (slow network, takes 5s)
Client times out at 3s and retries Request B with SAME Idempotency-Key
Both requests execute simultaneously in parallel database threads!
Duplicate charge occurs!
```
**Fix:** Use atomic Redis `SET NX` locks to mark keys as `PROCESSING` while executing.

---

## 9. Best Practices
1. **Adopt IETF Idempotency-Key Draft Standard:** Use the standard header name `Idempotency-Key`.
2. **Return Cached Status and Body Exactly:** When an idempotent hit occurs, return the exact same HTTP status code (e.g. `201 Created`) and payload that was generated on the initial execution.
3. **Persist Idempotency Records in Redis:** Set TTLs between 24 hours and 7 days. Most network retries occur within seconds or minutes.

---

## 10. Performance Considerations
- **Redis In-Memory Speed:** Checking an idempotency key in Redis takes <1ms, avoiding expensive multi-second database queries and payment gateway RPC round trips.
- **Lock Contention:** Set short lock expiration times (e.g. 15-30s) on in-flight processing locks so that crashed server pods don't hold keys hostage indefinitely.

---

## 11. Security Considerations
- **Idempotency Key Hijacking:** An attacker might try guessing or reusing someone else's idempotency key to inspect the cached response payload. Always bind the key to the authenticated `req.user.id`.
- **Replay Attacks:** Reject idempotency keys older than the supported time window (e.g. 24 hours).

---

## 12. Alternatives
- **Database Unique Constraints:** Enforcing unique constraints on the database level (e.g. `UNIQUE (user_id, order_reference)`). Catches duplicate inserts, but throws raw DB errors instead of returning the clean original response.
- **Two-Phase Commit (2PC):** Heavyweight distributed transaction protocol for multi-database architectures.

---

## 13. Trade-offs

| Method / Pattern | Safety | Idempotency | Best Use Case |
| :--- | :--- | :--- | :--- |
| **`GET`** | Safe | Idempotent | Fetching entities |
| **`PUT`** | Unsafe | Idempotent | Complete resource update or upsert |
| **`PATCH`** | Unsafe | Non-Idempotent (by spec) | Partial updates |
| **`POST` + Key** | Unsafe | Idempotent (via Key) | Financial transactions, orders |

---

## 14. Real-World Usage
- **Stripe Payments API:** Stripe requires `Idempotency-Key: <UUID>` on all charge creation requests (`POST /v1/charges`). Retried requests return the identical charge object without charging the credit card a second time.
- **AWS S3 Object Uploads:** `PUT /bucket/file.png` is naturally idempotent. Uploading the exact same file 10 times results in the same file stored in the bucket.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the difference between a Safe HTTP method and an Idempotent HTTP method?**  
*Answer:*
- A **Safe** method does not modify any server state (it is read-only, such as `GET`, `HEAD`, `OPTIONS`).
- An **Idempotent** method can modify server state, but executing it multiple identical times results in the exact same server state as executing it once (such as `PUT`, `DELETE`). All safe methods are idempotent, but not all idempotent methods are safe.

### Conceptual
**Q: Explain why `PUT` is idempotent while `POST` is not.**  
*Answer:* `PUT` represents a complete replacement of a resource at a specific URI. Calling `PUT /users/42` with `{ "name": "Bob" }` 10 times leaves User 42 with the name "Bob" every time. In contrast, `POST /users` creates a new resource. Calling it 10 times creates 10 distinct user records with 10 different IDs.

### Implementation
**Q: How do you implement idempotency in a payment checkout API endpoint?**  
*Answer:* Require an `Idempotency-Key` header from the client. When a request arrives, check Redis:
1. If the key exists with `COMPLETED`, return the cached response immediately.
2. If the key exists with `PROCESSING`, return `409 Conflict`.
3. If the key does not exist, atomically acquire an in-flight lock (`SET key PROCESSING EX 30 NX`), process the payment through the payment gateway, save the final response into Redis with a 24-hour TTL, and return the response to the client.

### Debugging
**Q: A client reports that calling `DELETE /orders/5` the first time returns `204 No Content`, but calling it immediately a second time returns `404 Not Found`. Does this violate HTTP idempotency?**  
*Answer:* No. Idempotency pertains to the **side effects on the server's resource state**, not the returned status code. In both cases, the end state on the server is identical: Order 5 does not exist.

### Scenario
**Q: A frontend user on poor mobile Wi-Fi clicks "Place Order" ($500). The network drops before the receipt arrives. How does the frontend handle this safely?**  
*Answer:* The frontend generates a unique `Idempotency-Key` (UUID v4) before sending the first request. If the request times out or disconnects, the frontend retries the exact same request with the **exact same `Idempotency-Key`**. The backend detects the existing key, avoids charging the card again, and returns the original receipt data.

### Advanced
**Q: What is Payload Hashing in Idempotency implementations and why is it necessary?**  
*Answer:* Payload Hashing computes a cryptographic hash (e.g. SHA-256) of the incoming request body and stores it alongside the idempotency key. If a client mistakenly sends a subsequent request with the same idempotency key but a **different payload** (e.g. changing the amount from $100 to $500), the server detects the hash mismatch and rejects the request with `422 Unprocessable Entity` or `400 Bad Request`, preventing accidental parameter poisoning.

---

## 16. Coding Questions

### Problem: Build an Idempotent Bank Account Transfer Service Function
```typescript
// services/transferService.ts
import db from '@/lib/db';
import redis from '@/lib/redis';

interface TransferInput {
  fromAccountId: string;
  toAccountId: string;
  amountCents: number;
  idempotencyKey: string;
}

export async function processTransfer(input: TransferInput) {
  const cacheKey = `transfer:idemp:${input.idempotencyKey}`;

  // 1. Check existing cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // 2. Atomic lock
  const locked = await redis.set(`lock:${cacheKey}`, '1', 'EX', 15, 'NX');
  if (!locked) {
    throw new Error('Concurrent transfer execution in progress. Please retry.');
  }

  try {
    // 3. Execute transactional ledger transfer
    const transactionRecord = await db.$transaction(async (tx) => {
      const fromAcc = await tx.account.findUnique({ where: { id: input.fromAccountId } });
      if (!fromAcc || fromAcc.balanceCents < input.amountCents) {
        throw new Error('Insufficient funds');
      }

      await tx.account.update({
        where: { id: input.fromAccountId },
        data: { balanceCents: { decrement: input.amountCents } },
      });

      await tx.account.update({
        where: { id: input.toAccountId },
        data: { balanceCents: { increment: input.amountCents } },
      });

      return await tx.transferLedger.create({
        data: {
          fromAccountId: input.fromAccountId,
          toAccountId: input.toAccountId,
          amountCents: input.amountCents,
          referenceKey: input.idempotencyKey,
        },
      });
    });

    const resultPayload = {
      success: true,
      transactionId: transactionRecord.id,
      timestamp: transactionRecord.createdAt.toISOString(),
    };

    // 4. Cache response for 24 hours
    await redis.set(cacheKey, JSON.stringify(resultPayload), 'EX', 86400);

    return resultPayload;
  } finally {
    // Release in-flight lock
    await redis.del(`lock:${cacheKey}`);
  }
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "`POST` is always non-idempotent and cannot be made idempotent."  
  *Truth:* While `POST` is non-idempotent by HTTP specification, implementing the **Idempotency-Key** pattern makes `POST` endpoints functionally idempotent at the application layer.
- **Trap 2:** "`PATCH` is strictly idempotent."  
  *Truth:* False. `PATCH` can describe incremental or append operations (`{ op: 'add' }`), making it conditionally non-idempotent. Only `PUT` is strictly idempotent by RFC specification.

---

## 18. Revision Summary
- Safe methods (`GET`, `HEAD`, `OPTIONS`) never modify server state.
- Idempotent methods (`GET`, `PUT`, `DELETE`) produce identical server state regardless of execution count.
- `PUT` replaces the entire resource; `PATCH` modifies only specified fields.
- `DELETE` is idempotent because the end state (resource absent) is identical on subsequent calls.
- Use `Idempotency-Key` with Redis atomic locks to guarantee zero duplicate transactions in financial APIs.

---

## 19. Quick Reference

```
+--------------------+-------------------+-------------------+-------------------+
| HTTP Method        | Safe?             | Idempotent?       | Primary Action    |
+--------------------+-------------------+-------------------+-------------------+
| GET                | YES               | YES               | Read resource     |
| HEAD               | YES               | YES               | Read headers only |
| OPTIONS            | YES               | YES               | CORS / Options    |
| PUT                | NO                | YES               | Complete replace  |
| DELETE             | NO                | YES               | Remove entity     |
| POST               | NO                | NO                | Create / Process  |
| PATCH              | NO                | NO (Conditional)  | Delta update      |
| Idempotency Key    | Protects POST     | Redis SET NX lock | 24-hr TTL cache   |
+--------------------+-------------------+-------------------+-------------------+
```
