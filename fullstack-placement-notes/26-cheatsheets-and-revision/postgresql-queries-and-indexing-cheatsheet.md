# PostgreSQL Queries & Indexing Cheatsheet & Deep Dive

---

## 1. What is it?

The PostgreSQL Queries and Indexing Cheatsheet is a high-density, authoritative reference guide covering modern SQL querying techniques, advanced analytical window functions, CTEs (Common Table Expressions), execution plan interpretation, and the complete taxonomy of PostgreSQL index types (**B-Tree, Hash, GIN, GiST, BRIN, Partial, Functional, and Covering Indexes**). It provides senior-level clarity on the exact **logical SQL execution order**, internal **storage engine page layouts (8KB heap tuples)**, and performance tuning rules required to solve complex placement coding problems and ace database optimization rounds.

```
+-----------------------------------------------------------------------------------+
|                     PostgreSQL Query & Indexing Architecture                      |
+-----------------------------------------------------------------------------------+
| Logical SQL Order:     FROM -> JOIN -> WHERE -> GROUP BY -> HAVING -> SELECT      |
|                        -> DISTINCT -> ORDER BY -> LIMIT / OFFSET                  |
| Analytical Primitives: Window Functions (DENSE_RANK, LEAD/LAG), Recursive CTEs    |
| Index Architecture:    B-Tree (O(log N) Scalar), GIN (Inverted), BRIN (Block Range)|
| Performance Scans:     Seq Scan vs Index Scan vs Index Only Scan vs Bitmap Scan   |
| Engine Diagnostics:    EXPLAIN (ANALYZE, BUFFERS, VERBOSE, COSTS)                 |
+-----------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Relational databases store data on disk as unordered collections of 8KB data blocks:
1. **Full Table Scans are Prohibitive:** Scanning a 100-million row table to find a single user record requires reading gigabytes of disk blocks, causing multi-second delays and high I/O wait times. Indexes provide $O(\log N)$ tree structures that point directly to the exact page offset (`TID: (Block, Offset)`).
2. **Complex Analytical Reporting:** Traditional SQL with standard `GROUP BY` collapses individual rows. Window functions exist to compute running totals, moving averages, and rankings *without* collapsing rows.
3. **Hierarchical Graph Traversal:** Standard relational queries struggle with recursive trees (categories, org charts, graph relationships). Recursive CTEs (`WITH RECURSIVE`) provide declarative recursion within SQL.

---

## 3. Mental Model

To master PostgreSQL in interviews, memorize the **10-Step Logical Execution Order of SQL**:

```
[ SQL QUERY WRITTEN ]
  SELECT DISTINCT department, AVG(salary) 
  FROM employees 
  JOIN departments ON employees.dept_id = departments.id
  WHERE salary > 50000 
  GROUP BY department 
  HAVING COUNT(*) > 5 
  ORDER BY AVG(salary) DESC 
  LIMIT 10;

                                  |
                                  v
[ ACTUAL LOGICAL EXECUTION ORDER IN DATABASE ENGINE ]
  1. FROM        (Loads target base table)
  2. JOIN & ON   (Applies join conditions and Cartesian product filters)
  3. WHERE       (Filters individual base rows BEFORE aggregation)
  4. GROUP BY    (Groups remaining rows into distinct buckets)
  5. HAVING      (Filters aggregated groups AFTER grouping)
  6. SELECT      (Computes expressions, columns, and window functions)
  7. DISTINCT    (Eliminates duplicate output rows)
  8. ORDER BY    (Sorts the final result set)
  9. LIMIT       (Restricts total rows returned)
  10. OFFSET     (Skips leading rows)
```

---

## 4. Basic Example

### The Complete Join Spectrum

```sql
-- 1. INNER JOIN: Returns matching rows in BOTH tables
SELECT u.name, o.total FROM users u 
INNER JOIN orders o ON u.id = o.user_id;

-- 2. LEFT JOIN: Returns ALL rows from left, matching rows from right (NULL if none)
SELECT u.name, o.total FROM users u 
LEFT JOIN orders o ON u.id = o.user_id;

