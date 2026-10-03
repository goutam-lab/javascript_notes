# MongoDB CRUD Operations, Query Operators, and Projections

## 1. What is it?
In MongoDB, **CRUD Operations** are the primary API methods used to Create, Read, Update, and Delete documents inside a collection. 

Unlike SQL which expresses operations via declarative text statements, MongoDB represents queries, updates, and projections as **BSON documents** structured with specialized **Operators** prefixed with the dollar sign (`$`):
- **Query Operators**: Comparison (`$eq`, `$gt`, `$in`), Logical (`$and`, `$or`, `$nor`), and Element (`$exists`, `$type`).
- **Update Operators**: Field modifiers (`$set`, `$unset`, `$inc`, `$currentDate`) and Array modifiers (`$push`, `$pull`, `$addToSet`, `$pop`, `$[<identifier>]`).
- **Projections**: Limiting the returned document fields using inclusion (`field: 1`) or exclusion (`field: 0`) to optimize network bandwidth and memory utilization.

```
MongoDB CRUD Command Taxonomy:
CREATE:  collection.insertOne(doc), collection.insertMany([docs])
READ:    collection.findOne(filter, { projection }), collection.find(filter)
UPDATE:  collection.updateOne(filter, updateDoc), collection.updateMany(filter, updateDoc)
DELETE:  collection.deleteOne(filter), collection.deleteMany(filter)

Example Atomic Update Document:
db.users.updateOne(
  { _id: ObjectId("...") },
  {
    $set: { "profile.bio": "Software Architect" }, // Updates field
    $inc: { "analytics.views": 1 },               // Atomic counter increment
    $addToSet: { tags: "typescript" }             // Adds to array if not already present
  }
);
```

---

## 2. Why does it exist?
1. **Preventing Full Document Overwrite Accidents**: In early NoSQL databases, updating a document required reading the entire object into memory, modifying a property, and saving the entire object back to disk. If another request updated a different field in between, the second write silently overwrote and destroyed the first update. MongoDB's **field-level atomic update operators** (`$set`, `$inc`, `$push`) modify fields in-place on disk without overwriting sibling properties.
2. **Atomic Array Manipulation**: Adding an item to a user's notification list or removing a tag requires array mutations directly inside the storage engine without pulling the array over the network into the application layer.
3. **Bandwidth and I/O Conservation via Projections**: Returning large 2MB documents with 50 fields when the frontend only needs `title` and `slug` wastes network bandwidth, saturates the Node.js event loop with JSON parsing, and consumes WiredTiger cache. Projections restrict the engine to stream only required fields.

---

## 3. Mental Model
Think of MongoDB CRUD Operators as **Precision Surgical Tools**:
- **Full Document Replacement (`replaceOne`)**: A sledgehammer. You knock down the entire wall and build a new one from scratch. If someone hung a picture on the other side of the wall while you were working, it's gone.
- **`$set`**: A paintbrush. You walk in and paint just the kitchen door blue without touching any other room in the house.
- **`$inc`**: A mechanical turnstile clicker. You don't read the counter, calculate $+1$, and paint a new number. You simply click the ratchet mechanism; it advances by 1 atomically.
- **`$addToSet`**: A unique guest list. If the person's name is already on the clipboard, do nothing; if they are not on the list, add them.
- **Projections**: A cardboard stencil with cutouts. You place the stencil over a crowded document; only the `title` and `price` holes show through, completely blocking the rest of the page from view.

---

## 4. Basic Example
Comprehensive query, update, and projection examples in JavaScript / TypeScript:

```typescript
import { MongoClient, ObjectId } from 'mongodb';

const client = new MongoClient('mongodb://localhost:27017');
const db = client.db('store');
const products = db.collection('products');

async function crudDemo() {
  // 1. CREATE: Insert with specific types
  await products.insertOne({
    sku: 'PROD-MACBOOK',
    title: 'MacBook Pro 16"',
    price: 2499.00,
    tags: ['laptop', 'apple', 'tech'],
    inventory: { inStock: 45, reserved: 5 },
    isActive: true,
    lastRestockedAt: new Date()
  });

  // 2. READ: Complex query with comparison and logical operators + PROJECTION
  const matchingProducts = await products.find(
    {
      price: { $gte: 1000, $lte: 3000 },
      tags: { $in: ['laptop', 'workstation'] },
      'inventory.inStock': { $gt: 0 }
    },
    {
      projection: {
        title: 1,
        price: 1,
        'inventory.inStock': 1,
        _id: 0 // Explicitly suppress default _id field
      }
    }
  ).toArray();

  // 3. UPDATE: Atomic field mutation and array append
  await products.updateOne(
    { sku: 'PROD-MACBOOK' },
    {
      $set: { price: 2399.00 },
      $inc: { 'inventory.inStock': -1, 'inventory.reserved': 1 },
      $addToSet: { tags: 'discounted' },
      $currentDate: { updatedAt: true }
    }
  );

  // 4. DELETE: Clean up inactive inventory
  await products.deleteMany({ isActive: false, 'inventory.inStock': 0 });
}
```

