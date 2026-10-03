# Design Systems: Design Tokens, Theming Architecture & FOUC Prevention

## 1. What is it?
A **Design System** is a standardized collection of reusable components, guided by clear design standards and unified by **Design Tokens**.

**Design Tokens** are the atomic, platform-agnostic design decisions of a product stored as data (such as colors, typography sizes, spacing, shadows, and animation curves). Rather than hardcoding `#3b82f6` or `16px` across dozens of components, tokens establish a single source of truth that can be transformed into CSS variables, iOS Swift constants, or Android XML resources.

A resilient theming architecture handles multi-brand theming and dark/light switching while completely preventing the **Flash of Unstyled Theme (FOUT / FOUC)** during initial page load.

---

## 2. Why does it exist?
In unstandardized frontend applications:
- **Visual Inconsistency**: Three different buttons use three slightly different shades of blue (`#2563eb`, `#1d4ed8`, `#3b82f6`) and four different border-radii (`3px`, `4px`, `5px`, `6px`).
- **Dark Mode Refactoring Nightmares**: If colors are hardcoded as hexadecimal values in 300 CSS files, adding dark mode requires manually rewriting thousands of lines of CSS rules.
- **The FOUC Flash**: When dark mode is managed naively in React `useState`, a user who prefers dark mode sees a blinding white screen for 200ms while JavaScript downloads and hydrates, before the page suddenly turns dark.
- **The Token Solution**: Design tokens categorize styles into 3 structured tiers, allowing instant theme switching and zero-latency script hydration.

---

## 3. Mental Model: The 3-Tier Design Token Hierarchy
💡 **Think of an Organization with 3 Layers of Abstraction:**

```
TIER 1: GLOBAL / PRIMITIVE TOKENS (Raw values)
┌─────────────────────────────────────────────────────────────┐
│  --blue-500: #3b82f6;       --gray-100: #f1f5f9;            │
│  --space-4: 16px;           --radius-md: 8px;               │
│  (Describes what the value IS, regardless of how it's used) │
└──────────────────────────────┬──────────────────────────────┘
                               │ Referenced by
                               ▼
TIER 2: SEMANTIC / PURPOSE TOKENS (Intent & Theming)
┌─────────────────────────────────────────────────────────────┐
│  Light Theme:               Dark Theme:                     │
│  --color-bg-canvas: #ffffff --color-bg-canvas: #0f172a      │
│  --color-text-primary: #111 --color-text-primary: #f8fafc   │
│  --color-interactive: var(--blue-500)                       │
│  (Describes what the token DOES in a specific theme)        │
└──────────────────────────────┬──────────────────────────────┘
                               │ Referenced by
                               ▼
TIER 3: COMPONENT TOKENS (Scoped to specific widget)
┌─────────────────────────────────────────────────────────────┐
│  --button-primary-bg: var(--color-interactive);             │
│  --button-padding: var(--space-4);                          │
│  (Enables surgical overrides without breaking other widgets)│
└─────────────────────────────────────────────────────────────┘
```

---

## 4. The Complete Token Architecture in CSS

```css
/* tokens.css */
:root {
  /* 1. Global Primitives */
  --primitive-blue-500: #3b82f6;
  --primitive-blue-600: #2563eb;
  --primitive-slate-900: #0f172a;
  --primitive-slate-50: #f8fafc;
  
  /* 2. Fluid Typography with clamp(min, preferred, max) */
  --font-size-sm: clamp(0.8rem, 0.17vw + 0.76rem, 0.89rem);
  --font-size-base: clamp(1rem, 0.34vw + 0.91rem, 1.19rem);
  --font-size-xl: clamp(1.5rem, 1.15vw + 1.21rem, 2.13rem);

  /* 3. 8-Point Spacing Grid */
  --space-1: 0.25rem; /* 4px */
  --space-2: 0.5rem;  /* 8px */
  --space-3: 0.75rem; /* 12px */
  --space-4: 1rem;    /* 16px */
  --space-6: 1.5rem;  /* 24px */
  --space-8: 2rem;    /* 32px */

  /* 4. Strict Z-Index Scale */
  --z-dropdown: 1000;
  --z-sticky: 1100;
  --z-modal: 1300;
  --z-toast: 1500;

  /* 5. Default Light Semantic Tokens */
  --color-bg-canvas: #ffffff;
  --color-bg-surface: #f8fafc;
  --color-border: #e2e8f0;
  --color-text-primary: #0f172a;
  --color-text-secondary: #64748b;
  --color-brand: var(--primitive-blue-600);
}

/* Dark Mode Semantic Overrides */
[data-theme='dark'] {
  --color-bg-canvas: var(--primitive-slate-900);
  --color-bg-surface: #1e293b;
  --color-border: #334155;
  --color-text-primary: var(--primitive-slate-50);
  --color-text-secondary: #94a3b8;
  --color-brand: var(--primitive-blue-500);
}
```

---

## 5. Preventing FOUC (Flash of Unstyled Theme) in SSR & Next.js

