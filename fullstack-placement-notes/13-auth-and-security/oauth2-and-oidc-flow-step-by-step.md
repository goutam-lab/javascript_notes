# OAuth 2.0 and OpenID Connect (OIDC): The Complete Handshake Guide

---

## 1. What is it?

**OAuth 2.0** (RFC 6749) is an open-standard authorization framework that enables third-party applications to obtain limited, delegated access to a user's resources on an HTTP service (such as Google Drive or GitHub) without exposing the user's password. It answers the question: *Can Application X act on behalf of User Y to access Resource Z?*

**OpenID Connect (OIDC)** is an identity authentication layer built directly on top of OAuth 2.0. While OAuth 2.0 was designed strictly for **Delegated Authorization** (issuing an `access_token` to call APIs), OIDC extends the framework for **Federated Authentication** ("Log in with Google"), issuing a cryptographically signed JSON Web Token called an **`id_token`** that asserts the user's verified identity, email, and profile metadata.

```
+-------------------------------------------------------------------------------+
|                       OAUTH 2.0 vs OPENID CONNECT (OIDC)                      |
+-------------------------------------------------------------------------------+
| Feature              | OAuth 2.0                      | OpenID Connect (OIDC) |
+----------------------+--------------------------------+-----------------------+
| Core Purpose         | Delegated Authorization        | Federated Identity    |
| Metaphor             | A Valet Key (Limited access)   | A Driver's License    |
| Primary Artifact     | `access_token` (Opaque or JWT) | `id_token` (Always JWT)|
| Target Consumer      | The Resource Server (API)      | The Client Application|
| Typical User Prompt  | "Allow app to read your files?"| "Sign in with Google" |
+----------------------+--------------------------------+-----------------------+
```

---

## 2. Why does it exist?

Before OAuth 2.0, if you wanted Yelp to invite your Google contacts, Yelp would display a form asking:
*"Enter your Google email and password so we can log into your account."*

This anti-pattern (**The Credential Sharing Anti-Pattern**) caused severe security risks:
1. **Unrestricted Access**: Yelp gained the power to read your private emails, delete Google Docs, and read your search history.
2. **Revocation Nightmare**: The only way to stop Yelp from accessing your account was to change your Google password, which broke every other linked application.
3. **Phishing & Credential Theft**: Users became accustomed to entering their Google passwords into third-party websites.

OAuth 2.0 eliminates credential sharing. The user logs in exclusively on Google's trusted domain, and Google issues an access token with strictly scoped permissions (`scope: "contacts.read"`).

---

## 3. Mental Model

Visualize a **Hotel Valet Key & Guest Passport**:

- **OpenID Connect (`id_token`)**: You walk into the hotel lobby and show your Passport to the front desk. The clerk inspects your photo and confirms: *"You are Jane Doe, age 28"* (**Authentication**).
- **OAuth 2.0 (`access_token`)**: You give the hotel valet a special **Valet Key**. The valet key can start the engine and drive the car 5 MPH to the parking lot, but it **cannot** open the glove compartment or the trunk (**Delegated Authorization with Scoped Access**).
- **The Authorization Server**: Google/GitHub (The manufacturer that cuts the keys).
- **The Resource Server**: Google Drive / GitHub Repositories (The vault that holds the data).
- **The Client**: Your application (The guest requesting access).

---

## 4. Basic Example

### 4.1 The 3 Tokens in OIDC
When completing an OIDC login flow, the authorization server returns three distinct tokens:

```json
{
  "access_token": "ya29.a0AfH6SM...",
  "id_token": "eyJhbGciOiJSUzI1NiIs...",
  "refresh_token": "1//04_...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "scope": "openid profile email"
}
```

1. **`id_token` (JWT)**: Consumed by your frontend/backend to know *who logged in* (`sub`, `email`, `name`).
2. **`access_token`**: Handed to the Resource Server's APIs (`https://api.github.com/user`) in the `Authorization: Bearer` header.
3. **`refresh_token`**: Stored securely on the server to obtain new access tokens when the 1-hour access token expires.

---

## 5. Real Example

