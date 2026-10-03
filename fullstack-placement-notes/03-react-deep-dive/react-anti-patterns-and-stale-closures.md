# React Anti-Patterns, Stale Closures & Production Pitfalls

## 1. What is it?
A **React Anti-Pattern** is a common coding pattern that seems intuitive or works initially, but introduces severe bugs, subtle race conditions, memory leaks, performance degradation, or stale UI states as an application grows in scale and complexity.

Among all React bugs, the **Stale Closure** is the single most notorious. It occurs when an asynchronous callback, event listener, or timer captures variable values from an earlier render cycle via JavaScript lexical scoping, and continues referencing those outdated "frozen" values long after the component has rendered with newer state.

> 🔗 *Prerequisite Knowledge*: Stale closures are fundamentally rooted in JavaScript lexical scoping and closure retention. Review [`javascript-placement-notes/01-core-javascript/closures.md`](../../javascript-placement-notes/01-core-javascript/closures.md) and [`javascript-placement-notes/04-execution/event-loop.md`](../../javascript-placement-notes/04-execution/event-loop.md).

---

## 2. Why does it exist?
React components are functions that run over and over again on every render.
- Every time a component renders, it has its own private set of props, state, and local variables.
- When an asynchronous callback (such as `setTimeout`, `setInterval`, or an event listener) is registered, it forms a **closure** over the specific variables of *that exact render*.
- If the dependency array is omitted or empty, or if references are not kept up to date, the callback remains trapped in the past. It looks at the world through a snapshot taken minutes ago.

---

## 3. Mental Model: The Stale Photograph
💡 **Think of an Old Printed Polaroid Photograph:**

```
RENDER 1 (Time = 0s)
  State: count = 0
  Callback registered: "Look at the count photo in my pocket and print it."
  The photo in the pocket shows: [ 0 ]

RENDER 2 (Time = 1s, count = 1)
  State: count = 1
  Component has a new photo: [ 1 ]

RENDER 3 (Time = 2s, count = 2)
  State: count = 2
  Component has a new photo: [ 2 ]

TIMER FIRES (Time = 3s)
  The timer runs its original callback!
  It reaches into its pocket, pulls out the Render 1 photo, and prints: "Count is 0"!
  Even though the real world is at 2, the callback is looking at its stale photo!
```

---

## 4. Basic Example: The Stale Closure in `setInterval`

```tsx
import { useState, useEffect } from 'react';

// ❌ BROKEN: The Counter gets stuck at 1!
export function StaleCounter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      // count here is frozen at 0 from Render 1!
      console.log('Timer executing, reading count:', count);
      setCount(count + 1); // 0 + 1 = 1 every second!
    }, 1000);

    return () => clearInterval(timer);
  }, []); // Empty deps: effect only runs once on mount!

  return <h1>Count: {count}</h1>;
}
```

### The Output in Console:
```
Timer executing, reading count: 0 -> setCount(1)
Timer executing, reading count: 0 -> setCount(1)
Timer executing, reading count: 0 -> setCount(1)
```
The UI updates to `1` and remains frozen at `1` forever!

### The Two Solutions:
```tsx
// ✅ FIX 1: Functional State Updater (Does not depend on closed-over count)
setCount((prev) => prev + 1);

// ✅ FIX 2: Ref-based mutable container for arbitrary callbacks
const countRef = useRef(count);
countRef.current = count; // Updated on every render
// Inside timer:
setCount(countRef.current + 1);
```

---

## 5. The Top 6 React Anti-Patterns in Production

### Anti-Pattern 1: Direct State Mutation
```tsx
// ❌ WRONG: Mutates state in-place; React does NOT re-render!
const [todos, setTodos] = useState(['Task 1']);

function addTodo() {
  todos.push('Task 2'); // Direct array mutation!
  setTodos(todos);       // Object.is(todos, todos) === true! React bails out!
}

// ✅ CORRECT: Return a fresh array reference
function addTodo() {
  setTodos((prev) => [...prev, 'Task 2']);
}
```

