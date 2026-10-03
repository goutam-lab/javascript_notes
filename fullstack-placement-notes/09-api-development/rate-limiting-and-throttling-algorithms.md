# Rate Limiting and Throttling Algorithms: Token Bucket, Leaky Bucket, and Sliding Window

## 1. What is it?
Rate Limiting and Throttling are traffic shaping mechanisms that govern the frequency and volume of requests a client (identified by IP address, user account ID, or API key) can transmit to a service within a specified time window. They protect web services against Denial of Service (DoS) attacks, brute-force password cracking, scraping bots, and cascade resource exhaustion. The four industry-standard rate limiting algorithms are:
1. **Fixed Window Counter:** Counts requests within fixed time intervals (e.g., 100 requests per 1:00-2:00 PM block).
2. **Sliding Window Log:** Logs the exact millisecond timestamp of every request in a sorted set, calculating counts across a rolling window.
3. **Sliding Window Counter:** A memory-efficient hybrid that calculates weighted moving averages between the previous and current fixed windows.
4. **Token Bucket:** Tokens replenish in a bucket at a constant rate; requests consume tokens. Supports bursts up to bucket capacity.
5. **Leaky Bucket:** Requests enter a buffer (bucket) and are processed at a constant, smooth outbound rate, smoothing jagged traffic spikes.

```
+-----------------------------------------------------------------------------------------------+
|                            RATE LIMITING ALGORITHMS COMPARISON                                |
+-------------------+---------------+-------------------+-------------------+-------------------+
| Algorithm         | Memory Cost   | Bursts Allowed?   | Traffic Smoothing | Implementation    |
+-------------------+---------------+-------------------+-------------------+-------------------+
| Fixed Window      | Ultra Low     | ⚠️ Boundary Flaw  | ❌ No             | Redis INCR + EX   |
| Sliding Window Log| Extremely High| ✅ Exact          | ❌ No             | Redis ZADD / ZREM |
| Sliding Counter   | Very Low      | ✅ Smooth approx  | ❌ No             | Redis 2 Keys + Lua|
| Token Bucket      | Very Low      | ✅ Yes (Capacity) | ❌ Bursty         | Redis Hash + Lua  |
| Leaky Bucket      | Low           | ❌ No (FIFO Queue)| ✅ Yes (Smooth)   | Redis List / Queue|
+-------------------+---------------+-------------------+-------------------+-------------------+
```

---

## 2. Why does it exist?
Without rate limiting:
- A malicious actor or broken client script can fire 10,000 requests per second, exhausting Node.js event loop capacity, starving database connection pools, and knocking the application offline for all legitimate users.
- Attackers can brute-force passwords or API keys with millions of automated permutations.
- Third-party scrapers can suck entire product databases dry, increasing AWS/Cloud egress bills.

Rate limiting provides defense-in-depth, enforces multi-tier monetization plans (Free vs Pro tiers), and guarantees system availability.

---

## 3. Mental Model
Think of Rate Limiting Algorithms as **Different Nightclub Bouncers**:
- **Fixed Window (The Hourly Ticket Stager):** The bouncer allows 100 people into the club every hour on the clock. If 100 people enter at 1:59 PM, and another 100 enter at 2:01 PM, the club has 200 people crowded inside in a 2-minute span (The Boundary Burst Flaw!).
- **Sliding Window Log (The Ledger Scribe):** The bouncer writes the exact second every guest entered in a massive leather book. When someone approaches, he counts backwards 60 minutes in the book. Ultra-accurate, but the book weighs 50 pounds (High memory).
- **Token Bucket (The Arcade Token Dispenser):** A dispenser drops 1 token into a bowl every second (capacity 10 tokens). If you walk up with 10 friends after a quiet period, you grab all 10 tokens at once and enter together (Burst capacity). But once empty, you can only enter as fast as new tokens drop.
- **Leaky Bucket (The Funnel Drain):** A funnel sits over the door. Guests are dumped into the top of the funnel at any speed, but people drip through the narrow spout at a strictly constant rate of exactly 1 person every 2 seconds (Zero bursts; smooth traffic).

---

## 4. Basic Example

### Standard Rate Limiting Response Headers
When an API client makes requests, the server communicates rate limit quotas using standardized headers:
```http
HTTP/1.1 200 OK
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 84
X-RateLimit-Reset: 1773582400

# When limit is exceeded:
HTTP/1.1 429 Too Many Requests
Retry-After: 30
Content-Type: application/json

{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Quota exceeded. Maximum 100 requests per minute allowed.",
    "retryAfterSeconds": 30
  }
}
```

---

## 5. Real Example

