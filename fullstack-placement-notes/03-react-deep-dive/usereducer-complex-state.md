# useReducer: Complex State Machines & Predictable State Transitions

## 1. What is it?
The **`useReducer`** hook is React's advanced state management hook designed for managing complex, multi-property state transitions. Inspired by the Redux / Flux architecture, it separates **what happened** (an **Action**) from **how the state updates** (a pure function called a **Reducer**).

Its signature is:
```typescript
const [state, dispatch] = useReducer(reducer, initialArg, init?);
```
Where:
- **`reducer`**: A pure JavaScript function `(state, action) => newState`.
- **`dispatch`**: A permanent, stable function used to emit action events.

---

## 2. Why does it exist?
When a component's state becomes complex:
- Managing 8 independent `useState` hooks causes **State Fragmentation**.
- If updating one state value requires conditionally updating two other state values (e.g. submitting a form requires setting `isLoading: true`, `error: null`, and `attempts: attempts + 1`), scattering this logic across multiple event handlers creates race conditions and impossible-to-test edge cases.
- **The Solution**: `useReducer` consolidates all state transition logic into a **single pure function outside the component**. This makes business logic 100% testable in pure Node.js/Vitest without needing to mount or render a React component!

---

## 3. Mental Model
💡 **Think of it like an Official Bank Teller & Accounting Ledger:**
- **State (`state`)**: The Bank's official ledger book showing your current balance and transaction history.
- **The Customer (`Component`)**: You walk up to the bank window. You are **not allowed to reach across the counter and grab the ledger** (**State is strictly immutable**).
- **The Action Slip (`dispatch({ type: 'DEPOSIT', payload: 100 })`)**: You fill out an official deposit slip stating what you want to do.
- **The Bank Teller (`Reducer Function`)**: The teller receives your slip. Following strict federal banking rules (**Pure Reducer Logic**), the teller checks your account, calculates the new balance, writes it in the ledger, and stamps it approved.

### Architectural Data Flow in useReducer
```
[ User Action: Click "Submit Order" ]
                  │
                  ▼
[ dispatch({ type: 'SUBMIT_START' }) ]  ◄── Stable function (never changes identity)
                  │
                  ▼
┌────────────────────────────────────────────────────────┐
│                    REDUCER FUNCTION                    │
│        (state, action) ──► Returns Brand-New State     │
│  • PURE function! Zero side effects!                   │
│  • Handles transitions: IDLE ──► LOADING ──► SUCCESS   │
└─────────────────────────┬──────────────────────────────┘
                          │
                          ▼
[ React commits new state and re-renders component UI ]
```

---

## 4. Basic Example: Type-Safe State Machine in TypeScript

```tsx
// CounterReducer.tsx
import React, { useReducer } from 'react';

// 1. Define State Shape:
interface CounterState {
  count: number;
  step: number;
}

// 2. Define Discriminated Union Actions:
type CounterAction =
  | { type: 'INCREMENT' }
  | { type: 'DECREMENT' }
  | { type: 'SET_STEP'; payload: number }
  | { type: 'RESET' };

const initialState: CounterState = { count: 0, step: 1 };

// 3. Pure Reducer Function:
function counterReducer(state: CounterState, action: CounterAction): CounterState {
  switch (action.type) {
    case 'INCREMENT':
      return { ...state, count: state.count + state.step };
    case 'DECREMENT':
      return { ...state, count: state.count - state.step };
    case 'SET_STEP':
      return { ...state, step: action.payload };
    case 'RESET':
      return initialState;
    default:
      // Exhaustiveness check: Ensures TypeScript flags missing action cases!
      const _exhaustiveCheck: never = action;
      return state;
  }
}

export function CounterComponent() {
  const [state, dispatch] = useReducer(counterReducer, initialState);

  return (
    <div>
      <h2>Count: {state.count}</h2>
      <button onClick={() => dispatch({ type: 'INCREMENT' })}>+{state.step}</button>
      <button onClick={() => dispatch({ type: 'DECREMENT' })}>-{state.step}</button>
      <button onClick={() => dispatch({ type: 'RESET' })}>Reset</button>

      <label>
        Step:
        <input
          type="number"
          value={state.step}
          onChange={(e) => dispatch({ type: 'SET_STEP', payload: Number(e.target.value) || 1 })}
        />
      </label>
    </div>
  );
}
```

---

## 5. Real Example: Async Data Fetching State Machine
Managing `loading`, `data`, and `error` states cleanly without fragmented `useState` setters:

