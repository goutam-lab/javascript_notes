# CORS & Same-Origin Policy (SOP) Masterclass

## 1. What is it?
The **Same-Origin Policy (SOP)** is a fundamental security model implemented by all modern web browsers. It restricts how a document or script loaded by one "Origin" can interact with a resource from another "Origin". 

**CORS (Cross-Origin Resource Sharing)** is an HTTP-header-based mechanism that allows a server to explicitly relax the Same-Origin Policy, signaling to the browser: *"Yes, I permit JavaScript code running on `https://frontend.com` to read my API responses."*

---

## 2. Why does it exist?
Imagine you are logged into your online bank (`https://mybank.com`). Your browser holds your authentication cookies.
- **The Catastrophe Without SOP**: You click an email link and open `https://evil-attacker.com`. A script on the attacker's page runs:
  ```javascript
  fetch('https://mybank.com/api/transfer-funds', {
    method: 'POST',
    body: JSON.stringify({ to: 'hacker', amount: 50000 })
  });
  ```
- Because the browser automatically attaches cookies, the bank would execute the transfer and the attacker could read your balance!
- **SOP and CORS prevent this**: The browser blocks `https://evil-attacker.com` from reading or mutating the bank's internal API unless the bank's server explicitly returns headers giving `evil-attacker.com` permission.

---

## 3. Mental Model
💡 **Think of it like an Office Building Security Guard:**
- **The Browser is the Security Guard** stationed at the entrance of a high-security corporate building.
- **The Server is an Office inside the building**.
- **The JavaScript code is a messenger** sent by an external company (`frontend.com`).
- When the messenger arrives at the building, the Security Guard (Browser) halts them and asks the office (Server): *"Hey Server, this messenger from `frontend.com` wants to enter your office and take some files. Do you allow guests from `frontend.com`?"*
- If the Server replies: *"No"* (or says nothing), the Security Guard **tackles the messenger and shreds the response**!
- *Crucial Realization*: The server might have already processed the work, but the **Browser refuses to let JavaScript touch the data**!

### What Defines an "Origin"?
An Origin is strictly defined by the **3-Tuple: Protocol + Hostname + Port**:
$$\text{Origin} = \text{Protocol} + \text{Domain} + \text{Port}$$

Comparing against baseline: `http://example.com:80/app/index.html`
| Compared URL | Same Origin? | Why? |
|---|---|---|
| `http://example.com/api/data` | ✅ **YES** | Same protocol (`http`), same host (`example.com`), same port (`80`). |
| `https://example.com/api/data` | ❌ **NO** | Different protocol (`https` vs `http`). |
| `http://api.example.com/data` | ❌ **NO** | Different host (subdomain `api.example.com` $\neq$ `example.com`). |
| `http://example.com:3000/data`| ❌ **NO** | Different port (`3000` vs `80`). |

---

## 4. Basic Example: The Dreaded CORS Error in Browser Console
When an unauthorized cross-origin request is blocked by the browser, you see this classic error:

```
Access to fetch at 'https://api.backend.com/users' from origin 'http://localhost:3000' 
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present 
on the requested resource.
```

---

## 5. Real Example: Configuring Production CORS in Express
Building a production-grade CORS configuration in Express that supports multiple allowed environments (local, staging, production) with credentials:

```typescript
// cors-server.ts
import express, { Request, Response } from 'express';
import cors from 'cors';

const app = express();

// Whitelist of approved origins
const allowedOrigins = [
  'http://localhost:3000',
  'https://staging.myapp.com',
  'https://myapp.com'
];

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server or mobile app requests with no origin (like curl)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      callback(null, true); // Origin approved!
    } else {
      callback(new Error('Blocked by CORS: Unauthorized Origin'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count', 'X-RateLimit-Remaining'],
  credentials: true,       // Allow HttpOnly cookies to pass across origins
  maxAge: 86400            // Cache preflight OPTIONS response for 24 hours (86400s)
};

app.use(cors(corsOptions));
app.use(express.json());

app.get('/api/users', (req: Request, res: Response) => {
  res.setHeader('X-Total-Count', '150');
  res.json({ users: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] });
});

app.listen(5000, () => console.log('CORS-enabled API listening on port 5000'));
```

---

## 6. Under the Hood: Simple Requests vs. Preflight Requests

The browser categorizes all cross-origin requests into two distinct groups:

```
                      Is it a SIMPLE Request?
                      • Method is GET, HEAD, or POST
                      • Headers: Accept, Accept-Language, Content-Language
                      • Content-Type: text/plain, multipart/form-data,
                        or application/x-www-form-urlencoded
                                  │
                  ┌───────────────┴───────────────┐
                 YES                              NO
                  │                               │
                  ▼                               ▼
       [ Send Request Directly ]      [ 1. Send Preflight OPTIONS Request ]
                  │                               │
                  ▼                               ▼
       [ Check Allow-Origin ]         [ Server responds with Allowed Methods/Headers ]
                                                  │
                                                  ▼
                                      [ 2. If approved, send ACTUAL Request ]
```

### The Preflight Sequence Tracing (The `OPTIONS` Call):
When you send a JSON payload (`Content-Type: application/json`) with a Bearer Token:
1. **Preflight Request**: The browser automatically halts your code and sends a lightweight HTTP `OPTIONS` request first:
   ```http
   OPTIONS /api/orders HTTP/1.1
   Host: api.backend.com
   Origin: https://frontend.com
   Access-Control-Request-Method: POST
   Access-Control-Request-Headers: authorization, content-type
   ```
2. **Server Response**:
   ```http
   HTTP/1.1 204 No Content
   Access-Control-Allow-Origin: https://frontend.com
   Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
   Access-Control-Allow-Headers: Authorization, Content-Type
   Access-Control-Allow-Credentials: true
   Access-Control-Max-Age: 86400
   ```
3. **The Actual Request**: The browser verifies the response headers. If approved, it dispatches your actual `POST /api/orders` payload!

---

## 7. The Core CORS Response Headers

| Header | Meaning & Value |
|---|---|
| **`Access-Control-Allow-Origin`** | Specifies which origin is allowed to read the response (e.g. `https://myapp.com` or `*`). |
| **`Access-Control-Allow-Methods`** | Comma-separated list of permitted HTTP methods (`GET, POST, PUT, DELETE, OPTIONS`). |
| **`Access-Control-Allow-Headers`** | Permitted request headers (`Authorization, Content-Type`). |
| **`Access-Control-Allow-Credentials`** | Boolean (`true`). Required if the frontend sends cookies or Authorization headers. |
| **`Access-Control-Max-Age`** | Number of seconds the browser can cache the preflight `OPTIONS` response without re-checking. |
| **`Access-Control-Expose-Headers`** | Whitelists custom response headers (e.g. `X-Total-Count`) so client JavaScript can read them. |

---

## 8. Common Mistakes & Anti-Patterns

### ❌ Mistake 1: The Wildcard `*` + Credentials Disaster
```typescript
// ❌ BROKEN CONFIGURATION:
app.use(cors({
  origin: '*',          // Allow all origins
  credentials: true     // Allow cookies!
}));
```
- **The Error**: The browser halts with:
  `The value of the 'Access-Control-Allow-Origin' header in the response must not be the wildcard '*' when the request's credentials mode is 'include'.`
- **Why it breaks**: W3C security specifications strictly forbid using wildcard `*` with credentials. Allowing any arbitrary website to read authenticated cookie responses would completely defeat web security!
- **✅ The Fix**: Dynamically reflect the specific requesting origin if it matches an approved whitelist.

### ❌ Mistake 2: Trying to "Fix CORS" on the Frontend
- **The Confusion**: A junior developer tries setting CORS headers in their frontend `fetch()` call:
  ```javascript
  // ❌ USELESS: Setting this in client fetch does NOTHING to fix CORS!
  fetch('https://api.backend.com/data', {
    headers: { 'Access-Control-Allow-Origin': '*' }
  });
  ```
- **Reality**: `Access-Control-Allow-Origin` is a **Server Response Header**. The client cannot give itself permission!

### ❌ Mistake 3: Thinking CORS Protects the Backend Server
- **Trap**: Believing CORS stops hackers or unauthorized clients from accessing your API.
- **Reality**: **CORS is a BROWSER-ONLY security policy.**
  - If an attacker opens a terminal and runs `curl -X POST https://api.mybank.com/transfer`, or uses Postman or Python, **CORS is completely bypassed!**
  - CORS does not prevent your server from executing requests; it only prevents **third-party browsers from reading responses**. You still need API Authentication (JWT/API Keys), Rate Limiting, and input validation on the server!

---

## 9. Best Practices in Modern Production
1. **Cache Preflight Requests with `Access-Control-Max-Age`**:
   - Every preflight `OPTIONS` call adds an extra 50ms-150ms round-trip delay before the actual API call can begin.
   - Set `Access-Control-Max-Age: 86400` (24 hours) so the browser caches the permission for the entire day.
2. **Handle Reverse Proxy CORS (Nginx / Cloudflare)**:
   - For high performance, handle CORS directly at the Nginx reverse proxy or API Gateway level so preflight `OPTIONS` requests never even touch your Node.js application process!
