# System Design Case Study: Scalable URL Shortener (TinyURL / Bitly)

## 1. What is it?
A **URL Shortener** (such as TinyURL, Bitly, or ow.ly) is a high-throughput, read-heavy distributed service that generates short, compact aliases (e.g., `https://tiny.url/7bX9qA`) for long, unwieldy URLs (e.g., `https://example.com/products/electronics/item-987654?campaign=spring_sale&ref=social`). When a user visits the short URL, the service quickly resolves the alias and redirects the user to the destination long URL using standard HTTP redirection codes (`301 Moved Permanently` or `302 Found`).

Modern URL shorteners also provide click analytics (geographic distribution, referrer domains, device types), custom vanity aliases, expiration dates, and malicious link detection.

```
       Write Journey: Generate Short URL
┌────────┐     POST /api/v1/urls (longUrl)     ┌──────────────┐     Base62 Token     ┌──────────────┐
│ Client │ ──────────────────────────────────► │ Shortener Srv│ ───────────────────► │ Distributed  │
└────────┘ ◄────────────────────────────────── └──────┬───────┘                      │ ID Generator │
               201 Created (tiny.url/7bX9qA)          │ Insert                       └──────────────┘
                                                      ▼
                                           ┌────────────────────┐
                                           │ Relational DB / NoSQL
                                           └────────────────────┘

       Read Journey: Fast Redirection (<15ms)
┌────────┐     GET /7bX9qA                     ┌──────────────┐     Cache Hit (<1ms) ┌──────────────┐
│ Browser│ ──────────────────────────────────► │ Edge CDN/LB  │ ───────────────────► │ Redis Cache  │
│        │ ◄────────────────────────────────── └──────┬───────┘                      │ (80/20 RAM)  │
└────────┘     301/302 Redirect to Long URL           │ Cache Miss                   └──────────────┘
                                                      ▼
                                           ┌────────────────────┐
                                           │ Primary DB Shards  │
                                           └────────────────────┘
```

---

## 2. Why does it exist?
The URL Shortener is the **canonical classic System Design interview question** for SDE-1 and SDE-2 roles at top tech companies because it tests every fundamental pillar of distributed engineering in an accessible, bounded problem:

1. **Massive Read/Write Asymmetry**: Demonstrates mastery of caching and read replica scaling under extreme read-heavy ratios (100:1).
2. **High-Performance Encoding & Collision Handling**: Evaluates whether candidates understand cryptographic hashing (MD5/SHA256) versus bijective Base62 encoding and distributed ID generation.
3. **HTTP Protocol Specifics**: Evaluates deep knowledge of HTTP redirection mechanisms (`301 Moved Permanently` vs. `302 Found`) and their operational trade-offs for analytics.
4. **Data Sizing & Partitioning**: Requires realistic back-of-the-envelope calculations for multi-terabyte data growth and horizontal database sharding.

---

## 3. Step 1: Requirements Clarification

### Functional Requirements
1. **URL Shortening**: Given a long URL, generate a unique 7-character short alias.
2. **Redirection**: Given a short alias, redirect the user to the original long URL in under 15ms.
3. **Custom Vanity URLs (Optional)**: Allow users to specify custom aliases (e.g., `tiny.url/my-portfolio`).
4. **Expiration**: Links expire by default after 5 years unless configured otherwise.
5. **Click Analytics**: Track click counts, referrer domain, and timestamp.

### Non-Functional Requirements
1. **High Availability (HA)**: 99.99% availability (redirection must never fail; AP preference over strict consistency).
2. **Low Latency**: Redirection latency must be $< 15\text{ms}$ at the 99th percentile (p99).
3. **Durable Storage**: Generated links must persist permanently without data loss.
4. **Collision-Proof**: Two different users shortening the same or different long URLs must receive distinct, non-conflicting aliases.

### Out of Scope / Non-Goals
- User authentication, billing tiers, and malicious domain scraping (deferred to v2).

---

## 4. Step 2: Capacity Estimation & Back-of-the-Envelope Math

Let us establish realistic traffic assumptions:
- **New URLs created**: 100 Million new URLs per month.
- **Read-to-Write Ratio**: 100:1 (Read-Heavy).
- **Data Retention**: 5 years.

