# Filtering, Grouping, and Aggregations in SQL

## 1. What is it?
SQL is fundamentally a declarative language designed for set-based data transformation. The backbone of analytical and business logic in SQL relies on the triad of **Filtering**, **Grouping**, and **Aggregation**:
- **Filtering (`WHERE` and `HAVING`)**: Restricting the rows returned by evaluating logical predicates.
- **Grouping (`GROUP BY`)**: Collapsing rows with identical values in specified columns into summary groups.
- **Aggregation (`COUNT`, `SUM`, `AVG`, `MIN`, `MAX`)**: Mathematical functions that compute a single summary value across a collection of grouped or filtered rows.

Understanding the strict semantic difference between **`WHERE`** (which filters raw individual rows *before* grouping occurs) and **`HAVING`** (which filters aggregated summary groups *after* grouping occurs) is essential for correct SQL query construction.

```
SQL Logical Execution Pipeline:
[FROM & JOINs] 
      | (Produces complete raw joined table)
      v
   [WHERE]     <=== Filters raw individual rows (Cannot use aggregate functions here!)
      |
      v
  [GROUP BY]   <=== Collapses identical column values into summary buckets
      |
      v
  [HAVING]     <=== Filters aggregated groups (e.g., HAVING COUNT(*) > 5)
      |
      v
   [SELECT]    <=== Computes expressions, aliases, and aggregates
      |
      v
  [DISTINCT]   <=== Removes duplicate rows
      |
      v
  [ORDER BY]   <=== Sorts final output (Can reference SELECT aliases)
      |
      v
  [LIMIT/OFFSET] <=== Slices result window
```

---

## 2. Why does it exist?
In production systems, raw data is rarely consumed in its primitive form:
1. **Bandwidth and Memory Protection**: If an e-commerce platform has 20,000,000 orders, an analytics dashboard showing "Total revenue per country in 2026" should never pull 20,000,000 rows over the network to calculate totals in JavaScript. Doing so causes Out-Of-Memory (OOM) crashes and minutes of network transfer.
2. **Pushdown Computation to the Database Engine**: Relational database engines are written in highly optimized C/C++ and execute parallelized SIMD vector aggregations and hash-tables directly over memory buffer pages, reducing a 20-million row dataset to 50 country rows in 150 milliseconds.
3. **Handling Incomplete Data (`NULL`)**: Aggregation engines provide mathematical consistency regarding missing data, defining how `NULL` interacts with counters, sums, and default fallbacks (`COALESCE`).

---

## 3. Mental Model
Think of Filtering and Grouping as a **Post Office Sorting Facility**:
- **`FROM`**: All 10,000 packages arrive at the loading dock.
- **`WHERE` (Initial Inspection)**: The mail inspector throws out damaged packages or packages destined for foreign countries before sorting begins. (Individual row filtering).
- **`GROUP BY` (Sorting Bins)**: The remaining packages are sorted into distinct postal code bins.
- **Aggregation (`COUNT`, `SUM`)**: For each postal code bin, a scale measures the total weight (`SUM(weight)`) and counts the letters (`COUNT(*)`).
- **`HAVING` (Bin Inspection)**: The supervisor steps in and says: *"Only load trucks for postal bins that contain more than 100 packages (`HAVING COUNT(*) > 100`)"*. Bins with fewer packages stay behind.

---

## 4. Basic Example
A comprehensive SQL query demonstrating the interaction between `WHERE`, `GROUP BY`, `HAVING`, and `COALESCE`:

