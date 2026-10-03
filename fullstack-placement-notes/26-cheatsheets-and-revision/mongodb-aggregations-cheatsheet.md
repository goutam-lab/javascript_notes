# MongoDB Aggregation Pipeline Cheatsheet & Deep Dive

---

## 1. What is it?

The MongoDB Aggregation Pipeline Cheatsheet is an advanced technical reference and operational guide for data processing, multi-stage analytics, and complex transformations in MongoDB. Modeled on data processing pipelines where documents enter a multi-stage assembly line, the Aggregation Framework transforms, filters, groups, joins, and reshapes documents across declarative stages (`$match`, `$project`, `$group`, `$unwind`, `$lookup`, `$facet`, `$bucket`, `$setWindowFields`, and `$merge`). It provides senior-level mastery of **memory ceilings (100MB stage limit)**, **pipeline optimization passes**, and **index utilization mechanics**.

```
+-----------------------------------------------------------------------------------+
|                     MongoDB Aggregation Pipeline Anatomy                          |
+-----------------------------------------------------------------------------------+
| Raw Collection Documents: [ { _id: 1, user: "Alex", total: 100, items: [...] } ]  |
|                                    |                                              |
|                                    v                                              |
| Stage 1 ($match):   Filters documents early using indexes                         |
| Stage 2 ($unwind):  Deconstructs nested array field into individual documents     |
| Stage 3 ($group):   Groups by accumulator key and computes sums, averages, sets   |
| Stage 4 ($lookup):  Left outer join with external collection                      |
| Stage 5 ($project): Reshapes document fields; computes expressions                |
| Stage 6 ($facet):   Executes parallel multi-category aggregation pipelines        |
|                                    |                                              |
|                                    v                                              |
| Final Aggregated Result:  [ { _id: "Electronics", totalRevenue: 54000, ... } ]     |
+-----------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Standard MongoDB queries (`find()` and `findOne()`) are limited to basic field filtering, sorting, and projection.
The Aggregation Framework exists to:
1. **Eliminate Client-Side Data Processing:** Performing calculations, groupings, and joins in backend Node.js code requires streaming millions of documents over the network, overwhelming application memory and network bandwidth.
2. **Support Complex Business Analytics:** Enables multi-faceted search (e-commerce category and price filters), histogram bucketing, running totals, and moving averages directly inside the database engine.
3. **Handle Relational-Style Joins (`$lookup`):** Allows left outer joins between collections without forcing developers to denormalize every single data relationship.

---

## 3. Mental Model

To master MongoDB aggregation in interviews, visualize the framework as a **Sequential Factory Conveyor Belt**:

```
[ Collection on Disk ] 
         |
         v
  [ STAGE 1: $match ]  <-- Inspection: Drops non-qualifying documents (Uses Index!)
         |
         v
  [ STAGE 2: $group ]  <-- Accumulation: Aggregates items into summary buckets
         |
         v
  [ STAGE 3: $lookup ] <-- Enrichment: Attaches customer details from another collection
         |
         v
  [ STAGE 4: $project]<-- Formatting: Keeps desired fields, hides internal IDs
         |
         v
