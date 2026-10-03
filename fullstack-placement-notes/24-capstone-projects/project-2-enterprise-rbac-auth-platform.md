# Capstone Project 2: Enterprise RBAC Authentication & IAM Platform

## 1. What is it?
An **Enterprise Identity & Access Management (IAM) Platform** (such as Auth0, Okta, or Keycloak) is a centralized, secure authentication and authorization infrastructure platform responsible for verifying user identities, issuing cryptographically signed tokens, rotating credentials, enforcing granular permissions, and maintaining immutable security audit trails.

In senior full-stack placement interviews, this capstone project demonstrates deep mastery of web security, cryptography, and enterprise access control. It implements:
1. **Dual-Token Architecture with Automatic Rotation**: Short-lived Access Tokens (JWT, 15-minute lifespan) paired with single-use, rotating Refresh Tokens (stored in secure `HttpOnly`, `SameSite=Strict` cookies).
2. **Refresh Token Theft Detection**: If an attacker intercepts and attempts to reuse an already-invalidated refresh token, the system detects the anomaly, immediately revokes the entire token family, and terminates all active user sessions across all devices.
3. **Granular Role-Based & Attribute-Based Access Control (RBAC / ABAC)**: Decoupling users from raw permissions through roles (`SuperAdmin`, `BillingManager`, `Viewer`), evaluated at runtime using bitwise or relational permission matrices.
4. **Immutable Security Audit Logging**: Recording every login, token issuance, role change, and access denial for regulatory compliance (SOC2, HIPAA, ISO 27001).

```
                   DUAL TOKEN ROTATION & THEFT DETECTION FLOW
                   
 [ Client Browser ]                                        [ Auth Server ]
         │ 1. POST /api/v1/auth/refresh (Sends RefreshToken #1)   │
         ├───────────────────────────────────────────────────────►│
         │                                                        │
         │                                       Validate Token in Database:
         │                                       Is Token #1 already USED?
         │                                                        │
         │                        ┌───────────────────────────────┴───────────────────────────────┐
         │                        ▼ NO (Legitimate Request)                                       ▼ YES (THEFT DETECTED!)
         │             • Mark Token #1 as "USED"                                       🚨 BREACH DETECTED:
         │             • Generate Token #2 (Fresh Refresh Token)                       • Attacker reused old token!
         │             • Issue new Access Token (JWT)                                  • Revoke ALL tokens for User!
         │ 2. Set-Cookie: RefreshToken #2 (Single-Use)                                 • Blacklist active JWTs in Redis
         │◄───────────────────────────────────────────────────────┤                    • Write critical audit log alert
         │                                                        │◄───────────────────┘
```

---

## 2. Why does it exist?
Authentication is the highest-stakes component of any software system. Naive implementations lead to catastrophic enterprise security breaches:

1. **The Long-Lived JWT Dilemma**: If a JWT is valid for 30 days and an attacker steals it (via XSS or network snooping), the attacker has unrestricted access for 30 days. JWTs are stateless; traditional servers cannot revoke them without querying a database on every request.
2. **Missing Token Theft Detection**: If a refresh token is stolen, both the legitimate user and the attacker can refresh tokens indefinitely. Without automatic family rotation and theft detection, token compromise goes completely unnoticed.
3. **Hardcoded Role Checks**: Writing `if (user.role === 'admin')` throughout application controllers is brittle. If the business introduces a `BillingAdmin` who can view invoices but not delete users, the entire application requires extensive code refactoring. True enterprise systems evaluate fine-grained **Permissions** (`users:delete`, `invoices:read`), not roles.
4. **Compromised Audit Trails**: If an administrator's account is hijacked and customer records are exported, regulators require proof of *who* performed the action, from *what IP*, with *what user-agent*, at the exact microsecond.

---

## 3. Mental Model
Think of enterprise IAM like a high-security international airport:
- **Your Passport** is your credentials (email + password + 2FA): verified only once at check-in.
- **The Boarding Pass** is the **Access Token (JWT)**: valid for only 15 minutes. You show it at security gates to board the plane quickly without waiting in line for a full passport check.
- **The Baggage Claim Voucher** is the **Refresh Token**: single-use. When your boarding pass expires, you exchange the voucher for a fresh boarding pass. If someone else shows up with a photocopy of an already-claimed voucher, security alarms sound immediately, grounding all flights associated with your ticket (Theft Detection).

---

