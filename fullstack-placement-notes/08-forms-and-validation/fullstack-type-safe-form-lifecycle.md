# Full-Stack Type-Safe Form Lifecycle: End-to-End Schema Sharing

## 1. What is it?
The Full-Stack Type-Safe Form Lifecycle is an end-to-end architecture where a **single Zod schema** serves as the universal contract across all tiers of a web application:
1. **Frontend Client Validation:** Powers client-side validation in React Hook Form via `@hookform/resolvers/zod`.
2. **Next.js Server Action Validation:** Validates incoming `FormData` on the server before database execution.
3. **Standalone Express/Node.js API Validation:** Validates HTTP request bodies in REST controllers via middleware.
4. **Database DTO / Model Typing:** Inferred types (`z.infer<typeof Schema>`) generate TypeScript interfaces for ORMs (Prisma, Drizzle, Mongoose).

```
+-------------------------------------------------------------------------------+
|                    FULL-STACK TYPE-SAFE CONTRACT LIFECYCLE                    |
+-------------------------------------------------------------------------------+
|               Shared Zod Contract: shared/schemas/user.ts                     |
|                   export const UserSchema = z.object({ ... })                 |
|                   export type UserDTO = z.infer<typeof UserSchema>            |
+-------------------------------------------------------------------------------+
         |                              |                               |
         v                              v                               v
[ React Hook Form ]          [ Next.js Server Action ]        [ Express Controller ]
zodResolver(UserSchema)       UserSchema.safeParse(formData)   UserSchema.parse(req.body)
Instant UI errors             Progressive Enhancement          Standard REST API
         |                              |                               |
         +------------------------------+-------------------------------+
                                        |
                                        v
                          [ Database Persistence Layer ]
                           Prisma / PostgreSQL / Mongo
```

---

## 2. Why does it exist?
In traditional full-stack web applications without shared contracts:
- **Triple Duplication:** A developer defines the `User` shape 3 times: an interface in React, a Joi/Yup schema in Express, and a Prisma model in the database.
- **Contract Drift & Silent Bugs:** The backend adds a required field `phoneNumber`. The frontend team doesn't know until users report that form submissions fail with generic 500 errors in production.
- **Inconsistent Error Responses:** The client validates `minLength(8)`, but the backend validates `minLength(10)`, causing jarring form submission rejections after client-side checks passed.

Sharing a single Zod schema across the entire stack eliminates contract drift, guarantees identical validation rules, and enables compile-time type safety across the network boundary.

---

## 3. Mental Model
Think of the Shared Schema as an **Architectural Blueprint for a Standardized Brick**:
- The clay factory (Client Form) uses the mold to shape the brick.
- The shipping inspector (Next.js Server Action) uses the identical mold to verify dimensions before loading the truck.
- The customs officer at the border (Express API) measures the brick with the exact same mold.
- The bricklayer at the construction site (PostgreSQL Database) only accepts bricks stamped with that mold.
- If an engineer updates the blueprint, every machine in the entire supply chain updates simultaneously at compile time.

---

## 4. Basic Example

### The Shared Contract File
```typescript
// shared/schemas/contact.ts
import { z } from 'zod';

export const ContactFormSchema = z.object({
  fullName: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Invalid email format'),
  message: z.string().min(10, 'Message must be at least 10 characters').max(1000),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
});

// Single static TypeScript type derived from schema
export type ContactFormInput = z.infer<typeof ContactFormSchema>;
```

---

## 5. Real Example

