# HTTP Status Codes & Headers Cheatsheet & Deep Dive

---

## 1. What is it?

The HTTP Status Codes and Headers Cheatsheet is an authoritative, complete operational guide covering the full spectrum of HTTP communication protocols (HTTP/1.1, HTTP/2, and HTTP/3 / QUIC). It systematically categorizes every critical status code (1xx Informational, 2xx Success, 3xx Redirection, 4xx Client Errors, and 5xx Server Errors), unpacks the semantic differences between confusing pairs (e.g., `301` vs `308`, `401` vs `403`, `502` vs `504`), and deconstructs essential HTTP request/response headers for **security hardening (CSP, HSTS)**, **caching hierarchies (`Cache-Control`, `ETag`)**, and **Cross-Origin Resource Sharing (CORS)**.

```
+-----------------------------------------------------------------------------------+
|                        HTTP Status Code Taxonomy                                  |
+-----------------------------------------------------------------------------------+
| 1xx: Informational (100 Continue, 101 Switching Protocols)                       |
| 2xx: Success (200 OK, 201 Created, 202 Accepted, 204 No Content, 206 Partial)     |
| 3xx: Redirection (301 Moved Perm, 302 Found, 304 Not Modified, 307 Temp, 308 Perm)|
| 4xx: Client Error (400 Bad Req, 401 Unauth, 403 Forbid, 404 Not Found, 409, 429)  |
| 5xx: Server Error (500 Internal Error, 502 Bad Gateway, 503 Overload, 504 Timeout)|
+-----------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Without strict HTTP status code and header standards:
1. **Broken REST Semantics:** Returning `200 OK` with a JSON payload `{ "error": "User not found" }` breaks HTTP caching, fools monitoring tools (Datadog/Sentry report 100% success rate), and ruins client library error handling.
2. **Security Vulnerabilities:** Omitting security headers leaves web applications vulnerable to Clickjacking (`X-Frame-Options`), Cross-Site Scripting (`Content-Security-Policy`), and Man-in-the-Middle downgrades (`Strict-Transport-Security`).
3. **Inefficient Network Caching:** Failing to utilize conditional caching headers (`ETag`, `If-None-Match`, `Cache-Control: s-maxage, stale-while-revalidate`) forces browsers and CDNs to re-download gigabytes of unchanged data, driving up cloud egress bills and degrading Core Web Vitals.

---

## 3. Mental Model

To master HTTP in interviews, visualize an HTTP transaction as a **Standardized Envelope with a Status Stamp**:

```
[ HTTP REQUEST ENVELOPE ]
  - Method & URI: POST /api/v1/payments HTTP/2
  - Headers:
      Host: api.stripe.com
      Authorization: Bearer sec_key_99
      Content-Type: application/json
      Idempotency-Key: idemp_12345
  - Payload: { "amount": 5000, "currency": "usd" }

                             |
                             v
[ SERVER PROCESSING & EVALUATION ]
                             |
                             v
[ HTTP RESPONSE ENVELOPE ]
  - Status Line: HTTP/2 201 Created
  - Headers:
      Content-Type: application/json
      Cache-Control: no-store
      Location: /api/v1/payments/pay_888
      Strict-Transport-Security: max-age=63072000; includeSubDomains
      X-Correlation-Id: corr_991823
  - Payload: { "id": "pay_888", "status": "succeeded" }
```

---

## 4. Basic Example

### Express Controller Setting Semantic Headers and Status Codes

```typescript
import { Request, Response } from "express";

export function getProductHandler(req: Request, res: Response) {
  const product = { id: "prod_1", name: "Mechanical Keyboard", price: 120 };
  const etag = '"hash_99a8b7"'; // Computed entity tag

  // Check if client already has the latest cached version
  if (req.headers["if-none-match"] === etag) {
    // 304 Not Modified: Client uses cached copy; ZERO response body sent!
    return res.status(304).end();
  }

  // Set Caching Headers
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
  
  // Set Security Headers
  res.setHeader("X-Content-Type-Options", "nosniff");

  return res.status(200).json(product);
}
```

---

## 5. Real Example

### Production Enterprise Security Headers Middleware

```typescript
import { Request, Response, NextFunction } from "express";

