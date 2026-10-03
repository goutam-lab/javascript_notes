# Database, SQL & NoSQL Placement Interview Mastery Guide

---

## 1. What is it?

Database, SQL, and NoSQL interview mastery encompasses the theoretical and operational knowledge required to design, query, optimize, and scale persistent storage systems in high-stakes software engineering interviews. Tier-1 product companies (Google, Amazon, Meta, Uber, Stripe) do not merely evaluate if a candidate can write basic `SELECT` queries or insert documents into MongoDB. Interviewers rigorously probe **B-Tree index traversal complexity**, **ACID transaction isolation anomalies**, **PostgreSQL MVCC (Multi-Version Concurrency Control) storage mechanics**, **query execution plans (`EXPLAIN ANALYZE`)**, **WiredTiger storage engine locking**, and **distributed database partitioning tradeoffs (CAP theorem)**.

```
+-----------------------------------------------------------------------------------+
|                        Database Placement Architecture Map                        |
+-----------------------------------------------------------------------------------+
| Relational Engine (PostgreSQL / MySQL)    | Document Store (MongoDB)             |
| - Relational Schema, Foreign Keys, 3NF    | - Flexible BSON documents, Embed/Ref |
| - ACID Transactions, Strict Isolation     | - Tunable Consistency (WiredTiger)   |
| - B-Tree Indexes, GIN/GiST, Hash          | - Compound, Multikey, Wildcard Index |
| - Joins: Nested Loop, Hash, Merge Join    | - Aggregation Pipeline ($facet, etc) |
| - Write-Ahead Logging (WAL)               | - Oplog Replication, Chunk Sharding  |
+-----------------------------------------------------------------------------------+
| Scaling Layer: Connection Pooling (PgBouncer) + Read Replicas + Table Partitioning|
+-----------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Software applications require persistence, but different workloads possess conflicting operational requirements:
1. **Financial and Transactional Systems:** Require strict consistency, data integrity, and deterministic multi-table guarantees where losing a debit or credit is catastrophic. Relational databases (PostgreSQL, MySQL) were built with ACID guarantees, mathematical relational algebra, and B-Tree indexing to ensure safety.
2. **High-Velocity Content & Hierarchical Documents:** In rapid-prototyping environments or semi-structured data stores (catalogs, analytics events, telemetry), rigid relational schemas require expensive migrations and complex multi-table joins. NoSQL document stores (MongoDB) exist to provide dynamic schemaless BSON documents, horizontal sharding out of the box, and localized data locality.

---

## 3. Mental Model

To master database interviews, visualize database engines through **Data Organization vs Retrieval Cost**:

```
[ INCOMING QUERY: SELECT * FROM orders WHERE user_id = 42 AND created_at > '2026-01-01' ]
                                  |
                                  v
                       [ Query Optimizer / Planner ]
                                  |
               +------------------+------------------+
               |                                     |
               v                                     v
       [ Sequential Scan ]                  [ Index Scan (B-Tree) ]
  - Reads every block on disk          - Root -> Branch -> Leaf pages
  - O(N) Disk I/O pages loaded         - O(log N) page traversal
  - Catastrophic for 10M rows          - Reads only matching Heap TIDs
               |                                     |
               +------------------+------------------+
                                  |
                                  v
                      [ Buffer Pool (Shared Buffers) ]
                      - Cache hit: 0.1ms RAM access
                      - Cache miss: 5.0ms SSD Disk Read
```

* **Relational Core Mental Model:** Tables are collections of unordered 8KB heap pages on disk. Indexes are sorted auxiliary B-Tree structures that map search keys to specific page offsets (`Tuple ID / TID`).
* **Document Core Mental Model:** Documents are self-contained BSON objects stored sequentially. Related data is either nested (embedding for 1:few) or linked (referencing for 1:many/many:many).

---

## 4. Basic Example

### Relational Schema vs MongoDB Document Structure

#### PostgreSQL Table Definition with Foreign Keys & Constraints
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    total_amount NUMERIC(12, 2) NOT NULL CHECK (total_amount >= 0),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_orders_user_status ON orders(user_id, status);
```

#### MongoDB Equivalent Document (Embedded Subdocument Pattern)
```json
{
  "_id": ObjectId("6501f1a2b3c4d5e6f7a8b9c0"),
  "email": "alex@enterprise.com",
  "createdAt": ISODate("2026-01-15T08:00:00Z"),
  "orders": [
    {
      "orderId": "ord_8819",
      "totalAmount": 149.50,
      "status": "COMPLETED",
      "createdAt": ISODate("2026-02-01T12:30:00Z")
    }
  ]
}
```

