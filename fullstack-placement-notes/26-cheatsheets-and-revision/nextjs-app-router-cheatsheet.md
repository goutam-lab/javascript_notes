# Next.js App Router Cheatsheet & Deep Dive

---

## 1. What is it?

The Next.js App Router Cheatsheet is an operational reference guide and deep-dive technical blueprint for Next.js 13, 14, and 15 architectures. Built on React Server Components (RSC) and React Suspense, the App Router replaces the legacy Pages Router (`pages/`) with a directory-based routing paradigm inside `app/`. It provides native streaming SSR, server-driven data fetching without client bundles, declarative nested layouts, Server Actions for full-stack mutations, and a multi-tiered caching pipeline designed for serverless and edge environments.

```
+-----------------------------------------------------------------------------------+
|                        Next.js App Router Hierarchy                               |
+-----------------------------------------------------------------------------------+
| Directory Convention:  app/dashboard/settings/page.tsx -> /dashboard/settings     |
| Special File Pipeline: layout.tsx -> template.tsx -> error.tsx -> loading.tsx      |
|                        -> not-found.tsx -> page.tsx                               |
| Route Groups:          (marketing)/about/page.tsx -> /about (No URL impact)       |
| Dynamic Routing:       [id] (Single), [...slug] (Catch-all), [[...slug]] (Optional)|
| Advanced Routing:      @modal (Parallel Slot), (.)photos/[id] (Intercepting)      |
| Execution Directives:  "use server" (Actions), "use client" (Hydration boundary)  |
+-----------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

In the legacy Pages Router (`pages/`):
1. **Coupled Data Fetching:** `getServerSideProps` and `getStaticProps` operated strictly at the top-level page file. Child components could not fetch their own data directly, leading to prop drilling across dozens of component layers.
2. **Layout State Reset:** Navigating between sibling pages caused layouts to unmount and remount, losing scroll positions, audio/video playback states, and local UI state.
3. **Heavy Client Bundles:** Every library imported for data formatting, date parsing, or markdown conversion was bundled and shipped to the client browser.
4. **Waterfall Blocking:** Pages Router SSR blocked the entire HTTP response until the slowest database call resolved, causing severe Time-to-First-Byte (TTFB) latency.

---

## 3. Mental Model

To master Next.js App Router in interviews, visualize a page request as a **Nested Shell Assembly Line with Streaming Holes**:

```
[ Incoming Request: GET /dashboard/analytics ]
                       |
                       v
         [ Root Layout (app/layout.tsx) ]
           - HTML shell, Global CSS, Navbars (Persistent)
                       |
                       v
         [ Dashboard Layout (app/dashboard/layout.tsx) ]
           - Sidebar, User Context (Preserves state across sub-routes)
                       |
                       v
      +----------------+----------------+
      |                                 |
      v                                 v
[ Immediate Static Shell ]    [ Suspense Boundary Hole ]
  - Header & Breadcrumbs         - <Suspense fallback={<Skeleton />}>
  - Flushed immediately to edge     - Slow Database Query runs async
  - Instant TTFB & FCP              - Streams chunked RSC payload when resolved
```

---

## 4. Basic Example

### The Canonical Special File Hierarchy

```
app/
├── layout.tsx       # Root layout: wraps <html> and <body>
├── page.tsx         # Home page UI (/)
├── loading.tsx      # Automatic Suspense boundary fallback for page.tsx
├── error.tsx        # Client error boundary for catching rendering errors
├── not-found.tsx    # UI for notFound() triggers or 404s
└── dashboard/
    ├── layout.tsx   # Nested dashboard layout (preserves sidebar state)
    ├── page.tsx     # Dashboard home (/dashboard)
    └── settings/
        └── page.tsx # Settings page (/dashboard/settings)
```

#### Basic Server Component Page with Direct DB Query
```tsx
// app/dashboard/page.tsx (Server Component by default)
import { db } from "@/lib/db";

export default async function DashboardPage() {
  const stats = await db.analytics.findFirst();

  return (
    <div className="p-6">
      <h1 className="text-xl font-bold">Dashboard</h1>
      <p>Active Users: {stats?.activeCount ?? 0}</p>
    </div>
  );
}
```

---

## 5. Real Example

### Parallel Routes, Intercepting Routes, and Server Action Mutation

```tsx
// app/@modal/(.)photos/[id]/page.tsx (Photo Modal Interceptor)
import { Modal } from "@/components/Modal";
import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import Image from "next/image";

