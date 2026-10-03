# Asset Optimization: Images, Next-Gen Web Fonts & Script Loading Strategies

## 1. What is it?
**Asset Optimization** is the discipline of minimizing the byte size, network latency, and browser rendering cost of non-code resources—specifically **Images**, **Web Fonts**, and **External JavaScript/CSS Files**.

Because images and fonts typically account for over **70% of total web page weight**, unoptimized media is the primary cause of slow **LCP (Largest Contentful Paint)** and jarring **CLS (Cumulative Layout Shift)** in real-world web applications.

Mastering modern asset pipelines involves leveraging next-gen formats (AVIF, WebP), responsive resolution switching (`<picture>`, `srcset`), self-hosted variable fonts with `font-display: swap`, and precise script loading attributes (`async` vs. `defer`).

---

## 2. Why does it exist?
- **The 4MB PNG Disaster**: An e-commerce catalog renders a 4000x3000px raw PNG image inside a 200x150px thumbnail. A mobile user on cellular data spends 10 seconds downloading 4MB for a tiny picture.
- **FOIT (Flash of Invisible Text)**: A web page loads, but all text is invisible for 3 seconds while a custom font downloads from Google Fonts, leaving blank holes on the screen.
- **Parser Blocking Scripts**: A `<script src="analytics.js">` in the document `<head>` freezes the browser HTML parser for 500ms while downloading over a slow connection, preventing any HTML from rendering.
- **The Optimization Solution**: Modern web standards allow automatic format conversion, responsive downscaling, font preloading, and asynchronous script deferral.

---

## 3. Script Loading Strategies: Normal vs. Async vs. Defer

Understanding the execution lifecycle of `<script>` tags is one of the most frequently asked technical placement questions:

```
HTML Parsing:       [ Parse HTML ] ──── PAUSED ────> [ Parse HTML ] ──> [ DOM Ready ]
Normal Script:                     [ Fetch ] [ Exec ]

HTML Parsing:       [ Parse HTML ] ───────── PAUSED ───> [ Parse HTML ]
Async Script:       [ Fetch (Parallel) ] ──> [ Exec ]

HTML Parsing:       [ Parse HTML ................................... ] ──> [ DOM Ready ]
Defer Script:       [ Fetch (Parallel) ] ───────────────────────────────> [ Exec ]
```

```
┌──────────────┬──────────────────────────────┬──────────────────────────────┬──────────────────────────────┐
│ Attribute    │ Network Fetching             │ Script Execution             │ Execution Order Guaranteed?  │
├──────────────┼──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ **Normal**   │ Blocks HTML parser           │ Blocks parser immediately    │ YES (Source order)           │
│ `<script>`   │                              │ upon download completion     │                              │
├──────────────┼──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ **`async`**  │ Parallel (Non-blocking)      │ Executes IMMEDIATELY when    │ ❌ NO! Whichever file        │
│              │                              │ downloaded (pauses parser)   │ finishes downloading first   │
├──────────────┼──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ **`defer`**  │ Parallel (Non-blocking)      │ Executes ONLY after the full │ ✅ YES! Preserves exact      │
│              │                              │ HTML document is parsed      │ document source order        │
└──────────────┴──────────────────────────────┴──────────────────────────────┴──────────────────────────────┘
```

> **The Golden Rule**:
> - Use **`defer`** for application logic scripts that depend on the DOM or on other scripts.
> - Use **`async`** only for independent third-party trackers (Google Analytics, Stripe, Sentry) that do not depend on the DOM.

---

## 4. Modern Image Formats: WebP vs. AVIF