export function enterpriseSecurityHeaders(req: Request, res: Response, next: NextFunction) {
  // 1. HTTP Strict Transport Security (HSTS): Enforce HTTPS for 2 years
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=63072000; includeSubDomains; preload"
  );

  // 2. Content Security Policy (CSP): Strict origin lockdown
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'nonce-rAnD0m123'; object-src 'none'; frame-ancestors 'none';"
  );

  // 3. Prevent MIME-type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");

  // 4. Clickjacking Defense: Deny iframe embedding
  res.setHeader("X-Frame-Options", "DENY");

  // 5. Referrer Policy: Leak zero path data on cross-origin requests
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // 6. Permissions Policy: Restrict browser hardware capabilities
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );

  next();
}
```

---

## 6. Under the Hood

### HTTP Evolution: HTTP/1.1 vs HTTP/2 vs HTTP/3

```
+------------------------------------------------------------------------------------+
| HTTP/1.1 (1997): Text-based protocol. Head-of-Line (HoL) blocking at application   |
| level. 1 request per TCP socket at a time. Browsers open 6 TCP connections/domain. |
+------------------------------------------------------------------------------------+
| HTTP/2 (2015): Binary framing layer. Multiplexing (hundreds of streams over ONE    |
| single TCP socket). Header compression (HPACK). Server push.                       |
| Limitation: TCP-level Head-of-Line blocking (1 lost packet stalls all streams).   |
+------------------------------------------------------------------------------------+
| HTTP/3 (2020+): Built on QUIC (UDP instead of TCP). Eliminates HoL blocking!       |
| 0-RTT connection handshakes. Connection migration across WiFi/Cellular switches.  |
| QPACK header compression.                                                          |
+------------------------------------------------------------------------------------+
```

---

## 7. Important Rules

1. **The Rule of 204 No Content:** An HTTP `204 No Content` response **must never return a message body**. The Content-Length must be 0, and the response closes immediately. Ideal for `DELETE` operations or preflight `OPTIONS`.
2. **The Rule of Redirection Methods (`301/302` vs `307/308`):**
   - `301 Moved Permanently` & `302 Found`: Browsers historically rewrote `POST` requests to `GET` upon redirection.
   - `307 Temporary Redirect` & `308 Permanent Redirect`: Strictly mandate that the HTTP client **must NOT change the HTTP method** (`POST` remains `POST` after redirect).
3. **The Rule of ETag Generation:** Strong ETags (`"12345"`) guarantee byte-for-byte exact equality. Weak ETags (`W/"12345"`) guarantee semantic equivalence (e.g., two documents convey the same meaning even if whitespace differs).
4. **The Rule of `Cache-Control: no-cache` vs `no-store`:**
   - `no-cache`: Does **NOT** mean "don't cache". It means: "Cache the response, but **must revalidate with the server** (using ETag) before using it."
   - `no-store`: Strictly means **DO NOT store this response anywhere** (browser disk, memory, or CDN). Use for confidential banking or auth payloads.

---

## 8. Common Mistakes

### Mistake 1: The "200 OK with Error" Anti-Pattern
Returning HTTP 200 with `{ success: false, error: "Unauthorized" }`. This breaks standard HTTP caching proxies, prevents API gateways from tracking 4xx metrics, and violates REST specifications.

### Mistake 2: Confusing 401 Unauthorized and 403 Forbidden
Using `401` when a user is logged in but lacks permission.
- `401 Unauthorized` strictly means **Unauthenticated** ("Who are you? Missing or invalid token").
- `403 Forbidden` strictly means **Unauthorized** ("I know who you are, but you do not have permission to view this resource").

### Mistake 3: Setting `Cache-Control: max-age` on HTML Pages
Setting long `max-age=31536000` on the root `index.html`. When you deploy a new frontend build, users cannot see updates because the browser loads the old HTML from disk cache without querying the server. HTML should always use `no-cache`, while hashed assets (`bundle.a89f.js`) use `max-age=31536000, immutable`.

---

## 9. Best Practices

1. **The Modern Cache Header Strategy:**
   - For versioned static assets (hashed JS, CSS, images):
     `Cache-Control: public, max-age=31536000, immutable`
   - For dynamic API responses:
     `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`
   - For user-specific private data:
     `Cache-Control: private, no-cache`
   - For sensitive auth / payment tokens:
     `Cache-Control: no-store, max-age=0`
2. **Proper CORS Response Headers:** Never echo `Access-Control-Allow-Origin: *` with credentials. Validate incoming `Origin` against a strict whitelist array.
3. **Always Include `Vary: Accept-Encoding`:** Informs caching proxies to maintain separate cached versions for `gzip`, `br` (Brotli), and uncompressed responses.

---

## 10. Performance Considerations

* **Brotli (`br`) vs Gzip Compression:** Brotli provides 15%–25% higher compression ratios than Gzip for text/HTML/JS, reducing network transfer times. Use `Accept-Encoding: br, gzip`.
* **Early Hints (HTTP Status 103):** Allows the web server to send preliminary HTTP headers (linking CSS and fonts via `Link: </style.css>; rel=preload`) while the server is still computing the dynamic HTML payload, eliminating 200–500ms of client idle time.

---

## 11. Security Considerations

* **Clickjacking Protection:** Always configure `Content-Security-Policy: frame-ancestors 'none';` to prevent malicious attackers from framing your website in an invisible iframe to hijack user clicks.
* **MIME-Sniffing Exploit:** Browsers historically tried to guess content types if `Content-Type` was wrong (e.g., executing a user-uploaded image as JavaScript). Always send `X-Content-Type-Options: nosniff`.

---

## 12. Complete HTTP Status Codes Reference Matrix

| Code | Name | Description | Placement Gotcha |
| :--- | :--- | :--- | :--- |
| **100** | Continue | Initial request headers received; client should proceed to send body | Used in large file uploads |
| **101** | Switching Protocols | Client requested protocol switch (e.g., HTTP upgrade to WebSocket) | Handshake for WebSockets |
| **200** | OK | Standard successful HTTP request | Standard read/update |
| **201** | Created | Resource successfully created; returns `Location` header | Standard for `POST` |
| **202** | Accepted | Request accepted for asynchronous processing; not yet completed | Background job queues |
| **204** | No Content | Request succeeded; response body is intentionally empty | Standard for `DELETE` |
| **206** | Partial Content | Server is fulfilling a range request (`Range: bytes=0-1024`) | Video streaming |
| **301** | Moved Permanently | Target resource assigned a new permanent URI (SEO link juice passed) | Rewrites POST to GET |
| **302** | Found | Temporary redirect | Rewrites POST to GET |
| **304** | Not Modified | Cached version is valid; body is empty (saves bandwidth) | Paired with `ETag` |
| **307** | Temporary Redirect | Temporary redirect; **guarantees method does NOT change** | Preserves `POST` body |
| **308** | Permanent Redirect | Permanent redirect; **guarantees method does NOT change** | Modern replacement for 301 |
| **400** | Bad Request | Client sent malformed syntax or failed schema validation | Zod / JSON parse error |
| **401** | Unauthorized | Authentication is required or has failed (Missing/Invalid Token) | "Unauthenticated" |
| **403** | Forbidden | Server understands identity, but refuses authorization | "Unauthorized" |
| **404** | Not Found | Resource does not exist on the server | Resource missing |
| **405** | Method Not Allowed | Resource exists, but does not support HTTP method (e.g., POST on read-only) | Missing method handler |
| **409** | Conflict | Request conflicts with current state (e.g., duplicate email registration) | Optimistic lock failure |
| **410** | Gone | Resource permanently deleted and will never return (SEO removes immediately)| Different from 404 |
| **413** | Payload Too Large | Request body exceeds server configured upload limits | File upload rejection |
| **415** | Unsupported Media | Payload format is unsupported (e.g., client sent XML instead of JSON) | Content-Type mismatch |
| **422** | Unprocessable Entity | Syntax is valid, but semantic instructions fail (e.g., negative price) | Form validation |
| **429** | Too Many Requests | Rate limit exceeded; returns `Retry-After` header | Token bucket exhausted |
| **500** | Internal Server Error | Uncaught server exception or application crash | Backend bug |
| **501** | Not Implemented | Server does not support functionality required to fulfill request | Stubbed endpoints |
| **502** | Bad Gateway | Reverse proxy received invalid response or connection drop from upstream | Node app crashed |
| **503** | Service Unavailable | Server temporarily overloaded or down for maintenance | Health check failed |
| **504** | Gateway Timeout | Reverse proxy timed out waiting for upstream application response | Slow DB query timeout |

---

## 13. Trade-offs

* **Strong Caching (`immutable`) vs Instant Updates:** Setting aggressive 1-year cache headers maximizes CDN speed and eliminates server costs, but requires automated cache-busting asset hashing (`main.a1b2.js`) in CI/CD build pipelines.
* **Strict CSP vs Third-Party Integration:** Strict CSP headers protect against XSS, but break marketing scripts, analytics trackers (Google Tag Manager), and third-party widgets unless nonce-based or hash-based allowlists are actively maintained.

---

## 14. Real-World Usage

* **Netflix / YouTube:** Uses `HTTP 206 Partial Content` with `Range` headers to stream 2MB video byte-ranges dynamically based on user buffer state.
* **Stripe API:** Returns `HTTP 402 Payment Required` when card processing fails, and uses `Idempotency-Key` headers to ensure network retries never charge a customer twice.

---

## 15. Placement Interview Questions

### Basic Level
1. **Explain the difference between `401 Unauthorized` and `403 Forbidden`.**
   * *Answer:* `401 Unauthorized` means the client is **unauthenticated**; identity has not been verified (missing, malformed, or expired JWT). The response must include a `WWW-Authenticate` header. `403 Forbidden` means the client is **authenticated**, but lacks the necessary **authorization or role permissions** to access the resource (e.g., a standard user trying to access an admin endpoint).

2. **What is the difference between `301 Moved Permanently` and `308 Permanent Redirect`?**
   * *Answer:* When a client receives a `301 Moved Permanently` on a `POST` request, historical browser behavior allows the browser to change the HTTP method to `GET` for the redirected request, discarding the POST body. `308 Permanent Redirect` was created in RFC 7538 to explicitly mandate that the HTTP client **must preserve the original HTTP method and body** (`POST` remains `POST`).

3. **What is an `ETag` and how does `HTTP 304 Not Modified` save network bandwidth?**
   * *Answer:* An `ETag` (Entity Tag) is an HTTP response header containing a unique hash or version identifier representing the specific content of a resource. On subsequent requests, the client sends this value back in the `If-None-Match: <hash>` header. If the server verifies the data has not changed, it returns an empty `304 Not Modified` response without a body, saving 99% of bandwidth.

4. **What does the `Cache-Control: stale-while-revalidate` directive do?**
   * *Answer:* It allows the client or CDN edge proxy to immediately serve a stale cached response while asynchronously fetching a fresh version from the origin server in the background. It provides instant load times to the user without sacrificing eventual data freshness.

5. **What is the difference between HTTP/1.1 and HTTP/2?**
   * *Answer:* HTTP/1.1 is text-based and processes requests sequentially per TCP connection, suffering from Head-of-Line (HoL) blocking (requiring browsers to open up to 6 connections per domain). HTTP/2 is binary-framed and introduces **multiplexing**, allowing hundreds of concurrent bidirectional requests and responses to stream over a **single TCP connection**, along with header compression (HPACK).

---

### Conceptual Level
6. **Explain what an HTTP Preflight Request is and why the browser sends it.**
   * *Answer:* A preflight request is an automatic `OPTIONS` request dispatched by the browser before executing a cross-origin request that is not considered a "Simple Request" (e.g., requests using `PUT`/`DELETE`, custom headers like `Authorization`, or `Content-Type: application/json`).
   * *Why:* It checks with the server whether the origin, method, and headers are permitted *before* executing a potentially dangerous state-changing operation on the server.

7. **How does HTTP/3 solve the TCP Head-of-Line Blocking problem present in HTTP/2?**
   * *Answer:* In HTTP/2, all multiplexed streams share a single underlying TCP connection. If a single network packet is dropped, TCP halts all streams on that connection until the missing packet is retransmitted and acknowledged. HTTP/3 replaces TCP with **QUIC (running over UDP)**. In QUIC, each stream is independent at the transport layer; dropping a packet on Stream 3 halts only Stream 3, while Streams 1, 2, and 4 continue processing without delay.

8. **What is the purpose of the `Vary` header?**
   * *Answer:* The `Vary` HTTP header tells intermediate caching proxies (CDNs) which incoming request headers must match in order to serve a cached response. For example, `Vary: Accept-Encoding, User-Agent` prevents a mobile user from receiving a cached desktop page, and prevents a browser that only supports `gzip` from receiving a cached `br` (Brotli) response.

9. **Explain the difference between `no-cache` and `no-store` in `Cache-Control`.**
   * *Answer:*
     - `no-cache`: The browser CAN cache the response, but it MUST send a validation request to the origin server (using `If-None-Match` or `If-Modified-Since`) before using the cached copy.
     - `no-store`: The browser and all intermediate proxies MUST NOT store any part of the request or response in cache or disk storage under any condition.

10. **What is HTTP Strict Transport Security (HSTS) and what does `preload` mean?**
    * *Answer:* HSTS (`Strict-Transport-Security: max-age=63072000; includeSubDomains`) instructs browsers that the domain must **only be accessed via HTTPS**, automatically upgrading any plain `http://` links before network dispatch. `preload` allows the domain to be included in Google's hardcoded browser HSTS Preload List, ensuring that even the user's very first visit to the domain is securely encrypted over HTTPS without an initial insecure HTTP redirect.

