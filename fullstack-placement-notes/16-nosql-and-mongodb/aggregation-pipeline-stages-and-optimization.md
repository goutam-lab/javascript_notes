# MongoDB Aggregation Pipeline: Stages, Operators, and Optimization

## 1. What is it?
The **MongoDB Aggregation Pipeline** is an advanced, multi-stage data processing framework modeled on the Unix pipe concept (`cat file | grep pattern | sort | uniq -c`). 

Instead of executing simple CRUD queries, documents enter a multi-stage sequential pipeline where each stage performs a specific transformation (filtering, grouping, reshaping, joining, sorting, or unwinding arrays) and passes its transformed output to the subsequent stage:

$$\text{Collection Documents} \longrightarrow [\$match] \longrightarrow [\$group] \longrightarrow [\$project] \longrightarrow [\$sort] \longrightarrow \text{Final Aggregated Result}$$

The most critical stages include:
- **`$match`**: Filters documents (similar to SQL `WHERE`).
- **`$group`**: Groups documents by a shared key and computes metrics (similar to SQL `GROUP BY`).
- **`$project`**: Reshapes documents, adds computed fields, or suppresses attributes.
- **`$unwind`**: Deconstructs an array field from input documents to output a document for *each* element.
- **`$lookup`**: Performs a left outer join to an unsharded collection in the same database.
- **`$sort`**, **`$limit`**, **`$skip`**: Ordering and pagination controls.

---

## 2. Why does it exist?
1. **Pushing Complex Analytics to the Engine**: Complex business metrics (e.g., calculating monthly customer churn, e-commerce sales attribution, or cohort retention) cannot be expressed with simple `find()` queries. Fetching millions of raw documents into Node.js to compute metrics in JavaScript causes memory overflows and freezes the event loop. The Aggregation Pipeline runs natively inside the database engine in optimized C++.
2. **Transforming Document Structures**: BSON documents often contain nested arrays. Aggregation operators allow flattening arrays (`$unwind`), computing array intersections, and reshaping hierarchical data into flat tabular formats.
3. **Multi-Collection Relational Joins (`$lookup`)**: While MongoDB emphasizes embedding, enterprise applications still require joining disparate collections (e.g., joining an `orders` collection with a `customers` collection).

---

## 3. Mental Model
Think of the Aggregation Pipeline as an **Automated Industrial Factory Assembly Line**:
- **Stage 1 (`$match`)**: Quality control inspector stands at the conveyor belt entrance and throws away broken parts. (Reduces dataset volume early).
- **Stage 2 (`$unwind`)**: A worker opens a box containing 5 bolts and places each bolt individually onto the belt.
- **Stage 3 (`$group`)**: Sorters place bolts into color-coded bins and weigh each bin on an industrial scale.
- **Stage 4 (`$project`)**: A painter paints a fresh label on each bin, writing only the color name and total weight.
- **Stage 5 (`$sort` & `$limit`)**: A forklift picks up the 3 heaviest bins and ships them to the loading dock.

---

## 4. Basic Example
A standard multi-stage aggregation pipeline calculating total revenue and average order size per customer for completed orders:

```javascript
db.orders.aggregate([
  // Stage 1: Filter raw orders (uses indexes!)
  {
    $match: {
      status: "COMPLETED",
      orderDate: { $gte: ISODate("2026-01-01") }
    }
  },
  
  // Stage 2: Group by customer and compute metrics
  {
    $group: {
      _id: "$customerId",
      totalSpent: { $sum: "$totalAmount" },
      ordersCount: { $sum: 1 },
      avgOrderValue: { $avg: "$totalAmount" },
      purchasedProducts: { $addToSet: "$productId" }
    }
  },
  
  // Stage 3: Reshape output and round decimals
  {
    $project: {
      _id: 0,
      customerId: "$_id",
      totalSpent: 1,
      ordersCount: 1,
      avgOrderValue: { $round: ["$avgOrderValue", 2] },
      distinctProductsCount: { $size: "$purchasedProducts" }
    }
  },
  
  // Stage 4: Filter high-value customers (HAVING equivalent)
  {
    $match: {
      totalSpent: { $gte: 1000.00 }
    }
  },
  
  // Stage 5: Sort descending by spend
  {
    $sort: { totalSpent: -1 }
  },
  
  // Stage 6: Paginate top 10
  {
    $limit: 10
  }
]);
```

---

## 5. Real Example: E-Commerce Multi-Table `$lookup` and `$unwind` in TypeScript
A production TypeScript service calculating product category performance, joining orders to products, and unwinding line item arrays:

