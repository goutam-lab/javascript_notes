# Data Fetching, Extended Fetch, and Caching Mechanisms

## 1. What is it?
Next.js elevates standard web data fetching by patching the native Web `fetch()` API with deep caching, request deduplication, and on-demand cache invalidation. Data fetching in the App Router operates across a synchronized 4-layer caching architecture:
1. **Request Memoization:** Dedupes identical `fetch()` calls with matching URLs and options within a single server render pass.
2. **Data Cache:** Persistent server-side key-value cache that preserves fetch responses across multiple incoming requests and deployments.
3. **Full Route Cache:** Automatically caches the evaluated HTML and RSC payload of static routes at build time.
4. **Router Cache:** In-memory client-side cache storing RSC payloads in the browser session.

```
+---------------------------------------------------------------------------------------+
|                             NEXT.JS 4-LAYER CACHING PIPELINE                          |
+-------------------+-------------------+-------------------+---------------------------+
| Layer             | Where Stored      | What is Cached?   | Lifespan                  |
+-------------------+-------------------+-------------------+---------------------------+
| 1. Memoization    | Server Memory     | fetch() returns   | Single render pass        |
| 2. Data Cache     | Server Persistent | Data / API JSON   | Persistent (revalidateTag)|
| 3. Full Route     | Server Persistent | HTML & RSC Payload| Persistent (until redeploy|
| 4. Router Cache   | Browser Memory    | RSC Payload tree  | Session (30s / 5min)      |
+-------------------+-------------------+-------------------+---------------------------+
```

---

## 2. Why does it exist?
In traditional architectures:
- **Redundant Network Queries:** If three child components deep in the tree need the current user object, developers had to fetch it at the root and prop-drill it down, or risk firing three identical HTTP requests.
- **Cache Invalidation Fragility:** Setting coarse HTTP headers (`Cache-Control: max-age=300`) often resulted in users seeing stale data or forced servers to constantly query backend databases.
- **Database Query Bloat:** Non-fetch queries (like Prisma ORM calls) lacked automatic deduplication across component trees.

Next.js provides automatic request memoization, granular tag-based cache invalidation (`revalidateTag`), and React `cache()` wrappers to ensure high-performance, cost-effective data fetching.

---

## 3. Mental Model
Think of data fetching as a **Corporate Supply Chain**:
- **Request Memoization is the Executive Desk Clipboard:** When three department heads ask for the company revenue report during the same 10:00 AM meeting, the assistant fetches it once and hands copies to all three without calling accounting three times.
- **Data Cache is the Warehouse Archive:** A temperature-controlled warehouse storing the official financial ledger. It stays there until someone files an audit revocation notice (`revalidateTag('ledger')`).
- **Full Route Cache is the Pre-Printed Catalog:** Glossy product catalogs printed at the factory. Distributed to all stores instantly until a new print run occurs.
- **Router Cache is the Customer's Pocket Brochure:** What the shopper already picked up and is browsing through in their hands.

```
Incoming Request
       |
       v
[ 1. Request Memoization ] ---> (Found in current render pass? Return instantly)
       |
       v
[ 2. Data Cache ] ------------> (Cached on disk? Check TTL / Tags. Return cached)
       |
       v
[ Network / Upstream API ] ---> (Perform physical fetch -> populate Memoization & Data Cache)
```

---

## 4. Basic Example

### Fetch Configurations in Server Components
```typescript
// app/dashboard/page.tsx

// 1. Force Cache (Static by default in Next.js 14, default behavior for static generation)
async function getCompanyProfile() {
  const res = await fetch('https://api.example.com/company', {
    cache: 'force-cache',
  });
  return res.json();
}

// 2. Time-Based Revalidation (ISR: Cache for 60 seconds)
async function getStockPrices() {
  const res = await fetch('https://api.example.com/stocks', {
    next: { revalidate: 60 },
  });
  return res.json();
}

// 3. No-Store (Dynamic SSR: Never cache, fetch fresh on every single request)
async function getLiveTelemetry() {
  const res = await fetch('https://api.example.com/telemetry', {
    cache: 'no-store',
  });
  return res.json();
}

// 4. Tag-Based Revalidation (Purge on demand via Server Actions)
async function getProducts() {
  const res = await fetch('https://api.example.com/products', {
    next: { tags: ['products-list', 'inventory'] },
  });
  return res.json();
}
```