```tsx
// DataFetcherReducer.tsx
import React, { useReducer, useEffect } from 'react';

interface State<T> {
  status: 'idle' | 'loading' | 'success' | 'error';
  data: T | null;
  error: string | null;
}

type Action<T> =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_SUCCESS'; payload: T }
  | { type: 'FETCH_ERROR'; payload: string };

function fetchReducer<T>(state: State<T>, action: Action<T>): State<T> {
  switch (action.type) {
    case 'FETCH_START':
      // When a new fetch starts, clear errors and enter loading:
      return { status: 'loading', data: null, error: null };
    case 'FETCH_SUCCESS':
      return { status: 'success', data: action.payload, error: null };
    case 'FETCH_ERROR':
      return { status: 'error', data: null, error: action.payload };
    default:
      return state;
  }
}

export function ProductView({ productId }: { productId: string }) {
  const [state, dispatch] = useReducer(fetchReducer<any>, {
    status: 'idle',
    data: null,
    error: null
  });

  useEffect(() => {
    dispatch({ type: 'FETCH_START' });

    fetch(`/api/products/${productId}`)
      .then(res => {
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        return res.json();
      })
      .then(data => dispatch({ type: 'FETCH_SUCCESS', payload: data }))
      .catch(err => dispatch({ type: 'FETCH_ERROR', payload: err.message }));
  }, [productId]);

  if (state.status === 'loading') return <div>Loading product...</div>;
  if (state.status === 'error') return <div className="error">{state.error}</div>;
  if (!state.data) return null;

  return <div>Product: {state.data.name}</div>;
}
```

---

## 6. Under the Hood: How `useState` is Built on Top of `useReducer`

Here is a senior engineering secret: **Inside React's source code, `useState` is implemented as a specialized instance of `useReducer`!**

```javascript
// ReactFiberHooks.js (Actual React Engine Mechanics)

// The default reducer for useState:
function basicStateReducer(state, action) {
  // If action is a function (e.g. prev => prev + 1), call it; otherwise return value:
  return typeof action === 'function' ? action(state) : action;
}

function updateState(initialState) {
  // Under the hood, useState simply calls updateReducer with basicStateReducer!
  return updateReducer(basicStateReducer, initialState);
}
```
- When you call `useState(0)`, React allocates a hook with `basicStateReducer`.
- When you call `useReducer(customReducer, init)`, React allocates the exact same hook structure, but passes your custom reducer function instead!

---

## 7. Lazy Initialization with the 3rd Argument (`init`)
If calculating the initial state is computationally expensive (e.g. reading from `localStorage` or parsing a large config), pass an initialization function as the **3rd parameter**:

```tsx
function init(initialCount: number): CounterState {
  const saved = localStorage.getItem('app_count');
  return {
    count: saved ? JSON.parse(saved) : initialCount,
    step: 1
  };
}

export function Counter({ initialCount }: { initialCount: number }) {
  // 💡 The 'init' function executes ONLY ONCE during initial mount!
  const [state, dispatch] = useReducer(counterReducer, initialCount, init);
  // ...
}
```

---

## 8. Common Mistakes & Anti-Patterns

### ❌ Mistake 1: Executing Side Effects Inside the Reducer
```tsx
// ❌ STRICT PURITY VIOLATION:
function badReducer(state: State, action: Action) {
  switch (action.type) {
    case 'CHECKOUT':
      // ⚠️ NEVER DO THIS! Reducers MUST BE PURE!
      fetch('/api/charge-card', { method: 'POST' }); 
      localStorage.setItem('cart', '');
      return { ...state, items: [] };
  }
}
```
- **Why it breaks**: In React 18 Concurrent Mode, React may execute the reducer function multiple times speculatively before committing. Putting side effects inside the reducer can trigger duplicate credit card charges or corrupted storage!
- **Rule**: Side effects belong in **event handlers** or **`useEffect`**, never in a reducer!

### ❌ Mistake 2: Mutating the `state` Argument In-Place
```tsx
// ❌ MUTATION TRAP:
case 'ADD_TODO':
  state.todos.push(action.payload); // ⚠️ Mutates array in place!
  return state; // Returns same object reference -> React skips re-render!
```
- **Fix**: Always return a fresh object:
  ```tsx
  case 'ADD_TODO':
    return { ...state, todos: [...state.todos, action.payload] };
  ```

---

## 9. Best Practices in Modern Production
1. **Use Discriminated Unions for Actions**: Give every action a literal `type` string property. This allows TypeScript to narrow down the `payload` type automatically in `switch` blocks.
2. **Implement TypeScript Exhaustiveness Checking**: Use the `default: const _exhaustiveCheck: never = action;` pattern to ensure the compiler warns you if you add a new action type but forget to handle it in the reducer.
3. **Keep `dispatch` Out of Dependency Arrays**: React **guarantees that `dispatch` is referentially stable forever**. You do not need to include `dispatch` in `useEffect` or `useCallback` dependency arrays.

