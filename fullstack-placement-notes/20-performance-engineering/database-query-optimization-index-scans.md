# Database Query Optimization: Index Scans, Covering Indexes & Execution Plan Profiling

## 1. What is it?
**Database Query Optimization** is the engineering practice of designing schemas, indexes, and SQL statements so that the relational database management system (RDBMS—specifically PostgreSQL and MySQL) retrieves and mutates data with minimal disk I/O, memory consumption, and CPU cycles.

The most critical distinction in relational query performance is between:
1. **Sequential Scan (`Seq Scan`)**: The database engine reads every single data page of a table sequentially from the physical disk into RAM to filter rows matching a `WHERE` clause. This operates at $O(N)$ time complexity and quickly saturates disk I/O as tables grow into millions of rows.
2. **Index Scan**: The database navigates a balanced B-Tree index data structure ($O(\log N)$) to locate the exact physical pointers (Tuple IDs / Heap TIDs) of matching rows, reading only the relevant data pages.
3. **Index-Only Scan (Covering Index)**: The index contains *all* columns requested by the `SELECT` query. The database engine satisfies the query entirely from the B-Tree index pages in RAM without ever touching the underlying table heap data pages on disk.

```
       Query: SELECT id, email FROM users WHERE email = 'test@domain.com';
                                      │
            ┌─────────────────────────┴─────────────────────────┐
            ▼                                                   ▼
┌─────────────────────────────────┐   ┌─────────────────────────────────┐
│ 1. Sequential Scan (Seq Scan)   │   │ 2. Index-Only Scan (Covering)   │
│ - Reads 100,000 table pages     │   │ - B-Tree lookup (3 page reads)  │
│ - Scans 5,000,000 rows          │   │ - Directly returns data from    │
│ - Disk I/O: High (1.2 seconds)  │   │   Index leaf pages              │
│ - Plan: Filter: (email = '...') │   │ - Table Heap: ZERO READS!       │
│                                 │   │ - Execution Time: 0.12 ms!      │
└─────────────────────────────────┘   └─────────────────────────────────┘
```

---

## 2. Why does it exist?
In fullstack applications, slow database queries are the primary cause of backend latency:

1. **The 100x Latency Cliff**: A query executing via a `Seq Scan` on a 10,000-row table in local development finishes in 4ms. When that same table grows to 10,000,000 rows in production, the query takes 12 seconds, exhausts database connection pool slots, and knocks down the entire application.
2. **Disk I/O Bottlenecks**: Relational databases read and write data in 8KB pages (in PostgreSQL). A sequential scan forces thousands of 8KB disk reads, thrashing the OS file-system cache (`shared_buffers`) and starving other queries.
3. **Optimizing Sorting & Aggregations**: Queries containing `ORDER BY created_at DESC LIMIT 20` without a matching index force the database to perform an expensive in-memory or on-disk **Sort (`SortMethod: external merge Disk`)**, causing severe CPU and disk thrashing.
4. **Targeted Partial Indexes**: Indexing every column wastes disk space and slows down `INSERT`, `UPDATE`, and `DELETE` operations. Advanced indexing (Partial Indexes, Covering Indexes) delivers sub-millisecond read performance with minimal write overhead.

---

## 3. Mental Model: The Library Card Catalog
Think of a database table as a **Gigantic Library with 10,000,000 Books**:
- **Sequential Scan**: You enter the library looking for a book with the title *"Refactoring"*. Starting at Shelf 1, Book 1, you walk down every aisle, inspecting the spine of every single book one by one until you reach the end of the building. It takes 3 weeks.
- **Index Scan**: You walk to the physical Card Catalog (the B-Tree index) sorted alphabetically by title. In 15 seconds, you locate the card for *"Refactoring"*, which lists the exact shelf and coordinate (`Shelf 42, Row 3, Book 12`). You walk straight to that shelf and pick up the book.
- **Index-Only Scan (Covering Index)**: The card in the catalog not only lists the title, but also includes the book's author and summary right on the index card. You read the information directly from the card and don't even have to walk over to the shelf.

