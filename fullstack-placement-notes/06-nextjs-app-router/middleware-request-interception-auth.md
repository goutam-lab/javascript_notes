# Middleware: Request Interception, Edge Runtime, and Authentication

## 1. What is it?
Next.js Middleware is a centralized boundary file (`middleware.ts` or `middleware.js`) positioned at the root of your application that executes **before any incoming request is completed**. Operating strictly within the lightweight V8 **Edge Runtime**, middleware intercepts HTTP requests, inspects cookies and headers, and controls the traffic flow by:
- **Redirecting:** Sending an HTTP 307/308 redirect to another route (e.g. unauthenticated users to `/login`).
- **Rewriting:** Serving an alternative internal route while keeping the browser URL unchanged (e.g. multi-tenant subdomain routing).
- **Modifying Headers & Cookies:** Setting contextual request headers (`x-user-id`, `x-tenant-id`) or response cookies before child routes execute.
- **Direct Responses:** Returning early JSON or HTML responses (e.g. rate-limit blocks).

```
+-------------------------------------------------------------------------------+
|                            MIDDLEWARE PIPELINE                                |
+-------------------------------------------------------------------------------+
| Browser Request ---> [ Edge Middleware (middleware.ts) ]                      |
|                            ├── 1. Path Matcher Check                          |
|                            ├── 2. JWT Verification (jose)                     |
|                            ├── 3. Bot / Rate-Limit Filtering                  |
|                            v                                                  |
|           +----------------+----------------+                                 |
|           |                                 |                                 |
|     (Unauthorized)                     (Authorized)                           |
|           v                                 v                                 |
| NextResponse.redirect('/login')       NextResponse.next()                     |
|                                             |                                 |
|                                             v                                 |
|                                  [ Target Page / Route ]                      |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?
Without centralized edge middleware:
- **Scattered Auth Checks:** Every individual page, layout, and API endpoint must duplicate boilerplate code to verify user sessions and permissions.
- **Slow Dynamic Server Hitting:** Unauthorized or malicious requests travel all the way to origin servers and database clusters before being rejected, wasting expensive server compute.
- **Subdomain & Tenant Complexity:** Routing tenants (e.g. `company.app.com` -> `app/tenants/company`) required complex proxy servers like NGINX or Cloudflare Workers.

Middleware unifies authentication gates, bot defenses, and URL rewrites at the edge within a single TypeScript file.

---

## 3. Mental Model
Think of Middleware as the **Airport Security Checkpoint (TSA)**:
- Before any traveler is allowed into the terminal (pages, layouts, database resources), they must pass through the security lane.
- If a traveler has no valid passport or boarding pass (JWT session cookie missing), the guard redirects them immediately to the check-in desk (`/login`).
- The security guard stamps the traveler's boarding pass with their terminal gate (`x-user-role: admin` header rewrite) so flight attendants down the line know their clearance.
- Because thousands pass through every minute, security guards do not run deep criminal background investigations (Edge runtime constraints); they perform rapid, high-speed credential verification.

---

## 4. Basic Example

### Simple Route Protection Middleware
```typescript
// middleware.ts (Must be at project root or src/)
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const sessionToken = request.cookies.get('session_token')?.value;

  // Protect all /dashboard routes
  if (request.nextUrl.pathname.startsWith('/dashboard')) {
    if (!sessionToken) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', request.nextUrl.pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

// Config matcher ensures middleware only runs on targeted routes
export const config = {
  matcher: ['/dashboard/:path*', '/settings/:path*'],
};
```

---

## 5. Real Example

### Production JWT Verification with `jose` and Header Ingestion
```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose'; // Edge-compatible JWT library

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'super-secret-key-32-chars-long-min'
);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const token = req.cookies.get('auth_token')?.value;

  // 1. Bypass public assets and static paths
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api/public') ||
    pathname === '/login' ||
    pathname === '/'
  ) {
    return NextResponse.next();
  }

  // 2. Validate Token presence
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // 3. Cryptographic Signature Verification in Edge Runtime
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET, {
      algorithms: ['HS256'],
    });

    // 4. Inject Verified User Metadata into Downstream Headers
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-user-id', payload.sub as string);
    requestHeaders.set('x-user-role', (payload.role as string) || 'user');

    return NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });
  } catch (error) {
    console.warn(`JWT verification rejected: ${error}`);
    // Token expired or forged: clear cookie and redirect
    const response = NextResponse.redirect(new URL('/login', req.url));
    response.cookies.delete('auth_token');
    return response;
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

---

## 6. Under the Hood

### 1. Edge Runtime Constraints
Middleware executes in the **Edge Runtime**, a V8 environment designed for instant startup (<5ms) and ultra-low memory overhead:
- **Supported:** Standard Web APIs (`fetch`, `Headers`, `Request`, `Response`, `Crypto`, `TextEncoder`, `URL`).
- **Unsupported:** Heavy Node.js native modules (`fs`, `child_process`, `net`, `tls`, native C++ bindings).
- Standard Node.js `jsonwebtoken` uses Node crypto and fails in Edge. You **must** use `jose` for Edge JWT verification.

### 2. `rewrite` vs. `redirect`
- `NextResponse.redirect(url)`: Returns an HTTP 307/308 status code to the browser. The browser's URL address bar changes.
- `NextResponse.rewrite(url)`: Proxies the request internally on the server. The user's address bar remains `example.com/company-a`, but Next.js internally renders the contents of `example.com/tenants/company-a`.

---

## 7. Important Rules
1. **Single File Convention:** You can only define **one** `middleware.ts` file per project, located in the project root or inside `src/`.
2. **Always Use the `matcher` Array:** Running middleware on every single image, CSS file, and font destroys performance. Configure the `matcher` to strictly exclude static assets (`/_next/static`, `/_next/image`, `favicon.ico`).
3. **No Direct Database Connections:** Because middleware runs on the Edge Runtime with cold-start connection limits, do not initialize heavy Prisma or MongoDB connections inside middleware. Use JWT verification or lightweight HTTP fetch calls to a key-value store (like Redis).
4. **Header Manipulation Protocol:** To pass headers to Server Components, use `NextResponse.next({ request: { headers } })`. To pass headers to the client browser, use `response.headers.set()`.

---

## 8. Common Mistakes

### Mistake 1: Importing `jsonwebtoken` in Middleware
```typescript
// ❌ CRASH: jsonwebtoken depends on Node.js 'crypto' and 'stream' modules not in Edge
import jwt from 'jsonwebtoken'; // Build/Runtime Failure in Middleware!
```
**Fix:** Use `import { jwtVerify } from 'jose';`.

### Mistake 2: Missing the Exclusion Matcher
```typescript
// ❌ WRONG: Middleware executes on every .png, .css, and .js file!
// Massively increases latency and server compute bills!
export function middleware(req: NextRequest) { ... }
// (No matcher defined!)
```

---

## 9. Best Practices
1. **Keep Middleware Ultra-Lean (<10ms):** Middleware blocks the Time to First Byte (TTFB) of every matched route. Keep operations to quick cookie checks, lightweight JWT verifications, or fast edge KV lookups.
2. **Multi-Tenant Subdomain Rewriting:**
   ```typescript
   const hostname = req.headers.get('host')!;
   const subdomain = hostname.split('.')[0];
   return NextResponse.rewrite(new URL(`/${subdomain}${req.nextUrl.pathname}`, req.url));
   ```
3. **Secure Headers Injection:** Add security headers (`X-Frame-Options`, `Content-Security-Policy`, `Strict-Transport-Security`) at the edge inside middleware so all routes inherit protection automatically.

---

## 10. Performance Considerations
- **TTFB Impact:** Every millisecond spent in middleware adds directly to the user's Time to First Byte. Avoid un-cached HTTP calls inside middleware.
- **Global Edge Proximity:** On Vercel, middleware runs at the edge node geographically closest to the user (e.g. Frankfurt, Mumbai, San Francisco), rejecting unauthorized requests before they ever hit the origin database center.

---

## 11. Security Considerations
- **Defense in Depth:** Middleware is your first line of defense, but never your only line. Always verify user ownership and permissions inside Server Actions and Data Fetching queries as well.
- **Cookie Tampering:** Always use cryptographically signed JWTs or encrypted session identifiers inside cookies to prevent users from fabricating fake session values.

---

## 12. Alternatives
- **Server Component Layout Guards:** Performing session checks inside `app/dashboard/layout.tsx`. Simpler, but cannot intercept static assets or perform URL rewrites.
- **Cloudflare Workers / AWS CloudFront Functions:** External edge proxies. Highly powerful, but decoupled from your Next.js application codebase.

---

## 13. Trade-offs

| Strategy | Advantages | Drawbacks |
| :--- | :--- | :--- |
| **Next.js Middleware** | Code colocated in app repo; edge latency; easy rewrites | Limited to Edge Runtime; blocks TTFB if slow |
| **Component Layout Guards**| Full Node.js runtime access (Prisma / SQL) | Slower rejection; cannot rewrite incoming URLs |
| **Cloudflare Workers** | Complete control over edge CDN | Managed in separate repository and CI pipeline |

---

## 14. Real-World Usage
- **Multi-Tenant SaaS (Vercel Platforms):** `companyA.myapp.com` is rewritten by middleware to render `app/sites/companyA/page.tsx` seamlessly.
- **A/B Testing & Geo-Routing:** Reading the user's `req.geo.country` header in middleware to rewrite `/shop` to `/uk/shop` or `/us/shop` without a client-side redirect flicker.

---

## 15. Placement Interview Questions

### Basic
**Q: Where must the `middleware.ts` file be located in a Next.js project?**  
*Answer:* It must be located at the root of the project (e.g. alongside `package.json`), or directly inside the `src/` directory if your project uses the `src/` directory convention. Only one middleware file is supported per application.

### Conceptual
**Q: What is the difference between `NextResponse.redirect` and `NextResponse.rewrite`?**  
*Answer:*
- `NextResponse.redirect` sends an HTTP 307/308 redirect back to the client, causing the browser address bar to update to the new URL.
- `NextResponse.rewrite` changes the destination URL internally on the server while leaving the browser address bar unchanged (URL masking/proxying).

### Implementation
**Q: Write a middleware matcher configuration that intercepts all routes except static assets, favicon, and image optimization paths.**  
*Answer:*
```typescript
export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
```

### Debugging
**Q: Why does connecting to PostgreSQL via Prisma inside `middleware.ts` cause a runtime failure?**  
*Answer:* Middleware runs on the V8 **Edge Runtime**, not standard Node.js. Prisma engine requires Node.js native child processes or network socket libraries unavailable in the Edge Runtime. Database queries in middleware should be avoided or performed via HTTP-based edge drivers (like Neon Serverless or Upstash Redis).

### Scenario
**Q: You need to implement an A/B test split where 50% of users see variant A and 50% see variant B without client-side layout shifts. How do you implement this?**  
*Answer:* In `middleware.ts`, inspect incoming cookies for an `ab-test-bucket` cookie. If missing, randomly assign `'A'` or `'B'`. Rewrite the incoming request URL to `/variant-a` or `/variant-b`, and attach the assigned cookie to the response:
```typescript
let bucket = req.cookies.get('bucket')?.value;
if (!bucket) bucket = Math.random() < 0.5 ? 'A' : 'B';
const res = NextResponse.rewrite(new URL(`/marketing/${bucket.toLowerCase()}`, req.url));
res.cookies.set('bucket', bucket);
return res;
```

### Advanced
**Q: How do you pass custom authenticated user information from `middleware.ts` to downstream Server Components?**  
*Answer:* You cannot mutate the `request` body or pass JavaScript objects directly. Instead, mutate the **request headers** using `NextResponse.next({ request: { headers: modifiedHeaders } })`. In downstream Server Components, read the values via `import { headers } from 'next/headers'`.

---

## 16. Coding Questions

### Problem: Implement a Role-Based Access Control (RBAC) Middleware Guard
```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const userRole = req.cookies.get('user_role')?.value;

  // Protect Admin Area
  if (pathname.startsWith('/admin')) {
    if (userRole !== 'ADMIN') {
      // Forbidden: Redirect to unauthorized notice
      return NextResponse.redirect(new URL('/unauthorized', req.url));
    }
  }

  // Protect Manager Area
  if (pathname.startsWith('/management')) {
    if (userRole !== 'ADMIN' && userRole !== 'MANAGER') {
      return NextResponse.redirect(new URL('/unauthorized', req.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/management/:path*'],
};
```

---

## 17. Common Interview Traps
- **Trap 1:** "You can have multiple middleware files in different subdirectories."  
  *Truth:* False! Next.js supports exactly one `middleware.ts` at the root. All routing logic and matchers must be consolidated there.
- **Trap 2:** "Middleware can read and write the database freely."  
  *Truth:* False. Due to Edge Runtime limits and cold-start connection exhaustion, heavy database queries in middleware are prohibited.

---

## 18. Revision Summary
- Middleware (`middleware.ts`) runs at the Edge before incoming requests hit pages or handlers.
- Runs on V8 Edge Runtime (use `jose` for JWTs; no native Node `fs` or `crypto`).
- Use `NextResponse.redirect` to change browser URL; use `NextResponse.rewrite` for invisible URL proxying.
- Always configure `matcher` to bypass static assets (`/_next/static`, images, icons).

---

## 19. Quick Reference

```
+------------------------------------+-------------------------------------------+
| Middleware API                     | Effect                                    |
+------------------------------------+-------------------------------------------+
| NextResponse.next()                | Passes request forward down the pipeline  |
| NextResponse.redirect(url)         | Sends HTTP 307/308 redirect to browser    |
| NextResponse.rewrite(url)          | Proxies request to another path secretly  |
| req.cookies.get('token')           | Reads cookie on incoming request          |
| res.cookies.set('key', 'val')      | Sets cookie on outgoing response          |
| req.nextUrl.pathname               | Parsed URL pathname                       |
| export const config = { matcher }  | Restricts middleware execution scope      |
+------------------------------------+-------------------------------------------+
```
