# Conditional Rendering Patterns & Reconciliation Mechanics

## 1. What is it?
**Conditional Rendering** in React is the programmatic technique of rendering different UI elements or component branches based on dynamic state, props, or permissions. Just as standard JavaScript uses `if`, ternaries, and logical operators to control program flow, React uses the exact same JavaScript primitives to control which JSX trees are delivered to the Virtual DOM.

---

## 2. Why does it exist?
Real-world web applications are rarely static. A single screen must gracefully transition across multiple states:
- **Loading State**: Showing a skeleton or spinner while an API request is in-flight.
- **Error State**: Displaying an error banner or retry button if the network fails.
- **Empty State**: Showing an illustration when a user has zero items in their cart.
- **Authentication State**: Displaying a "Login" button for guests and a "User Profile" dropdown for authenticated users.

---

## 3. Mental Model
💡 **Think of it like a Railroad Track Switch:**
- The train (**React Reconciliation Engine**) is traveling down the tracks carrying passengers (**Component State**).
- Ahead on the tracks is a mechanical switch (**Conditional Statement**).
- If the track switch is flipped to `isLoggedIn = true`, the train glides onto Track A (**`<Dashboard />`**).
- If the switch is flipped to `isLoggedIn = false`, the train is diverted onto Track B (**`<LoginForm />`**).
- *Crucial Reconciliation Rule*: If the switch diverts the train to a completely different station, everything inside the previous train is unloaded and dismantled (**Unmounted**).

### The 5 Primary Conditional Patterns
```
┌────────────────────────────────────────────────────────┐
│ 1. EARLY RETURN (Guard Clause)                         │
│    if (isLoading) return <Spinner />;                  │
│    if (error) return <ErrorMessage err={error} />;     │
├────────────────────────────────────────────────────────┤
│ 2. TERNARY OPERATOR (Either / Or)                      │
│    {isAuth ? <UserMenu /> : <LoginButton />}           │
├────────────────────────────────────────────────────────┤
│ 3. LOGICAL AND (Render or Nothing)                     │
│    {hasNotifications && <Badge count={count} />}       │
├────────────────────────────────────────────────────────┤
│ 4. LOOKUP TABLE / OBJECT MAP (Enum / Multi-branch)     │
│    {VIEW_MAP[status] ?? <DefaultView />}               │
├────────────────────────────────────────────────────────┤
│ 5. IIFE (Complex inline logic)                         │
│    {(() => { switch(type) { ... } })()}                │
└────────────────────────────────────────────────────────┘
```

---

## 4. Basic Example: The 4 Core Patterns Side-by-Side

```tsx
// ConditionalExamples.tsx
import React from 'react';

interface Props {
  isLoading: boolean;
  error: string | null;
  items: string[];
  role: 'ADMIN' | 'USER' | 'GUEST';
}

export function ConditionalDemo({ isLoading, error, items, role }: Props) {
  // Pattern 1: Early Return (Guard Clauses)
  if (isLoading) return <div className="spinner">Loading data...</div>;
  if (error) return <div className="error-alert">Error: {error}</div>;

  // Pattern 4: Lookup Table Map for Roles
  const RoleBadge = {
    ADMIN: <span className="badge-admin">Admin User</span>,
    USER: <span className="badge-user">Standard User</span>,
    GUEST: <span className="badge-guest">Guest</span>
  }[role];

  return (
    <div className="container">
      {/* Pattern 2: Ternary Operator */}
      <header>
        {role === 'ADMIN' ? <button>Admin Panel</button> : <button>Profile</button>}
      </header>

      {/* Pattern 3: Logical AND (Safe from the 0 bug!) */}
      {items.length > 0 ? (
        <ul>{items.map(item => <li key={item}>{item}</li>)}</ul>
      ) : (
        <p>No items found.</p>
      )}

      <footer>{RoleBadge}</footer>
    </div>
  );
}
```

---

## 5. Real Example: State Preservation vs. Reset in Reconciliation
How you structure conditional rendering directly affects whether React preserves or destroys local child state:

```tsx
// CounterPersistenceDemo.tsx
import React, { useState } from 'react';

function Counter({ label }: { label: string }) {
  const [score, setScore] = useState(0);
  return (
    <div className="counter-box">
      <h4>{label}: {score}</h4>
      <button onClick={() => setScore(s => s + 1)}>Add Point</button>
    </div>
  );
}

export function Scoreboard() {
  const [isPlayerA, setIsPlayerA] = useState(true);

  return (
    <div>
      {/* ⚠️ GOTCHA: React sees Counter at the SAME position in tree! */}
      {/* Even if isPlayerA changes, score state is ACCIDENTALLY PRESERVED! */}
      {isPlayerA ? (
        <Counter label="Player A" />
      ) : (
        <Counter label="Player B" />
      )}

      {/* ✅ THE FIX: Assign unique keys to force React to reset state! */}
      {/* {isPlayerA ? (
        <Counter key="player-a" label="Player A" />
      ) : (
        <Counter key="player-b" label="Player B" />
      )} */}

      <button onClick={() => setIsPlayerA(p => !p)}>Switch Player</button>
    </div>
  );
}
```

---

## 6. Under the Hood: The Reconciliation Element Type Rule

How does React decide whether to **preserve** or **destroy** a component during conditional rendering?

```
PREVIOUS RENDER TREE:                   NEW RENDER TREE:
     <div>                                   <section>  ◄── ELEMENT TYPE CHANGED!
       <Counter score={5} />                   <Counter score={5} />
     </div>                                  </section>
```

### The Invariant Rules of Diffing:
1. **Same Component Type at the Same Position**:
   - If the component type matches (`<Counter />` at position 1 previously, and `<Counter />` at position 1 now), React **keeps the existing component instance and its internal state alive**! It only updates the changed props.
2. **Different Component or HTML Type at the Same Position**:
   - If a `<div>` changes to a `<section>`, or a `<ComponentA />` changes to `<ComponentB />`, React **destroys the entire subtree**.
   - It unmounts the old components, executes their cleanup functions, drops all local state from memory, and mounts brand-new DOM nodes from scratch.
3. **The Role of the `key` Prop**:
   - If you provide a unique `key` (e.g. `<Counter key={userId} />`), React treats the key as an explicit identity check. When the key changes, React **forces a complete unmount and remount**, resetting all internal state to default.

---

## 7. Important Rules & Invariants
1. **Never Render Numbers with `&&` Without Comparisons**:
   - `{count && <Component />}` will render the string `"0"` on the page when `count === 0`.
   - **Always write**: `{count > 0 && <Component />}` or `{Boolean(count) && <Component />}`.
2. **Do Not Declare Components Inside Other Components**:
   ```tsx
   // ❌ DISASTROUS ANTI-PATTERN:
   function Parent() {
     // Re-declared on EVERY single render! Gets a new function reference every time!
     function Child() { return <div>Child</div>; }
     return <Child />; // React destroys and remounts Child on EVERY parent render!
   }
   ```
   Always declare components at the top level of the module.

---

## 8. Common Mistakes & Pitfalls

### ❌ Mistake 1: Deep Nested Ternary Hell
```tsx
// ❌ UNREADABLE SPAGHETTI:
return (
  <div>
    {isLoading ? <Spinner /> : error ? <ErrorDisplay /> : !data ? <Empty /> : data.length === 0 ? <NoResults /> : <Results data={data} />}
  </div>
);
```
- **Why it breaks**: Impossible to read, test, or maintain without introducing syntax bugs.
- **✅ The Fix**: Use early return guard clauses at the top of the function:
  ```tsx
  if (isLoading) return <Spinner />;
  if (error) return <ErrorDisplay error={error} />;
  if (!data || data.length === 0) return <EmptyResults />;
  return <Results data={data} />;
  ```

### ❌ Mistake 2: Leaking `NaN` or `undefined` into the DOM
- If an array length calculation produces `NaN`, `{nanValue && <Component />}` will print `"NaN"` directly onto your screen.
- In JavaScript, `NaN` is falsy, but `NaN && <Component />` returns `NaN`.

---

## 9. Best Practices in Modern Production
1. **Guard Clauses First**: Place loading, error, and permission checks at the very top of your component.
2. **Use Lookup Tables for State Machines**: When rendering different UIs based on status (`'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR'`), use a TypeScript `Record<Status, ReactNode>` map.
3. **Reset Form State via Keys**: When switching between editing "User 1" and "User 2" in a modal, pass `key={selectedUser.id}` to the form component. This cleanly resets all form inputs without manual `useEffect` resetting code!

---