-- 3. FULL OUTER JOIN: Returns all rows when there is a match in EITHER table
SELECT u.name, o.total FROM users u 
FULL OUTER JOIN orders o ON u.id = o.user_id;

-- 4. CROSS JOIN: Cartesian product of all rows (M * N rows)
SELECT s.size, c.color FROM sizes s CROSS JOIN colors c;

-- 5. SEMI-JOIN (EXISTS): Returns left rows that have AT LEAST ONE match in right
SELECT * FROM users u 
WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);

-- 6. ANTI-JOIN (NOT EXISTS): Returns left rows that have NO match in right
SELECT * FROM users u 
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id);
```

---

## 5. Real Example

### Advanced Window Functions & CTE: Employee Salary Quartiles and Running Totals

```sql
WITH department_stats AS (
    SELECT 
        id,
        first_name,
        last_name,
        department,
        salary,
        -- 1. Rank without skipping numbers
        DENSE_RANK() OVER (
            PARTITION BY department 
            ORDER BY salary DESC
        ) AS rank_in_dept,
        -- 2. Running cumulative salary total within department
        SUM(salary) OVER (
            PARTITION BY department 
            ORDER BY salary DESC 
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS running_dept_salary,
        -- 3. Previous employee's salary in same department
        LAG(salary, 1, 0) OVER (
            PARTITION BY department 
            ORDER BY salary DESC
        ) AS prev_higher_salary,
        -- 4. Salary percentile quartile (1 = Top 25%, 4 = Bottom 25%)
        NTILE(4) OVER (
            PARTITION BY department 
            ORDER BY salary DESC
        ) AS salary_quartile
    FROM employees
)
SELECT 
    department,
    first_name || ' ' || last_name AS full_name,
    salary,
    rank_in_dept,
    running_dept_salary,
    prev_higher_salary - salary AS salary_gap_to_next,
    salary_quartile
FROM department_stats
WHERE rank_in_dept <= 3
ORDER BY department, rank_in_dept;
```

---

## 6. Under the Hood

### Index Types Taxonomy & Anatomy

```
+------------------------------------------------------------------------------------+
| 1. B-Tree (Default): Balanced multi-way search tree. O(log N) lookup.              |
|    - Best for: Equality (=), Range (<, <=, >, >=), BETWEEN, Sorting (ORDER BY).    |
+------------------------------------------------------------------------------------+
| 2. Hash Index: O(1) hash table mapping hash(key) to page TID.                      |
|    - Best for: Pure equality (=) checks only. Cannot handle range queries or sorts.|
+------------------------------------------------------------------------------------+
| 3. GIN (Generalized Inverted Index): Maps element values to array of row IDs.      |
|    - Best for: JSONB containment (@>), Full-Text Search (tsvector @@ tsquery),     |
|      Array containment (tags && ARRAY['postgres']).                                |
+------------------------------------------------------------------------------------+
| 4. GiST (Generalized Search Tree): Balanced tree for non-scalar geometric data.    |
|    - Best for: PostGIS coordinates, polygon overlaps (&&), Range types (tsrange).  |
+------------------------------------------------------------------------------------+
| 5. BRIN (Block Range Index): Stores min/max summaries for physical ranges of pages.|
|    - Best for: Multi-billion row append-only timeseries tables sorted by time.     |
|      Size: 99% smaller than B-Tree!                                                |
+------------------------------------------------------------------------------------+
```

---

## 7. Important Rules

1. **The Leftmost Prefix Rule for Composite Indexes:** An index on `(A, B, C)` can satisfy queries on `WHERE A = 1`, `WHERE A = 1 AND B = 2`, and `WHERE A = 1 AND B = 2 AND C = 3`. It CANNOT satisfy a query on `WHERE B = 2` alone because the B-Tree is ordered by A first.
2. **Never Index Low-Cardinality Columns Alone:** An index on a boolean column (`is_active` where true=50%, false=50%) is ignored by the planner because reading index blocks plus heap blocks is slower than a direct sequential scan.
3. **Covering Indexes for Index-Only Scans:** Use the `INCLUDE` clause to append non-search columns into index leaf nodes:
   ```sql
   CREATE INDEX idx_users_email ON users(email) INCLUDE (full_name);
   ```
   PostgreSQL can return `full_name` directly from the index in RAM without touching the heap data blocks on disk (Index-Only Scan).
4. **Avoid Functions on Indexed Columns in `WHERE` Clauses:** Writing `WHERE LOWER(email) = 'alex@acme.com'` invalidates the B-Tree index on `email`. You must write a functional index: `CREATE INDEX idx_lower_email ON users(LOWER(email))`.

---

## 8. Common Mistakes

### Mistake 1: Using `NOT IN` with Nullable Columns
Using `WHERE id NOT IN (SELECT user_id FROM bad_users)`. If `bad_users` contains a single `NULL` value, SQL three-valued logic causes the entire query to return **zero rows**!
*Fix:* Always use `WHERE NOT EXISTS (SELECT 1 FROM bad_users WHERE ...)` or filter out NULLs explicitly.

### Mistake 2: Missing Indexes on Foreign Keys
Assuming that creating a `FOREIGN KEY` constraint creates an index on the child table's foreign key column. It does not! Deleting or updating a row in the parent table forces a full table scan on the child table to check for cascades.

### Mistake 3: Pagination with High `OFFSET`
Writing `SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 500000;`. The database must read and discard 500,000 rows before returning the 20 target rows ($O(N)$ scan).
*Fix:* Use Keyset Pagination (Cursor Pagination): `SELECT * FROM orders WHERE id > 500000 ORDER BY id LIMIT 20;` ($O(1)$ index lookup).

---

## 9. Best Practices

1. **Partial Indexes for Sparse Queries:**
   ```sql
   CREATE INDEX idx_pending_orders ON orders(created_at) WHERE status = 'PENDING';
   ```
   If 99% of orders are `COMPLETED`, this index is 99% smaller and dramatically faster.
2. **Profile with `EXPLAIN (ANALYZE, BUFFERS)`:**
   Always inspect `Buffers: shared read=...` (disk reads) vs `shared hit=...` (RAM cache hits) to evaluate actual I/O cost.
3. **Use `UNION ALL` instead of `UNION`:**
   `UNION` executes an expensive in-memory sort and deduplication pass. If sets are mutually exclusive or duplicates are acceptable, always use `UNION ALL`.
4. **Connection Pooling via PgBouncer:** Use PgBouncer in transaction pooling mode to multiplex thousands of client connections onto a small pool of database backend processes.

---

## 10. Performance Considerations

* **`work_mem` Allocation:** Controls memory allocated for in-memory sorting (`ORDER BY`) and hash tables (`Hash Join`). If a query's sort exceeds `work_mem`, PostgreSQL spills data to temporary files on disk, causing a 100x slowdown.
* **Autovacuum Tuning:** PostgreSQL's MVCC creates dead tuples on every `UPDATE` and `DELETE`. Ensure `autovacuum` runs frequently to reclaim dead tuples and prevent **Table Bloat**.

---

## 11. Security Considerations

* **Row-Level Security (RLS) for Multi-Tenancy:**
  ```sql
  ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
  CREATE POLICY tenant_isolation ON accounts 
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
  ```
  Guarantees that queries can never read another tenant's rows, even if application code omits `WHERE tenant_id = ...`.
* **Zero SQL Injection:** Always use parameterized placeholders (`$1, $2`). Never concatenate strings into dynamic SQL queries.

---

## 12. Complete Index Comparison Matrix

| Index Type | Internal Structure | Optimal Queries | Size / Overhead |
| :--- | :--- | :--- | :--- |
| **B-Tree** | Multi-level balanced tree | `=`, `<`, `>`, `BETWEEN`, `ORDER BY` | Moderate size, high update overhead |
| **Hash** | Hash buckets | Exact equality (`=`) only | Compact, fast writes |
| **GIN** | Inverted index (term -> posting list) | Array `&&`, JSONB `@>`, Full-text `@@` | Large size, slower writes, fast reads |
| **GiST** | Generalized Search Tree | Geospatial bounding box, ranges `&&` | Moderate size, fast spatial math |
| **BRIN** | Min/Max ranges per 128 pages | Timeseries append-only range scans | **Tiny (1% of B-Tree)**, near-zero write cost |

---

## 13. Trade-offs

* **Index Count vs Write Amplification:** Adding indexes speeds up `SELECT` queries, but linearly degrades `INSERT`, `UPDATE`, and `DELETE` throughput because every index must be modified on disk.
* **CTE Materialization (`MATERIALIZED` vs `NOT MATERIALIZED`):** In modern PostgreSQL, CTEs are inlined by default. Adding `WITH cte AS MATERIALIZED (...)` forces PostgreSQL to compute and cache the CTE as an in-memory temporary table, preventing duplicate execution but blocking the planner from pushing down `WHERE` clauses into the CTE.

---

## 14. Real-World Usage

* **GitLab:** Uses PostgreSQL Partial Indexes extensively to index active CI/CD pipeline jobs (`WHERE status = 'running'`), keeping hot queues ultra-fast while archiving billions of finished jobs.
* **Uber:** Uses BRIN indexes on multi-billion row ride telemetry tables, reducing index storage from 500GB down to 500MB while maintaining fast date-range queries.

---

## 15. Placement Interview Questions

### Basic Level
1. **Explain the difference between `RANK()`, `DENSE_RANK()`, and `ROW_NUMBER()`.**
   * *Answer:* When ranking values that have identical duplicates (e.g., salaries: 100, 100, 80):
     - `ROW_NUMBER()`: Assigns unique sequential integers regardless of ties (1, 2, 3).
     - `RANK()`: Assigns identical ranks to ties, but **skips subsequent ranks** (1, 1, 3).
     - `DENSE_RANK()`: Assigns identical ranks to ties, but **does NOT skip ranks** (1, 1, 2).

2. **What is the difference between `WHERE` and `HAVING`?**
   * *Answer:* `WHERE` filters individual rows **before** any grouping or aggregation takes place. `HAVING` filters aggregated groups **after** the `GROUP BY` clause has evaluated group summaries.

3. **What is the difference between `UNION` and `UNION ALL`?**
   * *Answer:* `UNION ALL` combines results from two queries directly, preserving duplicate rows (fast). `UNION` combines results and executes an additional deduplication sort pass to remove duplicate rows (slower).

4. **What is a Common Table Expression (CTE) and how does it differ from a Subquery?**
   * *Answer:* A CTE (`WITH cte_name AS (...)`) defines a temporary named result set accessible within the scope of a single query. Unlike subqueries, CTEs can be referenced multiple times within the same query, support recursive operations (`WITH RECURSIVE`), and drastically improve query readability and maintainability.

5. **What is the difference between `DELETE`, `TRUNCATE`, and `DROP`?**
   * *Answer:*
     - `DELETE`: DML command; deletes specific rows matching a `WHERE` clause; logs every deleted tuple in the WAL; fires row triggers; creates dead tuples.
     - `TRUNCATE`: DDL command; quickly removes all rows by deallocating the underlying data pages on disk; minimal WAL logging; resets auto-increment sequences; cannot be filtered.
     - `DROP`: DDL command; completely removes table schema, data, triggers, and constraints from the system catalog.

---

### Conceptual Level
6. **Walk me through how a PostgreSQL B-Tree Index performs a search under the hood.**
   * *Answer:*
     1. Starts at the **Root Page** in memory buffer.
     2. Compares search key against high/low boundary keys on the page.
     3. Follows the page pointer to the appropriate child **Branch Page**.
     4. Traverses down branch levels ($O(\log N)$ steps, typically 3–4 levels).
     5. Reaches the **Leaf Page**, which contains sorted pairs of `(Key, ItemPointer/TID)`.
     6. Uses the `TID (BlockNumber, OffsetNumber)` to retrieve the exact tuple from the table's heap page.

7. **Explain the four query execution scan types in `EXPLAIN`: Seq Scan, Index Scan, Index Only Scan, and Bitmap Index Scan.**
   * *Answer:*
     - *Sequential Scan:* Reads every page and row of the table from start to finish on disk ($O(N)$).
     - *Index Scan:* Traverses B-Tree to find matching TIDs, then performs random disk reads to load each matching row from the table heap.
     - *Index Only Scan:* All requested columns are present in the index itself (Covering Index) and rows are marked visible in the Visibility Map; does **not touch the heap at all** (fastest).
     - *Bitmap Index Scan:* Scans the index, builds an in-memory bitmap of matching page physical locations, sorts them by disk block order, and performs a sequential batch read of the heap pages (avoids random I/O).

8. **What is a Recursive CTE and how does its execution loop terminate?**
   * *Answer:* A recursive CTE (`WITH RECURSIVE`) consists of:
     1. *Anchor Member:* Non-recursive query that generates the initial base result set.
     2. `UNION ALL`: Combines anchor and recursive results.
     3. *Recursive Member:* Query that references the CTE name, operating on the intermediate working table from the previous step.
     * *Termination:* The engine executes the recursive step repeatedly until the recursive query produces **zero new rows** (an empty working table).

9. **Explain PostgreSQL MVCC (Multi-Version Concurrency Control) and why `VACUUM` is required.**
   * *Answer:* When a row is updated, PostgreSQL does not overwrite the row in place. It marks the old row's `xmax` attribute with the current transaction ID and inserts a brand new tuple with `xmin = current_tx`. Readers never block writers. Over time, dead tuples (rows deleted or superseded by updates) accumulate on disk pages. `VACUUM` scans pages, marks dead tuple space as available for future `INSERT`s, and freezes old transaction IDs to prevent 32-bit transaction ID wraparound.

10. **What is the difference between a Partial Index and a Covering Index?**
    * *Answer:*
      - *Partial Index:* An index that includes only a subset of table rows defined by a `WHERE` clause: `CREATE INDEX ON orders(user_id) WHERE status = 'PENDING';`. Reduces index size on disk.
      - *Covering Index:* An index that includes extra payload columns using the `INCLUDE` clause: `CREATE INDEX ON users(email) INCLUDE (full_name);`. Allows queries to be satisfied entirely from the index (Index-Only Scan) without visiting the heap table.

---

### Implementation Level
11. **Write a SQL query using a Window Function to find the 2nd highest salary in each department.**
    * *Answer:*
    ```sql
    WITH ranked_salaries AS (
        SELECT 
            department,
            first_name,
            last_name,
            salary,
            DENSE_RANK() OVER (
                PARTITION BY department 
                ORDER BY salary DESC
            ) as rnk
        FROM employees
    )
    SELECT department, first_name, last_name, salary
    FROM ranked_salaries
    WHERE rnk = 2;
    ```

12. **Write a Recursive CTE to display an organizational reporting hierarchy tree.**
    * *Answer:*
    ```sql
    WITH RECURSIVE OrgTree AS (
        -- Anchor: Top-level CEO (manager_id is NULL)
        SELECT id, name, manager_id, 1 as level, name::text as path
        FROM employees
        WHERE manager_id IS NULL

        UNION ALL

        -- Recursive step: Employees reporting to managers in OrgTree
        SELECT e.id, e.name, e.manager_id, ot.level + 1, (ot.path || ' -> ' || e.name)::text
        FROM employees e
        INNER JOIN OrgTree ot ON e.manager_id = ot.id
    )
    SELECT level, path FROM OrgTree ORDER BY path;
    ```

13. **How do you safely add an index to a 50-million-row production table without locking concurrent writes?**
    * *Answer:* Always use `CONCURRENTLY`:
    ```sql
    CREATE INDEX CONCURRENTLY idx_orders_user_id ON orders(user_id);
    ```
    Without `CONCURRENTLY`, PostgreSQL acquires an `SHARE` lock on the table, blocking all concurrent `INSERT`, `UPDATE`, and `DELETE` queries until the index build finishes. `CONCURRENTLY` performs two table scans and builds the index without blocking writes.

14. **Write a query to find consecutive active login days (Gaps and Islands problem).**
    * *Answer:*
    ```sql
    WITH numbered_logins AS (
        SELECT 
            user_id,
            login_date,
            login_date - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY login_date))::int AS island_group
        FROM user_logins
        GROUP BY user_id, login_date
    )
    SELECT 
        user_id,
        MIN(login_date) as streak_start,
        MAX(login_date) as streak_end,
        COUNT(*) as streak_days
    FROM numbered_logins
    GROUP BY user_id, island_group
    HAVING COUNT(*) >= 3;
    ```

15. **How do you implement full-text search with indexing on a blog post `title` and `body`?**
    * *Answer:*
    ```sql
    -- Generated stored tsvector column
    ALTER TABLE posts ADD COLUMN tsv_content tsvector 
    GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body)) STORED;

    -- GIN Index
    CREATE INDEX idx_posts_search ON posts USING GIN(tsv_content);

    -- Search Query
    SELECT title, ts_rank(tsv_content, query) as relevance
    FROM posts, to_tsquery('english', 'react & performance') query
    WHERE tsv_content @@ query
    ORDER BY relevance DESC;
    ```

---

### Debugging Level
16. **Why did a query running `SELECT * FROM users WHERE email = 'test@example.com'` perform a `Seq Scan` even though an index exists on `email`?**
    * *Answer:*
      1. *Small Table:* The table contains only a few hundred rows. The planner calculates that sequential scanning is faster than loading both index blocks and heap blocks.
      2. *Stale Statistics:* The table was loaded without running `ANALYZE users;`, causing the planner to misjudge table size.
      3. *Type Mismatch:* Querying a `VARCHAR` column with an implicit numeric or non-matching collation.

17. **Why does an `UPDATE` query on Table A lock up and wait indefinitely?**
    * *Answer:* Another concurrent transaction has locked the target row (or the whole table) and has not yet committed or rolled back.
    * *Debugging:* Inspect `pg_stat_activity` and `pg_locks` to find the blocking PID:
      ```sql
      SELECT pid, query, state, age(clock_timestamp(), query_start) 
      FROM pg_stat_activity 
      WHERE state != 'idle';
      ```

18. **Why does a query with `ORDER BY created_at DESC LIMIT 10` run slowly on a table with a B-Tree index on `created_at`?**
    * *Answer:* The index was created in default ascending order (`created_at ASC`), and the query requires nulls first/last handling that does not match index ordering. To optimize backward scans, create the index matching the exact query: `CREATE INDEX idx_created_desc ON orders(created_at DESC NULLS LAST);`.

19. **Why did a database disk usage increase by 100GB even though the number of total rows remained constant?**
    * *Answer:* **Table Bloat**. The application executed millions of `UPDATE` queries. Because PostgreSQL MVCC writes a new tuple on every update and marks the old tuple dead, dead space accumulates if `autovacuum` cannot keep up or is blocked by a long-running transaction. Run `VACUUM ANALYZE` or use `pg_repack` to eliminate bloat online.

20. **Why does `SELECT COUNT(*) FROM big_table` take 5 seconds in PostgreSQL, while in MySQL MyISAM it is instant?**
    * *Answer:* MySQL MyISAM stored a static counter in table headers (at the cost of table-level locking). Because PostgreSQL uses MVCC, there is no single "current row count"; every row's visibility depends on the inspecting transaction's active snapshot. PostgreSQL must perform a full scan of the Visibility Map and heap pages to determine which rows are visible to the calling transaction.

---

### Scenario-Based Questions
21. **Scenario: High-Volume E-Commerce Flash Sale. 100,000 customers are purchasing inventory concurrently. How do you prevent inventory overselling and avoid deadlocks in SQL?**
    * *Answer:*
      - Use row-level locking with explicit lock order:
      ```sql
      BEGIN;
      SELECT stock FROM products WHERE id = $1 FOR UPDATE;
      -- Verify stock >= quantity
      UPDATE products SET stock = stock - $1 WHERE id = $2;
      INSERT INTO order_items ...;
      COMMIT;
      ```
      - To completely eliminate deadlocks when an order contains multiple products: **always sort product IDs in ascending order before acquiring `FOR UPDATE` locks**.

22. **Scenario: Time-Series IoT Telemetry Table receiving 500 million records per month. Queries exclusively query date ranges within the last 7 days. How do you design this in PostgreSQL?**
    * *Answer:*
      - Implement **Declarative Range Partitioning** on `created_at` (e.g., weekly or monthly partitions: `telemetry_2026_w1`, `telemetry_2026_w2`).
      - Use **BRIN Indexes** on `created_at` within each partition (99% smaller than B-Trees).
      - Partition pruning ensures queries for the last 7 days scan only the active weekly partition.
      - Archiving data older than 90 days is instant: `DROP TABLE telemetry_2025_w40;`.

23. **Scenario: You need to implement soft-deletes (`deleted_at IS NULL`) across all tables while enforcing a `UNIQUE(username)` constraint on active users. How do you solve this?**
    * *Answer:* Use a **Partial Unique Index**:
    ```sql
    CREATE UNIQUE INDEX uq_active_username ON users(username) 
    WHERE deleted_at IS NULL;
    ```
    Allows multiple soft-deleted historical records with the same username, while guaranteeing that only one active user can hold that username.

24. **Scenario: You have a social media activity feed where users follow friends. Write a query to fetch the latest 20 posts from all accounts a user follows.**
    * *Answer:*
    ```sql
    SELECT p.id, p.content, p.created_at, u.username
    FROM follows f
    INNER JOIN posts p ON f.following_id = p.author_id
    INNER JOIN users u ON p.author_id = u.id
    WHERE f.follower_id = $1
    ORDER BY p.created_at DESC
    LIMIT 20;
    ```
    *Required Indexes:* Composite index on `follows(follower_id, following_id)` and composite index on `posts(author_id, created_at DESC)`.

25. **Scenario: How do you paginate an infinite feed of 10 million posts without using slow `OFFSET`?**
    * *Answer:* Use **Keyset Pagination (Cursor-based Pagination)**:
    ```sql
    -- Fetch first page
    SELECT id, title, created_at FROM posts ORDER BY created_at DESC, id DESC LIMIT 20;

    -- Fetch subsequent page using cursor of last item (e.g. created_at = '2026-03-01 10:00:00', id = 9981)
    SELECT id, title, created_at FROM posts 
    WHERE (created_at, id) < ('2026-03-01 10:00:00', 9981)
    ORDER BY created_at DESC, id DESC 
    LIMIT 20;
    ```
    Executes in constant time ($O(1)$) regardless of page depth using composite index `(created_at DESC, id DESC)`.

---

### Advanced Architectural Questions
26. **Explain Write Amplification caused by HOT (Heap-Only Tuples) optimization failures.**
    * *Answer:* When a row is updated in PostgreSQL, if any indexed column changes, every single index on that table must have a new entry inserted pointing to the new tuple. HOT optimization allows PostgreSQL to update a row without updating indexes if *none* of the indexed columns were modified and space exists in the same 8KB data page. If HOT fails, write amplification spikes, bloating both table heaps and index trees.

27. **What is the difference between Write Skew and Phantom Read anomalies?**
    * *Answer:*
      - *Phantom Read:* Transaction A reads a set of rows matching a condition. Transaction B inserts a new row matching that condition and commits. Transaction A re-reads and discovers a "phantom" row that was not present previously.
      - *Write Skew:* Two concurrent transactions read overlapping data, verify a constraint (e.g., at least one doctor must be on call), and make disjoint updates (Doctor 1 takes leave, Doctor 2 takes leave). Neither transaction modifies the other's row, but the combined result violates the global invariant. Prevented *only* by `SERIALIZABLE` isolation.

28. **How does PostgreSQL handle Parallel Query Execution?**
    * *Answer:* When a query scans large tables, the optimizer spawns a Gather node and multiple parallel worker processes (`max_parallel_workers_per_gather`). Workers scan distinct chunks of data blocks concurrently (Parallel Seq Scan or Parallel Hash Join), sending intermediate tuples through shared memory queues back to the Gather node, which aggregates results for the client.

29. **What is an Index Bloom Filter and how does it compare to GIN?**
    * *Answer:* The `bloom` extension provides multi-column indexing based on Bloom filters. While B-Trees require exact leftmost prefix matching, a Bloom index can test arbitrary combinations of columns in equality queries. However, Bloom indexes are lossy and require an index-scan confirmation step against heap pages.

30. **Explain how PostgreSQL handles JSONB indexing internally.**
    * *Answer:* `JSONB` stores decomposed binary JSON with fast access keys. When indexed with GIN:
      - Default GIN operator class (`jsonb_ops`): Indexes every path, key, and scalar element.
      - Path GIN operator class (`jsonb_path_ops`): Indexes only the cryptographic hash of each full path and value (`hash(path + value)`), making index size 50% smaller and lookups (`@>`) significantly faster.

---

## 16. Coding Questions

### Coding Challenge 1: Find Active Users with No Purchases in the Last 30 Days

```sql
SELECT u.id, u.email, u.created_at
FROM users u
WHERE u.is_active = true
  AND NOT EXISTS (
      SELECT 1 
      FROM orders o 
      WHERE o.user_id = u.id 
        AND o.created_at >= CURRENT_DATE - INTERVAL '30 days'
  )
