# System Design Interview Framework: The 4-Step SDE-1/SDE-2 Blueprint & Capacity Heuristics

## 1. What is it?
The **System Design Interview Framework** is a structured, repeatable 45-to-60-minute methodology used by top technology companies (Google, Meta, Amazon, Microsoft, Uber, Netflix, Stripe) to assess a candidate's ability to architect scalable, resilient, fault-tolerant, and maintainable distributed software systems.

Unlike coding interviews that have a single optimal algorithmic solution (e.g., dynamic programming or binary search), system design interviews are **open-ended, ambiguous architectural discussions**. There is no single "correct" answer; interviewers evaluate your engineering communication, requirements discovery, capacity estimation heuristics, component trade-off analysis, and depth under pressure.

The industry-standard process follows the **4-Step Execution Template**:
1. **Step 1: Requirements Clarification (Functional & Non-Functional)** (5–8 mins)
2. **Step 2: Capacity Estimation & Back-of-the-Envelope Math** (5–7 mins)
3. **Step 3: High-Level Architecture & API / Data Model Design** (15–20 mins)
4. **Step 4: Detailed Deep-Dive & Bottleneck Mitigation** (15–20 mins)

```
┌────────────────────────────────────────────────────────────────────────┐
│               45-MINUTE SYSTEM DESIGN TIMELINE BREAKDOWN               │
├───────────────┬───────────────────────────┬────────────────────────────┤
│ Phase         │ Time Allocation           │ Primary Deliverables       │
├───────────────┼───────────────────────────┼────────────────────────────┤
│ Step 1        │ 0:00 - 0:08 (8 mins)      │ Scope, FRs, NFRs, Non-Goals│
│ Step 2        │ 0:08 - 0:15 (7 mins)      │ QPS, Storage, Bandwidth,RAM│
│ Step 3        │ 0:15 - 0:30 (15 mins)     │ Box Diagram, APIs, DB Schema│
│ Step 4        │ 0:30 - 0:42 (12 mins)     │ Caching, Sharding, Failover│
│ Wrap-up / Q&A │ 0:42 - 0:45 (3 mins)      │ Summary, Monitoring, SRE   │
└───────────────┴───────────────────────────┴────────────────────────────┘
```

---

## 2. Why does it exist?
Candidates without a structured framework routinely fail system design rounds for predictable reasons:

1. **Jumping Straight to Architecture ("The Architecture Trap")**: An interviewer says: *"Design Twitter."* An unprepared candidate immediately starts drawing boxes: *"Okay, we need Redis, Kafka, and 10 microservices!"* The candidate never asked how many users exist, whether search is required, or what latency is expected. This results in an automatic reject.
2. **Analysis Paralysis**: Spending 25 minutes calculating microsecond disk seek times without ever drawing an architectural diagram or defining an API contract.
3. **Lack of Trade-Off Justification**: Choosing technologies by buzzword (*"We'll use Cassandra because it scales!"*) rather than articulating why Cassandra was chosen over PostgreSQL based on read/write ratios, consistency requirements, and partition tolerance.
4. **Simulating Real Engineering Leadership**: In senior engineering roles, you rarely write isolated algorithms. You design systems across teams, resolve technical ambiguities, negotiate constraints, and balance cost against availability.

---

## 3. Mental Model: Building a Bridge
Think of a System Design Interview as an **Architect Pitching a Bridge to City Council**:
- **Step 1 (Requirements)**: *"Are we building a pedestrian footbridge over a canal, or an 8-lane suspension bridge over an ocean bay for 50-ton freight trains?"*
- **Step 2 (Capacity Estimation)**: *"How many vehicles will cross per hour during rush hour? What is the maximum load weight?"*
- **Step 3 (High-Level Design)**: *"Here is the basic blueprint: steel suspension cables, two concrete pillars, and a two-lane asphalt deck."*
- **Step 4 (Deep Dive)**: *"What happens during an 8.0 earthquake? (Fault tolerance) How do we handle rust from saltwater spray? (Data retention / Archiving) How do we clear a multi-car pileup? (Dead-letter queues / Circuit breakers)"*

---

## 4. The 4-Step Template: Step-by-Step Execution

### Step 1: Requirements Clarification (8 Minutes)
Never assume anything. Narrow down the problem scope into three explicit buckets:

```
A. Functional Requirements (What the system MUST do):
   - User can shorten a long URL into a 7-character alias.
   - User visiting the short URL is redirected to original URL (HTTP 301/302).
   - User can view click analytics (count, geolocation).

B. Non-Functional Requirements (Quality attributes & SLAs):
   - Availability: High Availability (99.99% - 4 nines) preferred over strict consistency.
   - Latency: Sub-10ms redirection latency.
   - Read-to-Write Ratio: Heavily read-heavy (100:1).
   - Data Durability: Once created, short URLs must persist for 5 years.

C. Out of Scope / Non-Goals (Explicitly agreed with interviewer):
   - Custom vanity aliases (deferred to v2).
   - User authentication and billing tiers.
```

---

### Step 2: Capacity Estimation & Back-of-the-Envelope Math (7 Minutes)

You must master the **"Numbers Every Programmer Should Know"**:

```
┌──────────────────────────────────────┬─────────────────────────────────┐
│ Metric / Unit                        │ Approximate Value               │
├──────────────────────────────────────┼─────────────────────────────────┤
│ Seconds in a Day                     │ 86,400 ≈ 100,000 seconds (10^5) │
│ 1 Million Requests / Day             │ ≈ 12 Requests / Second (QPS)    │
│ 100 Million Requests / Day           │ ≈ 1,200 Requests / Second (QPS) │
│ 1 Billion Requests / Day             │ ≈ 12,000 Requests / Second (QPS)│
│ L1 Cache Reference                   │ 0.5 - 1 nanosecond              │
│ Main Memory (RAM) Reference          │ 100 nanoseconds                 │
│ Solid State Disk (SSD) Random Read   │ 100 microseconds (0.1 ms)       │
│ Rotational Disk Seek                 │ 10 milliseconds (10,000,000 ns) │
│ Data Center Roundtrip (Cross-WAN)    │ 150 milliseconds                │
└──────────────────────────────────────┴─────────────────────────────────┘
```

#### Example Calculation: TinyURL (100 Million New URLs per Month)
1. **Write QPS (Queries Per Second)**:
   $$\text{Write QPS} = \frac{100,000,000 \text{ writes}}{30 \text{ days} \times 86,400 \text{ sec}} \approx \frac{100,000,000}{2,500,000 \text{ sec}} \approx 40 \text{ writes/sec}$$
2. **Read QPS (Assuming 100:1 Read-to-Write Ratio)**:
   $$\text{Read QPS} = 40 \times 100 = 4,000 \text{ reads/sec}$$
   $$\text{Peak Read QPS (2x)} \approx 8,000 \text{ reads/sec}$$
3. **Storage Requirements (5-Year Horizon)**:
   - Each record: URL string (500 bytes) + Short alias (7 bytes) + CreatedAt (8 bytes) + ID (8 bytes) $\approx 500$ bytes.
   - 5 Years of writes: $100\text{M} \times 12 \text{ months} \times 5 \text{ years} = 6 \text{ Billion records}$.
   - Total Storage: $6,000,000,000 \times 500 \text{ bytes} = 3 \text{ Terabytes}$. (Easily fits on a modern NVMe array!).
4. **Memory / Cache Sizing (80/20 Pareto Rule)**:
   - 20% of the URLs generate 80% of daily read traffic.
   - Daily reads: $4,000 \times 86,400 \approx 350 \text{ Million reads/day}$.
   - Cache size required: $0.20 \times 350,000,000 \times 500 \text{ bytes} \approx 35 \text{ Gigabytes RAM}$. (A single Redis instance can hold this!).

---

### Step 3: High-Level Architecture & API / Data Model Design (15 Minutes)

#### 1. Define the REST / gRPC API Contract
```http
POST /api/v1/urls
Headers: Content-Type: application/json
Body: { "longUrl": "https://example.com/very/long/path" }
Response: 201 Created
{ "shortUrl": "https://tiny.url/aZ7b8Qc", "expiresAt": "2031-01-01T00:00:00Z" }

GET /{shortCode}
Response: 301 Moved Permanently (or 302 Found)
Header: Location: https://example.com/very/long/path
```

