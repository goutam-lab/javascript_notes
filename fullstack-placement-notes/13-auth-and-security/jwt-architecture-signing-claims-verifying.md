# JSON Web Tokens (JWT): Architecture, Cryptographic Signing, Claims, and Verification

---

## 1. What is it?

A **JSON Web Token (JWT)** (defined by **RFC 7519**) is an open, industry-standard compact URL-safe container format for securely transmitting verifiable assertions (claims) between two parties as a JSON object.

A JWT is fundamentally **stateless** and self-contained: all information required to authenticate and authorize a request (user ID, roles, permissions, expiration timestamp) is encoded directly inside the token itself. The authenticity and integrity of this data is cryptographically guaranteed by a digital signature. Any server possessing the verifying key can validate the token's origin and verify that its contents have not been tampered with—**without querying a database or cache**.

A serialized JWT consists of three distinct Base64URL-encoded strings separated by dots (`.`):
$$\text{JWT} = \text{Header} \,.\, \text{Payload} \,.\, \text{Signature}$$

```
+-------------------------------------------------------------------------------+
|                                ANATOMY OF A JWT                               |
+-------------------------------------------------------------------------------+
| eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9                                          |
| .eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ  |
| .SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c                                  |
+-------------------------------------------------------------------------------+
| 1. HEADER (Red)      | Metadata: Algorithm (`alg`: HS256) & Type (`typ`: JWT) |
| 2. PAYLOAD (Purple)  | Claims: Subject (`sub`), Expiration (`exp`), Custom data|
| 3. SIGNATURE (Blue)  | Cryptographic HMAC / RSA verification hash             |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

In traditional session architectures, every incoming HTTP request requires the server to query an in-memory database (Redis) or SQL database to fetch the user's session record. In high-scale distributed microservice architectures serving 500,000 requests per second across 50 microservices:
1. **Central Database Bottleneck**: The shared session database becomes an expensive single point of failure and scalability bottleneck.
2. **Cross-Service Latency**: Every microservice (Order Service, Billing Service, Inventory Service) must perform a network round-trip to the session store to verify the caller's identity.

JWTs solve this by moving the session state into the token itself. The authentication server issues a signed token once; downstream microservices simply verify the digital signature using a local public key in CPU memory ($< 0.05$ms), requiring zero network calls or database lookups.

---

## 3. Mental Model

Visualize a **Government-Issued Holographic Passport**:

- **The Header**: The front cover of the passport stating: *"United States Department of State, Format: Diplomatic Passport, Security Algorithm: Grade-A Holographic Ink"*.
- **The Payload**: The photo page containing your details: Name: Alice, Birthdate: 1995, Expiration: 2030, Nationality: Canadian.
- **The Signature (The Embedded Hologram & Seal)**: An intricate holographic watermark stamped by the federal government's secure stamping press.
- **The Verification Process**:
  - Alice lands in London. The UK border agent does not need to call the White House or query an American database.
  - The agent inspects the passport, validates the holographic seal (**Verifies the Signature**), and checks that the expiration date has not passed.
  - If Alice used a black marker to change her expiration date from 2024 to 2030, the seal's cryptographic checksum breaks, and she is arrested immediately (**Signature Mismatch / 401 Unauthorized**).

---

## 4. Basic Example

### 4.1 Symmetric Signing (`HS256`) with `jsonwebtoken`
```typescript
import jwt from "jsonwebtoken";

const SECRET_KEY = "super-secret-cryptographic-key-at-least-32-bytes";

// 1. SIGNING A TOKEN (Login Controller)
function generateToken(userId: string, role: string): string {
  const payload = {
    sub: userId, // Subject: The unique user identifier
    role: role,  // Custom claim
  };

  // Sign with HMAC SHA-256, expiring in 15 minutes
  return jwt.sign(payload, SECRET_KEY, {
    algorithm: "HS256",
    expiresIn: "15m",
    issuer: "api.mycompany.com",
    audience: "mycompany-app",
  });
}

