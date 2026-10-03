# Indexing Strategies: B-Trees, Hash, and GIN

## 1. What is it?
A **Database Index** is a specialized auxiliary data structure maintained alongside a database table to accelerate the speed of data retrieval operations at the cost of additional storage space and write performance overhead. 

Without an index, the database engine must execute a **Sequential Scan (Full Table Scan)**, reading every single disk page and row in the table from start to finish—an $O(N)$ operation. With an appropriate index, the engine jumps directly to the matching physical storage pointers in $O(\log N)$ or $O(1)$ time.

Different data types and query patterns require distinct indexing data structures:
- **B-Tree (Balanced Tree)**: The universal default for scalar equality and range queries (`=`, `<`, `>`, `<=`, `>=`, `BETWEEN`, `ORDER BY`).
- **Hash Index**: A flat bucket array optimized strictly for fast $O(1)$ exact equality lookups (`=`).
- **GIN (Generalized Inverted Index)**: An inverted index structure designed for composite or multi-valued data items such as JSONB documents, arrays, full-text search tokens, and tags.
- **GiST / BRIN**: Spatial, geometric, and block-range indexes for geographical points and time-series datasets.

```
       B-Tree Index Architecture (Balanced Hierarchy):
                        [ Root Node: 50 | 100 ]
                              /        \
                             /          \
               [ Inter: 20 | 40 ]     [ Inter: 70 | 90 ]
                   /     \                  /     \
                  v       v                v       v
           [Leaf: 10,20] [Leaf: 30,40]  [Leaf: 60,70] [Leaf: 80,90,100]
                 |             |              |               |
                 v             v              v               v
           [ Disk Tuple Pointers -> Row ID / Heap Storage Location (TID) ]
```

---

## 2. Why does it exist?
Hard drives and SSDs store database tables as unstructured collections of data blocks known as the **Heap**. 
1. **The Cost of Sequential Scans**: If a `users` table contains 50,000,000 rows stored across 500,000 disk pages (4GB of data), finding a user by email `WHERE email = 'alice@example.com'` without an index requires transferring all 4GB from disk into memory, causing massive I/O saturation and multi-second query delays.
2. **Predictable Query Latency**: By structuring row identifiers into logarithmic trees or inverted posting lists, query latency drops from 4,500ms to 0.4ms.
3. **Sorting and Ordering Acceleration**: B-Trees store keys in sorted order. An `ORDER BY created_at DESC LIMIT 20` query can retrieve top records directly from the rightmost leaves of a B-Tree index without performing an in-memory or on-disk `External Sort`.

---

## 3. Mental Model
Think of database indexing like **Finding Content in a 1,000-Page Textbook**:
- **Full Table Scan**: Reading every single sentence from page 1 to page 1,000 until you locate the word "Photosynthesis."
- **B-Tree Index**: The alphabetized Index section at the back of the textbook. You flip to the letter "P," look up "Photosynthesis," and find the exact page number (the Heap Tuple ID). You jump straight to page 412.
- **Hash Index**: A direct phonebook speed-dial button. You push the button labeled "Alice" and instantly connect. However, you cannot ask the speed-dial to "give me all names starting with A through C."
- **GIN Index (Generalized Inverted Index)**: The reverse concordance of a book. It lists every individual keyword, and under each keyword, lists all paragraphs and pages where that keyword appears. Ideal when an article contains a list of tags: `['tech', 'ai', 'cloud']`.

---

## 4. Basic Example
Creating and observing indexes in SQL:

```sql
-- 1. Default B-Tree Index (Supports equality and range comparisons)
CREATE INDEX idx_users_email ON users USING btree (email);

-- Range scan supported by B-Tree:
SELECT * FROM users WHERE created_at >= '2026-01-01' ORDER BY created_at ASC;

-- 2. Hash Index (Supports ONLY strict equality '=')
CREATE INDEX idx_sessions_token ON user_sessions USING hash (session_token);

-- Hash index accelerated query:
SELECT * FROM user_sessions WHERE session_token = 'sess_99a8b7c6';

-- 3. GIN Index (Generalized Inverted Index on JSONB document or array)
CREATE INDEX idx_products_tags ON products USING gin (tags);
CREATE INDEX idx_user_metadata ON users USING gin (metadata jsonb_path_ops);

-- GIN accelerated query (array containment or JSON path match):
SELECT * FROM products WHERE tags @> ARRAY['electronics', 'sale'];
SELECT * FROM users WHERE metadata @> '{"role": "admin"}';
```

---

