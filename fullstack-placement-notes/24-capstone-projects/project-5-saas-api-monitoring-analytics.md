# Capstone Project 5: High-Throughput SaaS Monitoring & Analytics Engine (Datadog / PostHog Clone)

## 1. What is it?
A **High-Throughput SaaS Monitoring & Analytics Engine** (exemplified by PostHog, Datadog, Mixpanel, and Amplitude) is a cloud-scale data ingestion and analytics platform designed to collect, process, buffer, and analyze hundreds of millions of time-series telemetry events, API metrics, and user interaction analytics daily.

In elite technical interviews, this capstone project demonstrates mastery of **Big Data Engineering, OLAP Columnar Databases, and High-Throughput Ingestion Pipelines**:
1. **Lightweight Client SDK with In-Memory Batching**: An embeddable SDK that captures events in real time, buffers them in client memory, and flushes them in batches to minimize mobile battery and network overhead.
2. **High-Throughput Ingestion Gateway**: A stateless, ultra-fast API gateway capable of ingesting 50,000+ events/sec, performing Zod validation, and publishing to a distributed buffer (**Apache Kafka / Redis Streams**) in $< 5\text{ms}$.
3. **Columnar OLAP Storage (ClickHouse / TimescaleDB)**: Utilizing columnar storage engines (**ClickHouse MergeTree**) to execute complex analytical aggregations (e.g., calculating p99 latency across 100 million records) in milliseconds.
4. **Real-Time Interactive Analytics Dashboard**: Querying time-series trends, user conversion funnels, and retention retention curves with sub-second dashboard rendering.

```
                    HIGH-THROUGHPUT ANALYTICS PIPELINE
                    
 [ Client SDKs / Mobile / Web Apps ]
         │ 1. Batched HTTP POST /api/v1/events (100 events/batch)
         ▼
 ┌────────────────────────────────────────────────────────┐
 │ Ingestion API Gateway Fleet (Node.js / Go)             │
 │ • Authenticates API Write Key                          │
 │ • Enforces Ingestion Rate Limits                       │
 └──────────────────────┬─────────────────────────────────┘
                        │ 2. Asynchronous Stream Ingestion (< 5ms)
                        ▼
 ┌────────────────────────────────────────────────────────┐
 │ Distributed Event Buffer: Apache Kafka / Redis Streams │
 │ Topic: `analytics.raw_events` (32 Partitions)          │
 └──────────────────────┬─────────────────────────────────┘
                        │ 3. Batch Consumer Fleet (5,000 events/batch)
                        ▼
 ┌────────────────────────────────────────────────────────┐
 │ Ingestion Workers (ETL & GeoIP Enrichment)             │
 └──────────────────────┬─────────────────────────────────┘
                        │ 4. Bulk Block Insert (High Throughput)
                        ▼
 ┌────────────────────────────────────────────────────────┐
 │ Columnar OLAP Database: ClickHouse (MergeTree Engine)  │
 │ • Partition by: `toYYYYMM(timestamp)`                  │
 │ • Primary Sort Key: `(project_id, event_name, time)`   │
 └──────────────────────┬─────────────────────────────────┘
                        │ 5. Analytical SQL Queries (< 50ms)
                        ▼
 ┌────────────────────────────────────────────────────────┐
 │ Web Analytics Dashboard (React + Apache ECharts)       │
 └────────────────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Attempting to build an analytics or monitoring platform using traditional relational databases (PostgreSQL or MySQL) results in total infrastructure collapse under volume:

1. **The Row-Store Bottleneck**: In a relational row-oriented database (PostgreSQL), all columns of a row are stored together on disk. When running an analytical query like: *"Calculate average response time for checkout over the last 30 days"*, PostgreSQL must read the **entire row** (including large JSON payloads and user agents) from disk for millions of records, exhausting disk I/O.
2. **Single-Insert Write Saturation**: Inserting events one-by-one (`INSERT INTO events VALUES (...)`) at 20,000 QPS overloads the database transaction engine. High-throughput databases require **bulk block writes** (writing 5,000 events in a single operation).
3. **The Unbounded Storage Expansion**: Uncompressed JSON logs grow by hundreds of gigabytes daily. A columnar database compresses similar column values using specialized algorithms (ZSTD, Double-Delta, Gorilla), achieving **80% to 90% storage compression**.
4. **Client Network Flooding**: If a client app makes a network request for every single mouse click or page view, the user’s mobile data and battery drain rapidly. Client-side memory batching is essential.

---

## 3. Mental Model
Think of the analytics pipeline like a city municipal recycling system:
- **Client SDK** is the recycling bin in your home: you don't drive to the city dump every time you throw away an empty soda can; you collect cans in the bin (client batching).
- Once a week, the municipal garbage truck collects the full bin (batch upload).
- The recycling facility sorts materials by category (plastic, glass, paper) into deep organized silos (Columnar storage).
- When a glass factory needs 500 tons of glass, they scoop directly from the glass silo without digging through mountains of food waste and cardboard (Columnar query scanning only the queried metric column).

---

## 4. Basic Example: OLTP (Row-Oriented) vs. OLAP (Columnar)

```
 ROW-STORE (PostgreSQL - OLTP)         COLUMN-STORE (ClickHouse - OLAP)
 ┌─────────────────────────────────┐   ┌─────────────────────────────────────────┐
 │ Row 1: [Time, Event, Latency, IP]│   │ Timestamp Column: [T1, T2, T3, T4, T5]  │
 │ Row 2: [Time, Event, Latency, IP]│   │ Event Column:     [E1, E2, E3, E4, E5]  │
 │ Row 3: [Time, Event, Latency, IP]│   │ Latency Column:   [20, 45, 12, 85, 30]  │ ◄── Only this column read!
 └─────────────────────────────────┘   │ IP Column:        [IP1, IP2, IP3, IP4]  │
 • Great for finding 1 user's profile. └─────────────────────────────────────────┘
 • Terrible for aggregations (reads     • Analyzes 100M rows in 15ms!
   all columns off disk).              • 90% disk compression on similar data.
