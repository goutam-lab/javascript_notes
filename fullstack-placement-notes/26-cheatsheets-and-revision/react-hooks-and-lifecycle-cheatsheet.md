# React Hooks & Lifecycle Cheatsheet & Deep Dive

---

## 1. What is it?

The React Hooks and Lifecycle Cheatsheet is an exhaustive operational reference and deep-dive technical guide covering every built-in React hook across React 16.8 through React 19 (`useState`, `useEffect`, `useContext`, `useReducer`, `useCallback`, `useMemo`, `useRef`, `useLayoutEffect`, `useImperativeHandle`, `useId`, `useTransition`, `useDeferredValue`, `useSyncExternalStore`, `useActionState`, `useOptimistic`, and `use`). It maps legacy class component lifecycles (`componentDidMount`, `componentDidUpdate`, `componentWillUnmount`) to hook primitives, deconstructs the internal **Fiber Hook Linked List** memory architecture, and provides battle-tested debugging patterns for interview success.

```
+-----------------------------------------------------------------------------------+
|                        React Hooks Architectural Taxonomy                         |
+-----------------------------------------------------------------------------------+
| State Primitives:      useState, useReducer, useActionState (React 19)            |
| Side-Effect Engines:   useEffect, useLayoutEffect, useInsertionEffect             |
| Memoization & Perf:    useMemo, useCallback, React.memo                           |
| Concurrent & Async:    useTransition, useDeferredValue, use (Promise/Context)     |
| DOM & Persistence:     useRef, useImperativeHandle                                |
| Architecture & State:  useContext, useSyncExternalStore, useOptimistic             |
+-----------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Before Hooks (React 16.7 and earlier):
1. **Class Component Bloat:** Logic was fragmented across lifecycle methods (`componentDidMount`, `componentDidUpdate`, `componentWillUnmount`). Event subscriptions were initialized in mount, updated in update, and torn down in unmount, leading to duplicate code and synchronization bugs.
2. **"Wrapper Hell" in Reusability:** Sharing stateful logic required complex Higher-Order Components (HOCs) or Render Props, resulting in deeply nested component trees that were difficult to inspect in React DevTools.
3. **`this` Binding Pitfalls:** Class methods required manual `.bind(this)` in constructors or arrow class fields, introducing confusion for developers and preventing optimizing compilers from minifying component code effectively.

---

## 3. Mental Model

To master hooks in interviews, visualize a React component not as an instance, but as a **Pure Function Invocation connected to a Persistent Fiber Linked List**:

```
[ Component Render Execution ]
  |
  +--> Hook Call 1: useState(0)      --> Points to Fiber.memoizedState (Node 1)
  |                                            |
  +--> Hook Call 2: useEffect(fn, []) --> Points to Node 1.next (Node 2)
  |                                            |
  +--> Hook Call 3: useRef(null)     --> Points to Node 2.next (Node 3)
```

* Every time a component renders, React iterates through the linked list of hook records attached to the current `Fiber` node.
* **Why the Rules of Hooks exist:** React matches hook calls to their stored state strictly by **call order index**. If a hook is placed inside an `if` condition or loop, the linked list order breaks, corrupting the state of all subsequent hooks!

---

## 4. Basic Example

### The Canonical Hook Reference Grid

```tsx
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";

export function CanonicalHooksDemo({ userId }: { userId: string }) {
  // 1. Primitive State
  const [count, setCount] = useState<number>(0);

  // 2. Mutable Ref (Does NOT trigger re-render on change)
  const renderCount = useRef<number>(0);
  renderCount.current += 1;

  // 3. Memoized Calculation (Recomputed only when count changes)
  const isEven = useMemo(() => {
    return count % 2 === 0;
  }, [count]);

  // 4. Memoized Callback (Stable function reference across renders)
  const handleIncrement = useCallback(() => {
    setCount((prev) => prev + 1); // Functional update avoids stale closure
  }, []);

  // 5. Synchronizing Side Effect with Cleanup
  useEffect(() => {
    console.log(`User ${userId} subscribed. Count: ${count}`);

    return () => {
      console.log(`Cleanup: User ${userId} unsubscribed.`);
    };
  }, [userId]); // Runs on mount, re-runs when userId changes, cleanup on unmount/change

  return (
    <div>
      <p>Count: {count} ({isEven ? "Even" : "Odd"})</p>
      <p>Renders: {renderCount.current}</p>
      <button onClick={handleIncrement}>Increment</button>
    </div>
  );
}
```

---

## 5. Real Example

### Production Custom Hook: `useDebouncedSearch` with Cancellation & AbortController

```typescript
import { useState, useEffect, useRef } from "react";

