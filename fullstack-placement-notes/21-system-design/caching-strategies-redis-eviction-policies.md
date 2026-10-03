# System-Level Caching Strategies: Eviction Policies, Hit Ratios & The 3 Cache Catastrophes

## 1. What is it?
In system design, **System-Level Caching** is the strategic placement of high-speed, volatile in-memory storage (typically **Redis** or **Memcached**) at key boundaries throughout an architecture (CDN, API Gateway, Application Layer, Database Query Cache) to eliminate redundant computation, reduce database read pressure, and accelerate response latency from tens of milliseconds down to sub-milliseconds.

A production caching system is characterized by two fundamental properties:
1. **Cache Hit Ratio (CHR)**: The percentage of incoming requests served directly from cache without querying the database:
   $$\text{Cache Hit Ratio} = \frac{\text{Cache Hits}}{\text{Cache Hits} + \text{Cache Misses}} \times 100\%$$
2. **Eviction Policy**: The deterministic algorithm executed by the cache engine when memory reaches its configured limit (`maxmemory`) to decide which keys must be deleted to free space for new entries (e.g., LRU, LFU, FIFO, Random).

```
┌────────────────────────────────────────────────────────┐
│ Client Request                                         │
└───────────┬────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────┐
│ In-Memory Redis Cluster (maxmemory 16GB reached!)       │
│                                                        │
│ Is Key Present?                                        │
│  ├── YES -> Return Cache HIT (0.4ms)                   │
│  └── NO  -> Cache MISS -> Query DB                     │
│                                                        │
│ When Writing New Key:                                  │
│  Eviction Engine runs policy (e.g. allkeys-lru):       │
│  - Evaluates idle time of keys                         │
│  - Evicts oldest unaccessed key from RAM               │
└────────────────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Memory (RAM) is finite and orders of magnitude more expensive than persistent disk storage. A high-traffic system generating terabytes of data cannot keep every record in RAM:

1. **Memory Capacity Exhaustion**: Without a strict eviction policy, an in-memory database will either consume all host RAM (triggering the operating system OOM killer to terminate Redis) or crash with write-rejection errors (`OOM command not allowed when used memory > 'maxmemory'`).
2. **The 3 Cache Catastrophes (Penetration, Avalanche, Breakdown)**: When caching is implemented naively, edge-case failure modes can cause total, catastrophic failure of the entire backend database cluster:
   - **Cache Penetration**: Malicious or non-existent IDs bypass the cache completely and overwhelm the database.
   - **Cache Avalanche**: Hundreds of thousands of keys expire simultaneously, causing a massive surge of concurrent queries to hit the database.
   - **Cache Breakdown (Stampede)**: A single viral "hot key" expires under heavy load, causing thousands of concurrent threads to attempt rebuilding it at once.
3. **Maximizing Cache Efficiency**: A well-tuned caching policy achieves a **95%+ Cache Hit Ratio**, allowing a single database to support 20x to 100x more concurrent users.

---

## 3. Mental Model: The Bookshelf in a Cramped Office
Think of Redis as a **Small Bookshelf in a Professor's Office**:
- The library archive (PostgreSQL) has 1,000,000 books 5 miles away.
- The professor's office bookshelf holds only 50 books.
- **LRU (Least Recently Used)**: When the shelf is full and the professor brings in a new book, they discard the book that hasn't been opened in the longest time.
- **LFU (Least Frequently Used)**: The professor discards the book that has been read the fewest total times, keeping beloved reference textbooks forever even if not read this week.
- **Cache Breakdown**: The entire university needs the single syllabus book on the shelf. The instant the professor throws it out, 5,000 students rush into the office at the exact same second, smashing through the doors.

---

## 4. Basic Example: Monitoring Cache Hit Ratio & Setting Eviction Policies

```bash
# redis.conf configuration:

# 1. Limit Redis memory usage
maxmemory 8gb

