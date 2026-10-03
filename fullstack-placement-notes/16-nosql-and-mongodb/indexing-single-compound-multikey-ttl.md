# MongoDB Indexing: Single Field, Compound, Multikey, TTL, and the ESR Rule

## 1. What is it?
In MongoDB, an **Index** is a specialized auxiliary B-Tree data structure stored in memory and on disk that holds a small, sorted portion of the collection's dataset to accelerate document retrieval. 

Without indexes, MongoDB must perform a **Collection Scan (`COLLSCAN`)**, reading every single BSON document in the collection from beginning to end ($O(N)$) to find matching criteria. With appropriate indexes, the WiredTiger storage engine traverses the B-Tree in $O(\log N)$ time.

MongoDB supports specialized index types tailored to diverse NoSQL document structures:
- **Single Field Index**: B-Tree on one scalar field.
- **Compound Index**: B-Tree across multiple fields, strictly governed by the **ESR Rule (Equality, Sort, Range)**.
- **Multikey Index**: Automatic indexing of array elements, creating an index entry for every element in an array.
- **TTL Index (Time-To-Live)**: Automated self-expiring indexes that delete documents after a specified time window.
- **Text & Geospatial (2dsphere) Indexes**: For tokenized text search and latitude/longitude polygon queries.

```
Compound Index Architecture and the ESR Rule:
Rule: Place Equality fields FIRST, Sort fields SECOND, Range fields LAST.
Index: { status: 1, createdAt: 1, score: 1 }
         (Equality)    (Sort)        (Range)

Incoming Query:
find({ status: "ACTIVE", score: { $gte: 80 } }).sort({ createdAt: 1 })
1. Jump to B-Tree branch: status == "ACTIVE"  (E: Equality narrows set)
2. Read leaves sequentially: sorted by createdAt (S: Sort satisfied with 0 memory sort!)
3. Filter within range: score >= 80            (R: Range checked)
```

---

## 2. Why does it exist?
1. **Preventing Latency Collapses under Scale**: If a `users` collection has 10,000,000 documents, searching for an email `db.users.find({ email: 'user@test.com' })` without an index takes ~4,500ms and consumes 100% CPU. With an index, it completes in 0.2ms.
2. **Eliminating In-Memory Sort Crashes**: MongoDB enforces a strict **32MB memory limit** on internal in-memory sort operations (`SORT` node). If an unindexed `sort()` query exceeds 32MB of RAM, MongoDB terminates execution and throws an error: `Executor error during find command: Sort exceeded memory limit`. B-Tree indexes store data pre-sorted, allowing zero-memory stream sorting.
3. **Automated Lifecycle Eviction (TTL)**: Session tokens, password reset codes, and transient cache objects need to be purged after 24 hours. Writing manual cron jobs to delete old records causes database load spikes. **TTL Indexes** instruct WiredTiger background threads to automatically purge expired documents.

---

## 3. Mental Model
Think of MongoDB Indexes as **A Library's Organization System**:
- **Collection Scan (`COLLSCAN`)**: Searching for a book by walking into a library where 1,000,000 books are piled randomly in the center of the floor, picking up every book one by one until you find the title.
- **Compound Index with ESR Rule**: The library's catalog cards:
  - First Drawer: **Genre** (Equality: "Science Fiction").
  - Second Order: **Publication Year** (Sort: Pre-sorted from 1950 to 2026).
  - Third Filter: **Page Count** (Range: Between 200 and 400 pages).
- **TTL Index**: A loaf of bread with an expiration date stamp. A store clerk walks by every 60 seconds, inspects the date, and discards expired bread without disturbing other shoppers.

---

## 4. Basic Example
Creating indexes in MongoDB / Node.js:

```typescript
import { MongoClient } from 'mongodb';

const client = new MongoClient('mongodb://localhost:27017');
const db = client.db('store');

async function createIndexesDemo() {
  const users = db.collection('users');
  const sessions = db.collection('sessions');

  // 1. Single Field Unique Index
  await users.createIndex({ email: 1 }, { unique: true });

  // 2. Compound Index obeying the ESR rule
  // Query: find({ tenantId: 't1', age: { $gte: 21 } }).sort({ lastName: 1 })
  await users.createIndex({ 
    tenantId: 1,  // Equality
    lastName: 1,  // Sort
    age: 1        // Range
  });

  // 3. Multikey Index (automatically created when indexing an array field)
  await users.createIndex({ tags: 1 });

  // 4. TTL Index (Automatically deletes documents 3600 seconds after createdAt)
  await sessions.createIndex(
    { createdAt: 1 }, 
    { expireAfterSeconds: 3600 }
  );

  console.log('All indexes created successfully');
}
```

---

