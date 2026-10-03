# Synthetic Events & Event Delegation in React

## 1. What is it?
A **SyntheticEvent** is React's cross-browser wrapper around the browser's native DOM event. It provides a standardized, unified API interface that works identically across all modern and legacy web browsers (Chrome, Safari, Firefox, Edge).

Instead of attaching individual event listeners to thousands of discrete DOM nodes (which would consume excessive memory), React uses **Event Delegation**: it attaches a single listener for each event type at the **root DOM container (`#root`)** and dispatches events to the correct component handlers using internal Fiber tree traversal.

> 🔗 *Prerequisite Knowledge*: To review native browser event propagation, bubbling vs. capturing, and event delegation, consult [`javascript-placement-notes/07-dom/events.md`](../../javascript-placement-notes/07-dom/events.md) and [`javascript-placement-notes/07-dom/event-delegation-deep-dive.md`](../../javascript-placement-notes/07-dom/event-delegation-deep-dive.md).

---

## 2. Why does it exist?
1. **Cross-Browser Inconsistencies**: Historically, different browser engines had conflicting event APIs (e.g. `e.target` vs. `e.srcElement`, `addEventListener` vs. `attachEvent`, differences in mouse wheel and keyboard codes). SyntheticEvent normalizes these quirks so developers write clean code once.
2. **Performance & Memory Optimization**: If an e-commerce page renders 1,000 product cards, attaching native `addEventListener('click', ...)` directly to 1,000 DOM buttons wastes significant memory. React solves this by binding **only 1 listener** at the top root container.

---

## 3. Mental Model
💡 **Think of it like an International Airport Translator & Central Switchboard:**
- **The Native Event (Local Dialect)**: A passenger arrives speaking an obscure regional dialect (**Native Browser Event**).
- **The SyntheticEvent (The Universal Translator)**: The translator steps in, listens to the passenger, and translates their words into standardized International English (**SyntheticEvent**).
- **Event Delegation (The Central Mailroom)**: Instead of stationing 1,000 security guards inside every single office room of a skyscraper, the building places **one single security guard at the front lobby revolving door (`#root`)**. When a package arrives for Room 402, the lobby guard checks the address label (**`e.target`**) and routes it directly to Room 402's desk.

### React Event Delegation Architecture
```
[ User Clicks Button: <button onClick={handleClick}>Delete</button> ]
                             │
                             ▼ (Native Browser Event Bubbles Up DOM Tree)
                  <div class="card">
                             │
                             ▼
                  <div id="root">  ◄── [ REACT LISTENER ATTACHED HERE! ]
                             │
                             ▼
  ┌────────────────────────────────────────────────────────┐
  │                 REACT EVENT SYSTEM                     │
  │  1. Intercepts native event at #root                   │
  │  2. Wraps native event in SyntheticEvent object        │
  │  3. Traverses internal Fiber tree to locate target     │
  │  4. Invokes your component's onClick={handleClick}     │
  └────────────────────────────────────────────────────────┘
```

---

## 4. Basic Example: Handling Synthetic Events in TypeScript

```tsx
// EventDemo.tsx
import React, { MouseEvent, ChangeEvent, FormEvent } from 'react';

export function EventDemo() {
  // 1. Mouse Event Typing:
  const handleButtonClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.preventDefault(); // Prevents default browser behavior
    console.log('[React Event] Clicked coordinates:', e.clientX, e.clientY);
    console.log('[Native Event]', e.nativeEvent); // Access underlying browser event
  };

  // 2. Change Event Typing:
  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    console.log('[Input Value]:', e.target.value);
  };

  // 3. Form Submit Event Typing:
  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); // Prevents page reload
    console.log('Form submitted securely without reload');
  };

  return (
    <form onSubmit={handleSubmit}>
      <input type="text" onChange={handleInputChange} placeholder="Type something..." />
      <button onClick={handleButtonClick}>Submit</button>
    </form>
  );
}
```

---

## 5. Real Example: Capturing vs. Bubbling Phase Handlers
Like native DOM events, React supports both the Bubbling and Capturing phases:
- `onClick`: Triggers during the **Bubbling Phase** (standard, inside-out).
- `onClickCapture`: Triggers during the **Capturing Phase** (outside-in, top-down).

