# Common Authentication and Authorization Vulnerabilities and Fixes

---

## 1. What is it?

**Authentication and Authorization Vulnerabilities** represent the most critical and frequently exploited failure modes in modern web applications. According to the **OWASP Top 10** and the **OWASP API Security Top 10**, flaws in identity verification and access control (such as Broken Object-Level Authorization, Insecure Direct Object References, and Credential Stuffing) consistently rank as the **#1 most prevalent security risk**.

These vulnerabilities occur when developers make false assumptions about client trustworthiness, fail to validate resource ownership, expose predictable identifiers, or use flawed cryptographic primitives. Understanding the anatomy of these attacks—and knowing how to implement bulletproof remediations—is the defining benchmark of a senior full-stack engineer.

```
+-------------------------------------------------------------------------------+
|                       THE OWASP AUTH & AUTHZ THREAT MATRIX                    |
+-------------------------------------------------------------------------------+
| Threat Category                      | Primary Exploitation Vector            |
+--------------------------------------+----------------------------------------+
| 1. BOLA / IDOR (OWASP API #1)        | Manipulating resource IDs in URLs/body |
| 2. Broken Function-Level Auth (BFLA) | Accessing unlisted admin endpoints     |
| 3. Credential Stuffing / Brute-Force | Automated dictionary attacks           |
| 4. Timing Attacks / User Enumeration | Leaking existence via response latency |
| 5. Insecure Password Reset           | Guessable / persistent reset tokens    |
| 6. Session Fixation / Hijacking      | Pre-allocating victim session cookies  |
| 7. CSRF (Cross-Site Request Forgery) | Abusing automatic browser cookie sends |
+--------------------------------------+----------------------------------------+
```

---

## 2. Why does it exist?

Web applications are built out of layered abstractions: HTTP transport, routing, database ORMs, and frontend clients. Security vulnerabilities emerge at the seams between these layers:
1. **Implicit Trust in Authentication**: Assuming that because a user holds a valid JWT, they are authorized to touch *any* record in the database.
2. **Speed-over-Security in Prototypes**: Scaffolding CRUD endpoints where `req.params.id` is passed directly to `db.delete(id)` without ownership verification.
3. **Flawed Cryptographic Assumptions**: Assuming string comparisons (`a === b`) are safe, or that hashing with SHA-256 is sufficient for passwords.

Securing an application requires defense-in-depth: validating identity at the perimeter, enforcing ownership in queries, and eliminating information leaks in error responses.

---

## 3. Mental Model

Visualize an **Apartment Building**:

- **Good Authentication (The Front Door Intercom)**: The doorman verifies you have a resident keycard to enter the lobby.
- **BOLA / IDOR (Unlatched Apartment Doors)**: Once inside the hallway, every apartment door is unlocked with sequential numbers (Apt 101, 102, 103). Because the doorman verified you live in Apt 101, you walk right into Apt 102 and steal their television (**Authorized into the building, but unauthorized to touch that specific apartment!**).
- **Broken Function-Level Auth (The Unlocked Boiler Room)**: The basement elevator button labeled "Manager Office & Master Keys" has no lock on it. Any resident can push the button and take the master keys.
- **Timing Attacks (The Attendant's Hesitation)**: When you ask the front desk: *"Is Alice home?"*, the attendant spends 5 seconds walking to Alice's door if she lives there, but responds *"No"* in 0.1 seconds if she doesn't. An observer with a stopwatch deduces whether Alice lives in the building without being told!

---

## 4. Vulnerability Catalog: Breakdown & Fixes

---

### 4.1 Vulnerability #1: Broken Object-Level Authorization (BOLA / IDOR)
- **The Flaw**: The server accepts an ID from the client (`/api/invoices/:id`) and updates/deletes the record without checking if `record.ownerId === req.user.id`.

```typescript
// ❌ VULNERABLE CODE: Anyone can view any invoice!
app.get("/api/invoices/:invoiceId", authenticateUser, async (req, res) => {
  const invoice = await db.invoices.findById(req.params.invoiceId);
  res.json(invoice);
});

//  SECURE REMEDIATION: Scope query to verified user identity
app.get("/api/invoices/:invoiceId", authenticateUser, async (req, res) => {
  const invoice = await db.invoices.findOne({
    where: {
      id: req.params.invoiceId,
      userId: req.user.id, // Enforce tenant/user ownership directly in SQL!
    },
  });

  if (!invoice) {
    // Return 404 to avoid leaking whether the invoice ID exists!
    return res.status(404).json({ error: "Invoice not found" });
  }

  res.json(invoice);
});
```

---

### 4.2 Vulnerability #2: Broken Function-Level Authorization (BFLA)
- **The Flaw**: Relying on "security through obscurity" by hiding administrative buttons in the frontend UI while leaving the backend API endpoint unprotected.

```typescript
// ❌ VULNERABLE CODE: Frontend hides the button, but endpoint is public to any logged-in user!
app.delete("/api/v1/users/:id", authenticateUser, async (req, res) => {
  await db.users.delete(req.params.id);
  res.status(204).end();
});

//  SECURE REMEDIATION: Explicit role/permission guard middleware
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "SUPER_ADMIN") {
    return res.status(403).json({ error: "Forbidden: Superadmin access required" });
  }
  next();
}

app.delete("/api/v1/users/:id", authenticateUser, requireAdmin, async (req, res) => {
  await db.users.delete(req.params.id);
  res.status(204).end();
});
```

---

### 4.3 Vulnerability #3: User Enumeration via Timing & Error Messages
- **The Flaw**: Disclosing whether an email address exists in the system via differing error messages or response times during login or password reset.

```typescript
// ❌ VULNERABLE CODE: Leaks user existence!
app.post("/login", async (req, res) => {
  const user = await db.findUser(req.body.email);
  if (!user) {
    return res.status(404).json({ error: "Email not found" }); // Leaked!
  }
  const isMatch = await bcrypt.compare(req.body.password, user.passwordHash);
  if (!isMatch) {
    return res.status(401).json({ error: "Incorrect password" }); // Leaked!
  }
});

//  SECURE REMEDIATION: Generic messages + Constant-time dummy hash on missing user
const DUMMY_HASH = "$2b$12$e8w.Ua5/l6yN8Uo5uM7LqOGm4R8Z2qY2v9K0aJ4pM3bV7cX6zQ9wE"; // Precomputed

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await db.findUser(email);

  // If user doesn't exist, compare against dummy hash to consume identical CPU time!
  const hashToCompare = user ? user.passwordHash : DUMMY_HASH;
  const isMatch = await bcrypt.compare(password, hashToCompare);

  if (!user || !isMatch) {
    // Single generic error message regardless of which check failed!
    return res.status(401).json({ error: "Invalid email or password" });
  }

  res.json({ token: generateToken(user) });
});
```

---

### 4.4 Vulnerability #4: Credential Stuffing & Missing Rate Limiting
- **The Flaw**: Allowing unlimited login attempts, enabling botnets to execute millions of automated password guesses per hour using credentials dumped from other website breaches.

```typescript
//  SECURE REMEDIATION: IP & Account-level Rate Limiting via Redis
import rateLimit from "express-rate-limit";
import RedisStore from "rate-limit-redis";

export const loginRateLimiter = rateLimit({
  store: new RedisStore({ sendCommand: (...args: string[]) => redisClient.call(...args) }),
  windowMs: 15 * 60 * 1000, // 15-minute window
  max: 5, // Limit each IP to 5 failed login attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again after 15 minutes." },
});

app.post("/api/auth/login", loginRateLimiter, authController.login);
```

---

### 4.5 Vulnerability #5: Insecure Password Reset Workflows
- **The Flaw**: Using short, numeric, or predictable reset tokens (e.g. 6-digit codes without expiration or attempt limits), or saving raw unhashed tokens in the database.

```typescript
//  SECURE REMEDIATION: High-entropy CSPRNG tokens with SHA-256 database hashing
export async function requestPasswordReset(email: string) {
  const user = await db.findUser(email);
  if (!user) {
    // Security Best Practice: Return success even if email doesn't exist to prevent enumeration!
    return { success: true };
  }

  // 1. Generate 32 bytes of cryptographic randomness (64 hex characters)
  const rawResetToken = crypto.randomBytes(32).toString("hex");

  // 2. Hash token before saving in database
  const tokenHash = crypto.createHash("sha256").update(rawResetToken).digest("hex");
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min expiry

  await db.saveResetToken({ userId: user.id, tokenHash, expiresAt });

  // 3. Send raw token in email link ONLY
  await mailer.sendResetEmail(user.email, `https://app.com/reset-password?token=${rawResetToken}`);

  return { success: true };
}
```

---

### 4.6 Vulnerability #6: Cross-Site Request Forgery (CSRF) on State-Changing Actions
- **The Flaw**: An attacker tricking an authenticated victim's browser into executing an unauthorized command on a target website via automatic cookie transmission:
  ```html
  <!-- Malicious site: attacker.com -->
  <img src="https://bank.com/api/transfer?amount=10000&to=attacker" />
  ```

```typescript
//  SECURE REMEDIATION: SameSite Cookies + Anti-CSRF Synchronizer Tokens
// 1. Enforce SameSite=Lax or Strict on all auth cookies
res.cookie("sessionId", sid, {
  httpOnly: true,
  secure: true,
  sameSite: "lax", // Browser withholds cookie on cross-origin POSTs!
});

