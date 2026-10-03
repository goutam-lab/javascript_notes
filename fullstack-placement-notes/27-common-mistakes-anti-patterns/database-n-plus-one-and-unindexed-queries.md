# Database N+1 Queries and Unindexed Query Anti-Patterns

## 1. What is it?
The **N+1 Query Problem** and **Unindexed Table Scans** represent the two most destructive performance anti-patterns in backend web applications. 

The **N+1 Query Problem** occurs when an application executes 1 initial database query to fetch a parent collection of $N$ records, followed by $N$ individual downstream queries inside an iteration loop to retrieve related child records for each parent. Instead of retrieving the complete dataset in 1 or 2 consolidated batch queries, the application hammers the database engine with $N + 1$ distinct roundtrips over the network.

**Unindexed Query Execution** occurs when a relational database query executes filter (`WHERE`), join (`ON`), sort (`ORDER BY`), or grouping (`GROUP BY`) clauses against table columns lacking an index (such as a B-Tree). Without an auxiliary indexing data structure, the database storage engine must perform a **Sequential Scan** (PostgreSQL) or **Full Table Scan** (MySQL) — reading every disk block and page of a multi-million-row table from physical storage into memory, resulting in disastrous I/O saturation, query queue latency spikes, and CPU starvation.

```
       N+1 QUERY DISASTER: 1 Parent Query + N Child Queries
       
   Client App                         Database Engine
       │                                     │
   1.  │ ──── SELECT * FROM users ─────────> │ (Finds 100 users)
       │ <─── Returns 100 User Rows ──────── │
       │                                     │
   2.  │ ──── SELECT * FROM posts WHERE id=1>│ (Roundtrip 1)
       │ <─── Returns Post Data ──────────── │
   3.  │ ──── SELECT * FROM posts WHERE id=2>│ (Roundtrip 2)
       │ <─── Returns Post Data ──────────── │
       │                 ...                 │
  101. │ ──── SELECT * FROM posts WHERE id=N>│ (Roundtrip 100)
       │ <─── Returns Post Data ──────────── │
       │                                     │
       Total: 101 Network RTTs + 101 Connection Acquires!
```

---

## 2. Why does it exist?
These anti-patterns emerge predominantly because of:
1. **Object-Relational Mapping (ORM) Abstraction Leaks:**
   ORMs (such as Prisma, TypeORM, Hibernate, Sequelize, and ActiveRecord) treat relational database tables as in-memory object graphs. When an engineer accesses a navigation property (e.g., `user.posts`), the ORM transparently triggers an on-demand SQL query under "Lazy Loading" behavior. The developer writes clean, object-oriented code without realizing that a loop over 500 items issues 500 synchronous database roundtrips.
2. **Impedance Mismatch:**
   Object-oriented code thinks iteratively (element-by-element through loops, iterators, and stream mappers), whereas relational databases think set-theoretically (processing relational sets through joins, projections, and hash aggregates).
3. **Premature Local Optimization Without Production Data Scale:**
   On a local development database with 20 rows, a Sequential Scan executes in 0.1 milliseconds. The engineer does not notice the missing index on `author_id` or `created_at`. In production, when the table reaches 50 million rows, the exact same query shifts from 0.1ms to 12.8 seconds, triggering HTTP gateway timeouts (504).
4. **GraphQL Resolver Topologies:**
   GraphQL's hierarchical schema execution executes field resolvers independently. If a field resolver queries the database for each parent node, an N+1 cascade occurs naturally unless mitigated by batching layers like Facebook's DataLoader.

---

## 3. Mental Model
Think of the database engine as a **Wholesale Warehouse** located 20 miles away across town, and your backend server as a **Restaurant Kitchen**:

```
                       RESTAURANT ANALOGY
                       
  [Kitchen Server] ──(20 mile highway roundtrip)──> [Wholesale Warehouse DB]

  ❌ The N+1 Approach:
     - Driver drives to warehouse to get 50 Chef names.
     - For Chef 1: Driver drives to warehouse to buy their knives.
     - For Chef 2: Driver drives to warehouse to buy their knives.
     - ... Drives 51 roundtrips. The kitchen runs out of time and closes.

  ✅ The Batched Join Approach (Eager Loading):
     - Driver sends one fax: "Send me all 50 chefs AND all their knives joined together."
     - Driver makes 1 single trip and returns with everything in one truckload.

  ❌ The Unindexed Table Scan:
     - The warehouse has 10,000,000 unmarked boxes stacked randomly on the floor.
     - The driver inspects every single box one by one until finding Chef #42's order.
     
  ✅ The Indexed Scan (B-Tree):
     - The warehouse has an alphabetized catalog index directing the driver directly
       to Aisle 4, Shelf B, Box 12. The retrieval is instantaneous (O(log N)).
```

---

## 4. Basic Example

### The Anti-Pattern: N+1 Lazy Fetching inside Express / Node.js
```typescript
// ❌ ANTI-PATTERN: N+1 Queries via loop
app.get('/api/users-with-posts', async (req, res) => {
  // Query 1: 1 roundtrip to fetch 100 users
  const users = await db.query('SELECT id, name FROM users LIMIT 100');
  
  const results = [];
  for (const user of users.rows) {
    // Queries 2 to 101: 100 roundtrips inside iteration loop!
    const posts = await db.query(
      'SELECT id, title FROM posts WHERE user_id = $1', 
      [user.id]
    );
    results.push({ ...user, posts: posts.rows });
  }
  
  res.json(results);
});
```

### The Fix: Single SQL Query with `JOIN` or Array Aggregation
```typescript
// ✅ FIXED: 1 Single Roundtrip utilizing SQL relational JOIN
app.get('/api/users-with-posts', async (req, res) => {
  const query = `
    SELECT 
      u.id AS user_id, 
      u.name,
      COALESCE(
        json_agg(
          json_build_object('id', p.id, 'title', p.title)
        ) FILTER (WHERE p.id IS NOT NULL), 
        '[]'
      ) AS posts
    FROM users u
    LEFT JOIN posts p ON p.user_id = u.id
    GROUP BY u.id, u.name
    LIMIT 100;
  `;
  
  const { rows } = await db.query(query);
  res.json(rows);
});
```

---

## 5. Real Example: Prisma ORM, DataLoader & Unindexed Column Investigation

### Scenario A: Prisma ORM N+1 vs Fluent `include`
```typescript
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ log: ['query'] });

// ❌ ANTI-PATTERN: Inducing N+1 through mapping
async function getAuthorsWithArticlesBad() {
  const authors = await prisma.user.findMany({ take: 50 });
  
  return Promise.all(
    authors.map(async (author) => {
      // Fires 50 separate SELECT queries!
      const articles = await prisma.article.findMany({
        where: { authorId: author.id }
      });
      return { ...author, articles };
    })
  );
}

// ✅ FIXED: Native Prisma Eager Loading (Issues exactly 2 optimized SQL queries)
async function getAuthorsWithArticlesOptimized() {
  // Prisma generates:
  // 1. SELECT ... FROM "User" LIMIT 50;
  // 2. SELECT ... FROM "Article" WHERE "authorId" IN (...extracted 50 IDs...);
  return prisma.user.findMany({
    take: 50,
    include: {
      articles: {
        select: { id: true, title: true, publishedAt: true }
      }
    }
  });
}
```

