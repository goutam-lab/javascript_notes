# HTTP Security Headers: CSP, HSTS, X-Frame-Options, and Defense-in-Depth

## 1. What is it?
**HTTP Security Headers** are standardized metadata directives transmitted by a web server in the header section of an HTTP response. 

These headers instruct the client's web browser to enforce strict security boundaries, activate built-in browser defense mechanisms, restrict resource loading, and disable dangerous legacy features. 

The primary security headers include:
- **`Content-Security-Policy` (CSP)**: Controls and restricts the exact domains and protocols from which scripts, styles, images, and fonts can be loaded or executed.
- **`Strict-Transport-Security` (HSTS)**: Enforces encrypted HTTPS connections, preventing SSL-stripping and man-in-the-middle attacks.
- **`X-Frame-Options`**: Prevents **Clickjacking** by disallowing the site from being rendered inside an `<iframe>`.
- **`X-Content-Type-Options`**: Prevents MIME-type sniffing attacks (`nosniff`).
- **`Referrer-Policy`**: Controls how much referrer information is leaked in external requests.
- **`Permissions-Policy`**: Disables access to sensitive browser hardware APIs (camera, microphone, geolocation).

```
HTTP Response Header Pipeline:
Server ---> HTTP/1.1 200 OK
            Content-Type: text/html
            Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
            X-Frame-Options: DENY
            X-Content-Type-Options: nosniff
            Content-Security-Policy: default-src 'self'; script-src 'self' https://apis.google.com
                                   |
                                   v
Browser receives directives ---> Locks down execution sandbox before rendering HTML!
```

---

## 2. Why does it exist?
1. **Hardening Against Application Code Bugs**: Even if an application contains an unintentional Cross-Site Scripting (XSS) vulnerability, a strict **Content Security Policy (CSP)** instructs the browser to block inline script execution and disallow exfiltration to external attacker domains.
2. **Eliminating Man-in-the-Middle (MITM) Downgrade Attacks**: When a user types `bank.com` into an address bar, the browser initially attempts an unencrypted `http://` connection. An attacker on the local Wi-Fi can intercept this initial request and strip SSL. **HSTS** instructs the browser to permanently rewrite all HTTP requests to HTTPS locally before touching the network.
3. **Preventing Clickjacking Exploits**: Without `X-Frame-Options` or `frame-ancestors`, an attacker can embed your application inside an invisible, transparent `<iframe>` on a malicious website, tricking the user into clicking buttons (e.g., "Confirm Transfer" disguised as "Play Game").

---

## 3. Mental Model
Think of HTTP Security Headers as **Safety Instructions for an Armored Bank Courier**:
- When the server hands the web page to the browser, it staples a list of **non-negotiable safety rules** to the top:
  - **HSTS**: *"Never drive down unpaved back alleys (HTTP). Only travel on the secure interstate highway (HTTPS). If someone tries to detour you, abort immediately."*
  - **X-Frame-Options (`DENY`)**: *"Never allow anyone to place a one-way mirror over our bank windows (Iframes)."*
  - **X-Content-Type-Options (`nosniff`)**: *"If a crate is labeled 'Cereal', do not open it and taste it to see if it's gunpowder. If it's labeled text, treat it as text."*
  - **CSP**: *"Only accept packages delivered by our vetted couriers (whitelisted domains). If an unverified stranger tries to hand you a letter with instructions (inline script), burn it immediately."*

---

## 4. Basic Example
Configuring baseline security headers in Node.js / Express using **Helmet.js**:

```typescript
import express from 'express';
import helmet from 'helmet';

const app = express();

// Use Helmet to automatically configure 15 secure HTTP headers
app.use(
  helmet({
    // 1. Content Security Policy
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://trusted-cdn.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https://images.unsplash.com"],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: []
      }
    },
    // 2. Strict Transport Security (HSTS) - 2 years + subdomains + preload
    hsts: {
      maxAge: 63072000,
      includeSubDomains: true,
      preload: true
    },
    // 3. Prevent Clickjacking
    frameguard: {
      action: 'deny'
    },
    // 4. Prevent MIME Sniffing
    noSniff: true,
    // 5. Referrer Policy
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin'
    }
  })
);

app.get('/', (req, res) => {
  res.send('Secure headers active!');
});
```

---

## 5. Real Example: Cryptographic Nonces in Dynamic Content Security Policy (Next.js / Express)
A production TypeScript middleware generating a per-request cryptographic **CSP Nonce** to permit legitimate inline scripts while blocking all unauthorized XSS payloads:

```typescript
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function cspNonceMiddleware(req: Request, res: Response, next: NextFunction) {
  // 1. Generate a cryptographically secure random 128-bit base64 nonce per request
  const nonce = crypto.randomBytes(16).toString('base64');
  
  // Attach nonce to res.locals for template engines or React SSR
  res.locals.cspNonce = nonce;

  // 2. Define strict Content-Security-Policy referencing the generated nonce
  const cspHeader = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`, // Only scripts with this matching nonce can run!
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'" // Modern replacement for X-Frame-Options: DENY
  ].join('; ');

  res.setHeader('Content-Security-Policy', cspHeader);
  next();
}

// In your Server-Rendered HTML Template / React root:
// <script nonce={res.locals.cspNonce}>
//   window.__INITIAL_DATA__ = { user: "Alice" };
// </script>
// If an attacker injects: <script>steal()</script> -> Browser blocks it because the nonce is missing!
```

---

## 6. Under the Hood

### 1. The Anatomy of Modern Security Headers

#### Content-Security-Policy (CSP)
- **`default-src 'self'`**: Sets the default fallback policy for all resource types.
- **`script-src`**: Restricts executable JavaScript sources.
- **`objectSrc 'none'`**: Disallows Flash, Java applets, and legacy browser plugins.
- **`base-uri 'self'`**: Prevents attackers from injecting `<base href="https://evil.com">` to hijack relative links.
- **`frame-ancestors 'none'`**: Replaces `X-Frame-Options`; controls which parent sites can embed this page in an iframe.
- **`upgrade-insecure-requests`**: Instructs the browser to treat all `http://` URLs as `https://` before fetching.

#### Strict-Transport-Security (HSTS)
- **Syntax**: `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- **`max-age`**: Number of seconds the browser must remember to enforce HTTPS (63072000 = 2 years).
- **`includeSubDomains`**: Applies HTTPS enforcement to all subdomains (`api.site.com`, `admin.site.com`).
- **`preload`**: Submits your domain to the **Chrome HSTS Preload List** (hardcoded directly into Chrome, Firefox, Safari, and Edge binaries). The browser connects over HTTPS even on the very first visit in history!

#### X-Content-Type-Options: `nosniff`
- Historically, if an endpoint returned an image with an incorrect MIME type (or an attacker uploaded a JavaScript file disguised as an image), Internet Explorer would "sniff" the file contents, detect JavaScript code, and execute it!
- Setting `nosniff` forces the browser to strictly honor the `Content-Type` header: if it says `image/png`, it will never execute it as script.

---

## 7. Important Rules
1. **Never Deploy a Strict CSP Blindly**: Deploying a strict CSP without testing can break third-party analytics (Google Analytics, Sentry, Stripe). Use the **`Content-Security-Policy-Report-Only`** header first to collect violation telemetry without breaking the website:
   ```
   Content-Security-Policy-Report-Only: default-src 'self'; report-uri /api/csp-violations
   ```
2. **Do Not Use `'unsafe-inline'` for `script-src` in Production**: Using `'unsafe-inline'` allows any inline `<script>` tag to execute, completely neutralizing CSP's ability to protect against XSS. Use **Nonces** or **SHA-256 Hashes**.
3. **HSTS Preload is Irreversible**: Once your domain is accepted into the browser HSTS Preload list, you **cannot** serve HTTP on any subdomain. Ensure all subdomains possess valid SSL certificates before submitting.

---

## 8. Common Mistakes

### 1. Setting `X-Frame-Options: ALLOW-FROM` in Modern Browsers
`ALLOW-FROM` is deprecated and ignored by modern browsers. If you need to allow a specific partner domain to iframe your application, use CSP's **`frame-ancestors`** directive:
```
Content-Security-Policy: frame-ancestors 'self' https://trusted-partner.com
```

### 2. Confusing CORS with CSP
- **CORS (`Access-Control-Allow-Origin`)**: Restricts **other domains** from reading responses from **your server**.
- **CSP (`Content-Security-Policy`)**: Restricts **your page** from loading or executing resources from **other domains**.

---

## 9. Best Practices

### 1. Automated Violation Reporting
Capture CSP violations in your observability stack (Sentry / Datadog) using the `report-to` directive:
```json
// Browser sends JSON payload to reporting endpoint when CSP blocks a violation:
{
  "csp-report": {
    "document-uri": "https://site.com/dashboard",
    "blocked-uri": "https://malicious-cdn.com/evil.js",
    "violated-directive": "script-src 'self'"
  }
}
```

### 2. Permissions-Policy Hardening
Disable unused device sensors to protect user privacy:
```typescript
res.setHeader(
  'Permissions-Policy',
  'camera=(), microphone=(), geolocation=(), payment=()'
);
```

---

## 10. Performance Considerations
- **Zero Runtime Overhead**: HTTP security headers are pure metadata evaluated directly by the browser's C++ rendering engine. They add zero server CPU overhead and zero database queries.
- **HSTS Performance Gain**: HSTS eliminates the 301/302 network redirect from `http://` to `https://`, saving one full network round-trip (~50ms–200ms) on initial page navigation.