```tsx
// PropagationDemo.tsx
import React from 'react';

export function PropagationDemo() {
  return (
    <div 
      className="outer-box"
      onClickCapture={() => console.log('1. Outer CAPTURE (Parent sees event first!)')}
      onClick={() => console.log('4. Outer BUBBLE (Parent sees event last)')}
    >
      <div 
        className="inner-box"
        onClick={() => console.log('2. Inner BUBBLE')}
      >
        <button 
          onClick={(e) => {
            console.log('3. Button Clicked');
            // e.stopPropagation(); // Uncommenting halts bubbling to parent!
          }}
        >
          Click Me
        </button>
      </div>
    </div>
  );
}
```

**Console Output on Button Click:**
```
1. Outer CAPTURE (Parent sees event first!)
2. Button Clicked
3. Inner BUBBLE
4. Outer BUBBLE (Parent sees event last)
```

---

## 6. Under the Hood: React 16 vs. React 17 Event Delegation Shift

One of the most consequential architectural changes in React history was the **Event Delegation Root Shift** in React 17:

```
REACT 16 (Attached to document)                REACT 17+ (Attached to #root container)
┌───────────────────────────────┐              ┌───────────────────────────────┐
│           document            │ ◄── LISTENER │           document            │
├───────────────────────────────┤              ├───────────────────────────────┤
│        <div id="root">        │              │  <div id="root"> ◄── LISTENER │
├───────────────────────────────┤              ├───────────────────────────────┤
│         <App />               │              │         <App />               │
└───────────────────────────────┘              └───────────────────────────────┘
```

### Why Did React Move from `document` to `#root`?
- **The Problem in React 16**: If an enterprise website had an existing jQuery application and wanted to embed a modern React widget, React attached its global listeners to `document`. If a legacy jQuery script executed `e.stopPropagation()` on a container, it stopped the event from bubbling up to `document`, silently breaking the React widget!
- **The Multi-Version Problem**: You could not run two different versions of React (e.g. React 16 and React 18) on the same page because both fought over the global `document` listener.
- **The React 17 Solution**: React 17+ attaches all listeners to the **specific root container** passed to `createRoot(document.getElementById('root'))`. Multiple independent React apps can now peacefully coexist on the same page!

---

## 7. The Death of Event Pooling (React 16 vs. React 17)

### What was Event Pooling in React 16?
In React 16 and earlier, React reused a single `SyntheticEvent` instance across all events to reduce garbage collection overhead.
- Once your event handler finished, React wiped all properties on the event object to `null`.
- If you tried to access `e.target` inside an asynchronous callback (like `setTimeout` or `Promise`), it crashed with:
  `TypeError: Cannot read properties of null`!
- Developers were forced to remember to call `e.persist()` to prevent wiping.

### The Modern Reality (React 17+):
- **Event Pooling was completely removed in React 17!**
- Modern V8 garbage collectors are so fast that allocating lightweight event wrappers has negligible overhead. You can now freely access `e.target` inside async functions without `e.persist()`.

---

## 8. Common Mistakes & Pitfalls

### ❌ Mistake 1: Invoking the Function Immediately in JSX
```tsx
// ❌ DISASTROUS TRAP: Infinite Render Loop!
<button onClick={handleDelete(item.id)}>Delete</button>
```
- **Why it breaks**: Parentheses `()` execute the function **immediately during render**, not when clicked! If `handleDelete` updates state, the component re-renders, executes the function again, and triggers an infinite loop!
- **✅ The Fix**: Pass an arrow function reference:
  ```tsx
  <button onClick={() => handleDelete(item.id)}>Delete</button>
  ```

### ❌ Mistake 2: Confusing `stopPropagation()` with `preventDefault()`
- **`e.preventDefault()`**: Prevents the browser's default native action (e.g. stops `<form>` from reloading the page, stops `<a>` from navigating to a URL). **It does NOT stop event bubbling!**
- **`e.stopPropagation()`**: Stops the event from traveling up the DOM tree to parent listeners. **It does NOT stop the default browser action!**

---

