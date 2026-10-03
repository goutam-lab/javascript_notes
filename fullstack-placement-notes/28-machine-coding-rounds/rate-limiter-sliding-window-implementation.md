# Rate Limiter: Sliding Window Counter Implementation and System Design

## 1. What is it?
A **Rate Limiter** is a defensive traffic-shaping mechanism that controls the rate at which network requests are processed by a server or service. If incoming traffic exceeds an authorized threshold (e.g., 100 requests per minute per IP or API key), the rate limiter rejects excess requests with HTTP status code `429 Too Many Requests`.

Among the primary algorithms (Fixed Window, Sliding Log, Token Bucket, Leaky Bucket), the **Sliding Window Counter** algorithm is the industry standard for production API gateways. It calculates request density dynamically across a rolling time window by combining the request count of the current time slice with a weighted fraction of the previous slice, eliminating the dangerous **boundary burst flaw** of Fixed Window counters while consuming a fraction of the memory required by Sliding Window Logs.

```
       SLIDING WINDOW COUNTER CALCULATION
       
    Previous 1-Min Window           Current 1-Min Window (30% elapsed)
  ┌───────────────────────────────┬───────────────────────────────┐
  │         80 Requests           │          30 Requests          │
  └───────────────────────────────┴───────────────▲───────────────┘
                                                  │
                                          Current Time (t)
                                          
  Formula:
  Estimated Requests = (Previous Count × (1 - Overlap Fraction)) + Current Count
                     = (80 × (1 - 0.30)) + 30
                     = (80 × 0.70) + 30 
                     = 56 + 30 = 86 Requests
                     
  If Limit = 100 req/min: 86 <= 100 -> ALLOW REQUEST!
```

---

## 2. Why does it exist?
Without rate limiting, web applications are vulnerable to:
1. **Denial-of-Service (DoS) and Brute-Force Attacks:** Attackers can flood login or OTP endpoints with millions of credentials per minute.
2. **Cascading Server Failures:** Spikes in unthrottled traffic exhaust database connection pools, memory, and CPU, taking down microservices.
3. **API Monetization & Quota Enforcement:** Tiered SaaS pricing plans (Free vs. Pro vs. Enterprise) require strict per-minute and per-month quota enforcement.
4. **Scraping and Data Exfiltration:** Automated bots scraping proprietary catalog data or internal endpoints.

---

## 3. Mental Model
Think of Rate Limiting algorithms as **Nightclub Bouncers**:

```
                       NIGHTCLUB BOUNCER ANALOGY
                       
  ❌ Fixed Window (The Hourly Bouncer):
     - Rule: 100 guests per hour.
     - At 11:59 PM, 100 people enter. At 12:01 AM, another 100 people enter.
     - The club has 200 people inside within 2 minutes! The floor collapses.

  ❌ Sliding Log (The Hyper-Obsessive Accountant):
     - Writes down the millisecond timestamp of every single person who ever arrived.
     - Needs a giant room of filing cabinets (massive RAM consumption).

  ✅ Sliding Window Counter (The Smart Rolling Estimator):
     - Looks at how far we are into the current hour.
     - If we are 15 minutes in, counts 75% of the last hour + 100% of this hour.
     - Smooth, mathematically sound, and fits on a tiny sticky note in memory.
```

---

## 4. Basic Example: In-Memory Sliding Window Counter in TypeScript

```typescript
export class InMemorySlidingWindowRateLimiter {
  private windowSizeMs: number;
  private maxRequests: number;
  // Key -> { prevCount, currentCount, currentWindowStart }
  private store = new Map<
    string,
    { prevCount: number; currentCount: number; currentWindowStart: number }
  >();

  constructor(maxRequests: number, windowSizeMs: number) {
    this.maxRequests = maxRequests;
    this.windowSizeMs = windowSizeMs;
  }

  public isAllowed(key: string): {
    allowed: boolean;
    remaining: number;
    resetMs: number;
  } {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry) {
      // First request from this key
      this.store.set(key, {
        prevCount: 0,
        currentCount: 1,
        currentWindowStart: now
      });
      return {
        allowed: true,
        remaining: this.maxRequests - 1,
        resetMs: this.windowSizeMs
      };
    }

    const elapsed = now - entry.currentWindowStart;

    // Check if we have transitioned to a new window
    if (elapsed >= this.windowSizeMs) {
      const windowsPassed = Math.floor(elapsed / this.windowSizeMs);

      if (windowsPassed === 1) {
        // Shift current window to previous
        entry.prevCount = entry.currentCount;
      } else {
        // More than 1 window passed; previous data is obsolete
        entry.prevCount = 0;
      }

      entry.currentCount = 0;
      entry.currentWindowStart = now - (elapsed % this.windowSizeMs);
    }

    // Calculate rolling weighted estimate
    const currentWindowOffset = now - entry.currentWindowStart;
    const weight = 1 - currentWindowOffset / this.windowSizeMs;
    const estimatedRequests = Math.floor(entry.prevCount * weight + entry.currentCount);

    if (estimatedRequests >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetMs: this.windowSizeMs - currentWindowOffset
      };
    }

    // Allow request and increment current counter
    entry.currentCount++;
    this.store.set(key, entry);

    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - (estimatedRequests + 1)),
      resetMs: this.windowSizeMs - currentWindowOffset
    };
  }
}
```

