# Transactions, Savepoints, Rollbacks, and Locking

## 1. What is it?
In PostgreSQL, a **Transaction** is a sequence of database operations executed as a single, atomic unit of work bounded by **`BEGIN`** and **`COMMIT`** (or **`ROLLBACK`**). 

A **Savepoint** is an intermediate checkpoint established inside an active transaction using the **`SAVEPOINT name`** command. It allows partial rollbacks (`ROLLBACK TO SAVEPOINT name`) of subsequent failing operations without aborting the entire parent transaction.

**Database Locking** is the concurrency control mechanism that coordinates access to shared data structures, preventing simultaneous transactions from corrupting rows or schemas. PostgreSQL implements a rich locking hierarchy:
- **Row-Level Locks**: `FOR UPDATE` (exclusive lock), `FOR NO KEY UPDATE`, `FOR SHARE`, `FOR KEY SHARE`.
- **Table-Level Locks**: `ACCESS SHARE` (reads), `ROW EXCLUSIVE` (writes), `ACCESS EXCLUSIVE` (schema alterations).
- **Advisory Locks**: Application-defined distributed mutexes managed entirely in PostgreSQL memory.

```
Transaction Boundary with Savepoints:
BEGIN;
  INSERT INTO orders ...;                   <--- Operation 1 (Active)
  
  SAVEPOINT payment_attempt;                <--- Savepoint Marker Created
    UPDATE wallet SET balance = ...;        <--- Operation 2 (Throws insufficient funds error!)
  ROLLBACK TO SAVEPOINT payment_attempt;    <--- Operation 2 is undone; Operation 1 is PRESERVED!
  
  UPDATE orders SET status = 'PAYMENT_FAILED'; <--- Operation 3
COMMIT;                                     <--- Successfully commits Ops 1 & 3!
```

---

## 2. Why does it exist?
1. **Error Recovery without Catastrophic Abort**: In PostgreSQL, if any statement inside a transaction throws an error (e.g., unique key violation or division by zero), PostgreSQL marks the entire transaction as **`ABORTED`** (`current transaction is aborted, commands ignored until end of transaction block`). Without Savepoints, the application has no choice but to throw away all previous work. Savepoints allow code to catch errors and recover gracefully.
2. **Preventing Race Conditions via Explicit Locking**: In high-concurrency systems (ticket booking, flash sales, inventory allocations), optimistic checks fail under load. Explicit row locking (`SELECT ... FOR UPDATE`) guarantees serialized access to contested resources.
3. **Application-Level Mutexes without Redis**: Backend clusters often need distributed locks to ensure only one worker executes a recurring cron task. PostgreSQL **Advisory Locks** provide instantaneous, cluster-wide distributed locking without requiring a separate Redis cluster.

---

## 3. Mental Model
Think of Transactions and Savepoints as **Playing a Video Game with Quick-Saves**:
- **`BEGIN`**: You start a challenging boss level.
- **Normal Gameplay**: You defeat the first mini-boss and collect gold (mutations).
- **`SAVEPOINT checkpoint_1`**: You reach a safe room and press "Quick-Save."
- **Failed Exploration**: You open a cursed treasure chest that triggers a death trap (SQL constraint error).
- **`ROLLBACK TO SAVEPOINT checkpoint_1`**: Instead of restarting the entire game from level 1 (`ROLLBACK`), you respawn right at the safe room door with your previous mini-boss gold intact! You decide to walk past the cursed chest and complete the level (`COMMIT`).

---

## 4. Basic Example
Using Savepoints and Pessimistic Row Locking in SQL:

```sql
-- 1. Explicit Transaction with Pessimistic Lock
BEGIN;

-- Lock specific row exclusively; other transactions attempting FOR UPDATE will wait
SELECT stock FROM inventory WHERE product_id = 'PROD-001' FOR UPDATE;

-- Update locked row
UPDATE inventory SET stock = stock - 1 WHERE product_id = 'PROD-001';

-- 2. Create Savepoint
SAVEPOINT log_checkpoint;

-- Attempt an optional audit log insert
INSERT INTO audit_logs (event) VALUES ('DEDUCTED_STOCK');

-- If audit log fails or is unwanted:
-- ROLLBACK TO SAVEPOINT log_checkpoint;

-- Release savepoint memory if successful:
RELEASE SAVEPOINT log_checkpoint;

-- Finalize all mutations
COMMIT;
```