### Complete Full-Stack Implementation: Shared Schema in React Hook Form, Next.js Server Action, and Express
```typescript
// 1. FRONTEND CLIENT: components/ContactForm.tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ContactFormSchema, ContactFormInput } from '@/shared/schemas/contact';
import { submitContactAction } from '@/app/actions/contactActions';
import { useState } from 'react';

export function ContactForm() {
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<ContactFormInput>({
    resolver: zodResolver(ContactFormSchema), // Exact shared schema!
    defaultValues: { priority: 'MEDIUM' },
  });

  const onSubmit = async (data: ContactFormInput) => {
    setServerError(null);
    const result = await submitContactAction(data);

    if (!result.success) {
      setServerError(result.error);
    } else {
      setSuccess(true);
      reset();
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="max-w-md p-6 border rounded-lg bg-white space-y-4">
      <h2 className="text-xl font-bold">Inquire with Engineering</h2>

      {serverError && <div className="p-3 bg-red-100 text-red-700 text-sm rounded">{serverError}</div>}
      {success && <div className="p-3 bg-green-100 text-green-700 text-sm rounded">Message dispatched!</div>}

      <div>
        <label className="block text-sm font-medium">Full Name</label>
        <input {...register('fullName')} className="w-full p-2 border rounded mt-1" />
        {errors.fullName && <p className="text-red-500 text-xs mt-1">{errors.fullName.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium">Email</label>
        <input {...register('email')} type="email" className="w-full p-2 border rounded mt-1" />
        {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email.message}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium">Message</label>
        <textarea {...register('message')} rows={4} className="w-full p-2 border rounded mt-1" />
        {errors.message && <p className="text-red-500 text-xs mt-1">{errors.message.message}</p>}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full py-2 bg-blue-600 text-white font-semibold rounded disabled:bg-blue-300"
      >
        {isSubmitting ? 'Transmitting...' : 'Send Message'}
      </button>
    </form>
  );
}
```

```typescript
// 2. NEXT.JS SERVER ACTION: app/actions/contactActions.ts
'use server';

import { ContactFormSchema, ContactFormInput } from '@/shared/schemas/contact';
import db from '@/lib/db';

export async function submitContactAction(rawData: ContactFormInput) {
  // Validate data on the server with identical shared schema
  const parsed = ContactFormSchema.safeParse(rawData);

  if (!parsed.success) {
    return {
      success: false,
      error: 'Server rejection: Malformed or invalid schema data',
    };
  }

  const { fullName, email, message, priority } = parsed.data;

  try {
    await db.inquiry.create({
      data: { fullName, email, message, priority },
    });
    return { success: true };
  } catch (err) {
    return { success: false, error: 'Database transaction failure' };
  }
}
```

```typescript
// 3. STANDALONE EXPRESS BACKEND: server/controllers/contactController.ts
import { Request, Response } from 'express';
import { ContactFormSchema } from '../../shared/schemas/contact';
import db from '../db';

export async function createContactExpressHandler(req: Request, res: Response) {
  // Reusing the exact same schema for external mobile / REST API consumers
  const parsed = ContactFormSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      success: false,
      errors: parsed.error.flatten().fieldErrors,
    });
  }

  const newRecord = await db.inquiry.create({ data: parsed.data });
  return res.status(201).json({ success: true, data: newRecord });
}
```

---

## 6. Under the Hood

### 1. Monorepo / Package Sharing Structure
In modern Turborepo or npm workspace setups:
```
my-monorepo/
  ├── packages/
  │     └── contracts/ (or shared/)
  │           ├── package.json (Exports Zod schemas)
  │           └── src/
  │                 └── userSchema.ts
  ├── apps/
  │     ├── web/ (Next.js - imports @repo/contracts)
  │     └── api/ (Express / NestJS - imports @repo/contracts)
```
- When a backend engineer updates a validation rule in `@repo/contracts`, TypeScript compiler checks in `apps/web` fail immediately if the frontend form does not conform!
- Eliminates manual sync meetings and API documentation drift.

### 2. Unified Error Code Translation
Zod issues carry standardized codes (`too_small`, `invalid_string`, `custom`). The `@hookform/resolvers/zod` package translates Zod's `issue.message` and `issue.path` directly into React Hook Form's `FieldError` map:
```
ZodError Issue: { path: ['email'], message: 'Invalid email' }
           |
           v (Automated translation by resolver)
RHF errors object: { email: { message: 'Invalid email', type: 'invalid_string' } }
```

---

