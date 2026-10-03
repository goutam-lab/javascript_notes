# Custom Hooks Architecture & Headless Logic Extraction

## 1. What is it?
A **Custom Hook** is a JavaScript/TypeScript function whose name begins with `use` and that can call other React hooks (`useState`, `useEffect`, `useRef`, `useCallback`, etc.). 

Custom hooks are React's primary mechanism for **extracting and sharing stateful logic** across components without altering component hierarchy or introducing higher-order component wrapper hell. They follow the **Headless UI** philosophy: they manage state, network requests, timers, and browser events, returning raw data and event handlers while leaving 100% of JSX presentation decisions to the consuming component.

> 🔗 *Prerequisite Knowledge*: Custom hooks rely entirely on JavaScript function composition and closures. To review how closures encapsulate state across function calls, revisit [`javascript-placement-notes/01-core-javascript/closures.md`](../../javascript-placement-notes/01-core-javascript/closures.md).

---

## 2. Why does it exist?
Before custom hooks (introduced in React 16.8), sharing stateful logic across components required complex design patterns:
1. **Higher-Order Components (HOCs)**: Wrapping components inside functions (`withRouter(withAuth(Profile))`). This created "Wrapper Hell" in React DevTools, prop collisions, and terrible TypeScript type inference.
2. **Render Props**: Passing a function as a prop or child (`<Mouse render={mouse => <Cat mouse={mouse} />} />`). This resulted in deeply nested, unreadable JSX pyramids.
3. **Duplicated Logic**: Developers often copy-pasted 30 lines of `useEffect` window resize listeners or fetch logic across 10 different components.

**The Custom Hook Solution**: Custom hooks allow you to extract pure reactive behavior into flat, composable functions. Every component calling `useWindowSize()` gets its own completely isolated instance of state.

---

## 3. Mental Model
💡 **Think of it like an External Engine or Power Tool Attached to a Chassis:**
- The **Component** is the car chassis, interior seats, and paint job (**The Visual JSX Presentation**).
- The **Custom Hook** is the modular engine block (**The Mechanical Logic**).
- Two completely different cars (a sporty convertible `<MobileMenu />` and a heavy truck `<DesktopSidebar />`) can install the exact same engine (`useDisclosure()` or `useOnClickOutside()`). 
- When the hook's internal state changes, it steps on the gas and causes the specific car it is installed inside to re-render.
- Installing the same hook in two components **does NOT share state between them**—each car has its own physical engine block in memory.

### Visual Architecture: Headless Extraction
```
┌─────────────────────────────────────────────────────────────┐
│ Custom Hook: useFetch<T>(url)                               │
│  - Internal useState: data, error, isLoading               │
│  - Internal useEffect: abort controller, network fetch      │
│  - Returns: { data, error, isLoading, refetch }             │
└──────────────┬───────────────────────────────┬──────────────┘
               │ Instantiated by               │ Instantiated by
               ▼                               ▼
┌──────────────────────────────┐ ┌──────────────────────────────┐
│ Component A: <UserProfile /> │ │ Component B: <ProductFeed /> │
│  - Consumes: { data: user }  │ │  - Consumes: { data: items } │
│  - Renders: Avatar & Bio JSX │ │  - Renders: Product Grid JSX │
│  - Isolated State Copy A     │ │  - Isolated State Copy B     │
└──────────────────────────────┘ └──────────────────────────────┘
```

---

## 4. Basic Example

Here is a foundational custom hook extracting the browser online/offline status:

```tsx
import { useState, useEffect } from 'react';

export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  });

  useEffect(() => {
    function handleOnline() {
      setIsOnline(true);
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // CRITICAL: Cleanup listeners on unmount
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []); // Run once on mount

  return isOnline;
}

// Consuming Component:
export function StatusIndicator() {
  const isOnline = useOnlineStatus();

  return (
    <div style={{ color: isOnline ? 'green' : 'red' }}>
      {isOnline ? '🟢 Connected to Network' : '🔴 Network Disconnected'}
    </div>
  );
}
```

---

## 5. Real Example: Production-Grade `useDebounce` and `useOnClickOutside`

In real production systems, you need reusable hooks that manage generic types, DOM refs, and memory cleanups without leaking.