Why does the theme flash happen?
- Server renders HTML with default theme (usually light).
- Browser receives HTML, paints white canvas.
- JavaScript bundle loads, executes `useEffect`, reads `localStorage.getItem('theme') === 'dark'`, and calls `setTheme('dark')`.
- The user is blinded by a 200ms white flash before the page switches to dark!

### The Production Cure: Inline Blocking Script
Place a tiny, synchronous inline `<script>` in the `<head>` of your HTML document before any CSS or body elements render:

```html
<!-- Inside index.html or Next.js app/layout.tsx <head> -->
<head>
  <script>
    (function() {
      try {
        const storedTheme = localStorage.getItem('theme');
        const userPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const theme = storedTheme || (userPrefersDark ? 'dark' : 'light');
        document.documentElement.setAttribute('data-theme', theme);
      } catch (e) {
        // Fallback gracefully if localStorage is disabled
      }
    })();
  </script>
</head>
```

**Why this works**:
The browser parser halts rendering when it encounters a synchronous script in `<head>`. It executes the 5-line script, sets `data-theme="dark"` on the `<html>` root, and only *then* begins painting the DOM. **Result: Zero flash! The very first frame painted on the monitor is already dark!**

---

## 6. Real Example: The Type-Safe Theme Switcher Hook

```tsx
import { useState, useEffect } from 'react';

type Theme = 'light' | 'dark' | 'system';

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'system';
    return (localStorage.getItem('theme') as Theme) || 'system';
  });

  useEffect(() => {
    const root = document.documentElement;

    function applyTheme(activeTheme: Theme) {
      if (activeTheme === 'system') {
        const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        root.setAttribute('data-theme', systemDark ? 'dark' : 'light');
      } else {
        root.setAttribute('data-theme', activeTheme);
      }
    }

    applyTheme(theme);
    if (theme === 'system') {
      localStorage.removeItem('theme');
    } else {
      localStorage.setItem('theme', theme);
    }

    // Listen to OS-level theme changes when in 'system' mode
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemChange = () => {
      if (theme === 'system') applyTheme('system');
    };

    mediaQuery.addEventListener('change', handleSystemChange);
    return () => mediaQuery.removeEventListener('change', handleSystemChange);
  }, [theme]);

  return { theme, setTheme };
}
```

---

## 7. Important Rules

1. **Components Must Only Consume Tier 2 (Semantic) Tokens**: A `<Card />` component must never use `--primitive-blue-500` directly. It must use `--color-brand` or `--color-bg-surface` so theme swapping works automatically.
2. **Standardize on an 8-Point Grid**: Spacing values must be multiples of 4px or 8px (`4, 8, 16, 24, 32, 48, 64px`) to preserve rhythm across screen densities.
3. **Use Explicit Z-Index Scales**: Never let engineers pick random numbers like `z-index: 99999`. Strictly enforce semantic z-index variables.

---

## 8. Common Mistakes

### Mistake 1: Relying on CSS-in-JS theme providers that re-render the entire component tree
```tsx
// ❌ EXPENSIVE: Entire app re-renders on theme change!
<ThemeProvider theme={theme === 'dark' ? darkTheme : lightTheme}>
  <App />
</ThemeProvider>
```
With CSS Custom Properties, changing themes **requires zero React re-renders**! You simply change a single attribute on the `<html>` element, and the browser's native C++ styling engine re-evaluates all colors in sub-milliseconds.

---

## 9. Best Practices

1. **Use `clamp()` for Fluid Sizing**: Eliminate jagged media queries by letting font sizes and containers scale smoothly with the viewport width.
2. **Support System Preferences by Default**: New users should automatically match their operating system dark/light mode preference.
3. **Pair Color Contrast with WCAG 2.2**: Ensure text tokens meet a minimum contrast ratio of 4.5:1 against their semantic background tokens.

---

## 10. Performance Considerations

- **Native CSS Variable Cascading**: CSS variables inherit down the DOM tree. Mutating `data-theme` on the root node is processed entirely on the GPU/compositor and style recalculation thread, consuming zero JavaScript heap or garbage collection cycles.

---

## 11. Security Considerations

- If allowing users to define custom hex codes for themes (e.g. workspace branding), validate the input against a strict hex regex (`/^#([0-9a-fA-F]{3}){1,2}$/`) before applying to prevent CSS injection exploits.

---

## 12. Alternatives

| Technique | Runtime Cost | Dark Mode Speed | FOUC Risk |
| :--- | :--- | :--- | :--- |
| **CSS Custom Properties (`data-theme`)** | **0ms** | ⚡ Instant (<1ms) | Zero (with head script) |
| **Tailwind `class="dark"`** | **0ms** | ⚡ Instant (<1ms) | Zero (with head script) |
| **CSS-in-JS ThemeProvider** | High (React render) | Slow (~50-100ms) | Very High |

---

## 13. Trade-offs

- **Benefit**: Visual cohesion; zero-cost theme switching; future-proof design evolution.
- **Cost**: Requires upfront design discipline and token governance.

---

## 14. Real-World Usage

- **GitHub, Linear, and Stripe**: Use semantic CSS tokens to switch between default, dark, dimmed, and high-contrast themes instantly.

---

## 15. Placement Interview Questions