```typescript
import { Collection, Document } from 'mongodb';

export interface CategoryRevenueMetric {
  category: string;
  totalRevenue: number;
  totalUnitsSold: number;
  uniqueOrdersCount: number;
}

export class AnalyticsPipelineService {
  constructor(private readonly ordersCollection: Collection<Document>) {}

  /**
   * COMPLEX AGGREGATION PIPELINE WITH $lookup AND $unwind
   */
  public async getRevenueByCategory(startDate: Date): Promise<CategoryRevenueMetric[]> {
    const pipeline: Document[] = [
      // 1. $match: Filter orders early to leverage index on { status: 1, createdAt: 1 }
      {
        $match: {
          status: 'PAID',
          createdAt: { $gte: startDate }
        }
      },

      // 2. $unwind: Deconstruct embedded items array (1 doc with 3 items -> 3 docs)
      {
        $unwind: '$items'
      },

      // 3. $lookup: Join to products collection to resolve category
      {
        $lookup: {
          from: 'products',
          localField: 'items.productId',
          foreignField: '_id',
          as: 'productDetails'
        }
      },

      // 4. $unwind: Flatten the joined productDetails array
      {
        $unwind: '$productDetails'
      },

      // 5. $group: Group by product category and accumulate revenue
      {
        $group: {
          _id: '$productDetails.category',
          totalRevenue: {
            $sum: { $multiply: ['$items.quantity', '$items.unitPrice'] }
          },
          totalUnitsSold: { $sum: '$items.quantity' },
          uniqueOrders: { $addToSet: '$_id' }
        }
      },

      // 6. $project: Format final reporting structure
      {
        $project: {
          _id: 0,
          category: '$_id',
          totalRevenue: { $round: ['$totalRevenue', 2] },
          totalUnitsSold: 1,
          uniqueOrdersCount: { $size: '$uniqueOrders' }
        }
      },

      // 7. $sort: Rank categories by revenue
      {
        $sort: { totalRevenue: -1 }
      }
    ];

    return await this.ordersCollection.aggregate<CategoryRevenueMetric>(pipeline).toArray();
  }
}
```

---

## 6. Under the Hood

### 1. Internal Pipeline Optimization Engine
MongoDB's query optimizer automatically rewrites and coalesces pipeline stages before execution:

```
Optimization Transformations:
1. $match Early Pushdown:
   Pipeline:  [ $sort ] -> [ $match ]
   Optimized: [ $match ] -> [ $sort ]  (Filters rows before sorting!)

2. Stage Coalescing ($sort + $limit):
   Pipeline:  [ $sort ] -> [ $limit: 10 ]
   Optimized: Merged into a Top-N Heap Sort node (Consumes only 10 memory slots!)

3. Projection Pushdown:
   MongoDB analyzes subsequent stages and automatically restricts fields 
   loaded from disk to only those referenced in downstream expressions.
```

### 2. The 100MB RAM Stage Limit and `allowDiskUse`
- Each individual aggregation stage has a strict **100 Megabyte in-memory RAM limit**.
- If a `$group` or `$sort` stage processes a large dataset that exceeds 100MB of RAM, MongoDB halts execution with:
  `QueryExceededMemoryLimitNoDiskUseAllowed: Exceeded memory limit for $group, but did not allow external sort. Pass allowDiskUse:true`.
- **The Solution**:
  ```typescript
  // Allows WiredTiger to write temporary spill files to disk
  collection.aggregate(pipeline, { allowDiskUse: true });
  ```
- **Performance Caution**: While `allowDiskUse: true` prevents query crashes, disk I/O degrades pipeline speed by 10x–50x. Optimize the pipeline to reduce data volume before grouping!

---

## 7. Important Rules
1. **Always Place `$match` at the Very Beginning**: Only a `$match` stage placed at the **start** of a pipeline can utilize B-Tree indexes! Once an aggregation passes through a `$project`, `$group`, or `$unwind` stage, index access is impossible, forcing subsequent stages to process documents in memory.
2. **Filter Before `$unwind`**: Never unwind an array across an entire collection before filtering. Unwinding 1,000,000 documents with an average of 10 items creates 10,000,000 intermediate documents in RAM! Always place `$match` before `$unwind`.
3. **Field References Must Be Prefixed with `$`**: In expressions, referencing a document's field value requires a leading dollar sign (`"$totalAmount"`). Omitting the `$` treats `"totalAmount"` as a literal string constant instead of reading the field value!

---

## 8. Common Mistakes

### 1. The Missing Dollar Sign Syntax Bug
```javascript
// BUG: Treats "price" as literal string text!
// Result: $sum evaluates to NaN or 0!
{ $group: { _id: "$category", total: { $sum: "price" } } }

// CORRECT: Uses $price to reference field value
{ $group: { _id: "$category", total: { $sum: "$price" } } }
```

