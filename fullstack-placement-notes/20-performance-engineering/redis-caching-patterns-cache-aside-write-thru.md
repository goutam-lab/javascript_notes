# Redis Caching Patterns: Cache-Aside, Write-Through, Invalidation & Stampede Mitigation

## 1. What is it?
**Caching** is the architectural technique of storing copies of frequently accessed, computationally expensive, or high-latency data in an ultra-fast, in-memory data store (such as **Redis** or **Memcached**) so that future requests can be served in sub-millisecond time ($< 1\text{ms}$) rather than querying a slower persistence layer (PostgreSQL, MongoDB, or third-party APIs).

A **Caching Pattern** defines the protocol and flow of data synchronization between the Application, the Cache, and the Primary Database during Read and Write cycles. The three industry-standard patterns are:
1. **Cache-Aside (Lazy Loading)**: The application orchestrates all reads and writes. On read, it checks the cache first; on a cache miss, it queries the database and populates the cache.
2. **Write-Through**: The application writes exclusively to the cache; the cache layer synchronously writes to the database before acknowledging success.
3. **Write-Behind (Write-Back)**: The application writes to the cache immediately; the cache asynchronously flushes updates to the database in batches.

```
                         CACHE-ASIDE PATTERN FLOW
                                   │
               ┌───────────────────┴───────────────────┐
               ▼                                       ▼
       [ Read Operation ]                      [ Write Operation ]
               │                                       │
               ▼                                       ▼
    1. Check Redis Cache                      1. Write to Primary DB
         /          \                                  │
    (Hit)            (Miss)                            ▼
     /                  \                     2. Invalidate Cache Entry
    ▼                    ▼                       (DEL key in Redis)
Return Cached      2. Query Postgres DB
Data                  (15ms - 50ms)
                         │
                         ▼
                   3. Populate Redis Cache
                      (with TTL)
                         │
                         ▼
                   Return Fresh Data
```

---

## 2. Why does it exist?
Modern web applications face asymmetric read-to-write traffic distributions (often 100:1 or 1,000:1). Relying exclusively on relational databases leads to critical bottlenecks:

1. **Database Connection & IOPS Exhaustion**: Even with indexes, handling 50,000 queries/sec on PostgreSQL exhausts connection pools and CPU cores. In-memory Redis serves 100,000+ operations/sec per core from RAM.
2. **Sub-Millisecond User Experience**: Relational disk reads take 5ms–50ms. Redis in-memory reads take 0.2ms–0.8ms, directly lowering TTFB and improving Core Web Vitals.
3. **Cache Invalidation Complexity**: As Phil Karlton famously stated: *"There are only two hard things in Computer Science: cache invalidation and naming things."* Choosing the wrong pattern leads to stale data, phantom reads, or inconsistent financial balances.
4. **The Cache Stampede (Dogpiling) Catastrophe**: When a heavily accessed cached key (e.g., the homepage product catalog receiving 10,000 req/sec) expires, all 10,000 concurrent requests experience a cache miss simultaneously and flood the primary database, crashing it instantly.

---

## 3. Mental Model: The Executive & Secretary
Think of the Application, Redis, and PostgreSQL as an **Executive, Personal Assistant, and Filing Archive**:
- **Cache-Aside (Lazy Assistant)**: The executive asks the assistant for a contract. The assistant checks their desk drawer (Redis). If it's there, they hand it over. If not, the assistant walks down to the basement vault (PostgreSQL), brings the folder up, places a copy in their desk drawer, and hands it to the executive.
- **Write-Through (Strict Assistant)**: When the executive signs a document, they hand it to the assistant. The assistant refuses to confirm until they have filed it in both the desk drawer and the basement vault.
- **Write-Behind (Efficient Batcher)**: The assistant puts all signed documents in a "Pending Filing" tray on their desk and carries 50 folders to the basement vault once every hour.

---

## 4. Basic Example: Cache-Aside Implementation in TypeScript with `ioredis`