### A. Production `useDebounce<T>`
```tsx
import { useState, useEffect } from 'react';

/**
 * Delays updating the debounced value until after the specified delay has elapsed
 * since the last time the input value changed.
 */
export function useDebounce<T>(value: T, delayMs: number = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delayMs);

    // Cancel timer if value or delay changes before delayMs has passed
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);

  return debouncedValue;
}
```

### B. Production `useOnClickOutside`
```tsx
import { useEffect, type RefObject } from 'react';

type EventListener = (event: MouseEvent | TouchEvent) => void;

export function useOnClickOutside<T extends HTMLElement = HTMLElement>(
  ref: RefObject<T | null>,
  handler: EventListener
): void {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      // Do nothing if clicking ref's element or descendent elements
      if (!ref.current || ref.current.contains(target)) {
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

// Real-World Dropdown Component Using Both Hooks:
import { useRef, useState } from 'react';

export function SearchDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 400);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when user clicks anywhere outside
  useOnClickOutside(containerRef, () => setIsOpen(false));

  return (
    <div ref={containerRef} className="search-container">
      <input
        type="text"
        placeholder="Search products..."
        value={query}
        onFocus={() => setIsOpen(true)}
        onChange={(e) => setQuery(e.target.value)}
      />
      {isOpen && (
        <div className="results-dropdown">
          <p>Debounced Searching for: <strong>{debouncedQuery}</strong></p>
        </div>
      )}
    </div>
  );
}
```

---

## 6. Under the Hood: Hook Order & The Fiber Linked List

How does React know which state belongs to which custom hook call?
- React does **NOT** inspect variable names or hook names at runtime.
- Internally, each component Fiber node has a linked list of **Hook Objects**:
  ```
  Fiber.memoizedState ──> [Hook 1: useState] ──> [Hook 2: useEffect] ──> [Hook 3: useRef] ──> null
  ```
- When your component calls a custom hook:
  ```tsx
  function MyComponent() {
    const isOnline = useOnlineStatus(); // Calls useState, useEffect inside
    const [count, setCount] = useState(0);
  }
  ```
- React flattens all internal hook calls into that component's single fiber hook linked list:
  1. `Hook 1`: `useOnlineStatus`'s `useState`
  2. `Hook 2`: `useOnlineStatus`'s `useEffect`
  3. `Hook 3`: `MyComponent`'s `useState(0)`
- This is why **The Rules of Hooks** apply strictly to custom hooks: you cannot call custom hooks conditionally (`if (condition) useMyHook()`), because doing so alters the linked list pointer index between renders, causing React to return the wrong state!

---

## 7. Important Rules

1. **Name Must Start With `use`**: Linter plugins and the React compiler identify custom hooks exclusively by the `use` prefix (e.g., `useFetch`, `useAuth`). If you name a function `fetchData` and call `useState` inside it, ESLint will throw a warning.
2. **Never Call Hooks Conditionally**: Never invoke custom hooks inside `if` statements, loops, or nested functions.
3. **State is Completely Isolated**: Invoking `useCounter()` in 5 different components creates 5 distinct, isolated state objects in memory. Custom hooks share *stateful logic*, not state itself.
4. **Return Tuples vs. Objects**:
   - Return a **tuple** `[value, setValue]` if the hook exposes 1-2 primary values and callers frequently want to rename them (like `useState`).
   - Return an **object** `{ data, error, isLoading, refetch }` if the hook returns 3+ properties, allowing consumers to destructure only what they need.

---

## 8. Common Mistakes

### Mistake 1: Returning unstable object references that trigger downstream effect loops
```tsx
// ❌ BAD: Returns a new object reference on every single render
function useUser(id: string) {
  const [user, setUser] = useState(null);
  
  // mutateUser is recreated on every render!
  const mutateUser = (newData: any) => { /* ... */ };

  return { user, mutateUser };
}

// In Consuming Component:
function Profile({ id }: { id: string }) {
  const { user, mutateUser } = useUser(id);

  useEffect(() => {
    mutateUser({ lastSeen: Date.now() });
  }, [mutateUser]); // 💥 Infinite Render Loop! mutateUser changes every render!
}

// ✅ GOOD: Wrap exposed action functions in useCallback
function useUser(id: string) {
  const [user, setUser] = useState(null);

  const mutateUser = useCallback((newData: any) => {
    setUser(prev => ({ ...prev, ...newData }));
  }, []); // Stable identity

  return { user, mutateUser };
}
```

