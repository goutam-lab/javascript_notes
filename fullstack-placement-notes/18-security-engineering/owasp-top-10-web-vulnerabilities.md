# OWASP Top 10 Web Application Security Vulnerabilities

## 1. What is it?
The **OWASP Top 10** is an internationally recognized, authoritative consensus report published by the **Open Worldwide Application Security Project (OWASP)**. It identifies and ranks the ten most critical security risks facing web applications, APIs, and modern cloud architectures.

Rather than being a static checklist, the OWASP Top 10 reflects real-world vulnerability telemetry collected from millions of security audits, penetration tests, and breach post-mortems across global software systems.

```
The OWASP Top 10 (Current Industry Standard Classification):
+---------------------------------------------------------------------------------+
| A01: Broken Access Control               (Most prevalent vulnerability)         |
| A02: Cryptographic Failures              (Sensitive data exposure, weak ciphers)|
| A03: Injection                           (SQL, NoSQL, OS Command, LDAP)        |
| A04: Insecure Design                     (Architectural flaws, lack of threat)  |
| A05: Security Misconfiguration           (Default passwords, open S3, CORS)    |
| A06: Vulnerable & Outdated Components    (Supply-chain CVEs, npm dependencies)  |
| A07: Identification & Auth Failures      (Credential stuffing, brute-force)     |
| A08: Software & Data Integrity Failures  (Insecure CI/CD pipelines, untrusted)  |
| A09: Security Logging & Monitoring Fails (Undetected breaches, zero audit logs) |
| A10: Server-Side Request Forgery (SSRF)  (Cloud metadata service exfiltration)  |
+---------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?
1. **Preventing Catastrophic Financial and Legal Breaches**: A single unmitigated Broken Access Control vulnerability or SQL injection can lead to complete database exfiltration, resulting in millions of dollars in regulatory fines (GDPR, CCPA, HIPAA), permanent brand damage, and operational downtime.
2. **Defending Against Automated Threat Actors**: Hackers rarely target specific systems manually; automated botnets continuously scan IPv4 address spaces and GitHub repositories for well-known OWASP patterns (e.g., open `.env` files, unauthenticated actuator endpoints, SQL injection vectors).
3. **Establishing Engineering Standards**: The OWASP Top 10 provides engineering teams, security auditors, and placement interviewers with a common vocabulary and rigorous baseline standards for code reviews, architectural threat modeling, and automated CI/CD security scanning.

---

## 3. Mental Model
Think of the OWASP Top 10 as **Securing a Modern Commercial Bank**:
- **A01: Broken Access Control**: A customer with a safety deposit box keycard walks into the vault and discovers their keycard opens every other customer's deposit box because the guard never checks the account name on the card (**IDOR**).
- **A02: Cryptographic Failures**: Writing account numbers and passwords in plain pencil on a receipt left on the front counter instead of hashing them with Argon2.
- **A03: Injection**: A robber hands the teller a withdrawal slip that reads: *"Give me $100; ALSO, open the main vault door and transfer all funds to my offshore account"*—and the automated computer system executes both commands blindly without separating instructions from data.
- **A05: Security Misconfiguration**: Leaving the bank's back alley door propped open with a wooden wedge with the factory default passcode `1234`.
- **A10: SSRF**: An attacker tricks the bank's internal mail courier into walking into the high-security basement server room and reading the master vault keys off the wall (**Cloud Metadata Service `169.254.169.254`**).

---

## 4. Basic Example
Contrasting a vulnerable endpoint against a secure implementation defending against **A01: Broken Access Control (IDOR)**:

```typescript
// --- VULNERABLE ENDPOINT (A01: Broken Access Control) ---
app.get('/api/invoices/:invoiceId', async (req, res) => {
  // FATAL FLAW: Fetches invoice purely by ID without verifying ownership!
  // Any logged-in user can change :invoiceId to view any other customer's billing data!
  const invoice = await db.query('SELECT * FROM invoices WHERE id = $1', [req.params.invoiceId]);
  res.json(invoice.rows[0]);
});

