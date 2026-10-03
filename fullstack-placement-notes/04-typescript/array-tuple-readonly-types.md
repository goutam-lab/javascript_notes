# Arrays, Tuples, Readonly Collections & Variadic Types

## 1. What is it?
In TypeScript, **Arrays** represent dynamic-length, homogeneous collections of items where every element conforms to a specified type (`T[]` or `Array<T>`).

**Tuples** represent fixed-length, heterogeneous collections where the exact type of each individual position (index 0, index 1, index 2) is explicitly defined and guaranteed by the compiler (`[string, number]`).

TypeScript also provides **Readonly Arrays and Tuples** (`readonly T[]`, `ReadonlyArray<T>`), which strip away mutative methods (`push`, `pop`, `splice`), enforcing immutability at compile time.

---

## 2. Why does it exist?
In vanilla JavaScript:
- Arrays are dynamically sized and can contain arbitrary mixed types: `const arr = ["user", 100, true]`.
- If an array always holds a key-value pair or coordinates (e.g. `[latitude, longitude]`), JavaScript has no mechanism to prevent a developer from pushing a third item or swapping the order to `[longitude, latitude]`.
- **The React `useState` Analogy**: `useState` returns a 2-element array: `[state, setState]`. Without tuples, TypeScript would infer the return type as `(T | Dispatch<SetStateAction<T>>)[]`. Calling `count + 1` on index 0 would throw a compiler error because TypeScript wouldn't know whether index 0 is the number or the updater function!
- **The Tuple Solution**: `[T, Dispatch<SetStateAction<T>>]` guarantees that index 0 is strictly `T` and index 1 is strictly the dispatch function.

---

## 3. Mental Model: A Train Cargo Container vs. an Egg Carton
💡 **Think of an Array as a Train Cargo Car and a Tuple as a Custom Egg Carton:**

```
                  TYPED ARRAY: number[] (Train Cargo)
┌─────────────────────────────────────────────────────────────┐
│  [ 10, 20, 30, 40, ... ]                                    │
│  - Length: Dynamic (can grow or shrink infinitely)          │
│  - Contents: Every item must be a number                    │
└─────────────────────────────────────────────────────────────┘

                  TUPLE: [string, number, boolean] (Custom Egg Carton)
┌─────────────────────────────────────────────────────────────┐
│  Slot 0: "Alice" (Must be string)                           │
│  Slot 1: 25      (Must be number)                           │
│  Slot 2: true    (Must be boolean)                          │
│  - Length: Strictly 3 slots                                 │
│  - Types: Pre-ordained per specific index                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. Basic Syntax & Named Tuple Elements

```typescript
// 1. Arrays
const numbers: number[] = [1, 2, 3];
const names: Array<string> = ['Alice', 'Bob'];

// Union array (can hold strings OR numbers in any order)
const mixed: (string | number)[] = ['Alice', 10, 'Bob', 20];

// 2. Tuples
type GeoCoordinate = [latitude: number, longitude: number]; // Named elements for IDE readability!

const officeLocation: GeoCoordinate = [37.7749, -122.4194];
console.log(officeLocation[0]); // Inferred as 'number'

// ❌ COMPILE ERRORS:
// const badLocation: GeoCoordinate = [37.7749]; // Error: Source has 1 elements, but target requires 2!
// const wrongOrder: GeoCoordinate = ["San Francisco", -122.4194]; // Error: Type 'string' is not assignable to 'number'!
```

---

## 5. The `as const` Tuple Idiom (How `useState` is Typed)

When you return an array from a custom function, TypeScript automatically widens it to a union array `(A | B)[]`. To preserve tuple identity without writing verbose types, use `as const`:

```typescript
// ❌ WITHOUT 'as const' (Inferred as: (string | number)[])
function createCoordinatesNaive() {
  return [10, 20]; // Inferred as number[]
}

function createTupleNaive() {
  return ['Alice', 100]; // Inferred as (string | number)[]
}
const [val1, val2] = createTupleNaive();
// val1 is: string | number
// val2 is: string | number (LOST TYPE PRECISION!)

// ✅ WITH 'as const' (Inferred as: readonly ['Alice', 100])
function createTupleStrict() {
  return ['Alice', 100] as const;
}
const [name, score] = createTupleStrict();
// name is strictly: 'Alice'
// score is strictly: 100

// ✅ Custom Hook Return Pattern:
export function useToggle(initial: boolean = false) {
  const [state, setState] = useState(initial);
  const toggle = () => setState(prev => !prev);

  // Returning 'as const' preserves the exact [boolean, () => void] tuple structure!
  return [state, toggle] as const;
}
```

---

## 6. Readonly Arrays & Tuples: Compile-Time Immutability

Mutating arrays in functional programming causes side-effects and bugs. TypeScript provides `readonly` modifiers to enforce immutability:

```typescript
// 1. Readonly Array
const immutableList: readonly number[] = [1, 2, 3];
// const immutableList2: ReadonlyArray<number> = [1, 2, 3]; // Identical syntax

