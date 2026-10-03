# Input Validation, Parsing & Sanitization: Zod, Joi & Defensive Data Pipelines

## 1. What is it?
**Input Validation** is the defensive programming practice of ensuring that all incoming data entering an application from untrusted boundaries (HTTP request query parameters, request bodies, route parameters, headers, webhooks, third-party API payloads) strictly conforms to expected types, formats, lengths, and business constraints before processing.

**Data Parsing & Transformation** (popularized by modern schema libraries like **Zod**) embraces the philosophy of *"Parse, don't validate"*: transforming un-typed, ambiguous input into strictly typed, guaranteed-valid domain objects.

**Sanitization** is the proactive cleaning or neutralization of potentially dangerous characters or executable constructs (such as stripping HTML script tags with DOMPurify, trimming whitespace, normalizing emails, or escaping special characters) to prevent attacks like Cross-Site Scripting (XSS), SQL Injection, NoSQL Injection, and Path Traversal.

```
Untrusted Inbound HTTP Request (JSON / URL Encoded / Query)
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│ 1. Structural & Type Parsing (Zod / Joi Schema)        │ -> Rejects unknown keys (strip/strict),
│    - Strict whitelist enforcement                      │    validates datatypes, enforces length,
│    - Type coercion (e.g. string "123" -> number 123)   │    formats (email, UUID, ISO8601 date)
└─────────────────────────┬──────────────────────────────┘
                          │ (Parsed Validated Typed DTO)
                          ▼
┌────────────────────────────────────────────────────────┐
│ 2. Sanitization Pipeline                               │ -> Strips dangerous XSS payloads,
│    - HTML Sanitization (DOMPurify / sanitize-html)     │    normalizes unicode, trims strings,
│    - Canonical path normalization                      │    canonicalizes emails (lowercase, strip dots)
└─────────────────────────┬──────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│ 3. Domain & Business Invariants (Refinements)          │ -> Cross-field validations (e.g.,
│    - Password confirm matching, start_date < end_date  │    password === confirmPassword,
│    - Asynchronous uniqueness checks (e.g., db lookup)  │    startDate < endDate)
└─────────────────────────┬──────────────────────────────┘
                          │
                          ▼
           Type-Safe Controller & Domain Service
```

---

## 2. Why does it exist?
Without rigorous schema validation and sanitization at the system boundary:

1. **Injection Vulnerabilities (OWASP A03)**: Unsanitized input injected into databases, shell commands, or HTML templates causes SQLi, NoSQLi, Command Injection, and XSS.
2. **Mass Assignment & Parameter Tampering**: Attackers send extra payload parameters (e.g., `{ "isAdmin": true, "role": "SUPERADMIN" }`). Without strict schema whitelisting, vulnerable ORMs/DB drivers persist malicious privileges directly into user records.
3. **Runtime Type Errors (`TypeError: Cannot read properties of undefined`)**: Deep in business logic, code crashes because an assumed string is `undefined`, `null`, or an array, leading to unhandled promise rejections and server crashes.
4. **Denial of Service via Payload Bombs**: Enormous string payloads or deeply nested JSON objects exhaust memory and trigger catastrophic backtracking in regular expressions (ReDoS).
5. **Loss of TypeScript End-to-End Type Safety**: TypeScript types exist only at compile time and are completely erased at runtime. Schema validation libraries (Zod) bridge compile-time types with runtime verification (`z.infer<typeof Schema>`).

---

## 3. Mental Model: "Parse, Don't Validate"
Traditional validation treats validation as a boolean function: `isValid(input): boolean`. If true, the code still interacts with untyped or loosely typed input (`any` or `Record<string, unknown>`), requiring repeated null checks and manual assertions throughout the service layer.

The **Parse, Don't Validate** paradigm (pioneered by Alexis King and implemented by Zod) treats validation as a **type conversion pipeline**:
$$\text{Input: } \text{unknown} \xrightarrow{\text{Parse / Transform}} \text{Output: } \text{Guaranteed Valid Domain Type } T$$
If parsing succeeds, invalid states are made structurally impossible to represent in downstream code. If parsing fails, execution halts immediately with structured, actionable error diagnostics.

