# Advanced Types: Indexed Access, Mapped Types, `keyof` & Template Literals

## 1. What is it?
TypeScript’s advanced type system allows you to build programmatic, dynamic type transformations using four foundational building blocks:
1. **The `keyof` Operator**: Produces a union of all known, public property names of an object type.
2. **Indexed Access Types (`T[K]`)**: Looks up the type of a specific property or array element by key or index.
3. **Mapped Types (`[P in K]`)**: Iterates over a union of keys to construct a new object shape, with the ability to add or remove `readonly` and `?` modifiers.
4. **Key Remapping & Template Literal Types (`as NewKey`, `${string}`)**: Allows renaming, filtering, or generating dynamic string-based keys (such as auto-generating `getName()` getters for every property in a model).

---

## 2. Why does it exist?
In modern enterprise architectures:
- Maintaining synchronized interfaces for database models, reactive event emitters, and getters/setters manually is error-prone.
- If you have an entity `User` with properties `name`, `age`, and `email`, writing a dynamic change listener:
  ```typescript
  user.on('nameChanged', (newName) => { ... })
  ```
  in vanilla TypeScript would require either hardcoding every event string or losing type safety with `string`.
- **The Advanced Type Solution**: Template literal types combined with mapped key remapping generate typed event listeners (`${keyof User}Changed`) and automatically associate the callback parameter with the exact property type `User[K]`.

---

## 3. Mental Model: Database Indexing & String Interpolation
💡 **Think of Array Indexing and ES6 Template Literals for Types:**

```
ES6 Runtime JavaScript               TypeScript Compile-Time Type System
──────────────────────────────────   ───────────────────────────────────────
const key = 'name';                  type Key = 'name';
const val = user[key];               type Val = User[Key]; // Indexed Access

`on${eventName}`                     `on${Capitalize<EventName>}` // Template Literal
```

---

## 4. The 4 Building Blocks in Detail

### 1. The `keyof` Operator
```typescript
interface User {
  id: string;
  name: string;
  age: number;
}

type UserKeys = keyof User; // 'id' | 'name' | 'age'
```

### 2. Indexed Access Types (`T[K]`)
```typescript
type IdType = User['id'];       // string
type NameOrAge = User['name' | 'age']; // string | number

// Extracting array element type using 'number':
const colors = ['red', 'green', 'blue'] as const;
type Color = (typeof colors)[number]; // 'red' | 'green' | 'blue'
```

### 3. Mapped Types & Modifier Stripping
```typescript
interface Original {
  readonly id: string;
  bio?: string;
}

// Strip readonly (-readonly) and strip optional (-?)
type MutableRequired<T> = {
  -readonly [P in keyof T]-?: T[P];
};

type Result = MutableRequired<Original>; 
// { id: string; bio: string; }
```

### 4. Key Remapping with `as` & Template Literals
```typescript
type EventNames = 'click' | 'hover';
type HandlerMap = {
  [K in EventNames as `on${Capitalize<K>}`]: () => void;
};
// Result: { onClick: () => void; onHover: () => void; }
```

---

## 5. Real Example: Auto-Generating Type-Safe Getters & Setters

```typescript
interface Person {
  name: string;
  age: number;
  isActive: boolean;
}

// 1. Generate Getter Signatures: getName(): string, getAge(): number
type CreateGetters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

// 2. Generate Setter Signatures: setName(val: string): void, setAge(val: number): void
type CreateSetters<T> = {
  [K in keyof T as `set${Capitalize<string & K>}`]: (val: T[K]) => void;
};

// 3. Combined Reactive Store Type:
export type ReactiveStore<T> = T & CreateGetters<T> & CreateSetters<T>;

// Usage in practice:
declare const store: ReactiveStore<Person>;

// Full Autocomplete for all generated methods!
const currentName: string = store.getName();
store.setAge(31);
// store.setAge("thirty"); // ❌ Compile Error: Type 'string' is not assignable to 'number'!
```

---

## 6. Under the Hood: Filtering Keys in Mapped Types

How do you pick properties of a specific type (e.g. only functions or only strings)?
You remap the key to **`never`**:

```typescript
// If the property value matches ValueType, keep key K; otherwise, drop it by returning 'never'!
type PickByValueType<T, ValueType> = {
  [K in keyof T as T[K] extends ValueType ? K : never]: T[K];
};

interface Sample {
  id: string;
  count: number;
  title: string;
  reset: () => void;
}

type StringPropsOnly = PickByValueType<Sample, string>;
// Result: { id: string; title: string; }

type FunctionPropsOnly = PickByValueType<Sample, Function>;
// Result: { reset: () => void; }
```

---

## 7. Important Rules

1. **`keyof any` evaluates to `string | number | symbol`**: Because JavaScript object keys can be numbers or symbols in addition to strings.
2. **Template Literals Require `string & K`**: When capitalizing or interpolating keys (`${Capitalize<K>}`), you must intersect with `string` (`string & K`) because `K` may include symbols or numbers that cannot be capitalized.
3. **Remapping to `never` Drops the Key**: When using key remapping (`as`), if the expression evaluates to `never`, TypeScript completely prunes that property from the resulting object type.

---

## 8. Common Mistakes

### Mistake 1: Attempting to use mapped types inside an `interface`
```typescript
// ❌ SYNTAX ERROR: Interfaces cannot declare mapped types!
interface BadInterface {
  [K in 'a' | 'b']: string;
}

// ✅ CORRECT: Must use a 'type' alias for mapped types
type GoodType = {
  [K in 'a' | 'b']: string;
};
```

---

## 9. Best Practices

1. **Use `(typeof arr)[number]` to Extract Element Unions from Arrays**: Avoid duplicating string unions when you already have an `as const` array at runtime.
2. **Filter via `as ... ? K : never` Instead of Nested Pick/Omit**: Key remapping with `as` is cleaner and faster for the compiler to process.
3. **Use Built-in String Manipulation Types**:
   - `Uppercase<StringType>`
   - `Lowercase<StringType>`
   - `Capitalize<StringType>`
   - `Uncapitalize<StringType>`

---

## 10. Performance Considerations

- **Combinatorial Template Literal Explosions**: Be cautious when interpolating multiple unions into template literals:
  ```typescript
  type Color = 'red' | 'blue' | 'green' | 'yellow';
  type Size = 'sm' | 'md' | 'lg' | 'xl';
  type Weight = 'light' | 'bold' | 'bolder';
  type ClassName = `${Color}-${Size}-${Weight}`; // 4 * 4 * 3 = 48 union members!
  ```
  Interpolating 4 or 5 large unions can easily generate 100,000+ union members, crashing the TypeScript compiler process!

---

## 11. Security Considerations

- Advanced types help prevent authorization privilege escalation bugs by generating strict permission action unions (e.g. `${Domain}:${Action}` like `'user:read' | 'user:write'`).

---

## 12. Alternatives

| Technique | Primary Use Case |
| :--- | :--- |
| **`keyof T`** | Extracting property name unions |
| **`T[K]`** | Accessing property value types |
| **`[P in K]: T`** | Transforming all properties of a type |
| **Key Remapping (`as`)** | Renaming, prefixing, or filtering properties |
| **Template Literals** | Generating structured string union sets |

---

## 13. Trade-offs

- **Benefit**: Infinite expressiveness; compile-time code generation without external build macros; zero boilerplate.
- **Cost**: Can become dense and cryptic ("Type Gymnastics") if overused where simple interfaces would suffice.

---

## 14. Real-World Usage

- **Tailwind CSS in TypeScript**: Libraries type utility class strings using template literal unions (`p-${number}`, `text-${color}`).
- **ORM Schema Mapping**: Prisma and TypeORM generate relation and where clauses dynamically using mapped types.

---

## 15. Placement Interview Questions

### Basic
**Q: What does the `keyof` operator return when applied to an interface?**  
*Answer*: It returns a union of all public property names of that interface as string (or number/symbol) literal types. For example, for `interface Point { x: number; y: number }`, `keyof Point` produces the union `'x' | 'y'`.

### Conceptual
**Q: How does Key Remapping with the `as` clause allow filtering properties out of a mapped type?**  
*Answer*: In a mapped type `[K in keyof T as NewKey]`, TypeScript evaluates `NewKey` for each property. If `NewKey` evaluates to the bottom type `never`, TypeScript completely excludes that property from the output object type, effectively filtering it out.

