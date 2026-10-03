# DDL and DML: CRUD Foundations and Upserts

## 1. What is it?
SQL statements are fundamentally divided into two major linguistic branches:
- **DDL (Data Definition Language)**: Commands that define, modify, or destroy the structural schema and integrity rules of the database. Primary commands include `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, and `RENAME`. DDL manages tables, columns, indexes, constraints, and schemas.
- **DML (Data Manipulation Language)**: Commands that interact with, query, insert, mutate, or remove the actual data records stored within those schemas. Primary commands include `SELECT`, `INSERT`, `UPDATE`, and `DELETE`.

The **UPSERT** pattern (`INSERT ... ON CONFLICT DO UPDATE` or `DO NOTHING`) is an advanced DML construct that combines insertion and modification into an atomic, race-condition-free operation.

```
SQL Language Taxonomy:
+---------------------------------------------------------------------------------+
|                                    SQL COMMANDS                                 |
+---------------------------------------------------------------------------------+
           |                                                    |
           v                                                    v
+-------------------------------+                     +---------------------------+
| DDL (Data Definition Language)|                     | DML (Data Manipulation)   |
| Modifies Schema & Invariants  |                     | Modifies Row Tuples       |
| - CREATE TABLE                |                     | - INSERT                  |
| - ALTER TABLE                 |                     | - SELECT                  |
| - DROP TABLE                  |                     | - UPDATE                  |
| - TRUNCATE TABLE              |                     | - DELETE                  |
| - ADD CONSTRAINT              |                     | - UPSERT (ON CONFLICT)    |
+-------------------------------+                     +---------------------------+
```

---

## 2. Why does it exist?
1. **Schema Contracts and Type Safety**: DDL commands define the rigid structural boundaries and invariant guarantees of a database. By enforcing types (`INT`, `VARCHAR`), constraints (`CHECK`, `UNIQUE`), and referential integrity (`FOREIGN KEY`), the database acts as the ultimate gatekeeper, preventing corrupt or orphaned data regardless of application-layer bugs.
2. **Atomic Data Mutations**: DML commands execute CRUD operations with predictable ACID guarantees.
3. **The Upsert Necessity**: In distributed, event-driven, or concurrent web systems, webhooks and API payloads frequently retry upon network timeouts. Without native atomic `ON CONFLICT` semantics, two concurrent requests checking "does user exist?" will both receive "no" and both issue `INSERT`, causing a duplicate key violation crash.

---

## 3. Mental Model
Think of DDL and DML as **Building Construction vs Interior Decorating**:
- **DDL (The Architect & Builder)**: Designing and pouring the concrete foundation, erecting the load-bearing steel beams, framing the doors, and enforcing building codes (`NOT NULL`, `PRIMARY KEY`). Once the building frame is built, altering a load-bearing beam (`ALTER TABLE`) requires heavy engineering machinery.
- **DML (The Tenant & Mover)**: Moving furniture, boxes, and people in (`INSERT`), looking for items in closets (`SELECT`), painting a chair a new color (`UPDATE`), or throwing trash into the dumpster (`DELETE`).
- **TRUNCATE vs DELETE**: `DELETE` is a sanitation worker carrying out furniture piece by piece, logging each item in an inventory book. `TRUNCATE` is pressing a demolition lever that instantly vacuums all furniture out of the room in one second, resetting the room to pristine empty concrete.

---

## 4. Basic Example
DDL table creation with rich constraints, followed by standard DML:

```sql
-- DDL: Create Table with Constraints
CREATE TABLE product_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku VARCHAR(64) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  price NUMERIC(10, 2) NOT NULL CHECK (price >= 0.00),
  stock_quantity INT NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- DML: Insert Record
INSERT INTO product_inventory (sku, title, price, stock_quantity)
VALUES ('SKU-LAPTOP-01', 'Developer Laptop 16GB', 1299.99, 50);

