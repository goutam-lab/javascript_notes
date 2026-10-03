# ⚡ JavaScript Placement & Technical Interview Master Handbook

Welcome to your personal, comprehensive **JavaScript Placement Preparation System**.

This handbook is designed specifically for software engineering campus placements, product-company technical rounds (SDE-1), and frontend/full-stack interviews.

Written in the voice of a **senior developer mentoring a student**:
- Simple, conversational English with real-world analogies (*"Think of it like this"*)
- Clear headings and plenty of whitespace
- Concise code snippets with outputs shown immediately below
- Common pitfalls highlighted with **"⚠️ Common Mistakes"**
- Interview tips packed into **"🎯 Interview Points"**

---

## 🗺️ Master Table of Contents

### 🟢 00. Placement Progress Tracker
- [**Placement Readiness Checklist**](./00-progress/progress.md) — Dynamic roadmap to track your daily study progress.

### 🟡 01. Core JavaScript (Fast Revision of Studied Topics)
- [**Variables (`var`, `let`, `const`)**](./01-core-javascript/variables.md) — Scopes, reassignments, and TDZ.
- [**Data Types & Coercion**](./01-core-javascript/datatypes.md) — 7 primitives vs references, `NaN`, floating point trap.
- [**Operators & Equality**](./01-core-javascript/operators.md) — `==` vs `===`, logical short-circuiting, `??` vs `||`.
- [**Conditions & Control Flow**](./01-core-javascript/conditions.md) — `switch` fall-through, lookup table pattern.
- [**Loops & Iteration**](./01-core-javascript/loops.md) — `for`, `for...of` vs `for...in`, why `for...in` breaks arrays.
- [**Functions Foundations**](./01-core-javascript/functions.md) — Declarations vs expressions vs arrow functions.
- [**Scope & Scope Chain**](./01-core-javascript/scope.md) — Global, function, and block scope, illegal shadowing.
- [**Hoisting & TDZ**](./01-core-javascript/hoisting.md) — Compilation phase vs execution phase.
- [**Closures**](./01-core-javascript/closures.md) — Lexical memory, private state, the loop + `setTimeout` trap.
- [**Callbacks & HOFs**](./01-core-javascript/callbacks.md) — First-class functions, `map` polyfill.

### 🟠 02. Arrays & Objects Deep Dive
- [**Objects: Complete Deep Dive**](./02-arrays-objects/objects-deep-dive.md) — Destructuring, Spread, Rest, Optional Chaining, Cloning & JSON.
- [**Arrays & V8 Memory Internals**](./02-arrays-objects/arrays.md) — `push`/`pop` vs `shift`/`unshift`, `slice` vs `splice`.
- [**Modern Array Methods**](./02-arrays-objects/array-methods.md) — `find`, `some`, `every`, `flat`, `reduce`, sorting trap.
- [**Objects & Methods**](./02-arrays-objects/objects.md) — `Object.keys/values/entries`, `freeze` vs `seal`.
- [**Destructuring (Arrays & Objects)**](./02-arrays-objects/destructuring.md) — Unpacking, renaming, swapping variables, optional chaining `?.`.
- [**Spread vs Rest Operator (`...`)**](./02-arrays-objects/spread-rest.md) — Unpacking vs gathering, shallow vs deep copy (`structuredClone`).

### 🔴 03. Functions Deep Dive
- [**Arrow Functions**](./03-functions-deep-dive/arrow-functions.md) — Lexical `this`, arguments object, when NOT to use them.
- [**The `this` Keyword Masterclass**](./03-functions-deep-dive/this.md) — The 4 binding rules, precedence, losing `this` context.
- [**`call()`, `apply()`, and `bind()`**](./03-functions-deep-dive/call-apply-bind.md) — Explicit binding, method borrowing, `bind` polyfill.
- [**Advanced Functions**](./03-functions-deep-dive/advanced-functions.md) — IIFE, Pure Functions, Infinite Currying `sum(1)(2)(3)...()`.

### ⚙️ 04. JavaScript Execution
- [**Execution Context**](./04-execution/execution-context.md) — Global vs Function context, Memory vs Execution phase.
- [**The Call Stack & Stack Overflow**](./04-execution/call-stack.md) — LIFO lifecycle, infinite recursion stack overflow.
- [**The Event Loop & Concurrency**](./04-execution/event-loop.md) — Microtask (VIP) vs Macrotask queue, `setTimeout(..., 0)` myth.
- [**Hoisting Engine Mechanics**](./04-execution/hoisting-deep-dive.md) — V8 bytecode scope table, class hoisting.

### ⏳ 05. Asynchronous JavaScript
- [**Timers & Callback Hell**](./05-async-javascript/callbacks.md) — Sync vs async, `setTimeout`, Inversion of Control.
- [**Promises Masterclass**](./05-async-javascript/promises.md) — States, `.then()`, `.catch()`, `.finally()`, promise chaining.
- [**`async` and `await`**](./05-async-javascript/async-await.md) — Sequential vs parallel execution (`Promise.all`), `for...of` trap.
- [**Fetch API & Promise Combinators**](./05-async-javascript/fetch.md) — Network error traps, `Promise.all` vs `allSettled` vs `race` vs `any`.
- [**REST APIs & HTTP Methods**](./05-async-javascript/rest-api.md) — GET, POST, PUT, DELETE, status codes, headers & payload.

