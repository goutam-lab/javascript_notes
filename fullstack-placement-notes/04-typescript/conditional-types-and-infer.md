# Conditional Types & Type Inference with `infer`

## 1. What is it?
In TypeScript, **Conditional Types** introduce runtime-like ternary decision logic into the static type system. Formatted with the syntax:
```typescript
T extends U ? TrueType : FalseType
```
a conditional type tests whether type `T` is assignable to type `U`. If it is, the type resolves to `TrueType`; otherwise, it resolves to `FalseType`.

When combined with the **`infer` keyword**, conditional types become capable of **pattern matching**: extracting and capturing internal types from within complex structures (such as unpacking the resolved value of a `Promise`, the return type of a function, or the element type of an array).

---

## 2. Why does it exist?
In vanilla JavaScript:
- A function might return a single value if passed a single ID, or an array of values if passed an array of IDs:
  ```javascript
  function find(idOrIds) {
    return Array.isArray(idOrIds) ? idOrIds.map(fetchOne) : fetchOne(idOrIds);
  }
  ```
- Before conditional types, typing this in TypeScript required either clumsy function overloads or loose union return types (`User | User[]`), forcing the caller to constantly check `Array.isArray()` even when they knew they only passed a single ID.
- **The Conditional Type Solution**:
  ```typescript
  function find<T extends string | string[]>(id: T): T extends string[] ? User[] : User;
  ```
  The compiler dynamically computes the exact return type based on whether the input argument is an array or a string!

---

## 3. Mental Model: Pattern Matching & Variable Extraction
💡 **Think of Regex Capture Groups for the Type System:**

```
Regular Expression Regex:          TypeScript Conditional with 'infer':
──────────────────────────────     ─────────────────────────────────────
/Hello, (\w+)!/                    T extends `Hello, ${infer Name}!`
Captures matching characters       Captures matching sub-type into variable
into Group $1                      'Name' for use in True branch
```

- Just as a regex matches a pattern and extracts substrings, `T extends Promise<infer R>` matches against the Promise pattern and extracts whatever type is inside into the variable `R`.

---

## 4. Basic Syntax & The `infer` Keyword

### 1. Basic Conditional Evaluation
```typescript
type IsString<T> = T extends string ? true : false;

type A = IsString<'hello'>; // true
type B = IsString<123>;     // false
```

### 2. Pattern Matching with `infer`
```typescript
// Unpack the type inside an Array:
type Flatten<T> = T extends Array<infer ElementType> ? ElementType : T;

type Str = Flatten<string[]>; // strictly 'string'
type Num = Flatten<number>;   // strictly 'number' (fell through to false branch)

// Unpack Promise:
type Unpromise<T> = T extends Promise<infer Value> ? Value : T;

type Result = Unpromise<Promise<boolean>>; // strictly 'boolean'
```

---

## 5. Distributive Conditional Types

When a conditional type operates on a generic type parameter that receives a **Union Type**, the conditional type automatically distributes across each member of the union:

```typescript
type ToArray<T> = T extends any ? T[] : never;

type Union = string | number;
type Distributed = ToArray<Union>; 
// Evaluates to: ToArray<string> | ToArray<number>
// Result: string[] | number[]
```

### How to PREVENT Distribution (Tuple Wrapping)
If you want to treat the union as a single whole entity rather than distributing across it, wrap both sides of the `extends` keyword in square brackets `[T] extends [U]`:

```typescript
type ToArrayNonDistributive<T> = [T] extends [any] ? T[] : never;

type Combined = ToArrayNonDistributive<string | number>;
// Result: (string | number)[]
```

---

## 6. Real Example: Deep Await & Async Action Unwrapper

In modern Redux Toolkit or server action pipelines, actions often return nested promises or functions returning promises:

```typescript
// Recursive conditional type that recursively unwraps nested Promises
export type DeepAwaited<T> = T extends Promise<infer Inner>
  ? DeepAwaited<Inner>
  : T;

// Extract return type of an async function
export type AsyncReturnType<T extends (...args: any[]) => Promise<any>> = 
  T extends (...args: any[]) => Promise<infer R> ? DeepAwaited<R> : never;

// Real Service Function:
async function fetchUserDashboard() {
  return {
    user: { id: 'u1', name: 'Alice' },
    unreadCount: 5,
  };
}

// Inferred cleanly as: { user: { id: string; name: string }; unreadCount: number }
export type DashboardData = AsyncReturnType<typeof fetchUserDashboard>;
```

---

## 7. Important Rules

1. **`infer` Can Only Be Used in the `extends` Clause**: You cannot use `infer` outside of a conditional type's `extends` condition.
2. **`infer` Variables Are Only In Scope in the True Branch**: Any type variable introduced with `infer R` is only accessible inside the `? TrueType` branch, not in the `: FalseType` branch.
3. **Naked Type Parameters Distribute**: A type parameter `T` distributes over unions *only* if it appears completely naked (unwrapped) on the left side of `extends`.

---

## 8. Common Mistakes

### Mistake 1: Accidental Union Distribution with `never`
```typescript
type IsNever<T> = T extends never ? true : false;

// ❌ Unexpected behavior:
type Test = IsNever<never>; // Evaluates to 'never', NOT 'true'!!
```
**Why this happens**:
`never` is an empty union. Since conditional types distribute across unions, distributing across zero members produces **`never`** before even evaluating the condition!

```typescript
// ✅ FIX: Wrap in square brackets to prevent distribution:
type IsNeverSafe<T> = [T] extends [never] ? true : false;
type SafeTest = IsNeverSafe<never>; // Evaluates to 'true'!
```

---

## 9. Best Practices

1. **Use Multiple `infer` Declarations When Needed**: You can infer multiple components simultaneously:
   ```typescript
   type UnpackFunction<T> = T extends (...args: infer P) => infer R
     ? { params: P; returns: R }
     : never;
   ```
2. **Handle Recursive Depth Safely**: In TypeScript 4.5+, tail-call recursion optimization allows up to 1,000 steps of conditional recursion. Always define a base non-matching fallback.

---

## 10. Performance Considerations

- **Compiler Recursion Limits**: Extremely complex recursive conditional types (like compiling a full JSON parser or SQL parser in TypeScript types) will hit compiler recursion limits (`TS2589`) and significantly slow down IDE responsiveness. Keep types focused on structural manipulation.

---

## 11. Security Considerations

- Type-level inference patterns guarantee that sensitive return types (like decrypted credentials or auth tokens) cannot bypass type checks when wrapped inside complex utility wrappers.

---

## 12. Alternatives

Before conditional types, polymorphic behaviors were handled using:
- **Function Overloading**: Effective for function calls, but cannot transform standalone data structures or interfaces.
- **Intersection Types**: Creates flat combinations, but cannot branch or conditionally drop properties.

---

## 13. Trade-offs

- **Benefit**: Unmatched type extraction power; eliminates hundreds of lines of repetitive overload boilerplate.
- **Cost**: High cognitive complexity; debugging complex conditional types requires mental execution of the compiler's evaluation tree.

---

## 14. Real-World Usage

- **TypeScript Standard Library**: Powers `ReturnType`, `Parameters`, `Awaited`, `InstanceType`, and `NonNullable`.
- **tRPC**: Inspects router procedure definitions using `infer` to automatically generate React client query hooks with exact types.

---

## 15. Placement Interview Questions

### Basic
**Q: What is a Conditional Type in TypeScript?**  
*Answer*: A conditional type selects one of two possible types based on a subtyping relationship test, using the syntax `T extends U ? X : Y`. If `T` is assignable to `U`, the type resolves to `X`; otherwise, it resolves to `Y`.

### Conceptual
**Q: What is the purpose of the `infer` keyword, and where can it be used?**  
*Answer*: The `infer` keyword is used within the `extends` clause of a conditional type to introduce a type variable that is automatically inferred through pattern matching against the target type. It allows developers to extract and inspect sub-types from complex structures (e.g. extracting the resolved type `R` from `Promise<R>`). It can only be used in the `extends` condition and is only in scope in the true branch of the ternary.

