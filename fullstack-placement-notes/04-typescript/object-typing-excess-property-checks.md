# Object Typing, Excess Property Checks & Shape Mutability

## 1. What is it?
In TypeScript, **Object Typing** defines the shape, property names, value types, and mutability constraints of JavaScript objects.

While TypeScript adheres to **Structural Subtyping** (where an object is allowed to have more properties than an interface requires), it applies a special heuristic verification known as **Excess Property Checking** to freshly created **object literals**.

Understanding why TypeScript permits extra properties when assigning through a variable reference, but strictly forbids them when assigning an inline object literal, is one of the most frequently asked conceptual questions in senior technical interviews.

---

## 2. Why does it exist?
Consider what happens when writing code in JavaScript:
- A developer writes an options object for an HTTP client:
  ```typescript
  interface RequestOptions {
    url: string;
    method?: 'GET' | 'POST';
  }
  ```
- If the developer makes a typo:
  ```typescript
  const options: RequestOptions = {
    url: 'https://api.com',
    methd: 'POST', // Typo! 'methd' instead of 'method'!
  };
  ```
- Under pure structural typing rules, because `{ url: string, methd: string }` has all required properties of `RequestOptions` (namely `url`), this code would be **100% legal**! The request would silently fall back to `GET`, producing a silent, catastrophic production bug.
- **The Excess Property Check Solution**: TypeScript detects that you are creating a *fresh object literal* specifically to satisfy `RequestOptions`. Since `methd` is not a recognized property, TypeScript assumes you made a mistake and throws an immediate compile-time error.

---

## 3. Mental Model: Fresh Literals vs. Used Reference
💡 **Think of a Specialized Tool Mold vs. a Generalized Swiss Army Knife:**

```
                  FRESH OBJECT LITERAL ASSIGNMENT
┌─────────────────────────────────────────────────────────────┐
│  const user: User = { name: 'Alice', extra: 123 };          │
│  The compiler sees a purpose-built object literal.          │
│  "Why did you forge this extra key if User cannot use it?" │
│  💥 Excess Property Error!                                 │
└─────────────────────────────────────────────────────────────┘

                  INDIRECT VARIABLE REFERENCE ASSIGNMENT
┌─────────────────────────────────────────────────────────────┐
│  const person = { name: 'Alice', extra: 123, age: 30 };     │
│  const user: User = person; // ✅ 100% Allowed!             │
│  The compiler sees an existing general-purpose object.      │
│  "person has a 'name' string, so it satisfies User."        │
└─────────────────────────────────────────────────────────────┘
```

- When you write an object literal inline (`{ ... }`), TypeScript knows it has no other references and will never be used anywhere else. An unrecognized property is almost certainly a bug or a typo.
- When you pass an existing variable reference, TypeScript falls back to standard **Width Subtyping** (it only cares that the required fields are present).

---

## 4. The Code Phenomenon in Action

```typescript
interface Point {
  x: number;
  y: number;
}

// Case 1: Fresh Object Literal
// ❌ COMPILE ERROR: Object literal may only specify known properties, and 'z' does not exist in type 'Point'.
const p1: Point = {
  x: 10,
  y: 20,
  z: 30, 
};

// Case 2: Indirect Variable Reference
const point3D = {
  x: 10,
  y: 20,
  z: 30,
};

// ✅ COMPILES WITHOUT ERROR!
const p2: Point = point3D; 

console.log(p2.x, p2.y); // 10, 20
// console.log(p2.z); // ❌ Error: Property 'z' does not exist on type 'Point' (even though it exists in JS memory!)
```

---

## 5. Optional Properties vs. `undefined`

In TypeScript, `property?: string` allows a property to either be a `string` or `undefined`, or omitted entirely:

```typescript
interface UserProfile {
  name: string;
  bio?: string; // Equivalent to: string | undefined (when omitted)
}

const u1: UserProfile = { name: 'Alice' }; // ✅ Omitted
const u2: UserProfile = { name: 'Bob', bio: undefined }; // ✅ Explicit undefined
```

### The `exactOptionalPropertyTypes` Flag (`tsconfig.json`)
By default, TypeScript treats omitting a property and passing `undefined` as identical. However, in modern strict codebases, you can enable `"exactOptionalPropertyTypes": true`:
```typescript
// With "exactOptionalPropertyTypes": true
const u3: UserProfile = {
  name: 'Charlie',
  bio: undefined, // ❌ ERROR! Must be string or omitted, NOT explicitly undefined!
};
```
This is critical for database ORMs where `undefined` might mean "do not update this column", while omitting the key means "no value provided".

---

## 6. Readonly Properties & Const Immutability

You can mark object properties as immutable using the `readonly` modifier:

```typescript
interface DatabaseConfig {
  readonly host: string;
  readonly port: number;
}

const config: DatabaseConfig = {
  host: 'localhost',
  port: 5432,
};

// ❌ COMPILE ERROR: Cannot assign to 'port' because it is a read-only property.
// config.port = 3306;

// Shallow Immutability Caveat:
interface Org {
  readonly details: {
    address: string;
  };
}

const org: Org = { details: { address: 'Main St' } };
// org.details = { address: 'New St' }; // ❌ Error: details is readonly
org.details.address = 'Broadway'; // ⚠️ LEGAL! readonly is shallow!
```

To make an entire nested object deeply immutable at compile time, use `as const`:
```typescript
const deepConfig = {
  db: {
    host: 'localhost',
    port: 5432,
  },
} as const; // All nested properties are readonly!
```

---

## 7. Index Signatures vs. `Record<K, V>`

When an object can have arbitrary keys that are not known ahead of time, use an **Index Signature** or the **`Record` utility type**:

```typescript
// 1. Index Signature
interface DynamicCache {
  [key: string]: string | number;
}

// 2. Record Utility Type
type ScoreCard = Record<string, number>;

const scores: ScoreCard = {
  alice: 95,
  bob: 88,
  // charlie: "failed" // ❌ Error: must be number!
};
```

---

## 8. Common Mistakes

### Mistake 1: Bypassing excess property checks using type assertions (`as Type`)
```typescript
interface ButtonProps {
  label: string;
  onClick: () => void;
}

// ❌ DANGEROUS: Type assertion disables excess property checking!
const props = {
  label: 'Submit',
  onClick: () => {},
  colour: 'red', // Typo! 'colour' instead of 'color'
} as ButtonProps; // Compiles silently! Typo goes undetected!

// ✅ CORRECT: Use explicit type annotation, not assertion
const safeProps: ButtonProps = {
  label: 'Submit',
  onClick: () => {},
  // colour: 'red' // 💥 Caught immediately by compiler!
};
```

---

## 9. Best Practices

1. **Avoid Type Assertions (`as`) on Object Creation**: Always annotate variables with their type (`const x: Type = ...`) rather than asserting (`const x = ... as Type`) so Excess Property Checks remain active.
2. **Use `Record<string, unknown>` for Untrusted Dynamic Objects**: Never use `{}` or `object` for arbitrary dictionaries; use `Record<string, unknown>` to enforce type narrowing before reading values.
3. **Use `Readonly<T>` for Functional Immutability**: Ensure props and state objects in React/Redux cannot be mutated in place.

---

## 10. Performance Considerations

- **Compiler Object Shape Optimization**: Avoid massive objects with 200+ individual optional properties. The TypeScript compiler constructs combinatorial state graphs to verify optional shapes. Break large options objects into smaller, composable nested interfaces.

---

## 11. Security Considerations

- **Object Injection & Prototype Pollution**: At runtime, JavaScript objects can be polluted via `__proto__`. TypeScript's type system cannot protect against prototype pollution attacks on raw JSON payloads; use `Object.create(null)` or validate inputs with Zod.

---

## 12. Alternatives

| Approach | Use Case | Excess Checking? |
| :--- | :--- | :--- |
| **Object Literal Annotation** | Creating new configurations | ✅ Enforced strictly |
| **Variable Reference** | Passing multi-purpose objects | ❌ Bypassed (Width subtyping) |
| **Index Signature (`[k: string]`)** | Open dictionary maps | ❌ All keys allowed |
| **Discriminated Union** | Known distinct shapes | ✅ Enforced per variant |

---

## 13. Trade-offs

- **Benefit**: Catches misspelled property names and stale config keys before code runs.
- **Cost**: Can occasionally feel counter-intuitive when an engineer expects pure structural typing and encounters an excess property error on an inline literal.

---

## 14. Real-World Usage

- **React Props Verification**: Catching invalid props passed to components (`<Button variant="primary" oncLick={handleClick} />` $\rightarrow$ catches `oncLick`).
- **ORM Query Builders**: Prisma and Drizzle use excess property checks to ensure you cannot pass non-existent database column names into queries.

---

## 15. Placement Interview Questions

### Basic
**Q: What is Excess Property Checking in TypeScript?**  
*Answer*: Excess Property Checking is a validation step in TypeScript that triggers when an object literal is assigned to a variable of an interface type or passed as an argument to a function. If the object literal contains any property not defined in the target interface, TypeScript raises a compile-time error, preventing silent bugs caused by typos or unrecognized properties.

