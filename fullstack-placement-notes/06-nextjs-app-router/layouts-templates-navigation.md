# Layouts, Templates, and Navigation Mechanics

## 1. What is it?
In the Next.js App Router, page transitions and surrounding visual chrome are managed by three core concepts:
1. **Layouts (`layout.tsx`):** UI that wraps child routes, persists across navigations, preserves state (e.g. form inputs, search queries, active audio players), and avoids re-rendering when navigating between sibling routes.
2. **Templates (`template.tsx`):** Similar to layouts, but creates a **brand-new instance for every child navigation**, resetting internal state, re-running effects, and re-triggering entry animations.
3. **Navigation Mechanics:** Client-side routing driven by `<Link>`, the `useRouter()` hook, `redirect()`, and automatic background route prefetching.

```
+-------------------------------------------------------------------------------+
|                      LAYOUTS VS TEMPLATES VS NAVIGATION                       |
+---------------------------+-----------------------+---------------------------+
| Feature                   | Layout (`layout.tsx`) | Template (`template.tsx`) |
+---------------------------+-----------------------+---------------------------+
| State on Navigation       | PRESERVED             | RESET (Clean instance)    |
| DOM Element Re-mounting   | No (Reused)           | Yes (Destroyed & Rebuilt) |
| Effects (`useEffect`)     | Do not re-run         | Re-runs on every route    |
| Primary Use Case          | Persistent sidebars,  | Page entry animations,    |
|                           | global auth providers | feedback forms, page views|
+---------------------------+-----------------------+---------------------------+
```

---

## 2. Why does it exist?
In traditional multi-page websites or the legacy Next.js Pages Router:
- Navigating between pages destroyed the DOM, re-rendered headers, broke CSS transitions, and discarded client state.
- Developers had to implement complex global state managers (Redux, Context) just to keep a search input or audio player alive while navigating.
- Implementing enter/exit CSS animations required awkward manual wrappers.

The App Router solves this by decoupling persistent structural containers (`layout.tsx`) from fresh page instances (`template.tsx`), backed by an intelligent client-side router that prefetches and swaps only the changing subtrees.

---

## 3. Mental Model
Think of your web application as a **Television Set**:
- **`layout.tsx` is the TV Frame and Speakers:** The physical plastic casing, sound bar, and power cord remain plugged in and active constantly.
- **`template.tsx` is the Channel Changing Transition:** When you flip from Channel 4 to Channel 5, the TV displays a brief channel badge animation and tunes into the new frequency from the beginning.
- **`<Link>` Navigation is Instant Channel Buffering:** While you are watching Channel 4, the TV silently pre-buffers the next two most popular channels in the background so switching is instantaneous.

```
NAVIGATING FROM /dashboard/overview TO /dashboard/settings:

[ RootLayout (Unchanged) ]
  └── [ DashboardLayout (Unchanged - Keeps sidebar state!) ]
        └── [ DashboardTemplate (Unmounts old, Mounts new!) ]
              └── [ OLD: Overview Page ] ---> REPLACED WITH ---> [ NEW: Settings Page ]
```

---

## 4. Basic Example

### Persistent Layout vs Fresh Template
```typescript
// app/dashboard/layout.tsx
import { ReactNode } from 'react';

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex">
      <aside className="w-64 bg-gray-900 text-white p-4">
        {/* State inside this sidebar is NEVER wiped when clicking links below */}
        <input 
          type="search" 
          placeholder="Filter menu..." 
          className="w-full p-2 bg-gray-800 rounded text-sm text-white"
        />
        <nav className="mt-4 space-y-2">
          <a href="/dashboard/overview" className="block text-gray-300 hover:text-white">Overview</a>
          <a href="/dashboard/settings" className="block text-gray-300 hover:text-white">Settings</a>
        </nav>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
```

