# Password Security: Cryptographic Salting, Bcrypt, and Argon2id

---

## 1. What is it?

**Password Security** in backend engineering is the science of storing and verifying user authentication secrets without ever persisting the raw plain-text password to disk or memory. Because database breaches are an inevitable risk of operating internet-facing services, passwords must be transformed using irreversible, computationally intensive, one-way cryptographic hash functions.

Modern password storage relies on three non-negotiable cryptographic pillars:
1. **One-Way Cryptographic Hashing**: A mathematical function that converts arbitrary plain text into a fixed-length string, designed such that reversing the operation ($H(x) \rightarrow x$) is mathematically infeasible.
2. **Cryptographic Salt**: A cryptographically secure, randomly generated string (typically 16+ bytes) concatenated with the password *before* hashing. A unique salt is generated for every user and stored alongside the hash, completely neutralizing **Rainbow Table** precomputation attacks.
3. **Slow, Memory-Hard Hash Functions (Key Stretching)**: Algorithms intentionally engineered to be computationally expensive and consume large amounts of RAM (e.g., **Bcrypt**, **Argon2id**, **Scrypt**). This deliberate slowness renders modern GPU and ASIC hardware brute-force cracking commercially impossible.

```
+-------------------------------------------------------------------------------+
|                       PASSWORD HASHING & SALTING PIPELINE                     |
+-------------------------------------------------------------------------------+
| User Plain-Text Password: "P@ssword123!"                                      |
|                                |                                              |
|                                +-- Cryptographic Salt (16 Random Bytes via    |
|                                |   CSPRNG): "9f8a7b6c5d4e3f21"                |
|                                v                                              |
| +---------------------------------------------------------------------------+ |
| | KEY STRETCHING ALGORITHM: Argon2id / Bcrypt (Work Factor / Cost = 12)     | |
| | - Iterates 4,096 times                                                    | |
| | - Allocates 64MB of RAM (Memory-Hardness prevents GPU parallel cracking)  | |
| | - Deliberate execution time: ~250ms - 350ms on server CPU                 | |
| +---------------------------------------------------------------------------+ |
|                                |                                              |
|                                v                                              |
| Resulting Hash String Stored in Database:                                     |
| "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgqlfre..."            |
| (Encodes: Algorithm ID + Version + Cost Factors + Salt + Hash Signature)      |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

### The Fatal Flaw of Fast Hash Functions (MD5, SHA-1, SHA-256)
Developers new to cryptography often write:
```typescript
// ❌ CATASTROPHIC SECURITY DISASTER: Fast Hashing
const hash = crypto.createHash("sha256").update(password).digest("hex");
```
**Why is SHA-256 fatal for passwords?**
SHA-256 was designed for high-speed data integrity verification (e.g., verifying a 10GB ISO download). A modern commodity consumer graphics card (such as an NVIDIA RTX 4090) can calculate **over 25 billion SHA-256 hashes per second**.
If an attacker steals your database containing SHA-256 hashes, an 8-character complex password can be cracked via brute-force in **under 2 minutes**!

### The Rainbow Table Threat
If users choose the common password `password123` and you hash it without a salt, the hash is always identical:
`ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f`.
Attackers maintain precomputed lookup tables (Rainbow Tables) containing billions of pre-hashed passwords. Cracking unsalted hashes requires an $O(1)$ dictionary lookup taking less than 1 millisecond.

Salting and slow memory-hard algorithms (Argon2id, Bcrypt) exist to turn that 2-minute attack into centuries of compute time.

---

## 3. Mental Model

Visualize a **Bank Vault with a Specialized Hydraulic Lock**:

- **Fast Hashing (SHA-256)**: A standard padlock on a shed. You can pick it in 0.0001 seconds. An attacker with 1,000 automated lock-picking robots (GPUs) picks 1 billion locks every minute.
- **The Salt**: Changing the keyhole shape for every single vault door on Earth. An attacker cannot build one master lockpick to open all doors. They must custom-craft a new pick for every single user account individually.
- **The Slow, Memory-Hard Algorithm (Argon2id)**: A heavy hydraulic safe door filled with concrete and thick molasses.
  - To turn the key once, the mechanism forces the safe to slowly grind gears for exactly **0.3 seconds**, requiring a massive hydraulic pump that fills an entire room (**64MB of RAM**).
  - For a legitimate user logging in once, waiting 0.3 seconds is completely imperceptible.
  - For an attacker trying 1 billion passwords, that 0.3-second delay means their attack would require **9.5 years and millions of gigabytes of RAM**, making the attack financially and physically impossible.

---

## 4. Basic Example

### 4.1 Hashing and Verifying with Bcrypt
```typescript
import bcrypt from "bcrypt";

