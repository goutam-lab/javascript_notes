# Routing Mastery: Dynamic, Catch-All, Route Groups, Parallel, and Intercepting Routes

## 1. What is it?
Routing in the Next.js App Router extends traditional file-system routing into a multi-dimensional system capable of handling complex URL matching, stateful UI overlays, and multi-tenant architectures:
- **Dynamic Segments (`[id]`):** Matches dynamic parameters in the URL pathname (e.g., `/products/123`).
- **Catch-All Segments (`[...slug]`):** Matches one or more subsequent path segments as an array (e.g., `/docs/a/b/c`).
- **Optional Catch-All Segments (`[[...slug]]`):** Matches zero or more segments, also matching the root `/docs`.
- **Route Groups (`(folderName)`):** Groups routes for layout organization without altering the URL path structure.
- **Parallel Routes (`@slot`):** Simultaneously renders multiple independent pages within the same layout.
- **Intercepting Routes (`(.)`, `(..)`, `(...)`):** Intercepts a route to display an alternative UI (e.g. a modal) while keeping the URL shareable.

```
+---------------------------------------------------------------------------------------+
|                               APP ROUTER SEGMENT CONVENTIONS                          |
+-------------------+---------------------------+---------------------------------------+
| Convention        | Example Path              | Matches URLs                          |
+-------------------+---------------------------+---------------------------------------+
| Static            | `app/about/page.tsx`      | `/about`                              |
| Dynamic           | `app/blog/[slug]/page.tsx`| `/blog/hello-world`, `/blog/nextjs`   |
| Catch-All         | `app/shop/[...slug]/page` | `/shop/clothes`, `/shop/clothes/tops` |
| Optional Catch-All| `app/docs/[[...slug]]/page`| `/docs`, `/docs/api`, `/docs/api/auth`|
| Route Group       | `app/(marketing)/about/..`| `/about` (omits "(marketing)" in URL) |
| Parallel Route    | `app/@modal/default.tsx`  | Injected as `props.modal` into layout |
| Intercepting Route| `app/(.)photo/[id]/page`  | Intercepts `/photo/1` navigation      |
+-------------------+---------------------------+---------------------------------------+
```

---

## 2. Why does it exist?
Traditional client-side and server-side routers suffered from several limitations:
- **URL Pollution for Structural Organization:** If you wanted different layouts for authentication pages vs marketing pages, you had to pollute the URL (e.g. `/auth/login` instead of `/login`).
- **Modal Routing Fragility:** Building modals that have their own URL (for link sharing and page refresh) traditionally required cumbersome client-side routing hacks, breaking history navigation and deep linking.
- **Independent Parallel Loading:** If a dashboard had two heavy panels (e.g., Analytics Chart and User Stream), traditional routing forced them to share one monolithic loading state or waterfall.

Next.js provides route groups, parallel slots, and intercepting segments directly in the file system to solve these challenges elegantly.

---

## 3. Mental Model
- **Route Groups `(group)` are Invisible Folders:** The parentheses tell the router: "Use this folder for assigning different layouts, but pretend this folder doesn't exist when building the URL."
- **Parallel Routes `@slot` are Multi-Monitor Display Ports:** Imagine your layout has two HDMI ports (`@team` and `@analytics`). Both slots receive their own separate page streams concurrently.
- **Intercepting Routes `(.)` are Soft Interceptors:** When you click a picture in your feed, Instagram shows a modal overlay while updating the URL to `/p/123`. If you refresh that URL or share it with a friend, it renders the full standalone page instead. That is route interception!

```
PARALLEL ROUTES ARCHITECTURE:
app/
  layout.tsx (Accepts { children, analytics, team })
  ├── @analytics/
  │     ├── page.tsx
  │     └── loading.tsx (Loads independently!)
  ├── @team/
  │     ├── page.tsx
  │     └── loading.tsx (Loads independently!)
  └── page.tsx (Passed as `children`)
```

---

## 4. Basic Example

