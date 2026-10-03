# Database Categorization: Relational, Document, Key-Value, Wide-Column, and Graph Systems

---

## 1. What is it?

In full-stack backend and distributed systems engineering, **Database Categorization** is the taxonomy of data storage engines grouped by their underlying data model, storage architecture, consistency guarantees, and retrieval mechanisms.

The database landscape is broadly divided into two major paradigms:
1. **Relational Database Management Systems (RDBMS / SQL)**: Organizes data into structured two-dimensional tables with predefined schemas, mathematical relations, primary/foreign key constraints, and strict **ACID** (Atomicity, Consistency, Isolation, Durability) guarantees (e.g., **PostgreSQL**, **MySQL**).
2. **Non-Relational Databases (NoSQL)**: Engineered to handle unstructured or semi-structured data, dynamic schemas, and massive horizontal scaling across distributed clusters. NoSQL systems are classified into four distinct architectural families:
   - **Document Stores**: Persist self-contained hierarchical documents (JSON/BSON) (e.g., **MongoDB**, **CouchDB**).
   - **Key-Value Stores**: Blisteringly fast $O(1)$ dictionary lookups indexed by a unique key (e.g., **Redis**, **Memcached**).
   - **Wide-Column / Column-Family Stores**: Optimized for high write throughput and analytical scans over petabytes of data (e.g., **Apache Cassandra**, **ScyllaDB**).
   - **Graph Databases**: Model highly connected networks using nodes, edges, and properties with index-free adjacency (e.g., **Neo4j**).

```
+-------------------------------------------------------------------------------+
|                       THE 5 MAJOR DATABASE PARADIGMS                          |
+-------------------------------------------------------------------------------+
| Category      | Primary Data Unit | Storage Engine    | Primary Use Case      |
+---------------+-------------------+-------------------+-----------------------+
| Relational    | Rows in Tables    | B-Tree / WAL      | Financial ledgers,    |
| (PostgreSQL)  | (Strict Schema)   |                   | E-Commerce transactions|
+---------------+-------------------+-------------------+-----------------------+
| Document      | JSON / BSON Trees | WiredTiger (B-Tree| Content management,   |
| (MongoDB)     | (Flexible Schema) | / LSM)            | Catalogs, User profiles|
+---------------+-------------------+-------------------+-----------------------+
| Key-Value     | Binary byte blob  | In-Memory Dict /  | Caching, Sessions,    |
| (Redis)       | or Typed Struct   | SkipList          | Leaderboards, Locks   |
+---------------+-------------------+-------------------+-----------------------+
| Wide-Column   | Sparse Columns    | LSM-Trees /       | Time-series telemetry,|
| (Cassandra)   | grouped by Key    | SSTables          | IoT sensor logs       |
+---------------+-------------------+-------------------+-----------------------+
| Graph         | Nodes & Directed  | Index-Free        | Social networks,      |
| (Neo4j)       | Edges             | Adjacency Pointers| Fraud detection graphs|
+---------------+-------------------+-------------------+-----------------------+
```

---

## 2. Why does it exist?

In the 1970s through the 1990s, relational databases (dominated by Oracle, IBM DB2, and MySQL) were the universal default for all software applications. However, the rise of global-scale internet services (Google, Amazon, Facebook) exposed three severe limitations of purely relational databases:

1. **Horizontal Scalability Bottleneck**: RDBMS systems are built to scale **vertically** (adding bigger CPUs, more RAM, and faster NVMe drives to a single server). Sharding a relational database across 100 servers breaks ACID multi-table JOINs and foreign key constraints.
2. **Schema Inflexibility in Rapid Product Iteration**: In an e-commerce platform with 50,000 product categories (where clothing has `size` and `fabric`, but laptops have `ram` and `cpu`), modeling products in SQL requires 50 separate tables or an anti-pattern like Entity-Attribute-Value (EAV).
3. **Data Access Asymmetry**: A social network finding "friends of friends of friends" in SQL requires a 6-way recursive self-join that grinds the database engine to a halt.

Different data access patterns require specialized storage engines—a practice known as **Polyglot Persistence**.

---

## 3. Mental Model

Visualize a **National University Administrative Complex**:

- **Relational / SQL (The Registrar’s Office)**: A rigid, iron filing cabinet with formal numbered paper ledgers. Every student record must have exact fields: First Name, Last Name, Student ID, GPA. If you attempt to write on a line without an ID, the registrar rejects it (**Integrity Constraint**). Every tuition payment balances perfectly to the penny (**ACID**).
- **Document Store (The Admissions Portfolio Room)**: A collection of cardboard boxes labeled by applicant. Inside Alice's box is a 5-page resume, 2 recommendation letters, and a PDF essay. Inside Bob's box is a single index card. Each box is completely self-contained (**Flexible BSON Document**).
- **Key-Value Store (The Campus Locker Room)**: 10,000 identical steel lockers with digital combination locks. You punch in `#402` and the door pops open in 0.001 seconds (**O(1) Redis Lookup**). You don't inspect what's inside other lockers; you just grab your coat and leave.
- **Wide-Column Store (The University Weather Sensor Station)**: An automated machine recording temperature, humidity, and wind speed every 2 seconds for 10 years (**Time-Series Telemetry**). It writes billions of sensor lines continuously at 50,000 writes/sec without stopping to index or relate them to students.
- **Graph Database (The Student Social Club / Alumni Network)**: A giant corkboard with pushpins (Students) connected by colored strings of yarn (Relationships: *"Alice is roommates with Bob"*, *"Bob is in the same fraternity as Charlie"*). Finding the shortest path between Alice and Charlie is just following the string (**Index-Free Adjacency**).

---

## 4. Basic Comparison Example

### 4.1 How Data is Stored Across Models
Consider modeling a **User Profile with Multiple Addresses**:

#### Relational (PostgreSQL) — Normalized across 2 Tables
```sql
-- Table 1: users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL
);

-- Table 2: addresses (Foreign Key Relationship)
CREATE TABLE addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  street VARCHAR(255) NOT NULL,
  city VARCHAR(100) NOT NULL
);
```

#### Document Store (MongoDB) — Embedded Tree in 1 Document
```json
{
  "_id": "64f1a2b3c4d5e6f7a8b9c0d1",
  "email": "alice@example.com",
  "name": "Alice Smith",
  "addresses": [
    { "street": "123 Main St", "city": "New York" },
    { "street": "456 Market St", "city": "San Francisco" }
  ]
}
```

#### Key-Value (Redis) — Serialized String or Hash
```bash
# Store as raw JSON string with 1-hour expiration
SET user:usr_102 '{"email":"alice@example.com","name":"Alice"}' EX 3600
```

---

## 5. Real Example

### Polyglot Persistence Architecture in an E-Commerce Platform
Modern production systems do not pick a single database. They combine multiple databases according to their operational strengths:

```
+-------------------------------------------------------------------------------+
|                       POLYGLOT PERSISTENCE ARCHITECTURE                       |
+-------------------------------------------------------------------------------+
| [ Inbound User Traffic ]                                                      |
|           |                                                                   |
|           +---> 1. Fast Session & Rate Limiting  -----> [ Redis (Key-Value) ] |
|           |                                                                   |
|           +---> 2. Dynamic Product Catalog Search ----> [ MongoDB (Document)] |
|           |                                                                   |
|           +---> 3. Financial Checkout & Orders -------> [ PostgreSQL (RDBMS) ]|
|           |                                                                   |
|           +---> 4. "Users who bought X also bought Y"-> [ Neo4j (Graph) ]     |
|           |                                                                   |
|           +---> 5. Clickstream Analytics & Logs ------> [ Cassandra / ClickH ]|
+-------------------------------------------------------------------------------+
```

