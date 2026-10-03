# MongoDB Schema Design: Embedding vs. Referencing

## 1. What is it?
In MongoDB schema architecture, deciding how to model relationships between entities is the single most critical engineering decision. Unlike relational databases where the answer is almost always "normalize into a new table with a foreign key," MongoDB offers two distinct architectural paradigms:
- **Embedding (Denormalized / Nested Documents)**: Storing related data directly inside the parent document as a sub-document or an array of sub-documents.
- **Referencing (Normalized / Manual or `$lookup` References)**: Storing related data in a separate collection and linking documents via an identifier reference (`ObjectId`).

Choosing between embedding and referencing is governed by data cardinality (**1-to-1**, **1-to-Few**, **1-to-Many**, **1-to-Squillions**, and **Many-to-Many**) and application query access patterns.

```
Embedding Pattern (Nested Array):
[User Document: {
  _id: 1,
  name: "Alice",
  addresses: [
    { street: "123 Main St", city: "Seattle" },
    { street: "456 Market St", city: "Austin" }
  ]
}]
Pros: Single disk read fetches all data. 0 JOINs.
Cons: Document size grows; updating sub-document requires full parent document write.

Referencing Pattern (Normalized Collections):
[Users Collection: { _id: 1, name: "Alice" }]
                      ^
                      | Linked via userId: 1
[Addresses Collection: { _id: 101, userId: 1, street: "123 Main St", city: "Seattle" }]
[Addresses Collection: { _id: 102, userId: 1, street: "456 Market St", city: "Austin" }]
Pros: Unbounded scale; independent updates; no 16MB document limit hazard.
Cons: Requires multiple network queries or expensive $lookup aggregations.
```

---

## 2. Why does it exist?
1. **Eliminating the Cost of Joins**: In distributed NoSQL databases, executing relational joins across collections that may reside on different physical shard servers (cross-shard joins) causes severe network saturation and high latency. Embedding enables atomic, single-document retrieval with zero network joins.
2. **Atomic In-Place Mutations**: MongoDB guarantees ACID atomicity at the **single document level**. By embedding related child data inside the parent document, updates to both parent and children succeed or fail together atomically without requiring multi-document distributed transactions.
3. **Preventing Document Explosion**: If an entity has millions of child records (e.g., IoT temperature logs per sensor), embedding all logs into a single document breaches the 16MB BSON size limit and degrades performance. Referencing decouples unbounded child growth from parent documents.

---

## 3. Mental Model
Think of Embedding vs Referencing as **Packing for a Vacation vs Shipping Furniture**:
- **Embedding (Your Suitcase)**: You pack your passport, sunglasses, clothes, and phone charger directly into your carry-on bag. When you arrive at the airport, you grab your suitcase and you have everything immediately in one grab. This works because you only have a few shirts and one charger (**1-to-Few**).
- **Referencing (A Freight Warehouse)**: You wouldn't pack a king-size bed, refrigerator, and 500 books into your carry-on suitcase. It would explode the zipper (**16MB limit**). Instead, you keep the furniture in a separate warehouse and carry an inventory claim receipt with a barcode (**`ObjectId` reference**). When you need the furniture, you look up the barcode.

---

## 4. Basic Example
Embedding vs Referencing syntax in MongoDB / Mongoose:

```typescript
// 1. EMBEDDED MODEL: 1-to-Few Relationship (User Addresses)
interface EmbeddedUser {
  _id: ObjectId;
  name: string;
  email: string;
  addresses: Array<{
    type: 'BILLING' | 'SHIPPING';
    street: string;
    city: string;
    zip: string;
  }>; // Embedded directly: retrieved in 1 query!
}

// 2. REFERENCED MODEL: 1-to-Many Unbounded Relationship (Author & Books)
interface Author {
  _id: ObjectId;
  name: string;
  bio: string;
}

interface Book {
  _id: ObjectId;
  title: string;
  isbn: string;
  authorId: ObjectId; // Reference to Author collection
  publishedYear: number;
}
```

---

## 5. Real Example: The "Subset Pattern" for High-Read Feeds in TypeScript
A production TypeScript schema implementing the **Subset Pattern** for a social media or e-commerce platform. It embeds the top 10 most recent comments for instant page rendering, while referencing the complete comment history in a separate collection:

```typescript
import { ObjectId } from 'mongodb';

// Product Document using the Subset Pattern
export interface ProductDocument {
  _id: ObjectId;
  title: string;
  price: number;
  totalReviewsCount: number;
  averageRating: number;
  
  // SUBSET PATTERN: Embed only the top 5 most recent reviews for instant feed rendering
  recentReviewsSubset: Array<{
    reviewId: ObjectId;
    authorName: string;
    rating: number;
    comment: string;
    createdAt: Date;
  }>;
}

// Complete Reviews Collection: Holds all 100,000+ reviews without hitting 16MB limit
export interface FullReviewDocument {
  _id: ObjectId;
  productId: ObjectId; // Reference to parent product
  userId: ObjectId;
  authorName: string;
  rating: number;
  comment: string;
  upvotes: number;
  createdAt: Date;
}

/**
 * REPOSITORY WORKFLOW:
 * 1. Product Detail Page Query:
 *    db.products.findOne({ _id: prodId })
 *    -> Returns product metadata + top 5 reviews in 1 single disk read (0.5ms)!
 * 
 * 2. "View All Reviews" Page (Pagination):
 *    db.reviews.find({ productId: prodId }).sort({ createdAt: -1 }).skip(5).limit(20)
 *    -> Only hit when the user explicitly clicks "Read More".
 */
```

---

## 6. Under the Hood

### The 5 Cardinality Rules of MongoDB Schema Design

```
Cardinality Matrix and Recommended Strategy:

1. One-to-One (1:1)       ===> Prefer EMBEDDING unless document exceeds 16MB or fields rarely read.
2. One-to-Few (1:N <= 100) ===> Prefer EMBEDDING (e.g., user addresses, order line items).
3. One-to-Many (1:N > 1000)===> Prefer REFERENCING (Parent Reference: child holds parent's _id).
4. One-to-Squillions      ===> Strict REFERENCING (Child holds parent's _id; e.g. IoT logs).
5. Many-to-Many (N:M)     ===> REFERENCING via Array of ObjectIds or Junction Collection.
```

### Deep Dive: Parent Referencing vs Child Referencing
- **Child Referencing (Anti-Pattern for large N)**: Storing an array of child IDs on the parent:
  ```json
  { "_id": 1, "title": "Sensor A", "log_ids": [101, 102, 103, ... 500000] }
  ```
  **Why it fails**: The `log_ids` array grows without bound, bloating the parent document and eventually exceeding 16MB.
- **Parent Referencing (Optimal for large N)**: Storing the parent's ID inside each child document:
  ```json
  // In logs collection:
  { "_id": 101, "sensor_id": 1, "temperature": 24.5 }
  { "_id": 102, "sensor_id": 1, "temperature": 24.8 }
  ```
  **Why it succeeds**: The parent document stays compact and fixed in size. You index `sensor_id` on the `logs` collection and query `logs.find({ sensor_id: 1 })`.

---

## 7. Important Rules
1. **Embed If Data is Queried Together**: If child data is always displayed on screen alongside the parent entity (e.g., order line items displayed on an invoice), **embed it**.
2. **Reference If Data is Queried Independently**: If an entity is queried, updated, or paginated separately (e.g., products searched across multiple categories), **reference it**.
3. **Beware of Two-Way Referencing Synchronization**: Storing `author.bookIds = []` AND `book.authorId = id`. If an author writes a book, both documents must be updated. If one fails, data becomes inconsistent. Choose one authoritative reference direction.
4. **Avoid Deep Nesting**: Limit document nesting to 2–3 levels. Deeper nesting makes queries and array update operators (`$[elem]`) cumbersome and error-prone.

---

## 8. Common Mistakes

### 1. The Relational Normalization Trap (Over-Referencing)
Splitting every entity into separate collections out of habit: a collection for `users`, a collection for `user_preferences`, a collection for `user_addresses`. Every query now requires 3 separate database calls or complex `$lookup` aggregations, completely defeating the purpose of choosing MongoDB.

### 2. The Uncontrolled Growth Anti-Pattern
Embedding an array of items that grows linearly over time (e.g., user notifications, chat messages, activity logs). The document grows continuously, causing WiredTiger to relocate the document on disk, fragmenting storage and eventually crashing on the 16MB limit.

---

## 9. Best Practices

### 1. The Extended Reference Pattern
When referencing an entity in another collection, avoid running `$lookup` joins on every read by embedding a few static, frequently displayed fields alongside the `ObjectId`:

```typescript
// IN ORDERS COLLECTION:
interface Order {
  _id: ObjectId;
  totalAmount: number;
  
  // EXTENDED REFERENCE: Stores the ID + cached display attributes
  customer: {
    id: ObjectId;
    name: string; // Copied from User to avoid joining User collection on invoice render!
    email: string;
  };
  
  createdAt: Date;
}
```

