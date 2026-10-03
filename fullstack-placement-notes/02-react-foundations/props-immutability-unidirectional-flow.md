# Props, Immutability & Unidirectional Data Flow

## 1. What is it?
In React, **Props** (short for *Properties*) are read-only inputs passed from a parent component down to a child component. Just as arguments are passed into a JavaScript function to customize its output, props are passed into React components to customize their rendered UI and behavior.

The foundational law of React architecture is **Unidirectional Data Flow**: data travels strictly downward through the component hierarchy via props, while communication back up the tree occurs exclusively through callback functions.

---

## 2. Why does it exist?
Without props, every component would have to be hardcoded with static values or fetch its own data independently:
- **The Problem**: A `Button` component could only ever say "Submit", and a `UserProfile` card would only ever display a single hardcoded user. You could not build reusable UI design systems.
- **The Props Solution**: Components become **generic, reusable templates**. A single `<Button variant="danger" label="Delete" onClick={handleDelete} />` component can be used in 100 different places across an enterprise application with different colors, text, and event handlers.
- **Why Immutability is Enforced**: If child components were allowed to mutate their received props directly, a child could silently alter state owned by its parent or siblings. In large codebases with thousands of components, tracking down which child corrupted shared state would be an impossible debugging nightmare.

---

## 3. Mental Model
💡 **Think of it like a Legal Contract / Official Memo:**
- A CEO (**Parent Component**) hands a sealed, stamped memo (**Props**) to a Department Manager (**Child Component**).
- The memo says: *"You have a budget of \$10,000 for Marketing."*
- The manager **cannot take an eraser and change the number on the CEO's memo** to \$20,000 (**Props are strictly read-only and immutable**).
- If the manager needs more money, they cannot steal it from the CEO's safe. They must use the official telephone number printed at the bottom of the memo (**Callback Function prop: `onRequestBudgetIncrease()`**) to call the CEO and ask for an approved increase!

### The Directional Invariant
```
         [ PARENT COMPONENT: <Dashboard /> ]
           • Owns State: { user: 'Alice', theme: 'dark' }
           • Defines Event Handler: function handleLogout() { ... }
                     │
                     ▼ PROPS TRAVEL DOWNWARD (Read-Only)
         [ CHILD COMPONENT: <Navbar user="Alice" onLogout={handleLogout} /> ]
           • Cannot mutate 'user' directly!
           • User clicks "Logout" button
                     │
                     ▲ CALLBACK EVENT TRAVELS UPWARD
         [ Parent's handleLogout() executes and updates state ]
```

---

## 4. Basic Example: Passing and Destructuring Props with TypeScript

```tsx
// Greeting.tsx
import React from 'react';

interface GreetingProps {
  name: string;
  unreadCount?: number; // Optional prop with default
  onDismiss: () => void; // Callback function prop
}

export function Greeting({ name, unreadCount = 0, onDismiss }: GreetingProps) {
  return (
    <div className="banner">
      <h2>Welcome back, {name}!</h2>
      {unreadCount > 0 && <span className="badge">{unreadCount} new alerts</span>}
      <button onClick={onDismiss} aria-label="Dismiss banner">
        Dismiss
      </button>
    </div>
  );
}

// Parent Component Usage:
export function App() {
  return (
    <Greeting 
      name="Goutam" 
      unreadCount={5} 
      onDismiss={() => console.log('Banner dismissed')} 
    />
  );
}
```

---

## 5. Real Example: The Slot Pattern via the `children` Prop
In enterprise design systems, components often need to accept arbitrary markup rather than just strings:

```tsx
// Modal.tsx
import React, { ReactNode } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode; // Special React prop for nested JSX content
  actionButtons?: ReactNode; // Slot prop for custom action buttons
}

export function Modal({ isOpen, onClose, title, children, actionButtons }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      {/* Stop click propagation so clicking inside modal does not close it */}
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <header className="modal-header">
          <h3>{title}</h3>
          <button onClick={onClose}>&times;</button>
        </header>

        <div className="modal-body">
          {/* Renders whatever nested children the parent passed in: */}
          {children}
        </div>

        {actionButtons && <footer className="modal-footer">{actionButtons}</footer>}
      </div>
    </div>
  );
}
```

