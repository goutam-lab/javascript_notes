# URL State: SearchParams, Browser History, and Deep Linking

## 1. What is it?
URL State refers to the architectural practice of treating the browser's address bar—specifically the URL pathname, hash, and search parameters (`?query=foo&page=2&sort=desc`)—as the primary single source of truth for user interface state. Instead of storing table filters, search queries, pagination offsets, and active tab selections in component memory (`useState`) or global stores (Zustand), URL State serializes them directly into query strings.
- **Deep Linking:** Any user can copy the current URL and send it to another user, who opens the exact same view, filter configurations, and page number.
- **History Navigation:** Back and forward browser buttons natively step through filter and pagination history without custom undo/redo logic.

```
+-------------------------------------------------------------------------------+
|                            URL STATE ARCHITECTURE                             |
+-------------------------------------------------------------------------------+
| User Types in Search Box                                                      |
|    |                                                                          |
|    | (Debounced input: 300ms)                                                 |
|    v                                                                          |
| Browser Address Bar: https://app.com/items?q=react&sort=stars&page=1         |
|    |                                                                          |
|    ├── HTML5 History API: window.history.replaceState()                      |
|    v                                                                          |
| React Component / Server Component reads: useSearchParams()                   |
|    |                                                                          |
|    v                                                                          |
| Fetches & Renders Filtered Data                                               |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?
Storing search, filter, and pagination state in ephemeral JavaScript memory causes severe user experience degradations:
- **The "Refresh Disaster":** A user spends 5 minutes configuring 6 filters on a data table, refreshes the page, and all filters reset to default.
- **Broken Shareability:** A user cannot send a link of their filtered view to a team member over Slack; the link opens an unfiltered homepage.
- **Broken Back-Button Ergonomics:** When a user clicks an item on page 4 of a search result and presses the browser's Back button, they are dumped back to page 1 with an empty search input.

Storing state in the URL gives web applications the native superpowers of the World Wide Web: shareability, bookmarkability, and history traversal.

---

## 3. Mental Model
Think of URL State as a **Postal Address on an Envelope**:
- If you write a letter to someone describing where to find a document, you don't say "look at what I had in my head 2 minutes ago." You provide the exact building, floor, room, and shelf number (`/building/docs?floor=3&room=12&shelf=B`).
- Anyone in the world who receives that letter can follow those exact coordinates to arrive at the identical physical document.
- The URL is the universal coordinate system of your web application.

---

## 4. Basic Example

### Reading and Writing URL SearchParams in Next.js
```typescript
'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';

export function SimplePagination() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Read current page from URL; default to 1
  const currentPage = Number(searchParams.get('page')) || 1;

  const setPage = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', newPage.toString());

    // Update URL without a full page reload; keep scroll position
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="flex gap-4 items-center">
      <button
        disabled={currentPage <= 1}
        onClick={() => setPage(currentPage - 1)}
        className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50"
      >
        Previous
      </button>
      <span>Page {currentPage}</span>
      <button
        onClick={() => setPage(currentPage + 1)}
        className="px-3 py-1 bg-gray-200 rounded"
      >
        Next
      </button>
    </div>
  );
}
```

---

## 5. Real Example

### Debounced Search Input with URL Synchronization and Nuqs/use-debounce Pattern
```typescript
'use client';

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';

