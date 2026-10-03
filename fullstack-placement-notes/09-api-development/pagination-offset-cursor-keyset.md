# Pagination Strategies: Offset, Cursor, and Keyset Pagination

## 1. What is it?
Pagination is the architectural technique of dividing massive datasets into smaller, digestible chunks (pages) for transmission over HTTP. When designing scalable APIs and database query layers, three core pagination strategies exist:
1. **Offset-Based Pagination (`LIMIT / OFFSET`):** Specifies the number of records to return (`limit`) and the number of records to skip (`offset` or `page`).
2. **Cursor-Based Pagination:** Specifies a pointer (a cursor, usually an opaque base64-encoded string) referencing a specific record, fetching records immediately following that cursor (`WHERE id > :cursor LIMIT :limit`).
3. **Keyset Pagination:** An optimized variant of cursor pagination that uses an indexed multi-column sort key (e.g. `(created_at, id)`) to seek directly to the next page using B-Tree index traversal.

```
+-------------------------------------------------------------------------------+
|                       PAGINATION ARCHITECTURAL COMPARISON                     |
+-------------------+-----------------------+-------------------+---------------+
| Strategy          | Database Query Syntax | Complexity        | Big-O Time    |
+-------------------+-----------------------+-------------------+---------------+
| Offset-Based      | LIMIT 20 OFFSET 10000 | Low (page=500)    | O(N) (Scans N)|
| Cursor-Based      | WHERE id > cursor L 20| Medium (opaque)   | O(1) (B-Tree) |
| Keyset Pagination | WHERE (date, id) > .. | High (composite)  | O(1) (B-Tree) |
+-------------------+-----------------------+-------------------+---------------+
```

---

## 2. Why does it exist?
While **Offset Pagination** is intuitive and easy to implement, it suffers from two critical flaws at production scale:
1. **The $O(N)$ Scanning Cost (The Deep Paging Death Spiral):** When executing `SELECT * FROM orders ORDER BY id LIMIT 20 OFFSET 1000000`, the database engine does NOT magically jump to record 1,000,000. It must physically scan, evaluate, and discard 1,000,000 rows from disk/memory before returning the 20 requested rows! Queries on deep pages take 10+ seconds and crash database CPUs.
2. **The "Missing / Duplicate Record" Problem:** In real-time feeds (e.g. Twitter or live orders), if a new post is inserted while a user is on page 1, all existing records shift down by one position. When the user requests page 2, the last item from page 1 appears again as the first item of page 2 (duplicate record)!

Cursor and Keyset pagination eliminate both problems: queries execute in $O(1)$ constant time regardless of page depth, and results remain perfectly stable even during concurrent inserts.

---

## 3. Mental Model
Think of Pagination Strategies as **Finding a Chapter in a 1,000-Page Book**:
- **Offset Pagination (The Inefficient Reader):** To read page 500, you start at page 1 and manually flip through 499 individual pages one by one, counting aloud until you hit page 500. By page 900, your fingers are exhausted and your reading speed drops to zero.
- **Cursor / Keyset Pagination (The Bookmark Ribbon):** You leave a bookmark ribbon at page 499 (the cursor). The next day, you grab the ribbon, open the book directly to page 500 in 0.1 seconds, and start reading immediately. It takes the exact same fraction of a second to open page 10 as it does page 900!

---

## 4. Basic Example

### Offset-Based vs. Cursor-Based SQL Queries
```sql
-- 1. Offset-Based Pagination (Degrades as OFFSET increases!)
-- Querying Page 50,000:
SELECT id, title, price 
FROM products 
ORDER BY id ASC 
LIMIT 20 OFFSET 1000000; -- Database must read 1,000,020 rows and discard 1,000,000!

-- 2. Cursor-Based Pagination (Instantaneous O(1) execution!)
-- The client sends: ?cursor=1000000
SELECT id, title, price 
FROM products 
WHERE id > 1000000 
ORDER BY id ASC 
LIMIT 20; -- Database uses B-Tree index to seek directly to 1,000,000 in 0.2ms!
```

---

## 5. Real Example

### Production Cursor Pagination with Base64 Compound Cursors (Node.js + Prisma)
```typescript
// services/feedService.ts
import db from '@/lib/db';

interface PaginationParams {
  cursor?: string; // Base64 encoded string: "createdAt:id"
  limit?: number;
}

interface FeedItem {
  id: string;
  title: string;
  createdAt: Date;
}

// 1. Cursor Encoder / Decoder Utilities
function encodeCursor(date: Date, id: string): string {
  return Buffer.from(`${date.toISOString()}###${id}`).toString('base64');
}