### A. Traffic / QPS Calculations
$$\text{Seconds in a Month} \approx 30 \text{ days} \times 86,400 \text{ sec} \approx 2,592,000 \text{ sec} \approx 2.5 \times 10^6 \text{ sec}$$
$$\text{Write QPS} = \frac{100,000,000 \text{ writes}}{2,500,000 \text{ sec}} \approx \mathbf{40 \text{ writes/sec}}$$
$$\text{Read QPS} = 40 \text{ writes/sec} \times 100 = \mathbf{4,000 \text{ reads/sec}}$$
$$\text{Peak Read QPS (2x)} \approx \mathbf{8,000 \text{ reads/sec}}$$

### B. Storage Sizing (5 Years)
- **Total Writes in 5 Years**: $100\text{M} \times 12 \text{ months} \times 5 \text{ years} = \mathbf{6 \text{ Billion records}}$.
- **Record Size Breakdown**:
  - `id` (64-bit integer): 8 bytes
  - `short_code` (VARCHAR 7): 7 bytes
  - `original_url` (VARCHAR 500): ~500 bytes
  - `created_at` (TIMESTAMPTZ): 8 bytes
  - `expires_at` (TIMESTAMPTZ): 8 bytes
  - Overhead & indexing metadata: ~70 bytes
  - **Total per record**: $\approx \mathbf{600 \text{ bytes}}$.
- **Total Storage Required**:
  $$\text{Storage} = 6,000,000,000 \times 600 \text{ bytes} \approx \mathbf{3.6 \text{ Terabytes (TB)}}$$
  *Insight*: 3.6 TB over 5 years is surprisingly small. It can easily fit on a modern NVMe SSD array with RAID redundancy!

### C. Cache / RAM Sizing (80/20 Rule)
- 20% of the URLs generate 80% of the read traffic.
- Daily read count: $4,000 \text{ reads/sec} \times 86,400 \text{ sec} \approx \mathbf{345 \text{ Million reads/day}}$.
- Number of unique URLs cached daily: $345,000,000 \times 0.20 \approx \mathbf{69 \text{ Million URLs}}$.
- RAM required for 20% working set:
  $$\text{Cache RAM} = 69,000,000 \times 600 \text{ bytes} \approx \mathbf{41.4 \text{ Gigabytes (GB)}}$$
  *Insight*: A standard AWS ElastiCache Redis cluster with two 32GB instances handles the entire cache comfortably!

---

## 5. Step 3: High-Level Architecture & API Design

### API Contract (REST)
```http
POST /api/v1/urls
Content-Type: application/json
{
  "longUrl": "https://example.com/very/long/path",
  "customAlias": "my-portfolio" // Optional
}

Response: 201 Created
{
  "shortCode": "7bX9qA",
  "shortUrl": "https://tiny.url/7bX9qA",
  "longUrl": "https://example.com/very/long/path",
  "expiresAt": "2031-01-01T00:00:00Z"
}

GET /{shortCode}
Response: 302 Found (or 301 Moved Permanently)
Location: https://example.com/very/long/path
```

### Relational Database Schema
```sql
CREATE TABLE urls (
    id BIGINT PRIMARY KEY,                 -- 64-bit distributed Snowflake ID
    short_code VARCHAR(7) UNIQUE NOT NULL, -- Base62 encoded string
    original_url TEXT NOT NULL,
    user_id UUID NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- B-Tree index for sub-millisecond point lookups on shortCode
CREATE UNIQUE INDEX idx_urls_short_code ON urls(short_code);
```

### End-to-End Architectural Diagram
```
[ Client Browser / Mobile ]
             │
             │ HTTPS (DNS Route 53)
             ▼
┌────────────────────────────────────────────────────────┐
│ Global Load Balancer (AWS ALB / Nginx Reverse Proxy)   │
└──────────────────────────┬─────────────────────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
┌─────────────────────────┐ ┌─────────────────────────┐
│ App Server (Node.js/Go) │ │ App Server (Node.js/Go) │
└────────────┬────────────┘ └────────────┬────────────┘
             │                           │
             ├───────────────────────────┤
             ▼                           ▼
┌─────────────────────────┐ ┌─────────────────────────┐
│ Distributed ID Service  │ │ Redis Cluster Cache     │
│ (Snowflake / ZooKeeper) │ │ (42 GB Hot Working Set) │
└─────────────────────────┘ └────────────┬────────────┘
                                         │ Cache Miss
                                         ▼
                            ┌─────────────────────────┐
                            │ PostgreSQL Primary DB   │
                            │ + Read Replicas         │
                            └────────────┬────────────┘
                                         │ Async CDC / Events
                                         ▼
                            ┌─────────────────────────┐
                            │ Kafka -> Click Analytics│
                            │ ClickHouse OLAP DB      │
                            └─────────────────────────┘
```

