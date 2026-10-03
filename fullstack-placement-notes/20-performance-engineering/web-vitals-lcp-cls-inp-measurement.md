# Core Web Vitals: LCP, CLS, INP & Modern Web Performance Auditing

## 1. What is it?
**Core Web Vitals (CWV)** are an essential set of standardized metrics established by Google that quantify the real-world user experience of loading speed, visual stability, and interaction responsiveness on the web. As of 2024, the three official Core Web Vitals that directly impact user engagement, conversion rates, and Google Search SEO rankings are:

1. **Largest Contentful Paint (LCP)**: Measures *perceived loading speed*. It marks the point in the page load timeline when the main content (typically a hero image, video poster, or large heading block) has likely rendered.
2. **Cumulative Layout Shift (CLS)**: Measures *visual stability*. It quantifies the unexpected layout shifts of visible page content during loading and interaction, preventing accidental clicks.
3. **Interaction to Next Paint (INP)**: Replaced First Input Delay (FID) in March 2024. Measures *interaction responsiveness*. It assesses the page's overall responsiveness to all user interactions (clicks, taps, and keyboard inputs) throughout the entire lifespan of the page.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CORE WEB VITALS THRESHOLDS                      │
├─────────────────┬──────────────────────┬───────────────┬───────────────┤
│ Metric          │ Good (Fast)          │ Needs Impr.   │ Poor (Slow)   │
├─────────────────┼──────────────────────┼───────────────┼───────────────┤
│ LCP (Loading)   │ <= 2.5 seconds       │ 2.5s - 4.0s   │ > 4.0 seconds │
│ CLS (Stability) │ <= 0.10 score        │ 0.10 - 0.25   │ > 0.25 score  │
│ INP (Response)  │ <= 200 milliseconds  │ 200ms - 500ms │ > 500 ms      │
└─────────────────┴──────────────────────┴───────────────┴───────────────┘
```

---

## 2. Why does it exist?
Traditional synthetic metrics (like `DOMContentLoaded` or `window.onload`) fail to capture how real users perceive performance:

1. **Synthetic vs. Real-World Disconnect**: A page might fire `window.onload` in 800ms while displaying a blank white screen because client-side React bundles are still downloading and parsing.
2. **E-Commerce Conversion Impact**: Studies by Amazon, Walmart, and Google prove that every 100ms improvement in LCP and INP increases checkout conversions by 1–2%. A CLS shift while clicking "Cancel" can accidentally trigger "Confirm Order", destroying user trust.
3. **SEO & Search Ranking Factor**: Google uses field data from the **Chrome User Experience Report (CrUX)** as a direct ranking signal for desktop and mobile search algorithms. Failing CWV directly reduces organic search visibility.
4. **Transition from FID to INP**: First Input Delay (FID) only measured the delay of the *very first* user interaction and only captured the input delay (not event processing or frame paint). INP measures all interactions throughout the session, evaluating the complete latency from input event to the next frame painted on screen.

---

## 3. Mental Model: The Restaurant Experience
Think of Core Web Vitals as dining at a high-end restaurant:
- **LCP (Largest Contentful Paint)**: How long it takes for your primary dish (the steak) to be placed on your table. If bread arrives in 10 seconds, but the steak takes 45 minutes, your experience is poor.
- **CLS (Cumulative Layout Shift)**: As you reach for your water glass, the waiter bumps the table, moving the glass 4 inches to the left, causing you to knock over the wine. Unstable, frustrating, and prone to accidents.
- **INP (Interaction to Next Paint)**: When you ask the waiter for the bill, how long do they freeze before acknowledging you with an eye nod and handing you the folder? If they stare blankly for 3 seconds before responding, the restaurant feels slow and broken.

---

## 4. Basic Example: Observing Core Web Vitals with PerformanceObserver

```typescript
// performance-monitor.ts
import { onLCP, onCLS, onINP, Metric } from 'web-vitals';

function sendToAnalytics(metric: Metric) {
  const body = JSON.stringify({
    name: metric.name,
    value: metric.value,
    rating: metric.rating, // 'good' | 'needs-improvement' | 'poor'
    delta: metric.delta,
    id: metric.id,
    navigationType: metric.navigationType,
  });

  // Use Navigator.sendBeacon for non-blocking telemetry on page exit
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/analytics/vitals', body);
  } else {
    fetch('/api/analytics/vitals', { body, method: 'POST', keepalive: true });
  }
}