---

## 4. Basic Example: Diagnosing Queries with `EXPLAIN (ANALYZE, BUFFERS)`

In PostgreSQL, prefixing any SQL statement with `EXPLAIN (ANALYZE, BUFFERS)` executes the query and returns the real-time execution plan:

```sql
-- 1. Unindexed Query (Forces a Sequential Scan)
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, full_name, email 
FROM users 
WHERE email = 'goutam@example.com';

/*
Execution Plan Output:
Seq Scan on users  (cost=0.00..18450.00 rows=1 width=72) (actual time=84.120..84.122 rows=1 loops=1)
  Filter: (email = 'goutam@example.com'::text)
  Rows Removed by Filter: 999999
  Buffers: shared hit=8450 read=10000
Planning Time: 0.150 ms
Execution Time: 84.180 ms  <-- 84ms on 1M rows!
*/

-- 2. Create B-Tree Index
CREATE INDEX idx_users_email ON users(email);

-- 3. Re-run Query (Now executes an Index Scan)
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, full_name, email 
FROM users 
WHERE email = 'goutam@example.com';

/*
Execution Plan Output:
Index Scan using idx_users_email on users  (cost=0.42..8.44 rows=1 width=72) (actual time=0.042..0.044 rows=1 loops=1)
  Index Cond: (email = 'goutam@example.com'::text)
  Buffers: shared hit=4
Planning Time: 0.180 ms
Execution Time: 0.065 ms  <-- Over 1,200x faster!
*/
```

---

## 5. Real-World Production Example: Covering Indexes (`INCLUDE`) & Partial Indexes in PostgreSQL

In high-throughput e-commerce systems, order queries must return order status and totals without hitting the heavy table heap.

### Technique 1: Covering Index with the `INCLUDE` Clause
```sql
-- Problem: Users frequently view their last 5 completed orders:
SELECT order_id, total_amount, created_at
FROM orders
WHERE user_id = 'usr_123'
ORDER BY created_at DESC
LIMIT 5;

-- Standard Composite Index: Requires touching the table heap to fetch `total_amount`
-- CREATE INDEX idx_orders_user ON orders(user_id, created_at);

-- ✅ OPTIMAL: Covering Index using INCLUDE
-- Stores `total_amount` in the leaf pages of the index without making it part of the B-Tree search key!
CREATE INDEX idx_orders_user_covering 
ON orders (user_id, created_at DESC) 
INCLUDE (total_amount);

-- Result: PostgreSQL performs an INDEX ONLY SCAN!
-- Zero table heap page lookups required.
```

### Technique 2: Partial Index for High-Volume Status Filtering
```sql
-- Problem: Out of 10,000,000 total orders, 9,900,000 are 'DELIVERED' or 'CANCELLED'.
-- Only 100,000 are actively 'PENDING_PAYMENT'.
-- A full index on `status` consumes 300MB of RAM and indexes millions of rows you never query.

-- ✅ OPTIMAL: Partial Index (Filters only active records)
CREATE INDEX idx_orders_pending_payment 
ON orders (created_at) 
WHERE status = 'PENDING_PAYMENT';

-- Query targeting pending orders:
SELECT id, created_at 
FROM orders 
WHERE status = 'PENDING_PAYMENT' 
ORDER BY created_at ASC;

-- Benefits:
-- 1. Index size is 99% smaller (3MB vs 300MB) -> Fits entirely in CPU L3/L2 RAM cache!
-- 2. Inserts and updates for 'DELIVERED' orders do NOT touch this index at all!
```

---

## 6. Under the Hood: The PostgreSQL Scan Hierarchy

