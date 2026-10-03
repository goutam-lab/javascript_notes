# System Design Numbers & Patterns Cheatsheet & Deep Dive

---

## 1. What is it?

The System Design Numbers and Patterns Cheatsheet is an operational reference guide, capacity estimation manual, and architectural blueprint matrix for distributed systems engineering. It brings together the canonical **Latency Numbers Every Programmer Should Know** (Jeff Dean's latency hierarchy), **Back-of-the-Envelope Estimation Heuristics** (QPS, bandwidth, and 5-year storage capacity calculations), and a condensed lookup table of core distributed systems patterns (**Consistent Hashing**, **Cache-Aside**, **Sagas**, **Transactional Outbox**, and **Rate Limiting Algorithms**).

```
+-----------------------------------------------------------------------------------+
|                     System Design Numbers & Patterns Blueprint                    |
+-----------------------------------------------------------------------------------+
| Hardware Latencies:   L1 Cache (1ns) -> RAM (100ns) -> SSD (16μs) -> WAN (150ms)   |
| Capacity Rules:       1M req/day ≈ 12 QPS (Avg) / 24-30 QPS (Peak)                 |
| Powers of Two:        2^10 = 1 KB, 2^20 = 1 MB, 2^30 = 1 GB, 2^40 = 1 TB, 2^50 = 1 PB|
| Storage Formulas:     Storage/Day = Daily Writes × Avg Size × Replication Factor   |
| Core Patterns:        Consistent Hashing (V-Nodes), Cache-Aside, Token Bucket, Saga|
| Consistency Laws:     CAP Theorem (Pick C or A in Partition), PACELC Theorem       |
+-----------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

In high-stakes system design rounds at Tier-1 companies (Google, Meta, Amazon, Uber):
1. **Uncalibrated Architecture Choices:** Proposing a multi-region distributed Cassandra cluster for an app with 5 writes per second reveals a severe lack of engineering calibration. Back-of-the-envelope calculations determine whether a system needs a simple single-node PostgreSQL instance or a distributed streaming cluster.
2. **Intuitive Hardware Limits:** Designing sub-50ms user-facing SLAs requires knowing that a cross-continental network round-trip alone takes ~150ms. Latency numbers dictate physical limits.
3. **Pattern Retrieval Speed:** System design rounds last 45 minutes; engineers must rapidly identify and apply appropriate architectural patterns (e.g., choosing between Fan-out on Write vs Fan-out on Read) without hesitation.

---

## 3. Mental Model

To master system design estimations, memorize the **Scale Multipliers and Time Converters**:

```
[ THE SACRED TIME CONVERSION CONSTANT ]
  1 Day = 24 hours × 60 mins × 60 secs = 86,400 seconds
  For easy interview mental math: ROUND TO 100,000 SECONDS!

[ QPS CALCULATION SHORTCUT ]
  - 1 Million requests per day:
      1,000,000 / 100,000 = 10 requests / second (Actual: 11.6 QPS)
  - 100 Million requests per day:
      100,000,000 / 100,000 = 1,000 QPS (Average)
  - Peak Traffic Heuristic: Peak QPS ≈ 2 × to 3 × Average QPS
      100M req/day -> Peak QPS ≈ 2,500 to 3,000 QPS
```

---

## 4. Basic Example

### Latency Numbers Every Programmer Should Know (Visual Comparison)

| Operation | Real Time | Scaled Equivalent (Human Scale: 1ns = 1 sec) |
| :--- | :--- | :--- |
| **L1 CPU Cache Reference** | 0.5 – 1 ns | 1 second |
| **Branch Mispredict** | 3 – 5 ns | 5 seconds |
| **L2 CPU Cache Reference** | 7 ns | 7 seconds |
| **Mutex Lock / Unlock** | 25 ns | 25 seconds |
| **Main Memory (RAM) Reference** | 100 ns | 1.7 minutes |
| **Compress 1KB with Snappy** | 2,000 ns (2 μs) | 33 minutes |
| **Send 2KB over 1 Gbps Network** | 20,000 ns (20 μs) | 5.5 hours |
| **SSD Random Read (NVMe / Flash)**| 16,000 – 100,000 ns (16–100 μs)| 4.5 – 28 hours |
| **Read 1MB sequentially from Memory**| 3,000 ns (3 μs) | 50 minutes |
| **Read 1MB sequentially from SSD** | 49,000 ns (49 μs) | 13.6 hours |
| **Datacenter Network Round-Trip** | 500,000 ns (0.5 ms) | 5.8 days |
| **Read 1MB sequentially from HDD** | 825,000 ns (0.8 ms) | 9.5 days |
| **HDD Disk Seek (Rotational)** | 10,000,000 ns (10 ms) | 4 months |
| **Trans-Atlantic Packet (NY to London)**| 150,000,000 ns (150 ms) | **4.7 years** |

*Key Takeaway:* Accessing RAM is **1,000x faster than reading an SSD**, and **1,500,000x faster than a cross-continental network round-trip**. Keep hot data in memory!

---

## 5. Real Example

### Complete Back-of-the-Envelope Calculation: Photo Sharing Platform (Instagram Scale)

```
[ PROBLEM SPECIFICATION ]
  - Daily Active Users (DAU): 500 Million
  - Photos uploaded per day: 10% of users upload 1 photo = 50 Million photos / day
  - Photos viewed per day: Average user views 20 photos = 10 Billion views / day
  - Average photo size: 2 MB
  - Average metadata size: 500 bytes per record

[ STEP 1: QPS CALCULATIONS ]
  - Write QPS (Uploads):
      50,000,000 / 100,000 = 500 writes / sec
      Peak Write QPS (2.5x) = 1,250 writes / sec
  - Read QPS (Views):
      10,000,000,000 / 100,000 = 100,000 reads / sec
      Peak Read QPS (2x) = 200,000 reads / sec
  - Read-to-Write Ratio: 200 : 1 (Heavily Read-Dominant System!)

[ STEP 2: STORAGE CAPACITY ESTIMATIONS (5 YEARS) ]
  - Photo Binary Storage / Day:
      50M photos × 2 MB = 100 TB / day
  - Photo Binary Storage / Year:
      100 TB × 365 ≈ 36.5 PB / year
  - Photo Binary Storage / 5 Years:
      36.5 PB × 5 ≈ 182.5 PB (Raw storage)
      With 3x Cloud Replication: ~547.5 PB total storage needed over 5 years.
  - Metadata Storage / Day:
      50M records × 500 bytes = 25 GB / day
  - Metadata Storage / 5 Years:
      25 GB × 365 × 5 ≈ 45.6 TB (Easily managed in sharded PostgreSQL or Cassandra).

[ STEP 3: NETWORK BANDWIDTH ESTIMATIONS ]
  - Ingress Bandwidth (Incoming uploads):
      500 writes/sec × 2 MB = 1 GB / sec (8 Gbps ingress)
  - Egress Bandwidth (Outgoing views):
      100,000 reads/sec × 2 MB = 200 GB / sec (1.6 Tbps egress -> Heavy CDN Caching Required!)
```

---

## 6. Under the Hood

### Consistent Hashing Ring with Virtual Nodes (V-Nodes)

```
                [ Physical Node A: Tokens 10, 110, 210 ]
                         /                   \
                        /                     \
[ Node C: Tokens 50, 150, 250 ] -------- [ Node B: Tokens 90, 190, 290 ]
```

1. **Hash Ring Range:** Maps both servers and data keys to a 32-bit integer space ($0$ to $2^{32}-1$).
2. **Key Assignment:** A data key is hashed: `hash(key)`. The key is assigned to the first server encountered moving **clockwise** around the ring.
3. **Node Failure / Addition:** When a physical server fails or is added, **only $1/N$ fraction of keys are remapped** (unlike modulo hashing where 100% of keys are re-hashed).
4. **Virtual Nodes (V-Nodes):** Each physical machine registers 100–250 virtual tokens randomly across the ring. This guarantees uniform statistical load distribution and prevents "hot spots".

---

## 7. Important Rules

1. **The Rule of 80/20 Caching (Pareto Principle):** 20% of content generates 80% of read traffic. Size your Redis in-memory cache to hold **20% of daily active read data**.
2. **The Rule of Stateless Compute:** Never store persistent state, session cookies, or user files on local server instances. Keep application servers completely stateless to enable zero-latency autoscaling behind load balancers.
3. **The Rule of Cache-Aside Update Order:** When updating data: **Update the database first, then delete (invalidate) the cache key.** Never update the cache before the DB, and never write the new value directly into the cache (avoids race conditions).
4. **The Rule of Idempotency on Mutations:** Any network call can time out or retry. Every state-changing API endpoint must require an `Idempotency-Key` to guarantee that duplicate requests produce the exact same outcome.

---

## 8. Common Mistakes

### Mistake 1: Confusing Megabytes (MB) and Megabits (Mbps)
In network calculations, bandwidth is measured in **bits** per second (1 Gbps = 1,000 Megabits/sec), whereas storage is measured in **bytes** (1 GB = 8 Gigabits). Confusing the two causes an 8x calculation error in bandwidth estimations!

### Mistake 2: Missing Peak Traffic Multipliers
Calculating infrastructure capacity based strictly on average daily traffic. A system handling 1,000 QPS on average might experience 15,000 QPS during a Super Bowl ad or flash sale. Always calculate for **Peak QPS (2x to 5x average)**.

### Mistake 3: Ignoring Database Replication Lag in Read Replicas
Routing user profile reads to asynchronous read replicas immediately after a write. The user saves changes, page reloads, and the user sees their old profile because the replica is 500ms behind. Always route "Read-Your-Own-Writes" to the Primary DB for 5–10 seconds.

---

## 9. Best Practices

1. **Powers of 2 Mental Conversion Table:**
   - $2^{10} \approx 1,000$ (1 Thousand = 1 KB)
   - $2^{20} \approx 1,000,000$ (1 Million = 1 MB)
   - $2^{30} \approx 1,000,000,000$ (1 Billion = 1 GB)
   - $2^{40} \approx 1,000,000,000,000$ (1 Trillion = 1 TB)
   - $2^{50} \approx 1,000,000,000,000,000$ (1 Quadrillion = 1 PB)
2. **Availability SLA Target Translation:**
   - **99% ("Two Nines"):** 3.65 days downtime / year
   - **99.9% ("Three Nines"):** 8.76 hours downtime / year
   - **99.99% ("Four Nines"):** 52.6 minutes downtime / year
   - **99.999% ("Five Nines"):** 5.26 minutes downtime / year
3. **Use the Transactional Outbox Pattern for Distributed Events:** Prevent dual-write inconsistencies between PostgreSQL and Kafka by writing outgoing events to an `outbox` table within the same local database transaction.

---

## 10. Performance Considerations

* **Cache Stampede (Thundering Herd) Defense:** When an expensive cache key expires, thousands of concurrent requests miss simultaneously, hitting the primary database.
  * *Fix:* Use **Mutex Locking** (only one worker queries DB to warm cache; others wait) or **Probabilistic Early Expiration (XFetch algorithm)**.
* **TCP Connection Pool Overhead:** Opening a TCP connection requires a 3-way handshake + TLS negotiation (~100ms). Multiplex thousands of HTTP requests over pre-warmed persistent connection pools using `keepAlive: true` and PgBouncer.

---

## 11. Security Considerations

* **Rate Limiting at the Edge:** Filter Layer 7 volumetric DDoS attacks at the Cloudflare / AWS WAF edge layer before requests consume backend CPU cycles.
* **Mutual TLS (mTLS) in Service Mesh:** Encrypt and authenticate all internal microservice-to-microservice traffic using private X.509 certificates managed by Istio / Envoy.

---

## 12. Alternatives: Core System Design Patterns Matrix

| Pattern | Category | How it Works | Best Use Case |
| :--- | :--- | :--- | :--- |
| **Cache-Aside** | Caching | App reads cache; on miss, reads DB and writes to cache | Read-heavy general workloads |
| **Write-Through** | Caching | App writes to cache; cache synchronously writes to DB | High data consistency requirements |
| **Write-Behind** | Caching | App writes to cache; cache asynchronously batches writes to DB | Ultra-high write speeds (e.g. logging) |
| **Consistent Hashing** | Partitioning | Hashes nodes & keys to 32-bit ring with V-nodes; remaps $1/N$ | Distributed caching & database sharding |
| **Saga Pattern** | Transactions | Decomposes distributed transaction into local steps + compensations | Cross-microservice business workflows |
| **Token Bucket** | Rate Limiting | Refills tokens at constant rate; permits bursts up to capacity | User API rate limiting |
| **Leaky Bucket** | Rate Limiting | Requests enter queue; leak out at fixed smooth rate | Traffic shaping; network egress |
| **Sliding Window Log**| Rate Limiting | Stores timestamps in Redis Sorted Set; counts active window | Exact rate limiting without edge spikes |

---

## 13. Trade-offs

* **CAP Theorem (Consistency vs Availability):** During a network partition, you must choose between:
  - *CP (Consistency):* Reject writes to avoid split-brain data divergence (Banking, Ledgers).
  - *AP (Availability):* Accept writes on all nodes, tolerating stale reads and eventual consistency (Social media feeds, shopping carts).
* **Fan-Out on Write vs Fan-Out on Read:**
  - *Fan-out on Write:* Pre-computes timelines into Redis on tweet post ($O(1)$ reads, but fails for celebrities with 50M followers).
  - *Fan-out on Read:* Merges feeds dynamically on user app open ($O(1)$ writes, but slow $O(K \log K)$ reads).

---

## 14. Real-World Usage

* **Netflix Video Ingestion:** Chunks 4K video files into 5-second segments, distributing encoding tasks across thousands of AWS EC2 spot instances via SQS queues.
* **Uber Real-Time Dispatch:** Uses Uber H3 (Hexagonal Hierarchical Spatial Index) mapped to Redis in-memory clusters to locate nearest drivers in under 20ms.

---

## 15. Placement Interview Questions

### Basic Level
1. **How many seconds are in a day, and how do you use this for mental math in interviews?**
   * *Answer:* Exactly 86,400 seconds. For interview mental estimation, round up to **100,000 seconds**. If a system receives 10 million requests per day: $10,000,000 / 100,000 = 100\text{ requests per second (QPS)}$.

2. **What is the difference between Throughput and Latency?**
   * *Answer:* Latency is the **time taken to process a single request** (measured in milliseconds: p50, p95, p99). Throughput is the **number of requests the system can process per unit of time** (measured in requests per second / QPS or megabytes per second).

3. **What is the difference between p95 and p99 latency?**
   * *Answer:* Average latency hides outliers. Percentiles rank all response times from fastest to slowest:
     - `p95 = 50ms`: 95% of all requests completed in 50ms or less (5% took longer).
     - `p99 = 250ms`: 99% of requests completed in 250ms or less (1% of users experienced the worst-case tail latency).

4. **What is the difference between Vertical Scaling and Horizontal Scaling?**
   * *Answer:* Vertical scaling (Scale-up) increases the capacity of an existing machine (adding more CPU cores or RAM). It has a hard physical ceiling and creates a single point of failure. Horizontal scaling (Scale-out) adds more independent machines to a resource pool behind a load balancer, providing unlimited scaling potential and high availability.

5. **What is the difference between Cache-Aside and Write-Through caching?**
   * *Answer:*
     - *Cache-Aside (Lazy Loading):* The application is responsible for querying the cache. If missed, it queries the database, writes the result to the cache, and returns. Caches only actively requested data.
     - *Write-Through:* The application writes data directly to the cache, and the cache synchronously writes the data to the database before acknowledging the write. Guarantees consistency, but introduces write latency.

---

### Conceptual Level
6. **Explain the CAP Theorem and why PACELC is a more realistic model for modern distributed systems.**
   * *Answer:* CAP states that in the event of a network Partition (P), a distributed system must choose between Consistency (C) and Availability (A).
   * *PACELC extends this:*
     $$\text{If } \mathbf{P} \text{ (Partition) } \rightarrow \text{Choose } \mathbf{A} \text{ (Availability) or } \mathbf{C} \text{ (Consistency)};$$
     $$\mathbf{E} \text{ (Else / Normal) } \rightarrow \text{Choose } \mathbf{L} \text{ (Latency) or } \mathbf{C} \text{ (Consistency)}.$$
     PACELC acknowledges that even when no partition exists, a distributed system must make a trade-off between **Latency** (returning immediately from a local replica) and **Consistency** (waiting for synchronous cross-datacenter replication).

7. **How does Consistent Hashing work and why is it preferred over `hash(key) % N`?**
   * *Answer:* In modulo hashing (`hash % N`), adding or removing 1 server changes the divisor ($N \to N+1$). Almost 100% of all keys are remapped, causing a catastrophic cache stampede that overwhelms the database.
   * *Consistent Hashing:* Maps servers and keys to positions on an abstract 32-bit circular ring. A key is assigned to the first server encountered moving clockwise. Adding or removing a server remaps only **$1/N$ fraction of keys**, leaving the remaining data untouched. Virtual nodes ensure uniform statistical key distribution.

8. **Explain the difference between Token Bucket and Leaky Bucket rate limiting algorithms.**
   * *Answer:*
     - *Token Bucket:* Tokens are added to a bucket of capacity $B$ at a constant rate $R$. Each incoming request consumes 1 token. If tokens $> 0$, request is allowed; else, rejected. **Permits bursts of traffic** up to bucket capacity $B$.
     - *Leaky Bucket:* Requests enter a FIFO queue of capacity $B$ and leak out at a **constant, smooth rate $R$**. If the queue overflows, incoming requests are dropped. Completely flattens traffic bursts into a uniform output stream.

9. **Explain the Transactional Outbox Pattern.**
   * *Answer:* In microservices, updating a database and publishing an event to Kafka are two separate network operations. If the database commit succeeds but the Kafka publish fails, data becomes permanently inconsistent.
   * *Outbox Pattern:*
     1. Insert domain data AND the outgoing event into an `outbox` table inside the **same local ACID database transaction**.
     2. A background process (or Debezium CDC reading the database WAL log) reads the `outbox` table and safely publishes events to Kafka.
     3. Guarantees **At-Least-Once event publishing** without dual-write race conditions.

10. **Explain the Saga Pattern: Choreography vs Orchestration.**
    * *Answer:* Used to manage distributed transactions across microservices via a sequence of local transactions:
      - *Choreography:* Decentralized. Each service executes its local transaction and publishes an event that triggers the next service. Simple, but difficult to track dependencies as services multiply.
      - *Orchestration:* Centralized. A dedicated orchestrator state machine directs participant services on which local transaction to execute next, and coordinates **compensating transactions** in reverse order if a step fails.

---

### Implementation Level
11. **Walk through back-of-the-envelope capacity estimation for a URL Shortener (TinyURL).**
    * *Answer:*
      - *Traffic:* 100 Million new URLs created / month. Read-to-write ratio = 100:1.
      - *Write QPS:* $100\text{M} / (30 \times 100,000) \approx 33\text{ writes/sec}$. Peak $\approx 100\text{ writes/sec}$.
      - *Read QPS:* $33 \times 100 \approx 3,300\text{ reads/sec}$. Peak $\approx 10,000\text{ reads/sec}$.
      - *Storage / 5 Years:* 100M URLs $\times$ 12 months $\times$ 5 years = 6 Billion URLs.
        Each record: `(id: 8B, short_hash: 7B, original_url: 500B)` $\approx$ 515 bytes.
        Total storage: 6 Billion $\times$ 515 bytes $\approx$ **3.1 TB over 5 years** (Easily fits on a single NVMe SSD with replica).
      - *Base62 Encoding:* $62^7 \approx 3.5\text{ Trillion}$ combinations (plenty for 6 Billion URLs).

12. **Implement a Token Bucket Rate Limiter in TypeScript.**
    * *Answer:*
    ```typescript
    export class TokenBucket {
      private tokens: number;
      private lastRefill: number;

      constructor(
        private capacity: number,
        private refillRatePerSecond: number
      ) {
        this.tokens = capacity;
        this.lastRefill = Date.now();
      }

      allowRequest(tokensRequired = 1): boolean {
        this.refill();

        if (this.tokens >= tokensRequired) {
          this.tokens -= tokensRequired;
          return true;
        }
        return false;
      }

      private refill(): void {
        const now = Date.now();
        const deltaSeconds = (now - this.lastRefill) / 1000;
        const tokensToAdd = deltaSeconds * this.refillRatePerSecond;

        this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
        this.lastRefill = now;
      }
    }
    ```

13. **How do you size a Redis cluster for 80/20 caching of 100 Million Daily Active Users?**
    * *Answer:*
      - Total Daily Active Records: 100 Million.
      - Average user profile cache object size: 1 KB.
      - Total Daily Data Size: $100\text{M} \times 1\text{ KB} = 100\text{ GB}$.
      - 20% Pareto Cache Working Set: $100\text{ GB} \times 0.20 = \mathbf{20\text{ GB RAM}}$.
      - Adding 25% memory buffer for Redis memory overhead and hash table fragmentation: $20\text{ GB} \times 1.25 = \mathbf{25\text{ GB RAM}}$.
      - Deploy as a 3-node Redis cluster with 16GB RAM per node (gives 48GB total RAM with 1 primary + 1 replica configuration).

14. **How do you generate 64-bit unique sequential IDs in distributed systems without database locks?**
    * *Answer:* Use the **Twitter Snowflake Algorithm**:
      - 1 bit: Unused sign bit (0).
      - 41 bits: Millisecond timestamp ($\approx 69$ years).
      - 10 bits: Machine / Node ID (supports 1,024 physical worker nodes).
      - 12 bits: Sequence counter (supports 4,096 IDs per millisecond per node).
      - Total throughput: **4.19 Million globally unique IDs per second**.

15. **How do you implement a Circuit Breaker pattern state machine?**
    * *Answer:*
      - `CLOSED`: Normal operation; calls pass through. If error rate exceeds 50% over a 10s window, trip to `OPEN`.
      - `OPEN`: Fast-fail immediately; zero network calls dispatched. Serves cached fallback or error. Starts 10-second cooldown timer.
      - `HALF_OPEN`: Cooldown expires; permits 1 test request through. If successful, resets to `CLOSED`. If failed, trips back to `OPEN`.

---

### Debugging Level
16. **Why did a database crash during a celebrity user's tweet post in a Fan-Out on Write architecture?**
    * *Answer:* The celebrity had 80 million followers. When the user tweeted, the system attempted to execute 80,000,000 writes into Redis follower timeline lists simultaneously. This triggered a massive write amplification storm, saturating Redis thread pools and exhausting connection queues.
    * *Fix:* Implement a **Hybrid Model**: Fan-out on write for users with $<25,000$ followers. For celebrities ($>25,000$ followers), bypass fan-out on write; dynamically merge their tweets into follower timelines at read time.

17. **Why did a multi-region Cassandra cluster return stale data to a client who had just submitted an update?**
    * *Answer:* The read query was executed with a read consistency level of `LOCAL_ONE` on an asynchronous multi-datacenter cluster. The write had only propagated to the local primary node and had not yet replicated across WAN links to the remote datacenter.
    * *Fix:* Enforce **Strong Quorum Consistency**:
      $$R + W > N$$
      (e.g., Read Quorum + Write Quorum > Replication Factor).

18. **Why did adding 5 more database read replicas fail to reduce read query latency?**
    * *Answer:*
      1. *Replication Overhead on Primary:* The primary database exhausted its network bandwidth transmitting WAL changes to 5 additional replicas.
      2. *Connection Exhaustion:* The application server opened separate connection pools to each replica, saturating database RAM.
      3. *Cold Caches:* The new replicas had empty buffer pool caches, forcing all queries to read from physical disk instead of RAM.

19. **Why did a distributed rate limiter fail to limit requests when deployed across 4 Kubernetes pods?**
    * *Answer:* The rate limiter maintained request counts in local node memory instead of a centralized, atomic store (Redis). Each pod allowed 100 requests, permitting a combined $4 \times 100 = 400$ requests per minute instead of the target 100.

20. **Why did an event-driven microservice system process the same payment twice?**
    * *Answer:* The message queue was configured for **At-Least-Once Delivery**. When a temporary network blip prevented the consumer from acknowledging the message, the broker redelivered it. The payment consumer lacked **Idempotency checks**, causing it to execute the credit card charge a second time.

---

### Scenario-Based Questions
21. **Scenario: Design a Scalable Notification Service handling 500 Million Push Notifications per day.**
    * *Answer:*
      - *Calculations:* $500\text{M} / 100,000 = 5,000\text{ notifications/sec}$ average. Peak $\approx 15,000\text{ QPS}$.
      - *Architecture:*
        1. Ingestion API accepts notification tasks with an idempotency key.
        2. Validates user preferences (SMS, Push, Email).
        3. Pushes to Apache Kafka partitioned by `user_id`.
        4. Dedicated worker pools consume from Kafka topics (APNs worker, FCM worker, SES email worker).
        5. Failed sends are routed to a Dead Letter Queue (DLQ) with exponential backoff retries.

22. **Scenario: You are designing a Global Distributed File Storage System (Dropbox / Google Drive). How do you handle file synchronization efficiently?**
    * *Answer:*
      - Chunking: Break large files into **4MB content-addressed chunks** hashed using SHA-256 (`hash(chunk)`).
      - Deduplication: Check if chunk hash exists in metadata DB. If it exists, skip uploading (saves 40% of storage and bandwidth).
      - Delta Sync: When a file is modified, upload only the specific 4MB chunks that changed, rather than the entire 1GB file.
      - Storage: Store raw chunks in Amazon S3, metadata in PostgreSQL/Cassandra.

23. **Scenario: Design a Real-Time Collaborative Whiteboard (Figma / Miro). What data structure resolves concurrent drawing conflicts?**
    * *Answer:*
      - Use **Conflict-Free Replicated Data Types (CRDTs)** or **Operational Transformation (OT)**.
      - CRDTs (e.g., Yjs or Automerge) provide state-based or operation-based mathematical structures that guarantee convergence: all clients arrive at the exact same canvas state regardless of the arrival order of network packets, without requiring a central database lock.

24. **Scenario: Design a Web Crawler that crawls 10 Billion web pages per month. What data structure prevents revisiting duplicate URLs?**
    * *Answer:*
      - Storing 10 Billion URL strings in a hash set requires $\approx 500\text{ GB}$ of RAM.
      - Use a **Bloom Filter**: A space-efficient probabilistic data structure.
      - For 10 Billion items with a 0.1% false-positive rate, a Bloom filter requires only **18 GB of RAM**, easily fitting in a single Redis instance with $O(1)$ constant-time lookup.

25. **Scenario: Design a Distributed Webhook Delivery Engine (like Stripe Webhooks). How do you handle slow or unresponsive client endpoints?**
    * *Answer:*
      - Worker queues (Kafka / BullMQ) consume webhook delivery tasks.
      - Enforce a strict **5-second HTTP connection timeout**.
      - If client endpoint times out: schedule retry with **Exponential Backoff and Full Jitter** over 3 days (e.g., retry at 1m, 5m, 30m, 2h, 6h, 24h).
      - If failure continues: disable webhook endpoint and send security email to merchant.

---

### Advanced Architectural Questions
26. **Explain the Two Generals' Problem and why it proves that consensus over an unreliable network is impossible.**
    * *Answer:* Two generals on opposing hills must coordinate an attack on a valley fortress. They can only communicate via messengers who may be captured. General A sends: "Attack at dawn." Will General A attack? No, because he doesn't know if the messenger arrived. If General B replies: "Acknowledged", will General B attack? No, because General B doesn't know if his acknowledgment arrived. This recursive acknowledgment dilemma mathematically proves that **two nodes can never achieve 100% certainty of consensus over an unreliable network**.

27. **What is Shuffle Sharding and how does AWS use it to eliminate blast radiuses?**
    * *Answer:* In standard sharding, 100 customers share Shard 1. If Customer X sends a toxic payload that crashes Shard 1, all 100 customers go down. In **Shuffle Sharding**, each customer is assigned a unique random *subset* (combination) of nodes (e.g., 4 nodes out of 100 total nodes). The mathematical combination:
      $$\binom{100}{4} = 3,921,225\text{ unique shard combinations}$$
      Even if Customer X's toxic traffic crashes their 4 nodes, no other customer shares the exact same 4 nodes, ensuring that 99.9% of all other customers experience zero downtime.

28. **Explain the Raft Distributed Consensus Leader Election and Log Replication process.**
    * *Answer:*
      - *Leader Election:* Nodes begin as Followers. If a follower detects no heartbeat from the leader, its randomized election timer (150–300ms) expires, and it becomes a Candidate, requesting votes. When it receives votes from a majority ($N/2 + 1$) quorum, it becomes Leader.
      - *Log Replication:* Clients send writes to the Leader. The Leader appends entries to its log and sends `AppendEntries` RPCs to followers. Once a majority acknowledges, the entry is committed and applied to the state machine.

29. **What is the difference between Write Amplification and Space Amplification in LSM-Trees (Cassandra/RocksDB) vs B-Trees?**
    * *Answer:*
      - *B-Trees:* In-place update engine. Low write amplification for reads, but high write amplification for random inserts (splitting 8KB pages).
      - *LSM-Trees (Log-Structured Merge-Trees):* Append-only engine. Inserts write instantly to an in-memory MemTable and append-only WAL ($O(1)$ writes). Background compaction merges sorted SSTables on disk. High space amplification (duplicate versions exist until compaction) and compaction-induced write amplification, but provides 10x higher write throughput than B-Trees.

30. **Explain how Google Spanner achieves globally synchronized distributed transactions without locks across continents.**
    * *Answer:* Traditional distributed databases cannot determine global time ordering across continents because physical hardware clocks drift by up to 100ms. Google Spanner uses **TrueTime API**, backed by physical atomic clocks and GPS receivers installed in every datacenter. TrueTime provides an API that returns a time interval: $[\text{earliest}, \text{latest}]$ with a guaranteed bound on uncertainty ($\epsilon \le 7\text{ms}$). By waiting out the uncertainty window ($2\epsilon$) before committing, Spanner guarantees **External Consistency (Strict Serializability)** globally without central coordinators.

---

## 16. Coding Questions

### Coding Challenge 1: Distributed Snowflake Unique ID Generator

```typescript
export class SnowflakeIdGenerator {
  private readonly epoch = 1704067200000n; // Custom Epoch: 2024-01-01T00:00:00Z
  private readonly workerIdBits = 10n;
  private readonly sequenceBits = 12n;

  private readonly maxWorkerId = (1n << this.workerIdBits) - 1n; // 1023
  private readonly maxSequence = (1n << this.sequenceBits) - 1n; // 4095

  private readonly workerIdShift = this.sequenceBits;
  private readonly timestampShift = this.sequenceBits + this.workerIdBits;

  private lastTimestamp = -1n;
  private sequence = 0n;

  constructor(private workerId: bigint) {
    if (workerId < 0n || workerId > this.maxWorkerId) {
      throw new Error(`Worker ID must be between 0 and ${this.maxWorkerId}`);
    }
  }

  nextId(): bigint {
    let currentTimestamp = BigInt(Date.now());

    if (currentTimestamp < this.lastTimestamp) {
      throw new Error("Clock moved backwards! Refusing to generate ID.");
    }

    if (currentTimestamp === this.lastTimestamp) {
      this.sequence = (this.sequence + 1n) & this.maxSequence;
      if (this.sequence === 0n) {
        // Sequence exhausted in current millisecond; wait for next millisecond
        while (currentTimestamp <= this.lastTimestamp) {
          currentTimestamp = BigInt(Date.now());
        }
      }
    } else {
      this.sequence = 0n;
    }

    this.lastTimestamp = currentTimestamp;

    return (
      ((currentTimestamp - this.epoch) << this.timestampShift) |
      (this.workerId << this.workerIdShift) |
      this.sequence
    );
  }
}
```

### Coding Challenge 2: Sliding Window Log Rate Limiter Algorithm

```typescript
export class SlidingWindowLogRateLimiter {
  private requestLogs = new Map<string, number[]>();

  constructor(
    private maxRequests: number,
    private windowDurationMs: number
  ) {}

  isAllowed(clientId: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowDurationMs;

    let timestamps = this.requestLogs.get(clientId) || [];

    // Filter out timestamps outside the sliding window
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= this.maxRequests) {
      this.requestLogs.set(clientId, timestamps);
      return false;
    }

    timestamps.push(now);
    this.requestLogs.set(clientId, timestamps);
    return true;
  }
}
```

---

## 17. Common Interview Traps

* **The Trap:** The interviewer asks: *"In our system design, can we just use WebSockets for all client-server communication because WebSockets are bidirectional and faster than HTTP?"*
  * **How candidates fail:** Saying "Yes, WebSockets eliminate HTTP headers and are faster."
  * **The Winning Answer:** **No!** WebSockets are stateful, persistent TCP connections. While ideal for real-time applications (chat, live collaborative whiteboards), using WebSockets for standard CRUD operations introduces severe scalability bottlenecks:
    1. They bypass standard HTTP caching across CDN edge networks and browser caches.
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
|               System Design Numbers & Patterns High-Yield Matrix                  |
+-----------------------------------------------------------------------------------+
| Latency Order:       RAM (100ns) < NVMe SSD (16μs) < Datacenter (0.5ms) < WAN(150ms)|
| 1M req/day:          10 QPS (Avg) / 25 QPS (Peak); 1 Day ≈ 100,000 Seconds        |
| 80/20 Rule:          Size Redis cache to hold 20% of daily active read data       |
| CAP Law:             Partition forced -> Choose Consistency (CP) or Avail (AP)    |
| Outbox Pattern:      Write event to DB outbox table within local ACID transaction |
| Consistent Hashing:  32-bit ring + V-nodes remaps only 1/N keys on node changes   |
| Rate Limiting:       Token Bucket permits bursts; Leaky Bucket flattens traffic   |
+-----------------------------------------------------------------------------------+
```

---

## 19. Quick Reference

* **1 Day:** 86,400 seconds ($\approx 100,000$ seconds for mental math).
* **1 Million req/day:** $\approx 12\text{ QPS}$ average, $25\text{ to }30\text{ QPS}$ peak.
* **L1 Cache:** 1 nanosecond.
* **RAM Access:** 100 nanoseconds.
* **SSD Random Read:** 16 to 100 microseconds.
* **Cross-Atlantic Network RTT:** 150 milliseconds.
* **Snowflake ID:** 64-bit distributed unique ID (Time + Machine + Sequence).
* **Bloom Filter:** Space-efficient probabilistic filter with zero false negatives.