```typescript
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export async function getUserProfile(userId: string): Promise<any> {
  const cacheKey = `user:profile:${userId}`;

  // 1. Try reading from Redis Cache
  const cachedData = await redis.get(cacheKey);
  if (cachedData) {
    return JSON.parse(cachedData); // Cache Hit!
  }

  // 2. Cache Miss: Query Primary Relational Database
  console.log(`[DB] Fetching user ${userId} from PostgreSQL...`);
  const userFromDb = await fakeDbQueryUser(userId);

  if (!userFromDb) {
    // Cache null for short duration to prevent Cache Penetration
    await redis.set(cacheKey, JSON.stringify(null), 'EX', 60);
    return null;
  }

  // 3. Populate Redis Cache with a 1-hour TTL (Time-To-Live)
  await redis.set(cacheKey, JSON.stringify(userFromDb), 'EX', 3600);

  return userFromDb;
}

// Write Operation: Invalidate on Update
export async function updateUserProfile(userId: string, updates: any): Promise<void> {
  // 1. Mutate primary DB first
  await fakeDbUpdateUser(userId, updates);

  // 2. Invalidate cache key (Do not write new value, just delete!)
  const cacheKey = `user:profile:${userId}`;
  await redis.del(cacheKey);
}

async function fakeDbQueryUser(id: string) { return { id, name: 'Alice', role: 'admin' }; }
async function fakeDbUpdateUser(id: string, data: any) { /* update SQL */ }
```

---

## 5. Real-World Production Example: Mitigating Cache Stampede with Distributed Locks & Probabilistic Early Expiration (XFetch)

When a hot key expires under high concurrency, standard caching fails. Two enterprise mitigations exist:
1. **Distributed Mutex Lock**: Only one thread rebuilds the cache; others wait.
2. **Probabilistic Early Expiration (XFetch Algorithm)**: A background worker refreshes the cache *before* it officially expires.

### Solution: Production Cache-Aside with Distributed Mutex (Redlock / Single-Key Lock)
```typescript
import Redis from 'ioredis';

const redis = new Redis();

export async function getWithStampedeProtection<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  // 1. Try to read from cache
  const cached = await redis.get(key);
  if (cached !== null) {
    return JSON.parse(cached) as T;
  }

  // 2. Cache Miss: Acquire a distributed mutex lock to prevent dogpiling
  const lockKey = `lock:${key}`;
  const lockAcquired = await redis.set(lockKey, 'locked', 'PX', 5000, 'NX'); // 5s timeout, NX = Only if Not Exists

  if (lockAcquired === 'OK') {
    try {
      // Re-check cache in case another worker populated it while acquiring lock
      const doubleCheck = await redis.get(key);
      if (doubleCheck !== null) {
        return JSON.parse(doubleCheck) as T;
      }

      // Execute expensive DB query
      console.info(`[Rebuilding Cache] Key: ${key}`);
      const freshData = await fetcher();

      // Write to cache with jitter to prevent synchronized expiration
      const jitterSeconds = Math.floor(Math.random() * 30);
      await redis.set(key, JSON.stringify(freshData), 'EX', ttlSeconds + jitterSeconds);

      return freshData;
    } finally {
      // Release lock
      await redis.del(lockKey);
    }
  } else {
    // 3. Lock not acquired: Another thread is currently fetching from DB!
    // Wait 50ms and retry reading from cache
    await new Promise((r) => setTimeout(r, 50));
    return getWithStampedeProtection(key, ttlSeconds, fetcher);
  }
}
```

---

## 6. Under the Hood: Deep Dive into the 4 Caching Patterns

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. Cache-Aside (Lazy Loading)                                          │
│ App reads Cache. Miss -> Reads DB -> Populates Cache.                  │
│ Writes: Writes DB -> Evicts Cache (DEL key).                           │
│ Pros: Cache only contains requested data; DB failures don't kill app.  │
│ Cons: Cache miss penalty on first access; potential stale data.        │
├────────────────────────────────────────────────────────────────────────┤
│ 2. Read-Through                                                        │
│ App treats Cache as single store. Cache library transparently loads DB.│
│ Pros: Cleaner application code.                                        │
│ Cons: Requires custom cache provider plugins.                          │
├────────────────────────────────────────────────────────────────────────┤
│ 3. Write-Through                                                       │
│ App writes to Cache. Cache synchronously writes to DB.                 │
│ Pros: Data in cache is never stale; reads are always warm.             │
│ Cons: Higher write latency (two writes per mutation); unread data      │
│       pollutes cache memory.                                           │
├────────────────────────────────────────────────────────────────────────┤
│ 4. Write-Behind (Write-Back)                                           │
│ App writes to Cache. Cache acknowledges immediately, then flushes to   │
│ DB asynchronously in batches (e.g. bulk insert 1,000 rows).            │
│ Pros: Blazing fast write throughput; absorbs write spikes.             │
│ Cons: Risk of permanent data loss if Redis crashes before flushing!    │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Important Rules

1. **Delete, Don't Update, on Mutation (Cache Invalidation Rule)**:
   When modifying a record in the database, **delete the cache key (`redis.del`)** instead of writing the updated value. Writing the new value creates race conditions: if Transaction A and Transaction B commit in reverse order, stale data will be permanently cached. Deleting ensures the next read safely fetches the committed state.