-- DML: Update Record
UPDATE product_inventory 
SET stock_quantity = stock_quantity - 1 
WHERE sku = 'SKU-LAPTOP-01';

-- DML: Delete Record
DELETE FROM product_inventory WHERE sku = 'SKU-LAPTOP-01';
```

---

## 5. Real Example: Atomic UPSERT with `RETURNING` in TypeScript
A production TypeScript repository method implementing an idempotent counter/upsert for an API rate limiter or web analytics tracking service:

```typescript
import { dbPool } from './db';

interface PageViewMetric {
  pagePath: string;
  viewCount: number;
  uniqueVisitors: number;
  lastVisitedAt: Date;
}

export class AnalyticsRepository {
  /**
   * ATOMIC UPSERT (INSERT ON CONFLICT DO UPDATE)
   * Tracks daily page views. If the record for (page_path, date) does not exist,
   * it inserts it. If it already exists, it atomically increments view_count.
   * Eliminates all race conditions without explicit transaction locks!
   */
  public static async recordPageView(
    pagePath: string, 
    visitorIp: string
  ): Promise<PageViewMetric> {
    const query = `
      INSERT INTO daily_page_metrics (
        page_path, 
        metric_date, 
        view_count, 
        last_visited_at
      )
      VALUES (
        $1, 
        CURRENT_DATE, 
        1, 
        NOW()
      )
      ON CONFLICT (page_path, metric_date) 
      DO UPDATE SET
        view_count = daily_page_metrics.view_count + 1,
        last_visited_at = EXCLUDED.last_visited_at
      RETURNING 
        page_path AS "pagePath", 
        view_count AS "viewCount", 
        last_visited_at AS "lastVisitedAt";
    `;

    const result = await dbPool.query(query, [pagePath]);
    return result.rows[0];
  }
}
```

---

## 6. Under the Hood

### 1. `TRUNCATE` vs `DELETE`: The Engine Mechanics
Why is `TRUNCATE` orders of magnitude faster than `DELETE`?
- **`DELETE FROM table;`**:
  - Operates as a row-by-row DML operation.
  - Scans the entire table, generating a separate **WAL transaction log entry** and deletion marker (`xmax`) for every single row.
  - Fires all row-level `ON DELETE` database triggers.
  - Does **not reclaim disk space** immediately; pages remain on disk filled with "dead tuples" until `VACUUM` runs.
- **`TRUNCATE TABLE table;`**:
  - Operates as a DDL structural operation.
  - Acquires an **`ACCESS EXCLUSIVE` lock** on the table.
  - Completely de-allocates the underlying disk data pages (the table's disk file is unlinked or truncated by the OS filesystem).
  - Generates minimal WAL entries (only logging the file truncation).
  - Resets all sequence generators if `RESTART IDENTITY` is appended.
  - Reclaims physical disk space immediately.

### 2. Deep Dive: `EXCLUDED` Pseudo-Table in UPSERTs
When an `INSERT ... ON CONFLICT (key) DO UPDATE` fires:
```
Incoming Tuple: { sku: 'ABC', title: 'New Name', price: 99.00 }
                       |
                       v
Database detects constraint collision on UNIQUE(sku)
                       |
                       v
Database exposes the proposed row via the special pseudo-table: 'EXCLUDED'
                       |
                       v
DO UPDATE SET 
  title = EXCLUDED.title,          -- Replaces old title with 'New Name'
  price = EXCLUDED.price,          -- Replaces old price with 99.00
  update_count = table.update_count + 1 -- References EXISTING table row!