#### 2. Define Data Schema (SQL vs. NoSQL Justification)
```sql
CREATE TABLE url_mappings (
    id BIGINT PRIMARY KEY,              -- 64-bit auto-increment or Snowflake ID
    short_code VARCHAR(7) UNIQUE NOT NULL, -- Base62 encoded string
    original_url TEXT NOT NULL,
    user_id UUID NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_short_code ON url_mappings(short_code);
```

#### 3. Draw the High-Level Architectural Box Diagram
```
[ Client (Browser / Mobile) ]
             │
             │ HTTPS (DNS / Anycast CDN)
             ▼
┌────────────────────────────────────────────────────────┐
│ Global Load Balancer (AWS ALB / Nginx Reverse Proxy)   │
└──────────────────────────┬─────────────────────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
┌─────────────────────────┐ ┌─────────────────────────┐
│ Web App Server Node 1   │ │ Web App Server Node 2   │
│ (Stateless Node.js/Go)  │ │ (Stateless Node.js/Go)  │
└────────────┬────────────┘ └────────────┬────────────┘
             │                           │
             ├───────────────────────────┤
             ▼                           ▼
┌─────────────────────────┐ ┌─────────────────────────┐
│ In-Memory Cache (Redis) │ │ Token / Range Generator │
│ (35 GB Hot URLs Cache)  │ │ (ZooKeeper / Snowflake) │
└────────────┬────────────┘ └─────────────────────────┘
             │
             ▼
┌────────────────────────────────────────────────────────┐
│ Relational Database Cluster (PostgreSQL / Aurora)      │
│ Primary (Writes) ──Replication──► Read Replicas (Reads) │
└────────────────────────────────────────────────────────┘
```

---

### Step 4: Detailed Deep-Dive & Bottleneck Mitigation (12 Minutes)

Address single points of failure (SPOF) and dive deep into technical nuances:
1. **Hashing & Collision Mitigation**: Why Base62 encoding on an auto-incrementing ID is mathematically superior to MD5/SHA256 truncation.
2. **HTTP 301 vs. 302 Redirection**:
   - `301 Moved Permanently`: The browser caches the redirection permanently. Subsequent clicks bypass your server completely, saving server load but destroying your ability to collect real-time click analytics.
   - `302 Found (Temporary)`: The browser sends every click through your server, enabling accurate analytics and click tracking at the cost of higher server traffic.
3. **Cache Eviction Policy**: Configure Redis with `allkeys-lru` (Least Recently Used) to automatically discard cold URLs when memory fills up.
4. **Database Sharding**: When storage exceeds a single instance, shard horizontally across multiple PostgreSQL nodes using `hash(short_code) % N`.

---

## 5. Under the Hood: The 6 Latency Heuristics Every SDE Must Memorize

```
1. In-Memory RAM vs. SSD Disk:
   Reading 1MB from RAM takes ~250 microseconds.
   Reading 1MB sequentially from SSD takes ~1,000 microseconds (1ms).
   Reading 1MB from Rotational Disk takes ~20,000 microseconds (20ms).
   -> RAM is 4x to 80x faster than disk.

2. Network WAN Latency:
   Intra-datacenter ping: < 0.5 ms
   Cross-country ping (NY to LA): ~40 ms
   Trans-Atlantic ping (NY to London): ~75 ms
   Trans-Pacific ping (LA to Tokyo): ~120 ms
   -> Cross-region network calls dominate all software execution overhead!

3. Database Connection Pool Limits:
   A single PostgreSQL instance can comfortably handle 300 to 500 active 
   connections before connection overhead degrades throughput.
   -> Always use connection poolers (PgBouncer) or stateless caching!
```

---

## 6. Important Rules

1. **Lead the Interview, Don't Be Passive**: The candidate should drive 75% of the conversation. Do not wait for the interviewer to prompt every single step. Present your plan, state your assumptions clearly, and validate them: *"I am going to assume a 100:1 read-to-write ratio; does that match your expectations?"*
2. **State Assumptions Explicitly**: If user traffic is unspecified, state: *"Let's assume 10 million Daily Active Users (DAU), where each user generates 5 views per day."*
3. **Never Introduce Technologies Without Justification**: Never say: *"I will use Kafka here."* Say: *"Because our write spikes can exceed database ingestion throughput during peak hours, I will decouple the ingestion tier with a Kafka message queue to provide backpressure and buffer writes."*
4. **Design for Failure (Assume Everything Will Crash)**: What happens if the Redis cache crashes? What happens if the network between Region A and Region B is severed? What happens if the database primary replica catches fire? A senior engineer designs automatic failover, circuit breakers, and read replicas into the initial architecture.
5. **Keep Servers Completely Stateless**: Application servers (Node.js/Express) must never store user sessions in local server memory. Store sessions in shared Redis clusters so that any server pod can handle any user request behind a round-robin load balancer.