```sql
-- Calculate monthly revenue and total orders per product category in 2026,
-- showing only categories that generated over $10,000 in sales:

SELECT 
  category_id,
  COALESCE(department_name, 'Unassigned') AS department,
  COUNT(id) AS total_orders,
  SUM(total_amount) AS gross_revenue,
  ROUND(AVG(total_amount), 2) AS average_order_value,
  MAX(total_amount) AS largest_single_order
FROM orders
WHERE created_at >= '2026-01-01' 
  AND created_at < '2027-01-01'
  AND status = 'COMPLETED'          -- WHERE: Filters raw orders BEFORE grouping
GROUP BY category_id, department_name
HAVING SUM(total_amount) > 10000.00 -- HAVING: Filters aggregated buckets AFTER grouping
ORDER BY gross_revenue DESC
LIMIT 10;
```

---

## 5. Real Example: Multi-Metric SaaS Billing Aggregation in TypeScript
A production TypeScript repository query generating an account usage statement:

```typescript
import { dbPool } from './db';

interface TenantBillingReport {
  tenantId: string;
  tenantName: string;
  totalApiCalls: number;
  totalStorageBytes: number;
  activeUsersCount: number;
  estimatedInvoiceUsd: number;
}

export async function generateTenantBillingReport(
  billingMonth: string // Format: '2026-03'
): Promise<TenantBillingReport[]> {
  const query = `
    SELECT 
      t.id AS "tenantId",
      t.name AS "tenantName",
      COALESCE(SUM(u.api_request_count), 0)::BIGINT AS "totalApiCalls",
      COALESCE(MAX(u.storage_used_bytes), 0)::BIGINT AS "totalStorageBytes",
      COUNT(DISTINCT u.user_id) AS "activeUsersCount",
      
      -- Dynamic computed billing formula
      ROUND(
        (COALESCE(SUM(u.api_request_count), 0) * 0.0001) + 
        ((COALESCE(MAX(u.storage_used_bytes), 0) / 1073741824.0) * 0.05),
        2
      ) AS "estimatedInvoiceUsd"
      
    FROM tenants t
    LEFT JOIN tenant_daily_usage u 
      ON t.id = u.tenant_id 
      AND to_char(u.usage_date, 'YYYY-MM') = $1
    WHERE t.is_suspended = false
    GROUP BY t.id, t.name
    HAVING COALESCE(SUM(u.api_request_count), 0) > 0 
        OR COALESCE(MAX(u.storage_used_bytes), 0) > 0
    ORDER BY "estimatedInvoiceUsd" DESC;
  `;

  const result = await dbPool.query(query, [billingMonth]);
  return result.rows;
}
```

---

## 6. Under the Hood

### 1. Engine Mechanics: `HashAggregate` vs `GroupAggregate`
When PostgreSQL encounters a `GROUP BY` clause, the query optimizer selects one of two physical execution strategies:
- **`HashAggregate`**:
  - The engine reads the filtered rows and inserts them into an in-memory hash table where the hash key is the `GROUP BY` column tuple.
  - The aggregate accumulators (`sum`, `count`, `max`) are updated in-place inside each hash bucket.
  - Fast: $O(N)$ runtime.
  - **Memory Constraint**: Must fit entirely within **`work_mem`**. If the number of unique groups exceeds `work_mem`, it spills to temporary disk files, causing severe slowdowns.
- **`GroupAggregate`**:
  - Used when the input data is already sorted by the `GROUP BY` keys (e.g., via a B-Tree index scan or an explicit sort node).
  - The engine iterates through the sorted stream sequentially. As long as the key value doesn't change, it updates accumulators. When the key transitions, it emits the summary row and resets.
  - Extremely memory-efficient: consumes $O(1)$ memory because it does not maintain an in-memory hash table.

### 2. Deep Dive: `COUNT(*)` vs `COUNT(column)` vs `COUNT(1)`
- **`COUNT(*)`**: Counts every row in the partition, regardless of whether individual columns contain `NULL`. In modern PostgreSQL, `COUNT(*)` and `COUNT(1)` are parsed into identical AST nodes with identical execution plans.
- **`COUNT(column_name)`**: Counts only rows where `column_name IS NOT NULL`. It must inspect the actual column value for nullability, incurring slightly more CPU overhead.