---

## 5. Real Example

### PostgreSQL Window Function with CTE vs MongoDB Aggregation Pipeline

#### Problem: Calculate running revenue and rank top customers per region.

```sql
-- PostgreSQL Production Window Analysis
WITH customer_revenue AS (
    SELECT 
        c.region,
        c.id AS customer_id,
        c.full_name,
        SUM(o.total_amount) AS total_spent
    FROM customers c
    INNER JOIN orders o ON c.id = o.customer_id
    WHERE o.status = 'PAID'
    GROUP BY c.region, c.id, c.full_name
)
SELECT 
    region,
    customer_id,
    full_name,
    total_spent,
    DENSE_RANK() OVER (PARTITION BY region ORDER BY total_spent DESC) as rank_in_region,
    SUM(total_spent) OVER (PARTITION BY region ORDER BY total_spent DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) as running_region_total
FROM customer_revenue;
```

```javascript
// MongoDB Aggregation Pipeline Equivalent
db.orders.aggregate([
  { $match: { status: "PAID" } },
  {
    $lookup: {
      from: "customers",
      localField: "customerId",
      foreignField: "_id",
      as: "customer"
    }
  },
  { $unwind: "$customer" },
  {
    $group: {
      _id: { region: "$customer.region", customerId: "$customer._id" },
      fullName: { $first: "$customer.fullName" },
      totalSpent: { $sum: "$totalAmount" }
    }
  },
  { $sort: { "_id.region": 1, totalSpent: -1 } },
  {
    $group: {
      _id: "$_id.region",
      topCustomers: {
        $push: {
          customerId: "$_id.customerId",
          fullName: "$fullName",
          totalSpent: "$totalSpent"
        }
      },
      regionTotalRevenue: { $sum: "$totalSpent" }
    }
  }
]);
```

---

## 6. Under the Hood

### PostgreSQL MVCC (Multi-Version Concurrency Control)
PostgreSQL handles concurrent reads and writes without locking tables using MVCC:
* When a row is inserted, it receives two hidden system attributes: `xmin` (the transaction ID that created the row) and `xmax` (the transaction ID that deleted or updated it, initially set to 0).
* When an `UPDATE` executes, PostgreSQL does **not** overwrite the existing row. It writes a **brand new row version** (tuple) with `xmin = current_tx`, and sets the old row's `xmax = current_tx`.
* A reading transaction inspects each row's `xmin` and `xmax` against its own active transaction snapshot to determine row visibility.
* Dead tuples accumulate on disk and must be periodically purged by the background **VACUUM** worker process to prevent table bloat.

### Transaction Isolation Levels & Concurrency Anomalies

| Isolation Level | Dirty Read | Non-Repeatable Read | Phantom Read | Serialization Anomaly |
| :--- | :--- | :--- | :--- | :--- |
| **Read Uncommitted** | Possible (in MySQL, not PG) | Possible | Possible | Possible |
| **Read Committed** (Default) | Prevented | Possible | Possible | Possible |
| **Repeatable Read** | Prevented | Prevented | Prevented (in PG via MVCC) | Possible (Write Skew) |
| **Serializable** | Prevented | Prevented | Prevented | Prevented |

---

## 7. Important Rules

1. **Leftmost Prefix Rule for Compound Indexes:** A B-Tree index on `(A, B, C)` can accelerate queries on `(A)`, `(A, B)`, and `(A, B, C)`. It CANNOT accelerate queries filtering *only* on `(B)` or `(C)` because the B-Tree is ordered by A first.
2. **Never Index Low-Cardinality Columns Alone:** Creating an index on a boolean column (`is_active` where values are 50% true and 50% false) is useless. The database query planner will ignore the index and perform a sequential scan because loading index blocks plus heap blocks is more expensive than scanning heap blocks directly.
3. **Always Parameterize Queries:** Never concatenate user input directly into SQL strings. Always use prepared statements (`$1, $2`) to guarantee SQL injection immunity.
4. **Foreign Keys Require Indexes:** Relational databases do *not* automatically create indexes on foreign key columns (unlike primary keys). Failing to index foreign keys causes full table locks during parent table `DELETE` or `UPDATE` cascades.

---

## 8. Common Mistakes

### Mistake 1: The N+1 Query Problem in ORMs
Fetching a list of 100 users, and then executing a separate `SELECT * FROM orders WHERE user_id = ?` query inside a loop for each user. This results in 101 database round-trips instead of 1 single query using `JOIN` or `WHERE user_id IN (...)`.

