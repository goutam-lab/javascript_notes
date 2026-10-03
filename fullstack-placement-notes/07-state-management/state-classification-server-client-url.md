# State Classification: Server, Client, and URL State

## 1. What is it?
State in modern full-stack web applications represents any dynamic data that changes over time and drives user interface rendering. Rather than treating all data as a monolithic "global state" (a common pitfall of early React/Redux architectures), modern software engineering categorizes state into four distinct architectural domains:
1. **Local UI State:** Ephemeral data confined to a single component or immediate parent-child pair (e.g., dropdown open/close toggle, hover state, input focus).
2. **Global UI State:** Client-only data needed by many disparate components across the application tree (e.g., current dark/light theme, user notification toasts, modal stacking manager, mobile drawer state).
3. **URL / Router State:** State stored directly in the browser's address bar via pathname, hash, and search parameters (`?q=term&page=2&sort=desc`).
4. **Server / Remote Cache State:** Asynchronous data originating from an external database or backend API (e.g., user profiles, product catalogs, order histories). It is not owned by the client; it is merely an in-memory cache of remote state.

```
+-------------------------------------------------------------------------------+
|                       THE 4 DOMAINS OF MODERN STATE                           |
+-------------------+-----------------------+-------------------+---------------+
| Domain            | Location / Tool       | Characteristic    | Example       |
+-------------------+-----------------------+-------------------+---------------+
| 1. Local UI       | `useState`, `useRef`  | Ephemeral, local  | Modal isOpen  |
| 2. Global UI      | Zustand, React Context| Client-only, wide | Dark mode     |
| 3. URL State      | `useSearchParams`     | Shareable, back/fw| Filter & Page |
| 4. Server Cache   | TanStack Query / RSC  | Async, remote, TTL| Users, Posts  |
+-------------------+-----------------------+-------------------+---------------+
```

---

## 2. Why does it exist?
In the early days of React (2015-2019), the dominant pattern was dumping **everything** into a single centralized Redux store:
- Server data (`users`, `products`), loading booleans (`isLoadingUsers`), errors (`userError`), modal toggles (`isModalOpen`), and pagination numbers were all shoved into one giant global JavaScript object.
- **Consequences:** Explosive boilerplate (actions, reducers, types), agonizing synchronization bugs, stale cache discrepancies, and loss of browser back/forward button parity because filters were not tied to URLs.

Separating state into dedicated domains drastically simplifies applications: server data is treated as an asynchronous cache, URL data enables shareable links, and global client stores stay lightweight (<5KB).

---

## 3. Mental Model
Think of State as **Different Financial Documents**:
- **Local UI State is a Sticky Note on your Monitor:** You jot down "remind John" and throw it in the trash 5 minutes later. Nobody else in the building needs to see it.
- **Global UI State is the Office Thermostat Setting:** Everyone in the office shares the room temperature (light/dark theme, sound volume), but it doesn't represent company profits or bank accounts.
- **URL State is the Official Coordinates on a Treasure Map:** If you mail the coordinates (`latitude=45&longitude=12`) to a colleague in another country, they open the exact same view with the exact same filters applied.
- **Server State is the Bank Account Statement:** Your phone doesn't "own" your bank balance; it merely displays a snapshot cached from the bank's mainframe 2 minutes ago. If someone transfers money to you, your local balance is stale until you re-sync.

```
STATE DECISION MATRIX:
Is the data fetched from an asynchronous remote backend?
   ├── YES ---> SERVER CACHE STATE (TanStack Query / React Server Components)
   └── NO
        ├── Should the state be shareable via URL, or survive page refresh?
        │     ├── YES ---> URL STATE (useSearchParams / router)
        │     └── NO
        │          ├── Is it needed by distant components across the app?
        │          │     ├── YES ---> GLOBAL UI STATE (Zustand / Context)
        │          │     └── NO  ---> LOCAL UI STATE (useState / useReducer)
```

---

## 4. Basic Example

