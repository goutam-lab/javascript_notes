# React Fiber Architecture & The Two-Phase Lifecycle

## 1. What is it?
**React Fiber** is the complete internal reimplementation of React's core reconciliation algorithm, released in React 16. At its core, Fiber transforms React from a recursive, synchronous rendering engine into a **cooperative, priority-based, interruptible scheduler**.

A **Fiber** is a plain JavaScript object that represents a unit of work and a node in the component tree. It holds the component's type, DOM node, props, state, effect flags, and pointers to its `child`, `sibling`, and `return` (parent) nodes.

Fiber enables React to break heavy rendering work into small incremental chunks, pause execution to allow high-priority browser events (like typing or clicks) to run on the main thread, and resume or abort rendering later without dropping frames.

---

## 2. Why does it exist? The Failure of the Stack Reconciler
Prior to React 16, React used the **Stack Reconciler**:
- **Synchronous Recursion**: When state changed at the root, React recursively called `render()` down the entire component tree using the native JavaScript Call Stack.
- **The Frame Drop Problem**: The browser must produce a frame every **16.6ms** (for 60Hz displays) or **8.3ms** (for 120Hz displays). If a deep component tree took 100ms to reconcile synchronously, the Call Stack was completely blocked:
  ```
  [ JavaScript Call Stack Rendering 100ms ] ──────> [ Browser UI Frozen! ]
  ▲ User clicks button or types text          ▲ Dropped frames, lag, jank!
  ```
- Once the Stack Reconciler started, **it could not be stopped or paused**.
- **The Fiber Solution**: Convert the recursive call stack into a **virtual call stack on the heap** using a linked-list structure. This allows React to execute work in a `while (workInProgress !== null && !shouldYield())` loop, yielding control back to the browser when the 5ms frame deadline is reached.

---

## 3. Mental Model: Double Buffering & The Work Loop
💡 **Think of it like 3D Video Game Graphics (Double Buffering):**

```
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│          CURRENT TREE           │       │      WORK-IN-PROGRESS TREE      │
│     (Displayed on Monitor)      │       │     (Built Off-Screen in RAM)   │
│                                 │       │                                 │
│  RootFiber                      │       │  WorkInProgress RootFiber       │
│    │ child                      │       │    │ child                      │
│    ▼                            │       │    ▼                            │
│  [ App ] (Currently visible)   │       │  [ App ] (Being calculated)     │
└────────────────┬────────────────┘       └────────────────┬────────────────┘
                 │                                         │
                 │              COMMIT PHASE               │
                 └─────────── Pointer Swap ────────────────┘
                     current = workInProgress (Instant!)
```

- In game engines, if you draw a frame directly onto the screen line by line, the player sees screen tearing. Instead, the game renders the next frame into an **off-screen back buffer**. Once the frame is 100% finished, it instantly swaps pointers so the back buffer becomes the visible front buffer.
- React Fiber does the exact same thing:
  - **`Current` Tree**: Represents the UI currently painted on the user's screen.
  - **`WorkInProgress` (WIP) Tree**: Represents the new UI being constructed and diffed in memory.
  - If a render is aborted or interrupted by higher priority user input, React simply discards the WIP tree without ever touching the real screen.

---

## 4. The Fiber Node Data Structure

Every element in your React app has a corresponding Fiber object in memory:

```typescript
interface Fiber {
  // 1. Tag identifying component category (Function, Class, HostComponent like 'div')
  tag: WorkTag; 
  
  // 2. Element identity
  key: null | string;
  elementType: any;
  type: any; // e.g. 'div' or function UserProfile()
  stateNode: any; // Reference to real DOM node or class instance

  // 3. Singly linked list tree structure
  return: Fiber | null;  // Pointer to Parent Fiber
  child: Fiber | null;   // Pointer to First Child Fiber
  sibling: Fiber | null; // Pointer to Next Sibling Fiber
  index: number;

  // 4. Props and State memory
  pendingProps: any;     // Incoming props to be processed
  memoizedProps: any;    // Props used to create the last committed output
  memoizedState: any;    // Linked list of hooks (useState, useEffect, etc.)

  // 5. Effect Tracking (What needs to happen to the DOM)
  flags: Flags;          // Bitwise mask: Placement | Update | Deletion
  subtreeFlags: Flags;   // Bitwise mask of all child flags

  // 6. Double Buffering pointer
  alternate: Fiber | null; // Points to its twin in Current / WIP tree

  // 7. Priority and Scheduling (React 18 Lanes)
  lanes: Lanes;          // Priority level of scheduled updates
  childLanes: Lanes;
}
```