export default async function PhotoModal({ params }: { params: { id: string } }) {
  const photo = await db.photo.findUnique({ where: { id: params.id } });
  if (!photo) notFound();

  return (
    <Modal>
      <div className="relative w-96 h-96">
        <Image src={photo.url} alt={photo.title} fill className="object-cover" />
      </div>
      <p className="mt-2 font-semibold">{photo.title}</p>
    </Modal>
  );
}
```

```typescript
// app/actions/photo-actions.ts
"use server";

import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";

export async function deletePhotoAction(photoId: string) {
  await db.photo.delete({ where: { id: photoId } });
  revalidateTag("photos-gallery"); // Purges all cached gallery views
  return { success: true };
}
```

---

## 6. Under the Hood

### The 4-Tier Caching Architecture Reference

```
+------------------------------------------------------------------------------------+
| Tier 1: Request Memoization (Per-Request Lifetime)                                 |
| - React deduplicates identical fetch() calls within a single render pass.          |
+------------------------------------------------------------------------------------+
| Tier 2: Data Cache (Persistent Cross-Request Cache)                                |
| - Stores fetch('...', { next: { revalidate: 3600, tags: ['posts'] } }).             |
| - Persists across deployments. Invalidated via revalidateTag('posts').             |
+------------------------------------------------------------------------------------+
| Tier 3: Full Route Cache (Server Build/ISR Memory & Disk)                          |
| - Stores statically rendered HTML and RSC flight payloads on the server.           |
| - Invalidated via revalidatePath() or revalidateTag().                             |
+------------------------------------------------------------------------------------+
| Tier 4: Router Cache (Client Browser Memory)                                       |
| - Caches prefetched and visited route RSC payloads in browser session RAM.         |
| - Cleared via router.refresh() or automatically after 30s (dynamic) / 5m (static). |
+------------------------------------------------------------------------------------+
```

---

## 7. Important Rules

1. **The Rule of Leaf Boundaries:** Keep the `"use client"` directive as far down the component tree as possible (at the interactive leaves). Never place `"use client"` at the top of a layout or page file unless 100% of child components strictly require client-side hooks.
2. **The Rule of Dynamic Functions:** Accessing `cookies()`, `headers()`, or reading `searchParams` in a page automatically bails the entire route out of Static Rendering and forces **Dynamic Rendering (SSR)** on every incoming request.
3. **The Rule of `error.tsx` Client Boundary:** `error.tsx` **must always be a Client Component** (`"use client"`). It catches errors thrown inside child Server Components and renders an interactive recovery fallback (`reset()`).
4. **The Rule of `global-error.tsx`:** An `error.tsx` in `app/error.tsx` does *not* catch errors thrown inside the root `app/layout.tsx`. To catch root layout crashes, you must define `app/global-error.tsx` which must render its own `<html>` and `<body>` tags.

---

## 8. Common Mistakes

### Mistake 1: Passing Non-Serializable Props across RSC Boundaries
Passing a JavaScript class instance, Date object, or callback function from a Server Component to a Client Component:
```tsx
// BAD: Error: Functions cannot be passed directly to Client Components
<ClientButton onClick={() => console.log('clicked')} />
```
Props crossing the network wire must be plain JSON-serializable primitives, objects, or arrays.

### Mistake 2: Missing `<Suspense>` Around SearchParams
Using `useSearchParams()` in a Client Component inside App Router without wrapping the component in `<Suspense>`. This causes the **entire page** to de-opt to client-side rendering during build time, breaking static optimization.

### Mistake 3: Confusing `template.tsx` and `layout.tsx`
Using `template.tsx` when you want to preserve state across navigations. `template.tsx` creates a completely new component instance on every route change, resetting all local state and re-triggering entrance animations.

---

## 9. Best Practices

1. **Route Segment Configuration Export:** Use explicit segment options to control rendering behavior:
   ```typescript
   export const dynamic = "force-dynamic"; // Equivalent to getServerSideProps
   export const revalidate = 3600;         // ISR: Revalidate every hour
   export const runtime = "edge";          // Run on Edge Workers
   ```
2. **Composition for Server Components inside Client Components:**
   Pass Server Components as `children` to Client Components:
   ```tsx
   <ClientSidebar>
     <ServerUserProfile /> {/* Renders on server, passed as children! */}
   </ClientSidebar>
   ```
3. **Parallel Fetching via `Promise.all`:** Always fetch independent data promises concurrently:
   ```tsx
   const [userData, ordersData] = await Promise.all([getUser(), getOrders()]);
   ```

---

## 10. Performance Considerations

* **Streaming with Loading UI (`loading.tsx`):** Automatically wraps page content in `<Suspense>`. Enables instant TTFB by sending static navigation headers immediately while dynamic database queries stream down.
* **Partial Prerendering (PPR):** Combines static generation and dynamic streaming in a single HTTP response. The static shell is served instantly from the CDN edge, and dynamic holes stream in over the same connection.
* **Link Prefetching:** `<Link href="/dashboard">` automatically prefetches the target route's RSC payload when the link enters the user's viewport, making navigations feel instant.

---

## 11. Security Considerations

* **Server Action Public Endpoint Exposure:** Every Server Action generates a public, callable HTTP POST endpoint (`/_next/action/...`). Never assume a Server Action is private because it's in an internal directory. You **must** verify user authentication and authorization inside every Server Action function body.
* **Leaking Secrets via `NEXT_PUBLIC_`:** Never prefix secret API keys (database passwords, Stripe private keys) with `NEXT_PUBLIC_`. Variables prefixed with `NEXT_PUBLIC_` are permanently embedded into the public client JavaScript bundle. Use `import "server-only"` to prevent accidental client imports.

---

## 12. Alternatives: Complete Special Files Cheatsheet

| File Name | Placement | Purpose | Client/Server |
| :--- | :--- | :--- | :--- |
| **`layout.tsx`** | Any directory | Shared UI wrapping child routes; preserves state | Server by default |
| **`template.tsx`** | Any directory | Like layout, but creates a brand new instance on navigation | Server by default |
| **`page.tsx`** | Any directory | The unique public UI for a specific URL route path | Server by default |
| **`loading.tsx`** | Any directory | Instant fallback UI wrapped in React `<Suspense>` | Server by default |
| **`error.tsx`** | Any directory | Error boundary catching runtime exceptions in children | **Must be Client** (`"use client"`) |
| **`global-error.tsx`**| `app/` root only | Catches errors in root `layout.tsx`; includes `<html>/<body>` | **Must be Client** (`"use client"`) |
| **`not-found.tsx`** | Any directory | UI rendered when `notFound()` is triggered | Server by default |
| **`route.ts`** | Any directory | REST / Webhook HTTP API route handler (`GET`, `POST`) | Server only |
| **`default.tsx`** | Inside parallel slots | Fallback UI for unmatched parallel routes on reload | Server by default |

---

## 13. Trade-offs

* **App Router (RSC) vs Pages Router:** App Router eliminates client bundle bloat and provides granular streaming, but introduces a steeper learning curve (mental model of server/client boundaries, serialization rules, and complex multi-layer caching).
* **Edge Runtime vs Node.js Runtime:** Edge runtime provides sub-10ms cold starts globally, but lacks access to native Node.js APIs (`fs`, `child_process`) and full database drivers that require TCP sockets (unless using HTTP-based drivers like Neon or Prisma Accelerate).

---

## 14. Real-World Usage

* **Priceline:** Migrated to Next.js App Router and React Server Components, reducing total client JavaScript bundle size by 35% and improving Largest Contentful Paint (LCP) by 28%.
* **Vercel Dashboard:** Uses parallel and intercepting routes to open deployment logs in modal drawers while maintaining shareable, standalone URLs.

---

## 15. Placement Interview Questions

### Basic Level
1. **What is the difference between a Server Component and a Client Component?**
   * *Answer:* Server Components render strictly on the server and send zero JavaScript to the client browser. They have direct access to backend resources (databases, filesystem, secrets). Client Components are marked with `"use client"`, pre-render to HTML on initial SSR, and hydrate in the browser to handle user interactivity (state, effects, DOM event listeners).

2. **What does the `"use server"` directive signify?**
   * *Answer:* It marks an asynchronous function as an executable **Server Action**. It tells the Next.js compiler to generate a public POST endpoint so the function can be invoked directly from client forms, buttons, or transitions.

3. **How does dynamic routing work in App Router (`[id]` vs `[...slug]` vs `[[...slug]]`)?**
   * *Answer:*
     - `[id]`: Single dynamic segment (e.g., `/posts/123` -> `{ id: '123' }`). Does not match `/posts` or `/posts/123/edit`.
     - `[...slug]`: Catch-all segment (e.g., `/shop/a/b/c` -> `{ slug: ['a', 'b', 'c'] }`). Does not match `/shop`.
     - `[[...slug]]`: Optional catch-all segment. Matches both `/shop` (`{ slug: undefined }`) and `/shop/a/b/c`.

4. **What is the role of `route.ts` in App Router?**
   * *Answer:* `route.ts` defines custom HTTP request handlers (equivalent to API routes in Pages Router). It exports standard Web API functions: `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, and `OPTIONS`. Note: A `route.ts` cannot exist in the same folder as a `page.tsx`.

