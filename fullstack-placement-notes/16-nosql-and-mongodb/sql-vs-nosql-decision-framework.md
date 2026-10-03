# SQL vs. NoSQL: Architectural Decision Framework

## 1. What is it?
The **SQL vs. NoSQL Architectural Decision Framework** is a systematic, objective engineering methodology used by principal engineers and software architects to evaluate, select, and justify the optimal database technology for a given software system or microservice.

Rather than relying on dogmatic tech trends or superficial binary choices ("SQL is old, NoSQL is modern"), the decision framework evaluates multi-dimensional trade-offs across:
- **Data Model Complexity**: Relational/tabular with deep relationships vs. Hierarchical document vs. Key-Value vs. Wide-Column vs. Graph.
- **Consistency Guarantees**: Strict ACID transactions vs. BASE (Basically Available, Soft state, Eventual consistency).
- **Scale Requirements**: Vertical scaling (Scale-Up) with read replicas vs. Horizontal partitioning (Scale-Out sharding).
- **Schema Dynamics**: Static, rigid schemas requiring migration governance vs. Polymorphic, rapidly evolving document structures.
- **Query Patterns**: Complex multi-table joins and analytical aggregations vs. High-throughput single-key lookups.

```
Architectural Decision Flowchart:
                         [ Evaluate Domain Model ]
                                    |
            +-----------------------+-----------------------+
            |                                               |
  [ Deeply Relational? ]                          [ Unbounded Volume / ]
  [ Multi-table Invariants? ]                     [ Polymorphic Documents? ]
  [ Strict ACID Accounting? ]                     [ Horizontal Auto-Sharding? ]
            |                                               |
            v                                               v
    CHOOSE SQL / RDBMS                              CHOOSE NoSQL
 (PostgreSQL, MySQL, CockroachDB)               (MongoDB, DynamoDB, Cassandra)
            |                                               |
   - Normalized 3NF Schemas                        - Embedded Documents
   - Foreign Key Integrity                         - Partition Keys
   - Sub-millisecond Joins                         - Single-seek Latency
```

---

## 2. Why does it exist?
Selecting the wrong database engine early in a system's lifecycle is one of the most expensive architectural blunders in software engineering:
1. **The Distributed Join Disaster**: Choosing a NoSQL database for a deeply interconnected relational business domain (like an ERP, accounting system, or multi-vendor supply chain) forces developers to write hundreds of fragile application-level joins, resulting in network saturation, lost atomicity, and massive code complexity.
2. **The Horizontal Scalability Wall**: Choosing a traditional single-node relational database for a massive write-heavy telemetry platform (e.g., millions of IoT sensor events per second) quickly hits the physical limits of vertical hardware scaling (CPU/disk I/O limits), leading to catastrophic downtime.
3. **The Polyglot Persistence Reality**: Modern software architecture acknowledges that a single enterprise system rarely uses only one database. Systems use **Polyglot Persistence**—PostgreSQL for core transactional billing, MongoDB for flexible product catalogs, Redis for sub-millisecond caching, and Elasticsearch for fuzzy full-text discovery.

---

## 3. Mental Model
Think of SQL vs NoSQL as **A Train System vs A Fleet of Cargo Helicopters**:
- **SQL (High-Speed Train Network)**: Heavy, rigid steel tracks laid across the countryside. Laying tracks (Schema migrations) takes meticulous upfront engineering. Trains cannot turn left off the rails. However, on those tracks, they carry massive, deeply coordinated freight with mathematical precision and zero collisions (**ACID integrity and relational joins**).
- **NoSQL (Fleet of Autonomous Cargo Helicopters)**: Fast, nimble, and requiring zero tracks. You can take off and land anywhere without paving rails (**Schemaless agility**). If you need to scale from 10 to 1,000 packages, you simply dispatch 1,000 helicopters into the sky (**Horizontal sharding**). However, coordinating 1,000 helicopters in a mid-air dance without bumping into each other is complex (**Eventual consistency and race conditions**).

---

## 4. Basic Example
Contrasting the data modeling paradigms:

```sql
-- SQL (PostgreSQL): Normalized, Relational, Strict Constraints
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL
);

CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  total NUMERIC(10, 2) NOT NULL CHECK (total >= 0)
);

CREATE TABLE order_items (
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  quantity INT NOT NULL CHECK (quantity > 0),
  PRIMARY KEY (order_id, product_id)
);
```