## 9. Best Practices in Modern Production
1. **Always Use `e.preventDefault()` on Forms**: Prevent accidental page reloads when submitting forms.
2. **Type Your Event Handlers Strictly in TypeScript**: Use `React.MouseEvent<HTMLButtonElement>`, `React.ChangeEvent<HTMLInputElement>`, and `React.KeyboardEvent<HTMLInputElement>` rather than loose `any`.
3. **Avoid Attaching Manual Native Listeners**: Stick to React JSX event props (`onClick`, `onKeyDown`). If you must use `window.addEventListener('resize', ...)`, **always clean it up** inside a `useEffect` return function to prevent memory leaks!

---

## 10. Performance Considerations: Event Delegation Benefits
Because React delegates events to `#root`, mounting and unmounting 5,000 rows in a virtualized table does not require 5,000 browser C++ DOM calls to `addEventListener` and `removeEventListener`. Event dispatch is handled purely in JavaScript memory via Fiber tree traversal, resulting in massive performance gains during complex DOM updates.

---

## 11. Security Considerations: Reverse Tabnabbing via `window.open`
When handling click events that open external links:
```tsx
<a href={externalUrl} target="_blank" rel="noopener noreferrer">External Site</a>
```
- If you omit `rel="noopener noreferrer"`, the newly opened external tab has access to `window.opener` and can execute `window.opener.location = "phishing.com"`, redirecting your original tab to a fake login clone!

---

## 12. Complete Comparison: React SyntheticEvents vs. Native DOM Events
| Feature | Native Browser DOM Event | React SyntheticEvent |
|---|---|---|
| **Naming Convention** | All lowercase (`onclick`, `onkeydown`) | Strict camelCase (`onClick`, `onKeyDown`) |
| **Listener Attachment** | Attached directly to each physical DOM element | **Delegated to Root Container (`#root`)** |
| **False Return Handling**| `return false;` prevents default action | `return false;` does nothing; **must call `e.preventDefault()`** |
| **Cross-Browser Normalization**| Inconsistent across older browsers | **100% normalized across all platforms** |
| **Memory Pooling** | Never pooled | Pooled in React $\le$ 16; **Removed in React 17+** |

---

## 13. Trade-offs: React Events vs. Native `addEventListener`
- **React Synthetic Events (`onClick`)**:
  - *Pro*: Memory-efficient (automatic delegation), cross-browser safe, automatic cleanup when component unmounts.
  - *Con*: Bubbles through the React component tree hierarchy, not necessarily the physical DOM hierarchy (e.g. React Portals).
- **Native `addEventListener` in `useEffect`**:
  - *Pro*: Necessary for global events not bound to components (`window` resize, `document` scroll, keydown escape listeners).
  - *Con*: Must be manually cleaned up on unmount or it will cause memory leaks.

---

## 14. Real-World Usage: React Portals and Event Bubbling
In React, modals are often rendered into a different physical DOM container using `ReactDOM.createPortal(children, document.body)`.
- Even though the modal physically lives in `document.body` outside `#root`, **React Synthetic Events still bubble through the React component hierarchy!**
- If a button inside the Portal is clicked, a parent component that rendered the Portal can catch the `onClick` event, maintaining component composition invariants.

---

## 15. Placement Interview Questions

### Basic (Intern)
1. **What is a SyntheticEvent in React?**
   - *Spoken Answer*: "A SyntheticEvent is a cross-browser wrapper around the browser's native DOM event. It provides a standardized interface across all browsers, normalizes cross-browser differences, and integrates with React's event delegation architecture."

### Conceptual (Junior SDE)
2. **How does Event Delegation work in React 18 compared to React 16?**
   - *Spoken Answer*: "In React 16, event delegation attached all event listeners to the global `document` node. In React 17 and 18, React attaches all event listeners to the **root DOM container** (`#root`) where the application was mounted via `createRoot`. This change prevents collisions between multiple React versions running on the same page and allows React widgets to integrate safely inside legacy non-React host applications."

### Implementation (SDE-1)
3. **What was Event Pooling in React 16, and why was it removed in React 17?**
   - *Spoken Answer*: "Event pooling was an optimization where React reused a single synthetic event instance across different events to minimize garbage collection. After the event handler executed, all properties were wiped to `null`, requiring developers to call `e.persist()` if they needed access inside asynchronous callbacks. React 17 completely removed event pooling because modern JavaScript engines (V8) have highly optimized garbage collectors, making the pooling mechanism unnecessary and eliminating widespread developer confusion."

