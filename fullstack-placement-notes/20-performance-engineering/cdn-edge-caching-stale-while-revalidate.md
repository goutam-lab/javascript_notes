# CDN Edge Caching: HTTP Cache-Control, Stale-While-Revalidate & Edge Compute Architecture

## 1. What is it?
**Content Delivery Network (CDN) Edge Caching** is the distributed systems strategy of storing copies of static and dynamic web assets (HTML pages, API responses, JavaScript chunks, images, and video fragments) across geographically dispersed proxy servers ("Points of Presence" or PoPs) located physically close to end-users (e.g., Cloudflare, AWS CloudFront, Fastly).

Instead of routing every user request back to the centralized origin server (e.g., an AWS data center in Virginia), the nearest edge PoP (e.g., Frankfurt, Mumbai, Tokyo) satisfies the request from its local in-memory/SSD cache in under 15ms.

The behavior of edge proxies is governed primarily by **HTTP Cache-Control Directives**, notably:
- `s-maxage`: Directs shared/edge caches (CDNs) how long to hold the response, overriding the browser's `max-age`.
- `stale-while-revalidate`: Instructs the edge cache to serve a stale (expired) asset to the user immediately while asynchronously fetching the updated version from the origin in the background.
- `stale-if-error`: Instructs the edge cache to continue serving stale data if the origin server returns a 5xx error or times out.

```
       Global User (e.g., Tokyo, Japan)
                       │
                       │ Latency: 8ms (Edge RTT)
                       ▼
┌────────────────────────────────────────────────────────┐
│ CDN Edge Point of Presence (Cloudflare Tokyo PoP)      │
│                                                        │
│ Is Cache Valid? (Age <= s-maxage)                      │
│   ├── YES -> Return 200 OK (Cache HIT: 12ms)           │
│   └── NO (Stale):                                      │
│       ├── If stale-while-revalidate active:            │
│       │   1. RETURN STALE DATA IMMEDIATELY (12ms) ───────► User receives instant page
│       │   2. Asynchronously revalidate in background:  │
│       │      Fetch from Origin (180ms WAN Latency) ────► Origin Server (US-East)
│       │      Update Edge Cache with fresh data         │
│       └── If no SWR:                                   │
│           Block user and wait for Origin (195ms)       │
└────────────────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Without CDN edge caching and stale-while-revalidate mechanics, global web applications suffer severe performance degradation:

1. **The Speed of Light Latency Limit**: Fiber optic packets take ~150ms–200ms to travel roundtrip between Sydney or Tokyo and US-East. Even with zero server processing time, TTFB (Time to First Byte) cannot drop below 200ms. Serving content from an edge PoP drops TTFB to 10ms–25ms globally.
2. **Origin Shielding (DDoS & Slashdot Protection)**: A viral post or flash sale driving 100,000 requests/sec would melt an origin database. With a 99% CDN cache hit ratio, the origin server processes only 1,000 requests/sec.
3. **Zero-Latency Invalidation (The Stale-While-Revalidate Revolution)**: Traditional caching forced a bad trade-off: either cache for a short time (frequent slow cache misses for users) or cache for a long time (users see outdated content). `stale-while-revalidate` delivers the best of both worlds: **users *always* get sub-20ms cached responses**, while the CDN automatically keeps content fresh via non-blocking background revalidations.
4. **Resilience During Origin Outages**: If your backend database crashes or enters maintenance mode, a CDN configured with `stale-if-error` continues serving the last known good pages to millions of visitors without a blip.

---

## 3. Mental Model: The Local Newspaper Kiosk
Think of CDN Edge Caching as a **Neighborhood Newspaper Kiosk**:
- **Origin Server**: The printing press printing newspapers 2,000 miles away.
- **Traditional Cache (`max-age=60`)**: The kiosk owner stocks newspapers at 8:00 AM. At 8:01 AM, when a customer asks for the news, the owner says "Wait here," drives 2,000 miles to the printing press, and brings back the paper. The customer waits 4 hours.
- **Stale-While-Revalidate (`s-maxage=60, stale-while-revalidate=3600`)**: At 8:05 AM, a customer arrives. The kiosk owner hands them the 8:00 AM edition immediately (instant gratification). While the customer walks away happy, the kiosk owner phones a delivery drone to drop off the 8:05 AM edition so it's ready for the *next* customer.

---

## 4. Basic Example: Configuring HTTP Headers in Express / Node.js

```typescript
import express, { Request, Response } from 'express';