---

## 5. The Two Major Phases of Fiber Execution

React Fiber strictly separates rendering into two distinct phases with opposite characteristics:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. RENDER PHASE (Reconciliation)                                            │
│  - Characteristics: ASYNCHRONOUS, COOPERATIVE, CAN BE PAUSED / ABORTED     │
│  - Action: Invokes component functions, diffs children, computes flags.    │
│  - DOM: NEVER TOUCHES THE REAL DOM! Zero DOM mutations occur here.         │
│  - Methods: Function component body, useMemo, useState updater logic.       │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Work Finished
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. COMMIT PHASE (DOM Mutation)                                              │
│  - Characteristics: SYNCHRONOUS, UNINTERRUPTIBLE                            │
│  - Action: Mutates the real DOM, invokes layout effects, swaps pointers.   │
│  - Sub-phases:                                                              │
│    a. Before Mutation (getSnapshotBeforeUpdate)                             │
│    b. Mutation Phase (appendChild, removeChild, update DOM node props)     │
│    c. Pointer Swap (fiberRoot.current = workInProgress)                      │
│    d. Layout Phase (useLayoutEffect executed synchronously)                 │
│    e. Passive Effects Phase (useEffect scheduled and executed async)        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 6. Under the Hood: The Fiber Work Loop

How does Fiber pause and resume? Through the internal cooperative scheduler loop:

```javascript
// Simplified conceptual representation of React's Work Loop
function workLoopConcurrent() {
  // Perform work on the current Fiber node until time runs out
  while (workInProgress !== null && !shouldYieldToHost()) {
    performUnitOfWork(workInProgress);
  }
}

function performUnitOfWork(unitOfWork) {
  const current = unitOfWork.alternate;
  
  // Step A: BeginWork - process current fiber and return its first child
  let next = beginWork(current, unitOfWork, renderLanes);
  unitOfWork.memoizedProps = unitOfWork.pendingProps;

  if (next === null) {
    // Step B: No children left; bubble back up via siblings and parent
    completeUnitOfWork(unitOfWork);
  } else {
    workInProgress = next;
  }
}
```

### Traversal Order: Depth-First Search via Pointers
1. **Down**: Follows `child` pointer as deep as possible (`beginWork`).
2. **Right**: When a leaf node has no children, call `completeWork`, then look for a `sibling`.
3. **Up**: If no sibling exists, return to the parent via `return` pointer and complete the parent.

---

## 7. Important Rules

1. **Render Phase Must Be Pure**: Because the Render Phase can be paused, aborted, or restarted multiple times (especially under Concurrent Mode or StrictMode), **component bodies must have zero side effects**! Never write to `localStorage`, trigger HTTP mutations, or attach global DOM listeners directly inside a component's render body.
2. **Side Effects Belong Exclusively in Effects**: Mutating the external world must happen in `useEffect` or `useLayoutEffect`, which run strictly in the Commit Phase.
3. **Commit Phase Cannot Be Interrupted**: Once React enters the Commit Phase, it must finish synchronously to ensure the user never sees a half-updated, broken UI on the screen.

---

## 8. Common Mistakes

### Mistake 1: Placing side effects in the render phase
```tsx
// ❌ DANGEROUS MISTAKE:
let analyticsCounter = 0;

function CheckoutButton() {
  // Render phase side-effect!
  analyticsCounter++; // Runs 2x in StrictMode! Runs multiple times if render yields!
  fetch('/api/analytics', { method: 'POST' }); // Sends duplicate network calls!

  return <button>Buy Now</button>;
}

// ✅ CORRECT: Place side effects in useEffect or event handlers
function CheckoutButton() {
  useEffect(() => {
    fetch('/api/analytics', { method: 'POST' });
  }, []);

  return <button>Buy Now</button>;
}
```

