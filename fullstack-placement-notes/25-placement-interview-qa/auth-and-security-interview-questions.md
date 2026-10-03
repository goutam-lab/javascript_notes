# Authentication & Security Engineering Placement Interview Mastery Guide

---

## 1. What is it?

Authentication and Security Engineering interview mastery covers the protocols, cryptographic foundations, session management architectures, and vulnerability defense mechanisms required to design safe, enterprise-grade full-stack applications. In top-tier software engineering interviews, candidates are evaluated on far more than basic login forms or calling `jwt.sign()`. Interviewers scrutinize your understanding of **asymmetric vs symmetric cryptographic token signing**, **OAuth 2.0 Authorization Code Flow with PKCE**, **Refresh Token Rotation security boundaries**, **CSRF vs XSS attack vectors across modern cookie configurations**, **OWASP Top 10 mitigation strategies**, and **Attribute-Based Access Control (ABAC)**.

```
+-----------------------------------------------------------------------------------+
|                        Authentication & Security Matrix                           |
+-----------------------------------------------------------------------------------+
| 1. Authentication Layer: Identity verification (Passwords, MFA/TOTP, SSO, Passkeys)|
| 2. Authorization Layer:  Permission evaluation (RBAC, ABAC, ReBAC, OAuth2 Scopes) |
| 3. Token Systems:        JWT (RS256 vs HS256), OIDC Claims, Refresh Rotation     |
| 4. Session Storage:      HttpOnly SameSite Cookies vs In-Memory vs Redis Store    |
| 5. Attack Mitigations:   XSS (CSP, DOMPurify), CSRF (SameSite/Tokens), SSRF, CORS |
| 6. Cryptographic Hashing:Argon2id, bcrypt, scrypt, PBKDF2 (Memory & Work Factors) |
+-----------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Without robust authentication and security engineering:
1. **Broken Object Level Authorization (BOLA / IDOR):** Attackers change an ID in an API request (`GET /api/documents/1092` to `1093`) and access confidential financial records belonging to other tenants.
2. **Session Hijacking & Token Theft:** Storing authentication tokens in browser `localStorage` leaves tokens vulnerable to theft via Cross-Site Scripting (XSS), granting attackers complete, unrevocable account takeover.
3. **Credential Stuffing & Rainbow Table Attacks:** Inadequate password hashing algorithms (MD5, SHA256) allow attackers to crack dumped database password hashes in seconds using modern GPU arrays.
4. **Third-Party Delegation Risks:** Exchanging raw user credentials with third-party apps compromises identity. OAuth 2.0 and OpenID Connect (OIDC) were created to provide standardized, scoped token delegation without credential exposure.

---

## 3. Mental Model

To master authentication and security in interviews, visualize security through the **Defense-in-Depth Layered Onion Model**:

```
[ UNTRUSTED EXTERNAL WORLD (User Browser / Attacker / Mobile App) ]
                                |
                                v
               [ Edge / Reverse Proxy / Gateway ]
               - Rate Limiting (Token Bucket)
               - WAF (Web Application Firewall) & DDoS Shield
               - Strict TLS / HSTS Enforcement
                                |
                                v
                [ Network Transport Security ]
               - CORS Headers (Allowed Origins)
               - Security Headers (CSP, X-Frame-Options)
               - Secure, HttpOnly, SameSite=Lax/Strict Cookies
                                |
                                v
               [ Application Security Gateway ]
               - CSRF Token Validation
               - JWT Asymmetric Signature Verification (RS256)
               - Input Validation & Sanitization (Zod / DOMPurify)
                                |
                                v
               [ Business Logic / Authorization ]
               - User Authentication Check (Who are you?)
               - RBAC / ABAC Permission Check (Can you do this?)
               - Object-Level Ownership Verification (Do you own this row?)
                                |
                                v
               [ Database Persistence / Secrets ]
               - Parameterized Queries (Zero SQLi)
               - Passwords hashed with Argon2id / bcrypt
               - Encrypted at Rest (AES-256-GCM)
```

---

## 4. Basic Example

### Secure Cookie-Based Session Configuration in Express

```typescript
import express from "express";
import session from "express-session";
import RedisStore from "connect-redis";
import { createClient } from "redis";

const app = express();
const redisClient = createClient({ url: process.env.REDIS_URL });
await redisClient.connect();

app.use(
  session({
    store: new RedisStore({ client: redisClient, prefix: "sess:" }),
    name: "__Host-sid", // Security prefix: enforces Secure flag and root path
    secret: process.env.SESSION_SECRET!,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true, // Prevents JavaScript document.cookie access (Mitigates XSS)
      secure: process.env.NODE_ENV === "production", // Transmitted ONLY over HTTPS
      sameSite: "lax", // Defends against Cross-Site Request Forgery (CSRF)
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days expiration
      path: "/",
    },
  })
);
```

---

## 5. Real Example

### Production Refresh Token Rotation with Reuse Detection

```typescript
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { db } from "@/lib/db";

