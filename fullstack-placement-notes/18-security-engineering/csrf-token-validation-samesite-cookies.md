# Cross-Site Request Forgery (CSRF): Synchronizer Tokens and SameSite Cookies

## 1. What is it?
**Cross-Site Request Forgery (CSRF / XSRF)** is a client-side confused-deputy attack that tricks an authenticated user's web browser into executing unwanted, state-changing actions on a trusted web application without the user's knowledge or consent.

Because web browsers historically attached stored session cookies automatically to **all** outgoing HTTP requests sent to a domain—regardless of whether the request originated from the legitimate web application or an external, third-party malicious website—a malicious site can forge an HTTP request (like transferring money or changing an email address) that the receiving server accepts as legitimate.

Modern web engineering defends against CSRF using two primary architectural mechanisms:
1. **The Anti-CSRF Synchronizer Token Pattern**: Requiring a secret, cryptographically random, per-session or per-request token embedded in state-changing requests that a third-party domain cannot read.
2. **`SameSite` Cookie Attribute**: Instructing the browser to restrict cookie transmission when requests originate from third-party sites (`SameSite=Lax` or `SameSite=Strict`).

```
The Classic CSRF Attack Flow:
1. Victim logs into bank.com ---> bank.com issues session cookie to browser.
2. In another tab, victim visits evil.com.
3. evil.com contains hidden auto-submitting form:
   <form action="https://bank.com/api/transfer" method="POST">
     <input type="hidden" name="toAccount" value="ATTACKER_ACCOUNT" />
     <input type="hidden" name="amount" value="5000" />
   </form>
   <script>document.forms[0].submit();</script>
4. Browser sends POST request to bank.com AND AUTOMATICALLY ATTACHES bank.com's session cookie!
5. bank.com sees valid session cookie and executes the $5,000 transfer!
```

---

## 2. Why does it exist?
1. **Ambient Authentication**: The fundamental premise of HTTP cookies is "ambient authority": the browser automatically sends credentials stored for `bank.com` on every HTTP request targeting `bank.com`. The server cannot distinguish whether the request was intentionally initiated by the user clicking a button inside `bank.com` or forged by hidden JavaScript inside `evil.com`.
2. **Cross-Origin Form Submissions**: The HTML standard explicitly permits cross-origin POST requests via `<form>` tags and `<img>` tags (`<img src="https://bank.com/api/delete-account">`) without triggering browser Cross-Origin Resource Sharing (CORS) preflight checks.
3. **Session Re-Use**: Without an unpredictable, proof-of-intent token (CSRF token), the session cookie alone is insufficient to verify user intent.

---

## 3. Mental Model
Think of CSRF as **A Forged Check Signed by Your Hand While Asleep**:
- You are a customer at a local coffee shop where the cashier knows your face and honors your tab (**The Session Cookie**).
- A prankster writes a note on a napkin: *"Give the bearer 100 free coffees and charge my tab."*
- If the prankster puts that note into your jacket pocket while you are walking in the street, and a courier hands that note to the cashier on your behalf (**Ambient cookie transmission**), the cashier looks at the signature, verifies your tab, and hands over the coffee!
- **Anti-CSRF Token**: The cashier establishes a rule: *"Every morning, I whisper a secret, random 10-word password into your ear (**The CSRF Token**). I will never honor any order unless that exact secret password is handwritten on the note."*
- Because the prankster standing outside cannot read your mind (**Same-Origin Policy**), they cannot guess the daily secret password, and their forged napkin is rejected.

---

## 4. Basic Example
Configuring Anti-CSRF protection in Express using the Synchronizer Token Pattern:

```typescript
import express from 'express';
import cookieParser from 'cookie-parser';
import csrf from 'csurf'; // Classical CSRF middleware

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser('cookie-signing-secret'));

// Configure CSRF protection using signed cookies
const csrfProtection = csrf({ cookie: { httpOnly: true, secure: true, sameSite: 'lax' } });

// Route to render form: Injects the generated CSRF token into the HTML form
app.get('/transfer-funds', csrfProtection, (req, res) => {
  res.send(`
    <form action="/api/transfer" method="POST">
      <!-- Hidden CSRF Token Field -->
      <input type="hidden" name="_csrf" value="${req.csrfToken()}">
      <input type="text" name="amount" placeholder="Amount">
      <button type="submit">Transfer</button>
    </form>
  `);
});

// State-changing POST endpoint: Middleware validates the token!
app.post('/api/transfer', csrfProtection, (req, res) => {
  // If the _csrf field is missing or invalid, csurf throws an HTTP 403 Forbidden error!
  res.send('Funds transferred successfully!');
});
```

---

## 5. Real Example: Modern SPA Single-Page App Architecture (Double Submit Cookie Pattern)
A production TypeScript Express service implementing the **Double Submit Cookie Pattern** for single-page applications (React/Next.js) with custom request headers:

```typescript
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export class CsrfProtectionMiddleware {
  private static readonly CSRF_COOKIE_NAME = 'XSRF-TOKEN';
  private static readonly CSRF_HEADER_NAME = 'x-xsrf-token';

  /**
   * ISSUE CSRF TOKEN: Sets a readable cookie for the frontend SPA to read.
   */
  public static issueToken(req: Request, res: Response): void {
    const token = crypto.randomBytes(32).toString('hex');

    // Cookie must NOT be httpOnly because the frontend JavaScript needs to read it
    // and attach it as a custom request header!
    res.cookie(this.CSRF_COOKIE_NAME, token, {
      httpOnly: false, // SPA reads this via document.cookie
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/'
    });
  }

  /**
   * VALIDATE CSRF TOKEN: Compares the cookie value against the custom header.
   */
  public static validateToken(req: Request, res: Response, next: NextFunction): void {
    // Safe HTTP methods do NOT require CSRF checks (GET, HEAD, OPTIONS)
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }

    const cookieToken = req.cookies[CsrfProtectionMiddleware.CSRF_COOKIE_NAME];
    const headerToken = req.headers[CsrfProtectionMiddleware.CSRF_HEADER_NAME];

    // Verify both tokens exist
    if (!cookieToken || !headerToken) {
      res.status(403).json({ error: 'CSRF token missing' });
      return;
    }

    // Constant-time comparison to prevent timing attacks
    const cookieBuf = Buffer.from(String(cookieToken));
    const headerBuf = Buffer.from(String(headerToken));

    if (cookieBuf.length !== headerBuf.length || !crypto.timingSafeEqual(cookieBuf, headerBuf)) {
      res.status(403).json({ error: 'Invalid CSRF token' });
      return;
    }

    // Token is valid!
    next();
  }
}
```

---

## 6. Under the Hood

### 1. The Three `SameSite` Cookie Modes
The `SameSite` attribute controls whether cookies are sent with cross-site requests:

```
SameSite Comparison Matrix:

Attribute Mode | Same-Site Requests | Cross-Site Top-Level Links | Cross-Site POST / Images
---------------+--------------------+----------------------------+-------------------------
Strict         |      ATTACHED      |          BLOCKED           |         BLOCKED         
Lax (Default)  |      ATTACHED      |          ATTACHED          |         BLOCKED         
None           |      ATTACHED      |          ATTACHED          |         ATTACHED        
               (Requires Secure)                                 (Vulnerable to CSRF!)
```

- **`SameSite=Strict`**: Cookies are **never** sent in cross-site contexts. If a user clicks a link to `bank.com` from an external email or Google search, they arrive logged out until they click a link inside `bank.com`.
- **`SameSite=Lax` (Modern Browser Default)**: Cookies are blocked on cross-site sub-requests (images, iframes, cross-site POST forms), but are **permitted on top-level safe GET navigations** (clicking a link from a search engine). This completely blocks traditional form-based CSRF attacks!
- **`SameSite=None`**: Cookies are sent on all cross-site requests. Requires the `Secure` flag (HTTPS only); used for third-party embeds (Stripe checkout modals, widgets).

