# Authentication vs Authorization: The Mental Model and Architecture

---

## 1. What is it?

In software security and backend systems engineering, security access control is divided into two distinct, sequential phases that are frequently conflated:

1. **Authentication (AuthN — "Who are you?")**: The process of verifying the declared identity of a user, service, or client. It answers the question: *Is this entity who they claim to be?* This is achieved through credentials (passwords, TOTP two-factor codes, biometrics, signed cryptographic assertions, or digital certificates).
2. **Authorization (AuthZ — "What are you allowed to do?")**: The process of determining whether an authenticated identity has permission to perform a specific action on a specific resource. It answers the question: *Does User #42 possess the right to delete Document #999?* This is achieved through access control policies (Role-Based Access Control, Attribute-Based Access Control, or Access Control Lists).

```
+-------------------------------------------------------------------------------+
|                       THE 4 A's OF ENTERPRISE SECURITY                        |
+-------------------------------------------------------------------------------+
| 1. Identification | "I am alice@company.com" (Claiming an identity)           |
|         |                                                                     |
|         v                                                                     |
| 2. Authentication | "Here is my password + YubiKey" (Proving identity -> AuthN)|
|         |                                                                     |
|         v                                                                     |
| 3. Authorization  | "Can Alice edit the production DB?" (Policy check -> AuthZ)|
|         |                                                                     |
|         v                                                                     |
| 4. Audit / Account| "Alice modified Row 4 at 14:02 UTC" (Immutable audit log) |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Without clear separation between Authentication and Authorization:
1. **Confused Deputy Problems**: A system might verify that a client holds a valid JWT signature, and then immediately execute an administrative delete query without checking if the token belongs to an administrator or an ordinary guest.
2. **Horizontal Privilege Escalation (IDOR / BOLA)**: User A authenticates legitimately, but by changing `GET /api/invoices/100` to `GET /api/invoices/101`, reads User B's private invoices because the server verified *who* User A was (AuthN), but failed to verify whether User A *owned* invoice #101 (AuthZ).
3. **Rigid, Monolithic Architecture**: Hardcoding role checks inside login handlers prevents systems from adopting fine-grained, contextual permissions (e.g. multi-tenant organizations, time-based access, IP whitelists).

Separating AuthN from AuthZ ensures that identity verification happens once at the perimeter, while authorization is evaluated continuously across every domain boundary.

---

## 3. Mental Model

Visualize an **Airport and International Boarding Gate**:

- **Authentication (The Passport Control Counter)**:
  - You hand the border officer your passport.
  - The officer scans your biometric chip, looks at your face, and verifies that you are indeed *Alex Smith* (**AuthN**).
  - The officer stamps your passport. You have proven your identity.
  - *However, having a valid passport does NOT give you permission to walk into the cockpit or board a private Gulfstream jet!*
- **Authorization (The Flight Boarding Gate & Security Clearance)**:
  - You walk to Gate B12 to board Flight 402 to Tokyo.
  - The flight attendant inspects your Boarding Pass (**AuthZ Token**).
  - The attendant checks: *Is Alex Smith assigned Seat 14A on Flight 402 today?*
  - If yes, you enter Economy Class.
  - If you attempt to open the Cockpit door, the pilots lock it (**Access Denied / 403 Forbidden**), even though everyone on board agrees you are Alex Smith.

---

## 4. Basic Example

### 4.1 Concrete Express Middleware Distinguishing AuthN from AuthZ
```typescript
import { Request, Response, NextFunction } from "express";

// Extend Request type
declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: "USER" | "ADMIN" };
    }
  }
}

// 1. AUTHENTICATION (AuthN): Verifies Identity
export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers["authorization"]?.split(" ")[1];

  if (!token) {
    // 401 Unauthorized = Missing or invalid credentials (Who are you?)
    res.status(401).json({ error: "Authentication credentials required" });
    return;
  }

  // Simulated token verification
  if (token === "valid-user-token") {
    req.user = { id: "usr_1", role: "USER" };
    return next();
  } else if (token === "valid-admin-token") {
    req.user = { id: "adm_9", role: "ADMIN" };
    return next();
  }

  res.status(401).json({ error: "Invalid or expired token" });
}