# 2. Select Eviction Policy:
# Options: noeviction, allkeys-lru, volatile-lru, allkeys-lfu, volatile-lfu, allkeys-random, volatile-random, volatile-ttl
maxmemory-policy allkeys-lru
```

### Checking Cache Hit Ratio via Redis CLI
```bash
$ redis-cli info stats
# Look for keyspace_hits and keyspace_misses:
# keyspace_hits: 8520300
# keyspace_misses: 480100

# Cache Hit Ratio Calculation:
# 8,520,300 / (8,520,300 + 480,100) = 8,520,300 / 9,000,400 = 94.66% Hit Ratio!
```

---

## 5. Real-World Production Example: Defending Against the 3 Cache Catastrophes

```typescript
import Redis from 'ioredis';
import { BloomFilter } from 'bloomfilter';

const redis = new Redis();

// ==========================================
// 1. DEFENSE AGAINST CACHE PENETRATION:
// Technique A: Bloom Filter (In-memory probabilistic membership check)
// Technique B: Null Caching with Short TTL
// ==========================================
const bloom = new BloomFilter(32 * 256, 16); // Pre-populated with all valid User IDs

export async function getUserWithPenetrationDefense(userId: string) {
  // A. Fast check: If Bloom filter says it DOES NOT exist, it 100% does NOT exist!
  if (!bloom.test(userId)) {
    console.warn(`[Penetration Defense] User ID ${userId} blocked by Bloom Filter.`);
    return null; // Bypasses DB completely!
  }

  const cacheKey = `user:${userId}`;
  const cached = await redis.get(cacheKey);

  if (cached === 'NULL_RECORD') {
    return null; // Known non-existent record cached
  }

  if (cached !== null) {
    return JSON.parse(cached);
  }

  // Query Database
  const user = await dbQueryUser(userId);

  if (!user) {
    // B. Cache the absence of data with a short 60s TTL
    await redis.set(cacheKey, 'NULL_RECORD', 'EX', 60);
    return null;
  }

  // Populate cache with jittered TTL
  await redis.set(cacheKey, JSON.stringify(user), 'EX', calculateJitteredTtl(3600));
  return user;
}

// ==========================================
// 2. DEFENSE AGAINST CACHE AVALANCHE:
// Technique: Random Jitter on TTL
// ==========================================
export function calculateJitteredTtl(baseTtlSeconds: number): number {
  // Add random variation between -10% and +10%
  const jitterRange = baseTtlSeconds * 0.1;
  const randomJitter = (Math.random() * 2 - 1) * jitterRange;
  return Math.floor(baseTtlSeconds + randomJitter);
}

// ==========================================
// 3. DEFENSE AGAINST CACHE BREAKDOWN (STAMPEDE):
// Technique: Mutex Lock via Redis SET NX
// ==========================================
export async function getViralProductWithBreakdownDefense(productId: string) {
  const cacheKey = `product:hot:${productId}`;
  const cached = await redis.get(cacheKey);

  if (cached) return JSON.parse(cached);

  const lockKey = `lock:${cacheKey}`;
  // Acquire lock for 5000ms, only if key does NOT exist
  const acquired = await redis.set(lockKey, '1', 'PX', 5000, 'NX');

  if (acquired === 'OK') {
    try {
      // Re-verify in case another thread populated cache while we acquired lock
      const doubleCheck = await redis.get(cacheKey);
      if (doubleCheck) return JSON.parse(doubleCheck);

      // Only ONE thread rebuilds the expensive cache entry!
      console.info(`[Stampede Defense] Rebuilding hot key ${productId} from SQL...`);
      const freshData = await dbQueryProduct(productId);

      await redis.set(cacheKey, JSON.stringify(freshData), 'EX', calculateJitteredTtl(7200));
      return freshData;
    } finally {
      await redis.del(lockKey); // Release lock
    }
  } else {
    // Other concurrent threads wait 50ms and retry reading cache
    await new Promise((r) => setTimeout(r, 50));
    return getViralProductWithBreakdownDefense(productId);
  }
}