---

### Anti-Pattern 2: The "Syncing State with Props" Redundancy
Developers often copy props into state, creating dual sources of truth that desynchronize:

```tsx
// ❌ WRONG: Storing derived prop in state and syncing via useEffect
function FullNameDisplay({ firstName, lastName }: { firstName: string; lastName: string }) {
  const [fullName, setFullName] = useState('');

  useEffect(() => {
    // Unnecessary state + unnecessary re-render!
    setFullName(`${firstName} ${lastName}`);
  }, [firstName, lastName]);

  return <div>{fullName}</div>;
}

// ✅ CORRECT: Compute derived values on the fly during render!
function FullNameDisplay({ firstName, lastName }: { firstName: string; lastName: string }) {
  // Free, instant, zero extra re-renders, 100% bug-free!
  const fullName = `${firstName} ${lastName}`;
  return <div>{fullName}</div>;
}
```

---

### Anti-Pattern 3: Lying to the `useEffect` Dependency Array
```tsx
// ❌ DANGEROUS: Omitting dependencies to "prevent re-running"
function SearchBox({ query, onSearch }: { query: string; onSearch: (q: string) => void }) {
  useEffect(() => {
    onSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Lied to React! Will never execute when query changes!
}

// ✅ CORRECT: Honor the dependencies or restructure logic
function SearchBox({ query, onSearch }: { query: string; onSearch: (q: string) => void }) {
  useEffect(() => {
    onSearch(query);
  }, [query, onSearch]);
}
```

---

### Anti-Pattern 4: Defining Components Inside Components
```tsx
// ❌ FATAL ANTI-PATTERN:
function ParentPage() {
  const [text, setText] = useState('');

  // Child component is re-declared on every single render!
  function SearchInput() {
    return <input value={text} onChange={(e) => setText(e.target.value)} />;
  }

  return (
    <div>
      <SearchInput /> {/* Input drops focus after every keystroke! */}
    </div>
  );
}
```

---

### Anti-Pattern 5: Using `useEffect` for User Event Handling
```tsx
// ❌ WRONG: Setting a flag in state just to run an effect
function Form() {
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (submitted) {
      postDataToBackend(); // Should just be called in onSubmit!
    }
  }, [submitted]);

  return <button onClick={() => setSubmitted(true)}>Submit</button>;
}

// ✅ CORRECT: Call action directly inside the event handler!
function Form() {
  function handleSubmit() {
    postDataToBackend();
  }
  return <button onClick={handleSubmit}>Submit</button>;
}
```

---

### Anti-Pattern 6: Missing Effect Cleanup Functions (Memory Leaks)
```tsx
// ❌ MEMORY LEAK: Subscriptions accumulate indefinitely
useEffect(() => {
  window.addEventListener('resize', handleResize);
  // Missing return () => window.removeEventListener('resize', handleResize);
}, []);
```

---

## 6. Under the Hood: Why V8 Closures Cause Memory Leaks

When a closure retains a variable from an outer scope, the V8 JavaScript engine **cannot garbage collect** that scope's context object:
```
[ Component Render Context ]
  ├── massiveDataset = 50MB ArrayBuffer
  └── handleClick() ──> retains 'massiveDataset' in closure scope
```
- If an uncleaned event listener on `window` retains `handleClick`, the entire 50MB `massiveDataset` remains anchored in memory indefinitely, even after the component unmounts!
- Always clean up listeners, timers, web sockets, and abort controllers in the `useEffect` cleanup return function.

---

## 7. Important Rules

1. **If it can be computed from props/state, DO NOT put it in state.**
2. **Never mutate state objects or arrays in-place.**
3. **Always follow the Exhaustive Deps ESLint rule (`eslint-plugin-react-hooks`).**
4. **Use functional state updaters `setVal(v => v + 1)` when new state depends on previous state.**
5. **Always clean up global event listeners, timers, and active network subscriptions.**

---

## 8. Common Mistakes: Stale Closure in Async Fetch