// Register official web-vitals listeners
export function initPerformanceMonitoring() {
  onLCP(sendToAnalytics);
  onCLS(sendToAnalytics);
  onINP(sendToAnalytics);
}
```

---

## 5. Real-World Production Example: Custom In-House Real User Monitoring (RUM) with `PerformanceObserver`

For enterprise platforms that cannot rely on external third-party SDKs, here is a zero-dependency implementation of native browser performance observation:

```typescript
// rum-observer.ts
export class CoreWebVitalsObserver {
  private clsScore: number = 0;

  constructor() {
    this.observeLCP();
    this.observeCLS();
    this.observeINP();
  }

  private observeLCP(): void {
    if (!PerformanceObserver.supportedEntryTypes.includes('largest-contentful-paint')) return;

    const observer = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const lastEntry = entries[entries.length - 1] as PerformanceEntry & {
        element?: Element;
        renderTime: number;
        loadTime: number;
      };

      const lcpTime = lastEntry.renderTime || lastEntry.loadTime;
      console.info(`[CWV] LCP: ${Math.round(lcpTime)}ms | Element:`, lastEntry.element);
    });

    observer.observe({ type: 'largest-contentful-paint', buffered: true });
  }

  private observeCLS(): void {
    if (!PerformanceObserver.supportedEntryTypes.includes('layout-shift')) return;

    const observer = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        const layoutShift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
        // Only count shifts that were NOT triggered by user interaction within 500ms
        if (!layoutShift.hadRecentInput) {
          this.clsScore += layoutShift.value;
          console.info(`[CWV] Current CLS Score: ${this.clsScore.toFixed(3)}`);
        }
      }
    });

    observer.observe({ type: 'layout-shift', buffered: true });
  }

  private observeINP(): void {
    if (!PerformanceObserver.supportedEntryTypes.includes('event')) return;

    const observer = new PerformanceObserver((entryList) => {
      for (const entry of entryList.getEntries()) {
        const eventEntry = entry as PerformanceEntry & {
          duration: number;
          interactionId: number;
          processingStart: number;
          processingEnd: number;
        };

        // Filter for meaningful user interactions (clicks, keypresses) with an interactionId
        if (eventEntry.interactionId) {
          const inputDelay = eventEntry.processingStart - eventEntry.startTime;
          const processingDuration = eventEntry.processingEnd - eventEntry.processingStart;
          const presentationDelay = eventEntry.startTime + eventEntry.duration - eventEntry.processingEnd;

          console.info(`[CWV] INP Interaction: ${Math.round(eventEntry.duration)}ms`, {
            inputDelay: Math.round(inputDelay),
            processingTime: Math.round(processingDuration),
            presentationDelay: Math.round(presentationDelay),
          });
        }
      }
    });

    // durationThreshold 40ms filters out micro-interactions
    observer.observe({ type: 'event', buffered: true, durationThreshold: 40 } as any);
  }
}
```

---

## 6. Under the Hood: The Critical Rendering Path & Metric Breakdown

```
HTML Parse Starts
      │
      ▼
┌──────────────┐
│ TTFB         │ -> Time to First Byte (Server Response + Network latency)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ FCP          │ -> First Contentful Paint (First text/canvas/SVG painted)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ LCP Subparts │ 1. TTFB (Time to First Byte): 40% of target budget (~1000ms)
│ Breakdown    │ 2. Resource Load Delay (Time until image URL is discovered)
│              │ 3. Resource Load Duration (Time to download asset over network)
│              │ 4. Element Render Delay (Time for CPU to decode & paint frame)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ INP Subparts │ 1. Input Delay (Queue time waiting for Main Thread to idle)
│ Breakdown    │ 2. Processing Time (Execution duration of JS event handlers)
│              │ 3. Presentation Delay (Compositing, style recalculation & paint)
└──────────────┘
```

---

## 7. Important Rules

1. **Prioritize the LCP Element**: If your LCP is an image, make sure it is **preloaded** in the HTML `<head>` using `<link rel="preload" as="image" href="..." fetchpriority="high">`. Never lazy-load your LCP hero image!
2. **Always Reserve Space for Images and Ad Embeds**: Set explicit `width` and `height` attributes or CSS `aspect-ratio` on all images, videos, and dynamic iframes. This allows the browser layout engine to allocate the exact aspect ratio box before the image downloads, reducing CLS to `0.00`.
3. **Yield to the Main Thread for Low INP**: Break long JavaScript tasks (> 50ms) into small chunks using `scheduler.yield()` or `setTimeout(..., 0)` so the browser can paint input responses immediately.
4. **Distinguish Lab Data from Field Data**:
   - **Lab Data (Lighthouse)**: Run on simulated mobile devices with artificial CPU throttling. Great for debugging, but does not reflect real user diversity.
   - **Field Data (CrUX / RUM)**: Anonymized metrics collected from real Chrome users on real networks and hardware. This is what Google uses for SEO rankings.
5. **Use `font-display: swap` or `optional`**: Prevent Flash of Invisible Text (FOIT) and layout shifts caused by custom web fonts swapping in late.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Lazy Loading the LCP Hero Image
```html
<!-- ❌ DISASTER: Delays LCP by 2 to 4 seconds! -->
<img src="hero-banner.webp" loading="lazy" alt="Hero">