```
┌───────────┬──────────────────────────────┬──────────────────────────────┬──────────────────────────────┐
│ Format    │ Compression Efficiency       │ Browser Support              │ Best Use Case                │
├───────────┼──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ **AVIF**  │ 🌟 50% smaller than JPEG     │ Modern Browsers (Chrome,     │ Photographic images, high-   │
│           │ Superior detail at low size  │ Firefox, Safari 16+)         │ fidelity marketing visuals   │
├───────────┼──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ **WebP**  │ 🌟 30% smaller than JPEG     │ Universal (97%+ of browsers) │ General web images, fallback │
│           │ Supports transparency & lossy│                              │ for older browsers           │
├───────────┼──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ **SVG**   │ Scalable vector math         │ 100% Universal               │ Logos, icons, simple artwork │
├───────────┼──────────────────────────────┼──────────────────────────────┼──────────────────────────────┤
│ **PNG**   │ Lossless (Large file size)   │ 100% Universal               │ Screenshots with crisp text  │
└───────────┴──────────────────────────────┴──────────────────────────────┴──────────────────────────────┘
```

---

## 5. Responsive Images: `<picture>`, `srcset` & `sizes`

Never serve a desktop-sized 1920px image to a mobile phone with a 375px viewport!

### Multi-Format & Multi-Resolution HTML Pattern:
```html
<picture>
  <!-- 1. Serve AVIF to cutting-edge browsers -->
  <source
    type="image/avif"
    srcset="/img/hero-small.avif 400w, /img/hero-large.avif 1200w"
    sizes="(max-width: 600px) 400px, 1200px"
  />

  <!-- 2. Fallback to WebP for standard modern browsers -->
  <source
    type="image/webp"
    srcset="/img/hero-small.webp 400w, /img/hero-large.webp 1200w"
    sizes="(max-width: 600px) 400px, 1200px"
  />

  <!-- 3. Base Fallback Image for legacy browsers & SEO crawlers -->
  <img
    src="/img/hero-large.jpg"
    alt="Developer working on high performance system"
    width="1200"
    height="600"
    loading="lazy"
    decoding="async"
    fetchpriority="high"
  />
</picture>
```

### Critical HTML Image Attributes:
1. **`loading="lazy"`**: Defers downloading off-screen images until the user scrolls within 200px of them (native browser lazy-loading).
2. **`fetchpriority="high"`**: Prioritizes the main **LCP hero image**, instructing the browser to download it before non-critical CSS/JS.
3. **`width` & `height`**: Prevents **Cumulative Layout Shift (CLS)** by allowing the browser to calculate the exact aspect ratio box before the image finishes downloading.

---

## 6. Next-Gen Web Font Optimization & Zero-Layout Shift

Custom web fonts often cause visual jumps or blank text. Modern font engineering requires 3 techniques:

### 1. The `font-display: swap` Property
```css
@font-face {
  font-family: 'Inter';
  src: url('/fonts/Inter-Variable.woff2') format('woff2');
  font-weight: 100 900;
  font-display: swap; /* Immediately renders fallback font, then swaps when Inter loads */
}
```

```
┌──────────────────────┬────────────────────────────────────────────────────────┐
│ Value                │ Behavior                                               │
├──────────────────────┼────────────────────────────────────────────────────────┤
│ `font-display: auto` │ Browser default (often blocks text for up to 3s: FOIT).│
│ `font-display: swap` │ Shows fallback font instantly, swaps when custom loads.│
│ `font-display: fallback`│ Tiny block period (100ms), 3s swap window; then fails.|
│ `font-display: optional`│ 🌟 Best for performance: only uses custom font if    │
│                      │ already in cache; never causes layout shift!           │
└──────────────────────┴────────────────────────────────────────────────────────┘
```

### 2. Preloading Critical Fonts
Tell the browser to start downloading the font in parallel with the HTML:
```html
<link
  rel="preload"
  href="/fonts/Inter-Variable.woff2"
  as="font"
  type="font/woff2"
  crossorigin
/>
```

---

## 7. Self-Hosting Fonts vs. Google Fonts CDN

Modern production systems **self-host fonts** (like Next.js `next/font` does):
- **Why Google Fonts CDN is slower**:
  1. Connecting to `fonts.googleapis.com` requires an extra DNS lookup, TCP handshake, and TLS negotiation.
  2. Browser partitioning: Chrome now partitions HTTP cache by origin. Even if a user previously downloaded "Inter" on another website, your site **cannot reuse that cached font file**.
- **Self-Hosting Benefits**: Fonts are served from your own domain or CDN edge, eliminating third-party connection latency and fully complying with GDPR privacy regulations.

