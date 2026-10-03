# Next.js Mental Model: SSR, SSG, ISR, and React Server Components (RSC)

## 1. What is it?
Next.js is a production-grade React framework that transitions web applications from pure client-side single-page applications (SPAs) into hybrid architectures. It provides four distinct rendering strategies:
1. **SSR (Server-Side Rendering):** HTML is generated dynamically on every single incoming HTTP request on the server.
2. **SSG (Static Site Generation):** HTML is generated once at build time and served instantly from CDNs as static files.
3. **ISR (Incremental Static Regeneration):** Static pages are regenerated in the background on demand or after a specified cache invalidation interval (`revalidate`) without rebuilding the entire application.
4. **RSC (React Server Components):** A paradigm shift where React components execute exclusively on the server, emitting a serialized stream of virtual DOM nodes (the RSC payload) without shipping JavaScript to the client bundle.

```
+---------------------------------------------------------------------------------------------------+
|                                  NEXT.JS RENDERING PARADIGMS                                      |
+-------------------+---------------------------+-----------------------------------+---------------+
| Paradigm          | When is HTML Generated?   | Data Freshness                    | CDN Cacheable |
+-------------------+---------------------------+-----------------------------------+---------------+
| SSG (Static)      | At build time (`npm run`) | Static until next deployment      | Yes (100%)    |
| ISR (Incremental) | Build time + Background   | Stale-While-Revalidate interval   | Yes (Edge)    |
| SSR (Dynamic)     | Per request (on the fly)  | Real-time on every page load      | No (by def.)  |
| RSC (Server Comp) | Server (never in bundle)  | Can be static or dynamic          | Payload cached|
+-------------------+---------------------------+-----------------------------------+---------------+
```

---

## 2. Why does it exist?
Traditional Client-Side Rendered (CSR) React applications suffer from critical architectural weaknesses:
- **Blank Screen / Slow First Contentful Paint (FCP):** The user receives an empty `<div id="root"></div>`, downloads a multi-megabyte bundle, parses and compiles JavaScript, and then fires client-side API requests before rendering content.
- **Poor Search Engine Optimization (SEO):** Search crawlers (especially non-Google bots) struggle with heavy client-side JavaScript execution, leading to indexing failures.
- **Client Waterfalls:** Components render, trigger `useEffect` fetches, render child components, trigger more fetches, cascading latency.
- **Client-Side Secret Exposure:** Direct database queries or API secret keys cannot safely reside inside client bundles.

Next.js addresses these issues by shifting computation to the server, enabling immediate HTML delivery, zero-bundle-size server components, and direct database access.

---

## 3. Mental Model
Think of web delivery as ordering food:
- **CSR (Client-Side Rendering):** The restaurant delivers raw ingredients, pans, and a recipe book to your door. You must assemble, cook, and plate the meal yourself before eating.
- **SSG (Static Site Generation):** A pre-packaged, frozen meal prepared in advance at the factory. It is delivered instantly from local distribution centers (CDNs), but the menu cannot change without a factory re-run.
- **ISR (Incremental Static Regeneration):** The local hub stocks pre-cooked meals. When an order arrives past the expiration window, it serves the current one instantly, while ordering a fresh replacement to restock the shelf.
- **SSR (Server-Side Rendering):** A personal chef cooks the meal from scratch in a professional kitchen every time an order is placed and couriers it immediately. It is always fresh, but delivery speed depends on cooking time.
- **RSC (React Server Components):** The chef strips out all the heavy cookware, peels the shells, and sends you only the ready-to-eat food and interactive condiments. You never receive the heavy kitchen machinery.

```
TRADITIONAL CSR:
Browser <=== Empty HTML + Massive JS === Server
Browser ---> Runs JS ---> Fetches Data ---> Paints DOM (High FCP/TTI)

SSR:
Browser <=== Fully Formed HTML + JS (Hydration) === Server (Dynamic per req)

RSC (App Router):
Server Component (Runs on Server) ---> Serialized RSC Payload (JSON-like stream)
Client Component (Runs on Browser) <--- Hydrates interactive islands only
```

---

## 4. Basic Example

### Server Component (Default in App Router)
```typescript
// app/products/page.tsx
// This runs ONLY on the server. Zero JS added to client bundle.
interface Product {
  id: string;
  name: string;
  price: number;
}

export default async function ProductsPage() {
  // Direct fetch with automatic caching behavior
  const res = await fetch('https://api.example.com/products', {
    next: { revalidate: 60 }, // ISR: Revalidate every 60 seconds
  });
  const products: Product[] = await res.json();

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">Product Catalog</h1>
      <ul className="mt-4 space-y-2">
        {products.map((p) => (
          <li key={p.id} className="p-3 border rounded shadow-sm">
            {p.name} - ${p.price.toFixed(2)}
          </li>
        ))}
      </ul>
    </main>
  );
}
```

