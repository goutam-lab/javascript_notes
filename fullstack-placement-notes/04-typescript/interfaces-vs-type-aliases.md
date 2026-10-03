# Interfaces vs. Type Aliases: Deep Comparison & Architectural Rules

## 1. What is it?
In TypeScript, **`interface`** and **`type` alias** are the two primary ways to declare custom types and describe object structures. 

While they share substantial syntactic and semantic overlap—both can describe object shapes, functions, and class implementations—they possess critical architectural differences in how the TypeScript compiler processes, caches, merges, and extends them.

---

## 2. Why does it exist?
TypeScript evolved over a decade:
- **`interface`** was introduced in TypeScript 0.8 (2012) to mirror traditional Object-Oriented Programming (OOP) paradigms (like C# and Java) and support open-ended extension via **Declaration Merging** (critical for augmenting browser APIs like `window`).
- **`type` alias** was introduced in TypeScript 1.4 (2014) to support Functional Programming (FP) paradigms, algebraic data types, union types (`|`), intersection types (`&`), tuples, and primitive aliases.

Understanding the internal compiler differences between them is a standard benchmark used in technical placement interviews to distinguish junior developers from senior engineers.

---

## 3. Mental Model: The Open Blueprint vs. The Exact Mathematical Equation
💡 **Think of an Open Architectural Blueprint vs. a Sealed Math Formula:**

```
                  INTERFACE (Open Blueprint)
┌─────────────────────────────────────────────────────────────┐
│  interface User { name: string; }                           │
│  ... later in a third-party plugin file ...                  │
│  interface User { permissions: string[]; }                  │
│  Result: Merges into { name: string; permissions: string[] }│
└─────────────────────────────────────────────────────────────┘

                  TYPE ALIAS (Sealed Formula)
┌─────────────────────────────────────────────────────────────┐
│  type User = { name: string };                              │
│  type User = { permissions: string[] };                     │
│  Result: 💥 Duplicate identifier error! Cannot be reopened! │
└─────────────────────────────────────────────────────────────┘
```

- An **`interface`** is open-ended: other files or packages can "reopen" it and add new properties (Declaration Merging).
- A **`type`** alias is a sealed definition: once defined, it cannot be redefined with the same name. It is an exact assignment: `type Point = (x, y)`.

---

## 4. Basic Syntax Comparison

```typescript
// 1. Defining Object Shapes
interface UserInterface {
  id: string;
  name: string;
}

type UserType = {
  id: string;
  name: string;
};

// 2. Extending / Composing
interface AdminInterface extends UserInterface {
  role: 'admin';
}

type AdminType = UserType & {
  role: 'admin';
};

// 3. Implementing with Classes
class UserAdminOne implements AdminInterface {
  id = '1';
  name = 'Admin';
  role = 'admin' as const;
}

class UserAdminTwo implements AdminType {
  id = '2';
  name = 'SuperAdmin';
  role = 'admin' as const;
}
```

---

## 5. The 4 Key Differences Every Senior Engineer Must Know

### Difference 1: Declaration Merging
Interfaces automatically merge multiple declarations with the same name in the same scope. Type aliases throw a compile error.

```typescript
// ✅ Merges automatically:
interface CartItem {
  id: string;
  price: number;
}

interface CartItem {
  quantity: number;
}

const item: CartItem = {
  id: 'c1',
  price: 29.99,
  quantity: 2, // Required!
};

// ❌ COMPILE ERROR with type aliases:
type CartProduct = { id: string };
// type CartProduct = { price: number }; // 💥 Duplicate identifier 'CartProduct'.
```

### Difference 2: Unions, Primitives & Tuples
`type` can declare primitives, unions, and tuples. `interface` cannot.

```typescript
// ✅ Only possible with 'type':
type Status = 'IDLE' | 'ACTIVE' | 'ERROR'; // Union
type ID = string | number;                  // Primitive union
type Coordinate = [x: number, y: number];   // Tuple
type Callback = (data: string) => void;     // Clean function alias

// ❌ Interfaces CANNOT do this:
// interface Status = 'IDLE' | 'ACTIVE'; // Syntax Error!
```

### Difference 3: Compiler Performance & Type Checking Internals
The TypeScript compiler handles them differently in its type-checker cache:
- **`interface`**: TypeScript creates a **single flat cached object type**. When checking relationships via `extends`, TypeScript does a quick hash lookup. Conflict detection is instant and produces clear, direct error messages.
- **`type` Intersection (`&`)**: TypeScript creates a **recursive intersection type**. When checking `A & B`, the compiler must recursively examine and flatten every property. If properties conflict:
  ```typescript
  type Conflict = { id: string } & { id: number };
  // TypeScript silently evaluates Conflict['id'] as: string & number = never!
  ```
  In massive enterprise codebases with thousands of files, extensive use of `&` intersections can noticeably slow down `tsc` compilation compared to `interface extends`.

### Difference 4: Mapped Types & Computed Properties
Only `type` aliases can produce mapped types using the `in keyof` syntax:

```typescript
type FeatureFlags = 'auth' | 'billing' | 'chat';

// ✅ Valid with 'type':
type FeatureConfig = {
  [K in FeatureFlags]: boolean;
};

// ❌ Interfaces cannot directly map across a union:
// interface BadInterface { [K in FeatureFlags]: boolean; } // Syntax Error!
```

---

## 6. Real Example: Library Augmentation (Window & Express Request)

Declaration merging makes `interface` the only tool for **Declaration Augmentation**:

```typescript
// Augmenting the global browser 'Window' object:
declare global {
  interface Window {
    analytics: {
      track: (eventName: string, props?: Record<string, unknown>) => void;
    };
  }
}

// Now you can safely use it without 'any' casts!
window.analytics.track('PAGE_VIEW', { path: '/dashboard' });

// Augmenting Express 'Request' with an authenticated user:
import 'express';

declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      id: string;
      role: 'admin' | 'user';
    };
  }
}
```

---

## 7. The Definitive Decision Matrix

| Feature | `interface` | `type` alias |
| :--- | :--- | :--- |
| **Objects & Class contracts** | ✅ Excellent | ✅ Excellent |
| **Primitives & Literals** | ❌ Cannot define | ✅ Yes (`type ID = string`) |
| **Union Types (`\|`)** | ❌ Cannot define | ✅ Yes (`type A = B \| C`) |
| **Tuple Types** | ❌ Difficult | ✅ Yes (`type T = [A, B]`) |
| **Declaration Merging** | ✅ Yes (Open) | ❌ No (Sealed) |
| **Global / Module Augmentation** | ✅ Yes | ❌ No |
| **Mapped & Conditional Types** | ❌ Cannot define | ✅ Yes (`[K in Keys]`, `infer`) |
| **Compiler Performance** | ⚡ Fastest (Flat cached shapes) | Slightly slower for deep `&` intersections |

---

## 8. The Senior Placement Rule of Thumb

> **The Golden Rule**:
> 1. Use **`interface`** by default for **Object shapes, React component Props, Class models, and Public Library APIs** (benefits from compiler caching and declaration merging).
> 2. Use **`type`** whenever you need **Unions, Primitives, Tuples, Utility Types, Mapped Types, or Complex Function Signatures**.

---

## 9. Common Mistakes

### Mistake 1: Accidental Declaration Merging
```typescript
// File A:
interface Settings {
  theme: string;
}

// File B (unintentionally reuses the name):
interface Settings {
  notifications: boolean;
}

// Result: Any code creating Settings now silently requires BOTH properties!
// If accidental, this causes confusing compiler errors across large projects.
```

### Mistake 2: Conflicting Intersections creating `never`
```typescript
interface UserA { id: string; }
interface UserB { id: number; }

// ❌ Does not throw an error at definition time, but 'id' becomes 'never'!
type Combined = UserA & UserB;

const test: Combined = {
  // 💥 Error: Type 'string' is not assignable to type 'never'!
  id: '123' as any, 
};
```

---

## 10. Performance Considerations

- In benchmarks performed on large enterprise codebases (100k+ lines of TypeScript), replacing widespread recursive `&` intersections with `interface extends` reduced full type-checking compilation times by **up to 15-20%** because `interface` allows the compiler to detect property collisions before constructing intersection graphs.

---

## 11. Security Considerations

- Declaration merging allows malicious third-party dependencies in `node_modules` to augment ambient types and bypass type safety checks without warnings. Ensure your `package-lock.json` and dependencies are audited.

---

## 12. Alternatives: Classes

Classes define both a runtime JavaScript constructor/prototype and a TypeScript type with the same name. However, classes add runtime overhead and memory allocations; use `interface` or `type` when you only need compile-time shape contracts.

---

## 13. Trade-offs

- **Interface Trade-off**: Better performance and extensibility; cannot represent non-object types.
- **Type Alias Trade-off**: Ultimate expressiveness (supports all type algebra); can cause compiler bloat with excessive nested `&` intersections.

---

## 14. Real-World Usage

- **React Codebases**: Component props are commonly written as `interface ButtonProps { ... }`.
- **Next.js & Express**: Augmenting request contexts using interface declaration merging.
- **Zod & Prisma**: Generating inferred types using `type User = z.infer<typeof UserSchema>`.

---

## 15. Placement Interview Questions

### Basic
**Q: Can a type alias be reopened to add new properties in TypeScript?**  
*Answer*: No. Type aliases cannot be reopened; attempting to declare a type alias with the same name in the same scope throws a "Duplicate identifier" compiler error. Only interfaces support declaration merging and can be reopened.

### Conceptual
**Q: Why does `interface extends` perform better in the TypeScript compiler than type intersection `&`?**  
*Answer*: `interface extends` allows the compiler to check for property name conflicts immediately and create a flat, cached object type definition in memory. Type intersections (`&`) create composite intersection structures where properties are combined recursively. The compiler must evaluate each branch to determine compatibility, and conflicting property types are silently reduced to `never` instead of producing immediate structural validation errors.

### Implementation
**Q: How do you augment an existing third-party npm package interface to add a custom property in your TypeScript project?**  
*Answer*: Use module augmentation by declaring the module and redeclaring the interface with the desired property:
```typescript
declare module 'axios' {
  export interface AxiosRequestConfig {
    customMetadata?: { timestamp: number };
  }
}
```

### Debugging
**Q: An engineer writes `type T = { a: string } & { a: number }`. Why doesn't TypeScript show an error on this line, but throws an error when trying to instantiate an object of type `T`?**  
*Answer*: TypeScript computes the type intersection of the `a` property: `string & number`. Because no value can simultaneously be a string and a number, the type of `a` becomes `never`. The type definition itself is mathematically valid in set theory (it represents an impossible set). The error only surfaces when you attempt to assign a value to `T.a`, because no valid value can be assigned to `never`.

### Scenario
**Q: You are building a public component library that will be published to npm for thousands of external developers. Should your component prop types be declared as `interface` or `type`?**  
*Answer*: They should be declared as **`interface`**. This allows consumers of your library to use declaration merging to add custom vendor props or augment component interfaces without having to fork or monkey-patch your library source code.

### Advanced
**Q: How does the `implements` clause behave when a class implements an interface vs. an intersection type?**  
*Answer*: A class can implement both an `interface` and a `type` alias representing an object shape or intersection (`class Foo implements A & B`). However, a class **cannot** implement a `type` alias that represents a union type (`type Union = A | B`), because a class must have a single, static structural shape determined at instantiation time.

---

## 16. Coding Challenge: Polymorphic Logger Interface

**Task**: Write an architectural type contract for a logging system where plugins can augment the log levels via declaration merging, but core formatting options are sealed using a type alias.

```typescript
// Sealed formatting options using 'type'
export type LogFormat = 'json' | 'pretty-text' | 'compact';

// Extensible Logger interface supporting declaration merging
export interface LoggerLevels {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string, err?: Error) => void;
}

// Base Logger definition
export interface ILogger extends LoggerLevels {
  format: LogFormat;
  log: (level: keyof LoggerLevels, message: string) => void;
}

// External plugin file augments LoggerLevels with 'debug' and 'audit':
declare module './logger' {
  interface LoggerLevels {
    debug: (msg: string) => void;
    audit: (msg: string, userId: string) => void;
  }
}
```

---

## 17. Common Interview Traps

1. **"Always use `type` because it's newer and can do everything."**  
   *Trap*: Dismissing interfaces.  
   *Reality*: Interfaces are essential for OOP contracts, declaration merging, public API design, and offer superior compiler caching.
2. **"Interfaces can extend union types."**  
   *Trap*: Writing `interface MyInterface extends (TypeA | TypeB)`.  
   *Reality*: An interface cannot extend a union type because an interface represents a single, fixed object blueprint.

---

## 18. Revision Summary

- `interface` $\rightarrow$ Open (declaration merging), object shapes, class contracts, public APIs, faster compiler caching.
- `type` $\rightarrow$ Sealed (cannot reopen), unions, primitives, tuples, mapped/conditional types.
- Conflicting intersections in `type` produce `never`; conflicting properties in `interface extends` produce immediate compile errors.
- Use `interface` for React props and object shapes; use `type` for unions and algebraic data types.

---

## 19. Quick Reference

```typescript
// Object Shape: Prefer interface
interface UserProps {
  id: string;
  name: string;
}

// Union / Algebra: Must use type
type ID = string | number;
type ApiResponse<T> = 
  | { success: true; data: T }
  | { success: false; error: string };

// Extension:
interface AdminProps extends UserProps { role: string; }
type AdminType = UserProps & { role: string; };
```
