# Web Accessibility (a11y), WCAG 2.2 & Accessible Component Patterns

## 1. What is it?
**Web Accessibility (a11y)** is the engineering practice of designing and developing digital products so that people with disabilities—including visual, motor, auditory, speech, or cognitive impairments—can perceive, understand, navigate, and interact with web applications.

Accessibility standards are codified internationally by the W3C as **WCAG (Web Content Accessibility Guidelines)**, currently at version **2.2**. Compliance levels range from **Level A** (minimum) to **Level AA** (the legal and enterprise industry standard for public companies and government contracts) to **Level AAA** (specialized maximum accessibility).

Crucially, accessibility is not an "optional afterthought" or a list of ARIA tags: it begins with **Semantic HTML5**, strict **Keyboard Navigation**, and programmatic **Focus Management**.

---

## 2. Why does it exist?
Consider what happens when a developer builds a button using a `<div>`:
```tsx
// ❌ THE "DIV BUTTON" DISASTER:
<div className="btn" onClick={handleClick}>Click Me</div>
```
### Why This Destroys Accessibility:
1. **Zero Keyboard Focusability**: A blind user or a motor-impaired user navigating with the `Tab` key cannot focus on a `<div>`. The element is completely invisible to their keyboard.
2. **Missing Keypress Support**: Native `<button>` elements trigger on both `Enter` and `Space`. The `<div>` only listens to mouse clicks.
3. **Screen Reader Silence**: A screen reader (VoiceOver, NVDA, JAWS) announces the `<div>` as *"Text: Click Me"*, rather than *"Button: Click Me"*. The user has no idea it is interactive.
4. **Legal & Financial Liability**: Under the Americans with Disabilities Act (ADA) and European Accessibility Act (EAA), companies face million-dollar lawsuits and fines for inaccessible web portals.

---

## 3. Mental Model: The First Rule of ARIA
💡 **The Golden Rule of Accessibility:**

> *"No ARIA is better than bad ARIA."*  
> If an existing native HTML5 element can perform the task, **always use the native element** rather than bolting ARIA onto a `<div>`.