---

## 5. Real Example

### On-Demand Revalidation with Tags and React `cache()` for Prisma/ORMs
```typescript
// lib/data/users.ts
import { cache } from 'react';
import db from '@/lib/db';

// React cache() dedupes ORM/database queries within a single render pass
export const getUserById = cache(async (userId: string) => {
  console.log(`Executing SQL query for user: ${userId}`);
  return await db.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true },
  });
});
```

```typescript
// app/actions/updateProduct.ts
'use server';

import { revalidateTag, revalidatePath } from 'next/cache';

export async function updateProductPrice(productId: string, newPrice: number) {
  // 1. Mutate database
  await fetch(`https://api.example.com/products/${productId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ price: newPrice }),
  });

  // 2. Invalidate only the relevant cache tags instantly!
  revalidateTag('products-list');
  revalidateTag(`product-${productId}`);

  // Optional: Invalidate specific route path
  revalidatePath('/dashboard/products');
}
```

---

## 6. Under the Hood

### 1. Extended Fetch Patching
Next.js patches the native global `fetch()` function during the build and runtime initialization:
```typescript
// Simplified mental representation of the Next.js fetch monkey-patch
const nativeFetch = globalThis.fetch;

globalThis.fetch = async function (input, init) {
  const cacheKey = generateCacheKey(input, init);

  // Check 1: In-memory Request Memoization Map
  if (currentRenderMemo.has(cacheKey)) {
    return currentRenderMemo.get(cacheKey).clone();
  }

  // Check 2: Next.js Persistent Data Cache (Filesystem / Redis)
  const cachedEntry = await persistentDataCache.get(cacheKey);
  if (cachedEntry && !isStale(cachedEntry, init?.next?.revalidate)) {
    return createResponseFromCache(cachedEntry);
  }

  // Fallback: Perform real network fetch
  const res = await nativeFetch(input, init);
  
  // Populate persistent data cache if cacheable
  if (init?.cache !== 'no-store') {
    await persistentDataCache.set(cacheKey, res);
  }
  
  return res;
};
```

### 2. Request Memoization vs React `cache()`
- `fetch()` memoization is **built-in and automatic** for HTTP requests.
- For non-fetch operations (Prisma, Drizzle, raw PostgreSQL, disk reads), use React's `cache()` function to achieve identical per-render memoization.

---

## 7. Important Rules
1. **Next.js 15 Fetch Defaults:** In Next.js 15, `fetch` requests default to `no-store` (uncached) unless explicitly configured with `cache: 'force-cache'` or `next: { revalidate: N }`.
2. **Dynamic Functions Disable Full Route Cache:** Using dynamic functions like `cookies()`, `headers()`, or reading `searchParams` automatically switches the route from static to dynamic rendering.
3. **Memoization is Scoped to a Single Request:** Request memoization does NOT persist across multiple users or different HTTP requests; it exists purely to deduplicate calls within one component tree render.
4. **Tag Purging is Eventual or Immediate:** `revalidateTag()` immediately marks the cache entry as stale; the very next incoming request regenerates the cache in the background (stale-while-revalidate).

---

## 8. Common Mistakes

### Mistake 1: Attempting to Use React `cache()` in Client Components
```typescript
// ❌ WRONG: React cache() is ONLY available in Server Components
'use client';
import { cache } from 'react'; // Undefined or runtime error!
```
**Fix:** Use React `cache()` strictly inside server-only utility files.

### Mistake 2: Accidentally Triggering Dynamic Mode on Static Pages
```typescript
// app/products/page.tsx
import { cookies } from 'next/headers';