### The Production Standard: Authorization Code Flow with PKCE (Proof Key for Code Exchange)
Historically, the Authorization Code Flow relied on a `client_secret`. However, in Single Page Applications (React, Next.js) and Mobile Apps, the client secret cannot be kept secret (anyone can open DevTools and read it). 
**PKCE (RFC 7636)** replaces the client secret with dynamic, one-time cryptographic proof:

```
+-------------------------------------------------------------------------------+
|                       AUTHORIZATION CODE FLOW WITH PKCE                       |
+-------------------------------------------------------------------------------+
| Client (Browser / App)          Auth Server (Google)       Your Backend API   |
|      |                                    |                        |          |
|      +-- 1. Generates `code_verifier`     |                        |          |
|      |      and `code_challenge`          |                        |          |
|      |                                    |                        |          |
|      | --- 2. GET /authorize ----------->|                        |          |
|      |        (client_id, scope, state,   |                        |          |
|      |         code_challenge, S256)      |                        |          |
|      |                                    +-- User logs in &       |          |
|      |                                    |   consents to scopes   |          |
|      |                                    |                        |          |
|      | <--- 3. Redirect with `code` ------+                        |          |
|      |         and original `state`       |                        |          |
|      |                                    |                        |          |
|      | --- 4. POST /token --------------->|                        |          |
|      |        (code, code_verifier!)      |                        |          |
|      |                                    +-- Verifies:            |          |
|      |                                    |   SHA256(verifier)     |          |
|      |                                    |   === challenge?       |          |
|      |                                    |   YES!                 |          |
|      | <--- 5. Returns -------------------+                        |          |
|      |         (id_token + access_token)                           |          |
+-------------------------------------------------------------------------------+
```

### Complete Implementation in Node.js / Express
```typescript
// oauth-pkce-controller.ts
import express, { Request, Response } from "express";
import crypto from "node:crypto";
import axios from "axios";

const app = express();

// In-memory session simulation for demonstration
const authSessions = new Map<string, { codeVerifier: string; state: string }>();

// Helper: Base64URL encoding
function base64URLEncode(buffer: Buffer): string {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// Helper: PKCE Challenge Generation
function generatePKCE() {
  // 1. Generate high-entropy verifier (43-128 chars)
  const codeVerifier = base64URLEncode(crypto.randomBytes(32));
  // 2. Compute SHA-256 hash of verifier
  const codeChallenge = base64URLEncode(
    crypto.createHash("sha256").update(codeVerifier).digest()
  );
  return { codeVerifier, codeChallenge };
}

// -------------------------------------------------------------
// STEP 1: Redirect User to Identity Provider (Google Login)
// -------------------------------------------------------------
app.get("/auth/google", (req: Request, res: Response) => {
  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = base64URLEncode(crypto.randomBytes(16)); // CSRF protection

  // Store verifier and state in session
  authSessions.set(state, { codeVerifier, state });

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  authUrl.searchParams.set("redirect_uri", "http://localhost:3000/auth/google/callback");
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  res.redirect(authUrl.toString());
});

// -------------------------------------------------------------
// STEP 2: Handle OAuth Callback & Exchange Code for Tokens
// -------------------------------------------------------------
app.get("/auth/google/callback", async (req: Request, res: Response) => {
  const { code, state } = req.query as { code?: string; state?: string };

  if (!code || !state) {
    return res.status(400).send("Missing code or state");
  }

  // 1. CSRF Defense: Validate state matches our session!
  const sessionData = authSessions.get(state);
  if (!sessionData || sessionData.state !== state) {
    return res.status(403).send("Invalid OAuth state parameter (Possible CSRF Attack!)");
  }

  // Clean up session state
  authSessions.delete(state);

  try {
    // 2. Exchange authorization code + code_verifier for tokens
    const tokenResponse = await axios.post("https://oauth2.googleapis.com/token", {
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      code,
      code_verifier: sessionData.codeVerifier, // The PKCE secret!
      grant_type: "authorization_code",
      redirect_uri: "http://localhost:3000/auth/google/callback",
    });

    const { id_token, access_token } = tokenResponse.data;

    // 3. Decode & verify id_token to retrieve user identity
    // (In production, verify JWT signature against Google's JWKS endpoint!)
    const base64Payload = id_token.split(".")[1];
    const userProfile = JSON.parse(Buffer.from(base64Payload, "base64").toString("utf8"));

    console.log("Authenticated User Profile:", {
      googleSub: userProfile.sub,
      email: userProfile.email,
      name: userProfile.name,
      picture: userProfile.picture,
    });

    // Create local application session or JWT...
    res.json({ message: "Login successful!", user: userProfile });
  } catch (err: any) {
    console.error("Token exchange failed:", err.response?.data || err.message);
    res.status(500).send("Authentication failed");
  }
});
```