```
BAD: Reinventing the Wheel with ARIA (Fragile & Incomplete)
┌─────────────────────────────────────────────────────────────┐
│  <div                                                       │
│    role="button"                                            │
│    tabIndex={0}                                             │
│    onKeyDown={handleEnterAndSpace}                          │
│    aria-pressed={isPressed}                                 │
│  >Submit</div>                                              │
└─────────────────────────────────────────────────────────────┘

GOOD: Native HTML5 (Free, built-in C++ accessibility tree)
┌─────────────────────────────────────────────────────────────┐
│  <button type="button" aria-pressed={isPressed}>Submit</button>│
│  - Automatically focusable via Tab                          │
│  - Automatically triggers on Enter & Space                  │
│  - Automatically announced as "Button" by screen readers   │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Understanding TabIndex

The `tabindex` HTML attribute controls keyboard focusability:

```
┌───────────────┬──────────────────────────────────────────┬──────────────────────────────────────────┐
│ TabIndex      │ Focus Behavior                           │ Correct Use Case                         │
├───────────────┼──────────────────────────────────────────┼──────────────────────────────────────────┤
│ `tabindex="0"`│ Focusable in sequential keyboard order.  │ Custom interactive controls (e.g. tabs). │
├───────────────┼──────────────────────────────────────────┼──────────────────────────────────────────┤
│ `tabindex="-1"`│ NOT reachable via Tab key, but CAN be   │ Modals, alert headings, roving focus     │
│               │ focused programmatically via `.focus()`. │ elements in menus and grids.             │
├───────────────┼──────────────────────────────────────────┼──────────────────────────────────────────┤
│ `tabindex="1+"`│ ❌ ANTI-PATTERN: Disrupts natural page   │ NEVER USE POSITIVE TABINDEX! It wrecks   │
│               │ tab order and causes focus disorientation│ the logical reading order.               │
└───────────────┴──────────────────────────────────────────┴──────────────────────────────────────────┘
```

---

## 5. Real Example: Accessible Modal Dialog & Focus Trap

An accessible modal requires 4 non-negotiable behaviors:
1. Trap keyboard focus inside the modal while open (pressing Tab on the last element wraps to the first).
2. Pressing the `Escape` key immediately closes the modal.
3. Return keyboard focus back to the original trigger button after closing.
4. Mark background content with `aria-hidden="true"`.

```tsx
import React, { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function AccessibleModal({ isOpen, onClose, title, children }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      // 1. Remember the element that triggered the modal
      previousFocusRef.current = document.activeElement as HTMLElement;

      // 2. Move focus inside the modal dialog
      dialogRef.current?.focus();

      // 3. Lock background body scrolling
      document.body.style.overflow = 'hidden';
    } else {
      // 4. Restore focus back to original trigger on close
      document.body.style.overflow = '';
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  // 5. Handle Keyboard Trap & Escape Key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }

    if (e.key === 'Tab' && dialogRef.current) {
      const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      if (focusableElements.length === 0) return;

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        // Shift + Tab: if on first element, wrap to last
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab: if on last element, wrap to first
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
        className="modal-container"
        onClick={(e) => e.stopPropagation()} // Prevent backdrop click
        onKeyDown={handleKeyDown}
      >
        <header className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button onClick={onClose} aria-label="Close dialog">✕</button>
        </header>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
```

---

## 6. Live Regions: Announcing Dynamic Content with `aria-live`

When an asynchronous update occurs (e.g. an item is added to the cart, or a toast appears), screen reader users will not know unless you declare an **`aria-live`** region:

```tsx
export function LiveCartCounter({ count }: { count: number }) {
  return (
    <div>
      <span className="cart-icon">🛒</span>
      {/* aria-live="polite": Wait until the user pauses, then announce */}
      {/* aria-atomic="true": Announce the entire phrase, not just the changed number */}
      <span 
        aria-live="polite" 
        aria-atomic="true" 
        className="visually-hidden"
      >
        {count} items in shopping cart
      </span>
    </div>
  );
}
```

- **`aria-live="polite"`**: Screen reader finishes its current sentence before announcing the update (used for 95% of alerts, toasts, and search result counts).
- **`aria-live="assertive"`**: Screen reader interrupts speech immediately (reserved strictly for emergency errors like server disconnection or session timeouts).

---

## 7. Important Rules

1. **Every Image Must Have an `alt` Attribute**:
   - Informative images: `alt="Sales growth chart for Q3 2026"`.
   - Purely decorative icons: `alt=""` or `aria-hidden="true"`. Omitting `alt` entirely causes screen readers to read the raw image URL!
2. **Never Remove Focus Outlines Without Providing an Alternative**:
   ```css
   /* ❌ CATASTROPHIC ACCESSIBILITY BUG: */
   *:focus { outline: none; }

   /* ✅ CORRECT: Use :focus-visible for high-contrast keyboard navigation rings */
   button:focus-visible {
     outline: 2px solid #2563eb;
     outline-offset: 2px;
   }
   ```
3. **Form Inputs Must Be Associated with Labels**: Use `<label htmlFor="email">Email</label><input id="email" />` or wrap inputs inside `<label>`.

---

## 8. Common Mistakes

### Mistake 1: Relying on color alone to convey meaning
```tsx
// ❌ WRONG: Color-blind users cannot differentiate red vs green
<span style={{ color: isPaid ? 'green' : 'red' }}>●</span>

// ✅ CORRECT: Pair color with clear text or icons
<span style={{ color: isPaid ? 'green' : 'red' }}>
  {isPaid ? '✓ Paid' : '⚠ Overdue'}
</span>
```

---

## 9. Best Practices

1. **Install `eslint-plugin-jsx-a11y`**: Catches missing `alt` tags, bad roles, and mouse-without-keyboard handlers at compile time.
2. **Provide Skip-to-Content Links**: Let keyboard users skip past a 50-link navigation bar directly to the main content:
   ```html
   <a href="#main-content" className="skip-link">Skip to main content</a>
   ```
3. **Automate with Axe-core**: Run `@axe-core/playwright` or Lighthouse in your CI/CD pipeline to catch 40-50% of common accessibility regressions automatically.

---

## 10. Performance Considerations

- Accessible semantic markup has **zero runtime performance penalty**. In fact, native HTML elements like `<dialog>` and `<details>` run on native browser C++ engines, performing significantly faster and using less memory than heavy JavaScript custom implementations.

---

## 11. Security Considerations

- Accessible screen reader announcements must not announce sensitive PII (like unmasked credit card numbers or raw password strings) in `aria-live` regions.

---

## 12. Alternatives: Native `<dialog>` Element

Modern browsers now support the native HTML5 `<dialog>` element:
```html
<dialog id="favDialog">
  <form method="dialog">
    <button>Close</button>
  </form>
</dialog>
```
Calling `dialog.showModal()` **automatically traps focus, renders a native backdrop, and handles the Escape key natively**!

---

## 13. Trade-offs

- **Benefit**: Universal user reach; legal compliance; better SEO (search engine bots are essentially blind screen readers); superior keyboard navigation for power users.
- **Cost**: Requires engineering testing with keyboard navigation and screen readers.

---

## 14. Real-World Usage

- **Government & Banking Portals**: Mandatory WCAG 2.2 AA compliance to avoid federal accessibility lawsuits.
- **Radix UI & React Aria (Adobe)**: The gold-standard headless accessibility libraries used across enterprise design systems.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the "First Rule of ARIA"?**  
*Answer*: The First Rule of ARIA states: *"If you can use a native HTML element or attribute with the semantics and behavior already built in, then do so instead of re-purposing an element and adding an ARIA role, state or property."* Native HTML elements (`<button>`, `<select>`, `<nav>`) provide built-in keyboard accessibility and screen reader support without fragile custom JavaScript.

### Conceptual
**Q: Explain the difference between `aria-labelledby` and `aria-describedby`.**  
*Answer*:
- `aria-labelledby`: Replaces or provides the **accessible name/label** of an element (analogous to the text of a button or the `<label>` of an input). It is announced first by screen readers.
- `aria-describedby`: Provides **secondary description or contextual help** (analogous to an input hint or error message). It is announced after the label with a slight auditory pause.

### Implementation
**Q: How do you visually hide an element on the screen while keeping it completely accessible to screen readers?**  
*Answer*: Use the standard CSS `.sr-only` (Screen Reader Only) utility:
```css
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}
```
*Note*: Never use `display: none` or `visibility: hidden`, because those properties completely remove the element from both the visual screen AND the screen reader accessibility tree!

### Debugging
**Q: A developer adds `onClick` to a `<span>` to act as a button. What 4 things must be added to make it fully accessible if they cannot change it to a `<button>`?**  
*Answer*:
1. `role="button"` (informs screen readers of its purpose).
2. `tabIndex={0}` (makes it focusable via keyboard Tab).
3. `onKeyDown` listener handling both `Enter` and `Space` keys (to mirror native button triggers).
4. `aria-disabled="true"` if the span can be disabled.

### Scenario
**Q: How do you design an accessible autocomplete search dropdown for keyboard users?**  
*Answer*: Use the **ARIA Combobox pattern** (`role="combobox"`):
- The `<input>` has `aria-expanded={isOpen}`, `aria-autocomplete="list"`, and `aria-controls="results-listbox"`.
- Use the **Roving Tabindex** or `aria-activedescendant` pattern: as the user presses Arrow Down/Up, update `aria-activedescendant="option-id"` to point to the highlighted suggestion without physically moving focus away from the input, allowing the user to keep typing seamlessly.

### Advanced
**Q: What is the Accessibility Object Model (AOM) and the Browser Accessibility Tree?**  
*Answer*: The browser creates an **Accessibility Tree** in parallel with the DOM tree. The Accessibility Tree represents a semantic hierarchy of accessible objects, exposing their names, roles, states, and properties to the host operating system's native assistive technology APIs (such as MSAA/UIA on Windows or NSAccessibility on macOS). When an element's attributes or text change, the browser fires accessibility events into the OS pipeline.

---

## 16. Coding Challenge: Accessible Toast Notification System

**Task**: Implement an accessible Toast notification component in React that announces alerts politely to screen readers without stealing keyboard focus.

```tsx
import React, { useEffect } from 'react';

export interface ToastMessage {
  id: string;
  type: 'info' | 'error' | 'success';
  message: string;
}

export function AccessibleToast({
  toast,
  onDismiss,
  duration = 5000,
}: {
  toast: ToastMessage;
  onDismiss: (id: string) => void;
  duration?: number;
}) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss(toast.id);
    }, duration);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss, duration]);

  const isAlert = toast.type === 'error';

  return (
    <div
      // Errors get assertive live regions; standard info gets polite live regions
      role={isAlert ? 'alert' : 'status'}
      aria-live={isAlert ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={`toast-container toast-${toast.type}`}
    >
      <span className="toast-icon">
        {toast.type === 'success' && '✓'}
        {toast.type === 'error' && '⚠'}
        {toast.type === 'info' && 'ℹ'}
      </span>
      <p className="toast-text">{toast.message}</p>
      <button
        onClick={() => onDismiss(toast.id)}
        aria-label={`Dismiss notification: ${toast.message}`}
        className="toast-close"
      >
        ✕
      </button>
    </div>
  );
}
```

---

## 17. Common Interview Traps

1. **"`display: none` hides elements from sighted users while screen readers read them."**  
   *Trap*: Repeating this misconception.  
   *Reality*: `display: none` removes the element completely from the accessibility tree; screen readers will ignore it entirely! Use `.sr-only` CSS instead.
2. **"Setting `tabindex="5"` ensures users see the most important button first."**  
   *Trap*: Using positive tab index numbers.  
   *Reality*: Positive tab indices are a severe anti-pattern that creates disorienting keyboard jumps. Keep tab order natural through logical DOM structure.

---

## 18. Revision Summary

- **WCAG 2.2 AA**: Target compliance level for software placements.
- **First Rule of ARIA**: Always prefer native HTML5 elements over custom ARIA divs.
- `tabindex="0"` (normal tab order), `tabindex="-1"` (programmatic focus only), never use positive tab index.
- Accessible modals must **trap focus, handle Escape, and restore focus on exit**.
- Use **`aria-live="polite"`** for dynamic asynchronous toast/alert updates.

---

## 19. Quick Reference

```html
<!-- Accessibility Essentials -->
<button aria-expanded="false" aria-controls="menu-id">Menu</button>
<div id="menu-id" role="menu" hidden>...</div>

<span aria-live="polite">Item added to cart</span>
```
