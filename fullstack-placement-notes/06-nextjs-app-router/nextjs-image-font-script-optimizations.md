# Next.js Optimization APIs: Image, Font, and Script

## 1. What is it?
Next.js provides three dedicated optimization primitives built directly into the framework core to maximize Core Web Vitals (Largest Contentful Paint - LCP, Cumulative Layout Shift - CLS, and Interaction to Next Paint - INP):
1. **`next/image` (`<Image />`):** An evolution of the native HTML `<img>` element that delivers automated modern format conversion (AVIF/WebP), responsive `srcset` generation, lazy loading with blur placeholders, and visual stability without layout shifts.
2. **`next/font`:** Built-in font optimization engine that automatically self-hosts Google Fonts or custom local font files at build time, eliminating external third-party network requests (to `fonts.googleapis.com`) and zeroing out Cumulative Layout Shift (CLS) via automated CSS `size-adjust`.
3. **`next/script` (`<Script />`):** Intelligent third-party script loader that manages script loading order and execution timing using declarative strategies (`beforeInteractive`, `afterInteractive`, `lazyOnload`, `worker`).

```
+-------------------------------------------------------------------------------+
|                       NEXT.JS OPTIMIZATION PRIMITIVES                         |
+-------------------+---------------------------+-------------------------------+
| Primitive         | Target Metric             | Primary Optimization          |
+-------------------+---------------------------+-------------------------------+
| `next/image`      | LCP & Performance Score   | AVIF/WebP, resizing, lazyload |
| `next/font`       | CLS & Privacy (GDPR)      | Self-hosted, CSS size-adjust  |
| `next/script`     | INP & TBT (Total Blocking)| Non-blocking deferred loading |
+-------------------+---------------------------+-------------------------------+
```

---

## 2. Why does it exist?
Unoptimized media, fonts, and third-party scripts are the three greatest contributors to slow web page performance:
- **Image Bloat & Layout Shifts:** Traditional `<img>` tags load uncompressed multi-megabyte JPEGs/PNGs, lack fixed aspect ratios (causing the page to violently jump when images load, destroying CLS), and download images that are far outside the user's viewport.
- **Font Flash (FOUT/FOIT):** Loading Google Fonts traditionally required external DNS lookups, TCP handshakes, and SSL negotiation with Google's servers, blocking the render tree or displaying jarring fallback fonts.
- **Third-Party Script Deadlocks:** Tag managers, tracking pixels, and analytics scripts compete for main-thread CPU time, delaying initial page interaction and hurting INP.

Next.js automates these performance best practices at the compiler level.

---

## 3. Mental Model
Think of optimization APIs as an **Automated Pit Crew for a Formula 1 Racecar**:
- **`next/image` is the Fuel & Tire Strategist:** Instead of giving the car a heavy 50-gallon tank on lap 1, it calculates the exact amount of fuel needed for the current lap, swaps tires according to weather conditions (AVIF for modern browsers, WebP for older), and mounts tires only right as the car enters the pit lane.
- **`next/font` is the Custom Tailored Seat:** It molds the driver's seat during factory manufacturing (build time) so the driver never shifts around when accelerating (zero layout shift).
- **`next/script` is the Air Traffic Controller:** It prevents non-essential sponsor stickers and dashboard telemetry from blocking the engine ignition sequence.

---

## 4. Basic Example

### `<Image />` and `next/font/google`
```typescript
// app/page.tsx
import Image from 'next/image';
import { Inter } from 'next/font/google';

// Automatically self-hosted at build time; 0 external Google network requests!
const inter = Inter({ subsets: ['latin'], display: 'swap' });

export default function HomePage() {
  return (
    <main className={inter.className}>
      <h1>High Performance Architecture</h1>

      {/* Optimized Image with fixed aspect ratio to prevent CLS */}
      <Image
        src="/hero-banner.png"
        alt="Cloud Architecture Diagram"
        width={1200}
        height={630}
        priority={true} // High priority preload for Largest Contentful Paint (LCP)
        className="rounded-lg shadow-md"
      />
    </main>
  );
}
```

---

## 5. Real Example

