# Rate Limiting & DDoS Mitigation: Architecture, Algorithms & Defensive Engineering

## 1. What is it?
**Rate Limiting** is a traffic management strategy that constrains the frequency of requests a client (identified by IP address, API key, user session, or device fingerprint) can execute against a backend service within a specified window of time. If a client exceeds their designated quota, subsequent requests are rejected—conventionally with HTTP status code `429 Too Many Requests`—until the quota replenishes.

**DDoS (Distributed Denial of Service) Mitigation** encompasses infrastructure, networking, and application-level controls designed to detect, absorb, and filter malicious floods of distributed traffic before they exhaust system resources (CPU, memory, database connection pools, bandwidth, or thread pools). While rate limiting operates primarily at the application layer (OSI Layer 7), DDoS defense spans Layers 3 (Network - IP floods, ICMP), 4 (Transport - SYN floods, UDP amplification), and 7 (Application - HTTP floods, slowloris, cache-busting queries).

```
   Incoming Untrusted Traffic (1,000,000 req/sec)
                      │
                      ▼
┌────────────────────────────────────────────────────────┐
│ Layer 3/4 DDoS Shield (Cloudflare Magic Transit / AWS   │ -> Drops SYN floods, UDP reflection,
│ Shield / Anycast Scrubbing Centers)                    │    BGP blackholing, ICMP flooding
└─────────────────────────┬──────────────────────────────┘
                          │ (Scrubbed Clean Traffic)
                          ▼
┌────────────────────────────────────────────────────────┐
│ Layer 7 Web Application Firewall (WAF) & Edge Rules    │ -> Bot score filtering, CAPTCHA challenge,
│ (Cloudflare WAF, AWS WAF, Fastly Signal Sciences)      │    geo-blocking, IP reputation inspection
└─────────────────────────┬──────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│ Edge / Reverse Proxy Rate Limiting (Nginx / Envoy /    │ -> IP-based token/leaky bucket rate limiting
│ Kong / Cloudflare Rate Limiting)                       │    Burst buffering, early HTTP 429 returns
└─────────────────────────┬──────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│ Application Cluster & Redis Distributed Rate Limiter   │ -> Tenant-based, User-ID tiering, route-
│ (Sliding Window Log/Counter via Redis Lua Scripts)     │    specific quotas (e.g. 5 SMS OTPs/hr)
└─────────────────────────┬──────────────────────────────┘
                          │
                          ▼
             Protected Microservices & DB
```

---

## 2. Why does it exist?
Without rate limiting and DDoS defenses, modern distributed applications suffer from catastrophic failure modes:

1. **Resource Starvation (Denial of Service)**: A single abusive script or misconfigured client loop can fire thousands of concurrent queries per second, consuming all Node.js event loop ticks, database connection pool slots, or worker threads, knocking the service offline for all legitimate users.
2. **Cascading Microservice Collapse**: In modern architectures, one unthrottled endpoint invoking downstream microservices or third-party APIs (Stripe, Twilio, OpenAI) can trigger cascading failures across the entire service mesh.
3. **Financial "Denial of Wallet" (DoW)**: Serverless functions (AWS Lambda, Google Cloud Run) and pay-per-use external APIs (SMS OTPs, LLM token generation, transactional emails) can rack up tens of thousands of dollars in unexpected billing overnight if unconstrained.
4. **Brute Force & Credential Stuffing Prevention**: Authentication endpoints (`/api/v1/auth/login`, `/api/v1/auth/reset-password`) without aggressive rate limiting allow attackers to test millions of breached credential pairs.
5. **API Monetization & Fair Use Tiering**: Multi-tenant SaaS platforms (like GitHub, Stripe, Twilio) use rate limiting to enforce monetization tiers (e.g., Free Tier: 60 req/min; Pro Tier: 1,000 req/min; Enterprise: 10,000 req/min) and ensure "noisy neighbors" do not degrade cluster performance.

---