---

## 4. Basic Example: Validating with Zod & Type Inference

```typescript
import { z } from 'zod';

// 1. Define runtime schema
export const RegisterUserSchema = z.object({
  username: z
    .string()
    .min(3, 'Username must be at least 3 characters')
    .max(30, 'Username cannot exceed 30 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'Username can only contain alphanumeric characters and underscores'),
  email: z
    .string()
    .email('Invalid email address')
    .toLowerCase()
    .trim(),
  age: z
    .number()
    .int()
    .min(18, 'User must be at least 18 years old')
    .optional(),
  agreeToTerms: z.literal(true, {
    errorMap: () => ({ message: 'You must agree to the terms and conditions' }),
  }),
});

// 2. Infer compile-time TypeScript type directly from schema
export type RegisterUserInput = z.infer<typeof RegisterUserSchema>;

// 3. Execution
const untrustedInput: unknown = {
  username: 'goutam_dev',
  email: ' Goutam@Example.COM ',
  age: 22,
  agreeToTerms: true,
};

const parseResult = RegisterUserSchema.safeParse(untrustedInput);

if (!parseResult.success) {
  // Structured validation errors
  console.error(parseResult.error.flatten().fieldErrors);
} else {
  // Guaranteed type-safe data with transformations applied!
  // parseResult.data.email is normalized: "goutam@example.com"
  console.log('Successfully validated user:', parseResult.data.username);
}
```

---

## 5. Real-World Production Example: Generic Express Request Validation Middleware & Sanitization

In production Express/Node.js microservices, validation must intercept requests at the route layer, validate `body`, `query`, and `params`, sanitize rich text inputs against XSS, and return RFC 7807 compliant error responses.

```typescript
import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';
import DOMPurify from 'isomorphic-dompurify';

/**
 * Interface defining schema contracts for HTTP Request segments
 */
export interface RequestValidationSchemas {
  body?: ZodSchema<any>;
  query?: ZodSchema<any>;
  params?: ZodSchema<any>;
}

/**
 * Higher-order middleware factory for generic request validation
 */
export function validateRequest(schemas: RequestValidationSchemas) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schemas.params) {
        req.params = await schemas.params.parseAsync(req.params);
      }
      if (schemas.query) {
        req.query = await schemas.query.parseAsync(req.query);
      }
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Return standardized, frontend-friendly validation errors
        res.status(400).json({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Input validation failed',
          issues: error.errors.map((err) => ({
            field: err.path.join('.'),
            rule: err.code,
            message: err.message,
          })),
        });
        return;
      }
      next(error);
    }
  };
}

/**
 * Custom Zod transformation for sanitizing HTML/Rich Text fields (Prevents Stored XSS)
 */
export const sanitizedHtmlString = (minLength = 1, maxLength = 10000) =>
  z
    .string()
    .min(minLength)
    .max(maxLength)
    .transform((rawHtml) =>
      DOMPurify.sanitize(rawHtml, {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'ul', 'ol', 'li', 'a', 'code', 'pre'],
        ALLOWED_ATTR: ['href', 'target', 'rel'],
      })
    );

// ==========================================
// Route Implementation
// ==========================================

export const CreateBlogPostSchema = {
  body: z.object({
    title: z.string().trim().min(5).max(150),
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Invalid URL slug format'),
    contentHtml: sanitizedHtmlString(20, 50000), // Strips <script>, onerror, onload
    tags: z.array(z.string().trim().toLowerCase()).min(1).max(5),
    isDraft: z.boolean().default(true),
  }).strict(), // Reject unknown extra keys (Prevents Mass Assignment)
  params: z.object({
    authorId: z.string().uuid('Author ID must be a valid UUID'),
  }),
};

// Express Route Registration
// router.post('/authors/:authorId/posts', validateRequest(CreateBlogPostSchema), handleCreatePost);
```

---

## 6. Under the Hood: Comparison of Validation Libraries (Zod vs Joi vs Yup vs Class-Validator)

