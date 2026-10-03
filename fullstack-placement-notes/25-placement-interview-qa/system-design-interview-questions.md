# System Design Placement Interview Mastery Guide

---

## 1. What is it?

System Design interview mastery represents the architectural problem-solving methodology, distributed systems foundations, and trade-off analysis required to design scalable, fault-tolerant, high-concurrency systems in Tier-1 placement and FAANG/MANG interviews. In senior and fullstack interviews, system design rounds evaluate an engineer's ability to navigate ambiguity, translate business requirements into concrete architectural components, calculate back-of-the-envelope capacity estimations, eliminate single points of failure (SPOFs), and defend complex distributed data consistency models under network partitions.

```
+-----------------------------------------------------------------------------------+
|                        System Design Architecture Blueprint                       |
+-----------------------------------------------------------------------------------+
| [ Edge Layer ]:      Anycast DNS -> Cloudflare CDN -> DDoS Shield                 |
|                            |                                                      |
| [ Gateway Layer ]:   API Gateway / Envoy Reverse Proxy (Auth, Rate Limit, TLS)    |
|                            |                                                      |
| [ Application ]:     Microservices Cluster (Node.js/Go) <-> Service Mesh (mTLS)   |
|                            |                                 |                    |
| [ Caching Layer ]:   Redis Cluster (LRU Cache-Aside)         | Async Events       |
|                            |                                 v                    |
| [ Persistence ]:     Primary SQL DB (PostgreSQL)      Message Broker (Kafka/SQS)  |
|                      + Read Replicas + CDC Engine            |                    |
|                                                              v                    |
| [ Async Workers ]:                                   Event Consumers / Workers    |
+-----------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Single-node monolithic architectures inevitably collapse when user traffic scales from hundreds of users to millions:
1. **Hardware Resource Ceilings:** A single server has physical CPU, RAM, and network bandwidth limits. Once exceeded, vertical scaling becomes impossible or cost-prohibitive.
2. **Single Point of Failure (SPOF):** If a single server or availability zone crashes, the entire platform goes offline.
3. **Contrasting Workload Requirements:** A system processing read-heavy user feeds (99% reads) requires drastically different storage and caching optimizations than an append-only telemetric IoT ingestion pipeline (99% writes).
4. **Data Consistency vs High Availability:** Physical network cables across geographic data centers experience fiber cuts and latency spikes. The **CAP Theorem** dictates that distributed systems must make principled trade-offs between immediate consistency and continuous availability during network partitions.

---

## 3. Mental Model

To excel in system design interviews, structure every answer using the **6-Step Systematic Framework**:

```
[ STEP 1: Clarify Scope & Functional Requirements ]
  - What are the core user flows? (e.g. Post tweet, View timeline, Follow user)
  - What are the out-of-scope features? (e.g. Video streaming, Ads)

[ STEP 2: Non-Functional Requirements & Scale Estimates ]
  - Availability: 99.99% (Four Nines = ~52 mins downtime/year)
  - Latency: p99 < 150ms read latency
  - DAU / QPS: 100M Daily Active Users -> Read QPS vs Write QPS
  - Storage & Network Bandwidth over 5 years

[ STEP 3: High-Level Architecture Diagram ]
  - Client -> CDN -> Load Balancer -> API Gateway -> Stateless App Servers -> DB

[ STEP 4: Deep-Dive Core Components & Data Models ]
  - Relational vs NoSQL database selection
  - Caching strategy (Cache-Aside, TTL)
  - Message broker queueing (Kafka / RabbitMQ)

[ STEP 5: Scalability & Resilience Bottlenecks ]
  - Eliminating SPOFs via multi-AZ deployments
  - Database sharding strategies (Consistent Hashing)
  - Handling Celebrity / Hotspot problems (Fan-out on Read vs Write)

[ STEP 6: Monitoring, Observability & Trade-offs ]
  - Distributed tracing, metrics (Prometheus/Grafana), Circuit Breakers
```

---

## 4. Basic Example

### Consistent Hashing Ring Concept

```
                   Node A (Tokens: 0, 100)
                     /                 \
                    /                   \
                   /                     \
       Node C (Token: 200) ----------- Node B (Token: 300)

- Hash Ring space: 0 to 2^32 - 1
- Key K1 hashes to 150 -> Mapped to next clockwise node: Node C
- Key K2 hashes to 50  -> Mapped to next clockwise node: Node A
- Virtual Nodes (V-Nodes): Each physical server registers 100+ virtual tokens
  to ensure uniform data distribution and prevent hotspotting.
```

---

## 5. Real Example

### Distributed Rate Limiter: Redis Sliding Window Counter

```typescript
import { createClient } from "redis";

const redis = createClient({ url: process.env.REDIS_URL });

/**
 * Production Sliding Window Rate Limiter using Redis Sorted Sets (ZSET).
 * Guarantees exact atomicity across multi-instance stateless web nodes.
 */