---

## 6. Under the Hood

### 6.1 The 4 Core Roles in OAuth 2.0
1. **Resource Owner**: The human end-user who owns the data (e.g., You).
2. **Client**: The application requesting access to the resource (e.g., Your Express/React web app).
3. **Authorization Server**: The server that authenticates the user, obtains consent, and issues tokens (e.g., `accounts.google.com`).
4. **Resource Server**: The API hosting the protected user resources (e.g., `gmail.googleapis.com`).

### 6.2 Why the `state` Parameter is Mandatory (CSRF Protection)
Without the `state` parameter, an attacker can launch an **OAuth Login CSRF Attack**:
1. The attacker starts the Google login flow on your website, but intercepts the callback redirect before the browser exchanges the code.
2. The attacker tricks the victim into clicking a link that finishes the callback: `https://yourapp.com/callback?code=ATTACKER_CODE`.
3. The victim's browser sends the request. The server exchanges the code and links the victim's session to the **attacker's Google account**!
4. The victim now uploads private documents or enters credit cards into what they think is their account, while the attacker can log in and view everything!
- **The Defense**: The client generates a random cryptographic `state` string, saves it in a secure cookie, and verifies that the `state` returned in the callback matches.

### 6.3 Why the Implicit Grant is Deprecated
Historically, SPAs used the **Implicit Flow**, where the access token was returned directly in the URL hash (`#access_token=xyz`) without an intermediate authorization code exchange.
- *The Flaw*: Access tokens leaked in browser history, proxy server logs, and HTTP `Referer` headers.
- *Modern Standard*: **OAuth 2.1 officially bans the Implicit Flow**. All clients (SPAs, mobile, backend) must use the **Authorization Code Flow with PKCE**.

---

## 7. Important Rules

1. **Always Use PKCE for All Clients**: PKCE is no longer just for mobile apps; modern OAuth 2.1 requires PKCE for SPAs and traditional backend web apps as well.
2. **Never Skip `state` Validation**: Reject any callback where the returned `state` is missing or does not match the stored session value.
3. **Verify the `id_token` Cryptographic Signature**: Do not just decode the base64 payload of an `id_token`! In production, fetch the provider's public keys from their **JWKS endpoint** (`https://www.googleapis.com/oauth2/v3/certs`) and verify the signature using `RS256`.
4. **Never Pass `access_token` in Query Strings**: Tokens must always be passed in the `Authorization: Bearer <token>` header.

---

## 8. Common Mistakes

### Mistake 1: Confusing OAuth 2.0 with OIDC
Using vanilla OAuth 2.0 for user login without OIDC means the client has no standard way to verify *who* logged in. Developers hack around this by calling the provider's `/userinfo` API. OIDC standardizes authentication by returning a cryptographically signed `id_token`.

### Mistake 2: Hardcoding Redirect URIs
If the `redirect_uri` passed to the authorization endpoint does not **byte-for-byte match** the `redirect_uri` configured in the Google/GitHub Developer Console, the provider will reject the request with `redirect_uri_mismatch`.

---

## 9. Best Practices

1. **Request Minimal Scopes**: Only request the exact scopes needed (e.g. `openid email profile`). Requesting excessive permissions (`https://mail.google.com/`) alarms users, causing 80%+ drop-off during consent screens.
2. **Handle Account Linking Securely**: If a user previously registered with email/password (`alice@gmail.com`) and later clicks "Log in with Google", only link the accounts automatically if the identity provider asserts that the email is verified (`email_verified: true` in the `id_token`).
3. **Implement Discovery via `/.well-known/openid-configuration`**: Instead of hardcoding authorization URLs, token URLs, and JWKS endpoints, query the provider's OpenID Discovery document to configure endpoints dynamically.

