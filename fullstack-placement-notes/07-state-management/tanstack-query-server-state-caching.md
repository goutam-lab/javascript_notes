# TanStack Query: Server State Caching, Invalidation, and Optimistic Updates

## 1. What is it?
TanStack Query (formerly React Query) is the industry-standard asynchronous state management and server-state caching library for web applications. Unlike traditional client state managers (Redux, Zustand) designed for synchronous UI toggles, TanStack Query is engineered specifically to manage **remote, asynchronous data** originating from databases and APIs. Core primitives include:
- **`useQuery`:** Declarative data fetching, caching, deduplication, and automatic background synchronization.
- **`useMutation`:** Handles create, update, and delete (CUD) operations with side-effect orchestration.
- **Query Keys:** Serializable dependency arrays (e.g. `['todos', { status: 'done' }]`) that uniquely identify cached datasets.
- **Cache Invalidation:** Programmatically marks queries as stale to trigger immediate, seamless background refetches (`queryClient.invalidateQueries`).
- **Optimistic Updates:** Instantly updates the client UI before server confirmation, rolling back gracefully if the mutation fails.

```
+-------------------------------------------------------------------------------+
|                       TANSTACK QUERY ARCHITECTURE                             |
+-------------------------------------------------------------------------------+
| Component mounts / Window refocuses                                           |
|    |                                                                          |
|    v                                                                          |
| QueryClient Cache Lookup by QueryKey: ['users', id]                           |
|    ├── CACHE HIT & FRESH (staleTime not expired) ---> Returns data instantly  |
|    ├── CACHE HIT BUT STALE (staleTime expired)  ---> Returns stale data      |
|    │                                            AND fires background fetch!   |
|    └── CACHE MISS                               ---> Shows isLoading spinner  |
|                                                 AND fires background fetch    |
|                                                                               |
| Background Fetch Resolves ---> Updates cache silently ---> Re-renders fresh UI|
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?
Traditional `useEffect` data fetching in React is fraught with subtle, high-severity bugs:
- **Boilerplate Explosion:** Every component needs manual `isLoading`, `error`, `data`, and abort controllers.
- **Race Conditions:** If a user types "a", then "ab", the response for "a" might arrive *after* "ab", overwriting the newer state with stale data.
- **Cache Incoherence:** Modifying a user's name on a profile page leaves the navbar avatar and comment list showing the old name unless manually synchronized.
- **Network Flooding:** Multiple components mounting simultaneously fire duplicate HTTP requests for the exact same data.

TanStack Query solves all of these problems out of the box with zero boilerplate.

---

## 3. Mental Model
Think of TanStack Query as a **Smart Automated Vending Machine**:
- **`queryKey` is the Product Slot Code (`B4`):** When you type `B4`, the machine checks if an ice-cold beverage is sitting in the tray.
- **`staleTime` is the Expiration Date:** If the beverage was placed there 2 minutes ago and the expiration window is 5 minutes (`staleTime: 300000`), it dispenses it instantly with 0ms waiting time.
- **`gcTime` (Garbage Collection Time) is the Cleanup Crew:** If nobody orders `B4` for 30 minutes, the machine removes the item from the refrigerated display to save power and memory.
- **Stale-While-Revalidate:** If you order `B4` after 6 minutes, the machine hands you the existing drink immediately so you don't wait thirsty, while silently restocking a fresh drink from the internal chiller in the background.

---

## 4. Basic Example

### Standard `useQuery` Implementation
```typescript
import { useQuery } from '@tanstack/react-query';

interface User {
  id: string;
  name: string;
  email: string;
}

async function fetchUser(userId: string): Promise<User> {
  const res = await fetch(`/api/users/${userId}`);
  if (!res.ok) throw new Error('Network response was not ok');
  return res.json();
}

export function UserProfile({ userId }: { userId: string }) {
  const { data: user, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['user', userId], // Keyed by dynamic userId
    queryFn: () => fetchUser(userId),
    staleTime: 1000 * 60 * 2, // Fresh for 2 minutes
    gcTime: 1000 * 60 * 10,   // Kept in memory for 10 minutes
  });

  if (isLoading) return <div>Loading user details...</div>;
  if (isError) return <div>Failed to load: {(error as Error).message}</div>;

  return (
    <div>
      <h2>{user?.name} {isFetching && <span className="text-xs text-blue-500">(Syncing...)</span>}</h2>
      <p>{user?.email}</p>
    </div>
  );
}
```

---

## 5. Real Example

### Complete Mutation with Optimistic Updates and Cache Rollback
```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface Todo {
  id: string;
  text: string;
  completed: boolean;
}