async function dbQueryUser(id: string) { return null; }
async function dbQueryProduct(id: string) { return { id, name: 'Viral Sneakers' }; }
```

---

## 6. Under the Hood: Redis Eviction Policies Deep Dive

When memory exceeds `maxmemory`, Redis executes the configured policy:

```
┌─────────────────┬────────────────────────────────────────────────────────┐
│ Policy          │ Eviction Criteria                                      │
├─────────────────┼────────────────────────────────────────────────────────┤
│ noeviction      │ Never evicts. Returns error on write commands (OOM).   │
│                 │ Standard for primary datastores, terrible for caches.  │
├─────────────────┼────────────────────────────────────────────────────────┤
│ allkeys-lru     │ Evicts the Least Recently Used keys across ALL keys.   │
│                 │ Approximated sampling algorithm. Gold standard general.│
├─────────────────┼────────────────────────────────────────────────────────┤
│ volatile-lru    │ Evicts the Least Recently Used keys ONLY among keys    │
│                 │ that have an active TTL (expiration) set.              │
├─────────────────┼────────────────────────────────────────────────────────┤
│ allkeys-lfu     │ Evicts Least Frequently Used keys across ALL keys.     │
│                 │ Uses a 24-bit logarithmic frequency counter + decay.  │
├─────────────────┼────────────────────────────────────────────────────────┤
│ volatile-ttl    │ Evicts keys with an active TTL, choosing the keys      │
│                 │ with the shortest remaining Time-To-Live first.        │
├─────────────────┼────────────────────────────────────────────────────────┤
│ allkeys-random  │ Evicts completely random keys across all keys.         │
└─────────────────┴────────────────────────────────────────────────────────┘
```

### LRU vs. LFU: When to Use Which?
- **LRU (Least Recently Used)** tracks *recency*. If an item was accessed 1 second ago, it is protected. Drawback: A temporary batch scan (e.g., reading 100,000 old records once for an export) flushes out genuinely popular items from cache.
- **LFU (Least Frequently Used)** tracks *access frequency*. It counts how many times an item was read over time. An item accessed 10,000 times will survive even if a batch scan occurs, making LFU ideal for long-tail search and e-commerce catalogs.

---

## 7. Important Rules

1. **Never Use `noeviction` for a Cache Cluster**: If Redis is acting as a cache and reaches `maxmemory`, `noeviction` will cause `SET`, `HSET`, and `LPUSH` commands to throw fatal errors, breaking application write paths.
2. **Never Omit TTL on Cached Entries**: Always assign an explicit TTL. Even with LRU eviction enabled, explicit TTLs guarantee that abandoned or orphaned keys do not waste memory indefinitely.
3. **Always Add Jitter to TTLs**: When populating thousands of keys during a scheduled batch job or database warm-up, always randomize the TTL by 10%–20% to avoid synchronized expiration waves (Cache Avalanche).
4. **Target a Cache Hit Ratio > 90%**: If your CHR falls below 80%, investigate whether:
   - Your `maxmemory` is too small (causing premature eviction).
   - Your TTLs are too short.
   - Your cache keys have unnecessary dynamic parameters that fracture the cache.
5. **Use Bloom Filters for Bounded Memory Existence Checks**: A Bloom Filter can check set membership across 100 million IDs in under 120MB of RAM with a 1% false positive rate and **0% false negative rate**, completely neutralizing Cache Penetration attacks.

---

## 8. Common Mistakes & Anti-Patterns

### 1. The Cache Avalanche Nightmare
```typescript
// ❌ DISASTER: 100,000 catalog items cached during midnight cron job with IDENTICAL TTL
items.forEach(item => {
  redis.set(`item:${item.id}`, JSON.stringify(item), 'EX', 3600); // Exactly 1 hour!
});
// At 01:00:00 AM, all 100,000 keys expire at the same second.
// The primary database experiences a massive 50,000 QPS spike and crashes.
```

### 2. Missing Double-Check inside Mutex Lock (Stampede)
Failing to re-check `redis.get(key)` immediately after acquiring a distributed lock. The thread that was waiting in line must verify whether the previous lock-holder already rebuilt the cache during the wait period.

### 3. Caching Transient Error Responses
If the database experiences a momentary 500 error or connection timeout, accidentally writing `{ error: true }` into Redis with a 2-hour TTL forces users to see error screens for 2 hours even after the database recovers.

---

## 9. Best Practices

- **Warm the Cache Proactively**: Before launching a major marketing campaign or product drop, run a background script that queries the database and populates Redis with top products, so the system experiences a 100% Hit Ratio from second 1.
- **Monitor Keyspace Evictions**: In Grafana / Datadog, set an alert on `evicted_keys`. A sudden spike in evictions means incoming write volume or key sizes have exceeded RAM capacity, causing active, hot keys to be discarded prematurely.

---

## 10. Performance Considerations

- **Redis LRU Approximation Mechanics**: True LRU requires a doubly-linked list, which consumes significant memory overhead per key. Redis uses an **Approximated LRU**: by default, it samples 5 random keys (`maxmemory-samples 5`) and evicts the oldest from that sample. Increasing samples to 10 closely mimics true LRU at the cost of slight CPU overhead.

---

## 11. Security Considerations

- **Cache Poisoning via Unsanitized Keys**: If an attacker crafts an input containing newline characters or spaces (`/search?q=shoes\r\nSET malicious_key ...`), vulnerable Redis clients could execute unintended protocol commands. Always sanitize cache key inputs.

---

## 12. The 3 Cache Catastrophes Comparison Matrix

| Problem | Root Cause | Impact | Core Defense |
| :--- | :--- | :--- | :--- |
| **Cache Penetration** | Querying non-existent IDs that are never in cache | Every request hits DB | Bloom Filter + Cache Null with short TTL |
| **Cache Avalanche** | Massive number of keys expire simultaneously | DB crushed by multi-key spike | Add randomized TTL jitter (10%-20%) |
| **Cache Breakdown** | A single viral hot key expires under high concurrency| DB crushed by single-key stampede | Mutex Lock (`SET NX`) or Probabilistic Refresh |

---

## 13. Trade-offs

- **LRU vs. LFU**: LRU uses less CPU to track access and adapts quickly to shifting trends, but is vulnerable to temporary scan pollution. LFU resists scan pollution and reflects true long-term popularity, but requires more metadata tracking and is slower to evict formerly popular items that have lost relevance.
- **Memory Cost vs. Database Provisioning**: Adding 64GB of RAM to a Redis cluster incurs monthly cloud hosting costs, but enables you to avoid provisioning a $3,000/month multi-sharded relational database cluster.

---

## 14. Real-World Usage Case Studies

1. **Reddit**: Utilizes heavy Redis caching for subreddit listings and comment trees. They prevent Cache Breakdown on breaking news threads by using distributed locks that permit only one worker to render markdown comment trees into HTML.
2. **Weibo (Chinese Social Network)**: Faced massive Cache Avalanches when celebrity marriage announcements caused millions of users to query fresh feeds simultaneously. They introduced dynamic TTL jitter and Bloom filters to stabilize their caching tier.

---

## 15. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: What is the formula for Cache Hit Ratio, and why does it matter?**
> **Answer**: $\text{Cache Hit Ratio} = \frac{\text{Hits}}{\text{Hits} + \text{Misses}} \times 100\%$. It is the primary indicator of caching efficiency. A high hit ratio (e.g., >90%) means the vast majority of user traffic is served in sub-milliseconds from in-memory RAM, protecting the slower relational database from load and connection saturation.

### Tier 2: Conceptual
**Q: Explain the difference between Cache Penetration, Cache Avalanche, and Cache Breakdown (Stampede).**
> **Answer**:
> - **Cache Penetration**: Requests query data that does *not* exist in either the cache or the database (e.g., malicious requests for fake IDs). Every request misses the cache and directly stresses the database.
> - **Cache Avalanche**: A massive batch of different cached keys expire at the exact same moment (e.g., identical TTLs), sending a wave of concurrent queries to the database.
> - **Cache Breakdown (Stampede)**: A *single*, extremely popular "hot key" (e.g., viral news article) expires, and thousands of concurrent requests for that specific key simultaneously hit the database to rebuild it.

### Tier 3: Implementation
**Q: How does a Bloom Filter prevent Cache Penetration in a user profile lookup system?**
> **Answer**: A Bloom Filter is a space-efficient probabilistic data structure. All existing user IDs from the database are hashed into the Bloom filter bit array on startup and upon user registration. When a request arrives, the application queries the Bloom filter first.
> - If the Bloom filter returns `false`, the ID **definitely does not exist**; the request is rejected immediately without querying Redis or the database.
> - If it returns `true`, the ID *likely* exists, and the application proceeds to the cache and database.

### Tier 4: Debugging
**Q: Your Redis memory is configured to 8GB with `allkeys-lru`. You notice that Redis is constantly evicting 5,000 keys per second, and database CPU has spiked to 90%. What is happening?**
> **Answer**: The application is experiencing **Cache Thrashing**. The active "working set" of hot data exceeds the 8GB RAM capacity. Because memory is saturated, every new write forces the immediate eviction of recently cached data. Subsequent reads for those evicted keys miss the cache and hit the database.
> **Fix**:
> 1. Increase Redis `maxmemory` (scale up RAM) or cluster shards (scale out).
> 2. Compress cached payloads (e.g., MessagePack or Protobuf instead of JSON).
> 3. Audit what is being cached; remove low-value, high-churn data from the cache.

### Tier 5: Scenario
**Q: Design a caching architecture for Black Friday flash sales where 50,000 users refresh the exact same promotional product page simultaneously every second.**
> **Answer**:
> 1. **Edge Caching**: Deploy Cloudflare CDN with `s-maxage=5, stale-while-revalidate=15` to absorb 99% of refreshes before they ever touch your infrastructure.
> 2. **Pre-Warming**: Pre-populate Redis with the promotional product data before the sale begins.
> 3. **Stampede Protection**: Use a distributed mutex lock (`SET product:lock PX 5000 NX`) on the origin application tier so that if the edge cache expires, only a single backend thread queries the database to rebuild the cache.
> 4. **Asynchronous Background Refresher**: Use a cron worker to re-fetch and refresh the Redis key every 3 seconds independently of user requests.

### Tier 6: Advanced
**Q: How does Redis implement its Approximated LRU algorithm and why doesn't it use a strict doubly-linked list?**
> **Answer**:
> A strict LRU implementation requires a hash map combined with a doubly-linked list. Every time any key is read or written, pointers must be moved to the head of the list. In a high-throughput system with millions of keys, this approach introduces significant memory overhead (16–24 bytes of pointer metadata per key) and severe lock contention across CPU cache lines.
> **Redis Approximated LRU**:
> Instead of a linked list, Redis stores a 24-bit timestamp in each object's header representing the last access time (`lru` clock). When memory is full and eviction is triggered, Redis samples $N$ random keys (configured by `maxmemory-samples`, default 5), evaluates their timestamps, and evicts the key with the oldest idle time from that sample pool. With $N=10$, this approximation achieves mathematical performance indistinguishable from true LRU while consuming zero extra pointer memory.

---

## 16. Coding Question: Implement an In-Memory Bloom Filter in TypeScript

### Problem
Implement a lightweight `SimpleBloomFilter` class in TypeScript that:
1. Initializes a bit array of size $M$ with $K$ hash functions.
2. Implements `add(key: string)` to set bits.
3. Implements `has(key: string)` to check membership with zero false negatives.

### Solution

```typescript
export class SimpleBloomFilter {
  private size: number;
  private bitArray: Uint8Array;
  private hashCount: number;