export default async function Products() {
  const cookieStore = await cookies(); // ❌ DYNAMIC BAILOUT: Calling cookies() forces entire route to SSR!
  // ...
}
```

---

## 9. Best Practices
1. **Fetch Data Where It Is Used (Colocation):** Do not fetch all data in the root layout and pass it down 5 levels. Because `fetch()` dedupes requests automatically, call `fetch('/api/user')` directly inside the Header, the Sidebar, and the Profile Card.
2. **Adopt Semantic Cache Tags:** Tag data fetches with both collection and entity identifiers:
   ```typescript
   next: { tags: ['posts', `post-${post.id}`, `author-${post.authorId}`] }
   ```
   This gives you the power to invalidate a single post or all posts by an author with precision.
3. **Use `revalidateTag` Inside Server Actions:** After submitting a form or mutating a record, immediately call `revalidateTag('tag-name')` so the UI reflects the updated state instantly.

---

## 10. Performance Considerations
- **Zero Network Overhead via Memoization:** You can call the same `fetch()` 10 times in 10 different components during one render; only ONE physical HTTP request is sent across the wire.
- **Parallel Fetching with `Promise.all`:** When fetching multiple independent endpoints, always execute them in parallel to prevent sequential waterfalls:
  ```typescript
  const [userData, ordersData] = await Promise.all([
    getUser(id),
    getOrders(id),
  ]);
  ```

---

## 11. Security Considerations
- **Prevent Cache Poisoning with User-Specific Data:** Never use `cache: 'force-cache'` on endpoints that return sensitive, user-specific data (e.g., `/api/user/billing-details`). If cached in the shared Data Cache, User A's billing details could be served to User B!
- **Server Action Authorization on Revalidation:** Validate that the current caller possesses admin permissions before invoking `revalidateTag()` or `revalidatePath()`.

---

## 12. Alternatives
- **TanStack Query (React Query):** Client-side caching library. Excellent for client-rendered applications and polling, but adds JavaScript bundle size.
- **SWR:** Vercel's lightweight client-side data fetching library. Ideal for client components that require continuous real-time data refreshing.

---

## 13. Trade-offs

| Strategy | Advantages | Drawbacks |
| :--- | :--- | :--- |
| **`force-cache`** | Blazing-fast TTFB; zero backend database hits | Data can become permanently stale if not revalidated |
| **`next: { revalidate: N }`** | Predictable freshness; automatic background updates | Serves stale data to first visitor after interval |
| **`revalidateTag()`** | Instant on-demand updates; highly targeted | Requires manual trigger inside mutation actions |
| **`no-store`** | Always 100% fresh data | High server load; slowest TTFB |

---

## 14. Real-World Usage
- **Hacker News / Reddit Clone:** Front page posts cached with `next: { revalidate: 30 }` (30 seconds). Submitting an upvote via a Server Action calls `revalidateTag('frontpage')` to immediately invalidate the cache.
- **Global E-Commerce Store:** Product catalog uses `next: { tags: ['catalog'] }`. Changing prices in the admin CMS sends a webhook to `/api/revalidate?tag=catalog`, immediately purging old prices worldwide.

---

## 15. Placement Interview Questions

### Basic
**Q: How does Request Memoization work in Next.js?**  
*Answer:* Request Memoization is a server-side optimization where Next.js automatically dedupes identical `fetch()` calls (matching URL and options) made during a single render pass. If multiple components in the tree call the same `fetch()`, the network request is executed only once, and the result is shared across components.

### Conceptual
**Q: What is the difference between Time-Based Revalidation and On-Demand Revalidation?**  
*Answer:*
- **Time-Based Revalidation (`revalidate: N`):** Data is cached for N seconds. The first request after the duration serves stale data while revalidating in the background (Stale-While-Revalidate).
- **On-Demand Revalidation (`revalidateTag` / `revalidatePath`):** Data remains cached indefinitely until an explicit mutation event (e.g., form submit or webhook) programmatically purges the cache.

### Implementation
**Q: How do you deduplicate database queries executed via an ORM like Prisma across multiple components in Next.js?**  
*Answer:* Wrap the query function inside React's `cache()` utility:
```typescript
import { cache } from 'react';
import db from '@/lib/db';

