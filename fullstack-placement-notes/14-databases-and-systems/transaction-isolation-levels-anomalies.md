# Transaction Isolation Levels and Anomalies

## 1. What is it?
In relational database systems, **Transaction Isolation Levels** define the degree to which the internal operations of one transaction are isolated from the concurrent modifications of other transactions. 

The ANSI/ISO SQL standard defines four official isolation levels, ranked from lowest isolation (highest concurrency) to highest isolation (strictly serialized):
1. **Read Uncommitted**
2. **Read Committed** (Default in PostgreSQL, Oracle, SQL Server)
3. **Repeatable Read** (Default in MySQL InnoDB)
4. **Serializable**

Each level is designed to prevent a specific set of **concurrency anomalies** (read/write bugs caused by uncoordinated simultaneous data access): **Dirty Reads**, **Non-Repeatable Reads**, **Phantom Reads**, and **Serialization Anomalies / Write Skew**.

```
Isolation Level Hierarchy & Anomaly Mitigation Matrix:

Isolation Level     | Dirty Read | Non-Repeatable Read | Phantom Read | Write Skew
--------------------+------------+---------------------+--------------+------------
Read Uncommitted    |  ALLOWED   |       ALLOWED       |   ALLOWED    |  ALLOWED
Read Committed      | PREVENTED  |       ALLOWED       |   ALLOWED    |  ALLOWED
Repeatable Read     | PREVENTED  |      PREVENTED      | PREVENTED*   |  ALLOWED
Serializable        | PREVENTED  |      PREVENTED      |  PREVENTED   | PREVENTED

*Note: In PostgreSQL and MySQL InnoDB, Repeatable Read also prevents Phantom Reads via MVCC/Next-Key Locking.
```

---

## 2. Why does it exist?
If a database ran all transactions in strict single-threaded serial order, data integrity would be 100% perfect, but system throughput would collapse to a crawl—only one user query could execute at any moment across the entire organization.

To achieve high concurrency, databases allow multiple transactions to execute simultaneously. However, concurrent execution without isolation boundaries introduces dangerous concurrency phenomena:
1. **Dirty Reads**: A user reads uncommitted data that gets rolled back a split second later, causing the application to act on data that never officially existed.
2. **Non-Repeatable Reads**: A user queries a row twice in the same transaction and gets two different values because another transaction modified and committed changes in between.
3. **Phantom Reads**: A user queries a range of rows (e.g., all active employees), but a concurrent transaction inserts new rows matching the criteria and commits, causing subsequent range queries in the first transaction to discover "ghost" records.
4. **Write Skew**: Two concurrent transactions read overlapping data sets, evaluate an invariant to be valid, and make updates that individually maintain the rule, but together violate the system invariant.

Isolation levels allow software engineers to choose the exact trade-off between **data consistency guarantees** and **raw transactional throughput**.

---

## 3. Mental Model
Think of isolation levels as **Working in an Office on Shared Documents**:
- **Read Uncommitted (Peeking over shoulders)**: You peek at your colleague's rough draft while their pencil is still moving. They might erase the whole paragraph 10 seconds later, leaving you with false notes.
- **Read Committed (Reading finalized memos)**: You only read memos that have been signed and placed in the outbox. But if you read Memo #1 at 9:00 AM, and your colleague issues a revised Memo #1 at 9:05 AM, reading it again at 9:10 AM reveals different numbers.
- **Repeatable Read (Taking a personal photocopy)**: When you start your task at 9:00 AM, you photocopy the entire filing cabinet. Throughout your day, you only read your photocopy. Even if others publish revised memos, your view of the cabinet remains frozen in time at 9:00 AM.
- **Serializable (One person in the library at a time)**: Only one person is allowed inside the archives at any time, or an auditor reviews all changes and cancels your work if someone else touched related records before you finished.

---

## 4. Basic Example
Configuring isolation levels in SQL:

```sql
-- Setting isolation level for a single transaction in PostgreSQL / MySQL
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;

SELECT balance FROM accounts WHERE account_id = 'ACC-001';

-- Any concurrent updates committed by other transactions while this transaction 
-- is running will NOT be visible to this transaction.

COMMIT;

-- Session-level default setting (PostgreSQL)
SET SESSION CHARACTERISTICS AS TRANSACTION ISOLATION LEVEL SERIALIZABLE;
```

---