---

## 5. Real Example

### Combining Server Components (Data/DB) with Interactive Client Components
```typescript
// app/dashboard/analytics/page.tsx (Server Component)
import db from '@/lib/db';
import { MetricsChart } from './MetricsChart'; // Client Component
import { Suspense } from 'react';

export const dynamic = 'force-dynamic'; // Enforces SSR (Dynamic per request)

export default async function AnalyticsPage() {
  // Direct Server Database Query (No public API route needed!)
  const stats = await db.query(
    'SELECT metric_name, value, recorded_at FROM system_metrics ORDER BY recorded_at DESC LIMIT 50'
  );

  return (
    <div className="analytics-container">
      <header>
        <h2>Executive Revenue Analytics</h2>
        <p>Live Real-Time Data (Server Rendered)</p>
      </header>

      {/* Heavy charting library bundled ONLY in Client Component island */}
      <Suspense fallback={<div className="skeleton-loader">Loading visualizer...</div>}>
        <MetricsChart initialData={stats.rows} />
      </Suspense>
    </div>
  );
}
```

```typescript
// app/dashboard/analytics/MetricsChart.tsx
'use client'; // Marks this boundary as an interactive Client Component

import { useState } from 'react';

interface MetricRow {
  metric_name: string;
  value: number;
  recorded_at: string;
}

export function MetricsChart({ initialData }: { initialData: MetricRow[] }) {
  const [filter, setFilter] = useState<'all' | 'high'>('all');

  const filtered = filter === 'high' 
    ? initialData.filter((d) => d.value > 1000) 
    : initialData;

  return (
    <div className="chart-wrapper">
      <div className="filters">
        <button onClick={() => setFilter('all')}>Show All</button>
        <button onClick={() => setFilter('high')}>Show High Value</button>
      </div>
      <div className="bars">
        {filtered.map((item, idx) => (
          <div key={idx} className="bar-row">
            <span>{item.metric_name}</span>
            <div style={{ width: `${Math.min(item.value / 10, 100)}%` }} className="bar-fill" />
            <span>${item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 6. Under the Hood

### 1. The RSC Wire Protocol
Server Components do not return HTML strings directly to the client runtime; they produce an **RSC Payload**:
- A compact serialized JSON-like binary stream containing:
  1. Rendered output of server components (HTML tags, text, props).
  2. Placeholder references for Client Components (e.g., `"$L1", "path/to/MetricsChart.js"`).
  3. Props passed from Server Components to Client Components.
- On initial page load, Next.js generates standard HTML from the RSC payload on the server for instant FCP.
- On subsequent client-side navigations (via `<Link>`), Next.js downloads *only* the RSC payload stream and reconciles the virtual DOM in the browser without reloading the page.

### 2. Hydration Boundary
Client Components are executed on the server first to emit initial HTML, and then "hydrate" on the browser.
```
Server Execution:
[Page (RSC)] ---> [MetricsChart (Client: Server Pre-render)] ---> Emits HTML & Initial RSC payload
                                                                         |
