# Attribute-Based Access Control (ABAC) and Contextual Policies

---

## 1. What is it?

**Attribute-Based Access Control (ABAC)** (standardized by **NIST SP 800-162**) is an advanced authorization paradigm that evaluates access rights dynamically based on the **attributes** of the entities involved in an operation, rather than relying solely on static user roles.

While RBAC evaluates a single question: *"What is the user's role?"*, ABAC evaluates a multidimensional boolean policy across **four core attribute categories**:
1. **Subject Attributes (The User)**: Department, security clearance, job title, seniority, organization/tenant ID, MFA status.
2. **Resource Attributes (The Target Data)**: Owner ID, data classification (`Confidential`, `Public`), document state (`DRAFT`, `PUBLISHED`), creation date.
3. **Action Attributes (The Operation)**: `READ`, `WRITE`, `DELETE`, `APPROVE`, `EXPORT`.
4. **Environment / Context Attributes (The Runtime Conditions)**: Current time of day, day of week, client IP address, geographical location, device trust score (e.g., corporate VPN vs public Wi-Fi).

```
+-------------------------------------------------------------------------------+
|                       THE 4 DIMENSIONS OF ABAC EVALUATION                     |
+-------------------------------------------------------------------------------+
| [ Subject Attributes ]     | Department: "Cardiology", Role: "Physician"      |
| [ Action Attributes ]      | Action: "READ"                                   |
| [ Resource Attributes ]    | Type: "MedicalRecord", PatientDept: "Cardiology" |
| [ Environment Attributes ] | Time: "14:00" (Work Hours), IP: "Hospital_LAN"   |
+-------------------------------------------------------------------------------+
                                      |
                                      v Evaluated against Policy Rule:
 "Physicians can READ MedicalRecords IF Record.Department == Physician.Department
  AND Request.Time is during WorkHours AND Network == Hospital_LAN"
                                      |
                                      v
                             [ PERMIT / DENY ]
```

---

## 2. Why does it exist?

Traditional Role-Based Access Control (RBAC) breaks down when access decisions depend on context, relationships, or environmental constraints.

Consider these common enterprise requirements:
- *"Doctors can only view medical records of patients currently assigned to their shift."*
- *"Managers can only approve expense reports for amounts under $5,000, and only if the report was submitted by an employee in their own department."*
- *"Employees can edit documents they personally created, but only while the document is in `DRAFT` status and not `PUBLISHED`."*

Attempting to implement these rules in RBAC results in catastrophic **"Role Explosion"** (creating hundreds of artificial roles like `Doctor_Shift_A_Cardiology` or `Manager_Under_5K_Engineering`). ABAC solves this elegantly by writing clean, declarative boolean logic rules that evaluate metadata attributes at runtime.

---

## 3. Mental Model

Visualize a **High-Security Corporate Vault Door with an Intelligent Scanner**:

- **RBAC (The Dumb Brass Key)**: The door has a single lock. If you have the "Manager Key", the door swings wide open, regardless of whether it is 2:00 AM, whether the vault contains secret blueprints from another department, or whether you are connecting via a compromised foreign IP address.
- **ABAC (The Smart Computerized Security Portal)**: The door examines multiple sensors simultaneously:
  - Scans your badge: *Employee = Bob, Dept = Finance* (**Subject**).
  - Scans the box you are reaching for: *Box = Q3 Tax Audit, Classification = Restricted, Dept = Finance* (**Resource**).
  - Checks the wall clock: *Time = 2:30 PM on a Tuesday* (**Environment**).
  - Checks your action: *Action = Read, Not Delete* (**Action**).
  - The computer evaluates: *Does Bob's department match the Box's department? (Yes). Is it during business hours? (Yes).*
  - The door unlocks. If Bob attempts the exact same action from his home laptop at 3:00 AM on Sunday, the door remains bolted shut (**Dynamic Contextual Denial**).

---

## 4. Basic Example

### 4.1 Simple ABAC Policy Evaluator in TypeScript
```typescript
interface User {
  id: string;
  department: string;
  isMfaActive: boolean;
}

interface FinancialReport {
  id: string;
  department: string;
  isConfidential: boolean;
  status: "DRAFT" | "SUBMITTED" | "APPROVED";
}

interface Context {
  ipAddress: string;
  timeHour: number; // 0-23
}

// Declarative Policy Function
function canEditReport(user: User, report: FinancialReport, context: Context): boolean {
  // Rule 1: Cannot edit if report is already APPROVED
  if (report.status === "APPROVED") return false;

  // Rule 2: User must belong to the report's department
  if (user.department !== report.department) return false;

  // Rule 3: Confidential reports require active MFA
  if (report.isConfidential && !user.isMfaActive) return false;

  // Rule 4: Edits permitted only during business hours (08:00 - 18:00)
  if (context.timeHour < 8 || context.timeHour > 18) return false;

  return true;
}
```

