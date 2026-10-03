# TypeScript Types & Generics Cheatsheet & Deep Dive

---

## 1. What is it?

The TypeScript Types and Generics Cheatsheet is an advanced type-system reference and operational guide designed for senior fullstack and frontend placement interviews. It covers the full spectrum of TypeScript's type-level meta-programming: **built-in utility types** (`Partial`, `Pick`, `Omit`, `Record`, `Exclude`, `Extract`, `Awaited`), **conditional types and the `infer` keyword**, **mapped types with key remapping (`as`)**, **template literal types**, **variance mechanics (covariance vs contravariance)**, and the **`satisfies` operator**.

```
+-----------------------------------------------------------------------------------+
|                       TypeScript Type-System Hierarchy                            |
+-----------------------------------------------------------------------------------+
| Top Types:             unknown, any                                               |
| Composite Types:       Objects, Interfaces, Tuples, Arrays, Unions (|), Intersect(&)|
| Utility Types:         Partial, Required, Readonly, Pick, Omit, Record, Awaited   |
| Meta-Programming:      Conditional (T extends U ? X : Y), infer, Mapped ([K in keyof])|
| Type Narrowing:        Discriminated Unions, Type Guards (val is T), asserts      |
| Bottom Type:           never                                                      |
+-----------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Standard JavaScript relies on dynamic typing, causing bugs to escape into production as runtime exceptions (`TypeError: Cannot read properties of undefined`).
TypeScript exists to:
1. **Provide Compile-Time Verification:** Catch data mismatches, null pointer dereferences, and invalid property accesses before code reaches a browser or server.
2. **Enable Expressive API Contracts:** Using generics and mapped types, libraries (like Zod, Prisma, Redux Toolkit, and tRPC) provide end-to-end type inference without manual type duplication.
3. **Enhance Developer Tooling:** Power rich autocompletion, automated refactoring, and self-documenting codebases across large distributed engineering teams.

---

## 3. Mental Model

To master TypeScript in interviews, visualize TypeScript not as a runtime validator, but as a **Compile-Time Set-Theoretic Proof Engine**:

```
[ Set Theory Mental Model ]
  - 'any'     = The Wildcard (Disables set checking entirely)
  - 'unknown' = Universal Set (Contains everything; nothing can be done without narrowing)
  - 'string'  = Infinite set of all character sequences
  - '"idle"'  = Unit set containing exactly one string literal
  - 'never'   = The Empty Set ∅ (Contains nothing; impossible to instantiate)
  - Union (|) = Set Union (A ∪ B)
  - Intersect(&)= Set Intersection (A ∩ B)
```

* **Types disappear at runtime:** TypeScript emits zero runtime bytes for types, interfaces, or generics. All type checking executes strictly during compilation (`tsc`).

---

## 4. Basic Example

### The Canonical Built-in Utility Types Matrix

```typescript
interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  age?: number;
}

// 1. Partial<T>: Makes all properties optional
type OptionalUser = Partial<User>;

// 2. Required<T>: Makes all properties required (removes '?')
type StrictUser = Required<User>;

// 3. Readonly<T>: Freezes all properties from reassignment
type ImmutableUser = Readonly<User>;

// 4. Pick<T, K>: Extracts a subset of properties
type UserCredentials = Pick<User, "email" | "role">;

// 5. Omit<T, K>: Removes specific properties
type PublicProfile = Omit<User, "email">;

// 6. Record<K, T>: Maps a set of keys to a specific type
type UserDirectory = Record<string, User>;

// 7. Exclude<T, U>: Excludes types from a union
type MemberOnlyRole = Exclude<User["role"], "admin">; // "member"

// 8. Extract<T, U>: Extracts matching types from a union
type AdminRole = Extract<User["role"], "admin" | "superadmin">; // "admin"

// 9. NonNullable<T>: Strips null and undefined
type ValidString = NonNullable<string | null | undefined>; // string

// 10. ReturnType<T>: Infers return type of a function
type FetchUserReturn = ReturnType<() => Promise<User>>; // Promise<User>