### 2. Excessive `$lookup` Invocations
Using 5 nested `$lookup` stages to simulate complex relational joins. MongoDB is not an optimized relational join engine; multi-stage lookups cause nested-loop disk thrashing. If your application requires 5-way joins on every query, the schema should either be denormalized or migrated to PostgreSQL.

---

## 9. Best Practices

### 1. Conditional Fields with `$cond` (Ternary Operator)
```javascript
{
  $project: {
    title: 1,
    pricingTier: {
      $cond: {
        if: { $gte: ["$price", 1000] },
        then: "PREMIUM",
        else: "STANDARD"
      }
    }
  }
}
```

### 2. Profiling Pipelines with `explain()`
Run `.explain("executionStats")` on your aggregation pipeline:
```typescript
const plan = await collection.aggregate(pipeline).explain('executionStats');
```
Verify that the initial `$match` stage outputs `stage: "IXSCAN"` rather than `COLLSCAN`.

---

## 10. Performance Considerations
- **Index Support for `$sort` + `$match`**: If a pipeline begins with `$match` followed by `$sort`, a compound index matching the **ESR rule** satisfies both stages simultaneously using an index scan with zero memory usage.
- **Streaming Pipeline Execution**: Stages like `$match` and `$project` operate as stream filters (documents flow through one-by-one with $O(1)$ memory). Stages like `$group` and `$sort` are **blocking stages**; they must accumulate the entire input stream before emitting the first result.

---

## 11. Security Considerations
- **Aggregation Pipeline Injection**: Passing user-controlled request objects directly into aggregation stages (e.g., `db.orders.aggregate(req.body.stages)`) allows attackers to inject `$lookup` stages to exfiltrate passwords or sensitive data from other collections. Never accept raw pipeline stages from untrusted clients.

---

## 12. Alternatives
1. **Map-Reduce**: MongoDB's legacy analytics framework; officially deprecated in favor of the Aggregation Pipeline due to JavaScript engine performance bottlenecks.
2. **External Data Warehouses (Snowflake / BigQuery)**: When analytical queries must process billions of historical documents across years of historical data.

---

## 13. Trade-offs

| Method | Speed | Memory Limit | Expressiveness |
| :--- | :--- | :--- | :--- |
| **Simple `find()`** | Fastest | 32MB Sort Limit | Simple filters and projections |
| **Aggregation Pipeline** | Very Fast in RAM | 100MB per stage (unless `allowDiskUse`) | Complete analytical transformations |
| **Application-Layer JS** | Slowest (High network transfer) | Node.js Heap Limit | Arbitrary TypeScript code |

---

## 14. Real-World Usage
- **Real-Time Dashboards**: SaaS platforms generate real-time usage charts and conversion funnels using scheduled aggregation pipelines.
- **Activity Feed Generation**: Social apps join user follows, group memberships, and post documents using `$lookup` and `$facet` to render multi-widget homepages in a single query.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the MongoDB Aggregation Pipeline, and how does it process data?**  
*Answer*: The Aggregation Pipeline is a multi-stage framework for data processing and analysis. Documents from a collection pass through a sequence of stages (such as `$match`, `$group`, `$project`, and `$sort`) where each stage transforms the documents and passes the output to the next stage in a linear pipeline.

### Conceptual
**Q: Why is placing `$match` at the start of an aggregation pipeline critical for performance?**  
*Answer*: Placing `$match` as the very first stage allows MongoDB to use **B-Tree indexes** to filter documents, minimizing the volume of data read from disk. Once documents pass through transforming stages like `$project`, `$group`, or `$unwind`, the data structure is modified in memory, preventing the query planner from using indexes and forcing subsequent stages to execute full collection scans in memory.

### Implementation
**Q: What is the purpose of the `$unwind` stage in an aggregation pipeline? Give an example.**  
*Answer*: The `$unwind` stage deconstructs an array field from the input documents to output a separate document for **each element** in the array.  
*Example*: If a document is `{ _id: 1, tags: ['news', 'tech'] }`, applying `{ $unwind: "$tags" }` produces two distinct output documents:  
1. `{ _id: 1, tags: 'news' }`  
2. `{ _id: 1, tags: 'tech' }`  
This enables grouping, filtering, or sorting by individual array values.

### Debugging
**Q: A production aggregation pipeline crashes with `QueryExceededMemoryLimitNoDiskUseAllowed: Exceeded memory limit for $group`. What caused this error, and what are two ways to fix it?**  
*Answer*: The error occurred because a blocking aggregation stage (like `$group` or `$sort`) exceeded the strict **100MB in-memory RAM limit**.  
- Fix 1: Optimize the pipeline by placing a selective `$match` or `$project` stage earlier in the pipeline to filter out unnecessary documents and fields before the `$group` stage.  
- Fix 2: Enable disk spilling by setting `{ allowDiskUse: true }` in the aggregation options: `collection.aggregate(pipeline, { allowDiskUse: true })`.

