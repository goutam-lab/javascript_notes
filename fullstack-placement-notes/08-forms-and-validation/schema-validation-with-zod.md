# Schema Validation with Zod: Types, Inferences, Refinements, and Transforms

## 1. What is it?
Zod is a TypeScript-first schema declaration and runtime data validation library. Unlike traditional TypeScript types that vanish during compilation (leaving the runtime exposed to unvalidated JSON), Zod provides **runtime validation coupled with automatic static type inference**. With Zod, you define a single schema rule once, and TypeScript automatically derives the exact static type via `z.infer<typeof Schema>`.
- **`parse()`:** Validates data and returns the typed result; throws a `ZodError` if validation fails.
- **`safeParse()`:** Non-throwing validation returning a discriminated union (`{ success: true; data: T } | { success: false; error: ZodError }`).
- **`.refine()` / `.superRefine()`:** Custom procedural validation logic (e.g. password matching, database availability checks).
- **`.transform()`:** Mutates or coerces validated data into a desired output format (e.g. trimming strings, parsing ISO dates).

```
+-------------------------------------------------------------------------------+
|                             ZOD VALIDATION PIPELINE                           |
+-------------------------------------------------------------------------------+
| Untrusted Raw Input (API Payload / Form Submission / URL Query)               |
|    |                                                                          |
|    v                                                                          |
| Zod Schema: z.object({ email: z.string().email(), age: z.coerce.number() })   |
|    |                                                                          |
|    ├── 1. Coerce & Parse Types                                                |
|    ├── 2. Structural Property Validation                                      |
|    ├── 3. Custom Refinements (.refine())                                      |
|    ├── 4. Transformations (.transform())                                      |
|    v                                                                          |
| Discriminated Union Result:                                                   |
|    ├── { success: true, data: TypedSanitizedData }                            |
|    └── { success: false, error: ZodError (field-level issues) }               |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?
In JavaScript/TypeScript full-stack development, the boundary between the outside world and your application code is un-typed:
- An API request `req.body` or form submission `formData` is typed as `any` or `unknown`.
- Developers historically wrote manual TypeScript interfaces (`interface UserDTO { email: string }`) and cast input blindly (`const user = req.body as UserDTO`). If the client sent `null` or omitted `email`, the app crashed at runtime with `TypeError: Cannot read property of undefined`.
- Maintaining separate TypeScript interfaces and Joi/Yup validation schemas caused schema drift bugs.

Zod eliminates schema drift by establishing a single source of truth: the Zod schema acts as both the runtime validator and the static TypeScript type generator.

---

## 3. Mental Model
Think of Zod as a **Border Customs Officer with an Automated Passport Scanner**:
- You don't just tell the officer: "Trust me, I'm an engineer" (Type Assertion: `as User`).
- You hand over your physical passport (Raw Input).
- The officer places it in the scanner (Zod Schema).
- The scanner checks the barcode format (`z.string().email()`), verifies security holograms (`.refine()`), and stamps the entry date onto the visa page (`.transform()`).
- If anything fails, the officer issues a detailed rejection report (`ZodError`). If it passes, you are legally admitted as a certified citizen (`z.infer<typeof Schema>`).

---

## 4. Basic Example

### Defining Schemas, Inferred Types, and `safeParse`
```typescript
import { z } from 'zod';

// 1. Define Runtime Schema
export const UserRegistrationSchema = z.object({
  username: z.string().min(3, 'Username must be at least 3 characters').max(20),
  email: z.string().email('Invalid email address format'),
  age: z.number().int().min(18, 'Must be at least 18 years old'),
  role: z.enum(['admin', 'member', 'guest']).default('member'),
});

// 2. Automatically Derive Static TypeScript Type!
export type UserRegistrationDTO = z.infer<typeof UserRegistrationSchema>;
// Equivalent to:
// { username: string; email: string; age: number; role: 'admin' | 'member' | 'guest' }