### Picking the Wrong Home vs. The Right Home
```typescript
// ❌ THE ANTI-PATTERN: Storing remote server data in a client Redux/Zustand store
interface BadGlobalStore {
  products: Product[];
  isLoading: boolean;
  error: string | null;
  fetchProducts: () => Promise<void>;
}
// Problems: Requires manual error handling, manual loading flags, manual refetch on focus,
// manual retry on disconnect, and manual cache invalidation!

// ✅ THE MODERN PATTERN: TanStack Query treats server data as a remote cache
import { useQuery } from '@tanstack/react-query';

export function ProductCatalog() {
  const { data: products, isLoading, error } = useQuery({
    queryKey: ['products'],
    queryFn: () => fetch('/api/products').then((res) => res.json()),
    staleTime: 1000 * 60 * 5, // 5 minutes fresh cache
  });

  if (isLoading) return <div>Loading catalog...</div>;
  if (error) return <div>Error loading products</div>;

  return <ul>{products.map((p: any) => <li key={p.id}>{p.name}</li>)}</ul>;
}
```

---

## 5. Real Example

### Unified Multi-Domain State Architecture in an E-Commerce Filter Page
```typescript
// app/shop/ProductFilterView.tsx
'use client';

import { useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

// 1. GLOBAL UI STATE (Zustand): Toast notification system
interface ToastStore {
  toasts: string[];
  addToast: (msg: string) => void;
}
export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  addToast: (msg) => set((s) => ({ toasts: [...s.toasts, msg] })),
}));

export function ProductFilterView() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 2. URL STATE: Read filter and page directly from URL
  const selectedCategory = searchParams.get('category') || 'all';
  const page = parseInt(searchParams.get('page') || '1', 10);

  // 3. LOCAL UI STATE: Mobile filter drawer toggle
  const [isFilterDrawerOpen, setIsFilterDrawerOpen] = useState(false);

  // 4. SERVER CACHE STATE: TanStack Query keyed by URL params!
  const { data, isLoading } = useQuery({
    queryKey: ['products', selectedCategory, page],
    queryFn: () =>
      fetch(`/api/products?cat=${selectedCategory}&page=${page}`).then((r) => r.json()),
  });

  const addToast = useToastStore((s) => s.addToast);

  const updateCategory = (newCat: string) => {
    // Sync category changes with URL state
    const params = new URLSearchParams(searchParams.toString());
    params.set('category', newCat);
    params.set('page', '1'); // Reset to page 1 on filter change
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="p-6">
      {/* Local UI Drawer Toggle */}
      <button 
        onClick={() => setIsFilterDrawerOpen(!isFilterDrawerOpen)}
        className="md:hidden mb-4 p-2 bg-gray-200 rounded"
      >
        {isFilterDrawerOpen ? 'Close Filters' : 'Open Filters'}
      </button>

      {/* URL Filter Controls */}
      <div className={`filter-sidebar ${isFilterDrawerOpen ? 'block' : 'hidden md:block'}`}>
        <button onClick={() => updateCategory('electronics')}>Electronics</button>
        <button onClick={() => updateCategory('apparel')}>Apparel</button>
      </div>

      {/* Server Cache Rendering */}
      <main className="mt-4">
        {isLoading ? (
          <p>Loading items...</p>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {data?.items.map((item: any) => (
              <div key={item.id} className="border p-4 rounded">
                <h4>{item.name}</h4>
                <button 
                  onClick={() => addToast(`Added ${item.name} to cart!`)}
                  className="mt-2 text-xs bg-blue-600 text-white p-1 rounded"
                >
                  Quick Add
                </button>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
```

---

## 6. Under the Hood

### 1. The Lifespan of State Types
- **Local State (`useState`):** Bound to the Fiber node instance. When the component unmounts from the DOM, the memory reference is destroyed and garbage-collected.
- **Global UI Store (Zustand):** Module-level closure living outside React's fiber tree. Survives component mounting and unmounting, but resets when the user performs a full browser hard refresh (`Cmd+R` / `F5`).
- **URL State:** Persisted in the browser's `History` stack. Survives hard refreshes, is bookmarkable, and responds to browser native Back and Forward buttons.
- **Server Cache State:** Maintained in memory with a Time-To-Live (TTL) and Garbage Collection (GC) timer. Synchronized across background window refocus events.

---

## 7. Important Rules
1. **Never Put Server Data in Global Stores:** Storing API query responses in Zustand or Redux forces you to manually implement caching, deduplication, retry loops, and cache invalidation. Use TanStack Query, SWR, or React Server Components instead.
2. **If Users Want to Bookmark or Share It, It Belongs in the URL:** Search queries, active tabs, pagination index, and filter selections should always be stored in URL search parameters.
3. **Keep State As Local As Possible:** Never lift state to a parent or global store unless two or more distant components genuinely require access to it.
4. **Derive State Instead of Duplicating It:** If a value can be computed from existing state or props (`const fullName = firstName + ' ' + lastName`), never create a separate state variable for it.