---

## 10. Performance Considerations: Passing `dispatch` Deep Down
In deep component hierarchies:
- Passing callback functions (`onAdd`, `onDelete`, `onUpdate`) down 5 levels forces you to wrap each one in `useCallback`.
- With `useReducer`, you can **pass `dispatch` down directly** (or via a clean Dispatch Context).
- Because `dispatch` never changes identity, child components wrapped in `React.memo` never re-render unnecessarily!

---

## 11. Security Considerations: Action Spoofing & Validation
When actions are dispatched from WebSocket feeds or external iframe postMessages:
- Never pass untrusted external objects directly to `dispatch(externalEvent)`.
- Always validate the action schema using **Zod** to prevent unexpected action types from corrupting application state.

---

## 12. Complete Comparison Matrix: `useState` vs. `useReducer`
| Dimension | `useState` | `useReducer` |
|---|---|---|
| **Code Volume** | Low (simple tuple declaration) | Moderate (requires Actions and Reducer) |
| **State Complexity** | Independent primitives (boolean, string, number) | Interdependent objects, arrays, status machines |
| **Logic Location** | Mixed directly inside JSX event handlers | Isolated in pure, testable functions |
| **Unit Testability** | Hard (requires mounting component) | **Trivial (pure JS function testing)** |
| **Reference Stability**| `setState` is stable | `dispatch` is stable |
| **Best Used For** | Form inputs, toggles, simple modals | Complex carts, multi-step wizards, game logic |

---

## 13. Trade-offs: When to Migrate from `useState` to `useReducer`
- **Stay with `useState`**: When managing simple, isolated values (e.g. `isOpen`, `query`, `selectedTab`).
- **Migrate to `useReducer`**: When you find yourself writing:
  ```tsx
  setLoading(true);
  setError(null);
  setData(null);
  ```
  in 4 different functions across the same file. Consolidate them into `dispatch({ type: 'INITIATE_FETCH' })`.

---

## 14. Real-World Usage: E-Commerce Multi-Step Checkout Wizard
During e-commerce checkout (Shopify / Nike):
- Steps: `1. Shipping Address` $\rightarrow$ `2. Shipping Method` $\rightarrow$ `3. Payment Details` $\rightarrow$ `4. Confirmation`.
- State transitions are tightly coupled: modifying the shipping address invalidates the selected shipping method and clears previous tax calculations.
- A `checkoutReducer` enforces valid state transitions:
  ```typescript
  case 'UPDATE_SHIPPING_ADDRESS':
    return {
      ...state,
      address: action.payload,
      shippingMethod: null, // Reset dependent state!
      taxRate: null,
      step: 1
    };
  ```

---

## 15. Placement Interview Questions

### Basic (Intern)
1. **What is `useReducer` and what are its three arguments?**
   - *Spoken Answer*: "`useReducer` is a React hook for managing complex state transitions using a reducer function. Its three arguments are:
     1. `reducer`: The pure function `(state, action) => newState`.
     2. `initialArg`: The initial state value.
     3. `init` (optional): A lazy initialization function used to compute the initial state on mount."

### Conceptual (Junior SDE)
2. **Why must a Reducer function be a Pure Function?**
   - *Spoken Answer*: "A reducer must be pure because React relies on deterministic state transitions. In Concurrent React, React may run the reducer function speculatively without immediately committing the result. If a reducer performs side effects (like API calls or mutating external variables), those side effects would execute unpredictably, causing duplicate actions, race conditions, and memory leaks."

### Implementation (SDE-1)
3. **How is `useState` implemented under the hood in relation to `useReducer`?**
   - *Spoken Answer*: "In the React Fiber source code, `useState` is simply a wrapper around `useReducer`. It uses an internal built-in reducer function called `basicStateReducer`, which checks if the incoming action is a function updater (`prev => prev + 1`) or a raw value, and returns it. Thus, `useState` and `useReducer` share the exact same underlying Fiber hook queue architecture."

### Debugging
4. **In a reducer: `case 'UPDATE': state.count = action.payload; return state;`. The action dispatches, but the component never re-renders. Why?**
   - *Analysis*: The reducer directly mutated `state.count` and returned the same `state` object reference. React compares the returned state with previous state using `Object.is()`. Because `Object.is(state, state) === true`, React bails out of re-rendering.
   - *Fix*: Return a new object reference: `return { ...state, count: action.payload };`.

