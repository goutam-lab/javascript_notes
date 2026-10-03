# Top 25 SQL Placement Query Challenges: Solutions and Architectural Breakdown

## 1. What is it?
**SQL Query Solving** in placement assessments and machine coding rounds tests an engineer's ability to manipulate relational datasets using declarative SQL constructs: **Window Functions (`ROW_NUMBER`, `RANK`, `DENSE_RANK`, `LEAD`, `LAG`)**, **Common Table Expressions (CTEs & Recursive CTEs)**, **Self Joins**, **Conditional Aggregations (`CASE WHEN`)**, and **Set Operators**.

These 25 queries represent the canonical, high-frequency SQL interview problems asked by tier-1 product companies (Amazon, Google, Microsoft, Uber, Razorpay, Flipkart).

```
          ADVANCED SQL ENGINE EXECUTION PIPELINE
          
   SQL Text:
   SELECT dept, emp, salary, DENSE_RANK() OVER (PARTITION BY dept ORDER BY salary DESC)
   FROM employees WHERE status = 'ACTIVE' GROUP BY ... HAVING ...
   
   Logical Execution Order:
   1. FROM / JOIN     ──► Gathers candidate row Cartesian space
   2. WHERE           ──► Prunes non-matching rows before aggregation
   3. GROUP BY        ──► Bundles rows into discrete aggregate buckets
   4. HAVING          ──► Prunes grouped buckets
   5. WINDOW (OVER)   ──► Computes rolling / partitioned analytical functions
   6. SELECT          ──► Projects requested columns and expressions
   7. DISTINCT        ──► Deduplicates result rows
   8. ORDER BY        ──► Sorts final output
   9. LIMIT / OFFSET  ──► Slices pagination window
```

---

## 2. Why does it exist?
Modern full-stack engineers frequently perform database transformations inside application code (e.g. Node.js JavaScript loops). Pulling 500,000 rows across the network into Node.js heap memory to find the "Top 3 earners per department" causes massive network overhead and memory exhaustion. 

Mastering SQL allows engineers to push heavy analytical processing down to the database engine's native C++ query optimizer, returning results in milliseconds.

---

## 3. Mental Model
Think of SQL operations as **Assembly Line Workstations**:

```
                       ASSEMBLY LINE ANALOGY
                       
  [ Raw Raw Table Rows ]
          │
          ▼  [ Station 1: WHERE ]
  (Discards broken or inactive parts)
          │
          ▼  [ Station 2: JOIN ]
  (Bolts on matching parts from a second conveyor belt)
          │
          ▼  [ Station 3: PARTITION BY (Window) ]
  (Sorts parts into color-coded bins without crushing them together)
          │
          ▼  [ Station 4: DENSE_RANK() ]
  (Numbers the parts inside each bin from best to worst)
          │
          ▼  [ Station 5: LIMIT ]
  (Boxes up only the top 10 parts for shipment)
```

---

## 4. Top 1–5 Canonical SQL Problems

### 1. Second Highest Salary
Find the 2nd highest salary from an `Employee` table. If there is no 2nd highest, return `NULL`.

```sql
-- Solution 1: Subquery with MAX (Immune to duplicates)
SELECT MAX(salary) AS SecondHighestSalary
FROM Employee
WHERE salary < (SELECT MAX(salary) FROM Employee);

-- Solution 2: Window Function with DENSE_RANK (Handles N-th salary)
WITH RankedSalaries AS (
  SELECT salary, DENSE_RANK() OVER (ORDER BY salary DESC) AS rnk
  FROM Employee
)
SELECT (
  SELECT salary FROM RankedSalaries WHERE rnk = 2 LIMIT 1
) AS SecondHighestSalary;
```

