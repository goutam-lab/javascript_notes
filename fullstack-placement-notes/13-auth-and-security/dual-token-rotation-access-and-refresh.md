# Dual-Token Architecture: Access Tokens, Refresh Tokens, and Rotation (RTR)

---

## 1. What is it?

The **Dual-Token Architecture** is the industry-standard authentication pattern designed to resolve the fundamental conflict between security (short token lifetimes to limit damage from stolen tokens) and user experience (long-lived sessions so users aren't forced to re-enter passwords every 15 minutes).

It operates using two distinct tokens:
1. **Access Token**: A short-lived (typically 5 to 15 minutes), stateless JWT containing user identity and permissions. It is sent on every HTTP request header (`Authorization: Bearer <token>`) and verified in memory by backend microservices.
2. **Refresh Token**: A long-lived (typically 7 to 30 days), stateful, high-entropy cryptographic token persisted in a database or Redis store. Its sole purpose is to obtain a new Access Token when the current one expires.

**Refresh Token Rotation (RTR)** is an advanced security mechanism where **every time a Refresh Token is used to obtain a new Access Token, the old Refresh Token is immediately invalidated, and a brand new Refresh Token is issued**. If an attacker steals a Refresh Token and attempts to use it after the legitimate user has already rotated it, the server detects **Token Reuse**, identifies an active breach, and immediately revokes the entire **Token Family**, locking out the attacker and protecting the user.

```
+-------------------------------------------------------------------------------+
|                       REFRESH TOKEN ROTATION & THEFT DETECTION                |
+-------------------------------------------------------------------------------+
| Legitimate User                                           Server (DB / Redis) |
|      |                                                            |           |
|      | --- 1. POST /refresh (Presents Refresh Token A) ---------> |           |
|      |                                                            +-- Token A |
|      |                                                            |   Valid?  |
|      |                                                            |   YES!    |
|      |                                                            +-- Invalid-|
|      |                                                            |   ates A  |
|      |                                                            +-- Creates |
|      | <--- 2. Issues (Access Token 2 + Refresh Token B) -------- |   Token B |
|                                                                               |
| ===================== COMPROMISED ATTACK SCENARIO =========================== |
| Malicious Attacker (Possesses stolen copy of Token A)                         |
|      |                                                            |           |
|      | --- 3. POST /refresh (Presents Stolen Token A) ----------> |           |
|      |                                                            +-- Token A |
|      |                                                            |   Valid?  |
|      |                                                            |   NO! It  |
|      |                                                            |   is ALREADY|
|      |                                                            |   USED!   |
|      |                                                            |           |
|      |                                                            +-- THEFT   |
|      |                                                            |   DETECTED!
|      |                                                            +-- REVOKES |
|      |                                                            |   ENTIRE  |
|      |                                                            |   FAMILY! |
|      | <--- 4. HTTP 401 Unauthorized (Tokens Banned) ------------ |   (Token B|
|                                                                       dead!)  |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Consider the dilemmas of single-token authentication:
- **Case 1: Access Token expires in 30 days**: If an attacker steals the token via network sniffing or an XSS vulnerability, they have unrestricted access to the user's account for a full month. The server cannot revoke it statelessly.
- **Case 2: Access Token expires in 10 minutes**: Secure against theft, but the user is booted to the login screen and forced to re-type their password every 10 minutes.

The Dual-Token Architecture solves both problems:
1. **Minimizes Breach Window**: If an access token is intercepted, it becomes useless within 10 minutes.
2. **Seamless User Experience**: The client application automatically refreshes access tokens silently in the background without user intervention.
3. **Automatic Intrusion Detection (RTR)**: Refresh Token Rotation turns token theft into an active tripwire that triggers automatic account defense.

---

## 3. Mental Model

Visualize a **Secure Corporate Skyscraper (High-Security Facility)**:

- **The Access Token (Visitor Badge Sticker)**: A paper sticker printed with the current time that expires every 15 minutes. It lets you open standard office doors. If you drop it on the floor, whoever finds it can only use it for the remaining 8 minutes before security guards ignore it.
- **The Refresh Token (High-Security Keycard in the Vault)**: Locked in your biometric briefcase. You don't wave it at every door. You only present it to the security desk on Floor 1.
- **Refresh Token Rotation (The One-Time Keycard Exchange)**:
  - When your 15-minute badge expires, you present Keycard A to the desk.
  - The guard takes Keycard A, puts it through a shredder, and hands you Keycard B plus a fresh 15-minute sticker.
- **Theft Detection**:
  - Suppose a spy stole a clone of Keycard A.
  - You used Keycard A at 12:00 PM (shredding it and receiving Keycard B).
  - At 12:05 PM, the spy walks up to the desk and presents the cloned Keycard A.
  - The guard gasps: *"Keycard A was already shredded 5 minutes ago! We have a security breach!"*
  - The guard sounds the alarm, deactivates Keycard B, locks all elevators, and forces everyone to show physical passports at the front desk.

---

## 4. Basic Example

### 4.1 Token Issuance and Refresh Endpoint
```typescript
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { Request, Response } from "express";

const ACCESS_SECRET = "access-secret-15m";
const REFRESH_SECRET = "refresh-secret-7d";

// Generate Token Pair
export function generateTokenPair(userId: string, familyId: string = crypto.randomUUID()) {
  const accessToken = jwt.sign({ sub: userId }, ACCESS_SECRET, { expiresIn: "15m" });
  const refreshToken = jwt.sign({ sub: userId, familyId }, REFRESH_SECRET, { expiresIn: "7d" });

  return { accessToken, refreshToken, familyId };
}

// Storing Refresh Token in Secure HttpOnly Cookie
export function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 15 * 60 * 1000, // 15 mins
  });

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/refresh", // Scoped strictly to refresh endpoint!
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}
```

---

## 5. Real Example

### Production Refresh Token Rotation with Token Family Reuse Detection
```typescript
// refresh-token-service.ts
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

