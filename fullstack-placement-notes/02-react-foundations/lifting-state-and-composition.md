# Lifting State Up & Component Composition (Inversion of Control)

## 1. What is it?
In React applications, components frequently need to share data or reflect the same changing state. 

**Lifting State Up** is the fundamental React architectural pattern of moving a piece of state from child components up to their **closest common ancestor**. The parent becomes the "Single Source of Truth", passing the state down to children as read-only props and receiving change requests through callback functions.

**Component Composition** is the practice of combining smaller, focused components together using the `children` prop and specialized slot props. It allows developers to solve the infamous **Prop Drilling** problem through **Inversion of Control (IoC)** without reaching for heavy external state management libraries.

---

## 2. Why does it exist?
1. **The Sibling Synchronization Problem**: Two sibling components (like a `SearchInput` and a `SearchResultsList`) cannot talk to each other directly because React enforces strict Unidirectional Data Flow (data only flows down from parents, never sideways between siblings). To synchronize them, state must be lifted to their common parent.
2. **The Prop Drilling Anti-Pattern**: When state lives 5 levels up in the tree, passing it down through 4 intermediate components that don't need it creates brittle, tightly-coupled code. Component composition eliminates this by inverting control.

---

## 3. Mental Model
💡 **Think of it like Shared Water Wells and Nested Russian Dolls:**
- **Lifting State Up (The Shared Village Well)**:
  - If House A and House B both need fresh water, they don't dig a secret tunnel between their basements (**No sideways sibling communication**).
  - Instead, the Village Council (**Common Parent Component**) digs a centralized water well in the town square (**Lifts State Up**).
  - Both House A and House B run pipes to the central well (**Props**).
- **Component Composition (Inversion of Control / Russian Matryoshka Dolls)**:
  - Instead of giving a delivery courier a locked box and telling them: *"Deliver this box to the basement, tell the butler to open it, give the inner envelope to the maid, and tell her to hand the letter to the kid"*,
  - The parent simply puts the kid inside the car, hands them the letter directly, and drives to the house (**`<House><Basement><Kid letter={secret} /></Basement></House>`**)! The courier (intermediate component) doesn't need to know the letter exists!

### Visualizing State Lifting vs. Composition
```
LIFTING STATE UP TO CLOSEST COMMON ANCESTOR:
                  ┌──────────────────────┐
                  │    <ParentPage />    │  ◄── STATE LIFTED HERE: [query, setQuery]
                  └──────────┬───────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼ (Passes callback: onChange)     ▼ (Passes data: query)
   ┌─────────────────┐               ┌─────────────────┐
   │  <SearchBar />  │               │ <ResultsList /> │
   └─────────────────┘               └─────────────────┘

─────────────────────────────────────────────────────────────────────────────

SOLVING PROP DRILLING VIA COMPOSITION (Inversion of Control):
❌ Prop Drilling (Intermediate components forced to forward props):
   <Page user={user}> ──► <Header user={user}> ──► <Nav user={user}> ──► <Avatar user={user} />

✅ Composition (Children Slot Pattern - Zero Prop Drilling!):
   <Page>
     <Header>
       <Nav>
         <Avatar user={user} />  {/* Passed directly! Header and Nav don't touch user! */}
       </Nav>
     </Header>
   </Page>
```

---

## 4. Basic Example: Lifting State Between Currency Converters

```tsx
// CurrencyConverter.tsx
import React, { useState } from 'react';

interface CurrencyInputProps {
  label: string;
  amount: number;
  onAmountChange: (amount: number) => void;
}

function CurrencyInput({ label, amount, onAmountChange }: CurrencyInputProps) {
  return (
    <div className="currency-field">
      <label>{label}:</label>
      <input
        type="number"
        value={isNaN(amount) ? '' : amount}
        onChange={(e) => onAmountChange(parseFloat(e.target.value) || 0)}
      />
    </div>
  );
}

export function CurrencyCalculator() {
  // 1. Lift state up to the closest common parent:
  const [usd, setUsd] = useState<number>(100);

  // 2. Derive EUR from USD dynamically:
  const exchangeRate = 0.92;
  const eur = usd * exchangeRate;

  const handleUsdChange = (newUsd: number) => setUsd(newUsd);
  const handleEurChange = (newEur: number) => setUsd(newEur / exchangeRate);

  return (
    <div className="converter-card">
      <h3>Live Currency Converter</h3>
      <CurrencyInput label="USD ($)" amount={usd} onAmountChange={handleUsdChange} />
      <CurrencyInput label="EUR (€)" amount={eur} onAmountChange={handleEurChange} />
    </div>
  );
}
```