## 7. Important Rules
1. **Never Trust Client Validation:** Client-side validation exists purely for user experience (instant feedback). All authorization, business logic constraints, and schema checks **must** be re-executed on the server before mutating databases.
2. **Schemas Must Be Pure and Dependency-Free:** Never import Node.js native modules (`fs`, `crypto`) or database libraries (Prisma) inside your shared schema files. Shared schemas must compile cleanly in both browser and server environments.
3. **Use Coercion for Universal Endpoints:** In Express, query parameters arrive as strings. In Next.js Server Actions, `formData` entries arrive as strings. Use `z.coerce` so schemas handle both JSON objects and form data effortlessly.
4. **Colocate Inferred Types:** Always export `export type ModelInput = z.infer<typeof ModelSchema>` alongside the schema. Never manually write a matching TypeScript interface.

---

## 8. Common Mistakes

### Mistake 1: Importing Backend-Only Packages into Shared Schema Files
```typescript
// shared/schemas/user.ts
import prisma from '@/lib/db'; // ❌ FATAL ERROR: Importing DB client into client-consumed schema crashes browser build!
```
**Fix:** Keep database checks in Server Actions or API controllers; use `.refine()` with pure logic in shared schemas.

### Mistake 2: Manually Re-typing DTOs
```typescript
// ❌ ANTI-PATTERN:
export const UserSchema = z.object({ email: z.string().email() });
export interface UserDTO { email: string } // Will drift over time!

// ✅ FIXED:
export type UserDTO = z.infer<typeof UserSchema>;
```

---

## 9. Best Practices
1. **Colocate Shared Contracts in a Dedicated Directory:** Maintain all schemas in `packages/contracts/src/` or `@/shared/schemas/`.
2. **Version External API Contracts:** If third-party clients consume your Express endpoints, maintain versioned schemas: `UserSchemaV1`, `UserSchemaV2`.
3. **Use Standardized API Error Envelopes:**
   ```typescript
   interface ApiErrorResponse {
     success: false;
     error: {
       code: 'VALIDATION_FAILED';
       details: Record<string, string[]>;
     };
   }
   ```

---

## 10. Performance Considerations
- **Tree-Shaking:** Zod is fully modular and tree-shakeable. Importing specific schemas into client bundles adds only ~8KB to the client bundle.
- **Zero Redundant Parsing:** Validation takes <0.1ms for typical form payloads, introducing undetectable overhead on server throughput.

---

## 11. Security Considerations
- **Parameter Injection Defense:** Zod automatically strips undeclared keys by default (`.strip()`), preventing attackers from injecting unauthorized fields (e.g. `isAdmin: true` or `role: 'ROOT'`) into database insert queries.
- **Strict Parsing with `.strict()`:** For high-security endpoints, invoke `.strict()` on the schema to reject any request containing unrecognized parameters with an error.

---

## 12. Alternatives
- **tRPC:** End-to-end type safety framework that uses Zod schemas to generate typed React Query hooks automatically without manual fetch boilerplate.
- **GraphQL with CodeGen:** Generates types from GraphQL schemas; excellent for microservices, but requires heavy compilation toolchains.

---

## 13. Trade-offs

| Strategy | Advantages | Drawbacks |
| :--- | :--- | :--- |
| **Shared Zod Contracts**| 0 schema drift; full-stack type safety; auto-types | Requires monorepo or shared package setup |
| **Separate Frontend/Backend**| Independent repos; decoupled deployment | High contract drift risk; duplicate validation code |
| **tRPC** | Complete RPC automation with zero fetch code | Tight coupling; not consumable by non-TS clients |

---

## 14. Real-World Usage
- **Modern Full-Stack Monorepos (Turborepo + Next.js + Express):** Teams share schemas across web frontends, mobile React Native apps, and backend microservices to ensure complete validation parity.
- **Stripe / FinTech Payment Forms:** Shared card and customer validation schemas executed in both browser preview and backend settlement layers.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the primary benefit of sharing a single Zod schema between frontend and backend?**  
*Answer:* It establishes a single source of truth for data contracts. Validation rules, error messages, and TypeScript types are defined once, eliminating schema drift between the client and server while ensuring identical validation behavior across both tiers.

### Conceptual
**Q: How does `@hookform/resolvers/zod` map Zod validation errors to React Hook Form errors?**  
*Answer:* The resolver executes `schema.safeParse(values)`. If validation fails, it converts Zod's internal issue structure (`issue.path` and `issue.message`) into React Hook Form's flat `FieldErrors` object (`{ [path]: { message, type } }`), allowing form components to display error messages seamlessly.