---

## 8. Common Mistakes

### Mistake 1: Storing Pagination and Filter State in `useState`
```typescript
// ❌ WRONG: If the user refreshes or sends the link to a coworker, all filters are lost!
const [page, setPage] = useState(1);
const [searchQuery, setSearchQuery] = useState('');
```
**Fix:** Store `page` and `q` in the URL via `useSearchParams()`.

### Mistake 2: Storing Form Input Keystrokes in Redux/Zustand
```typescript
// ❌ PERFORMANCE TRASH: Dispatching a global store update on every single character typed
<input onChange={(e) => dispatch(updateFormField({ field: 'name', val: e.target.value }))} />
```
**Fix:** Keep form input values local via `useState` or uncontrolled via React Hook Form.

---

## 9. Best Practices
1. **Adopt the Single Source of Truth Principle:** Ensure every piece of state has exactly one owner.
2. **Use URL as the Primary UI State Machine:** When building dashboards, search engines, and data tables, treat the URL query string as the true state machine.
3. **Set Realistic Stale Times in Server Caching:** Avoid setting `staleTime: 0` for static or slow-changing server data. Setting `staleTime: 5 * 60 * 1000` (5 minutes) saves thousands of unnecessary database queries.

---

## 10. Performance Considerations
- **Context Re-render Cascades:** Placing rapidly changing state inside a single monolithic React Context triggers re-renders across all consuming components. Use Zustand with selectors or split contexts.
- **Shallow Routing:** When writing to URL state via `router.push('?page=2', { scroll: false })`, ensure shallow routing is enabled to prevent full page re-renders.

---

## 11. Security Considerations
- **URL Parameter Poisoning:** Any state read from the URL (`searchParams.get('id')`) is untrusted user input. An attacker can craft malicious URLs containing XSS payloads or SQL injection patterns. Always validate URL parameters using Zod or numerical guards before passing to queries.
- **Client Cache Data Leaks:** Ensure sensitive tenant or user data cached in TanStack Query or Zustand is explicitly wiped when the user logs out (`queryClient.clear()`).

---

## 12. Alternatives
- **Monolithic Redux Architecture:** Historical standard; still used in legacy enterprise applications, but largely superseded by the modular Modern State stack.
- **Signals (Preact / Solid / Jotai atoms):** Fine-grained atomic reactivity that updates DOM nodes directly without virtual DOM re-renders.

---

## 13. Trade-offs

| State Category | Best Fit | Pitfalls If Misused |
| :--- | :--- | :--- |
| **Local State** | Modals, toggles, form fields | Prop drilling if passed too deep |
| **Global UI State** | Theme, auth modal, notifications | Memory leaks; unnecessary re-renders |
| **URL State** | Filters, search, pagination, tabs | URL length limits (2048 chars); string parsing |
| **Server Cache** | Database entities, API queries | High complexity if used for client-only data |

---

## 14. Real-World Usage
- **GitHub Pull Request Interface:**
  - Active Tab (`Conversation`, `Commits`, `Files changed`): **URL State** (`?tab=commits`).
  - Comment reply box content: **Local UI State**.
  - Reviewer list & CI check statuses: **Server Cache State** (periodically polled).
  - Dark mode and global notification drawer: **Global UI State**.

---

## 15. Placement Interview Questions

### Basic
**Q: What are the four primary categories of state in modern full-stack web applications?**  
*Answer:*
1. Local UI State (`useState`, `useRef`)
2. Global UI State (Zustand, React Context)
3. URL / Router State (`useSearchParams`)
4. Server / Remote Cache State (TanStack Query, React Server Components)

### Conceptual
**Q: Why is storing server-fetched data in Redux or Zustand considered an anti-pattern today?**  
*Answer:* Server data is not owned by the client; it is an asynchronous cache of remote database state. Storing it in Redux requires manual implementation of loading states, error states, deduplication, retry logic, background refetching on window focus, and cache invalidation. Dedicated server caching libraries like TanStack Query handle all of these concerns automatically with zero boilerplate.