// 2. Custom header validation (Browsers disallow cross-origin custom headers without CORS preflight)
export function requireCustomHeader(req: Request, res: Response, next: NextFunction) {
  if (req.method !== "GET" && !req.headers["x-requested-with"]) {
    return res.status(403).json({ error: "Missing required security header" });
  }
  next();
}
```

---

## 5. Security Defense-in-Depth Checklist

```
+-------------------------------------------------------------------------------+
|                       FULL-STACK AUTH SECURITY CHECKLIST                      |
+-------------------------------------------------------------------------------+
| [ ] 1. Password Storage: Argon2id (64MB memory cost) or Bcrypt (Rounds >= 12)  |
| [ ] 2. Cookies: Equipped with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`  |
| [ ] 3. BOLA Defense: Every database write verifies `userId === req.user.id`   |
| [ ] 4. Generic Auth Errors: Always return "Invalid credentials" (no user leak)|
| [ ] 5. Timing Attack Defense: Dummy hash comparison on non-existent users     |
| [ ] 6. Rate Limiting: Max 5 failed attempts per IP / Account on auth routes   |
| [ ] 7. Reset Tokens: 32 bytes CSPRNG; hashed with SHA-256 in DB; 15-min TTL  |
| [ ] 8. JWT Validation: Explicitly enforce `algorithms: ['RS256']`; check `exp`|
| [ ] 9. Session Fixation: Call `req.session.regenerate()` upon every login     |
| [ ] 10. Audit Logging: Record all failed login events with IP and timestamp   |
+-------------------------------------------------------------------------------+
```

---

## 6. Placement Interview Questions

### 6.1 Basic Questions
1. *What is an Insecure Direct Object Reference (IDOR) and how do you prevent it?*
   - Answer: An IDOR occurs when an application exposes a reference to an internal database object (such as an ID in a URL) without validating that the authenticated user possesses authorization to access that specific object. It is prevented by enforcing ownership checks directly in the database query (e.g. `SELECT * FROM orders WHERE id = :id AND user_id = :currentUserId`).
2. *Why should login error messages always say "Invalid email or password" instead of specifying which one was wrong?*
   - Answer: To prevent **User Enumeration**. Specifying "Email not found" confirms to an attacker that an email is not registered, while "Incorrect password" confirms that the email is a valid registered account, allowing attackers to harvest verified email lists for targeted spear-phishing.

### 6.2 Conceptual Questions
3. *What is a Timing Attack in the context of user authentication, and how is it mitigated?*
   - Answer: A timing attack measures minor differences in server response latency. If verifying a valid user takes 300ms (due to slow Bcrypt hashing) while rejecting an invalid user takes 2ms (because the database lookup returns immediately without hashing), an attacker can distinguish valid accounts from invalid ones. It is mitigated by executing a dummy password hash comparison when a user is not found, ensuring both branches consume identical CPU time.
4. *How does the `SameSite=Lax` cookie attribute protect against Cross-Site Request Forgery (CSRF)?*
   - Answer: `SameSite=Lax` instructs the browser to omit the cookie on cross-site requests (such as form submissions, AJAX calls, or image tags originating from another domain). The cookie is only sent on top-level safe GET navigations (such as clicking a standard hyperlink), preventing malicious sites from triggering unauthorized POST/PUT state mutations.