## 3. Mental Model
Think of Rate Limiting as an **Airport Security Checkpoint & Boarding Gate**:
- **Fixed Window**: The gate agent allows 50 passengers through every hour on the clock (e.g., 10:00 to 11:00). If 50 passengers rush in at 10:59, and another 50 rush in at 11:01, 100 passengers enter within two minutes, causing a stampede.
- **Sliding Window Counter**: The gate agent maintains a sliding stopwatch looking back exactly 60 minutes from the current second, weighting the proportion of requests from the previous and current windows, preventing the boundary stampede.
- **Token Bucket**: A bucket holds tokens (up to capacity $B$). Every second, a dispenser drops $r$ tokens into the bucket. Each passenger must pick up a token to pass. If the bucket is full, a burst of $B$ passengers can pass immediately. When empty, passengers can only pass as fast as new tokens drop ($r$/sec).
- **Leaky Bucket**: Passengers enter a narrow funnel (buffer). Regardless of how fast passengers arrive, they are released out of the funnel at a constant, uniform drip rate ($r$/sec). If the funnel overflows its buffer, incoming passengers are rejected.

---

## 4. Basic Example: In-Memory Fixed Window Limiter (Express Middleware)

```typescript
import { Request, Response, NextFunction } from 'express';

interface RateLimitRecord {
  count: number;
  resetTime: number;
}

const windowMs = 60 * 1000; // 1 minute window
const maxRequests = 100;    // Max 100 requests per minute
const ipStore = new Map<string, RateLimitRecord>();

export function basicRateLimiter(req: Request, res: Response, next: NextFunction): void {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const currentTime = Date.now();
  
  const record = ipStore.get(clientIp);

  if (!record || currentTime > record.resetTime) {
    // New window
    ipStore.set(clientIp, {
      count: 1,
      resetTime: currentTime + windowMs,
    });
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', maxRequests - 1);
    res.setHeader('X-RateLimit-Reset', Math.ceil((currentTime + windowMs) / 1000));
    return next();
  }

  if (record.count >= maxRequests) {
    const retryAfterSeconds = Math.ceil((record.resetTime - currentTime) / 1000);
    res.setHeader('Retry-After', retryAfterSeconds);
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));
    res.status(429).json({
      error: 'Too Many Requests',
      message: `Quota exceeded. Try again in ${retryAfterSeconds} seconds.`,
    });
    return;
  }

  record.count += 1;
  res.setHeader('X-RateLimit-Limit', maxRequests);
  res.setHeader('X-RateLimit-Remaining', maxRequests - record.count);
  res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));
  next();
}
```

*Pitfall of this basic model*: If your backend runs across multiple Node.js cluster processes or Docker containers behind a load balancer, memory is **not shared**. An attacker can cycle through instances, getting $N \times \text{limit}$ requests. Additionally, `ipStore` leaks memory without active eviction.

---

## 5. Real-World Production Example: Atomic Sliding Window Counter with Redis & Lua Script

In production, rate limiting must be **atomic**, **distributed**, and **performant** (< 2ms overhead). A single Redis Lua script ensures zero race conditions across multi-node clusters.

```typescript
import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';

const redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

/**
 * Atomic Sliding Window Counter using Redis Lua
 * Algorithm:
 * Current Window = Math.floor(now / windowSizeMs)
 * Previous Window = Current Window - 1
 * Weight = (now % windowSizeMs) / windowSizeMs
 * Estimated Count = PrevWindowCount * (1 - Weight) + CurrentWindowCount
 */
const SLIDING_WINDOW_LUA = `
local currentKey = KEYS[1]
local prevKey = KEYS[2]
local limit = tonumber(ARGV[1])
local currentWindowWeight = tonumber(ARGV[2])
local ttlSeconds = tonumber(ARGV[3])

local currentCount = tonumber(redis.call('get', currentKey) or "0")
local prevCount = tonumber(redis.call('get', prevKey) or "0")

local estimatedCount = math.floor(prevCount * (1 - currentWindowWeight) + currentCount)

if estimatedCount >= limit then
  return { 0, estimatedCount, limit } -- 0 = Rejected