### Scenario B: The DataLoader Pattern for GraphQL & Nested Microservices
```typescript
import DataLoader from 'dataloader';
import { db } from '../infrastructure/database';

// Batch function: receives an array of keys (userIds) and returns an array of results
const postBatchLoader = new DataLoader<string, Post[]>(async (userIds: readonly string[]) => {
  // 1 Consolidated Query with IN operator
  const query = `
    SELECT id, title, content, user_id 
    FROM posts 
    WHERE user_id = ANY($1::uuid[])
  `;
  const { rows } = await db.query(query, [userIds]);

  // Group posts by user_id
  const postMap: Record<string, Post[]> = {};
  userIds.forEach(id => { postMap[id] = []; });
  
  rows.forEach((post) => {
    postMap[post.user_id]?.push(post);
  });

  // MUST return results in the EXACT same order as the incoming keys array
  return userIds.map(id => postMap[id] || []);
});

// GraphQL Resolver:
export const resolvers = {
  User: {
    posts: async (parentUser: { id: string }) => {
      // Even if called 1,000 times in one tick of the Node.js event loop,
      // DataLoader coalesces all calls into 1 single batch query!
      return postBatchLoader.load(parentUser.id);
    }
  }
};
```

---

## 6. Under the Hood: B-Tree Indexes, EXPLAIN ANALYZE, and Buffer Pages

### How a B-Tree Index Eliminates Full Table Scans

```
               POSTGRESQL B-TREE INDEX (Depth: 3)
               
                         [ Root Node ]
                         /           \
                 [ Page 12 ]       [ Page 15 ]
                 /         \       /         \
            [Leaf 1]    [Leaf 2] [Leaf 3]   [Leaf 4]
               │           │        │          │
      TIDs: (Block,Offset) ─────────┴──────────┘
               │
               ▼
   [ HEAP STORAGE (Table Pages on Disk) ]
   Page 1: [Row 1, Row 2, Row 3...]
   Page 2: [Row 4, Row 5, Row 6...]
```

When you query without an index:
`SELECT * FROM orders WHERE customer_id = 'c_99812' AND status = 'COMPLETED';`
1. The PostgreSQL query planner inspects the system catalog (`pg_statistic`).
2. If no index exists on `customer_id`, the planner executes a **Seq Scan (Sequential Scan)**.
3. Every single heap block (8KB page) is fetched from the kernel page cache or disk. For 10,000,000 orders spanning 15 GB of disk:
   - 1,900,000 page reads.
   - Execution time: ~4,200 ms.
   - Buffer memory churn evicts other cached tables.

### Investigating with `EXPLAIN (ANALYZE, BUFFERS)`

```sql
-- ❌ BEFORE INDEXING:
EXPLAIN (ANALYZE, BUFFERS) 
SELECT * FROM orders WHERE customer_id = 'c_99812';

/* Output:
Seq Scan on orders  (cost=0.00..184520.00 rows=15 width=128) (actual time=84.210..3120.450 rows=12 loops=1)
  Filter: (customer_id = 'c_99812'::text)
  Rows Removed by Filter: 9999988
  Buffers: shared hit=1200 read=183320
Planning Time: 0.150 ms
Execution Time: 3121.230 ms
*/

-- Create the B-Tree Index:
CREATE INDEX idx_orders_customer_id ON orders(customer_id);

-- ✅ AFTER INDEXING:
EXPLAIN (ANALYZE, BUFFERS) 
SELECT * FROM orders WHERE customer_id = 'c_99812';

/* Output:
Bitmap Heap Scan on orders  (cost=4.42..42.10 rows=15 width=128) (actual time=0.045..0.082 rows=12 loops=1)
  Recheck Cond: (customer_id = 'c_99812'::text)
  Buffers: shared hit=6
  ->  Bitmap Index Scan on idx_orders_customer_id  (cost=0.00..4.42 rows=15 width=0) (actual time=0.021..0.021 rows=12 loops=1)
        Index Cond: (customer_id = 'c_99812'::text)
Planning Time: 0.120 ms
Execution Time: 0.098 ms   <-- 31,000x SPEEDUP!
*/
```

---

## 7. Important Rules

1. **Foreign Keys Are Not Indexed Automatically in PostgreSQL:**
   In PostgreSQL, creating a `FOREIGN KEY (user_id) REFERENCES users(id)` creates a constraint, **NOT** an index. You must explicitly create an index on the foreign key column (`CREATE INDEX idx_posts_user_id ON posts(user_id)`). Failure to do so causes full table scans on parent `DELETE` cascades and child joins!