```tsx
// ❌ RACE CONDITION & STALE CLOSURE:
function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    fetch(`/api/users/${userId}`)
      .then(res => res.json())
      .then(data => {
        // If userId changes from 1 to 2 rapidly, Request 1 may finish AFTER Request 2!
        // Stale data from User 1 will overwrite User 2!
        setUser(data);
      });
  }, [userId]);
}

// ✅ CORRECT: Use an ignore flag or AbortController
function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    let ignore = false;

    fetch(`/api/users/${userId}`)
      .then(res => res.json())
      .then(data => {
        if (!ignore) {
          setUser(data);
        }
      });

    return () => {
      ignore = true; // Discard outdated response!
    };
  }, [userId]);
}
```

---

## 9. Best Practices

1. **Store Functions in `useCallback` when passed as dependencies.**
2. **Use `useRef` for values that must be read inside long-lived callbacks without re-triggering effects.**
3. **Use Primitive Dependencies**: Depend on `user.id` (`string`) rather than the entire `user` object (`object`) to prevent unnecessary effect executions.

---

## 10. Performance Considerations

- **Excessive Re-renders from State Syncing**: Using `useEffect` to sync state causes a minimum of **2 renders** for every 1 prop update. Computing directly during render executes in **1 single render**.

---

## 11. Security Considerations

- Direct DOM mutation anti-patterns (e.g. `ref.current.innerHTML = data`) bypass React's built-in XSS escaping mechanisms. Always render data declaratively via JSX.

---

## 12. Alternatives

| Problem | Anti-Pattern | Recommended Solution |
| :--- | :--- | :--- |
| **Filtered Lists** | `useEffect` + `setFilteredList` | `useMemo` or compute inline during render |
| **Prev State in Timer** | `count + 1` in `setInterval` | Functional updater: `setCount(c => c + 1)` |
| **Event Handlers** | `useEffect` on `submitted` flag | Direct invocation inside `onSubmit` |
| **Reset Form on ID Change** | `useEffect` setting all inputs | `key={entityId}` on the form component |

---

## 13. Trade-offs

- **Immutable Data Structures**: Allocates new arrays/objects on updates (minor GC cost), but grants $O(1)$ reference equality checking for React reconciliation.

---

## 14. Real-World Usage

Identifying and refactoring these anti-patterns is a primary responsibility of Senior Engineers (SDE-2 / Staff):
- Auditing memory leaks using Chrome DevTools Heap Snapshots.
- Fixing race conditions in search autocomplete bars.
- Eliminating re-render storms across high-traffic enterprise portals.

---

## 15. Placement Interview Questions

### Basic
**Q: What is a stale closure in React?**  
*Answer*: A stale closure occurs when a callback function (such as in `useEffect`, `setTimeout`, or an event listener) captures state or prop variables from an earlier render cycle and retains those outdated values, failing to reflect the latest state updates because its enclosing scope or dependency array was not refreshed.

### Conceptual
**Q: Why is syncing state from props using `useEffect` considered an anti-pattern?**  
*Answer*: It introduces redundant state, creates dual sources of truth that can get out of sync, and degrades performance by forcing a mandatory second render cycle (Render 1: component renders with old state; Effect runs and calls `setState`; Render 2: component re-renders with new state). Instead, the value should be computed directly during the initial render.

### Implementation
**Q: How do you solve the stale closure problem in an event listener without constantly adding and removing the listener from the DOM?**  
*Answer*: Use the **Latest Ref Pattern**:
```tsx
const latestHandler = useRef(handler);
latestHandler.current = handler; // Updated every render

useEffect(() => {
  const listener = (e) => latestHandler.current(e);
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}, []); // Attached once on mount, but always calls latest handler!
```

### Debugging
**Q: A developer uses `array.push()` inside `useState` and calls the setter, but the component fails to re-render. Why?**  
*Answer*: React uses `Object.is()` to determine if state has changed. Because `array.push()` mutates the existing array in-place, the memory reference of the array remains identical (`Object.is(oldArray, newArray) === true`). React assumes nothing changed and bails out of rendering. To fix it, create a new array: `setArray([...prev, item])`.