```typescript
// app/dashboard/template.tsx
'use client';

import { ReactNode, useEffect } from 'react';

export default function DashboardTemplate({ children }: { children: ReactNode }) {
  useEffect(() => {
    // This effect runs ON EVERY SUB-ROUTE NAVIGATION!
    console.log('Template mounted: user navigated to a dashboard sub-route');
  }, []);

  return (
    <div className="animate-fadeIn transition-opacity duration-300">
      {children}
    </div>
  );
}
```

---

## 5. Real Example

### Complete Navigation Controls with `<Link>`, Active Links, and `useRouter`
```typescript
// components/navigation/DashboardNav.tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

const NAV_ITEMS = [
  { label: 'Overview', href: '/dashboard' },
  { label: 'Analytics', href: '/dashboard/analytics' },
  { label: 'Billing', href: '/dashboard/billing' },
  { label: 'Team', href: '/dashboard/team' },
];

export function DashboardNav() {
  const pathname = usePathname();
  const router = useRouter();

  const handleQuickJump = (e: React.ChangeEvent<HTMLSelectElement>) => {
    router.push(e.target.value);
  };

  return (
    <nav className="flex items-center justify-between p-4 bg-white border-b">
      <ul className="flex space-x-4">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                prefetch={true} // Automatically prefetch RSC payload into Router Cache
                className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Programmatic Navigation */}
      <select 
        value={pathname} 
        onChange={handleQuickJump} 
        className="p-1 border rounded text-sm"
      >
        {NAV_ITEMS.map((item) => (
          <option key={item.href} value={item.href}>{item.label}</option>
        ))}
      </select>
    </nav>
  );
}
```

---

## 6. Under the Hood

### 1. The Prefetching Pipeline
When a `<Link>` appears in the browser's viewport (detected via `IntersectionObserver`):
1. Next.js silently initiates a background HTTP fetch for the destination's **RSC Payload**.
2. For static routes: the entire RSC payload is prefetched and cached indefinitely in the client-side **Router Cache**.
3. For dynamic routes: the shared layout tree and loading skeletons down to the first `loading.tsx` boundary are prefetched for 30 seconds.
4. When the user clicks the link, the transition occurs instantly with 0ms network latency!

### 2. Client-Side Router Cache
Next.js maintains an in-memory client-side cache of visited and prefetched route segments:
- Navigating back and forth using the browser's Back/Forward buttons is instant because the RSC payload is retrieved from memory without contacting the server.
- The router reconciles the React virtual DOM tree, preserving existing DOM elements outside the changing segment.

---

## 7. Important Rules
1. **Layouts Do Not Accept SearchParams:** `layout.tsx` does NOT receive `searchParams` props. Only `page.tsx` receives `searchParams`. This prevents cache invalidation of the entire layout whenever a query param changes.
2. **Always Use `<Link>` for Internal Navigation:** Never use standard `<a href="...">` for internal routes. `<a>` tags trigger a full page browser reload, destroying all client-side state and prefetching benefits.
3. **Server Redirects vs Client Navigation:**
   - Use `redirect('/login')` from `next/navigation` in Server Components, Route Handlers, and Server Actions.
   - Use `router.push('/login')` inside Client Components.
4. **Scroll Restoration is Default:** Next.js automatically scrolls to the top of the new page and preserves scroll position on back/forward navigation unless disabled via `<Link scroll={false}>`.

---

## 8. Common Mistakes

### Mistake 1: Relying on `layout.tsx` to Fire Analytics Page Views
```typescript
// app/dashboard/layout.tsx
// ❌ WRONG: Layout does not re-mount when switching between /dashboard/users and /dashboard/billing!
// Page view events placed here will only trigger once on initial load.
```
**Fix:** Put page view tracking in `template.tsx` or inside a Client Component using `usePathname()`.

### Mistake 2: Missing `scroll={false}` for Tabbed or Filter Interfaces
```typescript
// When changing query params or tabs, the browser jumps to the top of the viewport
<Link href="/dashboard?tab=logs">Logs</Link> // Jumps to top!

// Fix:
<Link href="/dashboard?tab=logs" scroll={false}>Logs</Link>
```

