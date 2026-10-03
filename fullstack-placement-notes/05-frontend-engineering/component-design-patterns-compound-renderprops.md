# Component Design Patterns: Compound Components, Render Props & Polymorphism

## 1. What is it?
**Component Design Patterns** are architectural blueprints for structuring UI components to maximize reusability, maintainability, and developer ergonomics while preventing prop-drilling and bloated monolithic APIs.

The three foundational advanced patterns in modern frontend engineering are:
1. **Compound Components**: A pattern where a group of related components work together to manage shared state implicitly (e.g., `<Select>`, `<Select.Option>`), giving the consumer complete declarative control over JSX layout.
2. **Render Props**: A technique for sharing code between React components using a prop whose value is a function that returns JSX.
3. **The Slot / Polymorphic Pattern**: Allowing a component to change its underlying HTML element or merge its props onto an immediate child (pioneered by Radix UI's `Slot`).

---

## 2. Why does it exist?
Consider what happens when building a reusable `<Dropdown />` component naively:
```tsx
// ❌ MONOLITHIC PROP-HEAVY DESIGN:
<Dropdown
  options={items}
  selectedItem={selected}
  onSelect={handleSelect}
  renderCustomItem={fn}
  headerTitle="Choose"
  showSearch={true}
  searchPlaceholder="Search..."
  dropdownPosition="bottom-right"
  emptyStateText="No options found"
  footerButtonLabel="Create new"
  onFooterButtonClick={handleCreate}
/>
```
### Why Monolithic Components Fail:
1. **Combinatorial Explosion of Props**: Every time a designer asks for a small variation (e.g. "put a divider between option 2 and 3"), you have to add another boolean flag (`hasDividers`, `dividerIndices`). Soon the component has 60 props.
2. **Brittle Layout**: The consumer cannot rearrange the header, search box, or items without modifying the core internal component code.
3. **The Compound Component Solution**: Split the monolithic component into coordinated sub-components:
   ```tsx
   <Dropdown value={selected} onChange={handleSelect}>
     <Dropdown.Trigger>Select a Country</Dropdown.Trigger>
     <Dropdown.Menu>
       <Dropdown.Search />
       <Dropdown.Item value="us">United States</Dropdown.Item>
       <Dropdown.Divider />
       <Dropdown.Item value="uk">United Kingdom</Dropdown.Item>
     </Dropdown.Menu>
   </Dropdown>
   ```

---

## 3. Mental Model: HTML `<select>` and `<option>`
💡 **Think of Native Browser HTML:**

```
<select name="cars" id="cars">
  <option value="volvo">Volvo</option>
  <option value="saab">Saab</option>
</select>
```
- In HTML, `<select>` manages the selected state and keyboard navigation.
- The `<option>` elements don't need you to pass `onChange` or `selectedValue` to every single option!
- They communicate **implicitly behind the scenes**. Compound components bring this exact native browser elegance to React using React Context.

---

## 4. Basic Example: Building a Compound `<Tabs>` System

```tsx
import React, { createContext, useContext, useState, type ReactNode } from 'react';

// 1. Shared Context for State Coordination
interface TabsContextValue {
  activeTab: string;
  setActiveTab: (id: string) => void;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('Tabs sub-components must be rendered within a <Tabs> parent!');
  }
  return context;
}

// 2. Parent Container Component
export function Tabs({
  defaultTab,
  children,
}: {
  defaultTab: string;
  children: ReactNode;
}) {
  const [activeTab, setActiveTab] = useState(defaultTab);

  return (
    <TabsContext.Provider value={{ activeTab, setActiveTab }}>
      <div className="tabs-container">{children}</div>
    </TabsContext.Provider>
  );
}

// 3. Tab Trigger Button
Tabs.Tab = function Tab({ id, children }: { id: string; children: ReactNode }) {
  const { activeTab, setActiveTab } = useTabsContext();
  const isActive = activeTab === id;

  return (
    <button
      role="tab"
      aria-selected={isActive}
      className={`tab-btn ${isActive ? 'tab-active' : ''}`}
      onClick={() => setActiveTab(id)}
    >
      {children}
    </button>
  );
};

// 4. Tab Content Panel
Tabs.Panel = function Panel({ id, children }: { id: string; children: ReactNode }) {
  const { activeTab } = useTabsContext();
  if (activeTab !== id) return null;

  return (
    <div role="tabpanel" className="tab-panel">
      {children}
    </div>
  );
};
```

### Clean Consumer Usage:
```tsx
export function SettingsPage() {
  return (
    <Tabs defaultTab="profile">
      <div className="tab-bar">
        <Tabs.Tab id="profile">User Profile</Tabs.Tab>
        <Tabs.Tab id="security">Security & 2FA</Tabs.Tab>
      </div>

      <div className="content">
        <Tabs.Panel id="profile">
          <p>Profile configuration inputs go here...</p>
        </Tabs.Panel>
        <Tabs.Panel id="security">
          <p>Password change form goes here...</p>
        </Tabs.Panel>
      </div>
    </Tabs>
  );
}
```

---

## 5. The Render Props Pattern

Render Props inversion gives the consumer access to internal component calculations while delegating UI rendering:

```tsx
import { useState, type ReactNode } from 'react';

interface MousePosition {
  x: number;
  y: number;
}

interface MouseTrackerProps {
  children: (pos: MousePosition) => ReactNode;
}

export function MouseTracker({ children }: MouseTrackerProps) {
  const [pos, setPos] = useState<MousePosition>({ x: 0, y: 0 });

  return (
    <div
      style={{ height: '200px', border: '1px dashed #ccc' }}
      onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
    >
      {/* Consumer decides what to render with the coordinates! */}
      {children(pos)}
    </div>
  );
}

// Usage:
<MouseTracker>
  {({ x, y }) => <h3>Mouse is at coordinates: X: {x}, Y: {y}</h3>}
</MouseTracker>
```

---

## 6. The Slot Pattern (Radix UI / Shadcn Approach)

In modern design systems, instead of supporting endless `as="a"`, `as="button"`, `as={Link}` polymorphic props, components support an **`asChild`** prop using a **Slot**:

```tsx
import React, { cloneElement, isValidElement, type ReactElement } from 'react';

interface SlotProps extends React.HTMLAttributes<HTMLElement> {
  children?: React.ReactNode;
}

// Simplified conceptual Slot implementation
export function Slot({ children, ...props }: SlotProps) {
  if (isValidElement(children)) {
    // Merges Slot props and event handlers directly onto the single child element!
    return cloneElement(children as ReactElement<any>, {
      ...props,
      ...children.props,
      className: `${props.className || ''} ${children.props.className || ''}`.trim(),
    });
  }
  return null;
}

// Usage in Design System Button:
export function Button({ asChild, children, ...props }: { asChild?: boolean; children: React.ReactNode }) {
  const Component = asChild ? Slot : 'button';
  return <Component className="btn-base" {...props}>{children}</Component>;
}

// Renders an actual Next.js <Link> with Button styles without HTML validation warnings!
<Button asChild>
  <a href="/login">Log In</a>
</Button>
```

---

## 7. Important Rules

1. **Always Throw Guard Errors in Sub-Components**: If a consumer renders `<Tabs.Tab />` outside `<Tabs />`, throw an immediate descriptive error (`useTabsContext` check) rather than crashing with `Cannot read property of null`.
2. **Support Controlled and Uncontrolled Usage**: A compound component should ideally accept an optional `value` and `onChange` prop (controlled), or fall back to internal `defaultValue` state (uncontrolled).
3. **Compound Components Must Be Keyboard Accessible**: Coordinate ARIA attributes (`aria-selected`, `aria-expanded`, `role="tablist"`) across sub-components.

---

## 8. Common Mistakes

### Mistake 1: Relying on `React.Children.map` instead of Context for Compound Components
```tsx
// ❌ FRAGILE ANTI-PATTERN:
function Tabs({ children }) {
  return React.Children.map(children, child => {
    // This only works if child is an immediate direct descendant!
    // If the consumer wraps <Tab> inside a <div> or a custom container,
    // this silently breaks!
    return React.cloneElement(child, { activeTab });
  });
}

// ✅ CORRECT: Always use React Context to share state across arbitrary JSX depth!
```

---

## 9. Best Practices

1. **Attach Sub-components to the Parent Function**: Attach `Tabs.Tab = Tab` and `Tabs.Panel = Panel` for clean namespace discoverability in IDE autocomplete.
2. **Keep Sub-components Focused**: Each sub-component should have a single responsibility (Trigger, Content, Header, Footer).
3. **Export Sub-components Individually for Tree-Shaking**:
   ```tsx
   export { Tabs, Tab, TabPanel };
   ```

---

## 10. Performance Considerations

- **Context Splitting in High-Frequency Compound Components**: If state updates rapidly (e.g. slider scrubbing), split Context into a `StateContext` and a `DispatchContext` so static elements (like labels and wrappers) do not re-render.

---

## 11. Security Considerations

- In components that render user-generated markdown or dynamic tabs, sanitize string keys to prevent XSS injection into `id` and `aria-labelledby` attributes.

---

## 12. Alternatives

| Pattern | Inversion of Control | Best Use Case |
| :--- | :--- | :--- |
| **Compound Components** | High (Layout & Composition) | Navigation, Tabs, Modals, Accordions |
| **Render Props** | Maximum (Full rendering control) | Virtualized lists, dynamic canvas rendering |
| **Custom Hooks** | Headless (Zero UI constraints) | Data fetching, form state, media queries |
| **Slot Pattern (`asChild`)**| High (Element substitution) | Design systems (Buttons, Links) |

---

## 13. Trade-offs

- **Compound Components Benefit**: Unmatched consumer flexibility; declarative code; zero prop explosion.
- **Compound Components Cost**: Requires writing context boilerplate; slightly larger component surface area.

---

## 14. Real-World Usage

- **Radix UI / Shadcn**: Built entirely on Compound Components and the Slot pattern (`<Dialog.Root>`, `<Dialog.Trigger>`, `<Dialog.Content>`).
- **Headless UI (Tailwind)**: Powers unstyled, accessible UI primitives.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the Compound Component pattern in React?**  
*Answer*: The Compound Component pattern is an architectural design where a set of related components share state implicitly through React Context to achieve a coordinated task (like `<Select>` and `<Select.Option>`). It gives the consuming developer total flexibility over the JSX layout and DOM structure without requiring a massive list of configuration props on a single monolithic parent component.

### Conceptual
**Q: Why is using React Context superior to using `React.Children.map` and `React.cloneElement` for compound components?**  
*Answer*: `React.Children.map` and `cloneElement` only work on immediate direct child elements. If the consumer wraps a child in a formatting `<div>`, a flex container, or an animation wrapper, the parent can no longer reach or clone the grandchild component, breaking state communication. React Context penetrates arbitrary DOM nesting depth seamlessly, allowing consumers to organize sub-components in whatever layout hierarchy they desire.

### Implementation
**Q: Implement a reusable `<Toggle>` compound component featuring `<Toggle.On>`, `<Toggle.Off>`, and `<Toggle.Button>`.**  
*Answer*:
```tsx
import { createContext, useContext, useState, ReactNode } from 'react';

const ToggleContext = createContext<{ on: boolean; toggle: () => void } | null>(null);

export function Toggle({ children }: { children: ReactNode }) {
  const [on, setOn] = useState(false);
  return (
    <ToggleContext.Provider value={{ on, toggle: () => setOn(!on) }}>
      {children}
    </ToggleContext.Provider>
  );
}

Toggle.On = ({ children }: { children: ReactNode }) => {
  const { on } = useContext(ToggleContext)!;
  return on ? <>{children}</> : null;
};

Toggle.Off = ({ children }: { children: ReactNode }) => {
  const { on } = useContext(ToggleContext)!;
  return !on ? <>{children}</> : null;
};

Toggle.Button = () => {
  const { toggle } = useContext(ToggleContext)!;
  return <button onClick={toggle}>Switch State</button>;
};
```

### Debugging
**Q: A consumer uses your compound component sub-element directly, but the application throws `Cannot read properties of null (reading 'activeTab')`. How do you provide a professional developer experience for this error?**  
*Answer*: Wrap the `useContext` call in a custom hook that checks whether the context is `null`. If `null`, throw a clear, human-readable Error explaining that the sub-component must be rendered as a child of the parent:
```tsx
function useMyContext() {
  const ctx = useContext(MyContext);
  if (!ctx) {
    throw new Error('Component must be used within its parent Provider hierarchy!');
  }
  return ctx;
}
```

### Scenario
**Q: In your design system, you have a `<Button>` component. A developer needs the Button to visually look identical to a button, but render semantically as an `<a>` tag or Next.js `<Link>` for SEO. How do you implement this cleanly?**  
*Answer*: Use the **Slot pattern (`asChild`)** popularized by Radix UI. If `asChild` is true, instead of rendering a `<button>`, the component renders a `<Slot>` that clones its child and merges the design system's CSS classes, event handlers, and ARIA attributes onto the consumer's `<Link>` or `<a>` element, ensuring semantic correctness and zero extra DOM wrappers.

### Advanced
**Q: What is the "Control Props" pattern in React, and how is it implemented?**  
*Answer*: Control Props is a pattern that allows a component to function in both **Uncontrolled** and **Controlled** modes simultaneously (similar to how `<input>` works with `defaultValue` vs `value`). The component maintains an internal state variable, but inspects its incoming props: if an explicit controlled prop (e.g. `value !== undefined`) is passed by the parent, the component ignores its internal state and uses the parent's value, delegating state updates to the parent's `onChange` callback.

---

## 16. Coding Challenge: Accessible Accordion with Compound Pattern

**Task**: Implement a production-ready `<Accordion>` compound component with single-expand behavior and full ARIA accessibility.

```tsx
import { createContext, useContext, useState, ReactNode } from 'react';

interface AccordionContextType {
  activeId: string | null;
  toggle: (id: string) => void;
}

const AccordionContext = createContext<AccordionContextType | null>(null);

export function Accordion({ children }: { children: ReactNode }) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const toggle = (id: string) => {
    setActiveId((prev) => (prev === id ? null : id));
  };

  return (
    <AccordionContext.Provider value={{ activeId, toggle }}>
      <div className="accordion-root">{children}</div>
    </AccordionContext.Provider>
  );
}

Accordion.Item = function Item({ id, children }: { id: string; children: ReactNode }) {
  return <div className="accordion-item" data-item-id={id}>{children}</div>;
};

Accordion.Trigger = function Trigger({ id, children }: { id: string; children: ReactNode }) {
  const ctx = useContext(AccordionContext);
  if (!ctx) throw new Error('Trigger must be inside Accordion');
  const isOpen = ctx.activeId === id;

  return (
    <button
      className="accordion-trigger"
      onClick={() => ctx.toggle(id)}
      aria-expanded={isOpen}
      aria-controls={`panel-${id}`}
      id={`trigger-${id}`}
    >
      {children}
    </button>
  );
};

Accordion.Content = function Content({ id, children }: { id: string; children: ReactNode }) {
  const ctx = useContext(AccordionContext);
  if (!ctx) throw new Error('Content must be inside Accordion');
  if (ctx.activeId !== id) return null;

  return (
    <div
      id={`panel-${id}`}
      role="region"
      aria-labelledby={`trigger-${id}`}
      className="accordion-content"
    >
      {children}
    </div>
  );
};
```

---

## 17. Common Interview Traps

1. **"Compound components can only be used with class components."**  
   *Trap*: Thinking it is a legacy pattern.  
   *Reality*: Modern compound components are written entirely with functional components and React Context (`createContext` + `useContext`).
2. **"Render Props are obsolete because of Custom Hooks."**  
   *Trap*: Claiming render props are completely dead.  
   *Reality*: While custom hooks replaced render props for headless state logic, render props remain essential for **dynamic layout rendering** (such as virtualized list item renderers in `react-window` or chart data points).

---

## 18. Revision Summary

- **Compound Components**: Related components sharing state implicitly via React Context.
- Eliminates prop explosion and gives consumers complete layout control.
- Always validate context presence with custom consumer hooks.
- **Slot Pattern (`asChild`)**: Merges props onto child elements, solving polymorphism cleanly.
- **Render Props**: Delegates JSX rendering decisions to consumer functions.

---

## 19. Quick Reference

```tsx
// Compound Structure Pattern
const Ctx = createContext(null);

function Parent({ children }) {
  const [val, setVal] = useState(0);
  return <Ctx.Provider value={{ val, setVal }}>{children}</Ctx.Provider>;
}

Parent.ChildA = () => { const { val } = useContext(Ctx); return <span>{val}</span>; };
Parent.ChildB = () => { const { setVal } = useContext(Ctx); return <button onClick={() => setVal(v => v + 1)}>+</button>; };
```
