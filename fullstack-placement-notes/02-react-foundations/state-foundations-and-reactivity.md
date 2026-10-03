# State Foundations, Reactivity & The Render Lifecycle

## 1. What is it?
In React, **State** is a component's private, persistent memory. Unlike regular local variables that reset every time a function finishes executing, state variables survive across multiple function calls. 

More importantly, state is the core trigger of **Reactivity**: calling a state updater function informs React that data has changed, scheduling a re-render of the component and bringing the on-screen UI into alignment with the new data.

> 🔗 *Prerequisite Knowledge*: To understand why state update functions capture historical variables in their scope, review JavaScript closures in [`javascript-placement-notes/01-core-javascript/closures.md`](../../javascript-placement-notes/01-core-javascript/closures.md).

---

## 2. Why does it exist? Why Can't We Just Use Local Variables?
Consider what happens if you attempt to manage UI state with a regular JavaScript local variable:

```tsx
// ❌ THIS DOES NOT WORK IN REACT:
export function BrokenCounter() {
  let count = 0; // Local variable

  function handleClick() {
    count++; // Variable is mutated in memory!
    console.log("Count is now:", count);
  }

  return <button onClick={handleClick}>Clicked {count} times</button>;
}
```

### Why Local Variables Fail:
1. **Local Variables Don't Persist Across Renders**: When React re-renders a component, it invokes the component function from top to bottom. Every local variable is re-declared and reset to its initial value (`let count = 0`).
2. **Mutations Don't Trigger Re-renders**: Changing a local variable (`count++`) mutates a number in V8 RAM, but **React has no idea that anything changed**! There is no listener or proxy notifying React to re-evaluate the component function and update the browser DOM.

---

## 3. Mental Model: The Snapshot & The Photo Album
💡 **Think of a Component Render as a Single Photo Snapshot:**
- When your component renders, React takes a physical **Polaroid photograph** of your UI for that specific state.
- Inside that photograph, the variable `count` is frozen in time as a static constant (e.g. `count = 0`).
- Calling `setCount(1)` **does NOT change the number inside the current photograph**!
- Instead, calling `setCount(1)` tells React: *"Please take a BRAND-NEW photograph for tomorrow's album where `count = 1`!"*

### The React 3-Step Render Lifecycle: Trigger ──► Render ──► Commit
```
[ STEP 1: TRIGGER ]
  • Initial Mount: Root renders for the first time.
  • State Update: User clicks button; `setCount(prev => prev + 1)` is called.
           │
           ▼
[ STEP 2: RENDER (Pure V8 Calculation) ]
  • React calls your component function: `Counter()`
  • React calculates what the JSX should look like for the new state snapshot.
  • React diffs the new Virtual DOM with the previous Virtual DOM.
  • (Zero pixels on the screen have changed yet!)
           │
           ▼
[ STEP 3: COMMIT (Physical DOM Mutation) ]
  • React applies ONLY the calculated differences to the browser's real DOM.
  • (For initial mount, it runs `appendChild()`; for updates, it mutates specific DOM text nodes).
  • The browser repaints the screen!
```

---

## 4. Basic Example: The `useState` Hook & Snapshot Demonstration

```tsx
// SnapshotDemo.tsx
import React, { useState } from 'react';

export function SnapshotDemo() {
  const [count, setCount] = useState<number>(0);

  const handleClick = () => {
    // ⚠️ THE SNAPSHOT TRAP:
    console.log('Before update:', count); // 0
    setCount(count + 1);
    console.log('Immediately after setCount:', count); // STILL 0!
  };

  return (
    <div>
      <p>Current Count: {count}</p>
      <button onClick={handleClick}>Increment</button>
    </div>
  );
}
```

### Why did `console.log` print `0` instead of `1`?
Inside the current execution frame of `handleClick`, `count` is a constant equal to `0`. `setCount(1)` merely schedules a future render with value `1`. The current function execution frame continues running with the existing snapshot value `0`!

---

## 5. Real Example: Functional State Updaters vs. Direct Values
When multiple updates occur in rapid succession or within asynchronous callbacks, relying on the snapshot value produces bugs. You must use **Functional State Updates**:

```tsx
// BatchingCounter.tsx
import React, { useState } from 'react';

export function BatchingCounter() {
  const [count, setCount] = useState<number>(0);

  // ❌ WRONG: Each call sees the exact same snapshot (count = 0)
  const handleBuggyTripleIncrement = () => {
    setCount(count + 1); // setCount(0 + 1)
    setCount(count + 1); // setCount(0 + 1)
    setCount(count + 1); // setCount(0 + 1)
    // Result after render: count will only be 1, NOT 3!
  };

  // ✅ CORRECT: Passes an updater function to the pending state queue
  const handleReliableTripleIncrement = () => {
    setCount(prev => prev + 1); // Queue: (0) => 1
    setCount(prev => prev + 1); // Queue: (1) => 2
    setCount(prev => prev + 1); // Queue: (2) => 3
    // Result after render: count will correctly be 3!
  };

  return (
    <div>
      <h3>Count: {count}</h3>
      <button onClick={handleBuggyTripleIncrement}>Buggy +3 (Adds 1)</button>
      <button onClick={handleReliableTripleIncrement}>Reliable +3 (Adds 3)</button>
    </div>
  );
}
```

---

## 6. Under the Hood: React 18 Automatic Batching

What is **Batching**?
- If a function updates 3 state variables (`setLoading(false); setUser(data); setError(null);`), re-rendering the component 3 separate times would be disastrous for performance.
- React **groups (batches) multiple state updates into a single re-render** for optimal performance.

### The React 17 vs. React 18 Revolution:
- **In React 17**: State updates were batched **only inside React synthetic event handlers** (like `onClick`). If you updated state inside a `setTimeout`, a native `fetch.then()`, or a native DOM listener, React did **NOT** batch them, causing multiple wasted re-renders!
- **In React 18 (Automatic Batching)**: React batches **all state updates everywhere**, regardless of whether they occur inside promises, `setTimeout`, or asynchronous microtasks!

```tsx
// Inside React 18:
setTimeout(() => {
  setCount(c => c + 1);
  setFlag(f => !f);
  // React 18: Combines these into ONE SINGLE re-render at the end of the microtask!
  // React 17: Would have triggered TWO separate re-renders!
}, 1000);
```

---

## 7. The Golden Rules of Immutable State Updates

In JavaScript, objects and arrays are reference types. React detects state changes using **Referential Equality** (`Object.is(oldState, newState)`). If you mutate an object in place, the memory address does not change, and React skips the render!

### Master Immutable Update Patterns:

```tsx
// 1. Updating Nested Objects:
const [user, setUser] = useState({ name: 'Alice', address: { city: 'Tokyo', zip: 100 } });

// ✅ Use the spread operator at EVERY level of nesting:
setUser(prev => ({
  ...prev,
  address: {
    ...prev.address,
    city: 'Kyoto'
  }
}));

// 2. Adding to an Array:
const [todos, setTodos] = useState(['Task 1']);
setTodos(prev => [...prev, 'Task 2']); // Appends to end

// 3. Removing from an Array:
setTodos(prev => prev.filter((_, index) => index !== targetIndex));

// 4. Updating an Item in an Array:
setTodos(prev => prev.map((todo, idx) => idx === targetIndex ? 'Updated Task' : todo));

// 5. Sorting an Array (Remember: .sort() mutates in place!):
setTodos(prev => [...prev].sort()); // Spread into a new array before sorting!
```

---

## 8. Common Mistakes & Anti-Patterns

### ❌ Mistake 1: Initializing State with a Costly Function Call Directly
```tsx
// ❌ EXPENSIVE PERFORMANCE TRAP:
function ComplexDashboard() {
  // ⚠️ getHeavyDataFromLocalStorage() runs on EVERY SINGLE RE-RENDER!
  const [data, setData] = useState(getHeavyDataFromLocalStorage());
}
```
- **Why it breaks**: Passing `fn()` directly executes the function on every render, even though React only uses the return value on the very first mount!
- **✅ The Fix (Lazy Initial State)**: Pass a function reference (**Initializer Function**):
  ```tsx
  // ✅ The function runs ONLY ONCE during initial mount!
  const [data, setData] = useState(() => getHeavyDataFromLocalStorage());
  ```

### ❌ Mistake 2: Storing Derived State in `useState`
```tsx
// ❌ REDUNDANT STATE ANTI-PATTERN:
const [items, setItems] = useState<Item[]>([]);
const [totalPrice, setTotalPrice] = useState<number>(0); // ⚠️ Redundant!
```
- **Consequence**: You now have two sources of truth that can fall out of sync.
- **✅ The Fix**: Calculate it on the fly during render:
  ```tsx
  const totalPrice = items.reduce((sum, item) => sum + item.price, 0); // Derived!
  ```