### Responsive Hero Image with Blur Placeholder and Third-Party Script Management
```typescript
// app/product/[id]/page.tsx
import Image from 'next/image';
import Script from 'next/script';

export default function ProductDetailPage() {
  return (
    <div className="product-container max-w-4xl mx-auto p-6">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">Autonomous Robotics Node</h1>
      </header>

      {/* Responsive Image Container using `fill` and `sizes` */}
      <div className="relative w-full h-[400px] rounded-xl overflow-hidden bg-gray-100">
        <Image
          src="https://images.unsplash.com/photo-1546776310-eef45dd6d63c"
          alt="Autonomous Robotics Hardware"
          fill // Automatically stretches to fill parent container
          sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 800px"
          priority // Above the fold: Preload for fastest LCP
          placeholder="blur"
          blurDataURL="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA4IDUiPjxyZWN0IHdpZHRoPSI4IiBoZWlnaHQ9IjUiIGZpbGw9IiNlMmU4ZjAiLz48L3N2Zz4="
          className="object-cover"
        />
      </div>

      <p className="mt-6 text-gray-700">Detailed hardware telemetry specifications...</p>

      {/* Third-Party Analytics Script: Loaded ONLY after page is interactive */}
      <Script
        src="https://www.googletagmanager.com/gtag/js?id=G-XYZ123"
        strategy="afterInteractive" // Default strategy: Loads after page hydrates
      />
      <Script id="google-analytics" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-XYZ123');
        `}
      </Script>

      {/* Low Priority Script: Loaded during browser idle time */}
      <Script
        src="https://widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js"
        strategy="lazyOnload" // Lowest priority
      />
    </div>
  );
}
```

---

## 6. Under the Hood

### 1. `next/image` On-Demand Optimization Pipeline
When a user requests an image through `<Image src="/car.jpg" width={600} height={400} />`:
1. The browser requests `/_next/image?url=%2Fcar.jpg&w=640&q=75`.
2. The Next.js image optimization server (backed by the ultra-fast C library `sharp` in Node.js) inspects the browser's `Accept` HTTP header.
3. If the browser supports `image/avif`, it resizes and encodes the image into AVIF. If not, it falls back to WebP.
4. The generated image is cached on disk or the Edge CDN. Subsequent requests are served instantly from cache.

### 2. `next/font` Zero-CLS Engine
When you import a font:
```typescript
import { Roboto } from 'next/font/google';
const roboto = Roboto({ weight: '400', subsets: ['latin'] });
```
1. At build time, Next.js downloads the font files from Google and bundles them with your static assets.
2. The browser never makes requests to Google servers, complying with EU GDPR privacy regulations.
3. Next.js calculates the exact vertical glyph metrics of the web font and generates fallback CSS with `size-adjust`, `ascent-override`, and `descent-override`.
4. While the custom font loads, the fallback font matches the custom font's dimensions perfectly, resulting in **0.000 Cumulative Layout Shift**.

---

## 7. Important Rules
1. **Remote Domains Whitelisting:** To use external image URLs (e.g. Amazon S3, Unsplash) in `<Image />`, you **must** configure `remotePatterns` in `next.config.js`. Unregistered domains throw a runtime security error.
2. **Width/Height vs `fill`:** You must provide either explicit numerical `width` and `height` properties, or set `fill={true}` (in which case the parent element MUST have `position: relative` or `position: absolute`).
3. **Always Add `sizes` When Using `fill`:** Omitting `sizes` when using `fill` forces the browser to assume the image is 100vw across all devices, downloading oversized images on mobile screens.
4. **Reserve `priority` for Hero Images (LCP):** Add `priority={true}` only to the largest image visible in the initial viewport. Setting `priority` on every image hurts performance by congesting network bandwidth.

---

## 8. Common Mistakes

### Mistake 1: Forgetting `position: relative` on a Parent Container with `fill`
```typescript
// ❌ BROKEN: Image expands across the entire webpage instead of staying inside card!
<div className="w-64 h-64">
  <Image src="/logo.png" alt="Logo" fill />
</div>

// Fix:
<div className="relative w-64 h-64">
  <Image src="/logo.png" alt="Logo" fill />