---

## 6. Under the Hood: How React Freezes Props in Development

When you pass props into a component, React gathers them into a plain JavaScript object:
```javascript
const props = { name: "Alice", age: 25 };
```

In development mode (`process.env.NODE_ENV !== 'production'`), React passes the props object through `Object.freeze()`:
```javascript
// React internal runtime mechanics (simplified):
if (__DEV__) {
  Object.freeze(element.props);
}
```
If you or a library attempt to execute:
```javascript
props.name = "Bob";
```
- In **Strict Mode**, JavaScript throws an immediate runtime exception:
  `TypeError: Cannot assign to read only property 'name' of object '#<Object>'`
- In production, freezing is skipped for micro-performance reasons, but mutating props still introduces silent desynchronization bugs between Fiber nodes and the Virtual DOM!

---

## 7. Important Rules of Props
1. **Props are Pure Inputs**: A component must never modify its own props. It must act as a pure function with respect to its props.
2. **Shallow Immutability**: `Object.freeze` is **shallow**! If you pass an object or array as a prop:
   ```tsx
   <Profile user={{ name: 'Alice', details: { city: 'London' } }} />
   ```
   Mutating `props.user.details.city = 'Paris'` will not throw a shallow freeze error, but **it mutates the parent's memory directly**, breaking React reconciliation!
3. **Use ES6 Default Parameters**: Avoid the deprecated `Component.defaultProps` syntax. Modern React uses standard ES6 default parameter destructuring:
   `function Card({ theme = 'light' }: Props)`

---

## 8. Common Mistakes & Pitfalls

### ❌ Mistake 1: Mutating a Nested Prop Directly
```tsx
// ❌ DANGEROUS MUTATION BUG:
function UserEditor({ user, onSave }: { user: User; onSave: () => void }) {
  const handleCityChange = (newCity: string) => {
    // ⚠️ Mutates the parent's actual state object in memory!
    user.address.city = newCity; 
    onSave();
  };

  return <input onChange={(e) => handleCityChange(e.target.value)} />;
}
```
- **Consequence**: The parent component will not know that state changed because its state reference did not change.
- **✅ The Fix**: Child creates a clean copy or sends the delta back to the parent:
  ```tsx
  // ✅ Child emits the updated value to parent:
  const handleCityChange = (newCity: string) => {
    onUpdate({
      ...user,
      address: { ...user.address, city: newCity }
    });
  };
  ```

### ❌ Mistake 2: Prop Drilling Hell
- **The Problem**: Passing a `theme` or `currentUser` prop through 8 intermediate components that have zero use for the prop, just to reach a tiny button at the bottom of the tree.
- **The Solution**: Use **Component Composition** (passing elements as `children`) or **React Context / Zustand** for truly global state.

---

## 9. Best Practices in Modern Production
1. **Explicit TypeScript Interfaces**: Always define a strict `interface ComponentProps` for every component. Never use `any` or loose object types.
2. **Destructure Props at the Function Signature**:
   ```tsx
   // Clean and self-documenting:
   export function UserCard({ id, name, email }: UserCardProps) { ... }
   ```
3. **Keep Props Minimal and Normalized**: Avoid passing huge monolithic database objects if the child only needs two fields. Pass `name={user.name}` and `avatar={user.avatar}` instead of `user={user}`. This makes the component easier to memoize with `React.memo`.

---

## 10. Performance Considerations: Object Reference Instability
```tsx
// ⚠️ PERFORMANCE HAZARD:
function Parent() {
  return <HeavyChart config={{ theme: 'dark', animated: true }} />;
}
```
- On every render of `Parent`, JavaScript allocates a **brand-new object reference** `{ theme: 'dark', animated: true }`.
- Even if `<HeavyChart />` is wrapped in `React.memo`, it will re-render every time because:
  `{ ... } !== { ... }` (Referential inequality in JavaScript).
- **Optimization**: Hoist static objects outside the component, or memoize them using `useMemo`:
  ```tsx
  const CHART_CONFIG = { theme: 'dark', animated: true }; // Static reference!
  ```

---