3. **Use Reverse Proxy Path Routing in Development to Bypass CORS Completely**:
   - In Next.js or Vite, use a development rewrite proxy:
     ```javascript
     // vite.config.js or next.config.js
     rewrites: () => [{ source: '/api/:path*', destination: 'http://localhost:5000/api/:path*' }]
     ```
   - Now the browser makes requests to `http://localhost:3000/api/...`, making it a **Same-Origin** request and bypassing CORS preflights entirely!

---

## 10. Performance Considerations: Eliminating Preflight Overhead
Preflight requests double the network latency of every API call:
$$\text{Total Latency} = \text{RTT}(\text{OPTIONS}) + \text{RTT}(\text{Actual POST})$$
If you have users with 100ms mobile latency, an API call takes **200ms** instead of 100ms!
- **Optimizations**:
  1. Leverage `Access-Control-Max-Age: 86400`.
  2. In Next.js, use **Server Actions** or **Route Handlers** on the same domain so all client requests remain strictly Same-Origin.

---

## 11. Security Considerations: `Origin: null` Exploitation
When a webpage runs inside a local HTML file (`file://`) or a sandboxed iframe (`<iframe sandbox>`), the browser sends:
`Origin: null`
- **Vulnerability**: Insecure backend code that checks:
  ```javascript
  if (!origin || origin === 'null') res.setHeader('Access-Control-Allow-Origin', 'null');
  ```
- Attackers can host an exploit inside a sandboxed iframe, triggering the server to allow access to authenticated data!

---

## 12. Alternatives: Reverse Proxy Routing vs. CORS
| Architecture | Mechanism | Pros | Cons |
|---|---|---|---|
| **CORS Architecture** | Frontend at `app.com`, Backend at `api.com`. Server responds with CORS headers. | Independent hosting and deployment of frontend and backend. | Preflight latency penalty (`OPTIONS`); complex header configuration. |
| **BFF / Reverse Proxy (Single-Origin)** | Nginx routes `myapp.com/` to Next.js and `myapp.com/api/` to Express. | **Zero CORS preflight latency!** Simplifies cookies and security. | Requires unified routing configuration in Nginx/Cloudflare. |

---

## 13. Trade-offs: Strict Whitelist vs. Open API
- **Strict Origin Whitelist**: Mandatory for any API handling user sessions, cookies, or private data (banking, SaaS dashboards, internal tools).
- **Open Access (`Access-Control-Allow-Origin: *`)**: Appropriate only for public, unauthenticated read-only APIs (like Unsplash image APIs, public weather APIs, or public crypto price feeds).

---

## 14. Real-World Usage: Stripe Checkout & Webhooks
- **Stripe API**: Public payment intent creation endpoints allow cross-origin requests from merchant web pages using publishable keys (`pk_live_...`). Stripe returns `Access-Control-Allow-Origin: *` because the publishable key identifies the merchant and no user session cookies are used.
- **Stripe Dashboard**: Strictly enforces a private domain whitelist with `Access-Control-Allow-Credentials: true` to prevent unauthorized dashboards from reading financial transactions.

---

## 15. Placement Interview Questions

### Basic (Intern)
1. **What is the Same-Origin Policy (SOP), and why do browsers enforce it?**
   - *Spoken Answer*: "The Same-Origin Policy is a fundamental browser security mechanism that prevents scripts on one origin from accessing or reading DOM and network data from another origin. It exists to protect users from malicious sites executing unauthorized authenticated actions or stealing data from other sites where the user is currently logged in."

### Conceptual (Junior SDE)
2. **Why does Postman work without CORS errors, while your browser fetch fails with a CORS error?**
   - *Spoken Answer*: "Because CORS is strictly a **browser-enforced security policy**. Tools like Postman, cURL, and Python scripts are not web browsers; they do not have a DOM, do not execute untrusted third-party scripts, and do not enforce the Same-Origin Policy. They receive the server's response regardless of CORS headers. The browser, by contrast, intercepts the response and blocks JavaScript from reading it if the correct `Access-Control-Allow-Origin` header is absent."

### Implementation (SDE-1)
3. **What triggers a CORS Preflight (`OPTIONS`) request?**
   - *Spoken Answer*: "A preflight request is triggered whenever a cross-origin request is **not a Simple Request**. Specifically, it triggers if:
     1. The HTTP method is anything other than `GET`, `HEAD`, or `POST` (e.g. `PUT`, `DELETE`, `PATCH`).
     2. Custom headers are sent (like `Authorization`, `X-Api-Key`).
     3. The `Content-Type` is anything other than `application/x-www-form-urlencoded`, `multipart/form-data`, or `text/plain`—most commonly when sending JSON (`application/json`)."