---

## 6. Step 4: Deep Dive & Technical Bottlenecks

### Deep Dive 1: Base62 Encoding vs. MD5 Hashing

```
┌────────────────────────────────┬────────────────────────────────────────┐
│ Approach A: MD5 / SHA256 Hash  │ Approach B: Bijective Base62 Counter   │
├────────────────────────────────┼────────────────────────────────────────┤
│ MD5(longUrl) -> 128-bit hex    │ 1. Unique 64-bit integer ID generated. │
│ Take first 7 characters.       │ 2. Convert ID to Base62: [a-z,A-Z,0-9] │
│ Fatal Flaw: HASH COLLISIONS!   │ Guarantees ZERO COLLISIONS!            │
│ Truncating 128 bits to 7 chars │ 62^7 = 3.52 Trillion unique URLs.      │
│ introduces birthday paradox    │ Bijective 1-to-1 mathematical mapping. │
│ collisions. Requires expensive │ Highly performant, zero lookup retries.│
│ database collision retries.    │ Industry standard for TinyURL.         │
└────────────────────────────────┴────────────────────────────────────────┘
```

**Why Base62?**
A 7-character string using characters `[0-9, a-z, A-Z]` ($10 + 26 + 26 = 62$ characters) yields:
$$62^7 = 3,521,614,606,208 \approx \mathbf{3.52 \text{ Trillion unique combinations}}$$
At 100 Million URLs per month, $3.52 \text{ Trillion}$ combinations will last over **2,900 years** before exhaustion!

---

### Deep Dive 2: Distributed Unique ID Generation
How do multiple horizontal application servers generate monotonically increasing, unique 64-bit integers without locking a central database?

Two proven architectural patterns:
1. **Twitter Snowflake Algorithm**:
   - 1 bit: Unused sign bit (0).
   - 41 bits: Millisecond timestamp (69 years).
   - 10 bits: Machine/Node ID (1,024 independent server instances).
   - 12 bits: Local sequence counter (4,096 IDs per millisecond per instance).
   - *Result*: Every application server generates up to 4 million unique IDs per second locally in memory with zero network coordination.
2. **Ticket Server / Range Allocator (ZooKeeper / Redis)**:
   - A central coordinator hands out batches of numbers (e.g., Server 1 gets IDs `1 – 1,000,000`; Server 2 gets `1,000,001 – 2,000,000`).
   - Servers increment locally in RAM. When a server's batch runs low, it requests a new range.

---

### Deep Dive 3: HTTP 301 vs. HTTP 302 Redirection

```
┌────────────────────────────────┬────────────────────────────────────────┐
│ HTTP 301 Moved Permanently     │ HTTP 302 Found (Temporary Redirect)    │
├────────────────────────────────┼────────────────────────────────────────┤
│ Browser caches the redirect    │ Browser DOES NOT cache the redirect.   │
│ permanently in local memory.   │ Every subsequent visit must hit your   │
│ Subsequent clicks bypass your  │ server cluster.                        │
│ servers entirely.              │ Trade-off: Higher server traffic, BUT  │
│ Trade-off: Saves server load,  │ enables 100% accurate, real-time click │
│ but LOSES ALL CLICK ANALYTICS  │ tracking, referrer inspection, and     │
│ on repeat visits!              │ instant destination URL updating.      │
└────────────────────────────────┴────────────────────────────────────────┘
```
*Production Decision*: Use **HTTP 302** (or `307 Temporary Redirect`) if monetization or click analytics are required; use **HTTP 301** if minimizing infrastructure compute costs is the top priority.

---

### Deep Dive 4: Click Analytics Ingestion Pipeline
Never write analytics directly into the primary URL database. Direct writes will overwhelm the relational database with 8,000+ writes/sec.
1. When redirecting a user, the application server asynchronously pushes a click event to an **Apache Kafka** topic:
   ```json
   { "shortCode": "7bX9qA", "timestamp": 1710000000, "ip": "10.0.1.2", "referer": "twitter.com" }
   ```