else
  redis.call('incr', currentKey)
  if currentCount == 0 then
    redis.call('expire', currentKey, ttlSeconds)
  end
  return { 1, estimatedCount + 1, limit } -- 1 = Allowed
end
`;

export interface RateLimitOptions {
  windowSec: number;
  maxRequests: number;
  keyGenerator?: (req: Request) => string;
}

export function createRedisSlidingRateLimiter(options: RateLimitOptions) {
  const { windowSec, maxRequests } = options;
  const windowMs = windowSec * 1000;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const identifier = options.keyGenerator 
        ? options.keyGenerator(req) 
        : (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || 'anonymous';

      const now = Date.now();
      const currentWindowIndex = Math.floor(now / windowMs);
      const prevWindowIndex = currentWindowIndex - 1;
      const currentWindowWeight = (now % windowMs) / windowMs;

      const currentKey = `ratelimit:${identifier}:${currentWindowIndex}`;
      const prevKey = `ratelimit:${identifier}:${prevWindowIndex}`;
      const ttlSeconds = windowSec * 2; // Keep key alive through the next window

      // Execute Lua script atomically on Redis cluster/instance
      const result = (await redisClient.eval(
        SLIDING_WINDOW_LUA,
        2,
        currentKey,
        prevKey,
        maxRequests.toString(),
        currentWindowWeight.toString(),
        ttlSeconds.toString()
      )) as [number, number, number];

      const [isAllowed, currentEstimatedCount, limit] = result;
      const remaining = Math.max(0, limit - currentEstimatedCount);
      const resetTimeSec = Math.ceil(((currentWindowIndex + 1) * windowMs) / 1000);

      // Standard IETF RFC RateLimit Headers
      res.setHeader('RateLimit-Limit', limit);
      res.setHeader('RateLimit-Remaining', remaining);
      res.setHeader('RateLimit-Reset', resetTimeSec);

      if (isAllowed === 0) {
        const retryAfter = Math.max(1, resetTimeSec - Math.floor(now / 1000));
        res.setHeader('Retry-After', retryAfter);
        res.status(429).json({
          statusCode: 429,
          error: 'Too Many Requests',
          message: `API rate limit of ${limit} requests per ${windowSec}s exceeded.`,
          retryAfterSeconds: retryAfter,
        });
        return;
      }

      next();
    } catch (error) {
      // Fail-open strategy: Never block paying customers due to Redis downtime
      console.error('[RateLimiter] Redis connection error, failing open:', error);
      next();
    }
  };
}
```

---

## 6. Under the Hood: Algorithmic Comparison & Redis Mechanics

```
1. Fixed Window Counter:
   [ Window 1: 10:00 - 10:01 ]    [ Window 2: 10:01 - 10:02 ]
         50 requests at 10:00:59   +   50 requests at 10:01:01
   ------------------------------------------------------------
   => 100 requests in a 2-second burst! (Double quota breach)

2. Sliding Window Log (Exact ZSET):
   Redis ZADD key <timestamp> <uuid>
   Redis ZREMRANGEBYSCORE key 0 (now - window)
   Redis ZCARD key -> Exact count
   Drawback: High memory footprint (O(N) memory per request logged)

3. Sliding Window Counter (Approximation):
   Blends previous window counter with current window counter proportionally.
   Memory: 2 scalar integers per client.
   Accuracy error: < 0.05% in production traffic distributions.

4. Token Bucket (AWS / Stripe Standard):
   Bucket Capacity B = 100, Refill Rate r = 10 tokens/sec
   Allows bursts up to B, then sustained rate capped at r.
```

---

## 7. Important Rules

1. **Always Use Atomic Operations in Distributed Environments**: Never do `GET key` followed by `INCR key` in Node.js application code. The network roundtrip between Node.js and Redis creates a race condition where thousands of concurrent requests read the same initial count before incrementing. Use Redis Lua scripts or `MULTI`/`EXEC` pipelines.
2. **Standardize Response Headers**: Always return standard rate limit headers:
   - `RateLimit-Limit`: Maximum quota allowed in current policy.
   - `RateLimit-Remaining`: Tokens or calls remaining.
   - `RateLimit-Reset`: Unix epoch timestamp when quota fully replenishes.
   - `Retry-After`: Delta seconds the client must wait (returned on 429).