### Mistake 2: Thinking custom hooks share global state across components
```tsx
// ❌ WRONG EXPECTATION:
function ComponentA() {
  const { count, increment } = useGlobalCounter(); // count = 0
  return <button onClick={increment}>A: {count}</button>;
}

function ComponentB() {
  const { count } = useGlobalCounter(); // count = 0
  return <div>B: {count}</div>;
}
// Clicking button in ComponentA will NOT update ComponentB!
// To share state, combine the custom hook with React Context or Zustand!
```

---

## 9. Best Practices

1. **Keep Hooks Focused (Single Responsibility Principle)**: Create `useLocalStorage` and `useWindowScroll`, not a monolithic `useAppUtilities`.
2. **Accept Options as Configuration Objects**:
   ```tsx
   interface UseFetchOptions {
     autoFetch?: boolean;
     debounceMs?: number;
   }
   function useFetch<T>(url: string, options: UseFetchOptions = {}) { ... }
   ```
3. **Support Cleanup & Abort Controllers**: All network-based custom hooks should accept an `AbortSignal` or instantiate an internal `AbortController` to cancel pending requests on unmount.
4. **Export TypeScript Types**: Always export the return type and options interface alongside the custom hook (`export type UseFetchResult<T> = ...`).

---

## 10. Performance Considerations

1. **Memoize Returned Functions**: Any callback returned from a custom hook (`refetch`, `toggle`, `reset`) should be wrapped in `useCallback` so consumers can pass them to memoized children without breaking `React.memo`.
2. **Memoize Complex Derived Computations**: If the hook calculates derived values, wrap the calculation in `useMemo`.
3. **Avoid Unnecessary State**: If a value can be computed on the fly from input arguments, calculate it during render instead of storing it in `useState` and syncing via `useEffect`.

---

## 11. Security Considerations

1. **XSS via Return Values**: If a custom hook fetches untrusted external strings, ensure consuming components do not inject them via `dangerouslySetInnerHTML`.
2. **Storage Leakage**: If building a `useLocalStorage` hook, never store sensitive unencrypted authentication tokens, passwords, or PII.

---

## 12. Alternatives

| Technique | How It Works | Strengths | Weaknesses |
| :--- | :--- | :--- | :--- |
| **Custom Hooks** | JavaScript functions composing built-in hooks | Direct TypeScript inference, zero JSX wrappers, flat tree | Isolated state (requires Context for global sharing) |
| **Higher-Order Components (HOC)** | Function taking a component and returning an enhanced component | Reusable across class components | Wrapper hell, prop collisions, difficult TS typing |
| **Render Props** | Passing render callback `children={(data) => <UI />}` | Clear data flow | JSX nesting pyramid of doom |
| **Zustand / Redux Hooks** | Global state stores exporting custom selector hooks | Shared singleton state across tree | Requires external library runtime |

---

## 13. Trade-offs

- **Benefit**: Massive reduction in boilerplate code; highly modular testability.
- **Cost**: Can hide complex dependency graphs; an unoptimized `useEffect` inside a deeply nested custom hook can cause subtle infinite re-render loops in consuming components that are difficult to locate.

---

## 14. Real-World Usage

Enterprise applications frequently maintain an internal `@shared/hooks` library containing:
- `useAuth`: Returns current user identity, permissions, and logout handlers.
- `useDebounce` / `useThrottle`: Optimizing search inputs and scroll handlers.
- `useIntersectionObserver`: Powering infinite scroll and lazy image loading.
- `useMediaQuery`: Dynamically responding to CSS breakpoints in JavaScript.
- `useLocalStorage`: Two-way reactive synchronization with `window.localStorage`.

---

## 15. Placement Interview Questions

### Basic
**Q: What is a custom hook in React, and what rule must its name follow?**  
*Answer*: A custom hook is a JavaScript function that uses other built-in React hooks to encapsulate and share reusable stateful logic. Its name must strictly start with the prefix `use` (e.g. `useFetch`, `useAuth`) so that React's linter and compiler can identify it and enforce the Rules of Hooks.

### Conceptual
**Q: If two components call the same custom hook, do they share state?**  
*Answer*: No! Custom hooks share *stateful logic*, not state itself. Each invocation of a custom hook instantiates completely independent hook linked lists in that specific component's Fiber node. To share state, the hook must be backed by a Context Provider or an external store (like Zustand).

