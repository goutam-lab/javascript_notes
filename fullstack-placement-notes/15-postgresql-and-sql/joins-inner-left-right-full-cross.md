# SQL Joins: Inner, Left, Right, Full, Cross, and Engine Mechanics

## 1. What is it?
In relational database theory, a **JOIN** is a fundamental relational algebra operator that combines rows from two or more tables based on a related column between them. 

The ANSI SQL standard provides five primary types of joins:
1. **`INNER JOIN`**: Returns only rows where there is a match in both tables.
2. **`LEFT (OUTER) JOIN`**: Returns all rows from the left table, and matching rows from the right table (unmatched right rows become `NULL`).
3. **`RIGHT (OUTER) JOIN`**: Returns all rows from the right table, and matching rows from the left table (unmatched left rows become `NULL`).
4. **`FULL (OUTER) JOIN`**: Returns all rows when there is a match in either the left or right table, filling non-matching sides with `NULL`.
5. **`CROSS JOIN`**: Produces the Cartesian product of both tables (combines every row of Table A with every row of Table B).

Under the hood, database query optimizers execute these relational joins using one of three physical algorithms: **Nested Loop Join**, **Hash Join**, or **Merge Join**.

```
Venn Diagram Visualization of SQL Joins:

    INNER JOIN             LEFT JOIN              RIGHT JOIN             FULL JOIN
   +-----+-----+         +-----+-----+          +-----+-----+          +-----+-----+
   |     |#####|         |#####|#####|          |     |#####|          |#####|#####|
   |  A  |#A&B#|  B      |##A##|#A&B#|  B       |  A  |#A&B#|##B##     |##A##|#A&B#|##B##
   |     |#####|         |#####|#####|          |     |#####|          |#####|#####|
   +-----+-----+         +-----+-----+          +-----+-----+          +-----+-----+
 Only matching rows     All A + matched B      All B + matched A      Everything from both
```

---

## 2. Why does it exist?
1. **The Core of Relational Modeling**: Normalization dictates that data entities (`users`, `orders`, `products`) must be stored in distinct, modular tables to prevent data duplication. Relational joins allow applications to reconstruct complete composite business views on-demand without data redundancy.
2. **Expressive Data Relationship Modeling**:
   - `INNER JOIN` models mandatory relationships (e.g., an order line item must belong to an existing product).
   - `LEFT JOIN` models optional relationships (e.g., a customer who may or may not have placed an order).
   - `FULL JOIN` identifies orphaned records or merges data reconciliation feeds across disparate systems.
   - `CROSS JOIN` generates permutations (e.g., generating all combinations of shirt sizes and shirt colors for an inventory matrix).

---

## 3. Mental Model
Think of Joins as **Pairing Students with Locker Keys**:
- **Table A**: Students.
- **Table B**: Lockers.
- **`INNER JOIN`**: Only students who actually have an assigned locker walk into the hallway with their locker. Students without lockers and empty lockers are left behind.
- **`LEFT JOIN`**: Every student enters the hallway. If a student has an assigned locker, they stand next to it. If they don't have a locker, they stand alone with an empty space (`NULL`) beside them.
- **`RIGHT JOIN`**: Every physical locker is brought out. If a student owns it, they stand next to it. Unassigned lockers stand empty with `NULL` for student details.
- **`FULL OUTER JOIN`**: All students and all lockers are brought out. Everyone with a match stands together; unassigned students stand with `NULL`, and unassigned lockers stand with `NULL`.
- **`CROSS JOIN`**: Every student tries the key on every single locker in the school (Every row of A paired with every row of B).

---

## 4. Basic Example
SQL syntax for all join variations:

```sql
-- 1. INNER JOIN
SELECT u.name, o.order_number, o.total_amount
FROM users u
INNER JOIN orders o ON u.id = o.user_id;

-- 2. LEFT JOIN (Preserves all users, even those with zero orders)
SELECT u.name, COALESCE(o.order_number, 'NO_ORDERS') AS order_status
FROM users u
LEFT JOIN orders o ON u.id = o.user_id;

-- 3. RIGHT JOIN (Rare in practice; typically rewritten as LEFT JOIN)
SELECT u.name, o.order_number
FROM users u
RIGHT JOIN orders o ON u.id = o.user_id;

-- 4. FULL OUTER JOIN (Finds unmatched records on both sides)
SELECT u.name, o.order_number
FROM users u
FULL OUTER JOIN orders o ON u.id = o.user_id;

-- 5. CROSS JOIN (Cartesian product: 4 sizes * 3 colors = 12 rows)
SELECT s.size_name, c.color_name
FROM sizes s
CROSS JOIN colors c;
```

---

