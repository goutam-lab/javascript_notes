# Primitives, Literal Types & Discriminated Unions

## 1. What is it?
In TypeScript, **Primitives** represent the foundational, immutable atomic values of JavaScript (`string`, `number`, `boolean`, `symbol`, `bigint`, `null`, `undefined`).

Building upon primitives, TypeScript introduces **Literal Types**, which represent an exact, specific value rather than an infinite set of values (e.g. `'success'` instead of any `string`, or `404` instead of any `number`).

When you combine multiple literal types using the union operator (`|`), you create **Union Types**. When union types share a common, single-literal property (a discriminator tag), they form **Discriminated Unions** (also known as *Tagged Unions* or *Algebraic Data Types*)—the single most powerful architectural pattern in TypeScript for modeling state machines, API responses, and event systems.

---

## 2. Why does it exist?
In vanilla JavaScript:
- Modeling a network request state often leads to inconsistent, invalid states:
  ```javascript
  // ❌ IMPOSSIBLE STATE PROBLEM:
  const state = {
    isLoading: true,
    isSuccess: true, // Wait, is it loading or is it a success?!
    error: new Error("Network failed"), // Why is there an error if it succeeded?!
    data: null
  };
  ```
- With boolean flags, $N$ booleans produce $2^N$ possible states, most of which are nonsensical and cause runtime bugs.
- **The Discriminated Union Solution**: Make invalid states unrepresentable. A state can *only* be `'loading'`, `'success'`, or `'error'`. Each state only carries the data relevant to that exact phase.

---

## 3. Mental Model: Set Theory & The Discriminating Tag
💡 **Think of Types as Mathematical Sets:**

```
      INFINITE SET: string                 FINITE SUBSET: 'pending' | 'active'
┌───────────────────────────────────┐    ┌───────────────────────────────────┐
│ "apple", "banana", "hello", ...   │    │      'pending'    'active'        │
│ Any sequence of characters        │    │ (Only these two exact strings!)   │
└───────────────────────────────────┘    └───────────────────────────────────┘

                    DISCRIMINATED UNION ARCHITECTURE
                                    │
    ┌───────────────────────────────┼───────────────────────────────┐
    ▼                               ▼                               ▼
State: { status: 'idle' }    State: { status: 'loading' }   State: { status: 'success', data: [...] }
(No data, no error)          (No data, no error)            (Guaranteed to have data!)
```

- A `string` is an infinite set of all possible characters.
- A Literal `'admin'` is a singleton set containing exactly one string.
- A Union `'user' | 'admin'` is the union of two discrete elements.
- The **Discriminator Tag** (e.g., `status: 'success'`) acts like an airport gate boarding pass: once the compiler checks the tag in a `switch` statement, it automatically unlocks access to the payload fields for that specific variant.

---

## 4. Basic Example: Type Widening & `as const`

```typescript
// 1. Type Widening with 'let' vs 'const'
const constantString = 'hello'; // Type is the literal: 'hello'
let variableString = 'hello';   // Type is widened to: string

// 2. Object property widening trap
const request = {
  method: 'GET', // Type is inferred as 'string', NOT 'GET'!
};

function sendRequest(url: string, method: 'GET' | 'POST') {
  // ...
}

// ❌ COMPILE ERROR: Argument of type 'string' is not assignable to parameter of type ''GET' | 'POST''.
// sendRequest('/api', request.method);

// ✅ FIX: Use 'as const' (Const Assertion)
const safeRequest = {
  method: 'GET' as const, // Type is strictly 'GET'
};
sendRequest('/api', safeRequest.method); // ✅ Compiles!

// Or freeze the entire object deeply:
const config = {
  endpoint: '/api/v1',
  method: 'POST',
} as const; // All fields become 'readonly' and literal!
```

---

## 5. Real Example: Production Discriminated Union for Network State

```typescript
// 1. Define explicit variants with a shared discriminator 'status'
export type AsyncData<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T; timestamp: number }
  | { status: 'error'; error: Error; retryCount: number };

// 2. Consumer function utilizing exhaustive type narrowing
export function renderUI<T>(state: AsyncData<T>): string {
  switch (state.status) {
    case 'idle':
      return 'Please click submit to begin.';

    case 'loading':
      return '⏳ Loading your data...';

    case 'success':
      // TypeScript GUARANTEES state.data exists here!
      return `Loaded successfully at ${state.timestamp}: ${JSON.stringify(state.data)}`;

    case 'error':
      // TypeScript GUARANTEES state.error exists here!
      return `❌ Error: ${state.error.message} (Retries: ${state.retryCount})`;

    default: {
      // 3. Exhaustiveness Checking with 'never'
      const _exhaustiveCheck: never = state;
      throw new Error(`Unhandled union case: ${_exhaustiveCheck}`);
    }
  }
}
```

---