export const getSessionUser = cache(async (id: string) => {
  return await db.user.findUnique({ where: { id } });
});
```

### Debugging
**Q: You set `next: { revalidate: 60 }` on a `fetch()` call, but the page continues to render dynamically on every request. Why?**  
*Answer:* The route likely uses dynamic functions such as `cookies()`, `headers()`, or accesses `searchParams` on the page. In Next.js, using dynamic functions bails out of static rendering and switches the route into dynamic SSR mode.

### Scenario
**Q: You are building an e-commerce checkout page that displays inventory quantity and applies coupon discounts. How should you configure caching?**  
*Answer:* For checkout and inventory verification, use `cache: 'no-store'` to guarantee 100% real-time accuracy and prevent out-of-stock purchases. Caching inventory data during checkout is dangerous due to race conditions.

### Advanced
**Q: Describe the complete lifecycle of a request when `revalidateTag('products')` is called during a Server Action.**  
*Answer:* When `revalidateTag('products')` executes, Next.js marks all Data Cache entries associated with that tag as stale. Next.js also purges the Full Route Cache for routes displaying that data. The current Server Action finishes and returns updated data to the client, while subsequent visitor requests trigger background regeneration of the static cache.

---

## 16. Coding Questions

### Problem: Implement Parallel Fetching with Error Handling and Tag Invalidation
```typescript
// app/dashboard/financials/page.tsx
import { notFound } from 'next/navigation';

interface RevenueData {
  totalRevenue: number;
  monthlyGrowth: number;
}

interface ExpenseData {
  totalExpenses: number;
  burnRate: number;
}

async function getRevenue(): Promise<RevenueData> {
  const res = await fetch('https://api.finance.com/revenue', {
    next: { tags: ['finance', 'revenue'], revalidate: 3600 },
  });
  if (!res.ok) throw new Error('Failed to load revenue ledger');
  return res.json();
}

async function getExpenses(): Promise<ExpenseData> {
  const res = await fetch('https://api.finance.com/expenses', {
    next: { tags: ['finance', 'expenses'], revalidate: 3600 },
  });
  if (!res.ok) throw new Error('Failed to load expense ledger');
  return res.json();
}

export default async function FinancialsPage() {
  // Parallel execution eliminates waterfalls
  const [revenue, expenses] = await Promise.all([
    getRevenue(),
    getExpenses(),
  ]);

  const netIncome = revenue.totalRevenue - expenses.totalExpenses;

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-6">Financial Ledger Overview</h1>
      <div className="grid grid-cols-3 gap-6">
        <div className="p-4 border rounded shadow-sm bg-green-50">
          <h3>Total Revenue</h3>
          <p className="text-2xl font-bold">${revenue.totalRevenue.toLocaleString()}</p>
        </div>
        <div className="p-4 border rounded shadow-sm bg-red-50">
          <h3>Total Expenses</h3>
          <p className="text-2xl font-bold">${expenses.totalExpenses.toLocaleString()}</p>
        </div>
        <div className="p-4 border rounded shadow-sm bg-blue-50">
          <h3>Net Operating Margin</h3>
          <p className="text-2xl font-bold">${netIncome.toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "`revalidateTag()` immediately pauses the server to re-fetch all data."  
  *Truth:* False. It invalidates the cache; regeneration happens on the next incoming request following the Stale-While-Revalidate pattern.
- **Trap 2:** "React `cache()` and Next.js `fetch()` cache are the exact same thing."  
  *Truth:* False! React `cache()` is an in-memory per-render memoizer for any arbitrary function (e.g. database query). Next.js `fetch()` cache is a persistent, cross-request, multi-deployment HTTP cache.

---

## 18. Revision Summary
- Next.js features a 4-layer cache: Request Memoization (per-render), Data Cache (persistent), Full Route Cache (server HTML/RSC), and Router Cache (client memory).
- `fetch()` requests can be configured with `force-cache`, `no-store`, or `next: { revalidate: N, tags: [...] }`.
- Use React `cache()` to deduplicate ORM queries and arbitrary async computations within a single render.
- Use `revalidateTag()` inside Server Actions for targeted, instant on-demand cache invalidation.

---

## 19. Quick Reference

```
+------------------------------------+-------------------------------------------+
| Option / Function                  | Operational Behavior                      |
+------------------------------------+-------------------------------------------+
| fetch(url, { cache: 'no-store' })  | Dynamic SSR; never caches; fresh every req|
| fetch(url, { cache: 'force-cache'})| Static caching; caches indefinitely       |
| fetch(url, { next: { revalidate: N}} ISR time-based caching; refreshes every Ns|
| fetch(url, { next: { tags: ['t']}})| Tagged cache; purges via revalidateTag('t')|
| revalidateTag('tag')               | On-demand server action cache purge       |
| revalidatePath('/route')           | On-demand route segment cache purge       |
| React.cache(asyncFn)               | Per-render request memoization for non-fetch|
+------------------------------------+-------------------------------------------+
```