## 5. Real Example: Preventing Write Skew in TypeScript / PostgreSQL
A real-world hospital on-call scheduling scenario demonstrating Write Skew and how `SERIALIZABLE` or pessimistic locking prevents it:

```typescript
import { PoolClient } from 'pg';
import { dbPool } from './db';

/**
 * INVARIANT: At least one doctor must remain on call at all times.
 * There are currently 2 doctors on call: Dr. Alice and Dr. Bob.
 * Both doctors simultaneously attempt to check out of their on-call shift.
 */

// ANTI-PATTERN: Fails under READ COMMITTED / REPEATABLE READ (Write Skew!)
export async function vulnerableRequestShiftOff(doctorId: string): Promise<boolean> {
  const client: PoolClient = await dbPool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');

    // Step 1: Count active doctors on call
    const res = await client.query(
      'SELECT COUNT(*) as count FROM doctors WHERE on_call = true'
    );
    const count = parseInt(res.rows[0].count, 10);

    // If both Dr. Alice and Dr. Bob run this concurrently, both see count = 2!
    if (count > 1) {
      // Both proceed to set on_call = false!
      await client.query(
        'UPDATE doctors SET on_call = false WHERE id = $1',
        [doctorId]
      );
      await client.query('COMMIT');
      return true; // Result: 0 doctors on call! Invariant violated.
    }

    await client.query('ROLLBACK');
    return false;
  } finally {
    client.release();
  }
}

// ROBUST SOLUTION: Use SERIALIZABLE with automatic retry on serialization failure
export async function robustRequestShiftOff(
  doctorId: string, 
  maxRetries: number = 3
): Promise<boolean> {
  let attempts = 0;

  while (attempts < maxRetries) {
    attempts++;
    const client: PoolClient = await dbPool.connect();

    try {
      // Serializable Snapshot Isolation (SSI) detects overlapping write skews
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');

      const res = await client.query(
        'SELECT COUNT(*) as count FROM doctors WHERE on_call = true'
      );
      const count = parseInt(res.rows[0].count, 10);

      if (count <= 1) {
        await client.query('ROLLBACK');
        return false; // Cannot leave: only 1 doctor on call
      }

      await client.query(
        'UPDATE doctors SET on_call = false WHERE id = $1',
        [doctorId]
      );

      // In SERIALIZABLE, the second concurrent commit throws error code 40001 (serialization_failure)
      await client.query('COMMIT');
      return true;
    } catch (error: any) {
      await client.query('ROLLBACK');

      // PostgreSQL error code '40001' represents serialization_failure
      if (error.code === '40001') {
        console.warn(`Serialization conflict on attempt ${attempts}. Retrying...`);
        // Exponential backoff with jitter
        await new Promise(r => setTimeout(r, Math.random() * 50 * attempts));
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  throw new Error('Failed to complete transaction after maximum serialization retries');
}
```

---

## 6. Under the Hood

### Detailed Anatomy of the Four Concurrency Anomalies

#### 1. Dirty Read (`G1` Anomaly)
- **Sequence**:
  1. Transaction 1 updates row $A$ from value `100` to `200`.
  2. Transaction 2 reads row $A$ and sees `200`.
  3. Transaction 1 crashes or issues `ROLLBACK`. Row $A$ reverts to `100`.
  4. Transaction 2 acts on `200`, which was never officially committed.
- **Prevention**: Enforce `Read Committed`. The engine checks the MVCC tuple header or row lock; uncommitted changes are strictly hidden from outside readers.

#### 2. Non-Repeatable Read (`Fuzzy Read`)
- **Sequence**:
  1. Transaction 1 reads row $A$ (value = `100`).
  2. Transaction 2 updates row $A$ to `150` and issues `COMMIT`.
  3. Transaction 1 reads row $A$ a second time within its same transaction boundary and now sees `150`.
- **Prevention**: Enforce `Repeatable Read`. In MVCC engines, the database takes a snapshot of the database state at the **start of the transaction** (or first query). Any commits made by concurrent transactions after that snapshot timestamp are ignored.

#### 3. Phantom Read
- **Sequence**:
  1. Transaction 1 executes: `SELECT * FROM orders WHERE status = 'PENDING'`. Returns 3 rows.
  2. Transaction 2 executes: `INSERT INTO orders (status) VALUES ('PENDING')` and issues `COMMIT`.
  3. Transaction 1 re-executes the exact same query: it now receives 4 rows. The 4th row is a "phantom."