---

## 9. Best Practices

1. **Keep Component Functions Lean**: Because React evaluates component bodies during the Render Phase, avoid heavy synchronous computations ($O(N^2)$ loops) inside the render body unless wrapped in `useMemo`.
2. **Leverage StrictMode**: Always wrap your root in `<React.StrictMode>`. StrictMode intentionally executes the Render Phase twice in development to uncover impure side effects.
3. **Favor `useEffect` over `useLayoutEffect`**: `useLayoutEffect` runs synchronously before the browser paints the screen, blocking visual frame updates. Only use it when calculating DOM measurements to prevent visual flickers.

---

## 10. Performance Considerations

- **Lanes Priority Architecture**: React 18 uses a 31-bit integer bitmask called **Lanes** to assign priority:
  - `SyncLane`: Discrete user input (typing in an `<input>`, clicking a button).
  - `TransitionLane`: Non-urgent UI transitions (filtering a massive table, switching tabs).
  - `IdleLane`: Off-screen work, prefetching.
- If a low-priority transition is underway and the user types a character, Fiber immediately interrupts the transition, runs the high-priority `SyncLane` update, and then restarts the transition.

---

## 11. Security Considerations

- Fiber nodes retain references to host DOM elements and component instances. Avoid leaking Fiber node references into the global `window` object in production builds, as attackers could inspect internal state.

---

## 12. Alternatives

| Architecture | Framework | Scheduling Strategy |
| :--- | :--- | :--- |
| **Fiber (Linked List Tree)** | React 16+ | Cooperative time-sliced scheduling on the heap |
| **Stack Reconciler** | React 15 (Old) | Synchronous call stack recursion (blocking) |
| **Reactive Graph** | SolidJS / Svelte | No scheduler needed; fine-grained signal subscriptions update DOM directly |

---

## 13. Trade-offs

- **Benefit**: Smooth 60/120fps interactions; prevents UI freezing during massive data updates; powers Suspense and Transitions.
- **Cost**: Complex internal codebase; increased memory overhead per DOM node (storing Fiber properties and alternate twin pointers).

---

## 14. Real-World Usage

Fiber enables modern features like:
- **`useTransition`**: Marking state changes as interruptible.
- **Selective Hydration**: Streaming SSR where interactive components hydrate first while slow components stream in.
- **Offscreen Rendering** (`<Activity>` API): Pre-rendering background tabs at low priority.

---

## 15. Placement Interview Questions

### Basic
**Q: What is React Fiber and why was it introduced?**  
*Answer*: React Fiber is the complete rewrite of React's reconciliation engine introduced in React 16. It was created to solve the limitations of the previous Stack Reconciler, which reconciled component trees synchronously via recursive call stack calls, blocking the browser's main thread and causing UI jank. Fiber introduces a linked-list data structure that allows React to pause, prioritize, abort, and resume rendering work incrementally without dropping frames.

### Conceptual
**Q: Explain the concept of Double Buffering in React Fiber.**  
*Answer*: Double Buffering is a technique borrowed from computer graphics. React maintains two trees simultaneously in memory: the **Current Tree** (reflecting what is currently painted on the screen) and the **WorkInProgress (WIP) Tree** (reflecting the new state being computed off-screen). React builds and diffs the WIP tree without touching the DOM. Once all work is complete, React executes the Commit Phase and performs an instant pointer swap (`fiberRoot.current = workInProgress`), making the WIP tree the new Current tree.

### Implementation
**Q: What are the pointers that connect Fiber nodes to form a tree structure?**  
*Answer*: Instead of storing an array of children (`children: []`), Fiber uses three singly linked list pointers:
1. `child`: Points to its first immediate child node.
2. `sibling`: Points to its immediate right-hand sibling node.
3. `return`: Points back to its parent Fiber node (the node to which work returns upon completion).

### Debugging
**Q: Why does a component's render body execute twice in development mode under React 18, and what does this test?**  
*Answer*: `<React.StrictMode>` intentionally mounts, unmounts, and re-mounts components, running the Render Phase twice in development. This is designed to detect impure side-effects (e.g., mutating global variables, uncleaned subscriptions, or improper state initializations). Because Fiber's Render Phase can be paused and restarted in production under Concurrent React, any code in the render body that produces side effects will cause race conditions and data corruption.

