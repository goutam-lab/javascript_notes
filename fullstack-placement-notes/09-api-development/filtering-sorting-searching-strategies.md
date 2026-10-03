# Filtering, Sorting, and Searching Strategies for REST APIs

## 1. What is it?
Filtering, Sorting, and Searching represent the triad of query capabilities that allow API clients to retrieve tailored subsets of data from large resource collections. Implemented predominantly through URL query parameters (`req.query`), they adhere to distinct functional specifications:
1. **Filtering:** Constrains the result set based on field attributes and comparative operators (e.g. `?status=active&price[gte]=100`).
2. **Sorting:** Orders the result set across single or multiple dimensions (e.g. `?sort=-created_at,price`).
3. **Searching:** Executes full-text search (FTS), partial string matches, or semantic vector searches across free-form text columns (e.g. `?q=mechanical+keyboard`).

```
+-------------------------------------------------------------------------------+
|                       API QUERY PARSING & EXECUTION PIPELINE                  |
+-------------------------------------------------------------------------------+
| Incoming Request: GET /api/v1/products?cat=tech&price[lte]=500&sort=-rating&q=key
|    |                                                                          |
|    v                                                                          |
| 1. Query Normalization & Parsing (e.g. qs library)                            |
|    |                                                                          |
|    v                                                                          |
| 2. Zod Schema Validation & Sanitization (Reject unknown fields/injections)    |
|    |                                                                          |
|    v                                                                          |
| 3. Dynamic SQL / ORM Query Construction (Prisma / SQL Query Builder)          |
|    ├── WHERE category = 'tech' AND price <= 500                               |
|    ├── AND to_tsvector('english', title) @@ plainto_tsquery('english', 'key') |
|    └── ORDER BY rating DESC                                                   |
|    |                                                                          |
|    v                                                                          |
| 4. Database B-Tree / GIN Index Execution ---> Fast Paginated Result           |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?
Without standardized query strategies:
- Clients are forced to download massive datasets and filter/sort them on the client, wasting cellular bandwidth and memory.
- Naive developers concatenate raw query strings directly into SQL statements (`WHERE name LIKE '%" + req.query.q + "%'`), creating devastating SQL injection vulnerabilities.
- Un-indexed dynamic queries trigger table-wide sequential disk scans, taking down production databases under modest traffic.

Standardizing query syntax, enforcing strict schema validation, and utilizing PostgreSQL GIN indexes ensures high-speed, secure, and intuitive querying.

---

## 3. Mental Model
Think of Querying as **Searching for a Specific Book in the Library of Alexandria**:
- **Filtering is Visiting the Departmental Room:** "Take me only to the Ancient History wing (`?genre=history`) with books printed after 1800 (`?year[gte]=1800`)."
- **Sorting is Arranging the Books on the Cart:** "Sort them by publication date newest first, and then alphabetically by author (`?sort=-date,author`)."
- **Searching is the Master Index Catalog:** Instead of reading every page of all 500,000 books, the librarian consults the pre-compiled **Subject Index Catalog (GIN / Full-Text Index)**, finding the exact shelf and row in 2 seconds.

---

## 4. Basic Example

### Standard URL Parameter Syntax Conventions
```http
# 1. Exact Match Filtering:
GET /api/v1/users?role=ADMIN&status=ACTIVE

# 2. Comparison Operator Filtering (Square Bracket Notation):
GET /api/v1/products?price[gte]=50&price[lte]=200

# 3. Multi-Value Set Filtering (Comma-Separated):
GET /api/v1/orders?status=PENDING,PROCESSING,SHIPPED

# 4. Multi-Column Sorting (- prefix denotes DESC):
GET /api/v1/invoices?sort=-issuedAt,totalCents

# 5. Full-Text Search Query:
GET /api/v1/articles?q=kubernetes+networking
```

---

## 5. Real Example

### Production Dynamic Query Builder with Zod and Prisma (Node.js)
```typescript
// lib/queryParser.ts
import { z } from 'zod';
import { Prisma } from '@prisma/client';

