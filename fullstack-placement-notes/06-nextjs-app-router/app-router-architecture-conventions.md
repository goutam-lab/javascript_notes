# App Router Architecture & File Conventions

## 1. What is it?
The Next.js App Router (introduced in Next.js 13 and refined in 14/15) is a modern file-system based routing architecture built entirely around React Server Components (RSC), nested layouts, and declarative UI states. In this paradigm, folders define URL segments, while special reserved filenames define the user interface and behavioral wrappers for that segment:
- `page.tsx`: The unique public leaf UI for a URL route.
- `layout.tsx`: Shared UI that wraps child segments and preserves state across navigations.
- `template.tsx`: Similar to layout, but re-instantiates state and re-mounts on navigation.
- `loading.tsx`: Instant loading skeleton wrapped in a React `Suspense` boundary.
- `error.tsx`: Client-side error boundary that isolates component crashes.
- `not-found.tsx`: UI rendered when `notFound()` is thrown or a URL matches no routes.
- `global-error.tsx`: Fallback boundary targeting root layout fatal errors.

```
+-------------------------------------------------------------------------------+
|                       APP ROUTER FILE CONVENTION HIERARCHY                    |
+-------------------------------------------------------------------------------+
| app/dashboard/                                                                |
|   ├── layout.tsx       ---> Wraps entire dashboard & sub-routes (Persistent)  |
|   ├── template.tsx     ---> Optional: Resets state on each navigation         |
|   ├── loading.tsx      ---> Automatically wraps page in <Suspense> fallback   |
|   ├── error.tsx        ---> Client error boundary for dashboard subtree       |
|   ├── not-found.tsx    ---> 404 UI for dashboard routes                       |
|   └── page.tsx         ---> Route endpoint: /dashboard                        |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?
In the legacy Pages Router (`pages/`):
- Layouts were clumsy: developers had to manually write `getLayout` functions or create wrapper HOCs.
- Navigating between pages caused full page re-renders, destroying scroll state, video playback, and form focus.
- Every route had to manually implement loading spinners and error handling with boilerplate state variables (`const [loading, setLoading] = useState(true)`).
- Code splitting was coarse-grained.

The App Router solves this by leveraging React 18 primitives (Suspense, Error Boundaries) directly mapped to filesystem conventions, providing declarative loading states, nested error recovery, and shared persistent layouts by default.

---

## 3. Mental Model
Think of the App Router as an onion:
- Each folder level adds an outer wrapper (the `layout.tsx` and `error.tsx` boundary).
- When a user requests `/dashboard/analytics`, Next.js nests the components like Russian nesting dolls:
```
<RootLayout>
  <DashboardLayout>
    <DashboardErrorBoundary (error.tsx)>
      <DashboardSuspense (loading.tsx)>
        <DashboardPage (page.tsx) />
      </DashboardSuspense>
    </DashboardErrorBoundary>
  </DashboardLayout>
</RootLayout>
```
If `page.tsx` throws an error, only the inner `error.tsx` catches it. The `DashboardLayout` (sidebar, top header) and `RootLayout` remain completely intact, interactive, and alive!

---

## 4. Basic Example

### Directory Structure & Standard Segment Files
```typescript
// app/dashboard/layout.tsx
import { ReactNode } from 'react';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-64 bg-slate-900 text-white p-4">
        <nav>Sidebar Navigation</nav>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
```

```typescript
// app/dashboard/loading.tsx
export default function DashboardLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-1/4" />
      <div className="h-64 bg-gray-200 rounded" />
    </div>
  );
}
```

```typescript
// app/dashboard/error.tsx
'use client'; // Error boundaries MUST be Client Components

import { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Captured dashboard error:', error);
  }, [error]);

  return (
    <div className="p-6 bg-red-50 border border-red-200 rounded-lg text-red-900">
      <h2 className="text-xl font-bold">Failed to load dashboard data</h2>
      <p className="mt-2 text-sm text-red-700">{error.message}</p>
      <button
        onClick={() => reset()}
        className="mt-4 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
      >
        Retry Operation
      </button>
    </div>
  );
}
```

```typescript
// app/dashboard/page.tsx
export default async function DashboardPage() {
  // Simulating async server data fetch
  const data = await new Promise<string>((resolve) => 
    setTimeout(() => resolve('Mission Control Analytics Ready'), 1000)
  );

  return (
    <div>
      <h1 className="text-2xl font-bold">{data}</h1>
    </div>
  );
}
```

---

## 5. Real Example

### Root Layout with Fonts, Providers, and Global Metadata
```typescript
// app/layout.tsx
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/providers/AuthProvider';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: {
    default: 'Enterprise Cloud Portal',
    template: '%s | Enterprise Cloud',
  },
  description: 'Mission-critical distributed systems telemetry dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.className}>
      <body className="bg-slate-50 text-slate-900 antialiased min-h-screen">
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
```

---

## 6. Under the Hood

### How Next.js Synthesizes the Component Tree
When you provide `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, and `page.tsx` in a folder segment, the Next.js compiler transpiles and nests them into the following JSX structure:

```
+-------------------------------------------------------------+
| Layout Component (layout.tsx)                               |
|  +-------------------------------------------------------+  |
|  | Template Component (template.tsx) - if present        |  |
|  |  +-------------------------------------------------+  |  |
|  |  | ErrorBoundary (error.tsx)                       |  |  |
|  |  |  +-------------------------------------------+  |  |  |
|  |  |  | Suspense (fallback = <Loading />)         |  |  |  |
|  |  |  |  +-------------------------------------+  |  |  |  |
|  |  |  |  | Page Component (page.tsx)           |  |  |  |  |
|  |  |  |  +-------------------------------------+  |  |  |  |
|  |  |  +-------------------------------------------+  |  |  |
|  |  +-------------------------------------------------+  |  |
|  +-------------------------------------------------------+  |
+-------------------------------------------------------------+
```

1. **State Preservation:** Because the Layout sits *outside* the Page and the Suspense boundary, navigating between sibling pages (`/dashboard/users` -> `/dashboard/settings`) keeps the `DashboardLayout` mounted. State inside `DashboardLayout` (e.g. search input value, open menus) is NOT wiped.
2. **`reset()` in `error.tsx`:** Calling `reset()` tells React to discard the error state and attempt to re-render the children inside the boundary.

---

## 7. Important Rules
1. **Root Layout is Mandatory:** `app/layout.tsx` must exist, must be a Server Component, and must contain `<html>` and `<body>` tags. No other layout can contain `<html>` or `<body>`.
2. **`error.tsx` Must Be a Client Component:** React Error Boundaries require lifecycle methods (`componentDidCatch` / `getDerivedStateFromError`), which are client-only primitives. You must place `'use client';` at the top of every `error.tsx`.
3. **`error.tsx` Cannot Catch Errors in Its Own Layout:** An `error.tsx` inside `app/dashboard/` only catches errors thrown inside `page.tsx` or child routes. It does NOT catch errors thrown in `app/dashboard/layout.tsx`. To catch layout errors, put `error.tsx` in the parent directory!
4. **Use `global-error.tsx` for Root Layout Crashes:** Errors inside `app/layout.tsx` can only be caught by `app/global-error.tsx`. It must define its own `<html>` and `<body>`.

---

## 8. Common Mistakes

### Mistake 1: Trying to Style `<html>` or `<body>` inside Sub-Layouts
```typescript
// app/dashboard/layout.tsx
// ❌ WRONG: Sub-layouts must NEVER render <html> or <body> tags
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <html>
      <body>{children}</body>
    </html>
  );
}
```

### Mistake 2: Expecting `layout.tsx` to Re-render on Navigation
```typescript
// app/dashboard/layout.tsx
// ❌ GOTCHA: If you place animations or analytics triggers in layout.tsx expecting them
// to run on every sub-route click, they won't! Layouts do NOT re-mount on navigation.
```
**Fix:** Use `template.tsx` if you intentionally want components to re-mount, trigger entry animations, or reset state on every route change.