### Distributed Sliding Window Counter with Redis & Lua Scripting
```typescript
// middleware/rateLimiter.ts
import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Atomic Lua script implementing Sliding Window Counter in Redis:
// Prevents race conditions across multiple server instances!
const slidingWindowLua = `
  local current_key = KEYS[1]
  local prev_key = KEYS[2]
  local now = tonumber(ARGV[1])
  local window_size = tonumber(ARGV[2])
  local limit = tonumber(ARGV[3])

  local current_count = tonumber(redis.call('get', current_key) or '0')
  local prev_count = tonumber(redis.call('get', prev_key) or '0')

  local time_into_current_window = now % window_size
  local weight = (window_size - time_into_current_window) / window_size
  local estimated_count = math.floor(prev_count * weight + current_count)

  if estimated_count >= limit then
    return {0, estimated_count, math.ceil(window_size - time_into_current_window)}
  end

  redis.call('incr', current_key)
  if current_count == 0 then
    redis.call('expire', current_key, window_size * 2)
  end

  return {1, estimated_count + 1, math.ceil(window_size - time_into_current_window)}
`;

export function createRateLimiter(limit: number = 60, windowSeconds: number = 60) {
  return async (req: Request, res: Response, next: NextFunction) => {
    // Identify client by authenticated user ID or client IP
    const clientId = (req as any).user?.id || req.ip || 'anonymous';
    const now = Math.floor(Date.now() / 1000);
    const currentWindowIndex = Math.floor(now / windowSeconds);

    const currentKey = `ratelimit:${clientId}:${currentWindowIndex}`;
    const prevKey = `ratelimit:${clientId}:${currentWindowIndex - 1}`;

    try {
      const [allowed, currentCount, resetInSeconds] = (await redis.eval(
        slidingWindowLua,
        2,
        currentKey,
        prevKey,
        now,
        windowSeconds,
        limit
      )) as [number, number, number];

      // Set standard headers
      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - currentCount));
      res.setHeader('X-RateLimit-Reset', now + resetInSeconds);

      if (allowed === 0) {
        res.setHeader('Retry-After', resetInSeconds);
        return res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `Too many requests. Limit is ${limit} per ${windowSeconds}s.`,
            retryAfter: resetInSeconds,
          },
        });
      }

      next();
    } catch (err) {
      console.error('Rate limiting failure (Failing open):', err);
      // In production, fail open so Redis outages do not take down the entire API
      next();
    }
  };
}
```

---

## 6. Under the Hood

### 1. The Fixed Window Boundary Flaw
Why Fixed Window counters fail under stress:
```
Window 1 (12:00 - 12:01)         Window 2 (12:01 - 12:02)
--------------------------       --------------------------
[ 0 req ] ... [ 100 req ]        [ 100 req ] ... [ 0 req ]
               ^                  ^
               12:00:59           12:01:01
```
- In both windows independently, the client stayed within the 100 req/min limit.
- But between 12:00:50 and 12:01:10 (a 20-second rolling window), **200 requests occurred**, doubling the intended load capacity and crashing backend databases!

### 2. Why Lua Scripting is Mandatory in Distributed Redis
If you implement rate limiting in JavaScript by calling:
```typescript
const count = await redis.get(key);
if (count > limit) reject();
await redis.incr(key);
```
- When 50 requests hit simultaneously across 4 Node.js replicas, they all execute `redis.get(key)` at the exact same millisecond before any replica calls `incr`.
- All 50 pass the check (Race Condition!).
- Executing logic inside an **atomic Redis Lua script** guarantees that the entire read-compute-write cycle executes uninterrupted in a single atomic transaction.

---

## 7. Important Rules
1. **Always Use Atomic Operations:** Never execute rate limiting checks and increments in separate network round trips. Use Redis Lua scripts or atomic transactions (`MULTI/EXEC`).
2. **Fail Open vs. Fail Closed Policy:**
   - For standard web APIs: **Fail Open** (if Redis goes down, allow requests through and log an alert). You do not want a caching cluster glitch to take down your entire company's product.
   - For payment processing and authentication endpoints (login/signup): **Fail Closed** (block requests or fallback to local memory limits to prevent brute-force attacks).