// --- SECURE ENDPOINT (Defense-in-Depth Authorization) ---
app.get('/api/invoices/:invoiceId', authenticateToken, async (req, res) => {
  const { invoiceId } = req.params;
  const currentUserId = req.user.id; // Extracted from verified JWT session

  // Secure: Invariant checks BOTH invoice ID AND the requesting user's identity!
  const invoice = await db.query(
    'SELECT * FROM invoices WHERE id = $1 AND user_id = $2',
    [invoiceId, currentUserId]
  );

  if (!invoice.rows.length) {
    // Return 404 to avoid leaking the existence of another user's invoice
    return res.status(404).json({ error: 'Invoice not found' });
  }

  res.json(invoice.rows[0]);
});
```

---

## 5. Real Example: Defending Against A10: Server-Side Request Forgery (SSRF)
A production TypeScript webhook validator preventing attackers from tricking the server into querying internal cloud metadata services (`http://169.254.169.254/latest/meta-data/`):

```typescript
import ipaddr from 'ipaddr.js';
import dns from 'dns/promises';

export class SecureWebhookDispatcher {
  /**
   * SSRF DEFENSE: Validates that a user-supplied URL does NOT resolve to:
   * 1. Loopback addresses (127.0.0.1, localhost)
   * 2. Private intranet ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
   * 3. Cloud Provider Metadata Endpoints (169.254.169.254)
   */
  public static async validateSafePublicUrl(targetUrl: string): Promise<boolean> {
    const parsed = new URL(targetUrl);

    // Only allow standard web protocols
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Unsupported protocol: Only HTTP and HTTPS are permitted');
    }

    // Resolve DNS hostname to raw IP addresses
    const resolvedIps = await dns.resolve(parsed.hostname);

    for (const ipStr of resolvedIps) {
      const addr = ipaddr.parse(ipStr);
      const range = addr.range();

      // Block dangerous IP ranges
      if (
        range === 'loopback' ||     // 127.0.0.1
        range === 'private' ||      // 10.0.0.0/8, 192.168.0.0/16
        range === 'linkLocal' ||    // 169.254.0.0/16 (AWS / GCP / Azure Metadata!)
        range === 'uniqueLocal' ||  // IPv6 private
        range === 'carrierGradeNat'
      ) {
        throw new Error(`Security Violation: URL resolves to prohibited internal IP: ${ipStr}`);
      }
    }

    return true;
  }
}
```

---

## 6. Under the Hood

### Deep Dive into the Top 5 Vulnerabilities

#### A01: Broken Access Control
- **Mechanism**: The application fails to properly enforce that the authenticated user possesses the authorization permissions to act upon the target object.
- **Most Common Manifestation**: **IDOR (Insecure Direct Object Reference)**. An endpoint exposes direct database primary keys in URLs (`/users/105/settings`), allowing an attacker to increment the ID and view or mutate other users' private records.
- **Prevention**: Always enforce authorization checks at the database query layer (`WHERE id = :id AND tenant_id = :tenant_id`).

#### A02: Cryptographic Failures
- **Mechanism**: Data in transit or data at rest is either unencrypted or protected using obsolete, broken cryptographic algorithms (MD5, SHA1, DES, ECB mode).
- **Prevention**: Enforce TLS 1.3 everywhere. Hash passwords using memory-hard algorithms (**Argon2id** or **bcrypt** with work factor $\ge 12$). Encrypt sensitive PII at rest using **AES-256-GCM**.

#### A03: Injection
- **Mechanism**: Untrusted user data is concatenated directly into an interpreter (SQL parser, shell command, LDAP query). The interpreter cannot distinguish between the developer's instructions and the attacker's payload.
- **Prevention**: Use parameterized queries, prepared statements, and Object-Relational Mappers. Never concatenate user input into SQL or OS command strings.

#### A05: Security Misconfiguration
- **Mechanism**: Applications running with default credentials, unneeded features enabled, permissive CORS headers (`Access-Control-Allow-Origin: *`), verbose stack traces leaked to end-users, or unencrypted S3 storage buckets.
- **Prevention**: Automated infrastructure-as-code hardening, disabling production debug flags, and enforcing security headers via **Helmet.js**.