### 2. Nth Highest Salary (PostgreSQL Stored Function)
```sql
CREATE OR REPLACE FUNCTION getNthHighestSalary(N INT) 
RETURNS TABLE (Salary INT) AS $$
BEGIN
  RETURN QUERY (
    WITH Ranked AS (
      SELECT e.salary, DENSE_RANK() OVER (ORDER BY e.salary DESC) as rnk
      FROM Employee e
    )
    SELECT DISTINCT r.salary
    FROM Ranked r
    WHERE r.rnk = N
  );
END;
$$ LANGUAGE plpgsql;
```

### 3. Duplicate Emails
Find all duplicate emails in a table `Person(id, email)`.

```sql
-- Approach: GROUP BY with HAVING filter
SELECT email
FROM Person
GROUP BY email
HAVING COUNT(email) > 1;
```

### 4. Delete Duplicate Records (Keeping Smallest ID)
Delete all duplicate email rows from `Person`, keeping only the row with the smallest `id`.

```sql
-- PostgreSQL CTE with Window Function
DELETE FROM Person
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY email ORDER BY id ASC) as rn
    FROM Person
  ) t
  WHERE t.rn > 1
);

-- Alternative: Self-Join Delete
DELETE p1 FROM Person p1
INNER JOIN Person p2 
ON p1.email = p2.email AND p1.id > p2.id;
```

### 5. Consecutive Numbers in Logs
Find all numbers that appear at least three times consecutively in `Logs(id, num)`.

```sql
WITH AnalyzedLogs AS (
  SELECT 
    num,
    LAG(num, 1) OVER (ORDER BY id) AS prev_1,
    LAG(num, 2) OVER (ORDER BY id) AS prev_2
  FROM Logs
)
SELECT DISTINCT num AS ConsecutiveNums
FROM AnalyzedLogs
WHERE num = prev_1 AND num = prev_2;
```

---

## 5. Top 6–10 Intermediate SQL Problems

### 6. Department Top 3 Salaries
Find employees who have the top 3 unique salaries in each department.

```sql
WITH RankedEmployees AS (
  SELECT 
    d.name AS Department,
    e.name AS Employee,
    e.salary AS Salary,
    DENSE_RANK() OVER (
      PARTITION BY e.departmentId 
      ORDER BY e.salary DESC
    ) as rnk
  FROM Employee e
  INNER JOIN Department d ON e.departmentId = d.id
)
SELECT Department, Employee, Salary
FROM RankedEmployees
WHERE rnk <= 3;
```

### 7. Customers Who Never Order
Find all customers who never placed any orders.

```sql
-- Approach 1: LEFT JOIN with NULL check (Optimized with indexes)
SELECT c.name AS Customers
FROM Customers c
LEFT JOIN Orders o ON c.id = o.customerId
WHERE o.id IS NULL;

-- Approach 2: NOT EXISTS (Often produces superior query plans)
SELECT c.name AS Customers
FROM Customers c
WHERE NOT EXISTS (
  SELECT 1 FROM Orders o WHERE o.customerId = c.id
);
```

### 8. Employees Earning More Than Their Managers
`Employee(id, name, salary, managerId)`

```sql
SELECT e.name AS Employee
FROM Employee e
INNER JOIN Employee m ON e.managerId = m.id
WHERE e.salary > m.salary;
```

### 9. Rising Temperature
Find all dates `id` with higher temperatures compared to the previous day.

```sql
SELECT w1.id
FROM Weather w1
INNER JOIN Weather w2 
ON w1.recordDate = w2.recordDate + INTERVAL '1 day'
WHERE w1.temperature > w2.temperature;
```

### 10. Trips and Users (Cancellation Rate)
Calculate the cancellation rate of requests by unbanned users each day between `'2025-10-01'` and `'2025-10-03'`.

