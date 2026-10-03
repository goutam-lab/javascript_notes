# Generics, Type Constraints & Default Parameters

## 1. What is it?
In TypeScript, **Generics** are type parameters (variables for types) that allow you to write reusable, type-safe functions, classes, and interfaces that work across a variety of data types rather than a single concrete type.

Instead of hardcoding a type (e.g., `string` or `number`) or resorting to the type-unsafe `any`, generics introduce placeholder type variables (conventionally named `T`, `U`, `V`, `K`, `V`) whose exact concrete types are captured at the moment of invocation.

TypeScript enhances generics through **Generic Constraints** (`extends`)—which restrict allowed types to specific shapes—and **Default Generic Types** (`<T = DefaultType>`).

---

## 2. Why does it exist?
Consider building an API client or data structure in JavaScript:
- Without Generics, a caching function or identity function must either:
  1. Be duplicated for every possible type (`cacheString`, `cacheNumber`, `cacheUser`).
  2. Use `any`:
     ```typescript
     function getFirstItem(arr: any[]): any {
       return arr[0];
     }
     const item = getFirstItem([1, 2, 3]); // 'item' is any! Lost all type safety!
     ```
- With `any`, all compile-time autocomplete and safety are destroyed.
- **The Generic Solution**:
  ```typescript
  function getFirstItem<T>(arr: T[]): T | undefined {
    return arr[0];
  }
  const item = getFirstItem([1, 2, 3]); // 'item' is strictly 'number'!
  ```
  TypeScript dynamically captures the type of the array elements and links it directly to the return type!

---

## 3. Mental Model: The Variable for Types & The Custom Mold
💡 **Think of an Industrial Factory Injection Mold:**

```
                  THE GENERIC INJECTION MOLD: ApiResponse<T>
┌─────────────────────────────────────────────────────────────┐
│  interface ApiResponse<T> {                                 │
│    status: number;                                          │
│    data: T; // <-- The Empty Mold Slot                      │
│  }                                                          │
└──────────────────────────────┬──────────────────────────────┘
                               │
               ┌───────────────┴───────────────┐
               ▼                               ▼
    Pour in [ UserProfile ]           Pour in [ Product[] ]
               │                               │
               ▼                               ▼
  ApiResponse<UserProfile>            ApiResponse<Product[]>
  - status: number                    - status: number
  - data: UserProfile                 - data: Product[]
```

- Just as normal function parameters accept **values** at runtime, generic type parameters accept **types** at compile time.

---

## 4. Basic Syntax: Functions, Interfaces & Classes

```typescript
// 1. Generic Function
function wrapInArray<T>(value: T): T[] {
  return [value];
}
const numArr = wrapInArray(42);       // Inferred as: number[]
const strArr = wrapInArray('hello'); // Inferred as: string[]

// 2. Generic Interface
interface PaginatedResult<T> {
  items: T[];
  totalCount: number;
  page: number;
}

const userPage: PaginatedResult<{ id: string; name: string }> = {
  items: [{ id: '1', name: 'Alice' }],
  totalCount: 100,
  page: 1,
};

// 3. Generic Class
class Queue<T> {
  private data: T[] = [];

  push(item: T): void {
    this.data.push(item);
  }

  pop(): T | undefined {
    return this.data.shift();
  }
}

const numQueue = new Queue<number>();
numQueue.push(10);
// numQueue.push("error"); // ❌ Compile error!
```

---

## 5. Generic Constraints (`extends`)

Often, you don't want a generic to accept *any* type; you need to guarantee that the incoming type possesses specific properties (like an `.id` or `.length`):

```typescript
// Define constraint shape:
interface HasId {
  id: string | number;
}

// Enforce that T MUST have at least an 'id' property:
function printId<T extends HasId>(entity: T): void {
  console.log(`Entity ID: ${entity.id}`);
}

printId({ id: 'u123', name: 'Alice' }); // ✅ Valid! Has 'id'
printId({ id: 99, title: 'Item' });      // ✅ Valid! Has 'id'

// ❌ COMPILE ERROR: Argument of type '{ name: string }' is not assignable to parameter of type 'HasId'.
// printId({ name: "Bob" });
```

---

## 6. The `K extends keyof T` Constraint (Safe Property Access)

One of the most powerful TypeScript idioms connects an object with its own keys:

