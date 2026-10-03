# Request Validation Middleware: Schema Validation with Zod in Express

---

## 1. What is it?

**Request Validation Middleware** is an architectural pattern where incoming HTTP requests are validated against strict, declarative schemas *before* execution control ever reaches the route controller. In modern TypeScript and Express applications, this is achieved by pairing Express middleware with **Zod**, a TypeScript-first schema declaration and validation library.

The validation middleware intercepts the three primary data carriers of an HTTP request:
1. **`req.body`**: JSON or form data payloads.
2. **`req.query`**: URL query parameters (which are always raw strings by default).
3. **`req.params`**: Dynamic URL route parameters (`/users/:id`).

If the request satisfies the schema, the middleware sanitizes, transforms, and attaches the validated data to the request object. If validation fails, the middleware short-circuits the request pipeline immediately, returning a structured `400 Bad Request` or `422 Unprocessable Entity` response detailing exactly which fields failed and why.

```
+-------------------------------------------------------------------------------+
|                       REQUEST VALIDATION MIDDLEWARE PIPELINE                  |
+-------------------------------------------------------------------------------+
| [ Incoming HTTP Request: Body, Query, Params ]                                |
|                        |                                                      |
|                        v                                                      |
| [ Validation Middleware: validateRequest(schema) ]                            |
|                        |                                                      |
|      +-----------------+-----------------+                                    |
|      |                                   |                                    |
| (Validation Fails)              (Validation Passes)                           |
|      |                                   |                                    |
|      v                                   v                                    |
| Short-Circuit:                  Sanitize & Coerce Types                       |
| Return 400 Bad Request          (e.g., string "42" -> number 42)             |
| RFC 7807 Error JSON                      |                                    |
| (Controller Never Runs!)                 v                                    |
|                                 [ Route Controller: Fully Typed req.body ]    |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Without automated validation middleware, developers write manual conditional checks inside every controller:

```typescript
// ❌ Manual Validation Nightmare inside Controller
app.post("/users", async (req, res) => {
  if (!req.body.email || !req.body.email.includes("@")) {
    return res.status(400).json({ error: "Invalid email" });
  }
  if (!req.body.age || typeof req.body.age !== "number" || req.body.age < 18) {
    return res.status(400).json({ error: "Age must be at least 18" });
  }
  // Repeat for 20 other fields...
});
```

This manual approach introduces severe software vulnerabilities:
1. **Mass Assignment Vulnerability**: If a user submits `{ "email": "a@b.com", "role": "admin", "isVerified": true }`, naive controllers that pass `req.body` directly to the database allow attackers to grant themselves administrative privileges.
2. **Type Coercion Vulnerabilities**: URL query strings like `?page=1&limit=20` arrive as strings (`"1"`, `"20"`). If unparsed, passing them to SQL pagination queries can crash the database or trigger SQL injection.
3. **Inconsistent Error Formatting**: Different controllers return validation errors in conflicting schemas, frustrating frontend clients.

Validation middleware acts as a single, immutable gatekeeper protecting controllers from malformed or malicious data.

---

## 3. Mental Model

Visualize an **Automated Airport Passport & Security Gate**:

- **The Passenger (HTTP Request)**: Arrives with luggage (`req.body`), flight ticket (`req.query`), and passport stamp (`req.params`).
- **The Scanner (Zod Schema)**: A rigid physical scanner shaped like the exact dimensions of permitted carry-on baggage.
- **The Gate Agent (Validation Middleware)**:
  - If a bag has contraband or is oversized (missing fields, wrong types, password too short), the gate alarm sounds immediately. The passenger is turned around with a printed checklist of infractions (**400 Bad Request**).
  - The airplane flight crew (**The Controller**) never has to inspect bags or verify passports. By the time a passenger walks onto the aircraft, the crew can guarantee with 100% mathematical certainty that the passenger is legitimate and safe.

---

## 4. Basic Example

### 4.1 Schema Definition and Validation Function
```typescript
import { z } from "zod";
import { Request, Response, NextFunction } from "express";

