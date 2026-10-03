# Window Functions: ROW_NUMBER, RANK, DENSE_RANK, LEAD, and LAG

## 1. What is it?
A **Window Function** in SQL performs a calculation across a set of table rows that are somehow related to the current row, without collapsing the individual rows into a single summary output row. 

Unlike standard `GROUP BY` aggregations (which group rows together and collapse 100 rows into 1 summary row), a Window Function preserves the identity of every single individual row in the result set while appending a new computed column derived from its **window partition**.

Window functions are declared using the **`OVER`** clause, which specifies how rows are partitioned and ordered:
- **`ROW_NUMBER()`**: Generates a continuous unique sequential integer starting from 1 for every row within its partition.
- **`RANK()`**: Assigns ranks with gaps on ties (e.g., ties at rank 1 produce ranks `1, 1, 3`).
- **`DENSE_RANK()`**: Assigns ranks without gaps on ties (e.g., ties at rank 1 produce ranks `1, 1, 2`).
- **`LEAD(col, offset)`**: Accesses data from a subsequent row without requiring a self-join.
- **`LAG(col, offset)`**: Accesses data from a preceding row without requiring a self-join.
- **Running Aggregates**: `SUM(amount) OVER (PARTITION BY user_id ORDER BY created_at)` computes cumulative balances.

```
Difference Between Aggregation and Window Functions:
GROUP BY Aggregation:
[Row 1: Dept A, $100]
[Row 2: Dept A, $200]  ===> GROUP BY Dept ===> [Summary: Dept A, Total: $300] (Collapses rows!)

Window Function:
[Row 1: Dept A, $100]  ===> OVER (PARTITION BY Dept) ===> [Row 1: Dept A, $100, DeptTotal: $300, Rank: 1]
[Row 2: Dept A, $200]                                     [Row 2: Dept A, $200, DeptTotal: $300, Rank: 2]
                                                          (Every row is preserved!)
```

---

## 2. Why does it exist?
Before window functions were introduced in the SQL:2003 standard, calculating analytical metrics was notoriously complex and slow:
1. **Running Balances and Moving Averages**: Computing a customer's running bank balance required a quadratic correlated self-join (`SELECT SUM(o2.amount) FROM orders o2 WHERE o2.user_id = o1.user_id AND o2.date <= o1.date`), turning what should be a single linear scan into an $O(N^2)$ nightmare.
2. **Top-N Queries Per Category**: Finding the "top 3 highest selling products in each category" required multi-table correlated subqueries with severe performance penalties.
3. **Period-over-Period Growth**: Calculating day-over-day revenue growth required joining the `daily_revenue` table to itself on `d1.date = d2.date + INTERVAL '1 DAY'`, which failed when dates were missing. `LAG()` solves this in a single scan.

---

## 3. Mental Model
Think of Window Functions as a **Camera Sliding on a Dolly Track**:
- The database lays out all rows on a long table, sorted into designated bins (**`PARTITION BY`**) and sorted in chronological order (**`ORDER BY`**).
- As you walk past each row, you look through a sliding viewfinder (the **Window Frame**).
- For `ROW_NUMBER()`, you click a handheld clicker (+1 for every step you take inside the bin).
- For `LAG()`, you glance backward over your shoulder at the row behind you.
- For `LEAD()`, you look ahead to the next row coming up.
- For `SUM() OVER (...)`, your shopping basket accumulates the values of every row you have walked past so far (a cumulative running total).

---

## 4. Basic Example
Comparing `ROW_NUMBER()`, `RANK()`, `DENSE_RANK()`, `LEAD()`, and `LAG()` in SQL:

```sql
-- Demonstrating ranking functions and tie-breaking:
SELECT 
  employee_id,
  department,
  salary,
  
  -- 1. ROW_NUMBER: Strictly sequential, ties are broken arbitrarily
  ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS row_num,
  
  -- 2. RANK: Tied values share the same rank; skips numbers after ties (1, 2, 2, 4)
  RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS rank_with_gaps,
  
  -- 3. DENSE_RANK: Tied values share rank; does NOT skip numbers (1, 2, 2, 3)
  DENSE_RANK() OVER (PARTITION BY department ORDER BY salary DESC) AS dense_rank_no_gaps,
  
  -- 4. LAG: Look at previous employee's salary in the same department
  LAG(salary, 1) OVER (PARTITION BY department ORDER BY salary DESC) AS previous_higher_salary,
  
  -- 5. LEAD: Look at next employee's salary in the same department
  LEAD(salary, 1) OVER (PARTITION BY department ORDER BY salary DESC) AS next_lower_salary

FROM employees;
```

---

## 5. Real Example: Running Bank Ledger and Month-over-Month Growth in TypeScript
A production TypeScript / PostgreSQL service computing running account balances and financial growth percentages:

```typescript
import { dbPool } from './db';

interface LedgerTransaction {
  transactionId: string;
  transactionDate: Date;
  amount: number;
  runningBalance: number;
  prevTransactionAmount: number | null;
  dayOverDayDelta: number | null;
}

export class BankLedgerService {
  /**
   * COMPUTES RUNNING BALANCES AND TRANSACTION DELTAS
   * Uses Window Functions to perform linear O(N) calculations in a single table pass.
   */
  public static async getAccountStatement(accountId: string): Promise<LedgerTransaction[]> {
    const query = `
      SELECT 
        id AS "transactionId",
        created_at AS "transactionDate",
        amount,
        
        -- 1. RUNNING BALANCE: Cumulative sum from start of account history to current row
        SUM(amount) OVER (
          PARTITION BY account_id 
          ORDER BY created_at ASC 
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS "runningBalance",
        
        -- 2. LAG: Previous transaction amount for comparison
        LAG(amount, 1) OVER (
          PARTITION BY account_id 
          ORDER BY created_at ASC
        ) AS "prevTransactionAmount",
        
        -- 3. DELTA: Current amount minus previous amount
        (
          amount - LAG(amount, 1) OVER (
            PARTITION BY account_id 
            ORDER BY created_at ASC
          )
        ) AS "dayOverDayDelta"
        
      FROM account_transactions
      WHERE account_id = $1
      ORDER BY created_at ASC;
    `;

    const result = await dbPool.query(query, [accountId]);
    return result.rows;
  }
}
```

---

## 6. Under the Hood

### 1. The Execution Lifecycle of Window Functions
Window functions are evaluated **very late** in the SQL logical query pipeline:
```
1. FROM & JOINs
2. WHERE (Raw row filtering)
3. GROUP BY
4. HAVING
5. WINDOW FUNCTIONS EVALUATION  <=== Evaluated here! (Can see group aggregates)
6. SELECT Projection
7. DISTINCT
8. ORDER BY
9. LIMIT / OFFSET
```
- **Consequence**: You **cannot** put a Window Function directly inside a `WHERE` or `HAVING` clause! (e.g., `WHERE ROW_NUMBER() <= 3` is illegal syntax). To filter on a window calculation, you **must wrap it in a CTE or derived subquery**.

### 2. Window Framing Mechanics: `ROWS` vs `RANGE`
When you write `OVER (ORDER BY date)`, PostgreSQL defaults to an implicit frame:
`RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`.
- **`ROWS`**: Physical rows. `ROWS BETWEEN 1 PRECEDING AND 1 FOLLOWING` looks strictly at the row immediately before and the row immediately after.
- **`RANGE`**: Logical value range. If multiple rows have the **identical timestamp or value** in the `ORDER BY` column, `RANGE` treats all duplicates as part of the current row, resulting in identical aggregate totals for all ties!
- **Performance Rule**: `ROWS` is significantly faster than `RANGE` because it does not require testing for peer duplicate values.

```
Window Frame Definitions:
[ UNBOUNDED PRECEDING ]  <--- Start of the partition
          |
[ N PRECEDING ]          <--- N rows before current row
          |
[ CURRENT ROW ]          <--- The active row being evaluated
          |
[ N FOLLOWING ]          <--- N rows after current row
          |
[ UNBOUNDED FOLLOWING ]  <--- End of the partition
```

---

## 7. Important Rules
1. **Never Put Window Functions in `WHERE`**: Writing `SELECT * FROM tbl WHERE ROW_NUMBER() OVER (...) = 1` causes an error: `ERROR: window functions are not allowed in WHERE`. Wrap the query in a CTE:
   ```sql
   WITH ranked AS (
     SELECT *, ROW_NUMBER() OVER (PARTITION BY dept ORDER BY salary DESC) as rn FROM tbl
   )
   SELECT * FROM ranked WHERE rn = 1;
   ```
2. **`ROW_NUMBER` vs `RANK` vs `DENSE_RANK` on Ties**:
   - `ROW_NUMBER()` arbitrarily orders ties (e.g., `1, 2, 3`). If order is non-deterministic, results can vary between runs!
   - `RANK()` assigns identical ranks to ties and skips subsequent numbers (`1, 2, 2, 4`).
   - `DENSE_RANK()` assigns identical ranks to ties without skipping (`1, 2, 2, 3`).
3. **Partition Independence**: Each partition is evaluated independently; window counters and accumulators reset to initial values when the partition key changes.

---

## 8. Common Mistakes

### 1. Default `RANGE` Frame Causing Accidental Duplicate Sums
```sql
-- DANGEROUS: If two transactions share the exact same timestamp, 
-- RANGE sums both rows together for both outputs!
SUM(amount) OVER (ORDER BY created_at)

-- SAFE: Explicitly declare ROWS frame to ensure strict sequential accumulation:
SUM(amount) OVER (ORDER BY created_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
```

### 2. Performing Moving Averages in Node.js
Fetching thousands of historical records into a Node.js process and looping through them with rolling slice windows to compute 7-day moving averages. Window functions can compute this in a single SQL query in 2 milliseconds:
```sql
AVG(revenue) OVER (ORDER BY date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW)
```

---

## 9. Best Practices

### 1. The Named `WINDOW` Clause
When multiple window functions share the exact same partition and ordering rules, avoid repeating the `OVER (...)` definition. Define a reusable named window at the bottom of the query:

```sql
SELECT 
  id,
  department_id,
  salary,
  ROW_NUMBER() OVER w AS row_num,
  RANK() OVER w AS rank_num,
  DENSE_RANK() OVER w AS dense_rank_num,
  AVG(salary) OVER w AS avg_dept_salary
FROM employees
WINDOW w AS (PARTITION BY department_id ORDER BY salary DESC);
```

### 2. Top-N Per Category via `DENSE_RANK` in a CTE
The standard production pattern for leaderboards and category showcases:
```sql
WITH ranked_products AS (
  SELECT 
    id,
    category_id,
    name,
    sales_count,
    DENSE_RANK() OVER (PARTITION BY category_id ORDER BY sales_count DESC) AS rank
  FROM products
)
SELECT * 
FROM ranked_products 
WHERE rank <= 3;
```

---

## 10. Performance Considerations
- **Sorting Cost (`WindowAgg` Node)**: In `EXPLAIN ANALYZE`, window functions appear as a `WindowAgg` execution node. If the data is not pre-sorted by the `PARTITION BY` and `ORDER BY` columns, PostgreSQL must execute an in-memory or on-disk **Sort** node.
- **Index Optimization**: A composite B-Tree index on `(department_id, salary DESC)` allows the database to eliminate the Sort node entirely, reading rows sequentially in already-sorted order for instantaneous window aggregation.

---

## 11. Security Considerations
- **Data Leakage in Multitenancy**: If an application calculates `PERCENT_RANK()` or `AVG()` over a window, forgetting to include `PARTITION BY tenant_id` or omitting `tenant_id` in the `WHERE` clause will calculate statistics across all customer accounts in the database, inadvertently leaking confidential competitor benchmark data.

---

## 12. Alternatives
1. **Self-Joins**: Pre-SQL:2003 approach; computationally expensive ($O(N^2)$) and hard to maintain.
2. **Correlated Subqueries**: Slow, quadratic performance on unindexed tables.
3. **Application-Level Array Processing**: Viable for small paginated lists (< 50 items), but unusable for large-scale financial reporting.

---

## 13. Trade-offs

| Method | Performance | Row Preservation | Memory Usage | Implementation |
| :--- | :--- | :--- | :--- | :--- |
| **Window Functions** | Fast ($O(N \log N)$ or $O(N)$ with index) | Preserves all rows | Moderate (`work_mem` sort) | Native SQL standard |
| **`GROUP BY`** | Fast ($O(N)$) | Collapses rows | Moderate | Simple |
| **Correlated Self-Join** | Extremely Slow ($O(N^2)$) | Preserves all rows | High | Complex and error-prone |

---

## 14. Real-World Usage
- **Gaming Leaderboards**: Calculating player ranks (`DENSE_RANK()`) within geographical regions or matchmaking divisions.
- **Fintech Fraud Detection**: Using `LAG(created_at, 1)` to detect impossible geographic travel (e.g., credit card used in New York, and 3 minutes later used in London).

---

## 15. Placement Interview Questions

### Basic
**Q: What is a Window Function, and how does it differ from a regular `GROUP BY` aggregate function?**  
*Answer*: A window function performs a calculation across a set of table rows related to the current row, but unlike a `GROUP BY` query (which groups rows and collapses them into a single summary output row), a window function preserves every individual row in the result set while appending the calculated aggregate value.

### Conceptual
**Q: Differentiate between `ROW_NUMBER()`, `RANK()`, and `DENSE_RANK()` with a concrete example involving tied values.**  
*Answer*: Suppose we have three employees with salaries `$100, $80, $80, $50`:
- **`ROW_NUMBER()`**: Generates continuous sequential integers regardless of ties: `1, 2, 3, 4` (the order between the two `$80` salaries is arbitrary).
- **`RANK()`**: Assigns the same rank to ties, but leaves gaps in subsequent ranks: `1, 2, 2, 4` (rank 3 is skipped).
- **`DENSE_RANK()`**: Assigns the same rank to ties without skipping subsequent ranks: `1, 2, 2, 3` (no gaps).

### Implementation
**Q: How do you find the Top 3 highest earning employees in each department using SQL?**  
*Answer*: Use `DENSE_RANK()` inside a CTE:
```sql
WITH ranked_employees AS (
  SELECT 
    name, 
    department_id, 
    salary,
    DENSE_RANK() OVER (PARTITION BY department_id ORDER BY salary DESC) AS rank
  FROM employees
)
SELECT name, department_id, salary, rank 
FROM ranked_employees 
WHERE rank <= 3;
```

### Debugging
**Q: A query with `SELECT id, ROW_NUMBER() OVER () as rn FROM users WHERE rn <= 10;` fails with `ERROR: column "rn" does not exist`. Why?**  
*Answer*: In SQL's logical execution pipeline, the `WHERE` clause is evaluated in **Phase 2**, whereas Window Functions and `SELECT` aliases (`rn`) are evaluated in **Phase 5**. Because the alias `rn` and the window function do not yet exist when `WHERE` runs, SQL cannot filter on it. The fix is to wrap the query in a CTE or subquery and filter in the outer `WHERE`.

### Scenario
**Q: You need to calculate the month-over-month percentage growth in revenue for 2026. How do you implement this in SQL?**  
*Answer*: Use the `LAG()` window function:
```sql
WITH monthly_sales AS (
  SELECT 
    DATE_TRUNC('month', created_at) AS sales_month,
    SUM(amount) AS current_revenue
  FROM orders
  WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01'
  GROUP BY DATE_TRUNC('month', created_at)
)
SELECT 
  sales_month,
  current_revenue,
  LAG(current_revenue, 1) OVER (ORDER BY sales_month) AS prev_month_revenue,
  ROUND(
    ((current_revenue - LAG(current_revenue, 1) OVER (ORDER BY sales_month)) / 
     NULLIF(LAG(current_revenue, 1) OVER (ORDER BY sales_month), 0)) * 100, 
    2
  ) AS mom_growth_percentage
FROM monthly_sales
ORDER BY sales_month;
```

### Advanced
**Q: What is the performance difference between `ROWS BETWEEN` and `RANGE BETWEEN` in a window frame specification?**  
*Answer*: 
- **`ROWS`** defines the window frame by physical row offsets (e.g., `ROWS BETWEEN 1 PRECEDING AND CURRENT ROW`). It is computationally fast because the engine simply counts row pointers without examining row values.
- **`RANGE`** defines the frame by logical value offsets (e.g., all rows with the same timestamp or value). The engine must compare the current row's ordering key against peer rows to determine if values are tied. This comparison incurs higher CPU overhead. If `ORDER BY` is used without an explicit frame, SQL defaults to `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`, which can lead to unexpected aggregated ties and slower execution.

---

## 16. Coding Questions

### Problem 1: Detect Gaps and Consecutive Logins (The Island and Gaps Problem)
Find users who logged into the system for at least 3 consecutive days.

```sql
WITH daily_logins AS (
  -- Deduplicate multiple logins on the same day
  SELECT DISTINCT user_id, DATE(login_time) AS login_date
  FROM user_logins
),
login_groups AS (
  -- Subtracting a sequential row_number from a sequential date produces a constant base date for consecutive streaks!
  SELECT 
    user_id,
    login_date,
    login_date - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY login_date) * INTERVAL '1 day') AS streak_group
  FROM daily_logins
)
SELECT 
  user_id,
  MIN(login_date) AS streak_start,
  MAX(login_date) AS streak_end,
  COUNT(*) AS consecutive_days
FROM login_groups
GROUP BY user_id, streak_group
HAVING COUNT(*) >= 3;
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking `LEAD()` and `LAG()` require a second argument. By default, `LEAD(col)` and `LAG(col)` offset by 1 row. You can provide an optional second argument for offset distance (`LAG(col, 3)`), and an optional third argument for default fallback if null (`LAG(col, 1, 0)`).
- **Trap 2**: Believing `PARTITION BY` is mandatory. It is not; `OVER (ORDER BY created_at)` creates a single global window across the entire table.
- **Trap 3**: Confusing `FIRST_VALUE()` with `MIN()`. `MIN()` returns the minimum value in the partition; `FIRST_VALUE()` returns the value of the first physical row in the ordered frame.

---

## 18. Revision Summary
- Window functions compute metrics across sets of related rows while preserving all individual rows.
- Evaluated late in the query pipeline (after `WHERE`, `GROUP BY`, and `HAVING`).
- Must wrap in a CTE or subquery if you need to filter on a window function result.
- `ROW_NUMBER()` is strictly unique; `RANK()` leaves gaps on ties; `DENSE_RANK()` has no gaps on ties.
- `LEAD()` accesses future rows; `LAG()` accesses past rows.
- Use explicit `ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW` to avoid unexpected `RANGE` peer grouping on duplicate keys.

---

## 19. Quick Reference

| Function | Output on Ties (`[100, 100, 50]`) | Common Use Case |
| :--- | :--- | :--- |
| **`ROW_NUMBER()`** | `1, 2, 3` | Pagination, deduplication, row identification |
| **`RANK()`** | `1, 1, 3` (Gap) | Competition rankings, official Olympic scoring |
| **`DENSE_RANK()`** | `1, 1, 2` (No gap) | Top-N categories, leaderboards |
| **`LAG(col, N)`** | Accesses $N$ rows prior | Period-over-period growth, state transitions |
| **`LEAD(col, N)`** | Accesses $N$ rows ahead | Session duration calculation, churn prediction |
| **`SUM() OVER (...)`** | Cumulative accumulator | Running bank balances, moving averages |
