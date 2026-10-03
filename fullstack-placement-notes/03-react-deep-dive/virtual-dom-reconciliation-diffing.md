# Virtual DOM Reconciliation & The O(N) Diffing Algorithm

## 1. What is it?
**Reconciliation** is the internal algorithmic process by which React compares two Virtual DOM trees (the previous tree and the newly rendered tree) to determine the minimal set of changes required to update the actual browser DOM.

At the heart of reconciliation is React's **Diffing Algorithm**. While finding the minimum number of edit operations to transform one arbitrary tree into another is mathematically a problem of **$O(N^3)$ complexity**, React employs a pragmatic heuristic algorithm that reduces this to **$O(N)$ linear time**, allowing smooth 60fps renders even across massive applications with thousands of nodes.

> 🔗 *Prerequisite Knowledge*: To understand why direct browser DOM operations are computationally slow, review [`javascript-placement-notes/07-dom/dom.md`](../../javascript-placement-notes/07-dom/dom.md).

---

## 2. Why does it exist?
### The Computational Problem of Tree Diffing
In computer science, finding the absolute minimum sequence of insertions, deletions, and substitutions to transform Tree $A$ into Tree $B$ has a theoretical lower bound of **$O(N^3)$** (using algorithms like Zhang-Shasha or Klein).
- If your application has **1,000 DOM elements**:
  $$N^3 = 1,000^3 = 1,000,000,000 \text{ (1 Billion operations!)}$$
- Calculating 1 billion comparisons on every state change would freeze the user's browser for several seconds on every keystroke!
- **React's Solution**: React makes **two heuristic assumptions** based on real-world web UI patterns to achieve **$O(N)$ complexity** (1,000 operations instead of 1 billion).

---

## 3. Mental Model: The Two Heuristic Assumptions
💡 **Think of it like an Architect Inspecting Two Building Blueprints:**

```
                  HEURISTIC ASSUMPTIONS IN REACT
                                │
        ┌───────────────────────┴───────────────────────┐
        ▼                                               ▼
[ ASSUMPTION 1: TYPE IDENTITY ]             [ ASSUMPTION 2: STABLE KEYS ]
Different element types will produce       Children with matching keys are
completely different subtrees.              the same entity across renders.
Action: Tear down old tree & build new.    Action: Move/update existing DOM node.
```

1. **Assumption 1 (Different Types $\rightarrow$ Complete Tear Down)**:
   If an element's type changes (e.g., from `<div>` to `<span>`, or from `<Header>` to `<NavBar>`), React assumes the old subtree and the new subtree share no similarities. It does **not** waste time diffing their children; it completely destroys (unmounts) the old tree and mounts a fresh one.
2. **Assumption 2 (Keys Provide Identity)**:
   In dynamic child lists, React cannot know if an element was moved, added, or deleted without help. The developer provides a stable, unique `key` prop, allowing React to match children in the old tree with children in the new tree in $O(1)$ time per node.

---

## 4. Basic Example: How React Diffs Elements

### Case A: Same Element Type, Different Attributes
```tsx
// Render 1:
<div className="banner-inactive" title="Welcome" style={{ color: 'red' }} />

// Render 2:
<div className="banner-active" title="Welcome" style={{ color: 'blue' }} />
```
**What React Does Under the Hood**:
- Inspects element type: both are `div`. **Type has not changed.**
- Inspects props/attributes:
  - `title`: identical ("Welcome") $\rightarrow$ No DOM touch.
  - `className`: changed from `"banner-inactive"` to `"banner-active"` $\rightarrow$ updates `element.className`.
  - `style.color`: changed from `'red'` to `'blue'` $\rightarrow$ updates `element.style.color`.
- **Result**: React mutates only the changed attributes on the existing real DOM node. Zero nodes created or destroyed.

### Case B: Different Element Types
```tsx
// Render 1:
<div>
  <Counter initialCount={10} />
</div>

// Render 2:
<span>
  <Counter initialCount={10} />
</span>
```
**What React Does Under the Hood**:
- Inspects root node: `div` changed to `span`.
- **Destroys the entire old subtree**: The `div` and its child `<Counter />` are completely unmounted.
- Any internal state inside `<Counter />` is **wiped out forever**!
- Mounts the `span` and mounts a brand-new instance of `<Counter />` from scratch (`count` resets to initial value).

---

## 5. Real Example: Child List Diffing Without vs. With Keys

Consider an unordered task list:

```tsx
// Initial Render:
<ul>
  <li>Task B</li>
  <li>Task C</li>
</ul>

// Next Render: (New Task A inserted at top)
<ul>
  <li>Task A</li>
  <li>Task B</li>
  <li>Task C</li>
</ul>
```

### Scenario 1: No Keys (Naive Index Matching)
1. Compares Index 0: Old `Task B` vs New `Task A` $\rightarrow$ Mutates text of DOM Node 0 to `"Task A"`.
2. Compares Index 1: Old `Task C` vs New `Task B` $\rightarrow$ Mutates text of DOM Node 1 to `"Task B"`.
3. Compares Index 2: Old had nothing, New has `Task C` $\rightarrow$ Creates new DOM Node 2 with `"Task C"`.
- **Total Work**: 2 DOM mutations + 1 DOM creation. All children re-render and lose focus/local state!

### Scenario 2: With Stable Keys
```tsx
// Initial:
<ul>
  <li key="b">Task B</li>
  <li key="c">Task C</li>
</ul>

// Next:
<ul>
  <li key="a">Task A</li>
  <li key="b">Task B</li>
  <li key="c">Task C</li>
</ul>
```
- React looks up key `"a"`: New item! Creates DOM node for `Task A`.
- React looks up key `"b"`: Already exists! Keeps existing DOM node intact.
- React looks up key `"c"`: Already exists! Keeps existing DOM node intact.
- Performs a single `parentNode.insertBefore(nodeA, nodeB)`.
- **Total Work**: 1 DOM insertion. Zero unnecessary mutations.

---

## 6. Under the Hood: The Fiber Diffing Mechanics

React 16+ executes reconciliation through **Fiber Nodes** organized as a singly linked list (`child`, `sibling`, `return`).

```
                    Parent Fiber (WorkInProgress)
                                │
                                ▼ child
                         [ Fiber Child 1 ]
                          ├── return ──> Parent
                          └── sibling ──> [ Fiber Child 2 ]
                                           ├── return ──> Parent
                                           └── sibling ──> [ Fiber Child 3 ]
```

### The Two-Pass Reconciliation for Lists
When reconciling a list of children, React cannot do an arbitrary two-pointer diff because Fiber nodes are a **singly-linked list** (there is no backward pointer `prevSibling`):

1. **First Pass (Linear Scan)**:
   - React iterates through the old Fiber children and the new JSX array simultaneously from index `0`.
   - As long as the keys and types match, React reuses the Fiber node and updates props.
   - The moment it encounters a key mismatch or a reorder, the first pass breaks!
2. **Second Pass (Map Lookup)**:
   - React puts all remaining old Fiber children into a JavaScript `Map<Key, Fiber>`.
   - It iterates through the rest of the new JSX children and queries the map by key.
   - If found: React extracts the Fiber from the map, checks its previous index (`placement` flag), and reuses it.
   - If not found: React allocates a new Fiber node.
   - Any nodes remaining in the map after the loop are tagged with the `Deletion` flag to be removed from the real DOM during the Commit phase.

---

## 7. Important Rules

1. **Keys Must Be Unique Among Siblings**: Keys do not need to be globally unique across the entire app, only unique within their immediate parent array.
2. **Keys Must Be Stable Across Renders**: Never generate keys on the fly (`key={Math.random()}` or `key={uuid()}`). An unstable key forces React to completely destroy and re-instantiate the DOM node on every single render.
3. **Changing Component Type Resets Subtree State**: Switching from `<UserCard />` to `<AdminCard />` will tear down `<UserCard />` and lose all nested state, even if they return identical HTML elements.
4. **Changing Keys Forces State Reset**: Giving an element a different `key` forces React to treat it as a new instance, unmounting the old one.

---

## 8. Common Mistakes

### Mistake 1: Defining a Component Inside Another Component Function
```tsx
// ❌ CATASTROPHIC ANTI-PATTERN:
function ParentContainer() {
  const [text, setText] = useState('');

  // ChildComponent is REDEFINED on every single render of ParentContainer!
  function InnerInput() {
    return <input value={text} onChange={(e) => setText(e.target.value)} />;
  }

  return (
    <div>
      <InnerInput />
    </div>
  );
}
```
**Why this breaks**:
On every render of `ParentContainer`, `InnerInput` is a brand-new function reference in memory. React compares `OldType !== NewType`, determines the component type has changed, destroys the `<input>` DOM node, and mounts a new one. **Result: The input loses focus after every single character typed!**

