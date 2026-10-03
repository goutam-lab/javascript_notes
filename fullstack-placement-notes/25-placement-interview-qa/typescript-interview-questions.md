# Master Interview Handbook: 35+ TypeScript Placement Questions

## 1. What is it?
This guide is the definitive **TypeScript Technical Placement Handbook**, containing 35+ core, categorized interview questions covering type system theory, generics, conditional types, the `infer` keyword, compiler mechanics, and production typing patterns.

Each question features the **Two-Tier Answer Format**:
1. **The Spoken Answer**: High-impact 45-second explanation for verbal rounds.
2. **Under-The-Hood Mechanics**: Deep compiler analysis (AST, type checking engine, type erasure, structural subtyping).

```
                   TYPESCRIPT TYPE SYSTEM TAXONOMY
                   
 ┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
 │ 1. Type Foundations  │   │ 2. Advanced Types    │   │ 3. Generics & infer  │
 │ • Structural typing  │   │ • Discriminated union│   │ • Type constraints   │
 │ • Type erasure       │   │ • Mapped types       │   │ • Distributive types │
 │ • any vs unknown     │   │ • Template literals  │   │ • infer unpacking    │
 └──────────────────────┘   └──────────────────────┘   └──────────────────────┘
 ┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
 │ 4. Utility Internals │   │ 5. Compiler & Config │   │ 6. Full-Stack Typing │
 │ • Pick & Omit math   │   │ • AST & type check   │   │ • Express Request    │
 │ • ReturnType<T>      │   │ • Declaration merging│   │ • Polymorphic React  │
 │ • DeepReadonly       │   │ • tsconfig strict    │   │ • Zod schema infer   │
 └──────────────────────┘   └──────────────────────┘   └──────────────────────┘
```

---

## 2. Why does it exist?
Product companies (such as Stripe, Microsoft, Uber, and top startups) evaluate TypeScript to test engineering rigor. Common candidate failure points:
- Using `any` or `as unknown as T` to bypass the type checker rather than properly narrowing types.
- Inability to explain how utility types like `Omit` or `ReturnType` work mathematically under the hood.
- Confusing compile-time type verification with runtime validation.

---

## 3. Mental Model
Think of TypeScript like architectural blueprints and building inspectors:
- **JavaScript** is constructing a house directly with raw bricks and wood: fast to start, but you only discover the foundation is crooked when the roof collapses during the storm (runtime crash).
- **TypeScript** is the structural engineering blueprint: it checks physics and load calculations at compile time. Once the inspection passes, the blueprints are rolled up and archived (**Type Erasure**); the physical building (plain JavaScript) executes in the browser without carrying the blueprints.

---

## 4. Category 1: Type System Foundations (Q1 – Q8)