#### A10: Server-Side Request Forgery (SSRF)
- **Mechanism**: A web application accepts an external URL from a user (e.g., "Enter image URL to import your avatar") and fetches it from the server backend. The attacker supplies `http://169.254.169.254/latest/meta-data/iam/security-credentials/`, causing the server to fetch and return its own AWS IAM role temporary keys, leading to complete cloud account takeover!
- **Prevention**: Strictly validate, parse, and resolve URLs against private IP blacklists before fetching, or run external fetchers in an isolated DMZ.

---

## 7. Important Rules
1. **Never Trust Client-Side Authorization**: Hiding a "Delete User" button in the React UI is **not security**. Any client can craft a `DELETE /api/users/123` HTTP request directly using curl or Postman. Authorization must be strictly validated on the server on every request.
2. **Deny by Default**: Always configure access control policies to deny all requests by default, explicitly whitelisting permissions only when required.
3. **Fail Securely**: When an authentication or authorization check fails, log the event internally with full context, but return generic error messages to the client (`401 Unauthorized` or `404 Not Found`) to prevent information leakage.
4. **Automate Dependency Vulnerability Audits**: Run `npm audit` or **Snyk** in every CI/CD pipeline to catch vulnerable open-source dependencies (**A06: Vulnerable Components**).

---

## 8. Common Mistakes

### 1. The IDOR Vulnerability in Nested Routes
```typescript
// VULNERABLE: Checks organization ownership, but not project ownership!
app.put('/api/orgs/:orgId/projects/:projectId', async (req, res) => {
  // If user belongs to orgId, the code assumes they own projectId without checking!
  await db.query('UPDATE projects SET name = $1 WHERE id = $2', [req.body.name, req.params.projectId]);
});

// SECURE: Enforces full hierarchical ownership verification
app.put('/api/orgs/:orgId/projects/:projectId', verifyOrgMembership, async (req, res) => {
  const result = await db.query(
    'UPDATE projects SET name = $1 WHERE id = $2 AND org_id = $3',
    [req.body.name, req.params.projectId, req.params.orgId]
  );
  if (result.rowCount === 0) return res.status(404).json({ error: 'Project not found' });
});
```

### 2. Leaking Detailed Stack Traces in Production
Allowing unhandled Express errors to display `Error: connect ECONNREFUSED 10.0.1.5:5432 at ...` in HTTP 500 responses. This reveals internal server IP addresses, database versions, and source code directory paths to attackers.

---

## 9. Best Practices

### 1. Production Helmet.js Configuration
Enforce baseline security headers in Express:
```typescript
import helmet from 'helmet';

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://trusted-cdn.com"]
      }
    },
    hidePoweredBy: true, // Strips 'X-Powered-By: Express' header
    hsts: { maxAge: 31536000, includeSubDomains: true } // Enforces HTTPS for 1 year
  })
);
```

### 2. Principle of Least Privilege (PoLP)
- The database user used by your web API should only have `SELECT`, `INSERT`, `UPDATE`, and `DELETE` privileges.
- Never connect your application backend using the database `postgres` or `root` superuser role!

---

## 10. Performance Considerations
- **Password Hashing Work Factors**: Setting bcrypt rounds to 16 or Argon2 memory to 2GB will freeze the Node.js event loop during user registration surges. Balance security with performance: bcrypt rounds of **10 to 12** provides strong cryptographic resistance against GPUs while computing in ~100ms on server CPUs.
- **SSRF Validation Overhead**: Resolving DNS hostnames synchronously before fetching adds a 20ms–50ms network DNS lookup. Cache verified domains in memory.

---

## 11. Security Considerations
- **Defense in Depth**: Never rely on a single layer of security. Pair network firewalls (WAF/Cloudflare) with API rate limiting, strict CORS, input validation (Zod), parameterized queries, and database Row-Level Security (RLS).

---

## 12. Alternatives
1. **Zero-Trust Network Architecture**: Moving beyond perimeter security; every microservice verifies every internal request via mutual TLS (mTLS) and signed JWT tokens.
2. **Managed Authentication Providers (Clerk, Auth0, AWS Cognito)**: Offloads the maintenance of password salting, brute-force mitigation, and credential stuffing defense to dedicated enterprise security teams.