// 2. VERIFYING A TOKEN (Auth Middleware)
function verifyToken(token: string) {
  try {
    const decoded = jwt.verify(token, SECRET_KEY, {
      algorithms: ["HS256"], // STRICTLY declare expected algorithms!
      issuer: "api.mycompany.com",
      audience: "mycompany-app",
    });
    console.log("Verified Payload:", decoded);
    return decoded;
  } catch (error: any) {
    console.error("JWT Verification Failed:", error.message);
    // Common errors: TokenExpiredError, JsonWebTokenError
    return null;
  }
}
```

---

## 5. Real Example

### Production Asymmetric Signing (`RS256` / `ES256`) in Microservices
In production microservices, **symmetric keys (`HS256`) are an anti-pattern** because every microservice must know the shared secret. If a compromised logging service has the secret, it can forge tokens as an administrator!
**Asymmetric signing (`RS256` / `ES256`)** uses a **Private Key** (kept only by the Auth Service to sign) and a **Public Key** (distributed to all microservices to verify):

```typescript
// auth-tokens.ts
import jwt, { SignOptions, VerifyOptions } from "jsonwebtoken";
import crypto from "node:crypto";

// Generate RSA 2048-bit keypair for demonstration (in production, load from vault/env)
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

export interface UserTokenPayload {
  sub: string;
  email: string;
  role: "USER" | "ADMIN";
}

export class AsymmetricJWTService {
  /**
   * AUTH SERVICE ONLY: Signs token using the PRIVATE KEY.
   */
  public static signUserToken(user: UserTokenPayload): string {
    const options: SignOptions = {
      algorithm: "RS256",
      expiresIn: "15m", // Short-lived access token
      issuer: "https://auth.enterprise.com",
      audience: "https://api.enterprise.com",
      jwtid: crypto.randomUUID(), // Unique token ID (jti) for revocation tracking
    };

    return jwt.sign(user, privateKey, options);
  }

  /**
   * ANY DOWNSTREAM MICROSERVICE: Verifies token using ONLY the PUBLIC KEY.
   */
  public static verifyUserToken(token: string): UserTokenPayload {
    const options: VerifyOptions = {
      algorithms: ["RS256"], // Prevents algorithm switching attacks
      issuer: "https://auth.enterprise.com",
      audience: "https://api.enterprise.com",
    };

    // Throws if expired, tampered with, or invalid issuer/audience
    const decoded = jwt.verify(token, publicKey, options) as jwt.JwtPayload;

    return {
      sub: decoded.sub as string,
      email: decoded.email,
      role: decoded.role,
    };
  }
}

// Verification Test
const token = AsymmetricJWTService.signUserToken({
  sub: "usr_99",
  email: "candidate@placement.com",
  role: "ADMIN",
});

