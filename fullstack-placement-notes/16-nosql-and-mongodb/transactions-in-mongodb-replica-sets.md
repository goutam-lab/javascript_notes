# Transactions in MongoDB Replica Sets and Distributed Systems

## 1. What is it?
In early versions of MongoDB, ACID transaction guarantees were strictly limited to **single document operations**. If an operation mutated multiple documents or collections simultaneously, it lacked multi-document atomicity and isolation boundaries.

Starting with **MongoDB 4.0** (for Replica Sets) and **MongoDB 4.2** (for Distributed Sharded Clusters), MongoDB introduced **Multi-Document ACID Transactions**. 

Using a two-phase commit protocol under the hood, multi-document transactions allow developers to group multiple read and write operations across multiple collections and databases into a single atomic session (`ClientSession`). Either all mutations commit to disk across the replica set, or the entire transaction is rolled back with zero partial writes.

```
MongoDB Multi-Document Transaction Lifecycle:
Application ---> startSession()
      |
      v
session.startTransaction({ readConcern: 'snapshot', writeConcern: { w: 'majority' } })
      |
      +---> Collection A: updateOne({ _id: 1 }, { $inc: { balance: -100 } }, { session })
      |
      +---> Collection B: updateOne({ _id: 2 }, { $inc: { balance: +100 } }, { session })
      |
      v
session.commitTransaction() ===> Two-Phase Commit flushes to Primary & Replicas!
(Or session.abortTransaction() on error)
```

---

## 2. Why does it exist?
1. **Financial and Multi-Entity Invariant Guarantees**: While 90% of MongoDB use cases leverage embedded documents for single-document atomicity, certain critical workflows (e.g., bank transfers between two distinct accounts, e-commerce order checkouts updating both `orders` and `inventory` collections) inherently span multiple documents.
2. **Eliminating Fragile Two-Phase Application Workarounds**: Before MongoDB 4.0, developers had to manually write complex compensating transaction logic (application-level sagas with pending flags) to handle partial rollbacks when a second query failed. Native multi-document transactions eliminate manual compensating code.
3. **Snapshot Isolation for Point-in-Time Reads**: Running large multi-document reports while concurrent writes are active can result in inconsistent data reads. Transactions with `readConcern: 'snapshot'` guarantee that the application reads a mathematically consistent point-in-time snapshot of the entire database.

---

## 3. Mental Model
Think of MongoDB Transactions as **A Synchronized Lockbox with a Remote Signature**:
- **Single Document Update (The Default)**: Modifying a single manila folder in a filing cabinet. WiredTiger locks just that one folder, stamps the change, and releases it in 0.1ms. Fast, lightweight, and independent.
- **Multi-Document Transaction**: You open 5 different drawers at once, pull out 5 folders, place them into an armored lockbox, and begin making edits. 
- While the lockbox is open, no other clerk in the office can modify those 5 folders.
- When you click "Commit," an electronic signal travels to the **Primary Server and Replica Nodes** (the consensus committee). Once a majority of nodes sign the receipt, the lockbox closes, and all 5 folders return to their drawers simultaneously.

---

## 4. Basic Example
Configuring and executing a transaction using the MongoDB Node.js driver:

```typescript
import { MongoClient } from 'mongodb';

const client = new MongoClient('mongodb://replica1:27017,replica2:27017/?replicaSet=rs0');

async function transferFunds(fromUserId: string, toUserId: string, amount: number) {
  await client.connect();
  
  // 1. Start a Client Session (MANDATORY for transactions)
  const session = client.startSession();

  try {
    // 2. Begin transaction with configuration
    session.startTransaction({
      readConcern: { level: 'snapshot' },
      writeConcern: { w: 'majority' }
    });

    const db = client.db('banking');
    const accounts = db.collection('accounts');

    // 3. Deduct from sender (Pass session in options!)
    const debitRes = await accounts.updateOne(
      { userId: fromUserId, balance: { $gte: amount } },
      { $inc: { balance: -amount } },
      { session }
    );

    if (debitRes.matchedCount === 0) {
      throw new Error('Insufficient funds or sender account not found');
    }

    // 4. Credit to receiver (Pass session in options!)
    await accounts.updateOne(
      { userId: toUserId },
      { $inc: { balance: amount } },
      { session }
    );

    // 5. Commit transaction across replica set
    await session.commitTransaction();
    console.log('Transfer committed successfully');
  } catch (error) {
    // Abort and roll back all operations
    await session.abortTransaction();
    console.error('Transaction aborted due to error', error);
    throw error;
  } finally {
    // 6. Always end the session to release connection resources
    await session.endSession();
  }
}
```