---

## 5. Real Example: Distributed Redis Sliding Window with Atomic Lua Script

In production microservices running behind load balancers, an in-memory map fails because multiple server instances don't share memory. We use **Redis** with an atomic **Lua Script** to eliminate race conditions.

```typescript
import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';

const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Atomic Lua Script: Evaluates Sliding Window Log directly inside Redis
const slidingWindowLuaScript = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local window = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])
  local clearBefore = now - window

  -- 1. Remove timestamps older than the current rolling window
  redis.call('ZREMRANGEBYSCORE', key, '-inf', clearBefore)

  -- 2. Count remaining elements in the sorted set
  local currentRequests = redis.call('ZCARD', key)

  -- 3. Check if over quota
  if currentRequests < limit then
    -- Add current timestamp as both score and member
    redis.call('ZADD', key, now, now .. '-' .. redis.call('INCR', key .. ':counter'))
    -- Set TTL to automatically expire key if inactive
    redis.call('EXPIRE', key, math.ceil(window / 1000))
    return {1, limit - currentRequests - 1} -- Allowed, remaining
  else
    return {0, 0} -- Rejected
  end
`;

export function redisRateLimiter(maxRequests: number, windowSeconds: number) {
  const windowMs = windowSeconds * 1000;

  return async (req: Request, res: Response, next: NextFunction) => {
    // Rate limit per authenticated user ID or client IP address
    const clientIdentifier = (req as any).user?.id || req.ip || 'anonymous';
    const rateLimitKey = `ratelimit:${clientIdentifier}`;
    const now = Date.now();

    try {
      const result = (await redisClient.eval(
        slidingWindowLuaScript,
        1,
        rateLimitKey,
        now,
        windowMs,
        maxRequests
      )) as [number, number];

      const [isAllowed, remaining] = result;

      // Set standard RFC 6585 and draft IETF headers
      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));

      if (isAllowed === 1) {
        return next();
      } else {
        res.setHeader('Retry-After', windowSeconds);
        return res.status(429).json({
          error: 'Too Many Requests',
          message: `Rate limit exceeded. Try again in ${windowSeconds} seconds.`
        });
      }
    } catch (error) {
      console.error('Rate limiter Redis error:', error);
      // Fail-open strategy: Allow traffic to pass if Redis goes down, to protect availability
      return next();
    }
  };
}
```

---

## 6. Under the Hood: Redis Sorted Sets (`ZSET`) and Lua Atomicity

```
           REDIS ZSET SLIDING LOG ARCHITECTURE
           
  Key: "ratelimit:user_123" (ZSET)
  ┌─────────────────────────────────────────────────────────────┐
  │ Score: 1727950000000   Member: "1727950000000-1"            │
  │ Score: 1727950015000   Member: "1727950015000-2"            │
  │ Score: 1727950045000   Member: "1727950045000-3"            │
  └─────────────────────────────────────────────────────────────┘
  
  When a new request arrives at t = 1727950060000 (Window = 60,000ms):
  1. ZREMRANGEBYSCORE: Prunes all entries with score < (1727950060000 - 60000)
  2. ZCARD: Reads count of remaining elements in O(1) time
  3. ZADD: Appends current timestamp in O(log N) time
  
  Why Lua?
  Redis executes Lua scripts atomically in a single event-loop tick.
  No other concurrent request can read or modify the ZSET midway,
  completely preventing Race Conditions!
```

---

## 7. Important Rules

1. **Standardized HTTP Headers:** Always return:
   - `X-RateLimit-Limit`: Maximum requests allowed per window.
   - `X-RateLimit-Remaining`: Remaining request quota.
   - `X-RateLimit-Reset`: Epoch timestamp when quota resets.
   - `Retry-After`: Seconds to wait before retrying (on 429 status).
2. **Fail-Open vs. Fail-Closed:**
   If your Redis rate limiting cluster goes offline, decide whether to:
   - **Fail-Open (Recommended for general APIs):** Allow requests through so a caching failure doesn't cause a total system outage.
   - **Fail-Closed (Recommended for Billing / Auth):** Block requests to prevent brute force attacks during outages.
3. **Accurate Client Identification Behind Proxies:**
   If running behind Cloudflare or AWS ALB, `req.ip` might be the load balancer's internal IP! Read `req.headers['x-forwarded-for']` properly with trusted proxy configurations (`app.set('trust proxy', 1)`).

---

## 8. Common Mistakes

```typescript
// ❌ MISTAKE 1: Fixed Window Counter (Allows 2x burst across window boundary)
// Window 1: 00:00 - 01:00 (100 reqs at 00:59)
// Window 2: 01:00 - 02:00 (100 reqs at 01:01)
// Result: 200 requests processed in 2 seconds, crashing the DB!