### Scenario
**Q: A user types quickly in a search input. The server responses return out-of-order, causing old search results to overwrite newer search results. How do you resolve this race condition?**  
*Answer*: Use an active/cancelled flag or an `AbortController` in the `useEffect`:
```tsx
useEffect(() => {
  const controller = new AbortController();
  fetch(`/api/search?q=${query}`, { signal: controller.signal })
    .then(res => res.json())
    .then(data => setResults(data))
    .catch(err => { if (err.name !== 'AbortError') handleError(err); });

  return () => controller.abort(); // Cancels previous pending request on next keystroke!
}, [query]);
```

### Advanced
**Q: Why does resetting state using `key={id}` perform better than resetting state inside a `useEffect`?**  
*Answer*: Using `useEffect` to reset form fields requires the component to render once with the *previous* user's stale data, execute the effect on the commit phase, trigger a state update, and re-render a second time with empty values. Changing the `key` prop informs React's reconciliation engine that the element identity has changed; React unmounts the old instance and mounts a fresh instance with pristine initial state in a **single render pass**, eliminating layout flicker and stale data leaks.

---

## 16. Coding Question: Fix the Broken Custom `useDebounceCallback`

**Task**: Identify the stale closure bug in this broken debounce hook and implement the corrected production version.

```typescript
// ❌ BROKEN HOOK (Suffers from Stale Closures):
function useBrokenDebounce(callback: Function, delay: number) {
  return useCallback((...args: any[]) => {
    setTimeout(() => {
      callback(...args); // Closes over stale callback!
    }, delay);
  }, [delay]); // Missing callback in deps or proper ref management!
}

// ✅ CORRECT PRODUCTION IMPLEMENTATION:
import { useRef, useEffect, useMemo } from 'react';

export function useDebounceCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): (...args: Parameters<T>) => void {
  const callbackRef = useRef<T>(callback);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Keep callbackRef pointing to latest function reference on every render
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return useMemo(() => {
    return (...args: Parameters<T>) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        callbackRef.current(...args); // Always invokes the fresh function!
      }, delay);
    };
  }, [delay]);
}
```

---

## 17. Common Interview Traps

1. **"Can an empty dependency array `[]` ever cause bugs?"**  
   *Trap*: Saying empty arrays are always safe for initialization.  
   *Reality*: An empty array `[]` is the #1 cause of stale closures in React! If the effect reads props or state without including them or using functional updaters, it will read stale data forever.
2. **"Does `useMemo` prevent all re-renders?"**  
   *Trap*: Believing `useMemo` stops a component from re-rendering.  
   *Reality*: `useMemo` only caches the **result of a calculation** between renders. The component itself still executes whenever its state or parent changes.

---

## 18. Revision Summary

- **Stale Closure**: Functions capturing variables from older render scopes. Fix with functional updaters `setVal(v => v + 1)` or `useRef`.
- **Never mutate state**: Always return new object/array copies (`[...prev, item]`).
- **Do not sync state with props**: Compute derived values directly during render.
- **Never define components inside other components**: Causes input focus loss and unmounts.
- **Always return cleanup functions** from effects to prevent memory leaks and race conditions.

---

## 19. Quick Reference

```
┌─────────────────────────────────┬────────────────────────────────────────────┐
│ Anti-Pattern                    │ Solution                                   │
├─────────────────────────────────┼────────────────────────────────────────────┤
│ `state.push(val)`               │ `setState(prev => [...prev, val])`         │
│ `useEffect` to sync props/state │ Compute inline: `const full = first + last`│
│ Stale `setInterval` count       │ `setCount(c => c + 1)`                     │
│ Lying to deps `[]`              │ Include all read variables or use refs     │
│ Child defined in parent body    │ Move child declaration to module scope     │
│ Component reset via effect      │ Pass distinct `<Component key={id} />`     │
└─────────────────────────────────┴────────────────────────────────────────────┘
```