---

### Implementation Level
11. **Write a complete CORS middleware implementation from scratch without using the `cors` npm package.**
    * *Answer:*
    ```typescript
    import { Request, Response, NextFunction } from "express";

    const ALLOWED_ORIGINS = ["https://app.example.com", "https://admin.example.com"];

    export function customCors(req: Request, res: Response, next: NextFunction) {
      const origin = req.headers.origin;

      if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Correlation-Id");
        res.setHeader("Access-Control-Max-Age", "86400"); // Cache preflight for 24 hours
      }

      // Handle Preflight Request
      if (req.method === "OPTIONS") {
        return res.status(204).end();
      }

      next();
    }
    ```

12. **How do you implement an API endpoint that supports HTTP Range requests for video streaming (`HTTP 206 Partial Content`)?**
    * *Answer:*
    ```typescript
    import fs from "fs";
    import path from "path";
    import { Request, Response } from "express";

    export function streamVideo(req: Request, res: Response) {
      const videoPath = path.resolve(__dirname, "video.mp4");
      const stat = fs.statSync(videoPath);
      const fileSize = stat.size;
      const range = req.headers.range;

      if (!range) {
        res.setHeader("Content-Length", fileSize);
        res.setHeader("Content-Type", "video/mp4");
        return fs.createReadStream(videoPath).pipe(res);
      }

      // Parse Range: bytes=1000-
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Content-Length", chunkSize);
      res.setHeader("Content-Type", "video/mp4");

      fs.createReadStream(videoPath, { start, end }).pipe(res);
    }
    ```