// 1. Hashing a password (Registration)
async function hashPassword(plainTextPassword: string): Promise<string> {
  // Salt rounds (Work Factor): 12 is the current production sweet spot (~250ms)
  const saltRounds = 12;
  const passwordHash = await bcrypt.hash(plainTextPassword, saltRounds);
  return passwordHash;
}

// 2. Verifying a password (Login)
async function verifyPassword(plainTextPassword: string, storedHash: string): Promise<boolean> {
  // Automatically extracts the salt and work factor from storedHash
  // Executes constant-time comparison under the hood to prevent timing attacks!
  const isMatch = await bcrypt.compare(plainTextPassword, storedHash);
  return isMatch;
}

// Verification Run
async function run() {
  const hash = await hashPassword("PlacementMastery2026!");
  console.log("Generated Bcrypt Hash:", hash);
  // Example: $2b$12$e8w.Ua5/l6yN8Uo5uM7LqOGm4R8Z...

  const valid = await verifyPassword("PlacementMastery2026!", hash);
  console.log("Password valid?", valid); // true

  const invalid = await verifyPassword("WrongPassword", hash);
  console.log("Password valid?", invalid); // false
}
```

---

## 5. Real Example

### Enterprise Password Security Service with Argon2id (OWASP Recommended Standard)
**Argon2id** is the winner of the international Password Hashing Competition (PHC) and is the #1 recommended algorithm by OWASP because it is simultaneously immune to side-channel attacks and GPU/ASIC cracking:

```typescript
// password-hasher.ts
import argon2 from "argon2";
import crypto from "node:crypto";

export class PasswordSecurityService {
  /**
   * OWASP Recommended Parameters for Argon2id:
   * - Type: Argon2id (hybrid defense against side-channel and GPU attacks)
   * - Memory Cost: 65,536 KB (64 MB)
   * - Time Cost: 3 iterations
   * - Parallelism: 4 threads
   */
  private static readonly ARGON_OPTIONS: argon2.Options = {
    type: argon2.argon2id,
    memoryCost: 65536, // 64 MB of RAM per hash
    timeCost: 3,       // 3 iterations
    parallelism: 4,    // 4 CPU threads
  };

  /**
   * Hashes a password using Argon2id.
   */
  public static async hash(password: string): Promise<string> {
    if (!password || password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    return argon2.hash(password, this.ARGON_OPTIONS);
  }

  /**
   * Verifies a password against an Argon2id hash using constant-time comparison.
   */
  public static async verify(password: string, hash: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // Prevent internal errors from revealing hash format validity
      return false;
    }
  }