## 11. Security Considerations: Insecure Prop Spreading (`{...props}`)
```tsx
// 🚨 SECURITY HAZARD: Blindly spreading unknown props onto native elements:
function TextInput(props: any) {
  return <input {...props} className="custom-input" />;
}
```
- If an API response or untrusted input contains malicious HTML attributes (e.g. `onFocus="exploit()"` or `formAction`), spreading them indiscriminately allows injection vulnerabilities.
- Explicitly pick the allowed props and rest-spread only known safe HTML attributes.

---

## 12. Alternatives: Props vs. Context vs. Global Stores
| Mechanism | Best Used For | Pros | Cons |
|---|---|---|---|
| **Props** | Direct Parent-to-Child communication (1-2 levels). | Explicit, easy to trace, highly testable, zero magic. | Becomes tedious over deep trees (Prop Drilling). |
| **React Context** | Low-frequency global data (Theme, Auth, Language). | Eliminates prop drilling without external libraries. | Can trigger unnecessary re-renders in un-memoized subtrees. |
| **Zustand / Redux** | High-frequency, complex shared application state. | Fine-grained selector subscriptions; zero re-render cascade. | Adds an external state management abstraction. |

---

## 13. Trade-offs: Flat Props vs. Object Props
- **Flat Props (`<Card name="Goutam" role="Engineer" score={95} />`)**:
  - *Pro*: Highly granular; easy for `React.memo` to shallow-compare primitives (`string`, `number`).
  - *Con*: Long, verbose component signatures when there are 10+ properties.
- **Object Prop (`<Card user={userObject} />`)**:
  - *Pro*: Clean component signature.
  - *Con*: If any irrelevant property on `userObject` changes, the child re-renders even if it didn't use that field.

---

## 14. Real-World Usage: Compound Components in Radix UI / Shadcn
Modern production component libraries (like Radix UI) use props and the `children` composition model to build compound components:
```tsx
<Dialog.Root>
  <Dialog.Trigger>Open Settings</Dialog.Trigger>
  <Dialog.Portal>
    <Dialog.Content>
      <Dialog.Title>Preferences</Dialog.Title>
      <Dialog.Description>Configure your app settings.</Dialog.Description>
      <Dialog.Close />
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
```
Every sub-component communicates implicitly through internal context and props without forcing the developer to manage 10 manual state variables.

---

## 15. Placement Interview Questions

### Basic (Intern)
1. **Can a child component change its own props?**
   - *Spoken Answer*: "No. In React, props are strictly read-only and immutable. A component must act like a pure function with respect to its props. If a child needs to modify data received via props, the parent component must pass down a state updater callback function, which the child invokes to request a state change in the parent."

### Conceptual (Junior SDE)
2. **What is the difference between `props` and `state`?**
   - *Spoken Answer*: "Props are external inputs passed into a component from its parent; they are owned and controlled by the parent and are immutable to the receiving component. State is internal, private data owned and managed by the component itself using hooks like `useState`; it can be mutated over time in response to user actions or network events."

### Implementation (SDE-1)
3. **What is 'Prop Drilling' and what are 3 distinct ways to eliminate it?**
   - *Spoken Answer*: "Prop drilling occurs when props must be passed down through multiple intermediate components that have no use for the data other than forwarding it to deeply nested children. Three architectural ways to eliminate it are:
     1. **Component Composition**: Pass children or component slots (`{children}`) directly, allowing the top parent to inject the target child with props.
     2. **React Context**: Create a Provider that broadcasts data to any component in the subtree via `useContext`.
     3. **External State Managers**: Use specialized state stores like Zustand or Redux Toolkit with atomic selector subscriptions."

### Debugging
4. **A child component is wrapped in `React.memo()`, but it re-renders every time the parent re-renders. What is the root cause?**
   - *Analysis*: `React.memo` performs a shallow comparison of previous and incoming props (`Object.is`). If the parent passes an inline function (`onClick={() => doSomething()}`) or an inline object/array (`style={{ color: 'red' }}`), a brand-new memory reference is allocated on every parent render. Because `{}` never equals `{}`, the shallow comparison fails and the child re-renders.
   - *Fix*: Wrap functions in `useCallback` and objects in `useMemo` in the parent.