```typescript
// polyglot-client.ts
import { Pool } from "pg";
import { MongoClient } from "mongodb";
import Redis from "ioredis";

export class PolyglotDataService {
  private pgPool: Pool;
  private mongoClient: MongoClient;
  private redis: Redis;

  constructor() {
    this.pgPool = new Pool({ connectionString: process.env.POSTGRES_URL });
    this.mongoClient = new MongoClient(process.env.MONGO_URL || "mongodb://localhost:27017");
    this.redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");
  }

  /**
   * 1. High-speed cached reads from Redis
   */
  async getCachedProduct(productId: string) {
    const cached = await this.redis.get(`product:${productId}`);
    if (cached) return JSON.parse(cached);

    // Fallback: Read dynamic document from MongoDB
    const doc = await this.mongoClient
      .db("store")
      .collection("products")
      .findOne({ _id: productId as any });

    if (doc) {
      await this.redis.set(`product:${productId}`, JSON.stringify(doc), "EX", 300);
    }
    return doc;
  }

  /**
   * 2. ACID Financial Transaction in PostgreSQL
   */
  async executeOrder(userId: string, productId: string, amountCents: number) {
    const client = await this.pgPool.connect();
    try {
      await client.query("BEGIN"); // ACID Atomicity

      // Deduct inventory
      const res = await client.query(
        "UPDATE inventory SET stock = stock - 1 WHERE product_id = $1 AND stock > 0 RETURNING stock",
        [productId]
      );
      if (res.rowCount === 0) throw new Error("Out of stock");

      // Insert financial ledger record
      await client.query(
        "INSERT INTO orders (user_id, product_id, amount_cents) VALUES ($1, $2, $3)",
        [userId, productId, amountCents]
      );

      await client.query("COMMIT");
      return { success: true };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
```

---

## 6. Under the Hood

### 6.1 The CAP Theorem
Formulated by Eric Brewer, the **CAP Theorem** states that in any asynchronous distributed network, a distributed data store can guarantee at most **two out of the following three properties**:

```
                  Consistency (C)
                     /       \
                    /         \
                   /   RDBMS   \
                  /  (Postgres) \
                 /               \
                /                 \
  Availability (A) --------------- Partition Tolerance (P)
     (Cassandra)                      (MongoDB)
```