// 1. Define Zod Schema for User Registration
export const RegisterUserSchema = z.object({
  body: z.object({
    username: z.string().min(3).max(30),
    email: z.string().email(),
    password: z.string().min(8),
    age: z.number().int().min(18).optional(),
  }),
});

// 2. Validation Middleware
export const validateRegister = (req: Request, res: Response, next: NextFunction) => {
  const result = RegisterUserSchema.safeParse({ body: req.body });

  if (!result.success) {
    return res.status(400).json({
      status: "error",
      errors: result.error.flatten().fieldErrors,
    });
  }

  // Assign sanitized/parsed data back to req
  req.body = result.data.body;
  next();
};
```

---

## 5. Real Example

### Production Generic Type-Safe Request Validator with Query Coercion & RFC 7807 Compliance
In enterprise applications, you need a reusable, generic validation factory that validates `body`, `query`, and `params` simultaneously, coerces strings to numbers/dates, strips unexpected fields, and outputs standard RFC 7807 problem details:

```typescript
// validate-request.ts
import { Request, Response, NextFunction } from "express";
import { z, ZodError, ZodTypeAny } from "zod";

// Schema Interface covering all 3 request dimensions
export interface RequestSchema {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Higher-order middleware factory that creates a validation middleware for any Zod schema.
 */
export function validateRequest(schemas: RequestSchema) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 1. Validate and Parse Body
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }

      // 2. Validate, Coerce, and Parse Query
      if (schemas.query) {
        req.query = await schemas.query.parseAsync(req.query);
      }

      // 3. Validate, Coerce, and Parse Route Params
      if (schemas.params) {
        req.params = await schemas.params.parseAsync(req.params);
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Format errors into RFC 7807 Problem Details
        const formattedErrors = error.errors.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
          rule: issue.code,
        }));

        res.status(400).json({
          type: "https://api.example.com/errors/validation-failed",
          title: "Request Validation Failed",
          status: 400,
          detail: "One or more request parameters failed schema validation.",
          instance: req.originalUrl,
          invalidParams: formattedErrors,
        });
        return; // Short-circuit!
      }

      next(error);
    }
  };
}

// -------------------------------------------------------------
// Real-World Usage in a Products Controller
// -------------------------------------------------------------

// Schema with URL parameter coercion
export const GetProductListSchema = {
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(["price_asc", "price_desc", "newest"]).default("newest"),
    category: z.string().optional(),
  }),
  params: z.object({
    storeId: z.string().uuid("Store ID must be a valid UUID"),
  }),
};

// Route Registration:
// router.get(
//   '/stores/:storeId/products',
//   validateRequest(GetProductListSchema),
//   productController.listProducts
// );
```

---

## 6. Under the Hood

### 6.1 `safeParse` vs `parse` vs `parseAsync`
- **`schema.parse(data)`**: Synchronous. Throws a `ZodError` if validation fails.
- **`schema.safeParse(data)`**: Synchronous. Never throws. Returns a discriminated union:
  - `{ success: true, data: T }`
  - `{ success: false, error: ZodError }`
- **`schema.parseAsync(data)`**: Asynchronous. Required when schemas use async refinements (e.g., checking if an email already exists in a database via `z.string().refine(async (email) => !(await db.exists(email)))`).

### 6.2 Stripping Unknown Keys (`z.object().strip()` vs `strict()`)
By default, Zod objects **strip** unknown keys:
```typescript
const UserSchema = z.object({
  name: z.string(),
});