---

## 9. Best Practices in Modern Production
1. **Group Related State or Use `useReducer`**: If 3 state variables always change together (e.g. `isLoading`, `data`, `error`), combine them into a single state object `{ status: 'loading' | 'success' | 'error', data: null }`.
2. **Never Mutate State Directly**: Always treat React state as read-only. Consider using libraries like **Immer** if dealing with deeply nested immutable trees.
3. **Keep State Local**: If state is only needed by a single button or modal, do not lift it to the global store.

---

## 10. Performance Considerations: State Colocation
Lifting state to the top of the component tree causes the entire tree below it to re-render whenever state changes.
- **State Colocation Rule**: Push state down as far as possible to the leaves of the tree. If only `<SearchInput />` cares about keystrokes, keep `const [query, setQuery] = useState('')` inside `<SearchInput />`.

---

## 11. Security Considerations: State Injection via URL Deserialization
When syncing state with URL parameters (e.g. `?filter=active`):
- Never assume URL query strings are safe or well-formed.
- Always validate deserialized state using **Zod** schemas before assigning it to `useState` to prevent prototype pollution or invalid application states.

---

## 12. Alternatives: `useState` vs. `useReducer` vs. `useRef`
| Hook | Re-renders Component? | Mutable? | Best Used For |
|---|---|---|---|
| **`useState`** | ✅ **Yes** | ❌ Immutable | Independent, primitive values or simple state transitions. |
| **`useReducer`** | ✅ **Yes** | ❌ Immutable | Complex state objects with multiple sub-values and interdependent actions. |
| **`useRef`** | ❌ **No** | ✅ Mutable | Storing values that persist across renders without triggering a visual re-render (timer IDs, DOM nodes). |

---

## 13. Trade-offs: Granular State vs. Monolithic State Objects
- **Granular State (`const [name, setName] = useState(''); const [age, setAge] = useState(0);`)**:
  - *Pro*: Highly specific; updating `age` does not touch `name`.
  - *Con*: Can result in 10 separate state setters in large forms.
- **Single Object (`const [form, setForm] = useState({ name: '', age: 0 });`)**:
  - *Pro*: Single updater function.
  - *Con*: Must remember to spread `...prev` on every update; modifying one field requires re-creating the entire object reference.

---

## 14. Real-World Usage: Optimistic UI in Chat Applications (Slack / Discord)
When you type a message in Slack and press Enter:
1. Slack immediately updates local React state and adds your message to the screen with a faint gray spinner (**Optimistic Update**).
2. Concurrently, it sends an asynchronous HTTPS POST request to the backend.
3. If the server responds with success (201 Created), Slack updates the message status to "Delivered".
4. If the server fails (500 Error or Network Offline), Slack catches the error in state and marks the message with a red exclamation point: *"Failed to send. Click to retry."*

---

## 15. Placement Interview Questions

### Basic (Intern)
1. **What happens under the hood when you call `useState`?**
   - *Spoken Answer*: "When `useState` is called, React looks up the currently executing component's Fiber node and retrieves its internal linked list of hooks. On initial mount, it allocates a hook object storing the initial state and returns a tuple `[state, dispatch]`. On subsequent re-renders, it ignores the initial value and returns the current memoized state value from the fiber's hook list."

### Conceptual (Junior SDE)
2. **Why does `setCount(count + 1)` called three times in a row only increment the count by 1?**
   - *Spoken Answer*: "Because state updates are queued against the current render's state snapshot. If `count` is `0`, each call evaluates to `setCount(0 + 1)`. All three calls queue the value `1` as the next state. To increment three times sequentially, you must use functional state updates: `setCount(prev => prev + 1)`, which processes the pending update queue sequentially."

### Implementation (SDE-1)
3. **What is Automatic Batching in React 18, and how does it differ from React 17?**
   - *Spoken Answer*: "Batching is when React groups multiple state updates into a single re-render to avoid unnecessary layout calculations. In React 17, batching only occurred inside React's synthetic event handlers. Updates inside promises, `setTimeout`, or native events triggered multiple independent re-renders. In React 18, Automatic Batching applies everywhere by default, grouping updates across all asynchronous contexts into a single render."