2. **Always Set a TTL (Time-To-Live)**: Never store keys without an expiration time. Without TTLs, abandoned keys consume RAM forever until Redis hits `maxmemory` and triggers evictions.
3. **Add Jitter to TTLs**: If 100,000 keys are cached at 12:00 with a 3,600s TTL, all 100,000 keys will expire simultaneously at 13:00, triggering a **Cache Avalanche**. Add random jitter (`TTL = 3600 + Math.random() * 300`).
4. **Protect Against Cache Penetration (Null Caching / Bloom Filters)**: If an attacker queries millions of non-existent IDs (`/users/random-uuid-999`), every request misses the cache and hits the database. Cache the non-existence (`redis.set(key, null, 'EX', 60)`) or use a **Bloom Filter**.
5. **Update DB First, Then Invalidate Cache**: Always commit the relational transaction to PostgreSQL *before* issuing `redis.del()`. If you delete the cache key first, a concurrent read query may fetch the uncommitted old DB data and repopulate the cache before the write transaction finishes.

---

## 8. Common Mistakes & Anti-Patterns

### 1. The Race Condition: Updating Cache Instead of Invalidation
```typescript
// ❌ DANGEROUS RACE CONDITION:
// Request 1 updates user name to "Bob"
// Request 2 updates user name to "Bobby"
// If Request 1's redis.set finishes AFTER Request 2, the cache has "Bob" forever!
await db.user.update(...);
await redis.set(key, JSON.stringify(updatedUser)); // WRONG!

// ✅ CORRECT: Evict key
await db.user.update(...);
await redis.del(key);
```

### 2. Large Object Serialization Bloat
Storing massive 10MB JSON documents in a single Redis string key. Serializing and deserializing large JSON blobs in Node.js blocks the event loop. Split data into Redis Hashes (`HSET`, `HGET`) or paginate cached collections.

### 3. Missing Fallback when Redis is Down (No Circuit Breaking)
If the Redis cluster experiences a network partition, the application should not crash. Implement a fallback to query the database directly while logging the Redis error.

---

## 9. Best Practices

- **Redis Eviction Policy Configuration**: Configure `maxmemory-policy` in `redis.conf`:
  - `allkeys-lru`: Evicts least recently used keys among all keys (ideal for general caching).
  - `volatile-lru`: Evicts least recently used keys among those with an active TTL.
  - `noeviction`: Returns an error on writes when memory is full (never use for a cache!).
- **Structured Key Namespacing**: Standardize key formats using colons:
  `app:<environment>:<entity>:<id>:<attribute>` $\rightarrow$ `app:prod:users:101:profile`.

---

## 10. Performance Considerations

- **Redis MGET / Pipelines**: When fetching multiple items (e.g., 20 products in a catalog), never issue 20 sequential `redis.get()` calls. Use `redis.mget()` or a pipeline (`redis.pipeline()`) to batch network roundtrips into a single TCP packet (<1ms total).
- **RAM Sizing & Key Compression**: Use compact key names and binary serializers (Protobuf, MessagePack) instead of verbose JSON strings to reduce Redis memory footprint by 50%.

---

## 11. Security Considerations

- **Do Not Cache Sensitive Unencrypted Data**: Avoid storing plaintext passwords, credit card numbers, or unencrypted PII in Redis. If a Redis instance is misconfigured without a password (`AUTH`) or exposed to the public internet, attackers can dump the entire database using `KEYS *`.
- **Require Authentication and TLS**: In cloud deployments (AWS ElastiCache, Redis Enterprise), enable Transit Encryption (TLS) and Token Authentication.

---

## 12. Comparison Matrix: Caching Strategies

| Pattern | Read Latency | Write Latency | Stale Data Risk | Failure Impact |
| :--- | :--- | :--- | :--- | :--- |
| **Cache-Aside** | Fast (on hit) | Normal | Low (if invalidated) | Fallback to DB |
| **Read-Through** | Fast | Normal | Low | Fallback to DB |
| **Write-Through** | Fast | Slow (dual write) | Zero | Cache down = Writes fail |
| **Write-Behind** | Fast | Fastest (in-memory)| Moderate | Data loss if cache crashes |

---

## 13. Trade-offs

