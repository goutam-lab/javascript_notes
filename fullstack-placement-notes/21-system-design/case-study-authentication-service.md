# System Design Case Study: Centralized Authentication & Session Management Service

## 1. What is it?
A **Centralized Authentication & Session Service** (Identity and Access Management - IAM) is a mission-critical infrastructure platform responsible for authenticating user identities, issuing cryptographic tokens (JWT / Opaque Bearer tokens), enforcing Single Sign-On (SSO / OAuth2 / OIDC), tracking active sessions across multiple devices, and enabling immediate authorization revocation across a global microservice ecosystem.

Unlike simple monoliths where authentication is handled by a single local cookie parser, a centralized auth service operates as the security gatekeeper for hundreds of downstream microservices, handling millions of requests per second with sub-5ms latency and 99.999% availability.

```
       Global Client Traffic (Web / Mobile / Third-Party)
                              │
                              ▼
┌────────────────────────────────────────────────────────┐
│ Global API Gateway & Edge WAF                          │
│ - Verifies Stateless JWT Signature locally in RAM      │
│   (Zero network calls for valid, unexpired tokens!)    │
└──────────────┬──────────────────────────┬──────────────┘
               │ (Valid JWT)              │ (Expired Token / Refresh)
               ▼                          ▼
┌─────────────────────────┐    ┌─────────────────────────┐
│ Downstream Microservices│    │ Centralized Auth Service│
│ (Orders, Billing, Chat) │    │ - Validates Refresh Tok │
└─────────────────────────┘    │ - Enforces Token Revocat│
                               │ - Issues new Key Pair   │
                               └──────────┬──────────────┘
                                          │
                        ┌─────────────────┴─────────────────┐
                        ▼                                   ▼
          ┌──────────────────────────┐        ┌──────────────────────────┐
          │ Multi-Region Redis Cluster│        │ PostgreSQL Primary &     │
          │ (Active-Active Session   │        │ Multi-AZ Read Replicas   │
          │  Blacklist & Revocation) │        │ (Credentials & User PII) │
          └──────────────────────────┘        └──────────────────────────┘
```

---

## 2. Why does it exist?
Architecting authentication in distributed systems involves balancing security, performance, and operational scalability:

1. **The Distributed Verification Bottleneck**: If every microservice must make a network RPC call to a central Auth Service on every single HTTP request to check if a session is valid, the Auth Service becomes the ultimate bottleneck and single point of failure for the entire company.
2. **The Stateless JWT Invalidation Dilemma**: Stateless JSON Web Tokens (JWTs) eliminate database lookups because any service with the public key can verify them in microseconds. However, **pure stateless JWTs cannot be revoked** on demand. If a user's phone is stolen or an admin revokes an employee's access, an attacker can use the stolen JWT until it expires.
3. **Multi-Device & Session Concurrency**: Users log in from phones, laptops, and smart TVs simultaneously. The system must allow users to view active sessions, see geographic login locations, and execute "Log Out of All Devices" reliably.
4. **Multi-Region Cross-WAN Latency**: Authenticating a user in London against a database in Virginia adds 150ms of cross-Atlantic WAN latency to every single interaction unless session state is replicated globally.

---

## 3. Step 1: Requirements Clarification

### Functional Requirements
1. **User Authentication**: Secure login via email/password, MFA (TOTP), and OAuth2/OIDC social providers (Google, GitHub).
2. **Token Issuance**: Issue short-lived Access Tokens (JWT) and long-lived Refresh Tokens.
3. **Session Management**: Users can view all active logged-in devices and revoke individual sessions or all sessions.
4. **Token Revocation (Blacklisting)**: Support immediate revocation of compromised access tokens.
5. **Authorization Verification**: Downstream microservices must verify access tokens in $< 1\text{ms}$.

### Non-Functional Requirements
1. **High Availability**: 99.999% availability (5 nines). If the auth service is down, the entire company is down.
2. **Low Latency**: Token verification at the API Gateway must take $< 1\text{ms}$; token refresh must take $< 20\text{ms}$.
3. **Cryptographic Security**: Passwords must be hashed using adaptive, memory-hard algorithms (Argon2id or Bcrypt). Private signing keys must be rotated seamlessly via JWKS (JSON Web Key Sets).
4. **Global Data Consistency**: Session revocations must propagate to all geographic regions within 2 seconds.

---

