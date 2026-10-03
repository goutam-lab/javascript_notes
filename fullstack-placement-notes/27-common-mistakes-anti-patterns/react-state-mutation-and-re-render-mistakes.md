# React State Mutation & Re-Render Anti-Patterns Deep Dive

---

## 1. What is it?

React State Mutation and Re-Render Anti-Patterns represent the most pervasive and destructive class of frontend bugs in modern React applications. These include **direct state mutation** (modifying objects or arrays in-place instead of creating immutable copies), **missing or index-based `key` prop bugs** in dynamic lists, **infinite render loops** (invoking state setters during the render phase or via un-memoized object dependencies in effects), and **redundant derived state duplication**. Understanding these failure modes at the level of the **React Fiber reconciler** and **`Object.is` shallow equality comparisons** is a foundational requirement in technical placement interviews.

```
+-----------------------------------------------------------------------------------+
|                     React State & Re-render Failure Spectrum                      |
+-----------------------------------------------------------------------------------+
| 1. Direct In-Place Mutation: state.push(item) -> Object.is(prev, next) === true   |
|                              -> Reconciler bails out -> UI does NOT update!       |
| 2. Index as Key Anti-Pattern: key={index} on dynamic list -> Component state leaks|
|                              to wrong item on delete/insert -> DOM corruptions    |
| 3. Infinite Render Loop:      setState() in render body -> schedules render ->    |
|                              renders -> setState() -> Maximum update depth limit  |
| 4. Syncing Props to State:    useState(prop) -> Prop updates -> State does NOT     |
|                              sync -> Stale UI & out-of-sync state bugs            |
+-----------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

These anti-patterns emerge from a fundamental mismatch between JavaScript's mutable, reference-based nature and React's declarative, functional state model:
1. **JavaScript References vs Value Equality:** In JavaScript, modifying `user.name = "Bob"` mutates the object in place. The pointer memory address does not change. Because React uses `Object.is` shallow reference comparison to determine if a component needs to re-render, modifying an object in-place signals to React that "nothing changed", silently suppressing UI updates.
2. **Component Lifecycle vs Function Execution:** Junior developers treat function component bodies like script files, forgetting that the function executes repeatedly on every state change. Calling a state setter unconditionally inside the function body inevitably causes an infinite execution loop.
3. **Reconciliation Identification:** React requires a stable, unique identifier (`key`) to track which item in an array maps to which virtual DOM Fiber node. Using array indexes destroys identity when items are reordered, inserted, or deleted.

---

## 3. Mental Model

To eliminate state mutation bugs forever, visualize React's reconciliation engine as an **Immutability Diff Inspector**:

```
[ PREVIOUS STATE MEMORY ]
  Memory Address: 0x001A
  Value: { id: 1, name: "Alice", tags: ["admin"] }

                                  |
               +------------------+------------------+
               |                                     |
               v (Direct Mutation - ANTI-PATTERN)    v (Immutable Copy - BEST PRACTICE)
  user.name = "Bob";                    setUser({ ...user, name: "Bob" });
  Memory Address: 0x001A (STILL SAME!)  Memory Address: 0x009F (NEW POINTER!)
  React Check: Object.is(0x001A, 0x001A) React Check: Object.is(0x001A, 0x009F)
  Result: TRUE -> NO RE-RENDER!        Result: FALSE -> TRIGGER FIBER DIFF!
```

---

## 4. Basic Example

### Direct Mutation vs Immutable State Update

```tsx
// ❌ ANTI-PATTERN: Direct In-Place Mutation
function BuggyTodoList() {
  const [todos, setTodos] = useState(["Buy milk", "Walk dog"]);

  const handleAdd = () => {
    // BUG: Modifies array in place! Pointer address does not change!
    todos.push("Read book");
    setTodos(todos); // React sees prev === next (same reference) and BAILS OUT!
  };

  return <button onClick={handleAdd}>Add Todo</button>;
}