```

---

## 7. Important Rules
1. **The Target of `ON CONFLICT` Must Have a Unique Index**: You cannot specify `ON CONFLICT (column_name)` unless `column_name` has an active `UNIQUE` constraint or unique index. Otherwise, the engine throws an error: `there is no unique or exclusion constraint matching the ON CONFLICT specification`.
2. **Never Execute `UPDATE` or `DELETE` Without a `WHERE` Clause**: Running `DELETE FROM users;` or `UPDATE users SET is_active = false;` without `WHERE` will mutate every single row in the table. Configure production databases with `sql_safe_updates = 1` or use transactions.
3. **Always Leverage `RETURNING`**: PostgreSQL allows `INSERT`, `UPDATE`, and `DELETE` queries to append `RETURNING *` or `RETURNING id, updated_at`. This avoids firing a redundant subsequent `SELECT` query to retrieve generated primary keys or computed values.

---

## 8. Common Mistakes

### 1. The Select-Then-Insert Race Condition (Anti-Pattern)
```typescript
// TERRIBLE: Vulnerable to race conditions under concurrent requests
const existingUser = await db.query('SELECT id FROM users WHERE email = $1', [email]);
if (!existingUser.rows.length) {
  // If two requests pass this check concurrently, both run INSERT, 
  // and the second one crashes with a 500 duplicate key error!
  await db.query('INSERT INTO users (email, name) VALUES ($1, $2)', [email, name]);
}

// CORRECT: Atomic Upsert handled directly by the database engine
await db.query(`
  INSERT INTO users (email, name) VALUES ($1, $2)
  ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
  RETURNING id
`, [email, name]);
```

### 2. Locking Entire Tables During DDL Migrations
Executing `ALTER TABLE users ADD COLUMN bio TEXT DEFAULT 'Hello' NOT NULL;` on older database versions. In historical PostgreSQL versions, adding a column with a volatile default rewritten the entire physical table on disk, acquiring an exclusive table lock that queued and timed out all incoming web traffic. (Modern PostgreSQL 11+ handles constant defaults instantly via catalog metadata without rewriting tables).

---

## 9. Best Practices

### 1. Schema Invariant Defense with `CHECK` Constraints
Move domain assertions into PostgreSQL's engine:
```sql
CREATE TABLE employees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name VARCHAR(64) NOT NULL,
  email VARCHAR(255) NOT NULL,
  salary NUMERIC(10, 2) NOT NULL,
  tax_rate NUMERIC(4, 2) NOT NULL,
  
  -- Defend business rules at the schema level:
  CONSTRAINT chk_salary_positive CHECK (salary > 0),
  CONSTRAINT chk_tax_range CHECK (tax_rate >= 0.00 AND tax_rate <= 1.00),
  CONSTRAINT chk_valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);
```

### 2. Multi-Row Batched Insert with `RETURNING`
Inserting 1,000 rows in one single network round-trip instead of 1,000 separate queries:
```sql
INSERT INTO tags (name) 
VALUES ('typescript'), ('react'), ('postgresql'), ('docker')
ON CONFLICT (name) DO NOTHING
RETURNING id, name;
```

---

## 10. Performance Considerations
- **`TRUNCATE` vs `DELETE`**: On a table with 10,000,000 rows, `DELETE` can take 45 seconds, write gigabytes of WAL logs, and cause replication lag. `TRUNCATE` finishes in 15 milliseconds.
- **Bulk Insert Overhead**: When inserting millions of rows (e.g., ETL or CSV imports), standard `INSERT` statements are slow due to per-statement planning overhead. Use PostgreSQL's native **`COPY` command** (`COPY my_table FROM 'data.csv' WITH CSV`), which streams raw binary or delimited data directly into table pages, bypassing SQL parsing overhead.

---

## 11. Security Considerations
- **SQL Injection in DDL**: While most developers parameterize DML (`SELECT ... WHERE id = $1`), DDL statements (like dynamically altering tables or partitioning) often cannot be parameterized using standard bind variables in client libraries. Never concatenate unsanitized user input into table or column names; use identifier escaping functions (`quote_ident()` in PL/pgSQL).

---

## 12. Alternatives
1. **Merge Statements (`MERGE INTO`)**: Added in PostgreSQL 15 and standard in SQL Server/Oracle. Provides standard ANSI syntax for combining `INSERT`, `UPDATE`, and `DELETE` into a single statement.
2. **Soft Deleting (`is_deleted = true`)**: Instead of DML `DELETE`, set a timestamp flag (`deleted_at = NOW()`). Preserves auditability at the cost of requiring index filtering on all active queries.

---

## 13. Trade-offs

| Operation | Performance | Locks Acquired | Triggers Fired | Rollback Capable? |
| :--- | :--- | :--- | :--- | :--- |
| **`DELETE`** | Slow on large tables ($O(N)$) | Row-level `X-Lock` | Fires `BEFORE/AFTER DELETE` | Yes (Fully logged in WAL) |
| **`TRUNCATE`** | Instantaneous ($O(1)$) | Table-level `ACCESS EXCLUSIVE` | Fires `TRUNCATE` statement triggers | Yes in Postgres (DDL is transactional!) |
| **`UPSERT`** | Fast (Single round-trip) | Row-level write lock | Fires insert/update triggers | Yes |

---

## 14. Real-World Usage
- **Idempotent Webhook Processors**: Stripe or GitHub webhook consumers receive duplicate event deliveries during network retries. Using `INSERT INTO webhook_events (event_id, payload) VALUES ($1, $2) ON CONFLICT (event_id) DO NOTHING RETURNING id` ensures events are processed exactly once without race conditions.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the difference between DDL and DML in SQL?**  
*Answer*: DDL (Data Definition Language) commands (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`) define and modify the structural schema, constraints, and tables of the database. DML (Data Manipulation Language) commands (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) query, insert, and mutate the actual data rows stored within those schemas.