13. **How do you generate and validate a Weak ETag for database query results?**
    * *Answer:*
    ```typescript
    import crypto from "crypto";

    export function generateWeakETag(data: any): string {
      const json = JSON.stringify(data);
      const hash = crypto.createHash("md5").update(json).digest("hex");
      return `W/"${hash}"`;
    }
    ```

14. **How do you configure an API to return `429 Too Many Requests` with rate limit headers?**
    * *Answer:*
    ```typescript
    res.setHeader("X-RateLimit-Limit", 100);
    res.setHeader("X-RateLimit-Remaining", 0);
    res.setHeader("Retry-After", 60); // Seconds to wait
    return res.status(429).json({ error: "Rate limit exceeded. Try again in 60s." });
    ```

15. **How do you implement a Content Security Policy (CSP) with a dynamic cryptographic nonce in Express?**
    * *Answer:*
    ```typescript
    import crypto from "crypto";

    app.use((req, res, next) => {
      const nonce = crypto.randomBytes(16).toString("base64");
      res.locals.nonce = nonce;
      res.setHeader(
        "Content-Security-Policy",
        `default-src 'self'; script-src 'self' 'nonce-${nonce}'; object-src 'none';`
      );
      next();
    });
    ```

---

### Debugging Level
16. **Why does an API request from a React SPA fail with `CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource` even though the backend returned HTTP 500?**
    * *Answer:* When the backend server threw an unhandled exception (HTTP 500), the global error handler sent an error response *before* the CORS middleware added the `Access-Control-Allow-Origin` header (or the error handler bypassed the middleware stack). The browser received the 500 error, noted the absence of the CORS header, and blocked the response from reaching JavaScript. Ensure CORS headers are added *before* or *inside* error handlers.