const app = express();

app.get('/api/products/trending', (req: Request, res: Response) => {
  // Set HTTP Cache-Control header
  // 1. max-age=0: Tells browser NOT to store locally, always check with CDN
  // 2. s-maxage=60: Tells Edge CDN (Cloudflare/CloudFront) to cache for 60 seconds
  // 3. stale-while-revalidate=600: If 60s expires, serve stale for up to 10 minutes while fetching fresh in background
  // 4. stale-if-error=86400: If origin crashes, serve stale for up to 24 hours
  res.setHeader(
    'Cache-Control',
    'public, max-age=0, s-maxage=60, stale-while-revalidate=600, stale-if-error=86400'
  );

  // Return product payload
  res.status(200).json({
    generatedAt: new Date().toISOString(),
    products: [
      { id: 'p1', name: 'Mechanical Keyboard', price: 120 },
      { id: 'p2', name: 'Ultra-Wide Monitor', price: 450 },
    ],
  });
});
```

---

## 5. Real-World Production Example: Next.js Incremental Static Regeneration (ISR) & Edge Compute Routing

Next.js App Router's **Incremental Static Regeneration (ISR)** is built directly on top of the HTTP `stale-while-revalidate` edge caching primitive.

### Step 1: ISR in Next.js App Router (`app/products/[id]/page.tsx`)
```typescript
interface PageProps {
  params: Promise<{ id: string }>;
}

// Statically generated at build time, revalidated at edge every 60 seconds
export const revalidate = 60; // Equivalent to s-maxage=60, stale-while-revalidate

export default async function ProductPage({ params }: PageProps) {
  const { id } = await params;
  
  // Next.js automatically maps this to CDN Edge Cache headers
  const res = await fetch(`https://api.inventory.com/products/${id}`, {
    next: { revalidate: 60 },
  });
  const product = await res.json();

  return (
    <main>
      <h1>{product.name}</h1>
      <p>Price: ${product.price}</p>
      <small>Page rendered at: {new Date().toISOString()}</small>
    </main>
  );
}
```

### Step 2: Edge Worker Routing (Cloudflare Worker Middleware)
Intercepting and personalizing requests at the Edge without touching the central origin server:

```typescript
// edge-worker.ts (Runs on Cloudflare Workers / Vercel Edge Middleware)
export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    // 1. Edge Geolocation Routing: Read user's country from Cloudflare headers
    const country = request.headers.get('cf-ipcountry') || 'US';

    // 2. Fetch asset from Cache API first
    const cache = caches.default;
    const cacheKey = new Request(url.toString() + `?geo=${country}`, request);
    let response = await cache.match(cacheKey);

    if (response) {
      console.log('[Edge] Cache Hit for country:', country);
      return response;
    }

    // 3. Cache Miss: Fetch from Origin server
    console.log('[Edge] Cache Miss. Fetching origin...');
    response = await fetch(request);

    // 4. Clone response and store in Edge Cache with SWR
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=3600');
    headers.set('X-Edge-Location', request.headers.get('cf-ray') || 'unknown');

    const edgeResponse = new Response(response.body, {
      status: response.status,
      headers,
    });

    // Store in Edge Cache asynchronously without blocking response to client
    ctx.waitUntil(cache.put(cacheKey, edgeResponse.clone()));

    return edgeResponse;
  },
};
```

---

## 6. Under the Hood: The RFC 5861 `stale-while-revalidate` State Machine

```
      Request arrives at Edge CDN
                  │
                  ▼
          ┌───────────────┐
          │ Check Age (T) │
          └───────┬───────┘
                  │
       ┌──────────┴──────────┐
       │                     │
   T <= s-maxage      s-maxage < T <= (s-maxage + SWR)
       │                     │
       ▼                     ▼
