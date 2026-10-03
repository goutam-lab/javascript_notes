# Project 2: Multi-Tenant RBAC & Auth Platform Defense Guide

## 1. What is it?
The **Multi-Tenant Role-Based Access Control (RBAC) & Enterprise Authentication Platform** (Clerk/WorkOS/Auth0 style) is a production-grade identity and access management (IAM) service. It provides secure multi-tenant organization isolation, granular permissions-based authorization (RBAC/ABAC), multi-factor authentication (TOTP via RFC 6238), refresh token rotation with reuse detection, and immutable audit logging for enterprise SOC 2 compliance.

In placement interviews, candidates present this project to demonstrate:
- Advanced cryptographic authentication workflows (Argon2id, asymmetric RS256 JWTs, TOTP).
- Multi-tenancy database isolation strategies and tenant leakage prevention.
- High-performance authorization middleware capable of sub-millisecond permission checks.
- Resilient session management and token lifecycle revocation architectures.

```
       MULTI-TENANT ENTERPRISE AUTHENTICATION PIPELINE
       
   Client App                               API Gateway / Auth Service
       │                                                │
   1.  │ ── POST /api/auth/login { email, pass } ────►  │
       │                                                │ ── 1. Hash check (Argon2id)
       │                                                │ ── 2. Read Tenant Roles & Permissions
       │                                                │ ── 3. Check TOTP MFA status
       │                                                │ ── 4. Generate Asymmetric RS256 JWT
       │                                                │ ── 5. Issue Rotating Refresh Token
       │                                                │
   2.  │ ◄── Set-Cookie: refresh_token (HttpOnly) ───── │
       │     Body: { access_token (15m), user, org }    │
       │                                                │
   3.  │ ── GET /api/org/projects (Bearer JWT) ───────► │
       │                                                │ ── 1. Verify RS256 Signature (Public Key)
       │                                                │ ── 2. Check Redis Revocation Blocklist
       │                                                │ ── 3. Enforce Tenant & Permission Match
       │                                                │
       │ ◄── 200 OK (Tenancy-Isolated Query Result) ─── │
```

---

## 2. Why does it exist?
Enterprises demand secure boundaries:
1. **Tenant Data Isolation:** A bug must never allow Customer A to read Customer B's records (**Tenant Leakage**).
2. **Granular Privileges:** Simple "Admin vs. User" flags fail when enterprise customers require custom roles (e.g. "Billing Admin", "Read-Only Auditor", "DevOps Engineer").
3. **Regulatory Compliance (SOC 2, HIPAA, GDPR):** Mandates multi-factor authentication, cryptographic audit trails, and instant session revocation.

---

## 3. Mental Model
Think of the system as an **Ultra-Secure Enterprise Office Skyscraper**:

```
                       OFFICE SKYSCRAPER ANALOGY
                       
  [ The Building (The Multi-Tenant Application) ]
     - Houses 500 different independent corporate companies (Tenants / Orgs).
     
  [ The Ground Floor Security Gate (Authentication Layer) ]
     - Verifies passport & password, scans fingerprint (MFA).
     - Issues a 15-minute temporary visitor badge (Access Token).
     - Records entry in the master visitor logbook (Audit Trail).
     
  [ Floor Security Turnstiles (Authorization Layer - RBAC) ]
     - Company B's employees can NEVER open the elevator doors to Company A's floor
       (Tenant Isolation).
     - Within Company A, only executives can enter the Boardroom (Permission Guard).
```

---

## 4. Basic Example: RBAC vs ABAC Data Model

### Relational Schema for Granular RBAC
```sql
-- 1. Organizations (Tenants)
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Permissions (Atomic capabilities)
CREATE TABLE permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(100) UNIQUE NOT NULL -- e.g. 'project:create', 'billing:view'
);

-- 3. Roles (Scoped to Organization)
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  UNIQUE(organization_id, name)
);

-- 4. Role Permissions (Many-to-Many)
CREATE TABLE role_permissions (
  role_id UUID REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- 5. User Organization Memberships
CREATE TABLE memberships (
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  role_id UUID REFERENCES roles(id),
  PRIMARY KEY (user_id, organization_id)
);
```

---

## 5. Real Example: Multi-Tenant Row-Level Security (RLS) in PostgreSQL

The most robust way to prevent tenant data leakage is database-enforced **Row-Level Security (RLS)**. Even if an engineer writes a buggy query missing `WHERE tenant_id = ...`, PostgreSQL automatically filters rows.

```sql
-- 1. Enable RLS on core tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- 2. Create the RLS Policy using PostgreSQL session context
CREATE POLICY tenant_isolation_policy ON projects
FOR ALL
USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
```