### Dynamic Route and `generateStaticParams`
```typescript
// app/posts/[id]/page.tsx
interface PageProps {
  params: Promise<{ id: string }>;
}

// Pre-render specific IDs at build time (SSG / ISR)
export async function generateStaticParams() {
  const posts = await fetch('https://api.example.com/posts').then((r) => r.json());
  return posts.map((post: { id: string }) => ({
    id: post.id,
  }));
}

export default async function PostDetailPage({ params }: PageProps) {
  const { id } = await params; // Next.js 15 requires awaiting params
  
  return (
    <article className="p-6">
      <h1 className="text-xl font-bold">Displaying Post ID: {id}</h1>
    </article>
  );
}
```

---

## 5. Real Example

### Parallel Routes with Independent Slots and Conditional Modals
```typescript
// app/dashboard/layout.tsx
import { ReactNode } from 'react';

interface DashboardLayoutProps {
  children: ReactNode;
  analytics: ReactNode; // Injected from @analytics slot
  activity: ReactNode;  // Injected from @activity slot
}

export default function DashboardLayout({
  children,
  analytics,
  activity,
}: DashboardLayoutProps) {
  return (
    <div className="p-8 space-y-6">
      <header className="border-b pb-4">
        <h1 className="text-3xl font-bold">Executive Overview</h1>
      </header>

      {/* Main Page Content */}
      <section>{children}</section>

      {/* Independent Parallel Subsystems */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-4 border rounded shadow-sm bg-white">
          <h2 className="font-semibold text-lg mb-2">Metrics Engine</h2>
          {analytics}
        </div>
        <div className="p-4 border rounded shadow-sm bg-white">
          <h2 className="font-semibold text-lg mb-2">Activity Stream</h2>
          {activity}
        </div>
      </div>
    </div>
  );
}
```

```typescript
// app/dashboard/@analytics/page.tsx
export default async function AnalyticsSlot() {
  const stats = await fetch('https://api.example.com/stats', { cache: 'no-store' }).then((r) => r.json());
  return <div>Active Users: {stats.activeUsers}</div>;
}
```

```typescript
// app/dashboard/@analytics/default.tsx
// REQUIRED: Default fallback UI when navigating routes that don't match the slot
export default function AnalyticsDefault() {
  return null;
}
```

---

## 6. Under the Hood

### 1. Intercepting Routes Notation
Intercepting routes use directory prefixes that mimic relative file paths:
- `(.)segment`: Matches segments on the **same level**.
- `(..)segment`: Matches segments **one level above**.
- `(..)(..)segment`: Matches segments **two levels above**.
- `(...)segment`: Matches segments from the **root `app` directory**.

When a user performs a client-side navigation (`<Link href="/photos/1">`), Next.js intercepts the transition and renders `app/(.)photos/[id]/page.tsx` inside a modal. When the user visits `/photos/1` directly via hard refresh or bookmark, Next.js ignores the interceptor and renders `app/photos/[id]/page.tsx`.

### 2. Route Groups for Multiple Root Layouts
You can create multiple root layouts by placing route groups at the top level of `app/`:
```
app/
  ├── (marketing)/
  │     ├── layout.tsx (Contains public header/footer)
  │     └── page.tsx   (Matches /)
  └── (admin)/
        ├── layout.tsx (Contains secure admin sidebar)
        └── dashboard/
              └── page.tsx (Matches /dashboard)
```

---

## 7. Important Rules
1. **Always Provide `default.tsx` for Parallel Slots:** If a user hard refreshes a sub-route, Next.js cannot recover the unmatched parallel slot unless a `default.tsx` fallback file is provided.
2. **Next.js 15 Async `params`:** In Next.js 15, `params` and `searchParams` are Promises. You must always `await params` or use `React.use(params)` before accessing properties.
3. **Route Groups Don't Affect Paths:** `app/(shop)/cart/page.tsx` resolves to `/cart`, NOT `/(shop)/cart`.
4. **No Multiple Roots Without Complete HTML Bodies:** If you split `app/` into multiple route groups with their own root layouts, each group's `layout.tsx` must define its own `<html>` and `<body>` tags.

---

## 8. Common Mistakes

### Mistake 1: Forgetting `default.tsx` in Parallel Routes
```
Error: 404 Not Found or Unmatched Slot on hard reload
```
**Fix:** Always create a `default.tsx` inside each parallel slot folder (`@slotName/default.tsx`) returning the fallback UI or `null`.