---

## 9. Best Practices
1. **Prefer `layout.tsx` Over `template.tsx` by Default:** Use templates only when you have a specific requirement for resetting state or triggering entry animations. Layouts maximize performance by avoiding DOM re-mounts.
2. **Optimize Prefetching for Large Menus:** In massive e-commerce mega-menus with hundreds of links, set `prefetch={false}` on below-the-fold links to avoid overwhelming the client network connection.
3. **Use Route Segment Config in Layouts:**
   ```typescript
   export const dynamic = 'force-static'; // All child pages become static unless overridden
   ```

---

## 10. Performance Considerations
- **Partial Rendering:** When switching from `/settings/profile` to `/settings/security`, Next.js re-renders ONLY the child segment. The root layout and settings layout are completely untouched in memory, minimizing CPU work.
- **Router Cache Invalidation:** The client-side Router Cache can be programmatically cleared using `router.refresh()`, triggering a background refetch without wiping React state.

---

## 11. Security Considerations
- **Do Not Rely on Layout Guards for Child Authorization:** An attacker can trigger a Server Action or fetch an RSC payload for a sub-page directly. Always enforce authorization checks at the data layer, in `middleware.ts`, or inside Server Actions.
- **Open Redirect Vulnerabilities:** When using `redirect(redirectUrl)` based on user-supplied query parameters (e.g. `?returnTo=/dashboard`), validate that `returnTo` starts with a single `/` and does not point to an external origin (e.g. `https://malicious.com`).

---

## 12. Alternatives
- **Single Page Application Routers (React Router):** Complete client-side routing, but lacks automatic streaming, server-side prefetching, and nested server component boundaries.
- **Traditional MPA Navigation (Standard HTML Links):** High latency, complete page reloads, and state destruction.

---

## 13. Trade-offs

| Strategy | Advantages | Drawbacks |
| :--- | :--- | :--- |
| **`layout.tsx`** | Preserves input state, zero re-mount overhead | Cannot trigger route-change animations |
| **`template.tsx`** | Re-mounts DOM, triggers entry effects cleanly | Re-renders child tree; wipes form state |
| **`<Link prefetch>`** | Instant zero-latency transitions | Consumes bandwidth for unused pages |
| **`router.push()`** | Programmatic control in event handlers | Not discoverable by web crawlers (bad for SEO) |

---

## 14. Real-World Usage
- **Admin Dashboard Layout:** Left sidebar retains collapsed/expanded state, search query, and scroll position while the center content area smoothly navigates through hundreds of pages.
- **Onboarding Flow Template:** A 5-step registration wizard using `template.tsx` so that each forward step triggers a slide-in animation and resets validation state for the new step.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the key difference between `layout.tsx` and `template.tsx` in Next.js?**  
*Answer:* A `layout.tsx` component persists across route navigations, maintaining its state and avoiding re-renders of its DOM elements. A `template.tsx` component creates a brand-new instance on every navigation, completely resetting state, re-running effects, and re-mounting the DOM.

### Conceptual
**Q: How does Next.js prefetching work with the `<Link>` component?**  
*Answer:* When a `<Link>` enters the browser's viewport, Next.js automatically prefetches the route's RSC payload in the background. For static routes, the entire payload is cached; for dynamic routes, the layout tree down to `loading.tsx` is prefetched. When clicked, navigation is virtually instantaneous.

### Implementation
**Q: How do you programmatically navigate to a new route from a client-side form submission without using `<Link>`?**  
*Answer:*
```typescript
'use client';
import { useRouter } from 'next/navigation';

export function LoginForm() {
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await authenticateUser();
    router.push('/dashboard');
  }

  return <form onSubmit={handleSubmit}><button type="submit">Log In</button></form>;
}
```