// 2. AUTHORIZATION (AuthZ): Verifies Permissions
export function authorizeRole(requiredRole: "USER" | "ADMIN") {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Must be authenticated first!
    if (!req.user) {
      res.status(401).json({ error: "Authentication required before authorization" });
      return;
    }

    // 403 Forbidden = We know who you are, but you lack permission!
    if (req.user.role !== requiredRole && req.user.role !== "ADMIN") {
      res.status(403).json({ error: "Forbidden: Insufficient privileges" });
      return;
    }

    next();
  };
}
```

---

## 5. Real Example

### Production Enterprise Contextual Security Guard (Protecting Against BOLA / IDOR)
Authentication verifies identity, but authorization must verify **Resource Ownership**:

```typescript
// resource-authz.ts
import { Request, Response, NextFunction } from "express";

export interface Document {
  id: string;
  ownerId: string;
  isPublic: boolean;
  content: string;
}

// Simulated Database
const documentsDb = new Map<string, Document>([
  ["doc_100", { id: "doc_100", ownerId: "usr_alice", isPublic: false, content: "Alice's Taxes" }],
  ["doc_101", { id: "doc_101", ownerId: "usr_bob", isPublic: true, content: "Bob's Public Blog" }],
]);

/**
 * Contextual Authorization Guard:
 * Permits access if:
 * 1. User is an ADMIN, OR
 * 2. Document is marked public, OR
 * 3. Authenticated user is the direct owner of the document.
 */
export async function authorizeDocumentAccess(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const user = req.user; // Injected by prior AuthN middleware
  const { docId } = req.params;

  if (!user) {
    res.status(401).json({ error: "Unauthorized: Please log in" });
    return;
  }

  const document = documentsDb.get(docId);
  if (!document) {
    // Security Best Practice: Return 404 instead of 403 to prevent resource enumeration!
    res.status(404).json({ error: "Document not found" });
    return;
  }

  // AuthZ Rule Evaluation
  const isOwner = document.ownerId === user.id;
  const isAdmin = user.role === "ADMIN";
  const isPublic = document.isPublic && req.method === "GET";

  if (isOwner || isAdmin || isPublic) {
    // Attach resource to request to avoid duplicate database lookups in controller!
    (req as any).document = document;
    return next();
  }

  // 403 Forbidden: Identity is verified, but action on this resource is prohibited
  res.status(403).json({
    status: "error",
    code: "FORBIDDEN",
    message: "You do not have permission to access or modify this document.",
  });
}
```

---

## 6. Under the Hood

### 6.1 Status Code Semantics: 401 Unauthorized vs 403 Forbidden
The HTTP specification contains a historic linguistic flaw: `401` is named `Unauthorized`, but semantically it means **`Unauthenticated`**!

```
+-------------------------------------------------------------------------------+
|                       401 UNAUTHORIZED vs 403 FORBIDDEN                       |
+-------------------------------------------------------------------------------+
| HTTP Code        | Real Semantic Meaning    | When to Send                    |
+------------------+--------------------------+---------------------------------+
| 401 Unauthorized | UNAUTHENTICATED          | - Missing Authorization header  |
|                  | (Identity unknown)       | - Expired JWT or session        |
|                  |                          | - Invalid password credentials  |
|                  |                          | * Client can retry after login  |
+------------------+--------------------------+---------------------------------+
| 403 Forbidden    | UNAUTHORIZED             | - Regular user hits /admin/users|
|                  | (Identity verified,      | - User A attempts to edit       |
|                  |  permission denied)      |   User B's private bank profile |
|                  |                          | * Client should NOT re-prompt   |
|                  |                          |   for credentials!              |
+------------------+--------------------------+---------------------------------+
```

### 6.2 Privilege Escalation Vectors
- **Vertical Privilege Escalation**: An unprivileged user accesses functionality reserved for higher-tier roles (e.g., an ordinary customer directly calling `DELETE /api/v1/users/42` and deleting accounts).
- **Horizontal Privilege Escalation (IDOR / BOLA)**: A user accesses resources belonging to another user with the *same* privilege level (e.g., Alice modifying `req.body.accountId = "bob_account"` to siphon Bob's money).

---

## 7. Important Rules

1. **Authentication Must Strictly Precede Authorization**: You cannot evaluate whether an identity has permission to perform an action until that identity has been cryptographically proven.
2. **Never Trust Client-Supplied Identity in Request Bodies**: If a user is logged in, their user ID must come from the cryptographically verified JWT claims or session cookie (`req.user.id`). Never read `userId` from `req.body.userId` or `req.params.userId` for write operations!
3. **The Principle of Least Privilege (PoLP)**: By default, every identity must have zero permissions. Permissions are explicitly granted, never assumed.
4. **Defense in Depth**: Do not rely solely on API gateway URL matching for authorization. Enforce domain authorization checks at the service and data layer.

---

## 8. Common Mistakes

### Mistake 1: Relying on URL-Only Authorization Guards
```typescript
// ❌ WRONG: Fails to protect against horizontal privilege escalation (IDOR)!
app.get("/orders/:orderId", authenticateToken, async (req, res) => {
  // Verifies user is logged in, BUT ANY user can fetch ANY order by guessing the ID!
  const order = await db.orders.find(req.params.orderId);
  res.json(order);
});