// ✅ BEST PRACTICE: Immutable State Update with Spread Syntax
function CleanTodoList() {
  const [todos, setTodos] = useState(["Buy milk", "Walk dog"]);

  const handleAdd = () => {
    // Creates a brand new array reference in memory
    setTodos((prev) => [...prev, "Read book"]);
  };

  return <button onClick={handleAdd}>Add Todo</button>;
}
```

---

## 5. Real Example

### The "Index as Key" Destruction Pattern & Safe Key Management

```tsx
// ❌ ANTI-PATTERN: Using Array Index as Key
// Deleting the first item causes the remaining items to retain the wrong internal state!
function BuggyList({ items }: { items: { id: string; text: string }[] }) {
  return (
    <ul>
      {items.map((item, index) => (
        // BUG: When item 0 is deleted, item 1 inherits index 0!
        // Uncontrolled inputs or internal state will NOT shift, corrupting user input!
        <TodoItem key={index} item={item} />
      ))}
    </ul>
  );
}

// ✅ BEST PRACTICE: Stable Unique Domain Identifier
function RobustList({ items }: { items: { id: string; text: string }[] }) {
  return (
    <ul>
      {items.map((item) => (
        // Unique and stable ID guarantees exact Fiber preservation across reorders
        <TodoItem key={item.id} item={item} />
      ))}
    </ul>
  );
}
```

---

## 6. Under the Hood

### How React Bails Out via `Object.is` in `ReactFiberHooks.js`

Inside React's core reconciler, when `dispatchSetState` is invoked, React executes an eager bailout check:

```javascript
function dispatchSetState(fiber, queue, action) {
  const update = { action, next: null };
  const currentState = queue.lastRenderedState;
  
  // Calculate eager next state
  const eagerState = typeof action === 'function' ? action(currentState) : action;

  // React checks if state actually changed!
  if (Object.is(eagerState, currentState)) {
    // BAILOUT: Fast-path return! 
    // React avoids scheduling work on the Fiber tree entirely!
    return;
  }

  // Schedule render work on the Fiber node...
  scheduleUpdateOnFiber(fiber);
}
```

If you mutate an object in place (`obj.name = "new"`), `eagerState === currentState` evaluates to `true`. React immediately halts and exits without updating the DOM!

---

## 7. Important Rules

1. **The Rule of Immutable Updates:** Never mutate state directly. Always create shallow or deep copies using array spreads (`[...arr]`), object spreads (`{ ...obj }`), or utility libraries like Immer (`produce(state, draft => { draft.x = 1; })`).
2. **The Rule of Stable Keys:** A `key` must be **unique among siblings** and **stable across renders**. Never generate keys randomly during render (`key={Math.random()}`); this forces React to destroy and recreate the DOM node on every render, wiping out focus and local state.
3. **The Rule of No `setState` in Render:** Never call a state setter function directly within the component render body. State setters must live inside event handlers (`onClick`) or inside `useEffect`.
4. **The Rule of Functional Updates:** If the next state depends on the previous state, always pass an updater function: `setCount((prev) => prev + 1)` instead of `setCount(count + 1)`.

---

## 8. Common Mistakes

### Mistake 1: Deep Nested Object Mutation
```tsx
// BUG: Nested object reference is NOT copied!
const [user, setUser] = useState({ name: "Alex", settings: { theme: "dark" } });

// ANTI-PATTERN:
user.settings.theme = "light";
setUser({ ...user }); // user is new, but user.settings is STILL THE SAME REFERENCE!

// FIX: Deep copy nested objects
setUser((prev) => ({
  ...prev,
  settings: { ...prev.settings, theme: "light" },
}));
```

### Mistake 2: Mirroring Props into State (Derived State)
```tsx
// ANTI-PATTERN: Redundant state that falls out of sync
function UserCard({ name }: { name: string }) {
  const [currentName, setCurrentName] = useState(name); // Never updates when `name` prop changes!
  return <div>{currentName}</div>;
}