---

## 8. Common Mistakes

### Mistake 1: Omitting `width` and `height` attributes on images
```html
<!-- ❌ DISASTROUS FOR CLS: -->
<img src="banner.jpg" alt="Banner" />
```
When the page loads, the browser allocates `0px` height for the image. When the image finishes downloading 1 second later, it suddenly pushes the entire text and article down by `400px`, causing a massive **Cumulative Layout Shift (CLS)** score penalty.

```html
<!-- ✅ CORRECT: Explicit aspect ratio reservation -->
<img src="banner.jpg" width="800" height="400" alt="Banner" style="width: 100%; height: auto;" />
```

---

## 9. Best Practices

1. **Use Variable Fonts (`.woff2`)**: A single variable font file contains all weights from 100 to 900, replacing 6 separate font files with one small 50KB asset.
2. **Subset Fonts**: Strip out unused character glyphs (e.g. Cyrillic or Greek symbols if building an English-only site) to reduce font size by 80%.
3. **Never Lazy-Load the Hero Image**: The above-the-fold hero image is your Largest Contentful Paint (LCP). Adding `loading="lazy"` to it delays LCP by several seconds!

---

## 10. Performance Considerations

- **Priority Hints (`fetchpriority`)**: Use `fetchpriority="high"` on LCP images and `fetchpriority="low"` on background carousel images.

---

## 11. Security Considerations

- **SVG Image Sanitization**: SVGs are XML documents that can contain executable `<script>` tags! If allowing user-uploaded avatars in SVG format, sanitize them with DOMPurify or serve them via `<img>` tags (where script execution is disabled by the browser).

---

## 12. Alternatives

| Asset Type | Unoptimized Legacy | Modern Production Standard |
| :--- | :--- | :--- |
| **Images** | JPEG / PNG | AVIF with WebP fallback + `srcset` |
| **Fonts** | Multiple TTF / OTF files via external CDN | Self-hosted WOFF2 Variable Font |
| **Scripts** | Synchronous `<script>` in `<head>` | Bundled chunks with `defer` |

---

## 13. Trade-offs

- **Benefit**: Reduces page payload by 60-80%; drastically improves Core Web Vitals (LCP < 2.5s, CLS < 0.1).
- **Cost**: Requires build-time image processing tools (Sharp, Squoosh, or Cloudinary).

---

## 14. Real-World Usage

- **Next.js (`next/image` & `next/font`)**: Automatically converts images to WebP/AVIF and inlines zero-layout-shift font metrics at build time.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the difference between `<script async>` and `<script defer>`?**  
*Answer*: Both fetch the script asynchronously in the background without blocking the HTML parser. The difference lies in execution:
- `async` executes the script **immediately upon download completion**, pausing the HTML parser, and does **not guarantee execution order** (whichever script downloads first runs first).
- `defer` waits until the **entire HTML document has finished parsing** before executing, and **strictly preserves document order**.

### Conceptual
**Q: How does specifying `width` and `height` attributes on an image prevent Cumulative Layout Shift (CLS) when using responsive CSS?**  
*Answer*: Modern browsers use the `width` and `height` HTML attributes to calculate the image's **aspect ratio** (`aspect-ratio = width / height`) before the image data has even begun downloading. When combined with responsive CSS (`width: 100%; height: auto;`), the browser automatically reserves the exact vertical height space on the page layout, preventing content below the image from jumping down when the image finishes loading.

### Implementation
**Q: Write an HTML `<picture>` element that serves an AVIF image on screens wider than 768px, falling back to WebP on mobile and JPEG for legacy browsers.**  
*Answer*:
```html
<picture>
  <source media="(min-width: 768px)" srcset="desktop.avif" type="image/avif" />
  <source srcset="mobile.webp" type="image/webp" />
  <img src="fallback.jpg" alt="Responsive visual" width="800" height="400" loading="lazy" />
</picture>
```