## 5. Real Example: Composite Indexes and the Leftmost Prefix Rule
A real-world production TypeScript / SQL example demonstrating the **Leftmost Prefix Rule** and composite index design for a high-traffic SaaS ledger:

```typescript
/**
 * Table: audit_logs
 * Schema:
 *   id            UUID PRIMARY KEY
 *   tenant_id     UUID NOT NULL
 *   status        VARCHAR(32) NOT NULL
 *   created_at    TIMESTAMPTZ NOT NULL
 *   payload       JSONB
 */

// Production Composite Index Migration in SQL:
export const migrationSql = `
  -- Composite B-Tree Index: (tenant_id, status, created_at DESC)
  CREATE INDEX idx_audit_logs_composite 
  ON audit_logs (tenant_id, status, created_at DESC);
`;

/**
 * UNDERSTANDING QUERY EFFICIENCY WITH THE COMPOSITE INDEX:
 * 
 * Query 1: Fully Indexed (Index Scan + Index Ordering)
 * SELECT * FROM audit_logs 
 * WHERE tenant_id = 't_123' AND status = 'FAILED' 
 * ORDER BY created_at DESC LIMIT 50;
 * -> USES ALL 3 COLUMNS of the index. Latency ~ 0.3ms.
 * 
 * Query 2: Uses Prefix (tenant_id, status)
 * SELECT * FROM audit_logs 
 * WHERE tenant_id = 't_123' AND status = 'SUCCESS';
 * -> USES FIRST 2 COLUMNS of index. Highly efficient.
 * 
 * Query 3: Uses Leftmost Prefix Only (tenant_id)
 * SELECT * FROM audit_logs 
 * WHERE tenant_id = 't_123';
 * -> USES FIRST COLUMN of index. Efficient.
 * 
 * Query 4: VIOLATES LEFTMOST PREFIX RULE (Index Cannot Be Used Effectively)
 * SELECT * FROM audit_logs 
 * WHERE status = 'FAILED' AND created_at >= '2026-01-01';
 * -> DOES NOT provide 'tenant_id'. B-Tree cannot jump to the starting branch.
 * -> Results in a sequential scan or slow index scan.
 */
```

---

## 6. Under the Hood

### 1. B-Tree Internal Architecture
A B-Tree is a self-balancing, multi-way search tree. Unlike binary search trees where each node has at most two children, a B-Tree page (typically 8KB in PostgreSQL) has a high **fanout** (often 200–500 keys per node):
- **Shallow Depth**: Even for a table of 100,000,000 rows, a B-Tree with a fanout of 300 only requires a depth of **3 or 4 levels**.
- **Page Traversal**: The root page and intermediate levels are almost always cached in the database RAM buffer pool (`shared_buffers`). Locating any row requires only 3–4 page reads, usually completing with 0 physical disk I/O reads.
- **Leaf Level**: The leaf pages are arranged in a **doubly linked list**. This makes range scans (`WHERE age BETWEEN 25 AND 35`) extremely fast: the database finds the first leaf page for 25, and simply walks the linked list forward until it hits 36, avoiding repeated tree traversals.

```
Leaf Page Doubly Linked List for Range Scans:
[ Page 1: Keys 1..20 ] <===> [ Page 2: Keys 21..40 ] <===> [ Page 3: Keys 41..60 ]
```

### 2. Clustered vs Non-Clustered (Secondary) Indexes
- **Clustered Index (MySQL InnoDB / SQL Server)**:
  - The table data *itself* is physically stored inside the leaf pages of the primary key B-Tree.
  - The table is sorted by the primary key.
  - Secondary indexes store the primary key value as their leaf pointer. A secondary lookup requires two traversals: secondary index $\to$ primary key $\to$ row data (the "Bookmark Lookup").
- **Heap Tables with Secondary Indexes (PostgreSQL)**:
  - The table data is stored in an unordered heap file.
  - Every index (including primary key and secondary indexes) points to a physical **Tuple ID (TID)** consisting of `(block_number, offset)`.
  - Every index lookup jumps directly to the heap block.

### 3. GIN (Generalized Inverted Index) Mechanics
When indexing an array `['sports', 'tech']` or a JSONB document:
- A B-Tree treats the whole array as an opaque single value.
- A **GIN index** extracts every individual element/key within the composite object and creates an entry in an internal B-Tree of keys.
- Under each key, GIN stores a sorted **Posting List** (or posting tree) of all Tuple IDs (TIDs) that contain that key.
- When you execute `WHERE tags @> ARRAY['tech', 'news']`, the engine fetches the posting list for `'tech'` and the posting list for `'news'`, performs a fast bitmap intersection in RAM, and retrieves the matching rows.