```javascript
// NoSQL (MongoDB): Denormalized, Self-Contained Document
db.orders.insertOne({
  _id: ObjectId("..."),
  customerId: ObjectId("..."),
  customerName: "Alice Smith", // Embedded display data
  total: 1299.99,
  status: "COMPLETED",
  items: [
    { productId: ObjectId("..."), sku: "LAPTOP-01", qty: 1, unitPrice: 1299.99 }
  ],
  createdAt: ISODate("2026-03-01T12:00:00Z")
});
```

---

## 5. Real Example: Polyglot Persistence Architecture in Production TypeScript
A production TypeScript architecture demonstrating how enterprise platforms use **PostgreSQL for core ACID ledgers** and **MongoDB for flexible product specifications**:

```typescript
import { PoolClient } from 'pg';
import { dbPool } from './sqlDb';
import { MongoClient, ObjectId } from 'mongodb';

const mongoClient = new MongoClient(process.env.MONGO_URI!);

export class ECommerceOrderOrchestrator {
  /**
   * POLYGLOT PERSISTENCE WORKFLOW:
   * 1. Read flexible, polymorphic product metadata from MongoDB (NoSQL)
   * 2. Execute strict, atomic financial deduction and order placement in PostgreSQL (SQL)
   */
  public static async processOrder(
    userId: string,
    productId: string,
    quantity: number
  ): Promise<{ orderId: string; status: 'COMPLETED' }> {
    // 1. Fetch document from MongoDB Product Catalog (Polymorphic attributes)
    await mongoClient.connect();
    const catalogDb = mongoClient.db('catalog');
    const productDoc = await catalogDb.collection('products').findOne({
      _id: new ObjectId(productId)
    });

    if (!productDoc || productDoc.status !== 'ACTIVE') {
      throw new Error('Product is unavailable or does not exist');
    }

    const unitPrice = productDoc.pricing.currentPrice;
    const totalAmount = unitPrice * quantity;

    // 2. Execute financial transaction in PostgreSQL with strict ACID guarantees
    const sqlClient: PoolClient = await dbPool.connect();

    try {
      await sqlClient.query('BEGIN ISOLATION LEVEL READ COMMITTED');

      // Check and debit user wallet with pessimistic row lock
      const walletRes = await sqlClient.query(
        'UPDATE user_wallets SET balance = balance - $1 WHERE user_id = $2 AND balance >= $1 RETURNING balance',
        [totalAmount, userId]
      );

      if (walletRes.rowCount === 0) {
        throw new Error('Insufficient wallet funds');
      }

      // Record financial order in relational ledger
      const orderRes = await sqlClient.query(
        `INSERT INTO orders (user_id, product_id, quantity, unit_price, total_amount, status)
         VALUES ($1, $2, $3, $4, $5, 'PAID')
         RETURNING id`,
        [userId, productId, quantity, unitPrice, totalAmount]
      );

      await sqlClient.query('COMMIT');

      return {
        orderId: orderRes.rows[0].id,
        status: 'COMPLETED'
      };
    } catch (error) {
      await sqlClient.query('ROLLBACK');
      throw error;
    } finally {
      sqlClient.release();
    }
  }
}
```

---

## 6. Under the Hood

### 1. CAP Theorem and PACELC Trade-offs
In distributed systems, database architectures are mathematically bounded by the **CAP Theorem**:
- **Consistency ($C$)**: Every read receives the most recent write or an error.
- **Availability ($A$)**: Every non-failing node returns a response (without guarantee that it contains the most recent write).
- **Partition Tolerance ($P$)**: The system continues to operate despite arbitrary network message loss or network partitions.
- **Rule**: In a distributed network, network partitions ($P$) are inevitable. You **must choose between CP or AP**:
  - **CP Systems (MongoDB, CockroachDB, HBase)**: Under network partition, the system rejects writes or waits for primary election to preserve absolute consistency.
  - **AP Systems (Cassandra, DynamoDB, CouchDB)**: Under network partition, all nodes remain available for writes, accepting eventual consistency and temporary divergence.