  /**
   * Checks if a stored hash needs to be re-hashed with updated work factors.
   * Useful when server hardware upgrades allow increasing cost factors.
   */
  public static needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, this.ARGON_OPTIONS);
  }

  /**
   * Generates a cryptographically secure, high-entropy password reset token.
   * Stores the SHA-256 hash of the token in the DB, sending the raw token to user email.
   */
  public static generateResetToken(): { rawToken: string; hashedToken: string; expiresAt: Date } {
    // 32 cryptographically secure random bytes = 64 hex characters
    const rawToken = crypto.randomBytes(32).toString("hex");

    // We store ONLY the SHA-256 hash in the database!
    // (If the DB is leaked, reset tokens cannot be hijacked)
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    // Token expires in 15 minutes
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    return { rawToken, hashedToken, expiresAt };
  }
}
```

---

## 6. Under the Hood

### 6.1 Dissecting a Modular Crypt Format String
When you inspect a Bcrypt or Argon2 hash saved in PostgreSQL, the entire cryptographic metadata is encoded within a single string:

```
Bcrypt Hash:
$2b$12$e8w.Ua5/l6yN8Uo5uM7LqOGm4R8Z2qY2v9K0aJ4pM3bV7cX6zQ9wE
 |  |  |                      |
 |  |  |                      +-- 31 characters of Hash Signature
 |  |  +-- 22 characters of Base64-encoded Salt
 |  +-- Cost / Work Factor: 2^12 = 4,096 iterations
 +-- Algorithm Identifier ($2b$ = modern Bcrypt)