---

## 5. Real Example: Eliminating Prop Drilling with Inversion of Control
Refactoring a deep dashboard hierarchy using the **Slot Pattern**:

```tsx
// CompositionDashboard.tsx
import React, { ReactNode } from 'react';

// Child components that DO NOT need to know about 'currentUser':
function Sidebar({ children }: { children: ReactNode }) {
  return <aside className="sidebar-nav">{children}</aside>;
}

function Navigation({ children }: { children: ReactNode }) {
  return <nav className="nav-links">{children}</nav>;
}

function UserBadge({ user }: { user: { name: string; avatar: string } }) {
  return (
    <div className="user-badge">
      <img src={user.avatar} alt={user.name} />
      <span>{user.name}</span>
    </div>
  );
}

// Parent Component: Assembles components together using Inversion of Control!
export function AppShell() {
  const currentUser = { name: 'Goutam', avatar: 'https://avatar.url/1.png' };

  return (
    <div className="app-shell">
      {/* Zero prop drilling! UserBadge is injected directly into Navigation */}
      <Sidebar>
        <Navigation>
          <a href="/home">Home</a>
          <a href="/projects">Projects</a>
          <UserBadge user={currentUser} />
        </Navigation>
      </Sidebar>
    </div>
  );
}
```

---

## 6. Under the Hood: Why Inversion of Control Optimizes React Rendering

When you use the `children` prop pattern:
```tsx
function Layout({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState('light');
  return (
    <div className={`theme-${theme}`}>
      <button onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}>
        Toggle Theme
      </button>
      {children}
    </div>
  );
}
```

### The Rendering Secret:
1. When the `theme` state changes inside `<Layout />`, `<Layout />` re-renders.
2. But what happens to `{children}`?
   - `{children}` was created in `<Layout />`'s parent component.
   - Its React Element object (`type`, `props`, `key`) **already exists and was not re-evaluated**!
3. Because the `children` prop object reference is identical (`Object.is(oldChildren, newChildren) === true`), React's reconciler **bails out of re-rendering the entire children subtree**!
4. **Result**: You updated the theme wrapper without re-rendering the heavy 1,000-component subtree inside `{children}`!

---

## 7. Important Rules & Invariants
1. **Lift State to the CLOSEST Common Ancestor (Not the Root!)**:
   - Only lift state as high as strictly necessary to bridge the communicating siblings.
   - Putting localized search query state at the top-level `<App />` component will cause the entire application to re-render on every keystroke!
2. **Single Source of Truth**: When state is lifted up, do not keep a duplicate copy in the children. Pass it strictly as a prop.
3. **Children are Evaluated in the Parent Scope**: A component passed into `{children}` has access to the variables and state of the parent where it was defined, not the wrapper component where it is rendered.

---

## 8. Common Mistakes & Anti-Patterns

### ❌ Mistake 1: The "Lift Everything to App.tsx" Trap
- **The Mistake**: A developer has 10 different pages. Instead of keeping modal states, dropdown states, and filter states local to their pages, they put 40 `useState` hooks inside `App.tsx` and drill them down 8 layers.
- **The Impact**: Typing 1 letter into a search input re-renders the Navbar, Sidebar, Footer, and all unrelated dashboard widgets!
- **✅ The Fix**: State Colocation. Keep state inside the lowest common parent.

### ❌ Mistake 2: Mutating Lifted State in Child Callbacks
- A child receives `user` and `onUpdateUser`. The child mutates `user.email = 'new@mail.com'` and then calls `onUpdateUser()`.
- Always treat lifted state as immutable; child passes the new delta object back through the callback.

---

## 9. Best Practices in Modern Production
1. **Combine Lifting State with Custom Hooks**: If the lifted state logic becomes complex (multiple setters, validation, localStorage syncing), extract it into a custom hook: `const { usd, eur, setUsd } = useCurrencyConverter()`.
2. **Use Multiple Slot Props for Complex Layouts**:
   ```tsx
   <SplitView 
     leftPane={<NavigationMenu />} 
     rightPane={<DataGrid />} 
     footer={<StatusBar />} 
   />
   ```
3. **Prefer Composition Over Context for 1-3 Levels**: Do not reach for React Context just to skip 2 levels of props. Context adds testing boilerplate; composition with `{children}` solves it with zero boilerplate.

---

## 10. Performance Considerations: Rendering Isolation
By using component composition, you can isolate state changes to a tiny island of the component tree:
```tsx
export function Page() {
  return (
    <ScrollWatcher>
      {/* HeavyContent will NOT re-render when ScrollWatcher's scroll state updates! */}
      <HeavyDataGrid items={10000} />
    </ScrollWatcher>
  );
}
```