---

## 5. Real Example

### Production Enterprise Policy Engine: Policy Enforcement Point (PEP) & Policy Decision Point (PDP)
Following the **NIST ABAC architectural standard**, enterprise systems decouple policy evaluation (**PDP**) from the API route handlers (**PEP**):

```typescript
// abac-engine.ts
import { Request, Response, NextFunction } from "express";

// 1. Data Contracts
export interface Subject {
  id: string;
  department: string;
  roles: string[];
  clearanceLevel: number; // 1 to 5
}

export interface Resource {
  type: string;
  ownerId: string;
  department: string;
  classificationLevel: number; // 1 to 5
  status?: string;
}

export interface Environment {
  ip: string;
  isWorkHours: boolean;
  isCorporateVpn: boolean;
}

export interface PolicyContext {
  subject: Subject;
  action: "READ" | "CREATE" | "UPDATE" | "DELETE" | "EXPORT";
  resource: Resource;
  environment: Environment;
}

export type PolicyRule = (ctx: PolicyContext) => boolean;

// 2. Policy Decision Point (PDP): The Brain
export class PolicyDecisionPoint {
  private rules: PolicyRule[] = [];

  public addRule(rule: PolicyRule): void {
    this.rules.push(rule);
  }

  /**
   * Evaluates all policy rules. Uses "Permit if ANY rule passes, DENY by default".
   */
  public evaluate(context: PolicyContext): boolean {
    for (const rule of this.rules) {
      if (rule(context)) {
        return true; // PERMIT
      }
    }
    return false; // DENY BY DEFAULT
  }
}

// 3. Configure Domain Policies
export const pdp = new PolicyDecisionPoint();

// Rule A: Admins can do anything IF connected via Corporate VPN
pdp.addRule(({ subject, environment }) => {
  return subject.roles.includes("SUPER_ADMIN") && environment.isCorporateVpn;
});

// Rule B: Users can READ or UPDATE resources they OWN, as long as it's not Level 5
pdp.addRule(({ subject, action, resource }) => {
  const isOwner = subject.id === resource.ownerId;
  const isAllowedAction = action === "READ" || action === "UPDATE";
  const notTopSecret = resource.classificationLevel < 5;
  return isOwner && isAllowedAction && notTopSecret;
});

// Rule C: Department members with equal or higher clearance can READ during work hours
pdp.addRule(({ subject, action, resource, environment }) => {
  const sameDept = subject.department === resource.department;
  const sufficientClearance = subject.clearanceLevel >= resource.classificationLevel;
  return action === "READ" && sameDept && sufficientClearance && environment.isWorkHours;
});

// 4. Policy Enforcement Point (PEP): Express Middleware Adapter
export function enforcePolicy(action: PolicyContext["action"], resourceExtractor: (req: Request) => Promise<Resource>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const subject: Subject = (req as any).user;
      if (!subject) {
        res.status(401).json({ error: "Unauthenticated" });
        return;
      }

      // Fetch the target resource dynamically
      const resource = await resourceExtractor(req);
      if (!resource) {
        res.status(404).json({ error: "Resource not found" });
        return;
      }

      // Construct Environment Context
      const hour = new Date().getHours();
      const environment: Environment = {
        ip: req.ip || "unknown",
        isWorkHours: hour >= 8 && hour <= 18,
        isCorporateVpn: req.headers["x-corporate-network"] === "true",
      };

      const isPermitted = pdp.evaluate({ subject, action, resource, environment });

      if (!isPermitted) {
        res.status(403).json({
          status: "error",
          code: "FORBIDDEN",
          message: "ABAC authorization policy denied access to this resource.",
        });
        return;
      }

      (req as any).resource = resource;
      next();
    } catch (err) {
      next(err);
    }
  };
}
```

---

## 6. Under the Hood

### 6.1 The NIST ABAC Reference Architecture (XACML Standard)
The National Institute of Standards and Technology (NIST) defines standard architectural components for ABAC systems:

```
+-------------------------------------------------------------------------------+
|                       NIST ABAC REFERENCE ARCHITECTURE                        |
+-------------------------------------------------------------------------------+
| [ PEP: Policy Enforcement Point ]                                             |
|  - Intercepts user requests (Express Middleware)                              |
|  - Packages Subject, Resource, Action, Environment attributes                 |
|  - Queries the PDP: "Is this permitted?"                                      |
|  - Enforces the final decision (Passes to next() or returns 403)              |
+-------------------------------------------------------------------------------+
                                      |
                                      v
| [ PDP: Policy Decision Point ]                                                |
|  - The policy evaluation engine                                               |
|  - Loads rules from the Policy Store (PAP)                                    |
|  - Queries missing attributes from PIP (e.g. database / LDAP)                 |
|  - Returns: PERMIT, DENY, NOT_APPLICABLE, or INDETERMINATE                    |
+-------------------------------------------------------------------------------+
```

### 6.2 CASL Library Mechanics in TypeScript
In modern Node.js and React full-stack applications, the **`@casl/ability`** library is the de-facto standard for ABAC:
- Defines abilities using an intuitive DSL: `can('read', 'Article', { authorId: user.id })`.
- Can be shared isomorphically across frontend and backend: the same ability rule controls whether a button is rendered in React (`<Can I="delete" this={post}>`) and whether an API endpoint executes in Express!

---

## 7. Important Rules

1. **Deny by Default**: An ABAC policy must reject access unless an explicit rule affirmatively permits it.
2. **Never Hardcode Environmental Constraints in Business Logic**: Keep time-of-day, network IP, and device checks inside the Policy Decision Point, never scattered inside SQL queries or controller if/else blocks.
3. **Handle Missing Attributes Safely**: If an attribute is missing (e.g. `user.clearanceLevel === undefined`), treat the comparison as `false`. Never let an undefined comparison evaluate to true.
4. **Co-locate Database Filters with ABAC Policies**: If a user is only permitted to view active documents in their department, push those attributes into the database `WHERE` clause (`WHERE dept = :dept AND status = 'ACTIVE'`) to avoid fetching 1,000,000 rows into Node memory just to reject 999,990 of them in JavaScript!

---

## 8. Common Mistakes

### Mistake 1: Memory-Based Filtering on Large Datasets
```typescript
// ❌ DISASTROUS ANTI-PATTERN: Fetching all rows, filtering in JS via ABAC
app.get("/records", async (req, res) => {
  const allRecords = await db.fetchAllMedicalRecords(); // Fetches 500,000 rows!
  const allowed = allRecords.filter((r) => canView(req.user, r)); // Crashes server with OOM!
  res.json(allowed);
});

//  CORRECT: Convert ABAC rules into SQL Query Predicates (e.g. via CASL Prisma adapter)
app.get("/records", async (req, res) => {
  const allowed = await db.medicalRecords.findMany({
    where: { department: req.user.department, isArchived: false },
  });
  res.json(allowed);
});
```

### Mistake 2: Time-Zone Bugs in Environmental Rules
Evaluating `new Date().getHours()` on a server running in UTC (AWS `us-east-1`) when validating "Business hours for a user in Tokyo" causes legitimate users to be locked out during their local workday. Always evaluate context using the user's local timezone.

---

## 9. Best Practices

1. **Use Policy as Code (Open Policy Agent / OPA)**: For large microservice architectures, offload ABAC policy evaluation to **Open Policy Agent (OPA)** using the Rego declarative policy language.
2. **Audit Policy Denials**: Whenever the PDP returns `DENY`, emit a structured log containing the exact failing attributes (`{ userId, failedRule: "ClearanceInsufficient", required: 4, actual: 2 }`) for security compliance.
3. **Combine RBAC and ABAC (Hybrid Model)**: Use RBAC for coarse-grained routing (e.g., only `PHYSICIANS` can access the medical records microservice), and use ABAC inside the service for fine-grained resource rules.

---

## 10. Performance Considerations

- **Policy Evaluation Speed**: A pure JavaScript ABAC policy evaluation takes between **0.01ms and 0.05ms** ($10-50$ microseconds) for in-memory attributes.
- **Attribute Retrieval Bottleneck (PIP)**: The primary performance cost is fetching the resource attributes from the database. Co-locate authorization lookups with your primary entity query to avoid redundant SQL calls.

---

## 11. Security Considerations

