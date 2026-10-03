# Subqueries and Correlated Subqueries in SQL

## 1. What is it?
A **Subquery** (also known as an inner query, nested query, or sub-select) is a `SELECT` statement embedded inside another enclosing SQL statement (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, or another subquery). 

Subqueries are categorized along two critical architectural axes:
1. **Output Shape**:
   - **Scalar Subquery**: Returns exactly one row with one column (a single value).
   - **Row Subquery**: Returns one row with multiple columns.
   - **Table / Multi-Row Subquery**: Returns multiple rows and columns (used with `IN`, `EXISTS`, `ANY`, `ALL`, or in the `FROM` clause).
2. **Execution Dependency**:
   - **Uncorrelated (Independent) Subquery**: The inner query does not reference any columns from the outer query. It executes **exactly once**, and its static result set is reused by the outer query.
   - **Correlated Subquery**: The inner query explicitly references one or more columns from the current row of the outer query. Semantically, it must execute **once for every single candidate row** evaluated by the outer query.

```
Uncorrelated Subquery Execution:
Inner Query ---> Executes ONCE ---> Returns [10, 20, 30]
                                          |
Outer Query ---> Filters rows WHERE id IN [10, 20, 30] (Fast: O(1) + O(N))

Correlated Subquery Execution:
Outer Query (Row 1) ---> Evaluates Inner Query with Outer.id = 1 ---> Returns result
Outer Query (Row 2) ---> Evaluates Inner Query with Outer.id = 2 ---> Returns result
...
Outer Query (Row N) ---> Evaluates Inner Query with Outer.id = N ---> Returns result
(Semantically O(N * M) nested loop if unoptimized!)
```

---

## 2. Why does it exist?
1. **Dynamic Filtering without Hardcoding**: Allows filtering based on calculated runtime values (e.g., finding all employees whose salary exceeds the company-wide average: `WHERE salary > (SELECT AVG(salary) FROM employees)`).
2. **Existence Checking (`EXISTS` / `NOT EXISTS`)**: Provides boolean conditional testing. `EXISTS` is often faster than `IN` because the query engine short-circuits evaluation as soon as the first matching child record is found.
3. **Derived Tables in `FROM`**: Allows complex multi-step transformations and aggregations to act as ephemeral in-memory tables without creating permanent database views.

---

## 3. Mental Model
Think of Subqueries as **Functions in Programming**:
- **Uncorrelated Subquery**: A pure, standalone helper function that takes zero arguments:
  ```typescript
  const averageSalary = getCompanyAverage(); // Evaluated ONCE
  const highEarners = employees.filter(e => e.salary > averageSalary);
  ```
- **Correlated Subquery**: A closure function that captures variables from an enclosing `for` loop:
  ```typescript
  const highEarnersByDept = employees.filter(outerEmployee => {
    // Re-evaluates for EVERY SINGLE employee in the array!
    const deptAverage = getDepartmentAverage(outerEmployee.departmentId);
    return outerEmployee.salary > deptAverage;
  });
  ```

---

## 4. Basic Example
Scalar, Multi-Row, and Correlated Subqueries in SQL:

```sql
-- 1. Uncorrelated Scalar Subquery (Evaluates once)
SELECT name, salary
FROM employees
WHERE salary > (SELECT AVG(salary) FROM employees);

-- 2. Multi-Row Subquery with IN
SELECT name, department_id
FROM employees
WHERE department_id IN (
  SELECT id FROM departments WHERE budget > 500000
);

-- 3. Correlated Subquery (Inner query references outer 'e.department_id')
-- Finds employees who earn more than the average of THEIR OWN department:
SELECT e.name, e.salary, e.department_id
FROM employees e
WHERE e.salary > (
  SELECT AVG(sub.salary)
  FROM employees sub
  WHERE sub.department_id = e.department_id -- Correlation condition!
);

-- 4. Semi-Join with EXISTS (Short-circuits on first match)
SELECT c.id, c.name
FROM customers c
WHERE EXISTS (
  SELECT 1 FROM orders o WHERE o.customer_id = c.id AND o.status = 'COMPLETED'
);
```

---

## 5. Real Example: Preventing Performance Traps in Production TypeScript
A production TypeScript repository method comparing a slow correlated subquery against an optimized SQL JOIN / Window Function rewrite:

```typescript
import { dbPool } from './db';

interface TopProductReport {
  productId: string;
  productName: string;
  category: string;
  price: number;
  categoryAvgPrice: number;
}

export class ProductAnalyticsRepository {
  /**
   * ANTI-PATTERN (Correlated Subquery):
   * On a table of 100,000 products, the inner query runs 100,000 times!
   */
  public static async getSlowProductsAboveCategoryAvg(): Promise<TopProductReport[]> {
    const slowQuery = `
      SELECT 
        p.id AS "productId",
        p.name AS "productName",
        p.category,
        p.price,
        (
          SELECT ROUND(AVG(sub.price), 2) 
          FROM products sub 
          WHERE sub.category = p.category
        ) AS "categoryAvgPrice"
      FROM products p
      WHERE p.price > (
        SELECT AVG(sub.price) 
        FROM products sub 
        WHERE sub.category = p.category
      );
    `;
    const res = await dbPool.query(slowQuery);
    return res.rows;
  }

  /**
   * OPTIMIZED PATTERN (Window Function / CTE):
   * Scans the table ONCE, computes category averages in RAM, and filters efficiently.
   * Latency drops from 3,800ms to 28ms!
   */
  public static async getFastProductsAboveCategoryAvg(): Promise<TopProductReport[]> {
    const fastQuery = `
      WITH product_stats AS (
        SELECT 
          id AS "productId",
          name AS "productName",
          category,
          price,
          ROUND(AVG(price) OVER (PARTITION BY category), 2) AS "categoryAvgPrice"
        FROM products
      )
      SELECT * 
      FROM product_stats 
      WHERE price > "categoryAvgPrice"
      ORDER BY category, price DESC;
    `;
    const res = await dbPool.query(fastQuery);
    return res.rows;
  }
}
```

---

## 6. Under the Hood

### 1. Correlated Subquery Optimization: Subquery Flattening & Decorrelation
Historically, correlated subqueries were notorious performance killers because naive database engines executed them as an $O(N \times M)$ nested loop.
Modern PostgreSQL features an intelligent **Query Rewriter / Subquery Flattener**:
- When PostgreSQL encounters `WHERE EXISTS (SELECT 1 FROM orders WHERE orders.customer_id = customers.id)`, it automatically **decorrelates** the subquery into a **Semi-Join**:
  ```
  Hash Semi Join
    Hash Cond: (customers.id = orders.customer_id)
    -> Seq Scan on customers
    -> Hash
       -> Seq Scan on orders
  ```
- The entire query executes in $O(N + M)$ time instead of nested-loop quadratic time!
- **When Optimization Fails**: If the correlated subquery is in the `SELECT` projection list or contains complex non-equijoins or aggregate groupings, the planner may be unable to decorrelate it, forcing a catastrophic per-row execution loop.

### 2. The `IN` vs `EXISTS` vs `NOT IN` vs `NOT EXISTS` Hazard

#### The `NOT IN` with `NULL` Disaster
Consider: `WHERE id NOT IN (SELECT manager_id FROM employees)`.
- If the inner table contains **even a single `NULL`** value:
  `id NOT IN (1, 2, NULL)` expands logically to:
  `id != 1 AND id != 2 AND id != NULL`.
- In three-valued SQL logic, `id != NULL` evaluates to **`UNKNOWN`**.
- Because `TRUE AND UNKNOWN` yields `UNKNOWN`, the `WHERE` condition fails for every single row! The query silently returns **0 rows**, completely corrupting business logic.
- **Rule**: Never use `NOT IN` with nullable subqueries; always use **`NOT EXISTS`** or **Anti-Joins (`LEFT JOIN ... WHERE IS NULL`)**.

---

## 7. Important Rules
1. **Scalar Subqueries Must Guarantee At Most One Row**: If an inner query in `SELECT (SELECT order_id FROM orders WHERE user_id = u.id)` matches 2 or more rows, the database halts execution immediately with error: `ERROR: more than one row returned by a subquery used as an expression`.
2. **Prefer `EXISTS` over `IN` for Unindexed or Large Subqueries**: `EXISTS` short-circuits immediately upon locating the first matching row; `IN` often constructs the full set in memory before testing membership.
3. **Beware of Column Shadowing in Subqueries**:
   ```sql
   -- DANGEROUS: If 'orders' table does NOT have a 'user_id' column, 
   -- SQL does NOT throw an error! It binds to the OUTER 'users.user_id', 
   -- making the query tautological: WHERE users.user_id = users.user_id!
   SELECT * FROM users WHERE user_id IN (SELECT user_id FROM orders);
   ```
   Always qualify columns with table aliases inside subqueries (`SELECT o.user_id FROM orders o`).

---

## 8. Common Mistakes

### 1. The Per-Row Subquery in Projection Anti-Pattern
```sql
-- SLOW: Firing a correlated subquery in the SELECT clause
SELECT 
  u.id, 
  u.name,
  (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) AS order_count
FROM users u;

-- FAST: Using LEFT JOIN with GROUP BY
SELECT 
  u.id, 
  u.name, 
  COUNT(o.id) AS order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
GROUP BY u.id, u.name;
```