---

## 5. Real Example: The `withTransaction` Helper with Transient Error Retries
A production TypeScript implementation using MongoDB's official **`withTransaction`** API, which automatically handles `TransientTransactionError` and `UnknownTransactionCommitResult` retries:

```typescript
import { MongoClient, ObjectId, ClientSession } from 'mongodb';

export class OrderCheckoutService {
  constructor(private readonly client: MongoClient) {}

  public async checkoutOrder(
    userId: ObjectId,
    items: Array<{ productId: ObjectId; qty: number; unitPrice: number }>
  ): Promise<{ orderId: ObjectId; status: 'SUCCESS' }> {
    const session: ClientSession = this.client.startSession();
    let createdOrderId: ObjectId | null = null;

    try {
      /**
       * withTransaction automatically manages:
       * - Calling startTransaction()
       * - Retrying the ENTIRE transaction on TransientTransactionError
       * - Retrying commitTransaction() on UnknownTransactionCommitResult (network blips)
       * - Calling abortTransaction() on application exceptions
       */
      await session.withTransaction(
        async () => {
          const db = this.client.db('ecommerce');
          const inventory = db.collection('inventory');
          const orders = db.collection('orders');

          // Step 1: Deduct inventory for all items
          for (const item of items) {
            const res = await inventory.updateOne(
              { _id: item.productId, availableStock: { $gte: item.qty } },
              { $inc: { availableStock: -item.qty, reservedStock: item.qty } },
              { session }
            );

            if (res.matchedCount === 0) {
              throw new Error(`Item ${item.productId.toHexString()} has insufficient inventory`);
            }
          }

          // Step 2: Create master order document
          const totalAmount = items.reduce((sum, i) => sum + (i.qty * i.unitPrice), 0);
          const orderInsert = await orders.insertOne(
            {
              userId,
              items,
              totalAmount,
              status: 'CONFIRMED',
              createdAt: new Date()
            },
            { session }
          );

          createdOrderId = orderInsert.insertedId;
        },
        {
          readPreference: 'primary', // Transactions must write to primary
          readConcern: { level: 'snapshot' },
          writeConcern: { w: 'majority', j: true } // Journal flushed to majority of nodes
        }
      );

      return { orderId: createdOrderId!, status: 'SUCCESS' };
    } finally {
      await session.endSession();
    }
  }
}
```

---

## 6. Under the Hood

### 1. Replica Set Prerequisites and the Oplog
- **Transactions Cannot Run on Standalone Instances**: Multi-document transactions require a **Replica Set** (minimum 3 nodes: 1 Primary + 2 Secondaries, or 1 Primary + 1 Secondary + 1 Arbiter).
- **The Oplog (Operations Log)**: In a transaction, mutations are not written to the primary's `local.oplog.rs` row-by-row. Instead, WiredTiger buffers changes in private transaction memory cache.
- When `commitTransaction` is executed, the entire transaction is packaged into a **single, multi-statement transaction oplog entry** and replicated to the secondary nodes.

### 2. Read Concerns and Write Concerns in Transactions
- **`readConcern: 'snapshot'`**: Returns data from a consistent point-in-time snapshot synchronized across the replica set. Reads do not see uncommitted changes from other transactions (no dirty reads).
- **`writeConcern: { w: 'majority', j: true }`**: Guarantees that the transaction's commit entry has been successfully written to disk journals across a mathematical majority ($> 50\%$) of voting nodes before returning acknowledgment to the application, eliminating data loss during primary failover.