- **Cache-Aside vs. Write-Through**: Cache-Aside only stores data that is actually requested, saving memory, but incurs a latency penalty on the first cache miss. Write-Through guarantees that data is always pre-warmed in the cache, but wastes RAM storing data that may never be read again.
- **Strong Consistency vs. Eventual Consistency**: Caching fundamentally introduces eventual consistency. If your application requires absolute, zero-tolerance consistency (such as real-time bank ledger balances), read directly from the ACID database with row locks rather than caching.

---

## 14. Real-World Usage Case Studies

1. **Twitter / X Timeline Service**: Uses a hybrid Cache-Aside and Write-Behind strategy. When a celebrity tweets, the tweet ID is pushed asynchronously to millions of followers' in-memory timeline caches in Redis, allowing timelines to load in <10ms.
2. **GitHub**: Employs Redis Cache-Aside for Git repository metadata and permission checks. They prevent Cache Stampedes on viral open-source repositories using distributed mutexes.

---

## 15. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: What is the Cache-Aside pattern and how does it handle a cache miss?**
> **Answer**: In the Cache-Aside (Lazy Loading) pattern, the application orchestrates reads and writes. When reading, the application queries the cache first. If the key exists (Cache Hit), it returns the data. If the key is missing (Cache Miss), the application queries the primary database, populates the cache with the fetched result (setting a TTL), and returns the response to the client.

### Tier 2: Conceptual
**Q: What is a "Cache Stampede" (also known as dogpiling or the thundering herd problem)?**
> **Answer**: A Cache Stampede occurs when a popular, high-traffic cached key expires. Under high concurrency (e.g., 5,000 requests per second), all 5,000 incoming requests experience a cache miss at the exact same millisecond. They all simultaneously attempt to query the primary relational database and recompute the value, overwhelming database CPU, connection pools, and disk I/O, frequently causing the database to crash.

### Tier 3: Implementation
**Q: Why should you delete a cache key instead of updating it when modifying data in the database?**
> **Answer**: Updating the cache creates **concurrency race conditions**. If Request A and Request B update the same record at nearly the same time, network latency might cause Request A's cache update to arrive *after* Request B's update, even though Request B was committed last in the database. The cache now permanently holds stale data. By **deleting** the key (`redis.del`), you force the subsequent read request to fetch the latest committed database state cleanly.

### Tier 4: Debugging
**Q: After adding Redis caching to your e-commerce API, users report seeing other users' shopping carts after checkout. What caused this?**
> **Answer**: The cache key was not properly namespaced or was missing unique user identification. For example, the developer used a static key like `cache:cart` instead of `cache:cart:${userId}` or `cache:cart:${sessionId}`. As a result, the second user received the cached response generated by the first user.

### Tier 5: Scenario
**Q: How do you design a caching strategy for a product inventory system where 1,000,000 users are trying to purchase 100 available items during a flash sale?**
> **Answer**:
> 1. Do not use standard Cache-Aside for inventory decrement because reading from DB and writing to cache creates race conditions.
> 2. Pre-warm the inventory count directly into Redis as an atomic integer: `redis.set('item:101:stock', 100)`.
> 3. Use an atomic Redis **Lua script** or `DECRBY`:
>    ```lua
>    local stock = redis.call('get', KEYS[1])
>    if tonumber(stock) > 0 then
>      redis.call('decr', KEYS[1])
>      return 1 -- Success
>    else
>      return 0 -- Sold out
>    end
>    ```
> 4. If the Redis decrement succeeds, push an order creation event to a message queue (Kafka/RabbitMQ) for asynchronous database persistence.

### Tier 6: Advanced
**Q: Explain the probabilistic early expiration algorithm (XFetch) and how it mathematically prevents cache stampedes without distributed locks.**
> **Answer**:
> Distributed locks force concurrent threads to wait, adding latency. **XFetch** calculates whether a worker should proactively recompute the cache *before* it officially expires.
> When reading key $K$, the cache stores: the value $V$, the computation duration $\delta$, and the expiration timestamp $E$.
> The client computes:
> $$-\beta \times \delta \times \ln(\text{random}()) > (E - \text{now})$$
> Where $\beta > 0$ is a aggressiveness multiplier and $\text{random}() \in (0, 1]$.
> As the current time approaches the expiration time $E$, the probability that this condition evaluates to `true` increases. The higher the read traffic, the earlier a single random request triggers a background refresh. When triggered, that single request recomputes and extends the cache before it ever reaches zero, guaranteeing that a cache miss never occurs for real users.

---

## 16. Coding Question: Multi-Get (Batch) Cache-Aside Function