</div>
```

### Mistake 2: Missing `remotePatterns` in `next.config.js`
```javascript
// next.config.js
module.exports = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        pathname: '/**',
      },
    ],
  },
};
```

---

## 9. Best Practices
1. **Use `display: 'swap'` on Fonts:** Ensures text remains visible using fallback metrics while the custom font file downloads.
2. **Use `next/font/local` for Custom Corporate Fonts:**
   ```typescript
   import localFont from 'next/font/local';
   const myFont = localFont({ src: './custom-sans.woff2' });
   ```
3. **Use `strategy="lazyOnload"` for Chat Widgets and Tracking Pixels:** Never allow support widgets (Intercom, Zendesk) to delay the initial load of your primary user experience.

---

## 10. Performance Considerations
- **Sharp Library in Production:** When self-hosting Next.js in a Docker container, always install `sharp` (`npm install sharp`). If `sharp` is missing, Next.js falls back to the slower JS-based `squoosh` library, increasing image transformation CPU load.
- **AVIF vs WebP:** AVIF compresses images 20% to 50% smaller than WebP with higher visual fidelity. Enable AVIF in `next.config.js`:
  ```javascript
  images: { formats: ['image/avif', 'image/webp'] }
  ```

---

## 11. Security Considerations
- **Image Optimization SSRF Defense:** Without `remotePatterns`, an attacker could supply malicious internal intranet URLs (`http://192.168.1.1/secret.png`) to `_next/image`, causing Server-Side Request Forgery. `remotePatterns` strictly enforces hostname and protocol allowlists.
- **Third-Party Script Sandboxing:** Scripts loaded via `next/script` run with full page privileges. Only load scripts from trusted domains with integrity checks.

---

## 12. Alternatives
- **Native HTML `<img>`:** Lacks automatic format conversion, responsive srcset calculation, and layout shift protection.
- **Third-Party Image CDNs (Cloudinary / Imgix):** Excellent external image services, but require additional paid subscriptions and setup.

---

## 13. Trade-offs

| Optimization API | Advantages | Drawbacks / Considerations |
| :--- | :--- | :--- |
| **`next/image`** | Auto AVIF/WebP; eliminates CLS; responsive | Consumes server CPU on first transformation |
| **`next/font`** | GDPR compliant; 0 external hits; 0 CLS | Adds font files to build bundle |
| **`next/script`** | Granular load prioritization; non-blocking | Complex timing if scripts depend on one another |

---

## 14. Real-World Usage
- **The Washington Post / Vercel Blogs:** All typography self-hosted via `next/font`, delivering instant text render without font flickers.
- **Airbnb / Real Estate Portals:** Thousands of dynamic property photos served via `next/image` with blur placeholders while lazy loading smoothly on infinite scroll.

---

## 15. Placement Interview Questions

### Basic
**Q: Why should you use `next/image` instead of the native HTML `<img>` tag?**  
*Answer:* `next/image` automatically optimizes images by converting them to modern formats (AVIF/WebP), resizes them dynamically for different viewports, lazy-loads offscreen images, generates blur placeholders, and prevents Cumulative Layout Shift (CLS) by reserving the required aspect ratio space.

### Conceptual
**Q: How does `next/font` eliminate Cumulative Layout Shift (CLS)?**  
*Answer:* `next/font` calculates the exact glyph metrics of the chosen web font at build time and injects fallback CSS rules with `size-adjust`, `ascent-override`, and `descent-override`. When the page first renders, the fallback font occupies the exact same vertical and horizontal space as the web font, eliminating layout shifts when the web font finishes loading.