## 4. Basic Example: Naive Role Check vs. Granular Permission Guard

```typescript
// ❌ NAIVE APPROACH: Hardcoded Role Checking (Brittle & Inflexible)
app.delete('/api/users/:id', authenticate, (req, res) => {
  if (req.user.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Only admins can delete users' });
  }
  // What happens if we introduce a "moderator" role tomorrow? Code refactor required!
  deleteUser(req.params.id);
});
```

```typescript
// ✅ PRODUCTION PATTERN: Granular RBAC Permission Guard
// Decouples roles from permissions; roles can be reconfigured dynamically in DB!
app.delete('/api/users/:id', 
  authenticate, 
  requirePermission('users:delete'), 
  (req, res) => {
    deleteUser(req.params.id);
  }
);
```

---

## 5. Real Example: Enterprise Relational Schema & Token Rotation Engine

### A. Production PostgreSQL Schema (`schema.sql`)
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users Table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL, -- Argon2id hash
    is_active BOOLEAN NOT NULL DEFAULT true,
    token_version INT NOT NULL DEFAULT 1, -- Incremented to invalidate all active JWTs!
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Permissions (Atomic system actions)
CREATE TABLE permissions (
    id VARCHAR(64) PRIMARY KEY, -- e.g., 'billing:read', 'users:delete'
    description TEXT NOT NULL
);

-- 3. Roles
CREATE TABLE roles (
    id VARCHAR(64) PRIMARY KEY, -- e.g., 'SUPER_ADMIN', 'MEMBER'
    description TEXT
);