---

## 11. Security Considerations: Children Component Spoofing
When accepting `{children: ReactNode}`, users or third-party plugins could pass unexpected element types. If building strict container architectures (like an `<Accordion>` that only permits `<AccordionItem>` children), use `React.Children.forEach` and check `child.type === AccordionItem` to ensure markup integrity.

---

## 12. Complete Comparison: Prop Drilling Solutions
| Strategy | Implementation | When to Use | Trade-offs |
|---|---|---|---|
| **Lifting State Up** | Common parent holds state; passes props down. | Siblings in close proximity (1-2 levels). | Direct, simple, easy to debug. |
| **Component Composition**| Passing JSX as `children` or named slot props. | Bypassing 2-4 intermediate container layers. | Eliminates prop drilling with zero external dependencies. |
| **React Context** | `createContext` + `useContext` provider. | App-wide global data (Theme, Auth, Language). | Overuse can trigger unnecessary re-renders in deep trees. |
| **Zustand / Redux** | External state store with atomic selectors. | High-frequency shared transactional data. | Requires learning an external library. |

---

## 13. Trade-offs: Composition vs. Rigid Props
- **Rigid Configuration Props (`<Card title="Title" subtitle="Sub" buttonText="Click" />`)**:
  - *Pro*: Enforces strict design system consistency.
  - *Con*: Inflexible. If a designer wants an icon next to the title tomorrow, you must add `titleIcon` prop; if they want a badge, you must add `titleBadge` prop.
- **Flexible Composition (`<Card><Card.Title><Icon /> Title <Badge /></Card.Title></Card>`)**:
  - *Pro*: Infinite flexibility; never needs new props for custom layouts.
  - *Con*: Requires developers to assemble components correctly.

---

## 14. Real-World Usage: React Router & Next.js Layouts
Next.js App Router's entire layout system is built on **Component Composition**:
```tsx
// layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <GlobalNavbar />
        <main>{children}</main> {/* Pages are slotted in via composition! */}
        <GlobalFooter />
      </body>
    </html>
  );
}
```
When navigating between `/dashboard` and `/settings`, `<GlobalNavbar />` and `<GlobalFooter />` remain mounted without re-rendering; only `{children}` updates!

---

## 15. Placement Interview Questions

### Basic (Intern)
1. **What does 'Lifting State Up' mean in React, and when should you do it?**
   - *Spoken Answer*: "'Lifting State Up' is the practice of moving state from child components up to their closest common ancestor in the component tree. You should do it whenever two or more sibling components need to reflect the same changing data or stay synchronized with each other, because React's unidirectional data flow prevents siblings from sharing state directly."

### Conceptual (Junior SDE)
2. **How does Component Composition solve Prop Drilling through Inversion of Control?**
   - *Spoken Answer*: "Prop drilling occurs when intermediate components must receive and forward props they don't care about. Component Composition inverts this control: instead of the parent telling the intermediate component how to build the child, the top-level parent creates the child element directly with its props and passes it down via `{children}` or named slots. The intermediate components simply render `{children}` without ever knowing what props the child requires."

### Implementation (SDE-1)
3. **Why does passing a component via the `children` prop prevent it from re-rendering when the wrapper component's state changes?**
   - *Spoken Answer*: "Because the `children` element is instantiated in the outer parent component's scope, not inside the wrapper component. When the wrapper component's internal state updates and it re-renders, its `props.children` object reference remains referentially identical (`Object.is(prevChildren, nextChildren) === true`). React's reconciliation engine recognizes that the children element did not change and bails out of re-rendering that subtree entirely."

### Debugging
4. **A developer lifted state to `<App />`. Now, typing in a search bar causes the entire website (including heavy charts) to stutter and drop frames. How do you fix it?**
   - *Analysis*: State was lifted **too high**. The search query state is not needed by the entire application; placing it in `App.tsx` forces the entire component tree to re-evaluate on every keystroke.
   - *Fix*: Move the search state down to the specific `<SearchContainer />` that encompasses only the search input and the results table, isolating the re-render boundary.

