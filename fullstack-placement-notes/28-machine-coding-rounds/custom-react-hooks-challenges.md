# Custom React Hooks: Machine Coding Implementation Guide

## 1. What is it?
**Custom React Hooks** are reusable JavaScript/TypeScript functions that encapsulate stateful logic, side effects, and lifecycle interactions by leveraging React's built-in hooks (`useState`, `useEffect`, `useRef`, `useCallback`, `useMemo`). 

In senior frontend and full-stack machine coding rounds, interviewers evaluate whether an engineer can extract complex imperative UI logic—such as browser API bindings, debounce timers, local storage synchronization, outside-click detection, and async data fetching—into clean, modular, composable, and type-safe hooks.

```
       REACT CUSTOM HOOK ARCHITECTURE
       
   ┌─────────────────────────────────────────────────────────────┐
   │ COMPONENT LAYER (Declarative UI)                            │
   │                                                             │
   │   const { data, loading, error } = useFetch('/api/users');  │
   │   const debouncedSearch = useDebounce(searchTerm, 300);     │
   │   const [theme, setTheme] = useLocalStorage('theme', 'dark')│
   │   const prevCount = usePrevious(count);                     │
   │   useOnClickOutside(modalRef, () => setIsOpen(false));      │
   └──────────────────────────────┬──────────────────────────────┘
                                  │
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ HOOKS LAYER (Stateful Logic & Imperative DOM / Browser API) │
   │                                                             │
   │   • useState / useRef (State & mutable instance references) │
   │   • useEffect (Side-effect lifecycle & event listener setup)│
   │   • useCallback / useMemo (Stable identity & memoization)   │
   │   • Cleanups (Tear down listeners, timers, sockets)         │
   └─────────────────────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Before React 16.8, sharing stateful logic between components required complex patterns like **Higher-Order Components (HOCs)** or **Render Props**. These caused:
1. **"Wrapper Hell":** Deeply nested component hierarchies that polluted the React DevTools tree.
2. **Scattered Lifecycle Logic:** A single feature (like window resizing or subscription) had logic fragmented across `componentDidMount`, `componentDidUpdate`, and `componentWillUnmount`.
3. **Difficult Abstraction:** Components had to mix presentation with unrelated DOM event handling.

Custom Hooks allow engineers to bundle related logic and its complete lifecycle into a single isolated, testable unit without introducing extra DOM nodes or component layers.

---

## 3. Mental Model
Think of a Custom Hook as an **Automated Subcontractor**:

```
                       SUBCONTRACTOR ANALOGY
                       
  [ General Contractor Component ]
  "I am responsible for designing and laying out the rooms (Rendering JSX)."
  
  [ Subcontractor: useLocalStorage ]
  "Give me a key and a default value. I will handle parsing JSON, writing to disk,
   catching Safari private-browsing quotas, and syncing across tabs."
   
  [ Subcontractor: useOnClickOutside ]
  "Hand me your wall reference (ref). I will stand guard on the document. The moment
   someone clicks outside your perimeter, I will ring your callback bell."
```

---

## 4. Basic Example: `usePrevious`
Tracks the previous value of a prop or state variable across renders.

```typescript
import { useRef, useEffect } from 'react';

export function usePrevious<T>(value: T): T | undefined {
  // Holds the value across renders without triggering a re-render
  const ref = useRef<T | undefined>(undefined);

  useEffect(() => {
    // Executes AFTER the current render finishes painting!
    ref.current = value;
  }, [value]);

  // Returns the value that was stored during the PREVIOUS render cycle
  return ref.current;
}
```

---

## 5. Real Example: Top 4 Production Machine Coding Hooks

### 1. `useDebounce`
Delays updating a value until a specified delay has elapsed without new changes.

```typescript
import { useState, useEffect } from 'react';

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    // Set up timer to update debounced value
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    // If 'value' or 'delayMs' changes before timeout expires, clear timer!
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
```

### 2. `useLocalStorage` with Cross-Tab Synchronization
Persists state to `window.localStorage` with JSON serialization, error handling, and cross-tab `storage` event synchronization.

```typescript
import { useState, useEffect, useCallback } from 'react';