---

## 7. Important Rules
1. **The Leftmost Prefix Rule**: A composite index on `(A, B, C)` can accelerate queries on `(A)`, `(A, B)`, and `(A, B, C)`. It **cannot** accelerate queries filtering exclusively on `(B)`, `(C)`, or `(B, C)`.
2. **Index Selectivity Rule**: An index is only useful if it is **selective** (filters down to a small percentage of rows, typically < 5–10%). An index on a `gender` or `is_active` boolean column with 50/50 distribution will be ignored by the query planner because a sequential scan is faster than jumping randomly between index pages and heap pages.
3. **The Function Wrapping Penalty**: Applying a function to an indexed column in the `WHERE` clause invalidates the index:
   - `WHERE LOWER(email) = 'alice@example.com'` will NOT use `CREATE INDEX ON users (email)`.
   - You must create an **Expression / Functional Index**: `CREATE INDEX ON users (LOWER(email))`.
4. **Writes Incur Index Maintenance Overhead**: Every `INSERT`, `UPDATE`, or `DELETE` must synchronously update all indexes declared on that table. Over-indexing degrades write throughput.

---

## 8. Common Mistakes

### 1. The Missing Leading Column Anti-Pattern
```sql
-- Composite index exists on (company_id, user_id, status)
-- MISTAKE: Query filters only by user_id
SELECT * FROM members WHERE user_id = 'u_456'; 
-- Query planner performs a sequential scan because company_id is omitted!
```

### 2. Over-Indexing Every Single Column
Creating separate individual indexes on every single column: `idx_col1`, `idx_col2`, `idx_col3`, `idx_col4`. When a write occurs, the database performs 4 separate random disk writes. Instead, analyze actual query patterns and construct targeted composite indexes.

### 3. Using B-Tree on Full Text Search or Deep JSONB
Attempting to use `CREATE INDEX ON articles (content)` and querying with `WHERE content LIKE '%technology%'`. A leading wildcard (`%word`) cannot traverse a B-Tree from left to right; it forces a full table scan. Use a **GIN index** with PostgreSQL `to_tsvector()` for full text search.

---

## 9. Best Practices

### 1. Covering Indexes (`INCLUDE` Clause)
An **Index-Only Scan** occurs when all columns requested by the `SELECT` query exist directly inside the index itself, allowing the database to completely skip reading the heap table pages from disk:

```sql
-- Traditional index requires reading 'total_price' from table heap
CREATE INDEX idx_orders_customer ON orders (customer_id);

-- Covering Index: Stores total_price in leaf nodes without adding it to the search tree
CREATE INDEX idx_orders_customer_covering 
ON orders (customer_id) 
INCLUDE (total_price, order_date);

-- EXTREME SPEED: Engine returns data directly from the index RAM buffer!
SELECT customer_id, total_price, order_date 
FROM orders 
WHERE customer_id = 'CUST-100';
```

### 2. Partial (Conditional) Indexes
If 99% of orders are `COMPLETED` and only 1% are `PENDING`, indexing all 10,000,000 completed orders is wasteful. Create a partial index targeting only the active working set:

```sql
-- Indexes only rows matching the WHERE filter (tiny index size, ultra-fast)
CREATE INDEX idx_orders_pending 
ON orders (created_at) 
WHERE status = 'PENDING';
```

---

## 10. Performance Considerations
- **Index Fragmentation and Bloat**: In PostgreSQL, updates write new row versions (MVCC). If HOT (Heap-Only Tuple) optimization cannot occur because an indexed column was updated, index bloat accumulates. Run `REINDEX CONCURRENTLY` periodically on high-update tables.
- **Memory Footprint**: Ensure your critical B-Tree indexes fit entirely into RAM (`pg_stat_user_indexes` and `shared_buffers`). If an index exceeds RAM, traversing the tree incurs physical disk I/O on every query.
- **Write Amplification**: Inserting a single row into a table with 12 indexes requires 1 write to the table heap plus 12 separate writes to 12 distinct index structures.

---

## 11. Security Considerations
- **Information Leakage via Index Scans**: Even if row-level security (RLS) is enabled, poorly designed partial indexes or error messages in unique constraint violations can inadvertently reveal the existence of sensitive IDs (e.g., "duplicate key value violates unique constraint on ssn_idx").
- **Denial of Service via Unindexed Foreign Keys**: In PostgreSQL, if you `DELETE` a row from a parent table, the database must check the child table to enforce `ON DELETE CASCADE` or `RESTRICT`. If the foreign key column on the child table is unindexed, the engine runs a full sequential scan on the child table, locking it and causing API timeouts.