## 10. Performance Considerations: Preserving DOM Nodes
If you have an expensive component (like a heavy Google Map or Video Player), completely unmounting and remounting it with `{showMap && <HeavyMap />}` wastes CPU and network bandwidth.
- **Alternative**: Keep the component mounted in the DOM and toggle visibility using CSS:
  ```tsx
  <div style={{ display: showMap ? 'block' : 'none' }}>
    <HeavyMap />
  </div>
  ```
  This preserves the initialized WebGL context and map state without re-fetching tiles!

---

## 11. Security Considerations: Rendering Roles Conditionally
- **The Security Fallacy**: Thinking that hiding an "Admin Panel" button with `{user.role === 'ADMIN' && <AdminButton />}` secures your application.
- **Reality**: An attacker can open React DevTools in Chrome and change their local state to `role = 'ADMIN'` in 2 seconds!
- **Rule**: Client-side conditional rendering is **only for User Experience (UX)**. All administrative endpoints and database queries **must be strictly authorized on the backend**!

---

## 12. Alternatives: CSS Hiding vs. Conditional Unmounting
| Approach | DOM Behavior | State Behavior | When to Use |
|---|---|---|---|
| **Conditional JSX (`{isOpen && <Modal />}`)** | Node is completely removed from real DOM. | Local state is wiped on unmount; cleans up memory. | Standard modals, dynamic pages, tabs. |
| **CSS Toggle (`style={{ display: 'none' }}`)** | Node remains in the real DOM tree. | Local state, scroll position, and inputs are preserved. | Expensive tabs (maps, rich text editors, video streams). |

---

## 13. Trade-offs: Early Return vs. Inline Ternary
- **Early Return**:
  - *Pro*: Exceptionally clean, eliminates nesting, isolates error handling.
  - *Con*: Can only be used for entire-page or entire-component state (cannot conditionally render a small icon inside a button).
- **Inline Ternary**:
  - *Pro*: Precise, surgical control over small localized parts of the JSX tree.
  - *Con*: Becomes unreadable if expressions span more than 3-4 lines.

---

## 14. Real-World Usage: Feature Flagging at Scale (LaunchDarkly)
At enterprise scale (Netflix / Uber), conditional rendering powers **Feature Flags**:
```tsx
export function CheckoutButton() {
  const { isEnabled: isNewCheckoutEnabled } = useFeatureFlag('v2_stripe_checkout');

  if (isNewCheckoutEnabled) {
    return <StripeElementsCheckout />;
  }
  return <LegacyCheckoutButton />;
}
```
Engineers can roll out the new checkout to 5% of users in production and roll it back instantly from a remote dashboard without deploying new code.

---

## 15. Placement Interview Questions

### Basic (Intern)
1. **Why does `{items.length && <List />}` render a `0` on the screen when the array is empty?**
   - *Spoken Answer*: "Because of how JavaScript's logical AND operator (`&&`) evaluates expressions. In JS, `expr1 && expr2` returns `expr1` if it is falsy. When `items.length` is `0`, JavaScript evaluates the expression to the number `0`. In React, while `false`, `null`, and `undefined` render nothing, numbers are rendered as literal text nodes. To fix it, use a boolean comparison: `{items.length > 0 && <List />}`."

### Conceptual (Junior SDE)
2. **If you conditionally switch between `<input id="first" />` and `<input id="last" />`, will the text entered by the user be preserved or erased?**
   - *Spoken Answer*: "By default, the text will be **accidentally preserved**! Because both elements are of the exact same type (`<input>`) at the exact same position in the Virtual DOM tree, React's reconciliation algorithm assumes it is the same input element and only updates the `id` attribute. To force React to treat them as distinct inputs and reset the text, you must supply unique `key` props (e.g. `key="first"` and `key="last"`)."

### Implementation (SDE-1)
3. **How does passing a `key` prop to a component force a complete state reset?**
   - *Spoken Answer*: "React's diffing algorithm matches fiber nodes between renders based on element type and `key`. If the key of a component at a given position changes (e.g. from `key="user-1"` to `key="user-2"`), React treats them as two completely unrelated components. It unmounts the old component instance, runs its cleanup effects, destroys its internal state from memory, and mounts a brand-new component instance with initial state."

### Debugging
4. **A component has: `if (isLoading) return <Loading />; const [user, setUser] = useState(null);`. Why does this throw an invariant error?**
   - *Analysis*: This violates the fundamental **Rules of Hooks**! Hooks must be called in the exact same order on every render. Because the `useState` hook is placed *after* an early return condition, on renders where `isLoading` is true, the hook is skipped, causing React's internal fiber hook linked list pointers to misalign and crash.
   - *Fix*: Move all hook calls (`useState`, `useEffect`) to the very top of the component, before any early returns.

