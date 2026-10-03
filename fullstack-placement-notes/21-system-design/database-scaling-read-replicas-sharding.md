# Database Scaling: Primary-Replica Replication, Replication Lag & Horizontal Sharding

## 1. What is it?
**Database Scaling** is the architectural evolution of the persistence tier required to sustain increasing write throughput, read query volume, and storage capacity beyond the physical limits of a single database server.

Database scaling is implemented via two primary methodologies:
1. **Primary-Replica Replication (Vertical Partitioning of Workload)**: One authoritative **Primary (Leader/Master)** node processes all writes (`INSERT`, `UPDATE`, `DELETE`) and streams its write-ahead log (WAL) to multiple read-only **Replicas (Followers/Slaves)**. Application read queries (`SELECT`) are distributed across replicas to scale read throughput.
2. **Horizontal Sharding (Database Partitioning)**: Dividing a massive single logical dataset across multiple independent physical database instances (**Shards**). Each shard holds a discrete, non-overlapping subset of the data based on a designated **Shard Key** (Partition Key).

```
PRIMARY-REPLICA ARCHITECTURE (Scales Reads)
               Write Traffic (INSERT / UPDATE)
                              │
                              ▼
                 ┌─────────────────────────┐
                 │ Primary Node (Read/Write)│
                 └────────────┬────────────┘
                              │ Streaming WAL Replication
                 ┌────────────┴────────────┐
                 ▼                         ▼
    ┌─────────────────────────┐ ┌─────────────────────────┐
    │ Read Replica 1 (RO)     │ │ Read Replica 2 (RO)     │
    └─────────────────────────┘ └─────────────────────────┘
                 ▲                         ▲
                 └────────────┬────────────┘
                              │ Read Traffic (SELECT)

HORIZONTAL SHARDING ARCHITECTURE (Scales Writes & Storage)
                       Incoming Traffic
                              │
                              ▼
┌────────────────────────────────────────────────────────┐
│ Sharding Router / Coordinator (Hash(user_id) % 3)      │
└──────────────┬──────────────┬──────────────┬───────────┘
               │              │              │
               ▼              ▼              ▼
        ┌─────────────┐┌─────────────┐┌─────────────┐
        │   Shard 0   ││   Shard 1   ││   Shard 2   │
        │ Users 0-33% ││ Users 34-66%││ Users 67-100│
        └─────────────┘└─────────────┘└─────────────┘
```

---

## 2. Why does it exist?
A single relational database server eventually encounters three insurmountable scaling walls:

1. **The Read Throughput Wall**: A single PostgreSQL instance can handle ~5,000–10,000 complex reads/sec. If an application grows to 100,000 reads/sec, deploying 5–10 read replicas behind a connection pooler scales read capacity linearly.
2. **The Write Throughput Wall**: Read replicas **do not scale write throughput**. In primary-replica setups, every write must be executed by the single primary node and replayed on all replicas. When writes exceed 5,000–10,000 QPS, the primary CPU and disk IOPS max out. **Sharding is the only way to scale relational writes**.
3. **The Storage & Memory Limit**: A table with 50 billion rows (15 Terabytes) cannot fit in memory and causes B-Tree indexes to exceed RAM. Partitioning the data across 16 shards reduces each shard to a manageable 1 Terabyte, fitting indexes back into RAM cache.
4. **The Replication Lag Challenge**: Asynchronous replication introduces a dangerous window where a user writes a record, is redirected to a read replica that has not yet replayed the write, and sees their own data "vanish" (violating Read-Your-Own-Writes consistency).

---

## 3. Mental Model: The Office Filing Cabinets
Think of database scaling as **Organizing Medical Records in a Hospital**:
- **Single Database**: One filing cabinet in the head doctor's office. Every doctor must queue up outside the door to read or write a patient chart.
- **Primary-Replica Replication**: The head doctor's cabinet is the master. Every time a new chart is filed, an assistant photocopies it and drops it into 4 reading cabinets in the nurses' lounge. Nurses can read charts quickly, but if a doctor just filed an update 2 seconds ago, the photocopy might still be walking down the hallway (**Replication Lag**).
- **Horizontal Sharding**: The hospital outgrows the room. They purchase 26 separate filing cabinets, labeled **A through Z** (the Shard Key). Records for patients named "Smith" go exclusively into Cabinet S; records for "Adams" go into Cabinet A. 26 doctors can file updates simultaneously without blocking one another.