```

---

## 5. Real Example: ClickHouse Columnar Schema & Production Ingestion Client SDK

### A. Production ClickHouse DDL (`schema.sql`)
```sql
CREATE DATABASE IF NOT EXISTS analytics;

-- ClickHouse MergeTree Table Engine
CREATE TABLE analytics.events (
    project_id UUID,
    event_name LowCardinality(String), -- LowCardinality optimizes strings using dictionary encoding!
    timestamp DateTime64(3, 'UTC'),
    user_id String,
    session_id UUID,
    duration_ms UInt32,
    http_status UInt16,
    properties String, -- JSON string payload
    ip_address IPv4
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp) -- Partitions data by month for efficient retention pruning
ORDER BY (project_id, event_name, timestamp) -- Primary Sort Key for lightning-fast range scans!
SETTINGS index_granularity = 8192;

-- High-Performance Aggregation Query: P95 Latency & Total Volume by Route
SELECT 
    event_name,
    count() AS total_requests,
    quantile(0.95)(duration_ms) AS p95_latency_ms,
    countIf(http_status >= 500) AS total_server_errors
FROM analytics.events
WHERE project_id = '7f8b9c0d-1234-5678-9abc-def012345678'
  AND timestamp >= now() - INTERVAL 24 HOUR
GROUP BY event_name
ORDER BY total_requests DESC
LIMIT 50;
```

### B. Production Client Ingestion SDK (`tracker-sdk.ts`)
This embeddable SDK batches events in memory, automatically flushing when either **100 events accumulate** or **2 seconds elapse**, and uses the browser's `navigator.sendBeacon` API to guarantee delivery on page unload.

```typescript
// tracker-sdk.ts
export interface EventPayload {
  eventName: string;
  durationMs?: number;
  httpStatus?: number;
  properties?: Record<string, any>;
}

export class AnalyticsTracker {
  private writeKey: string;
  private endpoint: string;
  private queue: Array<any> = [];
  private flushTimer: any = null;
  private readonly maxBatchSize = 100;
  private readonly flushIntervalMs = 2000;