// 1. Define Strict Zod Schema for Incoming Query String
export const ProductQuerySchema = z.object({
  category: z.string().optional(),
  minPrice: z.coerce.number().positive().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  status: z.enum(['IN_STOCK', 'OUT_OF_STOCK']).optional(),
  sort: z.string().default('-createdAt'),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ProductQueryParams = z.infer<typeof ProductQuerySchema>;

// 2. Safe Dynamic Prisma Query Transformer
export function buildProductPrismaQuery(params: ProductQueryParams) {
  const where: Prisma.ProductWhereInput = {};

  // Filters
  if (params.category) where.category = params.category;
  if (params.status) where.status = params.status;

  if (params.minPrice !== undefined || params.maxPrice !== undefined) {
    where.price = {
      gte: params.minPrice,
      lte: params.maxPrice,
    };
  }

  // Full-Text Search on PostgreSQL
  if (params.q) {
    where.OR = [
      { title: { contains: params.q, mode: 'insensitive' } },
      { description: { contains: params.q, mode: 'insensitive' } },
    ];
  }

  // Sorting Parser: e.g. "-rating,price"
  const orderBy: Prisma.ProductOrderByWithRelationInput[] = [];
  const sortFields = params.sort.split(',');

  for (const field of sortFields) {
    const isDesc = field.startsWith('-');
    const cleanField = isDesc ? field.slice(1) : field;

    // Whitelist allowed sortable columns to prevent runtime errors
    const allowedSortFields = ['createdAt', 'price', 'rating', 'title'];
    if (allowedSortFields.includes(cleanField)) {
      orderBy.push({
        [cleanField]: isDesc ? 'desc' : 'asc',
      });
    }
  }

  // Fallback tie-breaker sort
  orderBy.push({ id: 'desc' });

  return {
    where,
    orderBy,
    skip: (params.page - 1) * params.limit,
    take: params.limit,
  };
}
```

---

## 6. Under the Hood

### 1. PostgreSQL Full-Text Search (FTS) with GIN Indexes
When searching text columns:
- A naive `LIKE '%keyword%'` or `ILIKE` cannot use standard B-Tree indexes, forcing a slow sequential scan across every row on disk.
- **PostgreSQL Native FTS:** Converts text into a normalized lexeme vector:
  ```sql
  SELECT to_tsvector('english', 'The quick brown foxes jumped over lazy dogs');
  -- Output: 'brown':3 'dog':9 'fox':4 'jump':5 'lazi':8 'quick':2
  ```
- Words are stemmed (`foxes` -> `fox`, `jumped` -> `jump`) and stop words (`the`, `over`) are eliminated.
- A **GIN (Generalized Inverted Index)** maps every lexeme directly to the row IDs containing it, enabling sub-millisecond full-text searches across millions of documents!

---

## 7. Important Rules
1. **Always Whitelist Sortable Columns:** Never pass arbitrary client strings directly to database `ORDER BY` clauses. An attacker can pass `?sort=passwordHash` or invalid column names to trigger server panics.
2. **Sanitize Wildcards in Text Searches:** When using `LIKE` or regex, sanitize reserved wildcard characters (`%`, `_`, `[`) to prevent Denial of Service.
3. **Use Composite Indexes Matching Common Filter Pairs:** If users frequently query `WHERE category = 'electronics' AND price <= 500 ORDER BY rating DESC`, create an index matching that exact query:
   ```sql
   CREATE INDEX idx_products_cat_price_rating ON products (category, price, rating DESC);
   ```
4. **Enforce Global Search Limits:** Never execute unbounded text search queries. Always enforce `LIMIT` clauses.

---

## 8. Common Mistakes

### Mistake 1: The Leading Wildcard Sequential Scan
```sql
-- ❌ DISASTER: Leading wildcard '%phone' PREVENTS B-Tree index utilization!
SELECT * FROM products WHERE title LIKE '%phone%';
-- Forces complete scan of millions of rows, pegging CPU at 100%!
```
**Fix:** Use PostgreSQL Full-Text Search (`@@ plainto_tsquery`) backed by a GIN index, or `pg_trgm` (trigram) indexes.

### Mistake 2: Failing to Handle Multi-Value Parameters
```typescript
// If client sends: ?status=ACTIVE&status=PENDING
// Express parses req.query.status as string[]: ['ACTIVE', 'PENDING']
// If client sends: ?status=ACTIVE
// Express parses req.query.status as a single string: "ACTIVE"
```
**Fix:** Use Zod or a helper to normalize inputs into arrays: `z.union([z.string(), z.array(z.string())]).transform(...)`.

---

## 9. Best Practices
1. **Adopt Standardized Operators:** Standardize on square brackets for comparison operators:
   - `[gte]`: Greater than or equal to
   - `[lte]`: Less than or equal to
   - `[ne]`: Not equal to
   - `[in]`: Included in list
2. **Use Trigram Indexes for Autocomplete / Fuzzy Matching:**
   ```sql
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   CREATE INDEX idx_products_title_trgm ON products USING gin (title gin_trgm_ops);
   ```
   Enables high-speed fuzzy matching (`WHERE title ILIKE '%phone%'` in <5ms).
3. **Separate Search Concerns:** For simple apps, PostgreSQL FTS is sufficient. When search requires fuzzy typo-tolerance, synonyms, and faceted aggregations at scale, offload to **Elasticsearch**, **Typesense**, or **Algolia**.

---

## 10. Performance Considerations
- **Index Intersection vs Composite Indexes:** Modern databases can combine multiple single-column indexes, but a tailored multi-column composite index is 5x to 10x faster for high-volume filtering and sorting.
- **Search Query Throttling:** Debounce client search input by 300ms and apply rate limits on search endpoints to protect backend search clusters.

---

## 11. Security Considerations
- **SQL Injection in Dynamic Order Clauses:** Some ORMs or raw query builders do not parameterize column names in `ORDER BY`. An attacker could inject SQL via `?sort=id;(DROP TABLE users)`. Always validate against an allowlist of string constants!
- **ReDoS in Regex Filters:** If your API allows regex filtering (e.g. `?q[regex]=...`), malicious regexes with catastrophic backtracking can lock CPU threads permanently. Disallow arbitrary regex queries from public clients.

---

## 12. Alternatives
- **GraphQL Filtering (Prisma / PostGraphile style):** Rich nested filtering objects in GraphQL queries.
- **Dedicated Search Engines (Elasticsearch / Meilisearch / Algolia):** Superior for complex text ranking, multi-lingual stemming, and typo-tolerance.

---

## 13. Trade-offs

| Search Technology | Complexity | Performance | Best Use Case |
| :--- | :--- | :--- | :--- |
| **B-Tree `LIKE 'term%'`** | Low | Fast (prefix only) | Simple exact prefix matching |
| **PostgreSQL FTS (GIN)** | Medium | Very Fast | Monolithic DB text search (<5M rows)|
| **Trigram (`pg_trgm`)** | Medium | Fast | Fuzzy typo-tolerant matching |
| **Elasticsearch / Typesense**| High (External Cluster)| Instantaneous at scale| E-Commerce catalogs with facets |

---

## 14. Real-World Usage
- **GitHub Code & Issue Search:** Complex filter syntax support: `is:issue is:open label:bug author:goutam sort:updated-desc`.
- **E-Commerce Faceted Search (Amazon / ASOS):** Multi-dimensional filtering across size, color, brand, and price with simultaneous faceted counts.

---

## 15. Placement Interview Questions

### Basic
**Q: How should multi-column sorting be represented in a RESTful query string?**  
*Answer:* The industry standard convention uses a comma-separated list of field names, where a leading minus sign (`-`) denotes descending order and the absence of a prefix denotes ascending order. For example: `?sort=-created_at,price` instructs the backend to sort by `created_at DESC`, breaking ties with `price ASC`.

### Conceptual
**Q: Why does a query like `SELECT * FROM users WHERE name LIKE '%john%'` fail to use a standard B-Tree index?**  
*Answer:* B-Tree indexes are sorted hierarchically from left to right. When a wildcard `%` is placed at the **beginning** of the search term (`'%john%'`), the database cannot know where in the alphabetical index to start seeking. It is forced to evaluate every single row in the table sequentially (Full Table Scan). A B-Tree index can only be used for prefix matching (`'john%'`).

### Implementation
**Q: Write a PostgreSQL SQL statement that configures a Full-Text Search GIN index on a `products` table across `title` and `description`.**  
*Answer:*
```sql
-- Create generated tsvector column
ALTER TABLE products 
ADD COLUMN search_vector tsvector 
GENERATED ALWAYS AS (
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description, ''))
) STORED;

-- Create GIN index on the vector
CREATE INDEX idx_products_search ON products USING GIN (search_vector);

-- Query the index:
SELECT id, title, price 
FROM products 
WHERE search_vector @@ plainto_tsquery('english', 'wireless mechanical keyboard');
```

### Debugging
**Q: An engineer notices that querying `?sort=createdAt` works, but passing `?sort=createdAt,invalidColumn` crashes the server with an unhandled database exception. How do you resolve this?**  
*Answer:* The application failed to validate sort parameters against a whitelist of valid database columns. Pass the sort parameter through an allowlist validation check before query execution:
```typescript
const ALLOWED_SORT_COLUMNS = new Set(['createdAt', 'price', 'rating']);
const safeSorts = requestedSorts.filter(col => ALLOWED_SORT_COLUMNS.has(col));
```

### Scenario
**Q: You are designing an e-commerce catalog API with 2 million products. Users want to search product titles with typo tolerance (e.g. searching "aple" finds "Apple"). How do you architect this without spinning up an external search cluster?**  
*Answer:* Use the PostgreSQL **`pg_trgm`** (trigram) extension. Trigram indexes break text into 3-character slices (e.g. "apple" -> `"  a"`, `" ap"`, `"app"`, `"ppl"`, `"ple"`). Create a GIN trigram index on the title column: `CREATE INDEX idx_title_trgm ON products USING gin (title gin_trgm_ops)`. Then execute fuzzy matching using the similarity operator: `WHERE title % 'aple' ORDER BY similarity(title, 'aple') DESC LIMIT 20`.

### Advanced
**Q: What is the N+1 problem in API filtering and how does database query planning resolve it?**  
*Answer:* The N+1 problem occurs when an API filters a primary resource (e.g. 20 Orders) and then executes 20 separate individual queries to retrieve the associated Customer for each Order (1 query for orders + N queries for customers). This is resolved at the database/ORM layer using eager loading (SQL `JOIN` or `WHERE customer_id IN (...)` batching) to retrieve all related records in exactly two queries.

---

## 16. Coding Questions

### Problem: Build a Pure TypeScript Query String Filter Parser Supporting Operators
```typescript
// utils/filterParser.ts

export type FilterOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';

export interface ParsedFilter {
  field: string;
  operator: FilterOperator;
  value: string | string[];
}

export function parseQueryFilters(queryParams: Record<string, any>): ParsedFilter[] {
  const filters: ParsedFilter[] = [];
  const operatorRegex = /^(.+)\[(eq|ne|gt|gte|lt|lte|in)\]$/;

  for (const [key, rawVal] of Object.entries(queryParams)) {
    // Exclude pagination and sorting reserved keys
    if (['page', 'limit', 'sort', 'q'].includes(key)) continue;

    const match = key.match(operatorRegex);

    if (match) {
      const [, field, op] = match;
      const operator = op as FilterOperator;
      const value = operator === 'in' && typeof rawVal === 'string'
        ? rawVal.split(',')
        : rawVal;

      filters.push({ field, operator, value });
    } else {
      // Default exact equality
      filters.push({ field: key, operator: 'eq', value: rawVal });
    }
  }

  return filters;
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "`ILIKE '%term%'` is fast enough if the column is indexed."  
  *Truth:* False! Standard B-Tree indexes cannot index wildcards with leading characters. `ILIKE '%term%'` always forces a full table scan unless backed by a trigram index (`pg_trgm`).
- **Trap 2:** "Users should be able to sort by any database column they want."  
  *Truth:* False. Allowing sorting on arbitrary columns allows attackers to sort by unindexed columns, causing severe CPU spikes, or sort by private hashed columns.

---

## 18. Revision Summary
- Standardize query parameters: `field=val` (exact), `field[gte]=val` (comparison), `sort=-col,col2` (multi-sort), `q=term` (search).
- Always validate query parameters using Zod schemas and whitelist allowed sortable columns.
- Leading wildcard queries (`LIKE '%term%'`) bypass B-Tree indexes; use PostgreSQL GIN indexes or trigrams.
- Separate full-text search from standard attribute filtering.

---

## 19. Quick Reference

```
+--------------------+---------------------------+-----------------------------------------------+
| Query Requirement  | URL Query Convention      | Database Translation                          |
+--------------------+---------------------------+-----------------------------------------------+
| Exact Match        | ?status=ACTIVE            | WHERE status = 'ACTIVE'                       |
| Comparison         | ?price[gte]=100           | WHERE price >= 100                            |
| Inclusion Set      | ?tier=FREE,PRO            | WHERE tier IN ('FREE', 'PRO')                 |
| Descending Sort    | ?sort=-created_at         | ORDER BY created_at DESC                      |
| Multi-Sort         | ?sort=-rating,price       | ORDER BY rating DESC, price ASC               |
| Full-Text Search   | ?q=react+developer        | WHERE to_tsvector(..) @@ plainto_tsquery(..)  |
| Fuzzy Search       | ?q=appl                   | WHERE title % 'appl' (pg_trgm)                |
+--------------------+---------------------------+-----------------------------------------------+
```