### Scenario-Based
5. **How does `useReducer` combined with `useContext` serve as an alternative to Redux for mid-sized applications?**
   - *Spoken Answer*: "By placing `useReducer` at the top level of a feature and broadcasting its `state` and `dispatch` through React Context, you replicate the core architecture of Redux (central store, actions, pure reducers) natively in React with zero third-party dependencies. Utilizing the Split Context pattern (one context for State, one for Dispatch) ensures components dispatching actions don't re-render when state changes."

### Advanced (Tier-1 Product Company)
6. **Explain how to implement TypeScript Exhaustiveness Checking in a Reducer using the `never` type.**
   - *Spoken Answer*: "In the `default` branch of a TypeScript reducer switch statement, assign the action to a variable of type `never`:
     ```typescript
     default:
       const _exhaustiveCheck: never = action;
       return state;
     ```
     Because TypeScript's type checker narrows down the discriminated union in each `case` block, if all action types are handled, the remaining type in `default` is `never`. If a developer later adds a new action `{ type: 'REFUND' }` to the union but forgets to add a `case 'REFUND'` in the reducer, TypeScript triggers a compile-time error: *Type 'RefundAction' is not assignable to type 'never'*, preventing unhandled runtime actions."

---

## 16. Placement Coding Challenge: Pure Reducer Unit Testing
Write a complete, pure Shopping Cart reducer in TypeScript along with standalone unit test verification:

```typescript
// cartReducer.ts
export interface CartItem {
  id: string;
  name: string;
  price: number;
  qty: number;
}

export interface CartState {
  items: CartItem[];
  totalAmount: number;
}

export type CartAction =
  | { type: 'ADD_ITEM'; payload: Omit<CartItem, 'qty'> }
  | { type: 'REMOVE_ITEM'; payload: string }
  | { type: 'UPDATE_QTY'; payload: { id: string; qty: number } }
  | { type: 'CLEAR_CART' };

export const initialCartState: CartState = { items: [], totalAmount: 0 };

function calculateTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'ADD_ITEM': {
      const existingIdx = state.items.findIndex(i => i.id === action.payload.id);
      let updatedItems: CartItem[];

      if (existingIdx !== -1) {
        updatedItems = state.items.map((item, idx) =>
          idx === existingIdx ? { ...item, qty: item.qty + 1 } : item
        );
      } else {
        updatedItems = [...state.items, { ...action.payload, qty: 1 }];
      }

      return { items: updatedItems, totalAmount: calculateTotal(updatedItems) };
    }

    case 'REMOVE_ITEM': {
      const updatedItems = state.items.filter(i => i.id !== action.payload);
      return { items: updatedItems, totalAmount: calculateTotal(updatedItems) };
    }

    case 'UPDATE_QTY': {
      if (action.payload.qty <= 0) {
        const updatedItems = state.items.filter(i => i.id !== action.payload.id);
        return { items: updatedItems, totalAmount: calculateTotal(updatedItems) };
      }

      const updatedItems = state.items.map(item =>
        item.id === action.payload.id ? { ...item, qty: action.payload.qty } : item
      );
      return { items: updatedItems, totalAmount: calculateTotal(updatedItems) };
    }

    case 'CLEAR_CART':
      return initialCartState;

    default:
      return state;
  }
}
```

---

## 17. Common Interview Traps
- **Trap**: "Does calling `dispatch` cause the component to re-render if the reducer returns the exact same state object?"
  - *Trap Explanation*: **No.** React checks `Object.is(oldState, newState)`. If the reducer returns the exact same object reference (e.g. in the `default:` branch or an unhandled condition), React bails out of re-rendering completely!
- **Trap**: "Can `dispatch` be passed asynchronously inside promises or setTimeout?"
  - *Trap Explanation*: **Yes.** `dispatch` is permanently referentially stable and can be invoked from any asynchronous callback safely.

---

## 18. Revision Summary
- `useReducer` separates **Action Dispatching** from **State Transition Logic**.
- Reducer functions **must be strictly pure**: `(state, action) => newState`.
- Never execute side effects (API calls, storage) inside a reducer.
- `useState` is internally built on top of `useReducer` in React Fiber.
- `dispatch` is referentially stable forever; no need for `useCallback`.
- Use TypeScript **Discriminated Unions** and `never` exhaustiveness checking.

---

## 19. Quick Reference Cheat Sheet
```tsx
// 1. Hook Signature:
const [state, dispatch] = useReducer(reducer, initialState, lazyInitFn);

// 2. Dispatching an Action:
dispatch({ type: 'ADD_ITEM', payload: { id: '1', name: 'Item', price: 10 } });

// 3. Reducer Invariant:
function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ACTION': return { ...state, key: action.payload };
    default: return state;
  }
}
```