  constructor(sizeInBits: number = 10000, hashCount: number = 3) {
    this.size = sizeInBits;
    this.hashCount = hashCount;
    // 8 bits per byte
    this.bitArray = new Uint8Array(Math.ceil(sizeInBits / 8));
  }

  /**
   * Generates K independent hash values using FNV-1a variations
   */
  private getHashes(key: string): number[] {
    const hashes: number[] = [];
    let hash1 = 2166136261;
    let hash2 = 0;

    for (let i = 0; i < key.length; i++) {
      const code = key.charCodeAt(i);
      hash1 ^= code;
      hash1 = Math.imul(hash1, 16777619);
      hash2 = (hash2 << 5) - hash2 + code;
    }

    // Double hashing technique: hash(i) = (h1 + i * h2) % size
    for (let i = 0; i < this.hashCount; i++) {
      const combined = Math.abs((hash1 + i * hash2) % this.size);
      hashes.push(combined);
    }

    return hashes;
  }

  public add(key: string): void {
    const hashes = this.getHashes(key);
    for (const bitIndex of hashes) {
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = bitIndex % 8;
      this.bitArray[byteIndex] |= 1 << bitOffset;
    }
  }

  public has(key: string): boolean {
    const hashes = this.getHashes(key);
    for (const bitIndex of hashes) {
      const byteIndex = Math.floor(bitIndex / 8);
      const bitOffset = bitIndex % 8;
      if ((this.bitArray[byteIndex] & (1 << bitOffset)) === 0) {
        // If even ONE bit is 0, the key DEFINITELY does NOT exist!
        return false;
      }
    }
    // All bits were 1 -> Key PROBABLY exists (false positive possible, false negative impossible)
    return true;
  }
}

