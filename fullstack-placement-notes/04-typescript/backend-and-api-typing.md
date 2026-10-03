# Backend & API Typing: Express Contracts, Shared DTOs & Runtime Zod Bridges

## 1. What is it?
**Backend and API Typing** is the practice of establishing end-to-end type safety across the network boundary between the client (frontend) and server (backend).

In a full-stack Node.js/TypeScript architecture, this entails:
1. Strongly typing HTTP route parameters, request bodies, query strings, and response envelopes in frameworks like **Express.js** (`Request<Params, ResBody, ReqBody, ReqQuery>`).
2. Maintaining **Shared DTOs (Data Transfer Objects)** in a shared package or folder so frontend and backend reference the exact same data contracts.
3. Bridging the **Runtime-to-Static Boundary** using schema validation libraries like **Zod**: parsing untrusted runtime HTTP payloads and automatically inferring static TypeScript types via `z.infer`.

---

## 2. Why does it exist?
In traditional full-stack development:
- The backend changes an API response property from `user_id` to `userId`.
- The frontend team doesn't know until the app breaks in production when trying to read `response.data.user_id`.
- Furthermore, in Express, `req.body` has type `any` by default. A developer writes `const email = req.body.email.toLowerCase()`, and a malicious client sends `{ "email": 12345 }`, crashing the Node.js process with an unhandled exception!
- **The End-to-End Solution**: Shared DTOs ensure the frontend and backend agree on the schema at compile time, while Zod validation middleware protects the server from malicious payloads at runtime.

---

## 3. Mental Model: The Customs Checkpoint & Shared Legal Contract
💡 **Think of a Customs Inspection Gate at an International Border:**

```
FRONTEND (Browser Client)
┌─────────────────────────────────────────────────────────────┐
│  Component builds payload using shared contract:            │
│  const payload: CreateUserDTO = { email, age };             │
└──────────────────────────────┬──────────────────────────────┘
                               │ Serialized to raw JSON over HTTP wire
                               ▼
NETWORK BOUNDARY (The Wild West: Untrusted Strings & Numbers)
                               │
                               ▼
BACKEND (Node.js Express Server)
┌─────────────────────────────────────────────────────────────┐
│  [ CUSTOMS INSPECTION GATE: Zod Validation Middleware ]     │
│  - Inspects incoming JSON.                                  │
│  - Does email have '@'? Is age >= 0?                        │
│  - If invalid: Reject with 400 Bad Request immediately!     │
│  - If valid: Strips malicious extra fields & infers TS type!│
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
CONTROLLER & SERVICE LAYER
┌─────────────────────────────────────────────────────────────┐
│  req.body is GUARANTEED to match CreateUserDTO!             │
│  100% Safe database writes and business logic execution.    │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Typing Express Request & Response Generics

Express types `Request` with 5 generic parameters:
```typescript
interface Request<
  P = ParamsDictionary,  // 1. URL Path Params: /users/:id (req.params)
  ResBody = any,         // 2. Response Body type (res.send(data))
  ReqBody = any,         // 3. Request Body type (req.body)
  ReqQuery = ParsedQs,   // 4. Query Params: ?page=1&sort=asc (req.query)
  Locals = Record<string, any> // 5. res.locals (auth user, trace ID)
>
```

### Clean Strongly Typed Express Route Handler:
```typescript
import { type Request, type Response } from 'express';

// 1. Define Request Contracts
interface UserParams {
  userId: string;
}

interface UpdateUserBody {
  firstName?: string;
  lastName?: string;
  age?: number;
}

interface UserQuery {
  notify?: 'true' | 'false';
}

interface UserResponse {
  success: boolean;
  user: { id: string; name: string };
}