1. **Attribute Spoofing**: Ensure environmental attributes (like `isCorporateVpn` or `clientIp`) cannot be spoofed by incoming client HTTP headers. Trust `req.ip` only when `app.set('trust proxy', true)` is configured with specific reverse proxy IPs.
2. **Conflicting Policy Precedence**: In complex policy engines with both `PERMIT` and `DENY` rules, establish a clear precedence algorithm (e.g. **Deny-Overrides**: If *any* rule denies, the final decision is strictly `DENY`, even if 5 other rules say `PERMIT`).

---

## 12. Alternatives

| Authorization Model | Driving Logic | Complexity | Best For |
| :--- | :--- | :--- | :--- |
| **RBAC** | Static User Roles. | Low | Simple CRUD, small SaaS. |
| **ABAC** | Multi-attribute dynamic logic. | High | Healthcare, finance, enterprise compliance. |
| **ReBAC** | Graph relationships (Google Zanzibar). | Very High | Social platforms, complex document collaboration. |

---

## 13. Trade-offs

- **Flexibility vs Understandability**: ABAC can express virtually any business permission rule conceivable. However, debugging *why* a user was denied access across 40 interacting attribute rules is significantly more difficult than checking an RBAC role list.

---

## 14. Real-World Usage

- **AWS IAM Policies**: The quintessential industry implementation of ABAC (evaluating Actions like `s3:GetObject` against Resources with conditions on `aws:CurrentTime`, `aws:SourceIp`, and resource tags).
- **Electronic Health Records (Epic / Cerner)**: Implements HIPAA-compliant ABAC ensuring medical staff can only access patient charts during active treatment encounters.

---

## 15. Placement Interview Questions

### 15.1 Basic Questions
1. *What is Attribute-Based Access Control (ABAC)?*
   - Answer: ABAC is an authorization model where access rights are granted based on the evaluation of attributes associated with the Subject (user), the Resource (data), the requested Action, and the Environment (context like time or IP).
2. *What are the four core attribute categories evaluated in ABAC?*
   - Answer: Subject attributes, Resource attributes, Action attributes, and Environment/Contextual attributes.

### 15.2 Conceptual Questions
3. *How does ABAC solve the "Role Explosion" problem inherent in RBAC?*
   - Answer: In RBAC, adding contextual rules (such as regional, department, or ownership restrictions) forces teams to create a proliferation of hyper-specific roles (e.g., `HR_Manager_Europe`, `Sales_Lead_West`). ABAC eliminates this by treating region, department, and ownership as dynamic attributes evaluated in a single generic policy.
4. *What are the PEP and PDP in the NIST ABAC architecture?*
   - Answer: The **PEP (Policy Enforcement Point)** intercepts incoming requests (e.g., Express middleware) and enforces the decision. The **PDP (Policy Decision Point)** is the decision engine that evaluates the attributes against registered policies and returns a `PERMIT` or `DENY` verdict.

### 15.3 Implementation Questions
5. *How do you write a reusable policy rule that checks if a user is the owner of a resource in TypeScript?*
   - Answer:
     ```typescript
     export const isOwnerPolicy: PolicyRule = ({ subject, resource }) => {
       return subject.id === resource.ownerId;
     };
     ```

### 15.4 Debugging Questions
6. *A user in London reports they are blocked from accessing a system that permits access during "9:00 AM to 5:00 PM". Your server is hosted in US East (UTC-5). What is the bug?*
   - Answer: The server evaluated the environmental time rule using the server's local system time (UTC-5) rather than converting the timestamp to the user's localized time zone, causing a 5-hour operational discrepancy.

### 15.5 Scenario Questions
7. *How would you implement an emergency "Break-Glass" policy in a hospital EHR system using ABAC?*
   - Answer: Add an environmental/action attribute `isEmergencyOverride: true`. The PDP rule specifies: If `user.role === 'DOCTOR'` and `isEmergencyOverride === true`, `PERMIT` access to any patient record immediately, while simultaneously triggering an immutable high-priority audit event notifying hospital compliance for post-incident review.

### 15.6 Advanced Questions
8. *What is the difference between ABAC and ReBAC (Relationship-Based Access Control)?*
   - Answer: ABAC evaluates properties attached to isolated entities (e.g. `doc.status === 'DRAFT'`). ReBAC (popularized by Google Zanzibar) evaluates graph relationships and paths between objects (e.g., "User A is in Group B, which is a member of Team C, which has 'Viewer' access to Folder D, which contains Document E"). ReBAC is optimized for recursive graph traversals.

---

## 16. Coding Questions