17. **Why did a mobile browser continue showing an outdated profile picture even though the user uploaded a new image?**
    * *Answer:* The backend served the avatar image with `Cache-Control: public, max-age=31536000` without changing the image URL (`/users/123/avatar.png`). The browser read the file from disk cache without checking the server. Solution: Implement **Cache-Busting URLs** (e.g., `/users/123/avatar.png?v=1700000000` or `/avatars/hash123.png`) or use `ETag` validation with `Cache-Control: no-cache`.

18. **Why does a client receive `HTTP 415 Unsupported Media Type` when sending a JSON payload to an Express server?**
    * *Answer:* The client omitted the `Content-Type: application/json` header in the request, or sent `text/plain`. Express's `express.json()` middleware specifically inspects the `Content-Type` header; if it does not match `application/json`, it ignores the body or rejects it.

19. **Why does an Nginx reverse proxy intermittently return `HTTP 502 Bad Gateway`?**
    * *Answer:* Nginx successfully received the connection from the client, but the upstream application server (e.g., Node.js Express process) crashed, was restarted by PM2, or abruptly terminated the socket connection without sending an HTTP response. Check Node.js application logs for uncaught exceptions or OOM crashes.

20. **Why did users experience infinite redirect loops after an SSL certificate installation?**
    * *Answer:* Nginx terminated SSL on port 443, but proxied requests to the Node.js backend over plain HTTP (`http://localhost:3000`). The Node.js application contained middleware redirecting all non-HTTPS traffic to HTTPS (`if (req.protocol !== 'https') res.redirect('https://...')`). Because Nginx did not forward `X-Forwarded-Proto: https`, Node assumed the request was plain HTTP and repeatedly issued 301 redirects to HTTPS.