### Basic
**Q: What are Design Tokens and why are they used?**  
*Answer*: Design tokens are atomic design decisions (colors, spacing, typography scales, elevation) stored as platform-agnostic variables. They establish a single source of truth for design systems, eliminate visual inconsistency across components, and allow synchronized design changes across web, iOS, and Android platforms.

### Conceptual
**Q: What is FOUC (Flash of Unstyled Content / Theme) and how is it definitively eliminated?**  
*Answer*: FOUC occurs in Client-Side Hydrated apps (and SSR) when the HTML is initially painted with default light styles while the dark mode preference is stored in `localStorage`. Because React effects run after initial paint, the user sees a jarring white flash before JavaScript toggles the dark class. It is definitively prevented by injecting an inline, synchronous blocking `<script>` in the document `<head>` that reads `localStorage` and sets the `data-theme` attribute before the browser paints the first frame.

### Implementation
**Q: Write a CSS custom property rule using `clamp()` that creates a fluid title starting at 24px on mobile and scaling smoothly to 48px on large desktops.**  
*Answer*:
```css
h1.fluidTitle {
  font-size: clamp(1.5rem, 2.5vw + 1rem, 3rem);
}
```

### Debugging
**Q: An engineer sets a CSS variable on a component: `.card { --card-bg: white; }` and attempts to read it in JavaScript using `element.style.getPropertyValue('--card-bg')`, but it returns an empty string `""`. Why?**  
*Answer*: `element.style` only reads **inline styles** explicitly set via the HTML `style` attribute. If the CSS custom property was defined inside an external stylesheet or CSS module rule, you must use `window.getComputedStyle(element).getPropertyValue('--card-bg')`.

### Scenario
**Q: You need to support 5 different customer brand themes (e.g. Nike, Apple, Amazon) in an enterprise SaaS portal. How do you architect the CSS tokens?**  
*Answer*: Structure tokens into 3 tiers: (1) Global Primitives, (2) Semantic Tokens, and (3) Brand Themes. Define all component styles using Semantic Tokens (`--color-primary`, `--color-bg`). Then, create theme stylesheets that re-map the semantic tokens to different primitive palettes based on a data attribute: `[data-brand='nike'] { --color-primary: #f97316; }` and `[data-brand='apple'] { --color-primary: #000000; }`.

### Advanced
**Q: How does `color-scheme: dark light;` in CSS impact native browser UI elements?**  
*Answer*: Setting `color-scheme: dark light;` informs the browser engine that the page supports both themes. The browser automatically adapts native platform UI elements—including scrollbars, form control inputs (`<input type="date">`, checkboxes), and system focus rings—to match the active dark or light theme without requiring custom CSS hacks.

---

## 16. Coding Challenge: System Theme Synchronization Hook

**Task**: Write a complete React hook that coordinates user manual overrides (`light` / `dark`) with OS system preferences (`prefers-color-scheme`), saving preferences in `localStorage` and listening to real-time OS theme toggles.

```tsx
import { useState, useEffect, useCallback } from 'react';

type ThemePreference = 'light' | 'dark' | 'system';

export function useSystemThemeSync() {
  const [preference, setPreference] = useState<ThemePreference>('system');
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

  const updateDOM = useCallback((theme: 'light' | 'dark') => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    setResolvedTheme(theme);
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem('app-theme') as ThemePreference | null;
    if (saved) setPreference(saved);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');

    function resolve() {
      if (preference === 'system') {
        updateDOM(media.matches ? 'dark' : 'light');
      } else {
        updateDOM(preference);
      }
    }

    resolve();

    const listener = () => {
      if (preference === 'system') resolve();
    };

    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [preference, updateDOM]);

  const setMode = (mode: ThemePreference) => {
    setPreference(mode);
    if (mode === 'system') {
      localStorage.removeItem('app-theme');
    } else {
      localStorage.setItem('app-theme', mode);
    }
  };

  return { preference, resolvedTheme, setMode };
}
```

---

## 17. Common Interview Traps

1. **"CSS Custom Properties are processed by Babel or PostCSS."**  
   *Trap*: Assuming they need a compiler.  
   *Reality*: CSS Custom Properties are a native browser feature supported by all modern browsers.
2. **"To support dark mode, you must use media queries in every component."**  
   *Trap*: Scattering `@media (prefers-color-scheme: dark)` across 50 files.  
   *Reality*: Define semantic tokens once on `:root` and override them on `[data-theme='dark']`. Components simply consume the semantic tokens.

---

## 18. Revision Summary

- **3-Tier Token System**: Primitives $\rightarrow$ Semantic $\rightarrow$ Component.
- **Prevent FOUC**: Synchronous inline script in document `<head>` setting `data-theme`.
- **Fluid Sizing**: Use `clamp(min, preferred, max)` to replace rigid breakpoint queries.
- Native CSS variable updates trigger **zero React re-renders**.

---

## 19. Quick Reference

```css
/* Token Architecture */
:root {
  --blue-500: #3b82f6;
  --bg-canvas: #ffffff;
  --text-body: #111827;
}

[data-theme='dark'] {
  --bg-canvas: #0f172a;
  --text-body: #f8fafc;
}
```