// ==========================================
// Demonstration
// ==========================================
const filter = new SimpleBloomFilter(10000, 3);
filter.add('user_123');
filter.add('user_456');

console.log('Has user_123:', filter.has('user_123')); // true
console.log('Has user_456:', filter.has('user_456')); // true
console.log('Has user_999 (Non-existent):', filter.has('user_999')); // false (Blocked!)
```

---

## 17. Common Interview Traps

- **Trap 1**: Thinking Bloom Filters can delete items.
  *Gotcha*: A standard Bloom Filter **cannot delete items**. Setting a bit to 0 could accidentally delete bits shared by other keys. Deletion requires a **Counting Bloom Filter** (which stores counters instead of single bits), at the cost of 4x more memory.
- **Trap 2**: Setting a TTL without an eviction policy.
  *Gotcha*: If keys are written faster than they expire, Redis will run out of memory *before* the TTL timer fires. You must always configure an eviction policy (`allkeys-lru`) alongside TTLs.
- **Trap 3**: Believing Cache Hit Ratio can reach 100%.
  *Gotcha*: Every key must experience a cache miss on its very first access (unless pre-warmed). Furthermore, data updates inevitably invalidate keys. A production hit ratio of 90%–98% is world-class.

---

## 18. Revision Summary

- **Cache Hit Ratio (CHR)**: $\frac{\text{Hits}}{\text{Hits} + \text{Misses}} \times 100\%$. Target $> 90\%$.
- **Eviction Policies**:
  - `allkeys-lru`: Best for general workloads (evicts least recently accessed).
  - `allkeys-lfu`: Best for stable long-tail popularity (evicts least frequently accessed).
  - `volatile-*`: Evicts only keys with an active TTL.
- **The 3 Catastrophes & Solutions**:
  - *Penetration*: Bloom filters + cache null records.
  - *Avalanche*: Add randomized jitter to TTLs.
  - *Breakdown*: Distributed mutex locks (`SET NX`) on hot keys.

---

## 19. Quick Reference

| Problem | Symptom | Core Defense |
| :--- | :--- | :--- |
| **Cache Penetration** | Non-existent keys hit DB | Bloom Filter / Cache `NULL` with 60s TTL |
| **Cache Avalanche** | Multi-key simultaneous expiry | Add randomized jitter to TTLs ($\pm 15\%$) |
| **Cache Breakdown** | Single hot key expiry | Mutex Lock (`SET NX`) or early background refresh |
| **`allkeys-lru`** | Out of memory | Evicts oldest unaccessed key across all keys |
| **`allkeys-lfu`** | Out of memory | Evicts least frequently accessed key |
| **`maxmemory-policy`**| Configuration key | Determines eviction behavior when RAM is full |