export async function checkRateLimit(
  userId: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number }> {
  const key = `ratelimit:${userId}`;
  const now = Date.now();
  const clearBefore = now - windowSeconds * 1000;

  // Multi-exec Redis atomic pipeline
  const multi = redis.multi();
  
  // 1. Remove all requests older than active sliding window
  multi.zRemRangeByScore(key, 0, clearBefore);
  
  // 2. Add current request timestamp (using timestamp as both member and score)
  multi.zAdd(key, { score: now, value: `${now}:${Math.random()}` });
  
  // 3. Count total active requests in the current window
  multi.zCard(key);
  
  // 4. Set expiry on key to clean up idle users automatically
  multi.expire(key, windowSeconds);

  const results = await multi.exec();
  const requestCount = results[2] as number;

  if (requestCount > limit) {
    return { allowed: false, remaining: 0 };
  }

  return { allowed: true, remaining: limit - requestCount };
}
```

---

## 6. Under the Hood

### CAP vs PACELC Theorem

The CAP Theorem states that in the event of a network **Partition (P)**, a distributed system must choose between:
* **Consistency (C):** Every read receives the most recent write or an error.
* **Availability (A):** Every non-failing node returns a response, but it may contain stale data.

The **PACELC Theorem** extends CAP by explaining system behavior during normal (non-partition) operation:
$$\text{If } \mathbf{P} \text{ (Partition) } \rightarrow \text{Choose between } \mathbf{A} \text{ (Availability) or } \mathbf{C} \text{ (Consistency)};$$
$$\mathbf{E} \text{ (Else / Normal) } \rightarrow \text{Choose between } \mathbf{L} \text{ (Latency) or } \mathbf{C} \text{ (Consistency)}.$$

* **PA/EL Systems (e.g., DynamoDB, Cassandra):** Prioritizes Availability during partitions, and minimizes Latency during normal operations (eventual consistency).
* **PC/EC Systems (e.g., Spanner, CockroachDB, PostgreSQL Master):** Prioritizes Consistency during partitions, and enforces Consistency over Latency during normal operations.

---

## 7. Important Rules

1. **Rule of Stateless Application Servers:** Application servers must never store in-memory user sessions or state on local disk. Sessions must live in external distributed stores (Redis), enabling instances to scale horizontally behind a load balancer without sticky sessions.
2. **Rule of Idempotency in Distributed Systems:** Network requests fail unpredictably. Any state-changing API or message queue consumer MUST be idempotent (processing the same message twice produces the exact same result) using unique `Idempotency-Key` headers or database unique constraints.
3. **Rule of Cache-Aside Ordering:** When updating data: **Update database first, then delete cache entry.** Never update cache before database (risks cache containing uncommitted data if DB write fails), and never update cache directly with new value (concurrency race conditions overwrite fresh data with stale updates).
4. **Rule of Graceful Degradation:** When downstream dependencies fail, degrade gracefully. If the recommendation ML service times out, fall back to a cached list of top-10 global popular items instead of throwing a 500 error to the user.

---

## 8. Common Mistakes

### Mistake 1: Choosing Microservices Prematurely
Designing a distributed microservices mesh for a prototype or early-stage platform with 5 engineers. Microservices introduce network latency, distributed transaction complexities (Sagas), CI/CD overhead, and data consistency nightmares that crush small teams. A modular monolith is the superior initial pattern.

### Mistake 2: Missing Back-of-the-Envelope Math
Jumping straight into architecture diagrams without calculating Read QPS, Write QPS, Storage per Year, and Network Bandwidth. Estimations dictate whether your system requires sharding, caching, or standard single-node scaling.

### Mistake 3: Relying on Master-Master SQL for Scaling
Proposing multi-master relational database replication to scale writes. Master-master SQL introduces severe write conflict resolution issues, cross-datacenter latency deadlocks, and split-brain risks. Use single-master with read replicas or horizontal sharding by partition key.

---

## 9. Best Practices

1. **Consistent Hashing for Caching and Sharding:** Distribute cache keys or database shards across a consistent hashing ring with virtual nodes (100–250 per physical node) to minimize data movement ($1/N$ keys re-mapped) when adding or removing servers.
2. **Circuit Breakers with Exponential Backoff:** Wrap external network dependencies with a circuit breaker pattern (Netflix Hystrix / Opossum). If failure rate exceeds 50%, trip to `OPEN` immediately to protect thread pools and allow downstream services to recover.
3. **Use Asynchronous Event Streaming for Decoupling:** Decouple order checkout from notification emails, receipt generation, and warehouse updates using Apache Kafka or AWS SQS.

---

## 10. Performance Considerations

* **Cache Stampede (Thundering Herd) Mitigation:** When an expensive, high-traffic cache key expires, thousands of concurrent requests miss the cache simultaneously, hitting the underlying database and causing a crash.
  * *Fix:* Use **Mutex Locking** (only one worker acquires lock to recompute; others wait) or **Probabilistic Early Expiration (XFetch algorithm)** where the cache is refreshed in the background before actual expiration.
* **Database Connection Overhead:** A database connection consumes 2–10MB of memory and requires a 3-way TCP handshake + TLS negotiation. Use a dedicated connection pooler (PgBouncer) to multiplex thousands of app connections onto a small pool of database backend processes.

---

## 11. Security Considerations

* **DDoS Mitigation at Edge:** Terminate TLS and filter Layer 7 HTTP flood attacks at the edge (Cloudflare / AWS Shield) before packets reach your origin load balancers.
* **mTLS (Mutual TLS) in Service Mesh:** In a zero-trust microservice architecture, encrypt and authenticate all internal service-to-service communication using mTLS managed via Envoy proxies and Istio.

---

## 12. Alternatives

| Architecture Pattern | Pros | Cons | Best Use Case |
| :--- | :--- | :--- | :--- |
| **Monolith (Modular)** | Simple deployment, zero network latency between modules, single DB | Scales as a single unit, team ownership bottlenecks at 100+ devs | Startups, medium-scale platforms, rapid product iterations |
| **Microservices** | Independent deployments, domain isolation, language flexibility | Distributed tracing complexity, network latency, data consistency headaches | Large organizations (200+ engineers), distinct scaling boundaries |
| **Event-Driven (CQRS / Event Sourcing)** | High write throughput, perfect audit history, decoupled read views | Eventual consistency, high operational complexity | Financial trading, supply chain tracking, high-scale booking systems |
| **Serverless (Lambda / Fargate)** | Zero server maintenance, automatic scaling from 0 to 10k instances | Cold start latency, connection pool exhaustion with SQL, vendor lock-in | Burst-heavy APIs, background asynchronous workers |

---

## 13. Trade-offs

* **Strong Consistency vs High Availability (CAP):** Enforcing linearizable consistency requires synchronous network roundtrips across replicas before acknowledging writes, increasing latency and reducing availability during network partitions.
* **Denormalization vs Storage Cost:** Pre-computing feeds and denormalizing tables provides sub-10ms read response times, but multiplies disk storage by 5x and increases write amplification.

---

## 14. Real-World Usage

* **Twitter / X Timeline:** Uses a hybrid Fan-out on Write vs Fan-out on Read architecture. Standard users fan-out tweets to their followers' Redis timelines upon posting. Celebrities (e.g., Elon Musk with 180M+ followers) bypass fan-out on write; their tweets are merged into user timelines dynamically at read time.
* **Instagram Photo Storage (Haystack):** Created custom append-only blob storage files to eliminate Linux filesystem inode overhead when storing billions of small photo files.

---

## 15. Placement Interview Questions

### Basic Level
1. **Explain the difference between Vertical Scaling (Scale-Up) and Horizontal Scaling (Scale-Out).**
   * *Answer:* Vertical scaling increases the computing capacity of a single physical server by adding more CPU cores, RAM, or faster NVMe SSDs. It is simple (no code changes required), but has an absolute hardware ceiling and creates a single point of failure. Horizontal scaling adds more independent server instances to a pool behind a load balancer. It provides unlimited scaling potential and fault tolerance, but requires stateless application architecture and distributed data management.

2. **What is a Reverse Proxy and how does it differ from a Forward Proxy?**
   * *Answer:*
     * *Forward Proxy:* Sits in front of client browsers (e.g., corporate office proxy). Intercepts outgoing client requests to inspect traffic, enforce security policies, or anonymize the client's IP.
     * *Reverse Proxy:* Sits in front of backend web servers (e.g., Nginx, Envoy). Intercepts incoming requests from the public internet and routes them to appropriate internal servers, performing load balancing, SSL termination, caching, and rate limiting.

3. **What is the difference between Layer 4 (L4) and Layer 7 (L7) Load Balancing?**
   * *Answer:*
     * *Layer 4 (Transport Layer):* Routes traffic based strictly on IP address and TCP/UDP port without inspecting the packet payload. Extremely fast, lightweight, and consumes minimal CPU.
     * *Layer 7 (Application Layer):* Inspects HTTP/HTTPS headers, cookies, URL paths, and JSON payloads. Enables intelligent routing (e.g., `/api/payments` routes to Payment Service; `/api/images` routes to Image CDN), but requires CPU-intensive TLS termination and HTTP parsing.

4. **What are the primary Caching Strategies (Cache-Aside, Write-Through, Write-Behind)?**
   * *Answer:*
     * *Cache-Aside (Lazy Loading):* Application checks cache. On miss, reads from DB, writes to cache, and returns. Cache only holds actively requested data, but suffers from cache miss penalties.
     * *Write-Through:* Application writes data to cache, and the cache synchronously writes to the database before completing. Guarantees consistency, but adds write latency.
     * *Write-Behind (Write-Back):* Application writes to cache immediately. The cache asynchronously batches writes to the database in the background. Ultra-fast writes, but risks data loss if cache node crashes before flushing to disk.

5. **What is a CDN (Content Delivery Network) and how does it work?**
   * *Answer:* A CDN is a geographically distributed network of Point of Presence (PoP) edge proxy servers. When a user requests static assets (images, CSS, JS, videos) or cached API responses, Anycast DNS routes the request to the nearest physical edge server, drastically reducing latency by minimizing physical fiber round-trip distances.

---

### Conceptual Level
6. **Explain the Fan-Out on Write vs Fan-Out on Read problem in social media feeds (e.g., Twitter/Instagram).**
   * *Answer:*
     * *Fan-Out on Write (Push Model):* When User A posts a tweet, the system immediately writes that tweet ID into the pre-computed home timeline cache (Redis) of all of User A's followers.
       * *Pros:* Feed retrieval is instant ($O(1)$ read from Redis).
       * *Cons:* Catastrophic for celebrities with 50M+ followers. A single tweet triggers 50,000,000 Redis writes, causing massive write lag and thread pool starvation.
     * *Fan-Out on Read (Pull Model):* When User B opens their feed, the system queries the database for all accounts User B follows, fetches their latest posts, and merges/sorts them dynamically.
       * *Pros:* Posting is instant ($O(1)$ write).
       * *Cons:* Reading is extremely slow and expensive ($O(K \log K)$ join and sort across thousands of accounts).
     * *Hybrid Industry Solution:* Use Fan-Out on Write for 99% of normal users (<25k followers). For celebrities/influencers (>25k followers), bypass fan-out on write and dynamically merge their tweets at read time when followers open the app.

7. **How does Consistent Hashing work and why is it preferred over traditional modulo hashing (`hash(key) % N`)?**
   * *Answer:* In modulo hashing, if you have $N$ cache servers and add or remove 1 server, the divisor becomes $N+1$ or $N-1$. Almost 100% of all keys re-hash to completely different nodes, causing a catastrophic cache stampede that overwhelms the database.
   * *Consistent Hashing:* Maps both servers and keys to positions on an abstract circular 32-bit integer ring ($0$ to $2^{32}-1$). A key is assigned to the first server encountered moving clockwise. When a server is added or removed, only $1/N$ fraction of keys are remapped, leaving the rest undisturbed. Virtual nodes (v-nodes) ensure uniform statistical distribution across physical nodes.

8. **What is the difference between Message Queues (RabbitMQ/SQS) and Distributed Commit Logs (Apache Kafka)?**
   * *Answer:*
     * *Message Queue (RabbitMQ / SQS):* Implements Smart Broker / Dumb Consumer model. Messages are pushed to consumers. Once acknowledged (`ACK`), messages are immediately deleted from the queue. Ideal for discrete job processing, task delegation, and complex routing patterns (topic/direct exchanges).
     * *Distributed Log (Kafka):* Implements Dumb Broker / Smart Consumer model. Messages are immutable append-only logs partitioned on disk and retained for days/weeks. Consumers track their own read position via offsets. Multiple consumer groups can read the same stream independently at their own pace. Ideal for high-throughput event streaming, event sourcing, and real-time analytics.

9. **Explain the Distributed Transaction Dilemma: Two-Phase Commit (2PC) vs Saga Pattern.**
   * *Answer:*
     * *Two-Phase Commit (2PC):* Centralized coordinator asks all participants to Prepare, then Commit. Guarantees ACID consistency across databases, but is synchronous and blocking. If the coordinator crashes during Phase 2, locks are held indefinitely, destroying system availability.
     * *Saga Pattern:* Decomposes distributed transactions into a sequence of local transactions across services. Each service executes its local transaction and publishes an event. If a step fails, the Saga executes **Compensating Transactions** in reverse order to undo changes (eventual consistency). Handled via Choreography (event-driven) or Orchestration (central state machine).

10. **Explain the Database Replication Lag problem and how to prevent users from seeing stale reads ("Read-Your-Own-Writes").**
    * *Answer:* In Primary-Replica architectures, replication from primary to replicas is asynchronous to keep write latency low. If a user updates their profile and immediately refreshes the page, the load balancer may route the read query to a replica that is 500ms behind, displaying old data.
    * *Solutions:*
      1. Route reads for the specific user to the Primary database for 5–10 seconds following any write action.
      2. Track replication LSN (Log Sequence Number) or timestamp in a cookie; only query replicas that have caught up to that LSN.
      3. Read critical user profile views directly from the Primary or an in-memory cache.

---

### Implementation Level
11. **Design a Short URL Generator (TinyURL / Bitly). Walk through the schema, hashing, and collision strategy.**
    * *Answer:*
      * *Requirements:* Generate a 7-character short URL from a long URL. Scale: 100M URLs/month, 100:1 Read-to-Write ratio.
      * *Base62 Encoding:* $62^7 \approx 3.5 \text{ trillion}$ unique combinations (using `[a-z, A-Z, 0-9]`).
      * *ID Generation:* Never hash `MD5(longUrl)` (requires collision resolution and truncating). Instead, use a distributed unique 64-bit ID generator (Twitter Snowflake or pre-allocated Redis key ranges) to generate an integer ID (e.g., `125193`), then convert that integer to Base62: `base62(125193) -> "dZ3"`.
      * *Schema:* `(id BIGINT PK, short_code VARCHAR(7) UNIQUE, long_url TEXT, created_at TIMESTAMPTZ)`.
      * *Caching:* Cache top 20% most popular short codes in Redis using LRU eviction.

12. **How do you design a scalable Notification Service handling Push, Email, and SMS?**
    * *Answer:*
      * *Architecture:*
        1. API Gateway accepts notification requests with an idempotency key.
        2. Validates user preferences and notification settings.
        3. Pushes notification events to Apache Kafka partitioned by `user_id`.
        4. Dedicated worker pools consume from Kafka:
           - Push Worker Pool -> Firebase Cloud Messaging (FCM) / Apple Push (APNs).
           - SMS Worker Pool -> Twilio / Sinch (with rate limiting).
           - Email Worker Pool -> AWS SES / SendGrid.
        5. Failed sends are routed to a Dead Letter Queue (DLQ) with exponential backoff retries.

13. **How do you design a Distributed Unique ID Generator (Snowflake Algorithm)?**
    * *Answer:* A 64-bit ID composed of:
      * `1 bit`: Unused sign bit (always 0).
      * `41 bits`: Epoch timestamp in milliseconds (gives $\approx 69$ years of IDs).
      * `10 bits`: Machine / Node ID (supports 1,024 unique physical worker instances).
      * `12 bits`: Sequence number (generates up to 4,096 IDs per millisecond per node).
      * *Total Capacity:* $1024 \times 4096 = 4.19 \text{ million IDs per second}$, globally ordered by time without coordinating through a central database.

14. **How do you implement an API Rate Limiter using the Token Bucket Algorithm?**
    * *Answer:* Each user has a "bucket" with a maximum capacity of $B$ tokens. Tokens refill continuously at a rate of $R$ tokens per second. When a request arrives, if tokens $\ge 1$, decrement 1 token and allow request. If tokens $< 1$, reject with HTTP 429. In distributed systems, compute available tokens lazily on request arrival using timestamp delta to avoid running background cron timers for millions of users.

15. **How do you architect a Video Streaming Platform (YouTube / Netflix) storage and delivery pipeline?**
    * *Answer:*
      1. User uploads raw video to S3 via pre-signed multipart upload.
      2. S3 triggers an event to a Message Queue.
      3. Transcoding workers (using FFmpeg) encode the video into multiple resolutions (1080p, 720p, 480p) and format into adaptive bitrate streaming protocols (HLS / DASH) with 5-second `.ts` chunks.
      4. Chunk files and master `.m3u8` playlists are stored in an S3 bucket and distributed globally via a multi-CDN network.
      5. Video player dynamically adapts video quality based on current user network bandwidth.

---

### Debugging Level
16. **Your distributed cache cluster is showing a 99% hit rate, but the database CPU is pinned at 100% and timing out. What is happening?**
    * *Answer:* This is a classic **Hotspot / Heavy Hitter Key** failure or a **Cache Stampede on a single critical key**. While overall hit rate is 99%, an un-cached or frequently expiring record (e.g., flash sale inventory or breaking news item) is receiving 50,000 requests/sec. Every millisecond it is un-cached, thousands of queries hit the database concurrently. Solution: Implement localized in-memory caching on application nodes (L1 cache) with a 2-second TTL for hot keys, paired with mutex locking on cache misses.

17. **A message queue has 10 million unprocessed messages and lag is growing by 5,000 messages/min. How do you recover?**
    * *Answer:*
      1. Verify consumers are healthy and not crashing/restarting in an error loop.
      2. Inspect consumer bottleneck: Is it CPU, memory, or downstream database write locks?
      3. Increase consumer concurrency: Scale up consumer worker pods.
      4. If using Kafka, you can only scale consumers up to the number of **partitions**. If partitions = 10, 20 consumers cannot run in parallel. Temporarily increase topic partitions or have consumers batch-forward messages to an internal worker thread pool.
      5. Temporarily throttle or shed non-critical upstream write traffic.

18. **During a datacenter network partition, half of your microservices report errors while the other half succeed, resulting in inconsistent inventory and balances. What architectural flaw allowed this?**
    * *Answer:* The system lacked a unified distributed consensus protocol and attempted multi-master writes without distributed transaction coordination (Sagas or 2PC). Downstream services made local commits assuming other services succeeded. Solution: Implement an orchestrated Saga pattern with idempotent compensating transactions and persistent outbox event publishing (`Transactional Outbox Pattern`).

19. **Why did a database failover to a read replica cause data loss even though the replica was marked "In-Sync"?**
    * *Answer:* The database replication was configured for **Asynchronous Replication**. In async mode, the primary acknowledges commits to the client before WAL records are physically transmitted and applied on replicas. When the primary suffered a hardware crash, inflight WAL entries in the primary's memory buffer were permanently lost, causing the promoted replica to be several hundred transactions behind. For zero data loss, **Synchronous Replication** (semi-sync with at least 1 synchronous standby) is required.

20. **Why did adding 10 more web instances cause the entire application to slow down rather than speed up?**
    * *Answer:* The backend bottleneck was not application server CPU, but the **database connection pool**. Each web instance spawned an internal connection pool of 20 connections ($10 \times 20 = 200$ new database connections). PostgreSQL allocated 10MB RAM per connection and saturated CPU cores in context-switching and lock contention across competing transactions. Solution: Implement centralized connection pooling (PgBouncer) between app instances and the database.

---

### Scenario-Based Questions
21. **Scenario:** Design an E-Commerce Flash Sale System (e.g., selling 500 gaming consoles to 500,000 concurrent users).
    * *Answer:*
      * *Edge Layer:* Aggressively cache static product pages on CDN.
      * *Virtual Waiting Room:* Route incoming users through a queue (Cloudflare Waiting Room or Redis queue) to limit traffic hitting the checkout service to 5,000 requests/min.
      * *Stock Reservation:* Store stock count in Redis. Use an atomic Lua script to decrement inventory:
        ```lua
        if redis.call('get', KEYS[1]) > '0' then
          return redis.call('decr', KEYS[1])
        else
          return -1
        end
        ```
      * *Asynchronous Processing:* Successful reservations generate a token with a 10-minute expiry and push an order creation task to Kafka. If the user fails to complete payment within 10 minutes, the token expires and stock is incremented back in Redis.

22. **Scenario:** Design a Real-Time Collaborative Document Editing Platform (like Google Docs / Figma).
    * *Answer:*
      * *Conflict Resolution:* Traditional database locks do not work for real-time keystroke collaboration. Use **Operational Transformation (OT)** (centralized server reconciles operation offsets) or **Conflict-Free Replicated Data Types (CRDTs)** (state-based or operation-based data structures that mathematically converge to identical state without coordination).
      * *Communication:* WebSocket connections maintained via sticky sessions or an Anycast WebSocket Gateway backed by a Redis Pub/Sub cluster.
      * *Persistence:* Periodically snapshot document state to S3/PostgreSQL every 10 seconds, appending real-time operation deltas to a fast append-only log.

23. **Scenario:** Design a Proximity Service (like Yelp or Nearby Drivers in Uber).
    * *Answer:*
      * *Geospatial Indexing:* Traditional latitude/longitude bounding box queries (`WHERE lat BETWEEN ... AND lon BETWEEN ...`) require expensive 2D table scans.
      * *Solution:* Spatial indexing using **Geohashes** (hierarchical base32 spatial strings), **Google S2 Geometry** (hierarchical Hilbert curve cells), or **Uber H3** (hexagonal hierarchical spatial index).
      * Fast Redis Geospatial commands (`GEOADD`, `GEORADIUS`) map driver locations to cell buckets in memory. Driver location pings update Redis every 4 seconds with a 10-second TTL.

24. **Scenario:** Design a Web Crawler (like Googlebot) to crawl 1 billion web pages.
    * *Answer:*
      * *Components:*
        1. *URL Frontier:* Priority queue managing pending URLs, enforcing domain politeness (delay between requests to same host to avoid DoS).
        2. *DNS Resolver:* Custom cached DNS resolver to avoid bottlenecking public DNS servers.
        3. *Fetcher & Parser:* Async worker pool streaming HTML content, parsing text and extracting outgoing `<a href>` links.
        4. *Duplicate Eliminator:* Use **Bloom Filters** in memory to quickly check if a URL has already been visited ($O(1)$ lookup with 0.1% false positive rate).
        5. *Storage:* Store raw HTML in Amazon S3/HDFS, metadata in Cassandra/BigTable.

25. **Scenario:** Design a Distributed Logging & Metrics Aggregation System (like Datadog / ELK).
    * *Answer:*
      * *Agent Layer:* Lightweight daemon (Vector / FluentBit) running on every node, tailing log files and buffering entries.
      * *Ingestion Pipeline:* Agents stream logs via gRPC to an Apache Kafka cluster partitioned by application ID.
      * *Processing:* Stream processing workers (Apache Flink / Spark Streaming) parse, enrich, and filter logs.
      * *Storage:*
        - Logs (unstructured search): OpenSearch / Elasticsearch with time-based indices.
        - Metrics (time-series counters): Prometheus / VictoriaMetrics / ClickHouse.
      * *Data Lifecycle:* Hot data stored on fast NVMe for 7 days; rolled over to compressed S3 cold storage for 90 days.

---

### Advanced Architectural Questions
26. **What is the Transactional Outbox Pattern and why is it essential in microservices?**
    * *Answer:* In a microservice, updating a database and publishing an event to a message queue are two separate operations. If the database commit succeeds but the message queue broker is unreachable, data becomes permanently desynchronized.
    * *Outbox Pattern Solution:*
      1. Write business data AND the outgoing event into an `outbox` table inside the **same local ACID database transaction**.
      2. A separate background process (or CDC tool like Debezium reading the database WAL log) reads the `outbox` table and safely publishes events to Kafka.
      3. Guarantees **At-Least-Once event publishing** without dual-write race conditions.

27. **Explain the Raft and Paxos Distributed Consensus Algorithms.**
    * *Answer:* Consensus algorithms allow a collection of machines to agree on values or state transitions even if some nodes fail.
    * *Raft Mechanics:*
      - *Leader Election:* Nodes start as Followers. If a follower hears no heartbeat, it becomes a Candidate and requests votes. Once elected, the Leader manages all client writes.
      - *Log Replication:* The Leader appends client commands to its log and sends `AppendEntries` RPCs to followers. Once a majority ($N/2 + 1$) quorum acknowledge, the entry is committed and applied to the state machine.

28. **What is Database Sharding Re-balancing and how does it work with zero downtime?**
    * *Answer:* When existing shards run out of disk or throughput, you must increase shards (e.g., from 4 to 8 shards).
    * *Zero-Downtime Migration Process:*
      1. Deploy new shard nodes.
      2. Configure Dual-Writing: Application writes to both old shards and new shards, with reads still directed to old shards.
      3. Backfill: A background job migrates historical data from old shards to new shards.
      4. Verification: Run continuous diff checks between old and new shards until replication lag is 0.
      5. Switch Reads: Route reads to new shards.
      6. Decommission dual-writing and drop old shard tables.

29. **Explain the difference between At-Least-Once, At-Most-Once, and Exactly-Once message delivery semantics.**
    * *Answer:*
      * *At-Most-Once:* Messages may be lost, but are never duplicated. Consumer acknowledges message *before* processing. If worker crashes midway, message is lost.
      * *At-Least-Once:* Messages are never lost, but may be duplicated. Consumer acknowledges message *after* processing. If network ACK fails, broker re-delivers the message. (Requires idempotent consumer).
      * *Exactly-Once:* Message is processed effectively once. Extremely difficult in distributed systems; requires transactional producers, atomic consumer offset commits, and deduplication IDs across consumer persistence stores.

30. **What is Shuffle Sharding and how does AWS use it to prevent multi-tenant cascading failures?**
    * *Answer:* In standard sharding, 100 customers might share Shard 1. If Customer X generates a toxic payload that crashes Shard 1, all 100 customers go down. In **Shuffle Sharding**, each customer is assigned a unique random *subset* (combination) of nodes (e.g., each customer gets 4 nodes out of 100 total nodes). The mathematical combination $\binom{100}{4} = 3,921,225$ unique shards. Even if Customer X's toxic traffic crashes their 4 nodes, no other customer shares the exact same 4 nodes, ensuring that 99.9% of all other customers experience zero downtime.

---

## 16. Coding Questions

### Coding Challenge 1: In-Memory LRU (Least Recently Used) Cache

```typescript
class DNode<K, V> {
  key: K;
  value: V;
  prev: DNode<K, V> | null = null;
  next: DNode<K, V> | null = null;