### Scenario-Based
5. **You are building an Accordion component where only one item can be expanded at a time. How would you design its state and composition?**
   - *Spoken Answer*: "Lift the `activeItemId` state to the `<Accordion>` parent component:
     ```tsx
     <Accordion>
       <AccordionItem id="1" title="Section 1">Content 1</AccordionItem>
       <AccordionItem id="2" title="Section 2">Content 2</AccordionItem>
     </Accordion>
     ```
     The `<Accordion>` parent tracks `const [openId, setOpenId] = useState<string | null>(null)`. It clones or provides context to each `<AccordionItem>`, passing `isOpen={openId === item.id}` and `onToggle={() => setOpenId(item.id)}`. This ensures single-item exclusivity."

### Advanced (Tier-1 Product Company)
6. **Compare the Compound Components pattern with the Render Props pattern.**
   - *Spoken Answer*: "Both patterns solve component flexibility and logic sharing:
     - **Compound Components** (e.g. `<Select><Option /></Select>`): Multiple components share implicit state behind the scenes via internal React Context. It provides clean, declarative JSX and decouples visual layout from component logic.
     - **Render Props** (e.g. `<Mouse render={({ x, y }) => <Display x={x} y={y} />} />`): A component receives a function that returns JSX, explicitly exposing its internal state to the consumer. While powerful, render props can lead to 'callback hell' in JSX. Modern React generally prefers Custom Hooks for headless logic and Compound Components for UI structure."

---

## 16. Placement Coding Challenge: Compound Tabs Component
Implement a fully functional, composable Tabs component using Context and Composition:

```tsx
// Tabs.tsx
import React, { createContext, useContext, useState, ReactNode } from 'react';

interface TabsContextType {
  activeTab: string;
  setActiveTab: (id: string) => void;
}

const TabsContext = createContext<TabsContextType | undefined>(undefined);

// 1. Root Container
export function Tabs({ defaultTab, children }: { defaultTab: string; children: ReactNode }) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className="tabs-container">{children}</div>
    </TabsContext.Provider>
  );
}

// 2. Tab Trigger Button
export function TabTrigger({ id, children }: { id: string; children: ReactNode }) {
  const context = useContext(TabsContext);
  if (!context) throw new Error('TabTrigger must be used within <Tabs>');

  const isActive = context.activeTab === id;
  return (
    <button
      className={`tab-btn ${isActive ? 'active font-bold border-b-2' : ''}`}
      onClick={() => context.setActiveTab(id)}
    >
      {children}
    </button>
  );
}

// 3. Tab Content Panel
export function TabContent({ id, children }: { id: string; children: ReactNode }) {
  const context = useContext(TabsContext);
  if (!context) throw new Error('TabContent must be used within <Tabs>');

  if (context.activeTab !== id) return null;
  return <div className="tab-panel p-4">{children}</div>;
}

// Usage Example:
export function DemoTabs() {
  return (
    <Tabs defaultTab="profile">
      <div className="flex gap-4 border-b">
        <TabTrigger id="profile">Profile</TabTrigger>
        <TabTrigger id="settings">Settings</TabTrigger>
      </div>
      <TabContent id="profile"><h3>User Profile Content</h3></TabContent>
      <TabContent id="settings"><h3>App Settings Content</h3></TabContent>
    </Tabs>
  );
}
```

---

## 17. Common Interview Traps
- **Trap**: "Should you always use Redux or Zustand if you have prop drilling?"
  - *Trap Explanation*: **No!** Jumping straight to Redux for 2-3 levels of prop drilling is premature optimization. First attempt **Component Composition** (passing elements as `children`). If data is truly global (Auth, Theme), use **React Context**. Only use external stores for complex, high-frequency state.
- **Trap**: "Does lifting state up always slow down your application?"
  - *Trap Explanation*: Only if you lift state **too high** (e.g. to the root of the app). Lifting state to the immediate parent of two small sibling inputs has zero noticeable performance overhead and keeps state localized.

---

## 18. Revision Summary
- **Lifting State Up**: Move state to the closest common ancestor to synchronize sibling components.
- **Unidirectional Flow**: State lives in the parent; passed as props; updated via callbacks.
- **Component Composition**: Pass JSX as `children` or slots to eliminate prop drilling through Inversion of Control.
- Passing components via `children` bails out of re-renders when the wrapper updates!
- Keep state as close as possible to where it is consumed (**State Colocation**).

---

## 19. Quick Reference Cheat Sheet
```tsx
// 1. Lifting State Up Pattern:
function Parent() {
  const [value, setValue] = useState('');
  return (
    <>
      <ChildA value={value} onChange={setValue} />
      <ChildB value={value} />
    </>
  );
}

// 2. Composition (Inversion of Control) Pattern:
function Layout({ children }: { children: React.ReactNode }) {
  return <div className="shell">{children}</div>;
}

// Usage:
<Layout><DeepChild user={user} /></Layout>
```