// 2. Strongly Typed Controller Function
export async function updateUserController(
  req: Request<UserParams, UserResponse, UpdateUserBody, UserQuery>,
  res: Response<UserResponse>
): Promise<void> {
  const { userId } = req.params;     // Typed strictly as string!
  const { firstName } = req.body;     // Typed strictly as string | undefined!
  const shouldNotify = req.query.notify === 'true'; // Typed safely!

  // res.json() will ENFORCE that the payload matches UserResponse!
  res.status(200).json({
    success: true,
    user: { id: userId, name: firstName || 'Anonymous' },
  });
}
```

---

## 5. Bridging Runtime to Static: Zod Validation

TypeScript types exist **only at compile time**. To guarantee safety at runtime, define the schema in Zod, and infer the TypeScript type directly from the schema:

```typescript
import { z } from 'zod';

// 1. Define the Runtime Validation Schema
export const CreateUserSchema = z.object({
  email: z.string().email('Invalid email address format'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
  age: z.number().int().min(18, 'Must be at least 18 years old'),
  role: z.enum(['USER', 'ADMIN']).default('USER'),
});

// 2. Infer the Compile-Time TypeScript Type!
// ZERO DUPLICATION! The schema is the single source of truth!
export type CreateUserDTO = z.infer<typeof CreateUserSchema>;

// Resulting TypeScript Type:
// {
//   email: string;
//   password: string;
//   age: number;
//   role: "USER" | "ADMIN";
// }
```

---

## 6. Real Example: Production Express Zod Middleware

In production architectures, you never write manual `try/catch` validation blocks in every route. You write a reusable, generic validation middleware:

```typescript
import { type Request, type Response, type NextFunction } from 'express';
import { type AnyZodObject, ZodError } from 'zod';

interface RequestValidators {
  body?: AnyZodObject;
  query?: AnyZodObject;
  params?: AnyZodObject;
}

export function validateRequest(schemas: RequestValidators) {
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
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        // Return structured 400 Bad Request with exact validation error issues
        res.status(400).json({
          status: 'VALIDATION_ERROR',
          errors: error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        });
        return;
      }
      next(error);
    }
  };
}

// Route Definition:
import { Router } from 'express';
const router = Router();

router.post(
  '/users',
  validateRequest({ body: CreateUserSchema }),
  (req, res) => {
    // req.body is GUARANTEED to be sanitized and valid CreateUserDTO!
    console.log(req.body.email);
    res.status(201).json({ success: true });
  }
);
```

---

## 7. Shared Monorepo DTO Architecture

In a modern full-stack monorepo (using Turborepo, Nx, or pnpm workspaces):

```
monorepo/
├── packages/
│   └── shared-contracts/      <-- Shared Types & Zod Schemas
│       ├── src/
│       │   ├── auth.dto.ts    <-- Auth DTOs & Schemas
│       │   └── user.dto.ts    <-- User DTOs & Schemas
│       └── package.json
├── apps/
│   ├── backend/               <-- Node.js Express API
│   │   └── src/controllers/   <-- Imports shared-contracts
│   └── frontend/              <-- Next.js / React Web App
│       └── src/components/    <-- Imports shared-contracts for forms & fetch
```

When backend engineers update `CreateUserSchema`, the frontend build will immediately highlight every form or API call that needs updating!

---

## 8. Common Mistakes

### Mistake 1: Relying on `req.body as CreateUserDTO` without validation
```typescript
// ❌ CRITICAL SECURITY VULNERABILITY:
app.post('/transfer', (req, res) => {
  // Casting 'as TransferDTO' LIES to the compiler!
  // An attacker sends: { "amount": -1000 } or { "recipient": 12345 }
  const data = req.body as TransferDTO; 
  executeBankTransfer(data); // 💥 Catastrophic bug!
});