### Debugging
**Q: An engineer attempts to access `searchParams` in `app/dashboard/layout.tsx` and gets `undefined`. Why?**  
*Answer:* By design, `layout.tsx` files do NOT receive `searchParams`. This is an architectural optimization: if layouts received `searchParams`, changing a query parameter would force the entire layout and all its children to re-render. `searchParams` are only provided to `page.tsx`.

### Scenario
**Q: You want to maintain the user's scroll position when they click a link that updates a URL filter parameter (e.g. `?page=2`). How do you prevent Next.js from scrolling to the top?**  
*Answer:* Add the `scroll={false}` prop to the `<Link>` component: `<Link href="/products?page=2" scroll={false}>Next Page</Link>`.

### Advanced
**Q: Explain how the Next.js Client-Side Router Cache works and how you can force it to refresh.**  
*Answer:* The Router Cache stores prefetched and visited RSC payloads in browser memory. It invalidates automatically after a duration (30 seconds for dynamic, 5 minutes for static). To manually invalidate the client cache and fetch fresh server state without reloading the browser window, call `router.refresh()`.

---

## 16. Coding Questions

### Problem: Build an Animated Multi-Route Wrapper Using `template.tsx`
```typescript
// app/auth/template.tsx
'use client';

import { ReactNode } from 'react';

export default function AuthTemplate({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 to-indigo-950 p-4">
      <div className="w-full max-w-md bg-white rounded-xl shadow-2xl p-8 transform transition-all duration-500 animate-slideUp">
        {children}
      </div>
    </div>
  );
}
```

```typescript
// app/auth/login/page.tsx
import Link from 'next/link';

export default function LoginPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900">Sign In</h2>
      <p className="text-sm text-gray-600 mt-1">Access your enterprise cluster</p>
      <form className="mt-6 space-y-4">
        <input type="email" placeholder="Email" className="w-full p-2.5 border rounded-lg" />
        <input type="password" placeholder="Password" className="w-full p-2.5 border rounded-lg" />
        <button className="w-full bg-indigo-600 text-white py-2.5 rounded-lg font-semibold hover:bg-indigo-700">
          Authenticate
        </button>
      </form>
      <div className="mt-4 text-center">
        <Link href="/auth/register" className="text-sm text-indigo-600 hover:underline">
          Need an account? Register
        </Link>
      </div>
    </div>
  );
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "Layouts re-render whenever the URL changes."  
  *Truth:* False! Layouts preserve state and avoid re-rendering across navigations within the same segment.
- **Trap 2:** "`router.push()` should be used everywhere instead of `<Link>`."  
  *Truth:* False. `<Link>` enables automatic background prefetching and proper HTML `<a>` semantics for search engines and accessibility. Use `router.push()` only for imperative programmatic actions (e.g. after async submissions).

---

## 18. Revision Summary
- `layout.tsx` wraps children and persists state across navigations; `template.tsx` re-mounts on every navigation.
- Only `page.tsx` receives `searchParams`; `layout.tsx` does not receive them to avoid full-tree re-renders.
- Use `<Link>` for internal navigation to benefit from automatic viewport prefetching and Router Cache.
- Call `router.refresh()` to invalidate the client-side Router Cache without wiping React state.

---

## 19. Quick Reference

```
+--------------------+---------------------------+-----------------------------------------------+
| API / Component    | Scope                     | Primary Function                              |
+--------------------+---------------------------+-----------------------------------------------+
| <Link href="...">  | Client & Server JSX       | Accessible navigation with prefetching        |
| <Link scroll={f}>  | Client & Server JSX       | Prevents scrolling to top on navigation       |
| useRouter()        | Client Component only     | Programmatic navigation (push, replace, back) |
| redirect(path)     | Server Component / Action | Immediate server-side HTTP 307/308 redirect   |
| router.refresh()   | Client Component only     | Invalidates client cache and re-fetches RSC   |
| usePathname()      | Client Component only     | Returns current URL pathname string           |
+--------------------+---------------------------+-----------------------------------------------+
```