```
┌────────────────────────┬────────────────────────────────────────────────────────┐
│ Scan Type              │ Mechanics & Execution Profile                          │
├────────────────────────┼────────────────────────────────────────────────────────┤
│ 1. Sequential Scan     │ Reads all heap blocks sequentially.                    │
│    (Seq Scan)          │ Fast for small tables (<1,000 rows); disastrous for    │
│                        │ large tables.                                          │
├────────────────────────┼────────────────────────────────────────────────────────┤
│ 2. Bitmap Index Scan   │ Used when querying many rows (e.g. 5% of table).       │
│    + Bitmap Heap Scan  │ 1. Scans B-Tree index and creates an in-memory bitmask │
│                        │    of matching heap pages.                             │
│                        │ 2. Sorts page locations physically to perform sequential│
│                        │    disk reads instead of random seeks.                 │
├────────────────────────┼────────────────────────────────────────────────────────┤
│ 3. Index Scan          │ B-Tree traversal -> Looks up physical Tuple ID (TID)  │
│                        │ -> Fetches matching row from table heap page on disk.  │
├────────────────────────┼────────────────────────────────────────────────────────┤
│ 4. Index-Only Scan     │ B-Tree traversal -> Evaluates Visibility Map.          │
│                        │ Returns data directly from index. ZERO heap page reads!│
└────────────────────────┴────────────────────────────────────────────────────────┘
```

---

## 7. Important Rules

1. **Leftmost Prefix Rule for Composite Indexes**: If an index is defined on `(tenant_id, status, created_at)`:
   - Queries filtering on `tenant_id` $\rightarrow$ **USES INDEX**.
   - Queries filtering on `tenant_id AND status` $\rightarrow$ **USES INDEX**.
   - Queries filtering on `status AND created_at` $\rightarrow$ **CANNOT USE INDEX** (skips the leading column).
2. **Never Apply Functions to Indexed Columns in the `WHERE` Clause**:
   ```sql
   -- ❌ INVALIDATES INDEX: Forces full sequential scan!
   SELECT * FROM users WHERE LOWER(email) = 'test@example.com';
   SELECT * FROM orders WHERE EXTRACT(YEAR FROM created_at) = 2026;

   -- ✅ CORRECT: Use an Expression / Functional Index:
   CREATE INDEX idx_users_lower_email ON users(LOWER(email));
   ```
3. **Index Selectivity (The 10% Tipping Point Rule)**: If a query returns more than 10%–20% of the total rows in a table (e.g., filtering on `gender` or boolean `is_active`), the PostgreSQL query planner will **intentionally ignore the index** and execute a Sequential Scan. Reading through an index for half the table causes random disk I/O, which is slower than a fast sequential block read.
4. **Order Matters in Composite Indexes**: Put high-cardinality equality columns first (`user_id = 10`), followed by range/sorting columns (`created_at >= '2026-01-01'`).
5. **Maintain the Visibility Map (`VACUUM`) for Index-Only Scans**: PostgreSQL requires checking whether a tuple is visible to the current transaction. An Index-Only Scan relies on the **Visibility Map**. If autovacuum has not processed the table recently, PostgreSQL is forced to check the table heap, degrading the query to a standard Index Scan.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Over-Indexing (The "Index Everything" Anti-Pattern)
Adding an index to every single column in a table. Every additional index slows down `INSERT`, `UPDATE`, and `DELETE` queries, consumes disk space, and exhausts memory cache (`shared_buffers`).

### 2. Wildcard Leading Matching with `LIKE`
```sql
-- ❌ CANNOT USE B-TREE INDEX: Leading wildcard forces Seq Scan!
SELECT * FROM products WHERE name LIKE '%laptop%';

-- ✅ OPTIMAL: Use PostgreSQL Full-Text Search or Trigram GIN Index
CREATE EXTENSION pg_trgm;
CREATE INDEX idx_products_name_trgm ON products USING GIN (name gin_trgm_ops);
```

### 3. Implicit Type Coercion Mismatch
```sql
-- Schema: phone_number is VARCHAR(20)
-- ❌ INVALIDATES INDEX: Numeric constant forces cast of every row to NUMERIC!
SELECT * FROM users WHERE phone_number = 9876543210;

-- ✅ CORRECT: Pass matching string type
SELECT * FROM users WHERE phone_number = '9876543210';
```