// ✅ CORRECT: Always validate using a runtime schema first!
app.post('/transfer', async (req, res) => {
  const result = TransferSchema.safeParse(req.body);
  if (!result.success) return res.status(400).json(result.error);
  executeBankTransfer(result.data);
});
```

---

## 9. Best Practices

1. **Use `safeParse` instead of `parse` when handling control flow manually**: `safeParse` returns `{ success: true, data } | { success: false, error }`, avoiding unnecessary `try / catch` performance overhead.
2. **Strip Extra Keys with `.strip()` or `.strict()` in Zod**: Prevents Mass Assignment vulnerabilities where an attacker injects `isAdmin: true` into a profile update.
3. **Export Both Schemas and Inferred Types**:
   ```typescript
   export const LoginSchema = z.object({ ... });
   export type LoginDTO = z.infer<typeof LoginSchema>;
   ```

---

## 10. Performance Considerations

- **Zod Schema Parsing Overhead**: Zod parsing takes ~0.05ms to 0.2ms per request. In micro-benchmark hot paths with 50,000+ req/sec, consider ultra-fast validators like `TypeBox` or `Valibot` if serialization bottlenecks appear in CPU profiles.

---

## 11. Security Considerations

- **Mass Assignment Vulnerability**: If your database ORM does `prisma.user.update({ data: req.body })`, an unvalidated `req.body` containing `role: 'SUPERADMIN'` will overwrite the database column. Always use `.pick()` or schema validation to white-list acceptable fields.

---

## 12. Alternatives: REST DTOs vs. tRPC

| Architecture | How It Works | Strengths | Weaknesses |
| :--- | :--- | :--- | :--- |
| **REST + Shared Zod DTOs** | Standard HTTP JSON with shared schemas | Works with any client (iOS, Android, Third-Party) | Manual glue code between route and fetch |
| **tRPC** | Direct TypeScript RPC without schemas over HTTP | Zero boilerplate; 100% automatic autocomplete | Bound strictly to full-stack TypeScript |
| **GraphQL + Codegen** | GraphQL Schema generated to TS via codegen | Flexible client querying | Requires build-time code generation step |

---

## 13. Trade-offs

- **Shared DTOs**: Requires monorepo tooling or shared npm packages, but eliminates API drift entirely.

---

## 14. Real-World Usage

- **Fintech & Banking APIs**: Validating financial payloads and preventing rounding errors via Zod `.refine()`.
- **E-Commerce**: Ensuring checkout payloads conform to exact coupon and address requirements.

---

## 15. Placement Interview Questions

### Basic
**Q: Why is `req.body` typed as `any` by default in Express, and why is using `req.body as MyType` dangerous?**  
*Answer*: Express cannot know what payload will be sent across the network at runtime; therefore, it types `req.body` as `any`. Casting `req.body as MyType` is a compile-time assertion that is completely erased at runtime. It performs zero validation on the incoming JSON. If an attacker sends corrupted fields, missing keys, or malicious data types, the application will crash or suffer security vulnerabilities.

### Conceptual
**Q: How does `z.infer<typeof Schema>` create end-to-end type safety between frontend and backend?**  
*Answer*: Zod acts as a single source of truth. At the backend network boundary, Zod parses and sanitizes incoming HTTP payloads at runtime. Simultaneously, `z.infer` automatically generates the static TypeScript type corresponding to that exact schema. By sharing this schema in a shared monorepo package, both the frontend form components and the backend database controllers reference the exact same type definition, eliminating API contract drift.

### Implementation
**Q: Write an Express route typing for a GET request `/products/:category?page=1` that returns an array of products.**  
*Answer*:
```typescript
interface ProductParams { category: string; }
interface ProductQuery { page?: string; }
interface ProductResponse { items: Product[]; page: number; }