---

## 4. Basic Example: Read/Write Split Routing in TypeScript

In an application using read replicas, the database client must direct write queries to the primary and read queries to the replica pool:

```typescript
import { Pool } from 'pg';

// 1. Primary DB Pool (Handles writes)
const primaryPool = new Pool({ connectionString: process.env.DATABASE_PRIMARY_URL });

// 2. Read Replica Pool (Handles reads)
const replicaPool = new Pool({ connectionString: process.env.DATABASE_REPLICA_URL });

export class DatabaseRouter {
  public static async query(text: string, params: any[] = []): Promise<any> {
    const trimmed = text.trim().toUpperCase();

    // Route SELECT queries to read replicas; all mutations go to primary
    if (trimmed.startsWith('SELECT') && !trimmed.includes('FOR UPDATE')) {
      return replicaPool.query(text, params);
    } else {
      return primaryPool.query(text, params);
    }
  }
}
```

---

## 5. Real-World Production Example: Mitigating Replication Lag with "Read-Your-Own-Writes" Consistency

When a user updates their profile, reading immediately from a lagging replica shows old data. We solve this by enforcing **Read-Your-Own-Writes** consistency: after a write, route that specific user's reads to the Primary for a brief time window (e.g., 5 seconds) or until the replica catches up with the Log Sequence Number (LSN).

```typescript
import { Request, Response, NextFunction } from 'express';
import Redis from 'ioredis';
import { Pool } from 'pg';

const redis = new Redis();
const primaryDb = new Pool({ connectionString: process.env.PRIMARY_URL });
const replicaDb = new Pool({ connectionString: process.env.REPLICA_URL });

/**
 * Middleware: Detects if the requesting user recently performed a write.
 * If yes, forces queries to the Primary DB to prevent replication lag anomalies.
 */
export async function dbRoutingMiddleware(req: any, res: Response, next: NextFunction) {
  const userId = req.headers['x-user-id'] as string;

  if (userId) {
    const recentlyWritten = await redis.get(`user:recent_write:${userId}`);
    // Attach preferred DB pool to the request context
    req.db = recentlyWritten ? primaryDb : replicaDb;
    req.isUsingPrimary = !!recentlyWritten;
  } else {
    req.db = replicaDb; // Unauthenticated reads always use replicas
  }

  next();
}

// Controller mutating state
export async function updateUserProfile(req: any, res: Response) {
  const userId = req.headers['x-user-id'];
  const { name } = req.body;

  // 1. Execute write on Primary DB
  await primaryDb.query('UPDATE users SET name = $1 WHERE id = $2', [name, userId]);

  // 2. Mark this user in Redis as having written within the last 5 seconds
  // This guarantees subsequent GET requests from this user bypass lagging replicas!
  await redis.set(`user:recent_write:${userId}`, '1', 'EX', 5);

  res.json({ success: true, message: 'Profile updated' });
}
```

---

## 6. Under the Hood: Sharding Strategies Compared

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. Hash-Based Sharding (Algorithmic / Modulo)                          │
│ Shard ID = Hash(Shard_Key) % Total_Shards                              │
│ Pros: Perfectly uniform data and traffic distribution across nodes.    │
│ Cons: Adding a new shard requires massive re-sharding of all keys      │
│       (mitigated by Consistent Hashing). Multi-shard queries are slow. │
├────────────────────────────────────────────────────────────────────────┤
│ 2. Range-Based Sharding                                                │
│ Shard 1: Users [A - F], Shard 2: [G - M], Shard 3: [N - Z]             │
│ (Or by date: 2024 Shard, 2025 Shard, 2026 Shard)                       │
│ Pros: Easy range queries (`WHERE created_at BETWEEN X AND Y`).         │
│ Cons: Severe hot spots! All current writes hammer the newest shard     │
│       while old shards sit idle.                                       │
├────────────────────────────────────────────────────────────────────────┤
│ 3. Directory-Based (Lookup) Sharding                                   │
│ A centralized lookup service maps: `user_123 -> Shard 4`.              │
│ Pros: Complete flexibility; move individual accounts without rehash.   │
│ Cons: The lookup service becomes a single point of failure and         │
│       performance bottleneck (requires local caching).                 │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Important Rules