//  CORRECT: Verify ownership during authorization
app.get("/orders/:orderId", authenticateToken, async (req, res) => {
  const order = await db.orders.find({
    id: req.params.orderId,
    userId: req.user.id, // Scoped to verified user!
  });
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});
```

### Mistake 2: Returning 401 when 403 is Required
Returning `401 Unauthorized` when a user lacks permissions causes frontend apps to wipe out the user's login tokens and redirect them to the `/login` page, creating a frustrating infinite login loop. Use `403 Forbidden`.

---

## 9. Best Practices

1. **Deny by Default**: If an incoming request does not match an explicit allow rule, immediately reject it with `403 Forbidden`.
2. **Mask Existence of Sensitive Resources (404 instead of 403)**: If an unauthorized user attempts to access `/admin/secret-merger-deal`, returning `403 Forbidden` reveals that the resource exists! Returning `404 Not Found` prevents resource enumeration attacks.
3. **Centralize Permission Logic**: Never scatter ad-hoc permission `if/else` checks across 200 route files. Use declarative authorization guards or policy libraries (CASL, Oso, Permify).

---

## 10. Performance Considerations

- **Stateless vs Stateful AuthZ Checks**:
  - *Stateless (Role embedded in JWT)*: Checking `req.user.role === 'ADMIN'` takes $< 1$ microsecond (pure memory check).
  - *Dynamic Resource Ownership*: Checking if Alice owns Document #100 requires a database lookup ($2-5$ms).
- **Optimization Strategy**: Co-locate ownership checks directly within the database query (`WHERE id = :docId AND owner_id = :userId`) to avoid redundant round-trips.

---

## 11. Security Considerations

1. **Confused Deputy Attacks**: Ensure that service-to-service communication carries both the caller's machine identity and the originating user's delegated identity (e.g., OAuth On-Behalf-Of flow).
2. **Privilege Downgrades & Session Invalidation**: When a user's role is demoted from `ADMIN` to `USER`, statelessly cached JWTs will continue granting admin access until the token expires unless an active token revocation blacklist (in Redis) is maintained.

---

## 12. Alternatives & Frameworks

| Model | Approach | Best Use Case |
| :--- | :--- | :--- |
| **RBAC** | Role-Based (Admin, Editor, Viewer). | Standard SaaS dashboards, hierarchical organizations. |
| **ABAC** | Attribute-Based (User attrs, Resource attrs, Context). | Complex enterprise compliance, medical systems. |
| **ReBAC** | Relationship-Based (Google Zanzibar model). | Social networks, Google Docs-style sharing ("shared with me"). |
| **OAuth 2.0 / OIDC** | Delegated authorization & federated identity. | Third-party integrations, Single Sign-On (SSO). |

---

## 13. Trade-offs

- **RBAC vs ABAC**:
  - *RBAC*: Simple to implement and audit. However, handling rules like *"An editor can only edit posts they created before 5:00 PM"* causes "Role Explosion" (e.g. creating `Editor_Own_Posts_Daytime` roles).
  - *ABAC*: Extremely flexible and context-aware. However, evaluating dynamic Boolean logic graphs on every request incurs higher latency and complex policy management.

---

## 14. Real-World Usage

- **AWS IAM**: Implements sophisticated ABAC policies evaluating caller identity, action (`s3:PutObject`), resource ARN, source IP, and MFA status.
- **GitHub Permissions**: Combines RBAC (Organization Owner, Member) with ReBAC (Repository Collaborator, Team assignment).

---

## 15. Placement Interview Questions

### 15.1 Basic Questions
1. *What is the fundamental difference between Authentication and Authorization?*
   - Answer: Authentication is the process of verifying who a user is (identity verification). Authorization is the process of verifying what resources or actions that authenticated user is permitted to access (permission validation).
2. *What is the difference between HTTP status codes 401 and 403?*
   - Answer: `401 Unauthorized` semantically means "Unauthenticated"—the client has not provided valid authentication credentials. `403 Forbidden` means "Unauthorized"—the client's identity is verified, but they do not possess the required permissions to perform the requested action.

### 15.2 Conceptual Questions
3. *What is Broken Object Level Authorization (BOLA / IDOR) and why is it the #1 API security vulnerability on the OWASP Top 10?*
   - Answer: BOLA (Broken Object Level Authorization), historically known as Insecure Direct Object References (IDOR), occurs when an application accepts user input (such as an ID in the URL) and directly accesses an object in a database without verifying whether the authenticated user owns or has permission to view that object. It allows malicious users to access any customer's data simply by iterating through sequential IDs.
4. *What is the Principle of Least Privilege?*
   - Answer: A security architecture principle stating that every module, user, or service should only be granted the minimum necessary permissions required to complete its designated task, and for no longer than the necessary duration.

### 15.3 Implementation Questions
5. *How do you write a policy-based authorization middleware in Express that checks if a user has a specific permission string (e.g., `'posts:delete'`)?*
   - Answer:
     ```typescript
     export function requirePermission(permission: string) {
       return (req: Request, res: Response, next: NextFunction) => {
         if (!req.user?.permissions?.includes(permission)) {
           return res.status(403).json({ error: `Requires '${permission}' permission` });
         }
         next();
       };
     }
     ```

### 15.4 Debugging Questions
6. *A customer is logged in, but when clicking "View Profile", the server returns `401 Unauthorized`. What is the architectural bug?*
   - Answer: The authentication token has either expired, is missing from the `Authorization: Bearer <token>` header, or the server failed to decode/verify the token signature. The issue is purely an Authentication (AuthN) failure, not a permission issue.

### 15.5 Scenario Questions
7. *How would you design a multi-tenant SaaS authorization system where users can belong to multiple organizations with different roles in each organization?*
   - Answer: Store a `memberships` table mapping `(user_id, organization_id, role)`. In the incoming HTTP request, extract the active organization from headers (`X-Organization-ID`) or subdomain. The authorization middleware verifies that the authenticated `req.user.id` has an active membership record for that specific `organization_id` and extracts their organization-scoped role before evaluating permissions.

### 15.6 Advanced Questions
8. *Why is returning a 404 Not Found sometimes preferred over a 403 Forbidden from a security perspective?*
   - Answer: To prevent **Resource Enumeration and Information Disclosure**. Returning `403 Forbidden` informs an attacker that a resource definitely exists at that URL (e.g. `/api/secret-project-omega`), confirming valuable internal metadata. Returning `404 Not Found` reveals nothing about the existence or absence of the resource.

---

## 16. Coding Questions

### Problem 1: Implement an Action-Based Access Control Gatekeeper
**Question**: Write a TypeScript authorization function `can(user, action, resource)` that evaluates whether a user can perform an action (`'read'`, `'update'`, `'delete'`) on a resource object, enforcing that regular users can only update/delete their own resources, while administrators have unrestricted permissions.

```typescript
// access-control.ts