interface TokenPayload {
  userId: string;
  role: string;
}

export async function handleRefreshTokenRotation(req: Request, res: Response) {
  const incomingRefreshToken = req.cookies?.refreshToken;
  if (!incomingRefreshToken) {
    return res.status(401).json({ error: "Refresh token missing" });
  }

  // Hash the incoming token to match database storage
  const incomingTokenHash = crypto
    .createHash("sha256")
    .update(incomingRefreshToken)
    .digest("hex");

  // Query token record
  const tokenRecord = await db.refreshToken.findUnique({
    where: { tokenHash: incomingTokenHash },
    include: { user: true },
  });

  // CRITICAL SECURITY FEATURE: Automatic Reuse Detection
  // If token exists but is already marked revoked, an attacker or compromised client is reusing it!
  if (!tokenRecord || tokenRecord.isRevoked) {
    if (tokenRecord) {
      // Invalidate the ENTIRE token family for this user immediately (Compromise Protocol)
      await db.refreshToken.updateMany({
        where: { userId: tokenRecord.userId },
        data: { isRevoked: true },
      });
      console.warn(`SECURITY ALERT: Token reuse detected for user ${tokenRecord.userId}. Revoking all sessions.`);
    }
    return res.status(403).json({ error: "Invalid token. Session revoked." });
  }

  // Mark the consumed refresh token as revoked
  await db.refreshToken.update({
    where: { id: tokenRecord.id },
    data: { isRevoked: true },
  });

  // Generate new cryptographic Refresh Token
  const newRefreshToken = crypto.randomBytes(64).toString("hex");
  const newRefreshTokenHash = crypto
    .createHash("sha256")
    .update(newRefreshToken)
    .digest("hex");

  // Store new token in the database
  await db.refreshToken.create({
    data: {
      userId: tokenRecord.userId,
      tokenHash: newRefreshTokenHash,
      familyId: tokenRecord.familyId,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    },
  });

  // Issue new short-lived Access Token (15 mins)
  const newAccessToken = jwt.sign(
    { userId: tokenRecord.userId, role: tokenRecord.user.role },
    process.env.JWT_PRIVATE_KEY!,
    { algorithm: "RS256", expiresIn: "15m" }
  );

  // Set rotated refresh token in HttpOnly cookie
  res.cookie("refreshToken", newRefreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/api/auth/refresh",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  return res.json({ accessToken: newAccessToken });
}
```

---

## 6. Under the Hood

### JWT Architecture & Cryptographic Signing: HS256 vs RS256

A JSON Web Token consists of three base64url-encoded parts separated by dots: `Header.Payload.Signature`.

```
+-----------------------------------------------------------------------------------+
|                                 JWT Anatomy                                       |
+-----------------------------------------------------------------------------------+
| 1. Header:    {"alg": "RS256", "typ": "JWT"}                                      |
| 2. Payload:   {"sub": "usr_102", "role": "ADMIN", "iat": 1700000000, "exp": ...} |
| 3. Signature: Sign(Base64Url(Header) + "." + Base64Url(Payload), SecretOrKey)     |
+-----------------------------------------------------------------------------------+
```

#### Symmetric (HS256) vs Asymmetric (RS256 / Ed25519)
* **HS256 (HMAC with SHA-256):** Uses a **single shared secret key** to both create and verify tokens.
  * *Critical flaw in microservices:* Every single backend service that validates the JWT must possess the shared secret. If one downstream service is breached, the attacker can forge arbitrary admin tokens for the entire ecosystem.
* **RS256 (RSA Signature with SHA-256):** Uses an **asymmetric key pair**.
  * The Auth Server signs the JWT using its **Private Key**.
  * All downstream microservices and external gateways verify the JWT using the Auth Server's **Public Key** (distributed via JWKS: JSON Web Key Set). Downstream services can verify tokens, but cannot forge them.

---

## 7. Important Rules

1. **Rule of Token Storage:** Never store sensitive authentication tokens (Access or Refresh) in `localStorage` or `sessionStorage`. Any Cross-Site Scripting (XSS) vulnerability on your domain gives malicious JavaScript full access to read and exfiltrate tokens. Use `HttpOnly`, `Secure`, `SameSite=Lax/Strict` cookies.
2. **Rule of Password Hashing:** Never use general-purpose cryptographic hash functions (MD5, SHA-1, SHA-256, SHA-512) for passwords. They are intentionally designed to be fast, allowing hardware ASICs/GPUs to compute billions of guesses per second. Always use slow, memory-hard adaptive hashing algorithms: **Argon2id (recommended)** or **bcrypt**.
3. **Rule of Object-Level Authorization:** Authenticating the user (`req.user = decodedToken`) is not enough. You must verify that `req.user.id === resource.ownerId` or that the user has an explicit role grant on that specific record.
4. **Rule of Constant-Time Comparisons:** Always compare cryptographic hashes, HMAC signatures, and tokens using `crypto.timingSafeEqual()` to defend against side-channel timing attacks.

---

## 8. Common Mistakes

### Mistake 1: Accepting the "none" Algorithm in JWT Libraries
Older JWT libraries contained a severe vulnerability where an attacker changed `"alg": "HS256"` to `"alg": "none"` in the header, stripped the signature, and bypassed verification entirely because the parser treated unsigned tokens as valid.

### Mistake 2: Missing CSRF Protection with `SameSite=None`
Setting `SameSite=None` on authentication cookies without implementing Anti-CSRF tokens or custom headers (`X-Requested-With`). This allows third-party malicious sites to forge authenticated state-changing requests when a logged-in user visits an attacker's website.

### Mistake 3: State-Less Logout with JWTs
Believing that deleting the JWT on the client side constitutes a real logout. If an attacker intercepted the token before deletion, it remains completely valid on the server until its `exp` time expires. A production system must maintain a token blocklist in Redis or use a user-level `tokenVersion` counter.

---

## 9. Best Practices

1. **Short-Lived Access Tokens + Refresh Token Rotation:** Keep access tokens short-lived (10–15 minutes) and issue refresh tokens that can only be used once, invalidating the entire token family upon duplicate consumption.
2. **Strict Content Security Policy (CSP):** Prevent XSS by enforcing strict script execution policies via HTTP response headers:
   ```http
   Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-rAnd0m123'; object-src 'none';
   ```
3. **Multi-Factor Authentication (TOTP - RFC 6238):** Implement Time-Based One-Time Passwords using HMAC-SHA1 across 30-second time-step windows with window skew tolerance of $\pm 1$.
4. **Rate Limiting on Sensitive Endpoints:** Enforce strict sliding window rate limits on `/api/auth/login`, `/api/auth/forgot-password`, and OTP verification endpoints to halt credential stuffing and brute force attempts.

---

## 10. Performance Considerations

* **Asymmetric Verification Overhead:** RS256 token verification is CPU-intensive compared to HS256. In high-throughput API gateways processing 50,000 req/sec, caching verified public keys and public key JWKS endpoints in memory is critical.
* **Bcrypt Work Factor Calibration:** Bcrypt work factor (cost) scales exponentially ($2^{\text{cost}}$). A cost factor of 12 takes ~250ms per hash on modern CPUs—ideal for security vs server capacity. A cost of 16 takes 4 seconds, creating an easy Denial of Service (DoS) attack surface if an attacker spams concurrent login requests.

---

## 11. Security Considerations

* **Server-Side Request Forgery (SSRF):** When an API accepts a URL from a user (e.g., webhook URL, profile avatar fetcher), an attacker can pass internal network addresses (`http://169.254.169.254/latest/meta-data/` to steal AWS IAM credentials or `http://localhost:5432`). Always validate and disallow private IP ranges (RFC 1918) before performing outgoing fetches.
* **CORS Misconfiguration:** Never use `Access-Control-Allow-Origin: *` in conjunction with `Access-Control-Allow-Credentials: true`. Browsers automatically reject this combination, but dynamically echoing back the incoming `Origin` header creates the exact same vulnerability, allowing any website to read your user's authenticated responses.

---

## 12. Alternatives

| Auth Mechanism | Pros | Cons | Best Use Case |
| :--- | :--- | :--- | :--- |
| **Stateful Sessions (Redis)** | Instant revocation, minimal payload over wire, easy session termination | Centralized database dependency, storage overhead at scale | Enterprise SaaS, banking portals, high-security admin apps |
| **Stateless JWTs (RS256)** | Scalable across distributed microservices, zero DB lookup per request | Difficult immediate revocation, larger header payload size | Distributed microservices, public developer APIs |
| **OAuth 2.0 / OIDC** | Industry standard, third-party delegation, standardized identity claims | High protocol complexity (PKCE, state, nonce) | "Sign in with Google/GitHub", federated enterprise SSO |
| **WebAuthn / Passkeys** | Phishing-proof, hardware biometric security, zero shared passwords | Complex fallback recovery UX, browser/device compatibility edge cases | Next-gen consumer consumer logins, zero-trust platforms |

---

## 13. Trade-offs

* **Stateless Token Independence vs Immediate Revocation:** Stateless JWTs eliminate database roundtrips on every request, but make instant revocation impossible without adding a distributed stateful blocklist (which reintroduces database overhead).
* **Security vs User Friction:** Enforcing 2FA, re-authentication on password changes, and aggressive 15-minute session timeouts increases security posture, but adds UX friction that can impact conversion rates.

---

## 14. Real-World Usage

* **GitHub:** Enforced mandatory 2FA for all active contributors, combined with FIDO2 hardware security keys to protect code supply chains against credential leaks.
* **Stripe:** Uses restricted API keys with granular Attribute-Based Access Control (ABAC) and signed webhook payloads (`Stripe-Signature` HMAC-SHA256) to guarantee webhook authenticity and immutability.

---

## 15. Placement Interview Questions

### Basic Level
1. **What is the difference between Authentication (AuthN) and Authorization (AuthZ)?**
   * *Answer:* Authentication verifies **identity** ("Who are you?"), such as verifying a username and password, validating an OTP, or verifying a biometric fingerprint. Authorization determines **permissions** ("What are you allowed to do?"), verifying whether an already-authenticated user has the privileges to access a resource (e.g., read a confidential report, delete a record).

2. **What are the three parts of a JWT and what does each contain?**
   * *Answer:*
     1. *Header:* Contains metadata about the token, including the signature algorithm (`alg`, e.g., RS256) and token type (`typ: "JWT"`).
     2. *Payload:* Contains claims (subject `sub`, expiration `exp`, roles, custom metadata). Base64Url-encoded, NOT encrypted (visible to anyone).
     3. *Signature:* Cryptographic hash of the encoded header and payload created with a secret key or private key, ensuring data integrity and tamper-resistance.

3. **What is Cross-Site Scripting (XSS) and what are its three primary types?**
   * *Answer:* XSS occurs when an application includes untrusted data in a web page without proper validation or escaping, allowing an attacker to execute malicious JavaScript in a victim's browser.
     - *Stored XSS:* Malicious script is permanently stored in a database (e.g., in a comment field) and served to all subsequent visitors.
     - *Reflected XSS:* Malicious script is reflected off the web server in an immediate response (e.g., in a search query parameter).
     - *DOM-based XSS:* Vulnerability exists entirely on the client side where JavaScript writes user input directly into dangerous DOM sinks (`innerHTML`, `eval()`).

4. **What is Cross-Site Request Forgery (CSRF)?**
   * *Answer:* CSRF is an attack that tricks an authenticated user's browser into executing an unauthorized state-changing action on a trusted website (e.g., transferring funds, changing an email address). The browser automatically includes the user's session cookies with the cross-origin request because the victim is currently logged in.

5. **Why should passwords be salted before hashing?**
   * *Answer:* A salt is a unique, cryptographically random string appended to a password before hashing. Salting ensures that identical passwords produce completely different hash outputs, completely neutralizing **Rainbow Table attacks** (precomputed hash lookup tables) and preventing an attacker from detecting if multiple users share the same password.

---

### Conceptual Level
6. **How does OAuth 2.0 Authorization Code Flow with PKCE work, and why is PKCE mandatory for Single Page Apps (SPAs)?**
   * *Answer:*
     1. Client generates a cryptographically random `code_verifier` and computes its SHA-256 hash, called the `code_challenge`.
     2. Client redirects user to Authorization Server, sending `code_challenge` and `code_challenge_method = S256`.
     3. User authenticates and authorizes permissions.
     4. Auth Server redirects back to client with an `authorization_code`.
     5. Client exchanges the `authorization_code` and original `code_verifier` with Auth Server via POST request.
     6. Auth Server hashes `code_verifier` and verifies it matches original `code_challenge`. If matched, tokens are returned.
     * *Why PKCE is mandatory:* Public clients (React SPAs, mobile apps) cannot safely store a client secret. PKCE prevents attackers who intercept the authorization code (e.g., via browser history or custom URI scheme hijacking) from exchanging it for tokens without possessing the original memory-held `code_verifier`.

7. **Explain the `SameSite` cookie attribute values: `Strict`, `Lax`, and `None`.**
   * *Answer:*
     * `Strict`: Cookie is sent *only* if the request originates from the exact same site. Never sent on cross-site links (e.g., clicking a link from an email will not send the cookie).
     * `Lax` (Modern Browser Default): Cookie is withheld on cross-site subrequests (images, iframes, AJAX POST requests), but *is* sent when a user navigates to the origin site via top-level link clicks (`<a href>`). Provides CSRF protection for mutations while maintaining link navigation UX.
     * `None`: Cookie is sent on all cross-site requests. Requires the `Secure` flag (HTTPS only).

8. **What is an Insecure Direct Object Reference (IDOR) and how do you prevent it?**
   * *Answer:* IDOR (or BOLA) occurs when an application uses user-supplied input to access objects directly without authorization checks (e.g., `DELETE /api/orders/9981`).
   * *Prevention:*
     - Never rely solely on object IDs. Enforce ownership queries: `DELETE FROM orders WHERE id = $1 AND user_id = $2;`.
     - Use non-sequential identifiers (UUIDv4 or ULID) to prevent ID enumeration.
     - Implement centralized Attribute-Based Access Control (ABAC) middleware.

9. **Compare bcrypt, Argon2id, and PBKDF2. Why is Argon2id the modern gold standard?**
   * *Answer:*
     - *PBKDF2:* CPU-intensive algorithm. Vulnerable to fast hardware cracking via ASICs and GPUs that compute SHA iterations in parallel.
     - *bcrypt:* Uses Eksblowfish key schedule. Introduces memory usage (4KB) to resist older GPU attacks, but is limited to a 72-byte password length and is vulnerable to specialized modern FPGA arrays.
     - *Argon2id:* Winner of the Password Hashing Competition. It provides **memory-hard** and **time-hard** parameters. It combines Argon2d (resistant to GPU cracking) and Argon2i (resistant to side-channel cache timing attacks). Hardware attackers cannot parallelize guesses without allocating massive amounts of physical RAM per thread.

10. **Explain the difference between RBAC (Role-Based Access Control) and ABAC (Attribute-Based Access Control).**
    * *Answer:*
      * *RBAC:* Permissions are assigned to static roles (e.g., `ADMIN`, `EDITOR`, `VIEWER`), and users are assigned roles. Simple to implement, but suffers from "role explosion" when fine-grained rules are required.
      * *ABAC:* Evaluates dynamic attributes of the subject (user role, department), resource (owner, classification, project), action (read, edit, delete), and environment (time of day, IP subnet, device compliance). Enables complex policies like: *"A Doctor can view Medical Records ONLY IF the Doctor is assigned to the Patient AND access is during Hospital Operating Hours."*

---

### Implementation Level
11. **Implement a constant-time HMAC signature verification function in Node.js to validate third-party webhook requests.**
    * *Answer:*
    ```typescript
    import crypto from "crypto";

    export function verifyWebhookSignature(
      rawPayload: string | Buffer,
      receivedSignature: string,
      secretKey: string
    ): boolean {
      const computedSignature = crypto
        .createHmac("sha256", secretKey)
        .update(rawPayload)
        .digest("hex");

      const signatureBuffer = Buffer.from(receivedSignature, "utf8");
      const computedBuffer = Buffer.from(computedSignature, "utf8");

      // Length mismatch implies immediate failure, but check safely
      if (signatureBuffer.length !== computedBuffer.length) {
        return false;
      }

      // Timing-safe comparison prevents side-channel timing attacks
      return crypto.timingSafeEqual(signatureBuffer, computedBuffer);
    }
    ```

12. **How do you implement immediate revocation for stateless JWTs without querying a database on every single API request?**
    * *Answer:* Use a **Hybrid Token Versioning Strategy**:
      1. Embed a `tokenVersion: number` claim inside the short-lived JWT (15-min TTL).
      2. Store `user:{userId}:tokenVersion` in an in-memory Redis cluster.
      3. On sensitive events (password change, user clicking "Logout Everywhere"), increment the user's version counter in Redis (`INCR user:123:tokenVersion`).
      4. Downstream services read the version from Redis (sub-millisecond in-memory cache lookup) or check only when renewing access tokens, instantly invalidating all tokens with an outdated version.

13. **How do you configure a production Content Security Policy (CSP) header in an Express application using `helmet`?**
    * *Answer:*
    ```typescript
    import helmet from "helmet";

    app.use(
      helmet.contentSecurityPolicy({
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "https://trusted-cdn.com"],
          styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          fontSrc: ["'self'", "https://fonts.gstatic.com"],
          imgSrc: ["'self'", "data:", "https://images.unsplash.com"],
          connectSrc: ["'self'", "https://api.stripe.com"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"], // Prevents Clickjacking
          upgradeInsecureRequests: [],
        },
      })
    );
    ```

14. **How do you implement brute-force login protection with exponential backoff and account lockouts?**
    * *Answer:* Store login attempt counts in Redis keyed by `login_attempts:{email}` with a 15-minute TTL.
      * Attempts 1–4: Return standard 401 Unauthorized.
      * Attempt 5: Enforce a CAPTCHA challenge or 2-minute mandatory delay.
      * Attempt 10: Temporarily lock account for 30 minutes, send a security alert email to the user with a password reset link, and log the attacker's IP to the SIEM system.

15. **How do you prevent Server-Side Request Forgery (SSRF) when fetching user-supplied avatar URLs?**
    * *Answer:*
      1. Parse the user-provided URL and strictly whitelist protocols (`http:`, `https:`).
      2. Resolve DNS for the hostname using `dns.promises.lookup()`.
      3. Validate resolved IP addresses against private and link-local CIDR ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`). Reject immediately if an IP belongs to a private range.
      4. Fetch the image using a custom HTTP agent bound to the validated public IP, with a strict 3-second timeout and 5MB size limit.

---

### Debugging Level
16. **Users report that after logging in on Chrome, their session is lost whenever they refresh the page, but Firefox works. What is happening?**
    * *Answer:* The authentication cookie was set with `SameSite=None` without the `Secure` attribute, or the application is running over plain HTTP in local development. Chrome strictly enforces that any cookie with `SameSite=None` MUST include the `Secure` flag and be delivered over HTTPS. When `Secure` is missing, Chrome silently rejects the cookie.

17. **Your security scanner flags a "CORS Wildcard with Credentials" vulnerability. What causes this?**
    * *Answer:* The backend contains logic dynamically reflecting the incoming `Origin` header into `Access-Control-Allow-Origin: <req.headers.origin>` while simultaneously setting `Access-Control-Allow-Credentials: true`. This allows any malicious website visited by an authenticated user to perform credentialed AJAX requests and read the response data, completely bypassing the browser's Same-Origin Policy.

18. **Why does an Express app throw `Error: secret option required for sessions` even though `process.env.SESSION_SECRET` is set in the `.env` file?**
    * *Answer:* The `.env` file was not loaded before the session configuration initialized. In Node.js/TypeScript, `import` statements are hoisted. If `import dotenv from "dotenv"; dotenv.config();` is placed after `import app from "./app"`, the session middleware reads `process.env.SESSION_SECRET` as `undefined`. Solution: Execute `dotenv.config()` at the very top of the application entry point.

19. **Why is an attacker able to execute an XSS attack even though you stripped `<script>` tags from user comments?**
    * *Answer:* Attackers bypass naive regex filters using alternative HTML tags with event handlers: `<img src="invalid" onerror="alert(document.cookie)">`, `<svg onload="alert(1)">`, or `<a href="javascript:alert(1)">Click Me</a>`. Never write custom regex sanitizers. Always use an established, audited sanitization library like **DOMPurify** or sanitize at rendering via React's automatic JSX text escaping.

20. **Why did users suddenly start getting logged out every 15 minutes after you deployed your app to 3 load-balanced instances?**
    * *Answer:* The application was using the default in-memory session store (`MemoryStore`). Each load-balanced instance maintained its own isolated memory heap. When a user's subsequent request was routed to a different instance by the load balancer, that instance could not find the session ID in its local RAM and rejected the request. Solution: Use a shared centralized session store like **Redis**.

---

### Scenario-Based Questions
21. **Scenario:** You are designing a Multi-Tenant B2B SaaS application. How do you guarantee that Company A's employees cannot access Company B's data under any circumstance?
    * *Answer:*
      1. Embed `tenantId` in the signed JWT and session context.
      2. Enforce database Row-Level Security (RLS) in PostgreSQL, binding the connection's session variable to the validated `tenantId`.
      3. In the ORM/Data layer, implement an automated tenant filter extension (e.g., Prisma client extension) that automatically appends `where: { tenantId }` to every read and write.
      4. Require multi-tenant unit and integration tests that explicitly attempt cross-tenant reads.

22. **Scenario:** A mobile application and a web Single Page App share the same backend. How should authentication be architected for both?
    * *Answer:*
      - *Web SPA:* Use `HttpOnly`, `Secure`, `SameSite=Lax` cookies for the refresh token and session cookies to protect against XSS token theft.
      - *Mobile Native App (iOS/Android):* Native apps are not subject to browser Same-Origin Policy or XSS cookie handling. Use OAuth 2.0 PKCE, storing the Refresh Token securely in the OS hardware-backed keychain (iOS Keychain Services / Android Keystore). Transmit tokens in the `Authorization: Bearer <token>` header.

23. **Scenario:** Your company discovers an active data breach where an employee's JWT private key was exposed on GitHub. What is your immediate incident response protocol?
    * *Answer:*
      1. Immediately revoke the compromised RSA private key.
      2. Generate a new RSA key pair with a new Key ID (`kid: "key-2026-v2"`).
      3. Update the Auth Server to sign all new tokens with the new key.
      4. Update the public JWKS endpoint so API gateways only accept the new `kid`.
      5. Because older compromised tokens signed with the old key will fail verification, this instantly logs out all users globally.
      6. Invalidate all active sessions in Redis and force all users to re-authenticate with MFA.

24. **Scenario:** How do you implement a secure "Remember Me" feature that lasts for 30 days without exposing users to perpetual token theft?
    * *Answer:* Implement the **Persistent Login Cookie Pattern** (Charles Miller specification):
      - Store a cookie containing: `SeriesIdentifier:TokenValue`.
      - In the database, store `(userId, seriesIdentifier, hashedTokenValue, expiresAt)`.
      - When user visits: If `seriesIdentifier` matches and `hashedTokenValue` matches, issue a brand new `TokenValue` (rotate token) while keeping the same `seriesIdentifier`.
      - If `seriesIdentifier` matches but `hashedTokenValue` does NOT match, it indicates token theft (both victim and attacker have the cookie). Immediately invalidate all sessions for that series and alert the user.

25. **Scenario:** How do you safely export confidential user data (GDPR Right to Access) without exposing your internal database to memory crashes or data interception?
    * *Answer:*
      1. The user requests an export via an authenticated POST request. The server returns `202 Accepted` with a job ID.
      2. A background worker generates the export asynchronously: streams data in JSON chunks from PostgreSQL, writes to an encrypted ZIP file in temporary storage.
      3. Uploads the encrypted ZIP to Amazon S3 with server-side encryption (KMS).
      4. Generates an S3 Pre-Signed URL with a strict 15-minute expiration time.
      5. Sends the download link to the user's verified email address, requiring user to re-enter their password before download initiates.

---

### Advanced Architectural Questions
26. **Explain the OAuth 2.0 Token Exchange (RFC 8693) in a zero-trust microservice mesh.**
    * *Answer:* In a microservices architecture, Service A should not forward an end-user's raw client JWT to downstream Service B and Service C (which violates the Principle of Least Privilege). Instead, Service A performs Token Exchange with the Authorization Server: exchanging the user's broad JWT for a scoped, audience-restricted token (`aud: "service-c"`, `scope: "read:inventory"`) that is cryptographically signed and valid only between Service A and Service C.

27. **What is Clickjacking and how do modern security standards prevent it?**
    * *Answer:* Clickjacking occurs when an attacker embeds a vulnerable website inside an invisible transparent `<iframe>` on a malicious website, overlaying deceptive buttons over sensitive actions (e.g., "Click here to win a prize!" overlays "Delete Account").
    * *Mitigation:*
      - Send HTTP Header: `X-Frame-Options: DENY` or `SAMEORIGIN`.
      - Modern standard: Content Security Policy `frame-ancestors 'none';`.

28. **How do Passkeys (FIDO2 / WebAuthn) achieve phishing-proof authentication?**
    * *Answer:* Passkeys use asymmetric public-key cryptography. During registration, the user's device (authenticator) generates a public/private key pair. The private key remains securely locked inside the device's Secure Enclave/TPM and never leaves the hardware. During authentication, the server sends a random challenge. The device signs the challenge using the private key *only if* the browser confirms that the current origin matches the domain registered to the credential. Even if a user visits a fraudulent phishing domain (`evil-bank.com`), the browser detects the domain mismatch and refuses to sign the challenge.

29. **What is HTTP Request Smuggling and how does it arise?**
    * *Answer:* Request Smuggling occurs when a front-end reverse proxy and a back-end web server disagree on the boundaries of an HTTP request. This typically happens when an HTTP/1.1 request includes both `Content-Length` and `Transfer-Encoding: chunked` headers. If the front-end prioritizes `Content-Length` and the back-end prioritizes `Transfer-Encoding`, the backend treats part of the first request as the start of the next user's incoming request, enabling cache poisoning, credential hijacking, and firewall bypass.

30. **Explain how Zero-Knowledge Proofs (ZKPs) and zk-SNARKs can be used for authentication.**
    * *Answer:* A Zero-Knowledge Proof allows a Prover to prove to a Verifier that a statement is mathematically true without revealing any secret information beyond the validity of the statement. In authentication, a user can prove they possess the valid cryptographic secret/password or satisfy an age requirement (e.g., "User is over 21") without revealing their password or date of birth to the verifying server.

---

## 16. Coding Questions

### Coding Challenge 1: Custom Role and Permission-Based Guard Middleware (RBAC)

```typescript
import { Request, Response, NextFunction } from "express";

export type Permission = 
  | "users:read"
  | "users:write"
  | "users:delete"
  | "billing:manage";

// Extend Express Request type to include user context
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        roles: string[];
        permissions: Permission[];
      };
    }
  }
}