- **Prevention**: 
  - In traditional lock-based systems: **Predicate Locking** or **Index-Range Locks (Next-Key Locks)** prevent inserts into the queried range.
  - In PostgreSQL MVCC: Repeatable Read takes a snapshot at transaction start, inherently preventing phantom reads for standard `SELECT` queries without locking.

#### 4. Serialization Anomaly: Write Skew
- **Mechanism**: Write skew occurs when two concurrent transactions read overlapping datasets, verify a shared constraint, and then write to disjoint parts of that dataset, violating the global invariant.
- **Why Repeatable Read Fails**: Because each transaction updates a *different row*, row-level write locks never conflict! Both transactions commit successfully under Repeatable Read, corrupting the business invariant.
- **Prevention**: Requires true `SERIALIZABLE` isolation. PostgreSQL uses **Serializable Snapshot Isolation (SSI)**, tracking read-write dependency graphs (SIREAD locks) in RAM. If a cycle is detected in the dependency graph, the database aborts one transaction with error `40001 (serialization_failure)`.

---

## 7. Important Rules
1. **Serializable Requires Application Retry Loops**: In `SERIALIZABLE` mode, the database will deliberately abort transactions that encounter concurrent conflicts. Your application code **must** implement automatic retry loops with exponential backoff.
2. **Read Committed Takes Statement-Level Snapshots**: In `Read Committed`, each individual SQL statement within the transaction gets a fresh snapshot of the latest committed data.
3. **Repeatable Read Takes Transaction-Level Snapshots**: In `Repeatable Read`, the snapshot is captured at the very beginning of the transaction and remains frozen until `COMMIT` or `ROLLBACK`.
4. **Writes Always Lock the Row**: In all isolation levels, when a transaction issues `UPDATE`, `DELETE`, or `SELECT ... FOR UPDATE`, it acquires an exclusive row lock (`X-Lock`). Concurrent transactions attempting to modify the exact same row are blocked until the lock-holding transaction finishes.

---

## 8. Common Mistakes

### 1. Assuming "Repeatable Read" Prevents Write Skew
Many developers assume `REPEATABLE READ` prevents all concurrency anomalies. As proven in the doctor on-call example, `REPEATABLE READ` allows write skew because the two transactions mutate different rows.

### 2. Using `SERIALIZABLE` Without Handling Error Code `40001`
Enabling `SERIALIZABLE` without catching serialization failure exceptions in the backend. When user traffic surges, the database engine aborts conflicting transactions, causing random HTTP 500 errors to surface to end users instead of transparent retries.

### 3. Blindly Defaulting Everything to `SERIALIZABLE`
Using `SERIALIZABLE` for high-throughput, low-conflict CRUD operations (e.g., updating user last-login timestamps). This causes unnecessary lock tracking overhead, high abort rates, and reduced system throughput.

---

## 9. Best Practices
- **Use `Read Committed` for 95% of Web APIs**: It delivers the highest concurrency and throughput while completely preventing dirty reads.
- **Use Pessimistic Row Locking (`SELECT ... FOR UPDATE`) in `Read Committed`**: For specific race conditions (e.g., account balance transfers or inventory deductions), you don't need `SERIALIZABLE`; simply lock the specific target rows:
  ```sql
  SELECT balance FROM accounts WHERE id = $1 FOR UPDATE;
  ```
- **Reserve `SERIALIZABLE` for Complex Multi-Row Invariants**: Use it when multiple rows across multiple tables govern a shared invariant (e.g., medical shift coverage, complex financial balance sheets, tax ledger calculations).
- **Keep Isolation Scopes Narrow**: Never set the entire database cluster to `SERIALIZABLE` if only two specific accounting endpoints require it. Set it per-transaction:
  ```sql
  BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
  ```

---

## 10. Performance Considerations
- **Abort & Retry Rate in SSI**: Under high write contention on overlapping datasets, `SERIALIZABLE` transactions experience elevated abort rates. Retrying transactions consumes CPU cycles and increases P99 latency.
- **Memory Consumption of SIREAD Locks**: In PostgreSQL, Serializable Snapshot Isolation maintains lock dependency structures in shared memory. Extremely complex queries touching millions of rows in `SERIALIZABLE` mode can exhaust `max_pred_locks_per_transaction`.
- **Latency Differences**: `Read Committed` has negligible overhead since MVCC handles it cleanly without lock contention on reads.