### Scenario
**Q: How does `$lookup` perform a left outer join between two collections in MongoDB?**  
*Answer*: The `$lookup` stage specifies four parameters:
```javascript
{
  $lookup: {
    from: "foreignCollection",    // The collection to join
    localField: "localFieldKey",  // Field in current document
    foreignField: "foreignKey",   // Field in foreign collection
    as: "joinedArrayField"        // Name of the new array field to output
  }
}
```
MongoDB reads matching documents from `foreignCollection` and embeds them as an array inside the output document under `joinedArrayField`. If no matches exist, an empty array `[]` is output.

### Advanced
**Q: What is the `$facet` stage in MongoDB aggregation, and what production UI use case does it solve?**  
*Answer*: The `$facet` stage allows executing **multiple independent aggregation pipelines in parallel** over the same input stream of documents within a single database round-trip. Its primary production use case is powering **E-Commerce Faceted Search Pages**: in a single query, one sub-pipeline calculates price distribution buckets, a second sub-pipeline counts available brands, a third counts available sizes, and a fourth paginates the actual matching product cards.

---

## 16. Coding Questions

### Problem 1: Faceted E-Commerce Category Aggregation with Stats and Top Products
Write an aggregation pipeline that takes a product catalog and returns:
1. Category overall statistics (total products, average price, min price, max price).
2. The top 3 most expensive products in each category.

```javascript
db.products.aggregate([
  // Step 1: Filter active products
  { $match: { isActive: true } },

  // Step 2: Sort by price descending
  { $sort: { price: -1 } },

  // Step 3: Group by category, calculating stats and pushing top products
  {
    $group: {
      _id: "$category",
      totalProducts: { $sum: 1 },
      avgPrice: { $avg: "$price" },
      minPrice: { $min: "$price" },
      maxPrice: { $max: "$price" },
      // Collect product summaries into an array
      allProducts: {
        $push: {
          title: "$title",
          price: "$price",
          sku: "$sku"
        }
      }
    }
  },

  // Step 4: Slice the top 3 products and format output
  {
    $project: {
      _id: 0,
      category: "$_id",
      totalProducts: 1,
      avgPrice: { $round: ["$avgPrice", 2] },
      minPrice: 1,
      maxPrice: 1,
      top3ExpensiveProducts: { $slice: ["$allProducts", 3] } // Takes first 3 items
    }
  },

  // Step 5: Sort categories by total products descending
  { $sort: { totalProducts: -1 } }
]);
```

---

## 17. Common Interview Traps
- **Trap 1**: Forgetting that `$lookup` outputs an **array**. Even for a 1-to-1 relationship, `$lookup` embeds matching records in an array (`customer: [{ name: "Alice" }]`). You must append an `{ $unwind: "$customer" }` stage to turn it into an object.
- **Trap 2**: Believing `allowDiskUse` is enabled by default. It is disabled by default; any blocking stage exceeding 100MB of RAM will crash unless explicitly enabled.
- **Trap 3**: Confusing `$match` with `$filter`. `$match` is a pipeline stage that filters the stream of documents; `$filter` is an array operator used inside `$project` or `$addFields` to filter elements within an existing array.

---

## 18. Revision Summary
- The Aggregation Pipeline processes documents through sequential transformation stages.
- `$match` filters; `$group` aggregates; `$project` reshapes; `$unwind` flattens arrays; `$lookup` performs left outer joins.
- Always place `$match` at stage 0 to leverage B-Tree indexes.
- Each stage has a strict 100MB RAM limit; use `{ allowDiskUse: true }` to permit temporary disk spilling.
- Field references in expressions must always be prefixed with a dollar sign (`"$fieldName"`).

---

## 19. Quick Reference

| Stage | Purpose | SQL Analogue | Index Capable? |
| :--- | :--- | :--- | :--- |
| **`$match`** | Filters documents | `WHERE` / `HAVING` | Yes (if at Stage 0) |
| **`$group`** | Summarizes data | `GROUP BY` + Aggregates | No (Blocking stage) |
| **`$project`** | Reshapes output fields | `SELECT` clause | No |
| **`$unwind`** | Deconstructs array to docs | Table-valued function | No |
| **`$lookup`** | Joins other collection | `LEFT JOIN` | Yes (uses foreign index)|
| **`$sort`** | Sorts document stream | `ORDER BY` | Yes (if at Stage 0) |
| **`$facet`** | Multi-pipeline parallel processing| Multiple queries | No |
