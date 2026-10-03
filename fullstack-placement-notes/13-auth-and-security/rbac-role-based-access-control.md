# Role-Based Access Control (RBAC) and Hierarchical Permissions

---

## 1. What is it?

**Role-Based Access Control (RBAC)** is an authorization model in which system permissions are assigned to specific **Roles**, and users are assigned one or more of these roles. Rather than granting individual users direct permissions to view, edit, or delete specific resources, permissions are grouped into logical, reusable organizational job functions (e.g., `ADMIN`, `BILLING_MANAGER`, `SUPPORT_AGENT`, `MEMBER`).

In enterprise systems, RBAC is implemented in two primary paradigms:
1. **Flat RBAC**: Every role is an independent bucket of permissions with no relationship to other roles.
2. **Hierarchical RBAC (RBAC1)**: Roles inherit permissions from lower-tier roles in a tree or Directed Acyclic Graph (DAG). For example, a `SUPER_ADMIN` automatically inherits all permissions of an `ADMIN`, who in turn inherits all permissions of a `MEMBER`.

```
+-------------------------------------------------------------------------------+
|                       HIERARCHICAL RBAC INHERITANCE TREE                      |
+-------------------------------------------------------------------------------+
|                           [ SUPER_ADMIN ]                                     |
|                           (Can delete tenant, manage billing, all below)      |
|                                  |                                            |
|                                  v Inherits                                   |
|                              [ ADMIN ]                                        |
|                              (Can invite members, change roles, all below)    |
|                                  |                                            |
|                                  v Inherits                                   |
|                              [ EDITOR ]                                       |
|                              (Can create, edit, and publish content)          |
|                                  |                                            |
|                                  v Inherits                                   |
|                              [ VIEWER ]                                       |
|                              (Read-only access to published content)          |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Without RBAC, managing permissions in an application with 10,000 users and 200 distinct operations becomes an operational nightmare (**Discretionary Access Control Trap**):
- If each user is assigned individual boolean flags (`can_edit_posts`, `can_delete_users`, `can_refund_charges`), onboarding 50 new customer service representatives requires toggling 20 individual database columns per user.
- If a security policy changes (e.g. support agents should no longer see credit card numbers), an administrator must execute updates across thousands of user records.
- Auditing who has access to financial ledgers requires scanning millions of individual permission assignments.

RBAC introduces a layer of indirection: **Users $\rightarrow$ Roles $\rightarrow$ Permissions**. Modifying the permissions associated with a single Role instantly and consistently updates access for all users assigned to that role.

---

## 3. Mental Model

Visualize a **Military Base with Security Clearances**:

- **The Permissions (The Keys)**: Individual physical keys labeled *"Armory Door"*, *"Mess Hall"*, *"Communications Bunker"*, *"Nuclear Silo"*.
- **The Roles (The Ranks)**:
  - Private (Clearance Level 1)
  - Captain (Clearance Level 2)
  - General (Clearance Level 3)
- **The System**: Instead of giving each Private 15 separate keys, the base assigns them a **Level 1 Badge (Role)**.
  - The Level 1 Badge automatically opens the Mess Hall and Barracks.
  - The Level 3 Badge (General) automatically opens everything the Captain and Private can open, plus the Nuclear Silo (**Hierarchical Inheritance**).
  - When a soldier is promoted from Private to Captain, the quartermaster simply swaps their rank badge.

---

## 4. Basic Example

### 4.1 Flat Role Guard Middleware in Express
```typescript
import { Request, Response, NextFunction } from "express";

type Role = "USER" | "EDITOR" | "ADMIN";

// Middleware factory checking if user possesses any of the required roles
export function requireRoles(...allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user; // Injected by previous authentication middleware

    if (!user) {
      res.status(401).json({ error: "Unauthenticated" });
      return;
    }

    if (!allowedRoles.includes(user.role as Role)) {
      res.status(403).json({
        error: "Forbidden",
        message: `Requires one of the following roles: [${allowedRoles.join(", ")}]`,
      });
      return;
    }

    next();
  };
}

// Route Usage:
// app.delete('/api/users/:id', requireRoles('ADMIN'), userController.deleteUser);
// app.post('/api/posts', requireRoles('EDITOR', 'ADMIN'), postController.createPost);
```

---

## 5. Real Example

### Production Hierarchical Permission-Based Access Control System
Best-practice architectures **authorize by granular permissions, not by coarse role names**. Roles are simply collections of granular permission strings (`domain:action`):

```typescript
// rbac-system.ts
import { Request, Response, NextFunction } from "express";