```sql
SELECT 
  t.request_at AS "Day",
  ROUND(
    SUM(CASE WHEN t.status LIKE 'cancelled%' THEN 1.0 ELSE 0.0 END) / COUNT(*),
    2
  ) AS "Cancellation Rate"
FROM Trips t
INNER JOIN Users c ON t.client_id = c.users_id AND c.banned = 'No'
INNER JOIN Users d ON t.driver_id = d.users_id AND d.banned = 'No'
WHERE t.request_at BETWEEN '2025-10-01' AND '2025-10-03'
GROUP BY t.request_at;
```

---

## 6. Top 11–15 Advanced Data Transformation Problems

### 11. Reformat Department Table (Pivot via Conditional Aggregation)
Pivot `Department(id, revenue, month)` from rows into columns (`Jan_Revenue`, `Feb_Revenue`...).

```sql
SELECT 
  id,
  SUM(CASE WHEN month = 'Jan' THEN revenue ELSE NULL END) AS Jan_Revenue,
  SUM(CASE WHEN month = 'Feb' THEN revenue ELSE NULL END) AS Feb_Revenue,
  SUM(CASE WHEN month = 'Mar' THEN revenue ELSE NULL END) AS Mar_Revenue
FROM Department
GROUP BY id;
```

### 12. Tree Node Structure (Root, Inner, Leaf)
`Tree(id, p_id)`. Categorize each node.

```sql
SELECT 
  id,
  CASE 
    WHEN p_id IS NULL THEN 'Root'
    WHEN id IN (SELECT DISTINCT p_id FROM Tree WHERE p_id IS NOT NULL) THEN 'Inner'
    ELSE 'Leaf'
  END AS type
FROM Tree;
```

### 13. Market Analysis I
Find for each user their registration date and the number of orders placed in 2024 as a buyer.

```sql
SELECT 
  u.user_id AS buyer_id,
  u.join_date,
  COUNT(o.order_id) AS orders_in_2024
FROM Users u
LEFT JOIN Orders o 
  ON u.user_id = o.buyer_id 
  AND EXTRACT(YEAR FROM o.order_date) = 2024
GROUP BY u.user_id, u.join_date;
```

### 14. Rank Scores Without Gaps
Score rankings where tied scores share the same rank and the next score receives the immediate consecutive integer.

```sql
SELECT 
  score,
  DENSE_RANK() OVER (ORDER BY score DESC) AS "rank"
FROM Scores;
```

### 15. Running Total / Cumulative Sum
Calculate cumulative revenue over time.

```sql
SELECT 
  order_date,
  daily_amount,
  SUM(daily_amount) OVER (ORDER BY order_date ASC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running_total
FROM (
  SELECT order_date, SUM(amount) AS daily_amount
  FROM Orders
  GROUP BY order_date
) daily_summary;
```

---

## 7. Top 16–20 Analytical & Behavioral Problems

### 16. Monthly Active Users (MAU) & User Retention Cohorts
Calculate 30-day retention cohort matrix.

```sql
WITH UserFirstSeen AS (
  SELECT user_id, DATE_TRUNC('month', MIN(login_date)) AS cohort_month
  FROM UserLogins
  GROUP BY user_id
),
UserActivities AS (
  SELECT DISTINCT user_id, DATE_TRUNC('month', login_date) AS activity_month
  FROM UserLogins
)
SELECT 
  f.cohort_month,
  a.activity_month,
  COUNT(DISTINCT f.user_id) AS active_retained_users
FROM UserFirstSeen f
INNER JOIN UserActivities a ON f.user_id = a.user_id
GROUP BY f.cohort_month, a.activity_month
ORDER BY f.cohort_month, a.activity_month;
```

### 17. Find Median Salary
Find the median salary per department without built-in median functions.

```sql
WITH OrderedSalaries AS (
  SELECT 
    department_id,
    salary,
    ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY salary ASC) as row_asc,
    ROW_NUMBER() OVER (PARTITION BY department_id ORDER BY salary DESC) as row_desc
  FROM Employee
)
SELECT department_id, AVG(salary) AS median_salary
FROM OrderedSalaries
WHERE row_asc BETWEEN row_desc - 1 AND row_desc + 1
GROUP BY department_id;
```