  constructor(key: K, value: V) {
    this.key = key;
    this.value = value;
  }
}

export class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, DNode<K, V>> = new Map();
  private head: DNode<K, V>;
  private tail: DNode<K, V>;

  constructor(capacity: number) {
    this.capacity = capacity;
    // Dummy sentinel nodes to eliminate boundary null checks
    this.head = new DNode<K, V>(null as any, null as any);
    this.tail = new DNode<K, V>(null as any, null as any);
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) return undefined;

    // Move to front (most recently used)
    this.removeNode(node);
    this.addToFront(node);
    return node.value;
  }

  put(key: K, value: V): void {
    if (this.map.has(key)) {
      const existing = this.map.get(key)!;
      existing.value = value;
      this.removeNode(existing);
      this.addToFront(existing);
      return;
    }

    if (this.map.size >= this.capacity) {
      // Evict least recently used (node before tail)
      const lruNode = this.tail.prev!;
      this.removeNode(lruNode);
      this.map.delete(lruNode.key);
    }

    const newNode = new DNode(key, value);
    this.addToFront(newNode);
    this.map.set(key, newNode);
  }

  private removeNode(node: DNode<K, V>): void {
    node.prev!.next = node.next;
    node.next!.prev = node.prev;
  }

  private addToFront(node: DNode<K, V>): void {
    node.next = this.head.next;
    node.prev = this.head;
    this.head.next!.prev = node;
    this.head.next = node;
  }
}
```

### Coding Challenge 2: Distributed Lock Pattern via Redis (Redlock Concept)

```typescript
import { createClient } from "redis";
import crypto from "crypto";