3. **Adopt Fail-Open for Standard Routes, Fail-Closed for Sensitive Routes**: If Redis goes down, standard read traffic (`GET /products`) should **fail-open** (allow requests through) to avoid an outage. Sensitive endpoints (`POST /auth/login`, `POST /payments/charge`, `POST /otp/send`) must **fail-closed** or fallback to local in-memory throttles to prevent financial loss or credential stuffing.
4. **Identify Beyond Plain Remote IP**: In modern cloud topologies, traffic passes through load balancers (AWS ALB, Cloudflare, Kubernetes Ingress). `req.ip` might be the private subnet IP of the proxy. Inspect the `X-Forwarded-For` header or `CF-Connecting-IP`, ensuring your reverse proxy strips untrusted client-forged headers at the ingress boundary.
5. **Differentiate Identity Tiers**: Apply tiered rate limits:
   - Anonymous unauthenticated IPs: 30 req/min
   - Authenticated Free Tier Users: 120 req/min
   - Authenticated Enterprise API Keys: 5,000 req/min
   - Critical Operations (Password Reset, Checkout): 5 req/15 min

---

## 8. Common Mistakes & Anti-Patterns

### 1. Trusting Spoofed `X-Forwarded-For` Headers
```typescript
// ❌ WRONG: Attacker sends 'X-Forwarded-For: 8.8.8.8' in curl request
const ip = req.headers['x-forwarded-for']; 
// Attacker rotates fake IPs with every request and bypasses rate limiting!

// ✅ CORRECT: Configure Express to trust only known upstream proxy hops
app.set('trust proxy', 1); // Only trust the immediate reverse proxy (Nginx / Cloudflare)
const clientIp = req.ip; // Express extracts verified client IP
```

### 2. High Memory Leaks from Sliding Window Logs (Redis ZSET)
Storing a unique string identifier and timestamp for every single request using `ZADD` without aggressive TTLs will blow up Redis memory under a DDoS attack (e.g., 50 million requests in 10 minutes = gigabytes of RAM). Use Sliding Window Counters or Token Buckets in memory-constrained environments.

### 3. Rate Limiting Behind Database Writes
Placing the rate-limiting verification query inside PostgreSQL or MongoDB:
```sql
-- ❌ DISASTER: Hitting relational database for every single HTTP request
INSERT INTO api_logs (user_id, timestamp) VALUES ($1, NOW());
SELECT COUNT(*) FROM api_logs WHERE user_id = $1 AND timestamp > NOW() - INTERVAL '1 minute';
```
Under high traffic, the rate-limiting system itself causes a total database crash. Rate limits must be handled at the Edge (CDN/WAF) or in an in-memory cache (Redis).

---

## 9. Best Practices

- **Layered Defense (Defense in Depth)**:
  1. *L3/L4 (Network)*: Cloudflare Magic Transit / AWS Shield DDoS mitigation.
  2. *L7 Edge*: Cloudflare / AWS WAF for bot mitigation and geofencing.
  3. *Ingress Proxy*: Nginx `limit_req_zone` for coarse IP throttling.
  4. *Application Layer*: Redis-backed granular user/API key tier rate limiting.
- **Implement Exponential Backoff on the Client**: Ensure SDKs and frontend clients inspect the `Retry-After` header and back off using randomized jitter (`delay = base * 2^attempt + jitter`).
- **Use Dedicated Redis Instances for Rate Limiting**: Do not share the rate-limiting Redis instance with your primary application cache or persistent session storage. If an aggressive attack occurs, rate-limiting commands (`INCR`, `EVAL`) should not evict application data or starve mission-critical caches.

---

## 10. Performance Considerations

