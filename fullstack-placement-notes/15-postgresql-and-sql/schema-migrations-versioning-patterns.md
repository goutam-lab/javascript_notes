# Schema Migrations and Versioning Patterns

## 1. What is it?
**Database Schema Migration** is the engineering practice of applying version-controlled, incremental, programmatic changes to a relational database schema over time. 

Rather than executing manual, unrecorded ad-hoc SQL commands against a production database, migrations treat database DDL as first-class source code. Schema changes are stored as sequential timestamped files in version control (Git), tracked by a dedicated database catalog table (e.g., `_prisma_migrations`, `flyway_schema_history`, or `schema_migrations`), and applied automatically during deployment pipelines.

**Zero-Downtime Migration Patterns** (such as the **Expand and Contract Pattern**) ensure that schema changes (e.g., renaming a column or changing a data type) never break running instances of older backend application code during rolling deployments.

```
Migration Execution Workflow:
Git Repository: [001_create_users.sql] ---> [002_add_phone_to_users.sql] ---> [003_index_phone.sql]
                                                      |
                                                      v
Deployment Pipeline: Checks Database Tracking Table: [schema_migrations]
                     - 001 already executed: SKIPPED
                     - 002 already executed: SKIPPED
                     - 003 not found: EXECUTED INSIDE TRANSACTION!
                     - Writes checksum & timestamp of 003 to [schema_migrations]
```

---

## 2. Why does it exist?
1. **The Inevitability of Schema Drift**: Without automated migrations, staging, development, and production databases inevitably drift apart. An engineer tests code against a column manually added to staging, but the production deployment crashes because the column does not exist in production.
2. **Deterministic Rollbacks**: If a software release fails, versioned down-migrations allow the team to systematically revert the database structure to the previous stable release.
3. **Multi-Instance and CI/CD Automation**: When 50 developer containers, automated GitHub Actions test runners, and production clusters spin up, they must be able to bootstrap the exact same database state automatically from scratch via `migrate deploy`.
4. **Preventing Production Outages from Table Locks**: Naive migrations (like adding a `NOT NULL` column with a volatile default or building an index without `CONCURRENTLY`) acquire exclusive table locks that lock out all user traffic.

---

## 3. Mental Model
Think of Migrations as **Git Commits for Database Architecture**:
- Each migration file is a single Git commit describing a discrete schema evolution.
- The `schema_migrations` tracking table is the `HEAD` pointer, tracking which commits have been applied to this specific physical database.
- **The Expand and Contract Pattern**: If you want to rename a room in a busy hotel from "Dining Hall" to "Grand Ballroom", you do not tear down the signs while guests are walking in. First, you hang both signs side-by-side (Expand). You wait until all invitations and guests adapt to the new name. Finally, weeks later, you take down the old sign (Contract).

---

## 4. Basic Example
A standard Up/Down SQL migration pair:

```sql
-- Migration: 20260301120000_add_phone_number_to_users.up.sql
ALTER TABLE users 
ADD COLUMN phone_number VARCHAR(32) NULL;

-- Create index concurrently without locking writes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_phone 
ON users (phone_number);

-- Down Migration: 20260301120000_add_phone_number_to_users.down.sql
DROP INDEX CONCURRENTLY IF EXISTS idx_users_phone;

ALTER TABLE users 
DROP COLUMN IF EXISTS phone_number;
```

---

## 5. Real Example: The Expand and Contract Pattern (Zero-Downtime Column Renaming)
A step-by-step production pattern renaming a column from `full_name` to `display_name` on a 50-million-row production table without taking the service offline:

```typescript
/**
 * SCENARIO: Renaming 'full_name' to 'display_name' on table 'users'.
 * A direct 'ALTER TABLE users RENAME COLUMN full_name TO display_name;'
 * will instantly crash all active server pods currently running older code!
 * 
 * THE 4-PHASE ZERO-DOWNTIME EXPAND & CONTRACT PROCESS:
 */

// PHASE 1: EXPAND (Database Migration 1)
// Add the new column as nullable; do not remove the old column yet!
export const migrationPhase1Sql = `
  ALTER TABLE users ADD COLUMN display_name VARCHAR(255) NULL;
  
  -- Trigger to synchronize writes during deployment transition
  CREATE OR REPLACE FUNCTION sync_user_names()
  RETURNS TRIGGER AS $$
  BEGIN
    NEW.display_name = COALESCE(NEW.display_name, NEW.full_name);
    NEW.full_name = COALESCE(NEW.full_name, NEW.display_name);
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER trg_sync_user_names
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION sync_user_names();
`;

// PHASE 2: BACKFILL (Asynchronous Background Worker)
// Backfill historical rows in small batches to avoid lock contention
export async function backfillHistoricalNames(db: any) {
  let updatedRows = 0;
  do {
    const res = await db.query(`
      WITH batch AS (
        SELECT id FROM users 
        WHERE display_name IS NULL AND full_name IS NOT NULL 
        LIMIT 1000 FOR UPDATE SKIP LOCKED
      )
      UPDATE users u
      SET display_name = u.full_name
      FROM batch
      WHERE u.id = batch.id;
    `);
    updatedRows = res.rowCount;
    // Sleep 100ms between batches to allow normal traffic priority
    await new Promise(r => setTimeout(r, 100));
  } while (updatedRows > 0);
}

// PHASE 3: APPLICATION UPDATE
// Deploy backend code that reads from 'display_name' and writes to both.
// Verify all pods have transitioned to the new version.

// PHASE 4: CONTRACT (Database Migration 2)
// Once 100% of traffic is on the new code, drop legacy column and trigger:
export const migrationPhase4Sql = `
  DROP TRIGGER IF EXISTS trg_sync_user_names ON users;
  DROP FUNCTION IF EXISTS sync_user_names();
  
  -- Enforce NOT NULL on the new column if required
  ALTER TABLE users ALTER COLUMN display_name SET NOT NULL;
  
  -- Drop the legacy column
  ALTER TABLE users DROP COLUMN full_name;
`;
```

---

## 6. Under the Hood

### 1. Lock Hierarchy During Migrations
The primary risk of running migrations in production is acquiring an **`ACCESS EXCLUSIVE`** lock:
- `ALTER TABLE users ADD COLUMN ...` acquires an `ACCESS EXCLUSIVE` lock.
- While holding this lock, **no other transaction can read or write** to the table.
- If a long-running read query (e.g., an export job) is active on `users`, the `ALTER TABLE` statement must wait.
- **The Lock Queue Stampede**: In PostgreSQL, lock requests form a strict FIFO queue. If `ALTER TABLE` waits for a read to finish, **every subsequent read and write request from incoming web requests queues behind the `ALTER TABLE`**, exhausting the web server connection pool in seconds.

### 2. How Migration Tools Work Under the Hood
Tools like Prisma, Flyway, and Golang-Migrate maintain a tracking table:
```sql
CREATE TABLE schema_migrations (
  version VARCHAR(255) PRIMARY KEY,
  checksum VARCHAR(64) NOT NULL, -- SHA256 of the migration file
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  execution_time_ms INT NOT NULL
);
```
- When `migrate deploy` runs:
  1. The CLI acquires a PostgreSQL **Advisory Lock** to prevent concurrent CI/CD pipelines from migrating simultaneously.
  2. It reads the local migration folder and compares file checksums against `schema_migrations`.
  3. If an existing migration file has been modified locally, it halts with a **Checksum Mismatch Error** to prevent schema corruption.
  4. Unapplied migrations are executed inside a transactional block (`BEGIN ... COMMIT`).
  5. The advisory lock is released.

---

## 7. Important Rules
1. **Never Change an Already-Committed Migration File**: Once a migration file has been merged into main or executed on staging, its contents must be treated as immutable. If a fix is needed, generate a **new forward migration**. Modifying past migrations breaks checksum validation in CI/CD.
2. **Always Create Indexes `CONCURRENTLY`**:
   - `CREATE INDEX` acquires a `SHARE` lock that blocks writes to the table.
   - `CREATE INDEX CONCURRENTLY` builds the index in two passes without blocking writes.
   - Note: `CREATE INDEX CONCURRENTLY` cannot run inside a multi-statement transaction block.
3. **Always Set `lock_timeout` in Migration Scripts**:
   ```sql
   SET lock_timeout = '3000ms';
   ```
   If a migration cannot acquire its table lock within 3 seconds, it fails immediately instead of queuing and blocking application traffic.
4. **Never Add a Column with a Volatile Default and `NOT NULL` in Older Engines**:
   - In modern PostgreSQL (11+), `ADD COLUMN col INT DEFAULT 0 NOT NULL` is instant (metadata update).
   - In older engines or with volatile functions (`DEFAULT random()`), this rewrites the entire table on disk.

---

## 8. Common Mistakes

### 1. The Rollout Race Condition (Deploying Code Before DB)
Deploying new backend application pods that query `SELECT company_id FROM users;` *before* the database migration adding `company_id` has completed. The new pods immediately crash with column missing errors. (Always apply backward-compatible DB migrations *before* deploying application code).

### 2. Storing Non-Idempotent Migrations
Writing migration scripts that fail if re-executed after a partial network failure. Use defensive guards:
```sql
CREATE TABLE IF NOT EXISTS ...
ALTER TABLE users ADD COLUMN IF NOT EXISTS ...
DROP INDEX IF EXISTS ...
```