// FIX: Calculate derived state directly during render
function UserCard({ name }: { name: string }) {
  return <div>{name}</div>;
}
```

### Mistake 3: Object Literal in `useEffect` Dependency Array Causing Infinite Loop
```tsx
function Component() {
  const [data, setData] = useState<any>(null);
  
  // BUG: options is allocated as a BRAND NEW object pointer on EVERY render pass!
  const options = { limit: 10 };

  useEffect(() => {
    fetchData(options).then(setData);
  }, [options]); // Infinite render loop!
}
```

---

## 9. Best Practices

1. **Use Immer for Complex Nested Trees:** For objects with 3+ levels of nesting, use Immer (`useImmer` hook):
   ```tsx
   updateUser((draft) => {
     draft.profile.address.city = "New York";
   });
   ```
2. **Keys from Domain Entities:** Always use unique IDs from the database (`item.id`, `item.uuid`). If items lack IDs and cannot be reordered, use a persistent mapping hash.
3. **Primitive Dependencies in Effects:** In `useEffect`, pass primitive values (`options.limit`) instead of object literals (`options`) to preserve reference stability.
4. **Strict Mode in Development:** Always run apps inside `<React.StrictMode>`. Strict Mode intentionally invokes component render bodies twice in development to uncover unexpected side-effects and impure mutations.

---

## 10. Performance Considerations

* **Over-Splitting State vs Unnecessary Renders:** If 5 state variables always change together, grouping them into a single `useReducer` or object state prevents 5 separate state declarations and coordinates batched updates.
* **Component Splitting to Isolate Renders:** If a text input triggers state updates on every keystroke, extract the input into its own child component so the heavy parent tree does not re-render on every character typed.

---

## 11. Security Considerations

* **State Injection via Deserialization:** When hydrating initial state from server-rendered HTML (`window.__INITIAL_STATE__`), ensure the data is sanitized against Cross-Site Scripting (XSS). Attackers can inject malicious closing script tags (`</script><script>alert(1)</script>`) into JSON strings embedded in HTML.

---

## 12. Alternatives: State Management Comparison

| Strategy | Mutability | Re-render Control | Best Use Case |
| :--- | :--- | :--- | :--- |
| **`useState` / `useReducer`** | Immutable | Component-level reconciliation | Local, isolated UI state |
| **Immer (`produce`)** | Proxied (feels mutable) | Pure immutable output | Deeply nested state updates |
| **Zustand** | Immutable | Selector-based fine-grained re-renders | Global cross-component state |
| **Jotai / Recoil** | Atomic | Atom-level subscriber re-renders | Fine-grained independent widget state |
| **MobX** | Observable / Mutable | Automatic transparent tracking | Teams preferring reactive OOP patterns |

---

## 13. Trade-offs

* **Spread Operator Overhead vs Deep Cloning:** Shallow spreads (`{ ...obj }`) are fast ($O(1)$ memory copies of root properties), but do not protect nested child objects. Deep cloning (`structuredClone()`) protects against all nested mutations, but is computationally expensive ($O(N)$) on large objects.
* **Component Isolation vs Prop Drilling:** Isolating interactive leaves into separate components prevents parent re-renders, but increases file count and prop passing complexity.

---

## 14. Real-World Usage

* **Trello / Asana Kanban Boards:** Moving cards across columns requires updating both the source and target column arrays immutably. Mutating the array in place causes drag-and-drop animations to glitch and drop cards into duplicate slots.
* **Figma Web Canvas:** Avoids traditional React state for high-frequency cursor coordinates; uses `useRef` and direct Canvas/WebGL rendering to bypass React reconciler overhead entirely.

---

## 15. Placement Interview Questions

### Basic Level
1. **Why does mutating state directly in React fail to update the user interface?**
   * *Answer:* React's reconciler relies on shallow reference equality (`Object.is`) to detect state changes. When you mutate an object or array in place (`arr.push(1)`), the memory reference pointer remains identical. React compares `Object.is(prevState, nextState)`, determines that no change occurred, and bails out of scheduling a re-render.

2. **Why is using the array index as a `key` considered an anti-pattern in dynamic lists?**
   * *Answer:* React uses the `key` to identify which DOM element corresponds to which item in the Fiber tree. If you delete or insert an item in an array using index keys, every item after the modification point receives a **new index**. React erroneously reuses existing DOM elements and state for different items, causing input values, checkboxes, and CSS animations to stay with the wrong items.

3. **What causes a `Maximum update depth exceeded` error in React?**
   * *Answer:* Calling a state updater (`setState()`) unconditionally inside the render phase of a component. The component renders, calls `setState()`, which schedules a re-render, which immediately calls `setState()` again in an infinite loop. React detects this runaway recursion and halts execution after 50 iterations to prevent browser freeze.

4. **What is the difference between `useState(expensiveCalculation())` and `useState(() => expensiveCalculation())`?**
   * *Answer:*
     - `useState(expensiveCalculation())`: The expensive function executes on **every single render pass**, even though React only uses the returned value during the initial mount.
     - `useState(() => expensiveCalculation())`: **Lazy State Initialization**. The function executes **only once during initial component mount**, saving CPU on subsequent renders.

5. **Why does React batch state updates?**
   * *Answer:* Batching combines multiple `setState()` calls into a single render pass, avoiding intermediate re-renders and boosting performance. In React 18+, **Automatic Batching** batches updates inside promises, timeouts, and native event handlers as well as synthetic React events.

---

### Conceptual Level
6. **Explain the difference between a Component Re-render and a DOM Repaint.**
   * *Answer:*
     - *Re-render:* React executes the component function body, re-evaluates hooks, and produces a new Virtual DOM tree. This happens purely in JavaScript memory and is relatively fast.
     - *DOM Repaint / Reflow:* If the new Virtual DOM differs from the previous one (Reconciliation), React commits changes to the real browser DOM. The browser recalculates layout geometry and repaints pixels on the screen (computationally expensive). A re-render does *not* necessarily mean a real DOM repaint occurs if the Virtual DOM diff is empty!

7. **How does `React.memo` work and when does it fail to prevent re-renders?**
   * *Answer:* `React.memo` wraps a component and performs shallow equality comparison on incoming props (`prevProps === nextProps`). It fails to prevent re-renders if the parent passes **new function references** (inline arrow functions or un-memoized callbacks) or **new object/array references** on every render, because shallow comparison evaluates `{}` !== `{}`.

8. **What is the "Stale State in Closures" problem and how does the functional updater pattern solve it?**
   * *Answer:* When `setState(count + 1)` is called inside an asynchronous callback (e.g., `setTimeout`), it captures the value of `count` from the render pass when the closure was created. If multiple updates occur before the callback fires, subsequent updates overwrite each other. The functional updater `setState(prev => prev + 1)` receives the freshest, pending state value directly from React's internal queue, ensuring accurate updates.

9. **Explain why passing a new object literal to a Context Provider causes unnecessary re-renders of all consumers.**
   * *Answer:*
     ```tsx
     <MyContext.Provider value={{ user, theme }}> {/* BUG: New object on every render! */}
     ```
     Even if `user` and `theme` have not changed, allocating `{ user, theme }` inline creates a new memory pointer. All components consuming `MyContext` will re-render on every parent update.
     *Fix:* Wrap the value in `useMemo`: `const value = useMemo(() => ({ user, theme }), [user, theme]);`.

10. **What is the difference between Controlled and Uncontrolled components in React?**
    * *Answer:*
      - *Controlled Component:* Form data is driven by React state (`value={state}` and `onChange={e => setState(e.target.value)}`). React is the single source of truth.
      - *Uncontrolled Component:* Form data is handled directly by the browser DOM itself. Values are retrieved on-demand using a `useRef` pointing to the input element (`ref.current.value`).

---

### Implementation Level
11. **Refactor a buggy nested array mutation into a clean immutable update.**
    * *Answer:*
    ```typescript
    interface Todo { id: string; text: string; completed: boolean; }

    // Task: Toggle completion of todo with targetId immutably
    export function toggleTodo(todos: Todo[], targetId: string): Todo[] {
      return todos.map((todo) =>
        todo.id === targetId ? { ...todo, completed: !todo.completed } : todo
      );
    }
    ```

12. **Implement an immutable matrix / 2D-array cell updater.**
    * *Answer:*
    ```typescript
    export function updateMatrixCell(
      matrix: number[][],
      rowIdx: number,
      colIdx: number,
      newValue: number
    ): number[][] {
      return matrix.map((row, r) =>
        r === rowIdx
          ? row.map((cell, c) => (c === colIdx ? newValue : cell))
          : row
      );
    }
    ```

13. **How do you safely reset local state when a key prop changes?**
    * *Answer:* Use the `key` prop on the component itself:
    ```tsx
    // When selectedUserId changes, React treats UserEditor as a brand new component,
    // automatically unmounting the old instance and resetting all internal state!
    <UserEditor key={selectedUserId} userId={selectedUserId} />
    ```

14. **Write a custom hook `useForceUpdate` to force a component re-render without state variables.**
    * *Answer:*
    ```typescript
    import { useReducer } from "react";

    export function useForceUpdate(): () => void {
      const [, dispatch] = useReducer((x: number) => x + 1, 0);
      return dispatch;
    }
    ```

15. **How do you create an immutable state updater helper without external libraries?**
    * *Answer:*
    ```typescript
    export function updateNested<T extends object, K extends keyof T>(
      obj: T,
      key: K,
      updater: (val: T[K]) => T[K]
    ): T {
      return {
        ...obj,
        [key]: updater(obj[key]),
      };
    }
    ```

---

### Debugging Level
16. **Why does an input field lose keyboard focus on every character typed?**
    * *Answer:* The input component was **defined inside the render body of another component**:
    ```tsx
    function Parent() {
      // BUG: SubComponent gets a brand new type definition on every parent render!
      const SubInput = () => <input />;
      return <SubInput />;
    }
    ```
    On every keystroke, `Parent` re-renders, creating a new function reference for `SubInput`. React's reconciler sees a different component type, unmounts the old input, mounts a brand new input, and destroys DOM focus.
    *Fix:* Move `SubInput` outside the `Parent` component.

17. **Why does a component re-render twice on every state update in development?**
    * *Answer:* The app is wrapped in `<React.StrictMode>`. In development mode, StrictMode intentionally double-invokes function components, `useState` initializers, and reducers to help developers detect accidental side-effects and impure mutations. In production builds, components render only once.

18. **Why does `console.log(count)` immediately after `setCount(count + 1)` print the old value?**
    * *Answer:* `setCount` is **asynchronous** and schedules an update; it does not mutate the `count` variable in the current execution scope. The current function execution continues with its local closure variable `count`. The updated value will only be visible in the *next* render pass.

19. **Why did deleting the first item from a list cause a checkbox in the bottom item to uncheck?**
    * *Answer:* The list was rendered using array indexes as keys (`key={index}`). When the first item was deleted, React matched the remaining items by their new indexes (Item 1 became Index 0, etc.). React reconciled the DOM elements by index, preserving the local checkbox state on the wrong data rows.

20. **Why did an effect trigger an infinite loop even though the state variable had the same numeric value?**
    * *Answer:* The state was set to an object or array: `setData({ count: 5 })`. Even though `5` is identical, every call allocates a new object reference (`0x001` vs `0x002`). The effect's dependency comparison `Object.is(prev, next)` evaluated to `false`, repeatedly triggering the effect and setting state.

---

### Scenario-Based Questions
21. **Scenario: A user is rapidly typing in a search input that filters a list of 5,000 table rows. The typing feels sluggish and drops frames. How do you resolve this without external libraries?**
    * *Answer:*
      1. Separate the urgent state (input text) from the non-urgent state (filtered table list).
      2. Use **`useTransition`** (React 18):
      ```tsx
      const [input, setInput] = useState("");
      const [filteredList, setFilteredList] = useState(allRows);
      const [isPending, startTransition] = useTransition();

      const handleChange = (e) => {
        setInput(e.target.value); // Urgent: updates input immediately
        startTransition(() => {
          setFilteredList(filterRows(e.target.value)); // Non-urgent: interruptible
        });
      };
      ```
      Typing remains instant at 60 FPS while the table filter renders in the background.

22. **Scenario: You have a form with 20 input fields. Updating one input field re-renders all 20 fields. How do you optimize this?**
    * *Answer:*
      - Option A: Use **Uncontrolled Components** via `useRef` or React Hook Form, eliminating state re-renders during keystrokes and reading values only on form submit.
      - Option B: Wrap individual input fields in `React.memo` and pass stable `useCallback` change handlers or dispatch actions.

23. **Scenario: You need to implement an Undo/Redo feature for a collaborative drawing app. How do you design the state structure?**
    * *Answer:*
      Use a 3-stack state structure:
      ```typescript
      interface HistoryState<T> {
        past: T[];
        present: T;
        future: T[];
      }
      ```
      - On mutation: push current `present` to `past`, set new `present`, clear `future`.
      - On Undo: pop from `past`, set as `present`, push old `present` to `future`.
      - On Redo: pop from `future`, set as `present`, push old `present` to `past`.
      - Guarantee all elements in `past` and `future` are **deeply immutable snapshots**.

24. **Scenario: You have an e-commerce shopping cart where items can have quantity updates, voucher applications, and tax calculations. Where should tax calculation live?**
    * *Answer:*
      Tax calculation should **never be stored in separate state**! Storing `taxAmount` in state creates derived state synchronization bugs. Calculate tax as a **derived value during render**:
      ```tsx
      const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
      const tax = useMemo(() => calculateTax(subtotal, userState), [subtotal, userState]);
      ```

25. **Scenario: A dashboard has a live timer ticking every second, alongside an expensive data visualization chart. The timer causes the chart to re-render every second. How do you fix this?**
    * *Answer:*
      - **Push the timer down into its own isolated component**:
        Extract `<Timer />` into a standalone leaf component with its own `useState` and `useEffect`.
      - The parent dashboard and the heavy chart will **not re-render** when the timer ticks!

---

### Advanced Architectural Questions
26. **Explain React's Bailout Mechanism in `beginWork`.**
    * *Answer:* During reconciliation, React visits each Fiber node in `beginWork`. If a node has `oldProps === newProps` and `!hasScheduledWork(fiber)`, React executes the **bailoutOnAlreadyFinishedWork** path. It skips rendering the current Fiber node and its entire subtree, returning `fiber.child` directly and saving massive CPU time.

27. **How does Automatic Batching work across microtask boundaries in React 18?**
    * *Answer:* In React 17, state updates inside `setTimeout` or `Promise.then` were not batched. In React 18, React schedules updates by pushing them to an internal update queue associated with the Fiber root. React defers rendering to the end of the current microtask tick using `queueMicrotask`. When the microtask executes, all pending updates across that tick are collapsed into a single reconciliation pass.

28. **What is Component "Tearing" in Concurrent React?**
    * *Answer:* Tearing occurs when a component reads from an external mutable store outside React during a concurrent, interruptible render pass. If the store mutates *midway* through rendering, some components render with the old store value while others render with the new store value on the same screen. Solved in React 18 by **`useSyncExternalStore`**, which detects store mutations during concurrent renders and forces a synchronous re-render.

29. **Explain the difference between Identity Preservation and Structural Sharing.**
    * *Answer:*
      - *Identity Preservation:* Preserving the exact same object reference (`oldObj === newObj`) so downstream consumers can skip re-computations via shallow comparison.
      - *Structural Sharing:* When an immutable tree is modified, unchanged branches retain their exact original object references, while only the modified node and its ancestors allocate new object references. Enables fast $O(1)$ equality checks on unchanged subtrees.

30. **What is the React Compiler (React Forget) and how does it eliminate manual memoization?**
    * *Answer:* React Compiler is an optimizing build-time compiler that parses JavaScript AST and analyzes data flow graphs. It automatically inserts fine-grained memoization (caching values and function references) into compiled component code. It eliminates the need for developers to manually write `useMemo`, `useCallback`, and `React.memo` by guaranteeing structural sharing and identity preservation automatically.

---

## 16. Coding Questions

### Coding Challenge 1: Deep Immutable State Updater with Path Traversal

```typescript
/**
 * Immutably updates a deeply nested property in an object given a dot-separated path.
 * e.g., setDeep(user, 'profile.address.city', 'London')
 */