---

## 5. Real Example: Updating Nested Elements in Arrays using Positional Filter Operator (`$[elem]`)
A production TypeScript repository method updating the price of a specific variant inside a nested array of product variants without rewriting the whole document:

```typescript
import { Collection, ObjectId, UpdateResult } from 'mongodb';

interface ProductWithVariants {
  _id: ObjectId;
  title: string;
  variants: Array<{
    variantId: string;
    color: string;
    size: string;
    price: number;
    available: boolean;
  }>;
}

export class ProductInventoryRepository {
  constructor(private readonly collection: Collection<ProductWithVariants>) {}

  /**
   * ATOMIC NESTED ARRAY UPDATE USING ARRAY FILTERS ($[elem])
   * Updates the price of all "Red" variants across matching product documents.
   */
  public async updateVariantPriceByColor(
    productId: ObjectId,
    targetColor: string,
    newPrice: number
  ): Promise<UpdateResult> {
    const result = await this.collection.updateOne(
      { _id: productId },
      {
        // Positional filtered array operator $[elem]
        $set: {
          'variants.$[v].price': newPrice,
          'variants.$[v].available': true
        },
        $currentDate: { updatedAt: true }
      },
      {
        // Define the array filter identifier 'v'
        arrayFilters: [
          { 'v.color': targetColor }
        ]
      }
    );

    return result;
  }
}
```

---

## 6. Under the Hood

### 1. In-Place Field Updates vs Document Relocation
When you execute `$set` or `$inc`:
- **In-Place Update (Fast)**: If the modified field does not change the physical byte length of the BSON document (e.g., updating an integer counter or swapping a 4-letter string for another 4-letter string), WiredTiger mutates the bytes directly in memory cache. Disk pages are dirtied without altering document storage offsets.
- **Document Relocation (Slow)**: If a `$push` appends elements to an array, and the document outgrows its allocated disk record space, WiredTiger must allocate a brand-new contiguous memory and disk segment elsewhere, copy the entire updated document over, update all index pointers (`_id` and secondary B-Trees) to point to the new disk address, and mark the old slot as dead space.

### 2. Deep Dive: Array Mutation Operators
- **`$push`**: Appends an element to the end of an array. Can be paired with `$each`, `$slice`, and `$sort` to maintain fixed-size sorted queues (e.g., maintaining only the top 10 scores).
- **`$addToSet`**: Appends an element **only if it does not already exist** in the array (set semantics). Performs an in-engine equality check.
- **`$pull`**: Removes all occurrences of a value or objects matching a condition from an array:
  ```javascript
  db.posts.updateOne({ _id: id }, { $pull: { tags: { $in: ["deprecated", "draft"] } } });
  ```
- **`$` (Positional Operator)**: Updates the *first* array element that matched the query condition.
- **`$[]` (All Positional Operator)**: Updates *every single element* in the array.
- **`$[<identifier>]` (Filtered Positional Operator)**: Updates only elements that satisfy specific criteria defined in `arrayFilters`.

---

## 7. Important Rules
1. **Never Mix Inclusion and Exclusion in Projections**: A projection document must either consist entirely of inclusions (`{ name: 1, email: 1 }`) or entirely of exclusions (`{ passwordHash: 0, internalNotes: 0 }`).  
   **The Only Exception**: The `_id` field is included by default; you can explicitly exclude `_id: 0` alongside field inclusions (`{ name: 1, _id: 0 }`).
2. **Atomic Updates Require Update Operators**: If you execute `collection.updateOne({ _id }, { name: 'Alice' })` without `$set`, newer MongoDB drivers will throw an error or replace the entire document with `{ name: 'Alice' }`, wiping out all other fields! Always use `$set`.
3. **Use `$inc` for Concurrent Counters**: Never read a counter into JavaScript, increment it, and write it back. Use `{$inc: { count: 1 }}` to guarantee race-condition-free atomic updates directly in the database engine.

---

## 8. Common Mistakes

### 1. The Accidental Full Document Replacement Trap
```typescript
// FATAL BUG: Intended to update title, but accidentally replaces whole document!
// Old Mongo shell behavior: replaces entire document, destroying all other fields!
await collection.replaceOne({ _id: userId }, { title: 'New Title' });

// CORRECT: Uses $set to preserve all other document fields
await collection.updateOne({ _id: userId }, { $set: { title: 'New Title' } });
```