### Implementation
**Q: Write a TypeScript utility type `ObjectEntries<T>` that returns a union of key-value tuples representing the entries of `T`.**  
*Answer*:
```typescript
type ObjectEntries<T> = {
  [K in keyof T]: [K, T[K]];
}[keyof T];

interface User { id: string; age: number; }
type UserEntries = ObjectEntries<User>; // ['id', string] | ['age', number]
```

### Debugging
**Q: Why does `type UppercaseKeys<T> = { [K in keyof T as Uppercase<K>]: T[K] }` throw a compiler error?**  
*Answer*: `keyof T` can include `symbol` or `number` types, which are not assignable to `string`. The intrinsic utility `Uppercase<S>` requires `S extends string`. To fix this, intersect `K` with `string`: `[K in keyof T as Uppercase<string & K>]: T[K]`.

### Scenario
**Q: You are building a state store. You want an `on(event, handler)` method where valid events are typed as `${stateProperty}Changed` and the callback receives the new property value. How do you implement this?**  
*Answer*:
```typescript
interface State { count: number; user: string; }

type StateChangeEvents<T> = {
  [K in keyof T as `${string & K}Changed`]: (newValue: T[K]) => void;
};

type EventListenerRegistry<T> = {
  on<E extends keyof StateChangeEvents<T>>(event: E, handler: StateChangeEvents<T>[E]): void;
};
```

### Advanced
**Q: How does `T[keyof T]` work, and what does it produce?**  
*Answer*: It is an Indexed Access Type that looks up all property values of `T` using the full union of its keys. It produces a **union of all value types** present in `T`. For example, if `T` is `{ a: string; b: number; c: boolean }`, `T[keyof T]` evaluates to `string | number | boolean`.

---

## 16. Coding Challenge: Strongly Typed Event Name Extractor

**Task**: Implement a template literal utility that parses a route path string (like `"/users/:userId/posts/:postId"`) and extracts the route parameters into a typed object shape (`{ userId: string; postId: string }`).

```typescript
export type ExtractRouteParams<T extends string> = 
  T extends `${string}:${infer Param}/${infer Rest}`
    ? { [K in Param | keyof ExtractRouteParams<Rest>]: string }
    : T extends `${string}:${infer Param}`
    ? { [K in Param]: string }
    : Record<string, never>;

// Verification:
type Params = ExtractRouteParams<'/organizations/:orgId/projects/:projectId/teams/:teamId'>;
// Inferred strictly as: { orgId: string; projectId: string; teamId: string; }

function navigateTo<Path extends string>(path: Path, params: ExtractRouteParams<Path>) {
  console.log('Navigating to', path, 'with params', params);
}

// ✅ Compiles:
navigateTo('/organizations/:orgId/projects/:projectId', {
  orgId: 'org_1',
  projectId: 'proj_99',
});
```

---

## 17. Common Interview Traps

1. **"`keyof` on an empty object `{}` returns `never`."**  
   *Trap*: Saying it returns `object`.  
   *Reality*: Since `{}` has no keys, `keyof {}` evaluates to `never`.
2. **"Template literal types only work with strings."**  
   *Trap*: Thinking numbers and booleans cannot be used.  
   *Reality*: TypeScript automatically coerces numbers and booleans inside template literals (`${number}` matches any numerical string like `"42"`).

---

## 18. Revision Summary

- **`keyof T`**: Union of property names.
- **`T[K]`**: Lookup value type by key.
- **`T[number]`**: Extract element type of an array.
- **`[P in K]`**: Mapped type iterator; use `+?`, `-?`, `+readonly`, `-readonly` modifiers.
- **`as NewKey`**: Remap keys; returning `never` filters the key out.
- **`${string}`**: Template literal types for dynamic string patterns.

---

## 19. Quick Reference

```typescript
// 1. Value Union
type Values<T> = T[keyof T];

// 2. Filter Properties by Type
type OnlyBooleans<T> = {
  [K in keyof T as T[K] extends boolean ? K : never]: T[K];
};

// 3. Template Literal Remapping
type Getters<T> = {
  [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};
```