- **Redis Round-Trip Overhead**: Each rate check adds 0.5ms–2ms latency. For massive-scale APIs (100k+ req/sec), use **Local In-Memory Batching**:
  - The application container decrements a local memory bucket.
  - Every 1 second, it synchronizes deltas with Redis using Redis Pipelines (`PIPELINE`).
- **Nginx Native Rate Limiting**: Offload raw IP-based rate limiting to Nginx or Envoy before Node.js processes even wake up:
  ```nginx
  # /etc/nginx/nginx.conf
  limit_req_zone $binary_remote_addr zone=api_ip_limit:10m rate=10r/s;

  server {
      location /api/ {
          limit_req zone=api_ip_limit burst=20 nodelay;
          proxy_pass http://nodejs_upstream;
      }
  }
  ```

---

## 11. Security Considerations

- **Resource Exhaustion Attacks (ReDoS & Hash Floods)**: Attackers may send random UUIDs or random client IDs to fill your Redis instance with millions of dead keys. Always enforce short TTLs (e.g., 2–5 minutes maximum) on rate-limit keys.
- **DDoS Layer 7 Slowloris Defense**: Attackers open hundreds of HTTP connections and send headers extremely slowly (1 byte every 10 seconds), keeping Node.js sockets or Nginx worker connections occupied until thread exhaustion. Mitigate via aggressive client header/body timeouts:
  ```nginx
  client_body_timeout 10s;
  client_header_timeout 10s;
  keepalive_timeout 15s;
  ```

---

## 12. Alternatives & Comparison Matrix

| Mechanism | Strengths | Weaknesses | Best Used For |
| :--- | :--- | :--- | :--- |
| **Fixed Window Counter** | Minimal memory, fast implementation | Allows $2\times$ burst at window boundaries | Low-traffic internal tools |
| **Sliding Window Log** | 100% precision, zero boundary burst | $O(N)$ memory growth with request volume | High-security financial APIs |
| **Sliding Window Counter** | Negligible memory ($O(1)$), smooth boundaries | Minimal approximation error (<0.1%) | Production public SaaS APIs |
| **Token Bucket** | Accommodates controlled bursts, constant refill | More state variables to maintain | REST API endpoints with bursty workloads |
| **Leaky Bucket** | Guarantees perfectly constant outbound flow | Drops requests aggressively without bursts | Traffic shaping to downstream legacy systems |

---

## 13. Trade-offs

- **Accuracy vs. Throughput**: An exact Sliding Window Log with Redis ZSET gives 100% precision down to the millisecond but requires storing individual timestamps. A Sliding Window Counter sacrifices 0.05% accuracy for constant $O(1)$ memory and lightning-fast Redis Lua execution.
- **Fail-Open vs. Fail-Closed**: Failing-open keeps the application operational during Redis outages but exposes it to abuse. Failing-closed stops attacks but turns a Redis hiccup into a total platform outage.
- **Centralized Redis vs. Local In-Memory**: Centralized Redis guarantees strict global quota across 100 cluster pods but incurs network overhead. In-memory is instantaneous (<0.01ms) but allows clients to exceed limits by balancing across different pods.

---

## 14. Real-World Usage Case Studies