export interface RefreshTokenRecord {
  tokenHash: string;
  userId: string;
  familyId: string;
  isUsed: boolean;
  expiresAt: Date;
}

export class RefreshTokenService {
  // Simulated database collection: token_records
  private static tokenDb = new Map<string, RefreshTokenRecord>();

  /**
   * Rotates a refresh token.
   * If reuse is detected, revokes the entire token family!
   */
  public static async rotateRefreshToken(
    rawIncomingToken: string
  ): Promise<{ newAccessToken: string; newRefreshToken: string; userId: string }> {
    let decoded: any;
    try {
      decoded = jwt.verify(rawIncomingToken, process.env.REFRESH_SECRET || "refresh-secret-7d");
    } catch (err) {
      throw new Error("Invalid or expired refresh token");
    }

    const { sub: userId, familyId } = decoded;
    const incomingTokenHash = crypto.createHash("sha256").update(rawIncomingToken).digest("hex");

    const existingRecord = this.tokenDb.get(incomingTokenHash);

    // 1. REUSE DETECTION: Token exists but is ALREADY MARKED AS USED!
    if (existingRecord && existingRecord.isUsed) {
      console.error(`🚨 CRITICAL SECURITY ALERT: Refresh token reuse detected for user ${userId}!`);
      console.error(`Family ID ${familyId} compromised. Revoking entire token family...`);

      // BREACH PROTOCOL: Revoke all tokens belonging to this family!
      for (const [hash, record] of this.tokenDb.entries()) {
        if (record.familyId === familyId) {
          this.tokenDb.delete(hash);
        }
      }

      throw new Error("Security Alert: Token reuse detected. Please log in again.");
    }

    // 2. Token not found in database (invalid or already revoked)
    if (!existingRecord) {
      throw new Error("Refresh token unrecognized or revoked");
    }

    // 3. Mark current token as USED
    existingRecord.isUsed = true;
    this.tokenDb.set(incomingTokenHash, existingRecord);

    // 4. Generate NEW Token Pair under the SAME Family ID
    const newAccessToken = jwt.sign({ sub: userId }, process.env.ACCESS_SECRET || "access-secret", {
      expiresIn: "15m",
    });

    const newRefreshToken = jwt.sign(
      { sub: userId, familyId },
      process.env.REFRESH_SECRET || "refresh-secret-7d",
      { expiresIn: "7d" }
    );

    const newTokenHash = crypto.createHash("sha256").update(newRefreshToken).digest("hex");

    // Save new token record
    this.tokenDb.set(newTokenHash, {
      tokenHash: newTokenHash,
      userId,
      familyId,
      isUsed: false,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    return { newAccessToken, newRefreshToken, userId };
  }
}
```

---

## 6. Under the Hood

### 6.1 The Token Family Concept
A **Token Family** represents a single continuous lineage of authenticated sessions originating from a single login action:

```
[ User Logs In ] ---> Generates Family #101
                           |
                           v
              [ Refresh Token 1 (Active) ]
                           |
            (Rotated after 15 minutes)
                           v
              [ Refresh Token 1 (Used) ] ---> [ Refresh Token 2 (Active) ]
                                                     |
                                      (Rotated after 15 minutes)
                                                     v
                                        [ Refresh Token 2 (Used) ] ---> [ Refresh Token 3 (Active) ]
```

- When Token 1 is rotated to Token 2, Token 1 is marked `isUsed: true`.
- If an attacker intercepts Token 1 and attempts to use it, the server sees `Token 1.isUsed === true`.
- The server identifies this as **Theft / Concurrent Usage** and executes:
  `DELETE FROM refresh_tokens WHERE family_id = 101`.
- Token 3 (currently held by the legitimate user) is deleted, forcing the user to re-authenticate with their password, stopping the attacker cold.

### 6.2 Frontend Silent Refresh with Axios Interceptors
How does a frontend application handle a 401 error seamlessly without flashing the login screen?

```typescript
// frontend-api-client.ts (Axios Interceptor Pattern)
import axios from "axios";

const api = axios.create({ baseURL: "/api" });

let isRefreshing = false;
let failedQueue: Array<{ resolve: (token: string) => void; reject: (err: any) => void }> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) prom.reject(error);
    else prom.resolve(token!);
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If request failed with 401 and hasn't been retried yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // Queue concurrent requests while token is refreshing
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(() => api(originalRequest));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // Request token rotation (reads HttpOnly refreshToken cookie automatically)
        await axios.post("/api/auth/refresh");
        processQueue(null);
        return api(originalRequest); // Replay original request!
      } catch (refreshError) {
        processQueue(refreshError, null);
        window.location.href = "/login"; // Force re-login if refresh fails
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);
```

---

## 7. Important Rules

1. **Path-Scope the Refresh Cookie**: Always set `Path=/api/auth/refresh` on the Refresh Token cookie. This ensures the browser only sends the heavy, sensitive refresh token when contacting the refresh endpoint, withholding it from standard API calls.
2. **Never Return Raw Refresh Tokens in JSON Responses for Web Apps**: Return Refresh Tokens exclusively in `HttpOnly`, `Secure` cookies to prevent XSS exfiltration.
3. **Always Hash Refresh Tokens Before Storing in DB**: Storing raw refresh tokens in PostgreSQL or Redis creates an internal vulnerability if the database is leaked. Hash them with SHA-256.
4. **Enforce Absolute Lifetime Limits**: Even with rotation, enforce an absolute maximum session age (e.g., 30 days) after which a user MUST re-enter their password.

---

## 8. Common Mistakes

### Mistake 1: Storing Refresh Tokens in `localStorage`
```typescript
// ❌ CRITICAL XSS VULNERABILITY
localStorage.setItem("refreshToken", token); // Any injected XSS script can steal this!
```
*Correction*: Store Refresh Tokens in `HttpOnly`, `Secure`, `SameSite=Lax` cookies.

### Mistake 2: Missing Concurrency Locks during Refresh (The Race Condition Trap)
If a web page loads and immediately fires 5 parallel API requests (`Promise.all([fetchUsers, fetchPosts, fetchSettings])`), all 5 receive a 401 simultaneously. If all 5 hit `/api/auth/refresh` at the same time:
- Request #1 rotates the token.
- Request #2 arrives 10ms later with the old token.
- The server interprets Request #2 as a **Theft Reuse Attack** and revokes the user's session!
*Correction*: The frontend must maintain an `isRefreshing` queue to serialize refresh calls, or the backend must allow a **15-second grace period** before treating a rotated token as an active breach.

---

## 9. Best Practices

1. **Implement a 15-Second Grace Period for Network Retries**: When rotating a token, permit the immediate predecessor token to be reused for 10-15 seconds to prevent network jitter or parallel HTTP requests from triggering false-positive theft detections.
2. **Revoke on Password Change**: When a user changes their password, immediately delete all token records for that `userId` across all families.
3. **Include Client Fingerprints in Refresh Records**: Store user-agent and IP country in the token record to alert users of anomalous geographical refreshes.

---

## 10. Performance Considerations

```
+-------------------------------------------------------------------------------+
|                       DUAL TOKEN NETWORK & DB PERFORMANCE                     |
+-------------------------------------------------------------------------------+
| Action                                | Frequency      | Overhead             |
+---------------------------------------+----------------+----------------------+
| Standard API Call (Access Token)      | Every request  | 0 DB calls (JWT verify)|
| Token Rotation (Refresh Token)        | Every 15 mins  | 1 DB Write / Hash    |
| Reuse Detection Query                 | On refresh     | 1 Key Lookup in Redis|
+---------------------------------------+----------------+----------------------+
```

- In a system with 100,000 active users making 1,000 requests per day:
  - Total API calls: 100,000,000 requests (0 database auth lookups!).
  - Total refresh calls: ~1,000,000 refresh operations spread over 24 hours ($\approx 11$ writes/sec in Redis).
  - This architecture delivers **99% reduction in database authentication load** compared to stateful session lookups!

---

## 11. Security Considerations

1. **Cross-Site Request Forgery (CSRF) on Refresh Endpoint**: Because the refresh token is stored in an `HttpOnly` cookie, ensure the `/api/auth/refresh` endpoint requires a custom header (`X-Requested-With` or CSRF token) or uses `SameSite=Strict/Lax`.
2. **Denial of Service via Parallel Refresh Storms**: Rate limit the `/refresh` endpoint (e.g. max 10 requests per minute per IP).

---

## 12. Alternatives

| Mechanism | Security Level | Complexity | Best For |
| :--- | :--- | :--- | :--- |
| **Pure Short-Lived JWT** | Low (Frequent logouts) | Low | Internal microservices. |
| **Pure Long-Lived JWT** | Dangerous (No revocation) | Low | Public non-sensitive data APIs. |
| **Dual Token with RTR** | Exceptional (OWASP standard) | Moderate | Production SaaS, consumer web apps. |
| **Stateful Redis Sessions** | High | Low | Monoliths with low cross-service traffic. |

---

## 13. Trade-offs

- **Security vs Complexity**: Refresh Token Rotation is significantly more complex to implement than simple JWTs or basic cookies, requiring frontend interceptor queues, backend token family tables, and race-condition grace periods. However, it is the only pattern that provides both stateless microservice speed and active token theft defense.

---

## 14. Real-World Usage

- **Auth0 / Okta / Supabase**: Use Refresh Token Rotation with Token Family reuse detection as the default authentication architecture for Single Page Applications (SPAs) and mobile apps.
- **Google Cloud SDK (`gcloud`)**: Uses rotating refresh tokens to generate temporary OAuth access tokens for CLI commands.

---

## 15. Placement Interview Questions

### 15.1 Basic Questions
1. *What are the respective lifespans and storage locations of an Access Token and a Refresh Token?*
   - Answer: An Access Token is short-lived (5-15 minutes) and stored in client memory or a secure cookie. A Refresh Token is long-lived (7-30 days) and stored in an `HttpOnly`, `Secure` cookie (with `Path=/api/auth/refresh`) and backed by a database or Redis record.
2. *Why is storing refresh tokens in `localStorage` an anti-pattern?*
   - Answer: `localStorage` is accessible to any JavaScript running on the page. If the site is vulnerable to Cross-Site Scripting (XSS) through a malicious dependency or unescaped input, an attacker can steal the refresh token and gain long-term unauthorized access.

### 15.2 Conceptual Questions
3. *What is Refresh Token Rotation (RTR) and how does it prevent token theft?*
   - Answer: RTR is a security protocol where every time a refresh token is used to generate a new access token, the current refresh token is invalidated and replaced with a newly generated one. If an attacker steals a refresh token and attempts to use it after the legitimate user has already rotated it, the server detects reuse of an invalidated token and immediately revokes all tokens in that family.
4. *What is a "Token Family" in RTR?*
   - Answer: A Token Family is a lineage identifier (`familyId`) shared across an unbroken chain of rotated refresh tokens originating from a single login event. If any token in the family is detected as reused or compromised, the server revokes the entire family, terminating both the attacker's and the victim's active sessions.

### 15.3 Implementation Questions
5. *How do you prevent race conditions when multiple concurrent frontend requests trigger a token refresh simultaneously?*
   - Answer: On the frontend, use an Axios/Fetch response interceptor with a mutex/promise queue (`isRefreshing`) to ensure only the first failed request triggers `/refresh`, while subsequent requests await the new token. On the backend, implement a 10-15 second grace period where an immediately retired predecessor token can still be exchanged without triggering reuse alarms.

### 15.4 Debugging Questions
6. *A user reports being randomly logged out when opening 4 dashboard tabs simultaneously. What is the bug?*
   - Answer: All 4 tabs detected an expired access token and hit `/api/auth/refresh` in parallel. Tab 1 rotated the token successfully; Tabs 2, 3, and 4 presented the old token within milliseconds. The backend server lacked a concurrency grace period, flagged Tabs 2-4 as a token reuse attack, and revoked the entire token family, logging the user out.

### 15.5 Scenario Questions
7. *How would you implement a "Sign out of all other sessions" feature in a Dual-Token Architecture?*
   - Answer: Store a `token_families` table in PostgreSQL or Redis. When a user requests to sign out of all other sessions, delete all token families for that `userId` *except* the `familyId` associated with the current refresh token.

### 15.6 Advanced Questions
8. *Why should the Refresh Token cookie specify `Path=/api/auth/refresh`?*
   - Answer: By default, cookies are sent on every request to the domain. Restricting the cookie path to `/api/auth/refresh` ensures the browser only transmits the refresh token when calling the refresh endpoint. This reduces HTTP request header overhead on all regular API routes and shields the refresh token from exposure on ordinary endpoints.

---

## 16. Coding Questions

### Problem 1: Implement an In-Memory Token Family Manager with Grace Period
**Question**: Write a TypeScript `TokenFamilyManager` that implements Refresh Token Rotation. It must permit a 10-second grace period for network retries of the immediate predecessor token, but trigger a full family revocation if an older token is reused.

```typescript
// token-family-manager.ts