export class RedisDistributedLock {
  private redis: ReturnType<typeof createClient>;

  constructor(redisClient: ReturnType<typeof createClient>) {
    this.redis = redisClient;
  }

  /**
   * Acquires a distributed lock using atomic SET NX PX
   */
  async acquireLock(
    lockKey: string,
    ttlMs: number
  ): Promise<{ acquired: boolean; lockIdentifier: string }> {
    const lockIdentifier = crypto.randomUUID();

    // SET key value NX PX ttl
    // NX: Set only if key does not already exist
    // PX: Set expiration time in milliseconds
    const result = await this.redis.set(lockKey, lockIdentifier, {
      NX: true,
      PX: ttlMs,
    });

    return {
      acquired: result === "OK",
      lockIdentifier,
    };
  }

  /**
   * Safely releases lock ONLY if the held identifier matches.
   * Uses Lua script to guarantee atomicity and prevent releasing another worker's lock.
   */
  async releaseLock(lockKey: string, lockIdentifier: string): Promise<boolean> {
    const luaScript = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    const result = await this.redis.eval(luaScript, {
      keys: [lockKey],
      arguments: [lockIdentifier],
    });

    return result === 1;
  }
}
```

---

## 17. Common Interview Traps

* **The Trap:** The interviewer asks: *"In our system design, can we just use WebSockets for all client-server communication because WebSockets are bidirectional and faster than HTTP?"*
  * **How candidates fail:** Saying "Yes, WebSockets are faster and eliminate HTTP overhead."
  * **The Winning Answer:** WebSockets are stateful, persistent TCP connections. While ideal for real-time applications (chat, live collaborative whiteboards, stock tickers), using WebSockets for standard CRUD operations introduces severe scalability bottlenecks:
    1. They prevent standard HTTP caching across CDN edge networks and browser caches.
    2. Load balancing is difficult because connections are sticky and long-lived.
    3. Hundreds of thousands of idle open sockets consume server file descriptors and memory.
    4. HTTP/2 and HTTP/3 multiplexing already provides fast, low-overhead REST/GraphQL communication without connection stickiness.
* **The Trap:** *"How do we guarantee exactly-once processing in our message queue consumer?"*
  * **How candidates fail:** Claiming that configuring Kafka with `enable.idempotence=true` solves exactly-once processing across the entire system.
  * **The Winning Answer:** True end-to-end exactly-once processing across the entire network boundary is impossible in distributed systems (Two Generals' Problem). You achieve **effective exactly-once processing** by combining **At-Least-Once message delivery** with **Strict Consumer Idempotency** (using unique deduplication keys stored in database transactions).

---

## 18. Revision Summary

```
+-----------------------------------------------------------------------------------+
|                     System Design High-Yield Revision Matrix                      |
+-----------------------------------------------------------------------------------+
| 6-Step Framework:    Scope -> Scale/Estimates -> High-Level -> Deep-Dive -> Edge  |
| CAP & PACELC:        Partition -> Pick Availability or Consistency; Else Latency  |
| Caching Rules:       Cache-Aside (update DB then delete cache); Eviction via LRU  |
| Load Balancing:      L4 (TCP ports, fast) vs L7 (HTTP paths/headers, intelligent) |
| High Scale Feeds:    Fan-out on Write for normal users; Fan-out on Read for VIPs  |
| Distributed Sagas:   Choreography/Orchestration with compensating transactions    |
| Outbox Pattern:      Write event to DB outbox table within local transaction      |
+-----------------------------------------------------------------------------------+
```

---

## 19. Quick Reference

* **Availability Math:** 99.9% ("Three Nines") = 8.7 hrs downtime/yr; 99.99% ("Four Nines") = 52 mins downtime/yr.
* **Snowflake ID:** 64-bit distributed unique ID (Time + Machine ID + Sequence).
* **Token Bucket:** Rate limiting algorithm permitting bursty traffic while enforcing average rate.
* **Bloom Filter:** Space-efficient probabilistic data structure for checking set membership (0 false negatives).
* **Consistent Hashing:** Remaps only $1/N$ keys upon node addition/removal using a circular 32-bit ring.
* **Transactional Outbox:** Ensures reliable at-least-once message publishing without distributed dual-write bugs.