2. A stream processor (Flink or Kafka consumer group) reads events and writes them in batches into an OLAP columnar database (**ClickHouse** or **Amazon Redshift**).
3. Analytics dashboards query ClickHouse, leaving the primary operational database 100% unencumbered.

---

## 7. Important Rules

1. **Never Re-Hash Long URLs to Handle Duplicates**: If User A and User B both shorten `google.com`, give them **two distinct short codes**. Trying to detect duplicate long URLs requires indexing the 500-character `original_url` column, causing massive index bloat and privacy leaks (User A could see User B's analytics).
2. **Prevent Cache Thrashing with Allkeys-LRU**: Configure Redis with `maxmemory-policy allkeys-lru`. If memory fills, Redis automatically evicts the least recently requested short URLs, keeping the most active links in RAM.
3. **Guard Against Malicious Phishing Redirects**: Attackers love URL shorteners to mask phishing sites. Integrate an asynchronous security worker that checks destination URLs against Google Safe Browsing API or VirusTotal, instantly disabling malicious short codes.
4. **Custom Vanity Alias Collision Handling**: If a user requests a custom alias (`/my-portfolio`), perform a transactional database check:
   ```sql
   INSERT INTO urls (short_code, original_url) VALUES ('my-portfolio', '...')
   ON CONFLICT (short_code) DO NOTHING;
   ```
   If the insert returns 0 rows, return `HTTP 409 Conflict: Custom alias already taken`.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Generating Short URLs with `Math.random()`
```typescript
// ❌ AMATEUR MISTAKE: Generates collisions after a few thousand URLs!
const shortCode = Math.random().toString(36).substring(2, 9);
```

### 2. Auto-Incrementing DB IDs Directly Exposed
Using a standard PostgreSQL `SERIAL` auto-incrementing ID ($1, 2, 3$) encoded directly into Base62. Attackers can trivially enumerate and scrape every single URL in your database by incrementing the short code (`/0000001`, `/0000002`).
*Remediation*: Use pseudo-randomized Snowflake IDs or bit-permutation feistel ciphers to obfuscate sequence ordering.

---

## 9. Best Practices

- **Warm the Edge Cache**: For high-profile enterprise customers, push newly created short codes directly to Cloudflare KV / AWS CloudFront edge functions to enable true single-digit millisecond redirects globally.
- **Connection Draining on Redirects**: Return `Connection: keep-alive` on 302 redirects to allow client browsers to reuse TCP sockets.

---

## 10. Performance Considerations

- **Redis Memory Optimization**: Store URLs in Redis using a raw string key: `SET url:7bX9qA "https://example.com" EX 86400`. Redis can perform over 100,000 `GET` commands per second per core, resolving redirects in under 0.5ms.

---

## 11. Security Considerations

- **Rate Limiting URL Creation**: Limit unauthenticated IP addresses to 10 URL shortening requests per minute to prevent spammers from exhausting the token space or flooding storage.

---

## 12. Trade-offs Summary Matrix

| Architectural Choice | Option A | Option B | Selected Choice & Rationale |
| :--- | :--- | :--- | :--- |
| **Encoding Strategy** | MD5 Truncation | Base62 Bijective Counter | **Base62**: Zero hash collisions; mathematical guarantee |
| **Redirection Code** | HTTP 301 (Permanent) | HTTP 302 (Temporary) | **HTTP 302**: Guarantees 100% analytics capture |
| **Storage Architecture**| Single PostgreSQL Node | Sharded PostgreSQL + Redis | **Sharded + Redis**: Absorbs 8,000 QPS with sub-15ms latency |
| **Analytics Processing**| Direct SQL write | Kafka $\rightarrow$ ClickHouse | **Kafka $\rightarrow$ ClickHouse**: Decouples read/write load |

---

## 13. Real-World Usage Case Studies

1. **Bitly**: Manages over 100 billion clicks per year. Uses distributed token generators and custom key-value storage backed by SSDs and multi-tiered caching to sustain massive global redirection loads.
2. **t.co (Twitter URL Shortener)**: Automatically shortens every link posted on X/Twitter to protect users from malware and phishing attacks while measuring click engagement metrics.

---

## 14. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: How many unique short URLs can be represented using a 7-character Base62 string?**
> **Answer**: $62^7 = 3,521,614,606,208$ (approximately **3.52 Trillion** unique URLs).

### Tier 2: Conceptual
**Q: Why does truncating an MD5 hash to 7 characters cause collisions, and how does the Birthday Paradox apply?**
> **Answer**: MD5 produces a 128-bit hash (32 hexadecimal characters). If you take only the first 7 characters, you reduce the entropy to $16^7 \approx 268 \text{ Million}$ possible values. Under the **Birthday Paradox**, a 50% probability of collision occurs after only $\sqrt{268,000,000} \approx \mathbf{16,000 \text{ URLs}}$! Even if converted to Base62, taking a 7-character prefix from a cryptographic hash will inevitably trigger hash collisions, requiring repeated database collision lookups.

### Tier 3: Implementation
**Q: How do you implement a Snowflake-based 64-bit ID generator in TypeScript?**
*(Refer to Section 15 for full code implementation)*.

### Tier 4: Debugging
**Q: During peak hours, redirection latency spikes to 800ms. Redis CPU is at 100%, while database CPU is at only 15%. What is the cause?**
> **Answer**:
> The Redis cluster is suffering from a **Hot Key bottleneck** or **Single-Thread Saturation**:
> 1. A single viral short URL (e.g., a breaking news link) is receiving 50,000 requests/sec. Because all requests for that key hit a single Redis node, that node's single execution thread is 100% saturated.
> 2. **Fix**:
>    - Enable **Local In-Memory Caching** (LRU cache in application server RAM) to absorb the hottest 1,000 keys for 10 seconds before querying Redis.
>    - Configure **Edge CDN Caching** (Cloudflare/CloudFront) with a 5-second `s-maxage`.

### Tier 5: Scenario
**Q: How would you shard the URL Shortener database when storage exceeds 20 Terabytes?**
> **Answer**:
> 1. **Shard Key**: Shard horizontally using `hash(short_code) % N_shards`.
> 2. Because 100% of read queries filter by `short_code` (`SELECT original_url FROM urls WHERE short_code = $1`), the router directly maps each incoming request to the exact physical shard containing that record in $O(1)$ time.
> 3. Zero cross-shard joins or scatter-gather queries are needed.

### Tier 6: Advanced
**Q: How do you handle link expiration and database pruning for 6 Billion records without locking tables or degrading redirection performance?**
> **Answer**:
> Never run a monolithic `DELETE FROM urls WHERE expires_at < NOW();`! A massive delete query will acquire table locks, bloat the transaction log, and freeze reads.
> **Production Pruning Architecture**:
> 1. **Lazy Expiration on Read**: When a user visits an expired URL, check `if (record.expires_at < Date.now())`. If expired, delete the key from cache, return `HTTP 410 Gone`, and enqueue a background delete event.
> 2. **Partition Dropping**: Partition the database tables by month based on `expires_at` (`PARTITION BY RANGE (expires_at)`). When a month ends, drop the entire table partition instantly via `DROP TABLE urls_expired_2026_02;`. Dropping a partition is an instantaneous metadata operation that incurs zero row-locking overhead.

---

## 15. Coding Question: Complete Snowflake ID Generator & Base62 Shortener in TypeScript

### Problem
Implement a standalone, thread-safe `SnowflakeIdGenerator` that generates unique 64-bit BigInt IDs, and combine it with a `UrlShortenerService` that encodes the ID to a Base62 short alias.

### Solution

```typescript
export class SnowflakeIdGenerator {
  // Epoch: 2026-01-01T00:00:00.000Z
  private readonly EPOCH = 1767225600000n;
  private readonly MACHINE_ID_BITS = 10n;
  private readonly SEQUENCE_BITS = 12n;

  private readonly MAX_MACHINE_ID = -1n ^ (-1n << this.MACHINE_ID_BITS); // 1023
  private readonly MAX_SEQUENCE = -1n ^ (-1n << this.SEQUENCE_BITS);     // 4095

  private machineId: bigint;
  private sequence: bigint = 0n;
  private lastTimestamp: bigint = -1n;

  constructor(machineId: number) {
    if (machineId < 0 || BigInt(machineId) > this.MAX_MACHINE_ID) {
      throw new Error(`Machine ID must be between 0 and ${this.MAX_MACHINE_ID}`);
    }
    this.machineId = BigInt(machineId);
  }

  public nextId(): bigint {
    let currentTimestamp = BigInt(Date.now());

    if (currentTimestamp < this.lastTimestamp) {
      throw new Error('Clock moved backwards! Refusing to generate ID.');
    }

    if (currentTimestamp === this.lastTimestamp) {
      // Increment sequence within the same millisecond
      this.sequence = (this.sequence + 1n) & this.MAX_SEQUENCE;
      if (this.sequence === 0n) {
        // Sequence exhausted, wait for next millisecond
        while (currentTimestamp <= this.lastTimestamp) {
          currentTimestamp = BigInt(Date.now());
        }
      }
    } else {
      this.sequence = 0n;
    }

    this.lastTimestamp = currentTimestamp;

    // Bit-shift construction: [Timestamp (41 bits)] [MachineID (10 bits)] [Sequence (12 bits)]
    return (
      ((currentTimestamp - this.EPOCH) << (this.MACHINE_ID_BITS + this.SEQUENCE_BITS)) |
      (this.machineId << this.SEQUENCE_BITS) |
      this.sequence
    );
  }
}

export class UrlShortenerService {
  private static readonly CHARSET =
    '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  private idGenerator: SnowflakeIdGenerator;

  constructor(machineId: number = 1) {
    this.idGenerator = new SnowflakeIdGenerator(machineId);
  }

  public generateShortCode(): string {
    const uniqueId = this.idGenerator.nextId();
    return this.toBase62(uniqueId);
  }

  private toBase62(num: bigint): string {
    let value = num;
    const base = BigInt(UrlShortenerService.CHARSET.length);
    const chars: string[] = [];

    while (value > 0n) {
      const rem = Number(value % base);
      chars.push(UrlShortenerService.CHARSET[rem]);
      value = value / base;
    }

    const encoded = chars.reverse().join('');
    // Pad to 7 characters with leading '0' if needed
    return encoded.padStart(7, '0');
  }
}

// ==========================================
// Demonstration
// ==========================================
const shortener = new UrlShortenerService(42); // Machine ID 42
console.log('Short Code 1:', shortener.generateShortCode());
console.log('Short Code 2:', shortener.generateShortCode());
console.log('Short Code 3:', shortener.generateShortCode());
```

---

## 16. Common Interview Traps

- **Trap 1**: Suggesting MD5 and claiming "we'll just append a number if there's a collision".
  *Gotcha*: Under high traffic, having to retry database inserts due to hash collisions destroys write throughput and adds unpredictable latency. Base62 ID encoding has **zero collisions by design**.
- **Trap 2**: Forgetting that 301 redirects are cached by browsers.
  *Gotcha*: If you use HTTP 301, the browser never hits your server again on repeat clicks. You cannot track analytics or change destination URLs. Always mention the 301 vs. 302 trade-off.
- **Trap 3**: Trying to store analytics in the relational database.
  *Gotcha*: 8,000+ reads/sec means 8,000 analytics events per second. Writing these synchronously into PostgreSQL will lock tables and crash the database. Decouple analytics via Kafka and ClickHouse.

---

## 17. Revision Summary

- **Scale Profile**: 100M writes/month $\rightarrow$ 40 writes/sec; 4,000 reads/sec (100:1 read-heavy); 3.6 TB storage over 5 years.
- **Core Algorithm**: Bijective **Base62 encoding** on a 64-bit **Snowflake ID** ($62^7 = 3.52 \text{ Trillion}$ combinations, zero collisions).
- **Caching**: 42GB Redis cluster (`allkeys-lru`) handles 80% of daily read traffic in $< 1\text{ms}$.
- **Redirection Trade-off**: 301 (low server load, zero repeat analytics) vs. 302 (higher server load, 100% analytics capture).
- **Partitioning**: Shard database horizontally on `short_code` for $O(1)$ point lookups.

---

## 18. Quick Reference

| Component | Technology Choice | Architectural Reason |
| :--- | :--- | :--- |
| **ID Generator** | Twitter Snowflake (64-bit) | Local in-memory generation; zero coordination |
| **Encoding** | Base62 (`[0-9a-zA-Z]`) | URL-safe, compact, zero collisions |
| **Caching** | Redis (`allkeys-lru`) | Sub-millisecond reads; auto-evicts cold links |
| **Primary DB** | PostgreSQL (Sharded by `short_code`)| Acid durability, high-speed B-Tree index |
| **Analytics Queue**| Apache Kafka | Decouples high-volume click logging |
| **Analytics DB** | ClickHouse / Redshift | Columnar aggregation for geographic reports |