┌──────────────┐      ┌─────────────────────────────────┐
│ FRESH HIT    │      │ STALE HIT (Revalidate Triggered)│
│ - Return     │      │ - Return cached content instantly│
│   Cached     │      │ - Asynchronously spawn          │
│   data       │      │   sub-request to origin         │
│ - Age: T     │      │ - On 200 OK from origin:        │
└──────────────┘      │   Overwrite cache with new data │
                      │   Reset Age to 0                │
                      └─────────────────────────────────┘
                             │
                             ▼ (If T > s-maxage + SWR)
                      ┌─────────────────────────────────┐
                      │ CACHE EXPIRED (Synchronous Miss)│
                      │ - Must wait for origin response │
                      └─────────────────────────────────┘
```

---

## 7. Important Rules

1. **Never Cache Authenticated User Responses at the Edge**:
   Responses containing personalized user data (e.g., account balance, profile settings, shopping carts) must **never** include `public` or `s-maxage`. If an edge cache stores an authenticated response, other users hitting the same edge PoP will receive another user's personal account data! Always use:
   `Cache-Control: private, no-store, no-cache`.
2. **Always Use `Vary` Headers When Content Depends on Headers**:
   If your server returns compressed gzip or brotli, or different languages based on `Accept-Language`, you must instruct the CDN to partition its cache:
   `Vary: Accept-Encoding, Accept-Language`.
   Without the `Vary` header, a browser that doesn't support Brotli might receive a cached Brotli file requested by an earlier visitor.
3. **Combine `s-maxage` with `max-age=0`**:
   Setting `Cache-Control: public, max-age=0, s-maxage=3600` ensures that individual user browsers do not hold stale copies in local cache (allowing instant client updates), while the CDN edge caches the file for an hour to protect your origin.
4. **Use Surrogate-Keys / Cache-Tags for Instant Purging**:
   Leading CDNs (Fastly, Cloudflare, CloudFront) support tagging responses with custom headers (e.g., `Cache-Tag: product-123, category-laptops`). When a product price changes, you invoke a single API call to purge `product-123` globally in 150ms without clearing the entire site cache.
5. **Implement `stale-if-error` for High Availability**:
   Always pair SWR with `stale-if-error=86400`. If an unexpected deployment bug takes down your API server, the CDN continues serving cached pages for 24 hours while your on-call team rolls back the deployment.

---

## 8. Common Mistakes & Anti-Patterns

### 1. The Catastrophic "Public Auth" Leak
```typescript
// ❌ CRITICAL SECURITY VULNERABILITY:
app.get('/api/user/me', (req, res) => {
  // Caching a personalized endpoint on a shared CDN!
  res.setHeader('Cache-Control', 'public, s-maxage=3600'); 
  res.json({ email: req.user.email, creditCardLast4: req.user.card });
});
// The first user's personal details are cached at the edge PoP!
// The next 10,000 visitors to that PoP see the first user's sensitive data!
```

### 2. Missing `no-cache` on `index.html` in Single Page Applications (SPAs)
Caching `index.html` on a CDN for 1 year. When you deploy a new version of your React app with new JavaScript bundle hashes, users never see the update because their browsers and CDN still hold the old `index.html` referencing old chunk hashes.
*Remediation*: Cache JavaScript and CSS chunks for 1 year (`max-age=31536000, immutable`), but cache `index.html` with `no-cache` or `s-maxage=0`.

### 3. Relying on Query Parameters Without CDN Configuration
Some legacy CDNs ignore query parameters by default (`/api/items?page=1` and `/api/items?page=2` return the same cached response). Ensure your CDN is configured to **Cache by Query String**.

---

## 9. Best Practices

- **The Gold Standard CDN Header for Static Assets (Images, Fonts, Hashed JS)**:
  ```http
  Cache-Control: public, max-age=31536000, immutable
  ```
  Tells browsers and CDNs that the file content will never change for 1 year. If the file changes, its filename hash changes (`main.a1b2c3.js`).
- **The Gold Standard CDN Header for Semi-Dynamic API Responses (Product Catalogs, Blog Posts)**:
  ```http
  Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=600, stale-if-error=86400
  ```
- **Programmatic Edge Cache Purging on Mutation**:
  ```typescript
  // When an admin edits a blog post:
  export async function onPostUpdated(slug: string) {
    await db.post.update({ ... });
    // Invalidate CDN Edge Cache immediately via Cloudflare API
    await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${CF_API_TOKEN}` },
      body: JSON.stringify({ tags: [`post:${slug}`] }),
    });
  }
  ```

---

## 10. Performance Considerations

- **Cache Hit Ratio (CHR)**: The primary metric for CDN efficacy. Aim for **CHR > 95%** on static assets and **CHR > 70%** on public dynamic APIs.
- **Tiered Caching / Origin Shield**: In massive global CDNs, having 300 PoPs query your origin independently on cache misses can still overwhelm the origin. Enable **Tiered Caching (Origin Shielding)**: regional PoPs query a designated upper-tier PoP (Origin Shield), which acts as a centralized cache buffer before hitting your origin.

---

## 11. Security Considerations

- **Web Application Firewall (WAF) Integration**: The CDN edge is your first line of defense against Layer 7 DDoS attacks, SQL injection, and credential stuffing. Terminate TLS and inspect traffic at the edge using Cloudflare WAF or AWS WAF rules before requests reach origin instances.

---

## 12. HTTP Cache Directives Comparison Matrix

| Directive | Cache Target | Meaning |
| :--- | :--- | :--- |
| `public` | Browser & Shared (CDN) | Any cache can store the response |
| `private` | Browser ONLY | Shared caches (CDN) must NEVER store it |
| `no-cache` | Browser & CDN | May cache, but MUST revalidate with origin before using |
| `no-store` | Everywhere | Must NEVER store any part of request/response in cache |
| `max-age=N` | Browser & CDN | Freshness lifetime for the client browser |
| `s-maxage=N` | Shared (CDN) ONLY | Overrides `max-age` for intermediate edge proxies |
| `stale-while-revalidate=N`| Shared (CDN) | Serve stale data while fetching fresh in background |
| `immutable` | Browser | Content will never change; never send conditional `If-None-Match` |

---

## 13. Trade-offs

- **Edge Personalization vs. Cache Hit Ratio**: Adding user cookies or granular query parameters to cache keys provides personalized user experiences, but fractures the cache into millions of tiny buckets, drastically reducing your Cache Hit Ratio.
- **Instant Purging vs. Stale-While-Revalidate**: Event-driven cache purging ensures data is always 100% up-to-date, but requires robust webhook synchronization and API calls. SWR is completely autonomous and requires zero infrastructure coordination, at the cost of brief moments of eventual consistency.

---

## 14. Real-World Usage Case Studies

1. **Vercel / Next.js**: Built their entire edge hosting platform around `stale-while-revalidate` (Incremental Static Regeneration). E-commerce stores powered by Next.js serve millions of product pages with sub-20ms TTFB worldwide while updating stock levels asynchronously in the background.
2. **BBC News**: Uses Fastly's edge compute and `stale-if-error` caching. When breaking news events generate millions of hits per minute, BBC origins experience near-zero load, and readers continue receiving news even if publishing database servers experience temporary failure.

---

## 15. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: What is the difference between `max-age` and `s-maxage` in the HTTP `Cache-Control` header?**
> **Answer**: `max-age` specifies the maximum time (in seconds) that a response is considered fresh for **all caches**, including private client browser caches. `s-maxage` (shared max-age) specifically targets **public shared caches** (such as CDN edge proxies like Cloudflare or AWS CloudFront) and completely overrides the `max-age` directive for those intermediaries, leaving the browser cache governed by `max-age`.

### Tier 2: Conceptual
**Q: Explain how the `stale-while-revalidate` directive works and why it improves user-perceived performance.**
> **Answer**: `stale-while-revalidate` instructs an edge cache that if an asset's freshness lifetime (`s-maxage`) has expired, the cache can immediately return the stale cached copy to the user, provided the asset has not exceeded the `stale-while-revalidate` window. In parallel, the edge cache asynchronously dispatches a background request to the origin server to fetch and cache the fresh copy. Users receive instant responses (<15ms) without waiting for network roundtrips to the origin.

### Tier 3: Implementation
**Q: What headers must you return from an Express API to ensure that CDN edge proxies cache a public product catalog for 5 minutes, serve stale data for up to 1 hour while updating, but force browsers to always check for updates?**
> **Answer**:
> ```http
> Cache-Control: public, max-age=0, s-maxage=300, stale-while-revalidate=3600
> ```

### Tier 4: Debugging
**Q: After updating a user's avatar image, the user complains that their profile still shows their old avatar, even though the database has the new image URL. What happened?**
> **Answer**:
> 1. The avatar image was served with long-lived browser caching headers (e.g., `Cache-Control: public, max-age=31536000`) under a static URL like `/avatars/user-123.jpg`. The browser is loading the old image directly from disk without contacting the server.
> 2. **Remediation**: Use **cache-busting URLs** (e.g., `/avatars/user-123.jpg?v=1710000000` or content hash `/avatars/user-123-a1b2c3.jpg`). When the user uploads a new avatar, the URL changes, forcing an immediate fetch of the new image.

### Tier 5: Scenario
**Q: How do you design an edge caching architecture for a global news website where the homepage is updated every 30 seconds, breaking news must appear within 5 seconds, and traffic spikes to 500,000 requests/sec?**
> **Answer**:
> 1. **Edge Caching with SWR**: Set `Cache-Control: public, s-maxage=30, stale-while-revalidate=60, stale-if-error=86400` on the homepage HTML.
> 2. **Surrogate Keys (Cache-Tags)**: Tag the homepage response with `Cache-Tag: page-home`.
> 3. **Instant Purge Webhook**: When an editor publishes breaking news in the CMS, trigger an automated webhook to Cloudflare/Fastly to purge the `page-home` tag globally (<150ms).
> 4. **Origin Shield**: Configure an Origin Shield PoP to collapse cache misses across global edge PoPs into a single origin request, ensuring the origin database never experiences more than 1 request every 30 seconds.

### Tier 6: Advanced
**Q: How does the HTTP `Vary` header prevent cache poisoning and cross-talk when serving localized or compressed content at the CDN edge?**
> **Answer**:
> By default, CDNs key cached entries based on the URL (`https://example.com/api/news`).
> If a French user requests this URL with `Accept-Language: fr`, and the server returns French content without a `Vary` header, the CDN stores that response under the plain URL key. When an English user later requests the same URL with `Accept-Language: en`, the CDN serves the French cached copy.
> By returning `Vary: Accept-Language, Accept-Encoding`, the server forces the CDN to construct a composite cache key incorporating both the URL and the specified request header values. This guarantees that clients receive the correct language and compression format without cache poisoning.

---

## 16. Coding Question: Edge Middleware for Conditional A/B Test Routing

### Problem
Write a Cloudflare Worker / Edge Middleware script that:
1. Inspects incoming user requests for an `ab_test_variant` cookie (`control` vs `treatment`).
2. If the cookie is absent, assigns the user randomly to `control` or `treatment` (50/50 split) and sets the cookie in the response.
3. Rewrites the request URL to fetch the corresponding cached static HTML page (`/variants/control.html` vs `/variants/treatment.html`) from the Edge Cache.

### Solution

```typescript
// edge-ab-router.ts
export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    // Only apply A/B test routing to the landing page
    if (url.pathname !== '/') {
      return fetch(request);
    }

    // 1. Read existing cookie
    const cookieHeader = request.headers.get('Cookie') || '';
    let variant: 'control' | 'treatment' | null = null;

    if (cookieHeader.includes('ab_test_variant=treatment')) {
      variant = 'treatment';
    } else if (cookieHeader.includes('ab_test_variant=control')) {
      variant = 'control';
    }

    // 2. If cookie absent, assign randomly
    let isNewAssignment = false;
    if (!variant) {
      variant = Math.random() < 0.5 ? 'control' : 'treatment';
      isNewAssignment = true;
    }

    // 3. Rewrite URL to fetch cached variant HTML
    const variantUrl = new URL(`/variants/${variant}.html`, url.origin);
    const variantRequest = new Request(variantUrl.toString(), request);

    // Fetch from edge cache / origin
    let response = await fetch(variantRequest);

    // 4. Attach Set-Cookie header if newly assigned
    if (isNewAssignment) {
      const newHeaders = new Headers(response.headers);
      newHeaders.append(
        'Set-Cookie',
        `ab_test_variant=${variant}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`
      );
      response = new Response(response.body, {
        status: response.status,
        headers: newHeaders,
      });
    }

    return response;
  },
};
```

---

## 17. Common Interview Traps

- **Trap 1**: Believing `no-cache` means "do not store in cache".
  *Gotcha*: `no-cache` actually means *"store in cache, but you MUST revalidate with the origin server (using `ETag` or `If-Modified-Since`) before using it"*. If you want the cache to completely ignore and never store the response, you must use **`no-store`**.
- **Trap 2**: Putting `stale-while-revalidate` on user session endpoints.
  *Gotcha*: SWR is strictly for public or anonymous resources. Putting SWR on personalized endpoints will cause users to see another user's stale profile data.
- **Trap 3**: Forgetting that CDNs ignore cookies on static assets by default.
  *Gotcha*: Most CDNs strip cookies from image and CSS requests to maximize cacheability. Do not attempt to personalize images using HTTP cookies without custom Edge Worker logic.

---

## 18. Revision Summary

- **Edge Caching**: Moves cached copies of web assets to globally distributed PoPs located within 15ms of end-users.
- **Directives**:
  - `s-maxage`: Controls expiration on shared CDN caches.
  - `max-age=0`: Prevents local browser caching while allowing CDN caching.
  - `stale-while-revalidate`: Serves stale data immediately while updating in background.
  - `stale-if-error`: Serves stale data if origin backend is down.
- **Security Rule**: Never mark authenticated user responses as `public` or `s-maxage`. Use `private, no-store`.
- **Invalidation**: Use Cache-Tags / Surrogate-Keys for sub-second targeted global purging.

---

## 19. Quick Reference

| Directive | Cache Destination | Typical Usage |
| :--- | :--- | :--- |
| `public, s-maxage=300, stale-while-revalidate=3600` | CDN Edge | High-traffic public API / Product catalog |
| `public, max-age=31536000, immutable` | Browser & CDN | Hashed static JS, CSS, fonts, images |
| `private, no-store, no-cache` | Nowhere | Authenticated user profile / Checkout / Auth |
| `stale-if-error=86400` | CDN Edge | Disaster recovery fallback if origin 5xxs |
| `Vary: Accept-Encoding` | CDN Edge | Partitions cache by compression format |