```

Because the salt and cost factors are serialized directly into the hash string:
1. You **do not** need a separate `salt` column in your SQL database!
2. You can increase the cost factor for new users without breaking login for existing users.
3. When verifying, the library parses the salt from the string, hashes the candidate password with that exact salt and cost, and verifies if the resulting signature matches.

### 6.2 Bcrypt vs Argon2id vs PBKDF2

```
+-------------------------------------------------------------------------------+
|                       PASSWORD HASHING ALGORITHM MATRIX                       |
+-------------------------------------------------------------------------------+
| Feature              | PBKDF2           | Bcrypt          | Argon2id          |
+----------------------+------------------+-----------------+-------------------+
| Memory-Hardness?     | NO (CPU only)    | NO (~4 KB)      | YES (Configurable)|
| GPU / ASIC Defense   | Weak             | Moderate        | Exceptional       |
| Truncation Limit     | None             | 72 Bytes ⚠️     | None              |
| Standards Compliance | FIPS-140 / NIST  | Industry Standard| OWASP Top Choice  |
| Primary Vulnerability| Vulnerable to GPU| Passwords > 72B | High server RAM   |
|                      | cluster attacks  | are truncated!  | usage if tuned too|
|                      |                  |                 | high              |
+----------------------+------------------+-----------------+-------------------+
```

### 6.3 The 72-Byte Bcrypt Truncation Trap
Bcrypt is based on the Blowfish block cipher, which has a hard ceiling: **it silently truncates passwords longer than 72 bytes!**
If a user submits an 80-character passphrase, bytes 73-80 are discarded. Any input matching the first 72 bytes will successfully authenticate.
- **Solution 1**: Pre-hash the password with SHA-256 before passing to Bcrypt (`bcrypt(sha256(password))`).
- **Solution 2 (Modern Standard)**: Use **Argon2id**, which does not have a 72-byte limit.

---

## 7. Important Rules

1. **Never Hash Passwords with Fast Digests (SHA-256, MD5, SHA-1, SHA-3)**: Fast algorithms exist for file checksums and digital signatures, not passwords.
2. **Never Invent Your Own Cryptography**: Never write custom salting logic like `md5(salt + password + "secret")`. Always use standardized libraries (`bcrypt`, `argon2`).
3. **Use Constant-Time Comparison**: Standard string equality (`hashA === hashB`) aborts early on the first mismatched character. Attackers measure request response times in nanoseconds to deduce hash characters. Always use `crypto.timingSafeEqual()` or built-in library verification methods.
4. **Tune Work Factors to Server Hardware**: A password hash should take approximately **250ms to 350ms** on your production CPU. If it takes 2ms, it is too easy for GPUs to crack. If it takes 3,000ms, an attacker sending 20 concurrent login requests will exhaust your server CPU (Denial of Service).

---

## 8. Common Mistakes

### Mistake 1: Client-Side Hashing Replaced Server-Side Hashing
```typescript
// ❌ WRONG: Hashing only on the frontend!
// If client sends hashPassword(pw) over the wire, that hash BECOMES the plain-text password!
// Anyone intercepting the hash can authenticate directly without ever knowing the real password!
```
*Correction*: Passwords must be transmitted over encrypted HTTPS to the server in plain text and hashed **server-side**. (Client-side pre-hashing is only useful as an extra step before server-side salting/hashing).

### Mistake 2: Storing Raw Reset Tokens in the Database
When a user requests a password reset, saving the raw unhashed token `xyz123` in `users.reset_token` means an attacker who compromises read-only database access can immediately reset any user's password. Always hash reset tokens with SHA-256 before persisting.

---

## 9. Best Practices

1. **Use `argon2id` for New Applications**: Argon2id provides superior resistance against specialized GPU mining rigs and ASIC cracking arrays.
2. **Implement Re-Hashing on Successful Login**: When upgrading from Bcrypt rounds 10 to 12, or from Bcrypt to Argon2id, check `needsRehash(hash)` inside the login controller. If `true`, re-hash the validated plain text and update the database transparently.
3. **Enforce Password Complexity and Length**: Prioritize password length over arbitrary character rules (e.g. recommend passphrases of 12+ characters). Check inputs against breached password lists (e.g. HaveIBeenPwned k-Anonymity API).

---

## 10. Performance Considerations

```
+-------------------------------------------------------------------------------+
|                       PASSWORD HASHING CPU & MEMORY PROFILES                  |
+-------------------------------------------------------------------------------+
| Algorithm & Setting           | Latency (ms) | RAM Consumed | GPU Feasibility |
+-------------------------------+--------------+--------------+-----------------+
| SHA-256 (Raw)                 | 0.001 ms     | ~0 KB        | Trivial (Secs)  |
| Bcrypt (Rounds = 10)          | ~80 ms       | ~4 KB        | Feasible        |
| Bcrypt (Rounds = 12)          | ~320 ms      | ~4 KB        | Hard            |
| Argon2id (64MB, t=3, p=4)     | ~280 ms      | 64 MB        | Impossible      |
+-------------------------------+--------------+--------------+-----------------+
```

- **Authentication Rate Limiting**: Because slow hashing consumes CPU cycles, an unauthenticated attacker can launch an **Algorithmic Denial of Service (DoS)** by flooding `/api/login` with 500 requests per second. Always place strict IP-based rate limiters (e.g., max 5 login attempts per minute) *before* invoking password verification!

---

## 11. Security Considerations

1. **Side-Channel Timing Attacks**: In password verification, ensure comparison functions do not leak information via variable execution time.
2. **Memory Leakage in Core Dumps**: Once verified, allow plain-text password variables to fall out of lexical scope immediately so V8 can clean them up. Never attach plain-text passwords to error objects or log outputs.

---

## 12. Alternatives

| Technology | Security Profile | Best Use Case |
| :--- | :--- | :--- |
| **Argon2id** | State-of-the-Art (Memory-Hard). | Modern standard; all new enterprise web applications. |
| **Bcrypt** | Battle-tested for 25+ years. | Legacy systems; environments where C-bindings for Argon2 fail. |
| **Scrypt** | Memory-hard predecessor to Argon2. | Cryptocurrency wallets; Node native `crypto.scrypt`. |
| **PBKDF2** | NIST/FIPS-140 approved; CPU-only. | Strictly regulated government/banking compliance environments. |

---

## 13. Trade-offs

- **Argon2id vs Bcrypt**:
  - *Argon2id*: Strongest protection against GPU clusters. Requires native C++ compilation (`node-gyp`) and consumes 64MB of RAM per verification.
  - *Bcrypt*: Universally available, lightweight memory footprint (4KB). However, limited to 72 bytes and vulnerable to specialized ASIC hardware.

---

## 14. Real-World Usage

- **Auth0 / Okta**: Use Bcrypt (cost 10-12) or Argon2id to hash credentials for millions of enterprise identities.
- **Django Framework**: Defaulted to PBKDF2 with SHA-256 with 600,000 iterations.
- **Linux `/etc/shadow`**: Modern Linux distributions (Ubuntu, Fedora) use `yescrypt` or `argon2id` for OS-level user password hashing.

---

## 15. Placement Interview Questions

### 15.1 Basic Questions
1. *Why should passwords never be hashed using SHA-256 or MD5?*
   - Answer: SHA-256 and MD5 are fast cryptographic hash functions designed for high-throughput checksum verification. Modern GPUs can calculate tens of billions of SHA-256 hashes per second, allowing attackers to brute-force breached password databases in minutes.
2. *What is a cryptographic salt and what attack does it neutralize?*
   - Answer: A salt is a unique, cryptographically random string concatenated with a password prior to hashing. It neutralizes **Rainbow Table attacks** (precomputed hash lookups) and prevents attackers from discovering that two users share the same password.

### 15.2 Conceptual Questions
3. *What does "Memory-Hardness" mean in modern hashing algorithms like Argon2id?*
   - Answer: A memory-hard algorithm deliberately requires a large amount of physical RAM (e.g., 64MB) to compute a single hash. This neutralizes GPU and ASIC cracking machines, which rely on thousands of tiny, highly parallel cores with very small memory caches.
4. *How does Bcrypt handle password strings longer than 72 bytes?*
   - Answer: Bcrypt silently truncates passwords at 72 bytes due to limitations in the underlying Blowfish block cipher. Any characters beyond the 72nd byte are ignored during hashing and verification.

### 15.3 Implementation Questions
5. *How do you securely handle a "Forgot Password" workflow without storing raw reset tokens in the database?*
   - Answer: Generate a 32-byte cryptographically secure random token using `crypto.randomBytes(32).toString('hex')`. Send this raw token in the reset link emailed to the user. Compute the SHA-256 hash of this token and save the hash (along with an expiration timestamp) in the database. When the user clicks the link, hash their token with SHA-256 and look up the matching record.

### 15.4 Debugging Questions
6. *Your application's CPU spikes to 100% and crashes when 30 users log in concurrently. What is the likely cryptographic cause?*
   - Answer: The Bcrypt cost factor or Argon2 time/memory cost was set too high (e.g., Bcrypt rounds = 16, which takes ~5-10 seconds per hash on a CPU). Lower the cost factor to a sensible production balance (~250ms, rounds = 12) and implement strict rate limiting on the login endpoint.

### 15.5 Scenario Questions
7. *Your company decides to upgrade its legacy user database from MD5 hashes to Argon2id without forcing all users to reset their passwords. How do you design this migration?*
   - Answer: Implement lazy migration on login:
     1. When a user submits their password, check if their stored hash is an MD5 hash.
     2. If MD5, verify `md5(password) === storedHash`.
     3. If valid, immediately hash the plain-text password using Argon2id and overwrite the database record with the new Argon2id hash.
     4. Subsequent logins will use standard Argon2id verification.

### 15.6 Advanced Questions
8. *What is a Timing Attack in password verification and how is it prevented?*
   - Answer: A timing attack occurs when an attacker measures slight differences in the time it takes for a server to reject an invalid input. In standard string comparison (`a === b`), the engine returns `false` as soon as the first non-matching byte is found. In a constant-time comparison (`crypto.timingSafeEqual`), the algorithm always examines every byte regardless of mismatches, ensuring execution time is independent of input correctness.

---

## 16. Coding Questions

### Problem 1: Implement a Secure Password Reset Token Lifecycle Manager
**Question**: Write a TypeScript module that generates a secure password reset token, creates an SHA-256 hash for database persistence, and provides a verification function that uses constant-time comparison to prevent timing attacks.

```typescript
// reset-token-manager.ts
import crypto from "node:crypto";

