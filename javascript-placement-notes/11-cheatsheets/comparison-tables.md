# Master JavaScript Comparison Tables

Quick-reference comparison tables for every high-yield placement comparison.

---

## 1. `var` vs `let` vs `const`

| Feature | `var` | `let` | `const` |
| :--- | :--- | :--- | :--- |
| **Scope** | Function / Global | Block `{}` | Block `{}` |
| **Hoisting** | Initialized to `undefined` | Uninitialized (in TDZ) | Uninitialized (in TDZ) |
| **Re-declaration** | Allowed in same scope | Throws `SyntaxError` | Throws `SyntaxError` |
| **Re-assignment** | Allowed | Allowed | Throws `TypeError` |
| **Global Object** | Attaches to `window.varName` | Does NOT attach | Does NOT attach |

---

## 2. `==` vs `===`

| Feature | `==` (Loose / Abstract Equality) | `===` (Strict Equality) |
| :--- | :--- | :--- |
| **Type Coercion** | Converts types before comparing | Compares value AND type directly |
| **Performance** | Slower (extra conversion steps) | Faster |
| **`0 == false`** | `true` | `false` |
| **`"" == 0`** | `true` | `false` |
| **`null == undefined`** | `true` | `false` |
| **Best Practice** | Avoid | Default to `===` always |

---

## 3. Function Declaration vs Expression vs Arrow Function

| Feature | Function Declaration | Function Expression | Arrow Function |
| :--- | :--- | :--- | :--- |
| **Syntax** | `function foo() {}` | `const foo = function() {}` | `const foo = () => {}` |
| **Hoisting** | Fully hoisted with body | Hoisted as variable (TDZ) | Hoisted as variable (TDZ) |
| **`this` Binding** | Dynamic (caller context) | Dynamic (caller context) | Lexical (parent scope) |
| **`arguments`** | Available | Available | Not available (use `...args`) |
| **Constructor** | Yes (`new foo()`) | Yes (`new foo()`) | No (Throws `TypeError`) |

---

## 4. `for` vs `for...of` vs `for...in`

| Feature | `for` (Standard) | `for...of` | `for...in` |
| :--- | :--- | :--- | :--- |
| **Best Used On** | Arrays, Strings, DSA | Iterables (Array, Map, Set) | Plain Objects |
| **Yields** | Index (numbers) | **Values directly** | **Keys / property names** |
| **Traverses Prototype?** | No | No | **Yes** (Avoid for arrays!) |
| **Supports `break`?** | Yes | Yes | Yes |

---

## 5. `slice()` vs `splice()`

| Feature | `slice(start, end)` | `splice(start, deleteCount, ...items)` |
| :--- | :--- | :--- |
| **Mutates Original?** | ❌ **NO** (Pure / Non-mutating) | ✅ **YES** (Mutates in-place) |
| **Return Value** | Extracted subarray | Array of removed elements |
| **End Index** | Up to, but not including `end` | Takes count of items to delete |
| **Insertion** | Cannot insert elements | Inserts new items at `start` index |

---

## 6. `undefined` vs `null`

| Feature | `undefined` | `null` |
| :--- | :--- | :--- |
| **Meaning** | Variable declared, no value yet | Intentional absence of value |
| **Type** | `"undefined"` | `"object"` (legacy bug) |
| **Assigned By** | JavaScript automatically | Developer explicitly |
| **Coerced to Number** | `NaN` | `0` |

---

## 7. Callbacks vs Promises vs `async/await`

| Feature | Callbacks | Promises | `async / await` |
| :--- | :--- | :--- | :--- |
| **Readability** | Poor (Callback Hell) | Good (Chaining) | Excellent (Looks synchronous) |
| **Error Handling** | Repetitive in each callback | Single `.catch()` at end | Standard `try / catch` |
| **Control** | Inversion of Control risk | Caller maintains control | Caller maintains control |
| **Introduced In** | ES1 (1995) | ES6 (2015) | ES8 (2017) |

---

## 8. `call()` vs `apply()` vs `bind()`

| Method | Invocation | How Arguments are Passed | Return Value |
| :--- | :--- | :--- | :--- |
| **`call()`** | Immediate | Comma-separated: `fn.call(ctx, 1, 2)` | Result of the function |
| **`apply()`** | Immediate | Array: `fn.apply(ctx, [1, 2])` | Result of the function |
| **`bind()`** | **Later** | Comma-separated: `fn.bind(ctx, 1, 2)` | **New bound function** |

---

## 9. Shallow Copy vs Deep Copy

| Feature | Shallow Copy (`...spread`, `Object.assign`) | Deep Copy (`structuredClone`) |
| :--- | :--- | :--- |
| **Level 1 Properties** | Independent copies | Independent copies |
| **Nested Objects** | **Shared memory references!** | Completely duplicated in memory |
| **Speed** | Fast | Slower (recursive traversal) |

---

## 10. `localStorage` vs `sessionStorage` vs Cookies

| Feature | `localStorage` | `sessionStorage` | Cookies |
| :--- | :--- | :--- | :--- |
| **Capacity** | ~5 to 10 MB | ~5 to 10 MB | ~4 KB |
| **Lifetime** | Never expires (until deleted) | Cleared on tab close | Set via expiration date |
| **Sent to Server?** | No (Client-only) | No (Client-only) | **Yes**, with every HTTP call |
| **Access** | JavaScript only | JavaScript only | JavaScript or `HttpOnly` |

---

## 11. `Promise.all` vs `allSettled` vs `race` vs `any`

| Method | Resolves When... | Rejects When... | Ideal Use Case |
| :--- | :--- | :--- | :--- |
| **`Promise.all`** | ALL fulfill | **ANY ONE rejects** (Fail-Fast) | Dependent tasks (checkout flow) |
| **`Promise.allSettled`** | ALL settle (fulfilled/rejected) | **NEVER rejects** | Dashboard independent widgets |
| **`Promise.race`** | First one settles (either way) | First one settles (either way) | API request timeout |
| **`Promise.any`** | **First one fulfills (succeeds)** | ALL reject (`AggregateError`) | Redundant mirror servers |
