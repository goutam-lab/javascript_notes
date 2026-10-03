# Common Table Expressions (CTE) and Recursive Queries

## 1. What is it?
A **Common Table Expression (CTE)** is a named, temporary result set defined within the execution scope of a single SQL statement (`SELECT`, `INSERT`, `UPDATE`, or `DELETE`) using the **`WITH`** clause. 

CTEs serve as clean, modular "in-line views" that break complex nested spaghetti queries into sequential, readable, and composable logical blocks. 

A **Recursive CTE** is a specialized variant of a CTE that references itself in a recursive step, enabling SQL to traverse graphs, tree hierarchies, nested categories, organizational charts, and threaded comment chains directly inside the database engine without requiring procedural code.

```
Standard CTE Pipeline:
WITH 
  regional_sales AS (
    SELECT region, SUM(amount) AS total_sales FROM orders GROUP BY region
  ),
  top_regions AS (
    SELECT region FROM regional_sales WHERE total_sales > 1000000
  )
SELECT * FROM orders WHERE region IN (SELECT region FROM top_regions);

Recursive CTE Architecture:
WITH RECURSIVE org_tree AS (
  -- 1. Anchor Member (Base Case: e.g., CEO with no manager)
  SELECT id, name, manager_id, 1 as depth FROM employees WHERE manager_id IS NULL
  
  UNION ALL
  
  -- 2. Recursive Member (Recursive Step: Joins to previous iteration)
  SELECT e.id, e.name, e.manager_id, ot.depth + 1 
  FROM employees e
  INNER JOIN org_tree ot ON e.manager_id = ot.id
)
SELECT * FROM org_tree; -- 3. Termination: Halts when recursive step returns 0 rows!
```

---

## 2. Why does it exist?
1. **Eliminating Nested Subquery Unreadability**: Deeply nested subqueries force developers to read SQL "from the inside out," making queries with 4+ levels of nesting unmaintainable and error-prone. CTEs allow linear, top-to-bottom procedural-like readability.
2. **Graph and Hierarchy Traversal**: Relational databases store data in flat tables. Traversing an organizational hierarchy or a tree of comments (e.g., Reddit threads) in traditional SQL without recursion required either making $N$ separate network calls from Node.js (triggering severe N+1 problems) or using fragile nested-set models with high write overhead.
3. **Data Mutation CTEs (`WITH ... INSERT ... RETURNING`)**: Modern PostgreSQL permits DML statements inside CTEs, allowing developers to insert a parent order and immediately use its generated IDs to insert child line items in a single, atomic SQL statement.

---

## 3. Mental Model
Think of CTEs as **Step-by-Step Mathematical Proofs or Code Variables**:
- **Nested Subqueries**: Writing an entire algebraic equation in one unreadable single-line formula:
  $$f(x) = \sqrt{\frac{\sum (x_i - \bar{x})^2}{N - 1}}$$
- **Standard CTEs**: Breaking it down with intermediate variables:
  ```typescript
  const mean = calculateMean(data);
  const squaredDiffs = calculateSquaredDiffs(data, mean);
  const variance = sum(squaredDiffs) / (data.length - 1);
  const stdDev = Math.sqrt(variance);
  ```
- **Recursive CTE**: A classic recursive algorithm:
  ```typescript
  function traverse(node: TreeNode, depth: number): TreeNodeOutput[] {
    // Anchor Member (Base case)
    let results = [{ ...node, depth }];
    // Recursive Member
    for (const child of node.children) {
      results = results.concat(traverse(child, depth + 1));
    }
    return results;
  }
  ```

---

## 4. Basic Example
A standard multi-step CTE in SQL:

```sql
-- Calculate the top 3 highest spending customers in each country:
WITH customer_spending AS (
  SELECT 
    c.id AS customer_id,
    c.name,
    c.country,
    SUM(o.total_amount) AS total_spent
  FROM customers c
  INNER JOIN orders o ON c.id = o.customer_id
  GROUP BY c.id, c.name, c.country
),
ranked_customers AS (
  SELECT 
    customer_id,
    name,
    country,
    total_spent,
    ROW_NUMBER() OVER (PARTITION BY country ORDER BY total_spent DESC) AS country_rank
  FROM customer_spending
)
SELECT * 
FROM ranked_customers 
WHERE country_rank <= 3
ORDER BY country, country_rank;
```