5. **How do you generate dynamic metadata for SEO in Next.js?**
   * *Answer:* Export an async function named `generateMetadata`:
   ```tsx
   export async function generateMetadata({ params }: Props): Promise<Metadata> {
     const post = await getPost(params.id);
     return { title: post.title, description: post.excerpt };
   }
   ```

---

### Conceptual Level
6. **Walk me through what happens when a user clicks a `<Link>` in Next.js App Router.**
   * *Answer:*
     1. The browser intercepts the click event (preventing full browser page reload).
     2. Next.js checks the in-memory **Client Router Cache**.
     3. If missed, it makes a lightweight HTTP request for the route's **RSC payload** (`?_rsc=...`).
     4. The server executes Server Components, streams the RSC payload back to the browser.
     5. React reconciler patches the virtual DOM tree, preserving common layout state and updating only the dynamic children.
     6. Browser URL is updated via `window.history.pushState`.

7. **Explain the difference between `revalidatePath` and `revalidateTag`.**
   * *Answer:*
     - `revalidatePath(path)`: Purges the cache for a specific URL path (e.g., `/products/[id]`). It invalidates both the Data Cache and the Full Route Cache for all pages matching that route.
     - `revalidateTag(tag)`: Purges cache entries across the *entire application* that were tagged during `fetch(url, { next: { tags: [tag] } })`. Enables fine-grained, cross-route cache invalidation.