### 3. Deep Dive: `COALESCE` vs `NULLIF`
- **`COALESCE(a, b, c)`**: Returns the **first non-null expression** in the argument list. Essential when left-joining tables to avoid returning `null` to application layers (`COALESCE(SUM(amount), 0)`).
- **`NULLIF(a, b)`**: Returns `NULL` if $a = b$; otherwise returns $a$. Critical for preventing **Division by Zero** crashes in SQL:
  ```sql
  -- Crash without NULLIF when total_orders is 0:
  -- SELECT total_revenue / total_orders FROM metrics;
  
  -- Safe: returns NULL instead of throwing division by zero error:
  SELECT total_revenue / NULLIF(total_orders, 0) FROM metrics;
  ```

---

## 7. Important Rules
1. **The Single-Value Rule of `GROUP BY`**: Every non-aggregate column listed in the `SELECT` list **must** be explicitly included in the `GROUP BY` clause. (Exception: If the table's primary key is in `GROUP BY`, modern PostgreSQL permits other columns from that table to be selected without explicit grouping).
2. **Never Use Aggregate Functions in `WHERE`**: Writing `WHERE COUNT(id) > 5` throws an error: `aggregate functions are not allowed in WHERE`. Aggregates compute over sets, which only exist after `WHERE` completes; use `HAVING COUNT(id) > 5`.
3. **`NULL` is Ignored by Standard Aggregates**: Functions like `SUM()`, `AVG()`, `MIN()`, and `MAX()` silently skip `NULL` values. If a dataset has values `[10, NULL, 20]`, `AVG()` calculates $(10 + 20) / 2 = 15$, **not** $(10 + 0 + 20) / 3 = 10$.
4. **Use Filter Expressions Inside Aggregates (`FILTER (WHERE ...)`):** PostgreSQL supports clean conditional aggregation syntax:
   ```sql
   SELECT 
     COUNT(*) AS total_users,
     COUNT(*) FILTER (WHERE is_active = true) AS active_users,
     COUNT(*) FILTER (WHERE role = 'ADMIN') AS admin_users
   FROM users;
   ```

---

## 8. Common Mistakes

### 1. Filtering Aggregated Results in Application Code
Fetching 500,000 unaggregated raw rows into a Node.js process and calculating averages using JavaScript `array.reduce()`. This destroys server memory and saturates network bandwidth. Always perform filtering and aggregation in the database engine.

### 2. The `WHERE` vs `HAVING` Performance Blunder
```sql
-- TERRIBLE (Slow): Filters 5,000,000 rows AFTER grouping them all!
SELECT department_id, COUNT(*) 
FROM employees 
GROUP BY department_id, is_active 
HAVING is_active = true;

-- CORRECT (Fast): Filters rows BEFORE grouping, reducing the working set!
SELECT department_id, COUNT(*) 
FROM employees 
WHERE is_active = true 
GROUP BY department_id;
```

---

## 9. Best Practices
- **Use `FILTER (WHERE ...)` Instead of Verbose `CASE WHEN`**:
  ```sql
  -- Legacy / Portable SQL:
  SUM(CASE WHEN status = 'REFUNDED' THEN amount ELSE 0 END)
  
  -- Clean Modern PostgreSQL:
  SUM(amount) FILTER (WHERE status = 'REFUNDED')
  ```
- **Leverage Covering Indexes for `GroupAggregate`**: If a query groups by `(store_id, department_id)` and sums `sales_amount`, a composite B-Tree index on `(store_id, department_id, sales_amount)` allows PostgreSQL to perform an **Index-Only GroupAggregate** without reading the table heap.

---

## 10. Performance Considerations
- **`work_mem` Sizing for HashAggregates**: Check execution plans with `EXPLAIN ANALYZE`. If you see `HashAggregate ... Batches: 4 Disk: 18432kB`, the hash table spilled to disk. Increasing `work_mem` for that session (`SET work_mem = '64MB'`) keeps the aggregation entirely in RAM, speeding up queries by 5x–10x.
- **Cardinally Estimation**: Grouping by high-cardinality columns (e.g., `user_id` or `uuid`) generates millions of hash buckets, demanding massive memory. Group by coarse-grained keys (`date_trunc('day', timestamp)`, `category_id`) whenever possible.

---

## 11. Security Considerations
- **Differential Privacy and Aggregate Inference Attacks**: In public analytics endpoints, an attacker can infer a specific individual's salary by comparing aggregated results:
  1. Query: `AVG(salary) WHERE department = 'Finance'` (10 employees).
  2. Query: `AVG(salary) WHERE department = 'Finance' AND email != 'victim@company.com'` (9 employees).
  By calculating the difference between the two averages, the attacker deduces the victim's exact salary. Mitigate this by enforcing minimum group size thresholds: `HAVING COUNT(*) >= 5`.

---

## 12. Alternatives
1. **Window Functions (`OVER (PARTITION BY ...)`):** When you need aggregate calculations (like running totals or department averages) *without collapsing* rows down to a single summary row.
2. **Materialized Views**: Storing pre-aggregated summaries on disk for instant retrieval when underlying data changes infrequently.
3. **OLAP / Columnar Stores (ClickHouse, BigQuery)**: When analytical queries must aggregate billions of rows across hundreds of dimensions in sub-second times.

---

## 13. Trade-offs

| Method | Use Case | Memory Usage | Output Granularity |
| :--- | :--- | :--- | :--- |
| **`GROUP BY` Aggregation** | Summary reporting, charts | High if HashAggregate spills | Collapses rows to 1 per group |
| **Window Functions** | Adding summary metrics to individual rows | High (sort buffer) | Preserves original row count |
| **Application-Layer Aggregation** | Small collections (< 50 items) | Low on DB, high on app | Flexible |

---

## 14. Real-World Usage
- **Stripe Dashboard**: Merchant revenue analytics feeds use `GROUP BY DATE_TRUNC('day', created_at)` with `FILTER (WHERE status = 'SUCCEEDED')` to render live interactive revenue graphs.
- **E-Commerce Inventory Reordering**: Automated supply chain engines trigger restocking alerts using `HAVING SUM(stock) < minimum_threshold`.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the difference between `WHERE` and `HAVING` in SQL?**  
*Answer*: `WHERE` filters individual rows **before** any grouping or aggregation takes place; it cannot contain aggregate functions. `HAVING` filters the summarized groups **after** the `GROUP BY` clause has collapsed rows and computed aggregates.

### Conceptual
**Q: How does `AVG()` treat `NULL` values in SQL? Give an example.**  
*Answer*: `AVG()` completely ignores `NULL` values; it does not treat them as zeros. If a column contains three rows with values `10`, `NULL`, and `20`, `AVG()` calculates $(10 + 20) / 2 = 15$. If you want `NULL` treated as zero, you must wrap the column in `COALESCE`: `AVG(COALESCE(score, 0))`, which would yield $(10 + 0 + 20) / 3 = 10$.

### Implementation
**Q: How do you prevent a "Division by Zero" runtime error when calculating conversion rates in SQL?**  
*Answer*: Use the `NULLIF` function:
```sql
SELECT successful_conversions::FLOAT / NULLIF(total_visitors, 0) AS conversion_rate 
FROM campaign_metrics;
```
If `total_visitors` is 0, `NULLIF` returns `NULL`, and dividing by `NULL` safely yields `NULL` instead of throwing a fatal query error.

### Debugging
**Q: A junior developer writes `SELECT department, employee_name, AVG(salary) FROM employees GROUP BY department;`. What error occurs, and why?**  
*Answer*: The query fails with `ERROR: column "employees.employee_name" must appear in the GROUP BY clause or be used in an aggregate function`. Because `employee_name` is neither aggregated nor listed in the `GROUP BY` clause, the database cannot determine which single employee name to display for a department that contains 50 distinct employees.

### Scenario
**Q: You need to calculate the total number of orders, total completed orders, and total refunded orders in a single table scan. How do you write this in PostgreSQL?**  
*Answer*: Use conditional aggregation with the `FILTER (WHERE ...)` clause:
```sql
SELECT 
  COUNT(*) AS total_orders,
  COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed_orders,
  COUNT(*) FILTER (WHERE status = 'REFUNDED') AS refunded_orders,
  COALESCE(SUM(amount) FILTER (WHERE status = 'COMPLETED'), 0) AS net_revenue
FROM orders;
```

### Advanced
**Q: What is the physical difference between a `HashAggregate` and a `GroupAggregate` in PostgreSQL's query execution engine?**  
*Answer*: 
- A **`HashAggregate`** reads unsorted input rows into an in-memory hash table using the group keys as hash lookups, updating accumulators in place. It requires $O(N)$ time and depends on `work_mem`. If the hash table exceeds `work_mem`, it spills partitions to disk.
- A **`GroupAggregate`** expects the input rows to already be sorted by the group keys (e.g., from an index scan). It streams through rows sequentially, emitting an aggregate row whenever the key changes. It operates in $O(1)$ memory, making it ideal for massive datasets where sorting is already available.

---

## 16. Coding Questions

### Problem 1: Second Highest Salary per Department (Without Window Functions)
Find the second highest salary in each department using standard grouping and subqueries.

```sql
SELECT 
  e1.department_id, 
  MAX(e1.salary) AS second_highest_salary
FROM employees e1
WHERE e1.salary < (
  SELECT MAX(e2.salary) 
  FROM employees e2 
  WHERE e2.department_id = e1.department_id
)
GROUP BY e1.department_id;
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking `COUNT(*)` and `COUNT(id)` are always identical. If `id` allows `NULL` (rare for primary keys, but possible for regular columns), `COUNT(id)` ignores nulls while `COUNT(*)` counts all rows.
- **Trap 2**: Believing `GROUP BY` sorts the output. While `GroupAggregate` requires sorted input, SQL does **not guarantee** any output ordering without an explicit `ORDER BY` clause.
- **Trap 3**: Assuming `SUM(empty_set)` returns 0. If a query matches zero rows or all values are null, `SUM()` returns `NULL`, not `0`. Always wrap sums in `COALESCE(SUM(col), 0)`.

---

## 18. Revision Summary
- Logical execution order: `FROM` $\to$ `WHERE` $\to$ `GROUP BY` $\to$ `HAVING` $\to$ `SELECT` $\to$ `ORDER BY` $\to$ `LIMIT`.
- `WHERE` filters raw rows before aggregation; `HAVING` filters summary buckets after aggregation.
- `COALESCE(val, fallback)` returns the first non-null argument; `NULLIF(a, b)` returns null if $a = b$.
- Standard aggregates (`SUM`, `AVG`, `MIN`, `MAX`) ignore `NULL` values.
- Modern PostgreSQL supports conditional aggregation using `COUNT(*) FILTER (WHERE condition)`.
- Sizing `work_mem` properly prevents `HashAggregate` nodes from spilling to disk.

---

## 19. Quick Reference

| Clause / Function | Purpose | Evaluated Phase | Can Contain Aggregates? |
| :--- | :--- | :--- | :--- |
| **`WHERE`** | Row-level filter | Phase 2 (Pre-Group) | No |
| **`GROUP BY`** | Bucketing rows | Phase 3 | No |
| **`HAVING`** | Group-level filter | Phase 4 (Post-Group)| Yes |
| **`COALESCE(a, b)`** | Null fallback replacement | Projection / Filter | N/A |
| **`NULLIF(a, b)`** | Division by zero safety | Projection / Filter | N/A |
| **`FILTER (WHERE ...)`** | Conditional aggregation | Aggregate calculation | Yes |