---

## 10. Performance Considerations

- **JWKS Key Caching**: When verifying `id_token` signatures, never fetch the JWKS key file on every request. Cache the JWKS public keys in memory for 24 hours, invalidating the cache only when a token specifies a key ID (`kid`) that is not present in the local cache.

---

## 11. Security Considerations

1. **Open Redirector Exploits**: Ensure the `redirect_uri` registered in your OAuth provider is an exact, absolute URL, never a wildcard regex (e.g. `https://mycompany.com/*`). Wildcards allow attackers to redirect authorization codes to their own malicious servers.
2. **Token Substitution Attacks**: In multi-client setups, verify that the `aud` (Audience) claim in the `id_token` matches your specific `client_id`, preventing tokens issued for another app from being accepted by yours.

---

## 12. Alternatives

| Technology | Role | Best Use Case |
| :--- | :--- | :--- |
| **OIDC / OAuth 2.0** | Federated modern identity. | Consumer apps, B2B SaaS, mobile SSO. |
| **SAML 2.0** | Enterprise XML-based SSO. | Legacy corporate intranets, government systems. |
| **Passkeys / WebAuthn** | Passwordless biometric auth. | Modern zero-password client logins. |

---

## 13. Trade-offs

- **Social Login vs Local Password Auth**:
  - *Social Login (OIDC)*: High conversion rate (one-click signup), zero password reset support tickets, security offloaded to Google. However, you are dependent on a third party; if a user loses their Google account, they lose access to your service.

---

## 14. Real-World Usage

- **Sign in with Apple / Google / GitHub**: Standard OIDC login powering millions of apps worldwide.
- **Shopify & Slack App Stores**: Use OAuth 2.0 to grant third-party plugins granular access to store orders and channel messages.

---

## 15. Placement Interview Questions

### 15.1 Basic Questions
1. *What is the difference between OAuth 2.0 and OpenID Connect (OIDC)?*
   - Answer: OAuth 2.0 is an authorization framework designed for delegated resource access (granting permissions to an API via an `access_token`). OpenID Connect is an authentication layer built on top of OAuth 2.0 that provides identity verification (asserting who the user is via an `id_token`).
2. *What is PKCE and why was it created?*
   - Answer: PKCE (Proof Key for Code Exchange) is an extension to the OAuth 2.0 Authorization Code Flow. It replaces static client secrets with dynamically generated cryptographic challenges (`code_verifier` and `code_challenge`), preventing attackers from intercepting authorization codes and exchanging them for tokens in public clients (SPAs and mobile apps).

### 15.2 Conceptual Questions
3. *Why does OAuth use an intermediate "Authorization Code" instead of returning the Access Token directly in the first redirect?*
   - Answer: To keep the access token secure. The initial redirect passes through the user's browser URL bar and browser history, where query parameters are exposed to browser extensions, history logs, and HTTP referer headers. The authorization code is a short-lived (typically 60-second), one-time-use credential. The actual token exchange happens via a secure, backchannel HTTP POST request directly between the application server and the authorization server.
4. *What security purpose does the `state` parameter serve in the OAuth flow?*
   - Answer: It protects against Cross-Site Request Forgery (CSRF) on the OAuth callback endpoint. By associating a random cryptographic string with the user's session before redirecting to the provider and validating it when the callback arrives, the server ensures that the user completing the flow is the same user who initiated it.

### 15.3 Implementation Questions
5. *How do you derive a PKCE `code_challenge` from a `code_verifier` in Node.js?*
   - Answer:
     ```typescript
     const codeChallenge = crypto
       .createHash("sha256")
       .update(codeVerifier)
       .digest("base64")
       .replace(/\+/g, "-")
       .replace(/\//g, "_")
       .replace(/=/g, "");
     ```

### 15.4 Debugging Questions
6. *A user attempts to log in with Google, but Google displays the error: `Error 400: redirect_uri_mismatch`. What is the fix?*
   - Answer: The `redirect_uri` parameter sent in the authorization request does not exactly match any of the Authorized Redirect URIs listed in the Google Cloud Console for that OAuth Client ID. Check for trailing slashes, `http` vs `https`, or mismatched ports.