8. **How do Parallel Routes (`@slot`) and Intercepting Routes (`(.)route`) work together?**
   * *Answer:* Parallel routes allow simultaneously rendering multiple independent pages in the same layout via named slots (`@modal`). Intercepting routes allow intercepting a route navigation from the current page (e.g., clicking a photo in a feed opens the photo in a modal via `(.)photos/[id]`) while keeping the underlying feed visible. If the user refreshes the page directly, Next.js renders the full standalone photo page (`/photos/[id]`).

9. **What causes Next.js to switch from Static Rendering to Dynamic Rendering?**
   * *Answer:*
     - Calling dynamic functions: `cookies()`, `headers()`.
     - Using the `searchParams` prop in page components.
     - Making `fetch()` calls with `{ cache: 'no-store' }`.
     - Specifying `export const dynamic = 'force-dynamic'`.

10. **Explain Partial Prerendering (PPR).**
    * *Answer:* PPR is a hybrid rendering model introduced in Next.js 14. At build time, Next.js prerenders a static HTML shell for the page (navigation, layout, and fallback skeletons). Any dynamic Server Components wrapped in `<Suspense>` leave "holes". When requested, the edge CDN serves the static shell instantly, while the server streams the dynamic holes into the placeholders over the same HTTP stream.

---

### Implementation Level
11. **Write a Server Action handling form submission with optimistic UI update via `useOptimistic`.**
    * *Answer:* (See Section 16, Coding Challenge 1).

12. **How do you implement an API Route Handler with streaming text responses (like ChatGPT)?**
    * *Answer:*
    ```typescript
    // app/api/chat/route.ts
    export async function POST(req: Request) {
      const encoder = new TextEncoder();
      const customReadable = new ReadableStream({
        async start(controller) {
          for (const word of ["Hello", " ", "this", " ", "is", " ", "streaming!"]) {
            controller.enqueue(encoder.encode(word));
            await new Promise((res) => setTimeout(res, 100));
          }
          controller.close();
        },
      });

      return new Response(customReadable, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    ```

13. **How do you safely read and modify cookies inside a Server Action?**
    * *Answer:*
    ```typescript
    "use server";
    import { cookies } from "next/headers";

    export async function updateUserTheme(theme: "dark" | "light") {
      const cookieStore = await cookies();
      cookieStore.set("theme", theme, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    ```