---

## 9. Best Practices
1. **Colocate Components and Assets:** You can place non-routed helper components, styles, and tests inside the route folders. Next.js only exposes a route if a folder contains a `page.tsx`.
2. **Granular Error Handling:** Do not rely solely on `app/error.tsx`. Place dedicated `error.tsx` files inside deep feature folders (e.g. `app/checkout/error.tsx`) so checkout failures do not take down the entire application shell.
3. **Graceful 404s with `notFound()`:** Call `notFound()` from `next/navigation` in your Server Component when an entity ID is missing in the database to automatically invoke `not-found.tsx`.

---

## 10. Performance Considerations
- **Instant Loading Skeletons (`loading.tsx`):** Next.js streams the `loading.tsx` UI instantly from the edge while the Server Component resolves its async database operations. This delivers a perceived TTFB (Time to First Byte) under 100ms.
- **Partial Prerendering (PPR):** Static parts of the layout are served instantly from cache, while dynamic holes stream concurrently.

---

## 11. Security Considerations
- **Segment Leaks via `error.tsx`:** In production, Next.js masks sensitive stack traces and internal database errors before passing them to client `error.tsx`. Never manually serialize raw error objects into client-visible error banners.
- **Root Layout Middleware Auth Synchronization:** Do not assume a child `page.tsx` is safe because a parent `layout.tsx` runs an auth check. Layouts can be bypassed during direct component rendering; enforce authentication in `middleware.ts` or directly within data-fetching functions.

---

## 12. Alternatives
- **Pages Router (`pages/_app.tsx`, `pages/_document.tsx`):** The legacy Next.js routing model. Requires custom `getLayout` patterns and does not support streaming or granular React Server Components.
- **Remix (`root.tsx`, nested routes):** Excellent nested routing with `ErrorBoundary` and `CatchBoundary`, but lacks native zero-bundle React Server Component primitives.

---

## 13. Trade-offs

| File | Purpose | Re-mounts on Navigation? | Server or Client? |
| :--- | :--- | :--- | :--- |
| `layout.tsx` | Persistent shared UI shell | **No** (Preserves state) | Server (Client optional) |
| `template.tsx`| Shared UI shell | **Yes** (New instance per page) | Server (Client optional) |
| `loading.tsx` | Instant loading skeleton | Swapped on data resolution | Server (rendered fast) |
| `error.tsx` | Error boundary | Resets via `reset()` | **Client only** (`'use client'`) |
| `not-found.tsx`| 404 UI | On invocation | Server (Client optional) |

---

## 14. Real-World Usage
- **Spotify Web App / Dashboards:** Sidebar and player bar sit in `layout.tsx`. As you navigate between playlists, podcasts, and albums, music plays without interruption because the audio player inside the layout never re-mounts.
- **GitHub Pull Request View:** Tabs (Conversation, Commits, Checks, Files changed) switch smoothly while the outer PR header and author info in `layout.tsx` remain stable.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the purpose of `loading.tsx` in the Next.js App Router?**  
*Answer:* `loading.tsx` creates an immediate fallback UI using React Suspense. When navigating to a route whose `page.tsx` performs async data fetching, Next.js displays `loading.tsx` instantly while the server stream resolves, preventing blank screens or client navigation lag.

### Conceptual
**Q: How does `layout.tsx` differ from `template.tsx`?**  
*Answer:* `layout.tsx` preserves state, does not re-render, and maintains its DOM nodes across route navigations within the same segment. `template.tsx` creates a completely new instance on every navigation; child DOM elements are destroyed and re-mounted, resetting effects and state.

### Implementation
**Q: How do you trigger the `not-found.tsx` UI programmatically from an async Server Component?**  
*Answer:*
```typescript
import { notFound } from 'next/navigation';

export default async function UserProfile({ params }: { params: { id: string } }) {
  const user = await db.user.findUnique({ where: { id: params.id } });
  if (!user) {
    notFound(); // Halts execution and displays nearest not-found.tsx
  }
  return <div>{user.name}</div>;
}
```