### Conceptual
**Q: How does `TRUNCATE` differ from `DELETE FROM table;` under the hood? Can `TRUNCATE` be rolled back in PostgreSQL?**  
*Answer*: `DELETE` is a row-by-row DML operation that scans tuples, marks them deleted in MVCC (`xmax`), writes WAL logs for every row, and fires row triggers without deallocating disk pages immediately. `TRUNCATE` is a DDL operation that unlinks and truncates the underlying physical storage file on disk, clearing the table instantly with minimal WAL logging and acquiring an exclusive table lock. **Yes**, in PostgreSQL, DDL is transactional; a `TRUNCATE` executed inside a `BEGIN ... ROLLBACK` block can be safely rolled back.

### Implementation
**Q: Write a SQL UPSERT query that increments a `login_count` counter and updates `last_login_at` if a user already exists by `email`.**  
*Answer*:
```sql
INSERT INTO user_logins (email, login_count, last_login_at)
VALUES ('alice@example.com', 1, NOW())
ON CONFLICT (email) 
DO UPDATE SET
  login_count = user_logins.login_count + 1,
  last_login_at = EXCLUDED.last_login_at
RETURNING id, login_count, last_login_at;
```

### Debugging
**Q: An application issues an `INSERT ... ON CONFLICT (username) DO UPDATE` query, but PostgreSQL throws `ERROR: there is no unique or exclusion constraint matching the ON CONFLICT specification`. What is the root cause?**  
*Answer*: The `ON CONFLICT (column_name)` clause requires an underlying `UNIQUE` constraint or unique index on the specified column(s). The error indicates that `username` is neither declared as a `PRIMARY KEY` nor has a `UNIQUE` index. The fix is to add a unique constraint via `ALTER TABLE users ADD CONSTRAINT uq_users_username UNIQUE (username);`.

### Scenario
**Q: You need to insert 500,000 sensor readings into PostgreSQL every minute. Individual `INSERT` statements are causing 100% CPU usage and connection timeouts. How do you re-architect the data ingestion?**  
*Answer*:
1. Batch multiple values into a single multi-row `INSERT` statement: `INSERT INTO readings (time, val) VALUES (...), (...), (...)` in chunks of 5,000 rows.
2. Better yet, stream the raw data directly using PostgreSQL's binary **`COPY` protocol** via Node.js streams (`pg-copy-streams`), which bypasses SQL parser overhead and writes straight to memory buffer pages.
3. Drop unneeded secondary indexes during bulk ingestion and recreate them afterward if doing initial seed loading.