```tsx
// ✅ CORRECT: Define child components outside or pass props
function InnerInput({ value, onChange }: { value: string; onChange: (val: string) => void }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} />;
}

function ParentContainer() {
  const [text, setText] = useState('');
  return (
    <div>
      <InnerInput value={text} onChange={setText} />
    </div>
  );
}
```

---

## 9. Best Practices

1. **Use Natural Database IDs for Keys**: Always use stable primary keys from your database (`user.id`, `product.uuid`).
2. **Use Key to Reset State Intentionally**: When switching between different profiles or tabs, pass the active ID as `key` to clean up old form inputs cleanly:
   ```tsx
   <UserProfileEditor key={selectedUserId} userId={selectedUserId} />
   ```
3. **Keep Hierarchy Stable**: Avoid swapping wrapping tags (`<div>` vs `<span>`) dynamically if you intend to preserve children state.

---

## 10. Performance Considerations

- **Heuristic Cost**: The $O(N)$ algorithm means rendering cost scales linearly with the size of the subtree being rendered.
- **Deep Component Trees**: Diffing 10,000 components still takes noticeable CPU time. Use `React.memo` or split state into subtrees to prevent reconciliation from even starting on unaffected branches.
- **Index as Key in Reordered Lists**: Reversing an array with index keys forces React to update every single DOM node instead of simply reordering DOM nodes via `Node.insertBefore()`.

---

## 11. Security Considerations

- **Component Injection**: Because React uses element types to determine tree construction, never accept untrusted string tag names from user input without validation:
  ```tsx
  // ⚠️ DANGEROUS if userInputTag is untrusted:
  const CustomTag = userInputTag as any;
  return <CustomTag />;
  ```
  An attacker could potentially provide an SVG or script element.

---

## 12. Alternatives: How Other Frameworks Handle Diffing

| Framework | Mechanism | Runtime Cost | Memory Usage |
| :--- | :--- | :--- | :--- |
| **React** | Virtual DOM Heuristic Diffing ($O(N)$) | Moderate (diffs tree on render) | Higher (stores 2 Virtual DOM trees) |
| **Svelte** | Compile-Time Reactivity (No VDOM) | Zero diffing at runtime | Minimal (direct DOM mutations) |
| **SolidJS** | Fine-Grained Reactive Signals | Zero diffing (signals update text nodes) | Very Low |
| **Vue 3** | Compiler-Optimized VDOM (Patch Flags) | Fast (skips static nodes via flags) | Moderate |

---

## 13. Trade-offs

- **Benefit**: Declarative programming model; you never write imperative DOM manipulation; predictable updates.
- **Cost**: Generates thousands of short-lived JavaScript objects during render that the JavaScript garbage collector must periodically collect.

---

## 14. Real-World Usage

Reconciliation is the engine powering:
- Seamless page transitions in Single Page Apps.
- Animated list reordering libraries (Framer Motion relies on stable keys to calculate FLIP layout animations).
- Form resets across editing states.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the time complexity of React's diffing algorithm, and why isn't it $O(N^3)$?**  
*Answer*: React's diffing algorithm runs in **$O(N)$ linear time**. The theoretical optimal tree diffing algorithm is $O(N^3)$, which would be too slow for UI rendering. React achieves $O(N)$ by applying two heuristics: (1) elements of different types generate completely different trees, and (2) elements in lists are matched across renders using developer-provided stable `key` props.

### Conceptual
**Q: What happens internally when the root tag of a component changes from `<div>` to `<section>`?**  
*Answer*: React detects that the element type has changed (`div !== section`). Under Heuristic #1, React destroys the entire old DOM subtree rooted at `div`, triggering `componentWillUnmount` (or effect cleanup functions) for all child components, and discards their local state. It then mounts a completely new `<section>` DOM element and constructs its children from scratch.

### Implementation
**Q: How does React differentiate between moving an existing DOM node vs. inserting a brand new DOM node in a keyed list?**  
*Answer*: During the second pass of child reconciliation, React builds a `Map<Key, Fiber>` of remaining old fibers. For each new child element, it looks up its `key` in the map:
- If the key exists: React reuses the old Fiber node and inspects its `lastPlacedIndex`. If the old index is less than the current highest seen index, React tags the Fiber with the `Placement` effect flag, which instructs the Commit phase to execute `parentNode.insertBefore()`.
- If the key does not exist: React instantiates a new Fiber and tags it with `Placement` to create and append a new DOM node.

### Debugging
**Q: Why does defining a helper component inside the render method of a parent component cause input focus loss on every keystroke?**  
*Answer*: Because on every parent render, a new function object is created for the child component. To React, `PrevComponentType !== NextComponentType` (their function references differ), so React unmounts the previous input DOM node and mounts a new one, immediately dropping keyboard focus.