14. **How do you generate static parameters for dynamic routes at build time using `generateStaticParams`?**
    * *Answer:*
    ```tsx
    // app/blog/[slug]/page.tsx
    export async function generateStaticParams() {
      const posts = await getPosts();
      return posts.map((post) => ({ slug: post.slug }));
    }

    export default async function BlogPost({ params }: { params: { slug: string } }) {
      const post = await getPostBySlug(params.slug);
      return <article><h1>{post.title}</h1></article>;
    }
    ```

15. **How do you implement internationalization (i18n) routing in App Router?**
    * *Answer:* Use dynamic route segment `app/[lang]/...` paired with `middleware.ts`. The middleware inspects the `Accept-Language` header or user locale cookie, redirects `/dashboard` to `/en/dashboard` or `/es/dashboard`, and components read `params.lang` to load localized translation dictionaries.

---

### Debugging Level
16. **Why does an error boundary (`error.tsx`) fail to catch an error thrown inside `app/layout.tsx`?**
    * *Answer:* The error boundary file `error.tsx` is rendered *inside* its adjacent `layout.tsx`. Because `layout.tsx` is the parent wrapper, an error thrown during layout rendering occurs *above* the boundary. To catch root layout errors, you must create `app/global-error.tsx`.

17. **Why do you get error: `Event handlers cannot be passed to Client Component props`?**
    * *Answer:* A Server Component attempted to pass a function prop (`onClick`, `onSubmit`) to a Client Component. Functions cannot be serialized across the network flight stream. The event handler function must be defined *inside* the Client Component itself.

18. **Why does `router.refresh()` not refetch data after a database update?**
    * *Answer:* `router.refresh()` only invalidates the client-side Router Cache; it asks the server for fresh RSC data. However, if the server's data was fetched using `fetch()` and cached in the server-side **Data Cache** (or Full Route Cache), the server simply returns the cached data! You must call `revalidatePath()` or `revalidateTag()` inside a Server Action before calling `router.refresh()`.

19. **Why does `cookies()` throw an error when called inside a static page?**
    * *Answer:* `cookies()` is a dynamic function that requires reading the incoming HTTP request headers. Calling `cookies()` opts the route out of static generation. If you explicitly configured `export const dynamic = 'error'` or `force-static`, Next.js throws a build-time compiler error.

20. **Why did a production Next.js build fail with `Dynamic server usage: Page couldn't be rendered statically because it used useSearchParams`?**
    * *Answer:* Reading `useSearchParams()` on the client during prerendering requires knowing the URL query string. Without a Suspense boundary, Next.js cannot prerender any part of the page. Fix by wrapping the component using `useSearchParams()` inside `<Suspense fallback={<SearchSkeleton />}>`.

---

### Scenario-Based Questions
21. **Scenario: You are designing an e-commerce Product Detail Page (PDP). The product title, images, and description change rarely (static), but real-time inventory and pricing change frequently. How do you architect this in App Router?**
    * *Answer:*
      - Use Partial Prerendering (PPR) or Streaming SSR:
      - The outer page is statically generated at build time (`export const revalidate = 86400`).
      - Wrap the inventory/pricing component in `<Suspense fallback={<PriceSkeleton />}>`.
      - The `LivePriceWidget` is an async Server Component that fetches fresh inventory with `{ cache: 'no-store' }`.
      - The browser receives the static product shell in 15ms from the CDN, and the live price streams into the Suspense placeholder in 100ms.

22. **Scenario: You have a multi-step checkout form. How do you manage form state across steps without losing data on page refresh?**
    * *Answer:*
      - Option A: Store step data in URL search parameters (`/checkout?step=2&shippingId=...`).
      - Option B: Store draft progress in an encrypted session cookie or Redis draft session using Server Actions.
      - Option C: Use a client-side Zustand store persisted to `sessionStorage` for the active wizard flow, submitting the final consolidated payload via a Server Action.

23. **Scenario: You are building a high-traffic SaaS dashboard. 10,000 users query the dashboard every minute. How do you prevent crushing your PostgreSQL database?**
    * *Answer:* Wrap the heavy database query in `unstable_cache`:
    ```typescript
    import { unstable_cache } from "next/cache";

    const getCachedDashboardData = unstable_cache(
      async (tenantId: string) => db.query(...),
      ["tenant-dashboard"],
      { revalidate: 300, tags: [`dashboard-${tenantId}`] }
    );
    ```
    This stores query results in the Next.js Data Cache for 5 minutes, reducing database load by 98%.