## 6. Under the Hood: Exhaustiveness Checking with `never`

What is `never`?
- In TypeScript's type hierarchy, `never` is the **Bottom Type** (the empty set $\emptyset$). No value can ever have the type `never` (except a function that never returns, e.g. throws an infinite loop or exception).
- How Exhaustiveness Checking works:
  1. In the `switch(state.status)` above, TypeScript narrows `state` in each `case`.
  2. In `case 'idle'`, `state` is `{ status: 'idle' }`.
  3. By the time execution reaches the `default:` branch, all possible union variants have been handled.
  4. Therefore, the remaining type of `state` in `default:` is **`never`**.
  5. If an engineer later adds a new variant to `AsyncData` (e.g. `| { status: 'canceled' }`) but forgets to update `renderUI`, `state` in `default:` will have type `{ status: 'canceled' }`.
  6. Assigning `{ status: 'canceled' }` to `const _exhaustiveCheck: never` causes an **immediate compilation error**!
  7. **Result**: You can never forget to handle a state variant in production.

---

## 7. Important Rules

1. **Discriminator Must Be a Literal Type**: The discriminating property (`status`, `kind`, `type`) must be typed as string literals, number literals, or boolean literals, not generic `string` or `number`.
2. **`as const` Makes Objects Immutable**: Adding `as const` to an object literal marks every property as `readonly` and infers the narrowest literal type possible for primitives.
3. **Union Distribution**: When a union type is passed to a conditional type, it distributes across the union (`(A | B) extends T ? X : Y` becomes `(A extends T ? X : Y) | (B extends T ? X : Y)`).

---

## 8. Common Mistakes

### Mistake 1: Optional properties instead of discriminated unions
```tsx
// ❌ ANTI-PATTERN: Everything is optional, leading to runtime null checks everywhere
interface UserAction {
  type: string;
  payload?: string;
  error?: Error;
  status?: number;
}

// ✅ CORRECT: Model distinct variants cleanly
type UserAction =
  | { type: 'ADD_TODO'; text: string }
  | { type: 'DELETE_TODO'; id: number }
  | { type: 'SET_ERROR'; error: Error };
```

---

## 9. Best Practices

1. **Always Use a Standard Discriminator Name**: Standardize on `status`, `type`, or `kind` across your entire architecture.
2. **Implement the Exhaustive Check Pattern**: Always add a `default: const _exhaustiveCheck: never = x;` block to switch statements processing union types.
3. **Use Union of Literals Instead of Enums**:
   ```typescript
   // ❌ Traditional TypeScript numeric enum (emits runtime JS code and has reverse mapping bugs):
   enum Status { Active, Inactive }

   // ✅ Modern TypeScript union of string literals (zero runtime JS output, fully type-safe):
   type Status = 'ACTIVE' | 'INACTIVE';
   ```

---

## 10. Performance Considerations

- **Compiler Cache Efficiency**: Discriminated unions evaluate extremely fast in TypeScript's type checker because checking a single literal property (`status`) in a hash map allows the compiler to prune non-matching branches in $O(1)$ time.

---

## 11. Security Considerations

- When parsing webhook payloads from external payment processors (e.g. Stripe), use discriminated unions on the `event.type` (`'payment_intent.succeeded' | 'charge.refunded'`) to ensure payment fulfillment code only executes when the verified success payload shape is present.

---

## 12. Alternatives: String Unions vs. Enums

| Feature | String Literal Union (`'A' \| 'B'`) | TypeScript `enum` |
| :--- | :--- | :--- |
| **Runtime Output** | **Zero JS** (Fully erased) | Emits an IIFE and object in JavaScript |
| **Tree-shaking** | Perfect | Can cause bundle bloat |
| **Inlined Values** | Yes | Depends on `const enum` flags |
| **Nominal vs Structural** | Structural (accepts raw string `'A'`) | Nominal (requires `Enum.A`) |

---

## 13. Trade-offs

- **Benefit**: Completely eliminates impossible states; compile-time exhaustiveness enforcement; zero runtime bundle footprint.
- **Cost**: Requires writing explicit discriminator properties in all object payloads.

---

## 14. Real-World Usage

- **Redux / useReducer Actions**: Standard pattern for typing actions in Redux Toolkit and React reducers.
- **API Payloads**: Representing polymorphic responses (e.g. `{ success: true, result: T } | { success: false, error: ApiError }`).
- **AST Nodes**: Compilers (like Babel, SWC, ESLint) represent every language syntax node via discriminated unions on `node.type`.

---

## 15. Placement Interview Questions

### Basic
**Q: What is a Literal Type in TypeScript?**  
*Answer*: A Literal Type is a type that represents an exact, specific value rather than an entire broad category of values. For example, `'admin'` is a string literal type that only accepts the string `"admin"`, and `404` is a number literal type that only accepts the number `404`.