1. **GitHub API**: Uses a Sliding Window Counter of 5,000 requests per hour for authenticated Personal Access Tokens and 60 requests per hour for unauthenticated IP addresses. Headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` guide client SDKs.
2. **Cloudflare WAF / DDoS Mitigation**: Cloudflare operates an Anycast network across 300+ cities. When a multi-terabit SYN flood strikes, BGP routes traffic to the nearest scrubbing center where FPGA/XDP packet filters drop malicious packets before they ever touch the web application stack.
3. **OpenAI API**: Uses Token Bucket rate limiting based on two concurrent metrics: **RPM** (Requests Per Minute) and **TPM** (Tokens Per Minute), throttling when either requests or token counts exceed user tier capacity.

---

## 15. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: What is the difference between HTTP 429 and HTTP 503?**
> **Answer**: `429 Too Many Requests` indicates that the specific *client* has exceeded their assigned quota within a given time frame and must back off. `503 Service Unavailable` indicates that the *server itself* is overloaded, down for maintenance, or unable to handle traffic across all clients globally.

### Tier 2: Conceptual
**Q: Explain the window boundary flaw in the Fixed Window algorithm.**
> **Answer**: If a policy allows 100 requests per minute from 12:00 to 12:01, a client can send 0 requests until 12:00:59, then send 100 requests in that last second. At 12:01:00, the window resets, and the client sends another 100 requests at 12:01:01. In the 2-second span between 12:00:59 and 12:01:01, the server processed 200 requests—twice the intended threshold—potentially crashing downstream databases.

### Tier 3: Implementation
**Q: Why do we use Lua scripts inside Redis for rate limiting instead of executing consecutive Redis commands from Node.js?**
> **Answer**: Redis executes Lua scripts **atomically**. If we used Node.js to run `GET`, calculate the count, and run `INCR`, two concurrent requests from the same user hitting different Node.js servers would both read the count as 99, both decide the request is allowed, and both increment to 100. By wrapping the logic in a Redis Lua script, Redis guarantees that no other command will run in parallel on those keys, eliminating race conditions without distributed locks.

### Tier 4: Debugging
**Q: After deploying your application behind an AWS Application Load Balancer (ALB), your rate limiter immediately blocks all users across the world after 100 requests. What happened and how do you fix it?**
> **Answer**: The rate limiter was inspecting `req.connection.remoteAddress` or `req.ip` without configuring proxy trust. In this setup, every incoming request appeared to come from the internal private IP address of the AWS ALB (e.g., `10.0.1.45`). The shared IP reached 100 requests within seconds, blocking everyone. 
> **Fix**: Set `app.set('trust proxy', 1)` in Express and inspect the verified client IP from the `X-Forwarded-For` header populated by the ALB.

### Tier 5: Scenario
**Q: How would you design a rate limiter for an e-commerce Flash Sale where millions of users hit the "Buy Now" button simultaneously?**
> **Answer**:
> 1. **Edge Drop**: Place Cloudflare Waiting Room or AWS WAF at the edge to queue and throttle users before hitting origin servers.
> 2. **Token Bucket on User ID**: Authenticated users obtain a cryptographic reservation token via Redis Token Bucket.
> 3. **Asynchronous Processing**: Instead of direct database writes, allowed requests are pushed to a Kafka or RabbitMQ queue for decoupled, constant-rate inventory processing.
> 4. **Fail-Closed on Purchase**: Protect the inventory ledger with strict fail-closed rate limits per user ID (max 1 order request per 10 seconds).

### Tier 6: Advanced
**Q: How do you design a distributed rate limiter across multiple geographic data centers (e.g., US-East, EU-West, AP-South) without paying the penalty of cross-region WAN latency on every request?**
> **Answer**:
> Cross-region synchronization on every request would add 100–200ms latency. The solution is **Hierarchical Local Allocations**:
> 1. A central global service allocates portions of the total quota to each region based on traffic weight (e.g., Global quota: 10,000 req/min $\rightarrow$ US: 6,000, EU: 3,000, AP: 1,000).
> 2. Each region checks against its local regional Redis cluster (<1ms latency).
> 3. A background daemon asynchronously re-balances quotas between regions every 10–30 seconds based on consumption rates.
> 4. If a region experiences a sudden surge, it requests an emergency quota top-up asynchronously from the central coordinator.

---

## 16. Coding Question: Implement Token Bucket Rate Limiter in TypeScript

### Problem
Write a production-ready `TokenBucketRateLimiter` class in TypeScript that implements the Token Bucket algorithm with millisecond replenishment precision without background timers.

### Solution

```typescript
export class TokenBucketRateLimiter {
  private capacity: number;
  private refillRatePerMs: number;
  private tokens: number;
  private lastRefillTimestamp: number;

  /**
   * @param capacity Maximum number of tokens bucket can hold (burst limit)
   * @param refillRatePerSecond Number of tokens added to bucket per second
   */
  constructor(capacity: number, refillRatePerSecond: number) {
    this.capacity = capacity;
    this.refillRatePerMs = refillRatePerSecond / 1000;
    this.tokens = capacity;
    this.lastRefillTimestamp = Date.now();
  }