interface UseDebouncedSearchResult<T> {
  query: string;
  setQuery: (q: string) => void;
  results: T[];
  isLoading: boolean;
  error: Error | null;
}

export function useDebouncedSearch<T>(
  searchFn: (query: string, signal: AbortSignal) => Promise<T[]>,
  delayMs = 300
): UseDebouncedSearchResult<T> {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Store active searchFn in a ref to avoid re-triggering effect if function identity changes
  const searchFnRef = useRef(searchFn);
  searchFnRef.current = searchFn;

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const abortController = new AbortController();

    const handler = setTimeout(async () => {
      try {
        const data = await searchFnRef.current(query, abortController.signal);
        setResults(data);
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setError(err);
        }
      } finally {
        setIsLoading(false);
      }
    }, delayMs);

    // CLEANUP: Cancels both pending debounce timer and in-flight HTTP request!
    return () => {
      clearTimeout(handler);
      abortController.abort();
    };
  }, [query, delayMs]);

  return { query, setQuery, results, isLoading, error };
}
```

---

## 6. Under the Hood

### The Fiber Hook Data Structure

In React's reconciler (`ReactFiberHooks.js`), each hook is an object stored on `fiber.memoizedState`:

```typescript
type Hook = {
  memoizedState: any;       // Current state value (for useState/useReducer) or cache (for useMemo)
  baseState: any;           // Base state for batched updates
  baseQueue: Update<any> | null;
  queue: UpdateQueue<any> | null; // Circular linked list of pending state updates
  next: Hook | null;        // Pointer to the next hook in the component
};
```

#### Lifecycle Phase Execution Order
1. **Render Phase:** React executes the component function body. `useState`, `useMemo`, and `useCallback` calculate their return values. React produces the new Virtual DOM tree.
2. **Commit Phase (Pre-mutation & Mutation):** React mutates the host DOM (inserts, updates, or deletes real DOM nodes).
3. **Commit Phase (Layout Effects):** React synchronously runs `useLayoutEffect` callbacks. The browser has **not** painted yet; this is where synchronous DOM measurements occur.
4. **Browser Paint:** The browser renders pixels to the screen.
5. **Passive Effects:** React asynchronously flushes `useEffect` callbacks after paint, preventing user interaction blocking.

---

## 7. Important Rules

1. **The Rule of Top-Level Invocations:** Never call hooks inside loops, conditions, or nested functions. Always call hooks at the top level of your React function component before any early `return` statements.
2. **The Rule of React Call Context:** Only call hooks from React function components or custom React hooks (functions whose names start with `use`).
3. **The Rule of Exhaustive Dependencies:** If a variable from component scope (props, state, or derived variables) is referenced inside `useEffect`, `useCallback`, or `useMemo`, it **must** be listed in the dependency array (or passed into a functional updater or ref).
4. **The Rule of Functional State Updates:** When new state depends on previous state, always use `setState((prev) => prev + 1)` instead of `setState(count + 1)` to eliminate stale closure bugs during concurrent updates or batched transitions.

---

## 8. Common Mistakes

### Mistake 1: Stale Closures in `useEffect` and `useCallback`
Referencing state inside a callback or effect without listing it in the dependency array (or using an empty array `[]`). The closure captures the value of state from the initial render pass and never sees subsequent state changes.

### Mistake 2: Using `useEffect` for Derived State
Calculating filtered lists or transformed values inside `useEffect` by calling `setFilteredList(data.filter(...))`. This triggers an unnecessary second render pass. Use `useMemo` or compute the value inline during render: `const filteredList = data.filter(...)`.

### Mistake 3: Infinite Loops with Object Dependencies
Passing an object or array literal into a hook dependency array:
```tsx
useEffect(() => { ... }, [{ userId: 123 }]); // BAD: Object reference is new on EVERY render!
```
The object reference changes on every render pass, causing the effect to execute in an infinite loop.

---

## 9. Best Practices

1. **Primitives in Dependencies:** Pass primitive properties (`user.id`) rather than entire objects (`user`) into dependency arrays to prevent superfluous re-runs.
2. **Separate Independent Concerns:** Never bundle unrelated side-effects into a single massive `useEffect`. Write multiple focused `useEffect` hooks for distinct subscriptions or analytics trackers.
3. **Use `useReducer` for Complex State Machines:** When 3 or more state variables frequently update together (e.g., `isLoading`, `data`, `error`), replace multiple `useState` calls with a single `useReducer`.
4. **Leverage `useRef` for Instance Variables:** Use `useRef` to store values that should persist across renders without triggering a re-render when modified (e.g., timer IDs, animation frame handles, previous prop values).

---

## 10. Performance Considerations

* **Over-Memoization Anti-Pattern:** Wrapping every single primitive function or simple calculation in `useCallback` and `useMemo`. Memoization itself has memory and CPU overhead (allocating dependency arrays and shallow-comparing dependencies on every render). Only memoize when:
  1. Passing callbacks to memoized children (`React.memo`).
  2. The calculation is computationally heavy (sorting 10,000 items).
  3. The value is a dependency of another hook.
* **Concurrent Transitions:** Wrap non-urgent state updates (search filtering, tab switching) in `startTransition(() => setSearch(val))` to keep urgent interactions (typing in input box) responsive at 60 FPS.

---

## 11. Security Considerations

* **XSS via Ref Direct DOM Manipulation:** When using `useRef` to manipulate DOM nodes directly, never use `ref.current.innerHTML = untrustedInput`. Always use `textContent` or sanitize using DOMPurify to prevent Cross-Site Scripting.
* **Memory Leaks via Abandoned Event Listeners:** Always return a cleanup function from `useEffect` when attaching window event listeners (`window.addEventListener('resize', handleResize)`). Failing to do so causes uncollected closures that leak memory.

---

## 12. Alternatives: Complete Hook Cheatsheet Reference

| Hook Name | Signature | When to Use | Lifecycle Equivalent |
| :--- | :--- | :--- | :--- |
| **`useState`** | `const [val, setVal] = useState(init)` | Local reactive component state | `this.state`, `this.setState` |
| **`useReducer`** | `const [state, dispatch] = useReducer(r, init)` | Complex state machines, multi-field updates | Redux-like state management |
| **`useEffect`** | `useEffect(setup, deps)` | Asynchronous side effects (API calls, timers) after paint | `componentDidMount`, `componentDidUpdate`, `componentWillUnmount` |
| **`useLayoutEffect`** | `useLayoutEffect(setup, deps)` | Synchronous DOM measurement *before* paint | `componentDidMount`, `componentDidUpdate` (synchronous) |
| **`useMemo`** | `const val = useMemo(() => calc, deps)` | Caching expensive computational results | Memoized selector |
| **`useCallback`** | `const fn = useCallback(fn, deps)` | Caching function definitions across renders | Class method binding |
| **`useRef`** | `const ref = useRef(init)` | Storing mutable values without re-render or DOM nodes | Instance variable (`this.myVar`) |
| **`useContext`** | `const val = useContext(Context)` | Reading shared context without prop drilling | `static contextType` |
| **`useTransition`** | `const [isPending, startTransition] = useTransition()` | Marking state updates as non-blocking / interruptible | N/A (Concurrent React) |
| **`useDeferredValue`**| `const defVal = useDeferredValue(val)` | Deferring re-renders for a non-urgent value | Debounced value |
| **`useId`** | `const id = useId()` | Generating unique accessible HTML IDs (SSR safe) | N/A |
| **`useSyncExternalStore`**| `useSyncExternalStore(sub, getSnap, getServerSnap)` | Subscribing to external stores (Redux, Zustand) safely | Tear-free concurrent read |

---

## 13. Trade-offs

* **`useEffect` vs `useLayoutEffect`:** `useEffect` runs asynchronously after paint, preventing UI jank; however, if you modify DOM styles inside it, the user sees a visible flicker. `useLayoutEffect` eliminates flicker by running synchronously before paint, but blocks browser rendering until execution completes.
* **`useRef` vs `useState`:** `useRef` updates instantly and synchronously without triggering a re-render (ideal for timers/DOM), but cannot cause the UI to visually reflect the new value. `useState` triggers re-renders and re-computes Virtual DOM, but is asynchronous.

---

## 14. Real-World Usage

* **Redux Toolkit / Zustand:** Replaced custom subscription logic with `useSyncExternalStore` to guarantee concurrent safety without tearing in React 18+.
* **Framer Motion:** Uses `useLayoutEffect` to measure exact element dimensions and coordinates before starting layout animations, preventing visual layout jumps.

---

## 15. Placement Interview Questions

### Basic Level
1. **What are the Rules of Hooks and why do they exist?**
   * *Answer:* Two primary rules:
     1. Only call hooks at the **top level** of a function component (never inside conditions, loops, or nested functions).
     2. Only call hooks from **React functions** (function components or custom hooks).
     * *Why:* React tracks hooks using a sequential linked list on the Fiber node. Hooks do not receive names or keys; React matches state to hook calls purely by the order in which they are invoked. Conditions alter the execution order, mismatching state to subsequent hooks.

2. **What is the difference between `useEffect` with `[]`, with `[dep]`, and with NO dependency array?**
   * *Answer:*
     - `[]` (Empty array): Runs **once** after the initial render (equivalent to `componentDidMount`). Cleanup runs on unmount.
     - `[dep]` (With dependencies): Runs after initial render and re-runs whenever any dependency value changes (by `Object.is` shallow equality).
     - *No dependency array omitted*: Runs after **every single render** pass.

3. **Why does modifying a `useRef` value NOT trigger a component re-render?**
   * *Answer:* A ref is a plain JavaScript object with a mutable `.current` property: `{ current: initialValue }`. React maintains a persistent reference to this exact same object across all renders. Modifying a property on an object does not notify the React reconciler, so no re-render is scheduled.

4. **What is the difference between `useCallback` and `useMemo`?**
   * *Answer:* `useMemo` caches the **result of invoking a function**: `useMemo(() => computeValue(a, b), [a, b])`. `useCallback` caches the **function definition itself**: `useCallback((e) => handleClick(e), [deps])`. In fact, `useCallback(fn, deps)` is syntactic sugar for `useMemo(() => fn, deps)`.

5. **When should you use `useReducer` instead of `useState`?**
   * *Answer:* Use `useReducer` when:
     - You have complex state logic involving multiple sub-values.
     - The next state depends on multiple previous states.
     - Different actions trigger predictable state transitions (state machine pattern).
     - You want to optimize performance by passing a stable `dispatch` function down instead of callbacks.

---

### Conceptual Level
6. **What is a "Stale Closure" in React Hooks and how do you resolve it?**
   * *Answer:* A stale closure occurs when a function (e.g., inside `useEffect`, `useCallback`, or a `setTimeout`) captures a variable from an earlier render pass. If the dependency array is omitted or empty, the function continues to reference the outdated variable indefinitely.
   * *Resolution:*
     1. Add the variable to the hook's dependency array.
     2. Use a functional state update: `setCount((prev) => prev + 1)` instead of `setCount(count + 1)`.
     3. Store the latest value in a mutable `useRef`.

7. **How does `useLayoutEffect` differ from `useEffect` under the hood?**
   * *Answer:*
     - `useLayoutEffect` executes synchronously in the **Commit Phase** immediately after React mutates the DOM, but *before* the browser paints pixels to the screen. It blocks visual paint. Use it strictly for DOM measurements (scroll position, element dimensions) or mutating styles before the user sees them.
     - `useEffect` executes asynchronously in the **Passive Phase** *after* the browser has completed layout and paint. It does not block the UI.

8. **Explain how `useTransition` enables non-blocking UI in React 18/19.**
   * *Answer:* In legacy React, all state updates were urgent; a slow re-render (e.g., rendering a chart with 10,000 nodes) blocked user typing and mouse clicks. `useTransition` allows developers to wrap state updates in `startTransition(() => setSlowState(val))`. React marks this update with a lower priority. If the user types in an input field while the transition is computing, React **interrupts** the transition render, processes the urgent typing update, and resumes or restarts the transition later.

9. **What is `useSyncExternalStore` and why was it introduced in React 18?**
   * *Answer:* In React 18's Concurrent Mode, React can pause and resume rendering across multiple ticks. If a component reads from a mutable store outside React (e.g., Redux, browser `window.innerWidth`) using `useEffect` + `useState`, the store might mutate *midway* through a concurrent render pass. This causes **tearing**: two components on the same screen render different values for the same state. `useSyncExternalStore` guarantees atomic, tear-free reads from external stores.

10. **Explain the new React 19 `use` hook and how it differs from traditional hooks.**
    * *Answer:* The `use` hook reads the value of a resource like a Promise or a Context directly inside render. Unlike all traditional hooks, **`use` can be called conditionally** inside `if` statements and loops! If called with a Promise, it integrates directly with `<Suspense>`, suspending the component until the promise resolves.

---

### Implementation Level
11. **Implement a custom hook `usePrevious` that returns the previous value of a prop or state.**
    * *Answer:*
    ```typescript
    import { useRef, useEffect } from "react";

    export function usePrevious<T>(value: T): T | undefined {
      const ref = useRef<T | undefined>(undefined);

      useEffect(() => {
        ref.current = value; // Updates after render phase finishes
      }, [value]);

      return ref.current; // Returns value from previous render pass
    }
    ```

12. **Implement a custom hook `useOnClickOutside` for closing modal dialogs and dropdowns.**
    * *Answer:*
    ```typescript
    import { useEffect, RefObject } from "react";

    export function useOnClickOutside<T extends HTMLElement>(
      ref: RefObject<T>,
      handler: (event: MouseEvent | TouchEvent) => void
    ) {
      useEffect(() => {
        const listener = (event: MouseEvent | TouchEvent) => {
          const el = ref.current;
          if (!el || el.contains((event.target as Node) || null)) {
            return;
          }
          handler(event);
        };

        document.addEventListener("mousedown", listener);
        document.addEventListener("touchstart", listener);

        return () => {
          document.removeEventListener("mousedown", listener);
          document.removeEventListener("touchstart", listener);
        };
      }, [ref, handler]);
    }
    ```

13. **How do you safely forward a ref and expose imperative methods to a parent component?**
    * *Answer:* Use `forwardRef` paired with `useImperativeHandle`:
    ```tsx
    import React, { forwardRef, useImperativeHandle, useRef } from "react";

    export interface CustomInputHandle {
      focusAndClear: () => void;
    }

    export const CustomInput = forwardRef<CustomInputHandle, {}>((props, ref) => {
      const inputRef = useRef<HTMLInputElement>(null);

      useImperativeHandle(ref, () => ({
        focusAndClear: () => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.value = "";
          }
        },
      }));

      return <input ref={inputRef} type="text" className="border p-2" />;
    });
    ```

14. **How do you implement an auto-reconnecting WebSocket custom hook with exponential backoff?**
    * *Answer:* (See Section 16, Coding Challenge 1).

15. **How do you implement an accessible, unique HTML ID generator using `useId`?**
    * *Answer:*
    ```tsx
    import { useId } from "react";

    export function FormField({ label }: { label: string }) {
      const id = useId();
      return (
        <div>
          <label htmlFor={id}>{label}</label>
          <input id={id} type="text" />
        </div>
      );
    }
    ```

---

### Debugging Level
16. **Why does an effect running `setCount(count + 1)` inside a `setInterval` stop incrementing past 1?**
    * *Answer:* A stale closure bug. The effect was declared with an empty dependency array `[]`. The `setInterval` callback closed over `count = 0` from the first render pass. Every tick, it executes `setCount(0 + 1)`, repeatedly setting state to 1. Solution: Use functional updater `setCount((prev) => prev + 1)` or add `count` to the dependency array (and clear interval on change).

17. **Why does React log `Cannot update a component while rendering a different component`?**
    * *Answer:* A child component called a state updater passed down from a parent *directly inside the child's render body* instead of inside an event handler or `useEffect`:
    ```tsx
    // BUG
    function Child({ onRender }: { onRender: () => void }) {
      onRender(); // Triggers parent setState during child render phase!
      return <div>Child</div>;
    }
    // FIX: Wrap in useEffect
    useEffect(() => { onRender(); }, [onRender]);
    ```

18. **Why does a component re-render even though its props haven't changed and it is wrapped in `React.memo`?**
    * *Answer:* The parent is passing an inline function or object literal as a prop (`onClick={() => doSomething()}` or `style={{ color: 'red' }}`). On every parent render, a brand new function/object reference is allocated in memory. `React.memo` performs shallow equality (`Object.is`) on props; since `oldProp !== newProp`, it re-renders. Solution: Wrap callback in `useCallback` and object in `useMemo`.

19. **Why is `ref.current` null when accessed inside `useEffect`?**
    * *Answer:* If the component conditionally renders the DOM node (`{isOpen && <div ref={myRef}>}`), and `isOpen` was false during initial render, the DOM node was never attached. Alternatively, if attempting to access `ref.current` during the component body (render phase) before React has completed the Commit phase, `ref.current` will still be its initial value (`null`).

20. **Why does an effect with cleanup fire twice immediately on component mount in development?**
    * *Answer:* React 18+ **Strict Mode** in development intentionally mounts, unmounts, and re-mounts every component to help developers identify missing cleanup logic (e.g., uncancelled network requests, uncleared timers, memory leaks). In production builds, effects run only once on mount.

---

### Scenario-Based Questions
21. **Scenario: You are building a live stock-trading ticker that receives 200 price updates per second via WebSocket. React is choking with dropped frames. How do you optimize this using hooks?**
    * *Answer:*
      1. Never call `setPrice(newPrice)` 200 times per second; this forces 200 reconciliation cycles.
      2. Store incoming price ticks in a mutable `useRef`: `priceBufferRef.current = latestTick`.
      3. Throttle state updates using `requestAnimationFrame`: update React state only once per animation frame (max 60 times/sec).
      4. Alternatively, use `useTransition` to mark price list updates as non-urgent so user button clicks remain instant.

22. **Scenario: You need to synchronize form draft data to `localStorage` automatically, but writing to disk on every keystroke causes typing latency. How do you design this custom hook?**
    * *Answer:* Combine `useState` with a debounced `useEffect`:
      - Maintain local state for instant input responsiveness.
      - In `useEffect([draftData])`, set a 500ms `setTimeout` to write to `localStorage`.
      - In the cleanup return function, call `clearTimeout`.
      - On window unmount/refresh (`beforeunload` event), flush the pending draft to `localStorage` immediately.

23. **Scenario: A component tree needs access to a theme, user auth, and localization setting. Prop drilling is messy. How do you design a clean Context architecture without causing unnecessary re-renders of the entire app?**
    * *Answer:* Split monolithic contexts into fine-grained independent contexts (`ThemeContext`, `AuthContext`, `LocaleContext`). Never combine frequently changing state (auth) with static state (theme) in a single context provider. For components that only consume specific slices of context, memoize child components with `React.memo` or use custom hooks that select specific fields.

24. **Scenario: You have an infinite scroll list where users can scroll through 10,000 cards. How do you implement infinite loading using IntersectionObserver and hooks?**
    * *Answer:* Create a `useIntersectionObserver` hook targeting a sentinel `div` placed at the bottom of the list. When `entry.isIntersecting` becomes true and `!isLoading && hasMore`, trigger the fetch callback for the next page. Always unobserve and disconnect the observer in the effect cleanup.

25. **Scenario: You are migrating a complex legacy class component with 500 lines of lifecycle logic to function components. What is your systematic migration strategy?**
    * *Answer:*
      1. Map `this.state` to a single `useReducer` to preserve action-dispatch patterns.
      2. Group related logic from `componentDidMount`, `componentDidUpdate`, and `componentWillUnmount` into focused, dedicated custom hooks (e.g., `useWindowResize`, `useDocumentTitle`).
      3. Replace instance variables (`this.timerId`) with `useRef`.
      4. Wrap child callbacks in `useCallback`.
      5. Validate using Jest / React Testing Library to ensure component behavior is identical.

---

### Advanced Architectural Questions
26. **Explain how React reconciles state updates during a batching event in React 18 (Automatic Batching).**
    * *Answer:* Prior to React 18, React only batched updates inside React synthetic event handlers. Updates inside `setTimeout`, `fetch`, or native promises triggered separate re-renders. In React 18, **Automatic Batching** batches all state updates within the same microtask execution context regardless of where they originate, collapsing multiple `setState` calls into a single render and commit pass.

27. **What is Hook Inversion of Control and how is it used in enterprise component libraries?**
    * *Answer:* Inversion of Control with hooks separates UI rendering from state logic. The library provides a "headless" hook (e.g., `useMenu`, `useTable`, `useCombobox` in Downshift or TanStack Table) that manages keyboard navigation, ARIA attributes, and selection state. The consuming developer provides the JSX UI, spreading the hook's returned getter props (`{...getMenuProps()}`).

28. **How does `useInsertionEffect` work and why is it reserved exclusively for CSS-in-JS libraries?**
    * *Answer:* `useInsertionEffect` fires **before all DOM mutations** and before `useLayoutEffect`. CSS-in-JS libraries (like Emotion, Styled-Components) need to inject `<style>` tags into the DOM before layout effects run so the browser can calculate styles accurately without recalculating styles multiple times during the commit phase.

29. **Explain the internal circular linked list of the Hook Update Queue.**
    * *Answer:* Inside Fiber, `hook.queue.pending` points to the *last* update in a circular linked list. The last update's `.next` pointer points back to the *first* update. This data structure allows React to insert new updates in $O(1)$ constant time (pointing `newUpdate.next = queue.pending.next; queue.pending.next = newUpdate; queue.pending = newUpdate;`) while allowing the reconciler to easily iterate from first to last during render.

30. **What is React Compiler (formerly React Forget) and how will it impact the future of `useMemo` and `useCallback`?**
    * *Answer:* React Compiler is an optimizing auto-memoizing compiler. It analyzes JavaScript and React rules at build time, understanding data flow graphs to automatically insert fine-grained memoization into component bodies. It eliminates the need for developers to manually write `useMemo`, `useCallback`, and `React.memo` to optimize re-renders.

---

## 16. Coding Questions

### Coding Challenge 1: Resilient Reconnecting WebSocket Hook

```typescript
import { useEffect, useRef, useState, useCallback } from "react";