### 2. The PACELC Extension
The CAP theorem only applies *if there is a network partition*. **PACELC** extends it to normal operating conditions:
- **If Partition ($P$)**: Choose between Availability ($A$) and Consistency ($C$).
- **Else ($E$)**: Choose between **Latency ($L$)** and **Consistency ($C$)**.
- Example: MongoDB is a **PC/EC** system (prefers Consistency over Availability during partitions, and Consistency over Latency in normal operations). Cassandra is a **PA/EL** system (prefers Availability and low Latency).

---

## 7. Important Rules
1. **The Relational Complexity Rule**: If your entities have deep Many-to-Many relationships and your queries frequently ask questions like "Find all users who bought items sold by vendors located in cities where taxes changed," **choose SQL**.
2. **The Financial Axiom**: Any system handling immutable financial ledgers, banking transfers, or double-entry bookkeeping should default to a strict **ACID Relational SQL** engine (PostgreSQL).
3. **The Single-Seek Document Rule**: If 95% of your application's read operations fetch a complete entity by a single identifier (e.g., loading a user profile, rendering a blog post, fetching a device configuration), **choose NoSQL (MongoDB)**.
4. **PostgreSQL JSONB Nullifies Many NoSQL Advantages**: Remember that modern PostgreSQL natively supports `JSONB` with GIN indexing, providing document storage *inside* an ACID relational database.

---

## 8. Common Mistakes

### 1. Re-implementing an RDBMS Inside MongoDB
Creating 10 normalized collections in MongoDB linked by `ObjectId` references, and writing sequential loops of `populate()` or multi-stage `$lookup` queries in Node.js. This combines the worst of both worlds: the latency overhead of network round-trips without any of the foreign key integrity guarantees of SQL.

### 2. Premature Sharding Assumptions
Choosing NoSQL solely because of the claim that "SQL doesn't scale." A single modern PostgreSQL instance running on AWS (`db.r6g.16xlarge`) can effortlessly process **50,000+ queries per second** with terabytes of data. 99% of applications will never outgrow a properly indexed, single-node PostgreSQL instance with read replicas.

---

## 9. Best Practices

### The 5-Pillar Decision Matrix

| Evaluation Pillar | Select SQL (PostgreSQL / MySQL) | Select NoSQL (MongoDB / DynamoDB) |
| :--- | :--- | :--- |
| **1. Data Structure** | Highly structured, normalized, uniform tables | Polymorphic, nested, rapidly changing documents |
| **2. Relationships** | Deep Many-to-Many, multi-table joins | Independent documents, 1-to-Few hierarchies |
| **3. Transaction Scope** | Critical multi-table ACID boundaries | Single-document atomicity is sufficient |
| **4. Scale Vector** | Vertical scale-up + horizontal read replicas | Horizontal sharding across clusters |
| **5. Query Patterns** | Dynamic ad-hoc filtering, complex analytics | Key-value lookups, document retrieval by ID |

---

## 10. Performance Considerations
- **Write Throughput**: Distributed NoSQL systems (Cassandra, MongoDB with unacknowledged writes) deliver higher write throughput by writing to memory and sequential logs. SQL engines incur synchronous WAL `fsync` and index maintenance overhead.
- **Join Overhead**: In SQL, joins are computed in optimized C memory structures (Hash/Merge joins). In NoSQL, joins (`$lookup`) are expensive and can saturate cross-shard network links.

---

## 11. Security Considerations
- **Injection Vectors**: SQL engines are vulnerable to classical **SQL Injection** (`' OR 1=1 --`); NoSQL engines are vulnerable to **Operator Injection** (`{"$gt": ""}`). Both require strict parameterization and schema validation.
- **Audit Compliance**: Financial regulations (SOC2, HIPAA, PCI-DSS) often require strict immutability, foreign key referential integrity, and row-level audit trails that are simpler to certify on relational databases.

---

## 12. Alternatives
1. **NewSQL (CockroachDB, YugabyteDB, Google Spanner)**: Next-generation distributed databases that combine the strict ACID relational SQL model with the automatic horizontal sharding and global replication of NoSQL.
2. **Specialized Engines**:
   - **Redis**: In-memory Key-Value for sub-millisecond caching and rate limiting.
   - **ClickHouse / Snowflake**: Columnar OLAP for billion-row analytical aggregations.
   - **Neo4j**: Graph database for social networks and recommendation trees.