  constructor(writeKey: string, endpoint = 'https://ingest.mycompany.com/api/v1/events') {
    this.writeKey = writeKey;
    this.endpoint = endpoint;

    // Listen to browser unload to flush remaining events via Beacon API
    if (typeof window !== 'undefined') {
      window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
          this.flushBeacon();
        }
      });
    }
  }

  /**
   * Tracks an event into the local memory buffer
   */
  track(event: EventPayload) {
    const enrichedEvent = {
      ...event,
      timestamp: new Date().toISOString(),
      sessionId: this.getSessionId(),
    };

    this.queue.push(enrichedEvent);

    // If batch size threshold is reached, flush immediately
    if (this.queue.length >= this.maxBatchSize) {
      this.flush();
    } else if (!this.flushTimer) {
      // Otherwise, set a timer to flush in 2000ms
      this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  /**
   * Asynchronously flushes the batch to the Ingestion Gateway
   */
  async flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.queue.length === 0) return;

    const batch = [...this.queue];
    this.queue = [];

    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Write-Key': this.writeKey,
        },
        body: JSON.stringify({ events: batch }),
      });
    } catch (err: any) {
      console.warn('[ANALYTICS FLUSH FAILED]: Re-queueing batch:', err.message);
      // Re-queue un-sent events (up to a safe ceiling of 500 items)
      this.queue = [...batch.slice(0, 500), ...this.queue];
    }
  }

  /**
   * Uses navigator.sendBeacon to ensure data is transmitted when tab is closed
   */
  private flushBeacon() {
    if (this.queue.length === 0 || !navigator.sendBeacon) return;

    const payload = JSON.stringify({
      writeKey: this.writeKey,
      events: this.queue,
    });

    navigator.sendBeacon(this.endpoint + '/beacon', payload);
    this.queue = [];
  }

  private getSessionId(): string {
    return 'sess_' + Math.random().toString(36).slice(2);
  }
}
```

---

## 6. Under the Hood: ClickHouse MergeTree Engine & Vectorized Execution

### A. The MergeTree Compaction Mechanism
Why is ClickHouse able to ingest 500,000 writes per second without locking?
1. **LSM-Tree Style Append**: Writes are appended to disk in temporary data blocks called **Parts**.
2. **Asynchronous Background Merging**: In the background, ClickHouse merges multiple smaller parts into larger sorted parts, removing deleted data and organizing records according to the `ORDER BY (project_id, event_name, timestamp)` key.
3. **Zero In-Place Updates**: Because data is immutable, there are zero row locks, eliminating write contention entirely.

### B. SIMD Vectorized Execution
When calculating `quantile(0.95)(duration_ms)`:
- Traditional databases process data row-by-row through interpreted loops.
- ClickHouse processes data in **Vectors (arrays of 65,536 integers at once)** using CPU **SIMD (Single Instruction, Multiple Data)** registers (AVX-512). A single CPU clock cycle computes operations across 16 numbers simultaneously, allowing ClickHouse to crunch 1 billion rows per second per server.

---

## 7. Important Rules

1. **NEVER Execute Single-Row Inserts into ClickHouse**:
   Executing individual `INSERT INTO events VALUES (...)` statements for every incoming HTTP request will generate thousands of tiny parts per second, leading to the dreaded ClickHouse error: `Too many parts in all data in table`. Always buffer events in memory or Kafka and insert in **bulk batches of 5,000 to 10,000 rows**.
2. **Sort Key Ordering Priority Matters**:
   ClickHouse orders data on disk based on the `ORDER BY` tuple. The most frequently filtered column with the lowest cardinality should be placed **first**:
   `ORDER BY (project_id, event_name, timestamp)`
   Queries filtering by `project_id` and `event_name` will skip 99% of disk blocks using binary search in the index.
3. **Use `navigator.sendBeacon()` for Page Leave Events**:
   Standard `fetch()` requests are often aborted by browsers when a user closes a tab. Always use `navigator.sendBeacon()` in client SDKs for reliable session end tracking.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Ingesting Unvalidated Client Payloads Directly into the Stream
Allowing arbitrary client SDK payloads to enter Kafka without validating types.
**Impact**: Malformed payloads (e.g., passing a string for `duration_ms` instead of an integer) cause background batch consumers to crash or fail bulk ClickHouse inserts. Validate strictly using **Zod** at the API Gateway.

### 2. Putting Dynamic High-Cardinality Strings into `LowCardinality`
Using `LowCardinality(String)` for unique User IDs or UUIDs.
`LowCardinality` creates a dictionary mapping strings to integers. If you store 50 million unique strings, the dictionary consumes gigabytes of RAM. `LowCardinality` is strictly for finite enums (e.g., `event_name`, `country_code`, `http_method`).

---

## 9. Best Practices

- **Automated Data Retention & Partition Dropping**:
  Instead of running expensive `DELETE FROM events WHERE timestamp < ...` (which rewrites tables), drop entire historical month partitions instantaneously with zero I/O cost:
  ```sql
  ALTER TABLE analytics.events DROP PARTITION 202501;
  ```
- **Dead Letter Queue (DLQ) for Malformed Batches**:
  If a batch insert into ClickHouse fails due to an unexpected schema mismatch, route the failed batch to a dead-letter queue (`analytics.failed_events`) for investigation without blocking the main Kafka consumer stream.

---

## 10. Performance Considerations

- **Compression Algorithm Selection**: Use **ZSTD** for string properties and **DoubleDelta** for monotonic timestamps. DoubleDelta compresses timestamps down to 1–2 bits per row.
- **Connection Multiplexing via Native ClickHouse TCP Protocol**: When inserting bulk batches from Node.js workers, use the native ClickHouse TCP protocol driver (`@clickhouse/client`) rather than HTTP for 30% higher throughput.

---

## 11. Security Considerations

- **Write-Only Ingestion API Keys**: Issue distinct `Write-Only API Keys` for client SDKs. Client-facing write keys have permission exclusively to insert events; they cannot read, query, or view analytics data.
- **Tenant Isolation in Analytical Queries**: Enforce `WHERE project_id = $authenticatedProjectId` at the database middleware layer to prevent cross-tenant data leakage.

---

## 12. Alternatives

| Technology | Storage Architecture | Query Speed (100M Rows) | Write Throughput |
|---|---|---|---|
| **ClickHouse** | Columnar (OLAP) | **Sub-50ms (Lightning)** | **Extremely High (>500k/s)** |
| **TimescaleDB** | Relational Hypertable | Moderate (500ms – 2s) | High (~50k/s) |
| **Elasticsearch** | Inverted Index | Good for text; poor for math | Moderate (~20k/s) |
| **PostgreSQL** | Row-Store (OLTP) | Slow (>10s / Timeout) | Low (<5k/s) |

---

## 13. Trade-offs

- **ClickHouse vs. PostgreSQL**:
  ClickHouse delivers 100x faster analytical aggregations and 90% better compression than PostgreSQL, but does not support traditional multi-row ACID transactions or foreign key constraints. In enterprise architectures, teams use **PostgreSQL for transactional entities** (users, billing, projects) and **ClickHouse for event telemetry**.

---

## 14. Real-World Usage & Implementation Example: Ingestion Gateway & Batch Consumer

Here is a complete, production-grade **Ingestion Gateway** and **Kafka Batch Writer**:

```typescript
// ingestion-service.ts
import express from 'express';
import { z } from 'zod';
import { createClient } from '@clickhouse/client';