interface TokenNode {
  tokenId: string;
  familyId: string;
  isUsed: boolean;
  rotatedAt?: number;
}

export class TokenFamilyManager {
  private tokens = new Map<string, TokenNode>();
  private readonly gracePeriodMs = 10000; // 10-second grace period

  public registerNewFamily(familyId: string, initialTokenId: string): void {
    this.tokens.set(initialTokenId, {
      tokenId: initialTokenId,
      familyId,
      isUsed: false,
    });
  }

  public rotate(oldTokenId: string, newTokenId: string): { success: boolean; compromised: boolean } {
    const existing = this.tokens.get(oldTokenId);

    if (!existing) {
      return { success: false, compromised: false }; // Token doesn't exist
    }

    const now = Date.now();

    // 1. CHECK REUSE
    if (existing.isUsed) {
      // If rotated within grace period, allow it (network race condition tolerance)
      if (existing.rotatedAt && now - existing.rotatedAt < this.gracePeriodMs) {
        console.warn(`[Grace Period] Duplicate refresh within grace period (${now - existing.rotatedAt}ms). Permitted.`);
        return { success: true, compromised: false };
      }

      // OUTSIDE GRACE PERIOD: Real breach detected!
      console.error(`🚨 THEFT DETECTED! Token ${oldTokenId} reused. Revoking family ${existing.familyId}!`);
      this.revokeFamily(existing.familyId);
      return { success: false, compromised: true };
    }

    // 2. NORMAL ROTATION
    existing.isUsed = true;
    existing.rotatedAt = now;
    this.tokens.set(oldTokenId, existing);

    // Register child token
    this.tokens.set(newTokenId, {
      tokenId: newTokenId,
      familyId: existing.familyId,
      isUsed: false,
    });

    return { success: true, compromised: false };
  }