function decodeCursor(cursor: string): { date: Date; id: string } {
  const [dateStr, id] = Buffer.from(cursor, 'base64').toString('utf8').split('###');
  return { date: new Date(dateStr), id };
}

export async function getFeedItems({ cursor, limit = 20 }: PaginationParams) {
  let whereClause = {};

  if (cursor) {
    const { date, id } = decodeCursor(cursor);

    // Keyset pagination using composite condition (date, id)
    whereClause = {
      OR: [
        { createdAt: { lt: date } }, // Older posts
        { createdAt: date, id: { lt: id } }, // Tie-breaker for identical timestamps
      ],
    };
  }

  // Fetch limit + 1 to determine if there is a next page
  const items = await db.post.findMany({
    where: whereClause,
    take: limit + 1,
    orderBy: [
      { createdAt: 'desc' },
      { id: 'desc' }, // Secondary unique tie-breaker
    ],
  });

  const hasMore = items.length > limit;
  const pageData = hasMore ? items.slice(0, limit) : items;

  let nextCursor: string | null = null;
  if (hasMore && pageData.length > 0) {
    const lastItem = pageData[pageData.length - 1];
    nextCursor = encodeCursor(lastItem.createdAt, lastItem.id);
  }

  return {
    data: pageData,
    meta: {
      limit,
      hasMore,
      nextCursor,
    },
  };
}
```

---

## 6. Under the Hood

### 1. Why `OFFSET` is Slow at the Storage Engine Level
In PostgreSQL, MySQL, or SQLite:
```
B-Tree Root Index ---> Branch Node ---> Leaf Node
```
- An index allows the database to locate a specific value in $O(\log N)$ time.
- However, `OFFSET 500000` is **NOT a key search**; it is an instruction: *"Count 500,000 index tuples, read the corresponding row data, and throw them away"*.
- The database engine must execute 500,000 disk/buffer cache reads.

### 2. The Multi-Column Index Requirement for Keyset Pagination
When sorting by non-unique fields (e.g. `created_at DESC`):
- Multiple records can share the exact same millisecond timestamp!
- If you query `WHERE created_at < :cursor`, any record sharing the identical timestamp as the boundary record is **permanently skipped**.
- **Solution:** Always sort by a composite index `(created_at DESC, id DESC)`. The unique `id` acts as an absolute tie-breaker.

---

## 7. Important Rules
1. **Never Use Simple Cursor Without Tie-Breakers on Non-Unique Columns:** If sorting by `price` or `created_at`, always append the primary key `id` as the secondary sort column to avoid skipping duplicate timestamp rows.
2. **Make Cursors Opaque to Clients:** Always base64-encode cursors. If you expose raw database values (e.g. `?cursor=2026-03-15T12:00:00Z_id123`), frontend clients start parsing and fabricating internal database state, coupling them to your internal schema.
3. **Always Request `limit + 1`:** Fetch one record beyond the requested limit to detect `hasMore` without executing a separate expensive `SELECT COUNT(*)` query!
4. **Cap Maximum Limits:** Never allow clients to pass arbitrary limits (e.g. `?limit=1000000`). Enforce an upper bound: `const safeLimit = Math.min(requestedLimit || 20, 100)`.

---

## 8. Common Mistakes

### Mistake 1: Running `SELECT COUNT(*)` on Every Cursor Request
```typescript
// ❌ PERFORMANCE DISASTER:
const items = await db.post.findMany({ take: 20, where: { id: { gt: cursor } } });
const total = await db.post.count(); // Table scan on 10,000,000 rows ruins cursor speed!
```
**Fix:** In cursor pagination (e.g. infinite scroll), users don't need `totalCount`. Omit it, or estimate it from database statistics.

### Mistake 2: Missing Index on Cursor Column
```sql
-- ❌ DISASTER: Running cursor query on unindexed column triggers full table scan on every request!
SELECT * FROM orders WHERE user_notes > 'cursor_val' LIMIT 20;
```
**Fix:** Ensure the cursor column has an explicit B-Tree index.

---

## 9. Best Practices
1. **Use Offset Pagination ONLY for Small Admin Tables:** If a table has <10,000 rows and users specifically need to click "Jump to Page 15", offset pagination is acceptable.
2. **Use Cursor Pagination for Feeds and APIs:** For social media feeds, chat messages, transaction logs, and public REST APIs, always use cursor pagination.
3. **Include Full Navigational Links in Responses:**
   ```json
   {
     "data": [...],
     "meta": {
       "nextCursor": "ZXlKaGJHY2lPaUpTVXp...",
       "nextUrl": "/api/v1/posts?cursor=ZXlKaGJHY2lPaUpTVXp...&limit=20"
     }
   }
   ```

---

## 10. Performance Considerations
- **Query Execution Benchmark:**
  - `OFFSET 100,000` on 1,000,000 rows: **~850ms - 2,500ms**.
  - `WHERE id > cursor LIMIT 20` with index: **~0.3ms - 1.2ms** (over 1,000x faster!).
- **Memory Footprint:** Cursor pagination avoids buffering millions of intermediate row tuples in database memory.

---

## 11. Security Considerations
- **Tampered Cursors:** If a malicious user tampers with the base64 cursor string, handle decoding errors gracefully. Return `400 Bad Request: Invalid pagination cursor` rather than throwing an unhandled 500 error.
- **Data Leakage via Base64 Cursors:** Base64 is encoding, NOT encryption. Anyone can decode it (`atob(cursor)`). Do not store sensitive tenant secrets or internal database credentials inside cursor payloads.

---

## 12. Alternatives
- **GraphQL Relay Connection Specification:** The industry standard specification for cursor pagination in GraphQL (`edges { cursor, node }`, `pageInfo { endCursor, hasNextPage }`).
- **Elasticsearch Search-After:** Cursor pagination implementation for distributed search indexes using Lucene doc IDs.

---

## 13. Trade-offs

| Criterion | Offset Pagination | Cursor / Keyset Pagination |
| :--- | :--- | :--- |
| **Performance on Page 1,000**| **Horrible ($O(N)$)** | **Lightning Fast ($O(1)$)** |
| **Real-Time Data Stability** | Skips or duplicates rows | 100% stable results |
| **Jump to Specific Page** | Yes (`page=50`) | No (Can only step next/prev) |
| **Total Count Required?** | Yes | No (Uses `limit + 1`) |
| **Implementation Complexity**| Very Low | Medium-High |

---

## 14. Real-World Usage
- **Twitter / Instagram / Threads Feed:** Infinite scroll feeds powered 100% by cursor pagination using compound `(created_at, tweet_id)` keys.
- **Stripe API:** All list endpoints (e.g. `GET /v1/charges?starting_after=ch_123`) utilize cursor-based pagination exclusively.

---

## 15. Placement Interview Questions

### Basic
**Q: Why does Offset-based pagination (`LIMIT 20 OFFSET 500000`) perform poorly on large database tables?**  
*Answer:* The database cannot jump directly to row 500,000. It must traverse the index, read the full row tuples from disk or cache, and count through all 500,000 rows before discarding them and returning the remaining 20 rows. This results in $O(N)$ linear time complexity and high disk I/O.

### Conceptual
**Q: How does Cursor-based pagination prevent the "duplicate item" bug that occurs in Offset pagination?**  
*Answer:* In Offset pagination, if a new item is inserted at the top of the table while a user navigates from page 1 to page 2, all records shift down by one position, causing the last item of page 1 to be returned again on page 2. Cursor pagination anchors the query to a specific record ID (`WHERE id < :last_seen_id`). Any newly inserted items above that ID are ignored, guaranteeing that items are never duplicated or skipped.

### Implementation
**Q: How do you determine if a "Next Page" exists in cursor pagination without executing an expensive `SELECT COUNT(*)` query?**  
*Answer:* Request `limit + 1` rows from the database. For example, if the client requests 20 items, query with `LIMIT 21`. If the database returns 21 rows, you know a next page exists. Return the first 20 rows to the client and set `hasMore = true` along with the cursor generated from the 20th row. If 20 or fewer rows are returned, set `hasMore = false`.

### Debugging
**Q: A developer implements cursor pagination sorting by `created_at DESC`. During high-volume automated testing, several items are skipped between page transitions. Why?**  
*Answer:* Multiple records were created with the exact same millisecond timestamp (`created_at`). When the query executes `WHERE created_at < :cursor_date`, all remaining records sharing that identical timestamp are filtered out. To fix this, use a composite keyset `(created_at, id)` where the primary key `id` serves as a deterministic tie-breaker: `WHERE (created_at < :date) OR (created_at = :date AND id < :id)`.

### Scenario
**Q: You are building an admin panel for an inventory warehouse where staff must frequently jump directly to specific pages (e.g. Page 84) to verify physical bin locations. Would you recommend Cursor or Offset pagination?**  
*Answer:* Recommend **Offset Pagination**. Cursor pagination only supports sequential navigation (Next / Previous); it cannot jump to an arbitrary page number. Because warehouse inventory tables are typically bounded in size (<100,000 rows) and updated infrequently, the performance drawbacks of offset pagination are acceptable in exchange for direct page-number access.

### Advanced
**Q: Explain how PostgreSQL optimizes Keyset pagination using row-value constructors.**  
*Answer:* PostgreSQL supports tuple comparison syntax: `WHERE (created_at, id) < (:cursor_date, :cursor_id)`. When backed by a composite B-Tree index `CREATE INDEX idx_posts_date_id ON posts (created_at DESC, id DESC)`, the query planner seeks directly to the exact index leaf in a single $O(\log N)$ tree traversal without evaluating complex OR conditions, achieving peak query performance.

---

## 16. Coding Questions

### Problem: Implement a Keyset Paginated Route Handler in Next.js App Router
```typescript
// app/api/v1/orders/route.ts
import { NextRequest, NextResponse } from 'next/server';
import db from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const searchParams = req.nextUrl.searchParams;
  const cursor = searchParams.get('cursor');
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);

  // If cursor exists, decode it: base64(id)
  const cursorId = cursor ? Buffer.from(cursor, 'base64').toString('utf8') : undefined;

  const orders = await db.order.findMany({
    take: limit + 1, // Fetch limit + 1
    cursor: cursorId ? { id: cursorId } : undefined,
    skip: cursorId ? 1 : 0, // Skip the cursor record itself
    orderBy: { id: 'asc' },
    select: {
      id: true,
      amountCents: true,
      status: true,
      createdAt: true,
    },
  });

  const hasMore = orders.length > limit;
  const data = hasMore ? orders.slice(0, limit) : orders;

  const nextCursor =
    hasMore && data.length > 0
      ? Buffer.from(data[data.length - 1].id).toString('base64')
      : null;

  return NextResponse.json({
    data,
    meta: {
      limit,
      hasMore,
      nextCursor,
    },
  });
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "Cursor pagination allows users to click 'Jump to Page 5'."  
  *Truth:* False! Cursor pagination is purely sequential. It cannot calculate where "Page 5" starts without traversing all intermediate records.