### Debugging
**Q: A web page loads, but for the first 2 seconds, all heading text is completely invisible, after which the text pops in with the custom font. What is this phenomenon called and how do you fix it?**  
*Answer*: This is **FOIT (Flash of Invisible Text)**, caused by the browser's default behavior of hiding text while waiting for an external font download. To fix it, add **`font-display: swap;`** inside the `@font-face` rule. This tells the browser to immediately render the text using a system fallback font (e.g. Arial or sans-serif) and seamlessly swap in the custom font once it has finished downloading.

### Scenario
**Q: Your client's homepage has an LCP (Largest Contentful Paint) score of 4.8 seconds because of a heavy promotional hero banner. What 3 changes will immediately bring LCP under 2.5 seconds?**  
*Answer*:
1. Convert the hero banner to **AVIF / WebP** format and resize it to exact viewport dimensions.
2. Remove any `loading="lazy"` attribute from the hero banner and add **`fetchpriority="high"`**.
3. Add a `<link rel="preload" as="image" href="..." fetchpriority="high">` tag in the document `<head>` so the browser discovers and requests the image immediately while parsing the HTML shell.

### Advanced
**Q: Why does loading Google Fonts from `fonts.googleapis.com` no longer benefit from shared browser caching across different domains?**  
*Answer*: To eliminate cross-site tracking and side-channel timing attacks, modern browser engines (WebKit, Blink, Gecko) implement **HTTP Cache Partitioning** (Double-Keyed Caching). The browser caches resources using a tuple of `(Top-Level Origin, Resource URL)`. Even if a user already downloaded the Roboto font from `fonts.googleapis.com` while visiting Website A, when they visit Website B, the browser treats it as a cache miss and downloads the font again from scratch.

---

## 16. Coding Challenge: Next.js-Style Image Component

**Task**: Implement a lightweight React `<OptimizedImage />` component that enforces aspect ratio layout reservation and uses native WebP/AVIF fallbacks.

```tsx
import React, { useState } from 'react';

interface OptimizedImageProps {
  src: string; // Base path without extension, e.g. "/images/hero"
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
}

export function OptimizedImage({
  src,
  alt,
  width,
  height,
  priority = false,
}: OptimizedImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        maxWidth: `${width}px`,
        aspectRatio: `${width} / ${height}`,
        backgroundColor: '#e2e8f0', // Placeholder skeleton color
        overflow: 'hidden',
      }}
    >
      <picture>
        <source srcSet={`${src}.avif`} type="image/avif" />
        <source srcSet={`${src}.webp`} type="image/webp" />
        <img
          src={`${src}.jpg`}
          alt={alt}
          width={width}
          height={height}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          {...(priority ? { fetchpriority: 'high' as any } : {})}
          onLoad={() => setIsLoaded(true)}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: isLoaded ? 1 : 0,
            transition: 'opacity 0.3s ease-in-out',
          }}
        />
      </picture>
    </div>
  );
}
```

---

## 17. Common Interview Traps

1. **"Adding `loading="lazy"` to all images makes the website faster."**  
   *Trap*: Lazy-loading everything.  
   *Reality*: Adding `loading="lazy"` to above-the-fold images (especially the LCP hero image) degrades performance by delaying when the browser initiates the download.
2. **"SVGs can always be used safely without security checks."**  
   *Trap*: Believing SVG is just an image.  
   *Reality*: SVG is raw XML that can execute JavaScript via embedded `<script>` or `onload` attributes.

---

## 18. Revision Summary

- **`defer`**: Non-blocking fetch; runs after DOM is parsed; preserves order.
- **`async`**: Non-blocking fetch; runs immediately upon download; no order guarantee.
- **Images**: Use AVIF/WebP with `<picture>`, define `width`/`height` to stop CLS.
- **Hero Image**: Use `fetchpriority="high"`, never lazy-load LCP images.
- **Fonts**: Use `font-display: swap;`, self-host WOFF2 variable fonts.

---

## 19. Quick Reference

```html
<!-- Script Rules -->
<script defer src="app.js"></script>
<script async src="analytics.js"></script>

<!-- Responsive Picture -->
<picture>
  <source srcset="img.avif" type="image/avif">
  <img src="img.jpg" width="800" height="400" alt="Hero" fetchpriority="high">
</picture>
```
