# Modular CSS, CSS Modules & Vanilla CSS Architecture

## 1. What is it?
**Modular CSS** is an architectural discipline for writing scalable, maintainable, and collision-free stylesheets in large web applications.

Historically, all CSS was global in scope: declaring a class `.button { color: red; }` in one file mutated every button across the entire website. To solve this, frontend engineering developed two primary solutions:
1. **Methodological Scoping (BEM - Block Element Modifier)**: A strict naming convention that namespaces styles manually (`.card__title--active`).
2. **Automated Scoping (CSS Modules)**: A build-time compiler transform (supported by Vite, Webpack, and Next.js) that transforms local class names into globally unique hashed class names (`.button_a7x9b`).
3. **Vanilla CSS Custom Properties (CSS Variables)**: Native browser variables (`--primary-color: #3b82f6;`) allowing dynamic runtime theming without JavaScript runtime overhead.

---

## 2. Why does it exist?
In monolithic frontend projects:
- **Global Namespace Collisions**: Two developers work on different features. Developer A creates `.title { font-size: 24px; }` for the blog. Developer B creates `.title { font-size: 14px; margin-bottom: 0; }` for the modal. Whichever CSS file loads last in the `<head>` overrides the other, causing silent visual bugs.
- **The Specificity Wars (`!important` Spiral)**: To overcome global overrides, developers start chaining IDs and adding `!important`, making future maintenance impossible.
- **Dead Code Accumulation**: In a 50,000-line global stylesheet, nobody deletes CSS rules when removing a component because nobody knows if `.header-link` is used on a hidden marketing page.

---

## 3. Mental Model: Local Scope vs. Global Broadcast
💡 **Think of Two Radio Transmitters on the Same Frequency:**