export function useAddTodoMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (newTodoText: string) => {
      const res = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: newTodoText }),
      });
      if (!res.ok) throw new Error('Failed to create todo');
      return res.json() as Promise<Todo>;
    },

    // 1. Optimistic Update before server network call finishes
    onMutate: async (newTodoText: string) => {
      // Cancel outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['todos'] });

      // Snapshot the previous cache state for rollback
      const previousTodos = queryClient.getQueryData<Todo[]>(['todos']);

      // Optimistically insert synthetic todo into cache
      if (previousTodos) {
        queryClient.setQueryData<Todo[]>(['todos'], [
          ...previousTodos,
          { id: `temp-${Date.now()}`, text: newTodoText, completed: false },
        ]);
      }

      // Return context containing the snapshot
      return { previousTodos };
    },

    // 2. If mutation fails, rollback to saved snapshot!
    onError: (err, newTodoText, context) => {
      if (context?.previousTodos) {
        queryClient.setQueryData(['todos'], context.previousTodos);
      }
      alert('Failed to save task. Reverting changes.');
    },

    // 3. Always refetch in background to synchronize true server ID and state
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] });
    },
  });
}
```

---

## 6. Under the Hood

### 1. `staleTime` vs. `gcTime`
- **`staleTime` (Default: `0`):** The duration data is considered fresh. While fresh, queries read from cache without triggering background refetches. Once `staleTime` expires, the data is marked "stale", and the next component mount or window focus triggers a background revalidation.
- **`gcTime` (Formerly `cacheTime`, Default: `5 minutes`):** The duration inactive data (data with zero active component subscribers) remains in memory before being garbage-collected.

```
Query Unmounts ---> Active Subscribers = 0
                          |
                          v
                 gcTime Timer Starts (e.g. 5 minutes)
                          |
           +--------------+--------------+
           |                             |
Component Re-mounts            gcTime Expires
Within 5 minutes:              After 5 minutes:
Instantly shows cache!         Data deleted from memory.
Timer resets.                  Next mount shows loading spinner.
```

### 2. Automatic Query Deduplication
If 5 different components on the screen all request `useQuery({ queryKey: ['user', '123'] })` at the exact same moment:
- TanStack Query creates a single shared in-memory Promise.
- **Only ONE physical network request** is executed over HTTP.
- All 5 components resolve simultaneously, eliminating network request waterfalls.

---

## 7. Important Rules
1. **Query Keys Must Be Serialized Deterministically:** Objects inside query keys are compared via deep equality, but key order inside objects does not matter:
   ```typescript
   ['todos', { status, page }] === ['todos', { page, status }] // Identical key match!
   ```
2. **Never Catch Errors Inside `queryFn` Silently:** If you do `try { ... } catch { return null }` inside your `queryFn`, TanStack Query will assume the request succeeded and cache `null`. Always re-throw errors so TanStack Query enters the `isError` state and triggers retry attempts.
3. **Always Call `cancelQueries` Before Optimistic Mutations:** Failing to cancel active queries on the same key can cause an in-flight background query to overwrite your optimistic UI update with old data.

---

## 8. Common Mistakes

### Mistake 1: Leaving `staleTime` at the Default `0` for Static Data
```typescript
// ❌ WRONG: Defaults to staleTime: 0. Every time the user clicks another tab or focuses window,
// an unnecessary HTTP request is fired to the backend!
useQuery({ queryKey: ['country-codes'], queryFn: fetchCodes });

// ✅ FIXED: Set appropriate staleTime for slow-moving data
useQuery({
  queryKey: ['country-codes'],
  queryFn: fetchCodes,
  staleTime: 1000 * 60 * 60, // Fresh for 1 hour!
});
```

### Mistake 2: Missing Query Key Dependencies
```typescript
// ❌ BUG: Changing `filter` does NOT re-fetch because it is missing from the queryKey!
useQuery({
  queryKey: ['products'], // Missing `filter` dependency!
  queryFn: () => fetchProducts(filter),
});