## 5. Real Example: Multi-Table E-Commerce Reporting with Self Joins
A production TypeScript / PostgreSQL query demonstrating multi-table relational joins combined with a **Self Join** to reconstruct employee managerial hierarchies:

```typescript
import { dbPool } from './db';

interface DepartmentHierarchyReport {
  employeeId: string;
  employeeName: string;
  jobTitle: string;
  managerName: string;
  departmentName: string;
  totalProjectsCount: number;
}

export async function getDepartmentHierarchy(): Promise<DepartmentHierarchyReport[]> {
  const query = `
    SELECT 
      e.id AS "employeeId",
      e.full_name AS "employeeName",
      e.title AS "jobTitle",
      COALESCE(m.full_name, 'TOP_LEVEL_EXECUTIVE') AS "managerName",
      d.name AS "departmentName",
      COUNT(ep.project_id) AS "totalProjectsCount"
      
    FROM employees e
    
    -- 1. SELF JOIN: Join employees table to itself to resolve manager hierarchy
    LEFT JOIN employees m 
      ON e.manager_id = m.id
      
    -- 2. INNER JOIN: Every employee must belong to a valid department
    INNER JOIN departments d 
      ON e.department_id = d.id
      
    -- 3. LEFT JOIN: Employee may be assigned to 0 or more active projects
    LEFT JOIN employee_projects ep 
      ON e.id = ep.employee_id
      
    WHERE e.is_active = true
    GROUP BY e.id, e.full_name, e.title, m.full_name, d.name
    ORDER BY d.name ASC, e.full_name ASC;
  `;

  const result = await dbPool.query(query);
  return result.rows;
}
```

---

## 6. Under the Hood

### The 3 Physical Join Execution Engines
When you write `JOIN`, the query planner chooses among three physical C algorithms based on data size, memory, and indexes:

```
1. NESTED LOOP JOIN:
   For each row R in Outer Table:
     For each row S in Inner Table:
       If R.key == S.key -> Emit(R, S)
   Best for: Small outer table + indexed inner table (Lightning fast: O(N log M))

2. HASH JOIN:
   Phase 1 (Build): Read smaller table into in-memory Hash Table (Hash on join key)
   Phase 2 (Probe): Stream larger table, hash each key, probe hash table for matches
   Best for: Large unsorted datasets with equality joins (O(N + M))

3. MERGE JOIN:
   Prerequisite: Both tables MUST be pre-sorted by the join key!
   Algorithm: Walk two pointers simultaneously down both sorted streams (like mergesort)
   Best for: Massive pre-sorted tables (e.g. from B-Tree index) or range joins
```

### Join Mechanics Matrix

| Algorithm | Pre-conditions | Memory Requirement | Time Complexity |
| :--- | :--- | :--- | :--- |
| **Nested Loop** | Highly efficient if inner table has B-Tree index | Minimal ($O(1)$) | $O(N \log M)$ with index; $O(N \times M)$ without |
| **Hash Join** | Equality operator (`=`) only | High (Builds hash table in `work_mem`) | $O(N + M)$ |
| **Merge Join** | Both inputs must be sorted by join key | Low ($O(1)$ memory streaming) | $O(N + M)$ (plus sort cost if unsorted) |

---

## 7. Important Rules
1. **The `ON` vs `WHERE` Clause Filter Trap in `LEFT JOIN`**:
   - Condition in `ON`: Filters the joined table **before** the join takes place; unmatched left rows are still retained with `NULL`.
   - Condition in `WHERE`: Filters the result set **after** the join takes place; filtering on the right table's column in `WHERE` silently converts your `LEFT JOIN` into an `INNER JOIN`!
2. **Foreign Key Columns Must Be Indexed**: Relational engines automatically index Primary Keys, but they **never** automatically index Foreign Keys. Joining on an unindexed foreign key forces the engine to fall back to slow table scans or costly Hash Joins.
3. **Cartesian Explosion Danger**: If Table A has 1,000 rows and Table B has 10,000 rows, a missing or broken join condition executes a `CROSS JOIN`, returning $1,000 \times 10,000 = 10,000,000$ rows, freezing database connections.

---

## 8. Common Mistakes

### 1. The Accidental Inner Join Bug (`WHERE` with `LEFT JOIN`)
```sql
-- BUG: Intended to show ALL users, but excludes users who have no orders!
SELECT u.id, u.name, o.status
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE o.status = 'PENDING'; -- FATAL: If user has no orders, o.status is NULL! 
                            -- 'NULL = PENDING' evaluates to UNKNOWN, dropping the user!

-- FIX: Move the right table predicate into the ON clause:
SELECT u.id, u.name, o.status
FROM users u
LEFT JOIN orders o ON u.id = o.user_id AND o.status = 'PENDING';
```