24. **Scenario: How do you handle file uploads in Next.js App Router without crashing serverless memory limits?**
    * *Answer:* Never upload large files directly through Server Actions or Route Handlers into memory.
      1. Client calls a lightweight Server Action to request an Amazon S3 / Cloudflare R2 **Pre-Signed Upload URL**.
      2. Client uploads the binary file directly from the browser to S3 via HTTP `PUT`.
      3. Client invokes a second Server Action with the resulting S3 file key to store metadata in PostgreSQL.

25. **Scenario: You need to support custom subdomains for multi-tenant users (`tenant.app.com`). How do you architect this in Next.js?**
    * *Answer:* In `middleware.ts`, extract the `Host` header from the incoming request. If the host matches `([a-zA-Z0-9]+).app.com`, rewrite the request internally to `app/tenants/[tenantId]/...` using `NextResponse.rewrite()`. The browser URL remains `tenant.app.com`, while Next.js routes to the dynamic tenant folder.

---

### Advanced Architectural Questions
26. **Explain the wire format of the React Server Component (RSC) Flight stream.**
    * *Answer:* The RSC stream is a line-delimited serialized representation of the React component tree:
      - Lines starting with `M:` declare client component chunk module references (`M1:{"id":"./Card.tsx","name":"Card"}`).
      - Lines starting with `J:` declare virtual DOM nodes with JSON props (`J0:["$","div",null,{"className":"p-4","children":["$L1",{"title":"Hello"}]}]`).
      - `$L1` references the client chunk `M1` for client hydration.
      - Promises are represented by placeholder IDs that emit resolved values later in the stream.

27. **How does Next.js Turbopack differ from Webpack in App Router compilation?**
    * *Answer:* Turbopack is written in Rust and built on an incremental computation engine (Turbo Engine). It caches function-level computations in memory rather than entire bundled chunks. When a Server Component changes, Turbopack re-executes only the exact function graph affected, delivering 5x–10x faster local Fast Refresh and build times compared to Webpack.

28. **What is the difference between `revalidate = 0`, `cache: 'no-store'`, and `dynamic = 'force-dynamic'`?**
    * *Answer:*
      - `revalidate = 0`: Sets cache time-to-live to 0 seconds. Route is dynamically rendered, but fetch requests may still memoize within the same tick.
      - `cache: 'no-store'`: Per-fetch option instructing the Data Cache never to store the HTTP response.
      - `dynamic = 'force-dynamic'`: Route-level override forcing the entire page into dynamic SSR on every request, bypassing all static optimization.

29. **How do Next.js Server Actions prevent Cross-Site Request Forgery (CSRF)?**
    * *Answer:* Next.js Server Actions automatically inspect the `Origin` and `Host` (or `X-Forwarded-Host`) headers on incoming POST requests. If the `Origin` header does not match the `Host` header, Next.js rejects the action with a 403 Forbidden error, preventing malicious third-party websites from forging action submissions.

30. **Explain Partial Route Updates during Client Navigation.**
    * *Answer:* When navigating between routes that share a parent layout (e.g., from `/dashboard/analytics` to `/dashboard/settings`), Next.js only requests the RSC payload for the changed leaf segment (`/settings`). The parent `/dashboard/layout.tsx` is not re-fetched, re-rendered, or re-mounted, preserving local layout state (scroll position, input drafts) seamlessly.

---

## 16. Coding Questions

### Coding Challenge 1: Optimistic UI List Mutation with Server Action