### 2. Why Does `SameSite=Lax` Still Need CSRF Tokens? (Defense in Depth)
While `SameSite=Lax` blocks most cross-site POST requests, it is **not a complete defense by itself**:
1. **The 2-Minute Lax-Allowing-Unsafe Exception**: In older Chromium implementations, top-level cross-site POST requests made within 2 minutes of cookie creation inadvertently included the cookie.
2. **Accidental State-Changing GET Endpoints**: If an application has a buggy endpoint like `GET /api/delete-account?id=123`, `SameSite=Lax` will attach the cookie when an attacker tricks the user into clicking a simple link (`<a href="https://bank.com/api/delete-account">`).
3. **Legacy and Non-Standard Browsers**: Embedded webviews and older mobile browsers do not fully honor `SameSite` flags.

---

## 7. Important Rules
1. **GET, HEAD, and OPTIONS Must Be Strictly Idempotent**: A `GET` request should **never** change application state (never debit money, delete an item, or update a password). State-changing GET requests break all CSRF defenses.
2. **Custom Headers Trigger Browser CORS Preflight**: An attacker on `evil.com` cannot set custom HTTP headers (like `X-CSRF-Token` or `Authorization: Bearer`) on a cross-origin request without triggering a browser **CORS Preflight check (`OPTIONS`)**. If CORS is configured correctly, the browser refuses to send the request.
3. **Store Auth Tokens in `Authorization` Header to Avoid CSRF**: If an API does not use cookies, but instead uses JWTs sent in the `Authorization: Bearer <token>` header, the API is **naturally immune to CSRF** because browsers never attach `Authorization` headers to cross-site requests automatically. (However, the token is vulnerable to XSS if stored in `localStorage`).

---

## 8. Common Mistakes

### 1. State-Changing GET Requests
```typescript
// FATAL FLAW: Using GET for destructive action!
// Attacker simply embeds: <img src="https://app.com/api/users/delete?id=50" />
// SameSite=Lax will ATTACH the cookie on top-level navigation, executing deletion!
app.get('/api/users/delete', async (req, res) => {
  await db.query('DELETE FROM users WHERE id = $1', [req.query.id]);
});

// CORRECT: Destructive actions MUST be POST, PUT, or DELETE paired with CSRF validation!
app.post('/api/users/delete', CsrfProtectionMiddleware.validateToken, async (req, res) => {
  await db.query('DELETE FROM users WHERE id = $1', [req.body.id]);
});
```

### 2. Permissive CORS Wildcards with Credentials
Configuring `Access-Control-Allow-Origin: *` while setting `Access-Control-Allow-Credentials: true`. (Modern browsers reject this combination, but misconfiguring origin reflection recreates the vulnerability).

---

## 9. Best Practices

### 1. Production Cookie Configuration
Always set all three essential flags on session cookies:
```typescript
res.cookie('session_id', sessionToken, {
  httpOnly: true,  // Defends against XSS token theft
  secure: true,    // Defends against network MITM sniffing (HTTPS only)
  sameSite: 'lax', // Defends against CSRF attacks
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
});
```

### 2. Axios / Fetch Interceptor for CSRF Tokens
In React / Next.js frontends, configure an API client interceptor to read the `XSRF-TOKEN` cookie and attach it automatically to all outgoing mutations:
```typescript
import axios from 'axios';

// Axios automatically looks for XSRF-TOKEN cookie and sends it as X-XSRF-TOKEN header!
export const apiClient = axios.create({
  baseURL: '/api',
  withCredentials: true,
  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'x-xsrf-token'
});
```

---

## 10. Performance Considerations
- **Cryptographic Generation Overhead**: Generating random CSRF tokens using `crypto.randomBytes(32)` takes ~0.005ms in Node.js.
- **Timing Safe Comparison**: Always use `crypto.timingSafeEqual()` rather than standard `===` when comparing tokens to eliminate **timing attacks** that allow attackers to deduce tokens byte-by-byte.

---

## 11. Security Considerations
- **XSS Subverts All CSRF Defenses**: If your application has a Cross-Site Scripting (XSS) vulnerability, the attacker's script runs directly inside the victim's origin. The script can simply read the CSRF token from the DOM or cookie and send an authenticated request with the valid token. **XSS completely neutralizes CSRF protection**.

---