export interface AuthUser {
  id: string;
  role: "ADMIN" | "USER";
}

export interface ResourceItem {
  id: string;
  ownerId: string;
  isLocked: boolean;
}

export type Action = "read" | "update" | "delete";

export function can(user: AuthUser, action: Action, resource: ResourceItem): boolean {
  // 1. Admin can do everything UNLESS resource is locked
  if (user.role === "ADMIN") {
    if (resource.isLocked && action === "delete") {
      return false; // Even admins cannot delete locked resources!
    }
    return true;
  }

  // 2. Regular user rules
  switch (action) {
    case "read":
      return true; // Public read

    case "update":
      return user.id === resource.ownerId && !resource.isLocked;

    case "delete":
      return user.id === resource.ownerId && !resource.isLocked;

    default:
      return false; // Deny by default
  }
}

// Verification Tests
const admin: AuthUser = { id: "u_admin", role: "ADMIN" };
const alice: AuthUser = { id: "u_alice", role: "USER" };
const bob: AuthUser = { id: "u_bob", role: "USER" };

const alicePost: ResourceItem = { id: "post_1", ownerId: "u_alice", isLocked: false };
const lockedDoc: ResourceItem = { id: "doc_99", ownerId: "u_bob", isLocked: true };

console.log("Alice edits Alice's post (expected true):", can(alice, "update", alicePost)); // true
console.log("Bob edits Alice's post (expected false):", can(bob, "update", alicePost));   // false
console.log("Admin edits Alice's post (expected true):", can(admin, "update", alicePost)); // true
console.log("Admin deletes locked doc (expected false):", can(admin, "delete", lockedDoc));// false
```

---

## 17. Common Interview Traps

- **Trap 1**: "Is a valid JWT proof that a user is authorized to perform an action?"
  - *Reality*: No! A valid JWT only proves **Authentication** (who the user is). Authorization requires checking whether that identity is allowed to perform that specific action on that specific target resource.
- **Trap 2**: "Is checking `if (user.role === 'admin')` sufficient for full application security?"
  - *Reality*: No. Role checks only defend against Vertical Privilege Escalation. They offer zero protection against Horizontal Privilege Escalation (User A reading User B's account records).
- **Trap 3**: "Can AuthN and AuthZ be handled in a single middleware function?"
  - *Reality*: Combining them violates the Single Responsibility Principle. Authenticate once at the perimeter; authorize granularly at the route/domain layer.

---

## 18. Revision Summary

- **AuthN ("Who are you?")**: Validates identity via credentials; returns 401 if invalid.
- **AuthZ ("What can you do?")**: Validates permissions on resources; returns 403 (or 404) if denied.
- **BOLA / IDOR**: OWASP #1 API vulnerability; occurs when servers fail to verify resource ownership during authorization.
- **PoLP**: Principle of Least Privilege—deny all access by default.
- **Status Codes**: 401 = Missing/Invalid Identity; 403 = Verified Identity lacks permission.

---

## 19. Quick Reference

```typescript
// AuthN Middleware (Verifies Identity)
app.use((req, res, next) => {
  const user = verifyToken(req.headers.authorization);
  if (!user) return res.status(401).json({ error: "Unauthenticated" });
  req.user = user;
  next();
});

// AuthZ Guard (Verifies Permission)
app.delete("/posts/:id", async (req, res) => {
  const post = await db.find(req.params.id);
  if (!post) return res.status(404).json({ error: "Not found" });
  if (post.authorId !== req.user.id && req.user.role !== "ADMIN") {
    return res.status(403).json({ error: "Forbidden" });
  }
  await db.delete(post.id);
  res.status(204).end();
});
```