const validated = UserSchema.parse({ name: "Bob", admin: true });
console.log(validated); // Output: { name: 'Bob' } -> 'admin' is stripped!
```
This behavior provides automatic **Mass-Assignment Protection**. Even if a malicious client passes `role: "superuser"`, Zod drops it before it reaches the controller!
If you want to outright reject unexpected keys, use `.strict()`:
```typescript
const StrictSchema = z.object({ name: z.string() }).strict();
// Throws ZodError: Unrecognized key: 'admin'
```

### 6.3 Type Coercion Internals (`z.coerce`)
HTTP query strings and route parameters are fundamentally strings (`"123"`, `"true"`).
Using `z.coerce.number()` instructs Zod to pass the input through `Number(val)` prior to validating:
```typescript
const QuerySchema = z.object({
  count: z.coerce.number(), // "42" -> 42
  active: z.coerce.boolean(), // "true" -> true
});
```

---

## 7. Important Rules

1. **Always Reassign Validated Data**: Schemas can transform data (trimming strings, coercing numbers, applying defaults). Always assign the parsed result back to the request: `req.body = parsedData`.
2. **Never Trust Client Types**: TypeScript types disappear at runtime. Relying solely on `req.body as CreateUserInput` without runtime schema validation offers zero security against malicious payloads.
3. **Validate Route Parameters**: Always validate `req.params` (e.g., UUID format, integer IDs) to prevent invalid IDs from reaching database queries.
4. **Use `coerce` for Query and Params**: Because HTTP URLs transmit strings, using `z.number()` on `req.query.page` will always fail unless you use `z.coerce.number()`.

---

## 8. Common Mistakes

### Mistake 1: Using `z.number()` Directly on Query Parameters
```typescript
// ❌ WRONG: req.query.page arrives as string "1", so validation always fails!
const schema = z.object({
  page: z.number(), // Expects typeof number, gets typeof string!
});