### 2. Multi-Key Indexing on Embedded Arrays
When embedding arrays, index elements inside the array so MongoDB can search internal properties with sub-millisecond B-Tree lookups:
```javascript
// Creates a multikey index on the nested street property across all addresses
db.users.createIndex({ "addresses.zip": 1 });
```

---

## 10. Performance Considerations
- **Disk I/O and Document Relocation**: In WiredTiger, if an embedded array expands and exceeds the current pre-allocated disk space for that document, WiredTiger must allocate a new chunk of disk blocks elsewhere, copy the entire document over, and mark the old slot as empty, causing high write latency and disk fragmentation.
- **`$lookup` Cost**: MongoDB's `$lookup` performs an in-memory left outer join. Running `$lookup` on unindexed foreign keys or across sharded clusters causes severe CPU spikes.

---

## 11. Security Considerations
- **PII Leakage in Embedded Subsets**: When copying user data into orders or review subsets (Extended Reference pattern), ensure sensitive personal data (e.g., social security numbers or phone numbers) is never duplicated. Only copy non-sensitive display attributes (`username`, `avatarUrl`).

---

## 12. Alternatives
1. **PostgreSQL Relational Foreign Keys**: Best when relationships are deeply interconnected, require strict referential integrity (`ON DELETE CASCADE`), and benefit from ACID multi-table transactions.
2. **Graph Databases (Neo4j)**: When relationships are complex, multi-layered (friends of friends), and traversing connections is the primary query pattern.

---

## 13. Trade-offs

| Criterion | Embedded Documents | Referenced Documents |
| :--- | :--- | :--- |
| **Read Latency** | Ultra-Fast ($O(1)$ single seek) | Moderate (Requires 2 queries or `$lookup`) |
| **Write Latency** | Faster for single document | Requires coordinating multiple collections |
| **Data Redundancy** | Higher (Duplicate copies across docs)| Minimal (Single normalized record) |
| **Scale Limit** | Strictly bounded by 16MB limit | Infinite (Unbounded horizontal growth) |
| **Atomicity** | Guaranteed without transactions | Requires multi-document ACID transactions |

---

## 14. Real-World Usage
- **E-Commerce Orders (Amazon / Shopify)**: Order line items are permanently embedded inside the order document because an order snapshot must never mutate even if the master product catalog changes.
- **GitHub Repositories**: Repository metadata embeds topic tags (`['typescript', 'react']`), but references issues and pull requests in separate collections due to unbounded volume.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the difference between embedding and referencing in MongoDB?**  
*Answer*: 
- **Embedding** stores related child data directly inside the parent document as nested sub-documents or arrays, allowing all related data to be retrieved in a single disk read without joins.
- **Referencing** stores data in separate collections and links them using document identifiers (`ObjectId`), similar to foreign keys in relational databases, preventing document size bloat and allowing unbounded growth.

### Conceptual
**Q: How does the concept of "Cardinality" dictate whether to embed or reference in MongoDB?**  
*Answer*: Cardinality measures the numerical relationship between entities:
- **1-to-Few (e.g., $\le$ 5 addresses per user)**: Ideal for **Embedding** because array size is small and fixed.
- **1-to-Many (e.g., 500 reviews per product)**: Requires **Referencing** or the **Subset Pattern** because embedding risks approaching the 16MB document size limit.
- **1-to-Squillions (e.g., millions of IoT sensor logs)**: Strict **Parent Referencing** (child log stores parent sensor `_id`) to prevent parent document explosion.

### Implementation
**Q: What is the "Subset Pattern" in MongoDB, and what performance problem does it solve?**  
*Answer*: The Subset Pattern addresses documents that have large or unbounded collections of related items (like an e-commerce product with 50,000 customer reviews). Instead of embedding all 50,000 reviews (which exceeds the 16MB limit) or purely referencing them (which requires a join on every page load), the Subset Pattern embeds only the top 5–10 most recent reviews directly in the product document for immediate display, while storing the complete historical archive in a separate `reviews` collection for paginated lookups.

### Debugging
**Q: A team embedded all user notifications inside an array in the `users` collection. After 6 months in production, the application crashes with `BSONObjectTooLarge` errors. What occurred, and how do you remediate it?**  
*Answer*: Active users accumulated thousands of notification objects, causing the user document to exceed the strict **16MB BSON size limit**. To remediate:
1. Create a separate `notifications` collection with schema `{ _id, userId: ObjectId, message, isRead, createdAt }`.
2. Run a migration script to extract notifications from the `users.notifications` array and insert them into the new collection.
3. Remove the `notifications` array from the `users` collection.
4. Update application code to query the notifications collection using pagination and an index on `{ userId: 1, createdAt: -1 }`.