---

### Scenario-Based Questions
21. **Scenario: You are designing an API for a financial transaction where network timeouts are common. How do you design the headers and status codes to ensure clients never double-charge?**
    * *Answer:*
      - Mandate an `Idempotency-Key: <UUID>` header on all `POST /api/charges` requests.
      - If the key is new: execute charge, commit transaction, store response payload in Redis keyed by the idempotency key, and return `201 Created`.
      - If the client times out and retries with the same `Idempotency-Key`: backend looks up Redis, detects existing completed transaction, and immediately returns the cached `201 Created` response without re-executing the charge.

22. **Scenario: Your SaaS platform needs to deprecate an old API endpoint (`/v1/users`) in favor of `/v2/users`. How do you communicate this via standard HTTP headers?**
    * *Answer:*
      - Return standard HTTP response with **Deprecation and Sunset Headers** (RFC 8594):
        ```http
        Deprecation: @1735689600
        Sunset: Wed, 01 Jul 2026 00:00:00 GMT
        Link: </v2/users>; rel="successor-version"
        ```
      - Client SDKs inspect these headers to log deprecation warnings automatically.

23. **Scenario: You are releasing a breaking update to your production CSS and JS files on AWS CloudFront CDN. How do you ensure users instantly receive the new version without purging the entire CDN cache?**
    * *Answer:* Use **Content-Hashed Filenames** (`app.88f2a1.js`, `styles.9c3b4a.css`). Never configure CDN caches on un-hashed filenames. Because the file names change with every code change, the CDN treats them as brand new resources, guaranteeing instant cache updates while allowing old versions to be cached forever (`max-age=31536000, immutable`).