console.log("Asymmetrically Signed Token:\n", token);
const verified = AsymmetricJWTService.verifyUserToken(token);
console.log("Successfully Verified with Public Key:", verified);
```

---

## 6. Under the Hood

### 6.1 Standard Registered Claims (RFC 7519)
The JWT specification defines standard 3-letter claims in the payload dictionary:

```
+-------------------------------------------------------------------------------+
|                       STANDARD REGISTERED CLAIMS (RFC 7519)                   |
+-------------------------------------------------------------------------------+
| Claim | Full Name      | Purpose / Example                                    |
+-------+----------------+------------------------------------------------------+
| `sub` | Subject        | The principal subject (Unique User ID: `usr_123`)    |
| `iss` | Issuer         | The authority issuing the token (`auth.company.com`) |
| `aud` | Audience       | The intended recipient service (`api.company.com`)   |
| `exp` | Expiration Time| Unix timestamp (seconds) when token becomes invalid  |
| `nbf` | Not Before     | Unix timestamp before which token must be rejected   |
| `iat` | Issued At      | Unix timestamp when token was created                |
| `jti` | JWT ID         | Unique identifier for the token (used in revocation) |
+-------+----------------+------------------------------------------------------+
```

### 6.2 Symmetric (`HS256`) vs Asymmetric (`RS256` / `ES256`)
- **`HS256` (HMAC with SHA-256)**: Uses a single shared symmetric key. Fast and simple, but every service that verifies the token has the power to generate fake tokens.
- **`RS256` (RSA Signature with SHA-256)**: Uses public/private key cryptography. Slower than HMAC, but secure for multi-tenant microservices and third-party API clients.
- **`ES256` (ECDSA using P-256 curve)**: Uses Elliptic Curve cryptography. Produces significantly shorter tokens with equivalent cryptographic strength to a 3072-bit RSA key, saving bandwidth.

### 6.3 The Fundamental Flaw: The JWT Revocation Problem
Because a JWT is completely stateless, **you cannot revoke a JWT before its expiration date without adding centralized state**.
If a user is fired or their phone is stolen, an access token valid for 24 hours can be used by an attacker for the full 24 hours.

**How Production Systems Solve This**:
1. **Short-Lived Access Tokens**: Set access token expiration to **5 to 15 minutes**.
2. **Dual-Token Architecture**: Pair short-lived access tokens with a stateful, rotatable **Refresh Token** stored in Redis/DB.
3. **Redis Blacklist / Bloom Filter**: If an emergency instant revocation is needed (e.g., user clicked "Revoke All"), the `jti` is pushed to a Redis set with a TTL matching the token's remaining lifespan.

---

## 7. Important Rules

1. **JWTs Are NOT Encrypted By Default**: Base64URL encoding is **NOT** encryption! Anyone who intercepts a JWT can paste it into `jwt.io` and read every single field in the payload in plain text. **Never store passwords, credit card numbers, or PII in a JWT payload.**
2. **Always Enforce the `algorithms` Array**: Never call `jwt.verify(token, key)` without explicitly declaring `{ algorithms: ['RS256'] }`.
3. **Always Validate `exp`, `iss`, and `aud`**: Ensure tokens issued for a mobile client cannot be presented to an internal admin service.
4. **Keep Payloads Small**: JWTs are transmitted on every single HTTP request header. Storing 20KB of user profile data inside a JWT bloats network bandwidth.

---

## 8. Common Mistakes

### Mistake 1: The "Algorithm None" (`alg: "none"`) Vulnerability
Early JWT libraries allowed tokens with `{"alg": "none"}` in the header (used for debugging). Attackers crafted tokens with `{"role": "admin"}`, set `alg: "none"`, stripped the signature, and bypassed authentication completely! Modern libraries reject `none` by default, but you must always specify allowed algorithms explicitly.

### Mistake 2: Key Confusion Attack (HMAC vs RSA)
If a server accepts both `RS256` and `HS256`, an attacker takes the server's public RSA key (which is public knowledge) and signs a fraudulent token using `HS256`, using the public key string as the HMAC secret! If the verification function doesn't enforce algorithms, it uses the public key as an HMAC secret and approves the forged signature.

### Mistake 3: Infinite Lifespan Tokens
Setting a JWT to expire in 30 days or never expire means any compromised token grants permanent, irreversible access.

---

## 9. Best Practices

1. **Use `crypto.randomUUID()` for `jti`**: Every token should carry a unique identifier for audit logs and selective blacklisting.
2. **Store JWTs in `HttpOnly` Cookies (for Browsers)**: Storing JWTs in `localStorage` exposes them to XSS exfiltration. Store them in secure, `HttpOnly`, `SameSite=Lax` cookies.
3. **Distribute Public Keys via JWKS (JSON Web Key Set)**: Microservices fetch public keys from an endpoint (`/.well-known/jwks.json`) on the Auth server, enabling seamless cryptographic key rotation without redeploying microservices.

---

## 10. Performance Considerations

```
+-------------------------------------------------------------------------------+
|                       JWT VERIFICATION BENCHMARKS (10,000 Ops)                |
+-------------------------------------------------------------------------------+
| Algorithm                             | Operations / Sec | CPU Overhead       |
+---------------------------------------+------------------+--------------------+
| HS256 (HMAC SHA-256)                  | ~120,000 ops/sec | Ultra-low (0.008ms)|
| RS256 (RSA 2048-bit)                  | ~22,000 ops/sec  | Moderate (0.045ms) |
| ES256 (ECDSA P-256)                   | ~35,000 ops/sec  | Low (0.028ms)      |
+---------------------------------------+------------------+--------------------+
```

- Symmetric `HS256` verification is ~5x faster than RSA, but sacrifices the security benefits of public/private key separation in distributed architectures.

---

## 11. Security Considerations

1. **Payload Data Leakage**: Do not put sensitive business logic, permissions you don't want clients to inspect, or user secrets in the payload.
2. **Replay Attacks**: A stolen valid access token can be replayed from any IP address until it expires. Short token lifetimes (5-15 mins) minimize this attack window.

---

## 12. Alternatives

| Mechanism | Description | Best For |
| :--- | :--- | :--- |
| **JWT** | Signed, stateless JSON container. | Modern microservices, Single Sign-On (OIDC). |
| **Paseto (Platform-Agnostic Security Tokens)**| Opinionated modern replacement for JWT. | Eliminates algorithm negotiation vulnerabilities. |
| **Macaroons** | Cookies with decentralized contextual caveats. | Complex distributed authorization chains. |
| **Opaque Session Tokens** | Random strings backed by Redis. | Traditional monoliths with instant revocation. |

---

## 13. Trade-offs

- **Stateless Verification vs Instant Revocation**:
  - *Stateless JWT*: Zero database lookups across 100 microservices; maximum throughput. Cannot instantly revoke tokens without adding centralized state.
  - *Stateful Sessions*: Instant revocation and zero payload bloat; requires Redis lookups on every request.

---

## 14. Real-World Usage

- **OpenID Connect (OIDC)**: Issues signed `id_token` JWTs containing user identity assertions to third-party apps (Google Login, Sign in with Apple).
- **AWS API Gateway / Kong**: Validates JWT signatures at the ingress perimeter, stripping the signature and passing user headers downstream.

---

## 15. Placement Interview Questions

### 15.1 Basic Questions
1. *What are the three components of a JSON Web Token (JWT)?*
   - Answer: Header (algorithm & token type), Payload (claims & user data), and Signature (cryptographic hash ensuring integrity).
2. *Is the payload of a standard JWT encrypted?*
   - Answer: No! The payload is simply Base64URL-encoded, not encrypted. Anyone can decode and view its contents. It is signed to detect tampering, but confidentiality is not protected unless using JWE (JSON Web Encryption).

### 15.2 Conceptual Questions
3. *What is the difference between `HS256` and `RS256` in JWT signing?*
   - Answer: `HS256` is a symmetric algorithm using a single shared secret key for both signing and verifying. `RS256` is an asymmetric algorithm using an RSA private key to sign the token and a corresponding public key to verify it. `RS256` is preferred in microservices so downstream services can verify tokens without possessing the power to forge them.
4. *Explain the JWT Revocation Problem and how engineering teams resolve it.*
   - Answer: Because JWTs are self-contained and stateless, a server cannot invalidate a token before its expiration time without introducing server-side state. Teams resolve this by issuing short-lived access tokens (5-15 minutes) paired with stateful refresh tokens stored in Redis/DB, and maintaining an emergency blacklist of revoked `jti` (JWT IDs) in Redis.

### 15.3 Implementation Questions
5. *How do you prevent the "Algorithm None" attack in an Express JWT verification middleware?*
   - Answer: By explicitly supplying the `algorithms` array option to `jwt.verify()`:
     ```typescript
     jwt.verify(token, secret, { algorithms: ["RS256"] });
     ```
     This forces the library to strictly reject any token whose header specifies `alg: "none"` or any other algorithm.

### 15.4 Debugging Questions
6. *Your API returns `TokenExpiredError: jwt expired` for a request sent from a mobile app whose clock is 3 minutes behind the server. How can you handle slight clock discrepancies?*
   - Answer: Use the `clockTolerance` option in `jwt.verify()`:
     ```typescript
     jwt.verify(token, secret, { clockTolerance: 30 }); // Allows 30 seconds of clock drift
     ```

### 15.5 Scenario Questions
7. *Design a secure JWT authentication architecture for a financial application that requires immediate session termination if a user's account is suspended.*
   - Answer: Use a hybrid model. The JWT access token has a short 5-minute lifespan and contains `sub` (userId) and `jti`. When an account is suspended, the admin service pushes the `userId` to a Redis distributed set `suspended_users`. The API Gateway checks Redis (`EXISTS suspended_users:<userId>`) on incoming requests ($< 0.5$ms) and rejects traffic immediately if present, combining JWT transport with instant revocation safety.

### 15.6 Advanced Questions
8. *What is a Key Confusion Attack against JWTs and how does it compromise security?*
   - Answer: It occurs when a server verifies tokens using a library that accepts both asymmetric (`RS256`) and symmetric (`HS256`) algorithms without strict configuration. An attacker takes the server's publicly known RSA public key, crafts an admin payload, signs it using `HS256` with the public key as the symmetric secret, and sends it. If the server verifies it using the public key with `HS256`, the HMAC check passes, allowing the attacker to forge arbitrary tokens.

---

## 16. Coding Questions

### Problem 1: Implement an In-Memory JWT Revocation Blacklist
**Question**: Write a TypeScript `TokenBlacklist` service that tracks revoked JWTs using their unique `jti` claim and automatically expires blacklisted entries based on the token's original `exp` timestamp.

```typescript
// token-blacklist.ts