// 3. Validate Untrusted Data without throwing
export function processRegistration(rawPayload: unknown) {
  const result = UserRegistrationSchema.safeParse(rawPayload);

  if (!result.success) {
    // result.error is strongly typed ZodError
    const formattedErrors = result.error.flatten().fieldErrors;
    console.error('Validation failed:', formattedErrors);
    return { success: false, errors: formattedErrors };
  }

  // result.data is 100% type-safe UserRegistrationDTO!
  console.log('Valid registration for user:', result.data.username);
  return { success: true, user: result.data };
}
```

---

## 5. Real Example

### Complex Schema with Multi-Field Refinement, Transformations, and Coercion
```typescript
// schemas/checkoutSchema.ts
import { z } from 'zod';

export const CheckoutOrderSchema = z
  .object({
    customerEmail: z.string().email().toLowerCase(), // Transform: lowercase automatically
    items: z
      .array(
        z.object({
          productId: z.string().uuid('Invalid Product UUID format'),
          quantity: z.number().int().positive('Quantity must be at least 1'),
          unitPriceCents: z.number().int().nonnegative(),
        })
      )
      .min(1, 'Cart cannot be empty; must contain at least 1 item'),

    // Coerce string inputs from HTML form to numbers/dates
    couponCode: z.string().trim().optional(),
    discountAmount: z.coerce.number().default(0),

    // Payment validation
    paymentMethod: z.enum(['CARD', 'INVOICE']),
    taxId: z.string().optional(),
  })
  // Cross-Field Validation Refinement:
  .refine(
    (data) => {
      // If payment is via INVOICE, taxId is strictly mandatory
      if (data.paymentMethod === 'INVOICE' && (!data.taxId || data.taxId.trim().length === 0)) {
        return false;
      }
      return true;
    },
    {
      message: 'Tax ID is strictly required when selecting Corporate Invoice billing',
      path: ['taxId'], // Points error specifically to the taxId field
    }
  );

export type CheckoutOrderInput = z.infer<typeof CheckoutOrderSchema>;
```

---

## 6. Under the Hood

### 1. `safeParse` Discriminated Union Pattern
`safeParse()` returns a discriminated union keyed on the boolean `success` property:
```typescript
type SafeParseReturnType<Output> =
  | { success: true; data: Output }
  | { success: false; error: ZodError };
```
Because of TypeScript control-flow analysis, checking `if (!result.success)` automatically narrows `result.error` in the truthy branch and `result.data` in the else branch, guaranteeing compile-time safety.

### 2. Output Types vs. Input Types in Transformations
When you use `.transform()` or `z.coerce`, the input type may differ from the output type:
```typescript
const NumericStringSchema = z.string().transform((val) => parseInt(val, 10));
type InputType = z.input<typeof NumericStringSchema>;   // string
type OutputType = z.output<typeof NumericStringSchema>; // number
```
- `z.infer` resolves to `z.output`.

---

## 7. Important Rules
1. **Prefer `safeParse()` in Production:** In web APIs, Server Actions, and user forms, never use `parse()` without a wrapping try/catch block. Uncaught `ZodError` exceptions crash requests with HTTP 500. Use `safeParse()` and return friendly validation envelopes.
2. **Assign Refinement Errors to Specific Paths:** Always provide `path: ['fieldName']` in `.refine()`. If omitted, the error attaches to the root object, making it impossible for form UI components to highlight the specific input field!
3. **Use `z.coerce` for Form Submissions:** Native HTML forms and URL query strings submit numbers and booleans as strings (`"123"`, `"true"`). Use `z.coerce.number()` and `z.coerce.boolean()` to cast them seamlessly during validation.
4. **Schema Composition Methods:**
   - `.extend({ newField: z.string() })`: Adds fields.
   - `.merge(OtherSchema)`: Merges two object schemas.
   - `.pick({ fieldA: true })` / `.omit({ fieldB: true })`: Subsets fields.
   - `.partial()`: Makes all fields optional.

---

## 8. Common Mistakes

### Mistake 1: Refinement Without Path Specification
```typescript
// ❌ WRONG: Error attaches to root object; UI input cannot display the error banner!
z.object({ password: z.string(), confirm: z.string() })
  .refine((data) => data.password === data.confirm, 'Passwords do not match');