### Mistake 2: Naming Collision Across Route Groups
```
app/(marketing)/about/page.tsx  ---> Resolves to /about
app/(company)/about/page.tsx    ---> Resolves to /about  ❌ BUILD ERROR!
```
**Fix:** Ensure route paths are unique across all route groups.

---

## 9. Best Practices
1. **Use `generateStaticParams` for Known Parameter Spaces:** For blogs, documentation, and product catalogs, always export `generateStaticParams()` to pre-render dynamic paths into static HTML at build time.
2. **Organize Large Codebases with Route Groups:** Use `(marketing)`, `(auth)`, `(dashboard)`, and `(settings)` to create distinct layouts and keep files organized without affecting public SEO URLs.
3. **Use Intercepting Routes for Shareable Modals:** Build modal dialogs (login popups, image previews) that update the URL bar, making modal states bookmarkable and shareable.

---

## 10. Performance Considerations
- **Independent Streaming in Parallel Slots:** Parallel route slots load concurrently and independently. If `@activity` is slow, `@analytics` renders immediately without waiting for `@activity` to finish.
- **Smart Static Parameter Generation:** `generateStaticParams()` runs at build time and can generate thousands of HTML pages in parallel, drastically reducing dynamic server load.

---

## 11. Security Considerations
- **Param Sanitization & Validation:** Dynamic parameters like `[slug]` or `[id]` come from untrusted user input. Never interpolate `params.id` directly into SQL queries or filesystem operations without validation (e.g. validating via Zod).
- **Route Group Auth Guard Isolation:** Don't rely on folder groups for access control. A route group does not restrict network access; enforce authorization in middleware or server actions.

---

## 12. Alternatives
- **React Router `useParams` (Client-side):** Requires full client bundle download before params can be parsed; no build-time static generation.
- **Express / Koa Params (`/users/:id`):** Standard backend routing, but lacks UI layout coupling and streaming integration.

---

## 13. Trade-offs

| Routing Feature | Primary Advantage | Trade-off / Complexity |
| :--- | :--- | :--- |
| **Dynamic `[id]`** | Clean URL parameterization | Requires 404 handling via `notFound()` |
| **Catch-All `[...slug]`** | High flexibility for CMS / nested trees | Complex parameter parsing logic |
| **Route Groups `()`** | Layout isolation without URL bloat | Potential duplicate path conflicts |
| **Parallel Routes `@`** | Independent streaming & sub-slots | Requires `default.tsx` file maintenance |
| **Intercepting `(.)`** | Deep-linkable modal views | Complex mental model for relative levels |

---

## 14. Real-World Usage
- **X (formerly Twitter) Image Viewer:** Clicking a photo in the timeline opens a modal with URL `/user/status/123/photo/1`. Reloading the page displays the full standalone photo view. Built using Intercepting + Parallel routes.
- **Multi-Tenant SaaS Portals:** Using route groups `(app)` and `(marketing)` to give the public website and the authenticated dashboard completely different layouts and styling sheets.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the difference between `[slug]` and `[...slug]` in the Next.js App Router?**  
*Answer:* `[slug]` matches a single URL path segment (e.g. `/posts/123`). `[...slug]` is a catch-all segment that matches one or more segments as an array (e.g. `/posts/tech/javascript/nextjs` where `slug` is `['tech', 'javascript', 'nextjs']`).

### Conceptual
**Q: How do Route Groups work and what is their primary use case?**  
*Answer:* Route groups are folders wrapped in parentheses, such as `(auth)`. They allow developers to organize files and assign different `layout.tsx` wrappers to specific sets of pages without including the folder name in the URL path. For example, `app/(auth)/login/page.tsx` resolves to `/login`.

### Implementation
**Q: Write a `generateStaticParams` function that pre-renders the top 100 products for an e-commerce store at build time.**  
*Answer:*
```typescript
// app/products/[id]/page.tsx
export async function generateStaticParams() {
  const products = await fetch('https://api.example.com/products?limit=100').then((r) => r.json());
  
  return products.map((product: { id: string }) => ({
    id: product.id,
  }));
}
```