## 4. Step 2: Capacity Estimation & Back-of-the-Envelope Math

Let us establish realistic traffic assumptions:
- **Total Registered Users**: 50 Million.
- **Daily Active Users (DAU)**: 10 Million.
- **Average Active Sessions per User**: 2 devices (Mobile + Laptop) = 20 Million active sessions.
- **API Request Traffic**: 10M DAU make an average of 50 API requests per day = 500 Million requests/day.

### A. Throughput & QPS Calculations
$$\text{Average Verification QPS} = \frac{500,000,000}{86,400 \text{ sec}} \approx \mathbf{5,800 \text{ req/sec}}$$
$$\text{Peak Verification QPS (3x)} \approx \mathbf{17,500 \text{ req/sec}}$$
$$\text{Token Refresh QPS (Access token expires every 15 mins)} = \frac{20,000,000 \text{ sessions}}{900 \text{ sec}} \approx \mathbf{22,000 \text{ refresh QPS}}$$

### B. Storage & Memory Sizing
- **Active Sessions Store (Redis)**:
  - Each session object: `sessionId` (36 bytes) + `userId` (16 bytes) + `refreshTokenHash` (32 bytes) + `deviceMetadata` (150 bytes) $\approx 250$ bytes.
  - 20 Million active sessions:
    $$\text{Session Cache RAM} = 20,000,000 \times 250 \text{ bytes} \approx \mathbf{5 \text{ Gigabytes (GB)}}$$
- **Revoked Token Blacklist Store (Redis)**:
  - Only stores tokens revoked *before* their natural 15-minute expiration time.
  - Assuming 0.1% of tokens are revoked prematurely: $20,000 \text{ tokens} \times 64 \text{ bytes} \approx \mathbf{1.2 \text{ Megabytes}}$ (Negligible!).

---

## 5. Step 3: High-Level Architecture & The Dual-Token Pattern

To achieve sub-millisecond verification without sacrificing revocation capabilities, we use the **Dual-Token Pattern with Asymmetric Cryptography (RS256 / EdDSA)**:

```
┌────────────────────────────────┬────────────────────────────────────────┐
│ Access Token (JWT)             │ Refresh Token (Opaque String)          │
├────────────────────────────────┼────────────────────────────────────────┤
│ - Lifetime: Short (15 minutes) │ - Lifetime: Long (30 days)             │
│ - Storage: In-memory / JS Var  │ - Storage: HttpOnly, Secure, SameSite  │
│ - Format: Signed JWT (Asymm.)  │ - Format: High-entropy crypto UUID     │
│ - Verification: Fully offline  │ - Verification: Stateful lookup in     │
│   by API Gateway using public  │   distributed Redis session store      │
│   key (Zero DB calls!)         │   with automatic token rotation!       │
└────────────────────────────────┴────────────────────────────────────────┘
```

### End-to-End Architectural Diagram
```
[ Web / Mobile Client ]
         │
         ├── 1. POST /api/v1/auth/login ──────► ┌──────────────────────────┐
         │                                      │ Centralized Auth Service │
         │ ◄── 2. Returns Access Token (JWT)    └────────────┬─────────────┘
         │        + Sets Refresh Token Cookie                │
         │                                                   ▼
         │                                      ┌──────────────────────────┐
         │                                      │ PostgreSQL User Ledger   │
         │                                      │ (Argon2id Hashes & MFA)  │
         │                                      └──────────────────────────┘
         │
         │ 3. API Requests (Header: Bearer <JWT>)
         ▼
┌────────────────────────────────────────────────────────┐
│ API Gateway / Ingress Envoy Proxy                      │
│ - Downloads public key from Auth Service JWKS endpoint │
│ - Cryptographically verifies JWT signature locally (<1ms)
│ - Checks local Redis Blacklist (for revoked users)     │
└──────────────┬─────────────────────────────────────────┘
               │ (Valid & Not Revoked)
               ▼
┌────────────────────────────────────────────────────────┐
│ Downstream Microservices (Order, Billing, Inventory)   │
│ - Extracts verified `userId` and `roles` from headers  │
└────────────────────────────────────────────────────────┘
```

---

## 6. Step 4: Deep Dive & Technical Bottlenecks