### Scenario
**Q: You are modeling an e-commerce checkout system. Should product details inside an order be embedded or referenced? Explain your architectural reasoning.**  
*Answer*: Product details inside an order must be **Embedded** (as line items containing `productId`, `title`, `unitPriceAtPurchase`, and `quantity`). Referencing the `products` collection directly is a catastrophic bug because product prices, names, and specifications change over time. Embedding captures an immutable historical snapshot of the exact price and title agreed upon at the moment the transaction occurred, guaranteeing historical accounting accuracy.

### Advanced
**Q: What is the "Extended Reference Pattern" in MongoDB, and how does it prevent the performance overhead of `$lookup` queries?**  
*Answer*: The Extended Reference Pattern is a hybrid modeling technique where an entity in Collection A references Collection B by `_id`, but also copies a few frequently accessed, relatively static display fields from Collection B directly into Collection A. For example, an `orders` document stores `{ customerId: ObjectId, customerName: "Alice", customerEmail: "alice@test.com" }`. When rendering customer invoices, the application reads the order document and immediately has all necessary customer display attributes in a single seek, completely eliminating the need to execute an expensive `$lookup` join against the `users` collection.

---

## 16. Coding Questions

### Problem 1: Implementing Parent Referencing with Pagination in TypeScript
Write a clean, performant TypeScript service method that queries an unbounded 1-to-Many relationship using parent referencing and cursor-based pagination.

```typescript
import { Collection, ObjectId } from 'mongodb';

interface CommentDocument {
  _id: ObjectId;
  postId: ObjectId; // Parent Reference
  author: string;
  content: string;
  createdAt: Date;
}

export class CommentRepository {
  constructor(private readonly commentsCollection: Collection<CommentDocument>) {}

  /**
   * Fast cursor-based pagination using parent reference and indexed _id
   * Prerequisite: Compound Index on { postId: 1, _id: -1 }
   */
  public async getCommentsForPost(
    postId: ObjectId,
    lastSeenId?: ObjectId,
    limit: number = 20
  ): Promise<CommentDocument[]> {
    const query: any = { postId };

    // Cursor pagination: Fetch rows strictly older than the last seen ID
    if (lastSeenId) {
      query._id = { $lt: lastSeenId };
    }

    return await this.commentsCollection
      .find(query)
      .sort({ _id: -1 }) // Newest first via ObjectId timestamp
      .limit(limit)
      .toArray();
  }
}
```

---

## 17. Common Interview Traps
- **Trap 1**: Believing embedding is always better because "MongoDB doesn't do joins." Excessive embedding leads to bloated documents, slow queries, and document size limit crashes.
- **Trap 2**: Thinking `$lookup` behaves identically to SQL joins. In MongoDB, `$lookup` outputs child records as a nested array inside the parent document, which must be flattened with `$unwind` if tabular rows are needed.
- **Trap 3**: Forgetting to index foreign reference fields. In referencing models, the referencing field (e.g., `postId` on `comments`) **must have an explicit index**; MongoDB does not index foreign fields automatically.

---

## 18. Revision Summary
- **Embedding**: Fast single-document reads, atomic mutations, best for 1-to-1 and 1-to-Few relationships.
- **Referencing**: Prevents document bloat, eliminates 16MB limit hazards, best for 1-to-Many and 1-to-Squillions.
- **Parent Referencing**: Child holds parent's `_id`; scalable and clean.
- **Child Referencing**: Parent holds array of child IDs; dangerous for large $N$.
- **Subset Pattern**: Embed top $N$ items for instant page loads; reference full historical archive.
- **Extended Reference Pattern**: Embed critical display fields alongside the reference ID to eliminate joins.

---

## 19. Quick Reference

| Relationship Cardinality | Recommended Modeling Strategy | Example |
| :--- | :--- | :--- |
| **1-to-1** | Embed as sub-document | User profile settings |
| **1-to-Few** | Embed as array of sub-documents | User shipping addresses, order line items |
| **1-to-Many** | Parent Reference (Child holds parent ID)| Blog post comments, bug report tickets |
| **1-to-Squillions** | Strict Parent Reference | IoT device telemetry, server audit logs |
| **Many-to-Many** | Array of ObjectIds on both or Junction Collection | Books and Authors, Students and Courses |
| **High-Read Feed** | Subset Pattern (Embed top 5, reference all) | Product reviews, social media feeds |