### 3. Concurrency and WiredTiger Lock Conflicts
- WiredTiger uses **Optimistic Concurrency Control (OCC)** for transactions.
- It does not hold heavy row locks while statements execute. Instead, when a transaction attempts to modify a document that was modified by another concurrent transaction since this transaction began, a **Write Conflict** occurs.
- The transaction fails with error label: **`TransientTransactionError`**. The driver's `withTransaction` helper catches this label and automatically restarts the transaction from the beginning.

---

## 7. Important Rules
1. **Transactions Have a Strict 60-Second Lifetime**: By default, a transaction cannot run for longer than 60 seconds (`transactionLifetimeLimitSeconds`). If a transaction remains open for 60.1 seconds, MongoDB automatically aborts it and rolls back all mutations. Keep transactions short!
2. **Never Create Collections Inside a Transaction in Older Versions**: Prior to MongoDB 4.4, executing DDL commands (`createCollection`, `createIndex`) inside a transaction was prohibited. While allowed in newer versions, DDL in transactions incurs heavy metadata locking. Pre-create collections during migrations.
3. **Transactions Cannot Write to Capped Collections**: Capped collections (fixed-size ring buffers) do not support multi-document transactions.
4. **Transactions Incur Significant Performance Overhead**: Do not default all writes to transactions out of habit. 95% of MongoDB writes should rely on **embedded document atomicity**; reserve transactions strictly for multi-document operations.

---

## 8. Common Mistakes

### 1. Forgetting to Pass `{ session }` to Database Calls
```typescript
// FATAL BUG: Forgot to pass session to the second query!
await accounts.updateOne({ _id: userA }, { $inc: { balance: -100 } }, { session });

// This query executes OUTSIDE the transaction!
// If the transaction aborts, userA's debit rolls back, but userB's credit PERSISTS!
await accounts.updateOne({ _id: userB }, { $inc: { balance: 100 } }); // MISSING { session }!
```

### 2. Manual Error Handling Without Retry Loops
Catching errors manually with `try/catch` and calling `abortTransaction()` without handling `TransientTransactionError`. Under concurrent write loads, write conflicts are expected; without retry loops, end-users will experience random 500 errors. Always use the native **`withTransaction()`** API.

---

## 9. Best Practices
- **Always Use `withTransaction()`**: Never write manual `session.startTransaction()` and `session.commitTransaction()` boilerplate. The `session.withTransaction()` method embeds industry-standard retry policies for transient network and concurrency conflicts.
- **Keep Transactions Small**: A transaction that modifies 50,000 documents consumes massive WiredTiger memory and locks buffer cache pages. Keep transactions under 1,000 modified documents.

---

## 10. Performance Considerations
- **Memory Consumption**: Every modified document in a transaction is pinned in the WiredTiger in-memory cache until commit. Large transactions increase cache pressure and can force dirty pages to disk, slowing down all operations on the cluster.
- **Oplog Size Limits**: If a transaction mutates hundreds of megabytes of data, it can exceed the maximum BSON size limit for the single transaction commit oplog entry (16MB), causing the transaction to fail.

---

## 11. Security Considerations
- **Session Hijacking**: Client sessions are bound to the underlying authenticated connection. Ensure connections use TLS/SSL to prevent man-in-the-middle attacks from intercepting session tokens.

---

## 12. Alternatives
1. **Single Document Embedding**: The idiomatic MongoDB pattern. Model related data in a single document to achieve 100% ACID atomicity with zero transaction overhead.
2. **The Saga Pattern**: For distributed microservices with separate databases where distributed transactions are impossible over unreliable networks.
3. **Relational Databases (PostgreSQL)**: When the vast majority of operations involve complex, multi-table transactions with relational integrity.