export class TokenBlacklist {
  private blacklistedJtis = new Map<string, number>(); // jti -> exp (epoch seconds)

  /**
   * Adds a token's jti to the blacklist.
   */
  public revoke(jti: string, expTimestampSec: number): void {
    const nowSec = Math.floor(Date.now() / 1000);
    // Only store if token is not already naturally expired
    if (expTimestampSec > nowSec) {
      this.blacklistedJtis.set(jti, expTimestampSec);
    }
  }

  /**
   * Checks if a jti is currently revoked.
   */
  public isRevoked(jti: string): boolean {
    const exp = this.blacklistedJtis.get(jti);
    if (!exp) return false;

    const nowSec = Math.floor(Date.now() / 1000);
    if (nowSec >= exp) {
      // Clean up naturally expired entry
      this.blacklistedJtis.delete(jti);
      return false;
    }

    return true;
  }

  /**
   * Periodic garbage collection of expired blacklist entries.
   */
  public cleanup(): void {
    const nowSec = Math.floor(Date.now() / 1000);
    for (const [jti, exp] of this.blacklistedJtis.entries()) {
      if (nowSec >= exp) {
        this.blacklistedJtis.delete(jti);
      }
    }
  }
}

// Verification Test
const blacklist = new TokenBlacklist();
const futureExp = Math.floor(Date.now() / 1000) + 300; // 5 mins in future