export function getProducts(
  req: Request<ProductParams, ProductResponse, unknown, ProductQuery>,
  res: Response<ProductResponse>
) {
  const { category } = req.params;
  const page = parseInt(req.query.page || '1', 10);
  res.json({ items: [], page });
}
```

### Debugging
**Q: An engineer writes a Zod schema `z.object({ age: z.number() })`. When testing via Postman using `application/x-www-form-urlencoded` or URL query params, Zod fails validation saying `Expected number, received string`. How do you fix this?**  
*Answer*: Query parameters and URL-encoded forms are transmitted as strings. Use `z.coerce.number()` to automatically coerce string digits (`"25"`) into numbers (`25`) during parsing:
```typescript
const QuerySchema = z.object({
  page: z.coerce.number().min(1).default(1),
});
```

### Scenario
**Q: How do you prevent Mass Assignment vulnerabilities in an Express PATCH `/api/profile` endpoint?**  
*Answer*: In the Zod schema, explicitly specify only the allowed mutable fields (e.g. `bio`, `avatarUrl`) and chain `.strict()` to the schema (`z.object({ bio: z.string() }).strict()`). If an attacker sends `{ bio: "New bio", role: "ADMIN" }`, Zod will reject the request with a validation error, preventing unauthorized fields from reaching the database update query.

### Advanced
**Q: What is the Richardson Maturity Model level of a tRPC application compared to a RESTful Zod application?**  
*Answer*: tRPC typically operates at Richardson Maturity Model Level 0 or 1 (HTTP as a Remote Procedure Call transport mechanism using RPC endpoints like `/api/trpc/user.getById`), focusing on type safety and function-call ergonomics rather than RESTful hypermedia or resource URIs. A RESTful Zod API operates at Level 2 (proper HTTP verbs `GET/POST/PUT/DELETE`, status codes `200/400/404`, and resource URIs `/api/users/123`).

---

## 16. Coding Challenge: Full-Stack Request-Response Pipeline

**Task**: Build a fully typed pipeline with a Zod schema for user creation, an Express validation middleware, and a typed controller.

```typescript
import { z } from 'zod';
import { type Request, type Response } from 'express';

// 1. Zod Schema with custom password validation
export const SignupSchema = z.object({
  username: z.string().min(3).max(20),
  email: z.string().email(),
  password: z.string().min(8).regex(/[A-Z]/, 'Must contain uppercase letter'),
});

export type SignupInput = z.infer<typeof SignupSchema>;

export interface SignupSuccessResponse {
  success: true;
  user: { id: string; username: string; email: string };
}

// 2. Strongly Typed Controller
export async function signupHandler(
  req: Request<{}, SignupSuccessResponse, SignupInput>,
  res: Response<SignupSuccessResponse>
): Promise<void> {
  const { username, email } = req.body; // Fully typed and validated!

  const newUser = {
    id: 'u_' + Math.random().toString(36).substring(2, 9),
    username,
    email,
  };

  res.status(201).json({
    success: true,
    user: newUser,
  });
}
```

---

## 17. Common Interview Traps

1. **"TypeScript types protect your backend from malformed JSON payloads."**  
   *Trap*: Believing types validate runtime network requests.  
   *Reality*: Types are completely erased. Runtime validation (Zod, Joi, class-validator) is mandatory.
2. **"`res.json()` prevents returning extra fields."**  
   *Trap*: Thinking Express strips unlisted properties.  
   *Reality*: TypeScript verifies `res.json()` at compile time, but at runtime Express serializes whatever object you pass it.

---

## 18. Revision Summary

- Express generic typing: `Request<Params, ResBody, ReqBody, ReqQuery>`.
- Never trust `req.body as Type`; always validate at the runtime boundary.
- **Zod**: Single source of truth for runtime validation and static TypeScript types (`z.infer`).
- Use shared DTO packages in monorepos to eliminate frontend-backend contract drift.
- Protect against Mass Assignment using `.strict()` or explicit `.pick()`.

---

## 19. Quick Reference

```typescript
// 1. Zod Schema & Inferred Type
export const EntitySchema = z.object({ id: z.string(), count: z.number() });
export type EntityDTO = z.infer<typeof EntitySchema>;

// 2. Express Route Typing
type CustomReq = Request<{ id: string }, ApiResponse, EntityDTO>;
```