<!-- ✅ OPTIMAL: High priority, eager loaded, responsive srcset -->
<img 
  src="hero-banner.webp" 
  loading="eager" 
  fetchpriority="high" 
  alt="Hero"
  width="1200" 
  height="600"
>
```

### 2. Dynamically Injecting Banners Above Existing Content
```typescript
// ❌ HIGH CLS: Pushes entire layout down after 2 seconds
useEffect(() => {
  fetchPromo().then((promo) => setBanner(promo));
}, []);

// ✅ CORRECT: Reserve container space with CSS min-height or sticky overlay
```

### 3. Blocking the Main Thread inside Click Handlers
Running heavy synchronous array filtering, JSON parsing, or large React state updates directly inside an `onClick` listener. The browser cannot paint the next frame until the script finishes, driving INP above 500ms.

---

## 9. Best Practices

- **Modern Image Optimization**: Serve images in modern formats (AVIF or WebP) with responsive `srcset` attributes to avoid sending 4K images to mobile screens:
  ```html
  <picture>
    <source srcset="hero.avif" type="image/avif">
    <source srcset="hero.webp" type="image/webp">
    <img src="hero.jpg" fetchpriority="high" width="800" height="400" alt="Platform">
  </picture>
  ```
- **Optimize INP with `scheduler.yield()`**:
  ```typescript
  async function handleFilterClick() {
    // 1. Give immediate visual feedback (e.g., active ripple/spinner)
    setButtonActive(true);

    // 2. Yield control to browser so it can paint the active state
    if ('scheduler' in window && 'yield' in (window as any).scheduler) {
      await (window as any).scheduler.yield();
    } else {
      await new Promise((r) => setTimeout(r, 0));
    }

    // 3. Perform heavy filtering task
    processHeavyFiltering();
  }
  ```

---

## 10. Performance Considerations

- **Server-Side Rendering (SSR) vs. Client-Side (CSR) for LCP**: SSR returns ready-to-render HTML directly from the server, allowing the browser to parse and paint text/images immediately (LCP < 1.2s). CSR (plain Create React App) requires downloading megabytes of JS bundles before rendering even begins (LCP > 3.5s).
- **CSS `contain: layout` & `content-visibility: auto`**: Offloads off-screen DOM subtree layout calculations, drastically improving initial page rendering speed and scroll responsiveness.

---

## 11. Security Considerations

- **Third-Party Script Sandboxing**: Third-party marketing tags (GTM, Meta Pixel, Hotjar) are the #1 cause of poor INP and high CLS. Load third-party scripts via `async` or `defer`, host them on your own CDN domain to avoid extra DNS lookups, or offload them to Web Workers using **Partytown**.

---

## 12. CWV Metric Diagnostics & Optimization Matrix

| Metric | Target | Main Root Causes | Primary Remediation |
| :--- | :--- | :--- | :--- |
| **LCP** | $\le 2.5\text{s}$ | Slow TTFB, render-blocking CSS/JS, lazy-loaded hero images | Preload hero image, CDN edge caching, SSR, compress images |
| **CLS** | $\le 0.10$ | Images without dimensions, dynamic ad injection, FOIT fonts | Set `width`/`height`, CSS `aspect-ratio`, `font-display: optional` |
| **INP** | $\le 200\text{ms}$| Long JavaScript tasks (>50ms), heavy re-renders, un-debounced inputs | Chunk tasks (`scheduler.yield()`), Web Workers, React `useTransition` |

---

## 13. Trade-offs

- **Image Compression vs. Visual Fidelity**: Compressing an LCP image to 40KB drops LCP to 1.2s, but excessive compression can introduce visible artifacts on Retina displays. The balance is using AVIF/WebP formats at 80% quality.
- **Client Hydration vs. INP**: Streaming SSR delivers fast LCP, but if hydration of massive interactive React component trees occurs while the user clicks a button, the main thread freezes, spiking INP.

---

## 14. Real-World Usage Case Studies

1. **Vodafone**: Improved LCP by 31%, resulting in an **8% increase in sales**, a 15% increase in lead-to-visit rate, and an 11% increase in shopping cart visits.
2. **The Economic Times**: Optimized CLS from 0.45 down to 0.05, cutting bounce rates by 43% across mobile web traffic.

---

## 15. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: What are the three official Core Web Vitals and what thresholds define a "Good" rating?**
> **Answer**:
> 1. **LCP (Largest Contentful Paint)**: $\le 2.5$ seconds.
> 2. **CLS (Cumulative Layout Shift)**: $\le 0.10$.
> 3. **INP (Interaction to Next Paint)**: $\le 200$ milliseconds.

### Tier 2: Conceptual
**Q: Why did Google replace First Input Delay (FID) with Interaction to Next Paint (INP) in 2024?**
> **Answer**: FID had major limitations: it only measured the *first* interaction of a session (ignoring subsequent clicks/keystrokes), and it only measured the *input delay* (the time waiting for the main thread to begin processing). It completely ignored the JavaScript execution duration and the time required to paint the resulting frame. INP evaluates *all* interactions across the user session and measures the entire roundtrip from user input to the visual paint of the next frame.

### Tier 3: Implementation
**Q: How do you completely eliminate CLS caused by dynamically loaded responsive images?**
> **Answer**: Use CSS `aspect-ratio` or native HTML `width` and `height` attributes:
> ```html
> <img src="image.jpg" width="800" height="450" style="width: 100%; height: auto; aspect-ratio: 16 / 9;" alt="...">
> ```
> Modern browsers use the `width` and `height` attributes to compute the aspect ratio before the file begins downloading, reserving the exact layout box and eliminating layout shifts.

### Tier 4: Debugging
**Q: A website has a fast LCP in Lighthouse (1.1s), but Google Search Console reports "LCP issue: longer than 4s" on mobile devices in the field. Why the discrepancy?**
> **Answer**: Lighthouse runs in an isolated lab environment with high-end CPUs, steady network simulation, and empty cache states. The field data (CrUX) comes from real users on low-end Android devices with 3G/4G connections and real network latency. Common causes include unoptimized multi-megabyte hero images served to mobile screens without `srcset`, slow backend TTFB for international users, or client-side JavaScript hydration blocking on slower mobile CPUs.

### Tier 5: Scenario
**Q: An e-commerce search page has an INP of 650ms whenever a user types into the search box. How do you diagnose and fix it?**
> **Answer**:
> 1. **Diagnosis**: Profile the interaction using Chrome DevTools Performance panel. Look for "Long Tasks" (>50ms) on the main thread during `input` and `keydown` events.
> 2. **Root Cause**: The search input handler is synchronously filtering thousands of array items and triggering an expensive React re-render of the entire product grid on every keystroke.
> 3. **Fix**:
>    - Debounce or throttle the input listener.
>    - Use React's `useDeferredValue` or `startTransition` to mark the search result list update as non-urgent, allowing the text input to update and paint immediately.
>    - Offload complex array filtering to a **Web Worker**.

### Tier 6: Advanced
**Q: Break down the four distinct sub-parts of Largest Contentful Paint (LCP) and explain how to optimize each.**
> **Answer**:
> LCP is mathematically composed of four parts:
> 1. **Time to First Byte (TTFB)**: Server processing and network latency. *Fix*: CDN edge caching, database query optimization, Redis caching.
> 2. **Resource Load Delay**: Time between TTFB and when the browser discovers the LCP image. *Fix*: Put `<link rel="preload">` in `<head>` and use `fetchpriority="high"`.
> 3. **Resource Load Duration**: Time to transfer the asset over the wire. *Fix*: Compress using modern AVIF/WebP, use responsive `srcset`, deploy on HTTP/3 CDN.
> 4. **Element Render Delay**: Time between asset download and visual paint. *Fix*: Eliminate render-blocking CSS/JS, avoid heavy client-side hydration delays.

---

## 16. Coding Question: Debounced Search Input with Concurrent Mode (`useTransition`) for Low INP

### Problem
Build an accessible React search input component that remains responsive (<50ms INP) even when filtering a massive list of 10,000 items on low-end devices.

### Solution

```tsx
import React, { useState, useTransition, useMemo } from 'react';