### Implementation
**Q: How do you configure a Zod schema to reject unknown properties instead of silently stripping them?**  
*Answer:* Chain `.strict()` onto the object schema:
```typescript
export const StrictUserSchema = z.object({
  username: z.string(),
  email: z.string().email(),
}).strict(); // Throws validation error if extra fields are present!
```

### Debugging
**Q: A frontend form using a shared schema fails client validation, but when testing the endpoint with Postman using the exact same JSON payload, the backend accepts it. Why?**  
*Answer:* The backend might be using a stale, un-updated version of the schema (missing build/re-publish of the shared package), or the backend route handler omitted the validation middleware call (`schema.parse(req.body)`), allowing invalid data to reach the database directly.

### Scenario
**Q: You are refactoring a massive legacy app where the frontend and backend live in two separate Git repositories. How do you share Zod schemas without a monorepo?**  
*Answer:* Publish the shared schemas as a private internal npm package (e.g. `@myorg/contracts`). Both the frontend and backend repositories install this package as a dependency. When a schema changes, a CI/CD pipeline publishes a new version, and automated Dependabot/Renovate PRs update both repositories.

### Advanced
**Q: How does Zod's `.transform()` behave when shared between a React Hook Form client and an Express backend?**  
*Answer:* In React Hook Form, `handleSubmit(onSubmit)` receives the **transformed** output data (`z.output`), not the raw input. On the backend, `schema.parse(req.body)` also returns the transformed data. This ensures both tiers work with sanitized, normalized data (e.g. trimmed strings, lowercased emails, parsed dates).

---

## 16. Coding Questions

### Problem: Build a Reusable Type-Safe Server Action Form Handler Helper
```typescript
// lib/safeAction.ts
import { z, ZodSchema } from 'zod';

type ActionHandler<TInput, TOutput> = (data: TInput) => Promise<TOutput>;

export function createSafeAction<TInput, TOutput>(
  schema: ZodSchema<TInput>,
  handler: ActionHandler<TInput, TOutput>
) {
  return async (rawInput: unknown) => {
    // Validate with shared schema
    const parsed = schema.safeParse(rawInput);

    if (!parsed.success) {
      return {
        success: false as const,
        validationErrors: parsed.error.flatten().fieldErrors,
      };
    }

    try {
      const data = await handler(parsed.data);
      return { success: true as const, data };
    } catch (error: any) {
      return {
        success: false as const,
        serverError: error.message || 'An unexpected failure occurred',
      };
    }
  };
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "If client validation passes with Zod, backend validation can be skipped."  
  *Truth:* False! An attacker can bypass the frontend entirely by sending requests via Postman, cURL, or malicious scripts. Backend validation is always mandatory.
- **Trap 2:** "Zod schemas add massive bloat to the client bundle."  
  *Truth:* False. Zod is modular and tree-shakeable (~8KB), which is negligible compared to modern frontend dependencies.

---

## 18. Revision Summary
- End-to-end schema sharing with Zod creates a single source of truth for runtime validation and static TypeScript types.
- Powers React Hook Form on the client and Server Actions / Express controllers on the backend.
- Derive static types using `z.infer<typeof Schema>` to eliminate duplicate interface definitions.
- Keep shared schema files free of environment-specific dependencies (pure TS/JS).
- Always enforce backend validation regardless of client-side checks.

---

## 19. Quick Reference

```
+------------------------------------+-------------------------------------------+
| Full-Stack Contract Architecture   | Location / Utility                        |
+------------------------------------+-------------------------------------------+
| Shared Contract Source             | shared/schemas/*.ts or @repo/contracts    |
| Static Type Generation             | export type DTO = z.infer<typeof Schema>  |
| Client Form Integration            | useForm({ resolver: zodResolver(Schema) })|
| Next.js Server Action Guard        | const res = Schema.safeParse(input)       |
| Express Validation Middleware      | req.body = Schema.parse(req.body)         |
| Strict Parameter Filtering         | Schema.strict() (rejects unknown keys)    |
| Safe Coercion for Strings          | z.coerce.number() / z.coerce.boolean()    |
+------------------------------------+-------------------------------------------+
```