---

## 7. Common Mistakes & Anti-Patterns

### 1. The "Buzzword Soup" Anti-Pattern
Littering the whiteboard with Cassandra, Kafka, Redis, Kubernetes, ElasticSearch, and GraphQL within the first 5 minutes without explaining how data flows between them.

### 2. Silently Calculating Math
Writing numbers on the board in complete silence for 5 minutes. Walk the interviewer through your thought process: *"Since there are roughly 100,000 seconds in a day, 10 million requests per day translates to approximately 100 requests per second."*

### 3. Ignoring Bottlenecks in the Wrap-up
Claiming your system is "100% scalable with zero flaws." Every architecture is a set of compromises. A senior candidate proactively identifies the system's weakest links: *"Our current single-primary database will become a write bottleneck once writes exceed 5,000 QPS; at that point, we must shard by user ID."*

---

## 8. Best Practices

- **The "Rule of 100k"**: Round 86,400 seconds in a day up to 100,000 ($10^5$) during back-of-the-envelope calculations. Interviewers care about orders of magnitude (whether you need 1 server or 100 servers), not decimal precision.
- **Round-Trip Communication**: Check in with the interviewer every 3–5 minutes: *"Does this high-level architecture look solid, or would you like me to dive deeper into the database sharding strategy?"*
- **Draw Clean Top-to-Bottom Data Flow**: Draw Clients at the top, Load Balancers next, Application Services in the middle, and Persistence/Caches at the bottom.

---

## 9. Performance Considerations

- **Sizing Compute Clusters**: A single modern 8-core, 16GB RAM Node.js or Go application server can comfortably handle **2,000 to 5,000 lightweight HTTP requests per second**. If your estimated QPS is 20,000, you need roughly 4 to 6 application server instances behind a load balancer, plus 2 instances for $N+1$ redundancy.

---

## 10. Security Considerations

- **DDoS & Rate Limiting at the Edge**: Place Cloudflare or AWS WAF at the ingress boundary to absorb Layer 3/4 volumetric attacks and rate-limit abusive IPs before requests hit application servers.
- **Data Encryption**: Enforce TLS 1.3 in-transit between clients and load balancers, mTLS between internal microservices, and AES-256 encryption-at-rest for databases and S3 object storage.

---

## 11. Architectural Style Comparison Matrix

| Architecture Pattern | Scalability | Complexity | Failure Blast Radius | Best Suited For |
| :--- | :--- | :--- | :--- | :--- |
| **Modular Monolith** | High (Vertical/Horizontal) | Low | High (Single deployable) | 0 to 1M users, small teams |
| **Microservices** | Very High (Independent) | High | Low (Isolated domains) | 100+ engineers, distinct domains |
| **Event-Driven (Pub/Sub)**| Massive (Async) | Moderate to High| Extremely Low | Decoupled background workflows |
| **Serverless (Lambda)** | Auto-scaling | Low (Vendor Lock) | Low | Bursty, infrequent workloads |

---

## 12. Trade-offs

- **Consistency vs. Availability (CAP Theorem)**: Choosing strong consistency (CP via 2-phase commit or Paxos) guarantees no user sees stale data, but requests will fail if a network partition occurs. Choosing high availability (AP via eventual consistency) guarantees the system never goes down, at the cost of temporary data drift.
- **Normalization vs. Denormalization**: Normalizing relational tables eliminates data redundancy and guarantees consistency during writes, but requires expensive multi-table `JOIN` operations on reads. Denormalizing copies data for lightning-fast single-table reads, at the cost of complex multi-row write updates.

---

## 13. Real-World Usage Case Studies