### Scenario-Based
5. **Why is it dangerous to copy a prop directly into a `useState` initial value?**
   - *Spoken Answer*: "Writing `const [count, setCount] = useState(props.initialCount)` initializes state **only once during the component's initial mount**. If the parent subsequently re-renders with an updated `props.initialCount`, the local `count` state will **not update**! It creates a dual-source-of-truth bug. If a component must stay in sync with incoming prop changes, the value should be derived directly or synchronized via keys."

### Advanced (Tier-1 Product Company)
6. **How does React's reconciliation handle prop changes under the hood?**
   - *Spoken Answer*: "During the Render Phase, React compares the previous fiber's `memoizedProps` with the incoming element's `pendingProps`. If the component is a functional component without `React.memo`, React re-executes the component function. For host DOM components (like `<div id={id} />`), React generates an **Update Queue** containing only the specific changed DOM attribute pairs (e.g. `['className', 'btn-active']`), which is flushed to the real DOM during the Commit Phase."

---

## 16. Placement Coding Challenge: Type-Safe Polymorphic Button
Write a production-grade polymorphic button in TypeScript that can render either as a native HTML `<button>` or as an `<a>` anchor tag based on an `as` prop, while preserving strict HTML attribute typing:

```tsx
// PolymorphicButton.tsx
import React, { ComponentPropsWithoutRef, ElementType, ReactNode } from 'react';

type ButtonBaseProps<T extends ElementType = 'button'> = {
  as?: T;
  variant?: 'primary' | 'secondary' | 'danger';
  children: ReactNode;
};

export type PolymorphicButtonProps<T extends ElementType = 'button'> = 
  ButtonBaseProps<T> & Omit<ComponentPropsWithoutRef<T>, keyof ButtonBaseProps<T>>;

export function Button<T extends ElementType = 'button'>({
  as,
  variant = 'primary',
  children,
  className = '',
  ...restProps
}: PolymorphicButtonProps<T>) {
  const Component = as || 'button';
  const variantClass = `btn-${variant}`;

  return (
    <Component className={`btn ${variantClass} ${className}`} {...restProps}>
      {children}
    </Component>
  );
}

// Usage Example:
// 1. Renders as native button:
const StandardBtn = <Button onClick={() => alert('Clicked')}>Submit</Button>;

// 2. Renders as an anchor link with href type safety:
const LinkBtn = <Button as="a" href="https://google.com" target="_blank">Google</Button>;
```

---

## 17. Common Interview Traps
- **Trap**: "Does `props.children` always represent an array of elements?"
  - *Trap Explanation*: **No!** If a component has only one child, `props.children` is a single object. If it has no children, `props.children` is `undefined`. Only when there are multiple siblings is it an array. To safely manipulate children without type errors, always use the `React.Children` utilities (e.g. `React.Children.map(props.children, ...)`).
- **Trap**: "Can we use `defaultProps` in modern React with TypeScript functional components?"
  - *Trap Explanation*: `defaultProps` on functional components is **officially deprecated** by the React team and triggers warnings in modern versions. Always use standard ES6 default parameter destructuring: `function MyComponent({ size = 'medium' }: Props)`.

---

## 18. Revision Summary
- **Props**: Read-only inputs passed from parent to child to parameterize components.
- **Unidirectional Flow**: Props flow down; event callbacks flow up.
- **Immutability**: React shallow-freezes props in development (`Object.freeze`); components must be pure.
- Avoid **Prop Drilling** using Component Composition (`children`) or Context.
- Inline objects and functions create new references every render, breaking `React.memo`.
- Never copy props into initial `useState` unless you explicitly want to ignore future prop updates.

---

## 19. Quick Reference Cheat Sheet
```tsx
// 1. Clean Typed Props with ES6 Defaults:
interface CardProps {
  title: string;
  count?: number;
  onSelect: (id: string) => void;
}

export function Card({ title, count = 0, onSelect }: CardProps) { ... }

// 2. The Children Slot Pattern:
export function Container({ children }: { children: React.ReactNode }) {
  return <div className="layout-wrapper">{children}</div>;
}
```