```
                  GLOBAL CSS (Open Radio Frequency)
┌─────────────────────────────────────────────────────────────┐
│  Developer A shouts on Frequency 101.5: ".btn { red; }"     │
│  Developer B shouts on Frequency 101.5: ".btn { blue; }"    │
│  💥 Jammed signal! The loudest (latest) broadcast wins!    │
└─────────────────────────────────────────────────────────────┘

                  CSS MODULES (Encrypted Private Frequencies)
┌─────────────────────────────────────────────────────────────┐
│  Developer A's button becomes:  .Button_btn__a7f92          │
│  Developer B's button becomes:  .Modal_btn__x93b1           │
│  ✅ Zero interference! Both coexist in harmony.             │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Basic Example: BEM vs. CSS Modules

### A. The BEM Methodology
```css
/* Block: Standalone entity */
.product-card { border: 1px solid #e2e8f0; }

/* Element: Part of the block */
.product-card__title { font-size: 1.25rem; font-weight: bold; }
.product-card__price { color: #16a34a; }

/* Modifier: Theme or state variation */
.product-card--featured { border-color: #f59e0b; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
```

### B. CSS Modules in Action
```css
/* Button.module.css */
.primaryButton {
  background-color: var(--primary-color);
  color: #ffffff;
  padding: 0.5rem 1rem;
  border-radius: 0.375rem;
  transition: opacity 0.2s ease;
}

.primaryButton:hover {
  opacity: 0.9;
}
```

```tsx
// Button.tsx
import styles from './Button.module.css';

export function Button({ label }: { label: string }) {
  // At build time, styles.primaryButton compiles to: "Button_primaryButton__d83a1"
  return <button className={styles.primaryButton}>{label}</button>;
}
```

---

## 5. Real Example: Modern Vanilla CSS Design Tokens Architecture

Using native CSS Custom Properties, you can build a full design system with zero CSS-in-JS runtime overhead:

```css
/* tokens.css */
:root {
  /* Colors */
  --color-primary-500: #3b82f6;
  --color-primary-600: #2563eb;
  --color-bg-canvas: #ffffff;
  --color-text-body: #1e293b;

  /* Typography */
  --font-family-sans: system-ui, -apple-system, sans-serif;
  --font-size-base: 1rem;
  --line-height-normal: 1.5;

  /* Spacing Scale */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-4: 1rem;
  --space-6: 1.5rem;

  /* Elevation Shadows */
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1);
}

/* Dark Mode Overrides (Instant runtime switching!) */
[data-theme='dark'] {
  --color-bg-canvas: #0f172a;
  --color-text-body: #f8fafc;
  --color-primary-500: #60a5fa;
}

body {
  background-color: var(--color-bg-canvas);
  color: var(--color-text-body);
  font-family: var(--font-family-sans);
}
```

---

## 6. Under the Hood: How CSS Modules Build Tooling Works

When a bundler (Vite / Webpack / SWC) encounters `import styles from './Card.module.css'`:
1. **CSS Loader Phase**: The compiler parses the CSS AST.
2. **Hash Generation**: It generates a cryptographic hash of the file path and local class name:
   $$\text{hash} = \text{MD5}(\text{"src/components/Card.module.css:title"}).\text{slice}(0, 5)$$
3. **Class Replacement**: 
   - In the emitted CSS: `.title` $\rightarrow$ `.Card_title__4a1b2 { ... }`.
   - In the compiled JavaScript: `styles.title` exports the string `"Card_title__4a1b2"`.
4. **Dead Code Elimination**: When a component is deleted, its `.module.css` file is no longer imported anywhere, so tree-shaking bundlers automatically drop the CSS file completely from the production bundle!

---

## 7. Important Rules

1. **Keep Selectors Flat**: Avoid deep nesting (`.card .header .user .avatar`). Strive for single-class selectors in CSS Modules to keep specificity low ($0, 1, 0$).
2. **Never Use Tag Selectors in Modules**: Do not write `div { ... }` or `p { ... }` in a `.module.css` file; tag selectors cannot be hashed and will leak globally!
3. **Use `:global()` Sparingly**: If you must target a third-party library element inside a module, use the `:global(.third-party-class)` escape hatch.

---

## 8. Common Mistakes

### Mistake 1: Trying to access kebab-case classes in JavaScript without brackets
```css
/* Card.module.css */
.card-header { font-weight: bold; }
```
```tsx
// ❌ FAILS or awkward:
import styles from './Card.module.css';
// <div className={styles.card-header} /> // JavaScript syntax error (minus sign)!
// <div className={styles['card-header']} /> // Awkward bracket access!

// ✅ BEST PRACTICE: Use camelCase for CSS Module class names
// .cardHeader { font-weight: bold; }
// <div className={styles.cardHeader} />
```

---

## 9. Best Practices

1. **Use `clsx` or `classnames` for Conditional Classes**:
   ```tsx
   import clsx from 'clsx';
   import styles from './Alert.module.css';

   <div className={clsx(styles.alert, {
     [styles.success]: variant === 'success',
     [styles.error]: variant === 'error',
   })} />
   ```
2. **Use `@media (prefers-color-scheme: dark)` for Zero-JS Theming**: Let the browser switch dark/light mode based on OS preferences without running a single line of JavaScript.

---

## 10. Performance Considerations

- **CSS Modules vs. Runtime CSS-in-JS (Styled-Components / Emotion)**: CSS Modules have **zero runtime overhead**. All classes are computed once at build time. Runtime CSS-in-JS parses template strings and injects `<style>` tags into the DOM at runtime, causing style recalcs and consuming CPU on every render.

---

## 11. Security Considerations

- Never inject user-controlled input directly into CSS variables via `style={{ '--dynamic': userInput }}` without sanitization, as malicious inputs can break CSS property rules or execute data extraction attacks.

---

## 12. Alternatives

| Styling Approach | Compilation | Runtime Cost | Scoping |
| :--- | :--- | :--- | :--- |
| **CSS Modules** | Build-time | **0ms (Zero)** | Scoped via class hashes |
| **Vanilla CSS + BEM** | Zero build | **0ms (Zero)** | Scoped via naming discipline |
| **Tailwind CSS** | Build-time | **0ms (Zero)** | Atomic utility classes |
| **Styled-Components** | Runtime | High (~5-10% CPU) | Scoped via runtime `<style>` tags |

---

## 13. Trade-offs

- **Benefit**: Zero runtime performance penalty; guaranteed style isolation; natural dead code elimination.
- **Cost**: Requires configuring build tools; sharing variables across files requires CSS Custom Properties.

---

## 14. Real-World Usage

- **Vercel & Next.js Core**: Next.js ships with first-class built-in support for `.module.css`.
- **High-Performance Dashboards**: Trading and finance interfaces use CSS Modules to eliminate re-render styling lag.

---

## 15. Placement Interview Questions

### Basic
**Q: What is a CSS Module and how does it prevent global style collisions?**  
*Answer*: A CSS Module is a CSS file in which all class names and animation names are scoped locally by default. During compilation, the bundler transforms each local class name into a globally unique identifier (e.g. `[filename]_[classname]__[hash]`), ensuring styles defined in one component never accidentally conflict with identical class names in another component.

### Conceptual
**Q: Why do major tech companies avoid runtime CSS-in-JS (like styled-components) in modern high-performance web applications?**  
*Answer*: Runtime CSS-in-JS incurs a significant performance penalty: on every component render, JavaScript parses CSS template strings, computes class hashes, generates new CSS rules, and injects `<style>` tags into the document `<head>`. This causes main-thread blocking, triggers browser style recalculations, bloats bundle size, and is incompatible with React Server Components (RSC) which execute on the server without client DOM access.

### Implementation
**Q: How do you dynamically toggle dark mode using Vanilla CSS custom properties?**  
*Answer*: Define base theme variables on `:root` and dark mode overrides under a data attribute `[data-theme='dark']`. Then toggle `document.documentElement.setAttribute('data-theme', 'dark')` in JavaScript:
```css
:root { --bg: #fff; --text: #000; }
[data-theme='dark'] { --bg: #121212; --text: #fff; }
body { background: var(--bg); color: var(--text); }
```

### Debugging
**Q: You import a CSS module in React, but the exported `styles` object is empty `{}` at runtime. What is the cause?**  
*Answer*: The build tool (Webpack or Vite) is not configured to recognize `.module.css` extensions with the `css-loader` `modules: true` option, or the CSS file contains only global selectors (`:global(.btn)` or tag selectors like `div`) without any local class names.

### Scenario
**Q: You need to style a third-party rich text editor inside a component using CSS Modules, but its internal HTML classes cannot be modified. How do you style it without leaking styles globally?**  
*Answer*: Use the `:global` pseudo-selector nested within a local CSS module container class:
```css
.editorContainer :global(.prose-mirror-bold) {
  color: var(--primary-color);
}
```
The `.editorContainer` is hashed and scoped, while the child `.prose-mirror-bold` selector targets the third-party node strictly inside that container.

### Advanced
**Q: Explain the difference between CSS Specificity calculation for a class selector vs. an ID selector vs. a `:where()` pseudo-class.**  
*Answer*: 
- An ID selector adds `(1, 0, 0)` specificity.
- A Class selector adds `(0, 1, 0)` specificity.
- The `:where()` pseudo-class (introduced in modern CSS) **always has zero specificity `(0, 0, 0)`**, regardless of what selectors are inside it. It allows developers to create low-specificity base styles that can be easily overridden by consumers without specificity wars.

---

## 16. Coding Challenge: Accessible Token-Based Accordion

**Task**: Write an accordion component using Vanilla CSS Modules and custom property tokens that respects keyboard navigation.

```css
/* Accordion.module.css */
.accordion {
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 0.5rem;
  overflow: hidden;
}

.item {
  border-bottom: 1px solid var(--border-color, #e2e8f0);
}

.trigger {
  width: 100%;
  display: flex;
  justify-content: space-between;
  padding: 1rem;
  background: none;
  border: none;
  font-size: 1rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.trigger:focus-visible {
  outline: 2px solid var(--primary-color, #3b82f6);
}

.panel {
  padding: 1rem;
  background-color: var(--panel-bg, #f8fafc);
}
```

```tsx
import { useState } from 'react';
import styles from './Accordion.module.css';

interface AccordionItem {
  id: string;
  title: string;
  content: string;
}

export function Accordion({ items }: { items: AccordionItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className={styles.accordion}>
      {items.map((item) => {
        const isOpen = openId === item.id;
        return (
          <div key={item.id} className={styles.item}>
            <button
              className={styles.trigger}
              onClick={() => setOpenId(isOpen ? null : item.id)}
              aria-expanded={isOpen}
              aria-controls={`panel-${item.id}`}
              id={`trigger-${item.id}`}
            >
              <span>{item.title}</span>
              <span>{isOpen ? '▲' : '▼'}</span>
            </button>
            {isOpen && (
              <div
                id={`panel-${item.id}`}
                role="region"
                aria-labelledby={`trigger-${item.id}`}
                className={styles.panel}
              >
                {item.content}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

---

## 17. Common Interview Traps

1. **"CSS Modules require special JavaScript runtimes."**  
   *Trap*: Thinking it has an in-browser interpreter.  
   *Reality*: CSS Modules are 100% compile-time transforms resulting in plain static CSS and hashed class strings.
2. **"CSS Custom Properties are identical to SASS variables."**  
   *Trap*: Confusing compile-time `$var` with runtime `var(--var)`.  
   *Reality*: SASS variables are resolved at compile time and cannot change dynamically in the browser. CSS Custom Properties exist in the browser DOM, inherit down the tree, and update dynamically via JavaScript or media queries.

---

## 18. Revision Summary

- Global CSS causes namespace collisions, dead code, and specificity escalation.
- **CSS Modules**: Compile-time class hashing; zero runtime overhead.
- **BEM**: Naming convention (`block__element--modifier`) for uncompiled projects.
- **CSS Custom Properties**: Native variables (`var(--token)`) powering dynamic theme switching.
- Use camelCase class names in CSS modules for natural dot-notation access in TypeScript.

---

## 19. Quick Reference

```css
/* CSS Module with Tokens */
.button {
  background-color: var(--primary, #0070f3);
  padding: 0.5rem 1rem;
}

/* Third-party override */
.container :global(.ant-select) {
  border-radius: 4px;
}
```