---

## 12. Alternatives
1. **BRIN (Block Range Index)**: For gigantic append-only time-series tables (billions of rows). Stores only the minimum and maximum values for each 128-block range. Consumes 99% less RAM and disk than a B-Tree.
2. **LSM-Trees (Log-Structured Merge-Trees)**: Used in Cassandra, RocksDB, and ScyllaDB. Optimized for write-heavy workloads over read-heavy B-Tree lookups.
3. **Full-Text Engines (Elasticsearch / Meilisearch)**: Dedicated external search clusters when complex fuzzy matching, typos, and BM25 relevance scoring exceed relational GIN capabilities.

---

## 13. Trade-offs

| Index Type | Lookups Supported | Write Overhead | Storage Footprint | Primary Use Case |
| :--- | :--- | :--- | :--- | :--- |
| **B-Tree** | Equality (`=`), Range (`<`, `>`, `BETWEEN`), Sort (`ORDER BY`) | Moderate | Moderate | Standard primary keys, foreign keys, timestamps, numeric filters |
| **Hash** | Exact Equality (`=`) ONLY | Low | Small | UUID / Session tokens where range search is never needed |
| **GIN** | Set containment (`@>`), Full-Text (`@@`), Array/JSON overlap | High (Re-indexing keys) | Large | JSONB documents, tag arrays, full-text search |
| **BRIN** | Range scans on physically sorted data | Extremely Low | Minimal (< 1% of B-Tree) | Enormous time-series / telemetry logs sorted by timestamp |

---

## 14. Real-World Usage
- **GitHub / GitLab**: Repositories use GIN indexes on issue labels and commit tags to provide instantaneous filtering across millions of issues.
- **Fintech Payment Ledgers**: Use composite covering B-Trees `(account_id, created_at DESC) INCLUDE (amount, balance)` to populate user transaction history feeds via zero-heap Index-Only Scans.

---

## 15. Placement Interview Questions

### Basic
**Q: What is a B-Tree index, and why is it the default index structure in relational databases?**  
*Answer*: A B-Tree is a self-balancing search tree data structure with high fanout and shallow depth. It is the default because it efficiently supports both exact equality lookups (`=`) and range queries (`<`, `>`, `BETWEEN`), while maintaining sorted order for `ORDER BY` operations in $O(\log N)$ time.

### Conceptual
**Q: Explain the "Leftmost Prefix Rule" in composite indexing. Why does an index on `(A, B)` not accelerate a query with `WHERE B = 10`?**  
*Answer*: A composite B-Tree sorts keys lexicographically: first by column A; then, for matching values of A, sorted by column B. Because values of B are scattered across completely different branches of the tree depending on the value of A, the search engine cannot traverse the tree hierarchy without knowing A. It is analogous to searching a physical phone book (sorted by `Last Name, First Name`) for anyone named "John" without knowing their last name.

### Implementation
**Q: How do you verify whether a SQL query is actually utilizing an index in PostgreSQL?**  
*Answer*: Prepend the query with `EXPLAIN (ANALYZE, BUFFERS)`. In the execution plan, look for:
- `Index Scan`: Traverses the index and reads matching tuples from the heap.
- `Index Only Scan`: Retrieves all data directly from the index without reading heap pages (optimal).
- `Bitmap Index Scan`: Builds a memory bitmap of matching pages before reading the heap (used when multiple indexes are combined).
- Avoid `Seq Scan` (Sequential Scan) on large tables when an index was intended.

### Debugging
**Q: You created a B-Tree index on the `created_at` column, but `SELECT * FROM events WHERE created_at::DATE = '2026-01-01'` performs a slow Sequential Scan. Why, and how do you fix it?**  
*Answer*: Casting `created_at::DATE` applies a function transformation to the column. The standard B-Tree index stores raw timestamps, not truncated dates, preventing the index from being used. You can fix this either by:
1. Rewriting the query into a sargable range: `WHERE created_at >= '2026-01-01 00:00:00' AND created_at < '2026-01-02 00:00:00'`.
2. Creating an expression index: `CREATE INDEX idx_events_date ON events ((created_at::DATE))`.