interface UseWebSocketOptions {
  maxRetries?: number;
  baseDelayMs?: number;
}

export function useWebSocket(url: string, options: UseWebSocketOptions = {}) {
  const { maxRetries = 5, baseDelayMs = 1000 } = options;
  const [lastMessage, setLastMessage] = useState<any>(null);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const retriesRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    try {
      const socket = new WebSocket(url);
      wsRef.current = socket;

      socket.onopen = () => {
        setIsConnected(true);
        retriesRef.current = 0;
        console.log("[WebSocket] Connected successfully");
      };

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          setLastMessage(parsed);
        } catch {
          setLastMessage(event.data);
        }
      };

      socket.onclose = () => {
        setIsConnected(false);
        if (retriesRef.current < maxRetries) {
          const delay = baseDelayMs * Math.pow(2, retriesRef.current);
          retriesRef.current += 1;
          console.warn(`[WebSocket] Disconnected. Reconnecting in ${delay}ms...`);
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      socket.onerror = (err) => {
        console.error("[WebSocket] Socket error:", err);
        socket.close();
      };
    } catch (err) {
      console.error("[WebSocket] Connection attempt failed:", err);
    }
  }, [url, maxRetries, baseDelayMs]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnect on deliberate unmount
        wsRef.current.close();
      }
    };
  }, [connect]);

  const sendMessage = useCallback((data: any) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(typeof data === "string" ? data : JSON.stringify(data));
    }
  }, []);

  return { lastMessage, isConnected, sendMessage };
}
```

### Coding Challenge 2: Custom `useInterval` Hook with Dynamic Delay

```typescript
import { useEffect, useRef } from "react";