### Advanced
**Q: What is the purpose of the `EXCLUDED` pseudo-table in PostgreSQL's `INSERT ... ON CONFLICT` statement, and how does it differ from referencing the target table name?**  
*Answer*: The `EXCLUDED` pseudo-table represents the **proposed row** that was passed into the `INSERT VALUES` clause and caused the constraint conflict. Referencing the target table name refers to the **existing row** currently stored in the database. For example, in `SET view_count = metrics.view_count + EXCLUDED.view_count`, `metrics.view_count` is the old value currently on disk, and `EXCLUDED.view_count` is the newly incoming increment value proposed in the `INSERT` statement.

---

## 16. Coding Questions

### Problem 1: Safe Bulk Upsert with Complex Conflict Handling
Write a clean PostgreSQL query that bulk-inserts multiple product price updates, keeping the lower price if a product already exists.

```sql
INSERT INTO product_discounts (product_sku, discount_price, expires_at)
VALUES 
  ('SKU-A', 49.99, NOW() + INTERVAL '2 days'),
  ('SKU-B', 89.99, NOW() + INTERVAL '5 days'),
  ('SKU-C', 19.99, NOW() + INTERVAL '1 day')
ON CONFLICT (product_sku) 
DO UPDATE SET
  -- Only update price if the incoming discount price is cheaper than existing!
  discount_price = LEAST(product_discounts.discount_price, EXCLUDED.discount_price),
  expires_at = GREATEST(product_discounts.expires_at, EXCLUDED.expires_at)
RETURNING product_sku, discount_price, expires_at;
```

---

## 17. Common Interview Traps
- **Trap 1**: Assuming DDL cannot be rolled back. In MySQL and Oracle, DDL statements issue an implicit commit, making rollback impossible. In **PostgreSQL**, DDL is fully transactional (`CREATE TABLE`, `ALTER TABLE`, and `TRUNCATE` can be safely rolled back inside a transaction).
- **Trap 2**: Believing `ON CONFLICT DO NOTHING` returns the existing row. If a conflict occurs and `DO NOTHING` is triggered, PostgreSQL does not insert anything and returns **zero rows** in the `RETURNING` clause.
- **Trap 3**: Believing `DELETE` resets auto-increment sequences. Deleting all rows from a table leaves sequence generators at their current high-water mark. Only `TRUNCATE TABLE tbl RESTART IDENTITY;` resets the sequence back to 1.

---

## 18. Revision Summary
- **DDL**: Defines schema, structure, tables, and constraints (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`).
- **DML**: Manipulates data records (`SELECT`, `INSERT`, `UPDATE`, `DELETE`).
- **`TRUNCATE`**: Fast DDL operation deallocating table disk pages; orders of magnitude faster than row-by-row `DELETE`.
- **UPSERT**: `INSERT ... ON CONFLICT (key) DO UPDATE` provides atomic, race-condition-free insert-or-update mechanics.
- **`EXCLUDED`**: Special keyword representing incoming rejected tuple values during an upsert collision.
- Always append `RETURNING` to DML operations in modern web APIs to avoid unnecessary follow-up queries.

---

## 19. Quick Reference

| Command | Category | Transactional in Postgres? | Reclaims Disk Space Immediately? |
| :--- | :--- | :--- | :--- |
| **`CREATE / ALTER TABLE`** | DDL | Yes | N/A |
| **`DROP TABLE`** | DDL | Yes | Yes |
| **`TRUNCATE TABLE`** | DDL | Yes | Yes |
| **`DELETE FROM`** | DML | Yes | No (Requires `VACUUM` to reclaim) |
| **`INSERT ... ON CONFLICT`** | DML | Yes | N/A (Atomic Upsert) |
| **`RETURNING *`** | DML Clause | Yes | Yields mutated rows without extra query |