### 18. Gaps and Islands (Grouping Contiguous Activity Streaks)
Group continuous user activity days into distinct streak sessions.

```sql
WITH NumberedDates AS (
  SELECT 
    user_id,
    activity_date,
    activity_date - (ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY activity_date) * INTERVAL '1 day') AS grp
  FROM UserActivity
)
SELECT 
  user_id,
  MIN(activity_date) AS streak_start,
  MAX(activity_date) AS streak_end,
  COUNT(*) AS streak_length_days
FROM NumberedDates
GROUP BY user_id, grp
ORDER BY streak_length_days DESC;
```

### 19. First-Touch and Last-Touch Attribution
Identify the first marketing campaign and the final conversion campaign for each customer.

```sql
SELECT 
  customer_id,
  FIRST_VALUE(campaign) OVER (
    PARTITION BY customer_id ORDER BY touch_timestamp ASC
  ) AS first_touch_campaign,
  LAST_VALUE(campaign) OVER (
    PARTITION BY customer_id ORDER BY touch_timestamp ASC
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
  ) AS last_touch_campaign
FROM MarketingTouches;
```

### 20. Exchange Seats (Swap Adjacent Students)
Swap seats for every two consecutive students in `Seat(id, student)`. If total count is odd, the last seat remains unchanged.

```sql
SELECT 
  CASE 
    -- If odd and last seat, keep id
    WHEN MOD(id, 2) != 0 AND id = (SELECT COUNT(*) FROM Seat) THEN id
    -- If odd, swap with next
    WHEN MOD(id, 2) != 0 THEN id + 1
    -- If even, swap with previous
    ELSE id - 1
  END AS id,
  student
FROM Seat
ORDER BY id ASC;
```

---

## 8. Top 21–25 Complex Relational Graph & Recursive Problems

### 21. Managers with At Least 5 Direct Reports
```sql
SELECT m.name
FROM Employee e
INNER JOIN Employee m ON e.managerId = m.id
GROUP BY m.id, m.name
HAVING COUNT(e.id) >= 5;
```

### 22. Page Recommendations
Recommend pages liked by friends of user 1, excluding pages user 1 has already liked.

```sql
WITH UserFriends AS (
  SELECT user2_id AS friend_id FROM Friendship WHERE user1_id = 1
  UNION
  SELECT user1_id AS friend_id FROM Friendship WHERE user2_id = 1
)
SELECT DISTINCT page_id AS recommended_page
FROM Likes
WHERE user_id IN (SELECT friend_id FROM UserFriends)
  AND page_id NOT IN (SELECT page_id FROM Likes WHERE user_id = 1);
```

### 23. Investments in 2016
Sum `tiv_2016` for policyholders who:
1. Have the same `tiv_2015` value as one or more other policyholders, and
2. Are not located in the exact same city (`(lat, lon)` is unique).

```sql
SELECT ROUND(CAST(SUM(tiv_2016) AS NUMERIC), 2) AS tiv_2016
FROM Insurance
WHERE tiv_2015 IN (
  SELECT tiv_2015 FROM Insurance GROUP BY tiv_2015 HAVING COUNT(*) > 1
)
AND (lat, lon) IN (
  SELECT lat, lon FROM Insurance GROUP BY lat, lon HAVING COUNT(*) = 1
);
```

### 24. Human Traffic of Stadium
Find rows with consecutive `id`s where people count $\ge 100$ for 3 or more consecutive days.

```sql
WITH FilteredStadium AS (
  SELECT id, visit_date, people,
         id - ROW_NUMBER() OVER (ORDER BY id) as island_id
  FROM Stadium
  WHERE people >= 100
),
IslandCounts AS (
  SELECT *, COUNT(*) OVER (PARTITION BY island_id) as island_size
  FROM FilteredStadium
)
SELECT id, visit_date, people
FROM IslandCounts
WHERE island_size >= 3
ORDER BY id ASC;
```