### Debugging
**Q: Why does putting an `error.tsx` inside `app/dashboard/` fail to catch an error thrown inside `app/dashboard/layout.tsx`?**  
*Answer:* In the component hierarchy, the segment's `layout.tsx` sits *outside* that segment's `error.tsx`. An error boundary can only catch errors thrown by its children. To catch an error thrown inside `app/dashboard/layout.tsx`, the error boundary must be placed in the parent directory (`app/error.tsx`).

### Scenario
**Q: You want to log all unhandled production client errors to an external service like Datadog or Sentry. Where and how should this be implemented in the App Router?**  
*Answer:* Implement the reporting logic inside `error.tsx` and `global-error.tsx` using `useEffect(() => { Sentry.captureException(error); }, [error])`. Next.js automatically provides the `error` object and an optional `digest` hash matching the server-side error log.

### Advanced
**Q: Explain how `global-error.tsx` functions and when it is invoked.**  
*Answer:* `global-error.tsx` is the root fallback boundary designed to catch errors that occur in the root `app/layout.tsx`. Because it replaces the entire root layout when active, it must define its own `<html>` and `<body>` tags. It only runs in production mode.

---

## 16. Coding Questions

### Problem: Build a Nested Dynamic Layout with Reset-Capable Error Boundary
```typescript
// app/invoices/error.tsx
'use client';

export default function InvoiceErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-md bg-amber-50 p-4 border border-amber-300">
      <h3 className="text-lg font-medium text-amber-800">Invoice Service Unavailable</h3>
      <p className="mt-1 text-sm text-amber-700">Ref: {error.digest || 'ERR_UNKNOWN'}</p>
      <div className="mt-4">
        <button
          onClick={() => reset()}
          className="rounded bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-500"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
```

```typescript
// app/invoices/page.tsx
export default async function InvoiceListPage() {
  const invoices = await fetch('https://api.example.com/invoices', { cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error('Failed to retrieve financial ledger');
    return r.json();
  });

  return (
    <div>
      <h2 className="text-xl font-bold">Ledger Records</h2>
      <ul>
        {invoices.map((inv: any) => (
          <li key={inv.id}>{inv.reference} - ${inv.total}</li>
        ))}
      </ul>
    </div>
  );
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "If I create a folder `app/utils`, it becomes a publicly accessible route `/utils`."  
  *Truth:* False! In the App Router, a folder is only routable if it contains a `page.tsx` file. Otherwise, it is simply a colocated code directory.
- **Trap 2:** "`template.tsx` is just an alias for `layout.tsx`."  
  *Truth:* False. Templates create a fresh instance on navigation, re-running `useEffect` and resetting internal `useState`. Layouts persist across navigations.

---

## 18. Revision Summary
- Special files in App Router: `page.tsx` (route UI), `layout.tsx` (persistent shell), `loading.tsx` (Suspense skeleton), `error.tsx` (Client error boundary), `not-found.tsx` (404 UI), `template.tsx` (re-mounting shell).
- Layouts persist state and do not re-render child trees across navigations.
- `error.tsx` must always have `'use client'`.
- Sub-layouts must never contain `<html>` or `<body>` tags.

---

## 19. Quick Reference

```
+--------------------+--------------------------------+----------------------------+
| Filename           | Responsibility                 | Special Requirement        |
+--------------------+--------------------------------+----------------------------+
| app/layout.tsx     | Mandatory Root Shell           | Must have <html> & <body>  |
| .../layout.tsx     | Nested persistent shell        | Takes { children } prop    |
| .../template.tsx   | Re-mounting shell              | Recreates state on change  |
| .../loading.tsx    | Streaming skeleton fallback    | Wrapped in React Suspense  |
| .../error.tsx      | Isolated error catch boundary  | Must use 'use client'      |
| .../global-error.ts| Catches root layout errors     | Must include <html> & body |
| .../not-found.tsx  | 404 fallback page              | Triggered by notFound()    |
+--------------------+--------------------------------+----------------------------+
```