3. **Identification Keys:** Never rely solely on `req.ip` for authenticated users; multiple corporate employees often share a single NAT office IP. Use `req.user.id` or API keys when authenticated.
4. **Expose Standard Headers:** Always attach `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `Retry-After`.

---

## 8. Common Mistakes

### Mistake 1: Memory Exhaustion via Sliding Window Log
```typescript
// ❌ DANGEROUS: Using Redis ZADD to log every millisecond timestamp
await redis.zadd(key, now, now);
// If an attacker sends 1,000,000 requests, Redis stores 1,000,000 sorted set members!
// Redis crashes with Out-of-Memory (OOM)!
```
**Fix:** Use the **Sliding Window Counter** or **Token Bucket** algorithm, which stores only 1-2 small numbers per user.

### Mistake 2: Using Simple In-Memory Variables in Cluster Mode
```typescript
// ❌ WRONG: Storing counts in a local Node.js variable
let requestCount = 0; // Fails when running multiple PM2 processes or Kubernetes pods!
```

---

## 9. Best Practices
1. **Tiered Limits by Action Criticality:**
   - Public GET requests: `100 req/min`.
   - Login / Password reset attempts: `5 req/min` (Strict).
   - Expensive AI / PDF export jobs: `2 req/min`.
2. **Implement Rate Limiting at the Edge:** Place Cloudflare, AWS WAF, or NGINX rate limiters in front of your Node.js servers to drop volumetric DDoS traffic before it touches your application servers.
3. **Whitelisting & Bypasses:** Provide health-check bypasses for internal Kubernetes readiness probes (`/api/health`).

---

## 10. Performance Considerations
- **Sub-Millisecond Overhead:** A Redis Lua rate check takes ~0.2ms to 0.8ms. When Redis is placed in the same local cloud network (AWS VPC), latency is imperceptible to end users.
- **Key Expiration Hygiene:** Always ensure Redis keys have explicit TTL expirations (`EXPIRE`). Orphaned keys without TTL will slowly consume all Redis RAM over months.

---

## 11. Security Considerations
- **IP Spoofing via `X-Forwarded-For`:** Attackers can forge `X-Forwarded-For: 8.8.8.8` headers to bypass IP-based limits. Ensure your reverse proxy (NGINX / ALB) strips untrusted client-supplied headers and sets the true client IP correctly (`app.set('trust proxy', 1)` in Express).
- **Distributed Brute-Force Attacks:** Attackers rotate thousands of residential proxies to bypass per-IP limits. Mitigate by applying global user-account-based locks and CAPTCHA challenges (Cloudflare Turnstile).

---

## 12. Alternatives
- **Cloudflare Rate Limiting / AWS WAF:** Cloud-managed rate limiting; intercepts traffic before it reaches origin servers.
- **API Gateways (Kong / Envoy / Tyk):** Built-in rate limiting plugins for microservice architectures.

---

## 13. Trade-offs

| Algorithm | Pros | Cons |
| :--- | :--- | :--- |
| **Fixed Window** | Simplest; minimal memory | Boundary burst flaw |
| **Sliding Window Log** | 100% mathematical precision | Extreme memory usage |
| **Sliding Counter** | Memory efficient; smooth boundary approximation | 0.05% theoretical calculation error |
| **Token Bucket** | Supports legitimate bursts; low memory | Slightly complex Lua implementation |
| **Leaky Bucket** | Guarantees perfectly constant outbound rate | Discards bursts; causes queue latency |

---

## 14. Real-World Usage
- **GitHub API:** Enforces 5,000 requests per hour for authenticated users and 60 requests per hour for unauthenticated callers, tracked via Token Bucket.
- **OpenAI API:** Enforces both **RPM (Requests Per Minute)** and **TPM (Tokens Per Minute)** limits using dynamic Token Bucket tracking.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the boundary burst flaw in the Fixed Window Counter algorithm?**  
*Answer:* In the Fixed Window algorithm, the counter resets at the boundary of each fixed time interval (e.g. at the top of the minute). If an attacker sends their entire quota (e.g. 100 requests) at 1:59 PM and another 100 requests immediately at 2:01 PM, 200 requests pass through within a 2-second rolling interval, effectively doubling the allowable burst capacity and overwhelming the server.

### Conceptual
**Q: How does the Token Bucket algorithm handle traffic bursts compared to the Leaky Bucket algorithm?**  
*Answer:*
- **Token Bucket** permits controlled bursts of traffic up to the bucket's maximum capacity. If tokens have accumulated during idle periods, a client can execute a burst of requests immediately until the bucket is exhausted.
- **Leaky Bucket** strictly forbids bursts. Requests enter a buffer and are processed at a constant, fixed outbound rate (like water leaking from a hole in a bucket). Any requests exceeding the buffer capacity are dropped immediately.

### Implementation
**Q: Why is it necessary to execute Redis rate-limiting operations inside a Lua script rather than consecutive JavaScript calls?**  
*Answer:* Executing multiple Redis commands from JavaScript (`GET`, followed by conditional logic, followed by `INCR`) requires multiple network round trips and is non-atomic. In a multi-server or concurrent environment, multiple requests can read the same count simultaneously before any request increments it, leading to race conditions where the limit is breached. Redis executes Lua scripts **atomically in a single single-threaded operation**, guaranteeing complete isolation.

### Debugging
**Q: An engineer configured an Express rate limiter using `req.ip`. In production behind AWS ALB, all users across the world are getting rate limited after only 100 total requests. Why?**  
*Answer:* The application did not configure `app.set('trust proxy', 1)`. Behind a reverse proxy or load balancer, `req.ip` defaults to the IP address of the load balancer itself! Consequently, all incoming internet traffic was treated as originating from a single IP address (the AWS ALB).

### Scenario
**Q: What is the "Fail-Open" vs. "Fail-Closed" rate limiting strategy, and which should you choose for an e-commerce product catalog?**  
*Answer:*
- **Fail-Open:** If the rate limiting service (Redis) crashes or times out, the middleware allows incoming requests to pass through anyway.
- **Fail-Closed:** If the rate limiting service fails, all requests are blocked with HTTP 500 or 503.
- For a product catalog, choose **Fail-Open**. You should never halt all commercial sales and revenue simply because your Redis caching cluster experienced a transient blip.

### Advanced
**Q: Explain the mathematical calculation behind the Sliding Window Counter algorithm.**  
*Answer:* The Sliding Window Counter estimates requests in a rolling window by calculating a weighted sum of the previous and current fixed windows:
$$\text{Estimated Count} = (\text{Previous Window Count} \times \text{Remaining Percentage of Previous Window}) + \text{Current Window Count}$$
For example, if the window size is 60s, the current request arrives at second 18, the previous window had 100 requests, and the current window has 10 requests:
$$\text{Remaining Percentage} = \frac{60 - 18}{60} = 0.70$$
$$\text{Estimated Count} = (100 \times 0.70) + 10 = 70 + 10 = 80 \text{ requests}$$
If 80 exceeds the limit, the request is rejected. This provides smooth rolling-window protection while consuming only two integer counters in memory.

---

## 16. Coding Questions

### Problem: Build a Token Bucket Rate Limiter Class in TypeScript
```typescript
// utils/TokenBucket.ts
export class TokenBucket {
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