// ❌ COMPILE ERRORS on mutative methods:
// immutableList.push(4);    // Property 'push' does not exist on type 'readonly number[]'.
// immutableList.pop();     // Property 'pop' does not exist on type 'readonly number[]'.
// immutableList[0] = 99;   // Index signature in type 'readonly number[]' only permits reading.

// ✅ Non-mutative methods are 100% permitted:
const doubled = immutableList.map(x => x * 2);
const filtered = immutableList.filter(x => x > 1);

// 2. Readonly Tuple
type ReadonlyPoint = readonly [x: number, y: number];
const pt: ReadonlyPoint = [10, 20];
// pt[0] = 50; // ❌ Compile Error!
```

---

## 7. Variadic Tuples & Rest Elements

TypeScript 4.0+ introduced **Variadic Tuples**, allowing tuple types to have dynamic lengths with rest elements (`...T[]`) placed anywhere:

```typescript
// 1. Rest at the end: Minimum 1 string, followed by any number of numbers
type StringThenNumbers = [string, ...number[]];
const v1: StringThenNumbers = ['Score', 10, 20, 30]; // ✅ Valid

// 2. Rest in the middle: First item must be boolean, last must be string
type Sandwich = [boolean, ...number[], string];
const v2: Sandwich = [true, 1, 2, 3, 'done']; // ✅ Valid

// 3. Spreading multiple tuple types together:
type Prefix = [boolean, number];
type Suffix = [string, string];
type Combined = [...Prefix, ...Suffix]; // [boolean, number, string, string]
```

---

## 8. Common Mistakes

### Mistake 1: Calling mutative array methods on non-readonly tuples
```typescript
type Pair = [string, number];
const pair: Pair = ['test', 1];

// ⚠️ HISTORICAL TS QUIRK:
// TypeScript allows .push() on non-readonly tuples without compile error!
pair.push(100); // Legal in non-readonly tuples, but corrupts length!
console.log(pair.length); // 3 (even though type says length is 2!)

// ✅ DEFENSE: Always mark tuples as 'readonly' if length must be invariant!
type StrictPair = readonly [string, number];
const safePair: StrictPair = ['test', 1];
// safePair.push(100); // 💥 Caught at compile time!
```

---

## 9. Best Practices

1. **Use Named Tuple Elements**: Always label tuple fields (`[id: string, age: number]`) instead of anonymous `[string, number]` to provide clear autocomplete tooltips in consuming code.
2. **Return `as const` from Custom Hooks**: Always append `as const` to arrays returned from custom React hooks that mimic `useState`.
3. **Favor `readonly` for Redux/State Arrays**: Prevent teammates from writing `state.todos.push(newTodo)` by typing state arrays as `readonly Todo[]`.

---

## 10. Performance Considerations

- **Zero Runtime Memory Cost**: Tuples and readonly arrays compile down to standard JavaScript arrays (`[]`). The `readonly` modifier and length guarantees exist purely in the compiler symbol table.

---

## 11. Security Considerations

- Reading past the declared length of an array: In TypeScript, `arr[10]` on a `number[]` has type `number`, but at runtime in JavaScript, it returns `undefined`!
- **Compiler Defense**: Enable `"noUncheckedIndexedAccess": true` in `tsconfig.json`. This forces TypeScript to type `arr[i]` as `number | undefined`, preventing critical out-of-bounds runtime crashes.

---

## 12. Alternatives

| Data Structure | Use Case | Mutability |
| :--- | :--- | :--- |
| **`T[]`** | Arbitrary length collections | Mutable |
| **`readonly T[]`** | Functional collections (React state) | Immutable |
| **`[A, B]`** | Fixed pairs / coordinates | Mutable (allows push quirk) |
| **`readonly [A, B]`** | Sealed pairs / hook returns | Strictly Immutable |
| **Object (`{ x, y }`)** | When keys need descriptive names | Configurable |

---

## 13. Trade-offs

- **Tuples vs Objects**: Tuples are more concise and allow consumers to rename variables during destructuring (`const [count, setCount] = useState()`), whereas objects require fixed property names (`const { data, refetch } = useQuery()`). For collections of 3+ items, prefer objects for clarity.

---

## 14. Real-World Usage

- **React Core**: The `useState`, `useReducer`, and `useTransition` hooks return tuples.
- **SQL / Database Rows**: Representing raw tabular rows where column index maps to schema fields (`[id, email, password_hash]`).
- **Promise Utilities**: `Promise.all([p1, p2])` infers its return type as a tuple `Promise<[Result1, Result2]>`.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the difference between an Array and a Tuple in TypeScript?**  
*Answer*: An Array (`T[]`) represents an arbitrary-length collection of elements sharing the same type. A Tuple (`[A, B]`) represents a fixed-length collection where the exact type of each individual position (index) is explicitly specified by the type system.

### Conceptual
**Q: Why does TypeScript infer `[10, 'hello']` as `(string | number)[]` instead of a tuple `[number, string]` by default?**  
*Answer*: TypeScript applies **Type Widening**. In JavaScript, arrays are overwhelmingly created with dynamic lengths where items can be pushed or popped at runtime. To avoid breaking common JavaScript array patterns, TypeScript conservatively infers array literals as union arrays. To tell TypeScript you intended a strict tuple, you must explicitly type it or append `as const`.

### Implementation
**Q: How do you enforce that a tuple must have at least one element (a Non-Empty Array type)?**  
*Answer*: Use variadic tuple notation:
```typescript
type NonEmptyArray<T> = [T, ...T[]];