---

## 11. Security Considerations
- **Reverse Tabnabbing**: When linking to external websites (`<a href="..." target="_blank">`), the target page can access `window.opener` to redirect the user to a phishing page. Modern browsers default to `rel="noopener"`, but always enforce it explicitly:
  ```html
  <a href="https://external.com" target="_blank" rel="noopener noreferrer">Link</a>
  ```

---

## 12. Alternatives
1. **Edge CDN Header Injection (Cloudflare / CloudFront)**: Injecting security headers at the CDN edge level using Cloudflare Transform Rules or Lambda@Edge, ensuring all static and dynamic assets are protected before reaching origin servers.
2. **Reverse Proxy Headers (Nginx)**: Adding headers directly in the Nginx `server` block (`add_header X-Frame-Options "DENY";`).

---

## 13. Trade-offs

| Header | Primary Security Benefit | Potential Trade-off |
| :--- | :--- | :--- |
| **`Content-Security-Policy`** | Eliminates XSS & data exfiltration | High maintenance; can break third-party scripts |
| **`Strict-Transport-Security`**| Eliminates SSL stripping | Irreversible on preloaded domains |
| **`X-Frame-Options: DENY`** | Eliminates Clickjacking | Cannot embed widgets in iframes |
| **`Referrer-Policy: no-referrer`**| Maximum privacy | Breaks affiliate link tracking |

---

## 14. Real-World Usage
- **Google & GitHub**: Enforce strict CSP nonces across all web properties. Attempting to inject `<script>` in the browser console results in an immediate CSP violation block.
- **Security Scorecards (Qualys SSL Labs / Mozilla Observatory)**: Enterprise security compliance tools scan HTTP security headers to assign grade ratings (A+ through F) for regulatory audits.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the purpose of the `Strict-Transport-Security` (HSTS) header?**  
*Answer*: HSTS instructs the web browser that the domain must **only be accessed using HTTPS**. If a user enters `http://` or clicks an unencrypted link, the browser automatically converts the request to `https://` locally before sending it over the network, completely preventing SSL-stripping and man-in-the-middle attacks.

### Conceptual
**Q: How does `X-Frame-Options` protect a web application from Clickjacking attacks?**  
*Answer*: In a Clickjacking attack, an attacker embeds a vulnerable website inside a transparent or hidden `<iframe>` on an external page, layering deceptive UI elements (e.g., "Click here to win a car") directly over legitimate action buttons (e.g., "Delete Account"). Setting `X-Frame-Options: DENY` (or `SAMEORIGIN`) instructs the browser that the page must **never be rendered inside a frame**, causing the browser to refuse to display the iframe and neutralizing the attack.

### Implementation
**Q: What is the difference between `X-Frame-Options` and the CSP `frame-ancestors` directive?**  
*Answer*: `X-Frame-Options` is a legacy header that only supports `DENY` or `SAMEORIGIN`; it cannot whitelist multiple specific external domains. The CSP **`frame-ancestors`** directive is the modern, flexible replacement that allows fine-grained control over which specific origins are permitted to frame the page (e.g., `Content-Security-Policy: frame-ancestors 'self' https://partner.com`). Modern browsers prioritize `frame-ancestors` over `X-Frame-Options`.