### Implementation
**Q: Implement the built-in `NonNullable<T>` utility type from scratch using conditional types.**  
*Answer*:
```typescript
type MyNonNullable<T> = T extends null | undefined ? never : T;
```
Because naked type parameters distribute over unions, passing `string | null | undefined` distributes into:
`(string extends null | undefined ? never : string) | (null extends null | undefined ? never : null) | (undefined extends null | undefined ? never : undefined)`, resulting in `string | never | never`, which simplifies to `string`.

### Debugging
**Q: Why does `type Check<T> = T extends never ? 1 : 2; type R = Check<never>;` result in `never` instead of `1`?**  
*Answer*: `T` is a naked type parameter undergoing union distribution. Because `never` represents the empty union (a union with 0 members), the conditional type distributes over zero items, immediately terminating with `never` without ever evaluating either branch. To fix it, wrap `T` in a tuple: `type Check<T> = [T] extends [never] ? 1 : 2;`.

### Scenario
**Q: Write a generic utility `FirstArg<T>` that extracts the type of the first argument of any function, or returns `never` if the function takes no arguments.**  
*Answer*:
```typescript
type FirstArg<T> = T extends (first: infer F, ...rest: any[]) => any ? F : never;

function authenticate(token: string, redirectUrl: boolean) { ... }
type TokenArg = FirstArg<typeof authenticate>; // strictly 'string'
```

### Advanced
**Q: How does `infer` behave when the same type variable appears in multiple covariant positions vs. contravariant positions?**  
*Answer*:
- In **covariant positions** (such as function return types), multiple candidates for the same `infer` variable result in a **union type**:
  `type Foo<T> = T extends { a: infer U; b: infer U } ? U : never;` produces `string | number` if `a` is string and `b` is number.
- In **contravariant positions** (such as function argument types), multiple candidates for the same `infer` variable result in an **intersection type**:
  `type Bar<T> = T extends { a: (x: infer U) => void; b: (x: infer U) => void } ? U : never;` produces `string & number` (which evaluates to `never`).

---

## 16. Coding Challenge: Tuple to Union and Deep Flatten

**Task**: Implement a recursive conditional type `DeepFlatten<T>` that flattens arbitrarily nested arrays into a single flat array element type.

```typescript
export type DeepFlatten<T> = T extends Array<infer Element>
  ? DeepFlatten<Element>
  : T;

// Verification:
type Nested = number[][][];
type FlatNumber = DeepFlatten<Nested>; // strictly: number

type MixedNested = (string | (number | boolean[])[])[];
type FlatMixed = DeepFlatten<MixedNested>; // strictly: string | number | boolean
```

---

## 17. Common Interview Traps

1. **"You can use `infer` directly inside an interface."**  
   *Trap*: Writing `interface Box<T> { val: infer R }`.  
   *Reality*: `infer` can only be used inside the `extends` clause of a conditional type.
2. **"Conditional types evaluate at runtime."**  
   *Trap*: Expecting ternary type logic to execute in JavaScript.  
   *Reality*: Conditional types are 100% evaluated at compile time and erased from emitted JS.

---

## 18. Revision Summary

- **Conditional Types**: `T extends U ? TrueType : FalseType`.
- **`infer`**: Pattern matches and extracts type variables inside `extends`.
- **Distributive Nature**: Naked unions distribute across conditional branches.
- Prevent distribution by wrapping in tuples: `[T] extends [U]`.
- Powers standard utility types: `ReturnType`, `Parameters`, `Awaited`.

---

## 19. Quick Reference

```typescript
// 1. Extract Promise Value
type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

// 2. Extract Array Element
type ArrayElement<T> = T extends (infer U)[] ? U : never;

// 3. Extract Function Return
type MyReturnType<T> = T extends (...args: any[]) => infer R ? R : never;
```