```typescript
// Guarantees that K is strictly a valid key of T, and returns T[K]!
export function getProperty<T, K extends keyof T>(obj: T, key: K): T[K] {
  return obj[key];
}

const user = {
  name: 'Alice',
  age: 30,
  isPremium: true,
};

// Autocomplete offers: "name" | "age" | "isPremium"!
const name = getProperty(user, 'name');      // Strictly: string
const age = getProperty(user, 'age');        // Strictly: number
const active = getProperty(user, 'isPremium'); // Strictly: boolean

// ❌ COMPILE ERROR: Argument of type '"salary"' is not assignable to parameter of type '"name" | "age" | "isPremium"'.
// getProperty(user, "salary");
```

---

## 7. Default Generic Parameters (`<T = DefaultType>`)

Just as functions can have default argument values, generics can have default types:

```typescript
// Default T to Record<string, unknown> if no type is provided
interface ApiResponse<T = Record<string, unknown>> {
  status: 'SUCCESS' | 'ERROR';
  data: T;
}

// 1. Uses the default type: Record<string, unknown>
const basicResponse: ApiResponse = {
  status: 'SUCCESS',
  data: { timestamp: Date.now() },
};

// 2. Explicitly overrides the default:
const userResponse: ApiResponse<{ name: string }> = {
  status: 'SUCCESS',
  data: { name: 'Alice' },
};
```

---

## 8. Common Mistakes

### Mistake 1: Unnecessary Generics (The Golden Rule of Generics)
Developers often use generics where simple types suffice:

```typescript
// ❌ OVER-ENGINEERED (Antipattern):
function logMessage<T extends string>(msg: T): void {
  console.log(msg);
}

// ✅ CLEAN & IDIOMATIC:
function logMessage(msg: string): void {
  console.log(msg);
}
```

> **The Golden Rule**: If a type parameter `T` only appears **once** in the function signature and is not used to relate multiple parameters or the return type, **you do not need a generic**!

---

## 9. Best Practices

1. **Let TypeScript Infer Generics**: Avoid explicitly typing generic parameters when calling functions if TypeScript can infer them from the arguments:
   ```typescript
   // ❌ Unnecessary:
   wrapInArray<string>("hello");
   // ✅ Idiomatic inference:
   wrapInArray("hello");
   ```
2. **Use Descriptive Names for Multi-Parameter Generics**: When using 2+ type parameters, use descriptive names (`TData, TError, TVariables`) rather than cryptic single letters (`T, U, V`).
3. **Constrain Generics Narrowly**: Don't use unconstrained `<T>` if your function needs to read specific properties; always constrain with `extends`.

---

## 10. Performance Considerations

- **Compiler Instantiation Cost**: Deeply recursive generic types (such as deep path string pickers or nested object mappers) can cause the TypeScript compiler to reach maximum instantiation depth (`TS2589: Type instantiation is excessively deep and possibly infinite`). Avoid unbounded recursion in generic types.

---

## 11. Security Considerations

- In backend ORMs, generic query builders (`findFirst<T>`) must sanitize SQL statements regardless of whether the generic type matches the database schema. Compile-time generic safety does not prevent runtime SQL injection.

---

## 12. Alternatives: Union Types vs Generics

| Problem | When to use Union | When to use Generic |
| :--- | :--- | :--- |
| **Fixed Set of Types** | Discrete values (`string \| number`) | When the type can be any arbitrary shape |
| **Output Relationship** | Return type is independent of input | Return type is **derived from** input type |
| **Data Structures** | Mixed items in one array | Homogeneous items of a variable type |

---

## 13. Trade-offs

- **Benefit**: Maximum code reuse without sacrificing type safety; powers modern libraries (TanStack Query, Prisma, Zod).
- **Cost**: Steeper learning curve; complex generic error messages can be difficult for junior developers to decipher.

---

## 14. Real-World Usage

- **TanStack Query (React Query)**: `useQuery<TData, TError>({ queryKey, queryFn })`.
- **Axios**: `axios.get<UserResponse>('/api/user')`.
- **React State**: `useState<User | null>(null)`.

---

## 15. Placement Interview Questions

### Basic
**Q: What is a Generic in TypeScript and why is it preferred over `any`?**  
*Answer*: A generic is a type variable that allows a function, interface, or class to operate on multiple data types while preserving exact type relationships. Unlike `any`—which turns off all compiler checks and returns an untyped value—a generic captures the incoming type and enforces it throughout the function and its return value, maintaining 100% type safety and autocomplete.