2. **Leftmost Prefix Rule for Composite Indexes:**
   A composite index on `(org_id, status, created_at)` can accelerate queries on:
   - `org_id`
   - `org_id AND status`
   - `org_id AND status AND created_at`
   It **CANNOT** accelerate queries filtering only on `status` or `created_at`.
3. **No Database Queries Inside Loops:**
   Code review gate: Any PR containing `await db.query()` or `await orm.find()` within a `.map()`, `for`, `while`, or `forEach` loop must be rejected immediately.
4. **Index Selectivity Rule:**
   Indexes on low-cardinality columns (e.g., a boolean `is_active` where 95% of rows are `true`) will be ignored by the query planner in favor of a Sequential Scan. Use **Partial Indexes** instead:
   `CREATE INDEX idx_active_users ON users(id) WHERE is_active = false;`

---

## 8. Common Mistakes

```typescript
// ❌ MISTAKE 1: Over-fetching through unbounded ORM relations
// Fetches 50,000 orders and then 500,000 line items into Node.js heap memory!
const users = await prisma.user.findMany({
  include: { orders: { include: { orderItems: true } } }
});

// ❌ MISTAKE 2: Applying SQL functions on indexed columns in WHERE clause
// This invalidates the B-Tree index scan and forces a Seq Scan!
// SELECT * FROM users WHERE LOWER(email) = 'goutam@example.com';
// Fix: CREATE INDEX idx_users_lower_email ON users(LOWER(email)); (Expression Index)

// ❌ MISTAKE 3: Pagination with high OFFSET (O(N) read cost)
// SELECT * FROM logs ORDER BY created_at DESC LIMIT 20 OFFSET 500000;
// Scans and discards 500,000 rows!
// Fix: Keyshot/Cursor Pagination:
// SELECT * FROM logs WHERE created_at < $last_seen_timestamp ORDER BY created_at DESC LIMIT 20;
```

---

## 9. Best Practices
1. **Enable Query Logging and Slow Query Alerts:** Set `log_min_duration_statement = 200` (Postgres) or configure MySQL `slow_query_log = 1` with `long_query_time = 0.5`.
2. **Use SQL `JOIN` or Two-Step `IN (...)` Batching:** When querying related datasets, issue a single query with joins or execute a maximum of 2 parallel batch queries.
3. **Always Run `EXPLAIN ANALYZE`:** Never assume an index is being utilized. Check if the query plan shows `Index Scan` or `Bitmap Index Scan`.
4. **Implement Covering Indexes (`INCLUDE` clause):**
   ```sql
   CREATE INDEX idx_users_email_covering ON users(email) INCLUDE (id, full_name);
   -- Enables "Index Only Scan" - retrieves data entirely from B-Tree without reading heap table!
   ```

---

## 10. Performance Considerations

| Metric | Sequential Scan (No Index) | B-Tree Index Scan | Covering Index (Index Only) |
|---|---|---|---|
| **Time Complexity** | $O(N)$ | $O(\log N)$ | $O(\log N)$ |
| **Disk I/O Cost** | 100% of Table Blocks | Few B-tree pages + row blocks | Only B-tree leaf pages |
| **Buffer Cache Churn** | Catastrophic (flushes cache) | Negligible | Lowest possible |
| **Write Penalty (INSERT/UPDATE)** | None ($O(1)$) | Adds B-Tree rebalance cost | Adds slightly more rebalance cost |

---

## 11. Security Considerations
- **Denial of Service via Unindexed Queries:** A malicious user or bot requesting `/api/search?unindexedField=xyz` can intentionally consume 100% database CPU, locking connection pools and taking down the entire platform.
- **Connection Pool Exhaustion:** N+1 loops hold connection pool leases open for hundreds of milliseconds longer than necessary, starving other incoming API requests and causing 500 Internal Server Errors.

---