Browser Reception:                                                      v
Paints HTML immediately ---> Downloads MetricsChart JS ---> Attaches event listeners (Hydration)
```

---

## 7. Important Rules
1. **Server Components are the Default:** In the Next.js App Router (`app/`), all files are Server Components unless explicitly marked with `'use client'` at the very top of the file.
2. **`'use client'` Defines the Boundary:** Marking a component with `'use client'` means it and all components imported inside it become part of the client bundle.
3. **Data Must Be Serializable:** Props passed from Server Components to Client Components must be serializable (JSON compatible). You cannot pass functions, classes, or Symbols across the server-client boundary.
4. **No Server Secrets in Client Components:** Never import database clients, private API tokens, or server-only modules inside Client Components. Next.js throws build errors if `import 'server-only'` is breached.

---

## 8. Common Mistakes

### Mistake 1: Slapping `'use client'` at the Root of Every Page
```typescript
// ❌ WRONG: Converts entire tree into a traditional CSR SPA, losing all RSC performance benefits
'use client';
export default function BadPage() {
  const [data, setData] = useState([]);
  useEffect(() => { fetch('/api/data').then(...) }, []);
  return <div>...</div>;
}
```
**Fix:** Keep the page as a Server Component. Fetch data directly in async functions, and isolate interactive elements (buttons, inputs) into small Client Components at the leaves.

### Mistake 2: Passing Functions as Props from Server to Client
```typescript
// ❌ WRONG: Functions cannot be serialized across the network boundary
export default async function ServerPage() {
  function handleAction() { console.log('clicked'); }
  return <ClientButton onClick={handleAction} />; // Runtime Serialization Error!
}
```
**Fix:** Pass Server Actions (marked with `'use server'`) or define handler logic inside the Client Component itself.

---

## 9. Best Practices
1. **Push `'use client'` Down the Tree:** Keep 90% of your components as Server Components. Only wrap interactive widgets (modals, dropdowns, forms) with `'use client'`.
2. **Pass Server Components as Children to Client Components:**
   ```typescript
   // A Client Component can accept Server Components as `children` without forcing them to become client bundles
   <ClientModal>
     <ServerHeavyDataList />
   </ClientModal>
   ```
3. **Use Granular Suspense Boundaries:** Wrap slow async data-fetching components in `<Suspense fallback={<Skeleton />}>` to enable Streaming SSR.
4. **Leverage Route Segment Config:**
   ```typescript
   export const dynamic = 'force-dynamic'; // Enforce SSR
   export const revalidate = 300;         // ISR: 5 minutes
   ```

---

## 10. Performance Considerations
- **Bundle Size Elimination:** Heavy libraries like `marked`, `date-fns`, `sanitize-html`, or Prisma stay 100% on the server when used inside Server Components, resulting in 0 KB added to client downloads.
- **Streaming SSR:** With React 18 Suspense, the server flushes initial HTML chunks immediately (navigation bar, layout) while long-running queries resolve in parallel, streaming the remaining HTML down the HTTP connection.

---

## 11. Security Considerations
- **Elimination of Public API Attack Surface:** Server Components query databases directly behind the corporate firewall. You do not need to create public `/api/users` endpoints that require CORS, rate limiting, and parameter validation simply to display user details.
- **Tainted Data Prevention:** Use the experimental `taint` API (`experimental_taintUniqueValue`) to prevent sensitive server credentials (like user passwords or API keys) from accidentally leaking through props to Client Components.

---

## 12. Alternatives
- **Vite + React Router (CSR):** Traditional client-side SPA. Simpler hosting (S3/Cloudflare Pages), but poor SEO and slow initial load.
- **Remix (React Router v7):** Emphasizes Web Standards and SSR with nested loaders and action handlers, but does not use the RSC mental model (all components ship to client bundle).
- **Astro:** Island architecture that ships 0 KB JavaScript by default with multi-framework support, ideal for content-heavy sites (blogs, marketing).

---

## 13. Trade-offs

| Strategy | Advantages | Disadvantages |
| :--- | :--- | :--- |
| **SSG** | Lightning fast CDN delivery; zero server cost | Stale data; requires full build on every content change |
| **ISR** | Fresh data without full rebuild; fast CDN delivery | Eventual consistency; complex cache invalidation |
| **SSR** | 100% real-time data freshness; access to request headers | Server compute costs; TTFB is bounded by slowest query |
| **RSC** | 0 KB bundle size for server code; direct DB access | Mental shift; strict serialization boundary constraints |

---

## 14. Real-World Usage
- **E-Commerce Product Pages (Amazon / Shopify):** Product details, reviews, and specifications use ISR (`revalidate: 3600`) for blazing-fast CDN caching. The "Add to Cart" button and live cart counter are interactive Client Components.
- **B2B SaaS Portals (Stripe / Linear):** Authenticated dashboards use dynamic SSR with Server Components to fetch sensitive tenant data directly from PostgreSQL, streaming charts with Suspense.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the difference between SSG and SSR in Next.js?**  
*Answer:* SSG (Static Site Generation) builds the HTML once during `next build`, serving identical static files from a CDN to all users. SSR (Server-Side Rendering) executes on the Node.js/Edge server on every incoming HTTP request, dynamically fetching data and generating fresh HTML tailored to that specific request.

### Conceptual
**Q: Do React Server Components replace SSR?**  
*Answer:* No. They are complementary. SSR is a delivery technique that renders a component tree to an initial HTML string on the server. RSC is an architecture where components run *exclusively* on the server and never ship their JavaScript to the client. You can SSR an application composed of both Server and Client Components.

### Implementation
**Q: How do you configure a route in Next.js App Router to use ISR with a 1-hour revalidation time?**  
*Answer:* Either set the route segment config `export const revalidate = 3600;` or pass `{ next: { revalidate: 3600 } }` in individual `fetch()` requests.

### Debugging
**Q: You import `useState` in a component inside `app/dashboard/page.tsx` and encounter the build error: "You're importing a component that needs useState. It only works in a Client Component". How do you resolve it?**  
*Answer:* Add the `'use client';` directive as the very first line of `app/dashboard/page.tsx`, or better yet, extract the stateful UI element into a dedicated component file (e.g., `app/dashboard/Counter.tsx`) with `'use client'`, keeping the page as a Server Component.

### Scenario
**Q: You are building a news media portal with 500,000 articles. Full build time takes 4 hours. Which rendering strategy should you recommend?**  
*Answer:* Use **Incremental Static Regeneration (ISR)** with `generateStaticParams`. Pre-render only the top 1,000 most popular articles at build time. Set dynamic parameters `dynamicParams = true`. When a user requests an older article, Next.js generates it statically on the fly and caches it on the CDN for subsequent requests.

### Advanced
**Q: What happens under the hood when a user clicks a `<Link>` tag navigating between two routes in the App Router?**  
*Answer:* The browser does NOT make a full document GET request. Instead, the Next.js router intercepts the click, fetches the **RSC Payload** for the target route via an asynchronous stream, caches it in the client-side Router Cache, preserves client state in persistent layouts, and swaps only the changing page subtree via React Concurrent reconciliation.

---

## 16. Coding Questions

### Problem: Build a Server Component with Suspense Streaming and ISR
```typescript
// app/blog/[slug]/page.tsx
import { Suspense } from 'react';
import { notFound } from 'next/navigation';