### Deep Dive 1: Asymmetric Key Signing & JWKS Key Rotation
Never use symmetric HMAC (HS256) where every microservice must know the shared secret. If one microservice is compromised, the attacker can forge admin JWTs for the entire company.
Use **Asymmetric Cryptography (RS256 or Ed25519)**:
- **Private Key**: Kept strictly confidential inside the Auth Service (stored in AWS KMS or HashiCorp Vault). Used only to *sign* tokens.
- **Public Key**: Published on a public endpoint (`/.well-known/jwks.json`).
- Downstream microservices and the API Gateway cache the public key. They verify signatures locally in memory with zero secret-leakage risk.

```json
// GET /.well-known/jwks.json
{
  "keys": [
    {
      "kty": "RSA",
      "use": "sig",
      "kid": "auth-key-2026-v1",
      "n": "u1b2c3d4...long_modulus_string",
      "e": "AQAB",
      "alg": "RS256"
    }
  ]
}
```

---

### Deep Dive 2: Refresh Token Rotation & Automatic Theft Detection
What happens if an attacker intercepts a long-lived Refresh Token?
We enforce **Refresh Token Rotation (RTR)**:
1. Every time a client exchanges a refresh token for a new access token, **the old refresh token is immediately invalidated**, and a brand new refresh token is issued.
2. If an attacker and a legitimate user attempt to use the *same* refresh token twice (a replay attack):
   - The Auth Service detects that an already-used refresh token was submitted.
   - The system assumes the session was compromised and **immediately invalidates the entire refresh token family** (all active sessions for that user), forcing all devices to re-authenticate with their password.

---

### Deep Dive 3: The Hybrid Instant Revocation Strategy
How do you revoke an active 15-minute JWT *instantly* without doing a database lookup on every request?

**The User Token Version (or Epoch) Pattern**:
1. In the database and Redis, each user record maintains an integer: `token_version: 1`.
2. When the user logs in, the JWT payload contains: `{ "sub": "u123", "tokenVersion": 1 }`.
3. If an admin revokes the user's access, or the user clicks "Log out of all devices", the Auth Service increments the version in Redis:
   ```bash
   INCR user:token_version:u123  # Now equals 2
   ```
4. The API Gateway caches user token versions in a high-speed local memory LRU cache. If `jwt.tokenVersion < redis.tokenVersion`, the request is rejected with `HTTP 401 Unauthorized` instantly.

---

### Deep Dive 4: Multi-Region Active-Active Session Synchronization
In a multi-region deployment (US-East, EU-West, AP-South):
- **User Database**: Primary in US-East, asynchronous read replicas in EU and AP.
- **Session Cache**: Deploy **Redis Enterprise Active-Active (CRDT-based)** or AWS ElastiCache Global Datastore.
- When an eviction or password reset occurs in London (EU), the revocation event is replicated across WAN to US and Tokyo in $< 1\text{ second}$ using Conflict-Free Replicated Data Types, ensuring revoked users cannot hop regions to bypass bans.

---

## 7. Important Rules

1. **Never Store Plaintext or Naive MD5/SHA256 Passwords**:
   Always use adaptive, memory-hard hashing algorithms: **Argon2id** (recommended by OWASP) or **Bcrypt** (cost factor 12+). Fast hashes (MD5, SHA-256) can be cracked at billions of guesses per second using modern GPUs.
2. **Store Refresh Tokens in HttpOnly, Secure, SameSite Cookies**:
   Never store long-lived tokens in browser `localStorage` or `sessionStorage` (which are 100% accessible to any Cross-Site Scripting [XSS] attack script). Store them in cookies configured with:
   `HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth/refresh`.
3. **Keep Access Token Payloads Lean**:
   Do not stuff massive user profiles into the JWT payload. Keep it under 500 bytes (`sub`, `roles`, `tokenVersion`, `exp`). A 4KB JWT attached to every HTTP header wastes gigabytes of ingress network bandwidth under high QPS.
4. **Implement Cryptographic Nonces for OAuth2 (State & PKCE)**:
   Always enforce **PKCE (Proof Key for Code Exchange)** for mobile and Single Page Applications to prevent authorization code interception attacks.
5. **Always Set Short Access Token Lifetimes**:
   Access tokens should live between **5 and 15 minutes**. Long-lived access tokens (e.g., 24 hours) leave an unacceptable vulnerability window where revoked credentials continue to work.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Database Query on Every API Request
Making a SQL query `SELECT * FROM users WHERE id = $1` on every single incoming API request just to check if the user exists. At 17,500 QPS, this crushes the relational database. Use stateless JWT signature verification at the Gateway.