### Mistake 2: Using `SELECT *` in Production
Using `SELECT *` fetches unneeded columns, inflates network transfer size, prevents PostgreSQL from utilizing **Index-Only Scans** (where data is read directly from index leaf nodes without touching disk heap pages), and breaks apps if schemas add heavy `TEXT` or `JSONB` blobs.

### Mistake 3: Unbounded MongoDB Arrays
Embedding unbounded arrays inside a single MongoDB document (e.g., storing millions of sensor readings inside an IoT device document). In MongoDB, documents have a hard **16MB BSON limit**. Once exceeded, writes crash.

---

## 9. Best Practices

1. **Use Partial Indexes:** For sparse queries, create indexes with a `WHERE` clause:
   ```sql
   CREATE INDEX idx_unprocessed_orders ON orders(created_at) WHERE status = 'PENDING';
   ```
   This index is 95% smaller and lightning-fast because it completely ignores historical completed orders.
2. **Connection Pooling via PgBouncer:** PostgreSQL uses a process-per-connection architecture (each connection takes ~10MB RAM). Never open 5,000 raw connections directly to PostgreSQL. Place PgBouncer in front in `transaction pooling` mode.
3. **Covering Indexes:** Include frequently fetched columns in the index leaf nodes using the `INCLUDE` clause to achieve pure Index-Only scans:
   ```sql
   CREATE INDEX idx_users_email ON users(email) INCLUDE (full_name);
   ```
4. **Use Composite Primary Keys for Join Tables:** Avoid synthetic UUIDs on many-to-many join tables; use `PRIMARY KEY (user_id, role_id)`.

---

## 10. Performance Considerations

* **EXPLAIN (ANALYZE, BUFFERS):** Always check the execution plan. Look for:
  * `Seq Scan` on large tables (bad, missing index).
  * `Bitmap Index Scan` (good for reading multiple matching pages).
  * `Index Only Scan` (fastest, reads purely from RAM cache).
  * `Buffers: shared read=...` (disk reads) vs `shared hit=...` (cache hits).
* **Work Mem Allocation:** `work_mem` controls memory allocated for in-memory sorting and hash tables. If a complex query exceeds `work_mem`, PostgreSQL spills sorts to temporary disk files, causing a 100x latency spike.

---

## 11. Security Considerations

* **Row-Level Security (RLS):** In multi-tenant systems, use PostgreSQL Row-Level Security:
  ```sql
  ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation_policy ON documents 
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);
  ```
  This guarantees that even if a developer forgets a `WHERE tenant_id = ?` clause in backend code, the database kernel rejects unauthorized cross-tenant reads.
* **Principle of Least Privilege:** Web application connection pools should never connect as database superusers (`postgres`). Create restricted application roles with access strictly limited to necessary tables (`GRANT SELECT, INSERT, UPDATE ON orders TO app_user`).

---

## 12. Alternatives

| Database Type | Engines | Pros | Cons | Best Use Case |
| :--- | :--- | :--- | :--- | :--- |
| **Relational (RDBMS)** | PostgreSQL, MySQL | ACID compliance, strong consistency, rich joins, relational integrity | Harder to shard horizontally, rigid schemas | Financial systems, core transactional business data |
| **Document (NoSQL)** | MongoDB, CouchDB | Dynamic schemas, fast read/write of nested documents, auto-sharding | Eventual consistency tradeoffs, memory hungry, no multi-table join optimizations | Content catalogs, mobile app state, analytics events |
| **Key-Value** | Redis, Dragonfly | Sub-millisecond in-memory speed, complex data structures | RAM constrained, persistence requires disk snapshotting | Caching, session storage, real-time leaderboards |
| **Columnar / OLAP** | ClickHouse, Snowflake | Massive aggregation speeds on billions of rows (100x faster than PG) | Slow single-row inserts/updates, strictly for analytical queries | Data warehousing, business intelligence, event streaming |

---

## 13. Trade-offs

* **Normalization vs Denormalization:** Normalization (3NF) eliminates data redundancy and guarantees consistency during updates, but requires expensive multi-table `JOIN` operations at read time. Denormalization optimizes read latency by duplicating data, but introduces write amplification and the danger of inconsistent state if an update fails midway.
* **ACID vs BASE (Eventual Consistency):** ACID prioritizes immediate correctness over availability during network partitions (CP in CAP theorem). BASE prioritizes high availability and low latency, accepting that replicas may be momentarily stale.

---

## 14. Real-World Usage