### Implementation
**Q: Write a custom hook that synchronizes a search input with the URL query parameters using Next.js `useSearchParams` and `useRouter`.**  
*Answer:*
```typescript
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useCallback } from 'react';

export function useSearchQuery() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const query = searchParams.get('q') || '';

  const setQuery = useCallback((newQuery: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (newQuery) {
      params.set('q', newQuery);
    } else {
      params.delete('q');
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [router, pathname, searchParams]);

  return [query, setQuery] as const;
}
```

### Debugging
**Q: An engineer complains that navigating back in the browser does not restore the active table filters. What is the root cause?**  
*Answer:* The table filters were stored in local component state (`useState`) or global store instead of URL search parameters. Because the filters were not pushed to the browser History stack via URL query params, pressing Back navigates to the previous page instead of reverting the filter state.

### Scenario
**Q: You are architecting a high-traffic SaaS dashboard. Where should the following pieces of state live? 1) User profile details, 2) Active navigation tab, 3) Notification drawer open toggle, 4) Form validation error.**  
*Answer:*
1. User profile details: **Server Cache State** (TanStack Query / Server Component).
2. Active navigation tab: **URL State** (`?tab=overview`).
3. Notification drawer open toggle: **Global UI State** (Zustand) or Local State.
4. Form validation error: **Local UI State** (React Hook Form).

### Advanced
**Q: Explain how React Server Components (RSC) fundamentally shift the division of state between server and client.**  
*Answer:* In traditional client applications, the client must manage the lifecycle of fetching and caching server data. With RSC, server components execute on the server and fetch data directly from databases. The client never stores or manages that server state; it simply receives the rendered virtual DOM output. As a result, the volume of client-side state is dramatically reduced to purely interactive UI and URL states.

---

## 16. Coding Questions

### Problem: Build a Multi-Category Filter Bar Synchronized with URL State
```typescript
// components/CategoryFilter.tsx
'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';

const CATEGORIES = ['All', 'Frontend', 'Backend', 'DevOps', 'System Design'];

export function CategoryFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentCategory = searchParams.get('category') || 'All';

  const handleSelect = (category: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (category === 'All') {
      params.delete('category');
    } else {
      params.set('category', category);
    }
    params.delete('page'); // Reset pagination on category switch
    router.push(`${pathname}?${params.toString()}`);
  };

  return (
    <div className="flex gap-2 p-2 bg-slate-100 rounded-lg">
      {CATEGORIES.map((cat) => (
        <button
          key={cat}
          onClick={() => handleSelect(cat)}
          className={`px-4 py-2 text-sm font-semibold rounded-md transition-all ${
            currentCategory === cat
              ? 'bg-blue-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-200'
          }`}
        >
          {cat}
        </button>
      ))}
    </div>
  );
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "All shared state in an application must go into Redux or Zustand."  
  *Truth:* False! Most shared state is either Server Cache (belongs in TanStack Query) or Route/Filter State (belongs in the URL). Global client stores should only hold true client-only global UI settings.
- **Trap 2:** "URL state is slow because writing to the URL causes a full page reload."  
  *Truth:* False. Modern routers (Next.js, React Router) use the HTML5 History API (`pushState` / `replaceState`), updating the URL instantly without reloading the page.

---

## 18. Revision Summary
- Modern state is partitioned into 4 domains: Local UI, Global UI, URL/Router, and Server Cache.
- Keep server-fetched data out of client stores; use TanStack Query or Server Components.
- Store filters, search, pagination, and active tabs in the URL for link sharing and back-button support.
- Keep state as local as possible; derive values instead of duplicating them.

---

## 19. Quick Reference

```
+------------------------------------+-------------------------------------------+
| State Requirement                  | Correct Choice                            |
+------------------------------------+-------------------------------------------+
| Dropdown toggle, input focus       | useState / useRef (Local)                 |
| Dark theme, notification alerts    | Zustand / React Context (Global UI)       |
| Table pagination, search keyword   | URL searchParams (URL State)              |
| API query records, user profile    | TanStack Query / RSC (Server Cache)       |
| Form input keystrokes              | React Hook Form (Uncontrolled / Local)    |
| Calculated cart total              | Derived variable (const total = items...) |
+------------------------------------+-------------------------------------------+
```