/**
 * Dan Abramov's canonical declarative interval hook.
 * Avoids stale closures while supporting dynamic pausing/resuming.
 */
export function useInterval(callback: () => void, delayMs: number | null) {
  const savedCallback = useRef(callback);

  // Remember the latest callback if it changes
  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  // Set up the interval
  useEffect(() => {
    if (delayMs === null) return; // Paused

    const tick = () => savedCallback.current();
    const id = setInterval(tick, delayMs);

    return () => clearInterval(id);
  }, [delayMs]);
}
```

---

## 17. Common Interview Traps

* **The Trap:** The interviewer asks: *"Can you call a React hook inside an `if` block if you are 100% sure the condition will NEVER change between renders?"*
  * **How candidates fail:** Saying "Yes, if the condition is static like `if (process.env.NODE_ENV === 'production')`, it's safe."
  * **The Winning Answer:** While static environment checks might technically maintain order in a specific build, it is a direct violation of the **Rules of Hooks**. Linter tools (`eslint-plugin-react-hooks`) will fail CI, and future refactors can easily break order assumptions. Never call hooks conditionally. (Note: The new React 19 `use` hook is the single exception explicitly designed to be called inside conditions).
* **The Trap:** *"Does `useMemo` guarantee that a value will never be recalculated unless dependencies change?"*
  * **How candidates fail:** Saying "Yes, it guarantees memoization."
  * **The Winning Answer:** No! According to React's official documentation, `useMemo` is a **performance hint, not a semantic guarantee**. In low-memory mobile environments or future releases, React reserves the right to "forget" memoized values and recalculate them on the next render. Your code must remain functionally correct even if `useMemo` re-executes.

---

## 18. Revision Summary

```
+-----------------------------------------------------------------------------------+
|                     React Hooks High-Yield Revision Matrix                        |
+-----------------------------------------------------------------------------------+
| Fiber Architecture:  Hooks stored as a singly linked list on fiber.memoizedState   |
| Call Order Matters:  Rules of Hooks guarantee index matching across render passes  |
| Stale Closures:      Fix via functional updates, dependency arrays, or useRef      |
| Passive vs Layout:   useEffect (after paint, non-blocking); useLayout (pre-paint) |
| Concurrent Helpers:  useTransition (non-urgent updates); useDeferredValue         |
| Memoization Rule:    Memoize only when passing to React.memo or for heavy math     |
+-----------------------------------------------------------------------------------+
```

---

## 19. Quick Reference

* **`useState(initial)`:** Reactive state primitive.
* **`useReducer(reducer, init)`:** State machine for complex multi-action state.
* **`useEffect(fn, deps)`:** Side effects after paint; cleanups run before next effect/unmount.
* **`useLayoutEffect(fn, deps)`:** Runs synchronously before paint; use for DOM measurement.
* **`useRef(init)`:** Returns `{ current: val }`; mutates synchronously without re-render.
* **`useMemo(() => val, deps)`:** Caches calculated value between renders.
* **`useCallback(fn, deps)`:** Caches function reference between renders.
* **`useTransition()`:** Breaks long renders into interruptible non-blocking background tasks.