  public allowRequest(tokensRequired: number = 1): boolean {
    this.refill();

    if (this.tokens >= tokensRequired) {
      this.tokens -= tokensRequired;
      return true;
    }

    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsedTimeSeconds = (now - this.lastRefillTimestamp) / 1000;
    const tokensToAdd = elapsedTimeSeconds * this.refillRatePerSecond;

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
- **Trap 1:** "`req.ip` is always a trustworthy identifier for rate limiting."  
  *Truth:* False! Behind proxies, `req.ip` is the proxy's IP unless `trust proxy` is enabled. Furthermore, thousands of corporate users can share an office NAT IP, so authenticated routes must rate-limit by `user.id`.
- **Trap 2:** "Token bucket prevents all traffic bursts."  
  *Truth:* False. Token bucket is specifically designed to **permit bursts** up to the bucket capacity. If you need strictly smooth, non-bursty traffic, use the **Leaky Bucket** algorithm.

---

## 18. Revision Summary
- Four primary algorithms: Fixed Window (boundary flaw), Sliding Log (memory heavy), Sliding Counter (balanced hybrid), Token Bucket (permits bursts), Leaky Bucket (smooth traffic).
- Always use atomic Redis Lua scripts to eliminate race conditions in distributed environments.
- Provide standard headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After`.
- Adopt a Fail-Open policy for non-critical endpoints and Fail-Closed for authentication/billing endpoints.

---

## 19. Quick Reference

```
+--------------------+---------------------------+-----------------------------------------------+
| Algorithm          | Memory Complexity         | Primary Strength                              |
+--------------------+---------------------------+-----------------------------------------------+
| Fixed Window       | O(1)                      | Lowest CPU; best for simple basic limits      |
| Sliding Window Log | O(N) (Logs every req)     | 100% mathematically exact                     |
| Sliding Counter    | O(1) (2 integer keys)     | Industry standard for high-scale distributed  |
| Token Bucket       | O(1)                      | Ideal when legitimate traffic bursts occur    |
| Leaky Bucket       | O(N) (Queue buffer)       | Ideal for traffic smoothing to fragile DBs    |
| HTTP Status Code   | 429 Too Many Requests     | Standard rate limit rejection code            |
+--------------------+---------------------------+-----------------------------------------------+
```