* **Uber:** Uses PostgreSQL and MySQL partitioned tables, routing geospatial queries through custom indexing shards.
* **Discord:** Migrated from MongoDB to Cassandra and ultimately to ScyllaDB to handle trillions of messages with consistent low-latency writes and predictable disk compaction.

---

## 15. Placement Interview Questions

### Basic Level
1. **Explain the difference between clustered and non-clustered indexes.**
   * *Answer:* A clustered index determines the physical order of data rows on disk (a table can have only ONE clustered index, typically the Primary Key in MySQL InnoDB). A non-clustered index is a separate sorted structure (B-Tree) containing index keys and pointers (Row IDs or Primary Keys) back to the actual data rows on disk.

2. **What does ACID stand for? Explain each component.**
   * *Answer:*
     * *Atomicity:* An all-or-nothing guarantee. Either all operations in a transaction succeed and commit, or all are rolled back.
     * *Consistency:* Transactions transition the database from one valid state to another, strictly enforcing all constraints, foreign keys, and triggers.
     * *Isolation:* Concurrent transactions execute without interfering with one another, preventing dirty reads or race conditions depending on the isolation level.
     * *Durability:* Once a transaction commits, its modifications are permanently recorded on non-volatile storage (via Write-Ahead Log) even in the event of an immediate system crash or power outage.

3. **What is the difference between `WHERE` and `HAVING` in SQL?**
   * *Answer:* `WHERE` filters individual rows *before* any grouping or aggregation takes place. `HAVING` filters aggregated groups *after* the `GROUP BY` clause has evaluated group summaries.

4. **What are the primary differences between SQL (Relational) and NoSQL (Document)?**
   * *Answer:* SQL databases enforce structured tabular schemas, strict foreign key constraints, mathematical joins, and ACID compliance, scaling vertically or via read replicas. NoSQL databases offer flexible schemaless documents (JSON/BSON), scale horizontally through sharding, and prioritize fast read/write speeds over complex cross-table relational integrity.

5. **What is a database deadlock and how is it resolved?**
   * *Answer:* A deadlock occurs when two or more concurrent transactions hold locks on resources that the other transactions need to proceed (e.g., Tx1 locks Row A and waits for Row B; Tx2 locks Row B and waits for Row A). Neither can proceed. Databases run background deadlock detection algorithms that periodically inspect wait-for graphs, abort one of the transactions (the "victim"), rollback its changes, and return an error so the application can retry.

---

### Conceptual Level
6. **Why do databases use B-Trees instead of Binary Search Trees (BST) or Hash Tables for indexing?**
   * *Answer:*
     * *Versus BST:* A Binary Search Tree has low fan-out (each node has at most 2 children), resulting in high tree height ($O(\log_2 N)$). In disk storage, each tree level traversal requires an expensive disk seek. B-Trees have massive fan-out (hundreds of keys per node), keeping tree height to 3 or 4 levels for millions of rows.
     * *Versus Hash Tables:* Hash tables offer $O(1)$ lookups for exact matches (`WHERE id = 5`), but *cannot* support range queries (`WHERE age BETWEEN 20 AND 30`) or sorting (`ORDER BY created_at`), which B-Trees handle naturally in $O(\log N + K)$ time.

7. **Explain the Write-Ahead Log (WAL) and how it guarantees Durability.**
   * *Answer:* Modifying random data pages on disk is slow and expensive. When a transaction commits, changes are first appended sequentially to an append-only file called the Write-Ahead Log (WAL). Sequential disk writes are orders of magnitude faster than random writes. Once the WAL entry is safely flushed to disk (`fsync`), the transaction is marked committed. If the server crashes before dirty memory pages are written to the main table heap files, PostgreSQL replays the WAL log upon reboot to restore full state.

8. **What is the difference between `DELETE`, `TRUNCATE`, and `DROP`?**
   * *Answer:*
     * `DELETE`: DML command. Deletes specific rows matching a `WHERE` clause. Logs every deleted row in WAL, fires row-level triggers, and creates dead tuples that require VACUUM. Can be rolled back.
     * `TRUNCATE`: DDL command. Quickly removes all rows from a table by deallocating the underlying disk data pages. Minimal WAL logging, ignores row triggers, resets auto-increment counters, and is significantly faster than `DELETE`.
     * `DROP`: DDL command. Completely removes table data, indexes, constraints, triggers, and table metadata from the system catalog.

9. **Explain the three major join algorithms used by database query planners: Nested Loop, Hash Join, and Merge Join.**
   * *Answer:*
     1. *Nested Loop Join:* For every outer table row, scans the inner table. Optimal when the outer table is small and the inner table has an index on the join key.
     2. *Hash Join:* Builds an in-memory hash table on the join key of the smaller table, then streams the larger table probing the hash table. Best for large, unindexed equality joins.
     3. *Merge Join:* Both tables are sorted by the join key and scanned concurrently in lockstep. Fastest for massive datasets when both inputs are already sorted (e.g., via B-Tree index).