---

## 9. Best Practices

### 1. Safe Non-Null Column Addition Pattern
Adding a `NOT NULL` column to a 100-million row table safely in PostgreSQL:
```sql
-- Step 1: Add column as NULLABLE (Fast metadata update, 0ms lock)
ALTER TABLE orders ADD COLUMN tracking_code VARCHAR(64) NULL;

-- Step 2: Validate column with a NOT VALID check constraint
ALTER TABLE orders ADD CONSTRAINT chk_tracking_not_null 
  CHECK (tracking_code IS NOT NULL) NOT VALID;

-- Step 3: Validate the constraint asynchronously without holding an exclusive lock!
ALTER TABLE orders VALIDATE CONSTRAINT chk_tracking_not_null;
```

---

## 10. Performance Considerations
- **Table Rewrites**: Check the PostgreSQL documentation to verify whether an `ALTER TABLE` statement causes a full physical table rewrite on disk. Changing a column type from `INT` to `BIGINT` rewrites every page on disk; changing `VARCHAR(32)` to `VARCHAR(64)` is a metadata-only catalog update.
- **Batch Backfilling**: When backfilling millions of rows, always batch updates in chunks of 1,000–5,000 rows with a sleep interval to prevent transaction log (WAL) saturation and excessive replication lag on read replicas.

---

## 11. Security Considerations
- **Migration Execution Permissions**: Migration pipelines should run with an administrative DDL database role, while normal application web servers should connect with a restricted DML role (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) that lacks `ALTER TABLE` or `DROP TABLE` privileges.

---

## 12. Alternatives
1. **Declarative Migration Tools (Atlas, Prisma db push)**: Compute diffs between a target schema definition and the active database automatically, rather than maintaining sequential migration files manually.
2. **Online Schema Change Tools (gh-ost / pt-online-schema-change)**: Primarily used in MySQL; creates a ghost shadow table, streams changes via binlogs, and performs an atomic table swap.
3. **NoSQL / Schema-less Databases**: Rely entirely on application-layer versioning and dynamic fallback properties.

---

## 13. Trade-offs

| Strategy | Deployment Safety | Implementation Effort | Downtime Risk |
| :--- | :--- | :--- | :--- |
| **Direct Destructive Migration** (`DROP COLUMN`) | Zero | Low | High (Crashes active pods) |
| **Expand & Contract Pattern** | Absolute | High (Requires 2-3 releases) | Zero |
| **Online Migration (Atlas / gh-ost)**| High | Moderate | Low |

---

## 14. Real-World Usage
- **Stripe & GitHub**: Deploy database schema evolutions hundreds of times per week with zero downtime using the Expand-and-Contract methodology and automated lock-timeout safeguards.

---

## 15. Placement Interview Questions

### Basic
**Q: What is a database schema migration, and why is it preferred over running manual SQL scripts?**  
*Answer*: A schema migration is a version-controlled, automated, and repeatable script that updates a database structure. It is preferred because it eliminates schema drift across development, staging, and production environments, allows automated execution in CI/CD pipelines, tracks execution history in a metadata table, and enables deterministic rollbacks.

### Conceptual
**Q: Explain the "Expand and Contract" pattern for zero-downtime database migrations.**  
*Answer*: The Expand and Contract pattern decouples destructive schema changes into multiple backward-compatible phases:
1. **Expand**: Add the new column/table alongside the old structure without removing the old one, keeping both backward and forward compatible.
2. **Migrate/Backfill**: Deploy application code that writes to both structures and run background workers to backfill legacy data.
3. **Switch**: Deploy code that reads exclusively from the new structure.
4. **Contract**: Once all active application instances are using the new structure, remove the old column/table in a final cleanup migration.

### Implementation
**Q: Why should you use `CREATE INDEX CONCURRENTLY` in production PostgreSQL, and what limitation does it impose on transactions?**  
*Answer*: Standard `CREATE INDEX` acquires an exclusive `SHARE` lock on the table, which blocks all concurrent `INSERT`, `UPDATE`, and `DELETE` operations until the entire index build finishes. `CREATE INDEX CONCURRENTLY` builds the index in multiple passes without blocking write operations. Its primary limitation is that it **cannot run inside a multi-statement transaction block** (`BEGIN ... COMMIT`); it must execute as a standalone command.

### Debugging
**Q: A migration attempting `ALTER TABLE users ADD COLUMN age INT;` causes all API endpoints to time out with connection pool exhaustion. What happened under the hood?**  
*Answer*: The `ALTER TABLE` statement requested an `ACCESS EXCLUSIVE` lock on the `users` table. A slow-running query was already reading the table, forcing `ALTER TABLE` to wait in the lock queue. Because PostgreSQL uses a FIFO lock queue, all subsequent incoming read and write queries from the web API queued behind the `ALTER TABLE` request, locking the entire table and consuming all available connection pool slots.