### Problem
Implement an efficient `getMultipleUsersProfile(userIds: string[])` function that:
1. Performs a single `redis.mget` call to fetch all available cached profiles.
2. Identifies the subset of IDs that were cache misses.
3. Queries the database only for the missing IDs using a single SQL `IN` query.
4. Populates Redis with the missing entries using a pipeline.
5. Returns a complete map of all requested user profiles.

### Solution

```typescript
import Redis from 'ioredis';

const redis = new Redis();

interface UserProfile {
  id: string;
  name: string;
  email: string;
}

export async function getMultipleUsersProfile(
  userIds: string[]
): Promise<Map<string, UserProfile>> {
  const resultMap = new Map<string, UserProfile>();
  if (userIds.length === 0) return resultMap;

  // 1. Construct Redis keys
  const keys = userIds.map((id) => `user:profile:${id}`);

  // 2. Fetch all keys in a single MGET network round-trip
  const cachedValues = await redis.mget(...keys);
  const missingIds: string[] = [];

  cachedValues.forEach((val, idx) => {
    const userId = userIds[idx];
    if (val !== null) {
      resultMap.set(userId, JSON.parse(val));
    } else {
      missingIds.push(userId);
    }
  });

  // 3. If all keys were in cache, return immediately
  if (missingIds.length === 0) {
    return resultMap;
  }

  // 4. Batch query the database ONLY for the missing IDs
  console.log(`[DB] Fetching ${missingIds.length} missing profiles from SQL...`);
  const dbUsers = await fakeSqlBatchQuery(missingIds);

  // 5. Use a Redis Pipeline to populate the missing records in a single round-trip
  const pipeline = redis.pipeline();

  for (const user of dbUsers) {
    resultMap.set(user.id, user);
    const key = `user:profile:${user.id}`;
    // 1-hour TTL with random jitter (0 - 60s)
    const jitter = Math.floor(Math.random() * 60);
    pipeline.set(key, JSON.stringify(user), 'EX', 3600 + jitter);
  }

  await pipeline.exec();

  return resultMap;
}

async function fakeSqlBatchQuery(ids: string[]): Promise<UserProfile[]> {
  // Simulates SELECT * FROM users WHERE id IN (...)
  return ids.map((id) => ({ id, name: `User_${id}`, email: `${id}@test.com` }));
}
```

---

## 17. Common Interview Traps

- **Trap 1**: Believing Redis persistence (RDB/AOF) turns Redis into a substitute for a primary relational database.
  *Gotcha*: Redis is an in-memory store. While it supports snapshots (RDB) and append-only logging (AOF), it lacks relational integrity, foreign keys, complex transactions, and disk-scale capacity. Use Redis as a cache, not your primary source of truth.
- **Trap 2**: Using `KEYS *` in production to find keys.
  *Gotcha*: `KEYS *` is a blocking $O(N)$ operation. In a Redis instance with millions of keys, running `KEYS *` locks the single Redis thread for seconds, blocking all application traffic. Always use `SCAN` with a cursor.
- **Trap 3**: Caching un-parameterized queries globally.
  *Gotcha*: Storing the results of `/api/search?q=shoes` under the key `search:shoes` without including the page number or user permissions will return Page 1 to someone asking for Page 2.

---

## 18. Revision Summary

- **Caching Patterns**:
  - *Cache-Aside*: Application coordinates reads/writes. Most common, highly resilient.
  - *Write-Through*: Synchronous write to cache and DB.
  - *Write-Behind*: Asynchronous batch write to DB. High throughput, risk of data loss.
- **Invalidation Strategy**: Always **delete (`DEL`)** the cache key after committing a DB update; never update the cache directly.
- **Cache Pitfalls & Defenses**:
  - *Stampede*: Prevent via distributed mutex locks or XFetch early refresh.
  - *Avalanche*: Prevent by adding randomized jitter to TTLs.
  - *Penetration*: Prevent by caching nulls or using Bloom filters.

---

## 19. Quick Reference

| Problem | Root Cause | Solution |
| :--- | :--- | :--- |
| **Cache Stampede** | Hot key expires under high concurrency | Distributed lock (`SET NX`) or XFetch |
| **Cache Avalanche** | Many keys expire at the same second | Add random jitter to TTLs |
| **Cache Penetration**| Requests for non-existent IDs hit DB | Cache `null` with short TTL or Bloom Filter |
| **Stale Data Race** | Updating cache value on mutation | Invalidate (`DEL key`) after DB commit |
| **Memory Exhaustion**| Unbounded cache growth | Set `allkeys-lru` eviction policy + TTLs |
| **Batch Operations** | High network roundtrip latency | Use `MGET` or `redis.pipeline()` |