export interface StoredTokenRecord {
  tokenHash: string;
  expiresAt: Date;
}

export class PasswordResetTokenManager {
  /**
   * Generates a raw token for the user link, and an SHA-256 hash for the DB.
   */
  public static createToken(validityMinutes: number = 15): { rawToken: string; record: StoredTokenRecord } {
    // 32 bytes of cryptographic randomness = 64 hex characters
    const rawToken = crypto.randomBytes(32).toString("hex");

    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + validityMinutes * 60 * 1000);

    return { rawToken, record: { tokenHash, expiresAt } };
  }

  /**
   * Verifies an incoming raw token against the stored DB record.
   */
  public static verifyToken(candidateRawToken: string, stored: StoredTokenRecord): boolean {
    // 1. Check expiration
    if (Date.now() > stored.expiresAt.getTime()) {
      return false; // Token expired
    }

    // 2. Hash candidate token
    const candidateHash = crypto.createHash("sha256").update(candidateRawToken).digest("hex");

    // 3. Constant-Time Comparison
    const candidateBuffer = Buffer.from(candidateHash, "utf8");
    const storedBuffer = Buffer.from(stored.tokenHash, "utf8");

    if (candidateBuffer.length !== storedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(candidateBuffer, storedBuffer);
  }
}

// Verification Test
const { rawToken, record } = PasswordResetTokenManager.createToken(15);
console.log("Raw Token sent in email link:", rawToken);
console.log("Hashed Token stored in DB:", record.tokenHash);