## 12. Alternatives
1. **Denormalization / Read Replicas:** Cache aggregate counters (e.g. `user.posts_count`) directly on the parent row to avoid joining child tables for count queries.
2. **Materialized Views:** For complex analytics involving multi-table joins, refresh a materialized view periodically or on triggers.
3. **Document Stores (MongoDB):** Embed child arrays directly inside the parent document if relations are bounded and 1-to-few.

---

## 13. Trade-offs

| Strategy | Advantages | Trade-offs |
|---|---|---|
| **Eager Loading (`JOIN`)** | 1 Single network roundtrip | Huge row duplication if joining 1-to-many multiple levels deep (Cartesian product). |
| **Two-Query `IN` Batching** | Prevents Cartesian explosions; clean JSON mapping | Requires 2 roundtrips instead of 1; requires application-side in-memory grouping. |
| **Heavy Indexing** | Reads become sub-millisecond | Increases disk usage; slows down high-frequency `INSERT`, `UPDATE`, and `DELETE` operations. |

---

## 14. Real-World Usage
- **Shopify & GitHub:** Implemented strict query linters in CI/CD pipelines that count SQL queries per HTTP request. If an endpoint fires more than 5 queries for a single request, the build fails.
- **Instagram / Meta:** Relies on DataLoader patterns across Python/Django and GraphQL services to prevent billions of redundant database calls per second.

---

## 15. Placement Interview Questions

### Basic
1. *What is the N+1 query problem, and how does it affect database server health?*
   - **Answer:** It is an architectural bug where 1 initial query is followed by $N$ secondary queries in a loop. It exhausts database connection pools, saturates network latency, and causes high CPU contention.

### Conceptual
2. *Why does creating a Foreign Key in PostgreSQL not create an index automatically?*
   - **Answer:** PostgreSQL separates data integrity enforcement (foreign key constraint) from physical access paths (indexes). While primary keys require an index to enforce uniqueness, foreign keys can have high update frequencies where index maintenance overhead might not be desired unless explicitly chosen by the developer.

### Implementation
3. *How do you write a DataLoader batching function in TypeScript?*
   - **Answer:** (See Section 5, Scenario B). The batch function must take an array of keys, fetch all matching rows with `WHERE key = ANY($keys)` or `IN (...)`, map them in memory, and return an array corresponding index-for-index with the requested keys.

### Debugging
4. *You observe an endpoint running slow. You ran `EXPLAIN ANALYZE` and see `Seq Scan` even though an index exists on `created_at`. Why is Postgres ignoring the index?*
   - **Answer:** 
     1. The query planner determined that the filter is not selective enough (e.g., retrieving 70% of the entire table; sequential scan is faster than random index lookups).
     2. A function was used on the column: `WHERE DATE(created_at) = '2025-01-01'`.
     3. Column type mismatch preventing index operator usage (e.g., comparing `varchar` to `integer`).
     4. Table statistics are outdated; running `ANALYZE tableName;` fixes it.

### Scenario
5. *How do you optimize an e-commerce order history query that joins `users`, `orders`, `order_items`, and `products` without blowing up memory?*
   - **Answer:** Use two-step batching or cursor pagination. First paginate orders: `SELECT * FROM orders WHERE user_id = $1 LIMIT 20`. Then batch fetch items: `SELECT * FROM order_items WHERE order_id IN (...)`, and join products via indexed foreign key.

### Advanced
6. *What is an "Index Only Scan" and what role does the PostgreSQL "Visibility Map" play in it?*
   - **Answer:** An Index Only Scan satisfies the query entirely from the B-tree leaf pages without visiting the heap table. However, PostgreSQL MVCC stores row visibility (xmin/xmax) in heap pages. If the Visibility Map indicates that an 8KB table block has not been modified since the last vacuum, the engine knows all tuples on that page are visible to all transactions, skipping the heap fetch entirely.

---

## 16. Coding Questions

### Problem: Detect and Fix N+1 Query in an ORM Service
Write a TypeScript function that takes an active user ID and returns all their teams, and for each team, its members, executing no more than 2 database queries total.

