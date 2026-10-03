# Type Narrowing, User-Defined Type Guards & Assertion Functions

## 1. What is it?
In TypeScript, **Type Narrowing** is the process by which the compiler's static analysis engine refines a broad, imprecise type (such as `string | number`, `unknown`, or an interface union) into a more specific, concrete type within a conditional code block.

Because TypeScript understands JavaScript's runtime control flow (Control Flow Analysis), standard runtime checks—such as `typeof`, `instanceof`, the `in` operator, and equality checks (`===`)—automatically act as **Type Guards**.

For complex objects or domain validations, TypeScript provides **User-Defined Type Guards** using the `value is Type` predicate syntax, as well as **Assertion Functions** (`asserts condition`).

---

## 2. Why does it exist?
In vanilla JavaScript:
- A function might accept `unknown` data from a network socket or user input.
- Calling `.toUpperCase()` on a value without checking its type causes an immediate crash if the value is a number: `TypeError: val.toUpperCase is not a function`.
- In TypeScript, you **cannot** call `.toUpperCase()` on `string | number` because `number` does not possess that method.
- **The Type Narrowing Solution**: TypeScript forces you to check the type at runtime with an `if` statement. Once verified, TypeScript automatically "narrows" the type inside the `if` block, unlocking full autocomplete and type safety.

---

## 3. Mental Model: The Sieve & Funnel
💡 **Think of a Laboratory Filter Funnel:**

```
                  INPUT: string | number | Date | null
                                   │
                                   ▼
                   [ Check 1: if (val === null) ]
                   ──> Handles null; removes null from funnel.
                                   │
                                   ▼
                   [ Check 2: if (typeof val === 'string') ]
                   ──> Inside block: TypeScript knows val is STRICTLY 'string'!
                                   │
                                   ▼
                   [ Check 3: if (val instanceof Date) ]
                   ──> Inside block: TypeScript knows val is STRICTLY 'Date'!
                                   │
                                   ▼
                   [ Remainder: else block ]
                   ──> Narrowed down to STRICTLY 'number'!
```

- With every conditional gate passed, the compiler filters out impossible types from the union set, leaving only the remaining valid types.

---

## 4. Built-in Type Guards

### 1. The `typeof` Guard
Operates on JavaScript primitive types (`'string'`, `'number'`, `'boolean'`, `'symbol'`, `'undefined'`, `'function'`, `'object'`).

```typescript
function formatValue(val: string | number): string {
  if (typeof val === 'number') {
    return `$${val.toFixed(2)}`; // ✅ TypeScript knows val is number here!
  }
  return val.trim().toUpperCase(); // ✅ TypeScript knows val is string here!
}
```

> ⚠️ *Quirk Warning*: Remember that in JavaScript, `typeof null === 'object'`. Checking `if (typeof val === 'object')` does NOT eliminate `null`! You must explicitly check `if (val !== null && typeof val === 'object')`.

---

### 2. The `instanceof` Guard
Checks the prototype chain of constructor functions and classes (e.g. `Date`, `Error`, `RegExp`, custom classes).

```typescript
function handleOutput(target: Date | Error): string {
  if (target instanceof Error) {
    return `Error: ${target.message}`; // ✅ Narrowed to Error
  }
  return target.toISOString(); // ✅ Narrowed to Date
}
```

---

### 3. The `in` Operator Guard
Checks whether an object contains a specific property key.

```typescript
interface Fish { swim: () => void; }
interface Bird { fly: () => void; }

function move(animal: Fish | Bird) {
  if ('swim' in animal) {
    animal.swim(); // ✅ Narrowed to Fish
  } else {
    animal.fly();  // ✅ Narrowed to Bird
  }
}
```

---

## 5. User-Defined Type Guards: The `val is Type` Predicate

Built-in guards only work for primitives and classes. When validating plain JavaScript objects or API payloads, you must write a **Custom Type Guard**:

```typescript
interface AdminUser {
  id: string;
  role: 'ADMIN';
  permissions: string[];
}

interface StandardUser {
  id: string;
  role: 'USER';
}

type AppUser = AdminUser | StandardUser;

// 1. Custom Type Guard Function
// Return type MUST be: 'user is AdminUser' (Type Predicate)
export function isAdmin(user: AppUser): user is AdminUser {
  return user.role === 'ADMIN' && Array.isArray((user as AdminUser).permissions);
}

// 2. Usage:
function grantAccess(user: AppUser) {
  if (isAdmin(user)) {
    // Inside this block, TypeScript narrows user to AdminUser!
    console.log(`Permissions: ${user.permissions.join(', ')}`);
  } else {
    // Narrowed to StandardUser!
    console.log(`Standard User: ${user.id}`);
  }
}
```

---

## 6. Assertion Functions: The `asserts condition` Syntax

TypeScript 3.7+ introduced **Assertion Functions**, which throw an exception if a condition is false, narrowing the variable's type for the **remainder of the entire scope** (no `if` block indentation required):

```typescript
// Assertion function signature:
export function assertIsString(val: unknown): asserts val is string {
  if (typeof val !== 'string') {
    throw new TypeError(`Expected a string, but received: ${typeof val}`);
  }
}

function processInput(input: unknown) {
  // input is 'unknown' here
  
  assertIsString(input);
  
  // From this line downward, input is GUARANTEED to be 'string'!
  console.log(input.toUpperCase());
}
```

---

## 7. Array Filtering Narrowing Trap & Solution

One of the most common complaints in TypeScript: `.filter(Boolean)` does not automatically narrow types!

```typescript
const numbersWithNull: (number | null)[] = [1, 2, null, 4, null];

// ❌ Naive filter: Return type is still (number | null)[]!
const result = numbersWithNull.filter(item => item !== null);

// ✅ SOLUTION: Use a Type Predicate in the filter callback
function isNotNull<T>(val: T | null): val is T {
  return val !== null;
}

const cleanNumbers: number[] = numbersWithNull.filter(isNotNull); // Strictly number[]!
```

---

## 8. Common Mistakes

### Mistake 1: Returning a boolean instead of a type predicate
```typescript
// ❌ WRONG: Returns boolean; does NOT narrow the type!
function isString(val: unknown): boolean {
  return typeof val === 'string';
}

function test(x: unknown) {
  if (isString(x)) {
    // x.toUpperCase(); // 💥 COMPILE ERROR: Object is of type 'unknown'!
  }
}

// ✅ CORRECT: Use the 'x is string' predicate
function isString(val: unknown): val is string {
  return typeof val === 'string';
}
```

---

## 9. Best Practices

1. **Keep Type Guards Honest**: A type guard is an assertion where TypeScript trusts you completely. If your guard returns `true` but the object is malformed, runtime crashes will occur. Double-check all runtime property checks.
2. **Combine Custom Guards with Zod for Untrusted Input**: Use Zod schemas to generate both runtime checks and inferred types simultaneously.
3. **Use Assertion Functions for Invariants**: Instead of wrapping your entire function body inside deep `if` statements, use assertion functions at the top of functions as guard clauses.

---

## 10. Performance Considerations

- Type guards are standard JavaScript conditions (`typeof`, `instanceof`). They execute in nanoseconds at runtime, making them the fastest and most efficient way to validate shapes in hot paths.

---

## 11. Security Considerations

- **Untrusted API Ingestion**: Always validate incoming HTTP request bodies using custom type guards or schema validators before passing payloads to database queries or authorization modules.

---

## 12. Alternatives

| Guard Technique | Best For | Runtime Cost |
| :--- | :--- | :--- |
| **`typeof`** | Primitives (`string`, `number`) | ⚡ Negligible (<1ns) |
| **`instanceof`** | Classes, `Date`, `Error` | ⚡ Fast (Prototype lookup) |
| **`in` operator** | Discriminated object properties | ⚡ Fast (Key lookup) |
| **Type Predicate (`val is T`)** | Custom domain objects | Depends on checks in function body |
| **Zod / Yup** | Complex external JSON validation | Moderate (parses schema) |

---

## 13. Trade-offs

- **Benefit**: 100% type safety without casting (`as`); clean control flow; self-documenting code.
- **Cost**: Requires writing defensive validation boilerplate for dynamic data.

---

## 14. Real-World Usage

- **Express Error Middleware**: Checking `if (err instanceof AppError)` to return formatted JSON vs 500 Internal Server Error.
- **WebSocket Message Handlers**: Disagreeing packet types via `in` or discriminated unions.
- **React Props**: Narrowing polymorphic component props.