```
┌────────────────────────────────────────────────────────────────────────┐
│ Zod Architecture (TypeScript-First, Zero Runtime Dependencies)          │
│                                                                        │
│ 1. Schema Definition:  const User = z.object({ name: z.string() })    │
│ 2. Type Extraction:    type User = z.infer<typeof User>                 │
│    (Compiler inspects Schema type structure via TypeScript inference)  │
│ 3. Runtime Parsing:    User.safeParse(data)                            │
│    -> Traverses AST of validators, applies Coercion & Transforms       │
│    -> Produces a NEW, cloned, validated and typed data object         │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ Joi Architecture (Classic Node.js, Schema-Driven)                      │
│                                                                        │
│ 1. Schema Definition:  const schema = Joi.object({ name: Joi.string() })│
│ 2. Type Extraction:    Manual or requires external plugins/interfaces  │
│ 3. Runtime Validation: schema.validate(data, { abortEarly: false })   │
│    -> Fast C-style internal validation loop, mutates/returns data      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Important Rules

1. **Never Trust Client-Side Validation Alone**: Client-side validation in React, Angular, or Vue is purely for User Experience (UX), never for Security. Attackers use `curl`, Postman, or automated scripts that completely bypass frontend JavaScript. Validation must occur on every single backend API endpoint.
2. **Enforce Whitelist Validation over Blacklists**:
   - *Blacklist (Flawed)*: "Block strings containing `<script>` or `' OR 1=1`". (Attackers bypass this with `<img src=x onerror=...>` or URL encoding).
   - *Whitelist (Secure)*: "Accept only strings that match `/^[a-zA-Z0-9_-]{3,20}$/`". Everything else is strictly rejected.
3. **Use `.strict()` on Object Schemas**: By default, many schema validators silently strip or ignore unrecognized fields. When mutating sensitive database models, use `.strict()` to reject any unexpected payload properties, shutting down Mass Assignment attacks.
4. **Sanitize Output Context-Specifically**: HTML sanitization belongs at the ingestion of rich text or right before rendering. SQL sanitization belongs inside database drivers via parameterized queries. Do not try to "sanitize SQL" using regex on input strings.
5. **Separate Structural Validation from Business Rules**: Use schemas for structural validation (type, length, regex format). Use domain services or database transactions for business invariants (checking if an email is already registered, verifying account balance).

---

## 8. Common Mistakes & Anti-Patterns

### 1. Manual Validation with Endless `if-else` Blocks
```typescript
// ❌ WRONG: Spaghetti code, incomplete coverage, no TypeScript inference
function handleUpdate(req: Request, res: Response) {
  if (!req.body.email || typeof req.body.email !== 'string') {
    return res.status(400).send('Invalid email');
  }
  if (req.body.age && typeof req.body.age !== 'number') {
    return res.status(400).send('Invalid age');
  }
  // What about striping unknown keys? What about regex checks? What about null?
}
```

### 2. Confusing Validation with Type Casting (`as`)
```typescript
// ❌ DANGEROUS: TypeScript 'as' keyword provides ZERO runtime protection
interface UserProfile {
  name: string;
  role: 'admin' | 'user';
}

app.post('/profile', (req, res) => {
  const user = req.body as UserProfile; // Lie to the compiler!
  // At runtime, user.role could be "SUPER_HACKER" or undefined
  if (user.role === 'admin') { ... } // High security breach!
});
```

### 3. Vulnerable Custom Regex Patterns (ReDoS)
Using naive regular expressions with nested quantifiers (e.g., `/([a-zA-Z0-9]+)*$/` or naive email regexes). When fed an adversarial payload like `aaaaaaaaaaaaaaaaaaaaaaaaaaaa!`, the Node.js regex engine enters exponential catastrophic backtracking, freezing the event loop at 100% CPU. Always use battle-tested regexes from libraries or test with tools like Safe-Regex.

---

## 9. Best Practices