export function requirePermissions(requiredPermissions: Permission[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;

    if (!user) {
      return res.status(401).json({ error: "Unauthorized: Missing authentication" });
    }

    // Check if user has ALL required permissions
    const hasAllPermissions = requiredPermissions.every((perm) =>
      user.permissions.includes(perm)
    );

    if (!hasAllPermissions) {
      return res.status(403).json({
        error: "Forbidden",
        message: "You do not have the required permissions to perform this operation.",
        required: requiredPermissions,
      });
    }

    next();
  };
}
```

### Coding Challenge 2: RFC 6238 TOTP (Time-Based One-Time Password) Verification Algorithm

```typescript
import crypto from "crypto";

/**
 * Validates a 6-digit TOTP code against a base32 secret.
 * Step: 30 seconds. Window: +-1 step tolerance.
 */
export function verifyTOTP(token: string, secretBase32: string, windowSteps = 1): boolean {
  // Decode base32 secret to Buffer
  const key = base32Decode(secretBase32);
  const currentTime = Math.floor(Date.now() / 1000);
  const timeStep = 30;
  const currentCounter = Math.floor(currentTime / timeStep);

  for (let offset = -windowSteps; offset <= windowSteps; offset++) {
    const counter = currentCounter + offset;
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigInt64BE(BigInt(counter));

    // Compute HMAC-SHA1
    const hmac = crypto.createHmac("sha1", key).update(counterBuffer).digest();

    // Dynamic truncation algorithm (RFC 4226)
    const offsetIndex = hmac[hmac.length - 1] & 0x0f;
    const codeValue =
      ((hmac[offsetIndex] & 0x7f) << 24) |
      ((hmac[offsetIndex + 1] & 0xff) << 16) |
      ((hmac[offsetIndex + 2] & 0xff) << 8) |
      (hmac[offsetIndex + 3] & 0xff);

    const generatedOTP = (codeValue % 1000000).toString().padStart(6, "0");

    if (crypto.timingSafeEqual(Buffer.from(token), Buffer.from(generatedOTP))) {
      return true;
    }
  }

  return false;
}