---

## 5. Real Example: Advisory Locking for Distributed Cron Workers in TypeScript
A production TypeScript worker using PostgreSQL Advisory Locks to guarantee that a background billing cron runs on only **one server instance** across a 10-pod Kubernetes cluster:

```typescript
import { dbPool } from './db';

export class DistributedJobRunner {
  // A deterministic 64-bit integer representing the unique job key
  private static readonly BILLING_CRON_LOCK_ID = 8829103948123;

  /**
   * EXECUTE EXCLUSIVE DISTRIBUTED TASK
   * Uses pg_try_advisory_lock to acquire a non-blocking mutex in PostgreSQL shared memory.
   */
  public static async runNightlyBillingJob(): Promise<void> {
    const client = await dbPool.connect();

    try {
      // 1. Attempt to acquire non-blocking session-level advisory lock
      // Returns true if lock was acquired, false if another pod already holds it
      const lockRes = await client.query(
        'SELECT pg_try_advisory_lock($1) AS acquired',
        [this.BILLING_CRON_LOCK_ID]
      );

      const hasLock = lockRes.rows[0].acquired;

      if (!hasLock) {
        console.log('[Worker] Another pod is currently running the nightly billing job. Exiting gracefully.');
        return;
      }

      console.log('[Worker] Lock acquired. Executing nightly billing pipeline...');
      
      // 2. Perform the critical business work
      await this.processAllPendingInvoices(client);

      console.log('[Worker] Billing job completed successfully.');
    } catch (error) {
      console.error('[Worker] Fatal error during billing job execution', error);
      throw error;
    } finally {
      // 3. MANDATORY: Explicitly release advisory lock
      try {
        await client.query(
          'SELECT pg_advisory_unlock($1)',
          [this.BILLING_CRON_LOCK_ID]
        );
      } catch (unlockErr) {
        console.error('[Worker] Failed to unlock advisory lock', unlockErr);
      }
      client.release();
    }
  }

  private static async processAllPendingInvoices(client: any): Promise<void> {
    // Simulating invoice processing
    await client.query('UPDATE invoices SET status = \'PROCESSED\' WHERE status = \'PENDING\'');
  }
}
```

---

## 6. Under the Hood

### 1. PostgreSQL Error State and the "Aborted Transaction" Rule
In many databases (like MySQL), if statement 2 of 3 fails, the connection can proceed to execute statement 3. 
**PostgreSQL is fundamentally different**:
- When an error occurs inside a PostgreSQL transaction, the internal transaction state machine immediately switches to **`TRANS_ABORT`**.
- Any subsequent SQL command sent on that connection (other than `ROLLBACK` or `ROLLBACK TO SAVEPOINT`) will be rejected by the server with:
  `ERROR: current transaction is aborted, commands ignored until end of transaction block`.
- **How Savepoints Fix This**: When you issue `SAVEPOINT foo`, PostgreSQL pushes a subtransaction record onto an internal subtransaction stack. When an error occurs, issuing `ROLLBACK TO SAVEPOINT foo` pops the failing commands off the undo log and clears the `TRANS_ABORT` flag, restoring the transaction to the valid `TRANS_IN_PROGRESS` state!

### 2. Lock Modes and Compatibility Matrix
PostgreSQL uses an 8-level table locking hierarchy. If two lock modes conflict, the second transaction is placed in a sleep queue until the first transaction commits or rolls back:

```
Table Lock Conflict Matrix (Simplified for Core Modes):

Requested Lock Mode    | ACCESS SHARE | ROW EXCLUSIVE | ACCESS EXCLUSIVE
-----------------------+--------------+---------------+------------------
ACCESS SHARE (SELECT)  |   CONFLICT   |   COMPATIBLE  |     CONFLICT     
ROW EXCLUSIVE (UPDATE) |  COMPATIBLE  |   COMPATIBLE  |     CONFLICT     
ACCESS EXCLUSIVE (DDL) |   CONFLICT   |    CONFLICT   |     CONFLICT     
```