### Debugging
**Q: A developer adds a parallel slot `@modal`, but when refreshing the browser on `/dashboard/settings`, the page crashes with a 404 error. Why?**  
*Answer:* When a hard browser refresh occurs, Next.js must render all active slots. If a slot does not match the current URL and has no `default.tsx` fallback defined, Next.js cannot render the slot and returns a 404. Creating `app/dashboard/@modal/default.tsx` returning `null` resolves the issue.

### Scenario
**Q: How would you design a documentation site where categories have arbitrary depth (e.g. `/docs/getting-started`, `/docs/api/v2/auth/jwt`)?**  
*Answer:* Use an optional catch-all route: `app/docs/[[...slug]]/page.tsx`. This single route matches both the root `/docs` (where `slug` is `undefined`) and any nested sub-path (where `slug` is an array of strings).

### Advanced
**Q: Explain how Intercepting Routes work when combined with Parallel Routes to build deep-linkable modals.**  
*Answer:* Create a parallel slot `@modal` in `app/layout.tsx`. Inside `app/@modal/(.)photos/[id]/page.tsx`, define the modal overlay. When navigating via client-side `<Link>`, Next.js intercepts the route and renders the modal inside `@modal` while the parent page remains visible. When accessing the URL directly, Next.js ignores the interceptor and renders `app/photos/[id]/page.tsx` as a full standalone page.

---

## 16. Coding Questions

### Problem: Build an Optional Catch-All Documentation Page with Breadcrumb Parser
```typescript
// app/docs/[[...slug]]/page.tsx
import Link from 'next/link';

interface DocProps {
  params: Promise<{ slug?: string[] }>;
}

export default async function DocPage({ params }: DocProps) {
  const { slug } = await params;
  const segments = slug || [];

  return (
    <div className="max-w-4xl mx-auto p-8">
      {/* Breadcrumb Navigation */}
      <nav className="flex space-x-2 text-sm text-gray-500 mb-6">
        <Link href="/docs" className="hover:underline">Docs</Link>
        {segments.map((seg, idx) => {
          const path = `/docs/${segments.slice(0, idx + 1).join('/')}`;
          return (
            <span key={path} className="flex space-x-2">
              <span>/</span>
              <Link href={path} className="hover:underline capitalize">{seg}</Link>
            </span>
          );
        })}
      </nav>

      <h1 className="text-3xl font-bold mb-4">
        {segments.length === 0 ? 'Documentation Overview' : segments[segments.length - 1].replace(/-/g, ' ')}
      </h1>

      <p className="text-gray-700">
        Current Documentation Path: <code>/docs/{segments.join('/')}</code>
      </p>
    </div>
  );
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "Catch-all `[...slug]` matches the root segment `/docs`."  
  *Truth:* False! `[...slug]` requires at least ONE segment. To match the root `/docs` as well, you must use optional catch-all `[[...slug]]` (double brackets).
- **Trap 2:** "Route groups change the URL."  
  *Truth:* False! Folders wrapped in parentheses are completely ignored by the URL parser.

---

## 18. Revision Summary
- Dynamic segments `[id]` parse path variables; catch-all `[...slug]` parses segment arrays; optional catch-all `[[...slug]]` matches zero or more segments.
- Route groups `(folder)` organize files and isolate layouts without altering URL paths.
- Parallel routes `@slot` render multiple independent views concurrently in the same layout.
- Always provide `default.tsx` for parallel slots to avoid 404 errors on hard refresh.
- Intercepting routes `(.)` enable deep-linkable modals and contextual overlays.

---

## 19. Quick Reference

```
+------------------------+---------------------------------------+-----------------------------+
| Pattern                | Filesystem Example                    | Sample Matching URL         |
+------------------------+---------------------------------------+-----------------------------+
| Dynamic Parameter      | app/items/[id]/page.tsx               | /items/42                   |
| Catch-All              | app/files/[...path]/page.tsx          | /files/docs/readme.txt      |
| Optional Catch-All     | app/wiki/[[...slug]]/page.tsx         | /wiki AND /wiki/react/hooks |
| Route Group            | app/(admin)/users/page.tsx            | /users                      |
| Parallel Route Slot    | app/@analytics/page.tsx               | Rendered via layout props   |
| Intercepting (Same lvl)| app/@modal/(.)login/page.tsx          | Intercepts /login on client |
+------------------------+---------------------------------------+-----------------------------+
```