---

## 13. Trade-offs

| Criterion | Relational SQL (Postgres) | Document NoSQL (MongoDB) | Wide-Column (Cassandra) |
| :--- | :--- | :--- | :--- |
| **Primary Strength** | Complex joins, data integrity | Developer velocity, nested docs | Massive write scalability |
| **Primary Weakness** | Horizontal write scaling | Multi-collection joins | Very rigid query access patterns |
| **Transactions** | Full Multi-Table ACID | Single-doc (Multi-doc with perf cost)| Lightweight / Tunable |
| **Schema Evolution** | Structured DDL migrations | Dynamic / Application managed | Predefined CQL tables |

---

## 14. Real-World Usage
- **Uber**: Uses PostgreSQL and MySQL for core rider/driver accounts and trip billing; uses Cassandra/DynamoDB for high-frequency GPS telemetry ingestion (millions of pings per minute).
- **Amazon**: Uses DynamoDB for the shopping cart and session state (instant single-seek latency); uses relational Aurora PostgreSQL for warehouse inventory allocations and financial invoicing.

---

## 15. Placement Interview Questions

### Basic
**Q: State the fundamental architectural difference between SQL and NoSQL databases.**  
*Answer*: SQL databases are relational, table-based systems that store structured data in fixed rows and columns, strictly enforce schema rules and foreign keys, and prioritize ACID consistency and relational joins. NoSQL databases encompass non-relational data models (Document, Key-Value, Wide-Column, Graph), store flexible, unstructured or nested data (such as BSON documents), and prioritize horizontal scalability and developer velocity.

### Conceptual
**Q: Explain the CAP Theorem and where PostgreSQL and MongoDB sit within its classification.**  
*Answer*: The CAP theorem states that a distributed data store can simultaneously provide at most two of three guarantees: Consistency (every read gets the latest write), Availability (every request receives a non-error response), and Partition Tolerance (system functions despite network partitions). Because network partitions ($P$) are inevitable in distributed systems:
- **MongoDB** is classified as a **CP system**: during a network partition, if a primary node is separated from the majority, it steps down and rejects writes to ensure data does not become inconsistent across partitions.
- A standard single-node **PostgreSQL** instance is a non-distributed ACID system. When configured in a distributed primary-replica topology, it can operate as **CP** (synchronous replication prioritizing consistency) or effectively prioritize availability with asynchronous replication.

### Implementation
**Q: When would you use PostgreSQL's `JSONB` data type instead of spinning up a separate MongoDB database cluster?**  
*Answer*: You should use PostgreSQL's `JSONB` when your application is predominantly relational (80–90% structured tables requiring foreign keys and ACID transactions), but requires flexible, schema-less document storage for specific features (such as user preferences, audit metadata, or third-party webhook payloads). `JSONB` supports GIN indexing and rich query operators directly inside PostgreSQL, giving you document flexibility without the operational overhead and security complexity of managing a separate database cluster.

### Debugging
**Q: A startup built a social networking platform with MongoDB. As user connections grew, simple feed generation queries became sluggish and began timing out. What architectural flaw occurred?**  
*Answer*: The team used a document database to model a **deeply interconnected graph domain** (users follow users, users like posts, posts belong to groups). Generating feeds in MongoDB required multiple nested `$lookup` stages or sequential application-level queries across collections. In an interconnected domain, a relational database (with indexed SQL joins) or a dedicated Graph Database (like Neo4j) is the correct architectural choice; document databases suffer severe performance degradation when forced to execute multi-hop graph traversals.

### Scenario
**Q: You are hired as the Lead Architect for a FinTech app that handles digital wallet transfers and user activity feeds. Design the database architecture.**  
*Answer*: Implement **Polyglot Persistence**:
1. **Core Financial Ledger & Wallets**: Use **PostgreSQL**. Wallets, transfers, and transactions require strict multi-table ACID guarantees, check constraints (`balance >= 0`), and immutable row-level locking (`FOR UPDATE`) to mathematically prevent double-spending and ensure audit compliance.
2. **User Activity & Notification Feed**: Use **MongoDB** (or Redis). Notifications and activity logs are high-volume, schema-flexible, independent documents that can be modeled with the Subset Pattern for sub-millisecond retrieval without relational joins.
3. **Session Cache & Rate Limiting**: Use **Redis** for in-memory key-value speed.