### 2. Storing JWT Signing Keys in Git Repositories
Hardcoding `jwt_secret = "my-secret-key"` in code. When the repository is cloned, signing keys leak. Always store private keys in cloud Key Management Services (AWS KMS, GCP Cloud KMS).

### 3. Missing Account Lockout / Rate Limiting on Login
Allowing attackers to run brute-force and credential-stuffing dictionaries against `/api/auth/login`. Protect endpoints with IP-based and username-based rate limits (max 5 failed attempts per 15 minutes) and CAPTCHA challenges.

---

## 9. Best Practices

- **Zero-Downtime Public Key Rotation via JWKS**:
  1. Generate a new key pair (`kid: "2026-v2"`).
  2. Publish the new public key to the JWKS endpoint alongside the old key (`"2026-v1"`).
  3. Wait 24 hours for all microservices to refresh their JWKS cache.
  4. Begin signing new JWTs with `"2026-v2"`.
  5. Remove `"2026-v1"` after all old access tokens have expired.
- **MFA Step-Up Authentication**:
  Require secondary MFA verification (TOTP / WebAuthn) only when sensitive operations occur (e.g., changing password, transferring money, updating bank details).

---

## 10. Performance Considerations

- **V8 Asymmetric Verification Throughput**: Verifying an RSA-256 signature in Node.js takes ~0.2ms of CPU time. To maximize throughput on API Gateways, use **Ed25519 (EdDSA)** signatures: EdDSA verification is 3x faster than RSA and produces signatures half the size (64 bytes vs 256 bytes).

---

## 11. Security Considerations

- **Timing Attack Mitigation**: When validating passwords, always use constant-time string comparison functions (`crypto.timingSafeEqual`) to prevent attackers from determining hash contents by measuring microsecond response time differences.

---

## 12. Authentication Strategy Comparison Matrix

| Strategy | Verification Speed | Revocation Ease | Server State | Best Used For |
| :--- | :--- | :--- | :--- | :--- |
| **Stateful Sessions** (Redis) | Fast (~1ms Redis read)| Instant (`DEL sid`) | Centralized RAM | High-security banking, enterprise internal apps |
| **Pure Stateless JWT** | Instant (<0.01ms CPU)| Impossible until exp | Zero | Simple public APIs with low security sensitivity |
| **Hybrid Dual-Token** (JWT + Rotated Refresh)| Instant (<0.01ms CPU)| Instant via Token Version| Minimal (Versions only)| Production standard for modern fullstack & mobile |

---

## 13. Trade-offs

- **Security vs. Latency (The Revocation Trade-off)**: Pure stateless JWTs offer zero-latency verification, but cannot be revoked on demand. Adding a Redis blacklist or token version check re-introduces a network dependency, but restores immediate security control.
- **Argon2id Cost vs. Login Throughput**: Increasing Argon2id memory and time cost factors makes password hashes uncrackable, but limits a single server node to ~20 login verifications per second per core.

---

## 14. Real-World Usage Case Studies

1. **Netflix Zuul Gateway**: Authenticates incoming traffic at the edge proxy boundary using encrypted internal tokens (Passport pattern). Zuul cryptographically unpacks customer credentials once and passes a trusted, lightweight identity header to internal microservices.
2. **Auth0 / Okta**: Provides multi-tenant identity verification using JWKS rotation, OpenID Connect discovery endpoints, and adaptive anomaly detection (blocking logins from suspicious IP geolocations).

---

## 15. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: What is the purpose of having both an Access Token and a Refresh Token?**
> **Answer**: The **Access Token** is short-lived (e.g., 15 minutes) and contains cryptographic user identity data (JWT) used to access protected resources quickly without database lookups. The **Refresh Token** is long-lived (e.g., 30 days) and stored securely in an `HttpOnly` cookie. It is used exclusively to request a new access token when the current one expires. This minimizes the vulnerability window if an access token is intercepted while maintaining a smooth user experience without repeated password prompts.

### Tier 2: Conceptual
**Q: How does the JSON Web Key Set (JWKS) enable zero-downtime cryptographic key rotation?**
> **Answer**: JWKS is an open standard endpoint (`/.well-known/jwks.json`) that exposes a set of public keys, each labeled with a unique Key ID (`kid`). Downstream services fetch and cache these public keys. When an access token arrives, the verifying service reads the `kid` from the JWT header and selects the matching public key to verify the signature. During rotation, both the old and new public keys are published in the JWKS array simultaneously, allowing services to verify tokens signed by either key without deployment downtime.