### 25. Recursive Organizational Hierarchy (Recursive CTE)
Traverse a complete reporting hierarchy tree under the CEO (`manager_id IS NULL`), calculating corporate depth.

```sql
WITH RECURSIVE OrgChart AS (
  -- Anchor Member: Find the CEO
  SELECT id, name, manager_id, 1 AS depth, CAST(name AS TEXT) AS hierarchy_path
  FROM Employees
  WHERE manager_id IS NULL

  UNION ALL

  -- Recursive Member: Join subordinates to their managers
  SELECT e.id, e.name, e.manager_id, o.depth + 1, o.hierarchy_path || ' -> ' || e.name
  FROM Employees e
  INNER JOIN OrgChart o ON e.manager_id = o.id
)
SELECT id, name, depth, hierarchy_path
FROM OrgChart
ORDER BY depth, id;
```

---

## 9. Important Rules
1. **`RANK()` vs `DENSE_RANK()` vs `ROW_NUMBER()`:**
   - `ROW_NUMBER()`: Always generates unique consecutive integers (1, 2, 3, 4) regardless of ties.
   - `RANK()`: Tied values receive the same rank, but skips subsequent numbers (1, 2, 2, 4).
   - `DENSE_RANK()`: Tied values receive the same rank without gaps (1, 2, 2, 3).
2. **`LAST_VALUE()` Window Framing Caveat:**
   By default, window frames use `RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW`. This makes `LAST_VALUE()` return the *current* row instead of the true last row! Always specify `ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING`.
3. **Filter Placement on LEFT JOINs:**
   Conditions placed in the `ON` clause filter before joining; conditions placed in the `WHERE` clause filter after joining (which can inadvertently turn a `LEFT JOIN` into an `INNER JOIN`).

---

## 10. Performance Considerations
- **Indexing Window Partition Keys:** If running `OVER (PARTITION BY dept_id ORDER BY salary DESC)`, create a composite B-Tree index on `(dept_id, salary DESC)` to allow index-backed stream sorting.
- **Filter Early in CTEs:** Push `WHERE` clauses directly into the base CTE expressions rather than filtering the outer query.

---

## 11. Common Interview Traps
- **Trap 1:** Using `LIMIT 1 OFFSET 1` to find 2nd highest salary.
  *Reality:* If there are duplicate top salaries or only 1 employee, `OFFSET 1` returns the top salary again or an empty set instead of `NULL`.
- **Trap 2:** Using `NOT IN` with subqueries containing `NULL` values.
  *Reality:* In SQL, `val NOT IN (SELECT col FROM t)` returns ZERO rows if any row in `col` is `NULL` (due to three-valued logic). Always use `NOT EXISTS`.

---

## 12. Quick Reference Summary Table

```
┌─────────────────────────────────┬───────────────────────────────────────────────┐
│ PROBLEM ARCHETYPE               │ KEY SQL CONSTRUCT                             │
├─────────────────────────────────┼───────────────────────────────────────────────┤
│ Top N per Category              │ DENSE_RANK() OVER (PARTITION BY ... ORDER BY) │
│ Sequential / Consecutive Events │ LAG(col, 1) / LEAD(col, 1) or Gaps & Islands  │
│ Running Totals / Moving Average │ SUM(col) OVER (ORDER BY date ROWS ...)        │
│ Missing Records / Anti-Join     │ NOT EXISTS (SELECT 1 ...) or LEFT JOIN IS NULL│
│ Data Flattening / Pivoting      │ SUM(CASE WHEN month = 'Jan' THEN revenue END) │
│ Organizational Hierarchy Trees  │ WITH RECURSIVE (Anchor UNION ALL Recursive)   │
└─────────────────────────────────┴───────────────────────────────────────────────┘
```