### Debugging
4. **You configured `Access-Control-Allow-Origin: *`, but when the frontend sends an Authorization header or cookie, the browser blocks the request. Why?**
   - *Analysis*: When a request includes credentials (`credentials: 'include'`), the W3C CORS specification forbids using the wildcard `*`.
   - *Fix*: The backend must explicitly return the exact requesting origin:
     `Access-Control-Allow-Origin: https://frontend.com`
     and explicitly include:
     `Access-Control-Allow-Credentials: true`.

### Scenario-Based
5. **How can you eliminate all CORS preflight latency in a production full-stack application?**
   - *Spoken Answer*: "By placing both the frontend and the backend behind a single **Reverse Proxy (like Nginx, AWS CloudFront, or Cloudflare)**:
     - Route `/` $\rightarrow$ Next.js Frontend
     - Route `/api/*` $\rightarrow$ Express Backend
     Because the browser interacts with a single origin (`https://example.com`), all requests become Same-Origin. This eliminates 100% of CORS preflight `OPTIONS` calls, saving one full network round trip on every single API request."

### Advanced (Tier-1 Product Company)
6. **If a server receives a cross-origin POST request without CORS approval, does the database write still execute?**
   - *Spoken Answer*: "For a **Simple POST Request** (e.g. standard form submission without preflight), **YES!** The browser sends the POST request to the server, and the server executes the database write. However, when the server returns the HTTP response, the browser checks for `Access-Control-Allow-Origin`. Finding none, the browser blocks client JavaScript from reading the response.
     For a **Preflighted POST Request** (e.g. JSON payload), **NO**, because the browser sends the `OPTIONS` request first. If the `OPTIONS` check fails, the browser never sends the actual `POST` request, preventing the database write."

---

## 16. Placement Coding Challenge: Custom Raw Node.js CORS Middleware
Write a pure TypeScript CORS handler from scratch without using the `cors` npm package:

```typescript
// raw-cors.ts
import http from 'node:http';

export interface CORSOptions {
  allowedOrigins: string[];
  allowedMethods: string[];
  allowedHeaders: string[];
  allowCredentials?: boolean;
  maxAge?: number;
}

export function handleCORS(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options: CORSOptions
): boolean {
  const origin = req.headers.origin;

  if (origin && options.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    if (options.allowCredentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }

  // Handle Preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', options.allowedMethods.join(', '));
    res.setHeader('Access-Control-Allow-Headers', options.allowedHeaders.join(', '));
    if (options.maxAge) {
      res.setHeader('Access-Control-Max-Age', options.maxAge.toString());
    }
    res.writeHead(204); // No Content
    res.end();
    return true; // Request handled (Preflight halted)
  }

  return false; // Proceed to business logic
}
```

---

## 17. Common Interview Traps
- **Trap**: "Does CORS stop a distributed denial of service (DDoS) attack or prevent hackers from scraping your API?"
  - *Trap Explanation*: **Absolutely not.** Hackers do not use web browsers with Same-Origin restrictions to scrape APIs or launch DDoS attacks; they use automated Python scripts, Go binaries, or botnets. CORS only protects legitimate users in web browsers from having their credentials abused by third-party websites.
- **Trap**: "Can an image tag `<img src="https://other-domain.com/photo.jpg">` be blocked by CORS?"
  - *Trap Explanation*: By default, HTML embedding tags (`<img>`, `<video>`, `<script>`, `<link rel="stylesheet">`) are exempt from SOP for standard rendering. However, if client JavaScript attempts to read the raw pixel data using an HTML5 `<canvas>` (`getImageData`), the canvas is tainted and blocked unless the image server returned CORS headers!

---

## 18. Revision Summary
- **Same-Origin Policy (SOP)**: Restricts scripts on Origin A from reading resources from Origin B.
- **Origin Definition**: Protocol + Domain + Port.
- **CORS**: A mechanism where the server uses HTTP response headers to grant the browser permission to share data across origins.
- **Preflight (`OPTIONS`)**: Triggered on non-simple requests (JSON, PUT/DELETE, custom headers).
- **Wildcard Trap**: `Access-Control-Allow-Origin: *` fails if `Access-Control-Allow-Credentials: true`.
- **CORS is browser-enforced**: It does not protect servers from non-browser clients (cURL/Postman).

---

## 19. Quick Reference Cheat Sheet
```http
# The Essential CORS Server Response Headers:
Access-Control-Allow-Origin: https://myapp.com
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
Access-Control-Allow-Credentials: true
Access-Control-Max-Age: 86400
Access-Control-Expose-Headers: X-Total-Count
```