export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((val: T) => T)) => void] {
  // Read value from localStorage safely (supports SSR & Private Browsing)
  const readValue = useCallback((): T => {
    if (typeof window === 'undefined') {
      return initialValue;
    }

    try {
      const item = window.localStorage.getItem(key);
      return item ? (JSON.parse(item) as T) : initialValue;
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
      return initialValue;
    }
  }, [key, initialValue]);

  const [storedValue, setStoredValue] = useState<T>(readValue);

  // Return a wrapped version of useState's setter that writes to localStorage
  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      if (typeof window === 'undefined') return;

      try {
        const newValue = value instanceof Function ? value(storedValue) : value;
        window.localStorage.setItem(key, JSON.stringify(newValue));
        setStoredValue(newValue);

        // Dispatch a custom event so other hook instances on the SAME tab sync up!
        window.dispatchEvent(new Event('local-storage-sync'));
      } catch (error) {
        console.error(`Error setting localStorage key "${key}":`, error);
      }
    },
    [key, storedValue]
  );

  // Synchronize across multiple browser tabs & same-page instances
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent | Event) => {
      if ('key' in e && e.key !== key) return;
      setStoredValue(readValue());
    };

    window.addEventListener('storage', handleStorageChange);
    window.addEventListener('local-storage-sync', handleStorageChange);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('local-storage-sync', handleStorageChange);
    };
  }, [key, readValue]);

  return [storedValue, setValue];
}
```

### 3. `useOnClickOutside`
Detects clicks or touches outside a referenced DOM element (essential for dropdowns, tooltips, and modals).

```typescript
import { RefObject, useEffect } from 'react';