---

## 5. Real Example: Threaded Comment Trees in TypeScript (Recursive CTE)
A production TypeScript / PostgreSQL repository method fetching an entire nested Reddit-style discussion tree with depth limits and cycle detection:

```typescript
import { dbPool } from './db';

interface CommentNode {
  id: string;
  postId: string;
  parentId: string | null;
  authorName: string;
  body: string;
  depth: number;
  path: string[];
  createdAt: Date;
}

export class DiscussionRepository {
  /**
   * RECURSIVE CTE: Fetches a complete multi-level comment tree for a post.
   * Tracks depth, formats the hierarchy path, and prevents infinite loops!
   */
  public static async getCommentThread(postId: string, maxDepth: number = 5): Promise<CommentNode[]> {
    const query = `
      WITH RECURSIVE comment_tree AS (
        -- 1. ANCHOR MEMBER: Top-level root comments (parent_id IS NULL)
        SELECT 
          c.id,
          c.post_id,
          c.parent_id,
          u.username AS author_name,
          c.body,
          0 AS depth,
          ARRAY[c.id::text] AS path,
          c.created_at
        FROM post_comments c
        INNER JOIN users u ON c.user_id = u.id
        WHERE c.post_id = $1 AND c.parent_id IS NULL
        
        UNION ALL
        
        -- 2. RECURSIVE MEMBER: Direct child replies joined to previous level
        SELECT 
          child.id,
          child.post_id,
          child.parent_id,
          u.username AS author_name,
          child.body,
          parent.depth + 1,
          parent.path || child.id::text,
          child.created_at
        FROM post_comments child
        INNER JOIN users u ON child.user_id = u.id
        INNER JOIN comment_tree parent ON child.parent_id = parent.id
        -- Safety check: Enforce maximum tree depth to prevent runaway queries
        WHERE parent.depth < $2
          -- Cycle detection: Ensure node does not appear in its own ancestor path!
          AND NOT (child.id::text = ANY(parent.path))
      )
      -- 3. FINAL ORDERING: Order by hierarchical path to present in tree order
      SELECT 
        id,
        post_id AS "postId",
        parent_id AS "parentId",
        author_name AS "authorName",
        body,
        depth,
        path,
        created_at AS "createdAt"
      FROM comment_tree
      ORDER BY path;
    `;

    const result = await dbPool.query(query, [postId, maxDepth]);
    return result.rows;
  }
}
```

---

## 6. Under the Hood

### 1. How Recursive CTEs Execute Internally
Under the hood, PostgreSQL executes a recursive CTE using a specialized in-memory **Work Table**:

```
Step 1: Execute Anchor Member
        -> Emits base rows
        -> Writes base rows to: [Final Result Buffer] AND [Work Table]

Step 2: Enter Recursive Loop
        While [Work Table] is NOT EMPTY:
          a. Read rows from [Work Table]
          b. Substitute [Work Table] as the CTE reference in the Recursive Member
          c. Execute Recursive Member query
          d. Clear [Work Table]
          e. Load newly generated child rows into [Work Table] AND [Final Result Buffer]
          f. Repeat!

Step 3: Termination
        -> When the Recursive Member yields 0 rows, the loop terminates.
        -> Emit [Final Result Buffer] to the outer query.
```

### 2. CTE Inlining vs Materialization in Modern PostgreSQL
- **Historical PostgreSQL (Prior to v12)**:
  - Every CTE was strictly an **Optimization Barrier**.
  - PostgreSQL unconditionally executed and materialized the CTE into a private in-memory or on-disk buffer before running the outer query.
  - This prevented the query optimizer from pushing down `WHERE` predicates into the CTE, frequently making CTEs significantly slower than plain subqueries.