### Conceptual
**Q: Why does `const user: User = { name: "Alice", extra: 123 }` fail, but assigning the same object through an intermediary variable succeeds?**  
*Answer*: This is an intentional design distinction between **fresh object literals** and **variable references**. Inline object literals have no other purpose than fulfilling that specific type assignment; an extra property is almost certainly a typo or mistake. An existing variable reference, however, may be a broader object created for multiple purposes. TypeScript allows the variable reference under standard **Structural Subtyping** (width subtyping), verifying that all required properties exist while ignoring extraneous ones.

### Implementation
**Q: How can you bypass excess property checks when you legitimately need to allow arbitrary extra properties on an interface?**  
*Answer*: Add a string index signature to the interface definition:
```typescript
interface FlexibleConfig {
  apiKey: string;
  [extraKey: string]: unknown; // Allows any number of additional properties
}
```

### Debugging
**Q: A developer uses `as User` to cast an object literal and wonders why TypeScript didn't catch their typo in `emial: "test@test.com"`. How do you explain this?**  
*Answer*: A type assertion (`as Type`) overrides the compiler's static analysis, telling TypeScript: *"Trust me, I know this object satisfies `User`."* Type assertions disable both excess property checks and standard type verification. To retain type safety, replace `as User` with an explicit variable type annotation: `const user: User = { ... }`.

### Scenario
**Q: In your API backend, you accept a user update object: `interface UpdateUserDTO { name?: string; age?: number; }`. How do you prevent an attacker from sending `{ admin: true }`?**  
*Answer*: At compile time, ensure DTOs do not contain index signatures so internal callers cannot pass unauthorized properties. At runtime (at the Express/NestJS boundary), strip or reject extra properties using a schema validator like Zod with `.strict()` (`z.object({ name: z.string().optional(), age: z.number().optional() }).strict()`), which throws a 400 Bad Request if unexpected keys are present in the HTTP request body.

### Advanced
**Q: How does TypeScript determine whether an object type is "fresh"?**  
*Answer*: During the type-checking phase, the compiler assigns an internal `FreshObjectLiteral` flag to any expression syntactically declared as an object literal (`{ ... }`). As long as this flag is present, TypeScript applies excess property checks. The moment the object literal is assigned to a non-contextually-typed variable or used in an expression with other operators, the freshness flag is stripped, and the object is treated as a regular structural reference.

---

## 16. Coding Challenge: Safe Config Merging with Strict Keys

**Task**: Write a function `mergeDefaults` that merges a user-supplied options object with default options, guaranteeing that the user cannot pass unrecognized config keys, even via variable references, using TypeScript generics and `keyof`.

```typescript
interface ServerConfig {
  port: number;
  host: string;
  maxConnections: number;
  useSsl: boolean;
}

const DEFAULT_CONFIG: ServerConfig = {
  port: 8080,
  host: '0.0.0.0',
  maxConnections: 1000,
  useSsl: false,
};

// Enforces that T cannot have keys that do not exist on ServerConfig
export function mergeConfig<T extends Partial<ServerConfig>>(
  overrides: T & Record<Exclude<keyof T, keyof ServerConfig>, never>
): ServerConfig {
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
  };
}

// Verification:
mergeConfig({ port: 3000, useSsl: true }); // ✅ Valid

// ❌ COMPILE ERROR: 'invalidKey' does not exist on ServerConfig!
// mergeConfig({ port: 3000, invalidKey: 'error' });
```

---

## 17. Common Interview Traps

1. **"TypeScript objects with `readonly` properties are completely immutable."**  
   *Trap*: Assuming `readonly` prevents mutating nested objects or array items.  
   *Reality*: `readonly` is strictly shallow. `readonly arr: number[]` prevents `arr = [1]`, but does not prevent `arr.push(2)` unless typed as `readonly number[]` or `ReadonlyArray<number>`.
2. **"`exactOptionalPropertyTypes` is enabled by default in `strict` mode."**  
   *Trap*: Assuming `"strict": true` turns it on.  
   *Reality*: It is an independent opt-in flag in `tsconfig.json` because it introduces strict breaking changes to optional property semantics.

---

## 18. Revision Summary

- **Excess Property Checks**: Active only on fresh object literals; prevents typos.
- **Structural Subtyping**: Active on variable references; allows extra properties.
- **Optional Properties (`?`)**: Allows omitting property or passing `undefined`.
- **`readonly`**: Shallow immutability modifier enforced at compile time.
- **Index Signatures (`[k: string]`)**: Permit open dynamic dictionaries.

---

## 19. Quick Reference

```typescript
// 1. Literal -> Excess checks enforced
const c1: Config = { host: 'localhost', typoKey: 123 }; // 💥 Error!

// 2. Reference -> Excess checks bypassed
const raw = { host: 'localhost', typoKey: 123 };
const c2: Config = raw; // ✅ Valid!

// 3. Readonly modifier
interface User {
  readonly id: string;
  name: string;
}
```