### 2. Finding Non-Matching Records Incorrectly
Using `NOT IN (SELECT id FROM ...)` which silently fails and returns zero rows if the subquery contains a single `NULL` value. Use an **Anti-Join (`LEFT JOIN ... WHERE right.id IS NULL`)**:
```sql
-- CORRECT & FAST: Anti-Join pattern to find users with zero orders
SELECT u.id, u.name
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE o.id IS NULL;
```

---

## 9. Best Practices
- **Prefer `LEFT JOIN` over `RIGHT JOIN`**: For consistency and mental readability, always place the primary/preserved table on the left and use `LEFT JOIN`.
- **Alias All Tables Explicitly**: Never write multi-table joins without short, descriptive table aliases (`FROM customers c JOIN orders o ON c.id = o.customer_id`).
- **Join on Compact Scalar Types**: Join on integers or UUIDs. Avoid joining tables on wide `VARCHAR` columns (e.g., joining on `email` or `company_name`), as string comparisons consume significantly more CPU and memory in Hash and Merge join nodes.

---

## 10. Performance Considerations
- **Hash Table Spilling to Disk**: If the build side of a Hash Join exceeds **`work_mem`**, PostgreSQL splits the hash table into batches and spills them to temporary disk files. Increasing `work_mem` for the query converts a multi-batch disk join into a single-batch pure-RAM join.
- **Join Re-ordering by Query Planner**: The PostgreSQL Genetic Query Optimizer (GEQO) automatically evaluates permutations of join order to pick the cheapest path. The table yielding the smallest intermediate result set is typically selected as the build/outer table.

---

## 11. Security Considerations
- **Tenant Isolation in Multi-Tenant Databases**: In shared databases where tables contain `tenant_id`, joining without propagating `tenant_id` to every join condition risks **Cross-Tenant Data Leakage** if foreign keys are corrupted. Enforce Row-Level Security (RLS) to ensure join targets are isolated at the database engine level.

---

## 12. Alternatives
1. **Denormalization**: Duplicating target attributes to avoid joins entirely in read-heavy architectures.
2. **Subqueries / `EXISTS`**: Using `WHERE EXISTS (SELECT 1 FROM ...)` (Semi-Join) when you only need to verify existence without projecting child columns.
3. **Application-Level In-Memory Stitching**: Executing two separate queries and joining objects in Node.js (common in microservices with separate databases, though slower than in-engine SQL joins).

---

## 13. Trade-offs

| Join Type | Result Size | Use Case | NULL Handling |
| :--- | :--- | :--- | :--- |
| **`INNER JOIN`** | $\le \min(A, B)$ | Enforcing strict relationship existence | Excludes non-matches |
| **`LEFT JOIN`** | $\ge \text{Size of } A$ | Retaining parent records regardless of child presence | Emits `NULL` for missing right side |
| **`FULL JOIN`** | $\ge \max(A, B)$ | Full audit reconciliations, data warehousing | Emits `NULL` on either side |
| **`CROSS JOIN`** | $A \times B$ | Combinatorial matrices, date range scaffolding | No `NULL` generated |

---

## 14. Real-World Usage
- **Financial Ledger Reconciliation**: Accounting engines run `FULL OUTER JOIN` between bank statement records and internal transaction ledgers to flag discrepancies where money was logged in one system but absent in the other.
- **Access Control Matrix**: Security systems use `CROSS JOIN` between all user roles and all application permissions to generate a baseline authorization evaluation matrix.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the difference between an `INNER JOIN` and a `LEFT JOIN`?**  
*Answer*: An `INNER JOIN` returns only rows that satisfy the join predicate in both tables (unmatched rows from both sides are discarded). A `LEFT JOIN` returns all rows from the left table regardless of whether a match exists in the right table; if no match exists, columns from the right table are populated with `NULL`.

### Conceptual
**Q: Explain the difference between putting a filtering condition in the `ON` clause versus the `WHERE` clause of a `LEFT JOIN`.**  
*Answer*: In a `LEFT JOIN`:
- A condition in the **`ON` clause** is applied *during* the join. If a row in the right table fails the condition, the left row is still returned, with `NULL` for the right table columns.
- A condition in the **`WHERE` clause** is applied *after* the join has completed. If the `WHERE` clause tests a column from the right table (e.g., `WHERE right.status = 'ACTIVE'`), rows where the right side was `NULL` evaluate to `UNKNOWN` and are filtered out, effectively turning the `LEFT JOIN` into an `INNER JOIN`.