---

## 13. Trade-offs

| Criterion | Single-Document Update | Multi-Document Transaction |
| :--- | :--- | :--- |
| **ACID Scope** | Atomic on 1 document | Atomic across multiple collections/docs |
| **Performance Overhead** | Negligible (Sub-millisecond) | Higher (Two-phase commit + replication sync) |
| **Max Lifetime** | Unlimited | 60 seconds strict limit |
| **Replica Set Required?**| No (Works on standalone) | Yes (Requires Replica Set or Sharded Cluster) |
| **Concurrency Model** | In-place update | Optimistic Concurrency Control (OCC) |

---

## 14. Real-World Usage
- **Fintech Wallets**: Moving funds between wallet documents and ledger entry collections atomically.
- **Supply Chain Fulfillment**: Deducting inventory across warehouse collections and creating shipping manifesting records in a single transactional boundary.

---

## 15. Placement Interview Questions

### Basic
**Q: Does MongoDB support ACID transactions?**  
*Answer*: Yes. MongoDB has always guaranteed ACID transactions at the **single document level**. Starting with MongoDB 4.0, it introduced **Multi-Document ACID Transactions** for Replica Sets, and in 4.2 extended this to Distributed Sharded Clusters using a two-phase commit protocol.

### Conceptual
**Q: Why do multi-document transactions require a Replica Set and fail on a standalone MongoDB instance?**  
*Answer*: Multi-document transactions rely on the **Oplog (Operations Log)** to package and replicate transactional operations as a single atomic unit. Standalone MongoDB instances do not have an active oplog; the oplog is only initialized when MongoDB runs as a member of a Replica Set.

### Implementation
**Q: What is the purpose of the `session.withTransaction()` helper method, and why is it preferred over manual transaction handling?**  
*Answer*: `session.withTransaction()` is the recommended best practice because it automatically manages transaction lifecycles and embeds built-in retry logic. Specifically, it automatically retries the entire callback if a **`TransientTransactionError`** occurs (e.g., concurrent write conflicts) and automatically retries the commit operation if an **`UnknownTransactionCommitResult`** occurs (e.g., transient network drops during commit), eliminating boilerplate error-handling code.

### Debugging
**Q: During load testing, multiple transactions fail with `WriteConflict error (error code 112)`. Is this a bug in MongoDB? How should the application handle it?**  
*Answer*: This is not a bug; it is the intended behavior of WiredTiger's Optimistic Concurrency Control (OCC). A `WriteConflict` occurs when two concurrent transactions attempt to modify the same document or index key simultaneously. Because transactions do not acquire blocking row locks during execution, MongoDB aborts the conflicting transaction with error code 112 and labels it a `TransientTransactionError`. The application must handle this by wrapping the transaction in an **idempotent retry loop** (such as `withTransaction`), which will automatically re-execute the transaction.

### Scenario
**Q: A developer has a transaction that processes a batch of 100,000 customer emails, taking 75 seconds to complete. The transaction aborts with `TransactionExceededLifetimeLimitSeconds`. What is the issue, and how do you re-architect it?**  
*Answer*: MongoDB enforces a strict default **60-second lifetime limit** (`transactionLifetimeLimitSeconds`) on transactions to prevent long-running transactions from pinning cache memory and bloating the oplog. Furthermore, external operations like sending emails should **never** run inside a database transaction block.  
**Re-architecture**: 
1. Remove email sending from the database transaction.
2. Break the 100,000-document batch into small chunks of 500 documents.
3. Process each chunk in its own rapid transaction (< 1 second) or use an asynchronous background message queue (e.g., BullMQ).