```tsx
// components/OptimisticTodoList.tsx
"use client";

import { useOptimistic, useTransition, useRef } from "react";
import { addTodoAction } from "@/app/actions/todo-actions";

interface Todo {
  id: string;
  text: string;
  isPending?: boolean;
}

export function OptimisticTodoList({ initialTodos }: { initialTodos: Todo[] }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  // Optimistic state wrapper
  const [optimisticTodos, addOptimisticTodo] = useOptimistic(
    initialTodos,
    (state: Todo[], newText: string) => [
      ...state,
      { id: `temp-${Date.now()}`, text: newText, isPending: true },
    ]
  );

  const handleFormSubmit = async (formData: FormData) => {
    const text = formData.get("todoText") as string;
    if (!text.trim()) return;

    formRef.current?.reset();

    // 1. Optimistic immediate update
    startTransition(async () => {
      addOptimisticTodo(text);
      try {
        await addTodoAction(text);
      } catch (err) {
        alert("Failed to save todo!");
      }
    });
  };

  return (
    <div className="p-4 max-w-md">
      <form ref={formRef} action={handleFormSubmit} className="flex gap-2 mb-4">
        <input name="todoText" className="border p-2 flex-1 rounded" placeholder="Add task..." />
        <button disabled={isPending} className="bg-blue-600 text-white px-4 py-2 rounded">
          {isPending ? "Adding..." : "Add"}
        </button>
      </form>

      <ul className="divide-y">
        {optimisticTodos.map((todo) => (
          <li key={todo.id} className={`py-2 ${todo.isPending ? "opacity-50 italic" : ""}`}>
            {todo.text} {todo.isPending && "(saving...)"}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### Coding Challenge 2: Middleware for Authentication & Subdomain Rewriting

```typescript
// middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/request";

export function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const host = request.headers.get("host") || "";
  const sessionToken = request.cookies.get("__Host-session")?.value;

  // 1. Route Protection for /dashboard
  if (url.pathname.startsWith("/dashboard") && !sessionToken) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", url.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 2. Multi-tenant Subdomain Rewriting
  // e.g., acme.example.com -> /tenants/acme/...
  const currentHost = process.env.NODE_ENV === "production" ? "example.com" : "localhost:3000";
  const customSubdomain = host.replace(`.${currentHost}`, "");

  if (customSubdomain && customSubdomain !== host && customSubdomain !== "www") {
    return NextResponse.rewrite(
      new URL(`/tenants/${customSubdomain}${url.pathname}${url.search}`, request.url)
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
```

---

## 17. Common Interview Traps

* **The Trap:** The interviewer asks: *"Does adding `"use client"` at the top of a file mean that the component runs ONLY in the browser client?"*
  * **How candidates fail:** Saying "Yes, it tells Next.js not to run this component on the server."
  * **The Winning Answer:** **No!** `"use client"` does **NOT** mean client-only execution. A Client Component is **still pre-rendered to static HTML on the server** during the initial page load (SSR) to ensure fast initial paint and SEO. The `"use client"` directive simply marks the boundary where the component is packaged into a client bundle for React browser hydration.
* **The Trap:** *"Can you use `revalidatePath` inside a Server Component during render?"*
  * **How candidates fail:** Saying "Yes, to ensure the component revalidates itself."
  * **The Winning Answer:** **No!** Calling `revalidatePath()` or `revalidateTag()` during the render phase of a Server Component will throw a runtime error. Revalidation functions are **mutation side-effects** and can *only* be called inside Server Actions (`"use server"`) or Route Handlers (`route.ts`).

---

## 18. Revision Summary

```
+-----------------------------------------------------------------------------------+
|                   Next.js App Router High-Yield Revision Matrix                   |
+-----------------------------------------------------------------------------------+
| File Hierarchy:     layout -> template -> error (client) -> loading -> page       |
| Directives:         "use server" (Server Actions); "use client" (Hydration cutoff)|
| 4 Caches:           Request Memo -> Data Cache -> Full Route Cache -> Router Cache|
| Dynamic Triggers:   cookies(), headers(), searchParams, { cache: 'no-store' }     |
| Revalidation:       revalidateTag('tag') for data; revalidatePath('/path') for UI |
| Streaming SSR:      <Suspense> + loading.tsx flushes immediate HTML shell & TTFB  |
| PPR:                Partial Prerendering: static edge shell + streaming holes     |
+-----------------------------------------------------------------------------------+
```

---

## 19. Quick Reference

* **`layout.tsx`:** Shared layout wrapper; preserves state across sibling navigations.
* **`template.tsx`:** Shared layout wrapper; creates a brand new instance on every navigation.
* **`error.tsx`:** Client error boundary; must contain `"use client"`.
* **`loading.tsx`:** Instant Suspense fallback UI for adjacent page.
* **`route.ts`:** Custom HTTP endpoint handler (GET, POST, etc.).
* **`revalidateTag(tag)`:** Purges specific Data Cache entries across the entire app.
* **`revalidatePath(path)`:** Clears Full Route Cache and Router Cache for specific path.
* **`unstable_cache(fn, keys, opts)`:** Caches arbitrary database/ORM calls in Next.js Data Cache.