### Conceptual
**Q: Explain how Discriminated Unions solve the "Impossible State" bug in frontend applications.**  
*Answer*: In naive state designs, developers use multiple independent boolean flags (e.g. `{ isLoading: boolean, isError: boolean, isSuccess: boolean, data: T | null }`). This allows invalid states where both `isLoading` and `isSuccess` are `true`, leading to UI glitches. A Discriminated Union models each state as a distinct variant with a shared literal tag (`{ status: 'loading' } | { status: 'success', data: T }`). Because an object can only have one `status` at any time, impossible states are mathematically unrepresentable at compile time.

### Implementation
**Q: Implement the `assertNever` helper function for exhaustiveness checking.**  
*Answer*:
```typescript
export function assertNever(value: never): never {
  throw new Error(`Unhandled discriminated union member: ${JSON.stringify(value)}`);
}
```

### Debugging
**Q: Why does the compiler throw an error when assigning `let x = "GET"; sendReq(x)` where `sendReq` expects `'GET' | 'POST'`?**  
*Answer*: Because `x` was declared with `let`, TypeScript applies **Type Widening**: since `x` can be reassigned to any string in the future (`x = "DELETE"`), its type is widened to the broad type `string`. The broad type `string` is not assignable to the narrower literal union `'GET' | 'POST'`. To fix it, use `const x = "GET"`, type annotate `let x: 'GET' = "GET"`, or use `as const`.

### Scenario
**Q: Design a TypeScript type for a Payment Gateway transaction that can be in Credit Card, PayPal, or Crypto format with their respective unique required details.**  
*Answer*:
```typescript
type PaymentMethod =
  | { type: 'CREDIT_CARD'; cardNumber: string; cvv: string; expiry: string }
  | { type: 'PAYPAL'; paypalEmail: string; payerId: string }
  | { type: 'CRYPTO'; walletAddress: string; network: 'ETHEREUM' | 'SOLANA' };
```

### Advanced
**Q: What is the difference between `unknown`, `any`, and `never` in TypeScript?**  
*Answer*:
- `any`: The escape hatch (Top and Bottom type). Silences all type checking; can be assigned to anything and anything can be assigned to it.
- `unknown`: The safe Top type. Everything is assignable to `unknown`, but `unknown` cannot be assigned to any other type or have methods called on it without explicit type narrowing.
- `never`: The Bottom type (the empty set). Represents values that can never occur. Nothing can be assigned to `never` (except `never`), making it ideal for exhaustiveness verification.

---

## 16. Coding Challenge: Exhaustive Command Parser

**Task**: Build a strongly typed command line parser that processes commands using a discriminated union and enforces exhaustiveness checking.

```typescript
type Command =
  | { action: 'NAVIGATE'; url: string; replaceHistory?: boolean }
  | { action: 'NOTIFY'; message: string; priority: 'LOW' | 'HIGH' }
  | { action: 'RESTART'; delayMs: number };

function executeCommand(cmd: Command): void {
  switch (cmd.action) {
    case 'NAVIGATE':
      console.log(`Navigating to ${cmd.url} (replace: ${Boolean(cmd.replaceHistory)})`);
      break;

    case 'NOTIFY':
      console.log(`[${cmd.priority}] Notification: ${cmd.message}`);
      break;

    case 'RESTART':
      console.log(`System restarting in ${cmd.delayMs}ms`);
      break;

    default: {
      const _unreachable: never = cmd;
      throw new Error(`Unrecognized command action: ${_unreachable}`);
    }
  }
}
```

---

## 17. Common Interview Traps

1. **"Can you use `as const` on function arguments directly?"**  
   *Trap*: Calling `fn(val as const)`.  
   *Reality*: While syntactically allowed, `as const` applies to the literal value at creation time, turning its properties into readonly literals.
2. **"TypeScript enums are better than string unions."**  
   *Trap*: Recommending traditional numeric enums.  
   *Reality*: Numeric enums permit unsafe numerical assignments (e.g. `Status.Active = 9999`) and emit runtime JavaScript code. Union of string literals is the modern best practice.

---

## 18. Revision Summary

- Literal types restrict values to an exact value (`'ready'`, `200`).
- `let` widens types; `const` and `as const` preserve narrow literal types.
- Discriminated Unions combine multiple shapes with a single common literal property (`type` / `status`).
- Use the `never` type in `default:` branches to enforce compile-time exhaustiveness checking.

---

## 19. Quick Reference

```typescript
// 1. Const Assertion
const routes = { HOME: '/', LOGIN: '/login' } as const;

// 2. Discriminated Union
type Result<T, E> =
  | { success: true; data: T }
  | { success: false; error: E };

// 3. Exhaustiveness Pattern
function handle(r: Result<string, Error>) {
  if (r.success) {
    console.log(r.data);
  } else {
    console.error(r.error.message);
  }
}
```