- **Derive TypeScript Types from Schemas**: Always use `z.infer<typeof MySchema>` to eliminate the dual-maintenance nightmare of keeping TypeScript `interface` and runtime schema synchronized.
- **Fail Fast with `.safeParse()` instead of Throwing**: Throwing exceptions (`.parse()`) incurs stack trace overhead in V8. In high-throughput APIs, prefer `.safeParse()` which returns a discriminated union `{ success: true, data } | { success: false, error }`.
- **Coerce Input Query Strings**: HTTP query parameters (`req.query`) and route parameters (`req.params`) are *always strings*. Use `z.coerce.number()` or `z.coerce.boolean()` to parse them gracefully into native types.
- **Use `.refine()` for Cross-Field Validation**:
  ```typescript
  const PasswordResetSchema = z.object({
    newPassword: z.string().min(8),
    confirmPassword: z.string(),
  }).refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"], // Attaches error directly to confirmPassword field
  });
  ```

---

## 10. Performance Considerations

- **Schema Re-use**: Never define Zod or Joi schemas inside request handler functions. Compiling schemas on every HTTP request creates garbage collection pressure and wastes CPU cycles. Declare schemas as static constants outside request handlers.
- **Micro-benchmarks**:
  - `Joi`: Fast for deep, massive objects; larger bundle size; Node.js backend centric.
  - `Zod`: Moderate speed, lightweight, zero dependencies, industry standard for fullstack TypeScript (Next.js, Remix, tRPC).
  - `TypeBox` / `Valibot`: Ultra-high throughput (leveraging JSON Schema and JIT compilation). Choose Valibot if bundle size in edge functions or client-side bundles is critical (<1KB).

---

## 11. Security Considerations

- **Mass Assignment Vulnerability**:
  ```typescript
  // Attacker sends: { "name": "Alice", "balance": 999999 }
  // Without .strict() or explicit field picking:
  const updated = await prisma.user.update({
    where: { id },
    data: req.body, // Attacker credited their own balance!
  });
  ```
  *Remediation*: Always pass validated DTOs (`parseResult.data`), never raw `req.body`.
- **Prototype Pollution via Unsanitized Object Merging**: Malicious payloads with keys like `__proto__` or `constructor.prototype` can pollute Object prototypes when merged into state. Modern Zod schemas automatically strip proto keys.

---

## 12. Alternatives & Comparison Matrix

| Library | Type Safety | Bundle Size | Execution Speed | Ecosystem Fit |
| :--- | :--- | :--- | :--- | :--- |
| **Zod** | ⭐⭐⭐⭐⭐ (Native `z.infer`) | 12 KB (gzipped) | Fast | Standard for TypeScript, tRPC, Next.js |
| **Joi** | ⭐⭐⭐ (External types) | 45 KB (gzipped) | Very Fast | Legacy Node.js, enterprise Hapi/Express |
| **Valibot** | ⭐⭐⭐⭐⭐ (Modular) | < 1 KB (Modular) | Ultra Fast | Edge functions, performance-critical frontend |
| **Yup** | ⭐⭐⭐⭐ (Inferable) | 14 KB (gzipped) | Moderate | Formik, classic React form libraries |
| **Validator.js** | ⭐⭐ (String checks only) | 8 KB (gzipped) | Fast | Standalone string sanitization/checks |

---

## 13. Trade-offs

- **Zod vs. Valibot**: Zod uses a fluent object-oriented API (`z.string().min(5)`), making it extremely readable and ergonomic, but harder to tree-shake. Valibot uses functional pipelines (`pipe(string(), minLength(5))`), achieving 95% smaller bundle sizes at the cost of slightly more verbose syntax.
- **Runtime Parsing Overhead vs. Safety**: Validating every request adds 0.1ms–1ms of CPU time. For high-frequency IoT streaming (100,000 UDP packets/sec), binary protocols (Protobuf) are preferred over JSON schema parsing. For REST/GraphQL APIs, the safety benefits overwhelmingly justify the sub-millisecond cost.

---

## 14. Real-World Usage Case Studies

1. **tRPC (End-to-End Type-Safe APIs)**: Uses Zod schemas as the single source of truth for API contracts. If the backend changes a schema, the frontend build immediately fails with TypeScript compile errors.
2. **React Hook Form**: Integrates `@hookform/resolvers/zod` to share identical validation rules between the React frontend form UI and the Express backend API.
3. **Stripe API**: Employs strict whitelist parameter checking. Sending an unrecognized query parameter or JSON body property to Stripe returns an immediate HTTP 400 with an `unknown_parameter` error code.