---

## 9. Best Practices

- **Find Missing Indexes with `pg_stat_user_tables`**:
  ```sql
  SELECT 
    schemaname, 
    relname AS table_name, 
    seq_scan, 
    idx_scan,
    ROUND(100.0 * idx_scan / NULLIF(seq_scan + idx_scan, 0), 2) AS index_usage_percent
  FROM pg_stat_user_tables
  WHERE seq_scan + idx_scan > 1000
  ORDER BY seq_scan DESC;
  ```
- **Find Slowest Queries in Production with `pg_stat_statements`**:
  ```sql
  SELECT 
    query, 
    calls, 
    round(total_exec_time::numeric, 2) AS total_time_ms,
    round(mean_exec_time::numeric, 2) AS avg_time_ms,
    rows
  FROM pg_stat_statements
  ORDER BY total_exec_time DESC
  LIMIT 10;
  ```
- **Create Indexes Concurrently**: Never run `CREATE INDEX` on a live production table without the `CONCURRENTLY` keyword. A standard `CREATE INDEX` acquires an `ACCESS EXCLUSIVE` table lock, blocking all writes until completion:
  ```sql
  CREATE INDEX CONCURRENTLY idx_users_active ON users(created_at);
  ```

---

## 10. Performance Considerations

- **Index Bloat and `REINDEX CONCURRENTLY`**: Frequent `UPDATE` and `DELETE` operations leave dead leaf pages in B-Tree indexes. Periodic reindexing reclaims memory and keeps B-Tree depth shallow.
- **Index Column Sizes**: Keep indexed keys compact (integers, UUIDs, short strings). B-Trees can pack more keys per 8KB page, reducing the depth of the tree to 3–4 levels even for 100,000,000 records.

---

## 11. Security Considerations

- **Row-Level Security (RLS) Performance**: When using PostgreSQL RLS policies (e.g., `WHERE tenant_id = current_setting('app.tenant_id')`), ensure `tenant_id` is the leading column on your composite indexes; otherwise, every RLS evaluation triggers a full table scan.

---

## 12. Index Type Comparison Matrix

| Index Type | Underlying Structure | Best Used For | Supported Operators |
| :--- | :--- | :--- | :--- |
| **B-Tree** (Default) | Balanced Tree | Equality, Ranges, Sorting | `=`, `<`, `<=`, `>`, `>=`, `BETWEEN` |
| **Hash** | Hash Table | High-volume exact equality only | `=` |
| **GIN** (Generalized Inverted) | Inverted Index | JSONB arrays, Full-Text, Tags | `@>`, `?`, `@@` |
| **GiST** | Generalized Search Tree | Geometric, Range Types, PostGIS | `&&`, `@>`, `<->` (nearest neighbor)|
| **BRIN** (Block Range) | Min/Max per block range | Massive time-series, append-only | `=`, `<`, `>` (Huge physical tables) |

---

## 13. Trade-offs

- **Read Speed vs. Write Throughput**: Adding a covering index makes reads 100x faster, but every `INSERT` or `UPDATE` must now write to both the table heap and the B-Tree index pages, consuming IOPS.
- **BRIN vs. B-Tree**: A BRIN index on an append-only timestamp column uses 99% less disk space than a B-Tree (~50KB vs 500MB), but is slightly slower for single-row lookups.

---

## 14. Real-World Usage Case Studies

1. **GitLab**: Saved terabytes of database storage and improved CI dashboard latency by migrating full-table indexes on project pipelines to **Partial Indexes** that filter exclusively on `status IN ('running', 'pending')`.
2. **Shopify**: Utilizes covering indexes with `INCLUDE` on fulfillment status tables, reducing Black Friday flash-sale checkout latency by eliminating heap page reads during order validation.

---