// ✅ FIXED:
z.object({ password: z.string(), confirm: z.string() })
  .refine((data) => data.password === data.confirm, {
    message: 'Passwords do not match',
    path: ['confirm'], // Points error directly to confirm password input!
  });
```

### Mistake 2: Using `.preprocess()` Instead of Coercion
```typescript
// ❌ COMPLEX & VERBOSE:
z.preprocess((val) => Number(val), z.number())

// ✅ MODERN & CLEAN:
z.coerce.number()
```

---

## 9. Best Practices
1. **Share Schemas Across Full Stack:** Colocate schemas in a shared package or directory (`packages/shared/schemas` or `@/lib/schemas`). The exact same Zod schema validates the React Hook Form, the Next.js Server Action, and the Express backend controller.
2. **Use `.strip()` by Default (Zod Standard):** Zod automatically strips excess unknown properties not defined in the schema, protecting against object injection attacks.
3. **Use `.superRefine()` for Dynamic Multi-Issue Validation:** When validating complex conditions that can emit multiple distinct errors at different paths, use `.superRefine((data, ctx) => { ctx.addIssue({ ... }) })`.

---

## 10. Performance Considerations
- **Cold Schema Compilation:** Creating a Zod schema is synchronous and fast (~0.05ms). However, avoid recreating large schemas inside tight loops or component render bodies. Define schemas once as module-level constants.
- **Deep Nesting Overhead:** Deeply nested array validations on payloads with >50,000 items can block the event loop. In high-throughput ingest pipelines, benchmark or use lightweight validators if necessary.

---

## 11. Security Considerations
- **Prototype Pollution Protection:** Zod parses objects cleanly and does not copy `__proto__` or `constructor` properties, defending against prototype pollution attacks.
- **Strict Regular Expressions:** When using `z.string().regex(/.../)`, ensure regular expressions are not vulnerable to Regular Expression Denial of Service (ReDoS) with catastrophic backtracking.

---

## 12. Alternatives
- **Yup:** Historically popular with Formik, but lacks native static type inference and has weaker TypeScript integration.
- **Joi:** Popular in Node.js/Express, but heavy, runtime-only, and lacks TypeScript type generation.
- **Valibot / TypeBox:** Ultra-lightweight modular alternatives (~1KB) optimized for extreme bundle size constraints.

---

## 13. Trade-offs

| Criterion | Zod | Yup | Joi |
| :--- | :--- | :--- | :--- |
| **Static Type Inference** | **Best (`z.infer`)** | Partial | None |
| **Coercion & Transform** | Built-in | Cast method | Cast method |
| **Bundle Size** | ~12 KB | ~14 KB | ~50 KB (Node-focused)|
| **Ecosystem Adoption** | Industry Standard (RHF, tRPC, Next.js) | Legacy React | Legacy Express |

---

## 14. Real-World Usage
- **tRPC Full-Stack Type Safety:** Every tRPC procedure defines its input contract using a Zod schema (`.input(z.object(...))`), generating end-to-end type safety between backend and frontend.
- **Next.js Server Actions & Route Handlers:** Validating incoming untrusted JSON requests before touching databases.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the difference between `parse()` and `safeParse()` in Zod?**  
*Answer:* `parse()` validates data and returns the parsed result, but throws a `ZodError` if validation fails. `safeParse()` does not throw exceptions; it returns a discriminated union: `{ success: true, data: T }` on success or `{ success: false, error: ZodError }` on failure.

### Conceptual
**Q: How does `z.infer<typeof Schema>` work in TypeScript?**  
*Answer:* `z.infer` uses TypeScript's conditional types and `infer` keyword under the hood. It inspects the internal structural definition of the Zod schema object and unpacks the corresponding static TypeScript interface matching the validated output type.

### Implementation
**Q: Write a Zod schema for a password confirmation form ensuring both passwords match, attaching the error specifically to `confirmPassword`.**  
*Answer:*
```typescript
import { z } from 'zod';