// ❌ MISTAKE 2: Non-atomic Redis calls in Node.js (Race Condition)
const count = await redis.get(key);
if (count < 100) {
  // Concurrency Bug: 50 requests can read count=99 at the same millisecond!
  await redis.incr(key); 
}
// Fix: Use atomic Lua scripts or Redis INCR/EXPIRE transactions!

// ❌ MISTAKE 3: Using client IP directly without proxy trust
// All users worldwide share the exact same AWS ALB IP, blocking all users after 100 calls!
```

---

## 9. Best Practices
1. **Tiered Rate Limits:** Apply different limits to different endpoints:
   - Global API: 1,000 req/min
   - Login / Password Reset: 5 req/min
   - Search: 60 req/min
2. **Key by User ID Over IP:** Authenticated users should be rate-limited by `userId` to avoid penalizing entire corporate offices sharing a single NAT gateway IP.
3. **Automate Key Expiration:** Always set a TTL on Redis rate-limiting keys (`EXPIRE key 60`) so memory is freed automatically when clients stop making requests.

---

## 10. Performance Considerations

| Algorithm | Memory per Key | Time Complexity | Accuracy |
|---|---|---|---|
| **Fixed Window** | $\sim 8$ bytes (Integer) | $O(1)$ | 🔴 Poor (2x boundary burst) |
| **Sliding Window Log** | $N \times 16$ bytes (Timestamps) | $O(\log N)$ | 🟢 100% Exact |
| **Sliding Window Counter** | $\sim 24$ bytes (2 Counters) | $O(1)$ | 🟢 99.9% Approximated |
| **Token Bucket** | $\sim 16$ bytes (Tokens + Time) | $O(1)$ | 🟢 Great for Bursts |

---

## 11. Security Considerations
- **IP Spoofing via `X-Forwarded-For`:** Attackers can send `X-Forwarded-For: 1.2.3.4` with each request to bypass IP-based rate limiting unless your reverse proxy (Nginx, Cloudflare) explicitly overwrites this header.
- **Distributed DDoS Defense:** Application-level rate limiters protect application logic, but high-volume volumetric DDoS (Layer 3/4) must be blocked upstream at the CDN / Cloudflare / AWS Shield layer.

---

## 12. Alternatives
1. **Token Bucket Algorithm:** Allows bursts of traffic up to bucket capacity, then refills at a steady rate. Great for bursty APIs.
2. **Leaky Bucket Algorithm:** Smooths traffic spikes into a constant output rate using a FIFO queue. Great for write pipelines.
3. **Nginx / Cloudflare Rate Limiting:** Offload rate limiting entirely to the edge reverse proxy layer before requests touch Node.js.

---

## 13. Trade-offs

| Approach | Advantages | Trade-offs |
|---|---|---|
| **Sliding Window Log** | Mathematically precise; zero false positives | High memory usage for high limits (e.g. 10,000 req/min per key) |
| **Sliding Window Counter** | Constant $O(1)$ memory; sub-millisecond calculation | 0.05% margin of error due to assuming uniform distribution in previous window |
| **In-Memory Store** | Zero network latency (no Redis call) | Fails in multi-instance horizontal scaling clusters |

---

## 14. Real-World Usage
- **GitHub REST API:** Limits authenticated requests to 5,000 per hour and unauthenticated requests to 60 per hour, returning `X-RateLimit-*` headers.
- **Stripe API:** Employs Token Bucket algorithms across edge proxies with separate limits for read and write endpoints.

---

## 15. Placement Interview Questions

### Basic
1. *What is HTTP status code 429 and what header tells the client when to retry?*
   - **Answer:** `429 Too Many Requests` indicates that the client has exceeded rate limits. The `Retry-After` header specifies the number of seconds (or timestamp) the client must wait before making new requests.

### Conceptual
2. *Explain the "Boundary Burst Flaw" of the Fixed Window algorithm.*
   - **Answer:** In a Fixed Window of 100 req/min from 12:00 to 12:01, if a user sends 100 requests at 12:00:59, and another 100 requests at 12:01:01, the rate limiter allows all 200 requests because they fall into separate windows. In reality, 200 requests hit the server within a 2-second interval.

### Implementation
3. *How does the Sliding Window Counter algorithm calculate request density?*
   - **Answer:** $\text{Requests} = \text{Current Count} + \text{Previous Count} \times (1 - \text{Percentage Elapsed in Current Window})$. It weights the previous window's count based on the overlap with the rolling window.

### Debugging
4. *In a production Node.js cluster with 4 instances, rate limiting fails and users exceed limits by 4x. Why?*
   - **Answer:** The rate limiter was implemented using in-memory variables (`Map` or local object). Each cluster worker has its own independent heap, allowing users to make 100 requests to *each* worker (400 total). Fix by centralizing the rate limiter state in a shared Redis instance.

### Scenario
5. *How do you protect a login endpoint against brute-force attacks while avoiding locking out legitimate users on a shared corporate IP?*
   - **Answer:** Implement dual-key rate limiting:
     1. Limit by IP (e.g., 50 failed attempts/min) to stop massive botnets.
     2. Limit by `email` or `username` (e.g., 5 failed attempts per 15 minutes) to protect specific accounts regardless of IP hopping.

### Advanced
6. *Why are Lua scripts required when implementing Redis rate limiters instead of standard `MULTI/EXEC` transactions?*
   - **Answer:** Redis `MULTI/EXEC` transactions execute commands atomically, but you cannot use the output of one command as input to the next command *within the same transaction* (no conditional logic). A Lua script allows conditional statements (`if currentRequests < limit then...`) executed atomically in a single Redis event-loop cycle without client roundtrips.

---

## 16. Coding Questions

### Problem: Token Bucket Rate Limiter in TypeScript
Implement a stateful Token Bucket rate limiter class that refills tokens at a fixed rate per second up to a maximum capacity.

```typescript
export class TokenBucketRateLimiter {
  private capacity: number;
  private refillRatePerSecond: number;
  private tokens: number;
  private lastRefillTimestamp: number;