interface SearchProps {
  items: string[];
}

export function HighPerformanceSearch({ items }: SearchProps) {
  const [inputValue, setInputValue] = useState('');
  const [filteredResults, setFilteredResults] = useState<string[]>(items);
  // React 18 Concurrent Transition hook
  const [isPending, startTransition] = useTransition();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextQuery = e.target.value;
    
    // 1. High Priority Urgent Update: Renders input text immediately (Low INP)
    setInputValue(nextQuery);

    // 2. Low Priority Non-Urgent Update: Yields main thread to user keystrokes
    startTransition(() => {
      const lower = nextQuery.toLowerCase();
      const filtered = items.filter((item) => item.toLowerCase().includes(lower));
      setFilteredResults(filtered);
    });
  };

  return (
    <div style={{ padding: '1rem', maxWidth: '600px' }}>
      <label htmlFor="search-box" style={{ fontWeight: 'bold' }}>
        Filter 10,000 Items
      </label>
      <input
        id="search-box"
        type="text"
        value={inputValue}
        onChange={handleInputChange}
        placeholder="Type to filter..."
        style={{ width: '100%', padding: '8px', margin: '8px 0' }}
      />

      {isPending && <p aria-live="polite" style={{ color: '#666' }}>Filtering items...</p>}

      <ul style={{ maxHeight: '300px', overflowY: 'auto' }}>
        {filteredResults.slice(0, 100).map((item, idx) => (
          <li key={idx}>{item}</li>
        ))}
      </ul>
      {filteredResults.length > 100 && (
        <small>Showing first 100 of {filteredResults.length} results</small>
      )}
    </div>
  );
}
```

---

## 17. Common Interview Traps

- **Trap 1**: Thinking First Input Delay (FID) is still a Core Web Vital.
  *Gotcha*: Google officially deprecated FID and replaced it with **INP** (Interaction to Next Paint) on March 12, 2024. Mentioning FID as current indicates outdated knowledge.
- **Trap 2**: Confusing Lab metrics (Lighthouse score) with Field metrics (CrUX).
  *Gotcha*: Achieving a 100 Lighthouse score on a MacBook Pro does not mean your users have good Core Web Vitals. Google's search algorithm ranks sites exclusively based on real 75th-percentile field user data (CrUX).
- **Trap 3**: Believing `display: none` elements cannot affect CLS.
  *Gotcha*: While elements with `display: none` do not contribute to CLS while hidden, suddenly unhiding them without reserved dimensions pushes surrounding DOM content down, causing sudden layout shifts.

---

## 18. Revision Summary

- **The Three Core Web Vitals**:
  - **LCP ($\le 2.5\text{s}$)**: Perceived loading speed; marks when main visual element renders.
  - **CLS ($\le 0.10$)**: Visual stability; prevents accidental layout jumping.
  - **INP ($\le 200\text{ms}$)**: Interaction responsiveness throughout session lifecycle.
- **Key LCP Fixes**: Preload hero image, `fetchpriority="high"`, edge CDN caching, modern image formats (AVIF/WebP).
- **Key CLS Fixes**: Set explicit `width`/`height` or CSS `aspect-ratio` on all media and dynamic ad slots.
- **Key INP Fixes**: Break up long JS tasks (>50ms) using `scheduler.yield()`, Web Workers, and React `startTransition`.

---

## 19. Quick Reference

| Metric | Target | Measurement Tool | Key Optimization Target |
| :--- | :--- | :--- | :--- |
| **LCP** | $\le 2.5\text{s}$ | `PerformanceObserver('largest-contentful-paint')` | Preload hero image, SSR, CDN edge |
| **CLS** | $\le 0.10$ | `PerformanceObserver('layout-shift')` | Aspect ratio boxes, font-display swap |
| **INP** | $\le 200\text{ms}$ | `PerformanceObserver('event')` | Break long tasks, React `startTransition` |
| **CrUX** | 75th percentile | Chrome User Experience Report | Real-world field data used by Google SEO |
| **web-vitals**| NPM Library | `import { onLCP, onCLS, onINP } from 'web-vitals'` | Official Google metrics collector |