### Debugging
4. **You have an array in state: `const [list, setList] = useState([1, 2]);`. A function runs `list.push(3); setList(list);`, but the UI doesn't update. Why?**
   - *Analysis*: React uses `Object.is(oldState, newState)` to determine if a re-render is required. `Array.push()` mutates the existing array in place without changing its memory reference. Because `Object.is(list, list)` is `true`, React bails out of rendering.
   - *Fix*: Pass a new array reference: `setList([...list, 3]);`.

### Scenario-Based
5. **How can you opt out of Automatic Batching in React 18 if you need an urgent DOM update immediately?**
   - *Spoken Answer*: "You can use `ReactDOM.flushSync()`:
     ```tsx
     import { flushSync } from 'react-dom';
     flushSync(() => { setCount(c => c + 1); });
     // React guarantees the DOM is updated synchronously right here!
     ```
     This should be used very sparingly, such as when scrolling a list to an element immediately after adding it."

### Advanced (Tier-1 Product Company)
6. **Explain the internal structure of how React stores hooks on a Fiber node.**
   - *Spoken Answer*: "On each component's Fiber node, there is a property called `memoizedState` which points to the head of a singly-linked list of Hook objects. Each hook object contains:
     - `memoizedState`: The current value (or reducer state).
     - `baseState` and `baseQueue`: Pending update queue.
     - `queue`: Circular linked list of update actions (`dispatch`).
     - `next`: Pointer to the next hook in the component.
     Because hooks are stored in a fixed-order linked list, **hooks can never be called conditionally or inside loops**, as skipping a hook would misalign the pointers on the next render!"

---

## 16. Placement Coding Challenge: Undo / Redo State Hook
Implement a custom React hook `useHistoryState` that manages state with full Undo and Redo capabilities:

```tsx
// useHistoryState.ts
import { useState, useCallback } from 'react';

export function useHistoryState<T>(initialPresent: T) {
  const [past, setPast] = useState<T[]>([]);
  const [present, setPresent] = useState<T>(initialPresent);
  const [future, setFuture] = useState<T[]>([]);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  const undo = useCallback(() => {
    if (!canUndo) return;

    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);

    setPast(newPast);
    setFuture([present, ...future]);
    setPresent(previous);
  }, [canUndo, past, present, future]);

  const redo = useCallback(() => {
    if (!canRedo) return;

    const next = future[0];
    const newFuture = future.slice(1);

    setPast([...past, present]);
    setPresent(next);
    setFuture(newFuture);
  }, [canRedo, past, present, future]);

  const set = useCallback((newPresent: T) => {
    if (newPresent === present) return;
    setPast(prev => [...prev, present]);
    setPresent(newPresent);
    setFuture([]); // Clear future on new action
  }, [present]);

  return { state: present, set, undo, redo, canUndo, canRedo };
}
```

---

## 17. Common Interview Traps
- **Trap**: "Is `setState` completely asynchronous in React?"
  - *Trap Explanation*: In modern React, state updates are not technically asynchronous in the `Promise` sense; rather, they are **scheduled and batched**. React determines when to flush updates based on priority lanes. Furthermore, inside `flushSync()`, state updates execute completely synchronously.
- **Trap**: "Can two separate instances of the same component share state if they use `useState`?"
  - *Trap Explanation*: **Never.** State inside `useState` is completely private and local to that specific component's Fiber instance in the tree. To share state between two instances, state must be lifted to a common parent or moved into an external store (Context / Zustand).

---

## 18. Revision Summary
- Local variables fail because they reset on every render and cannot trigger reactivity.
- **The Snapshot Model**: State variables are constants within a specific render's execution frame.
- **Functional State Updaters (`prev => prev + 1`)** are mandatory when queueing sequential updates.
- **React 18 Automatic Batching** groups all state updates across promises, timeouts, and events into a single render.
- State is **immutable**; always update objects and arrays by creating new references (`...spread`, `map`, `filter`).
- Lazy state initialization (`useState(() => getHeavy())`) prevents expensive computations on every render.

---

## 19. Quick Reference Cheat Sheet
```tsx
// 1. Functional State Updates:
setCount(prev => prev + 1);

// 2. Lazy Initialization:
const [data, setData] = useState(() => calculateHeavyInitialValue());

// 3. Immutable Array Updates:
setList(prev => [...prev, newItem]);              // Add
setList(prev => prev.filter(item => item.id !== id)); // Remove
setList(prev => prev.map(item => item.id === id ? { ...item, done: true } : item)); // Update
```