---

## 15. Placement Interview Questions

### Basic
**Q: What is Type Narrowing in TypeScript?**  
*Answer*: Type Narrowing is the process by which TypeScript's Control Flow Analysis refines a variable from a broader union type (e.g. `string | number`) to a more specific type within a conditional execution block based on runtime checks like `typeof`, `instanceof`, or custom type guards.

### Conceptual
**Q: What is the difference between a function returning `boolean` and a function returning `val is Type`?**  
*Answer*: A function returning `boolean` only provides a runtime true/false flag; the TypeScript compiler learns nothing about the variable's type and will not narrow it inside an `if` block. A function returning `val is Type` is a **User-Defined Type Guard**: when it returns `true`, it explicitly instructs the TypeScript compiler to narrow the argument `val` to `Type` within the corresponding conditional block.

### Implementation
**Q: Write a type guard that checks if an unknown error caught in a `catch` block is an `AxiosError` containing a response status.**  
*Answer*:
```typescript
interface AxiosLikeError {
  isAxiosError: true;
  response: { status: number; data: unknown };
}

export function isAxiosError(err: unknown): err is AxiosLikeError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'isAxiosError' in err &&
    (err as any).isAxiosError === true &&
    'response' in err &&
    typeof (err as any).response === 'object'
  );
}
```

### Debugging
**Q: Why does `typeof x === 'object'` fail to narrow a type of `string | object | null` to strictly `object`?**  
*Answer*: Due to a historical JavaScript bug originating in 1995, `typeof null` evaluates to `'object'`. Therefore, checking `typeof x === 'object'` leaves the type as `object | null`. To narrow strictly to `object`, you must write: `if (x !== null && typeof x === 'object')`.

### Scenario
**Q: You receive an array `(User | null | undefined)[]`. How do you filter it so the resulting array is strictly `User[]` without using `as User[]`?**  
*Answer*: Use an inline type predicate inside `.filter()`:
```typescript
const cleanUsers = users.filter((u): u is User => u !== null && u !== undefined);
```

### Advanced
**Q: How do Assertion Functions (`asserts condition`) differ from standard Type Guards?**  
*Answer*: Standard Type Guards return a boolean and require an `if / else` block to perform narrowing within the block scope. Assertion Functions throw an error if the condition fails and return `void`. Because execution cannot continue past the assertion function if the check fails, TypeScript narrows the type for the **entire remaining sequential scope** of the enclosing function, eliminating nested indentation.

---

## 16. Coding Challenge: Universal JSON Value Guard

**Task**: Write custom type guards for validating raw JSON data: `isJsonObject` and `isJsonArray`.

```typescript
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export type JsonObject = { [Key in string]?: JsonValue };
export type JsonArray = JsonValue[];

export function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === '[object Object]'
  );
}

export function isJsonArray(value: unknown): value is JsonArray {
  return Array.isArray(value);
}
```

---

## 17. Common Interview Traps

1. **"Type guards guarantee the object has valid data at runtime."**  
   *Trap*: Assuming TypeScript validates the internal code of the type guard.  
   *Reality*: TypeScript trusts the developer's type predicate blindly. If you write `function isNum(x): x is number { return true; }`, TypeScript will believe everything is a number!
2. **"Does `Array.isArray()` need a custom type guard in modern TS?"**  
   *Trap*: Writing a custom guard for arrays.  
   *Reality*: TypeScript's standard library already types `Array.isArray(arg)` as `arg is any[]`.

---

## 18. Revision Summary

- **Narrowing**: Refining broad union types via Control Flow Analysis.
- Built-ins: `typeof` (primitives), `instanceof` (classes/Date/Error), `in` (keys).
- Custom Type Guard: `function isType(val): val is Type`.
- Assertion Function: `function assertType(val): asserts val is Type`.
- Filter arrays cleanly using `arr.filter((x): x is T => ...)`.

---

## 19. Quick Reference

```typescript
// 1. User-Defined Type Guard
function isUser(x: any): x is User {
  return x && typeof x.name === 'string';
}

// 2. Assertion Function
function assertUser(x: any): asserts x is User {
  if (!isUser(x)) throw new Error('Not a user');
}

// 3. Array filter predicate
const valid = items.filter((x): x is string => typeof x === 'string');
```