export function setDeep<T extends Record<string, any>>(
  obj: T,
  path: string,
  value: any
): T {
  const keys = path.split(".");
  const [head, ...tail] = keys;

  if (keys.length === 1) {
    return { ...obj, [head]: value };
  }

  return {
    ...obj,
    [head]: setDeep(obj[head] || {}, tail.join("."), value),
  };
}
```

### Coding Challenge 2: Pure Immutable List Shuffler (Fisher-Yates)

```typescript
/**
 * Immutably shuffles an array using the Fisher-Yates algorithm.
 * Guarantees original input array is NOT mutated.
 */
export function shuffleImmutable<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
}
```

---

## 17. Common Interview Traps

* **The Trap:** The interviewer asks: *"Does calling `setState(newValue)` always trigger a component re-render in React?"*
  * **How candidates fail:** Saying "Yes, calling setState always triggers a re-render."
  * **The Winning Answer:** **No!** If `Object.is(newValue, currentState)` evaluates to `true` (e.g., passing the exact same primitive number or the same mutated object reference), React's reconciler executes an **eager bailout** and bails out without scheduling or executing a re-render.
* **The Trap:** *"Can you use `Math.random()` or `Date.now()` as a key in a React list if items don't have IDs?"*
  * **How candidates fail:** Saying "Yes, it guarantees every key is unique."
  * **The Winning Answer:** **No! That is even worse than using array index!** A random key changes on *every single render pass*. React interprets this as every item being destroyed and replaced with a brand new component, causing all DOM nodes to be unmounted and remounted, wiping input focus, breaking animations, and destroying performance.

---

## 18. Revision Summary

```
+-----------------------------------------------------------------------------------+
|               React State & Re-render High-Yield Revision Matrix                  |
+-----------------------------------------------------------------------------------+
| Immutability:        Direct mutation keeps pointer same -> Object.is bails out     |
| List Keys:           Must be unique and stable; NEVER index or Math.random()      |
| Infinite Loop:       Never call setState in render body; wrap in handlers/effects  |
| Derived State:       Never duplicate props to state; compute inline during render  |
| Lazy Init:           useState(() => heavyCalc()) runs only once on initial mount  |
| Context Perf:        useMemo the context value object to prevent consumer churn    |
| Transitions:         useTransition marks updates interruptible for 60 FPS typing   |
+-----------------------------------------------------------------------------------+
```

---

## 19. Quick Reference

* **`Object.is(a, b)`:** React's shallow comparison algorithm for state updates and props.
* **Functional State:** `setState(prev => next)` eliminates stale closure bugs.
* **`key` Prop:** Stable identifier for React Fiber reconciliation tracking.
* **Lazy State:** `useState(() => init())` executes only on mount.
* **`useTransition`:** Defers non-urgent state updates to keep UI responsive.
* **Derived State:** State that can be computed from props/state should not be stored.