### Scenario
**Q: You need to rename a column in a table with 200 million rows in an active production system. Describe the deployment steps.**  
*Answer*:
1. Do not use `ALTER TABLE RENAME COLUMN` directly, as it immediately breaks running application pods.
2. Migration 1: Add the new column as nullable (`ADD COLUMN new_col NULL;`).
3. Deploy App Version 1: Code writes to both `old_col` and `new_col`, but reads from `old_col`.
4. Asynchronously backfill historical rows in small batches using a script with `SKIP LOCKED`.
5. Deploy App Version 2: Code reads from `new_col` and writes to `new_col`.
6. Migration 2: Drop `old_col` (`ALTER TABLE DROP COLUMN old_col;`).

### Advanced
**Q: How do migration tools prevent race conditions when two CI/CD pipeline workers attempt to apply database migrations at the exact same second?**  
*Answer*: Migration frameworks (like Flyway, Liquibase, and Prisma) acquire a **distributed lock** on the database before reading or executing migrations. In PostgreSQL, they execute a transaction or session-level **Advisory Lock** (e.g., `pg_advisory_lock(unique_migration_hash)`). The second pipeline worker fails to acquire the lock and either waits or terminates immediately, guaranteeing single-threaded, sequential schema migration execution.

---

## 16. Coding Questions

### Problem 1: Writing a Safe Batch Backfill Script in Node.js
Write a batch updater that updates 1,000,000 rows without holding long-lived locks or exhausting database memory.

```typescript
import { dbPool } from './db';

export async function safeBatchUpdate(batchSize: number = 1000): Promise<void> {
  let totalUpdated = 0;
  let hasMore = true;

  console.log('Starting safe background backfill...');

  while (hasMore) {
    const client = await dbPool.connect();
    try {
      // Update small slice using a CTE with LIMIT
      const res = await client.query(`
        WITH target_batch AS (
          SELECT id 
          FROM customer_accounts 
          WHERE status_code IS NULL 
          LIMIT $1
        )
        UPDATE customer_accounts ca
        SET status_code = 'ACTIVE', updated_at = NOW()
        FROM target_batch
        WHERE ca.id = target_batch.id;
      `, [batchSize]);

      const count = res.rowCount || 0;
      totalUpdated += count;
      console.log(`Backfilled ${count} rows (Total: ${totalUpdated})`);

      if (count < batchSize) {
        hasMore = false;
      }

      // Crucial: Sleep 50ms to yield CPU and disk I/O to live user traffic
      await new Promise(r => setTimeout(r, 50));
    } finally {
      client.release();
    }
  }

  console.log('Safe backfill successfully completed.');
}
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking migrations can always be cleanly rolled back. Destructive migrations (e.g., `DROP TABLE`) destroy physical data. A "down" migration can recreate the empty table structure, but the data is lost unless restored from a backup.
- **Trap 2**: Believing `ALTER TABLE ... DEFAULT` always locks tables in modern PostgreSQL. Starting with PostgreSQL 11, adding a column with a constant default does not rewrite the table; it records the default in the system catalog, taking 0 milliseconds.
- **Trap 3**: Forgetting about Read Replicas. Heavy migrations that generate massive WAL logs can cause severe replication lag on read replicas, causing read-after-write inconsistencies.

---

## 18. Revision Summary
- Migrations version-control database structure and eliminate staging-to-production schema drift.
- Never edit a committed migration file; generate forward migrations instead.
- Use `CREATE INDEX CONCURRENTLY` in production to prevent write lockouts.
- Set `lock_timeout` in migration scripts to prevent queue stampedes.
- Use the **Expand and Contract pattern** to rename columns or alter types with zero downtime.
- Backfill historical data in small, rate-limited batches using `LIMIT` and sleep intervals.

---

## 19. Quick Reference

| Operation | Risk Level | Zero-Downtime Safe Pattern |
| :--- | :--- | :--- |
| **`ADD COLUMN (Nullable)`** | Low (0ms lock) | Direct execution |
| **`ADD COLUMN NOT NULL (Default)`** | Safe in PG 11+ | Direct execution (if constant default) |
| **`CREATE INDEX`** | High (Blocks writes) | Use `CREATE INDEX CONCURRENTLY` |
| **`RENAME COLUMN`** | Critical (Breaks app) | Expand and Contract (Add new, sync, drop old) |
| **`DROP COLUMN`** | Critical | Contract phase after all code stops reading |
| **`SET lock_timeout`** | Best Practice | Set `SET lock_timeout = '2s'` before DDL |