10. **What is Database Sharding and what challenges does it introduce?**
    * *Answer:* Sharding is the horizontal partitioning of a database across multiple independent physical servers using a shard key (e.g., `hash(user_id) % num_shards`).
    * *Challenges:*
      - Cross-shard joins are extremely slow or unsupported.
      - Distributed transactions require complex 2-Phase Commit (2PC) protocols.
      - Hotspot shards occur if the shard key is poorly distributed.
      - Re-sharding when adding new nodes requires migrating terabytes of live data.

---

### Implementation Level
11. **Write a SQL query to find the 3rd highest salary from an `employees` table without using `LIMIT` or `OFFSET`.**
    * *Answer:*
    ```sql
    SELECT salary 
    FROM (
        SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) as rank_pos
        FROM employees
    ) ranked
    WHERE rank_pos = 3
    FETCH FIRST 1 ROW ONLY;
    ```

12. **How do you safely migrate a 50-million-row production table to add a new non-null column with a default value without locking the table?**
    * *Answer:* In modern PostgreSQL (v11+), adding a column with a constant default value (`ALTER TABLE orders ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT false;`) is instant ($O(1)$) because PostgreSQL updates only the system catalog and does not rewrite table heap blocks.
    * For older engines or complex default functions:
      1. Add the column as nullable without default: `ALTER TABLE orders ADD COLUMN status VARCHAR(20);`
      2. Backfill existing rows in small batches (e.g., 5,000 rows per transaction) in a background script to prevent long-lived locks.
      3. Add a check constraint: `ALTER TABLE orders ADD CONSTRAINT chk_status_not_null CHECK (status IS NOT NULL) NOT VALID;`
      4. Validate the constraint without table lock: `ALTER TABLE orders VALIDATE CONSTRAINT chk_status_not_null;`

13. **How do you implement an optimistic locking pattern in PostgreSQL to prevent concurrent balance overdrafts?**
    * *Answer:*
    ```sql
    -- Add version column to account table
    -- Client reads: SELECT id, balance, version FROM accounts WHERE id = 1;
    -- Result: balance = 500, version = 4
    
    -- Client attempts update with version verification:
    UPDATE accounts 
    SET balance = balance - 100, version = version + 1
    WHERE id = 1 AND version = 4;
    
    -- If rows affected == 0, another concurrent transaction modified the account!
    -- Application catches this and retries.
    ```

14. **How do you implement full-text search in PostgreSQL without Elasticsearch?**
    * *Answer:* Use `tsvector` and `tsquery` with a **GIN (Generalized Inverted Index)**:
    ```sql
    ALTER TABLE articles ADD COLUMN tsv_search tsvector 
    GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || content)) STORED;

    CREATE INDEX idx_articles_search ON articles USING GIN(tsv_search);

    -- Querying
    SELECT title, ts_rank(tsv_search, query) as relevance
    FROM articles, to_tsquery('english', 'database & indexing') query
    WHERE tsv_search @@ query
    ORDER BY relevance DESC;
    ```

15. **How do you set up a MongoDB aggregation pipeline to calculate Monthly Active Users (MAU)?**
    * *Answer:*
    ```javascript
    db.userActivity.aggregate([
      {
        $match: {
          timestamp: { 
            $gte: ISODate("2026-01-01T00:00:00Z"), 
            $lt: ISODate("2026-02-01T00:00:00Z") 
          }
        }
      },
      {
        $group: {
          _id: "$userId" // Deduplicate users who logged in multiple times
        }
      },
      {
        $count: "monthlyActiveUsers"
      }
    ]);
    ```

---

### Debugging Level
16. **A production query was running in 5ms, but suddenly takes 8,000ms. Running `EXPLAIN` shows a `Seq Scan` on a table with an index. Why did the planner abandon the index?**
    * *Answer:* Common reasons:
      1. *Stale Table Statistics:* PostgreSQL's optimizer uses sampling stats from `pg_statistic`. If millions of rows were inserted without `ANALYZE`, the planner assumes the table is tiny and chooses a sequential scan. Run `ANALYZE table_name;`.
      2. *Type Coercion:* The query passes a string to an integer column (`WHERE phone_number = 12345` on a `VARCHAR` column), forcing PostgreSQL to apply a function conversion across every row.
      3. *Function wrapping index column:* Querying `WHERE DATE(created_at) = '2026-01-01'` invalidates the B-Tree index on `created_at`. Replace with range scan: `WHERE created_at >= '2026-01-01' AND created_at < '2026-01-02'`.
      4. *High Selectivity:* The query matches >30% of the total table rows. The planner calculates that sequential scanning is faster than loading both index blocks and random heap pages.