// 11. Awaited<T>: Recursively unwraps Promise wrappers
type ResolvedUser = Awaited<FetchUserReturn>; // User
```

---

## 5. Real Example

### Production Type-Safe Event Bus with Template Literal Types & Mapped Handlers

```typescript
// Define domain events
type Entity = "user" | "order" | "product";
type Action = "created" | "updated" | "deleted";

// Template Literal Type: "user:created" | "user:updated" | ... (9 combinations)
export type DomainEvent = `${Entity}:${Action}`;

// Event payload mapping
export interface EventPayloadMap {
  "user:created": { userId: string; email: string };
  "user:updated": { userId: string; changes: Record<string, any> };
  "user:deleted": { userId: string };
  "order:created": { orderId: string; totalAmount: number };
  "order:updated": { orderId: string; status: string };
  "order:deleted": { orderId: string };
  "product:created": { productId: string; name: string };
  "product:updated": { productId: string; price: number };
  "product:deleted": { productId: string };
}

export class TypeSafeEventBus {
  private handlers = new Map<string, Array<(payload: any) => void>>();

  // Generic publish method enforcing exact payload shape for the event
  publish<E extends DomainEvent>(event: E, payload: EventPayloadMap[E]): void {
    const registered = this.handlers.get(event) || [];
    registered.forEach((fn) => fn(payload));
  }

  // Generic subscribe method inferring payload parameter
  subscribe<E extends DomainEvent>(
    event: E,
    handler: (payload: EventPayloadMap[E]) => void
  ): () => void {
    const current = this.handlers.get(event) || [];
    this.handlers.set(event, [...current, handler]);

    return () => {
      const updated = (this.handlers.get(event) || []).filter((h) => h !== handler);
      this.handlers.set(event, updated);
    };
  }
}
```

---

## 6. Under the Hood

### Conditional Types and the `infer` Keyword Mechanics

A conditional type takes the form:
```typescript
T extends U ? X : Y
```
When `T` is a generic type parameter, conditional types become **distributive over naked unions**:
$$\text{If } T = A \mid B, \quad (A \mid B) \text{ extends } U ? X : Y \implies (A \text{ extends } U ? X : Y) \mid (B \text{ extends } U ? X : Y)$$

#### The `infer` Keyword
The `infer` keyword introduces a type variable within the `extends` clause to be deduced by the compiler during pattern matching:

```typescript
// Custom UnpackPromise implementation
type UnpackPromise<T> = T extends Promise<infer U> ? UnpackPromise<U> : T;

