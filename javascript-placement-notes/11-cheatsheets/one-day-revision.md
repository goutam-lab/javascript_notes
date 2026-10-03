# ⚡ One-Day JavaScript Placement Revision Sheet

> **Read this the night before your technical placement interview!**  
> Covers only the most critical concepts, syntax rules, memory behaviors, and interview traps.

---

## 1. Variables & Scope
- **`var`**: Function-scoped, hoisted to `undefined`, attaches to `window` in browser.
- **`let` / `const`**: Block-scoped (`{}`), hoisted into **Temporal Dead Zone (TDZ)**, throws `ReferenceError` if accessed before declaration.
- **`const`**: Cannot be reassigned. However, properties inside a `const` object/array **can be mutated**.
- **Illegal Shadowing**: You **cannot** shadow a `let` with `var` inside a block.

---

## 2. Types & Coercion Quick Rules
- **7 Primitives**: `string`, `number`, `boolean`, `undefined`, `null`, `bigint`, `symbol`.
- **`typeof null === "object"`**: Legacy 1995 V8/JS type tag bug. Check `x === null`.
- **`NaN === NaN` is `false`**: Always check with `Number.isNaN(x)`.
- **`+` operator**: Prefers string concatenation if either side is a string (`1 + "2" === "12"`).
- **`-`, `*`, `/` operators**: Always coerce strictly to numbers (`"6" - 2 === 4`).
- **`==` vs `===`**: `==` converts types before comparing; `===` checks both value and type without conversion. Always use `===`.
- **`null == undefined` is `true`**, but `null === undefined` is `false`.
- **`??` vs `||`**: `??` only falls back on `null` or `undefined`. `||` falls back on all 8 falsy values (`0`, `""`, `false`, etc.).

---

## 3. Execution Context & Event Loop
- **Two Phases**: 
  1. Memory Creation Phase (hoisting happens here)
  2. Code Execution Phase (runs line-by-line).
- **Call Stack**: Single-threaded LIFO stack.
- **Microtask Queue** (`Promise.then`, `queueMicrotask`): **Highest Priority!** Runs before the macrotask queue.
- **Macrotask Queue** (`setTimeout`, `setInterval`, DOM events): Runs only when Call Stack and Microtask Queue are completely empty.
- **Execution Order Rule**: `Sync Code > Microtasks (Promises) > Macrotasks (setTimeout)`.

---

## 4. Functions & Closures
- **Arrow Functions**: Have **lexical `this`** (inherit from parent scope), cannot be constructors (`new () => {}` fails), have no `arguments` object.
- **Closure**: A function bundled with its lexical environment. Remembers variables from its outer scope even after the outer function has returned.
- **Loop + `setTimeout` Trap**:
  - `for (var i = 0; i < 3; i++) setTimeout(() => console.log(i), 0);` logs `3, 3, 3`.
  - Fix: Use `let i` (block scope creates a fresh binding per iteration) or an IIFE.

---

## 5. The `this` Keyword: 4 Rules
1. **Default Binding**: Standalone call `fn()` $\rightarrow$ `window` (or `undefined` in `"use strict"`).
2. **Implicit Binding**: `obj.method()` $\rightarrow$ `this` is `obj` (left of the dot).
3. **Explicit Binding**: `call(obj, ...args)`, `apply(obj, [args])`, `bind(obj)` (returns a bound function).
4. **`new` Binding**: `new Person()` $\rightarrow$ `this` is the newly created object.
- **Precedence**: `new` > `bind/call` > `obj.method` > `standalone`.

---

## 6. Arrays & Objects
- `slice(start, end)`: Non-mutating (pure). Extracts a portion.
- `splice(start, deleteCount, ...items)`: **Mutates original array in-place!**
- `push` / `pop`: Fast $O(1)$.
- `shift` / `unshift`: Slow $O(N)$ (requires re-indexing).
- `Object.freeze()`: Shallow lock (no adds, deletes, or value edits).
- `Object.seal()`: Shallow lock (no adds or deletes, but **can update existing writable properties**).
- `structuredClone(obj)`: Native deep copy (ES2022). Spread `{ ...obj }` is only shallow.

---

## 7. Promises & Async
- **Promise States**: `pending`, `fulfilled`, `rejected`. Once settled, state is immutable.
- **`Promise.all`**: All must succeed. Fails fast if any single promise rejects.
- **`Promise.allSettled`**: Waits for all promises to finish. Never rejects.
- **`Promise.race`**: First settled promise (fulfilled OR rejected) wins.
- **`Promise.any`**: First fulfilled promise wins.
- **`fetch()` Trap**: Does NOT reject on 404 or 500! Must check `if (!response.ok)`.

---

## 8. DOM & Events
- `textContent` is safe from XSS attacks; `innerHTML` is vulnerable to script injection.
- **Event Bubbling**: Events trigger on target first, then bubble up to `window`.
- **Event Delegation**: Attach 1 listener to the parent container instead of 1,000 listeners to children.
- `e.target` is the element clicked; `e.currentTarget` is the element holding the listener.
- `e.preventDefault()` stops default browser action (page reload); `e.stopPropagation()` stops bubbling.

---

## 9. Performance & Advanced
- **Debounce**: Wait until user pauses typing for $X$ ms before calling API.
- **Throttle**: Limit execution to at most once every $X$ ms during continuous scrolling.
- **Currying**: Transforming `f(a, b, c)` into `f(a)(b)(c)`.
- **Memoization**: Caching return values of pure functions in a closure hash map.