### Debugging
4. **You click a button inside a modal and the underlying page navigates or closes. How do you fix it?**
   - *Analysis*: The click event on the button is bubbling up through the DOM tree and triggering click listeners on parent container elements.
   - *Fix*: Call `e.stopPropagation()` inside the button's click handler:
     ```tsx
     <button onClick={(e) => { e.stopPropagation(); handleDelete(); }}>Delete</button>
     ```

### Scenario-Based
5. **How can you access the true native browser DOM event from a React SyntheticEvent?**
   - *Spoken Answer*: "You can access it via the `e.nativeEvent` property on the SyntheticEvent object. This is useful when integrating with third-party legacy vanilla JavaScript libraries or when you need browser-specific properties not exposed on the synthetic wrapper."

### Advanced (Tier-1 Product Company)
6. **Explain how React Portals handle Synthetic Event propagation across disjoint DOM trees.**
   - *Spoken Answer*: "Even though a React Portal renders its children into a completely separate physical DOM node (such as appending a modal directly to `document.body`), SyntheticEvent propagation is governed by the **React Virtual Component Tree, NOT the real DOM tree**. When an event fires inside the portal, React's internal fiber traversal bubbles the event up through the parent component that rendered the portal, preserving normal React event handling behavior."

---

## 16. Placement Coding Challenge: Custom Click-Outside Hook
Implement a custom React hook `useOnClickOutside` using native event delegation that detects when a user clicks outside a designated component (essential for Dropdowns and Modals):

```tsx
// useOnClickOutside.ts
import { useEffect, RefObject } from 'react';

export function useOnClickOutside<T extends HTMLElement = HTMLElement>(
  ref: RefObject<T>,
  handler: (event: MouseEvent | TouchEvent) => void
) {
  useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      const el = ref?.current;
      // Do nothing if clicking ref's element or descendent elements
      if (!el || el.contains(event.target as Node)) {
        return;
      }
      handler(event);
    };

    // Listen to native mousedown and touchstart at document level
    document.addEventListener('mousedown', listener);
    document.addEventListener('touchstart', listener);

    // Clean up event listeners on unmount to prevent memory leaks!
    return () => {
      document.removeEventListener('mousedown', listener);
      document.removeEventListener('touchstart', listener);
    };
  }, [ref, handler]);
}
```

---

## 17. Common Interview Traps
- **Trap**: "Does `return false` inside a React event handler stop event propagation?"
  - *Trap Explanation*: **No!** In native inline HTML (`onclick="return false"`), returning false cancels the event. In React SyntheticEvents, `return false` does **absolutely nothing**. You must explicitly call `e.preventDefault()` or `e.stopPropagation()`.
- **Trap**: "Are React Synthetic Events attached to the individual HTML buttons in the real DOM?"
  - *Trap Explanation*: **No.** React attaches zero event listeners to individual `<button>` or `<input>` elements in the real DOM. All listeners are consolidated and attached to the root container (`#root`).

---

## 18. Revision Summary
- **SyntheticEvent**: Cross-browser normalized wrapper around native events.
- **Event Delegation**: Listeners are attached to `#root` in React 17+ (was `document` in React 16).
- **Event Pooling is Dead**: Removed in React 17; no need for `e.persist()`.
- **`e.preventDefault()`** stops default browser action; **`e.stopPropagation()`** halts bubbling.
- React Portal events bubble up through the **React component tree**, not the physical DOM tree.
- Always clean up native event listeners in `useEffect` return functions.

---

## 19. Quick Reference Cheat Sheet
```tsx
// React Event Types:
React.MouseEvent<HTMLButtonElement>       // Button Clicks
React.ChangeEvent<HTMLInputElement>       // Text Input / Select / Checkbox
React.FormEvent<HTMLFormElement>          // Form Submission
React.KeyboardEvent<HTMLInputElement>     // Key Press (onKeyDown)

// Canceling Actions:
e.preventDefault();   // Stops form refresh / link navigation
e.stopPropagation();  // Halts bubbling to parent components
e.nativeEvent         // Access underlying browser DOM Event
```