```typescript
interface TeamMember {
  userId: string;
  name: string;
  role: string;
}

interface TeamWithMembers {
  teamId: string;
  teamName: string;
  members: TeamMember[];
}

export async function getTeamsWithMembersOptimized(
  currentUserId: string,
  dbPool: any
): Promise<TeamWithMembers[]> {
  // Query 1: Fetch all teams for user
  const teamsQuery = `
    SELECT t.id AS team_id, t.name AS team_name
    FROM teams t
    INNER JOIN team_members tm ON tm.team_id = t.id
    WHERE tm.user_id = $1;
  `;
  const { rows: teams } = await dbPool.query(teamsQuery, [currentUserId]);
  
  if (teams.length === 0) return [];
  
  const teamIds = teams.map((t: any) => t.team_id);

  // Query 2: Batch fetch all members for ALL retrieved teams in one query
  const membersQuery = `
    SELECT 
      tm.team_id,
      u.id AS user_id,
      u.name,
      tm.role
    FROM team_members tm
    INNER JOIN users u ON u.id = tm.user_id
    WHERE tm.team_id = ANY($1::uuid[]);
  `;
  const { rows: members } = await dbPool.query(membersQuery, [teamIds]);

  // In-memory grouping O(M)
  const membersByTeam: Record<string, TeamMember[]> = {};
  for (const m of members) {
    if (!membersByTeam[m.team_id]) {
      membersByTeam[m.team_id] = [];
    }
    membersByTeam[m.team_id].push({
      userId: m.user_id,
      name: m.name,
      role: m.role
    });
  }

  return teams.map((team: any) => ({
    teamId: team.team_id,
    teamName: team.team_name,
    members: membersByTeam[team.team_id] || []
  }));
}
```

---

## 17. Common Interview Traps
- **Trap 1:** Assuming `Promise.all(arr.map(id => db.query(...)))` solves the N+1 problem.
  *Reality:* `Promise.all` runs queries concurrently over the network, but it still issues $N$ independent network calls and consumes $N$ database connection pool slots. It does not batch them into a single SQL command.
- **Trap 2:** Claiming "More indexes always make queries faster."
  *Reality:* Indexes incur write amplification. Every `INSERT`, `UPDATE`, and `DELETE` must synchronously write to both the table heap and all associated B-Trees. Over-indexing degrades write throughput and bloats memory.
- **Trap 3:** Confusing `Seq Scan` with index bugs when working with tiny tables.
  *Reality:* PostgreSQL deliberately chooses `Seq Scan` on small tables (e.g. < 500 rows) because sequential reading of 2 disk blocks is faster than reading an index page plus a data page!

---

## 18. Revision Summary
- **N+1 Problem:** 1 query for parents + $N$ queries inside loops for children.
- **Root Cause:** Lazy loading in ORMs, loop-based procedural code, and naive GraphQL resolvers.
- **Solution:** Eager loading via SQL `JOIN`, two-query `IN (...)` batching, or `DataLoader`.
- **Unindexed Scans:** Missing B-Trees cause $O(N)$ Full Table Scans. Adding indexes reduces lookups to $O(\log N)$.
- **Inspection:** Run `EXPLAIN (ANALYZE, BUFFERS)` to verify execution plans and buffer page hits.

---

## 19. Quick Reference

```
┌───────────────────────────────────────┬──────────────────────────────────────────┐
│ ANTI-PATTERN                          │ PRODUCTION-GRADE REMEDY                  │
├───────────────────────────────────────┼──────────────────────────────────────────┤
│ Query inside for/map loop             │ SQL JOIN or WHERE id IN (...) batching   │
│ GraphQL nested field N+1              │ Facebook DataLoader with batch function  │
│ Missing foreign key index             │ CREATE INDEX idx_child_fk ON table(fk_id)│
│ Slow WHERE LOWER(col) = val           │ Functional/Expression Index on LOWER(col)│
│ Massive OFFSET pagination             │ Keyset/Cursor-based pagination           │
│ Over-indexing every column            │ Composite indexes based on query access  │
└───────────────────────────────────────┴──────────────────────────────────────────┘
```