### Scenario
**Q: A heavy dashboard takes 300ms to calculate new charts upon clicking a tab, making the browser feel sluggish. How does Fiber architecture help solve this using modern React APIs?**  
*Answer*: We wrap the tab state update in `startTransition(() => setActiveTab(newTab))`. Fiber assigns this update a low-priority `TransitionLane`. If the user clicks elsewhere or types while the dashboard is rendering, Fiber immediately pauses the 300ms chart calculation, processes the urgent click/typing update on the main thread, and then resumes rendering the chart in the background.

### Advanced
**Q: What is the exact difference between `useLayoutEffect` and `useEffect` regarding the Fiber Commit Phase?**  
*Answer*: Both hooks run during or immediately after the Commit Phase, but at different sub-phases:
- `useLayoutEffect` runs **synchronously** during the Layout sub-phase of the Commit Phase, *after* React has mutated the real DOM nodes but *before* the browser has painted pixels to the screen. It blocks visual paint.
- `useEffect` is scheduled during the Commit Phase but runs **asynchronously (passively)** *after* the browser has finished painting the screen, ensuring that non-visual side effects (data fetching, logging) never block frame rendering.

---

## 16. Coding Challenge: Visualize Fiber Linked-List Traversal

**Task**: Write a JavaScript function that takes a Fiber-like node structure (`child`, `sibling`, `return`) and logs the nodes in the exact order React's `beginWork` and `completeWork` would visit them (Depth-First Search without recursion).

```typescript
interface MockFiber {
  name: string;
  child: MockFiber | null;
  sibling: MockFiber | null;
  return: MockFiber | null;
}

export function traverseFiberTree(root: MockFiber): void {
  let current: MockFiber | null = root;

  while (current !== null) {
    // 1. Begin Work (Going down)
    console.log(`beginWork: ${current.name}`);

    if (current.child !== null) {
      current = current.child;
      continue;
    }

    // 2. Complete Work (Leaf node reached; move right or up)
    while (current !== null) {
      console.log(`completeWork: ${current.name}`);

      if (current.sibling !== null) {
        current = current.sibling;
        break; // Break inner loop to beginWork on sibling
      }

      current = current.return; // Bubble up to parent
    }
  }
}
```

---

## 17. Common Interview Traps

1. **"Fiber replaces the Virtual DOM."**  
   *Trap*: Thinking Fiber is an alternative to the Virtual DOM.  
   *Reality*: Fiber **is** the Virtual DOM implementation in modern React! A Fiber tree is React's internal Virtual DOM data structure.
2. **"DOM nodes are updated during `beginWork`."**  
   *Trap*: Confusing Render and Commit phases.  
   *Reality*: The Render phase (`beginWork` and `completeWork`) calculates flags and diffs. Zero DOM mutations occur until the Commit phase begins.

---

## 18. Revision Summary

- Fiber replaces the recursive synchronous Stack Reconciler with an interruptible linked-list work loop.
- Fiber nodes form a tree using `child`, `sibling`, and `return` pointers.
- Uses **Double Buffering**: `current` (visible) vs `workInProgress` (in-memory draft).
- **Render Phase**: Async, interruptible, diffs trees, calculates effect flags, zero DOM mutations.
- **Commit Phase**: Sync, uninterruptible, mutates DOM, executes `useLayoutEffect`, paints, executes `useEffect`.

---

## 19. Quick Reference

```
┌─────────────────────┬───────────────────────────┬───────────────────────────┐
│ Feature             │ Render Phase              │ Commit Phase              │
├─────────────────────┼───────────────────────────┼───────────────────────────┤
│ Execution           │ Asynchronous / Time-sliced│ Synchronous / Blocking    │
│ Can Be Paused?      │ YES                       │ NO                        │
│ Touches Real DOM?   │ NO                        │ YES                       │
│ Hooks Executed      │ Component body, useMemo   │ useLayoutEffect, useEffect│
│ Frequency           │ May run multiple times    │ Runs exactly once         │
└─────────────────────┴───────────────────────────┴───────────────────────────┘
```