## 5. Real Example: The ESR Rule in Production TypeScript
A production TypeScript case study showing how violating the ESR rule causes memory sorts, and how applying ESR reduces query latency from 850ms to 0.4ms:

```typescript
import { Collection, Document } from 'mongodb';

export class OrderSearchRepository {
  constructor(private readonly ordersCollection: Collection<Document>) {}

  /**
   * BUSINESS REQUIREMENT:
   * "Find all orders with status 'DELIVERED', where orderTotal is between $50 and $500,
   *  sorted by orderDate descending."
   * 
   * Query Structure:
   * Filter 1: status = 'DELIVERED'        (E: Equality)
   * Filter 2: orderTotal: { $gte: 50 }    (R: Range)
   * Sort:     { orderDate: -1 }           (S: Sort)
   */

  // BAD INDEX (Violates ESR: Put Range before Sort):
  // { status: 1, orderTotal: 1, orderDate: -1 }
  // Consequence: The B-Tree branches at the range filter (orderTotal), 
  // destroying sorted order. MongoDB must perform an in-memory SORT node!

  // OPTIMAL INDEX (Strictly obeys ESR: Equality -> Sort -> Range):
  public async setupOptimalIndex(): Promise<void> {
    await this.ordersCollection.createIndex({
      status: 1,      // E - Equality
      orderDate: -1,  // S - Sort (Matches query sort direction!)
      orderTotal: 1   // R - Range
    });
  }

  public async executeQuery() {
    return await this.ordersCollection
      .find({
        status: 'DELIVERED',               // E
        orderTotal: { $gte: 50, $lte: 500 } // R
      })
      .sort({ orderDate: -1 })             // S
      .limit(20)
      .toArray();
  }
}
```

---

## 6. Under the Hood

### 1. The ESR Rule: Theoretical Proof
Why must the order be **Equality $\to$ Sort $\to$ Range**?
1. **Equality First**: Equality filters (`status = 'ACTIVE'`) prune the search space down to a single contiguous branch of the B-Tree.
2. **Sort Second**: Within that contiguous branch, the B-Tree leaf pages are physically ordered by the sort key (`orderDate`). The database walks the leaves in physical order, eliminating the need to read all records into memory to sort them.
3. **Range Last**: When a range operator (`$gt`, `$lt`) is evaluated, it splits the search path into multiple ranges. If Sort was placed *after* Range, keys with different range values would be interleaved, destroying the sorted property of the index for the sort key.

```
B-Tree Key Traversal Comparison:
Index [E, S, R]: { status, date, score }
  status='A' ---> date is in perfect physical sequence! ---> score filtered on-the-fly.
  Result: 0 In-Memory Sort. Minimal documents scanned.

Index [E, R, S]: { status, score, date }
  status='A' ---> score > 50 jumps across multiple sub-trees!
  Within score 51..100, dates are fragmented!
  Result: MongoDB must gather all matching rows and run in-memory SORT!
```

### 2. Multikey Indexes (Array Indexing)
When you index a field that contains an array (e.g., `tags: ['tech', 'gaming']`):
- MongoDB creates a **Multikey Index**.
- It creates a separate index entry in the B-Tree for **every single item** in the array. If a document has 20 tags, that document produces 20 distinct index entries!
- **Strict Limitation**: A compound index **cannot** contain more than one array field (to prevent Cartesian explosion of index entries: an index on two arrays of 50 items would produce $50 \times 50 = 2,500$ index keys per document).

### 3. TTL (Time-To-Live) Background Thread
- A background thread runs inside `mongod` once every **60 seconds**.
- It reads the TTL index and deletes documents where:
  $$\text{Current Time} \ge \text{Indexed Date} + \text{expireAfterSeconds}$$
- Because the thread runs every 60 seconds, documents may persist for a few seconds past their exact expiration timestamp.
- The indexed field **must be a BSON Date** (or an array containing Date objects); numbers or epoch timestamps are ignored.

---

## 7. Important Rules
1. **Index Direction Matters in Compound Indexes with Multiple Sorts**:
   - In a single field index, direction (`1` vs `-1`) doesn't matter (MongoDB can traverse forward or backward).
   - In a compound index sorting on multiple fields (`{ a: 1, b: -1 }`), the index supports `{ a: 1, b: -1 }` or `{ a: -1, b: 1 }`. It **cannot** support `{ a: 1, b: 1 }` without an in-memory sort!
2. **Covered Queries (Optimal Performance)**: A query is **Covered** when:
   - All fields in the query filter are part of an index.
   - All fields in the projection are part of that same index.
   - The `_id` field is explicitly excluded (`_id: 0`).
   The query planner never reads the actual document from disk; execution time is sub-millisecond.
3. **Compound Indexes Cannot Have Two Array Fields**: Attempting to create a compound index on two array fields throws an error: `cannot index parallel arrays`.

---