1. **Instagram Architecture Evolution**: Started as a monolithic Django application running on AWS EC2 with a PostgreSQL primary-replica cluster and Redis for feed caching. They scaled to 100 million users on this architecture before gradually introducing sharded databases and decoupled microservices.
2. **Discord Voice & Chat Infrastructure**: Transitioned from MongoDB to Cassandra, and later from Cassandra to ScyllaDB, because Cassandra's Java garbage collection pauses caused latency spikes in real-time chat channels with billions of messages.

---

## 14. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: What are the 4 main phases of a System Design interview?**
> **Answer**:
> 1. **Requirements Clarification**: Discovering Functional Requirements, Non-Functional Requirements (SLA/latency/availability), and Out-of-Scope non-goals.
> 2. **Capacity Estimation**: Back-of-the-envelope calculations for QPS, storage growth, network bandwidth, and cache sizing.
> 3. **High-Level Design**: Defining API contracts, data schemas, and the core end-to-end component box diagram.
> 4. **Deep Dive & Bottlenecks**: Addressing scaling bottlenecks, sharding, caching, single points of failure, and fault tolerance.

### Tier 2: Conceptual
**Q: How do you estimate the cache size for a system using the 80/20 Pareto principle?**
> **Answer**:
> The 80/20 Pareto principle assumes that 20% of your data items generate 80% of your total daily read traffic.
> To calculate cache size:
> 1. Calculate the total daily read volume: $\text{Daily Reads} = \text{Read QPS} \times 86,400 \text{ sec}$.
> 2. Take 20% of the unique read items: $\text{Hot Items} = \text{Unique Daily Items} \times 0.20$.
> 3. Multiply by average object size: $\text{Cache Size} = \text{Hot Items} \times \text{Average Object Size (Bytes)}$.

### Tier 3: Implementation
**Q: In a URL shortener system, why is Base62 encoding preferred over Base64 or standard hexadecimal?**
> **Answer**:
> Base62 uses alphanumeric characters: `[a-z]`, `[A-Z]`, and `[0-9]` ($26 + 26 + 10 = 62$).
> 1. **URL-Safe**: Base64 includes special characters like `+` and `/`, which have reserved meanings in URL syntax and query strings, requiring URL-encoding (`%2B`, `%2F`). Base62 is completely URL-safe without escaping.
> 2. **Information Density**: A 7-character Base62 string provides $62^7 \approx 3.52 \text{ Trillion}$ unique combinations, providing massive global scale with very short, readable URLs.

### Tier 4: Debugging
**Q: During an interview, you realize halfway through that your back-of-the-envelope math was off by an order of magnitude. How do you recover?**
> **Answer**:
> Pause immediately and acknowledge it directly to the interviewer: *"Looking back at our QPS calculation, I made an arithmetic error—our write QPS is 4,000, not 400. That means our daily storage will be 15GB instead of 1.5GB. This changes our database strategy: instead of a single PostgreSQL node, we will need read replicas immediately and should plan for horizontal sharding by month 6."* Interviewers respect self-correction and transparency under pressure.

### Tier 5: Scenario
**Q: Design the data model and generation logic for an auto-incrementing ID in a globally distributed URL shortener across 3 data centers without database collisions.**
> **Answer**:
> Use a distributed ID generator (like **Twitter Snowflake** or **Flickr Ticket Servers**):
> - **Snowflake ID (64-bit integer)**:
>   - 1 bit: Unused sign bit (0).
>   - 41 bits: Epoch timestamp in milliseconds (gives 69 years of IDs).
>   - 10 bits: Machine/Data Center ID (supports up to 1,024 independent generator nodes).
>   - 12 bits: Sequence counter (supports up to 4,096 IDs per millisecond per node).
> Every node generates IDs locally in memory without network coordination. Convert the 64-bit integer to a Base62 string for the final short URL.

### Tier 6: Advanced
**Q: What is the difference between a 301 Redirect and a 302 Redirect in a URL shortener, and what are the architectural trade-offs of each?**
> **Answer**:
> - **HTTP 301 (Moved Permanently)**: The browser and edge CDN cache the redirect response. The next time the user clicks the short link, their browser performs the redirect locally without ever contacting your servers.
>   - *Trade-off*: Minimizes server load and provides the lowest possible latency for the user, but you **cannot record analytics** (click counts, referrer, device type) for repeat visits.
> - **HTTP 302 (Found / Temporary Redirect)**: The browser does not cache the redirect and must hit your server on every single visit.
>   - *Trade-off*: Slightly higher latency and increased server load, but allows you to **record 100% of click analytics** and dynamically change the destination URL in real time.