### Scenario
**Q: You have a table with 50 million user records. 99.8% of users have `is_verified = true`, and 0.2% have `is_verified = false`. An admin dashboard frequently queries unverified users. What indexing strategy should you implement?**  
*Answer*: Create a **Partial Index**: `CREATE INDEX idx_users_unverified ON users (id, created_at) WHERE is_verified = false;`. A standard index on `is_verified` would be huge and virtually useless because the query planner avoids low-selectivity indexes. The partial index only indexes the 0.2% of unverified rows (~100,000 rows instead of 50,000,000), resulting in an index that is tiny, fits easily in RAM, and makes queries instantaneous.

### Advanced
**Q: What is a GIN (Generalized Inverted Index) index, and why is it preferred over B-Trees for JSONB documents and array columns?**  
*Answer*: A B-Tree treats an entire JSON document or array as a single atomic scalar key. If an array contains 10 elements, a B-Tree cannot look inside the array without scanning every value. A GIN index breaks composite documents into individual key-value elements or tokens. For each unique element, GIN maintains an inverted list (posting list) of all row IDs containing that element. Queries using containment operators (`@>`, `?`, `?&`) can immediately look up the token and perform fast bitwise intersection of posting lists in memory.

---

## 16. Coding Questions

### Problem 1: Analyzing EXPLAIN Output and Designing the Optimal Index
Given the following slow query running against an e-commerce `orders` table (10,000,000 rows):

```sql
-- SLOW QUERY (Takes 2,400ms):
SELECT id, total_amount, created_at 
FROM orders 
WHERE customer_id = 'c_8829' 
  AND status IN ('SHIPPED', 'DELIVERED') 
ORDER BY created_at DESC 
LIMIT 20;

-- TASK: Design the optimal covering index that eliminates the Sort operation 
-- and achieves an Index-Only Scan.

-- SOLUTION:
CREATE INDEX idx_orders_customer_status_created 
ON orders (customer_id, status, created_at DESC) 
INCLUDE (id, total_amount);

-- EXPLANATION:
-- 1. customer_id is equality (=) -> Placed first.
-- 2. status is filtered -> Placed second.
-- 3. created_at DESC matches the ORDER BY clause -> Eliminates in-memory Sort.
-- 4. INCLUDE (id, total_amount) places non-key projection columns into the leaf nodes,
--    allowing an Index-Only Scan without reading the heap table.
-- Execution time drops from 2,400ms to 0.4ms!
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking "more indexes is always better." Junior developers index every column they filter on, without realizing that write-heavy systems will suffer massive write latency and disk bloat.
- **Trap 2**: Believing `LIKE '%abc'` uses a B-Tree index. It cannot; B-Tree indexes can only traverse prefixes (`LIKE 'abc%'`). For substring or suffix searches, you need `pg_trgm` GIN/GiST indexes.
- **Trap 3**: Believing an index eliminates all I/O. If a query requests columns not present in the index, the database must execute a **Heap Fetch** for every matching index entry, which can result in slow random I/O if the table is not cached in RAM.

---

## 18. Revision Summary
- **B-Tree**: Universal tree index for equality (`=`), ranges (`<`, `>`), and sorting (`ORDER BY`).
- **Hash Index**: Exact match (`=`) only; flat structure with no sorting or range capability.
- **GIN Index**: Inverted index mapping internal tokens/elements to row IDs; optimal for arrays, JSONB, and full-text search.
- **Leftmost Prefix Rule**: Multi-column indexes `(A, B, C)` require queries to filter on leading columns in order to be utilized.
- **Covering Index (`INCLUDE`)**: Embeds projection columns in index leaf nodes to enable zero-heap Index-Only Scans.
- **Partial Index (`WHERE`)**: Indexes a small subset of rows matching a condition, saving massive disk space and RAM.

---

## 19. Quick Reference

| Feature | Syntax / Command | When to Use |
| :--- | :--- | :--- |
| **B-Tree Index** | `CREATE INDEX idx ON tbl (col);` | Primary keys, foreign keys, timestamps, sorted columns |
| **Composite Index** | `CREATE INDEX idx ON tbl (colA, colB);` | Frequent multi-column filtering; obey leftmost prefix rule |
| **Covering Index** | `CREATE INDEX idx ON tbl (colA) INCLUDE (colB);` | Eliminates heap reads for specific high-frequency queries |
| **Partial Index** | `CREATE INDEX idx ON tbl (colA) WHERE active = true;` | Skewed data distributions (e.g., pending tasks, soft deletes) |
| **GIN Index** | `CREATE INDEX idx ON tbl USING gin (tags);` | Arrays, JSONB documents, full-text search |
| **Check Query Plan**| `EXPLAIN (ANALYZE, BUFFERS) SELECT ...` | Mandatory validation tool to verify index usage |