## 8. Common Mistakes

### 1. The In-Memory Sort Limit Crash (`SORT` Stage Error)
Sorting on an unindexed column on a collection with > 32MB of data. The query crashes in production with: `Executor error during find command: Sort exceeded memory limit of 33554432 bytes`. Always ensure queries with `.sort()` have a corresponding index.

### 2. Violating the Leftmost Prefix Rule
Creating an index on `{ companyId: 1, department: 1, status: 1 }`, and then querying:
`db.employees.find({ department: 'Engineering' })`.
Because `companyId` was omitted, the B-Tree cannot traverse its root and performs a full collection scan (`COLLSCAN`).

---

## 9. Best Practices
- **Check Execution Plans with `explain("executionStats")`**:
  Look for:
  - `stage: "IXSCAN"`: Good (Index scan).
  - `stage: "COLLSCAN"`: Bad (Full collection scan).
  - `totalDocsExamined: 0`: Exceptional (Covered query).
  - `totalDocsExamined` vs `nReturned`: If you examine 10,000 docs to return 5, the index is poorly selective.
- **Partial Indexes**: Save index space by indexing only documents that match a filter:
  ```javascript
  // Only index active users (skipping 95% of dormant rows)
  db.users.createIndex(
    { email: 1 }, 
    { partialFilterExpression: { isActive: true } }
  );
  ```

---

## 10. Performance Considerations
- **Index RAM Sizing**: Indexes must fit entirely into RAM. Check `db.collection.totalIndexSize()`. If total index size exceeds available WiredTiger cache RAM, index lookups incur disk I/O, destroying performance.
- **Write Amplification**: Every document insert or delete must update every index on the collection. Limit secondary indexes to 3–6 per collection.

---

## 11. Security Considerations
- **Index Enumeration on Unique Constraints**: Error messages from unique constraint violations (`E11000 duplicate key error`) can be exploited by attackers to verify the existence of user emails or phone numbers without authentication. Sanitize error messages before sending them to the client.

---

## 12. Alternatives
1. **Atlas Search (Apache Lucene)**: Full-text search engine built into MongoDB Atlas; vastly superior to native text indexes for fuzzy matching, typos, and autocomplete.
2. **Redis for TTL Caching**: Redis TTL operates in sub-millisecond memory; preferable for high-churn session tokens exceeding 100,000 writes/sec.

---

## 13. Trade-offs

| Index Type | Read Speedup | Write Overhead | Memory Footprint | Special Capability |
| :--- | :--- | :--- | :--- | :--- |
| **Single Field** | Fast for 1 column | Low | Small | Primary keys, foreign keys |
| **Compound (ESR)**| Extremely Fast for multi-filters | Moderate | Medium | Eliminates in-memory sort |
| **Multikey (Array)**| Fast for array items | High (1 entry per array item) | Large | Set containment queries |
| **TTL** | N/A | Low | Small | Auto-deletes expired data |
| **Partial** | Fast for subset | Low | Minimal | Only indexes active working set |

---

## 14. Real-World Usage
- **Session Stores**: Express / Next.js sessions stored in MongoDB use a TTL index on `expiresAt` with `expireAfterSeconds: 0`, purging logged-out sessions automatically.
- **E-Commerce Filtering**: Product catalogs use compound indexes following the ESR rule (`{ category: 1, price: 1, rating: 1 }`) to power faceted sidebar filters with zero-memory sorting.

---

## 15. Placement Interview Questions

### Basic
**Q: What is a Multikey Index in MongoDB, and when is it automatically created?**  
*Answer*: A Multikey Index is an index created on a field that contains an array value. MongoDB automatically creates a multikey index if an indexed field contains an array; under the hood, it creates a separate B-Tree index key for every individual element in the array, allowing queries on array elements to use the index.

### Conceptual
**Q: Explain the ESR (Equality, Sort, Range) rule for designing compound indexes.**  
*Answer*: The ESR rule states that columns in a compound index should be ordered:
1. **Equality (`E`)**: Exact match fields (`=`, `$eq`) come first to narrow the search space to a single contiguous B-Tree leaf range.
2. **Sort (`S`)**: Ordering fields come second so the database can stream pre-sorted data directly from index leaves, completely eliminating in-memory `SORT` operations.
3. **Range (`R`)**: Inequality/range fields (`$gt`, `$lt`, `$in`) come last because once a range boundary is evaluated, the sorted order of subsequent index fields is broken.

### Implementation
**Q: How do you configure a TTL index to delete temporary password reset tokens exactly 15 minutes after generation?**  
*Answer*:
```javascript
db.password_resets.createIndex(
  { createdAt: 1 }, 
  { expireAfterSeconds: 900 } // 15 minutes = 900 seconds
);
```
The application inserts documents with `createdAt: new Date()`. A background thread running every 60 seconds purges records where the current time exceeds `createdAt + 900s`.