- **Row-Level Lock Types**:
  - **`FOR UPDATE`**: Exclusive row lock. Blocks concurrent `FOR UPDATE`, `FOR SHARE`, `UPDATE`, and `DELETE`.
  - **`FOR NO KEY UPDATE`**: Weaker exclusive lock. Used when updating columns that are **not** part of a unique index/primary key. Does not block `FOR KEY SHARE`.
  - **`FOR SHARE`**: Shared read lock. Allows concurrent readers, blocks concurrent writers.
  - **`FOR KEY SHARE`**: Weakest read lock (used internally by foreign key checks). Allows concurrent `UPDATE` on non-key columns.

---

## 7. Important Rules
1. **Always Acquire Locks in a Uniform Global Order**: If Transaction 1 locks Account A then Account B, while Transaction 2 locks Account B then Account A, PostgreSQL detects a **Deadlock** and abruptly terminates one of the transactions with error code `40P01`. Always sort IDs before locking:
   ```typescript
   const [firstId, secondId] = [idA, idB].sort();
   ```
2. **Use `SKIP LOCKED` for Message Queues**: When building job queues in SQL, never use plain `FOR UPDATE` (which serializes all workers). Use `FOR UPDATE SKIP LOCKED`. Workers skip rows already locked by other threads, achieving full parallel worker throughput.
3. **Never Keep Transactions Open Across Network Waits**: A transaction holding locks must never await third-party HTTP calls.

---

## 8. Common Mistakes

### 1. Subtransaction Memory Exhaustion (Savepoint Explosion)
Creating thousands of savepoints inside a single loop (`for (const item of 10000Items) { SAVEPOINT s; ... }`). In PostgreSQL, each subtransaction consumes a slot in shared memory (`pg_subtrans`). When subtransactions exceed 64, PostgreSQL drops hardware cache acceleration and falls back to expensive disk lookups for visibility checks, degrading entire database performance.

### 2. Lock Escalation Myths
Unlike Microsoft SQL Server (which escalates thousands of row locks into a full table lock when memory runs low), **PostgreSQL never escalates row locks to table locks**. Row locks are stored directly in tuple headers on disk pages, not in a fixed-size memory table.

---

## 9. Best Practices

### 1. The High-Throughput Job Queue Pattern (`SKIP LOCKED`)
Building a rock-solid background job processor directly in PostgreSQL:

```sql
-- Atomically claim 5 pending jobs without blocking other concurrent workers:
WITH claimed_jobs AS (
  SELECT id 
  FROM task_queue
  WHERE status = 'PENDING'
  ORDER BY priority DESC, created_at ASC
  LIMIT 5
  FOR UPDATE SKIP LOCKED -- Key feature: Skips rows locked by competing worker pods!
)
UPDATE task_queue
SET status = 'PROCESSING', locked_at = NOW()
WHERE id IN (SELECT id FROM claimed_jobs)
RETURNING id, task_payload;
```

### 2. Deadlock Timeout Configuration
Configure PostgreSQL's `deadlock_timeout` (default 1000ms). If a transaction waits more than 1 second on a lock, PostgreSQL awakens the deadlock detection engine to inspect the lock dependency graph.

---

## 10. Performance Considerations
- **Lock Contention**: Check `pg_locks` and `pg_stat_activity` where `wait_event_type = 'Lock'`. Long lock waits indicate uncommitted transactions or improper lock ordering.
- **Savepoint Cleanup**: Always run `RELEASE SAVEPOINT name` when a subtransaction block succeeds to free internal transaction memory structures.

---

## 11. Security Considerations
- **Denial of Service via Unbounded Table Locks**: Running `ALTER TABLE big_table ADD COLUMN col INT;` acquires an `ACCESS EXCLUSIVE` lock. If a long-running reporting query is currently reading the table, the `ALTER TABLE` queues behind it, and **all subsequent read queries queue behind the `ALTER TABLE`**, instantly bringing down the production application. Always set `lock_timeout`:
  ```sql
  SET lock_timeout = '2000ms';
  ALTER TABLE big_table ADD COLUMN col INT;
  ```

---