ORDER BY u.created_at DESC;
```

### Coding Challenge 2: Running Balance Calculation per Account

```sql
SELECT 
    transaction_id,
    account_id,
    amount,
    transaction_time,
    SUM(amount) OVER (
        PARTITION BY account_id 
        ORDER BY transaction_time ASC, transaction_id ASC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS running_balance
FROM transactions
ORDER BY account_id, transaction_time;
```

---

## 17. Common Interview Traps

* **The Trap:** The interviewer asks: *"Does `COUNT(column_name)` return the same result as `COUNT(*)`?"*
  * **How candidates fail:** Saying "Yes, both count the total rows in the table."
  * **The Winning Answer:** **No!** `COUNT(*)` counts the total number of rows returned by the query, including rows with NULL values. `COUNT(column_name)` counts **only rows where `column_name` IS NOT NULL**. If a column contains 10 nulls across 100 rows, `COUNT(*)` returns 100, but `COUNT(column_name)` returns 90.
* **The Trap:** *"Can you use a B-Tree index for a query with `WHERE title LIKE '%react%'`?"*
  * **How candidates fail:** Saying "Yes, B-Tree indexes speed up LIKE queries."
  * **The Winning Answer:** **No!** Standard B-Trees can only satisfy prefix searches (`WHERE title LIKE 'react%'`). A wildcard at the start (`'%react%'`) prevents B-Tree range traversal, forcing a full Sequential Scan. To accelerate substring searches, you must use a **Trigram Index (GIN with `pg_trgm`)**: `CREATE INDEX ON posts USING GIN (title gin_trgm_ops);`.

---

## 18. Revision Summary

```
+-----------------------------------------------------------------------------------+
|               PostgreSQL Queries & Indexing High-Yield Revision Matrix            |
+-----------------------------------------------------------------------------------+
| Logical Order:       FROM -> WHERE -> GROUP BY -> HAVING -> SELECT -> ORDER BY    |
| Window Functions:    DENSE_RANK (no gap); LAG/LEAD (prev/next row); PARTITION BY  |
| Indexes:             B-Tree (O(log N)), GIN (JSONB/Search), BRIN (massive append) |
| Composite Rule:      Leftmost prefix matching required; foreign keys need indexes |
| Partial Index:       CREATE INDEX ... WHERE status = 'PENDING' (saves 95% space)  |
| Explain Output:      Index Only Scan (fastest); Bitmap Scan (sorted blocks)       |
| Pagination:          Never use high OFFSET; use Keyset Cursor (WHERE id > last_id)|
+-----------------------------------------------------------------------------------+
```

---

## 19. Quick Reference

* **`DENSE_RANK() OVER (...)`:** Window function assigning ranks without skipped numbers.
* **`LAG(col, offset, default)`:** Reads value from preceding row within window partition.
* **`CREATE INDEX CONCURRENTLY`:** Builds index without locking table writes.
* **`EXPLAIN (ANALYZE, BUFFERS)`:** Inspects real execution time and memory buffer hits.
* **`INCLUDE (col1, col2)`:** Appends payload columns into B-Tree leaf nodes for Index-Only scans.
* **`WITH RECURSIVE`:** Enables hierarchical tree and graph SQL queries.
* **`gin_trgm_ops`:** Trigram GIN index operator class for accelerating `LIKE '%term%'` queries.
