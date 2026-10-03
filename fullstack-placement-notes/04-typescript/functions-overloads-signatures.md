# Function Typing, Overloads, Signatures & Return Semantics

## 1. What is it?
In TypeScript, **Function Typing** defines the parameter contracts, optional arguments, rest arguments, `this` contexts, and return value types of JavaScript functions.

Functions can be typed using inline signatures, type aliases, or callable interface signatures. Furthermore, for polymorphic functions that return different types depending on input arguments, TypeScript provides **Function Overloading**: defining multiple public **Overload Signatures** backed by a single **Implementation Signature**.

TypeScript also makes precise distinctions between three often-confused return types: **`void`**, **`undefined`**, and **`never`**.

---

## 2. Why does it exist?
In vanilla JavaScript:
- A function might accept either a `Date` object, a timestamp `number`, or an ISO `string`, and return formatted text:
  ```javascript
  function formatDate(val) { ... }
  ```
- Or a DOM selector function like `document.querySelector` returns an `HTMLCanvasElement` when passed `'canvas'`, but an `HTMLInputElement` when passed `'input'`.
- Without function overloads, developers would have to annotate return types with messy union types (`Element | null`) and perform manual type casting (`as HTMLCanvasElement`) at every call site.
- **The Function Overload Solution**: The compiler knows the exact return type based on the specific argument passed, giving developers full autocomplete and safety.

---

## 3. Mental Model: The Restaurant Menu vs. The Kitchen Stove
💡 **Think of Function Overloads as a Multi-Option Customer Menu:**

```
                  CUSTOMER MENU (Overload Signatures)
┌─────────────────────────────────────────────────────────────┐
│  Option 1: Order "Burger"  ──> You receive a [ FoodPlate ]  │
│  Option 2: Order "Coffee"  ──> You receive a [ BeverageCup ]│
│  (These are the ONLY valid orders the customer can make!)   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
                  KITCHEN STOVE (Implementation Signature)
┌─────────────────────────────────────────────────────────────┐
│  function cook(order: string): FoodPlate | BeverageCup {   │
│    // Internal chef logic handling both cases.              │
│    // The customer never interacts with this signature!    │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
```

- **Overload Signatures**: The public API contract visible to callers.
- **Implementation Signature**: The internal logic that satisfies all overloads; it is invisible from the outside and cannot be called directly.

---

## 4. `void` vs. `undefined` vs. `never`

Understanding these three return types is a standard interview question:

```
┌─────────────┬──────────────────────────────────────────┬──────────────────────────────────────────┐
│ Type        │ Meaning                                  │ Example                                  │
├─────────────┼──────────────────────────────────────────┼──────────────────────────────────────────┤
│ `void`      │ Function returns nothing of interest.   │ `function log(msg: string): void`        │
│             │ Can return undefined or nothing.         │ Callback return values are ignored.      │
├─────────────┼──────────────────────────────────────────┼──────────────────────────────────────────┤
│ `undefined` │ Function EXPLICITLY returns `undefined`. │ `function get(): undefined { return; }`  │
│             │ Must have a real `return` statement.     │ Calling code can check for `undefined`.  │
├─────────────┼──────────────────────────────────────────┼──────────────────────────────────────────┤
│ `never`     │ Function NEVER completes or returns.     │ `function panic(): never { throw err; }` │
│             │ Throws an error or loops infinitely.     │ Terminating execution path.              │
└─────────────┴──────────────────────────────────────────┴──────────────────────────────────────────┘
```

### The `void` Callback Permissiveness Trap:
```typescript
// Why does this compile in TypeScript?
type Callback = () => void;

const doSomething: Callback = () => {
  return 42; // Returns a number, but type says 'void'?!
};
```
**Why TypeScript allows this**:
In JavaScript, methods like `Array.prototype.push()` return a number (the new array length). If `void` strictly forbade returning a value, you couldn't write `list.forEach(item => output.push(item))`, because `push` returns a number while `forEach` expects a callback returning `void`. 

TypeScript's `void` means: *"The caller will not examine or use the return value."*

---

## 5. Function Overloading in Action

```typescript
// 1. OVERLOAD SIGNATURES (Public contract)
function getTimestamp(date: Date): number;
function getTimestamp(isoString: string): number;
function getTimestamp(year: number, month: number, day: number): number;

// 2. IMPLEMENTATION SIGNATURE (Internal logic)
function getTimestamp(
  dateOrIsoOrYear: Date | string | number,
  month?: number,
  day?: number
): number {
  if (dateOrIsoOrYear instanceof Date) {
    return dateOrIsoOrYear.getTime();
  }
  if (typeof dateOrIsoOrYear === 'string') {
    return new Date(dateOrIsoOrYear).getTime();
  }
  if (typeof dateOrIsoOrYear === 'number' && month !== undefined && day !== undefined) {
    return new Date(dateOrIsoOrYear, month - 1, day).getTime();
  }
  throw new Error('Invalid arguments provided to getTimestamp');
}

// Caller Usage:
const t1 = getTimestamp(new Date());        // ✅ Overload 1
const t2 = getTimestamp('2026-10-03');       // ✅ Overload 2
const t3 = getTimestamp(2026, 10, 3);        // ✅ Overload 3

// ❌ COMPILE ERROR (Caller cannot call the implementation signature directly!):
// getTimestamp(2026); // Error: No overload expects 1 argument of type 'number'!
```