### 2. Subquery in `FROM` Clause Without an Alias
Writing `SELECT * FROM (SELECT id, name FROM users);`. This produces a syntax error in PostgreSQL: `ERROR: subquery in FROM must have an alias`. Always provide an alias: `FROM (...) AS u`.

---

## 9. Best Practices
- **Rewrite Heavy Correlated Subqueries as CTEs or Window Functions**: Whenever calculating partition averages, ranks, or cumulative totals, replace correlated subqueries with `AVG() OVER (PARTITION BY ...)` or CTEs.
- **Use `SELECT 1` in `EXISTS` Subqueries**: By convention, write `WHERE EXISTS (SELECT 1 FROM ...)`. The projected column in `EXISTS` is completely ignored by the query planner, so `SELECT 1` clearly documents that you are testing purely for row existence.

---

## 10. Performance Considerations
- **Subplan Execution Count**: In `EXPLAIN ANALYZE` output, look for nodes labeled `SubPlan 1`. If `SubPlan 1` shows `loops=50000`, the subquery was not flattened and executed 50,000 separate times!
- **Materialization of Subqueries in `FROM`**: Prior to PostgreSQL 12, CTEs and complex subqueries were unconditionally materialized (computed and written to temporary RAM buffers), preventing predicate pushdown. Modern PostgreSQL inlines subqueries and CTEs automatically unless explicitly blocked with `WITH ... AS MATERIALIZED`.

---

## 11. Security Considerations
- **Subquery Injection**: Attackers frequently use subqueries in Blind SQL Injection attacks to extract sensitive information character-by-character:
  ```sql
  -- Malicious payload testing password hash character:
  ' OR (SELECT ASCII(SUBSTRING(password_hash, 1, 1)) FROM users WHERE email='admin@site.com') = 97 --
  ```
  Mitigate completely by using parameterized query bindings (`$1`, `?`).

---

## 12. Alternatives
1. **Window Functions**: For calculating group aggregates without collapsing rows.
2. **Common Table Expressions (CTEs)**: For breaking monolithic nested subqueries into readable, sequential logical blocks.
3. **Lateral Joins (`LEFT JOIN LATERAL`)**: The modern, highly optimized alternative to correlated subqueries when you need to return multiple columns or rows from a correlated expression.

---

## 13. Trade-offs

| Construct | Readability | Optimization by Engine | Flexibility |
| :--- | :--- | :--- | :--- |
| **Uncorrelated Subquery** | High | Easily optimized (Computed once) | Low (Static evaluation) |
| **Correlated Subquery** | Low to Moderate | Hard to optimize if complex | High (Row-specific logic) |
| **Window Functions** | High | Extreme (Single scan + RAM sort) | High for analytical reporting |
| **`EXISTS` Semi-Join** | High | High (Short-circuits on 1st match) | High for existence checks |

---

## 14. Real-World Usage
- **Fraud Detection Systems**: Risk engines use `WHERE EXISTS (SELECT 1 FROM fraud_blacklist b WHERE b.ip_address = t.ip_address)` to intercept suspicious payments with zero performance penalty.
- **Active User Engagement Dashboards**: SaaS portals isolate "Users who engaged with feature X but never touched feature Y" using correlated `NOT EXISTS` queries.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the difference between an Uncorrelated Subquery and a Correlated Subquery?**  
*Answer*: 
- An **Uncorrelated Subquery** is independent of the outer query; it does not reference any columns from the outer table, executes only once, and passes its static result to the outer query.
- A **Correlated Subquery** references columns from the outer query table, requiring it to semantically re-evaluate for each candidate row processed by the outer query.

### Conceptual
**Q: Why does `WHERE id NOT IN (SELECT parent_id FROM items)` return zero rows if the subquery contains a single `NULL` value?**  
*Answer*: In SQL three-valued logic, `id NOT IN (1, 2, NULL)` is mathematically equivalent to `(id != 1) AND (id != 2) AND (id != NULL)`. Comparing any value to `NULL` using equality or inequality operators evaluates to **`UNKNOWN`**. Because any boolean expression combined with `AND UNKNOWN` cannot evaluate to `TRUE`, the entire `WHERE` clause evaluates to `UNKNOWN` for every row, resulting in an empty result set.

### Implementation
**Q: Write a query using `EXISTS` to find all departments that have at least one employee with a salary greater than $100,000.**  
*Answer*:
```sql
SELECT d.id, d.name 
FROM departments d
WHERE EXISTS (
  SELECT 1 
  FROM employees e 
  WHERE e.department_id = d.id 
    AND e.salary > 100000
);
```