//  CORRECT: Use z.coerce.number()
const schema = z.object({
  page: z.coerce.number(), // Coerces "1" to 1 before validation
});
```

### Mistake 2: Forgetting to Catch Async Refinements
If a Zod schema contains an `async` `.refine()` rule (e.g., database check) and you call `schema.parse()` synchronously, Zod throws a runtime error stating that async refinements require `parseAsync()`.

### Mistake 3: Re-validating Inside Controllers
Controllers should never re-check fields already validated by middleware. If a controller contains `if (!req.body.email)`, the architectural boundary has broken down. Trust the middleware contract.

---

## 9. Best Practices

1. **Infer TypeScript Types from Zod Schemas**: Maintain a single source of truth by deriving TypeScript types directly from schemas via `z.infer`:
   ```typescript
   export const CreatePostSchema = z.object({
     title: z.string().min(5),
     content: z.string(),
     tags: z.array(z.string()).default([]),
   });

   export type CreatePostInput = z.infer<typeof CreatePostSchema>;
   ```
2. **Standardize Validation Error Responses**: Use standard formats like RFC 7807 Problem Details or JSON:API error objects.
3. **Sanitize String Inputs**: Use `.trim()` and `.toLowerCase()` on emails and usernames directly within the Zod schema:
   ```typescript
   email: z.string().email().trim().toLowerCase(),
   ```

---

## 10. Performance Considerations

```
+-------------------------------------------------------------------------------+
|                       ZOD SCHEMA VALIDATION BENCHMARKS                        |
+-------------------------------------------------------------------------------+
| Library                 | Validations / Sec    | Features                     |
+-------------------------+----------------------+------------------------------+
| Zod                     | ~80,000 ops/sec      | Rich TypeScript integration  |
| TypeBox / Ajv (JSON-Sch)| ~950,000 ops/sec     | Pre-compiled JIT validator   |
| Manual if/else checks   | ~5,000,000 ops/sec   | Zero abstraction overhead    |
+-------------------------+----------------------+------------------------------+
```

- **Zod vs Ajv**: Zod prioritizes developer experience and strict TypeScript type inference. For standard web APIs (handling 1,000 - 10,000 req/sec), Zod's 80,000 ops/sec is more than fast enough. In extreme microsecond-latency environments, compiled JSON-schema engines like Ajv are faster.

---

## 11. Security Considerations

1. **Mass-Assignment Exploits**: Without validation stripping unknown keys, an attacker can submit `{ "balance": 999999 }` on a profile update route. Zod's default `.strip()` protects against this vulnerability.
2. **ReDoS in Regex Validations**: Avoid complex regular expressions in `z.string().regex(/.../)`. Malicious inputs can cause catastrophic backtracking, freezing the Node.js event loop.
3. **Payload Injection via Untyped SQL**: When route params are interpolated into raw SQL queries without validation (`SELECT * FROM users WHERE id = ` + req.params.id), SQL injection is possible. Validating `req.params.id` with `z.string().uuid()` or `z.coerce.number().int()` neutralizes non-numeric injection attacks before they reach the database.

---

## 12. Alternatives

| Validation Library | Paradigm | Pros / Cons |
| :--- | :--- | :--- |
| **Zod** | TypeScript-first declarative schema. | Industry standard, auto-types, excellent DX. |
| **Yup** | Schema builder inspired by Joi. | Great, but weaker TS inference than Zod. |
| **Joi** | JavaScript object schema validator. | Mature; originally built for Hapi; bulky in TS. |
| **Ajv + TypeBox** | JSON Schema standard with code generation. | Maximum execution speed; steeper learning curve. |

---

## 13. Trade-offs

- **Zod Schema Overhead vs Controller Safety**:
  - *Trade-off*: Validating complex nested objects incurs a modest CPU cost (~0.02ms per request). In return, you eliminate 90% of runtime crashes and mass-assignment vulnerabilities.

---

## 14. Real-World Usage

- **tRPC**: Uses Zod schemas as the foundational validation contract across the full-stack network boundary.
- **Stripe & GitHub Webhooks**: Parsing complex JSON webhooks using Zod ensures incoming webhook structures match expected payload types before triggering background workers.

---

## 15. Placement Interview Questions

### 15.1 Basic Questions
1. *What are the three parts of an HTTP request that validation middleware typically validates?*
   - Answer: `req.body` (request payload), `req.query` (URL search parameters), and `req.params` (dynamic route path parameters).
2. *Why are query parameters and route parameters always received as strings in Node.js?*
   - Answer: The HTTP protocol transmits URL paths and query strings as raw text over the network. Node's HTTP parser does not make assumptions about data types and represents all URL segments as strings.

### 15.2 Conceptual Questions
3. *What is a Mass-Assignment vulnerability and how does Zod prevent it?*
   - Answer: Mass-assignment occurs when client-provided parameters are passed directly to database models without filtering, allowing attackers to overwrite sensitive internal columns (e.g., `role: "admin"`). Zod objects strip undeclared keys by default, guaranteeing that only explicitly validated fields reach the application logic.
4. *What is the difference between `z.number()` and `z.coerce.number()`?*
   - Answer: `z.number()` expects the raw input type to strictly be a JavaScript number (`typeof val === "number"`). `z.coerce.number()` passes the input through `Number(val)` first, converting strings like `"42"` into the integer `42` before applying number validation rules.

### 15.3 Implementation Questions
5. *How do you automatically infer a TypeScript type from a Zod schema?*
   - Answer:
     ```typescript
     import { z } from "zod";
     const UserSchema = z.object({ id: z.string(), name: z.string() });
     type User = z.infer<typeof UserSchema>;
     ```

### 15.4 Debugging Questions
6. *A client sends a valid ISO date string `"2026-10-03T00:00:00.000Z"` in `req.body.startDate`, but `z.date()` rejects it with `Expected date, received string`. How do you fix this?*
   - Answer: Use `z.coerce.date()` or `z.string().datetime()`:
     ```typescript
     startDate: z.coerce.date(); // Converts ISO string to JS Date object
     ```

### 15.5 Scenario Questions
7. *How would you implement a validation rule that requires `confirmPassword` to match `password` using Zod?*
   - Answer:
     ```typescript
     export const PasswordResetSchema = z.object({
       password: z.string().min(8),
       confirmPassword: z.string(),
     }).refine((data) => data.password === data.confirmPassword, {
       message: "Passwords must match",
       path: ["confirmPassword"], // Attaches error specifically to confirmPassword field
     });
     ```

### 15.6 Advanced Questions
8. *How can you use Zod to validate asynchronous conditions, such as checking whether a username is already taken in PostgreSQL?*
   - Answer: Use `.refine()` with an `async` predicate function and validate the request using `.parseAsync()`:
     ```typescript
     const UsernameSchema = z.string().refine(async (username) => {
       const user = await db.findUserByUsername(username);
       return !user;
     }, { message: "Username is already registered" });
     ```

---

## 16. Coding Questions

### Problem 1: Implement an Express Validation Middleware Supporting Dynamic Schemas
**Question**: Write a reusable TypeScript middleware function `validate` that accepts a Zod schema and validates `req.body`, `req.query`, and `req.params`. It must return structured field-level errors if validation fails.

```typescript
// validate.ts
import { Request, Response, NextFunction } from "express";
import { AnyZodObject, ZodError } from "zod";