### 2. Using `$push` When `$addToSet` Was Intended
Using `$push` for user tags or roles. If a user clicks "Add Tag" multiple times, the array accumulates duplicate tags (`['admin', 'admin', 'admin']`). Use `$addToSet` to maintain uniqueness.

---

## 9. Best Practices

### 1. Bounded Array Maintenance with `$push` + `$slice`
Keep an array of recent activity logs fixed at exactly the last 20 events without ever exceeding the document limit:

```typescript
await usersCollection.updateOne(
  { _id: userId },
  {
    $push: {
      activityLogs: {
        $each: [{ action: 'LOGIN', ip: '1.2.3.4', timestamp: new Date() }],
        $sort: { timestamp: -1 }, // Sort newest first
        $slice: 20                // Retain only the first 20 elements!
      }
    }
  }
);
```

### 2. Strict Projection Usage
Always project only the fields required by the active UI view. This minimizes memory transfer, speeds up deserialization, and enables **Covered Queries** (queries satisfied entirely by an index without reading documents).

---

## 10. Performance Considerations
- **Index Intersection on Compound Operators**: MongoDB can combine indexes to satisfy `$and` queries, but an explicit **Compound Index** is orders of magnitude faster than runtime index intersection.
- **Regular Expression Scanning**: Queries using unanchored regexes (`{ name: { $regex: /john/i } }`) cannot effectively traverse B-Tree index boundaries, causing full collection scans (`COLLSCAN`). Always anchor regexes to prefixes (`/^john/`) when using indexes.

---

## 11. Security Considerations
- **NoSQL Injection via Operator Injection**: If an Express route does `User.find({ email: req.body.email, password: req.body.password })`, and an attacker sends JSON `{"email": "admin@site.com", "password": {"$ne": ""}}`, the `$ne` operator matches any password that is not empty, logging the attacker in as admin! Always sanitize input using Zod or express-mongo-sanitize.

---

## 12. Alternatives
1. **MongoDB Aggregation Pipeline (`collection.aggregate()`)**: When queries require computed fields, lookups, multi-stage grouping, or array unwinding that simple CRUD projection cannot achieve.
2. **SQL `UPDATE ... WHERE`**: The relational equivalent with standard ANSI syntax.

---

## 13. Trade-offs

| Method | Concurrency Safety | Performance | Flexibility |
| :--- | :--- | :--- | :--- |
| **`updateOne` with `$set` / `$inc`** | 100% Atomic on single doc | Fast (In-place mutation) | High |
| **`replaceOne`** | Vulnerable to lost updates | Moderate | Replaces entire structure |
| **Read-Modify-Write in App Code** | Prone to race conditions | Slow (2 network round-trips) | Highest (Arbitrary JS logic) |

---

## 14. Real-World Usage
- **High-Throughput Analytics Counters**: Social media platforms use `$inc: { viewCount: 1 }` to record millions of video views concurrently without lock contention.
- **Flash Sale Inventory Reservation**: Using atomic queries with conditions:
  ```javascript
  db.products.updateOne(
    { sku: "IPHONE", "inventory.stock": { $gte: 1 } },
    { $inc: { "inventory.stock": -1 } }
  );
  ```
  If stock is 0, the filter fails to match, and `modifiedCount === 0`, preventing overselling atomically!

---

## 15. Placement Interview Questions

### Basic
**Q: What is the difference between `$set` and `$unset` in MongoDB?**  
*Answer*: `$set` assigns a new value to a specified field or creates the field if it does not already exist. `$unset` completely deletes the specified field from the document on disk.

### Conceptual
**Q: Explain the difference between `$push` and `$addToSet` when modifying an array in MongoDB.**  
*Answer*: 
- **`$push`** appends an element to the end of an array regardless of whether that value already exists, permitting duplicate entries.
- **`$addToSet`** treats the array as a mathematical set; it appends the value **only if the value does not already exist** in the array, preventing duplicate elements.

### Implementation
**Q: Write a MongoDB update query that atomically decrements a product's stock by 1, but only if the current stock is greater than or equal to 1.**  
*Answer*:
```javascript
db.products.updateOne(
  { _id: productId, stock: { $gte: 1 } },
  { 
    $inc: { stock: -1 },
    $currentDate: { updatedAt: true }
  }
);
// The application checks result.modifiedCount. If 1, reservation succeeded; if 0, item is out of stock.
```