---

## 15. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: What is the fundamental difference between data validation and data sanitization?**
> **Answer**: **Validation** is a gatekeeping check that verifies whether input conforms to expected criteria (types, lengths, ranges). If it fails, the input is rejected. **Sanitization** actively modifies or cleans untrusted input (e.g., stripping `<script>` tags, trimming whitespace, lowercasing emails) to make it safe for downstream consumption.

### Tier 2: Conceptual
**Q: What does the concept "Parse, Don't Validate" mean, and why is it superior in TypeScript applications?**
> **Answer**: Traditional validation checks data and returns a boolean, leaving the data typed as `any` or `unknown`. Developers must still write manual checks or type assertions. "Parse, Don't Validate" transforms untrusted input into a strongly-typed domain model where invalid states are impossible to represent. Downstream functions receive guaranteed types, eliminating redundant defensive checks throughout the codebase.

### Tier 3: Implementation
**Q: How do you handle asynchronous validation in Zod (e.g., checking if a username is already taken in PostgreSQL)?**
> **Answer**: Use `.refine()` with an `async` predicate function and parse the input with `.parseAsync()` or `.safeParseAsync()`:
> ```typescript
> const UserSchema = z.object({
>   username: z.string().min(3).refine(async (name) => {
>     const exists = await db.user.findUnique({ where: { username: name } });
>     return !exists;
>   }, { message: "Username is already taken" })
> });
> const result = await UserSchema.safeParseAsync(req.body);
> ```

### Tier 4: Debugging
**Q: An Express endpoint expects `{ "page": 2, "limit": 10 }` as query parameters. A developer writes `z.object({ page: z.number(), limit: z.number() })`. Every request fails validation. Why?**
> **Answer**: HTTP query parameters in `req.query` are parsed by Express as **strings** (e.g., `req.query.page` is `"2"`, not `2`). A standard `z.number()` schema fails because `typeof "2"` is `string`.
> **Fix**: Use Zod type coercion: `z.object({ page: z.coerce.number(), limit: z.coerce.number() })`.

### Tier 5: Scenario
**Q: How do you design an input validation and sanitization architecture for a blogging platform that accepts Markdown and rendered HTML without introducing Stored XSS?**
> **Answer**:
> 1. Ingest raw Markdown text from the client, validating length and metadata using Zod.
> 2. Render Markdown to HTML on the server using a parser like `marked`.
> 3. Pass the resulting HTML through `DOMPurify` with a strict whitelist of allowed tags (`<p>`, `<b>`, `<code>`, `<img>`) and attributes (`href`, `src`, `alt`). Explicitly strip dangerous schemes (`javascript:`, `data:`).
> 4. Store both the raw Markdown and the sanitized HTML in the database.
> 5. Serve the sanitized HTML with HTTP security headers (`Content-Security-Policy`).

### Tier 6: Advanced
**Q: How does Mass Assignment lead to Privilege Escalation, and how do schema validation libraries prevent it at the architectural layer?**
> **Answer**:
> If an application passes an unvalidated `req.body` directly into an ORM update query (`db.user.update({ where: { id }, data: req.body })`), an attacker can append `"isAdmin": true` or `"role": "SUPERADMIN"` to their profile update request. The ORM blindly persists these fields. Schema libraries prevent this by implementing **Strict Whitelisting**: schemas define only the permissible mutable fields (e.g., `name`, `bio`). When parsed with `.strict()`, any rogue fields either throw an immediate validation error or are silently omitted from the resulting typed object, ensuring only authorized fields reach the database layer.

---

## 16. Coding Question: Build a Comprehensive Validation & Sanitization Schema in Zod

### Problem
Define a production Zod schema for an e-commerce checkout request satisfying:
1. `cartItems`: Array of at least 1 item, each containing `productId` (valid UUID), `quantity` (integer between 1 and 99), and `unitPrice` (positive float rounded to 2 decimal places).
2. `shippingAddress`: Must contain `street`, `city`, `postalCode` (matching standard postal code formats), and `country` (2-letter ISO code).
3. `giftMessage`: Optional string, maximum 200 characters, automatically sanitized of any HTML tags and whitespace-trimmed.
4. Total constraint: Must reject any extra unknown root keys.