function base32Decode(base32: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of base32.toUpperCase().replace(/=/g, "")) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}
```

---

## 17. Common Interview Traps

* **The Trap:** The interviewer asks: *"If an authentication cookie is set with `HttpOnly`, is the application 100% immune to Cross-Site Scripting (XSS) attacks?"*
  * **How candidates fail:** Saying "Yes, because the hacker cannot access the cookie."
  * **The Winning Answer:** Setting `HttpOnly` prevents the attacker from **stealing the raw cookie value** via `document.cookie`. However, the application is **NOT immune to XSS**! An attacker executing arbitrary JavaScript can still perform actions *on behalf of the victim* using the browser's active session via `fetch()` or `XMLHttpRequest` (XSS-driven CSRF), read private page data, log keystrokes, and inject fraudulent login overlays.
* **The Trap:** *"Can we prevent SQL Injection by filtering out the words `UNION`, `SELECT`, and `DROP` from user input?"*
  * **How candidates fail:** Suggesting regex blacklisting as a valid security technique.
  * **The Winning Answer:** Blacklist filters are easily bypassed using alternate encodings, inline comments (`UN/**/ION SELECT`), capitalization variants, or secondary injections. The *only* mathematically proven defense against SQL Injection is using **Parameterized Queries (Prepared Statements)** where SQL logic and user data are parsed separately by the database engine.

---

## 18. Revision Summary

```
+-----------------------------------------------------------------------------------+
|               Authentication & Security High-Yield Revision Matrix                |
+-----------------------------------------------------------------------------------+
| Cookie Attributes:   HttpOnly (blocks XSS reading), Secure (HTTPS), SameSite=Lax  |
| Password Hashing:    Argon2id or bcrypt (slow, memory-hard); NEVER MD5/SHA256      |
| JWT Signing:         RS256 (asymmetric key pair) for microservices; HS256 shared  |
| OAuth2 / OIDC:       Auth Code + PKCE for SPAs and mobile; prevents code theft    |
| Rotation & Reuse:    Refresh token rotation with family revocation on reuse       |
| OWASP Top Defenses:  CSP for XSS, SameSite for CSRF, Prepared Statements for SQLi |
+-----------------------------------------------------------------------------------+
```

---

## 19. Quick Reference

* **`HttpOnly`:** Enforces browser cookie invisibility to `document.cookie`.
* **`SameSite=Lax`:** Default cookie defense preventing cross-site state mutation attacks.
* **`RS256`:** Asymmetric JWT signature with Private Key sign and Public Key verify.
* **PKCE:** Proof Key for Code Exchange; mandatory security standard for public OAuth2 clients.
* **`crypto.timingSafeEqual`:** Constant-time buffer comparison preventing timing leaks.
* **Argon2id:** Gold standard memory-hard password hashing algorithm.
* **CSP (`Content-Security-Policy`):** HTTP header controlling allowed script/resource execution domains.