// 1. Define Granular Permissions
export const Permissions = {
  USERS_READ: "users:read",
  USERS_CREATE: "users:create",
  USERS_DELETE: "users:delete",
  BILLING_READ: "billing:read",
  BILLING_UPDATE: "billing:update",
  POSTS_CREATE: "posts:create",
  POSTS_EDIT: "posts:edit",
} as const;

export type Permission = (typeof Permissions)[keyof typeof Permissions];

// 2. Define Hierarchical Role Definitions
const roleHierarchy: Record<string, Permission[]> = {
  VIEWER: [Permissions.USERS_READ],
  EDITOR: [
    Permissions.USERS_READ,
    Permissions.POSTS_CREATE,
    Permissions.POSTS_EDIT,
  ],
  ADMIN: [
    Permissions.USERS_READ,
    Permissions.USERS_CREATE,
    Permissions.POSTS_CREATE,
    Permissions.POSTS_EDIT,
    Permissions.BILLING_READ,
    Permissions.BILLING_UPDATE,
  ],
  SUPER_ADMIN: [
    Permissions.USERS_READ,
    Permissions.USERS_CREATE,
    Permissions.USERS_DELETE, // Exclusive to SUPER_ADMIN
    Permissions.BILLING_READ,
    Permissions.BILLING_UPDATE,
    Permissions.POSTS_CREATE,
    Permissions.POSTS_EDIT,
  ],
};

// 3. Permission Evaluation Engine
export class RBACService {
  /**
   * Resolves all unique permissions for a user based on their roles.
   */
  public static getUserPermissions(userRoles: string[]): Set<Permission> {
    const permissions = new Set<Permission>();

    for (const role of userRoles) {
      const perms = roleHierarchy[role] || [];
      perms.forEach((p) => permissions.add(p));
    }

    return permissions;
  }

  /**
   * Evaluates if a set of user roles satisfies a required permission.
   */
  public static hasPermission(userRoles: string[], required: Permission): boolean {
    const userPermissions = this.getUserPermissions(userRoles);
    return userPermissions.has(required);
  }
}

// 4. Fine-Grained Permission Guard Middleware
export function requirePermission(requiredPermission: Permission) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const userRoles: string[] = Array.isArray(user.roles) ? user.roles : [user.role];
    const isAuthorized = RBACService.hasPermission(userRoles, requiredPermission);

    if (!isAuthorized) {
      res.status(403).json({
        status: "error",
        code: "INSUFFICIENT_PERMISSIONS",
        message: `Action requires '${requiredPermission}' permission.`,
      });
      return;
    }

    next();
  };
}
```

---

## 6. Under the Hood

### 6.1 Database Schema Modeling for Enterprise Dynamic RBAC
In large enterprise systems, roles and permissions are dynamically configurable by company administrators via an admin dashboard. This is modeled using a classic **5-Table Many-to-Many Relational Schema**:

```
+---------------+       +------------------+       +---------------+
|     users     |       |    user_roles    |       |     roles     |
+---------------+       +------------------+       +---------------+
| id (PK)       |<----->| user_id (FK)     |<----->| id (PK)       |
| email         |       | role_id (FK)     |       | name (UNIQUE) |
| password_hash |       +------------------+       | description   |
+---------------+                                  +---------------+
                                                           ^
                                                           |
                        +----------------------+           |
                        |   role_permissions   |           |
                        +----------------------+           |
                        | role_id (FK)         |<----------+
                        | permission_id (FK)   |<----------+
                        +----------------------+           |
                                   |                       |
                                   v                       |
                        +----------------------+           |
                        |     permissions      |           |
                        +----------------------+           |
                        | id (PK)              |           |
                        | code (UNIQUE)        |-----------+
                        | description          | (e.g. 'users:delete')
                        +----------------------+