export function SearchFilterBar() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initialize local input state with current URL value
  const [searchTerm, setSearchTerm] = useState(searchParams.get('q') || '');

  // Debounce the input by 300ms to avoid flooding browser history
  useEffect(() => {
    const handler = setTimeout(() => {
      const currentParam = searchParams.get('q') || '';
      
      // Only push update if term actually changed
      if (searchTerm !== currentParam) {
        const params = new URLSearchParams(searchParams.toString());
        
        if (searchTerm.trim()) {
          params.set('q', searchTerm.trim());
        } else {
          params.delete('q');
        }
        
        // Reset page to 1 whenever search query changes
        params.delete('page');

        // Use replace instead of push for typing to keep history clean!
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
    }, 300);

    return () => clearTimeout(handler);
  }, [searchTerm, searchParams, router, pathname]);

  return (
    <div className="relative max-w-md w-full">
      <input
        type="search"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        placeholder="Search documentation, components, APIs..."
        className="w-full px-4 py-2 border border-slate-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      {searchTerm && (
        <button
          onClick={() => setSearchTerm('')}
          className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>
      )}
    </div>
  );
}
```

---

## 6. Under the Hood

### 1. `router.push()` vs. `router.replace()`
- `router.push(newUrl)`: Adds a brand-new entry to the browser's `window.history` stack. Clicking the browser's Back button returns to the previous URL state.
  - **Best for:** Explicit user clicks (changing tabs, clicking "Next Page", selecting a checkbox filter).
- `router.replace(newUrl)`: Overwrites the *current* entry in `window.history` without increasing stack length.
  - **Best for:** Real-time text search inputs. If you used `push` while typing "react", the user would have to click Back 5 times to erase "r", "e", "a", "c", "t"!

### 2. URL Serialization Constraints
- Search parameters are encoded as ASCII strings over HTTP. Complex JavaScript objects must be serialized (e.g. JSON stringified or comma-separated lists: `tags=react,nextjs,ts`).
- Maximum URL lengths vary by browser (~2,048 characters in legacy IE; modern browsers support ~32KB, but proxies/CDNs often cap query strings at 4KB-8KB).

---

## 7. Important Rules
1. **Always Reset Pagination on Filter Change:** Whenever the user changes a search term or category filter, always delete or reset `page=1`. Otherwise, if the user is on page 10 of "All Items" and selects a niche filter with only 2 items, they see an empty page!
2. **Use `replace()` for Typing Inputs:** Never use `router.push()` inside rapid keystroke handlers; it floods the browser history stack with partial words.
3. **Wrap in `<Suspense>` When Reading SearchParams in Client Components:** In Next.js App Router, using `useSearchParams()` in a Client Component bails out of static generation for that route unless the component is wrapped in a `<Suspense>` boundary.
4. **Delete Empty Parameters:** Do not clutter URLs with empty params like `?q=&category=&page=1`. Clean up the query string: delete empty keys to keep URLs clean and readable.

---

## 8. Common Mistakes

### Mistake 1: Flooding History Stack with Keystrokes
```typescript
// ❌ DISASTER: Pushing to history on every single keystroke
<input onChange={(e) => router.push(`?q=${e.target.value}`)} />
// Typing "apple" creates 5 history entries! Back button is ruined.
```
**Fix:** Debounce by 300ms and use `router.replace()`.

### Mistake 2: Missing `<Suspense>` Around `useSearchParams`
```
Next.js Build Warning: Entire page de-opted into client-side rendering because useSearchParams() was used without a Suspense boundary.
```
**Fix:** Wrap the search component in `<Suspense fallback={<div>Loading search...</div>}>`.

---

## 9. Best Practices
1. **Adopt Nuqs (Next.js URL Query State Library):** For production apps with heavy query parameter logic, use `nuqs` (formerly `next-usequerystate`) to get type-safe URL state with integer, boolean, and array parser helpers:
   ```typescript
   import { useQueryState, parseAsInteger } from 'nuqs';
   const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
   ```
2. **Set `scroll: false` on Parameter Updates:** When updating query parameters on tabs or pagination, pass `{ scroll: false }` to prevent the browser window from jumping to the top of the viewport.
3. **Canonical Parameter Ordering:** Alphabetize query parameters before pushing to preserve cache hits on CDNs:
   ```typescript
   params.sort();
   ```

---

## 10. Performance Considerations
- **Shallow Routing:** Next.js optimizes search parameter updates by skipping full layout re-renders and re-fetching only the dynamic segments that depend on `searchParams`.
- **CDN Cache Key Normalization:** CDNs cache responses based on the full URL. If User A visits `?sort=asc&page=1` and User B visits `?page=1&sort=asc`, an un-normalized CDN treats them as two distinct cache misses. Sort query keys consistently.

---

## 11. Security Considerations
- **Query Parameter Reflected XSS:** If search parameters are reflected directly into the DOM or HTML attributes without escaping (`<div>Search for: {searchParams.get('q')}</div>`), attackers can execute script injection via crafted URLs. React escapes text by default, but never pass raw searchParams to `dangerouslySetInnerHTML`.
- **Open Redirects via `returnUrl`:** When storing post-login redirect targets in `?returnTo=/dashboard`, validate that the value starts with `/` to prevent phishing attacks (`?returnTo=https://phishing.com`).

---

## 12. Alternatives
- **`useState` / Component State:** Simpler for internal tools, but completely unshareable and loses state on refresh.
- **LocalStorage:** Persists across reloads, but cannot be shared via links and is invisible to servers during SSR.

---

## 13. Trade-offs

| Strategy | Advantages | Drawbacks |
| :--- | :--- | :--- |
| **URL State** | 100% shareable; back/forward history; bookmarkable | Limited data size; only supports serializable strings |
| **Local State (`useState`)**| Supports complex objects & functions; ultra fast | Wiped on refresh; impossible to share via link |
| **LocalStorage** | Persists across browser sessions | Client-only; not shareable with other users |

---

## 14. Real-World Usage
- **Google Search / Amazon Product Search:** Every single filter (brand, price range, prime delivery, customer review score, sort order, pagination) is serialized into query parameters.
- **Linear / Jira Issue Trackers:** Project views, active sprints, search keywords, and group-by settings reside in the URL so developers can paste issue filter links in Slack.

---

## 15. Placement Interview Questions