### Advanced
**Q: Explain how MongoDB implements Two-Phase Commit for transactions across a Sharded Cluster.**  
*Answer*: In a sharded cluster, documents involved in a transaction may reside on different shards. MongoDB uses a **Two-Phase Commit (2PC)** protocol coordinated by a designated **Transaction Coordinator** (one of the shards):
1. **Prepare Phase**: The coordinator sends a `prepareTransaction` command to all participating shards. Each shard writes the transaction mutations to its local journal, acquires locks, and enters a "prepared" state, guaranteeing it can commit.
2. **Commit Phase**: Once all participating shards respond with "prepared", the coordinator writes a commit decision to its own transaction coordinator log and sends `commitTransaction` to all participating shards. If any shard fails to prepare or times out, the coordinator sends `abortTransaction` to all shards, rolling back the entire distributed transaction.

---

## 16. Coding Questions

### Problem 1: Dual-Account Ledger Transfer with Session Boundary
Write a complete, production-ready TypeScript transaction function that safely transfers loyalty points between two user accounts, handling validation and rollback.

```typescript
import { MongoClient, ObjectId } from 'mongodb';

export async function transferLoyaltyPoints(
  client: MongoClient,
  senderId: ObjectId,
  receiverId: ObjectId,
  points: number
): Promise<void> {
  if (points <= 0) throw new Error('Transfer points must be greater than 0');

  const session = client.startSession();

  try {
    await session.withTransaction(async () => {
      const db = client.db('rewards');
      const users = db.collection('user_accounts');
      const auditLog = db.collection('points_audit_log');

      // 1. Debit sender atomically ensuring sufficient balance
      const debitRes = await users.updateOne(
        { _id: senderId, loyaltyPoints: { $gte: points } },
        { $inc: { loyaltyPoints: -points }, $set: { updatedAt: new Date() } },
        { session }
      );

      if (debitRes.matchedCount === 0) {
        throw new Error('Sender has insufficient points or does not exist');
      }

      // 2. Credit receiver atomically
      const creditRes = await users.updateOne(
        { _id: receiverId },
        { $inc: { loyaltyPoints: points }, $set: { updatedAt: new Date() } },
        { session }
      );

      if (creditRes.matchedCount === 0) {
        throw new Error('Receiver account does not exist');
      }

      // 3. Create immutable audit log entry
      await auditLog.insertOne(
        {
          senderId,
          receiverId,
          points,
          transferredAt: new Date()
        },
        { session }
      );
    });

    console.log(`Successfully transferred ${points} points`);
  } finally {
    await session.endSession();
  }
}
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking MongoDB transactions lock entire collections. Transactions use WiredTiger's document-level optimistic concurrency; only conflicting documents trigger write conflicts.
- **Trap 2**: Forgetting that `session.endSession()` must be called in a `finally` block. Failing to end a session leaks connection pool slots and memory.
- **Trap 3**: Believing transactions should replace proper schema design. If an application requires hundreds of transactions per second across 10 collections, the schema is likely improperly modeled for NoSQL.

---

## 18. Revision Summary
- MongoDB supports Multi-Document ACID Transactions across Replica Sets (v4.0+) and Sharded Clusters (v4.2+).
- Single-document writes are always atomic without transactions.
- Transactions require an active `ClientSession` passed to every database call.
- Always use `session.withTransaction()` to benefit from automatic retries on `TransientTransactionError`.
- Strict 60-second transaction lifetime limit.
- Transactions must read from Primary and write with `{ w: 'majority' }` for strong durability.

---

## 19. Quick Reference

| Parameter / API | Purpose | Default / Requirement |
| :--- | :--- | :--- |
| **`client.startSession()`** | Spawns transaction session | Mandatory first step |
| **`session.withTransaction()`** | Executes callback with auto-retry | Best practice for all transactions |
| **`readConcern: 'snapshot'`** | Point-in-time consistent view | Standard transaction read concern |
| **`writeConcern: 'majority'`** | Flushed to $> 50\%$ replica nodes | Prevents rollback on failover |
| **`transactionLifetimeLimitSeconds`** | Max transaction duration | 60 seconds (Strict ceiling) |
| **`TransientTransactionError`** | Concurrency write conflict label | Handled automatically by `withTransaction` |