- **Modern PostgreSQL (v12+)**:
  - CTEs are now **Inlined automatically** by the query planner if they do not contain recursion or side-effects and are referenced only once.
  - If you *want* to force materialization (e.g., when a complex CTE is referenced multiple times and you want to prevent the engine from re-calculating it twice), you can explicitly specify:
    ```sql
    WITH my_expensive_calc AS MATERIALIZED (
      SELECT ...
    )
    ```

---

## 7. Important Rules
1. **The Recursive CTE Contract**: A recursive query must use `UNION` or `UNION ALL` to join the Anchor Member and the Recursive Member. `UNION ALL` is strongly preferred because `UNION` executes an expensive deduplication sort on every iteration.
2. **Recursion Must Have a Guaranteed Termination Condition**: If the dataset contains a cycle (Node A is parent of Node B, and Node B is parent of Node A), a recursive CTE will enter an **Infinite Loop**, consuming 100% CPU and filling disk space with temporary work tables until statement timeout or memory exhaustion. Always implement depth guards or path array cycle checks (`NOT child.id = ANY(path)`).
3. **Recursive Reference Restrictions**: The recursive reference to the CTE name inside the recursive member cannot be placed inside an outer join, an aggregate function, or a subquery.

---

## 8. Common Mistakes

### 1. Infinite Recursion on Circular References
```sql
-- DANGEROUS: If parent_id loops back to an ancestor, this runs infinitely!
WITH RECURSIVE bad_tree AS (
  SELECT id, parent_id FROM nodes WHERE parent_id IS NULL
  UNION ALL
  SELECT n.id, n.parent_id FROM nodes n JOIN bad_tree b ON n.parent_id = b.id
)
SELECT * FROM bad_tree;

-- FIX: Always track path and guard against cycles
WITH RECURSIVE safe_tree AS (
  SELECT id, parent_id, ARRAY[id] AS path FROM nodes WHERE parent_id IS NULL
  UNION ALL
  SELECT n.id, n.parent_id, path || n.id 
  FROM nodes n 
  JOIN safe_tree s ON n.parent_id = s.id 
  WHERE NOT (n.id = ANY(s.path)) -- Breaks cycle instantly!
)
SELECT * FROM safe_tree;
```

### 2. Using `UNION` Instead of `UNION ALL` in Large Trees
Using `WITH RECURSIVE ... UNION ...`. `UNION` forces the database to sort and deduplicate intermediate sets on every iteration step, slowing down large tree traversals by 10x compared to `UNION ALL`.

---

## 9. Best Practices

### 1. Data-Modifying CTEs (Atomic Multi-Table Insert)
PostgreSQL allows running `INSERT`, `UPDATE`, or `DELETE` directly inside CTEs, capturing their output via `RETURNING` to populate subsequent tables in one round-trip:

```sql
-- Atomically create an Order and its Audit Log in 1 statement:
WITH new_order AS (
  INSERT INTO orders (customer_id, total_amount) 
  VALUES ('cust_123', 450.00) 
  RETURNING id, customer_id, total_amount
),
audit_entry AS (
  INSERT INTO audit_logs (event_name, entity_id, payload)
  SELECT 
    'ORDER_CREATED', 
    id, 
    json_build_object('total', total_amount, 'customer', customer_id)
  FROM new_order
  RETURNING id
)
SELECT id FROM new_order;
```

---

## 10. Performance Considerations
- **Depth Limiting**: Always pass a strict `max_depth` parameter to user-facing recursive queries to prevent malicious deep-nesting denial of service.
- **Index Support**: The recursive join condition (`INNER JOIN comment_tree parent ON child.parent_id = parent.id`) **must have a B-Tree index on the child column (`parent_id`)**. Without an index on `parent_id`, every recursive iteration executes a full sequential scan on the entire table.

---