### 🏛️ 06. Objects & OOP
- [**Prototypes & Prototype Chain**](./06-oop/prototypes.md) — `__proto__` vs `prototype`, prototypal inheritance.
- [**ES6 Classes**](./06-oop/classes.md) — Constructors, static methods, getters/setters, `#private` fields.
- [**Class Inheritance & OOP**](./06-oop/inheritance.md) — `extends`, `super()`, method overriding, 4 pillars of OOP.

### 🌐 07. DOM & Browser JavaScript
- [**DOM Manipulation**](./07-dom/dom.md) — Selecting elements, `textContent` vs `innerHTML` (XSS), `append` vs `appendChild`.
- [**Dynamic DOM Manipulation**](./07-dom/dynamic-dom-manipulation.md) — Creating, inserting (`prepend`/`append`/`before`/`after`), attribute APIs, DocumentFragment optimization.
- [**Events & Propagation**](./07-dom/events.md) — Bubbling vs Capturing, `e.target` vs `e.currentTarget`, Event Delegation.
- [**Event Delegation: Complete Deep Dive**](./07-dom/event-delegation-deep-dive.md) — Bubbling, closest(), matches(), shopping cart deletion & dynamic lists.
- [**Web Storage**](./07-dom/storage.md) — `localStorage` vs `sessionStorage` vs Cookies, JWT token security.

### 🧠 08. Advanced JavaScript
- [**Debouncing**](./08-advanced/debounce.md) — Search bar autocomplete optimization, custom debounce polyfill.
- [**Throttling**](./08-advanced/throttle.md) — Scroll/resize rate limiting, custom throttle polyfill.
- [**Currying Deep Dive**](./08-advanced/currying.md) — Generalized auto-curry implementation (`curry(fn)`).
- [**Memoization**](./08-advanced/memoization.md) — Pure function caching with closures, trading memory for speed.

### 🧩 09. JavaScript for DSA
- [**Arrays: Core DSA Patterns**](./09-dsa/arrays.md) — Two Pointers, Sliding Window, Prefix Sum, Kadane's Algorithm.
- [**Strings & Immutability**](./09-dsa/strings.md) — Valid Palindrome, Anagrams, Longest Substring Without Repeating.
- [**HashMaps & Sets**](./09-dsa/hashmap.md) — `Map` vs `{}` object, Two Sum in $O(N)$, Group Anagrams.
- [**Stacks in JavaScript**](./09-dsa/stack.md) — Valid Parentheses, Monotonic Stack (Next Greater Element).
- [**Queues in JavaScript**](./09-dsa/queue.md) — High performance $O(1)$ Queue without slow `shift()`, BFS traversal.
- [**Linked Lists**](./09-dsa/linked-list.md) — Reversal, Floyd's Tortoise & Hare cycle detection, Middle node.
- [**Binary Trees & BST**](./09-dsa/trees.md) — Traversals, Max Depth, Inverting trees, BST Search.
- [**Graphs & 2D Grids**](./09-dsa/graphs.md) — Adjacency list, BFS/DFS, Number of Islands.
- [**Dynamic Programming in JS**](./09-dsa/dp.md) — Top-Down vs Bottom-Up, Climbing Stairs, House Robber, Coin Change.

### 🎯 10. Placement Interview Preparation
- [**Tricky Output Questions**](./10-interview/output-questions.md) — Step-by-step traces for event loop, coercion, and scope puzzles.
- [**Debugging Traps**](./10-interview/debugging.md) — ASI semicolon insertion, mutating during iteration, `NaN`.
- [**Conceptual FAQs**](./10-interview/conceptual.md) — V8 JIT compiler, Garbage Collection (Mark-and-Sweep), CJS vs ESM.
- [**Machine Coding Challenges**](./10-interview/coding-questions.md) — Polyfills for `Promise.all`, Deep Clone, Array Flattening.

### ⚡ 11. Cheatsheets & Emergency Revision
- [**One-Day Revision Sheet**](./11-cheatsheets/one-day-revision.md) — The ultimate night-before placement summary sheet!
- [**Top 100 JavaScript Interview Questions**](./11-cheatsheets/top-100-interview-questions.md) — Categorized with concise spoken answers.
- [**Master Comparison Tables**](./11-cheatsheets/comparison-tables.md) — 11 essential placement comparison tables.

### 🛠️ 12. Placement Projects
- [**Projects Guide**](./12-projects/projects-guide.md) — High-impact project ideas with resume-ready bullet points.

---

## 💻 Interactive Study Portal
You also have an interactive web application **[`index.html`](../index.html)** in the root workspace!
Open `index.html` in your browser to:
- Instantly search through any topic or interview question.
- Track your placement readiness checklist with live saved progress.
- View interactive code examples, copy snippets with one click, and toggle dark mode.