[ Client Application ]
```

* Documents flow from one stage to the next in strict sequence.
* The output of each stage serves as the input to the subsequent stage.
* Each stage acts as an independent document transformer.

---

## 4. Basic Example

### Calculating Total Revenue and Top Customers per Region

```javascript
db.orders.aggregate([
  // Stage 1: Filter completed orders using index
  { 
    $match: { 
      status: "COMPLETED", 
      orderDate: { $gte: ISODate("2026-01-01T00:00:00Z") } 
    } 
  },
  // Stage 2: Group by customer and compute total spend
  { 
    $group: { 
      _id: "$customerId", 
      totalSpent: { $sum: "$totalAmount" }, 
      orderCount: { $sum: 1 },
      avgOrderValue: { $avg: "$totalAmount" }
    } 
  },
  // Stage 3: Sort by highest spending customer
  { $sort: { totalSpent: -1 } },
  // Stage 4: Limit to top 5 customers
  { $limit: 5 },
  // Stage 5: Clean output shape
  {
    $project: {
      _id: 0,
      customerId: "$_id",
      totalSpent: { $round: ["$totalSpent", 2] },
      orderCount: 1,
      avgOrderValue: { $round: ["$avgOrderValue", 2] }
    }
  }
]);
```

---

## 5. Real Example

### Multi-Faceted E-Commerce Search with Dynamic Bucketing via `$facet`

```javascript
db.products.aggregate([
  // 1. Initial full-text and category filter
  {
    $match: {
      category: "electronics",
      isPublished: true,
      price: { $gte: 50, $lte: 2500 }
    }
  },
  // 2. Multi-Faceted Concurrent Aggregation
  {
    $facet: {
      // Facet A: Paginated Data Results
      products: [
        { $sort: { rating: -1, createdAt: -1 } },
        { $skip: 0 },
        { $limit: 20 },
        {
          $project: {
            title: 1,
            price: 1,
            rating: 1,
            brand: 1
          }
        }
      ],
      // Facet B: Total Matching Record Count
      totalCount: [
        { $count: "count" }
      ],
      // Facet C: Dynamic Price Distribution Buckets
      priceDistribution: [
        {
          $bucket: {
            groupBy: "$price",
            boundaries: [50, 200, 500, 1000, 2500],
            default: "Other",
            output: {
              count: { $sum: 1 },
              averagePrice: { $avg: "$price" }
            }
          }
        }
      ],
      // Facet D: Brand Aggregation
      topBrands: [
        { $group: { _id: "$brand", productCount: { $sum: 1 } } },
        { $sort: { productCount: -1 } },
        { $limit: 5 }
      ]
    }
  }
]);
```

---

## 6. Under the Hood

### Memory Limits & Pipeline Optimization Engine

1. **The 100MB RAM Limit per Stage:**
   - By default, an individual aggregation stage cannot consume more than **100MB of RAM** (e.g., in-memory `$sort` on millions of documents or massive `$group` tables).
   - If exceeded, MongoDB aborts the query with `QueryExceededMemoryLimitNoDiskUseAllowed`.
   - *Fix:* Pass `{ allowDiskUse: true }` to allow stages to spill temporary blocks to disk storage.
2. **Internal Pipeline Optimization Passes:**
   - **`$match` + `$match` Coalescence:** Two consecutive `$match` stages are merged into a single `$match` with an `$and` expression.
   - **`$sort` + `$limit` Coalescence:** When `$sort` is followed immediately by `$limit`, MongoDB avoids sorting the entire dataset in RAM; it maintains a top-K heap of size $K$, running in $O(N \log K)$ memory.
   - **`$project` / `$match` Pushdown:** MongoDB automatically moves `$match` stages ahead of `$project` stages whenever possible to leverage indexes.

---

## 7. Important Rules

1. **Place `$match` and `$sort` at the Very Beginning:** A pipeline can **only utilize indexes if `$match` and `$sort` appear as the first stages** in the pipeline before any document reshaping stages (`$unwind`, `$group`, `$project`).
2. **Index the Foreign Key in `$lookup`:** In a `$lookup` stage, MongoDB executes a query on the `from` collection for every incoming document. You **must create an index on the `foreignField`** in the target collection; otherwise, `$lookup` performs a full collection scan per document ($O(N \times M)$ catastrophic latency).
3. **The `_id` Requirement in `$group`:** In the `$group` stage, the `_id` expression is mandatory. To aggregate all documents into a single global summary, set `_id: null`.
4. **Beware of `$unwind` Document Multiplication:** If a document contains an array of 500 items, `$unwind` duplicates the document 500 times in memory. Unwinding massive arrays can quickly trigger the 100MB RAM limit.

---

## 8. Common Mistakes

### Mistake 1: Placing `$project` Before `$match`
Placing `$project` before `$match` prevents the query planner from using indexes on the filtered fields, forcing an expensive in-memory scan across every document in the collection.

### Mistake 2: Forgetting to `$unwind` After `$lookup`
`$lookup` always returns an **array** of matching documents, even if there is only 1 matching document. Accessing `$joinedField.propertyName` directly without `$unwind` fails because arrays do not expose child properties directly.

### Mistake 3: Unbounded `$push` Inside `$group`
Using `$push: "$$ROOT"` inside `$group` on large collections. This collects entire documents into arrays. If the grouped document exceeds **16MB (the hard BSON document size limit)**, the query crashes with `BSONObjectTooLarge`.

---

## 9. Best Practices

1. **Use `$set` / `$unset` Instead of `$project`:** In modern MongoDB, use `$set` (or `$addFields`) to add computed properties and `$unset` to remove properties. `$project` requires explicitly listing every single field you want to retain, which is brittle and verbose.
2. **Use `$merge` for Materialized Views:** For expensive analytical queries that run daily, write results directly to a separate collection using `$merge` (incremental update) or `$out` (full collection replacement).
3. **Filter Inside `$lookup` via Sub-Pipelines:** Use uncorrelated subqueries inside `$lookup` with a custom `pipeline` to filter joined documents *before* they are returned to the parent stage:
   ```javascript
   $lookup: {
     from: "reviews",
     let: { prodId: "$_id" },
     pipeline: [
       { $match: { $expr: { $and: [{ $eq: ["$productId", "$$prodId"] }, { $eq: ["$rating", 5] }] } } }
     ],
     as: "fiveStarReviews"
   }
   ```

---

## 10. Performance Considerations

* **Profiling Pipelines with `.explain("executionStats")`:** Inspect `stages.executionStats` to verify `totalDocsExamined` vs `nReturned`. If `IXSCAN` is present, the initial `$match` utilized an index.
* **Covered Aggregations:** If an initial stage requests only fields present in a compound index, MongoDB satisfies the query directly from RAM without loading document blocks from disk.

---

## 11. Security Considerations

* **NoSQL Injection in Aggregation Pipelines:** If user input is passed directly into `$match` without sanitization, attackers can inject query operators: `{ "$match": { "role": { "$ne": null } } }`. Always sanitize using Zod or use `mongo-sanitize` to strip `$` characters.
* **Denial of Service via Heavy Pipelines:** Unindexed `$lookup` stages or complex `$graphLookup` queries can peg the MongoDB CPU at 100%. Restrict aggregation endpoints behind strict rate limiting and set maximum query execution timeouts (`maxTimeMS`).

---

## 12. Complete Aggregation Stage Matrix

| Stage | Purpose | Placement Gotcha |
| :--- | :--- | :--- |
| **`$match`** | Filters documents matching a query condition | Uses index ONLY if placed first |
| **`$group`** | Groups documents by key; computes accumulators | `_id: null` for global aggregations |
| **`$project`** | Reshapes document fields; includes/excludes | Overrides shape; prefer `$set` |
| **`$unwind`** | Deconstructs an array field into individual docs | Can explode memory; use `preserveNullAndEmptyArrays` |
| **`$lookup`** | Performs a left outer join to an external collection | Target `foreignField` MUST be indexed |
| **`$facet`** | Executes multiple parallel aggregation pipelines | Each facet operates on identical input docs |
| **`$bucket`** | Groups documents into specified value ranges | Perfect for price / age histograms |
| **`$sort`** | Sorts documents | Uses index only if placed first |
| **`$limit`** | Restricts number of passing documents | Coalesces with `$sort` for top-K optimization |
| **`$merge`** | Writes pipeline output to an on-disk collection | Enables incremental materialized views |
| **`$count`** | Returns total document count passing stage | Lightweight count operator |

---

## 13. Trade-offs

* **Aggregation Pipeline vs Client-Side Processing:** Aggregation pipelines maximize performance by executing in C++ directly on the database server, but consume database CPU and RAM. Offloading processing to client workers preserves database resources at the cost of network transfer latency.
* **Normalized `$lookup` vs Denormalized Embedding:** Embedding subdocuments eliminates the need for `$lookup` entirely, providing sub-millisecond reads; however, embedded subdocuments increase document size and risk hitting the 16MB BSON ceiling.

---

## 14. Real-World Usage

* **E-Commerce Search Engines (Shopify / eBay):** Uses `$facet` to power faceted navigation (showing item counts per brand, rating, and price range concurrently alongside search results).
* **IoT Analytics Dashboards:** Aggregates millions of sensor telemetry records into hourly averages using `$group` and `$setWindowFields` to calculate 24-hour moving averages.

---

## 15. Placement Interview Questions

### Basic Level
1. **What is the MongoDB Aggregation Framework and how does it differ from `find()`?**
   * *Answer:* `find()` is a basic query tool used for retrieving and filtering documents. The Aggregation Framework is an advanced data processing engine where documents pass through a sequential, multi-stage pipeline (`$match`, `$group`, `$unwind`, `$lookup`). It allows developers to perform group-by aggregations, relational joins, document reshaping, and statistical calculations directly inside the database engine.

2. **What does the `$unwind` stage do?**
   * *Answer:* `$unwind` deconstructs an array field from the input documents to output a document for *every element* in the array. Each output document is identical to the input document except that the array is replaced by the specific element.

3. **What is the role of `_id` in the `$group` stage?**
   * *Answer:* `_id` specifies the grouping key. MongoDB groups all documents with the same distinct value of `_id` into a single output document. To calculate aggregate metrics across the entire collection without dividing into groups, specify `_id: null`.

4. **What is the difference between `$project` and `$set` (or `$addFields`)?**
   * *Answer:* `$project` defines a completely new document shape; any field not explicitly included (except `_id`) is excluded from the output. `$set` (or `$addFields`) appends new computed fields or overwrites existing fields while preserving all other existing fields automatically.

5. **What is the 100MB memory limit in aggregation stages and how is it bypassed?**
   * *Answer:* MongoDB enforces a default 100MB RAM ceiling on any individual aggregation stage (like `$group` or in-memory `$sort`). If a stage exceeds 100MB, the query crashes. You bypass this limit by setting the option `{ allowDiskUse: true }`, allowing MongoDB to spill intermediate data blocks to temporary disk storage.

---

### Conceptual Level
6. **How does MongoDB optimize an aggregation pipeline containing `$match`, `$sort`, and `$limit`?**
   * *Answer:*
     - *Index Utilization:* If `$match` and `$sort` appear at the start of the pipeline, MongoDB uses the collection's B-Tree index to perform index scans instead of loading documents.
     - *Coalescence:* When `$sort` is followed immediately by `$limit`, the engine combines them into a single top-K heap sort in memory. Instead of sorting 10 million rows, it keeps an array of size $K$, running in $O(N \log K)$ time.

7. **Explain the difference between correlated and uncorrelated `$lookup`.**
   * *Answer:*
     - *Uncorrelated `$lookup` (Equality match):* Uses `localField` and `foreignField`. Executes a straightforward equality join against the foreign collection.
     - *Correlated `$lookup` (Sub-pipeline):* Uses `let` to define variables from the parent document and executes a custom inner `pipeline` with `$expr`. Allows complex joins with filtering, sorting, and projections inside the target collection before returning results.

8. **How does `$facet` work and what are its limitations?**
   * *Answer:* `$facet` executes multiple aggregation sub-pipelines concurrently within a single stage on the exact same input document set.
   * *Limitations:* All facet outputs are returned inside a single root document. Therefore, the combined output of all facets must not exceed the hard **16MB BSON document size limit**.

9. **What is the difference between `$push` and `$addToSet` in `$group`?**
   * *Answer:* Both accumulate values into an array during grouping. `$push` appends every value encountered, preserving duplicates and order. `$addToSet` appends only unique values, automatically deduplicating items (functioning like a mathematical set).

10. **Explain how `$setWindowFields` provides SQL-style Window Functions in MongoDB 5.0+.**
    * *Answer:* `$setWindowFields` allows calculating running totals, moving averages, ranks (`$denseRank`), and lead/lag values across spans of documents partitioned by a key *without* collapsing documents into groups. It maintains the original document granularity while appending calculated window metrics.

---

### Implementation Level
11. **Write an aggregation pipeline to find the Monthly Active Users (MAU) for the year 2026.**
    * *Answer:*
    ```javascript
    db.userLogins.aggregate([
      {
        $match: {
          timestamp: { 
            $gte: ISODate("2026-01-01T00:00:00Z"), 
            $lt: ISODate("2027-01-01T00:00:00Z") 
          }
        }
      },
      {
        $group: {
          _id: {
            month: { $month: "$timestamp" },
            userId: "$userId"
          }
        }
      },
      {
        $group: {
          _id: "$_id.month",
          monthlyActiveUsers: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    ```

12. **Write a pipeline that performs a left outer join between `orders` and `users` to attach user profile information.**
    * *Answer:*
    ```javascript
    db.orders.aggregate([
      {
        $lookup: {
          from: "users",
          localField: "userId",
          foreignField: "_id",
          as: "userProfile"
        }
      },
      // Deconstruct array to object (preserve orders even if user is deleted)
      {
        $unwind: {
          path: "$userProfile",
          preserveNullAndEmptyArrays: true
        }
      }
    ]);
    ```

13. **How do you calculate the average rating and review count per product, filtering out products with fewer than 5 reviews?**
    * *Answer:*
    ```javascript
    db.reviews.aggregate([
      {
        $group: {
          _id: "$productId",
          avgRating: { $avg: "$rating" },
          reviewCount: { $sum: 1 }
        }
      },
      {
        $match: {
          reviewCount: { $gte: 5 }
        }
      },
      {
        $project: {
          _id: 0,
          productId: "$_id",
          avgRating: { $round: ["$avgRating", 1] },
          reviewCount: 1
        }
      }
    ]);
    ```

14. **How do you filter elements inside an array without unwinding using `$filter`?**
    * *Answer:*
    ```javascript
    db.orders.aggregate([
      {
        $project: {
          orderNumber: 1,
          expensiveItems: {
            $filter: {
              input: "$items",
              as: "item",
              cond: { $gte: ["$$item.price", 100] }
            }
          }
        }
      }
    ]);
    ```

15. **How do you implement an incremental materialized view using `$merge`?**
    * *Answer:*
    ```javascript
    db.dailySales.aggregate([
      { $match: { date: ISODate("2026-03-01T00:00:00Z") } },
      { $group: { _id: "$storeId", dailyTotal: { $sum: "$amount" } } },
      {
        $merge: {
          into: "monthlySalesSummary",
          on: "_id",
          whenMatched: "replace",
          whenNotMatched: "insert"
        }
      }
    ]);
    ```

---

### Debugging Level
16. **Why does an aggregation pipeline crash with `QueryExceededMemoryLimitNoDiskUseAllowed`?**
    * *Answer:* An in-memory stage (typically `$sort` or `$group`) consumed more than 100MB of RAM.
    * *Fixes:*
      1. Add `{ allowDiskUse: true }` to the aggregation call options.
      2. Ensure `$match` filters out unnecessary documents early.
      3. Create an index supporting the `$sort` field so sorting is performed via index scan instead of in memory.

17. **Why is a `$lookup` stage taking 40 seconds to process 1,000 documents?**
    * *Answer:* The target collection specified in `from: "..."` does **not have an index on the `foreignField`**. For every one of the 1,000 documents, MongoDB performs a complete collection scan on the foreign table. If the foreign table has 500,000 documents, MongoDB inspects 500,000,000 records ($O(N \times M)$). Create an index on `foreignField` to reduce lookup time from 40 seconds to 20 milliseconds.

18. **Why does `$unwind` cause documents with empty arrays to disappear from query results?**
    * *Answer:* By default, `$unwind` discards documents where the target array is empty (`[]`), `null`, or missing.
    * *Fix:* Pass the option `{ preserveNullAndEmptyArrays: true }`:
    ```javascript
    { $unwind: { path: "$tags", preserveNullAndEmptyArrays: true } }
    ```

19. **Why did an aggregation query fail with `BSONObj size: 16793600 bytes is too large`?**
    * *Answer:* A `$group` stage used `$push: "$$ROOT"` or accumulated massive sub-arrays, causing a single output document to exceed the **16MB BSON physical document limit**. Avoid pushing entire documents; project only necessary scalar fields or paginate using `$limit`/`$skip`.

20. **Why did an aggregation query ignore an index on a field filtered in `$match`?**
    * *Answer:* The `$match` stage was placed *after* a reshaping stage like `$project` or `$unwind`. Once documents pass through `$project` or `$unwind`, they are detached from the underlying collection indexes. Always position `$match` as the **first stage** in the pipeline.

---

### Scenario-Based Questions
21. **Scenario: You are designing an e-commerce dashboard. The business requires calculating the 7-day moving average of sales revenue across 1,000 stores. How do you implement this?**
    * *Answer:* Use `$setWindowFields`:
    ```javascript
    db.storeSales.aggregate([
      {
        $setWindowFields: {
          partitionBy: "$storeId",
          sortBy: { date: 1 },
          output: {
            movingAvg7Days: {
              $avg: "$dailyRevenue",
              window: {
                range: [-7, 0],
                unit: "day"
              }
            }
          }
        }
      }
    ]);
    ```

22. **Scenario: You have a social network with 10 million posts. Each post has an array of up to 10,000 user likes (`likedBy: [userId1, userId2, ...]`). How do you count total likes per post without blowing up memory?**
    * *Answer:* Do NOT use `$unwind` on 10,000-element arrays! Use the `$size` operator directly in a `$project` or `$set` stage:
    ```javascript
    db.posts.aggregate([
      {
        $project: {
          title: 1,
          likeCount: { $size: { $ifNull: ["$likedBy", []] } }
        }
      }
    ]);
    ```
    Executes in $O(1)$ memory without array multiplication.

23. **Scenario: You are building an analytics pipeline that processes 50 million clickstream events nightly and generates a summarized report. How do you ensure it does not impact production OLTP workloads?**
    * *Answer:*
      1. Route the aggregation query to a dedicated **Secondary Read Replica** using read preference: `db.getMongo().setReadPref('secondary')`.
      2. Enable `{ allowDiskUse: true }`.
      3. Set `maxTimeMS: 600000` (10-minute timeout).
      4. Write output to an analytical summary collection using `$merge`.

24. **Scenario: How do you implement a tag cloud generator that counts tag frequencies across all blog posts?**
    * *Answer:*
    ```javascript
    db.posts.aggregate([
      { $match: { isPublished: true } },
      { $unwind: "$tags" },
      { $group: { _id: { $toLower: "$tags" }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
      { $project: { _id: 0, tag: "$_id", count: 1 } }
    ]);
    ```

25. **Scenario: You need to detect duplicate accounts registered with identical phone numbers or email addresses in a users collection.**
    * *Answer:*
    ```javascript
    db.users.aggregate([
      {
        $group: {
          _id: "$email",
          count: { $sum: 1 },
          userIds: { $push: "$_id" }
        }
      },
      {
        $match: {
          count: { $gt: 1 }
        }
      }
    ]);
    ```

---

### Advanced Architectural Questions
26. **Explain the difference between Map-Reduce and the Aggregation Pipeline in MongoDB.**
    * *Answer:* Map-Reduce was MongoDB's legacy data processing model. It executed custom JavaScript functions inside SpiderMonkey, running slowly in a single-threaded JavaScript context. The Aggregation Pipeline was introduced as a C++ native replacement. It is 10x–50x faster, optimizes pipeline stages automatically, utilizes indexes, and completely deprecated Map-Reduce in MongoDB 5.0+.

27. **What is `$graphLookup` and how does it execute recursive tree traversals?**
    * *Answer:* `$graphLookup` performs recursive searches on a collection, traversing graph relationships (like organizational hierarchies, product category trees, or social follower networks):
      - `startWith`: Expression for initial search key.
      - `connectFromField` & `connectToField`: Defines relationship pointers between child and parent.
      - `maxDepth`: Restricts maximum recursive traversal depth.
      - Outputs an array of all connected hierarchical documents in a single stage.

28. **How does MongoDB optimize `$lookup` with Sub-Pipelines on Sharded Collections?**
    * *Answer:* In sharded clusters, `$lookup` between sharded collections requires the mongos router to coordinate document lookups across multiple shard servers. If not properly routed by the shard key, the query triggers a broadcast scatter-gather query across all shards. Always include the foreign collection's **shard key in the `$lookup` join condition** to direct queries to a single shard.

29. **What is the difference between `$merge` and `$out`?**
    * *Answer:*
      - `$out`: Replaces the entire target collection with the pipeline output. If target collection exists, it is completely dropped and recreated.
      - `$merge`: Introduced in MongoDB 4.2. Can output to existing collections across databases, and supports fine-grained actions: `whenMatched: "replace" | "keepExisting" | "merge"` and `whenNotMatched: "insert" | "discard"`. Enables continuous incremental updates.

30. **Explain how Accumulators differ in `$group` vs `$project`.**
    * *Answer:* In `$group`, accumulators (like `$sum`, `$avg`, `$push`) accumulate values across **multiple documents** to produce a single grouped summary. In `$project` (or `$set`), accumulators operate strictly **within a single document** (e.g., calculating `$sum: ["$subtotal", "$tax", "$shipping"]` across fields of the same row).

---

## 16. Coding Questions

### Coding Challenge 1: Customer Lifetime Value (LTV) Calculation Pipeline

```javascript
db.orders.aggregate([
  {
    $match: {
      status: "PAID",
      createdAt: { $gte: ISODate("2025-01-01T00:00:00Z") }
    }
  },
  {
    $group: {
      _id: "$customerId",
      totalSpent: { $sum: "$totalAmount" },
      firstOrderDate: { $min: "$createdAt" },
      lastOrderDate: { $max: "$createdAt" },
      orderCount: { $sum: 1 }
    }
  },
  {
    $lookup: {
      from: "customers",
      localField: "_id",
      foreignField: "_id",
      as: "customer"
    }
  },
  {
    $unwind: "$customer"
  },
  {
    $project: {
      _id: 0,
      customerId: "$_id",
      name: "$customer.name",
      email: "$customer.email",
      totalSpent: { $round: ["$totalSpent", 2] },
      orderCount: 1,
      relationshipDays: {
        $dateDiff: {
          startDate: "$firstOrderDate",
          endDate: "$lastOrderDate",
          unit: "day"
        }
      }
    }
  },
  { $sort: { totalSpent: -1 } },
  { $limit: 100 }
]);
```

### Coding Challenge 2: Monthly Cohort Retention Aggregation Pipeline

```javascript
db.userActivity.aggregate([
  // Stage 1: Group by user to find their cohort month (first active month)
  {
    $group: {
      _id: "$userId",
      cohortMonth: { $min: { $dateToString: { format: "%Y-%m", date: "$timestamp" } } },
      activityMonths: { $addToSet: { $dateToString: { format: "%Y-%m", date: "$timestamp" } } }
    }
  },
  // Stage 2: Unwind activity months to analyze retention
  { $unwind: "$activityMonths" },
  // Stage 3: Group by cohort month and active month
  {
    $group: {
      _id: {
        cohort: "$cohortMonth",
        active: "$activityMonths"
      },
      retainedUsers: { $sum: 1 }
    }
  },
  { $sort: { "_id.cohort": 1, "_id.active": 1 } }
]);
```

---

## 17. Common Interview Traps

* **The Trap:** The interviewer asks: *"Does an aggregation pipeline always run faster than running individual `find()` queries and processing data in a Node.js loop?"*
  * **How candidates fail:** Saying "Yes, database aggregations are always faster."
  * **The Winning Answer:** In 95% of analytical queries, aggregations are dramatically faster because they avoid network overhead and run natively in C++. However, in high-throughput transactional OLTP systems (e.g., 50,000 req/sec), executing complex multi-stage aggregations on the primary database will saturate database CPU and exhaust connection threads. For high-frequency transactions, simple indexed `find()` queries or background pre-calculated counters are far superior.
* **The Trap:** *"Can you use `$lookup` to join collections located in different MongoDB databases?"*
  * **How candidates fail:** Saying "No, MongoDB only joins collections within the exact same database."
  * **The Winning Answer:** Prior to MongoDB 4.4, `$lookup` was restricted to the same database. However, **MongoDB 4.4+ introduced cross-database `$lookup`** within the same MongoDB instance or replica set:
  ```javascript
  { $lookup: { from: { db: "analytics_db", coll: "logs" }, ... } }
  ```

---

## 18. Revision Summary

```
+-----------------------------------------------------------------------------------+
|               MongoDB Aggregations High-Yield Revision Matrix                     |
+-----------------------------------------------------------------------------------+
| Index Rules:         $match and $sort MUST be first to utilize B-Tree indexes     |
| Memory Ceiling:      100MB per stage; bypass via { allowDiskUse: true }           |
| Array Handling:      $unwind breaks arrays into docs; use preserveNullAndEmpty    |
| Joins:               $lookup requires index on foreignField ($O(N \times M)$ trap)|
| Faceting:            $facet runs parallel pipelines; combined result < 16MB       |
| Materialized Views:  $merge enables incremental updates to physical collections   |
| Window Functions:    $setWindowFields computes moving averages without collapsing |
+-----------------------------------------------------------------------------------+
```

---

## 19. Quick Reference

* **`$match`:** Filters documents; uses index if placed at stage 1.
* **`$group`:** Accumulates documents by `_id` key (`_id: null` for total sum).
* **`$unwind`:** Expands array into individual documents.
* **`$lookup`:** Left outer join; always index `foreignField`.
* **`$facet`:** Multi-faceted search running parallel pipelines.
* **`$bucket`:** Automatic value histogram bucketing.
* **`$merge`:** Writes output into target collection incrementally.
* **`{ allowDiskUse: true }`:** Bypasses 100MB RAM stage limit.