24. **Scenario: An attacker attempts to load your online banking login portal inside an invisible `<iframe>` on `free-giftcards.com`. What headers neutralize this attack?**
    * *Answer:*
      - `Content-Security-Policy: frame-ancestors 'none';` (Modern standard).
      - `X-Frame-Options: DENY` (Legacy browser fallback).
      - The browser inspects these headers and immediately refuses to render the document inside any frame.

25. **Scenario: How do you configure an API to safely return 500,000 search records without exhausting server memory or browser network buffers?**
    * *Answer:*
      - Never return 500,000 records in a single JSON array!
      - Enforce cursor-based pagination returning `HTTP 200 OK` with `20` records per page.
      - If an export is required: return `HTTP 202 Accepted` with a job status URL, generate the export asynchronously into an S3 bucket, and return a signed download link.

---

### Advanced Architectural Questions
26. **What is HPACK and QPACK header compression?**
    * *Answer:* In HTTP/1.1, redundant headers (Cookies, User-Agent) were re-transmitted in plain text on every single request, wasting bandwidth.
      - **HPACK (HTTP/2):** Maintains static and dynamic lookup tables between client and server. If headers are repeated, only a small integer index is transmitted over the wire.
      - **QPACK (HTTP/3):** Optimized for QUIC. Re-engineers header tables to avoid Head-of-Line blocking across independent UDP streams.

27. **Explain the `Cross-Origin-Opener-Policy` (COOP) and `Cross-Origin-Embedder-Policy` (COEP) headers.**
    * *Answer:* Introduced to mitigate CPU side-channel attacks like Spectre:
      - `COOP: same-origin`: Isolates the browser execution browsing context group, preventing other windows from interacting with your window via `window.opener`.
      - `COEP: require-corp`: Prevents the document from loading any cross-origin resource that does not explicitly grant permission via CORS or CORP.
      - *Significance:* Enabling both headers unlocks high-performance browser APIs like `SharedArrayBuffer` and `performance.measureUserAgentSpecificMemory()`.

28. **What is the `Sec-Fetch-*` family of metadata headers?**
    * *Answer:* A suite of browser-enforced security headers that cannot be modified by JavaScript:
      - `Sec-Fetch-Site`: Indicates relationship (`same-origin`, `same-site`, `cross-site`).
      - `Sec-Fetch-Mode`: Mode of request (`cors`, `navigate`, `no-cors`).
      - `Sec-Fetch-Dest`: Destination of the request (`document`, `image`, `script`).
      - Backend servers can inspect these headers to reject cross-site forged state mutations without needing anti-CSRF tokens.

29. **What is Server-Sent Events (SSE) and what headers are required to stream data over HTTP?**
    * *Answer:* SSE is a unidirectional streaming protocol allowing servers to push text events to clients over standard HTTP.
      - Required Headers:
        ```http
        Content-Type: text/event-stream
        Cache-Control: no-cache
        Connection: keep-alive
        ```
      - Data format: `data: {"msg": "hello"}\n\n`.

30. **Explain how HTTP/2 Server Push worked and why it was deprecated/removed by Chrome.**
    * *Answer:* HTTP/2 Server Push allowed the server to speculatively push resources (e.g., `style.css`) to the client's cache before the client parsed the HTML.
    * *Why deprecated:* It was complex, prone to race conditions, and frequently pushed assets the browser already had cached in disk memory, wasting bandwidth. It has been superseded by **103 Early Hints** (`Link: <...>; rel=preload`).

---

## 16. Coding Questions

### Coding Challenge 1: Type-Safe HTTP Status Code Classifier

```typescript
export type HttpStatusCategory = 
  | "INFORMATIONAL" 
  | "SUCCESS" 
  | "REDIRECTION" 
  | "CLIENT_ERROR" 
  | "SERVER_ERROR" 
  | "UNKNOWN";

export function categorizeStatusCode(statusCode: number): HttpStatusCategory {
  if (statusCode >= 100 && statusCode < 200) return "INFORMATIONAL";
  if (statusCode >= 200 && statusCode < 300) return "SUCCESS";
  if (statusCode >= 300 && statusCode < 400) return "REDIRECTION";
  if (statusCode >= 400 && statusCode < 500) return "CLIENT_ERROR";
  if (statusCode >= 500 && statusCode < 600) return "SERVER_ERROR";
  return "UNKNOWN";
}
```