### Debugging
**Q: A production query throws `Executor error during find command: Sort exceeded memory limit of 33554432 bytes`. What happened, and how do you resolve it?**  
*Answer*: The query executed a `.sort()` operation on an unindexed field (or an index that could not satisfy the sort order), forcing MongoDB to load all matching documents into memory to sort them. Because the dataset exceeded MongoDB's **32MB in-memory sort ceiling**, the query crashed. The resolution is to add a compound index that includes the sort field in accordance with the ESR rule or index the sort field directly.

### Scenario
**Q: What is a Covered Query in MongoDB, and what conditions are required to achieve one?**  
*Answer*: A Covered Query is a query that is satisfied **100% by an index** without reading any documents from the collection heap (in `explain()`, `totalDocsExamined: 0`). To achieve a covered query:
1. All fields in the query filter must exist in the index.
2. All fields returned in the projection must exist in the index.
3. The `_id` field must be explicitly excluded (`_id: 0`) unless `_id` is part of the index.

### Advanced
**Q: Why cannot a compound index in MongoDB contain more than one array field?**  
*Answer*: If a compound index permitted multiple array fields (e.g., `{ tags: 1, categories: 1 }`), MongoDB would have to index the **Cartesian Product** of all elements in both arrays for every single document. If a document had 20 tags and 20 categories, a single document would generate $20 \times 20 = 400$ separate index entries. This would lead to index bloat, severe write amplification, and catastrophic RAM consumption. MongoDB prohibits this and throws `cannot index parallel arrays`.

---

## 16. Coding Questions

### Problem 1: Analyzing `explain("executionStats")` to Detect Index Performance
Given the following execution stats output from a slow production find command:

```json
{
  "executionStages": {
    "stage": "FETCH",
    "nReturned": 10,
    "totalDocsExamined": 500000,
    "inputStage": {
      "stage": "IXSCAN",
      "indexName": "category_1",
      "totalKeysExamined": 500000
    }
  }
}
```

**Task: Identify the performance issue and provide the remediation index.**

**Analysis & Solution:**
- **Issue**: The query used an index scan (`IXSCAN`), but had to examine **500,000 keys** and **500,000 documents** just to return **10 documents** (`totalDocsExamined: 500000, nReturned: 10`). This indicates low index selectivity; the index on `category` filtered very little data, and the rest of the query filters (e.g., `price` and `status`) were evaluated in memory during the `FETCH` stage.
- **Remediation**: Create a targeted **Compound Index** incorporating the other filtered and sorted fields:
  ```javascript
  db.products.createIndex({ category: 1, status: 1, price: 1 });
  ```
  This reduces `totalKeysExamined` and `totalDocsExamined` from 500,000 to 10.

---

## 17. Common Interview Traps
- **Trap 1**: Thinking TTL indexes delete documents the exact millisecond they expire. The deletion thread runs every **60 seconds**, so documents can remain visible for up to a minute after expiry.
- **Trap 2**: Believing an index on `{ a: 1, b: 1 }` can be used to query `{ b: 1 }`. It cannot; MongoDB compound indexes obey the **leftmost prefix rule**.
- **Trap 3**: Creating duplicate single-field indexes when a compound index already exists. If you have `{ a: 1, b: 1 }`, you do **not** need a separate index on `{ a: 1 }`.

---

## 18. Revision Summary
- Indexes use B-Trees to replace slow Collection Scans (`COLLSCAN`) with fast Index Scans (`IXSCAN`).
- Compound indexes must strictly follow the **ESR Rule (Equality $\to$ Sort $\to$ Range)** to eliminate in-memory sort crashes.
- Multikey indexes index every element of an array; compound indexes cannot contain two array fields.
- TTL indexes automatically expire documents after a set duration; the indexed field must be a BSON Date.
- Aim for Covered Queries (`totalDocsExamined: 0`) for maximum throughput.

---

## 19. Quick Reference

| Index Type | Syntax | Key Rule |
| :--- | :--- | :--- |
| **Single Field** | `createIndex({ email: 1 })` | Fast equality and range on 1 field |
| **Compound (ESR)**| `createIndex({ status: 1, date: -1, price: 1 })` | Equality first, Sort second, Range third |
| **Multikey** | `createIndex({ tags: 1 })` | Indexes every array item; no parallel arrays |
| **TTL Index** | `createIndex({ createdAt: 1 }, { expireAfterSeconds: 3600 })` | Field must be BSON Date; runs every 60s |
| **Partial Index** | `createIndex({ email: 1 }, { partialFilterExpression: ... })` | Saves space; indexes subset of collection |
| **Covered Query** | Filter and projection satisfied by index | Must exclude `_id: 0` |