export function useOnClickOutside<T extends HTMLElement = HTMLElement>(
  ref: RefObject<T | null>,
  handler: (event: MouseEvent | TouchEvent) => void
): void {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      const el = ref?.current;
      // Do nothing if clicking ref's element or descendant elements
      if (!el || el.contains(event.target as Node)) {
        return;
      }
      handler(event);
    };

    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);

    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref, handler]);
}
```

### 4. `useFetch` with AbortController (Race Condition Proof)
Handles data fetching, loading, error states, and automatic cancellation on rapid re-renders or unmounts.

```typescript
import { useState, useEffect } from 'react';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export function useFetch<T = unknown>(url: string, options?: RequestInit): FetchState<T> {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    loading: true,
    error: null
  });

  useEffect(() => {
    // Instantiate AbortController to cancel in-flight requests on dependency change
    const controller = new AbortController();

    async function fetchData() {
      setState(prev => ({ ...prev, loading: true, error: null }));

      try {
        const response = await fetch(url, {
          ...options,
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as T;
        setState({ data, loading: false, error: null });
      } catch (err: any) {
        // Do NOT set error state if aborted intentionally!
        if (err.name !== 'AbortError') {
          setState({ data: null, loading: false, error: err });
        }
      }
    }

    fetchData();

    // Cleanup: Abort fetch if component unmounts or URL changes!
    return () => {
      controller.abort();
    };
  }, [url]);

  return state;
}
```

---

## 6. Under the Hood: React Hook Fiber Internals

```
           REACT FIBER HOOKS LINKED LIST UNDER THE HOOD
           
  FiberNode (MyComponent)
    │
    └── memoizedState ───► Hook 1 [useState: storedValue]
                             │
                             └── next ───► Hook 2 [useCallback: readValue]
                                             │
                                             └── next ───► Hook 3 [useEffect: timer]
                                                             │
                                                             └── next ───► null
```

1. **Hooks are Stored as a Singly-Linked List:**
   On a component's internal `FiberNode`, React stores all hooks sequentially in the `memoizedState` property.
2. **Order of Execution Matters:**
   React matches hook states between renders based **strictly on their invocation order**. This is why hooks can never be placed inside `if` statements, loops, or nested functions (**Rules of Hooks**). If an `if` condition skips a hook, the linked list pointer becomes misaligned, corrupting component state.
3. **Custom Hooks are Inlined into the Fiber:**
   Custom hooks have no separate fiber. All primitive hooks called inside your custom hook are simply appended to the caller component's linked list in the exact order they execute.

---

## 7. Important Rules

1. **Only Call Hooks at the Top Level:** Never call hooks inside loops, conditional blocks, or nested callbacks.
2. **Only Call Hooks from React Functions:** Call custom hooks only from React Function Components or other Custom Hooks.
3. **Always Return Cleanup in Effects:** Always clear timeouts, abort fetch controllers, and remove event listeners.
4. **Name Custom Hooks with `use` Prefix:** The React ESLint plugin relies on the `use` naming convention to enforce Hook rules.

---

## 8. Common Mistakes

```typescript
// ❌ MISTAKE 1: Overlooking closure identity in useOnClickOutside
// If the handler function is declared inline in the parent without useCallback,
// useEffect re-attaches document listeners on EVERY single render!
useOnClickOutside(modalRef, () => setOpen(false)); // Listener re-added every render!
// Fix: Pass ref to latest handler or memoize with useCallback.

// ❌ MISTAKE 2: Forgetting to handle SSR (window undefined) in useLocalStorage
const val = window.localStorage.getItem(key); // CRASHES in Next.js Server Components!

// ❌ MISTAKE 3: Not handling AbortError in fetch hooks
// Calling setState after unmount or on abort triggers uncaught promise rejections.
```

---

## 9. Best Practices
1. **Pass Primitive Dependencies Where Possible:** Instead of passing an entire options object to a hook, pass primitive strings or numbers to avoid triggering unwanted `useEffect` executions.
2. **Support Functional State Updates:** In custom state hooks like `useLocalStorage`, support the `setValue(prev => prev + 1)` signature just like native `useState`.
3. **Dispatch Cross-Tab Events:** Listen to the `window.onstorage` event to ensure multiple tabs of your app stay synchronized without reloading.

---

## 10. Performance Considerations
- **Event Listener Saturation:** Attaching `mousemove` or `scroll` listeners inside hooks can cause layout thrashing. Always throttle or debounce high-frequency events or use `requestAnimationFrame`.
- **Passive Event Listeners:** When attaching touch or wheel listeners inside custom hooks, set `{ passive: true }` to avoid blocking browser scrolling threads.

---

## 11. Security Considerations
- **XSS in LocalStorage Hooks:** Never store sensitive tokens or un-sanitized user strings in `localStorage`. Ensure data parsed from `localStorage` is validated (e.g. using Zod) to prevent malformed JSON injection or prototype pollution.
- **DDoS via Debounce Failure:** Ensure `useDebounce` or `useThrottle` properly cancels pending API requests, preventing rapid keypress events from flooding backend microservices.

---

## 12. Alternatives
1. **Third-Party Libraries:** `react-use`, `usehooks-ts`, or `ahooks`. In production, using battle-tested libraries is common; in machine coding interviews, you must build them from scratch.
2. **React Query / SWR:** For async data fetching, use TanStack Query instead of a custom `useFetch` because it handles caching, deduplication, retry logic, and background revalidation out of the box.

---

## 13. Trade-offs

| Custom Hook Pattern | Advantages | Trade-offs |
|---|---|---|
| **`useDebounce` (Value Based)** | Pure, declarative, simple to pass down | Incurs a small 1-render delay when updating state |
| **`useDebounce` (Callback Based)** | Immediate invocation option, imperatively callable | Requires careful cleanup to prevent stale closures |
| **Custom `useFetch`** | Zero dependencies, tailored to app | Hard to match TanStack Query's memory caching and deduplication |

---

## 14. Real-World Usage
- **E-Commerce Search Bars:** Using `useDebounce` on input elements to trigger autocomplete requests only after 300ms of user typing inactivity.
- **SaaS Modals & Flyouts:** `useOnClickOutside` combined with `useEscapeKey` powers dropdowns, notification menus, and dialogs across platforms like Notion, Slack, and Jira.

---

## 15. Placement Interview Questions

### Basic
1. *What are the two golden Rules of React Hooks?*
   - **Answer:** 
     1. Only call hooks at the top level (never in loops, conditions, or nested functions).
     2. Only call hooks from React function components or custom hooks.

### Conceptual
2. *How does `usePrevious` work when `useEffect` runs after render?*
   - **Answer:** During render, `usePrevious` returns `ref.current`, which holds the value from the *last* render. Then, React paints the screen and executes `useEffect`, which updates `ref.current = value` in preparation for the *next* render cycle.

### Implementation
3. *How do you make `useLocalStorage` synchronize across multiple browser tabs?*
   - **Answer:** Add a listener to `window.addEventListener('storage', callback)`. The browser fires this event across all other open tabs on the same origin whenever `localStorage` is modified.

### Debugging
4. *Why does an asynchronous custom hook crash with "Cannot update state on an unmounted component"?*
   - **Answer:** The hook triggered a `fetch` or `setTimeout` that resolved after the component unmounted. The promise callback called `setState()`. Fix by checking a mounted flag via `useRef` or using an `AbortController` to cancel the operation on cleanup.

### Scenario
5. *Design a `useOnlineStatus` hook that tells the UI when the user loses internet connection.*
   - **Answer:** Return a boolean state initialized to `navigator.onLine`. In `useEffect`, listen to `window.addEventListener('online', () => setOnline(true))` and `'offline'` events, with cleanup removing both listeners.

### Advanced
6. *How does React internally track which component owns a Hook without passing `this`?*
   - **Answer:** React maintains a global internal variable called `ReactCurrentOwner.current` (or currently executing Fiber). Before rendering a component, React sets this pointer to that component's FiberNode. When `useState` or any hook executes, it reads and appends to `currentlyRenderingFiber.memoizedState`.

---

## 16. Coding Questions

### Problem: Implement `useMediaQuery` in TypeScript
Write a production-grade `useMediaQuery` hook that listens to CSS media queries using `window.matchMedia` and updates reactively when the viewport matches/unmatches.

```typescript
import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  // Support SSR by defaulting to false
  const getMatches = (mediaQuery: string): boolean => {
    if (typeof window === 'undefined') {
      return false;
    }
    return window.matchMedia(mediaQuery).matches;
  };

  const [matches, setMatches] = useState<boolean>(() => getMatches(query));

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const matchMedia = window.matchMedia(query);
    
    // Triggered on window resize / orientation change
    const handleChange = () => {
      setMatches(matchMedia.matches);
    };

    // Modern browsers support addEventListener on MediaQueryList
    if (matchMedia.addEventListener) {
      matchMedia.addEventListener('change', handleChange);
    } else {
      // Legacy Safari fallback
      (matchMedia as any).addListener(handleChange);
    }

    // Set initial value in case query changed
    setMatches(matchMedia.matches);

    return () => {
      if (matchMedia.removeEventListener) {
        matchMedia.removeEventListener('change', handleChange);
      } else {
        (matchMedia as any).removeListener(handleChange);
      }
    };
  }, [query]);

  return matches;
}
```

---

## 17. Common Interview Traps
- **Trap 1:** Assuming Custom Hooks share state between components.
  *Reality:* Custom hooks share **stateful logic**, not state values. Every component calling `useLocalStorage('theme')` gets its own independent instance of `useState`.
- **Trap 2:** Omitting dependencies from `useCallback` or `useEffect` inside custom hooks.
  *Reality:* Omitting dependencies causes stale closures where the hook operates on outdated state or props.
- **Trap 3:** Not cleaning up DOM listeners on unmount.
  *Reality:* In machine coding rounds, forgetting to return `() => window.removeEventListener(...)` will instantly fail the interview for memory leak negligence.

---

## 18. Revision Summary
- **Custom Hook:** A function starting with `use` that calls other React hooks to encapsulate reusable stateful logic.
- **`useDebounce`:** Uses `setTimeout` and cleanup `clearTimeout` to delay state propagation.
- **`useLocalStorage`:** Syncs state to disk, handles SSR, and listens to `storage` events for multi-tab sync.
- **`useOnClickOutside`:** Binds `mousedown`/`touchstart` to `document` and checks `ref.current.contains(event.target)`.
- **`useFetch`:** Uses `AbortController` to cancel in-flight HTTP calls and prevent race conditions.

---

## 19. Quick Reference

```
┌─────────────────────────┬───────────────────────────────────────────────┐
│ HOOK                    │ CORE REACT TOOLS & KEY PATTERN                │
├─────────────────────────┼───────────────────────────────────────────────┤
│ usePrevious             │ useRef + useEffect (ref.current = value)      │
│ useDebounce             │ useState + useEffect (clearTimeout in cleanup)│
│ useOnClickOutside       │ useRef + document.addEventListener(mousedown) │
│ useLocalStorage         │ useState + window.onstorage + try/catch JSON  │
│ useFetch                │ useState + useEffect + AbortController.signal │
│ useMediaQuery           │ useState + window.matchMedia + change listener│
└─────────────────────────┴───────────────────────────────────────────────┘
```