### Scenario
**Q: You have a modal that displays a multi-step user onboarding flow. When switching between Step 1 and Step 2, form inputs in Step 2 retain text typed in Step 1. Why is this happening and how do you resolve it?**  
*Answer*: Both steps render identical `<input type="text" />` elements at the same position in the Virtual DOM tree. Because the element type is unchanged and no `key` is specified, React reuses the existing DOM node and preserves its uncontrolled DOM value. To resolve this, assign distinct keys: `<input key="step1-name" />` and `<input key="step2-email" />`, or key the parent step containers.

### Advanced
**Q: What are React 18 / Fiber `flags` (formerly `effectTag`) and how are they used during reconciliation?**  
*Answer*: During the Render phase, as React diffs nodes, it assigns bitwise flags to Fiber nodes (e.g. `Placement = 0b00000000000000000000000010`, `Update = 0b00000000000000000000000100`, `Deletion = 0b00000000000000000000001000`). During the Commit phase, React traverses the fiber tree (or effect list) and uses bitwise operations to execute only the necessary DOM operations (`appendChild`, `removeChild`, `setAttribute`) in a single synchronous pass.

---

## 16. Coding Question: Implement a Miniature Heuristic Tree Diff

**Task**: Implement a simplified JavaScript function `diff(oldVNode, newVNode)` that mirrors React's heuristics:
- Returns `'REPLACE'` if types differ.
- Returns `'UPDATE_PROPS'` with changed attributes if types match.
- Recursively diffs keyed children.

```typescript
interface VNode {
  type: string;
  key?: string | number;
  props: Record<string, any>;
  children?: VNode[];
}

type Patch = 
  | { type: 'REPLACE'; newVNode: VNode }
  | { type: 'UPDATE_PROPS'; propUpdates: Record<string, any> }
  | { type: 'NO_OP' };

export function diffNode(oldNode: VNode, newNode: VNode): Patch {
  // Heuristic 1: If types differ, tear down and replace completely
  if (oldNode.type !== newNode.type) {
    return { type: 'REPLACE', newVNode: newNode };
  }

  // Same type: calculate prop diffs
  const propUpdates: Record<string, any> = {};

  // Check changed or added props
  for (const [key, value] of Object.entries(newNode.props)) {
    if (oldNode.props[key] !== value) {
      propUpdates[key] = value;
    }
  }

  // Check removed props
  for (const key of Object.keys(oldNode.props)) {
    if (!(key in newNode.props)) {
      propUpdates[key] = null; // deleted
    }
  }

  if (Object.keys(propUpdates).length > 0) {
    return { type: 'UPDATE_PROPS', propUpdates };
  }

  return { type: 'NO_OP' };
}
```

---

## 17. Common Interview Traps

1. **"The Virtual DOM is faster than direct DOM manipulation."**  
   *Trap*: Repeating this myth.  
   *Reality*: Direct, surgically optimized DOM manipulation (as in vanilla JS or Svelte) is always faster than VDOM diffing. The Virtual DOM is about **developer productivity and predictable declarative mental models**, being *fast enough* for 99% of applications, not about beating raw C++ DOM bindings.
2. **"Keys must be globally unique across the whole web app."**  
   *Trap*: Thinking keys are like database UUIDs.  
   *Reality*: Keys only need to be unique among **direct sibling elements** within the same parent array.

---

## 18. Revision Summary

- Optimal tree diff is $O(N^3)$; React achieves **$O(N)$** via 2 heuristics:
  1. Different element types yield different trees.
  2. Keys provide stable child identities across renders.
- Changing element type causes a complete subtree unmount and state loss.
- Never define components inside other component render functions.
- Stable keys allow React to execute `insertBefore` instead of mutating every node.

---

## 19. Quick Reference

```
┌─────────────────────────────────┬────────────────────────────────────────────┐
│ Scenario                        │ Reconciliation Action                      │
├─────────────────────────────────┼────────────────────────────────────────────┤
│ Tag changes (`div` -> `span`)   │ Old DOM destroyed; New DOM created; State lost. │
│ Same tag, different attributes │ Reuses DOM node; mutates only changed props. │
│ Keyed list reorder             │ Moves existing DOM nodes via `insertBefore`.│
│ Unkeyed list insertion at top   │ Mutates every subsequent child element.   │
│ Changing `key` on same tag      │ Destroys old DOM node and resets all state.│
└─────────────────────────────────┴────────────────────────────────────────────┘
```