### Implementation
**Q: What is an "Anti-Join", and how do you write one in SQL to find customers who have never made a purchase?**  
*Answer*: An Anti-Join returns rows from the left table that have **no matching rows** in the right table. It is implemented using a `LEFT JOIN` paired with a `WHERE right_table.id IS NULL` check:
```sql
SELECT c.id, c.name 
FROM customers c 
LEFT JOIN orders o ON c.id = o.customer_id 
WHERE o.id IS NULL;
```

### Debugging
**Q: A query joining `users` (1,000 rows) and `roles` (5 rows) takes 30 seconds and outputs 5,000 rows. What mistake was made?**  
*Answer*: The query omitted the `ON` join predicate or used a broken condition, triggering an unintentional **`CROSS JOIN` (Cartesian Product)**. The database paired all 1,000 users with all 5 roles ($1,000 \times 5 = 5,000$ rows). The fix is to add the proper matching condition: `JOIN user_roles ur ON u.id = ur.user_id JOIN roles r ON ur.role_id = r.id`.

### Scenario
**Q: When would PostgreSQL choose a Hash Join over a Nested Loop Join, and how does `work_mem` affect it?**  
*Answer*: PostgreSQL chooses a **Hash Join** when joining two relatively large datasets on an equality operator (`=`) where neither side has an index on the join key. It builds an in-memory hash table of the smaller table and probes it with rows from the larger table in $O(N + M)$ time. If the hash table size exceeds **`work_mem`**, the planner cannot complete the hash join in RAM; it must split the hash table into batches and spill them to disk, resulting in disk I/O bottlenecks.

### Advanced
**Q: What is a Semi-Join in relational database query planning, and how does it differ from a standard Inner Join?**  
*Answer*: A **Semi-Join** returns rows from the first table if and only if there is at least one matching row in the second table, but unlike an `INNER JOIN`, it **never duplicates rows** from the first table regardless of how many matches exist in the second table, and it does not project columns from the second table. In SQL, Semi-Joins are written using `WHERE EXISTS (SELECT 1 FROM ...)` or `WHERE id IN (SELECT ...)`. The engine optimizes Semi-Joins by halting search on the second table as soon as the first match is encountered.

---

## 16. Coding Questions

### Problem 1: Department Manager and Salary Comparison (Self Join)
Find all employees who earn a higher salary than their direct manager.

```sql
SELECT 
  e.id AS employee_id,
  e.name AS employee_name,
  e.salary AS employee_salary,
  m.name AS manager_name,
  m.salary AS manager_salary
FROM employees e
INNER JOIN employees m ON e.manager_id = m.id
WHERE e.salary > m.salary;
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking `NOT IN` is identical to `NOT EXISTS` or Anti-Joins. If the subquery in `WHERE id NOT IN (SELECT user_id FROM orders)` contains even a single `NULL` value, the entire `NOT IN` expression evaluates to `UNKNOWN`, returning **zero rows**. Always use `NOT EXISTS` or Anti-Joins.
- **Trap 2**: Believing `CROSS JOIN` is always useless. `CROSS JOIN` is deliberately used in reporting to scaffold missing calendar dates or build permutation matrices.
- **Trap 3**: Assuming `JOIN` order in the SQL text forces the database execution order. Modern SQL optimizers use cost-based analyzers to dynamically reorder joins regardless of which table was written first in the `FROM` clause.

---

## 18. Revision Summary
- The 5 join types: `INNER`, `LEFT`, `RIGHT`, `FULL`, and `CROSS`.
- The 3 physical join algorithms: **Nested Loop** (small/indexed), **Hash Join** (large/RAM hash table), and **Merge Join** (pre-sorted streams).
- In a `LEFT JOIN`, filtering on the right table in `WHERE` turns it into an `INNER JOIN`; put right-table filters in the `ON` clause to preserve outer rows.
- Use the **Anti-Join pattern** (`LEFT JOIN ... WHERE right.id IS NULL`) to find missing relationships cleanly.
- Always index foreign key columns to enable fast Nested Loop or Merge Joins.

---

## 19. Quick Reference

| Join Syntax | Primary Table Retained | Unmatched Output | Typical Execution Node |
| :--- | :--- | :--- | :--- |
| **`INNER JOIN`** | Neither (Intersection only) | Dropped | Nested Loop / Hash Join |
| **`LEFT JOIN`** | Left Table | Right side populated with `NULL` | Hash Left Join |
| **`RIGHT JOIN`** | Right Table | Left side populated with `NULL` | Hash Right Join |
| **`FULL OUTER JOIN`** | Both Tables | Unmatched sides populated with `NULL` | Hash Full Join |
| **`CROSS JOIN`** | Both (Cartesian Product) | All permutations generated | Nested Loop |
| **Anti-Join** | Left Table | Filtered via `WHERE right.id IS NULL` | Hash Anti Join |