---

## 6. Typing Functions with Interfaces & Construct Signatures

In JavaScript, functions are first-class objects that can have properties attached to them:

```typescript
// 1. Callable Interface with attached properties
interface CounterFunction {
  (): number;             // Call signature
  count: number;          // Attached property
  reset: () => void;      // Attached method
}

function createCounter(): CounterFunction {
  const fn = (() => ++fn.count) as CounterFunction;
  fn.count = 0;
  fn.reset = () => { fn.count = 0; };
  return fn;
}

const counter = createCounter();
console.log(counter()); // 1
console.log(counter()); // 2
counter.reset();
console.log(counter.count); // 0

// 2. Construct Signatures (Constructor functions)
interface UserConstructor {
  new (name: string): { name: string; greet: () => void };
}

function instantiate(ctor: UserConstructor) {
  return new ctor('Alice');
}
```

---

## 7. Contextual Typing

TypeScript can automatically infer parameter types based on where a function is passed (**Contextual Typing**):

```typescript
const names = ['Alice', 'Bob', 'Charlie'];

// You DO NOT need to write: (name: string) => name.toUpperCase()
// TypeScript inspects 'names' (string[]) and contextually types 'name' as 'string'!
const upper = names.map(name => name.toUpperCase());

// In DOM Event Handlers:
window.addEventListener('keydown', (event) => {
  // 'event' is automatically inferred as KeyboardEvent!
  console.log(event.key);
});
```

---

## 8. Common Mistakes

### Mistake 1: Declaring implementation signature wider than overloads can handle
```typescript
// ❌ BROKEN OVERLOAD:
function process(x: string): string;
function process(x: number): number;
function process(x: string | number | boolean): any { // Boolean was added here!
  return x;
}

// The caller CANNOT pass a boolean, because boolean is not in the overload list!
// process(true); // 💥 Error: No overload matches this call!
```

---

## 9. Best Practices

1. **Always Provide Explicit Return Types for Public APIs**:
   ```typescript
   // ✅ GOOD: Protects against accidental return type changes
   export function calculateTotal(items: CartItem[]): number {
     return items.reduce((sum, item) => sum + item.price, 0);
   }
   ```
2. **Favor Generics over Overloads when relationships are simple**:
   ```typescript
   // ❌ Overly verbose overloads:
   function getFirst(arr: number[]): number;
   function getFirst(arr: string[]): string;
   function getFirst(arr: any[]): any { return arr[0]; }

   // ✅ Clean, scalable generic:
   function getFirst<T>(arr: T[]): T | undefined {
     return arr[0];
   }
   ```
3. **Always place the most specific overloads at the top**: TypeScript checks overloads from top to bottom and uses the first match.

---

## 10. Performance Considerations

- **Compiler Signature Matching**: Excessive overloaded signatures (10+ overloads on a single function) cause the compiler to evaluate permutations, increasing type-checking time. Keep overload lists concise.

---

## 11. Security Considerations

- **Typing Untrusted Callbacks**: When accepting user-defined callbacks in library code, ensure arguments passed to the callback cannot be mutated to corrupt internal state:
  ```typescript
  type SafeListener = (readonlyEvent: Readonly<TelemetryEvent>) => void;
  ```

---

## 12. Alternatives: Generics vs. Overloads

| Feature | Function Overloads | Generics (`<T>`) |
| :--- | :--- | :--- |
| **Use Case** | Distinctly different argument count or unrelated types | Same logical shape across different types |
| **Readability** | High for discrete branching | High for algorithmic data manipulation |
| **Output Type** | Exact per overload signature | Dependent on type parameter `T` |

---

## 13. Trade-offs

- **Overloads Benefit**: Clean IDE autocomplete for callers; models complex JavaScript legacy functions perfectly.
- **Overloads Cost**: Requires writing boilerplate implementation signatures; type safety inside the implementation body is weakened (often relies on `any` or broad unions).

---

## 14. Real-World Usage

- **DOM APIs**: `document.createElement('canvas')` returns `HTMLCanvasElement`, while `document.createElement('div')` returns `HTMLDivElement` via TypeScript lib overloads.
- **Testing Libraries (Jest / Vitest)**: `expect(fn).toThrow()` has different overloads depending on whether an error constructor, string, or regex is passed.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the difference between `void` and `never` in TypeScript?**  
*Answer*: `void` represents a function that completes normally but returns no meaningful value (it returns `undefined` at runtime). `never` represents a function that **never returns at all**—either because it unconditionally throws an exception or enters an infinite loop, never reaching its closing brace.