17. **Why is your PostgreSQL database disk usage increasing continuously even though you run a job that deletes millions of old records daily?**
    * *Answer:* PostgreSQL's MVCC design means `DELETE` does not free disk space back to the operating system; it merely marks row tuples as dead. Those dead tuples can only be reused for future `INSERT`s on the same table. If `autovacuum` is misconfigured or blocked by a long-running transaction or stale replication slot, dead tuples accumulate (Table Bloat). To reclaim physical disk space to the OS, run `pg_repack` or `VACUUM FULL` (note: `VACUUM FULL` takes an exclusive table lock).

18. **A MongoDB query using `$lookup` times out after 30 seconds. How do you debug it?**
    * *Answer:*
      1. Run `.explain("executionStats")` on the aggregation pipeline.
      2. Check the `foreignField` in the target collection. In 95% of cases, developers forget to create an index on the collection referenced in `$lookup.foreignField`.
      3. If unindexed, MongoDB performs a full collection scan on the target collection for *every single document* emitted by the source collection ($O(N \times M)$ complexity).

19. **Why does a transaction in `REPEATABLE READ` isolation fail with `could not serialize access due to concurrent update`?**
    * *Answer:* In `REPEATABLE READ`, if Transaction A attempts to update or lock a row that was already updated and committed by Transaction B *after* Transaction A's snapshot began, PostgreSQL cannot permit Transaction A to overwrite those changes. To maintain snapshot isolation without silent data corruption, PostgreSQL aborts Transaction A with a serialization failure. The application must catch this error and retry the transaction.

20. **Why did a database connection pool exhaust all available sockets, causing all HTTP requests to hang?**
    * *Answer:* Application code acquired a connection from the pool (`const client = await pool.connect()`) inside a route handler, but threw an unhandled error *before* reaching `client.release()` inside a `finally` block. Over time, leaked connections saturate the pool's max limit, causing all subsequent queries to queue indefinitely.

---

### Scenario-Based Questions
21. **Scenario:** You are designing a financial ledger where users transfer money to one another. How do you implement this in PostgreSQL to guarantee zero balance corruption, no deadlocks, and strict atomicity?
    * *Answer:*
      1. Wrap the transfer in a single ACID transaction (`BEGIN; ... COMMIT;`).
      2. Always acquire row locks (`SELECT balance FROM accounts WHERE id = ? FOR UPDATE`) in a **deterministic order** (e.g., sort user IDs numerically: lock `MIN(from_id, to_id)` first, then `MAX(from_id, to_id)`). This completely eliminates deadlocks.
      3. Verify `from_balance >= transfer_amount`.
      4. Update balances and insert immutable audit ledger entries in the same transaction block.

22. **Scenario:** You have an analytics table recording 100,000,000 clickstream events per month. Queries exclusively filter by date ranges (`created_at`). How do you architect this table for optimal query and deletion performance?
    * *Answer:* Implement **Declarative Table Partitioning by Range** on `created_at` (e.g., monthly partitions: `events_2026_01`, `events_2026_02`).
      * *Query Speed:* Partition pruning ensures queries for January only scan `events_2026_01`, ignoring the other 90% of data.
      * *Data Archival:* Deleting data older than 1 year is instant: simply run `DROP TABLE events_2025_01;`, freeing disk blocks instantly with zero WAL overhead and zero dead tuple bloat.

23. **Scenario:** Your company needs to support an e-commerce flash sale with 50,000 users attempting to buy 100 iPhone units at the exact same second. How do you handle this at the database level?
    * *Answer:* Do not execute `UPDATE inventory SET stock = stock - 1` across 50,000 concurrent web requests in PostgreSQL directly; row-level lock contention will cause severe connection exhaustion.
      * *Approach:* Use an in-memory Redis Lua script (`redis.eval`) with atomic decrement (`DECRBY`) to reserve inventory in sub-milliseconds.
      * Once stock hits 0, subsequent requests are rejected immediately at the edge.
      * The 100 winning purchase events are pushed to a message queue (RabbitMQ/Kafka) where a worker executes the PostgreSQL database checkout transactions asynchronously.