export const PasswordResetSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });
```

### Debugging
**Q: A query string returns `"42"` as a string, but the schema expects `z.number()`. `Schema.safeParse({ id: "42" })` fails. How do you fix it without manual parsing?**  
*Answer:* Use Zod coercion: `z.coerce.number()`. Zod will automatically convert the string `"42"` into the number `42` before running validation:
```typescript
const QuerySchema = z.object({ id: z.coerce.number() });
```

### Scenario
**Q: You want an existing `UserSchema` to be reused for an "Update User Profile" endpoint where all fields are optional except `id`. How do you compose the schema?**  
*Answer:* Combine `.partial()` with `.extend()` or `.merge()`:
```typescript
const UpdateUserSchema = UserSchema.partial().extend({
  id: z.string().uuid(), // id remains strictly required
});
```

### Advanced
**Q: What is the difference between `z.input<typeof Schema>` and `z.output<typeof Schema>`?**  
*Answer:* When a schema includes transformations (`.transform()`) or coercion (`z.coerce`), the data type accepted by the schema on entry (`z.input`) may differ from the validated data type returned on exit (`z.output`). For example, with `z.string().transform(s => s.length)`, `z.input` is `string`, while `z.output` is `number`. `z.infer` defaults to `z.output`.

---

## 16. Coding Questions

### Problem: Implement an Express.js Middleware Validator Powered by Zod
```typescript
// middleware/validateRequest.ts
import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';

export const validateRequest = (schema: AnyZodObject) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate body, query, and params in one schema
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      // Assign sanitized data back to request
      req.body = parsed.body;
      req.query = parsed.query;
      req.params = parsed.params;

      return next();
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request payload',
            details: error.flatten().fieldErrors,
          },
        });
      }
      return res.status(500).json({ success: false, error: 'Internal validation failure' });
    }
  };
};
```

---

## 17. Common Interview Traps
- **Trap 1:** "`z.infer` runs at runtime to validate data."  
  *Truth:* False! `z.infer` is purely a TypeScript compile-time type utility that generates types. Only `.parse()` and `.safeParse()` execute at runtime.
- **Trap 2:** "Zod modifies input objects in place."  
  *Truth:* False. Zod parses and returns a clean, newly constructed object.

---

## 18. Revision Summary
- Zod bridges static TypeScript types and runtime validation into a single definition.
- Use `safeParse()` to avoid unhandled exception crashes.
- Derive static types using `type T = z.infer<typeof Schema>`.
- Use `.refine({ path: ['field'] })` for custom cross-field validation rules.
- Use `z.coerce.number()` to automatically cast string inputs from HTML forms and query strings.

---

## 19. Quick Reference

```
+------------------------------------+-------------------------------------------+
| Zod Method                         | Purpose / Example                         |
+------------------------------------+-------------------------------------------+
| z.object({ ... })                  | Structural object validation              |
| z.infer<typeof Schema>             | Generates static TypeScript type          |
| schema.safeParse(input)            | Non-throwing validation (discriminated u) |
| z.coerce.number()                  | Coerces string "123" into number 123      |
| .refine(fn, { message, path })     | Custom validation with targeted field path|
| .transform(fn)                     | Modifies output data during parsing       |
| schema.partial()                   | Makes all schema fields optional          |
| schema.extend({ newKey: z... })    | Adds new keys to an existing schema       |
+------------------------------------+-------------------------------------------+
```