## 12. Alternatives
1. **Bearer Token Authentication**: Storing JWTs in in-memory state and passing them via `Authorization: Bearer <token>`. Completely immune to CSRF, but vulnerable to session loss on page refresh unless paired with refresh token rotation.
2. **Origin & Referer Header Verification**: Inspecting `req.headers.origin` and `req.headers.referer` on the server and rejecting requests whose origin does not match the server's domain.

---

## 13. Trade-offs

| Defense Strategy | CSRF Protection | Usability / User Experience | Complexity |
| :--- | :--- | :--- | :--- |
| **`SameSite=Strict`** | Absolute | Poor (Logged out when clicking external links) | Low |
| **`SameSite=Lax`** | Strong | Excellent (Seamless external links) | Low |
| **Synchronizer Token** | Absolute | Requires token injection into forms/headers | Moderate |
| **Bearer Token Header** | Immune to CSRF | Memory-only tokens require refresh flows | Moderate |

---

## 14. Real-World Usage
- **Banking Portals**: Enforce both `SameSite=Strict` cookies and per-transaction re-authentication (OTP / biometric challenge) for fund transfers.
- **GitHub / GitLab**: Every form submission embeds an encrypted, user-specific authenticity token (`authenticity_token`) validated on every mutation.

---

## 15. Placement Interview Questions

### Basic
**Q: What is Cross-Site Request Forgery (CSRF), and what fundamental browser behavior makes it possible?**  
*Answer*: CSRF is an attack where a malicious website tricks an authenticated user's browser into executing unintended, state-changing requests against a vulnerable web application where the user is currently logged in. It is made possible by **ambient cookie transmission**: web browsers historically attach stored session cookies automatically to all outgoing HTTP requests targeting a domain, regardless of which origin initiated the request.

### Conceptual
**Q: Differentiate between `SameSite=Strict`, `SameSite=Lax`, and `SameSite=None`.**  
*Answer*: 
- **`Strict`**: The cookie is **never** sent in cross-site requests, even when following standard links from external websites.
- **`Lax`**: The cookie is blocked on cross-site sub-requests (such as forms, images, and iframes), but is **included when the user navigates via top-level GET links** (e.g., clicking a search result link).
- **`None`**: The cookie is sent on all cross-site requests (requires the `Secure` HTTPS flag).

### Implementation
**Q: Explain the "Double Submit Cookie Pattern" for preventing CSRF in Single-Page Applications (SPAs).**  
*Answer*: In the Double Submit Cookie pattern:
1. The server sets a cryptographically random token inside a cookie (e.g., `XSRF-TOKEN`) with `httpOnly: false`, allowing client-side JavaScript to read it.
2. When the SPA issues a state-changing mutation (`POST`, `PUT`, `DELETE`), client-side JavaScript reads the cookie value and inserts it into a custom HTTP request header (e.g., `X-XSRF-TOKEN`).
3. The server intercepts the request and verifies that the value in the custom header matches the value in the cookie.
4. **Why it works**: A malicious third-party site cannot read the cookie from the target domain due to the **Same-Origin Policy**, meaning it cannot know what value to place into the custom header.

### Debugging
**Q: A developer migrates an API from Cookie-based authentication to `Authorization: Bearer <jwt>` headers stored in memory. The security audit team asks if CSRF protection middleware is still needed. How do you respond?**  
*Answer*: CSRF protection middleware is **no longer needed**. CSRF attacks rely on the browser automatically attaching credentials (cookies) to cross-site requests. Browsers **never** automatically attach custom `Authorization: Bearer` headers to cross-site requests. For an attacker on `evil.com` to send an `Authorization` header, they would have to execute cross-origin JavaScript, which is blocked by the browser's **Same-Origin Policy** and CORS preflight checks.

### Scenario
**Q: Why does a Cross-Site Scripting (XSS) vulnerability completely defeat CSRF protections?**  
*Answer*: CSRF defenses (like Synchronizer Tokens or Double Submit Cookies) rely on the guarantee that a third-party domain cannot read the token due to the Same-Origin Policy. However, an XSS vulnerability allows the attacker's script to execute **directly inside the victim's trusted origin**. The script can read the DOM, extract the valid CSRF token, and submit the state-changing request with the legitimate token attached, bypassing all anti-CSRF defenses.