### Basic
**Q: Why is the URL considered the best state manager for data table filters and pagination?**  
*Answer:* Storing filters in the URL makes the state shareable via links, bookmarkable, and persistent across page refreshes. Furthermore, it automatically integrates with the browser's native History API, allowing users to use the Back and Forward buttons to navigate through filter changes.

### Conceptual
**Q: When updating search parameters in Next.js, what is the difference between `router.push()` and `router.replace()`?**  
*Answer:* `router.push()` pushes a new entry onto the browser's history stack, allowing the user to click the Back button to return to the previous state. `router.replace()` replaces the current entry in the history stack, which is essential for debounced search inputs to avoid polluting the browser history with partial typing steps.

### Implementation
**Q: Write a utility function that takes the current `searchParams` and updates a key-value pair, removing the key if the value is empty or null.**  
*Answer:*
```typescript
export function createQueryString(
  searchParams: URLSearchParams,
  name: string,
  value: string | null
): string {
  const params = new URLSearchParams(searchParams.toString());
  if (value && value.trim()) {
    params.set(name, value.trim());
  } else {
    params.delete(name);
  }
  return params.toString();
}
```

### Debugging
**Q: Why does adding `useSearchParams()` inside a Client Component cause a Next.js build error or de-optimize the entire page during static generation?**  
*Answer:* Because search parameters are determined at request time by the client browser, Next.js cannot know what parameters exist at build time. If `useSearchParams()` is used without wrapping the component in a React `<Suspense>` boundary, Next.js de-optimizes the entire route from static to dynamic client-side rendering.

### Scenario
**Q: A user navigates to page 8 of a filtered catalog, then changes the filter from "Electronics" to "Books". The page displays "No products found", but there are 50 books in the catalog. What bug occurred?**  
*Answer:* The application failed to reset the pagination parameter when changing the filter category. The URL remained `?category=books&page=8`. Because "Books" only had enough products for 3 pages, page 8 was empty. Changing any filter must always reset `page=1`.

### Advanced
**Q: How do you read URL search parameters inside a Server Component in the App Router without client hooks?**  
*Answer:* In the App Router, `page.tsx` receives `searchParams` directly as a prop (which is a Promise in Next.js 15):
```typescript
interface PageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function CatalogPage({ searchParams }: PageProps) {
  const { q, page } = await searchParams;
  const currentPage = typeof page === 'string' ? parseInt(page, 10) : 1;
  return <div>Search query: {q}, Page: {currentPage}</div>;
}
```

---

## 16. Coding Questions

### Problem: Build a URL-Driven Tab Switcher with `scroll={false}`
```typescript
// components/TabNavigation.tsx
'use client';

import { useSearchParams, useRouter, usePathname } from 'next/navigation';

interface Tab {
  id: string;
  label: string;
}

const TABS: Tab[] = [
  { id: 'overview', label: 'System Overview' },
  { id: 'metrics', label: 'Telemetry & Logs' },
  { id: 'settings', label: 'Cluster Config' },
];

export function TabNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeTab = searchParams.get('tab') || 'overview';

  const selectTab = (tabId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tabId);
    // Replace URL and disable scrolling to top
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="border-b border-gray-200">
      <nav className="-mb-px flex space-x-8">
        {TABS.map((tab) => {
          const isSelected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              className={`py-4 px-1 border-b-2 font-medium text-sm transition-all ${
                isSelected
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "Reading `searchParams` in `layout.tsx` is supported."  
  *Truth:* False! Layouts do NOT receive `searchParams` in Next.js to prevent full layout re-renders on every query change. Only `page.tsx` receives `searchParams`.
- **Trap 2:** "URL state can hold any JavaScript object."  
  *Truth:* False. URL state is strictly text-based and limited by HTTP character constraints. Complex objects must be serialized to compact strings or handled via alternative state managers.

---

## 18. Revision Summary
- URL State provides shareability, bookmarkability, and native back/forward history support.
- Use `router.push()` for deliberate user actions (pagination, tabs) and `router.replace()` for typing/search inputs.
- Always reset `page=1` whenever filters change.
- Wrap components using `useSearchParams()` in `<Suspense>` boundaries to preserve static prerendering.
- Use `scroll: false` to prevent page jumping during filter/tab updates.

---

## 19. Quick Reference

```
+------------------------------------+-------------------------------------------+
| Navigation Operation               | Best Practice                             |
+------------------------------------+-------------------------------------------+
| Updating search text input         | router.replace(?q=...), debounced 300ms   |
| Clicking pagination Next / Prev    | router.push(?page=...), scroll: false     |
| Switching tabs                     | router.replace(?tab=...), scroll: false   |
| Changing filter category           | Set new category & delete('page')         |
| Reading in Server Component        | async function Page({ searchParams })     |
| Reading in Client Component        | useSearchParams() wrapped in <Suspense>   |
+------------------------------------+-------------------------------------------+
```