### Tier 3: Implementation
**Q: How do you implement Refresh Token Rotation with automatic theft detection?**
*(Refer to Section 16 for full code implementation)*.

### Tier 4: Debugging
**Q: An admin clicks "Ban User", updating the database column `is_banned = true`. However, the banned user continues making authorized API requests and modifying records for the next 14 minutes. Why?**
> **Answer**: The system is using **stateless JWTs** that are verified exclusively by inspecting the cryptographic signature. Because the user's active access token has 14 minutes remaining before expiration, and the API Gateway does not check the database on every request, the token remains valid.
> **Fix**: Implement an in-memory **Token Version Check** or immediate **Revocation Blacklist** in Redis. When the user is banned, publish a revocation event that pushes `banned_users:u123` to Redis with a 15-minute TTL, and have the Gateway reject matching tokens.

### Tier 5: Scenario
**Q: Design the authentication architecture for a multi-tenant B2B SaaS platform supporting Single Sign-On (SSO) via Okta, Google Workspace, and Azure AD.**
> **Answer**:
> 1. Use **SAML 2.0 and OpenID Connect (OIDC)** federated identity protocols.
> 2. When a user inputs their corporate email (`alex@acme.com`), parse the domain (`acme.com`) to look up Acme's configured Identity Provider (IdP) in the tenant database.
> 3. Redirect the user to their corporate IdP with an OAuth2 Authorization Request containing a signed state nonce and PKCE code challenge.
> 4. Upon successful IdP authentication, the IdP returns an authorization code to your redirect URI.
> 5. The Auth Service exchanges the code for the corporate user profile, maps corporate groups to internal roles, creates a session in Redis, and issues your application's internal dual tokens.

### Tier 6: Advanced
**Q: Explain how the "Passport Pattern" works in microservice architectures and why it is superior to passing raw user credentials between internal services.**
> **Answer**:
> In the **Passport Pattern** (used by Netflix and Uber):
> 1. The edge API Gateway terminates external client authentication (verifying cookies or public JWTs).
> 2. The Gateway extracts user metadata, permissions, and tenant context, and packages them into an internal, cryptographically signed token called a **Passport**.
> 3. The Gateway forwards the request to internal microservices with the Passport header (`X-Internal-Passport`).
> 4. Downstream microservices do not need to parse client credentials or call external IAM services; they simply verify the Gateway's internal HMAC/EdDSA signature on the Passport and trust the identity attributes.
> 5. This eliminates redundant authentication checks across internal service hops and prevents internal services from leaking sensitive credential verification logic.

---

## 16. Coding Question: Refresh Token Rotation & Theft Detection Engine in TypeScript

### Problem
Write a production-grade `AuthTokenService` class in TypeScript that implements:
1. `issueTokenPair(userId)`: Generates a JWT access token and records a refresh token family in Redis.
2. `refreshTokenPair(submittedRefreshToken)`: Rotates the refresh token, detecting replay attacks (theft) and invalidating the entire family if a compromised token is reused.

### Solution