---

## 13. Trade-offs

| Security Mechanism | Security Benefit | Developer / UX Cost | Performance Impact |
| :--- | :--- | :--- | :--- |
| **Strict CSP Headers** | Eliminates XSS | Can break 3rd-party analytics | 0% runtime overhead |
| **High Argon2 Work Factor** | Prevents brute force | Slower registration/login | High CPU utilization |
| **Strict SSRF DNS Checks** | Prevents cloud compromise| Complex network code | Adds ~30ms DNS latency |
| **Row-Level Security (RLS)**| Database-level IDOR shield | Complex SQL migrations | Minor query planning overhead |

---

## 14. Real-World Usage
- **Capital One Cloud Breach**: A misconfigured web application firewall permitted an SSRF attack, allowing an attacker to query the AWS EC2 metadata endpoint and steal IAM credentials, exposing 106 million customer credit card records.
- **Automated Snyk / Dependabot Audits**: Every major software enterprise scans pull requests against the OWASP Top 10 database before merging code to master.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the OWASP Top 10, and why is it significant?**  
*Answer*: The OWASP Top 10 is a globally recognized awareness document outlining the ten most critical security risks facing web applications. It serves as the industry standard for secure coding practices, vulnerability assessments, compliance frameworks, and developer security benchmarks.

### Conceptual
**Q: What is an Insecure Direct Object Reference (IDOR), and which OWASP category does it fall under?**  
*Answer*: IDOR falls under **A01: Broken Access Control**. It occurs when an application exposes a reference to an internal database object (such as an auto-incrementing integer or UUID in a URL parameter like `/api/documents/501`) and fails to verify that the currently authenticated user has the necessary permissions to access that specific object, allowing attackers to access unauthorized data simply by changing the ID.

### Implementation
**Q: How does a Server-Side Request Forgery (SSRF) attack allow an attacker to take over an AWS cloud infrastructure?**  
*Answer*: In an SSRF attack, an attacker tricks a vulnerable backend server into making an HTTP request to an internal network address on the attacker's behalf. In AWS environments, all EC2 instances can query a local, unauthenticated link-local IP address: `http://169.254.169.254/latest/meta-data/`. An attacker provides this URL to a vulnerable endpoint (e.g., an avatar image fetcher). The backend server fetches the URL and returns the output to the attacker, exposing temporary AWS IAM secret access keys and security tokens, allowing the attacker to assume the server's cloud permissions and take over AWS resources.

### Debugging
**Q: A penetration testing report flags an application for "A05: Security Misconfiguration" because the response header contains `X-Powered-By: Express`. Why is this a security hazard, and how do you remediate it?**  
*Answer*: The `X-Powered-By: Express` header leaks the underlying backend framework and runtime technology to attackers. If a zero-day vulnerability is published for that specific framework or version, automated botnets can target the server immediately. To remediate in Express, either call `app.disable('x-powered-by')` or use the **`helmet()`** middleware, which removes this header automatically.

### Scenario
**Q: You are reviewing a PR with this code: `db.query("SELECT * FROM users WHERE email = '" + req.body.email + "'")`. Explain the exact vulnerability, write an exploit payload, and provide the fix.**  
*Answer*:
- **Vulnerability**: **A03: SQL Injection**. Untrusted user input is directly concatenated into the SQL command string.
- **Exploit Payload**: The attacker sends `email = "admin@site.com' OR '1'='1' --"`. The resulting query becomes `SELECT * FROM users WHERE email = 'admin@site.com' OR '1'='1' --'`, which returns all user records in the database, bypassing authentication.
- **Fix**: Use parameterized queries:
  ```typescript
  db.query('SELECT * FROM users WHERE email = $1', [req.body.email]);
  ```