const app = express();
app.use(express.json({ limit: '5mb' }));

// 1. Strict Event Ingestion Schema
const EventItemSchema = z.object({
  eventName: z.string().min(1).max(100),
  timestamp: z.string().datetime(),
  userId: z.string().default('anonymous'),
  sessionId: z.string().uuid(),
  durationMs: z.number().int().nonnegative().default(0),
  httpStatus: z.number().int().min(100).max(599).default(200),
  properties: z.record(z.any()).optional().default({}),
});

const IngestionBatchSchema = z.object({
  events: z.array(EventItemSchema).min(1).max(500),
});

// 2. ClickHouse Client
const clickhouse = createClient({
  host: process.env.CLICKHOUSE_HOST || 'http://localhost:8123',
  username: 'default',
  password: '',
  database: 'analytics',
});

// In-Memory Bulk Write Buffer (Flushed every 5,000 rows or 3 seconds)
let writeBuffer: any[] = [];
let lastFlush = Date.now();

async function flushBufferToClickHouse() {
  if (writeBuffer.length === 0) return;

  const rowsToInsert = [...writeBuffer];
  writeBuffer = [];
  lastFlush = Date.now();

  try {
    await clickhouse.insert({
      table: 'events',
      values: rowsToInsert,
      format: 'JSONEachRow',
    });
    console.log(`[CLICKHOUSE FLUSH]: Successfully bulk-inserted ${rowsToInsert.length} events.`);
  } catch (err: any) {
    console.error('[CLICKHOUSE BULK INSERT FAILED]:', err.message);
  }
}

// Background buffer flush timer
setInterval(() => {
  if (writeBuffer.length > 0 && Date.now() - lastFlush >= 3000) {
    flushBufferToClickHouse();
  }
}, 1000);