const isValid = PasswordResetTokenManager.verifyToken(rawToken, record);
console.log("Verification valid? (expected true):", isValid); // true

const isInvalid = PasswordResetTokenManager.verifyToken("tampered_token", record);
console.log("Verification invalid? (expected false):", isInvalid); // false
```

---

## 17. Common Interview Traps

- **Trap 1**: "Can you decrypt a Bcrypt hash to get the original password?"
  - *Reality*: Never! Hashing is a one-way mathematical function, not encryption. There is no private key or decryption algorithm. You can only verify candidate passwords by hashing them and comparing the resulting signatures.
- **Trap 2**: "Do you need a separate database column to store the salt?"
  - *Reality*: No. Modern password hashing algorithms (Bcrypt, Argon2, Scrypt) encode the algorithm version, cost parameters, and the salt directly into the resulting hash string.
- **Trap 3**: "Is salting alone enough to make MD5 secure?"
  - *Reality*: No! Salting prevents Rainbow Tables, but because MD5 is still blisteringly fast (billions of hashes/sec), an attacker can easily brute-force salted MD5 hashes. You need both **Salting AND Key-Stretching (Slowness/Memory-Hardness)**.

---

## 18. Revision Summary

- **Fast Hashing is Fatal**: Never use SHA-256 or MD5 for passwords; GPUs crack them in minutes.
- **Key Stretching**: Use deliberately slow, memory-hard algorithms (Argon2id, Bcrypt).
- **Salting**: Unique random salt per user defeats Rainbow Tables; stored directly inside the modular crypt string.
- **Bcrypt Truncation**: Truncates after 72 bytes; Argon2id eliminates this restriction.
- **Reset Tokens**: Store only the SHA-256 hash of password reset tokens in databases; verify via `crypto.timingSafeEqual`.

---

## 19. Quick Reference

```typescript
import argon2 from "argon2";
import bcrypt from "bcrypt";

// Argon2id (OWASP Recommended)
const argonHash = await argon2.hash("myPassword", { type: argon2.argon2id, memoryCost: 65536 });
const isArgonValid = await argon2.verify(argonHash, "myPassword");

// Bcrypt (Standard)
const bcryptHash = await bcrypt.hash("myPassword", 12);
const isBcryptValid = await bcrypt.compare("myPassword", bcryptHash);
```