```

### 6.2 SQL Query to Retrieve All Permissions for a User
```sql
SELECT DISTINCT p.code
FROM permissions p
JOIN role_permissions rp ON p.id = rp.permission_id
JOIN user_roles ur ON rp.role_id = ur.role_id
WHERE ur.user_id = 'usr_12345';
```

---

## 7. Important Rules

1. **Check Permissions in Code, Not Role Names**: Never write `if (user.role === 'ADMIN')` in your controllers. Write `requirePermission('invoices:delete')`. If tomorrow you create a new role called `FINANCE_DIRECTOR`, you simply assign them `invoices:delete` in the database without modifying a single line of backend code.
2. **Deny by Default**: If an incoming request does not possess the explicit permission required, return `403 Forbidden`.
3. **Cache User Permissions in Redis**: Querying 5 relational SQL tables on every single HTTP request adds 5-10ms of database latency. Cache the resolved string array of permissions in Redis (`user:<userId>:permissions`) with a 15-minute TTL.
4. **Invalidate Cache on Role Update**: If an administrator modifies a role's permissions or removes a user's role, immediately invalidate the user's permission cache in Redis.

---

## 8. Common Mistakes

### Mistake 1: The "Role Explosion" Anti-Pattern
When developers use coarse roles to solve fine-grained business needs, they create a chaotic proliferation of hyper-specific roles:
- `ADMIN`
- `ADMIN_WITHOUT_BILLING`
- `ADMIN_WITH_AUDIT_ONLY`
- `REGIONAL_ADMIN_NORTH_AMERICA`
*Correction*: Maintain a small set of clean roles, or transition to **Attribute-Based Access Control (ABAC)** for contextual restrictions.

### Mistake 2: Hardcoding Role Hierarchies with Greater-Than Operators
```typescript
// ❌ FRAGILE ANTI-PATTERN: Numeric role levels
if (user.level >= 3) { /* Allow access */ }
```
Numeric role levels break down as soon as access requirements branch orthogonally (e.g. a `BILLING_ADMIN` should have Level 3 billing access, but Level 0 access to `SOURCE_CODE`). Use named permission sets.

---

## 9. Best Practices

1. **Use Colon-Namespaced Permission Identifiers**: Structure permissions as `<resource>:<action>`:
   - `orders:read`, `orders:create`, `orders:cancel`, `users:invite`, `reports:export`.
2. **Support Wildcard Permissions for Superadmins**: Allow permissions like `*` or `users:*` to match any action within that resource domain:
   ```typescript
   function matchesPermission(userPerm: string, requiredPerm: string): boolean {
     if (userPerm === "*") return true;
     if (userPerm.endsWith(":*")) {
       const prefix = userPerm.split(":")[0];
       return requiredPerm.startsWith(`${prefix}:`);
     }
     return userPerm === requiredPerm;
   }
   ```
3. **Embed Permissions in JWT (if small)**: If a user has fewer than 10 permissions, embed them directly into the JWT payload (`claims.perms = [...]`) to achieve completely stateless $O(1)$ authorization checks without database queries.

---

## 10. Performance Considerations

```
+-------------------------------------------------------------------------------+
|                       RBAC EVALUATION LATENCY PROFILES                        |
+-------------------------------------------------------------------------------+
| Strategy                              | Evaluation Latency | Invalidation Latency|
+---------------------------------------+--------------------+---------------------+
| 5-Table SQL Query per Request         | 4.0 - 15.0 ms      | Instant (0 ms)      |
| Cached in Redis Set                   | 0.5 - 1.2 ms       | Instant (Redis DEL) |
| Embedded in Signed JWT Claims         | 0.001 ms (Memory)  | Delayed (Token exp) |
+---------------------------------------+--------------------+---------------------+
```

- Embedding permissions in the JWT offers the highest throughput. However, if an administrator revokes a permission, the user retains access until their short-lived access token expires.

---

## 11. Security Considerations

1. **Privilege Escalation on User Update**: When an admin updates a user's profile, ensure the endpoint validates whether the caller possesses the permission to grant that specific target role. A standard admin must not be allowed to promote themselves to `SUPER_ADMIN`.
2. **Horizontal Privilege Leaks**: RBAC verifies that a user has the *type* of permission (`orders:read`), but does NOT verify *which* specific orders they are allowed to read. Always pair RBAC with resource ownership checks.

---

## 12. Alternatives

| Authorization Paradigm | Logic Driver | Best For |
| :--- | :--- | :--- |
| **RBAC** | User roles and permissions. | Standard SaaS applications, enterprise dashboards. |
| **ABAC** | Attributes of User, Resource, Context. | High compliance, dynamic rules (time, IP, ownership). |
| **ACL (Access Control Lists)** | Matrix of users attached directly to objects. | Google Drive file sharing, operating system filesystems. |

---

## 13. Trade-offs

- **Coarse Roles vs Fine-Grained Permissions**:
  - *Coarse Roles (`ADMIN`, `USER`)*: Fast to set up, minimal database schema. Inflexible when business requirements demand custom permissions for different departments.
  - *Fine-Grained Permissions (`users:delete`)*: Maximum flexibility and long-term architectural stability. Requires upfront modeling of permission catalogs and database schemas.

---

## 14. Real-World Usage

- **Stripe Dashboard**: Defines granular roles (Administrator, Developer, Analyst, Support Specialist, View Only) with explicit permission subsets.
- **Discord**: Implements a sophisticated hierarchical RBAC system where guild server roles have explicit permissions (Manage Channels, Ban Members) and roles are ordered by a draggable priority hierarchy.

---

## 15. Placement Interview Questions

### 15.1 Basic Questions
1. *What is Role-Based Access Control (RBAC)?*
   - Answer: RBAC is an authorization mechanism where permissions to perform system actions are assigned to specific Roles, and Users are assigned to those Roles. Users acquire all permissions granted to their assigned roles.
2. *Why should backend engineers authorize requests using permissions rather than role names?*
   - Answer: Authorizing by permission strings (e.g. `reports:export`) keeps code decoupled from organizational structure. If a company introduces new roles or reorganizes job titles, permissions can be reassigned in the database without modifying or redeploying any backend source code.

### 15.2 Conceptual Questions
3. *What is Hierarchical RBAC?*
   - Answer: Hierarchical RBAC is an extension of RBAC where roles inherit permissions from other roles in a parent-child relationship (e.g., an `ADMIN` automatically inherits all permissions possessed by an `EDITOR`). This prevents duplicating common permissions across multiple role definitions.
4. *What is the "Role Explosion" problem in RBAC and how is it resolved?*
   - Answer: Role explosion occurs when an application tries to handle contextual or fine-grained business requirements (e.g. "Admins who can only edit posts on weekends") by creating a brand-new role for every combination of conditions, resulting in hundreds of unmaintainable roles. It is resolved by pairing RBAC with Attribute-Based Access Control (ABAC).

### 15.3 Implementation Questions
5. *Design a PostgreSQL schema for a production RBAC system that supports users having multiple roles.*
   - Answer: A 5-table schema:
     1. `users (id, email, password_hash)`
     2. `roles (id, name)`
     3. `permissions (id, code)`
     4. `user_roles (user_id, role_id)`
     5. `role_permissions (role_id, permission_id)`

### 15.4 Debugging Questions
6. *An administrator removes the `billing:view` permission from the `SUPPORT` role in the database, but support staff can still view billing records for the next 15 minutes. What is the cause?*
   - Answer: The user permissions are cached in the user's short-lived JWT access token or a Redis cache with a 15-minute TTL. The server did not invalidate the cache upon the role update. To resolve this, trigger a cache invalidation event or issue an event to revoke active sessions for affected users.

### 15.5 Scenario Questions
7. *How would you implement a Wildcard Permission matcher (e.g., granting `billing:*` allows `billing:read`, `billing:write`, and `billing:refund`)?*
   - Answer:
     ```typescript
     function hasWildcardMatch(userPerms: string[], requiredPerm: string): boolean {
       return userPerms.some((p) => {
         if (p === "*") return true;
         if (p.endsWith(":*")) {
           const prefix = p.replace(":*", "");
           return requiredPerm.startsWith(prefix);
         }
         return p === requiredPerm;
       });
     }
     ```

### 15.6 Advanced Questions
8. *How can you prevent an administrative user from escalating their own privileges in an RBAC system?*
   - Answer: Implement a privilege ceiling check. When an administrator assigns a role to a user, the system must verify that the administrator's own role possesses a strictly higher authority than the role being assigned, and that the administrator possesses every single permission contained within that target role. Furthermore, forbid users from modifying their own role assignments.

---

## 16. Coding Questions

### Problem 1: Implement a Hierarchical RBAC Authorizer with Inheritance
**Question**: Write a TypeScript class `HierarchicalRBAC` that allows defining role inheritance (e.g. `ADMIN` inherits `EDITOR`, which inherits `VIEWER`). It must expose a method `isAuthorized(userRoles, requiredPermission)` that accurately evaluates inherited permissions.

```typescript
// hierarchical-rbac.ts