### Advanced
**Q: What is the PACELC theorem, and how does it refine our understanding of database trade-offs beyond the traditional CAP theorem?**  
*Answer*: The CAP theorem only describes database behavior in the presence of a network partition ($P$). The **PACELC theorem** refines this by asserting: If there is a Partition ($P$), trade off Availability ($A$) versus Consistency ($C$); **Else ($E$)**, when the system is running normally without partitions, trade off **Latency ($L$)** versus **Consistency ($C$)**. For example, MongoDB is a **PC/EC** system: under partition, it chooses consistency; under normal operation, it chooses strong consistency over lowest latency by writing to the primary. In contrast, Cassandra is **PA/EL**: under partition, it chooses availability; under normal operation, it trades strong consistency for ultra-low latency via tunable eventual consistency.

---

## 16. Coding Questions

### Problem 1: Architectural Trade-off Evaluation Matrix
Evaluate and write a technical decision record (ADR) justifying the database selection for an **IoT Fleet Telemetry Management System** (100,000 trucks sending GPS, speed, tire pressure, and engine diagnostics every 2 seconds).

```markdown
# Architecture Decision Record (ADR 001): Fleet Telemetry Database

## Context:
- Ingestion Volume: 100,000 trucks * 0.5 requests/sec = 50,000 writes/sec.
- Data Characteristics: Time-series, append-only, semi-structured diagnostics.
- Query Pattern: Recent truck status (90%), historical 30-day route analytics (10%).

## Decision:
We select a specialized Time-Series Engine / Wide-Column NoSQL store 
(e.g., TimescaleDB on PostgreSQL or MongoDB Time-Series Collections / Apache Cassandra).

## Justification:
1. Write Scale: 50,000 writes/sec would saturate single-node traditional RDBMS WAL disks. 
   MongoDB Time-Series or Cassandra uses sequential append-only writes (LSM-trees).
2. Data Lifecycle: Built-in TTL automatically purges raw sensor telemetry older than 90 days.
3. Schema Variability: Different truck models report distinct diagnostic engine sensor keys.

## Trade-offs Accepted:
- Complex multi-table joins are abandoned on the telemetry path.
- Relational entities (Truck Ownership, Driver Contracts) remain in a normalized PostgreSQL OLTP database.
```

---

## 17. Common Interview Traps
- **Trap 1**: Believing NoSQL means "no schema." NoSQL means **schema-on-read** rather than **schema-on-write**. The application code still assumes a schema; shifting validation from the database to the application requires discipline.
- **Trap 2**: Assuming SQL cannot scale horizontally. Modern NewSQL databases (CockroachDB, YugabyteDB, AWS Aurora Multi-Master) scale horizontally while providing full SQL ACID transactions.
- **Trap 3**: Believing MongoDB does not support ACID transactions. MongoDB has supported multi-document ACID transactions since version 4.0.

---

## 18. Revision Summary
- Choose **SQL** for complex relational data, strict multi-table ACID transactions, and deep joins.
- Choose **NoSQL** for polymorphic documents, rapid prototyping, horizontal sharding, and high-volume single-seek workloads.
- CAP Theorem: In distributed systems, pick Consistency ($CP$) or Availability ($AP$) under partition.
- Modern architectures embrace **Polyglot Persistence**: using the right database engine for each specific bounded context.
- PostgreSQL `JSONB` provides a powerful hybrid option for document storage inside a relational engine.

---

## 19. Quick Reference

| Requirement | Best Database Choice | Rationale |
| :--- | :--- | :--- |
| **Banking / Financial Ledgers** | PostgreSQL | Strict ACID, constraints, row-level locks |
| **Product Catalog (E-Commerce)**| MongoDB | Polymorphic attributes, nested variants |
| **IoT Sensor Telemetry** | TimescaleDB / Cassandra | High write throughput, automated TTL |
| **Session Cache / Rate Limits**| Redis | In-memory sub-millisecond key-value |
| **Full-Text Product Search** | Elasticsearch / Meilisearch | BM25 relevance scoring, fuzzy matching |
| **Social Follower Graph** | Neo4j / PostgreSQL | Deep graph traversals, friend-of-friend |