// 3. Fast Ingestion Endpoint
app.post('/api/v1/events', async (req, res) => {
  const writeKey = req.headers['x-write-key'] as string;
  if (!writeKey) {
    return res.status(401).json({ error: 'Missing X-Write-Key header' });
  }

  const parsed = IngestionBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Schema validation error', details: parsed.error.issues });
  }

  const projectId = '7f8b9c0d-1234-5678-9abc-def012345678'; // Lookup project by writeKey

  // Push events to in-memory buffer
  for (const item of parsed.data.events) {
    writeBuffer.push({
      project_id: projectId,
      event_name: item.eventName,
      timestamp: item.timestamp.replace('T', ' ').replace('Z', ''),
      user_id: item.userId,
      session_id: item.sessionId,
      duration_ms: item.durationMs,
      http_status: item.httpStatus,
      properties: JSON.stringify(item.properties),
      ip_address: req.ip === '::1' ? '127.0.0.1' : req.ip,
    });
  }

  // If buffer exceeds 5,000 items, trigger immediate flush
  if (writeBuffer.length >= 5000) {
    flushBufferToClickHouse();
  }

  // Return HTTP 202 Accepted immediately (< 5ms response time!)
  return res.status(202).json({ accepted: parsed.data.events.length });
});

app.listen(4000, () => console.log('[INGESTION GATEWAY]: Running on port 4000'));
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: What is the fundamental difference between an OLTP database and an OLAP database?
**Answer**:
- **OLTP (Online Transaction Processing - e.g., PostgreSQL, MySQL)**: Row-oriented databases optimized for fast, transactional reads and writes of individual rows (e.g., fetching a user profile, checking an order status). They enforce ACID guarantees, foreign keys, and low-latency row locks.
- **OLAP (Online Analytical Processing - e.g., ClickHouse, Snowflake)**: Columnar databases optimized for aggregating millions of rows across a few specific columns (e.g., calculating average latency, counting unique users). Because data is stored column-by-column, queries only read the specific columns requested from disk, executing mathematical aggregations at billions of rows per second.

### 2. Conceptual: Why does ClickHouse crash if you insert events one row at a time?
**Answer**:
ClickHouse's MergeTree engine is an immutable append-only storage engine. Every `INSERT` statement creates a new physical **data part** on disk containing compressed column files and index files.
- If you execute 1,000 single-row `INSERT` statements per second, ClickHouse creates 1,000 distinct directory parts every second.
- ClickHouse's background thread must merge these parts together. It cannot merge parts as fast as you create them.
- Within seconds, the number of unmerged parts exceeds the safety limit (default 300), and ClickHouse halts all writes with the error: **`Too many parts in all data in table`**. 
- **Rule**: Writes must be batched into chunks of **5,000 to 10,000 rows** per insert.

### 3. Implementation: How does the client-side Analytics SDK ensure events are not lost when a user navigates away or closes a tab?
**Answer**:
By utilizing the browser's **`navigator.sendBeacon()` API**:
1. When a browser tab is closing (`visibilitychange` event with `document.visibilityState === 'hidden'`), standard asynchronous `fetch()` requests are often killed by the browser before the network connection establishes.
2. `navigator.sendBeacon(url, data)` instructs the browser to queue the data in the background operating system network process.
3. The browser transmits the POST request asynchronously even after the tab and JavaScript context have completely terminated, guaranteeing delivery.

### 4. Debugging: A ClickHouse aggregation query is taking 8 seconds instead of 50ms. How do you optimize it?
**Answer**:
1. **Inspect Query Execution Plan**: Run `EXPLAIN actions SELECT ...` to see how many disk blocks (granules) were scanned.
2. **Check Primary Key Sorting Alignment**: Ensure the query's `WHERE` clause filters on the first column of the table's `ORDER BY` key. If the table is ordered by `(project_id, event_name, timestamp)`, querying by `timestamp` alone forces ClickHouse to scan all data parts sequentially.
3. **Verify Column Types**: Replace unbounded `String` columns with `LowCardinality(String)` for categorical fields like `event_name` or `country`, which allows ClickHouse to perform comparisons over dictionary integers rather than raw strings.