## 11. Security Considerations
- **DoS via Algorithmic Complexity (Billion-Row Trees)**: An attacker who can generate circular relationships or deeply nested parent-child entities can trigger an exponential recursive expansion, exhausting database RAM and IOPS. Always enforce statement timeouts (`SET LOCAL statement_timeout = '3000ms'`) on recursive endpoints.

---

## 12. Alternatives
1. **Closure Tables**: Storing all ancestor-descendant paths in a dedicated junction table. Highly efficient for reading ($O(1)$ lookups without recursion), but incurs write and storage overhead on node insertions/moves.
2. **Materialized Path Pattern (PostgreSQL `ltree` extension)**: Storing the hierarchical path as an indexable dot-separated string (`'1.5.23'`). Supports lightning-fast GiST index tree queries without recursive CTEs.
3. **Application-Level Graph Traversal**: Fetching all records and building trees in memory with JavaScript maps (suitable only if the total dataset is small, e.g., < 1,000 nodes).

---

## 13. Trade-offs

| Hierarchical Approach | Read Latency | Write / Insert Latency | Schema Complexity | Cycle Safety |
| :--- | :--- | :--- | :--- | :--- |
| **Recursive CTE** | Fast for moderate trees | Instantaneous ($O(1)$) | Simplest (Single `parent_id` column) | Requires path tracking |
| **PostgreSQL `ltree`** | Ultra-Fast (GiST indexed) | Moderate | Medium (Requires extension) | Inherent in path strings |
| **Closure Table** | Extremely Fast ($O(1)$) | Slow ($O(\text{depth})$ writes) | High (Separate relational table) | Handled by table rules |

---

## 14. Real-World Usage
- **Bill of Materials (BOM) in Manufacturing**: Automotive manufacturing systems use recursive CTEs to calculate every bolt, wire, and sub-assembly required to build a car by exploding complex multi-tier parts assemblies.
- **Reddit / Hacker News Comments**: Threaded discussion boards use recursive CTEs to fetch and sort entire comment hierarchies ordered by score and conversation tree path.

---

## 15. Placement Interview Questions

### Basic
**Q: What is a Common Table Expression (CTE), and which SQL keyword defines it?**  
*Answer*: A CTE is a named temporary result set that exists only within the execution scope of a single SQL statement. It is defined using the **`WITH`** keyword and allows developers to write modular, readable, and composable SQL queries.

### Conceptual
**Q: What are the two essential components of a Recursive CTE in SQL?**  
*Answer*: 
1. **The Anchor Member**: The base query that executes first to establish the initial result set (the base case, such as selecting root nodes where `parent_id IS NULL`).
2. **The Recursive Member**: The query that references the CTE name and joins with the previous iteration's result set to fetch child records until it returns zero rows (the recursive step). These two members are combined using `UNION ALL`.

### Implementation
**Q: How do you prevent infinite loops in a recursive CTE when the underlying database table contains circular references?**  
*Answer*: Track the traversal history by accumulating node IDs in an array (e.g., `ARRAY[id]` in the anchor, and `path || id` in the recursive member) and add a cycle guard in the recursive member's `WHERE` clause: `WHERE NOT (child.id = ANY(parent.path))`. Additionally, enforce a maximum recursion depth limit (`WHERE parent.depth < 10`).

### Debugging
**Q: Prior to PostgreSQL 12, developers observed that moving a subquery into a CTE significantly slowed down query execution. Why did this happen?**  
*Answer*: Prior to PostgreSQL 12, CTEs acted as strict **optimization barriers**. The database engine was forced to materialize (fully execute and buffer) the entire CTE in memory or temporary disk before executing the outer query. This prevented the query optimizer from **pushing down predicates** (e.g., applying `WHERE user_id = 123` into the CTE), resulting in full table scans inside the CTE. PostgreSQL 12 resolved this by automatically inlining non-recursive CTEs.

### Scenario
**Q: You need to insert a customer and their initial profile settings in a single atomic database trip without using multiple round-trips from Node.js. How can CTEs accomplish this?**  
*Answer*: Use a data-modifying CTE:
```sql
WITH new_customer AS (
  INSERT INTO customers (name, email) 
  VALUES ('Alice', 'alice@test.com') 
  RETURNING id
)
INSERT INTO customer_settings (customer_id, theme, notifications_enabled)
SELECT id, 'dark', true FROM new_customer;
```