1. **Shard Key Selection is Irreversible**: Choosing the wrong shard key is the most expensive mistake in distributed systems. A good shard key must have **high cardinality** and **uniform access distribution**.
   - *Good*: `user_id`, `tenant_id`, `account_id`.
   - *Terrible*: `country` (80% of users in US creates a giant hot shard), `created_at` (all writes hammer today's date shard).
2. **Avoid Cross-Shard Transactions (Distributed ACID)**: Executing a transaction that updates rows across Shard A and Shard B requires **Two-Phase Commit (2PC)**, which introduces network locking, high latency, and coordinator failure risks. Design schemas so that related data (e.g., a User and their Orders) share the same Shard Key and colocate on the exact same physical shard.
3. **Avoid Cross-Shard Joins**: Relational databases cannot join tables located on different physical network instances. If you join `orders` and `products`, either denormalize product data into the `orders` table or perform the join in application memory.
4. **Account for Replication Lag in Financial Logic**: Never execute balance deductions or payment verification against a read replica. All financial checks and inventory reservations must execute on the **Primary** node within serializable or row-level locked transactions (`SELECT ... FOR UPDATE`).
5. **Replication Topologies**:
   - **Asynchronous Replication (Standard)**: Primary writes to local disk, returns success to client immediately, sends WAL to replicas in background. *Pro*: Fast. *Con*: If primary crashes before replica receives WAL, data is permanently lost.
   - **Semi-Synchronous Replication**: Primary commits only after at least *one* replica acknowledges writing the WAL to disk. Balances durability with write latency.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Sharding Prematurely
Introducing database sharding for an application with 500,000 rows. Sharding introduces immense operational complexity (cross-shard queries, complex migrations, re-sharding tooling). A single optimized PostgreSQL instance with proper indexes and read replicas can comfortably handle 100+ million rows.

### 2. The Celebrity Hot Spot Problem
In a social network sharded by `user_id`, a regular user has 200 followers (small shard load), while a celebrity has 80,000,000 followers. Every post by the celebrity overloads their assigned shard.
*Remediation*: Detect celebrity accounts and handle their fans/posts via dedicated caching tiers or fan-out worker queues.

### 3. Infinite Growth without Re-Sharding Plans
Choosing fixed modulo sharding (`hash % 4`). When capacity reaches 100%, migrating to 8 shards requires migrating 50% of the entire database across the network. Always design with **Virtual Shards** (e.g., 1,024 logical shards mapped to 4 physical machines; scale by reassigning logical shards to new machines).

---

## 9. Best Practices

- **Use Connection Pooling Proxies (PgBouncer / AWS RDS Proxy)**:
  Directly connecting 200 application containers to 8 database shards results in 1,600 open connections per container, crashing databases. Deploy PgBouncer to multiplex client connections.
- **Automated Failover with Consensus (Patroni / Orchestrator)**:
  Never manage primary-replica failovers manually. Use high-availability tools like **Patroni** (which uses Etcd/Consul consensus) to automatically elect a new primary replica if the current primary stops heartbeating for 10 seconds.

---

## 10. Performance Considerations

- **WAL Archiving & Network Saturation**: High-volume write transactions generate gigabytes of Write-Ahead Logs per minute. Ensure replication network interfaces have dedicated 10Gbps+ private links to prevent replication lag spikes during heavy writes.
- **Secondary Indexing on Sharded Tables**: Secondary indexes on non-shard keys require querying **every single shard in parallel** (a "Scatter-Gather" query). If a table is sharded by `user_id`, searching `WHERE email = '...'` forces the application to query all 16 shards and aggregate results.

---

## 11. Security Considerations

- **Encrypted Replication Streams**: Replication data streams contain raw, unencrypted database rows traveling across the network. Always enforce SSL/TLS encryption for all inter-node database replication connections (`sslmode=require`).

---

## 12. Replication vs. Sharding Comparison Matrix

| Dimension | Primary-Replica Replication | Horizontal Sharding |
| :--- | :--- | :--- |
| **Primary Scaling Target**| Read Throughput ($QPS_{read}$) | Write Throughput ($QPS_{write}$) & Disk Space |
| **Data Distribution** | Every node holds 100% of data | Each node holds $1/N$ of data |
| **Write Scaling** | Does NOT scale writes | Scales writes linearly |
| **Complexity** | Low to Moderate | Very High |
| **Cross-Node Joins** | Supported natively | Broken / Not supported |
| **Consistency** | Eventual consistency on replicas | Strong consistency within a single shard |

---

## 13. Trade-offs

- **Strong Consistency vs. Read Scalability**: Using synchronous replication guarantees zero data loss, but every write must wait for network acknowledgments from replicas, severely throttling write latency. Asynchronous replication is fast, but risks stale reads and data loss during failover.
- **Shard Autonomy vs. Global Queries**: Sharding makes single-shard operations blisteringly fast, but global aggregations (e.g., `SELECT COUNT(*) FROM all_users`) require querying all shards and merging results in application memory.

---

## 14. Real-World Usage Case Studies

1. **Notion**: Transitioned from a single monolithic PostgreSQL database to 32 horizontally sharded PostgreSQL instances using a custom application-level sharding router based on `workspace_id`.
2. **Pinterest**: Sharded their database into hundreds of MySQL virtual shards keyed by `user_id`. All pins, boards, and likes belonging to a user live on the same physical shard, eliminating distributed joins.

---

## 15. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: What is the main difference between Read Replication and Database Sharding?**
> **Answer**: **Read Replication** copies the entire database to one or more read-only replica nodes to scale read throughput; all writes still hit the single primary node. **Database Sharding** divides the data into distinct, non-overlapping partitions across multiple physical database servers, scaling both write throughput and storage capacity.

### Tier 2: Conceptual
**Q: What is "Replication Lag" and what problems does it cause in web applications?**
> **Answer**: Replication lag is the delay between a transaction committing on the primary database and that same transaction being replayed on a read replica. It causes consistency anomalies, most notably violating **Read-Your-Own-Writes consistency**: a user submits a form (e.g., changes their username), the write commits on the primary, but the user is immediately redirected to a page that reads from a lagging replica, causing the user to see their old username and believe the update failed.

### Tier 3: Implementation
**Q: How do you implement a simple Hash-Based Sharding router in application code?**
> **Answer**:
> ```typescript
> function getShardIndex(shardKey: string, totalShards: number): number {
>   const hash = crypto.createHash('md5').update(shardKey).digest().readUInt32BE(0);
>   return hash % totalShards;
> }
> ```

### Tier 4: Debugging
**Q: In a sharded database architecture, a query `SELECT * FROM orders WHERE status = 'PENDING'` takes 10 seconds to execute, while `SELECT * FROM orders WHERE user_id = $1` takes 2ms. What is the cause?**
> **Answer**: The database is sharded on `user_id`. When querying with `user_id = $1`, the router directs the query to the single specific shard containing that user ($O(1)$ routing). However, when querying by `status = 'PENDING'`, the router does not know which shard holds pending orders. It must execute a **Scatter-Gather query**: it sends the query to *all* physical shards in parallel, waits for all network responses, and merges them. The slowest shard determines overall query latency.

### Tier 5: Scenario
**Q: You are designing the database architecture for a global Ride-Sharing platform (like Uber). How would you shard the trip data?**
> **Answer**:
> 1. Do not shard by `user_id` or `driver_id` because a trip involves both a rider and a driver who may be on different shards.
> 2. **Shard by City / Geohash**: Physical rides are strictly localized (a ride in Paris has no relation to a ride in New York).
> 3. Store all trips, riders, and active drivers for a metropolitan area in the same regional shard (`city_id`).
> 4. This guarantees that all driver matching, dispatching, and pricing queries execute locally on a single shard with zero cross-shard transactions.

### Tier 6: Advanced
**Q: How does Virtual Sharding (Consistent Hashing) solve the re-sharding problem when scaling from 4 to 8 physical database machines?**
> **Answer**:
> In naive modulo sharding (`hash % 4`), changing to `hash % 8` causes almost 100% of all data to change shards, requiring an impossible global migration.
> **Virtual Sharding**:
> 1. Partition the database into a large, fixed number of **Virtual Shards** (e.g., 1,024 virtual schemas: `shard_0000` to `shard_1023`).
> 2. Map virtual shards to physical nodes using a routing table: Physical Machine 1 holds shards 0–255; Machine 2 holds 256–511, etc.
> 3. To scale from 4 to 8 machines, simply provision 4 new machines and move 128 virtual schemas from each existing machine to the new machines. The application's hashing logic (`hash % 1024`) never changes, and data movement is isolated and predictable.

---

## 16. Coding Question: Consistent Shard Router with Virtual Node Allocation

### Problem
Write a TypeScript `ShardRouter` class that:
1. Maps an array of physical database connection strings to a consistent hash ring.
2. Given a `shardKey` (e.g., `userId`), routes the query to the correct database connection.
3. Dynamically adds a new physical shard node while remapping minimal keys.

### Solution

```typescript
import crypto from 'crypto';

export class ShardRouter {
  private ring: Map<number, string> = new Map();
  private sortedHashes: number[] = [];
  private vnodeCount: number;

  constructor(nodes: string[], vnodeCount: number = 50) {
    this.vnodeCount = vnodeCount;
    nodes.forEach((node) => this.addNode(node));
  }

  private hash(str: string): number {
    return crypto.createHash('sha256').update(str).digest().readUInt32BE(0);
  }

  public addNode(node: string): void {
    for (let i = 0; i < this.vnodeCount; i++) {
      const vnodeKey = `${node}:vnode:${i}`;
      const h = this.hash(vnodeKey);
      this.ring.set(h, node);
      this.sortedHashes.push(h);
    }
    this.sortedHashes.sort((a, b) => a - b);
  }

  public route(shardKey: string): string {
    if (this.sortedHashes.length === 0) throw new Error('No shards available');

    const h = this.hash(shardKey);

    // Binary search for first hash >= h
    let low = 0;
    let high = this.sortedHashes.length - 1;

    if (h > this.sortedHashes[high]) {
      return this.ring.get(this.sortedHashes[0])!;
    }

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.sortedHashes[mid] >= h) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    return this.ring.get(this.sortedHashes[low])!;
  }
}

// ==========================================
// Demonstration
// ==========================================
const router = new ShardRouter([
  'postgres://db-shard-1:5432/data',
  'postgres://db-shard-2:5432/data',
  'postgres://db-shard-3:5432/data',
]);

console.log('User usr_101 routes to:', router.route('usr_101'));
console.log('User usr_202 routes to:', router.route('usr_202'));
```

---

## 17. Common Interview Traps

- **Trap 1**: Thinking read replicas can scale write-heavy applications.
  *Gotcha*: Adding 20 read replicas will actually *decrease* write throughput, because the primary must spend CPU cycles broadcasting write-ahead logs to 20 destinations. Writes can only be scaled by **Sharding**.
- **Trap 2**: Sharding on an auto-incrementing integer ID or timestamp.
  *Gotcha*: If you shard by auto-incrementing ID or timestamp, all new records will have the highest values and route to the newest shard, creating an extreme write hot spot while older shards sit idle.
- **Trap 3**: Believing sharding maintains relational foreign keys across shards.
  *Gotcha*: Relational database engines cannot enforce foreign key constraints across different physical network instances. Foreign key integrity across shards must be managed entirely in application code.

---

## 18. Revision Summary

- **Read Replicas**: Scales read throughput ($QPS_{read}$); does not scale writes; vulnerable to replication lag.
- **Read-Your-Own-Writes**: Route recently updated users to the Primary for a brief window to prevent stale data anomalies.
- **Horizontal Sharding**: Scales write throughput and storage capacity by partitioning data across independent physical instances using a Shard Key.
- **Shard Key Rules**: High cardinality, uniform access distribution; avoid cross-shard joins and distributed two-phase commits.
- **Virtual Sharding**: Use consistent hashing or virtual schemas to enable seamless re-sharding without global data migration.

---

## 19. Quick Reference

| Problem | Scaling Strategy | Key Advantage | Major Trade-off |
| :--- | :--- | :--- | :--- |
| **High Read Volume** | Read Replicas | Linear read scale ($QPS$) | Replication lag / Stale reads |
| **High Write Volume**| Horizontal Sharding | Linear write scale ($QPS$) | No cross-shard joins / ACID |
| **Storage Exceeds RAM**| Sharding by Entity ID | Smaller indexes fit in RAM | High operational complexity |
| **Replication Lag** | Read-Your-Own-Writes | Consistent UX after writes | Increases primary read load |
| **Scatter-Gather** | Cross-shard secondary query| Allows searching non-shard keys | Slowest node bottleneck |