---

## 15. Coding Question: Base62 Encoder/Decoder Implementation

### Problem
Implement a production-grade Base62 encoder and decoder in TypeScript that converts a 64-bit numeric database ID into a 7-character URL-safe string and vice versa.

### Solution

```typescript
export class Base62 {
  private static readonly CHARSET =
    '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  private static readonly BASE = BigInt(Base62.CHARSET.length); // 62

  /**
   * Encodes a numeric ID into a Base62 string
   */
  public static encode(num: bigint | number): string {
    let value = BigInt(num);
    if (value === 0n) return Base62.CHARSET[0];

    const chars: string[] = [];

    while (value > 0n) {
      const remainder = Number(value % Base62.BASE);
      chars.push(Base62.CHARSET[remainder]);
      value = value / Base62.BASE;
    }

    // Reverse to get the most significant digit first
    return chars.reverse().join('');
  }

  /**
   * Decodes a Base62 string back into a numeric ID
   */
  public static decode(str: string): bigint {
    let result = 0n;

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      const index = Base62.CHARSET.indexOf(char);
      if (index === -1) {
        throw new Error(`Invalid Base62 character detected: ${char}`);
      }
      result = result * Base62.BASE + BigInt(index);
    }

    return result;
  }
}

// ==========================================
// Demonstration
// ==========================================
const testId = 125193489123n;
const shortCode = Base62.encode(testId);
console.log(`Original ID: ${testId} -> Encoded Short Code: ${shortCode}`);
// Outputs: "1k8KkI3"

const restoredId = Base62.decode(shortCode);
console.log(`Decoded back: ${restoredId} (Matches: ${testId === restoredId})`);
```

---

## 16. Common Interview Traps

- **Trap 1**: Forgetting to ask about read vs. write traffic ratios.
  *Gotcha*: A 100:1 read-heavy system requires heavy caching and read replicas. A 1:1 write-heavy system (like IoT telemetry) requires message queues (Kafka) and append-only time-series databases (TimescaleDB/Cassandra).
- **Trap 2**: Proposing microservices for a system with 500 total daily users.
  *Gotcha*: Start simple! Over-engineering simple requirements with Kubernetes and Kafka indicates poor practical judgment. Start with a clean Modular Monolith, state where it will break, and explain how you will decompose it when traffic scales.
- **Trap 3**: Believing back-of-the-envelope math must be exact to the byte.
  *Gotcha*: Interviewers want to see that you understand orders of magnitude ($10\text{MB}$ vs $10\text{TB}$), not that you can multiply $86,400 \times 365$ in your head without a calculator.

---

## 17. Revision Summary

- **4-Step Blueprint**:
  1. *Requirements Clarification* (5–8 mins): FRs, NFRs, Non-goals.
  2. *Capacity Estimation* (5–7 mins): QPS, storage, bandwidth, RAM cache.
  3. *High-Level Design* (15–20 mins): API routes, DB schema, box diagram.
  4. *Deep Dive* (15–20 mins): Sharding, caching, bottlenecks, SPOF.
- **Golden Heuristics**: 100k seconds in a day; 1M req/day $\approx$ 12 QPS; 80/20 rule for cache sizing.
- **Interview Presence**: Lead the conversation, state all assumptions out loud, and always justify technology choices with technical trade-offs.

---

## 18. Quick Reference

| Phase | Duration | Core Goal | Common Questions to Ask |
| :--- | :--- | :--- | :--- |
| **Requirements** | 8 mins | Define system boundaries | "What is the expected scale? Is high availability or consistency priority?" |
| **Estimation** | 7 mins | Quantify resources | "How many DAU? What is the read/write ratio? How long must data persist?" |
| **High-Level** | 15 mins | Core data flow | "Let's establish the REST API endpoints and data model before scaling." |
| **Deep Dive** | 12 mins | Fault tolerance & scale | "What happens when Redis evicts? How do we partition the database?" |