## 15. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: What is the difference between an Index Scan and an Index-Only Scan?**
> **Answer**: In a standard **Index Scan**, the database traverses the B-Tree index to find the matching row pointers (Tuple IDs), and then visits the actual table heap pages on disk to fetch the remaining columns requested in the `SELECT` clause. In an **Index-Only Scan**, *all* columns requested by the query exist directly inside the index itself (via composite keys or an `INCLUDE` clause); the database returns the data directly from the index without reading the table heap pages.

### Tier 2: Conceptual
**Q: Explain the "Leftmost Prefix Rule" in composite database indexes.**
> **Answer**: When a composite index is created on columns `(A, B, C)`, the B-Tree is ordered primarily by `A`, then by `B` within equal values of `A`, and finally by `C`. Therefore, the index can accelerate queries filtering on `(A)`, `(A, B)`, or `(A, B, C)`. However, a query filtering only on `(B)` or `(C)` cannot use the index efficiently because the tree is not ordered by those columns at the root level.

### Tier 3: Implementation
**Q: How do you create an index in PostgreSQL that speeds up case-insensitive email lookups?**
> **Answer**: Create an Expression (Functional) Index:
> ```sql
> CREATE UNIQUE INDEX idx_users_lower_email ON users (LOWER(email));
> ```
> Any query using `WHERE LOWER(email) = 'test@example.com'` will now perform a fast B-Tree index lookup.

### Tier 4: Debugging
**Q: You created an index on a boolean column `is_verified`, but `EXPLAIN ANALYZE` shows PostgreSQL is still performing a `Seq Scan` on `SELECT * FROM users WHERE is_verified = true`. Why?**
> **Answer**: This is due to **low index selectivity**. If 90% of the users in your database have `is_verified = true`, using an index would require reading 90% of the index tree plus performing random disk I/O to fetch each matching heap page. The query planner calculates that a Sequential Scan (reading contiguous disk blocks sequentially) is significantly faster than performing millions of random index lookups.

### Tier 5: Scenario
**Q: You have a PostgreSQL table `audit_logs` with 50 million rows. Queries filtering `WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20` are taking 8 seconds. How do you optimize this?**
> **Answer**:
> 1. Create a composite B-Tree index ordered by user and timestamp:
>    ```sql
>    CREATE INDEX CONCURRENTLY idx_audit_logs_user_created 
>    ON audit_logs (user_id, created_at DESC);
>    ```
> 2. This satisfies both the equality filter (`user_id = $1`) and the sorting requirement (`ORDER BY created_at DESC`) within a single B-Tree traversal, completely eliminating the expensive in-memory sort (`SortMethod: external merge`).
> 3. If specific columns are retrieved, use `INCLUDE` to achieve an Index-Only Scan.

### Tier 6: Advanced
**Q: What is a BRIN (Block Range Index) in PostgreSQL, and when would you choose it over a standard B-Tree index?**
> **Answer**:
> A **BRIN index** stores only the minimum and maximum values of a column for physical ranges of database disk blocks (typically 128 heap pages per range). It assumes the data is physically stored in sorted or sequential order on disk (such as an append-only `created_at` timestamp or auto-incrementing `id` in time-series data or event logs).
> **When to Choose**: Choose BRIN for massive tables (hundreds of millions or billions of rows) with natural physical clustering. A B-Tree index on 1 billion rows could consume 30GB of RAM, whereas a BRIN index for the same table consumes only ~500KB of RAM while providing nearly identical range query performance.

---

## 16. Coding Question: Schema Design & Index Tuning Challenge

### Problem
Given an e-commerce notification system table `user_notifications` with 20,000,000 rows:
- `id` (UUID, Primary Key)
- `user_id` (UUID)
- `is_read` (BOOLEAN)
- `created_at` (TIMESTAMPTZ)
- `payload` (JSONB)

Write the optimal SQL index creation statement to support the following frequent query (executed 20,000 times/min) with sub-millisecond execution:
```sql
SELECT id, created_at, payload 
FROM user_notifications 
WHERE user_id = 'c123e456-789a-bcde-0123-456789abcdef' 
  AND is_read = false 
ORDER BY created_at DESC 
LIMIT 10;
```