-- 4. Role-Permission Mapping (Many-to-Many)
CREATE TABLE role_permissions (
    role_id VARCHAR(64) REFERENCES roles(id) ON DELETE CASCADE,
    permission_id VARCHAR(64) REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- 5. User-Role Mapping (Many-to-Many)
CREATE TABLE user_roles (
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id VARCHAR(64) REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- 6. Refresh Tokens Table (Enforces Single-Use Rotation & Theft Detection)
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_family UUID NOT NULL, -- Groups all tokens in a rotation lineage
    token_hash VARCHAR(64) NOT NULL, -- SHA-256 hash of random token string
    is_revoked BOOLEAN NOT NULL DEFAULT false,
    is_used BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens (token_hash);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (token_family);

-- 7. Immutable Security Audit Log
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(64) NOT NULL, -- 'LOGIN_SUCCESS', 'TOKEN_THEFT_DETECTED', etc.
    ip_address INET NOT NULL,
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_audit_logs_user ON audit_logs (user_id, created_at DESC);
```

---

## 6. Under the Hood: Token Rotation & Theft Detection Mechanics

### The Token Family Rotation Algorithm
```
1. Client logs in ──► Server creates Token Family A, generates RefreshToken 1.
2. Client refreshes ──► 
   - Server checks DB: Is Token 1 used? (NO)
   - Server marks Token 1 as `is_used = true`.
   - Server generates RefreshToken 2 (same Family A) and returns it.
3. Attacker intercepts Token 1 and attempts to refresh ──►
   - Server checks DB: Is Token 1 used? (YES!)
   - 🚨 CRITICAL ALERT: Token 1 was already used; legitimate user must have Token 2!
   - Server immediately executes:
     `UPDATE refresh_tokens SET is_revoked = true WHERE token_family = 'Family A'`
     `UPDATE users SET token_version = token_version + 1 WHERE id = userId`
   - All tokens in Family A are dead. Both attacker and user are locked out, prompting 2FA re-verification.
```

---

## 7. Important Rules

1. **Store Refresh Tokens Strictly in `HttpOnly`, `SameSite=Strict` Cookies**:
   Never store refresh tokens in browser `localStorage` or `sessionStorage`. Any Cross-Site Scripting (XSS) vulnerability allows malicious scripts to read `localStorage` and steal credentials. `HttpOnly` cookies are inaccessible to JavaScript.
2. **Keep Access Tokens Short-Lived (10–15 Minutes)**:
   Access tokens are stateless and cannot be easily revoked without querying Redis on every request. Short lifespans limit the window of vulnerability if a token is intercepted.
3. **Use Password Hashing with Argon2id**:
   Never use MD5, SHA-256, or plain Bcrypt for enterprise passwords. Use **Argon2id** (winner of the Password Hashing Competition), which provides parameterized memory-hard and time-hard defenses against GPU-based cracking attacks.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Storing Sensitive Permissions Inside the JWT Payload
Embedding all permissions (`permissions: ['users:read', 'billing:write']`) inside the JWT.
**Why it fails**: If an administrator revokes a user's permissions, the user continues to execute privileged actions until their 15-minute JWT expires! 
**Fix**: Keep only the `userId` and `tokenVersion` inside the JWT payload. Cache user permissions in **Redis** with a 60-second TTL, allowing instant permission revocations across the fleet.

### 2. Failing to Hash Stored Refresh Tokens
Storing raw refresh token strings directly in the database. If an attacker gains read access to the database via SQL injection, they steal every active user session in the organization. Always store **SHA-256 hashes** of refresh tokens.

---

## 9. Best Practices

- **Token Version Blacklisting**: Include a `tokenVersion` integer in the JWT payload. When an employee is terminated or reports a stolen device, increment `users.token_version = token_version + 1` in the database. Any existing JWT presented with an older token version is rejected immediately by the authentication middleware.
- **Structured Audit Logging**: Emit structured JSON events to an immutable append-only audit table recording all sensitive security actions:
  ```typescript
  await auditLog({
    action: 'USER_ROLE_CHANGED',
    actorId: req.user.id,
    targetId: targetUser.id,
    changes: { oldRole: 'MEMBER', newRole: 'ADMIN' },
    ip: req.ip,
  });
  ```

---

## 10. Performance Considerations

- **Redis In-Memory Permission Caching**: Evaluating database joins across `users -> user_roles -> role_permissions -> permissions` on every HTTP request adds 15ms of latency. Cache user permission arrays in Redis (`SET permissions:user_42 "['users:read','orders:create']" EX 300`) to evaluate authorization in $< 1\text{ms}$.
- **Asynchronous Audit Logging**: Do not block user HTTP responses waiting for audit log database writes. Publish audit events to a background BullMQ queue or Kafka topic for asynchronous ingestion.

---

## 11. Security Considerations

- **Brute Force Protection via Account Lockout**: Track consecutive failed login attempts in Redis (`INCR failed_login:user@example.com`). After 5 failed attempts within 10 minutes, lock the account for 15 minutes or require email OTP confirmation.
- **Strict CORS & CSRF Defense**: When using `HttpOnly` cookies for token exchange, enforce `SameSite=Strict` and validate anti-CSRF custom headers (`X-Requested-With` or custom tokens) to eliminate Cross-Site Request Forgery attacks.

---

## 12. Alternatives

| Authorization Paradigm | Flexibility | Performance | Complexity |
|---|---|---|---|
| **Hardcoded Role Checking** | Very Low | High | Minimal (Brittle anti-pattern) |
| **RBAC (Role-Based)** | Medium | **High** | Medium (Industry Standard) |
| **ABAC (Attribute-Based)** | **Maximum** (Context-aware: time, IP, owner)| Lower (Complex rule engine) | High |
| **ReBAC (Relationship-Based: Google Zanzibar)** | High (Social graph permissions) | High | Very High |

---

## 13. Trade-offs

- **Stateless JWTs vs. Revocation Control**:
  Pure stateless JWTs eliminate database lookups, but cannot be instantly revoked. Adding a `tokenVersion` or Redis session blacklist restores instant revocation control, but introduces a lightweight in-memory cache lookup on every request. This is the optimal industry trade-off.

---

## 14. Real-World Usage & Implementation Example: Complete Token Rotation Service

```typescript
// auth-service.ts
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-12345';
const ACCESS_TOKEN_EXPIRY = '15m';

export class AuthService {
  private db: Pool;

  constructor(dbPool: Pool) {
    this.db = dbPool;
  }

  /**
   * Generates short-lived Access Token (JWT)
   */
  generateAccessToken(userId: string, tokenVersion: number): string {
    return jwt.sign(
      { sub: userId, version: tokenVersion },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );
  }

  /**
   * Generates single-use Refresh Token and registers in DB
   */
  async createRefreshToken(userId: string, existingFamily?: string) {
    const rawToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const tokenFamily = existingFamily || crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.db.query(
      `INSERT INTO refresh_tokens (user_id, token_family, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [userId, tokenFamily, tokenHash, expiresAt]
    );

    return { rawToken, tokenFamily, expiresAt };
  }

  /**
   * Handles Token Refresh with Automatic Theft Detection
   */
  async rotateRefreshToken(rawToken: string, ip: string, userAgent: string) {
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const result = await this.db.query(
      `SELECT * FROM refresh_tokens WHERE token_hash = $1`,
      [tokenHash]
    );

    if (result.rows.length === 0) {
      throw new Error('Invalid refresh token');
    }

    const tokenRecord = result.rows[0];

    // 🚨 THEFT DETECTION: Was this token already used?
    if (tokenRecord.is_used) {
      console.error(`🚨 [TOKEN THEFT DETECTED]: Token family ${tokenRecord.token_family} compromised!`);

      // 1. Revoke the entire token family immediately!
      await this.db.query(
        `UPDATE refresh_tokens SET is_revoked = true WHERE token_family = $1`,
        [tokenRecord.token_family]
      );

      // 2. Invalidate all active JWTs by bumping user's token_version
      await this.db.query(
        `UPDATE users SET token_version = token_version + 1 WHERE id = $1`,
        [tokenRecord.user_id]
      );

      // 3. Record Critical Security Audit Log
      await this.db.query(
        `INSERT INTO audit_logs (user_id, action, ip_address, user_agent, metadata)
         VALUES ($1, 'CRITICAL_TOKEN_THEFT_DETECTED', $2, $3, $4)`,
        [tokenRecord.user_id, ip, userAgent, JSON.stringify({ compromisedFamily: tokenRecord.token_family })]
      );

      throw new Error('Security breach detected: Refresh token already used. All sessions terminated.');
    }

    // Check expiration or revocation
    if (tokenRecord.is_revoked || new Date() > new Date(tokenRecord.expires_at)) {
      throw new Error('Refresh token has expired or been revoked');
    }

    // Mark current token as USED
    await this.db.query(
      `UPDATE refresh_tokens SET is_used = true WHERE id = $1`,
      [tokenRecord.id]
    );

    // Fetch user token version
    const userRes = await this.db.query('SELECT token_version FROM users WHERE id = $1', [tokenRecord.user_id]);
    const tokenVersion = userRes.rows[0].token_version;

    // Issue fresh Access Token and fresh Refresh Token in same family
    const newAccessToken = this.generateAccessToken(tokenRecord.user_id, tokenVersion);
    const newRefreshToken = await this.createRefreshToken(tokenRecord.user_id, tokenRecord.token_family);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken.rawToken,
    };
  }
}
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: What is the purpose of using a Refresh Token alongside an Access Token?
**Answer**:
An Access Token is short-lived (10–15 minutes) and contains signed identity claims. Because it is stateless, verifying it requires zero database lookups, making API calls fast. However, if stolen, it cannot be easily revoked. 
A **Refresh Token** is long-lived (7–30 days) and stored securely in an `HttpOnly` cookie. Its sole responsibility is to obtain a new Access Token when the old one expires. By keeping the Access Token short-lived and managing Refresh Tokens in a centralized database, the system minimizes the window of vulnerability while maintaining the ability to revoke compromised sessions instantly.

### 2. Conceptual: How does Refresh Token Theft Detection work?
**Answer**:
The system enforces **Single-Use Token Rotation** within a **Token Family**:
1. When a client refreshes their session, the presented Refresh Token is marked as `used`, and a new token in the same lineage (family) is issued.
2. If an attacker intercepts the first token and later attempts to use it, the database detects that a token with `is_used = true` was presented.
3. This guarantees that either the legitimate user or an attacker is presenting a duplicate token.
4. The system triggers an immediate security alert: it revokes the **entire token family**, increments the user's `token_version` (invalidating all active JWTs), and forces the user to log in again with multi-factor authentication.

### 3. Implementation: How do you enforce Role-Based Access Control (RBAC) in Express middleware?
**Answer**:
1. Define a middleware factory: `requirePermission(requiredPermission: string)`.
2. The authentication middleware extracts `req.user.id` from the validated JWT.
3. The RBAC middleware checks the user's cached permission array in Redis (`permissions:user_id`).
4. If the cache misses, query PostgreSQL joining `user_roles` and `role_permissions`.
5. If `userPermissions.includes(requiredPermission)`, call `next()`. If not, return **HTTP 403 Forbidden**.

### 4. Debugging: A user changed their password, but their old mobile app session remained logged in for days. What was missing?
**Answer**:
The application lacked a **Token Invalidation Mechanism**:
1. Changing a password must immediately invalidate all existing Access Tokens and Refresh Tokens.
2. In the database, the password reset transaction must:
   - Increment `token_version` on the `users` record (`UPDATE users SET token_version = token_version + 1`).
   - Revoke all active refresh tokens (`UPDATE refresh_tokens SET is_revoked = true WHERE user_id = $1`).
3. When the mobile app presents its old JWT, the auth middleware compares the JWT's `version` claim against the database/Redis `token_version`. Because the versions no longer match, the request is rejected with `401 Unauthorized`.

### 5. Scenario: Why should you avoid storing JWT tokens in browser `localStorage`?
**Answer**:
`localStorage` has zero security isolation from JavaScript code running on the same origin. If your application or any third-party NPM dependency (such as an analytics script or UI widget) suffers a **Cross-Site Scripting (XSS)** vulnerability, an attacker can execute `localStorage.getItem('token')` and exfiltrate the user's credentials to an external server. 
Storing tokens in **`HttpOnly` cookies** ensures that the browser automatically transmits the cookie in HTTP requests, but client-side JavaScript has zero programmatic access to the token, completely neutralizing token theft via XSS.

### 6. Advanced: What is the difference between RBAC and ABAC, and when would you migrate to ABAC?
**Answer**:
- **RBAC (Role-Based Access Control)**: Permissions are mapped to static roles (e.g., `Editor` has `document:edit`). Access decisions depend solely on *who* the user is.
- **ABAC (Attribute-Based Access Control)**: Evaluates dynamic attributes and contextual conditions at evaluation time:
  - Subject attributes (user department, clearance).
  - Resource attributes (document owner, document classification).
  - Contextual environment attributes (current time, user IP, device location).
- **When to migrate**: Migrate when business rules require context: e.g., *"A manager can only approve expense reports for employees in their own department, during business hours, and only if the amount is under $10,000."* RBAC causes a "role explosion" under these rules; ABAC evaluates them cleanly.

---

## 16. Coding Questions & Practical Challenges

1. **Permission Guard Middleware**: Write a TypeScript Express middleware factory that accepts an array of permissions and validates that the authenticated user possesses *all* specified permissions before proceeding.
2. **Argon2 Password Hasher**: Implement a secure password service in Node.js using `argon2` that hashes passwords with recommended OWASP memory cost parameters and verifies passwords with constant-time equality checks.
3. **Audit Log Inserter with IP Extraction**: Write a helper function that extracts client IP from `X-Forwarded-For`, normalizes IPv6 loopback addresses, and inserts a security audit event into PostgreSQL.

---

## 17. Common Interview Traps

- **Trap 1: Checking roles instead of permissions**: Interviewers consider hardcoding `if (role === 'admin')` an anti-pattern. Always demonstrate understanding that roles are simply bundles of atomic permissions.
- **Trap 2: Forgetting to handle database cleanup for expired refresh tokens**: Over months, a `refresh_tokens` table accumulates millions of expired rows. Set up an automated daily cron job or partition by month to drop expired tokens.
- **Trap 3: Generating JWT secrets with low entropy**: Using a weak string like `JWT_SECRET="secret"` allows attackers to brute-force the HMAC-SHA256 signature offline using tools like Hashcat in seconds. Always use a 256-bit cryptographically random secret (`crypto.randomBytes(32).toString('hex')`).

---

## 18. Revision Summary

- **Dual-Token Architecture**: Short-lived JWT Access Token (15m) + single-use Refresh Token in `HttpOnly` cookie (7d).
- **Theft Detection**: Reuse of an already-used refresh token revokes the entire token family and terminates all active sessions.
- **Granular RBAC**: Decouple users from permissions via intermediate roles; cache permissions in Redis for sub-millisecond evaluation.
- **Instant Revocation**: Use a `token_version` on the user record to invalidate all active JWTs instantly on password resets or account lockouts.

---

## 19. Quick Reference Cheatsheet

```typescript
// Essential Cookie Flags for Refresh Tokens
res.cookie('refreshToken', token, {
  httpOnly: true, // Prevents JavaScript XSS access
  secure: true,   // Transmitted exclusively over HTTPS
  sameSite: 'strict', // Neutralizes CSRF attacks
  path: '/api/v1/auth/refresh', // Restricts cookie transmission to refresh route
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
});

// Argon2id Recommended OWASP Parameters
import argon2 from 'argon2';
const hash = await argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,       // 3 iterations
  parallelism: 4,
});
```