### Express Middleware Setting Tenant Session Context
```typescript
import { Request, Response, NextFunction } from 'express';
import { pool } from '../db';

export async function tenantContextMiddleware(req: Request, res: Response, next: NextFunction) {
  const tenantId = (req as any).user?.tenantId;

  if (!tenantId) {
    return res.status(401).json({ error: 'Tenant context missing from token' });
  }

  // Acquire dedicated client from connection pool
  const client = await pool.connect();

  try {
    // Set transaction-local session variable for RLS
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [tenantId]);
    
    // Attach client to request for query execution
    (req as any).dbClient = client;

    res.on('finish', () => {
      client.release(); // Return client to pool after response
    });

    next();
  } catch (err) {
    client.release();
    next(err);
  }
}
```

---

## 6. Under the Hood: RFC 6238 TOTP (Time-Based One-Time Password)

```
                 HOW GOOGLE AUTHENTICATOR (TOTP) WORKS
                 
  Shared Secret (e.g., "KZXW633PN5XW6MZR")
         │
         ├── 1. Get Current Unix Time in Seconds (t)
         ├── 2. Calculate 30-Second Time Step: T0 = Math.floor(t / 30)
         │
         ▼
  HMAC-SHA1(Secret, T0) ──► Generates 20-Byte Hash
         │
         ▼  Dynamic Truncation
  Extract 4-Byte Binary Code ──► 0x3F8821B
         │
         ▼  Modulo 1,000,000
  Result: 6-Digit Code (e.g. 748291)
  
  Both the user's phone and your backend compute this independently!
  No internet or SMS connection required!
```

---

## 7. Important Rules

1. **Hash Passwords with Argon2id or bcrypt:** Never use plain MD5, SHA-256, or SHA-512. Argon2id is the winner of the Password Hashing Competition and provides memory-hard protection against GPU brute-forcing.
2. **Rotate Refresh Tokens on Every Use:** Invalidate the submitted refresh token immediately upon issuance of a new pair. If a revoked token is used, trigger **Reuse Detection** and revoke all tokens for that user.
3. **Never Query Without Tenant Id:** Every table in a shared-database multi-tenant system must have an indexed `tenant_id` column.

---

## 8. Common Mistakes

- **Mistake 1:** Encoding all user permissions directly into the JWT. If a user has 100 permissions, the token exceeds the 8KB HTTP header limit. Instead, encode only role names or fetch permissions via Redis cache.
- **Mistake 2:** Relying on frontend visibility flags for security (e.g. hiding the "Delete" button instead of checking permissions in the backend API).
- **Mistake 3:** Failing to enforce tenant ID checks on foreign keys during updates (IDOR).

---

## 9. Best Practices

1. **Asymmetric Key Pairs (RS256 / EdDSA):** Sign tokens with a Private Key on the Auth Service; internal microservices verify tokens using only the Public Key without needing database lookups.
2. **Immutable Audit Logs:** Log all authentication, role changes, and permission modifications to an append-only audit table containing `actor_id`, `action`, `tenant_id`, `ip_address`, and `timestamp`.
3. **Pre-Computed Permissions in Redis:** Cache active user permission sets in Redis with a 15-minute TTL, invalidating the cache immediately on role modifications.

---

## 10. Performance Considerations

| Component | Architecture | Latency |
|---|---|---|
| **JWT Verification** | RS256 Verification in memory via cached Public Key | < 0.2ms |
| **Permission Check** | In-Memory Bitwise Mask or Redis Set Check (`SISMEMBER`) | < 1ms |
| **Password Verification** | Argon2id (Memory: 64MB, Iterations: 3) | ~150ms (Intentionally slow) |

---

## 11. Security Considerations
- **Timing Attacks on Password Comparison:** Always use constant-time comparison (`crypto.timingSafeEqual`) when validating secrets or HMAC signatures.
- **Session Fixation:** Regenerate session IDs and tokens upon successful login to prevent fixation attacks.

---

## 12. Alternatives
1. **Casbin / Permit.io / Ory Kratos:** Third-party open-source authorization engines.
2. **Database-per-Tenant:** Maximum physical isolation for high-security enterprise tiers, at the cost of infrastructure complexity.

---

## 13. Trade-offs

| Multi-Tenancy Strategy | Isolation Level | Cost & Maintenance | Scalability |
|---|---|---|---|
| **Shared DB, Shared Schema (RLS)** | High (Enforced by DB) | Low (Single DB pool) | High (Supports 100k+ orgs) |
| **Shared DB, Schema-per-Tenant** | Very High | Moderate (Schema migration overhead) | Medium (Postgres catalog limit) |
| **Database-per-Tenant** | Physical Isolation | High (Huge connection overhead) | Low (Complex operations) |