### 5. Scenario: How do you design tenant isolation in a multi-tenant analytics SaaS platform?
**Answer**:
1. **Primary Sort Key Indexing**: Include `project_id` (or `tenant_id`) as the very first column in the ClickHouse `ORDER BY (project_id, event_name, timestamp)` clause. Because data is physically sorted by `project_id`, ClickHouse's sparse index locates a tenant's data in $O(\log N)$ time, skipping all other tenants' blocks.
2. **Row-Level Security (RLS)**: Enforce `WHERE project_id = :authenticatedProjectId` inside the backend API query builder before forwarding queries to ClickHouse.
3. **Virtual Partitioning / Quotas**: Use ClickHouse Quotas to limit CPU and memory usage per user to prevent one noisy tenant from monopolizing the analytics cluster.

### 6. Advanced: What is ClickHouse's "Sparse Primary Index", and how does it differ from a PostgreSQL B-Tree index?
**Answer**:
- **PostgreSQL B-Tree Index (Dense Index)**: Contains an entry for **every single row** in the table. If you have 100 million rows, the B-Tree index has 100 million index pointers, consuming gigabytes of memory.
- **ClickHouse Sparse Index**: Indexes only **one row out of every 8,192 rows** (called an **Index Granule**). 
  - For a table with 100 million rows, the sparse index contains only $\approx 12,207$ entries!
  - The entire primary index fits easily into a few megabytes of RAM.
  - When querying, ClickHouse uses the sparse index to identify which 8,192-row granules could contain matching data, completely skipping unneeded disk blocks without the RAM overhead of a dense index.

---

## 16. Coding Questions & Practical Challenges

1. **Buffer Flush Queue Class**: Implement a generic TypeScript `BatchBuffer<T>` class with `add()`, `flush()`, maximum batch size threshold, and debounce timeout controls.
2. **ClickHouse Funnel Query**: Write an analytical ClickHouse SQL query using the `windowFunnel()` function that measures the conversion percentage of users who performed: `PageView` $\rightarrow$ `AddToCart` $\rightarrow$ `Checkout` within a 1-hour window.
3. **Express Rate Limiter for Ingestion**: Write an Express middleware using Redis Token Bucket that limits write keys to 500 requests per second while permitting burst buffers.

---

## 17. Common Interview Traps

- **Trap 1: Using ClickHouse as the primary user database**: ClickHouse is an analytical powerhouse, but it does not support point lookups by primary key with ACID multi-row transactions. Never store user authentication passwords or shopping carts in ClickHouse; use PostgreSQL for transactional data and ClickHouse for event analytics.
- **Trap 2: Forgetting to handle client ad-blockers**: Modern ad-blockers block requests to third-party domains like `api.mixpanel.com`. In your architecture, explain that your ingestion API uses a **first-party reverse proxy domain** (`ingest.yourcompany.com`) to prevent legitimate product analytics from being blocked by browser extensions.
- **Trap 3: Running `ALTER TABLE DELETE` continuously**: In ClickHouse, `ALTER TABLE DELETE` is a heavy mutation that rewrites entire data parts on disk. It should be used sparingly for GDPR compliance, never for routine real-time deletions.

---

## 18. Revision Summary

- **Architecture Principle**: Decouple high-speed ingestion via client batching and Kafka buffers; write in bulk to a columnar database (ClickHouse).
- **OLAP Superpower**: Columnar storage compresses data by 90% and uses CPU SIMD vectorization to aggregate 100 million events in milliseconds.
- **ClickHouse Rule**: Always bulk-insert in batches of 5,000+ rows; order tables by `(project_id, event_name, timestamp)`.
- **Client Resilience**: Use `navigator.sendBeacon()` to ensure tracking events are not dropped during tab closure.

---

## 19. Quick Reference Cheatsheet

```sql
-- ClickHouse MergeTree Table Definition Skeleton
CREATE TABLE analytics.events (
    project_id UUID,
    event_name LowCardinality(String),
    timestamp DateTime64(3, 'UTC'),
    user_id String,
    duration_ms UInt32
) ENGINE = MergeTree()
PARTITION BY toYYYYMM(timestamp)
ORDER BY (project_id, event_name, timestamp);

-- ClickHouse Quantile (P99 Latency) Syntax
SELECT quantile(0.99)(duration_ms) FROM analytics.events;

-- Instant Partition Drop (Free Data Retention)
ALTER TABLE analytics.events DROP PARTITION 202401;
```