type Test1 = UnpackPromise<Promise<string>>;          // string
type Test2 = UnpackPromise<Promise<Promise<number>>>; // number (recursive)
type Test3 = UnpackPromise<boolean>;                 // boolean
```

---

## 7. Important Rules

1. **The Rule of Unknown over Any:** Never use `any` unless writing temporary scratch code. `any` disables all type-checking across every downstream consumer. Use `unknown` for untrusted inputs; `unknown` forces the developer to perform type narrowing before property access.
2. **The Rule of Discriminated Unions:** Always include a shared literal property (e.g., `type: "SUCCESS"` vs `type: "ERROR"`, or `kind: "circle"` vs `kind: "square"`) across members of a union. This enables exhaustive compile-time narrowing in `switch` and `if` blocks.
3. **The Rule of Readonly Immutability:** When returning configuration objects or tuples, use `as const` to freeze primitive types into immutable literal types and prevent accidental mutation.
4. **The Rule of the `satisfies` Operator:** Use `satisfies` (TypeScript 4.9+) when you want to validate that an object conforms to a type *without* widening literal types or losing exact property autocomplete.

---

## 8. Common Mistakes

### Mistake 1: Type Assertion Casting (`as unknown as T`)
Forcing the compiler to accept invalid types using double-casting (`data as unknown as User`). This completely bypasses type safety and masks runtime errors. Use Zod schemas (`UserSchema.parse(data)`) for runtime validation.

### Mistake 2: Missing Exhaustiveness Checking with `never`
Writing `switch` statements over discriminated unions without an exhaustive `default` branch:
```typescript
function handleAction(action: Action) {
  switch (action.type) {
    case "A": return 1;
    case "B": return 2;
    default: {
      const _exhaustiveCheck: never = action; // Compiler flags an error if a case is missed!
      throw new Error(`Unhandled action: ${_exhaustiveCheck}`);
    }
  }
}
```

### Mistake 3: Confusing `interface` vs `type` Declaration Merging
Accidentally redefining an `interface` with the same name across two files, causing TypeScript to merge them unexpectedly. `type` aliases do not merge and throw duplicate identifier errors, preventing accidental collisions.

---

## 9. Best Practices

1. **Use `satisfies` for Strict Configs:**
   ```typescript
   type Theme = Record<string, string | { r: number; g: number; b: number }>;
   const palette = {
     primary: "#3b82f6",
     secondary: { r: 239, g: 68, b: 68 },
   } satisfies Theme;
   // palette.primary is still inferred as string literal "#3b82f6", not broad string!
   ```
2. **Leverage Branded Types for Type Safety:**
   Differentiate primitive values like `UserId` and `OrderId` using branded types to prevent accidental parameter swaps:
   ```typescript
   type Brand<K, T> = K & { __brand: T };
   type UserId = Brand<string, "UserId">;
   type OrderId = Brand<string, "OrderId">;
   ```
3. **Strict Compiler Flags:** Always enable `"strict": true`, `"noUncheckedIndexedAccess": true`, and `"exactOptionalPropertyTypes": true` in `tsconfig.json`.

---

## 10. Performance Considerations

* **Compiler Type-Checking Latency:** Deeply nested recursive conditional types or massive unions ($>10,000$ members) cause `tsc` compilation times to skyrocket.
* **Interface vs Type Aliases for Object Shapes:** The TypeScript compiler caches property relationships on `interface` definitions more efficiently than complex object intersections (`A & B & C`). Prefer `interface` for public library APIs and core domain models.

---

## 11. Security Considerations

* **Type Erasure Illusion:** Remember that TypeScript types do **not exist at runtime**. Validating an API payload using `function handler(req: Request<UserDTO>)` does **not** protect against malicious input sent over the wire. You MUST validate untrusted payloads at the application boundary using runtime parsers (Zod, Valibot, ArkType).

---

## 12. Alternatives

| Typing Approach | Pros | Cons | Best Use Case |
| :--- | :--- | :--- | :--- |
| **TypeScript (Compile-Time)** | Zero runtime overhead, massive ecosystem, rich IDE support | Type erasure, cannot validate runtime data alone | General fullstack web engineering |
| **Zod / Valibot (Runtime + Inferred)** | Validates untrusted wire data, automatically infers TS types | Minor CPU validation overhead at runtime | API request payloads, environment variables |
| **JSDoc + `checkJs`** | Zero build step, runs natively in vanilla JS | Clunky syntax for complex generics, limited meta-programming | Lightweight scripts, npm packages avoiding build tools |

---

## 13. Trade-offs

* **Type Safety vs Complexity:** Writing complex recursive generic types provides ultimate type safety, but can make code unreadable and produce terrifying 50-line compiler error messages for other developers.
* **Structural Typing vs Nominal Typing:** TypeScript's structural typing ("duck typing") makes composition easy, but allows unrelated objects with identical field shapes to be substituted for one another unless branded types are used.

---

## 14. Real-World Usage

* **TRPC:** Uses advanced generic inference to share backend router types directly with frontend clients, giving end-to-end type safety without generating intermediate OpenAPI/Swagger schemas.
* **Prisma ORM:** Generates dynamic client types containing complex mapped and conditional types tailored to the developer's exact database schema.

---

## 15. Placement Interview Questions

### Basic Level
1. **Explain the difference between `interface` and `type` in TypeScript.**
   * *Answer:*
     - *`interface`:* Strictly for defining object shapes. Supports **declaration merging** (defining the same interface name merges properties). More performant for compiler property caching.
     - *`type`:* A type alias for arbitrary types (primitives, unions `|`, intersections `&`, tuples, functions, conditional types). Cannot be reopened or merged.

2. **What is the difference between `any` and `unknown`?**
   * *Answer:* `any` disables all type checking; you can assign anything to it and call arbitrary properties or methods on it without error, completely sacrificing type safety. `unknown` is the type-safe counterpart; any value can be assigned to `unknown`, but TypeScript forbids performing *any* operations on it (reading properties, calling methods) until you explicitly narrow its type using `typeof`, `instanceof`, or a type guard.

3. **What is the `never` type and when is it used?**
   * *Answer:* `never` represents the empty set—values that can never occur. It is the return type of functions that never return (throw an infinite loop or throw an exception). It is also used to enforce compile-time exhaustiveness checking in `switch` statements.

4. **What does the `as const` assertion do?**
   * *Answer:* `as const` tells the compiler to:
     1. Narrow primitive values to their exact literal types (e.g., `"admin"` instead of `string`).
     2. Mark all object properties as `readonly`.
     3. Convert array literals into fixed-length `readonly` tuples.

5. **What is a Discriminated Union?**
   * *Answer:* A pattern where every member of a union type contains a common, literal property (the "discriminant", e.g., `status: "idle" | "loading" | "success" | "error"`). TypeScript uses this property to exhaustively narrow down the exact object shape inside `if` or `switch` branches.

---

### Conceptual Level
6. **Explain the difference between Covariance and Contravariance in TypeScript.**
   * *Answer:*
     - *Covariance:* Subtypes preserve direction: If `Dog` extends `Animal`, then `Array<Dog>` can be assigned to `Array<Animal>`. TypeScript properties and function return types are **covariant**.
     - *Contravariance:* Subtypes reverse direction: If `Dog` extends `Animal`, a function accepting an `Animal` (`(a: Animal) => void`) can be safely passed where a function accepting a `Dog` is expected (`(d: Dog) => void`), because it can handle any animal. TypeScript function parameters under `"strictFunctionTypes": true` are **contravariant**.

7. **How does the `infer` keyword work in conditional types?**
   * *Answer:* The `infer` keyword declares a temporary type variable within the conditional `extends` clause. Instead of checking if a type matches, TypeScript deduces and extracts the type from that position.
   ```typescript
   type ElementType<T> = T extends (infer U)[] ? U : T;
   type Num = ElementType<number[]>; // number
   ```

8. **What is the difference between Type Assertion (`x as T`) and Type Declaration (`const x: T`)?**
   * *Answer:* Type Declaration (`const x: T = ...`) tells the compiler to verify that the assigned value matches type `T`. If a required property is missing, the compiler throws an error. Type Assertion (`x as T`) overrides the compiler's inference, asserting "I know better than the compiler." It bypasses safety checks and will not warn if properties are missing at compile time.

9. **Explain Distributive Conditional Types and how to disable distribution.**
   * *Answer:* When a generic parameter `T` in a conditional type `T extends U ? X : Y` receives a union (`A | B`), TypeScript automatically distributes the condition across each member: `(A extends U ? X : Y) | (B extends U ? X : Y)`.
   * *To disable distribution:* Wrap both sides of the `extends` keyword in square brackets: `[T] extends [U] ? X : Y`.

10. **What problem does the `satisfies` operator solve that type annotation cannot?**
    * *Answer:* When you annotate `const config: Record<string, string | number> = { port: 8080 }`, TypeScript widens `config.port` to `string | number`. Calling `config.port.toFixed()` throws a compiler error. Using `satisfies` (`const config = { port: 8080 } satisfies Record<string, string | number>`) validates that the object conforms to the shape, while preserving the exact literal type `number` for `port`.

---

### Implementation Level
11. **Implement a custom `DeepReadonly<T>` generic type.**
    * *Answer:*
    ```typescript
    export type DeepReadonly<T> = T extends Function | boolean | number | string | symbol | null | undefined
      ? T
      : T extends Array<infer U>
      ? ReadonlyArray<DeepReadonly<U>>
      : T extends Map<infer K, infer V>
      ? ReadonlyMap<DeepReadonly<K>, DeepReadonly<V>>
      : T extends Set<infer M>
      ? ReadonlySet<DeepReadonly<M>>
      : { readonly [K in keyof T]: DeepReadonly<T[K]> };
    ```

12. **Implement a custom type-safe `PickByValueType<T, ValueType>` that picks only properties of a specific type.**
    * *Answer:*
    ```typescript
    export type PickByValueType<T, ValueType> = Pick<
      T,
      { [K in keyof T]: T[K] extends ValueType ? K : never }[keyof T]
    >;

    // Usage:
    interface Person { id: number; name: string; age: number; bio: string; }
    type NumericFields = PickByValueType<Person, number>; // { id: number; age: number; }
    ```

13. **Write a custom User-Defined Type Guard function to validate that an unknown value is a valid `User` object.**
    * *Answer:*
    ```typescript
    interface User {
      id: string;
      email: string;
    }

    export function isUser(value: unknown): value is User {
      return (
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        typeof (value as any).id === "string" &&
        "email" in value &&
        typeof (value as any).email === "string"
      );
    }
    ```

14. **How do you implement type-safe currying in TypeScript for a 2-argument function?**
    * *Answer:*
    ```typescript
    export function curry2<A, B, R>(fn: (a: A, b: B) => R) {
      return (a: A) => (b: B): R => fn(a, b);
    }

    const add = (a: number, b: number) => a + b;
    const curriedAdd = curry2(add);
    const addFive = curriedAdd(5);
    const result = addFive(10); // 15 (fully type-safe)
    ```

15. **How do you extract the arguments of a function type as a tuple using `infer`?**
    * *Answer:*
    ```typescript
    type MyParameters<T extends (...args: any[]) => any> = T extends (
      ...args: infer P
    ) => any
      ? P
      : never;
    ```

---

### Debugging Level
16. **Why does TypeScript throw: `Type 'string' cannot be used to index type 'T'`?**
    * *Answer:* When indexing an object `obj[key]` in a generic function, TypeScript cannot guarantee that an arbitrary `string` exists on generic type `T`. Fix by constraining the key: `function getProp<T, K extends keyof T>(obj: T, key: K): T[K] { return obj[key]; }`.

17. **Why does TypeScript allow: `const arr: number[] = [1, 2]; const x = arr[100];` without compiler error, even though `x` is `undefined` at runtime?**
    * *Answer:* By default, TypeScript assumes array index accesses always return the element type (`number`). To prevent this runtime bug, enable `"noUncheckedIndexedAccess": true` in `tsconfig.json`. TypeScript will then correctly infer `x` as `number | undefined`.

18. **Why does `Omit<UnionType, 'key'>` break discriminated union narrowing?**
    * *Answer:* Built-in `Omit<T, K>` does **not distribute over unions**. It converts the union into an intersection or broad object type, stripping the discriminant property from the union. Solution: Write a distributive `Omit`:
    ```typescript
    type DistributiveOmit<T, K extends PropertyKey> = T extends any ? Omit<T, K> : never;
    ```

19. **Why does TypeScript throw `Property 'x' does not exist on type 'never'` after an `if` check?**
    * *Answer:* The type narrowing logic eliminated all possible types in the union, leaving `never`. This happens when conditions are mutually exclusive or redundant (e.g., checking `if (typeof val === 'string' && typeof val === 'number')`).

20. **Why does `interface A extends B` fail with `An interface can only extend an object type or intersection of object types with statically known members`?**
    * *Answer:* An `interface` cannot extend a union type (e.g., `type B = { a: string } | { b: number }`) because the shape of a union is not statically known at compile time. Change `interface A` to a `type` alias using intersection: `type A = B & { extra: boolean }`.

---

### Scenario-Based Questions
21. **Scenario: You are building an API client library. How do you type an endpoint function so that query parameters are strictly required ONLY IF the endpoint definition specifies parameters?**
    * *Answer:* Use conditional generic parameters with tuple resting:
    ```typescript
    type EndpointDef = {
      path: string;
      params?: Record<string, string>;
    };

    type RequestArgs<T extends EndpointDef> = T["params"] extends Record<string, string>
      ? [path: T["path"], params: T["params"]]
      : [path: T["path"]];

    function request<T extends EndpointDef>(...args: RequestArgs<T>) {
      // Implementation
    }
    ```

22. **Scenario: You need to prevent developers from passing un-sanitized SQL strings to a database client. How do you enforce this at the type level?**
    * *Answer:* Use **Branded Types**:
    ```typescript
    export type SanitizedSQL = string & { readonly __brand: unique symbol };

    export function sql(strings: TemplateStringsArray, ...values: any[]): SanitizedSQL {
      // Escape values and construct sanitized string
      return escapedQuery as SanitizedSQL;
    }

    export function query(statement: SanitizedSQL) {
      // Database execution
    }

    // query("SELECT * FROM users"); // COMPILE ERROR! Raw string is not SanitizedSQL
    // query(sql`SELECT * FROM users WHERE id = ${id}`); // PASSES
    ```

23. **Scenario: You are writing a state management library. How do you infer action payload types automatically from an action creator map?**
    * *Answer:*
    ```typescript
    type ActionCreatorMap = {
      [key: string]: (...args: any[]) => { type: string; payload?: any };
    };

    type ActionsFromMap<T extends ActionCreatorMap> = ReturnType<T[keyof T]>;
    ```

24. **Scenario: You have a form state object and need to dynamically generate validation error keys matching only nested string fields. How do you achieve this?**
    * *Answer:* Use template literal types combined with mapped recursion:
    ```typescript
    type NestedKeyOf<T> = T extends object
      ? {
          [K in keyof T & string]: T[K] extends object
            ? `${K}` | `${K}.${NestedKeyOf<T[K]>}`
            : `${K}`;
        }[keyof T & string]
      : never;
    ```

25. **Scenario: You are creating an SDK that supports plugins. Each plugin can add new methods to the core SDK instance. How do you design the type definition?**
    * *Answer:* Use method chaining with generic type intersections:
    ```typescript
    class SDK<TContext = {}> {
      use<TExtension>(
        plugin: (sdk: this) => TExtension
      ): SDK<TContext & TExtension> {
        // Attach methods at runtime
        return this as any;
      }
    }
    ```

---

### Advanced Architectural Questions
26. **Explain the difference between `any`, `unknown`, and `never` in set-theoretic terms.**
    * *Answer:*
      - `unknown` is the **Universal Top Type** ($\top$). It is the superset of every conceivable type. Everything is assignable to `unknown`.
      - `never` is the **Bottom Type** ($\bot$ or $\emptyset$). It contains no values. It is a subtype of every type, but nothing is assignable to `never` except `never`.
      - `any` is an escape hatch that turns off the type checker entirely. It acts as both top type and bottom type simultaneously, violating sound set theory.

27. **What is Higher-Kinded Typing (HKT) and how can it be simulated in TypeScript?**
    * *Answer:* Higher-Kinded Types are type constructors that take other type constructors as arguments (like `F<T>` where `F` itself is generic, e.g., Functor or Monad in Haskell). TypeScript does not natively support HKT syntax (`type Functor<F<_>>`). However, libraries like `fp-ts` simulate HKTs using **Lightweight Higher-Kinded Polymorphism**: using a global interface registry (URI-to-Type map) and defunctionalized type tokens.

28. **Explain how Key Remapping via `as` works in Mapped Types.**
    * *Answer:* Introduced in TypeScript 4.1, key remapping allows you to transform property keys in a mapped type using the `as` clause:
    ```typescript
    type Getters<T> = {
      [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
    };
    interface User { name: string; age: number; }
    type UserGetters = Getters<User>; // { getName: () => string; getAge: () => number; }
    ```
    If the `as` clause evaluates to `never`, that key is filtered out of the resulting type.

29. **What are Assertion Functions (`asserts condition` or `asserts val is T`)?**
    * *Answer:* Assertion functions are functions that throw an error if a condition is not met. When typed with `asserts val is T`, TypeScript refines the type of the variable for the entire remaining execution scope of the outer block without requiring an `if` statement:
    ```typescript
    function assertIsString(val: unknown): asserts val is string {
      if (typeof val !== "string") throw new TypeError("Not a string!");
    }
    // After calling assertIsString(x), x is narrowed to string on all subsequent lines.
    ```

30. **Explain Type Instantiation Depth Limits and how the compiler prevents infinite generic recursion.**
    * *Answer:* When evaluating recursive types (e.g., deeply nested JSON objects or linked list types), TypeScript enforces a hard instantiation depth limit (typically 50 levels for general recursion, or 1,000 for tail-recursive conditional types). If generic instantiation exceeds this limit, `tsc` halts with error `Type instantiation is excessively deep and possibly infinite`, preventing compiler memory exhaustion and infinite loops.

---

## 16. Coding Questions

### Coding Challenge 1: Type-Safe Object Flattener (Flattening Nested Keys)

```typescript
// Type-level recursive flattener
export type FlattenObject<T, Prefix extends string = ""> = {
  [K in keyof T & string]: T[K] extends object
    ? FlattenObject<T[K], `${Prefix}${K}.`>
    : { [P in `${Prefix}${K}`]: T[K] };
}[keyof T & string];

// UnionToIntersection helper to collapse union of objects into a single object
type UnionToIntersection<U> = (
  U extends any ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

export type Flatten<T> = UnionToIntersection<FlattenObject<T>>;

// Example test:
interface NestedData {
  user: {
    name: string;
    location: {
      city: string;
      zip: number;
    };
  };
  active: boolean;
}

// Resulting Type:
// { "user.name": string; "user.location.city": string; "user.location.zip": number; "active": boolean; }
```

### Coding Challenge 2: Custom Tuple Manipulation Utilities (`Push`, `Pop`, `Shift`, `Reverse`)

```typescript
// 1. Push
export type Push<T extends any[], V> = [...T, V];

// 2. Pop
export type Pop<T extends any[]> = T extends [...infer Rest, any] ? Rest : [];

// 3. Shift
export type Shift<T extends any[]> = T extends [any, ...infer Rest] ? Rest : [];

// 4. Reverse
export type Reverse<T extends any[]> = T extends [infer Head, ...infer Tail]
  ? [...Reverse<Tail>, Head]
  : [];

// Tests:
type T1 = Push<[1, 2], 3>;       // [1, 2, 3]
type T2 = Pop<[1, 2, 3]>;        // [1, 2]
type T3 = Shift<[1, 2, 3]>;      // [2, 3]
type T4 = Reverse<[1, 2, 3, 4]>; // [4, 3, 2, 1]
```

---

## 17. Common Interview Traps

* **The Trap:** The interviewer asks: *"Does TypeScript perform runtime type checking if you compile with `--strict`?"*
  * **How candidates fail:** Saying "Yes, strict mode enables runtime type assertions."
  * **The Winning Answer:** **TypeScript NEVER performs runtime type checking under any configuration flag.** All TypeScript types, interfaces, generics, and type guards are completely erased during compilation to JavaScript. `--strict` merely enables stricter compile-time static analysis rules. Runtime validation requires dedicated libraries like Zod or custom runtime validation code.
* **The Trap:** *"Can you assign a variable of type `{ id: string; name: string; age: number }` to a function expecting `{ id: string }`?"*
  * **How candidates fail:** Saying "No, because the types don't match exactly."
  * **The Winning Answer:** **Yes, you can!** TypeScript uses a **Structural Type System ("Duck Typing")**. If an object possesses all the required properties of a target type, it is considered a valid subtype, even if it contains additional excess properties. (Note: The only exception is **Excess Property Checking on fresh object literals**, which flags unlisted properties when passed directly inline).

---

## 18. Revision Summary

```
+-----------------------------------------------------------------------------------+
|                   TypeScript Types High-Yield Revision Matrix                     |
+-----------------------------------------------------------------------------------+
| Top & Bottom:       unknown (must narrow), any (turns off TS), never (empty set)   |
| Utility Types:      Pick, Omit, Partial, Required, Record, Awaited, ReturnType    |
| Meta-Programming:   Conditional (T extends U ? X : Y) + infer pattern matching    |
| Mapped Types:       [K in keyof T as NewKey]: NewVal (supports key filtering)     |
| Operator Safety:    satisfies validates shape without widening literal inference  |
| Narrowing:          Discriminated unions, typeof, instanceof, custom guards (is)  |
+-----------------------------------------------------------------------------------+
```

---

## 19. Quick Reference

* **`keyof T`:** Produces a union of property names of `T`.
* **`T[K]`:** Indexed access type (lookup type).
* **`infer R`:** Deduces and extracts an unknown type variable in conditional types.
* **`satisfies T`:** Validates type conformance without changing inference.
* **`as const`:** Freezes literals into immutable readonly types.
* **`val is T`:** Type predicate for custom type guard functions.
* **`asserts val is T`:** Assertion signature that refines type for subsequent execution scope.