export const revalidate = 600; // ISR: 10 minutes

interface PostProps {
  params: Promise<{ slug: string }>;
}

async function fetchPost(slug: string) {
  const res = await fetch(`https://api.cms.com/posts/${slug}`, {
    next: { tags: [`post-${slug}`] },
  });
  if (!res.ok) return null;
  return res.json();
}

async function CommentsSection({ slug }: { slug: string }) {
  // Slow comment query
  const res = await fetch(`https://api.cms.com/posts/${slug}/comments`, {
    cache: 'no-store', // Always dynamic
  });
  const comments = await res.json();

  return (
    <div className="comments-box">
      <h3>Discussion ({comments.length})</h3>
      {comments.map((c: any) => (
        <p key={c.id}><strong>{c.author}:</strong> {c.body}</p>
      ))}
    </div>
  );
}

export default async function BlogPostPage({ params }: PostProps) {
  const { slug } = await params;
  const post = await fetchPost(slug);

  if (!post) {
    notFound(); // Triggers not-found.tsx
  }

  return (
    <article className="prose mx-auto py-8">
      <h1>{post.title}</h1>
      <div dangerouslySetInnerHTML={{ __html: post.htmlContent }} />

      <hr className="my-6" />

      {/* Streaming SSR: Post body renders instantly; comments stream when ready */}
      <Suspense fallback={<div>Loading community comments...</div>}>
        <CommentsSection slug={slug} />
      </Suspense>
    </article>
  );
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "Client components only render in the browser."  
  *Truth:* False. On the initial page load, Client Components are pre-rendered into HTML on the server to provide fast FCP, and then hydrated on the client.
- **Trap 2:** "RSC payload is just HTML."  
  *Truth:* False. RSC payload is a compact JSON-like serialized representation of the React virtual DOM tree, containing component references, props, and slots.

---

## 18. Revision Summary
- Next.js supports SSG (build time), ISR (background revalidation), SSR (per request), and RSC (server execution without client JS).
- Server Components run exclusively on the server, have zero bundle size impact, and can access databases directly.
- Client Components (`'use client'`) add interactivity, browser APIs, and state hooks (`useState`, `useEffect`).
- Streaming SSR with Suspense allows fast components to paint immediately while slow queries stream in progressively.

---

## 19. Quick Reference

```
+--------------------+---------------------------+-----------------------------------------------+
| Directive / Method | Execution Location        | Typical Use Case                              |
+--------------------+---------------------------+-----------------------------------------------+
| Default (no mark)  | Server only               | Fetching data, DB queries, reading secrets    |
| 'use client'       | Server (pre-render) + Web | Event handlers, useState, custom browser hooks|
| 'use server'       | Server only               | Server Actions, form mutations, RPC functions |
| revalidate = N     | Server & Edge Cache       | ISR background cache refresh interval         |
| dynamic = 'force'  | Server on every request   | Real-time dynamic SSR with cookies/headers    |
+--------------------+---------------------------+-----------------------------------------------+
```