### Advanced
**Q: Why should you use `crypto.timingSafeEqual()` instead of the standard `===` equality operator when verifying CSRF tokens on the server?**  
*Answer*: The standard string equality operator (`===`) compares strings byte-by-byte from left to right and **returns immediately upon encountering the first non-matching character** (early exit). An attacker can measure microscopic differences in server response latency (a **Timing Attack**). By measuring which guesses take slightly longer to fail, the attacker can deduce the secret CSRF token character-by-character. `crypto.timingSafeEqual()` compares all bytes in constant time regardless of where differences occur, eliminating timing side-channels.

---

## 16. Coding Questions

### Problem 1: Origin and Referer Header Verification Guard
Write a production-grade Express middleware that validates `Origin` and `Referer` headers on all state-changing requests as an additional layer of CSRF defense.

```typescript
import { Request, Response, NextFunction } from 'express';

export function createOriginVerifier(trustedOrigins: string[]) {
  const trustedSet = new Set(trustedOrigins.map(o => o.toLowerCase()));

  return (req: Request, res: Response, next: NextFunction) => {
    // Skip safe read-only methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }

    // Extract Origin header (preferred) or Referer header fallback
    const originHeader = req.headers.origin;
    const refererHeader = req.headers.referer;

    let sourceOrigin: string | null = null;

    if (originHeader) {
      sourceOrigin = String(originHeader).toLowerCase();
    } else if (refererHeader) {
      try {
        const parsed = new URL(String(refererHeader));
        sourceOrigin = parsed.origin.toLowerCase();
      } catch {
        return res.status(403).json({ error: 'Malformed Referer header' });
      }
    }

    // If neither header is present, block request (defense-in-depth)
    if (!sourceOrigin) {
      return res.status(403).json({ error: 'Missing Origin and Referer headers' });
    }

    // Verify source origin exists in our trusted set
    if (!trustedSet.has(sourceOrigin)) {
      return res.status(403).json({ 
        error: `Cross-origin mutation rejected from origin: ${sourceOrigin}` 
      });
    }

    next();
  };
}
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking CORS stops CSRF. CORS blocks a website from **reading** the response of a cross-origin request; it does **not** stop the browser from **executing** the request on the server! The destructive state change executes before CORS ever checks the response.
- **Trap 2**: Believing `SameSite=Lax` makes CSRF impossible. If an application performs mutations via `GET` requests, `SameSite=Lax` will attach the cookie when the victim clicks a cross-site link.
- **Trap 3**: Believing JSON requests are automatically immune to CSRF. While `<form>` tags historically couldn't send `application/json`, modern HTML form encoding tricks and browser exploits make relying purely on `Content-Type: application/json` risky without explicit CSRF tokens or CORS verification.

---

## 18. Revision Summary
- CSRF tricks an authenticated browser into sending unauthorized requests using automatically attached session cookies.
- Defend using **`SameSite=Lax`** or **`SameSite=Strict`** cookie flags.
- Implement the **Anti-CSRF Synchronizer Token** or **Double Submit Cookie** pattern for state-changing operations.
- Ensure all `GET` endpoints are strictly read-only and idempotent.
- APIs using `Authorization: Bearer <token>` headers are naturally immune to CSRF.
- Always use `crypto.timingSafeEqual()` for token validation to prevent timing side-channel attacks.

---

## 19. Quick Reference

| Defense Layer | Mechanism | Protection Scope |
| :--- | :--- | :--- |
| **`SameSite=Lax`** | Browser blocks cookies on cross-site POST | High (Protects 95% of standard forms) |
| **`SameSite=Strict`** | Browser blocks cookies on all cross-site requests | Complete (Can degrade external link UX) |
| **Anti-CSRF Token** | Unpredictable token embedded in forms/headers | Complete (Standard for server-rendered HTML) |
| **Double Submit Cookie**| Compares readable cookie with custom header | Complete (Standard for SPAs / React) |
| **Bearer Tokens** | Auth stored in `Authorization` header | Complete (Browsers never auto-send headers)|