---

## 14. Real-World Usage
- **Slack & Notion:** Multi-tenant workspace architecture where a single user account can join hundreds of organizations with different roles in each.
- **AWS IAM:** The canonical enterprise implementation of RBAC combined with ABAC policy documents.

---

## 15. Placement Interview Questions (Defense & System Design)

### Basic
1. *What is the difference between Authentication (AuthN) and Authorization (AuthZ)?*
   - **Answer:** Authentication is verifying *who* you are (identity verification via email/password, TOTP). Authorization is determining *what* you are allowed to do (permissions and privileges on specific resources).

### Conceptual
2. *Why did you choose Shared Database with Row-Level Security over Database-per-Tenant?*
   - **Answer:** Shared Database with RLS provides the best balance of cost efficiency, easy schema migrations, and connection pool sharing, while PostgreSQL's kernel-level RLS policies eliminate the risk of accidental cross-tenant data leakage.

### Implementation
3. *How does your system handle instant token revocation if JWTs are stateless?*
   - **Answer:** We keep access token lifespans short (15 minutes). For emergency revocation (e.g. password reset or account compromise), we store a `token_version` integer on the user record and in the JWT. If the version in the JWT doesn't match the version in the database or Redis cache, the token is rejected immediately.

### Debugging
4. *A customer reports that a removed employee can still access the API for 10 minutes. How do you explain and fix this?*
   - **Answer:** This occurs because the stateless JWT access token remains cryptographically valid until its 15-minute expiration. To fix, write the user's `userId` to a Redis revocation blocklist on account removal, and check this Redis blocklist in the authentication middleware.

### Scenario
5. *Design the schema and logic for an enterprise customer requesting custom roles.*
   - **Answer:** (See Section 4). Create an atomic `permissions` table. Allow organizations to define custom rows in `roles` scoped to their `organization_id`, and map any combination of permissions to their custom role via `role_permissions`.

---

## 16. Coding Questions

### Problem: High-Performance Permission Guard Middleware
Write a TypeScript middleware function verifying that the requesting user has the required permission within their active tenant.

```typescript
import { Request, Response, NextFunction } from 'express';

export function requirePermission(permissionKey: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = (req as any).user;

    if (!user) {
      return res.status(401).json({ error: 'Unauthenticated' });
    }

    // Admins bypass all specific permission checks
    if (user.role === 'SUPER_ADMIN' || user.permissions?.includes('*')) {
      return next();
    }

    const hasPermission = user.permissions && user.permissions.includes(permissionKey);

    if (!hasPermission) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Missing required permission: ${permissionKey}`
      });
    }

    next();
  };
}
```

---

## 17. Common Interview Traps
- **Trap 1:** Assuming multi-tenancy can be implemented safely with just application-level `WHERE org_id = ...`.
  *Reality:* One forgotten `WHERE` clause in a complex JOIN query leaks data between competitors. Always use Row-Level Security (RLS) as a defense-in-depth safeguard.
- **Trap 2:** Sending TOTP secrets to the client on every request.
  *Reality:* The TOTP secret must be encrypted at rest in the database and only shown once via QR code during initial registration.

---

## 18. Revision Summary
- **Multi-Tenancy:** Shared database with PostgreSQL Row-Level Security (RLS) guarantees tenant boundaries.
- **RBAC Schema:** Organizations $\rightarrow$ Roles $\rightarrow$ Permissions $\rightarrow$ Memberships.
- **Tokens:** Short-lived RS256 JWTs paired with rotating refresh tokens in `HttpOnly` cookies.
- **MFA:** RFC 6238 TOTP using HMAC-SHA1 and 30-second time steps.

---

## 19. Quick Reference

```
┌─────────────────────────────────┬───────────────────────────────────────────────┐
│ SECURITY LAYER                  │ BEST PRACTICE SPECIFICATION                   │
├─────────────────────────────────┼───────────────────────────────────────────────┤
│ Password Hashing                │ Argon2id (Memory-hard, GPU resistant)         │
│ Token Signing                   │ RS256 (Private key signs, Public key verifies)│
│ Multi-Tenant Isolation          │ PostgreSQL Row-Level Security (RLS)           │
│ MFA Implementation              │ RFC 6238 Time-Based One-Time Password (TOTP)  │
│ Refresh Token Security          │ Rotation + Automatic Reuse Invalidation       │
│ Audit Logging                   │ Append-only immutable table with actors & IP  │
└─────────────────────────────────┴───────────────────────────────────────────────┘
```