const valid: NonEmptyArray<number> = [1, 2, 3]; // ✅ Valid
// const invalid: NonEmptyArray<number> = [];   // ❌ Compile Error! Source has 0 elements!
```

### Debugging
**Q: Why does `const point: [number, number] = [10, 20]; point.push(30);` compile without any error in TypeScript?**  
*Answer*: In standard TypeScript, non-readonly tuples are treated as subtypes of `Array`. While TypeScript verifies length on initial assignment and index access, it historically allowed array mutation methods (`push`, `pop`) for compatibility with JavaScript array methods. To prevent this mutation, type the tuple as `readonly [number, number]`.

### Scenario
**Q: You are writing a custom React hook that returns an error object, a user profile, and a boolean. What is the cleanest way to return these from the hook so the consumer can easily destructure and rename them?**  
*Answer*: Return a named readonly tuple using `as const`:
```typescript
export function useUserData(id: string) {
  // ...
  return [user, isLoading, error] as const;
}
// Consumer can destructure and rename freely:
const [currentUser, isUserPending, userError] = useUserData('123');
```

### Advanced
**Q: Explain how the `tsconfig.json` option `noUncheckedIndexedAccess` impacts array element access.**  
*Answer*: By default, indexing an array `const x = arr[0]` on `number[]` produces the type `number`. However, if the array is empty at runtime, `x` is actually `undefined`, causing unexpected runtime crashes when calling methods like `x.toFixed()`. Enabling `noUncheckedIndexedAccess` forces TypeScript to infer the type of any array index lookup as `T | undefined`, forcing the developer to perform a null check before using the value.

---

## 16. Coding Challenge: Typed Zip Function

**Task**: Implement a generic `zip` function that takes two tuples of equal length and combines their elements pairwise into a tuple of pairs with exact type inference.

```typescript
export function zip<T extends readonly unknown[], U extends readonly unknown[]>(
  arr1: T,
  arr2: U
): Array<[T[number], U[number]]> {
  const minLen = Math.min(arr1.length, arr2.length);
  const result: Array<[T[number], U[number]]> = [];

  for (let i = 0; i < minLen; i++) {
    result.push([arr1[i], arr2[i]]);
  }

  return result;
}

// Verification:
const names = ['Alice', 'Bob'] as const;
const ages = [25, 30] as const;

const paired = zip(names, ages);
// Type inferred as: Array<['Alice' | 'Bob', 25 | 30]>
```

---

## 17. Common Interview Traps

1. **"Tuples are an official JavaScript ES6 feature."**  
   *Trap*: Confusing TS with JS runtime.  
   *Reality*: JavaScript has no concept of tuples. At runtime, a tuple is a standard JavaScript `Array`.
2. **"`readonly` arrays are frozen at runtime."**  
   *Trap*: Assuming `readonly` calls `Object.freeze()`.  
   *Reality*: `readonly` is stripped during compilation. It provides zero runtime protection against mutation unless `Object.freeze()` is explicitly called.

---

## 18. Revision Summary

- **Arrays (`T[]`)**: Variable length, homogeneous types.
- **Tuples (`[A, B]`)**: Fixed length, heterogeneous types mapped to exact indices.
- Append **`as const`** to prevent array widening when returning tuples from functions.
- Mark tuples as **`readonly [A, B]`** to block mutative methods like `push` and `splice`.
- Use **`[T, ...T[]]`** to define Non-Empty Arrays.

---

## 19. Quick Reference

```typescript
// 1. Array
let items: string[] = ['a', 'b'];

// 2. Tuple
let entry: [key: string, value: number] = ['count', 10];

// 3. Readonly Tuple (Const assertion)
let pair = ['theme', 'dark'] as const;

// 4. Non-empty array
type NonEmpty<T> = [T, ...T[]];
```