## 12. Alternatives
1. **Optimistic Concurrency Control (OCC)**: Using a `version INT` column (`WHERE id = $1 AND version = $2`). Eliminates database locks entirely; best for low-contention environments.
2. **Redis Redlock**: Distributed locking coordinated outside the database. (Advisory locks are generally preferred if PostgreSQL is already your source of truth).

---

## 13. Trade-offs

| Lock Type | Concurrency Impact | Deadlock Risk | Implementation Complexity |
| :--- | :--- | :--- | :--- |
| **Optimistic Locking (`version`)**| Zero blocking | None | Requires application retry loops |
| **Pessimistic Locking (`FOR UPDATE`)**| Blocks competing transactions | High if ordering is inconsistent | Simple SQL clause |
| **`FOR UPDATE SKIP LOCKED`** | Extremely High (Workers don't wait)| Zero (Skips locked rows) | Ideal for queue consumers |
| **Advisory Locks** | Application controlled | Low if released properly | Zero disk/tuple overhead |

---

## 14. Real-World Usage
- **Ticketmaster / Airline Booking**: When a customer clicks "Reserve Seat 14B," the reservation service issues `SELECT ... FOR UPDATE` on seat 14B with a 10-minute hold timestamp, preventing double booking.
- **BullMQ / Celery Alternative**: Many startups use PostgreSQL `FOR UPDATE SKIP LOCKED` to process millions of background jobs daily without needing RabbitMQ or Redis.

---

## 15. Placement Interview Questions

### Basic
**Q: What is a Savepoint in a database transaction, and why is it useful?**  
*Answer*: A Savepoint is an intermediate checkpoint inside an active transaction. It allows an application to selectively roll back failing statements (`ROLLBACK TO SAVEPOINT name`) without aborting the entire parent transaction, enabling granular error recovery.

### Conceptual
**Q: What causes a Deadlock in SQL, and how does PostgreSQL resolve it?**  
*Answer*: A deadlock occurs when two or more transactions hold locks on separate resources and each transaction attempts to acquire a lock on the resource held by the other (a circular wait condition: T1 holds Lock A, wants Lock B; T2 holds Lock B, wants Lock A). Neither transaction can proceed. PostgreSQL resolves this using a background deadlock detector that awakens after `deadlock_timeout` (default 1s), detects the cycle in the lock graph, and aborts one of the transactions with error code `40P01` (`deadlock_detected`), allowing the other to complete.

### Implementation
**Q: How do you build a concurrent worker queue in PostgreSQL so that 10 workers do not process the same task or block each other?**  
*Answer*: Use `SELECT ... FOR UPDATE SKIP LOCKED`:
```sql
SELECT id, payload FROM jobs 
WHERE status = 'QUEUED' 
LIMIT 1 
FOR UPDATE SKIP LOCKED;
```
This locks the selected job for the active worker while instructing competing workers to immediately skip that row and pick the next available job without blocking or waiting.

### Debugging
**Q: An Express API returns `ERROR: current transaction is aborted, commands ignored until end of transaction block`. What caused this error, and how do you fix it?**  
*Answer*: A previous SQL statement inside that active transaction failed (e.g., a constraint check, syntax error, or duplicate key), putting PostgreSQL into the `TRANS_ABORT` state. Subsequent statements are blocked until the transaction ends. To fix it:
1. Fix the initial failing query.
2. If the error is expected and recoverable, wrap the dangerous query with a `SAVEPOINT` before execution and issue `ROLLBACK TO SAVEPOINT` if an error occurs.
3. Always issue `ROLLBACK` in the error handler before returning the client connection to the pool.

### Scenario
**Q: What is the difference between `FOR UPDATE` and `FOR NO KEY UPDATE` in PostgreSQL, and why is `FOR NO KEY UPDATE` better for foreign key performance?**  
*Answer*: 
- `FOR UPDATE` acquires a strong exclusive lock on the row, blocking all concurrent updates and any concurrent queries attempting `FOR KEY SHARE`.
- `FOR NO KEY UPDATE` locks the row for mutation, but signals that the row's primary key or unique key columns will **not** be modified. This allows concurrent transactions to insert child records referencing this row's foreign key (`FOR KEY SHARE`), significantly reducing lock contention on parent tables.

### Advanced
**Q: What are PostgreSQL Advisory Locks, where are they stored, and how do session-level advisory locks differ from transaction-level advisory locks?**  
*Answer*: Advisory locks are application-defined mutexes managed entirely in PostgreSQL shared memory (RAM); they do not lock any physical table or row.
- **Session-Level Advisory Locks** (`pg_advisory_lock(id)`): Bound to the physical database connection session. They persist across transaction boundaries and **must be manually unlocked** via `pg_advisory_unlock(id)`.
- **Transaction-Level Advisory Locks** (`pg_advisory_xact_lock(id)`): Bound strictly to the current transaction. They are automatically released when the transaction commits or rolls back, eliminating lock leakage risks.

---

## 16. Coding Questions

### Problem 1: Safe Multi-Account Money Transfer with Deadlock Prevention
Write a SQL transaction sequence in Node.js / TypeScript that transfers funds between Account A and Account B while mathematically preventing deadlocks.

```typescript
import { PoolClient } from 'pg';
import { dbPool } from './db';

export async function safeTransferFunds(
  acc1Id: string, 
  acc2Id: string, 
  amount: number
): Promise<void> {
  // CRITICAL: Prevent deadlocks by always sorting lock acquisition order!
  const [firstAccId, secondAccId] = [acc1Id, acc2Id].sort();

  const client: PoolClient = await dbPool.connect();

  try {
    await client.query('BEGIN');

    // 1. Lock rows in deterministic alphabetical order
    await client.query(
      'SELECT id, balance FROM accounts WHERE id IN ($1, $2) ORDER BY id FOR UPDATE',
      [firstAccId, secondAccId]
    );

    // 2. Perform business logic: Debit sender, credit receiver
    await client.query(
      'UPDATE accounts SET balance = balance - $1 WHERE id = $2 AND balance >= $1',
      [amount, acc1Id]
    );

    await client.query(
      'UPDATE accounts SET balance = balance + $1 WHERE id = $2',
      [amount, acc2Id]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking `SELECT` queries always acquire locks. Standard `SELECT` statements under MVCC acquire only lightweight `ACCESS SHARE` locks on table definitions, never locking rows or blocking writers.
- **Trap 2**: Believing `ROLLBACK TO SAVEPOINT` commits the transaction. It only reverts mutations back to the checkpoint; the transaction remains open until you issue an explicit `COMMIT` or `ROLLBACK`.
- **Trap 3**: Forgetting to release session advisory locks. If an application crashes before calling `pg_advisory_unlock()`, the lock remains held in PostgreSQL memory until the TCP socket closes. Use transaction-scoped advisory locks (`pg_advisory_xact_lock`) whenever possible.

---

## 18. Revision Summary
- Transactions guarantee all-or-nothing atomicity bounded by `BEGIN` and `COMMIT` / `ROLLBACK`.
- When any statement fails inside a PostgreSQL transaction, the transaction enters `TRANS_ABORT`; use **Savepoints** to recover gracefully without aborting the parent transaction.
- Row-level locking (`FOR UPDATE`) provides deterministic serialized access to high-contention records.
- `FOR UPDATE SKIP LOCKED` enables non-blocking, multi-pod background job queues.
- Always sort resource IDs before locking to mathematically eliminate deadlocks.
- Advisory locks provide cluster-wide distributed locking in database RAM without external tools.

---

## 19. Quick Reference

| Command / Construct | Scope | Release Condition | Key Use Case |
| :--- | :--- | :--- | :--- |
| **`SAVEPOINT name`** | Within Transaction | `RELEASE SAVEPOINT` or `ROLLBACK` | Error boundary inside transaction |
| **`ROLLBACK TO name`** | Reverts to savepoint | Clears `TRANS_ABORT` state | Granular error recovery |
| **`SELECT ... FOR UPDATE`** | Row Level | On `COMMIT` or `ROLLBACK` | Pessimistic concurrency control |
| **`FOR UPDATE SKIP LOCKED`** | Row Level | On `COMMIT` or `ROLLBACK` | Distributed background queues |
| **`pg_try_advisory_lock`** | Session (Connection) | Manual `pg_advisory_unlock` | Distributed cron deduplication |
| **`pg_advisory_xact_lock`**| Transaction | Automatically on `COMMIT` | Transaction-scoped distributed lock |