### Debugging
**Q: A query `db.users.find({}, { name: 1, email: 1, age: 0 })` throws a MongoDB execution error. Why, and how do you fix it?**  
*Answer*: The query mixes field **inclusion** (`name: 1, email: 1`) and field **exclusion** (`age: 0`) in the same projection document, which is strictly prohibited in MongoDB. The only field allowed to be excluded in an inclusion projection is `_id`. To fix it, remove `age: 0`; by default, omitting `age` in an inclusion projection excludes it automatically.

### Scenario
**Q: You need to maintain an array of the last 10 search queries for a user. How do you implement this efficiently without letting the array grow unbounded?**  
*Answer*: Use `$push` combined with the `$each`, `$slice`, and `$sort` modifiers:
```javascript
db.users.updateOne(
  { _id: userId },
  {
    $push: {
      recentSearches: {
        $each: [{ query: newSearchTerm, timestamp: new Date() }],
        $sort: { timestamp: -1 },
        $slice: 10 // Automatically trims the array to retain only the top 10 newest items!
      }
    }
  }
);
```

### Advanced
**Q: How does the filtered positional operator (`$[elem]`) work, and what problem does it solve that the traditional positional operator (`$`) could not?**  
*Answer*: The traditional positional operator (`$`) can only update the **first** array element that matched the query condition in the `find` criteria. The filtered positional operator (`$[<identifier>]`) paired with the `arrayFilters` option allows updating **multiple specific elements** in an array that match complex secondary conditions, or updating elements inside nested arrays of arrays, without having to know their array index positions.

---

## 16. Coding Questions

### Problem 1: Atomic Inventory Reservation with Upsert
Write a Node.js / TypeScript function using the native MongoDB driver that safely reserves inventory for a customer cart, ensuring items cannot be reserved past stock limits.

```typescript
import { Collection, ObjectId } from 'mongodb';

interface InventoryItem {
  _id: ObjectId;
  sku: string;
  stockAvailable: number;
  stockReserved: number;
}

export async function reserveProductInventory(
  inventoryCollection: Collection<InventoryItem>,
  sku: string,
  quantityToReserve: number
): Promise<{ success: boolean; message: string }> {
  // ATOMIC RESERVATION: Condition guarantees stockAvailable >= quantityToReserve
  const result = await inventoryCollection.updateOne(
    { 
      sku, 
      stockAvailable: { $gte: quantityToReserve } 
    },
    {
      $inc: {
        stockAvailable: -quantityToReserve,
        stockReserved: quantityToReserve
      }
    }
  );

  if (result.matchedCount === 0) {
    return {
      success: false,
      message: 'Insufficient inventory or product not found'
    };
  }

  return {
    success: true,
    message: `Successfully reserved ${quantityToReserve} units`
  };
}
```

---

## 17. Common Interview Traps
- **Trap 1**: Believing `_id` cannot be excluded. `_id: 0` is the only exclusion permitted inside an inclusion projection (`{ title: 1, _id: 0 }`).
- **Trap 2**: Thinking `updateOne` returns the modified document. `updateOne` returns an acknowledgment object (`matchedCount`, `modifiedCount`, `upsertedId`). If you need the updated document returned in the same call, you must use **`findOneAndUpdate(filter, update, { returnDocument: 'after' })`**.
- **Trap 3**: Confusing `$pull` with `$pop`. `$pop` removes either the first (`-1`) or last (`1`) item by position; `$pull` removes items matching a specific value or condition regardless of position.

---

## 18. Revision Summary
- CRUD in MongoDB uses BSON query filters and operator documents.
- Always use update operators (`$set`, `$inc`, `$unset`) rather than replacing documents.
- Use `$inc` for atomic race-condition-free counters.
- Projections restrict returned fields, saving bandwidth and enabling covered queries.
- Bounded arrays are maintained using `$push` with `$slice` and `$sort`.
- Nested array elements are updated with surgical precision using array filters (`$[elem]`).

---

## 19. Quick Reference

| Operator | Category | Purpose | Example |
| :--- | :--- | :--- | :--- |
| **`$set`** | Update Field | Sets or creates field | `{$set: {status: 'ACTIVE'}}` |
| **`$inc`** | Update Field | Atomically increments/decrements | `{$inc: {views: 1}}` |
| **`$unset`** | Update Field | Deletes field from document | `{$unset: {tempToken: ""}}` |
| **`$push`** | Update Array | Appends item to array | `{$push: {logs: newLog}}` |
| **`$addToSet`** | Update Array | Appends item only if unique | `{$addToSet: {roles: 'ADMIN'}}`|
| **`$pull`** | Update Array | Removes matching items from array | `{$pull: {tags: 'old'}}` |
| **`$[elem]`** | Array Filter | Mutates specific elements in array | Paired with `arrayFilters` |