### Debugging
**Q: A query with a subquery in the `SELECT` projection list causes production database CPU to spike to 100% and times out. What is the cause, and how do you fix it?**  
*Answer*: The projection contains a correlated subquery (e.g., `SELECT u.id, (SELECT MAX(created_at) FROM logs WHERE user_id = u.id) FROM users u;`). If `users` has 500,000 rows, the subquery executes 500,000 times, causing massive CPU context-switching and buffer cache churn. The fix is to rewrite the query using a `LEFT JOIN` with `GROUP BY` or a `LEFT JOIN LATERAL`, allowing the engine to scan the tables in bulk.

### Scenario
**Q: What is a `LATERAL JOIN` in PostgreSQL, and why is it superior to traditional correlated subqueries?**  
*Answer*: A `LATERAL JOIN` (`JOIN LATERAL (...) AS sub ON true`) acts like a foreach loop in SQL, allowing the subquery to reference columns from preceding tables in the `FROM` list. Unlike a scalar correlated subquery (which can return only a single value), a `LATERAL` subquery can return **multiple columns and multiple rows** per outer row. This makes it ideal for solving "Top N items per category" queries efficiently.

### Advanced
**Q: How does the PostgreSQL query planner transform a `WHERE EXISTS (...)` query during the planning phase?**  
*Answer*: PostgreSQL's query optimizer flattens the `WHERE EXISTS` correlated subquery into a **Hash Semi-Join** or **Merge Semi-Join**. It pulls the inner table into the main join tree, hashes the inner table's join keys, and scans the outer table, short-circuiting as soon as a match is verified in the hash bucket. This converts an $O(N \times M)$ nested loop into an $O(N + M)$ set operation.

---

## 16. Coding Questions

### Problem 1: Find Employees Earning Above Department Average
Write a query to find all employees whose salary is higher than the average salary of their respective department, displaying the employee name, salary, and the department average salary.

```sql
-- Solution using Correlated Subquery:
SELECT 
  e.name, 
  e.salary, 
  e.department_id,
  (
    SELECT ROUND(AVG(sub.salary), 2) 
    FROM employees sub 
    WHERE sub.department_id = e.department_id
  ) AS dept_avg_salary
FROM employees e
WHERE e.salary > (
  SELECT AVG(sub.salary) 
  FROM employees sub 
  WHERE sub.department_id = e.department_id
);

-- Alternative (Optimal) Solution using Window Functions:
WITH ranked_employees AS (
  SELECT 
    name, 
    salary, 
    department_id,
    ROUND(AVG(salary) OVER (PARTITION BY department_id), 2) AS dept_avg_salary
  FROM employees
)
SELECT * 
FROM ranked_employees 
WHERE salary > dept_avg_salary;
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking `SELECT COUNT(*)` inside `EXISTS` is needed. Writing `WHERE EXISTS (SELECT COUNT(*) FROM ...)` is a severe bug because `COUNT(*)` always returns at least one row (a row containing `0`), meaning `EXISTS` will always evaluate to `TRUE`! Always use `SELECT 1`.
- **Trap 2**: Believing correlated subqueries can never be fast. If the correlated column has a high-selectivity B-Tree index, index lookups in a nested loop can execute in microseconds for small outer row sets.
- **Trap 3**: Confusing Row Subqueries with Multi-Row Subqueries. A row subquery compares a tuple `WHERE (a, b) = (SELECT x, y FROM tbl WHERE id = 1)`.

---

## 18. Revision Summary
- Subqueries can be scalar (single value), multi-row (`IN`, `ANY`), or table expressions (`FROM`).
- Uncorrelated subqueries execute once; correlated subqueries depend on outer columns and evaluate per outer row.
- Never use `NOT IN` with subqueries that might contain `NULL`; use `NOT EXISTS` or Anti-Joins.
- Prefer `EXISTS` over `IN` for existence checking due to short-circuit evaluation.
- Modern PostgreSQL flattens simple `EXISTS` correlated subqueries into Semi-Joins.
- Replace heavy correlated subqueries in `SELECT` lists with `LEFT JOIN` or Window Functions.

---

## 19. Quick Reference

| Subquery Pattern | Execution Frequency | Safety Hazard | Modern Alternative |
| :--- | :--- | :--- | :--- |
| **Scalar in `SELECT`** | Once per outer row | Fails if > 1 row returned | `LEFT JOIN` with `GROUP BY` |
| **`WHERE val > (SELECT AVG)`** | Exactly once | Ensure subquery is uncorrelated | CTE |
| **`WHERE id IN (SELECT)`** | Once (builds set) | Memory bloat if set is huge | `EXISTS` or `INNER JOIN` |
| **`WHERE id NOT IN (SELECT)`** | Once | **Breaks completely if NULL exists** | `NOT EXISTS` or Anti-Join |
| **`WHERE EXISTS (SELECT 1)`** | Short-circuits | Minimal | Optimal for existence checks |
| **Correlated in `WHERE`** | Per row (unless flattened) | High CPU on unindexed joins | Window Function / `LATERAL` |