// ✅ FIXED:
useQuery({
  queryKey: ['products', filter],
  queryFn: () => fetchProducts(filter),
});
```

---

## 9. Best Practices
1. **Adopt Query Key Factories:** Organize keys using typed factory objects to prevent accidental typo mismatches:
   ```typescript
   export const userKeys = {
     all: ['users'] as const,
     lists: () => [...userKeys.all, 'list'] as const,
     detail: (id: string) => [...userKeys.all, 'detail', id] as const,
   };
   ```
2. **Leverage `select` for Data Transformation:** Use the `select` option to transform or filter data without re-running the transform unless the underlying data reference changes:
   ```typescript
   useQuery({
     queryKey: ['users'],
     queryFn: fetchUsers,
     select: (users) => users.filter((u) => u.isActive),
   });
   ```
3. **Prefetch Data on Hover:**
   ```typescript
   const prefetchUser = (id: string) => {
     queryClient.prefetchQuery({ queryKey: ['user', id], queryFn: () => fetchUser(id) });
   };
   <button onMouseEnter={() => prefetchUser(user.id)}>View Profile</button>
   ```

---

## 10. Performance Considerations
- **Structural Sharing:** TanStack Query performs deep structural sharing on query results. If a refetch returns an identical array of 1,000 objects where only 1 object changed, it preserves the memory references of the 999 unchanged objects, preventing unnecessary React child re-renders.
- **Window Focus Throttling:** Refetches triggered by `refetchOnWindowFocus` are automatically throttled to execute at most once every few seconds.

---

## 11. Security Considerations
- **Query Cache Memory Leakage:** In multi-user shared workstation environments (e.g. healthcare kiosks), always execute `queryClient.clear()` on user logout to purge cached patient/user data from browser RAM.
- **Sensitive Tokens in Query Keys:** Never include authentication passwords or private secret tokens in `queryKey` arrays, as query keys can be inspected via React Query DevTools or logged in error telemetry.

---

## 12. Alternatives
- **SWR (Stale-While-Revalidate by Vercel):** Lightweight alternative (~4KB), but lacks advanced mutation lifecycles, query cancellation, and offline mutation queues.
- **RTK Query:** Fully featured alternative tightly coupled to Redux Toolkit.

---

## 13. Trade-offs

| Criterion | TanStack Query | RTK Query | SWR |
| :--- | :--- | :--- | :--- |
| **Framework Agnostic**| Yes (React, Vue, Svelte, Solid)| Tied to Redux | Tied to React |
| **Optimistic Mutations**| First-class support | Good | Basic |
| **Bundle Size** | ~13 KB | Included with RTK | ~4.5 KB |
| **DevTools** | Standalone visual inspector | Redux DevTools | Third-party |

---

## 14. Real-World Usage
- **Twitter / Linear / Notion Web Clients:** Posts, issues, and documents are fetched using TanStack Query. Upvotes, checkmarks, and comment creations execute optimistically, updating the UI in 0ms while synchronizing with the database in the background.
- **Enterprise SaaS Portals:** Powering paginated data tables with automatic background polling and prefetching on row hover.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the primary difference between `isLoading` and `isFetching` in TanStack Query?**  
*Answer:*
- `isLoading`: True **only** during the very first query execution when there is no cached data available in memory (hard loading state).
- `isFetching`: True **any time** an asynchronous network request is in-flight, including background revalidations and window focus refetches while cached data is already being displayed.

### Conceptual
**Q: Explain the difference between `staleTime` and `gcTime` in TanStack Query.**  
*Answer:* `staleTime` defines the duration (in milliseconds) that cached data is considered fresh. While fresh, queries will not refetch from the network. `gcTime` defines the duration that inactive data (data with zero mounted component subscribers) remains in memory before being garbage-collected from the cache.

### Implementation
**Q: How do you invalidate all queries related to posts after creating a new post?**  
*Answer:* Use `queryClient.invalidateQueries`:
```typescript
const queryClient = useQueryClient();
await queryClient.invalidateQueries({
  queryKey: ['posts'],
  exact: false, // Invalidates ['posts'], ['posts', 'list'], ['posts', 1], etc.
});
```

### Debugging
**Q: An engineer notices that updating a state filter variable triggers a new fetch, but the component briefly flickers and displays a loading spinner on every filter click. How do you prevent this?**  
*Answer:* Set `placeholderData: keepPreviousData` (formerly `keepPreviousData: true` in v4). This tells TanStack Query to continue displaying the previous query's cached data while the new query is fetching in the background, eliminating layout flickering:
```typescript
useQuery({
  queryKey: ['items', page],
  queryFn: () => fetchItems(page),
  placeholderData: keepPreviousData,
});
```

### Scenario
**Q: You are building an offline-capable mobile web app. How does TanStack Query handle network disconnections and reconnections?**  
*Answer:* TanStack Query automatically listens to the browser's `online` and `offline` events. If a mutation or query fails due to network outage, it pauses the request and automatically resumes or retries the query with exponential backoff the moment the browser fires the `online` event (`refetchOnReconnect: true`).

### Advanced
**Q: Describe the step-by-step lifecycle of an Optimistic Update in TanStack Query.**  
*Answer:*
1. **`onMutate`:** Triggered before the mutation function runs. Cancels in-flight queries (`cancelQueries`), snapshots current cache data (`getQueryData`), and injects synthetic optimistic data into the cache (`setQueryData`).
2. **`mutationFn`:** Executes the network HTTP mutation.
3. **`onError`:** If `mutationFn` throws, it retrieves the snapshot from context and restores the original data (`setQueryData(key, context.previousData)`).
4. **`onSettled`:** Executes regardless of success or failure to trigger `invalidateQueries`, synchronizing the client cache with authoritative server state.

---

## 16. Coding Questions

### Problem: Build an Infinite Scrolling Feed using `useInfiniteQuery`
```typescript
// components/InfiniteFeed.tsx
import { useInfiniteQuery } from '@tanstack/react-query';
import { useInView } from 'react-intersection-observer';
import { useEffect } from 'react';