### Q1: What is the difference between Structural Typing and Nominal Typing?
- **Spoken Answer**: TypeScript uses **Structural Typing** (often called "duck typing"): type compatibility is determined solely by the shape and properties of the object, not by its explicit class or interface declaration. In a **Nominal Typing** language (like Java or C#), an object must explicitly declare that it implements an interface. In TypeScript, if Object A has all the properties required by Type B, Object A is valid as Type B regardless of how it was declared.
- **Code Example**:
  ```typescript
  interface Point { x: number; y: number; }
  const myObj = { x: 10, y: 20, name: 'origin' };
  const p: Point = myObj; // ✅ VALID! (myObj contains x and y)
  ```

### Q2: What is "Type Erasure" in TypeScript?
- **Spoken Answer**: TypeScript is a compile-time tool. During the compilation step (via `tsc`, Babel, or SWC), all interfaces, type aliases, generic type parameters, and type annotations are completely stripped away. The resulting output is **100% clean, standard JavaScript**. Types have **zero runtime overhead** and cannot be inspected or queried at runtime using `typeof` or `instanceof`.

### Q3: What is the difference between `any`, `unknown`, and `never`?
- **Spoken Answer**:
  - **`any`**: Turns off the type checker completely. You can assign anything to it, call arbitrary methods on it, and assign it to any other type. It is unsafe.
  - **`unknown`**: The type-safe counterpart of `any`. You can assign any value to `unknown`, but TypeScript **prohibits calling methods or accessing properties on it until you narrow the type** (via `typeof`, `instanceof`, or custom type guards).
  - **`never`**: Represents the type of values that **never occur** (e.g., the return type of a function that always throws an error or enters an infinite loop, or the exhausted default branch of a switch statement).

### Q4: What is the difference between an `interface` and a `type` alias?
- **Spoken Answer**:
  1. **Declaration Merging**: Interfaces with the same name automatically merge their property definitions; `type` aliases cannot be re-opened and throw a duplicate identifier error.
  2. **Syntax for Inheritance**: Interfaces extend via `extends`; types combine via intersection (`&`).
  3. **Union & Primitive Capabilities**: `type` can declare unions (`type Status = 'A' | 'B'`), primitives, and tuples; `interface` can only describe object shapes.
  4. **Compiler Performance**: Interfaces are cached more efficiently by the TypeScript compiler type checker than complex intersection types.

### Q5: What is Excess Property Checking in object literals?
- **Spoken Answer**: When you assign an object literal directly to a type, TypeScript enforces strict **Excess Property Checking**, flagging an error if unexpected properties exist:
  ```typescript
  interface User { name: string; }
  const u: User = { name: 'Alice', age: 30 }; // ❌ Error: 'age' does not exist in 'User'
  ```
  However, if the object is first assigned to an intermediate variable, excess property checking is bypassed, and standard structural subtyping applies.

### Q6: What does `strict: true` in `tsconfig.json` actually enable?
- **Spoken Answer**: `strict: true` is an umbrella flag that enables all strict type-checking options, most importantly:
  - `noImplicitAny`: Flags an error whenever an expression lacks a type and defaults to `any`.
  - `strictNullChecks`: Disallows `null` and `undefined` from being assigned to other types unless explicitly unioned (`string | null`).
  - `strictFunctionTypes`: Enforces contravariant parameter checking on function types.
  - `alwaysStrict`: Emits `"use strict"` in all JavaScript output files.

### Q7: Why is `typeof null === 'object'` in JavaScript, and how does TypeScript handle it?
- **Spoken Answer**: In original JavaScript implementations (1995), values were stored with type tags. The type tag for objects was `000`, and `null` was represented as a NULL pointer (`0x00`), causing `typeof null` to erroneously return `'object'`. TypeScript acknowledges this historical quirk: checking `if (typeof val === 'object')` leaves `null` in the narrowed type unless you explicitly check `if (val !== null)`.

### Q8: What is a Type Assertion (`as`), and why is it dangerous?
- **Spoken Answer**: A Type Assertion (`value as TargetType`) instructs the TypeScript compiler: *"Trust me, I know the type of this value better than you do."* It does **not** perform any runtime conversion or validation. If the underlying data structure does not match the asserted type at runtime, subsequent property accesses will throw `TypeError: Cannot read property of undefined`. Use runtime validation libraries (like Zod) instead of casting.

---

## 5. Category 2: Advanced Types & Narrowing (Q9 – Q16)

### Q9: What is a Discriminated Union, and why is it so powerful?
- **Spoken Answer**: A Discriminated Union (or Tagged Union) is a pattern where multiple object types share a common, literal property (the "discriminant tag", such as `type` or `status`). 
  When you write a switch statement on the discriminant tag, TypeScript **automatically narrows the object type** inside each case branch without type casting.
- **Code Example**:
  ```typescript
  type Action = 
    | { type: 'SUCCESS'; payload: string }
    | { type: 'ERROR'; error: Error };

  function handle(action: Action) {
    if (action.type === 'SUCCESS') {
      console.log(action.payload); // TypeScript KNOWS payload exists here!
    } else {
      console.error(action.error); // TypeScript KNOWS error exists here!
    }
  }
  ```

### Q10: How do you achieve Exhaustive Type Checking in TypeScript?
- **Spoken Answer**: By using the **`never`** type in the default branch of a switch statement over a discriminated union:
  ```typescript
  function handleAction(action: Action) {
    switch (action.type) {
      case 'SUCCESS': return ...;
      case 'ERROR': return ...;
      default: {
        const _exhaustiveCheck: never = action;
        throw new Error(`Unhandled action: ${_exhaustiveCheck}`);
      }
    }
  }
  ```
  If another developer adds `{ type: 'PENDING' }` to the `Action` union in the future, TypeScript will immediately throw a compile-time error at `_exhaustiveCheck` because `'PENDING'` cannot be assigned to `never`.

### Q11: What is a User-Defined Type Guard (Type Predicate)?
- **Spoken Answer**: A function whose return type is formatted as: **`parameterName is TargetType`**. When the function returns `true`, TypeScript narrows the argument to `TargetType` in the calling conditional block:
  ```typescript
  function isFish(pet: Fish | Bird): pet is Fish {
    return (pet as Fish).swim !== undefined;
  }

  if (isFish(myPet)) {
    myPet.swim(); // TypeScript guarantees myPet is Fish!
  }
  ```

### Q12: What does the `keyof` operator do?
- **Spoken Answer**: `keyof` takes an object type and produces a string or numeric literal union of its keys:
  ```typescript
  interface User { id: number; name: string; email: string; }
  type UserKeys = keyof User; // 'id' | 'name' | 'email'
  ```

### Q13: What is an Indexed Access Type (`T[K]`)?
- **Spoken Answer**: It allows looking up the type of a specific property on another type using index notation:
  ```typescript
  type UserIdType = User['id']; // number
  ```

### Q14: What is a Mapped Type?
- **Spoken Answer**: A mapped type builds new types by iterating over a union of keys (using `in keyof`):
  ```typescript
  type Readonly<T> = {
    readonly [P in keyof T]: T[P];
  };
  ```

### Q15: What are Template Literal Types?
- **Spoken Answer**: Template literal types allow building string types using template literal syntax, enabling powerful combinatorial types:
  ```typescript
  type Event = 'click' | 'hover';
  type HandlerName = `on${Capitalize<Event>}`; // 'onClick' | 'onHover'
  ```

### Q16: What is the `satisfies` operator introduced in TypeScript 4.9?
- **Spoken Answer**: The `satisfies` operator validates that an expression matches a type **without widening or altering the inferred type of the variable**.
  - Using `const config: Record<string, string | number>` widens all properties to `string | number`, losing specific types.
  - Using `const config = { ... } satisfies Record<string, string | number>` validates that the shape matches, but preserves exact literal types (e.g., `config.port` is known to be a `number`, allowing `.toFixed()` without type errors).

---

## 6. Category 3: Generics & The `infer` Keyword (Q17 – Q24)

### Q17: What are Generics in TypeScript, and why do we use them?
- **Spoken Answer**: Generics allow creating reusable, type-safe functions, classes, and interfaces that work with a variety of types rather than a single concrete type, while preserving type relationships between inputs and outputs:
  ```typescript
  function identity<T>(arg: T): T { return arg; }
  const num = identity(42); // num is strictly inferred as number!
  ```

### Q18: What is a Generic Constraint (`extends`)?
- **Spoken Answer**: A generic constraint restricts the types that can be passed to a generic parameter using the `extends` keyword:
  ```typescript
  function logLength<T extends { length: number }>(item: T): number {
    return item.length;
  }
  logLength('hello'); // ✅ String has .length
  logLength(12345);   // ❌ Compile error: number has no .length property!
  ```

### Q19: What is a Conditional Type?
- **Spoken Answer**: A type that selects one of two possible types based on a condition expressed as a type relationship test:
  ```typescript
  type IsString<T> = T extends string ? true : false;
  type A = IsString<string>; // true
  type B = IsString<number>; // false
  ```

### Q20: What are Distributive Conditional Types?
- **Spoken Answer**: When a naked type parameter is used in a conditional type, it automatically **distributes over union types**:
  ```typescript
  type ToArray<T> = T extends any ? T[] : never;
  type Result = ToArray<string | number>;
  // Evaluates as: ToArray<string> | ToArray<number>
  // Result: string[] | number[] (NOT (string | number)[])!
  ```
  To prevent distribution, wrap the type parameters in square brackets: `[T] extends [any]`.

### Q21: What is the `infer` keyword, and where can it be used?
- **Spoken Answer**: The `infer` keyword is used **exclusively within the condition of a conditional type** to introduce a type variable that is deduced (inferred) from another type at compile time:
  ```typescript
  type UnpackPromise<T> = T extends Promise<infer U> ? U : T;
  type Data = UnpackPromise<Promise<string>>; // string!
  ```

### Q22: How do you extract the element type of an array using `infer`?
- **Spoken Answer**:
  ```typescript
  type ElementOf<T> = T extends (infer U)[] ? U : never;
  type Item = ElementOf<string[]>; // string
  ```

### Q23: How does the built-in `ReturnType<T>` utility type work under the hood?
- **Spoken Answer**:
  ```typescript
  type ReturnType<T extends (...args: any[]) => any> = 
    T extends (...args: any[]) => infer R ? R : any;
  ```
  It tests if `T` is a function; if so, it infers the return type `R` and yields it.

### Q24: How does the built-in `Parameters<T>` utility type work under the hood?
- **Spoken Answer**:
  ```typescript
  type Parameters<T extends (...args: any[]) => any> = 
    T extends (...args: infer P) => any ? P : never;
  ```
  It tests if `T` is a function and infers its parameter list as a tuple `P`.

---

## 7. Category 4: Utility Types Under the Hood (Q25 – Q29)

### Q25: How is `Partial<T>` implemented under the hood?
- **Spoken Answer**:
  ```typescript
  type Partial<T> = {
    [P in keyof T]?: T[P];
  };
  ```
  It maps over every property key `P` in `T` and appends the optional modifier `?`.

### Q26: How is `Required<T>` implemented under the hood?
- **Spoken Answer**:
  ```typescript
  type Required<T> = {
    [P in keyof T]-?: T[P];
  };
  ```
  It uses the **`-?`** modifier to explicitly strip away the optional attribute from all properties.

### Q27: How is `Pick<T, K>` implemented under the hood?
- **Spoken Answer**:
  ```typescript
  type Pick<T, K extends keyof T> = {
    [P in K]: T[P];
  };
  ```
  It constrains `K` to valid keys of `T` and maps only over the keys in `K`.

### Q28: How is `Omit<T, K>` implemented under the hood?
- **Spoken Answer**:
  ```typescript
  type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
  ```
  It combines `Pick` with `Exclude` to take all keys of `T` except those present in `K`.

### Q29: How is `Exclude<T, U>` implemented under the hood?
- **Spoken Answer**:
  ```typescript
  type Exclude<T, U> = T extends U ? never : T;
  ```
  Leveraging distributive conditional types: for each element in union `T`, if it extends `U`, it resolves to `never` (filtering it out of the union).

---

## 8. Category 5: Compiler Mechanics, Declaration Files & Real-World Typing (Q30 – Q35)

### Q30: What is a Declaration File (`.d.ts`), and what is its purpose?
- **Spoken Answer**: A `.d.ts` file contains **only type declarations without executable JavaScript code**. It describes the public API shape, function signatures, and exported types of JavaScript libraries so the TypeScript compiler can provide autocomplete and type checking when consuming untyped JS packages.

### Q31: What is Declaration Merging, and how do you extend third-party types (e.g., Express Request)?
- **Spoken Answer**: Declaration Merging allows augmenting existing interfaces by re-declaring them within the same namespace.
- **Real-World Express Example**:
  ```typescript
  // express.d.ts
  declare global {
    namespace Express {
      interface Request {
        user?: { id: string; role: string }; // Injects typed user onto Express Request!
      }
    }
  }
  ```

### Q32: What is the difference between `const` in JavaScript and `as const` in TypeScript?
- **Spoken Answer**:
  - `const x = 'hello'` prevents re-binding the variable name.
  - `as const` (Const Assertion) instructs TypeScript to infer the deepest, most specific **read-only literal types** for objects and arrays:
  ```typescript
  const roles = ['admin', 'user'] as const;
  // Type: readonly ['admin', 'user'] (Tuple of literals, NOT string[]!)
  type Role = typeof roles[number]; // 'admin' | 'user'
  ```

### Q33: Why is Zod or Yup necessary when TypeScript already provides type safety?
- **Spoken Answer**: TypeScript types exist **strictly at compile time** and are erased in production. TypeScript cannot validate data coming across network boundaries (such as `req.body` or external API responses). **Zod** provides **runtime schema validation**, and uses `z.infer<typeof schema>` to automatically generate TypeScript types from the runtime validator, guaranteeing full-stack end-to-end type safety.

### Q34: What is the `override` keyword in TypeScript classes?
- **Spoken Answer**: The `override` keyword ensures that a method in a child class explicitly overrides a method in its parent class. If the parent class method is renamed or removed in the future, the compiler throws an error preventing broken method overrides.

### Q35: How does TypeScript type checking impact build speed, and how do you optimize it?
- **Spoken Answer**: Complex recursive types, deeply nested intersections, and thousands of `.d.ts` files slow down `tsc`. 
- **Optimization Strategy**:
  1. Use SWC, esbuild, or Vite for rapid development (they strip types instantly without checking).
  2. Run `tsc --noEmit --incremental` as a separate background process or CI gate to validate types using the cached `.tsbuildinfo` file.

---

## 9. Important Rules for Spoken Placement Answers

1. **Lead with "Structural Typing"**: Demonstrates core mechanical understanding over syntax.
2. **Never claim TypeScript runs in the browser**: Emphasize type erasure immediately.
3. **Reference mathematical set theory**: Mentioning that types in TypeScript are **sets of values** (e.g., `unknown` is the universal set, `never` is the empty set $\emptyset$, unions are set unions $\cup$, and intersections are set intersections $\cap$) impresses interviewers.

---

## 10. Common Mistakes & Buzzword Traps

- **Trap 1: "I cast with `as any` to fix compiler errors"**: Immediate disqualifier in senior rounds. Explain how to narrow with type guards instead.
- **Trap 2: Writing `Record<string, any>` instead of `Record<string, unknown>`**: `unknown` forces the consumer to type-check before accessing properties.

---

## 11. Best Practices for Technical Rounds

- **Whiteboard Utility Types**: Practice hand-writing the 1-line definitions of `Partial`, `Pick`, `Omit`, and `ReturnType`.
- **Explain Set Theory of Types**:
  - `A | B`: Union (values belonging to set A, set B, or both).
  - `A & B`: Intersection (values satisfying all properties of both A and B).
  - `never`: Empty set (no value can ever satisfy this type).

---

## 12. Performance Considerations in Types

- **Avoid Deep Recursion in Types**: Writing custom types that recurse deeply over strings or nested objects can exceed the compiler's maximum call stack (`Type instantiation is excessively deep and possibly infinite`).

---

## 13. Security Considerations

- **Type Assertions Bypass Security**: `req.body as CreateUserInput` provides zero security against malicious payloads. Always validate with a runtime schema validator (`CreateUserInputSchema.parse(req.body)`).

---

## 14. Alternatives & Comparison

| Language / System | Typing Model | Erasure | Runtime Reflection |
|---|---|---|---|
| **TypeScript** | Structural Subtyping | **Yes (Erased)** | No |
| **Java / C#** | Nominal Typing | Partial | Yes (Reflection API) |
| **Flow** | Structural | Yes | No |
| **Rust** | Trait-based Nominal | Monomorphized | Minimal |

---

## 15. Trade-offs

- **Strictness vs. Developer Velocity**:
  Enabling `noImplicitAny`, `strictNullChecks`, and `exactOptionalPropertyTypes` increases upfront typing effort, but prevents 90% of production `TypeError: Cannot read property of undefined` crashes.

---

## 16. Real-World Technical Stories to Tell

- **The Runtime Boundary Breach**: Discuss a production incident where an API received `null` instead of an expected string because developers used an unsafe `as string` assertion instead of Zod validation.
- **The TypeScript Compiler Bottleneck**: Describe optimizing a 5-minute CI build down to 30 seconds by replacing `tsc` transpile with `esbuild` and running `tsc --noEmit --incremental` in parallel.

---

## 17. Revision Summary

- **Core Primitives**: Structural typing, compile-time type erasure, `unknown` (safe) vs `any` (unsafe) vs `never` (empty set).
- **Discriminated Unions**: Common literal tag (`type`) enables automatic compiler narrowing.
- **Generics & Infer**: `infer` unpacks types inside conditional type conditions (`T extends Promise<infer U> ? U : T`).
- **Utility Mechanics**: Understand how `Pick`, `Omit`, `Partial`, and `ReturnType` are constructed.

---

## 18. Quick Reference Cheatsheet

```typescript
// Essential 1-Line Utility Type Implementations
type MyPartial<T>   = { [K in keyof T]?: T[K] };
type MyRequired<T>  = { [K in keyof T]-?: T[K] };
type MyReadonly<T>  = { readonly [K in keyof T]: T[K] };
type MyPick<T, K extends keyof T> = { [P in K]: T[P] };
type MyExclude<T, U> = T extends U ? never : T;
type MyOmit<T, K extends keyof any> = MyPick<T, MyExclude<keyof T, K>>;
type MyReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any;
```