### Debugging
**Q: An e-commerce website deploys a strict CSP `script-src 'self'`. Suddenly, their Google Tag Manager and Stripe Checkout widgets stop functioning. What happened, and how do you resolve it?**  
*Answer*: The CSP strictly restricted script execution to `'self'` (the site's own origin). When Google Tag Manager and Stripe attempted to load external scripts from `https://www.googletagmanager.com` and `https://js.stripe.com`, the browser blocked the network requests as unauthorized CSP violations.  
**Resolution**: Update the `script-src` and `frame-src` directives to explicitly whitelist the required third-party provider domains:
```
Content-Security-Policy: script-src 'self' https://js.stripe.com https://www.googletagmanager.com; frame-src https://js.stripe.com;
```

### Scenario
**Q: How does `Content-Security-Policy-Report-Only` allow engineering teams to test strict CSP policies without risking production downtime?**  
*Answer*: `Content-Security-Policy-Report-Only` runs the CSP engine in **monitoring mode**. The browser analyzes the page against the specified directives and logs violations (or sends JSON reports to a specified `report-uri`), but **does not actually block any scripts or resources from loading**. This allows engineering teams to deploy the policy to production, observe what legitimate third-party tools or inline scripts are flagged as violations over 2 weeks, whitelist them, and then safely switch to the blocking `Content-Security-Policy` header.

### Advanced
**Q: Explain how the `X-Content-Type-Options: nosniff` header prevents "MIME-Type Confusion" attacks.**  
*Answer*: Browsers historically implemented "MIME Sniffing": if an HTTP response lacked a Content-Type or had a generic type like `text/plain`, the browser inspected the first few bytes of the file to guess its type. In a MIME-type confusion attack, an attacker uploads an avatar image containing disguised JavaScript code (`<script>alert(1)</script>`). If the server serves the image with `text/plain` or missing types, an older browser might sniff the `<script>` tag and execute the file as JavaScript! Setting `nosniff` forces the browser to strictly honor the declared `Content-Type`; if the header declares `image/png`, the browser refuses to execute it as script.

---

## 16. Coding Questions

### Problem 1: Nginx Configuration for Comprehensive Security Headers
Write an Nginx server configuration block that implements all essential modern security headers with A+ Qualys rating standards.

```nginx
server {
    listen 443 ssl http2;
    server_name example.com;

    # SSL Certificate Configuration
    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    # 1. HSTS (Enforce HTTPS for 2 years, include subdomains, enable preload)
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;

    # 2. Prevent Clickjacking (Modern CSP + Legacy fallback)
    add_header X-Frame-Options "DENY" always;

    # 3. Prevent MIME-Type Sniffing
    add_header X-Content-Type-Options "nosniff" always;

    # 4. Referrer Policy (Send origin only to cross-origin HTTPS requests)
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # 5. Permissions Policy (Disable unused device sensors)
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;

    # 6. Baseline Content Security Policy
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; object-src 'none'; frame-ancestors 'none';" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking CORS and CSP do the same thing. CORS protects **your API** from unauthorized client-side domains; CSP protects **your users' browsers** from executing malicious injected resources.
- **Trap 2**: Believing `X-XSS-Protection` is still recommended. Modern security standards deprecate `X-XSS-Protection: 1; mode=block` because in older browsers, the filter could be weaponized to introduce side-channel vulnerabilities. CSP is the modern standard.
- **Trap 3**: Believing HSTS works over plain HTTP. Browsers ignore the `Strict-Transport-Security` header if received over unencrypted HTTP; it must be delivered over HTTPS.

---

## 18. Revision Summary
- HTTP Security Headers instruct the browser to enforce security boundaries before rendering HTML.
- **CSP**: Restricts script, style, and media sources; uses nonces to eliminate inline XSS.
- **HSTS**: Permanently forces HTTPS, preventing SSL stripping.
- **`X-Frame-Options` / `frame-ancestors`**: Eliminates Clickjacking attacks.
- **`X-Content-Type-Options: nosniff`**: Enforces declared MIME types and prevents script confusion.
- Use **Helmet.js** in Express to automatically configure production headers.

---

## 19. Quick Reference

| Header | Primary Directive | Protection Target |
| :--- | :--- | :--- |
| **`Content-Security-Policy`** | `default-src 'self'; object-src 'none'` | XSS, Data Exfiltration |
| **`Strict-Transport-Security`**| `max-age=63072000; includeSubDomains` | SSL-Stripping, MITM |
| **`X-Frame-Options`** | `DENY` | Clickjacking |
| **`X-Content-Type-Options`** | `nosniff` | MIME-Sniffing Execution |
| **`Referrer-Policy`** | `strict-origin-when-cross-origin` | Sensitive URL Path Leakage |
| **`Permissions-Policy`** | `camera=(), microphone=()` | Hardware Sensor Access |