### Conceptual
**Q: Why does the implementation signature of an overloaded function not count as one of the callable overloads?**  
*Answer*: Overload signatures define the public API contract for external callers. The implementation signature exists solely to provide a single concrete body where the author can reconcile and process the disparate overload arguments. TypeScript deliberately hides the implementation signature from the public call site to prevent callers from invoking the function with an invalid combination of arguments that only satisfies the implementation union.

### Implementation
**Q: Write an overloaded function `makeDate` that can be called with either 1 timestamp number or 3 numbers (year, month, day).**  
*Answer*:
```typescript
function makeDate(timestamp: number): Date;
function makeDate(year: number, month: number, day: number): Date;
function makeDate(yearOrTimestamp: number, month?: number, day?: number): Date {
  if (month !== undefined && day !== undefined) {
    return new Date(yearOrTimestamp, month, day);
  }
  return new Date(yearOrTimestamp);
}
```

### Debugging
**Q: Why does TypeScript allow a function typed as `() => void` to return a number?**  
*Answer*: This is known as **Void Callback Permissiveness**. It was designed to support common JavaScript idioms where array methods like `Array.prototype.push()` return a value (the new array length). If `() => void` prohibited returning any value, writing `array.forEach(item => bucket.push(item))` would fail type checking. `void` in a callback type simply means the caller will ignore the returned value.

### Scenario
**Q: You are designing an API client method `request(url: string, parseJson?: boolean)`. If `parseJson` is true, it should return `Promise<object>`. If false, it should return `Promise<string>`. How do you type this?**  
*Answer*:
```typescript
function request(url: string, parseJson: true): Promise<object>;
function request(url: string, parseJson: false): Promise<string>;
function request(url: string): Promise<object>; // Default overload
function request(url: string, parseJson: boolean = true): Promise<object | string> {
  // Implementation
  return fetch(url).then(res => parseJson ? res.json() : res.text());
}
```

### Advanced
**Q: What is the `this` parameter in TypeScript function declarations?**  
*Answer*: TypeScript allows you to declare an explicit `this` parameter as the **first parameter** in a function signature: `function handleClick(this: HTMLButtonElement, event: Event)`. It is purely a compile-time construct that informs the type checker what object `this` will refer to when the function is invoked. During compilation, the `this` parameter undergoes complete type erasure and does not appear in the emitted JavaScript parameter list.

---

## 16. Coding Challenge: Strongly Typed Event Dispatcher

**Task**: Implement an event emitter with overloaded `on` and `emit` methods that enforce strictly matching event payload types.

```typescript
interface EventMap {
  'user:login': { userId: string; timestamp: number };
  'user:logout': { userId: string };
  'cart:update': { itemCount: number; total: number };
}

export class TypedEventEmitter {
  private listeners: { [K in keyof EventMap]?: Array<(payload: EventMap[K]) => void> } = {};

  public on<K extends keyof EventMap>(event: K, listener: (payload: EventMap[K]) => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]!.push(listener);
  }

  public emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    const handlers = this.listeners[event];
    if (handlers) {
      handlers.forEach((fn) => fn(payload));
    }
  }
}

// Verification:
const emitter = new TypedEventEmitter();

emitter.on('user:login', (data) => {
  console.log(`User logged in: ${data.userId} at ${data.timestamp}`);
});

// ✅ Compiles perfectly:
emitter.emit('user:login', { userId: 'u_101', timestamp: Date.now() });

// ❌ COMPILE ERROR: Property 'total' is missing in type '{ itemCount: number; }'
// emitter.emit('cart:update', { itemCount: 2 });
```

---

## 17. Common Interview Traps

1. **"The implementation signature can be called if arguments match."**  
   *Trap*: Thinking you can call the implementation signature.  
   *Reality*: Overload signatures shadow and hide the implementation signature completely.
2. **"Arrow functions support the `function` overload syntax."**  
   *Trap*: Trying to overload an arrow function directly.  
   *Reality*: Arrow functions cannot use standard overload syntax; you must type the arrow variable using a callable interface or type alias.

---

## 18. Revision Summary

- **`void`**: Returns no useful value; return values in callbacks are ignored.
- **`undefined`**: Function explicitly returns the value `undefined`.
- **`never`**: Function never returns (throws error or loops forever).
- **Overloads**: Multiple public signatures + 1 implementation signature.
- **Contextual Typing**: Infers parameter types automatically from execution context.

---

## 19. Quick Reference

```typescript
// 1. Overload Pattern
function fn(x: string): string;
function fn(x: number): number;
function fn(x: any): any { return x; }

// 2. Explicit This
function handler(this: HTMLButtonElement, e: MouseEvent) {
  this.disabled = true;
}

// 3. Callable Interface
interface Formatter {
  (input: string): string;
  defaultLocale: string;
}
```