1. **Consistency (C)**: Every read receives the most recent write or an error. (Linearizability).
2. **Availability (A)**: Every non-failing node returns a non-error response for every request (no guarantee it's the latest write).
3. **Partition Tolerance (P)**: The system continues to operate despite an arbitrary number of messages dropped or delayed by the network between nodes.

**The Cold Truth**: In real-world physical networks, **network partitions are an unavoidable law of physics** (undersea cables get cut, switches fail). Therefore, a distributed system must choose between:
- **CP (Consistency + Partition Tolerance)**: When a network partition occurs, reject writes or wait for consensus to prevent stale data (e.g., **MongoDB Primary/Secondary**, **HBase**, **Consul**).
- **AP (Availability + Partition Tolerance)**: When a network partition occurs, accept writes on all available nodes; reconcile conflicting data later via eventual consistency (e.g., **Cassandra**, **CouchDB**, **DynamoDB**).
- *(Note: Traditional single-node PostgreSQL is **CA**, but once clustered across a network, it must pick CP or AP!)*

### 6.2 PACELC Theorem (The Extension to CAP)
CAP only describes behavior *during a network partition*. The **PACELC Theorem** asks what happens during normal operation:
$$\text{If } \mathbf{P} \text{ (Partition): Choose } \mathbf{A} \text{ or } \mathbf{C}; \quad \mathbf{E} \text{ (Else / Normal): Choose } \mathbf{L} \text{ (Latency) or } \mathbf{C} \text{ (Consistency)}$$
- **MongoDB**: PC / EC (Consistent during partitions, Consistent during normal times at the cost of higher latency).
- **Cassandra**: PA / EL (Available during partitions, Low Latency during normal times via eventual consistency).

### 6.3 ACID vs BASE

```
+-------------------------------------------------------------------------------+
|                       ACID (SQL) vs BASE (NoSQL)                              |
+-------------------------------------------------------------------------------+
| ACID (Pessimistic & Strict)           | BASE (Optimistic & Resilient)         |
+---------------------------------------+---------------------------------------+
| Atomicity (All or nothing)            | Basically Available (System remains   |
| Consistency (Rules/Invariants upheld) |   operational despite node failures)  |
| Isolation (Transactions don't clash)  | Soft State (Data state may float      |
| Durability (Committed data survives)  |   without active user interaction)    |
|                                       | Eventual Consistency (Data converges  |
|                                       |   across all nodes over time)         |
+---------------------------------------+---------------------------------------+
```

---

## 7. Important Rules

1. **Financial and Accounting Data Belongs in an ACID RDBMS**: Never store primary financial ledgers or inventory deduction logs in an eventually consistent NoSQL database. A network partition could allow double-spending.
2. **Key-Value Stores Are Not File Cabinets**: Redis stores data in RAM. RAM is $10\times$ more expensive per gigabyte than NVMe SSDs. Do not use Redis as your primary store for 500GB of user photos or logs.
3. **Avoid Emulating Relational JOINs in NoSQL**: If your application code repeatedly calls MongoDB to fetch an Order, then loops over 20 items and makes 20 separate MongoDB queries to fetch each Product, you are emulating an RDBMS JOIN poorly in application memory ($O(N)$ network latency!). Use PostgreSQL.
4. **Graph Databases Shine on Many-to-Many Relationships**: If your query involves traversing 3 or more degrees of relationships (`User -> Friends -> Liked Pages -> Recommended Events`), a Graph database will execute $1,000\times$ faster than SQL recursive joins.

---

## 8. Common Mistakes

### Mistake 1: Choosing MongoDB "Because We Don't Know the Schema Yet"
Many startups choose MongoDB believing flexible schemas mean they don't have to design data models. Within 6 months, their database contains documents with mismatched field names (`userId`, `user_id`, `id`), corrupted types, and missing indexes. Every database requires strict schema modeling; MongoDB simply enforces schema in application code (Mongoose) rather than in the database engine.

### Mistake 2: Using Redis without Eviction Policies or TTLs
Using Redis without setting `maxmemory-policy` (e.g., `allkeys-lru`) and omitting TTLs on keys causes Redis to consume 100% of host RAM, resulting in the Linux OOM-killer sending `SIGKILL` to the database.

---

## 9. Best Practices

1. **Default to PostgreSQL for 80% of Applications**: Modern PostgreSQL supports relational tables, JSONB document querying, full-text search, and vector embeddings (`pgvector`). Start with PostgreSQL until a proven scaling bottleneck demands a specialized NoSQL engine.
2. **Use CQRS to Split Models**: Write to an ACID PostgreSQL database; publish an event to sync an Elasticsearch / MongoDB read-model optimized for complex frontend search filters.
3. **Monitor Replication Lag**: In distributed NoSQL clusters (MongoDB / Cassandra), monitor replication lag metrics. A high replication lag means reads from replica nodes will return severely stale data.

---

## 10. Performance Considerations

```
+-------------------------------------------------------------------------------+
|                       DATABASE ENGINE PERFORMANCE PROFILES                    |
+-------------------------------------------------------------------------------+
| Database              | Read Latency   | Write Latency  | Primary Bottleneck  |
+-----------------------+----------------+----------------+---------------------+
| Redis (In-Memory)     | < 0.2 ms       | < 0.2 ms       | RAM Capacity / Net  |
| MongoDB (Indexed BSON)| 1.0 - 5.0 ms   | 2.0 - 8.0 ms   | Disk I/O / Cache    |
| PostgreSQL (Relational| 1.0 - 8.0 ms   | 3.0 - 15.0 ms  | Lock contention/WAL |
| Cassandra (Wide-Column| 5.0 - 20.0 ms  | 0.5 - 2.0 ms 🚀| Read repairs / Disk |
+-----------------------+----------------+----------------+---------------------+
```

- **Cassandra Write Superiority**: Cassandra appends writes sequentially to an in-memory `Memtable` and an on-disk commit log without reading before writing, giving it astronomical write speeds (100,000+ writes/sec on modest hardware).

---

## 11. Security Considerations

1. **NoSQL Injection**: Just as SQL is vulnerable to SQL injection, MongoDB is vulnerable to **Operator Injection** if raw JSON input like `{ "username": "admin", "password": { "$gt": "" } }` is passed into `db.users.find()`. Always validate and sanitize inputs with Zod.
2. **Redis Default Bindings**: Redis historically bound to `0.0.0.0` with no password by default. Thousands of servers were compromised by ransomware simply scanning port 6379 on the public internet. Always configure `requirepass` and bind exclusively to private VPC subnets.

---

## 12. Alternatives: Decision Matrix

| Requirement | Best Database Choice | Why? |
| :--- | :--- | :--- |
| **Financial Ledgers, Invoices, Orders** | **PostgreSQL / MySQL** | ACID transactions, strict schema constraints. |
| **User Sessions, Caching, Rate Limiting** | **Redis** | In-memory sub-millisecond $O(1)$ operations, TTLs. |
| **Dynamic Product Catalog, CMS** | **MongoDB** | Self-contained nested documents, flexible schema. |
| **IoT Sensor Telemetry, Audit Logs** | **Cassandra / ClickHouse** | Massive write throughput, distributed sharding. |
| **Social Follows, Fraud Networks** | **Neo4j** | Traversing deep relationships without SQL joins. |

---

## 13. Trade-offs

- **Normalized SQL vs Denormalized NoSQL**:
  - *Normalized SQL*: Single source of truth. Updating a user's name updates 1 row; all related orders immediately reflect the new name. However, reading an order requires multi-table JOINs.
  - *Denormalized NoSQL*: All order and customer data embedded in one document. Blisteringly fast $O(1)$ reads. However, updating a user's name requires updating 500 historical order documents.

---

## 14. Real-World Usage

- **Instagram**: Uses PostgreSQL for user accounts and media metadata, Cassandra for the activity feed, and Redis for caching and follower counts.
- **Uber**: Uses Schemaless (built on MySQL) for trip data, Redis for driver geo-locations, and Apache Kafka for real-time ride event streams.

---

## 15. Placement Interview Questions

### 15.1 Basic Questions
1. *What are the four primary types of NoSQL databases?*
   - Answer: Document stores (MongoDB), Key-Value stores (Redis), Wide-Column stores (Cassandra), and Graph databases (Neo4j).
2. *What does ACID stand for in relational databases?*
   - Answer: Atomicity (all-or-nothing), Consistency (rules and constraints upheld), Isolation (concurrent transactions execute independently), and Durability (committed data survives server crashes).

### 15.2 Conceptual Questions
3. *Explain the CAP Theorem and explain why a distributed system cannot be both CA and P.*
   - Answer: The CAP theorem states that a distributed system can guarantee at most two out of Consistency, Availability, and Partition Tolerance. In physical networks, network partitions (delays, broken links, dropped packets) are an unavoidable reality. When a network partition occurs, the system must either stop accepting writes to guarantee consistency (CP) or accept writes on isolated nodes and allow stale reads to guarantee availability (AP). A "CA" system is impossible in a distributed environment because it ignores the physical reality of partitions.
4. *What is the difference between Vertical Scaling and Horizontal Scaling in databases?*
   - Answer: Vertical Scaling (Scale Up) means increasing the computing power of a single server (adding more CPU cores, RAM, and SSD storage). Horizontal Scaling (Scale Out) means distributing database load across multiple commodity servers (nodes) organized in a cluster using sharding and replication.

### 15.3 Implementation Questions
5. *How do you model a Many-to-Many relationship in MongoDB versus PostgreSQL?*
   - Answer: In PostgreSQL, create a junction table (e.g. `student_courses` with `student_id` and `course_id` foreign keys). In MongoDB, either store an array of ObjectIds inside the document (`student.courseIds: [id1, id2]`), or if the list grows unboundedly, create a separate collection referencing both IDs.

### 15.4 Debugging Questions
6. *A high-traffic e-commerce database on MongoDB experiences occasional inventory count discrepancies (selling 11 items when only 10 existed in stock). What is the architectural bug?*
   - Answer: The inventory check and update were executed as two non-atomic operations (e.g. `find()` followed by `updateOne()`). Concurrent requests read the same stock count before either updated it. To fix this, use atomic operators like `findOneAndUpdate({ _id: prodId, stock: { $gt: 0 } }, { $inc: { stock: -1 } })` or multi-document ACID transactions.

### 15.5 Scenario Questions
7. *Design the storage architecture for an enterprise ride-sharing platform like Uber.*
   - Answer:
     - **Driver Real-Time Geo-Tracking**: Redis using `GEOADD` and `GEORADIUS` for sub-millisecond nearby driver lookups with fast expiration.
     - **User Profiles & Billing/Payments**: PostgreSQL for strict ACID compliance and financial consistency.
     - **Ride History & Telemetry**: Apache Cassandra / ClickHouse for massive, uninterrupted write throughput of GPS breadcrumbs.
     - **Fraud Detection**: Neo4j graph database to detect rings of drivers and riders colluding on false credit card promotions.

### 15.6 Advanced Questions
8. *What is "Index-Free Adjacency" in Graph Databases and why is it faster than relational joins?*
   - Answer: In a relational database, joining Table A to Table B requires looking up foreign keys in an index ($O(\log N)$ operation per row). In a graph database with index-free adjacency, each node maintains direct physical memory pointers to its neighboring nodes on disk/RAM. Traversing a relationship is a direct $O(1)$ pointer dereference, meaning graph traversal speed is completely independent of the total size of the database.

---

## 16. Coding Questions

### Problem 1: Implement an In-Memory Key-Value Store with TTL and Eviction
**Question**: Write a TypeScript `InMemoryKV` class replicating basic Redis key-value functionality, supporting `.set(key, val, ttlSeconds)`, `.get(key)`, and `.delete(key)`, while automatically purging expired keys without memory leaks.

```typescript
// in-memory-kv.ts

interface StoreItem<T> {
  value: T;
  expiresAt: number | null;
}

export class InMemoryKV<T = any> {
  private store = new Map<string, StoreItem<T>>();

  constructor() {
    // Background garbage collection sweep every 30 seconds
    setInterval(() => this.purgeExpired(), 30000).unref();
  }

  public set(key: string, value: T, ttlSeconds?: number): void {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
  }

  public get(key: string): T | null {
    const item = this.store.get(key);
    if (!item) return null;

    // Check TTL expiration on read
    if (item.expiresAt !== null && Date.now() > item.expiresAt) {
      this.store.delete(key);
      return null;
    }

    return item.value;
  }

  public delete(key: string): boolean {
    return this.store.delete(key);
  }

  private purgeExpired(): void {
    const now = Date.now();
    for (const [key, item] of this.store.entries()) {
      if (item.expiresAt !== null && now > item.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

// Verification Test
const kv = new InMemoryKV<string>();
kv.set("session:1", "UserAlice", 2); // 2-second TTL
kv.set("session:2", "UserBob");     // No TTL

console.log("Immediate read session:1:", kv.get("session:1")); // UserAlice
console.log("Immediate read session:2:", kv.get("session:2")); // UserBob

// Simulate expiration
setTimeout(() => {
  console.log("After 3s read session:1 (expected null):", kv.get("session:1")); // null
  console.log("After 3s read session:2 (expected UserBob):", kv.get("session:2")); // UserBob
}, 3000);
```

---

## 17. Common Interview Traps

- **Trap 1**: "Is MongoDB strictly eventually consistent?"
  - *Reality*: No! MongoDB replica sets are strongly consistent by default on the primary node. Reads from the primary node guarantee read-your-writes consistency. Eventual consistency only occurs if you explicitly configure read preferences to secondary nodes (`readPreference: 'secondary'`).
- **Trap 2**: "Does NoSQL mean 'No SQL'?"
  - *Reality*: No. NoSQL stands for **"Not Only SQL"**. Many modern NoSQL engines (Cassandra via CQL, Couchbase via N1QL) expose SQL-like query languages.
- **Trap 3**: "Can PostgreSQL handle JSON documents?"
  - *Reality*: Yes! PostgreSQL's native `JSONB` data type stores decomposed binary JSON with GIN indexing support, allowing PostgreSQL to perform document-store operations often faster than native document databases.

---

## 18. Revision Summary

- **Relational (RDBMS)**: Tabular, normalized, strict schema, ACID, ideal for financial ledgers.
- **Document (MongoDB)**: Hierarchical BSON, flexible schema, fast embedded reads, horizontal sharding.
- **Key-Value (Redis)**: In-memory $O(1)$ operations, TTLs, ideal for caching, sessions, rate limiters.
- **Wide-Column (Cassandra)**: Massive write throughput via LSM-trees, linear horizontal scaling, AP system.
- **Graph (Neo4j)**: Nodes, edges, index-free adjacency, ideal for social graphs and fraud rings.
- **CAP Theorem**: Must choose between Consistency (CP) or Availability (AP) during inevitable network partitions.

---

## 19. Quick Reference

```typescript
// Relational (PostgreSQL)
await client.query("SELECT * FROM users JOIN orders ON users.id = orders.user_id");

// Document (MongoDB)
await db.collection("orders").findOne({ _id: orderId }); // Embedded document

// Key-Value (Redis)
await redis.set("cache:user:1", JSON.stringify(userData), "EX", 3600);

// Graph (Neo4j Cypher)
// MATCH (u:User {id: '1'})-[:FRIEND]->(f)-[:LIKES]->(p:Page) RETURN p
```