export class HierarchicalRBAC {
  private rolePermissions = new Map<string, Set<string>>();
  private roleInheritance = new Map<string, string[]>(); // Role -> Parent/Inherited Roles

  public defineRole(role: string, permissions: string[], inheritsFrom: string[] = []): void {
    this.rolePermissions.set(role, new Set(permissions));
    this.roleInheritance.set(role, inheritsFrom);
  }

  /**
   * Recursively resolves all permissions for a given role, including inherited ones.
   */
  public resolveAllRolePermissions(role: string, visited = new Set<string>()): Set<string> {
    if (visited.has(role)) return new Set(); // Prevent circular cycles
    visited.add(role);

    const allPerms = new Set<string>(this.rolePermissions.get(role) || []);
    const parents = this.roleInheritance.get(role) || [];

    for (const parent of parents) {
      const parentPerms = this.resolveAllRolePermissions(parent, visited);
      parentPerms.forEach((p) => allPerms.add(p));
    }

    return allPerms;
  }

  public isAuthorized(userRoles: string[], requiredPermission: string): boolean {
    for (const role of userRoles) {
      const resolved = this.resolveAllRolePermissions(role);
      if (resolved.has(requiredPermission) || resolved.has("*")) {
        return true;
      }
    }
    return false;
  }
}