### Scenario-Based
5. **How would you structure a component that needs to render 6 different views based on an API status enum without writing messy nested ternaries?**
   - *Spoken Answer*: "Use the **Lookup Table / Object Map Pattern**:
     ```tsx
     const VIEW_MAP: Record<Status, ReactNode> = {
       IDLE: <IdleView />,
       PENDING: <Spinner />,
       RESOLVED: <SuccessView data={data} />,
       REJECTED: <ErrorView error={error} />,
       OFFLINE: <OfflineBanner />
     };
     return VIEW_MAP[status] ?? <DefaultView />;
     ```
     This provides $O(1)$ dispatching, clean readability, and full TypeScript exhaustiveness checking."

### Advanced (Tier-1 Product Company)
6. **Explain what happens to an unmounted component's cleanup functions during conditional rendering.**
   - *Spoken Answer*: "When a component branch is conditionally unmounted (e.g. `{show && <Child />}` becomes false), React's Commit Phase traverses the unmounting fiber subtree. It invokes all cleanup functions returned by `useEffect` and `useLayoutEffect`, detaches native DOM event listeners, cancels pending layout effects, releases DOM references, and marks the fiber node for garbage collection. If an asynchronous network request resolves after the unmount, calling `setState` will trigger memory leak warnings or be safely ignored by modern React."

---

## 16. Placement Coding Challenge: Exhaustive Switch Component
Implement a type-safe, declarative `<Switch>` and `<Case>` conditional rendering component in TypeScript:

```tsx
// ConditionalSwitch.tsx
import React, { ReactNode, Children, isValidElement } from 'react';

interface CaseProps<T> {
  value: T;
  children: ReactNode;
}

export function Case<T>({ children }: CaseProps<T>) {
  return <>{children}</>;
}

interface SwitchProps<T> {
  value: T;
  fallback?: ReactNode;
  children: ReactNode;
}

export function Switch<T>({ value, fallback = null, children }: SwitchProps<T>) {
  let matchedChild: ReactNode = null;

  Children.forEach(children, (child) => {
    if (matchedChild) return; // Already found first match

    if (isValidElement(child) && child.type === Case) {
      if ((child.props as CaseProps<T>).value === value) {
        matchedChild = child;
      }
    }
  });

  return <>{matchedChild ?? fallback}</>;
}

// Usage Example:
export function StatusDisplay({ status }: { status: 'loading' | 'success' | 'error' }) {
  return (
    <Switch value={status} fallback={<p>Unknown status</p>}>
      <Case value="loading"><div className="spinner">Loading...</div></Case>
      <Case value="success"><div>Operation successful!</div></Case>
      <Case value="error"><div className="error">Failed to load.</div></Case>
    </Switch>
  );
}
```

---

## 17. Common Interview Traps
- **Trap**: "Does React evaluate the falsy branch of a ternary operator?"
  - *Trap Explanation*: No. JavaScript ternary operators (`condition ? branchA : branchB`) use short-circuit evaluation. Only the matching branch is executed and converted into a React Element.
- **Trap**: "Can we return `undefined` from a React component?"
  - *Trap Explanation*: In modern React, returning `null` renders nothing cleanly. However, in older React versions, accidentally returning `undefined` threw a runtime error: *"A valid React element (or null) must be returned"*. Always return `null`, not `undefined`, when rendering nothing.

---

## 18. Revision Summary
- Use **Guard Clauses (Early Returns)** for page-level loading and error states.
- Use **Ternary Operators** for simple binary UI toggles (`isAuth ? <A /> : <B />`).
- Beware the **`0` Bug** with logical AND (`{items.length > 0 && <List />}`).
- Use **Lookup Tables / Object Maps** for multi-condition enum states.
- Changing component types or parent wrappers destroys child state.
- Use the **`key` prop** to explicitly force state resets on identical components.

---

## 19. Quick Reference Cheat Sheet
```tsx
// Safe Conditional Patterns:
{count > 0 && <Display />}       // Prevents '0' text bug
{isReady ? <App /> : null}        // Safe ternary
{STATUS_MAP[status] ?? <Empty />} // Clean lookup table

// Force Component State Reset:
<UserProfile key={userId} user={currentUser} />
```