### Implementation
**Q: Configure `next.config.js` to allow images from an AWS S3 bucket `my-bucket.s3.us-east-1.amazonaws.com`.**  
*Answer:*
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'my-bucket.s3.us-east-1.amazonaws.com',
        pathname: '/**',
      },
    ],
  },
};
module.exports = nextConfig;
```

### Debugging
**Q: You set `fill` on an `<Image />`, but the image overflows and takes over the entire viewport instead of staying within its card. Why?**  
*Answer:* Setting `fill={true}` gives the image `position: absolute; inset: 0; width: 100%; height: 100%`. For absolute positioning to be bounded, the immediate parent element must establish a positioning context by having `position: relative`, `position: absolute`, or `position: fixed`.

### Scenario
**Q: You are optimizing an e-commerce landing page where the Largest Contentful Paint (LCP) score is failing because the main banner image loads slowly. How do you fix it?**  
*Answer:* Add the `priority={true}` prop to the hero `<Image />`. This instructs Next.js to preload the image in the HTML `<head>` (`<link rel="preload">`) and disables lazy-loading, ensuring the browser fetches the hero asset immediately.

### Advanced
**Q: Explain the different script execution strategies available in `next/script` (`beforeInteractive`, `afterInteractive`, `lazyOnload`, `worker`).**  
*Answer:*
- `beforeInteractive`: Injected into the initial HTML document before any Next.js code runs. Reserved for critical scripts like bot detectors or consent banners.
- `afterInteractive` (default): Injected immediately after the page hydrates. Ideal for tag managers and primary analytics.
- `lazyOnload`: Deferred until all page resources have loaded and the browser is idle. Ideal for customer chat widgets and social feeds.
- `worker`: (Experimental) Offloads script execution to a Web Worker via Partytown, completely freeing the main thread.

---

## 16. Coding Questions

### Problem: Implement a Local Font and Responsive Image Card Component
```typescript
// components/HeroCard.tsx
import Image from 'next/image';
import localFont from 'next/font/local';

// Load local font from filesystem
const grotesqueFont = localFont({
  src: [
    { path: '../public/fonts/grotesque-regular.woff2', weight: '400', style: 'normal' },
    { path: '../public/fonts/grotesque-bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-grotesque',
});

interface HeroCardProps {
  title: string;
  category: string;
  imageSrc: string;
}

export function HeroCard({ title, category, imageSrc }: HeroCardProps) {
  return (
    <article className={`${grotesqueFont.variable} font-sans group relative overflow-hidden rounded-2xl bg-slate-900 border border-slate-800 p-6`}>
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-slate-800">
        <Image
          src={imageSrc}
          alt={title}
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 400px"
          className="object-cover transition-transform duration-300 group-hover:scale-105"
        />
      </div>

      <div className="mt-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
          {category}
        </span>
        <h3 className="mt-1 text-xl font-bold text-white">{title}</h3>
      </div>
    </article>
  );
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "`priority` should be placed on all images on the page."  
  *Truth:* False! `priority` disables lazy loading and forces immediate network download. Putting it on all images causes network bandwidth congestion, actually worsening LCP. Use it only on the 1-2 hero images above the fold.
- **Trap 2:** "`next/font` makes network requests to Google Fonts whenever a user visits the website."  
  *Truth:* False. Next.js downloads Google Fonts once during `next build` and self-hosts the files locally. Zero external requests are made at runtime.

---

## 18. Revision Summary
- `<Image />` automates AVIF/WebP conversion, responsive `srcset`, lazy loading, and CLS elimination.
- Parent container must have `position: relative` when using `fill`.
- Whitelist external image domains via `remotePatterns` in `next.config.js`.
- `next/font` self-hosts Google and local fonts at build time, preventing layout shift via automated CSS `size-adjust`.
- `<Script />` prioritizes loading via `beforeInteractive`, `afterInteractive`, and `lazyOnload`.

---

## 19. Quick Reference

```
+------------------------------------+-------------------------------------------+
| Optimization API                   | Usage / Configuration                     |
+------------------------------------+-------------------------------------------+
| <Image width={X} height={Y} />     | Fixed aspect ratio image optimization     |
| <Image fill sizes="..." />         | Responsive stretch to relative parent     |
| <Image priority />                 | Preloads hero image; boosts LCP           |
| Inter({ display: 'swap' })         | Google font with zero CLS                 |
| localFont({ src: '...' })          | Self-hosted custom font                   |
| <Script strategy="afterInteractive"| Loads third-party JS post-hydration       |
| <Script strategy="lazyOnload" />   | Lowest priority load during idle browser  |
+------------------------------------+-------------------------------------------+
```