24. **Scenario:** You are building a social media feed where users follow friends. Should you use MongoDB or PostgreSQL?
    * *Answer:*
      * If queries require deep graph traversals (friends of friends, mutual connections), a Relational database with recursive CTEs (`WITH RECURSIVE`) or a dedicated Graph database (Neo4j) is superior.
      * If storing the pre-computed activity feed (e.g., user timeline of post IDs), a NoSQL document store (MongoDB) or Redis sorted sets (`ZADD`) is optimal due to high write throughput and simple fan-out-on-write architectures.

25. **Scenario:** You need to support soft-deletes (`deleted_at IS NULL`) across all tables while enforcing a `UNIQUE(email)` constraint on active users. How do you solve this?
    * *Answer:* Use a **Partial Unique Index**:
    ```sql
    CREATE UNIQUE INDEX uq_users_active_email ON users(email) 
    WHERE deleted_at IS NULL;
    ```
    This allows multiple historical soft-deleted records with the same email address, while guaranteeing that only one active user (`deleted_at IS NULL`) can possess that email.

---

### Advanced Architectural Questions
26. **Explain the differences between PostgreSQL B-Tree, GIN, GiST, and BRIN indexes.**
    * *Answer:*
      * **B-Tree:** Default balanced tree. Optimized for equality (`=`) and range (`<, >, BETWEEN`) queries on scalar types.
      * **GIN (Generalized Inverted Index):** Inverted index mapping element values to row locations. Essential for multi-value types (JSONB arrays, full-text search, tags).
      * **GiST (Generalized Search Tree):** Lossy tree structure for complex geometric shapes, geospatial coordinates (PostGIS), and range types (`tsrange`).
      * **BRIN (Block Range Index):** Stores summary min/max values for physical ranges of pages. Extremely compact (1% size of B-Tree), ideal for multi-billion row append-only timeseries tables sorted by time.

27. **What is Write Skew anomaly and why does `REPEATABLE READ` fail to prevent it?**
    * *Answer:* Write Skew occurs when two concurrent transactions read overlapping datasets, evaluate a business rule constraint, and make disjoint updates that violate the global constraint.
    * *Example:* Hospital rule: At least one doctor must be on call. Both Doctor A and Doctor B query active on-call doctors (count = 2). Both simultaneously request leave. Under `REPEATABLE READ`, neither transaction modifies the other's row, so both commit successfully. The result: 0 doctors on call. Only `SERIALIZABLE` isolation or explicit table locks (`LOCK TABLE`) prevent Write Skew.

28. **How does MongoDB's WiredTiger Storage Engine handle concurrency?**
    * *Answer:* WiredTiger uses lock-free algorithms, optimistic concurrency control, and **document-level locking** for write operations (unlike older MMAPv1 engine which had collection-level locks). Multiple threads can write concurrently to different documents in the same collection. It uses memory caches with dirty-page thresholds, checkpointing data to disk every 60 seconds or 2GB of data volume.

29. **What is PostgreSQL Write Amplification caused by HOT (Heap-Only Tuples) optimization failures?**
    * *Answer:* When a row is updated in PostgreSQL, if any indexed column changes, every single index on that table must have a new entry inserted pointing to the new tuple. HOT optimization allows PostgreSQL to update a row without updating indexes if *none* of the indexed columns were modified and space exists in the same 8KB data page. If HOT fails, write amplification spikes, bloating both table heaps and index trees.

30. **Explain the 2-Phase Commit (2PC) protocol in distributed databases.**
    * *Answer:* 2PC coordinates transactions across multiple distributed nodes:
      1. *Phase 1 (Prepare):* The coordinator sends a `PREPARE` message to all participant nodes. Participants execute changes up to WAL, acquire locks, and vote `YES` (ready to commit) or `NO`.
      2. *Phase 2 (Commit/Abort):* If ALL nodes voted `YES`, the coordinator sends `COMMIT`. If any node voted `NO` or timed out, the coordinator sends `ROLLBACK`.
      * *Drawback:* 2PC is a blocking protocol; if the coordinator crashes during Phase 2, participants remain locked indefinitely.

---

## 16. Coding Questions

### Coding Challenge 1: Recursive CTE for Organizational Hierarchy