### Coding Challenge 2: Cache-Control Header Builder Utility

```typescript
interface CacheControlOptions {
  scope?: "public" | "private";
  maxAgeSeconds?: number;
  sMaxAgeSeconds?: number;
  noCache?: boolean;
  noStore?: boolean;
  mustRevalidate?: boolean;
  immutable?: boolean;
  staleWhileRevalidateSeconds?: number;
}

export function buildCacheControlHeader(opts: CacheControlOptions): string {
  if (opts.noStore) return "no-store";

  const directives: string[] = [];

  if (opts.scope) directives.push(opts.scope);
  if (opts.noCache) directives.push("no-cache");
  if (opts.maxAgeSeconds !== undefined) directives.push(`max-age=${opts.maxAgeSeconds}`);
  if (opts.sMaxAgeSeconds !== undefined) directives.push(`s-maxage=${opts.sMaxAgeSeconds}`);
  if (opts.staleWhileRevalidateSeconds !== undefined) {
    directives.push(`stale-while-revalidate=${opts.staleWhileRevalidateSeconds}`);
  }
  if (opts.mustRevalidate) directives.push("must-revalidate");
  if (opts.immutable) directives.push("immutable");

  return directives.join(", ");
}
```

---

## 17. Common Interview Traps

* **The Trap:** The interviewer asks: *"Does an HTTP `302 Found` redirect preserve the original request method when redirecting a `POST` request?"*
  * **How candidates fail:** Saying "Yes, 302 redirects preserve the method."
  * **The Winning Answer:** **No!** Historically, web browsers universally rewrote `POST` requests to `GET` upon receiving a `302 Found` or `301 Moved Permanently`. If you want to guarantee that the client preserves the original `POST` method and body, you **must use `307 Temporary Redirect` or `308 Permanent Redirect`**.
* **The Trap:** *"If a client sends `Cache-Control: no-cache`, does it mean the browser refuses to cache the response?"*
  * **How candidates fail:** Saying "Yes, no-cache disables caching."
  * **The Winning Answer:** **No!** `no-cache` means the response **can be cached**, but it **must be revalidated with the origin server** using conditional validation headers (`ETag` / `If-None-Match`) before being served. To completely prohibit caching, you must specify **`Cache-Control: no-store`**.

---

## 18. Revision Summary

```
+-----------------------------------------------------------------------------------+
|               HTTP Status Codes & Headers High-Yield Revision Matrix              |
+-----------------------------------------------------------------------------------+
| Status 204:          No Content; zero body allowed; perfect for DELETE operations |
| Status 301 vs 308:   301 rewrites POST->GET; 308 strictly preserves method & body |
| Status 401 vs 403:   401 = Unauthenticated (no token); 403 = Unauthorized (no role)|
| Status 502 vs 504:   502 = Upstream crashed/reset; 504 = Upstream query timed out |
| Cache-Control:       no-cache (revalidate first) vs no-store (never write to disk)|
| Security Standards:  HSTS (force HTTPS), CSP (mitigate XSS), X-Frame-Options (deny)|
| Protocols:           HTTP/2 (multiplexing/TCP); HTTP/3 (QUIC/UDP, no HoL blocking) |
+-----------------------------------------------------------------------------------+
```

---

## 19. Quick Reference

* **`200 OK`:** Successful read / mutation.
* **`201 Created`:** Resource created; returns `Location` header.
* **`204 No Content`:** Action successful, zero body.
* **`304 Not Modified`:** ETag match; client uses local cache.
* **`400 Bad Request`:** Malformed syntax / validation error.
* **`401 Unauthorized`:** Identity unverified (authentication missing).
* **`403 Forbidden`:** Identity verified, but lacks permission (authorization missing).
* **`409 Conflict`:** State conflict (duplicate key, optimistic lock fail).
* **`429 Too Many Requests`:** Rate limit exceeded (`Retry-After`).
* **`502 Bad Gateway`:** App server crashed / unreachable by reverse proxy.
* **`504 Gateway Timeout`:** App server timed out responding to reverse proxy.