---

## 11. Security Considerations
- **Financial Double-Spend Exploits**: A notorious security exploit in decentralized exchanges, crypto wallets, and fintech APIs involves firing simultaneous concurrent withdrawal requests. If the endpoint runs at standard `Read Committed` without row locking or serializable isolation, both requests read the initial balance before either commits, draining double the available funds.

---

## 12. Alternatives
1. **Explicit Pessimistic Locking (`SELECT ... FOR UPDATE` / `FOR SHARE`)**: Manually serializing access to specific rows while keeping the global isolation level at `Read Committed`.
2. **Optimistic Concurrency Control (OCC) via Versioning**: Adding a `version INT` column to the table. Updates verify `WHERE id = $1 AND version = $2`. Eliminates database locks entirely; conflicts are detected when row count equals 0.
3. **Redis Distributed Mutex (Redlock)**: Acquiring an in-memory lock in Redis before entering the database transaction. Offloads lock coordination outside the relational database engine.

---

## 13. Trade-offs

| Isolation Level | Concurrency / Throughput | Data Integrity Guarantees | Abort / Retry Probability |
| :--- | :--- | :--- | :--- |
| **Read Uncommitted** | Highest | Terrible (Dirty reads frequent) | 0% |
| **Read Committed** | Very High | Solid (No dirty reads; statement snapshot) | ~0% |
| **Repeatable Read** | High | Strong (Transaction snapshot; no non-repeatable reads) | Low (Write-conflict aborts) |
| **Serializable** | Moderate to Low | Absolute (Zero anomalies; mathematical equivalence to serial execution) | High under write contention |

---

## 14. Real-World Usage
- **Banking Ledger Adjustments**: Core banking systems run ledgers at `SERIALIZABLE` or use strict pessimistic row locks (`FOR UPDATE`) to ensure zero deviation across millions of transactions.
- **Content Management Systems (CMS / Blogs)**: Run at `Read Committed`. If an editor updates an article title while a reader is viewing the page, non-repeatable reads are completely harmless.

---

## 15. Placement Interview Questions

### Basic
**Q: What is a Dirty Read, and which isolation level is the minimum required to prevent it?**  
*Answer*: A dirty read occurs when Transaction A reads modifications made by Transaction B that have not yet been committed. If Transaction B rolls back, Transaction A is left holding invalid data that never truly existed. The minimum isolation level that prevents dirty reads is **Read Committed**.

### Conceptual
**Q: What is the fundamental difference between a Non-Repeatable Read and a Phantom Read?**  
*Answer*: 
- A **Non-Repeatable Read** involves reading the **exact same row** twice within a transaction and observing that its column values have changed because a concurrent transaction updated/deleted that row and committed.
- A **Phantom Read** involves executing a **range query** (e.g., `WHERE age > 30`) twice within a transaction and discovering that new rows ("phantoms") have appeared in the result set because a concurrent transaction inserted new records matching the predicate and committed.

### Implementation
**Q: How does PostgreSQL implement `REPEATABLE READ` without using traditional shared read locks?**  
*Answer*: PostgreSQL uses **Multi-Version Concurrency Control (MVCC)**. When a transaction starts in `REPEATABLE READ`, it takes a virtual snapshot of the database state. Each row contains hidden metadata headers (`xmin` for creation transaction ID and `xmax` for deletion transaction ID). The engine compares the transaction's snapshot timestamp against the row's `xmin` and `xmax`. Reads only see tuples that were committed before the snapshot was taken, completely ignoring any concurrent updates or inserts without acquiring read locks.

### Debugging
**Q: An e-commerce service experiences intermittent `error: could not serialize access due to concurrent update (SQLSTATE 40001)`. Is this a bug in the code? How should the backend handle it?**  
*Answer*: This is not a bug; it is the intended behavior of the database running in `REPEATABLE READ` or `SERIALIZABLE` mode when two transactions attempt to modify the same row or create a dependency cycle. The database engine intentionally aborts one transaction to preserve serializability. The backend must handle this by catching error code `40001` and wrapping the transaction execution in an **idempotent retry loop** with exponential backoff and jitter.