blacklist.revoke("jti_abc_123", futureExp);
console.log("Is jti_abc_123 revoked? (expected true):", blacklist.isRevoked("jti_abc_123")); // true
console.log("Is jti_unrelated revoked? (expected false):", blacklist.isRevoked("jti_unrelated")); // false
```

---

## 17. Common Interview Traps

- **Trap 1**: "Can you store user passwords or confidential data in a JWT as long as it's signed?"
  - *Reality*: Absolutely not! A digital signature verifies **integrity**, NOT **confidentiality**. Anyone can base64-decode the payload and read the plain text.
- **Trap 2**: "Does `jwt.decode()` verify the token signature?"
  - *Reality*: No! `jwt.decode()` simply deserializes the base64 string without checking the signature. You MUST use `jwt.verify()` to validate authenticity.
- **Trap 3**: "Can you change the payload of a JWT without invalidating the signature?"
  - *Reality*: No. The signature is computed over `Base64URL(Header) + "." + Base64URL(Payload)`. Mutating even a single bit in the payload produces a completely different hash, breaking verification.

---

## 18. Revision Summary

- **Structure**: `Header.Payload.Signature` (Base64URL encoded).
- **Statelessness**: Decouples auth from central database lookups across microservices.
- **Signing**:
  - `HS256`: Symmetric, single shared secret.
  - `RS256` / `ES256`: Asymmetric, private key to sign, public key to verify (recommended for microservices).
- **Security Essentials**: Always enforce `algorithms: ['RS256']`, validate `iss`/`aud`, keep lifespans short (5-15 mins).
- **Revocation**: Solved via short lifespans + Refresh Tokens + Redis `jti` blacklist.

---

## 19. Quick Reference

```typescript
import jwt from "jsonwebtoken";

// Sign (RS256)
const token = jwt.sign({ sub: user.id, role: user.role }, privateKey, {
  algorithm: "RS256",
  expiresIn: "15m",
  jwtid: crypto.randomUUID(),
});

// Verify (RS256)
const payload = jwt.verify(token, publicKey, {
  algorithms: ["RS256"],
});
```