```sql
-- Problem: Retrieve all employees reporting to Manager ID 'mgr_01' (both direct and indirect),
-- along with their hierarchical depth level.

WITH RECURSIVE OrgHierarchy AS (
    -- Base Case: Direct reports
    SELECT 
        employee_id,
        manager_id,
        first_name,
        last_name,
        1 AS depth_level
    FROM employees
    WHERE manager_id = 'mgr_01'

    UNION ALL

    -- Recursive Step: Reports of reports
    SELECT 
        e.employee_id,
        e.manager_id,
        e.first_name,
        e.last_name,
        oh.depth_level + 1
    FROM employees e
    INNER JOIN OrgHierarchy oh ON e.manager_id = oh.employee_id
)
SELECT 
    employee_id,
    first_name || ' ' || last_name AS employee_name,
    depth_level
FROM OrgHierarchy
ORDER BY depth_level ASC, last_name ASC;
```

### Coding Challenge 2: Advanced MongoDB Aggregation with `$facet` for E-Commerce Search

```javascript
/**
 * Executes a multi-faceted search query returning:
 * 1. Paginated product items
 * 2. Total matching count
 * 3. Dynamic price range buckets
 * 4. Brand category aggregation
 */
db.products.aggregate([
  {
    $match: {
      category: "electronics",
      isPublished: true,
      price: { $gte: 100, $lte: 2000 }
    }
  },
  {
    $facet: {
      // Facet 1: Paginated Data Results
      paginatedResults: [
        { $sort: { rating: -1, createdAt: -1 } },
        { $skip: 20 }, // Page 2 (limit 20)
        { $limit: 20 },
        {
          $project: {
            title: 1,
            price: 1,
            brand: 1,
            rating: 1
          }
        }
      ],
      // Facet 2: Total Count
      totalCount: [
        { $count: "count" }
      ],
      // Facet 3: Dynamic Price Ranges
      priceRanges: [
        {
          $bucket: {
            groupBy: "$price",
            boundaries: [100, 500, 1000, 2000],
            default: "Other",
            output: {
              count: { $sum: 1 },
              averagePrice: { $avg: "$price" }
            }
          }
        }
      ],
      // Facet 4: Brand Distribution
      brands: [
        { $group: { _id: "$brand", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 }
      ]
    }
  }
]);
```

---

## 17. Common Interview Traps

* **The Trap:** The interviewer asks: *"Does adding an index to a table always make database operations faster?"*
  * **How candidates fail:** Saying "Yes, indexes always speed up database queries."
  * **The Winning Answer:** Indexes speed up **read queries** (`SELECT`), but directly **degrade write performance** (`INSERT`, `UPDATE`, `DELETE`). Every time a row is written, the database must write to the heap table *and* update every single B-Tree index structure on that table. Furthermore, indexes consume memory in the shared buffer cache; having too many unused indexes evicts active data blocks from RAM.
* **The Trap:** *"Can MongoDB handle transactions across multiple documents and collections?"*
  * **How candidates fail:** Saying "No, MongoDB only supports single-document atomicity."
  * **The Winning Answer:** Prior to MongoDB v4.0, MongoDB only supported single-document atomic operations. However, **MongoDB v4.0+ introduced multi-document ACID transactions across collections**, and v4.2+ extended this to distributed sharded clusters via replica set sessions (`session.startTransaction()`). However, multi-document transactions incur high latency overhead and should not be used as a substitute for proper document schema modeling.

---

## 18. Revision Summary

```
+-----------------------------------------------------------------------------------+
|                     Database & SQL High-Yield Revision Matrix                     |
+-----------------------------------------------------------------------------------+
| Indexing:            B-Trees for ranges/equality; GIN for JSONB/Arrays; BRIN for TS|
| Isolation Levels:    Read Committed (default) -> Repeatable Read -> Serializable  |
| PostgreSQL MVCC:     xmin/xmax tracking; dead tuples require VACUUM; HOT updates  |
| Joins:               Nested Loop (indexed/small), Hash (large), Merge (sorted)    |
| Joins vs Embedding:  1:few = embed in NoSQL; 1:many/unbounded = reference/SQL 3NF |
| Optimization:        EXPLAIN ANALYZE; avoid N+1; use partial & covering indexes   |
+-----------------------------------------------------------------------------------+
```

---

## 19. Quick Reference

* **`EXPLAIN (ANALYZE, BUFFERS)`:** Profile query execution tree with actual runtime and memory stats.
* **`DENSE_RANK() OVER (PARTITION BY ... ORDER BY ...)`:** Window function ranking items without skipping rank numbers.
* **`VACUUM ANALYZE table_name;`:** Reclaims dead tuple space and updates planner statistics.
* **`WITH RECURSIVE`:** Enables recursive hierarchical SQL queries (graphs, org charts).
* **`$facet`:** Executes multiple aggregation pipelines concurrently within a single MongoDB stage.
* **PgBouncer:** Lightweight connection pooler essential for high-concurrency PostgreSQL apps.