### Conceptual
**Q: What is a Generic Constraint (`extends`) and why would you use it?**  
*Answer*: By default, an unconstrained generic `<T>` can be absolutely anything (a primitive, an object, null, undefined). Because TypeScript cannot guarantee what properties `T` possesses, you cannot access any properties on it (e.g. `item.length` causes a compile error). A generic constraint `<T extends HasLength>` restricts the allowed types to those that satisfy the `HasLength` shape, allowing the compiler to safely permit property access on `T`.

### Implementation
**Q: Write a generic function `pluck` that takes an array of objects and a key name, and returns an array containing only the values of that key.**  
*Answer*:
```typescript
export function pluck<T, K extends keyof T>(items: T[], key: K): T[K][] {
  return items.map((item) => item[key]);
}

const users = [
  { id: 1, name: 'Alice' },
  { id: 2, name: 'Bob' },
];

const names = pluck(users, 'name'); // Strictly: string[]
const ids = pluck(users, 'id');     // Strictly: number[]
```

### Debugging
**Q: What is wrong with the following generic function?**  
```typescript
function printLength<T>(arg: T): void {
  console.log(arg.length); // 💥 Error: Property 'length' does not exist on type 'T'.
}
```
*Answer*: `T` is completely unconstrained. A caller could pass a `number` or `boolean`, neither of which has a `.length` property. To fix this, constrain `T`: `function printLength<T extends { length: number }>(arg: T): void`.

### Scenario
**Q: How do you type a generic API response wrapper so that when `status === 200`, the data payload is typed as `T`, but when `status === 500`, the data payload is an `ApiError`?**  
*Answer*: Combine Generics with Discriminated Unions:
```typescript
type ApiResponse<T> =
  | { status: 200; data: T; error?: never }
  | { status: 500; data?: never; error: { code: string; message: string } };
```

### Advanced
**Q: What does the `extends` keyword mean in `<T extends U>` vs `type X = T extends U ? A : B`?**  
*Answer*:
1. In `<T extends U>`, `extends` is a **Generic Constraint**: it restricts `T` such that any type passed to `T` must be assignable to `U`.
2. In `type X = T extends U ? A : B`, `extends` is a **Conditional Type Operator**: it acts as a compile-time ternary expression that evaluates whether `T` is assignable to `U`, resolving to type `A` if true or type `B` if false.

---

## 16. Coding Challenge: Generic LRU Cache Class

**Task**: Implement a typed Least Recently Used (LRU) Cache using TypeScript generics that supports a fixed capacity, `get(key: K)`, and `put(key: K, value: V)`.

```typescript
export class LRUCache<K, V> {
  private capacity: number;
  private cache: Map<K, V>;

  constructor(capacity: number) {
    if (capacity <= 0) throw new Error('Capacity must be greater than 0');
    this.capacity = capacity;
    this.cache = new Map<K, V>();
  }

  public get(key: K): V | undefined {
    if (!this.cache.has(key)) return undefined;

    // Refresh key priority in Map
    const value = this.cache.get(key)!;
    this.cache.delete(key);
    this.cache.set(key, value);
    return value;
  }

  public put(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.capacity) {
      // Evict least recently used (first key in Map iterator)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, value);
  }

  public size(): number {
    return this.cache.size;
  }
}
```

---

## 17. Common Interview Traps

1. **"Generics exist in the JavaScript output."**  
   *Trap*: Expecting `<T>` in emitted `.js` files.  
   *Reality*: Generics undergo complete type erasure.
2. **"You can instantiate a generic type with `new T()`."**  
   *Trap*: Writing `const obj = new T()`.  
   *Reality*: Because `T` is erased at compile time, it does not exist as a constructor in JavaScript. To instantiate a generic class, you must pass a constructor function: `new (new (): T)()`.

---

## 18. Revision Summary

- Generics are **variables for types** (`<T>`).
- Constrain generics using **`<T extends Shape>`** to guarantee properties exist.
- Use **`<K extends keyof T>`** for type-safe property lookups.
- Set defaults using **`<T = DefaultType>`**.
- If `T` only appears once in the function signature, you probably don't need a generic!

---

## 19. Quick Reference

```typescript
// 1. Constrained Generic
function logId<T extends { id: string }>(item: T) {
  console.log(item.id);
}

// 2. keyof constraint
function get<T, K extends keyof T>(obj: T, k: K): T[K] {
  return obj[k];
}

// 3. Default generic parameter
type Store<T = string> = { data: T };
```