### 6.3 Implementation Questions
5. *Implement a constant-time string comparison function in Node.js.*
   - Answer:
     ```typescript
     import crypto from "node:crypto";
     export function constantTimeEqual(a: string, b: string): boolean {
       const bufA = Buffer.from(a);
       const bufB = Buffer.from(b);
       if (bufA.length !== bufB.length) return false;
       return crypto.timingSafeEqual(bufA, bufB);
     }
     ```

### 6.4 Debugging Questions
6. *Your security team discovers that an attacker was able to reset any user's password using the `/reset-password` endpoint. The code used `Math.random().toString(36)`. What is the flaw?*
   - Answer: `Math.random()` is **NOT cryptographically secure**. It uses a predictable pseudorandom number generator (PRNG) like xoshiro128+. An attacker observing a few generated tokens can determine the internal PRNG seed and calculate all future and past reset tokens. The solution is to use `crypto.randomBytes()`.

### 6.5 Scenario Questions
7. *Design an account lockout policy that protects against brute-force attacks without allowing attackers to launch a Denial of Service against legitimate users.*
   - Answer: Hard account lockouts (locking an account after 5 attempts) allow attackers to intentionally lock out legitimate executives simply by submitting 5 wrong passwords. A superior approach is **Exponential Progressive Delay and CAPTCHA**:
     - After 3 failed attempts: Require Cloudflare Turnstile / reCAPTCHA.
     - After 5 failed attempts: Impose an IP-level rate limit.
     - Never lock the entire account globally; lock only the specific IP address attempting the guesses.

### 6.6 Advanced Questions
8. *What is the "Confused Deputy Problem" in authorization systems?*
   - Answer: A Confused Deputy attack occurs when an unprivileged entity tricks a privileged service (the deputy) into executing an unauthorized action on its behalf. For example, an attacker instructs an image resizing microservice (which has administrative access to an internal S3 bucket) to fetch `http://169.254.169.254/latest/meta-data/` (SSRF), causing the privileged service to leak AWS cloud credentials back to the attacker.

---

## 7. Common Interview Traps

- **Trap 1**: "Is HTTPS enough to protect against CSRF?"
  - *Reality*: No! HTTPS encrypts traffic between browser and server, but the browser still automatically sends cookies on cross-origin requests. CSRF requires `SameSite` cookies or anti-CSRF tokens.
- **Trap 2**: "Does UUID v4 prevent BOLA / IDOR?"
  - *Reality*: No! UUIDs make guessing IDs harder than sequential integers, but if an attacker obtains a UUID (via shared links, logs, or network traffic), the lack of an ownership check still allows unauthorized access. **Obscurity is not authorization**.
- **Trap 3**: "Can rate limiting be based solely on client IP?"
  - *Reality*: No. Attackers use rotating proxy networks with millions of residential IPs to bypass IP rate limiters. Rate limit by combination of `IP + Target Email Account`.

---

## 8. Revision Summary

- **BOLA / IDOR (OWASP #1)**: Always verify resource ownership in database queries (`WHERE id = :id AND user_id = :userId`).
- **Timing Attacks**: Run dummy password hashes on missing accounts to ensure uniform latency.
- **Password Resets**: Use 32-byte CSPRNG tokens; hash them with SHA-256 before saving to database; enforce 15-minute TTL.
- **CSRF Defense**: Combine `HttpOnly`, `Secure`, and `SameSite=Lax` on all authentication cookies.
- **Credential Stuffing**: Implement Redis sliding-window rate limiters on all authentication endpoints.

---

## 9. Quick Reference

```typescript
// 1. BOLA-Safe Database Read
const item = await db.items.findOne({ where: { id: req.params.id, userId: req.user.id } });
if (!item) return res.status(404).json({ error: "Not found" });

// 2. Cryptographic Random Token
const rawToken = crypto.randomBytes(32).toString("hex");
const dbHash = crypto.createHash("sha256").update(rawToken).digest("hex");

// 3. Constant-Time Timing Check
const isValid = crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
```