export const validate = (schema: AnyZodObject) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      // Assign parsed & sanitized values
      req.body = parsed.body ?? req.body;
      req.query = parsed.query ?? req.query;
      req.params = parsed.params ?? req.params;

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          status: "fail",
          errors: error.errors.map((err) => ({
            location: err.path[0], // body, query, or params
            field: err.path.slice(1).join("."),
            message: err.message,
          })),
        });
        return;
      }
      next(error);
    }
  };
};

// Verification Test Schema
import { z } from "zod";

export const UpdateProfileSchema = z.object({
  body: z.object({
    displayName: z.string().min(2),
    bio: z.string().max(200).optional(),
  }),
  params: z.object({
    userId: z.string().uuid(),
  }),
});
```

---

## 17. Common Interview Traps

- **Trap 1**: "Can Zod validate file uploads (`multipart/form-data`)?"
  - *Reality*: Zod validates JavaScript objects. Multipart forms stream binary bytes. You must first use a multipart parser (like `multer` or `formidable`) to parse files into `req.file` or `req.files` before passing file metadata to Zod.
- **Trap 2**: "Does TypeScript eliminate the need for runtime validation like Zod?"
  - *Reality*: No! TypeScript types are erased at compile time. At runtime, the server receives arbitrary JSON from clients. Runtime validation is mandatory to ensure security and stability.
- **Trap 3**: "Does `z.object().strip()` throw an error when unknown fields are passed?"
  - *Reality*: No. It silently deletes unknown fields. Only `.strict()` throws an error on unexpected fields.

---

## 18. Revision Summary

- **Architecture**: Validation middleware intercepts and validates `req.body`, `req.query`, and `req.params` before controllers execute.
- **Zod Benefits**: Runtime validation with automatic static TypeScript type inference via `z.infer`.
- **Coercion**: Use `z.coerce` to automatically cast URL strings into numbers, booleans, and dates.
- **Security**: Stripping unknown fields protects against mass-assignment vulnerabilities.
- **Short-Circuiting**: Fails fast with `400 Bad Request`, preventing malformed data from ever touching business logic.

---

## 19. Quick Reference

```typescript
import { z } from "zod";

// 1. Defining a comprehensive schema
const Schema = z.object({
  body: z.object({
    email: z.string().email().toLowerCase(),
    password: z.string().min(8),
  }),
  query: z.object({
    page: z.coerce.number().default(1),
  }),
  params: z.object({
    id: z.string().uuid(),
  }),
});

// 2. Inferring TypeScript type
type SchemaType = z.infer<typeof Schema>;

// 3. Safe Parsing
const result = Schema.safeParse({ body: req.body, query: req.query, params: req.params });
if (!result.success) {
  console.log(result.error.flatten().fieldErrors);
}
```