### 15.5 Scenario Questions
7. *How should an application handle a scenario where a user logs in with "Sign in with Google", but their email already exists in your database from an earlier email/password registration?*
   - Answer: Check if Google asserts that the email is verified (`email_verified === true` in the `id_token`). If verified, link the Google `sub` identity to the existing user record and allow login. If `email_verified` is false or not provided, refuse automatic linking and prompt the user to authenticate with their password first to confirm account ownership.

### 15.6 Advanced Questions
8. *What is the JWKS (JSON Web Key Set) endpoint and how does an OIDC client use it to verify an `id_token`?*
   - Answer: The JWKS endpoint (e.g. `https://www.googleapis.com/oauth2/v3/certs`) is a publicly accessible URL hosted by the identity provider that publishes an array of public cryptographic keys in JSON format. The OIDC client inspects the `kid` (Key ID) header in the incoming `id_token`, finds the matching public key from the JWKS document, and uses it to verify the RSA or ECDSA digital signature.

---

## 16. Coding Questions

### Problem 1: Implement an OAuth State and PKCE Generator
**Question**: Write a TypeScript utility module that generates a complete PKCE parameter set (`codeVerifier`, `codeChallenge`) and a secure `state` parameter, returning everything needed to initiate an OAuth 2.0 authorization request.

```typescript
// pkce-helper.ts
import crypto from "node:crypto";

export interface OAuthInitParams {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state: string;
}

export function createOAuthInitParams(): OAuthInitParams {
  // 1. Generate 32 bytes of cryptographically secure randomness
  const verifierBytes = crypto.randomBytes(32);
  const codeVerifier = verifierBytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  // 2. Compute SHA-256 hash of the verifier
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  const codeChallenge = hash
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  // 3. Generate CSRF state token
  const state = crypto.randomBytes(16).toString("hex");

  return {
    codeVerifier,
    codeChallenge,
    codeChallengeMethod: "S256",
    state,
  };
}

// Verification Test
const params = createOAuthInitParams();
console.log("Code Verifier (secret):", params.codeVerifier);
console.log("Code Challenge (sent in URL):", params.codeChallenge);
console.log("State Parameter:", params.state);
```

---

## 17. Common Interview Traps

- **Trap 1**: "Is OAuth 2.0 an authentication protocol?"
  - *Reality*: No! OAuth 2.0 is strictly an **authorization** protocol for delegated access. **OpenID Connect (OIDC)** is the authentication protocol built on top of OAuth 2.0.
- **Trap 2**: "Does the frontend React app need the `client_secret` when using PKCE?"
  - *Reality*: No! The entire point of PKCE is that public clients (React, Next.js, mobile apps) **do not use or need a `client_secret`**.
- **Trap 3**: "Can an `access_token` be decoded by the frontend to read user profile details?"
  - *Reality*: No. The `access_token` is meant for the Resource Server and is often an opaque string. The frontend should read user profile claims exclusively from the **`id_token`**.

---

## 18. Revision Summary

- **OAuth 2.0**: Delegated authorization framework; issues `access_token` for APIs.
- **OIDC**: Authentication identity layer on top of OAuth; issues signed `id_token` (JWT).
- **PKCE**: Mandatory flow replacing client secrets with dynamic SHA-256 challenges (`code_verifier` + `code_challenge`).
- **CSRF Defense**: The `state` parameter prevents OAuth login CSRF attacks.
- **Tokens**: `id_token` (Identity for client), `access_token` (Permission for API), `refresh_token` (Long-term renewal).

---

## 19. Quick Reference

```typescript
// 1. Authorization URL Construction
const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}` +
  `&response_type=code&scope=openid%20email%20profile` +
  `&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

// 2. Token Exchange POST
const res = await axios.post("https://oauth2.googleapis.com/token", {
  client_id: CLIENT_ID,
  code: authCode,
  code_verifier: codeVerifier,
  grant_type: "authorization_code",
  redirect_uri: REDIRECT_URI,
});
```