### Implementation
**Q: Write a production-ready `usePrevious<T>` hook that returns the value of a prop or state from the previous render.**  
*Answer*:
```tsx
import { useEffect, useRef } from 'react';

export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);

  useEffect(() => {
    ref.current = value; // Updates after the render is committed to the screen
  }, [value]);

  // Returns the value stored during the previous render!
  return ref.current;
}
```

### Debugging
**Q: A developer writes a `useInterval` hook, but the callback function only ever sees the initial state value (`count` is stuck at `0`). What is wrong and how do you fix it?**  
*Answer*: This is a classic **Stale Closure** bug. The `setInterval` callback closes over the initial render's variables and is never updated because the dependency array is empty `[]`. To fix it without resetting the interval timer on every tick, save the latest callback in a mutable `useRef`:
```tsx
export function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef(callback);

  useEffect(() => {
    savedCallback.current = callback; // Keep ref pointing to latest callback
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;
    const id = setInterval(() => savedCallback.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}
```

### Scenario
**Q: How would you test a custom hook in isolation without mounting a dummy UI component?**  
*Answer*: Use the `renderHook` utility from `@testing-library/react`. `renderHook(() => useMyHook())` mounts the hook inside an internal synthetic test harness component and provides `result.current` to inspect returned values, as well as `act(() => { ... })` to trigger actions.

### Advanced
**Q: How does React ensure hook call order is maintained when multiple custom hooks are composed inside each other?**  
*Answer*: Custom hooks do not create new Fiber nodes. When custom hook $A$ calls custom hook $B$, React continues advancing the single linear `memoizedState` pointer on the host component's Fiber node. The entire nested tree of hook calls is flattened into one continuous sequence of Hook objects.

---

## 16. Coding Challenge: Build a Resilient `useFetch` Hook

**Task**: Implement a typed `useFetch<T>` hook that supports:
1. Loading, Error, and Data states.
2. Automatic request cancellation via `AbortController` on unmount or URL change.
3. Manual `refetch` function.

```tsx
import { useState, useEffect, useCallback, useRef } from 'react';

interface FetchState<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
}

interface UseFetchResult<T> extends FetchState<T> {
  refetch: () => void;
}

export function useFetch<T = unknown>(url: string): UseFetchResult<T> {
  const [state, setState] = useState<FetchState<T>>({
    data: null,
    isLoading: true,
    error: null,
  });

  // Track trigger count to support manual refetch
  const [refetchIndex, setRefetchIndex] = useState(0);

  const refetch = useCallback(() => {
    setRefetchIndex((prev) => prev + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;

    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    async function executeFetch() {
      try {
        const response = await fetch(url, { signal });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = (await response.json()) as T;
        setState({ data, isLoading: false, error: null });
      } catch (err: unknown) {
        // Ignore abort cancellations
        if (err instanceof Error && err.name === 'AbortError') {
          return;
        }
        setState({
          data: null,
          isLoading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    }

    executeFetch();

    return () => {
      controller.abort();
    };
  }, [url, refetchIndex]);

  return { ...state, refetch };
}
```

---

## 17. Common Interview Traps

1. **"Does a custom hook run on a separate thread?"**  
   *Trap Response*: Saying yes.  
   *Reality*: Custom hooks execute synchronously on the single browser main thread as part of the normal component render function.
2. **"Can custom hooks call other custom hooks?"**  
   *Trap*: Thinking hooks can only call primitive React hooks (`useState`).  
   *Reality*: Custom hooks can compose arbitrary other custom hooks (`useAuth` can call `useLocalStorage` which calls `useState`).

---

## 18. Revision Summary

- Custom hooks extract **stateful logic**, not state values.
- Name must strictly begin with `use`.
- All hook calls inside custom hooks are flattened into the host component Fiber node's linear linked list.
- Wrap exposed functions in `useCallback` to prevent downstream infinite re-render loops.
- Handle cleanup routines (listeners, timers, `AbortController`) inside returned `useEffect` cleaners.

---

## 19. Quick Reference

```tsx
// Pattern: Headless Custom Hook Skeleton
export function useCustomHook<T>(param: T) {
  const [value, setValue] = useState<T>(param);

  // Stable action handler
  const reset = useCallback(() => setValue(param), [param]);

  // Lifecycle & cleanup
  useEffect(() => {
    // Setup
    return () => { /* Cleanup */ };
  }, []);

  return { value, setValue, reset } as const;
}
```