// Verification Test
const rbac = new HierarchicalRBAC();

// 1. Define hierarchy
rbac.defineRole("VIEWER", ["posts:read"]);
rbac.defineRole("EDITOR", ["posts:create", "posts:edit"], ["VIEWER"]); // Inherits VIEWER
rbac.defineRole("ADMIN", ["posts:delete", "users:manage"], ["EDITOR"]); // Inherits EDITOR + VIEWER

// 2. Tests
console.log("Can VIEWER read posts? (expected true):", rbac.isAuthorized(["VIEWER"], "posts:read")); // true
console.log("Can VIEWER create posts? (expected false):", rbac.isAuthorized(["VIEWER"], "posts:create")); // false

console.log("Can EDITOR read posts? (expected true via inheritance):", rbac.isAuthorized(["EDITOR"], "posts:read")); // true
console.log("Can EDITOR create posts? (expected true):", rbac.isAuthorized(["EDITOR"], "posts:create")); // true
console.log("Can EDITOR delete posts? (expected false):", rbac.isAuthorized(["EDITOR"], "posts:delete")); // false

console.log("Can ADMIN delete posts? (expected true):", rbac.isAuthorized(["ADMIN"], "posts:delete")); // true
console.log("Can ADMIN read posts? (expected true via double inheritance):", rbac.isAuthorized(["ADMIN"], "posts:read")); // true
```

---

## 17. Common Interview Traps

- **Trap 1**: "Can RBAC handle rules like 'Users can only edit their own profile'?"
  - *Reality*: Pure RBAC cannot express resource ownership. If you create an `EDIT_OWN_PROFILE` permission, your code still needs to check `user.id === resource.ownerId`. That ownership check is **Attribute-Based Access Control (ABAC)**.
- **Trap 2**: "Is having 50 distinct roles a sign of good RBAC design?"
  - *Reality*: No. Having 50 roles indicates the "Role Explosion" anti-pattern. Good design keeps roles few and general (e.g. 4-6 roles), while using granular permissions or ABAC policies for specific cases.
- **Trap 3**: "Can a user have more than one role in RBAC?"
  - *Reality*: Yes! Standard RBAC supports multi-role assignment (e.g. a user can be both `TECH_SUPPORT` and `BILLING_ANALYST`), inheriting the union of permissions from all assigned roles.

---

## 18. Revision Summary

- **RBAC Core**: Users $\rightarrow$ Assigned to Roles $\rightarrow$ Possess Permissions.
- **Best Practice**: Authorize in code using granular permission strings (`users:delete`), never role names (`ADMIN`).
- **Hierarchy**: Child roles inherit permissions from parent roles (`SUPER_ADMIN` $\rightarrow$ `ADMIN` $\rightarrow$ `MEMBER`).
- **Database Model**: 5-table relational schema (`users`, `roles`, `permissions`, `user_roles`, `role_permissions`).
- **Performance**: Cache resolved permissions in Redis or embed in JWT for $O(1)$ evaluation.

---

## 19. Quick Reference

```typescript
// Permission Guard
export const requirePerm = (perm: string) => (req: Request, res: Response, next: NextFunction) => {
  if (!req.user?.permissions?.includes(perm)) {
    return res.status(403).json({ error: "Forbidden: Missing " + perm });
  }
  next();
};

// Route
app.post("/api/posts", requirePerm("posts:create"), postController.create);
```