```typescript
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import Redis from 'ioredis';

const redis = new Redis();
const JWT_PRIVATE_KEY = 'mock-private-key'; // In production, load from KMS / Vault

interface SessionFamily {
  userId: string;
  activeToken: string;
  compromised: boolean;
}

export class AuthTokenService {
  /**
   * Generates a new Access Token and registers a new Refresh Token Family
   */
  public async issueTokenPair(userId: string): Promise<{ accessToken: string; refreshToken: string }> {
    const accessToken = jwt.sign(
      { sub: userId, type: 'access' },
      JWT_PRIVATE_KEY,
      { expiresIn: '15m' }
    );

    const refreshToken = crypto.randomBytes(32).toString('hex');
    const familyId = crypto.randomUUID();

    const familyData: SessionFamily = {
      userId,
      activeToken: refreshToken,
      compromised: false,
    };

    // Store family in Redis (30-day expiration)
    await redis.set(`auth:family:${familyId}`, JSON.stringify(familyData), 'EX', 86400 * 30);
    // Map current refresh token to its family
    await redis.set(`auth:token_to_family:${refreshToken}`, familyId, 'EX', 86400 * 30);

    return { accessToken, refreshToken };
  }

  /**
   * Rotates Refresh Token with Replay Attack (Theft) Detection
   */
  public async refreshTokenPair(
    submittedRefreshToken: string
  ): Promise<{ accessToken: string; newRefreshToken: string }> {
    // 1. Locate token's family
    const familyId = await redis.get(`auth:token_to_family:${submittedRefreshToken}`);
    if (!familyId) {
      throw new Error('Invalid or expired refresh token');
    }

    const familyRaw = await redis.get(`auth:family:${familyId}`);
    if (!familyRaw) {
      throw new Error('Session family expired');
    }

    const family: SessionFamily = JSON.parse(familyRaw);

    // 2. THEFT DETECTION: If token submitted does NOT match current active token,
    // it was already rotated -> A malicious attacker or replay occurred!
    if (family.activeToken !== submittedRefreshToken) {
      console.error(`[SECURITY ALERT] Replay attack detected for user ${family.userId}! Revoking all sessions.`);
      // Nuke the family immediately
      await redis.del(`auth:family:${familyId}`);
      // Increment global user token version to invalidate all active JWTs immediately
      await redis.incr(`auth:user_version:${family.userId}`);
      throw new Error('SECURITY COMPROMISE: Session revoked due to detected token reuse');
    }

    // 3. Token is valid! Rotate to a brand new refresh token
    const newRefreshToken = crypto.randomBytes(32).toString('hex');
    const newAccessToken = jwt.sign(
      { sub: family.userId, type: 'access' },
      JWT_PRIVATE_KEY,
      { expiresIn: '15m' }
    );

    // Update family with new active token
    family.activeToken = newRefreshToken;
    await redis.set(`auth:family:${familyId}`, JSON.stringify(family), 'EX', 86400 * 30);

    // Point new token to family and invalidate old token pointer
    await redis.set(`auth:token_to_family:${newRefreshToken}`, familyId, 'EX', 86400 * 30);
    await redis.del(`auth:token_to_family:${submittedRefreshToken}`);

    return { accessToken: newAccessToken, newRefreshToken };
  }
}
```

---

## 17. Common Interview Traps

- **Trap 1**: Claiming you can revoke a pure stateless JWT without any shared state.
  *Gotcha*: If a JWT is truly stateless and downstream services only verify the signature, it is mathematically impossible to revoke it before its expiration time without consulting an external blacklist or version store.
- **Trap 2**: Storing passwords using raw SHA-256 or MD5 hashes.
  *Gotcha*: Modern GPUs calculate billions of SHA-256 hashes per second. Always use adaptive, memory-hard algorithms: **Argon2id** or **Bcrypt**.
- **Trap 3**: Confusing Authentication (401 Unauthorized) with Authorization (403 Forbidden).
  *Gotcha*: `401 Unauthorized` means *"I do not know who you are (missing or invalid token)"*. `403 Forbidden` means *"I know who you are, but you do not have permission to access this resource"*.

---

## 18. Revision Summary

- **Dual-Token Architecture**: Short-lived access token (JWT - 15m) verified offline; long-lived refresh token (HttpOnly cookie - 30d) rotated on use.
- **Asymmetric Signing (RS256 / EdDSA)**: Private key in Auth Service signs tokens; public keys distributed via JWKS endpoint for local verification.
- **Theft Detection**: Refresh Token Rotation detects reuse of old tokens and immediately revokes all sessions.
- **Instant Revocation**: Maintain a `token_version` counter in Redis to invalidate all user access tokens instantly without querying the primary database.

---

## 19. Quick Reference

| Component | Technology Choice | Architectural Reason |
| :--- | :--- | :--- |
| **Password Hashing** | Argon2id / Bcrypt | Memory-hard defense against GPU brute force |
| **Access Token** | Asymmetric RS256 / EdDSA JWT | Sub-millisecond offline verification at API Gateway |
| **Refresh Token** | Cryptographic 256-bit Hex String | Stored in `HttpOnly; Secure; SameSite` cookies |
| **Key Distribution**| `/.well-known/jwks.json` | Zero-downtime public key rotation |
| **Session Cache** | Redis Cluster (`allkeys-lru`)| Sub-5ms session lookups and immediate revocation |
| **Primary DB** | PostgreSQL (Multi-AZ) | ACID durability for credentials and MFA secrets |