### Advanced
**Q: Explain how modern applications mitigate "A08: Software and Data Integrity Failures" in CI/CD supply chains.**  
*Answer*: Supply chain attacks occur when attackers compromise third-party libraries (e.g., malicious npm packages) or CI/CD pipelines to inject malicious code into production builds. Mitigation involves:
1. Enforcing **Package Lockfile Integrity**: Always running `npm ci` instead of `npm install` to guarantee cryptographic SHA-512 integrity hashes match `package-lock.json`.
2. **Automated Vulnerability Scanning**: Running tools like Snyk or GitHub Dependabot in CI/CD to block builds containing known CVEs.
3. **Artifact Signing**: Digitally signing Docker images and release binaries using tools like Sigstore/Cosign so that production Kubernetes clusters reject unverified containers.
4. **Least-Privilege CI Secrets**: Scoping GitHub Actions tokens strictly to read-only where write access is not required.

---

## 16. Coding Questions

### Problem 1: Implementing a Secure Authorization Guard Middleware in Express
Write an Express.js middleware that validates whether the authenticated user has permission to modify a target project document, preventing IDOR.

```typescript
import { Request, Response, NextFunction } from 'express';
import { dbPool } from './db';

// Extending Express Request to include authenticated user context
interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    role: 'USER' | 'ADMIN';
  };
}

export async function authorizeProjectAccess(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const projectId = req.params.projectId;
    const currentUserId = req.user?.id;

    if (!currentUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Admins bypass ownership checks
    if (req.user?.role === 'ADMIN') {
      return next();
    }

    // Verify ownership in database
    const project = await dbPool.query(
      'SELECT owner_id FROM projects WHERE id = $1',
      [projectId]
    );

    if (project.rows.length === 0) {
      // Return 404 to avoid leaking project existence
      return res.status(404).json({ error: 'Project not found' });
    }

    if (project.rows[0].owner_id !== currentUserId) {
      // Forbidden: User is authenticated but does not own this resource!
      return res.status(403).json({ error: 'Access denied: You do not own this project' });
    }

    // Authorization verified
    next();
  } catch (error) {
    next(error);
  }
}
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking SQL Injection is only possible in raw SQL. If an ORM provides a raw escape hatch (e.g., `whereRaw` in Knex or `$queryRawUnsafe` in Prisma), concatenating strings into those methods introduces full SQL injection vulnerabilities.
- **Trap 2**: Believing authentication and authorization are the same. Authentication proves **who you are** (A07); authorization decides **what you are allowed to do** (A01).
- **Trap 3**: Believing HTTPS prevents SQL injection. HTTPS encrypts data in transit over the network; it does not sanitize malicious payloads once they arrive at the backend server.

---

## 18. Revision Summary
- The OWASP Top 10 provides an essential framework for identifying and mitigating critical web application vulnerabilities.
- **A01: Broken Access Control (IDOR)** is the #1 security risk; always verify resource ownership on every database query.
- **A02: Cryptographic Failures**: Hash passwords with Argon2/bcrypt; use TLS 1.3 everywhere.
- **A03: Injection**: Always use parameterized queries and prepared statements.
- **A05: Security Misconfiguration**: Disable debug modes, strip framework headers with Helmet.js.
- **A10: SSRF**: Strictly validate user-supplied URLs against private and cloud metadata IP ranges (`169.254.169.254`).

---

## 19. Quick Reference

| OWASP Category | Primary Danger | Gold Standard Defense |
| :--- | :--- | :--- |
| **A01: Broken Access Control** | IDOR, privilege escalation | Verify ownership in query (`WHERE user_id = $1`) |
| **A02: Cryptographic Failures** | Plaintext leaks, weak hashes | Argon2id / bcrypt ($\ge 12$ rounds), AES-256-GCM |
| **A03: Injection** | SQL / Command execution | Parameterized queries (`$1`), ORMs |
| **A04: Insecure Design** | Architectural flaws | Threat modeling, rate limiting |
| **A05: Security Misconfig** | Leaked stack traces, open CORS | Helmet.js, disable debug flags |
| **A06: Outdated Components** | Vulnerable npm dependencies | `npm audit`, Dependabot, Snyk |
| **A07: Auth Failures** | Brute force, credential stuffing | Multi-factor auth (MFA), rate limiting |
| **A10: SSRF** | Stealing AWS metadata keys | IP blacklist validation before URL fetch |