### Advanced
**Q: Explain how PostgreSQL manages memory during the execution of a recursive CTE using its internal "Work Table".**  
*Answer*: During recursive execution, PostgreSQL maintains an internal temporary structure called the **Work Table** alongside the accumulator buffer. On Step 1, the Anchor Member executes; its output is copied into both the accumulator buffer and the Work Table. In Step 2, the Recursive Member executes, reading from the Work Table as its input. When it completes, the Work Table is emptied and refilled with the newly produced rows, which are also appended to the accumulator buffer. This cycle repeats until the Recursive Member returns zero rows into the Work Table, at which point the accumulator buffer is returned to the client.

---

## 16. Coding Questions

### Problem 1: Full Organizational Hierarchy Path Generation
Given an `employees(id, name, manager_id)` table, write a recursive CTE that returns each employee, their direct manager, their depth in the hierarchy (CEO = 1), and a full breadcrumb hierarchy path (e.g., `'CEO > VP > Director > Alice'`).

```sql
WITH RECURSIVE org_chart AS (
  -- Anchor Member: The CEO (has no manager)
  SELECT 
    id,
    name,
    manager_id,
    1 AS depth,
    name::text AS hierarchy_path
  FROM employees
  WHERE manager_id IS NULL
  
  UNION ALL
  
  -- Recursive Member: Subordinates joined to their managers
  SELECT 
    e.id,
    e.name,
    e.manager_id,
    o.depth + 1,
    o.hierarchy_path || ' > ' || e.name
  FROM employees e
  INNER JOIN org_chart o ON e.manager_id = o.id
)
SELECT 
  id, 
  name, 
  depth, 
  hierarchy_path 
FROM org_chart 
ORDER BY hierarchy_path;
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking CTEs persist between different HTTP requests. A CTE exists **only for the duration of the single SQL statement** it is attached to; it is not a temporary table and disappears immediately after the query finishes.
- **Trap 2**: Believing `WITH RECURSIVE` requires true mathematical recursion in the engine. It is implemented iteratively via the Work Table loop until no new rows are generated.
- **Trap 3**: Forgetting `RECURSIVE` keyword. In PostgreSQL, if a CTE references itself, you **must** write `WITH RECURSIVE`; writing plain `WITH` throws a syntax error.

---

## 18. Revision Summary
- CTEs (`WITH`) define temporary, named result sets that make SQL modular, readable, and composable.
- Modern PostgreSQL (v12+) inlines CTEs automatically; use `AS MATERIALIZED` if you want to force single-evaluation caching.
- Recursive CTEs (`WITH RECURSIVE`) consist of an **Anchor Member**, `UNION ALL`, and a **Recursive Member**.
- Always implement cycle detection (`NOT id = ANY(path)`) and depth constraints (`depth < max_depth`) to prevent infinite loops on circular graphs.
- Data-modifying CTEs (`WITH ... INSERT ... RETURNING`) allow executing multi-table atomic operations in a single query.

---

## 19. Quick Reference

| Syntax Pattern | Purpose | Termination Requirement | Engine Behavior |
| :--- | :--- | :--- | :--- |
| **`WITH cte AS (SELECT ...)`** | Standard modular subquery | None | Inlined automatically (v12+) |
| **`WITH cte AS MATERIALIZED (...)`** | Forcing single execution cache | None | Computed once, held in RAM |
| **`WITH RECURSIVE cte AS (...)`** | Tree/graph traversal | Must yield 0 rows on leaf step | Iterative loop over Work Table |
| **Cycle Guard** | `WHERE NOT id = ANY(path)` | Prevents infinite loops | Halts loop if duplicate ID encountered |
| **Data Modifying CTE** | `WITH ins AS (INSERT ... RETURNING)` | Atomic multi-table write | Single round-trip ACID execution |