- **Trap 2:** "`SELECT COUNT(*)` must always be returned in pagination metadata."  
  *Truth:* False. Running `SELECT COUNT(*)` on multi-million row tables forces full table scans and negates the speed advantage of cursor pagination.

---

## 18. Revision Summary
- Offset pagination (`LIMIT/OFFSET`) suffers from $O(N)$ database scanning latency and duplicate/skipped rows during concurrent writes.
- Cursor pagination (`WHERE id > :cursor LIMIT 20`) executes in $O(1)$ constant time using B-Tree index lookups.
- Keyset pagination uses composite indexed keys `(created_at, id)` with unique tie-breakers.
- Always fetch `limit + 1` to detect `hasMore` without executing a slow `COUNT(*)` query.
- Use Offset for small admin tables requiring page numbers; use Cursor for feeds, high-scale APIs, and infinite scroll.

---

## 19. Quick Reference

```
+--------------------+---------------------------+-----------------------------------------------+
| Strategy           | Query Structure           | Primary Advantage                             |
+--------------------+---------------------------+-----------------------------------------------+
| Offset Pagination  | LIMIT 20 OFFSET 200       | Simple; supports page numbers (page=10)       |
| Cursor Pagination  | WHERE id > cursor LIMIT 20| O(1) constant time; stable real-time data     |
| Keyset Pagination  | WHERE (date, id) < (d, i) | Handles non-unique sort keys with tie-breakers|
| hasMore Check      | take: limit + 1           | Detects next page without SELECT COUNT(*)     |
| Cursor Format      | Base64 encoded string     | Keeps database implementation details opaque  |
+--------------------+---------------------------+-----------------------------------------------+
```