  constructor(capacity: number, refillRatePerSecond: number) {
    this.capacity = capacity;
    this.refillRatePerSecond = refillRatePerSecond;
    this.tokens = capacity;
    this.lastRefillTimestamp = Date.now();
  }

  public tryConsume(tokensRequested = 1): boolean {
    this.refill();

    if (this.tokens >= tokensRequested) {
      this.tokens -= tokensRequested;
      return true;
    }

    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillTimestamp) / 1000;
    
    // Calculate new tokens added since last check
    const tokensToAdd = elapsedSeconds * this.refillRatePerSecond;
    
    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefillTimestamp = now;
  }

  public getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}
```

---

## 17. Common Interview Traps
- **Trap 1:** Claiming in-memory rate limiters work in production web apps.
  *Reality:* Modern backend apps run across multiple load-balanced containers or serverless instances. In-memory rate limiting is defeated by round-robin load balancers.
- **Trap 2:** Ignoring clock drift across distributed servers.
  *Reality:* In distributed systems, rely on Redis's internal clock (`redis.call('TIME')`) inside Lua scripts rather than trusting client-provided timestamps.
- **Trap 3:** Blocking all routes equally.
  *Reality:* Asset routes (images, CSS) should not count toward API rate limits.

---

## 18. Revision Summary
- **Sliding Window Counter:** Blends previous and current window counts based on time offset, delivering $O(1)$ memory with zero boundary burst flaws.
- **Distributed State:** Use Redis Sorted Sets (`ZSET`) or Lua scripts for atomic updates across multi-instance microservices.
- **HTTP Standards:** Return `429 Too Many Requests` with `X-RateLimit-*` and `Retry-After` headers.
- **Dual Identification:** Key rate limits by both authenticated `userId` and client IP.

---

## 19. Quick Reference

```
┌─────────────────────┬───────────────────┬───────────────────┬─────────────────────┐
│ ALGORITHM           │ MEMORY PER CLIENT │ BURST SAFETY      │ BEST PRODUCTION FIT │
├─────────────────────┼───────────────────┼───────────────────┼─────────────────────┤
│ Fixed Window        │ Tiny (1 key)      │ ❌ 2x Burst Flaw  │ Simple daily quotas │
│ Sliding Window Log  │ High (Timestamps) │ 🟢 Exact          │ Low-volume APIs     │
│ Sliding Counter     │ Low (2 keys)      │ 🟢 Safe & Smooth  │ High-volume APIs    │
│ Token Bucket        │ Low (Tokens+Time) │ 🟢 Allows bursts  │ Burst-tolerant APIs │
└─────────────────────┴───────────────────┴───────────────────┴─────────────────────┘
```