### Solution

```typescript
import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';

export const CheckoutRequestSchema = z
  .object({
    cartItems: z
      .array(
        z.object({
          productId: z.string().uuid({ message: 'productId must be a valid UUID' }),
          quantity: z
            .number()
            .int({ message: 'quantity must be an integer' })
            .min(1, 'Minimum quantity is 1')
            .max(99, 'Maximum quantity is 99'),
          unitPrice: z
            .number()
            .positive('Price must be greater than zero')
            .refine((val) => Number(val.toFixed(2)) === val, {
              message: 'unitPrice cannot have more than 2 decimal places',
            }),
        }).strict()
      )
      .min(1, 'Cart must contain at least one item'),

    shippingAddress: z
      .object({
        street: z.string().trim().min(3).max(100),
        city: z.string().trim().min(2).max(50),
        postalCode: z.string().trim().regex(/^[A-Z0-9 -]{3,10}$/i, 'Invalid postal code format'),
        country: z.string().trim().length(2, 'Country must be a 2-letter ISO code').toUpperCase(),
      })
      .strict(),

    giftMessage: z
      .string()
      .max(200, 'Gift message cannot exceed 200 characters')
      .transform((val) => DOMPurify.sanitize(val.trim(), { ALLOWED_TAGS: [] })) // Strip all HTML
      .optional(),
  })
  .strict(); // Rejects mass assignment / unknown fields

export type CheckoutRequestDTO = z.infer<typeof CheckoutRequestSchema>;
```

---

## 17. Common Interview Traps

- **Trap 1**: Thinking `validator.isEmail()` or regex prevents SQL injection.
  *Gotcha*: Validating email format does not replace parameterized queries. A valid email format like `foo\'bar@test.com` can still break naive dynamic SQL strings. Always use parameterized queries in conjunction with validation.
- **Trap 2**: Relying on frontend HTML5 `required` and `type="email"` attributes for security.
  *Gotcha*: Anyone can open Chrome DevTools, remove the `required` attribute, or send raw HTTP requests via curl/Python bypassing frontend controls entirely.
- **Trap 3**: Believing `.strip()` in Zod is always safe for DB updates.
  *Gotcha*: While `.strip()` removes unknown keys, if a developer mistakenly includes a sensitive field (like `role`) in the schema definition without role-based access checks, users can still modify it. Use `.pick()` or separate DTO schemas for public vs. admin operations.

---

## 18. Revision Summary

- **Input Validation & Parsing** safeguards systems by rejecting malformed payloads before they reach business logic or databases.
- **Parse, Don't Validate**: Zod turns untrusted `unknown` input into strongly typed domain objects (`z.infer<typeof Schema>`).
- **Whitelisting > Blacklisting**: Always define what is allowed; never attempt to enumerate and block every dangerous pattern.
- **Defense in Depth**:
  - Zod/Joi for structural schema validation and mass-assignment prevention.
  - DOMPurify for HTML/rich-text sanitization.
  - Parameterized queries for SQL injection prevention.
  - Type coercion (`z.coerce`) for handling HTTP query and param string casting.

---

## 19. Quick Reference

| Feature | Zod Syntax | Description |
| :--- | :--- | :--- |
| **Type Inference** | `type T = z.infer<typeof S>` | Automatically extracts compile-time TypeScript type |
| **Safe Parsing** | `S.safeParse(input)` | Returns `{ success: true, data }` or error without throwing |
| **Strict Objects** | `z.object({...}).strict()` | Disallows unexpected keys (Prevents Mass Assignment) |
| **Coercion** | `z.coerce.number()` | Converts string inputs (`"42"`) into numbers (`42`) |
| **Transformations** | `z.string().transform(fn)` | Mutates/sanitizes valid data during parsing pipeline |
| **Refinements** | `z.string().refine(fn, msg)` | Custom business logic / cross-field validation checks |
| **HTML Sanitizer**| `DOMPurify.sanitize(input)` | Strips malicious executable XSS tags and attributes |