### Scenario
**Q: Explain Write Skew with a concrete real-world example, and explain why standard `REPEATABLE READ` fails to stop it.**  
*Answer*: Consider a medical rule stating "at least one doctor must be on active call." Doctors Alice and Bob are currently on call. Both simultaneously request off-duty status. Under `REPEATABLE READ`, Transaction 1 reads count = 2, and Transaction 2 reads count = 2. Transaction 1 updates Alice's row to `false`. Transaction 2 updates Bob's row to `false`. Because they are updating **different rows**, their write locks do not conflict. Both transactions commit successfully, leaving 0 doctors on call. `REPEATABLE READ` fails because it only locks rows that are modified, unable to detect that the shared read predicate was invalidated.

### Advanced
**Q: How does Serializable Snapshot Isolation (SSI) in modern PostgreSQL achieve serializability without using traditional two-phase locking (2PL)?**  
*Answer*: SSI operates optimistically on top of standard MVCC snapshots without blocking readers or writers. It tracks read-write dependencies at runtime using lightweight in-memory markers called **SIREAD locks** (stored in a shared-memory lock table). An SSI algorithm constantly monitors the transaction dependency graph for **rw-antidependency cycles** (where Transaction T1 reads data modified by T2, while T2 reads data modified by T1). If a cycle is detected, the database aborts one of the transactions before commit, guaranteeing serial equivalence while achieving significantly higher concurrency than strict 2PL.

---

## 16. Coding Questions

### Problem 1: Pessimistic Row-Level Locking in SQL (`FOR UPDATE`)
Write a SQL transaction sequence that prevents race conditions and balance overdrafts under the default `Read Committed` isolation level.

```sql
BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- 1. Lock the sender's row exclusively. 
-- Concurrent transactions trying to read this row FOR UPDATE will block and wait.
SELECT balance 
FROM accounts 
WHERE account_id = 'ACC-USER-1' 
FOR UPDATE;

-- 2. Validate balance in application logic (or via SQL check)
-- Assume balance is sufficient ($500 >= $100)

-- 3. Perform debit
UPDATE accounts 
SET balance = balance - 100.00, updated_at = NOW() 
WHERE account_id = 'ACC-USER-1';

-- 4. Perform credit
UPDATE accounts 
SET balance = balance + 100.00, updated_at = NOW() 
WHERE account_id = 'ACC-USER-2';

-- 5. Commit releases the row-level X-locks
COMMIT;
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking MySQL InnoDB and PostgreSQL behave identically at `REPEATABLE READ`. In PostgreSQL, `REPEATABLE READ` prevents phantom reads via MVCC snapshots. In MySQL InnoDB, Repeatable Read prevents phantom reads using a combination of MVCC snapshots for consistent reads and **Next-Key Locks** (gap locking) for locking reads (`FOR UPDATE`).
- **Trap 2**: Believing that `SELECT` queries block `UPDATE` queries in standard PostgreSQL. Under MVCC, readers never block writers, and writers never block readers.
- **Trap 3**: Believing `Read Uncommitted` is commonly used for performance. In reality, modern relational engines like PostgreSQL don't even implement true dirty reads; in PostgreSQL, requesting `READ UNCOMMITTED` simply runs under `READ COMMITTED`.

---

## 18. Revision Summary
- The 4 ANSI SQL isolation levels: Read Uncommitted, Read Committed, Repeatable Read, and Serializable.
- The 4 core concurrency anomalies: Dirty Read, Non-Repeatable Read, Phantom Read, and Write Skew.
- `Read Committed` is the industry standard default; it evaluates a fresh MVCC snapshot on each SQL statement.
- `Repeatable Read` evaluates a single MVCC snapshot across the entire transaction boundary.
- Write Skew cannot be caught by `Repeatable Read`; it requires `SERIALIZABLE` or explicit pessimistic row locking (`FOR UPDATE`).
- Any application using `SERIALIZABLE` must be engineered with automatic transaction retry handlers catching SQLSTATE `40001`.

---

## 19. Quick Reference

| Level | Snapshot Boundary | Locks Acquired | Typical Use Case |
| :--- | :--- | :--- | :--- |
| **Read Committed** | Per statement | Write locks only on modified rows | Default for 95% of standard web applications |
| **Repeatable Read** | Start of transaction | Write locks only on modified rows | Reporting, multi-step invoice generation |
| **Serializable** | Start of transaction + SIREAD tracking | Optimistic SIREAD dependency tracking | Complex financial ledgers, inventory allocations |
| **PostgreSQL Error 40001** | `serialization_failure` | Trigger for application-level retry | Always wrap with exponential backoff loop |