interface PostPage {
  posts: { id: string; title: string }[];
  nextCursor?: number;
}

async function fetchPostBatch({ pageParam = 0 }): Promise<PostPage> {
  const res = await fetch(`/api/feed?cursor=${pageParam}&limit=10`);
  return res.json();
}

export function InfiniteFeed() {
  const { ref, inView } = useInView();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    status,
  } = useInfiniteQuery({
    queryKey: ['feed'],
    queryFn: fetchPostBatch,
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 1000 * 60 * 5,
  });

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (status === 'pending') return <div>Loading initial feed...</div>;
  if (status === 'error') return <div>Error loading feed</div>;

  return (
    <div className="space-y-4 max-w-xl mx-auto p-4">
      {data?.pages.map((page) =>
        page.posts.map((post) => (
          <div key={post.id} className="p-4 border rounded-lg shadow-sm bg-white">
            <h4 className="font-bold">{post.title}</h4>
          </div>
        ))
      )}

      <div ref={ref} className="py-4 text-center">
        {isFetchingNextPage ? (
          <p className="text-gray-500">Loading more stories...</p>
        ) : hasNextPage ? (
          <p className="text-gray-400">Scroll for more</p>
        ) : (
          <p className="text-gray-400">Reached end of feed</p>
        )}
      </div>
    </div>
  );
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "`useQuery` runs only once when a component mounts."  
  *Truth:* False! By default, `useQuery` automatically re-fetches when the window regains focus, when the network reconnects, when dynamic query key parameters change, or when `invalidateQueries` is called.
- **Trap 2:** "`staleTime` and `gcTime` are synonyms."  
  *Truth:* False. `staleTime` controls when fresh data becomes stale and warrants a background fetch. `gcTime` controls when unused cached data is purged from memory entirely.

---

## 18. Revision Summary
- TanStack Query is an asynchronous server-state caching engine that eliminates manual `useEffect` fetch boilerplate.
- Query Keys are serializable dependency arrays that uniquely identify and deduplicate queries.
- `staleTime` dictates data freshness; `gcTime` dictates garbage collection of unused cache.
- Optimistic updates provide 0ms perceived latency by updating cache in `onMutate` with rollback support in `onError`.
- Always cancel in-flight queries before applying optimistic cache updates.

---

## 19. Quick Reference

```
+------------------------------------+-------------------------------------------+
| TanStack Query Primitive           | Purpose / Configuration                   |
+------------------------------------+-------------------------------------------+
| useQuery({ queryKey, queryFn })    | Declarative read query with deduplication |
| useMutation({ mutationFn, ... })   | Handles create/update/delete mutations    |
| queryClient.invalidateQueries(key) | Marks query stale and re-fetches in bg    |
| queryClient.setQueryData(key, fn)  | Synchronously updates cache data manually |
| placeholderData: keepPreviousData  | Prevents layout flicker during pagination |
| staleTime: Infinity                | Caches data permanently without refetching|
| gcTime: 1000 * 60 * 10             | Keeps unused cache in RAM for 10 minutes  |
+------------------------------------+-------------------------------------------+
```