### Solution

```sql
-- Solution: Partial Composite Index with Specific Sort Direction
-- 1. Filters only unread notifications (is_read = false)
-- 2. Indexes user_id for fast equality lookup
-- 3. Pre-sorts created_at DESC for zero-cost LIMIT resolution
CREATE INDEX CONCURRENTLY idx_user_unread_notifications
ON user_notifications (user_id, created_at DESC)
WHERE is_read = false;

/*
Why this is the optimal engineering solution:
1. Partial Index (WHERE is_read = false):
   Users read most notifications, so unread notifications represent < 5% of rows.
   The index is 95% smaller than an index on the full table, easily fitting in RAM.
   
2. Leading column `user_id`:
   Enables direct B-Tree point lookup for the target user.

3. Trailing column `created_at DESC`:
   Directly satisfies the ORDER BY created_at DESC LIMIT 10 clause.
   The database reads the first 10 leaf entries and stops (Zero sort cost).

4. Excludes `payload` from the index:
   JSONB payloads are large. Storing them in the index would bloat the B-Tree,
   reducing cache efficiency. Reading 10 heap rows for the final output is 
   negligible (<0.1ms).
*/
```

---

## 17. Common Interview Traps

- **Trap 1**: Thinking an index makes *all* queries faster.
  *Gotcha*: Indexes only speed up `SELECT` queries with matching `WHERE`, `JOIN`, or `ORDER BY` conditions. Every index adds overhead to `INSERT`, `UPDATE`, and `DELETE` queries because the database must update both the table and all related indexes.
- **Trap 2**: Using `COUNT(*)` without realizing it still requires scanning the table or index.
  *Gotcha*: PostgreSQL uses Multi-Version Concurrency Control (MVCC). A `COUNT(*)` cannot return a single cached number because different transactions see different row visibility states; it must scan the visibility map or rows.
- **Trap 3**: Believing `SELECT *` can use an Index-Only Scan.
  *Gotcha*: An Index-Only Scan requires all selected columns to reside in the index. `SELECT *` selects all table columns, which will almost always force the engine to read the table heap.

---

## 18. Revision Summary

- **Scan Types**:
  - *Seq Scan*: Scans all pages ($O(N)$); unacceptable for large tables.
  - *Index Scan*: Navigates B-Tree to find row pointers, fetches from heap ($O(\log N)$).
  - *Index-Only Scan*: Returns data directly from index leaf pages (zero heap reads).
- **Optimization Primitives**:
  - *Covering Indexes (`INCLUDE`)*: Appends non-key payload columns to leaf pages.
  - *Partial Indexes (`WHERE ...`)*: Indexes a filtered subset of rows (90% smaller).
  - *Expression Indexes*: Indexes calculated results (e.g., `LOWER(email)`).
- **Golden Rules**: Respect the leftmost prefix rule; avoid functions on indexed columns in `WHERE`; use `CONCURRENTLY` in production.

---

## 19. Quick Reference

| Optimization Technique | PostgreSQL Syntax | Primary Benefit |
| :--- | :--- | :--- |
| **B-Tree Index** | `CREATE INDEX idx ON tbl(col);` | Accelerates `=`, `<`, `>`, `ORDER BY` |
| **Covering Index** | `CREATE INDEX idx ON tbl(col) INCLUDE (col2);` | Enables Index-Only Scans |
| **Partial Index** | `CREATE INDEX idx ON tbl(col) WHERE status = 'ACTIVE';`| 90%+ smaller index footprint |
| **Expression Index** | `CREATE INDEX idx ON tbl(LOWER(col));` | Accelerates computed lookups |
| **Safe Creation** | `CREATE INDEX CONCURRENTLY idx ON tbl(col);` | Prevents blocking production writes |
| **Execution Profiler**| `EXPLAIN (ANALYZE, BUFFERS) SELECT ...;` | Reveals actual timing and page reads |