### Problem 1: Implement an Extensible ABAC Policy Engine with Deny-Overrides
**Question**: Write a TypeScript `ABACPolicyEngine` class that supports registering multiple rules and evaluates requests using the **Deny-Overrides** algorithm: If ANY rule explicitly returns `DENY`, the entire request is rejected; otherwise, if at least one rule returns `PERMIT`, access is granted.

```typescript
// abac-evaluator.ts

export type Decision = "PERMIT" | "DENY" | "NOT_APPLICABLE";

export interface ContextPayload {
  user: { id: string; role: string; department: string };
  action: "READ" | "WRITE" | "DELETE";
  resource: { ownerId: string; department: string; isLocked: boolean };
  env: { ip: string; isVpn: boolean };
}

export type DynamicRule = (ctx: ContextPayload) => Decision;

export class ABACPolicyEngine {
  private rules: DynamicRule[] = [];

  public registerRule(rule: DynamicRule): void {
    this.rules.push(rule);
  }

  public evaluate(context: ContextPayload): boolean {
    let hasPermit = false;

    for (const rule of this.rules) {
      const decision = rule(context);

      // Strict Deny-Overrides: A single DENY terminates immediately!
      if (decision === "DENY") {
        return false;
      }

      if (decision === "PERMIT") {
        hasPermit = true;
      }
    }

    // Permit only if at least one rule explicitly approved and none denied
    return hasPermit;
  }
}

// Verification Test
const engine = new ABACPolicyEngine();

// Rule 1: Locked resources can NEVER be modified or deleted (Hard Deny)
engine.registerRule(({ action, resource }) => {
  if (resource.isLocked && (action === "WRITE" || action === "DELETE")) {
    return "DENY";
  }
  return "NOT_APPLICABLE";
});

// Rule 2: Owners can read and write their own unlocked resources
engine.registerRule(({ user, action, resource }) => {
  if (user.id === resource.ownerId && (action === "READ" || action === "WRITE")) {
    return "PERMIT";
  }
  return "NOT_APPLICABLE";
});

const contextValid: ContextPayload = {
  user: { id: "usr_1", role: "USER", department: "IT" },
  action: "WRITE",
  resource: { ownerId: "usr_1", department: "IT", isLocked: false },
  env: { ip: "10.0.0.1", isVpn: true },
};

const contextLocked: ContextPayload = {
  ...contextValid,
  resource: { ownerId: "usr_1", department: "IT", isLocked: true },
};

console.log("Valid write permitted? (expected true):", engine.evaluate(contextValid)); // true
console.log("Locked write permitted? (expected false via DENY):", engine.evaluate(contextLocked)); // false
```

---

## 17. Common Interview Traps

- **Trap 1**: "Is ABAC a replacement for authentication?"
  - *Reality*: No! ABAC is strictly an **authorization** engine. It relies entirely on prior authentication to populate the verified Subject attributes.
- **Trap 2**: "Can ABAC policies be stored in a database?"
  - *Reality*: Yes! In enterprise systems, policies are stored in databases or configuration repositories as JSON schemas, Open Policy Agent Rego scripts, or XACML documents, allowing real-time policy updates without redeploying code.
- **Trap 3**: "Does ABAC make RBAC obsolete?"
  - *Reality*: No. In practice, the cleanest architecture is a **Hybrid RBAC + ABAC** model: use RBAC for high-level module routing (`role: "ACCOUNTANT"`), and use ABAC for fine-grained resource rules (`amount < 10000 && dept == user.dept`).

---

## 18. Revision Summary

- **Core Dimensions**: Subject (User), Resource (Target Data), Action (Verb), Environment (Context/Time/IP).
- **Solves**: Role explosion in complex organizational and compliance environments.
- **NIST Standard**: Decouples PEP (Enforcement middleware) from PDP (Evaluation engine).
- **Deny by Default**: Always reject requests unless an affirmative policy permits access.
- **Performance**: Push attribute filters to database queries to avoid memory-heavy filtering in Node.

---

## 19. Quick Reference

```typescript
// ABAC Rule Formulation
const canAccess = (user: User, resource: Resource, env: Environment) =>
  user.dept === resource.dept &&
  user.clearance >= resource.classification &&
  env.isBusinessHours;

// PEP Middleware
app.get("/documents/:id", async (req, res) => {
  const doc = await db.find(req.params.id);
  if (!pdp.evaluate({ subject: req.user, resource: doc, action: "READ", env: getEnv(req) })) {
    return res.status(403).json({ error: "Access Denied by Policy" });
  }
  res.json(doc);
});
```