  public revokeFamily(familyId: string): void {
    for (const [id, token] of this.tokens.entries()) {
      if (token.familyId === familyId) {
        this.tokens.delete(id);
      }
    }
  }

  public isTokenValid(tokenId: string): boolean {
    const token = this.tokens.get(tokenId);
    return !!token && !token.isUsed;
  }
}

// Verification Test
const manager = new TokenFamilyManager();
manager.registerNewFamily("fam_1", "tok_A");

// First rotation: tok_A -> tok_B
console.log("Rotate tok_A -> tok_B:", manager.rotate("tok_A", "tok_B")); // success: true

// Legitimate user uses tok_B -> tok_C
console.log("Rotate tok_B -> tok_C:", manager.rotate("tok_B", "tok_C")); // success: true

// Attacker tries to use old tok_A after grace period!
// (Simulate time passing)
const oldToken = (manager as any).tokens.get("tok_A");
oldToken.rotatedAt = Date.now() - 20000; // 20 seconds ago

const attackResult = manager.rotate("tok_A", "tok_HACK");
console.log("Attacker result (expected compromised: true):", attackResult);
console.log("Is tok_C still valid? (expected false, family nuked):", manager.isTokenValid("tok_C")); // false
```

---

## 17. Common Interview Traps

- **Trap 1**: "Does Refresh Token Rotation make Access Tokens obsolete?"
  - *Reality*: No! Access tokens are short-lived, stateless, and checked rapidly in memory. Refresh tokens are stateful and checked against a database. Removing access tokens forces every request to hit the database, defeating scalability.
- **Trap 2**: "Does Token Reuse Detection guarantee that an attacker never gets access?"
  - *Reality*: If an attacker uses the stolen refresh token *before* the legitimate user does, the attacker gets a valid token, and the legitimate user is the one who later triggers the reuse alarm. However, the alarm still terminates the attacker's session immediately when the user attempts to refresh.
- **Trap 3**: "Can refresh tokens be stored without an expiration date?"
  - *Reality*: No. Refresh tokens must have an absolute expiration date (e.g. 14 to 30 days) to prevent permanent session persistence.

---

## 18. Revision Summary

- **Dual-Token Model**: Short-lived Access Token (15m, stateless JWT) + Long-lived Refresh Token (7-30d, stateful DB).
- **RTR Protocol**: Every refresh operation invalidates the current refresh token and issues a new one.
- **Theft Detection**: If an invalidated refresh token is reused, the entire token family is revoked immediately.
- **Storage**: Access Token in memory or cookie; Refresh Token in `HttpOnly`, `Secure`, `Path=/api/auth/refresh` cookie.
- **Concurrency**: Frontend response interceptor queues and backend grace periods prevent false-positive lockouts.

---

## 19. Quick Reference

```typescript
// 1. Generation
const accessToken = jwt.sign({ sub: userId }, ACCESS_SECRET, { expiresIn: "15m" });
const refreshToken = jwt.sign({ sub: userId, familyId }, REFRESH_SECRET, { expiresIn: "7d" });

// 2. Cookie Setup
res.cookie("refreshToken", refreshToken, {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/api/auth/refresh",
  maxAge: 7 * 86400000,
});

// 3. Reuse Check
if (storedToken.isUsed) {
  await revokeAllTokensInFamily(storedToken.familyId);
  return res.status(401).json({ error: "Compromised token detected" });
}
```