  /**
   * Lazily refills tokens based on elapsed time since last request.
   */
  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillTimestamp;

    if (elapsedMs > 0) {
      const tokensToAdd = elapsedMs * this.refillRatePerMs;
      this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
      this.lastRefillTimestamp = now;
    }
  }

  /**
   * Attempts to consume N tokens.
   * Returns true if allowed, false if rejected.
   */
  public tryConsume(tokensToConsume: number = 1): {
    allowed: boolean;
    remainingTokens: number;
    retryAfterMs: number;
  } {
    this.refill();

    if (this.tokens >= tokensToConsume) {
      this.tokens -= tokensToConsume;
      return {
        allowed: true,
        remainingTokens: Math.floor(this.tokens),
        retryAfterMs: 0,
      };
    }

    const missingTokens = tokensToConsume - this.tokens;
    const retryAfterMs = Math.ceil(missingTokens / this.refillRatePerMs);

    return {
      allowed: false,
      remainingTokens: Math.floor(this.tokens),
      retryAfterMs,
    };
  }
}
```

---

## 17. Common Interview Traps

- **Trap 1**: Claiming in-memory Node.js Maps are sufficient for production rate limiting.
  *Gotcha*: In multi-container Kubernetes deployments, in-memory counters reset on pod restarts and fail to synchronize across horizontal replicas.
- **Trap 2**: Believing rate limiting alone stops DDoS attacks.
  *Gotcha*: If a Layer 7 DDoS attack sends 200,000 requests/sec, your Node.js application will still crash just parsing HTTP headers and executing Redis rate checks. Layer 3/4 and Layer 7 volumetric attacks must be mitigated upstream by Anycast CDNs (Cloudflare, Akamai, AWS Shield).
- **Trap 3**: Using a background `setInterval` to refill tokens or clean expired records.
  *Gotcha*: If you have 500,000 active clients, running a timer loop over 500,000 objects in memory freezes the Node.js event loop. Use **lazy evaluation on demand** (`now - lastRefillTimestamp`) and Redis native key TTLs.

---

## 18. Revision Summary

- **Rate Limiting** protects backend microservices, DBs, and third-party API budgets by enforcing throughput policies per client identifier.
- **Key Algorithms**:
  - *Fixed Window*: Easy, vulnerable to boundary double-quota bursts.
  - *Sliding Window Log*: Exact, high memory consumption ($O(N)$).
  - *Sliding Window Counter*: Industry standard balance of $O(1)$ memory and smooth boundary throttling.
  - *Token Bucket*: Best for handling legitimate bursts with sustained rate limits.
  - *Leaky Bucket*: Best for constant-rate traffic shaping.
- **DDoS Mitigation**: Requires multi-tiered defense across L3/L4 (Anycast BGP, SYN cookies, packet scrubbing) and L7 (WAF, rate limiting, CAPTCHA challenges).
- **Atomic Operations**: Always use Redis Lua scripts to eliminate race conditions across distributed backend pods.

---

## 19. Quick Reference

| Concept | Protocol / Metric | Standard Value | Description |
| :--- | :--- | :--- | :--- |
| **HTTP 429** | HTTP Status Code | `429 Too Many Requests` | Standard response when rate limit is breached |
| **Retry-After** | HTTP Response Header | Seconds or Date | Tells client how long to wait before retrying |
| **RateLimit-Limit** | IETF Draft Header | Integer | Request quota for current policy |
| **RateLimit-Remaining**| IETF Draft Header | Integer | Remaining calls in current window |
| **RateLimit-Reset** | IETF Draft Header | Unix Epoch Seconds | Timestamp when current window replenishes |
| **Token Bucket** | Algorithm | Capacity $B$, Refill $r$ | Allows burst up to $B$, sustained rate $r$/s |
| **Sliding Window** | Algorithm | Weighted interpolation | Smooth windowing without boundary burst bugs |
