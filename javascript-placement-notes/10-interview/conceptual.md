# Conceptual Placement FAQs: Engine, GC & Modules

Let's explore the high-level architecture questions that interviewers ask to gauge if you understand JavaScript beyond just syntax.

---

## 1. How Does the V8 Engine Execute JavaScript?

The Google V8 engine (powers Chrome and Node.js) does not simply interpret JavaScript line by line. It uses a **Just-In-Time (JIT) Compiler**:

1. **Parser**: Reads your source code and converts it into an **Abstract Syntax Tree (AST)**.
2. **Ignition (Interpreter)**: Converts the AST into fast **Bytecode** and starts executing immediately.
3. **TurboFan (Optimizing Compiler)**:
   - While your program runs, V8 watches for "hot code" (functions called hundreds of times with the same data types).
   - TurboFan compiles those hot functions into **blistering-fast machine code**.
   - If data types suddenly change (deoptimization), V8 bails back to bytecode!

---

## 2. How Does Garbage Collection Work in JavaScript?

JavaScript manages memory automatically using the **Mark-and-Sweep Algorithm**:

1. The Garbage Collector starts at the **Roots** (Global variables, currently executing Call Stack frames, DOM elements).
2. It walks through all pointers and "marks" every object that is reachable.
3. Any object in Heap memory that is **unreachable** (has no path from root) is "swept" and its memory is reclaimed.

### What causes a Memory Leak?
- Accidental global variables (`window.heavyData = ...`).
- Forgotten `setInterval()` timers that continue running forever.
- Closures holding onto large objects inside event listeners that were never detached.

---

## 3. CommonJS (CJS) vs ES Modules (ESM)

| Feature | CommonJS (CJS) | ES Modules (ESM) |
| :--- | :--- | :--- |
| **Origin** | Node.js default (pre-2020) | Official ECMAScript standard |
| **Syntax** | `const x = require('./x')` | `import x from './x'` |
| **Export** | `module.exports = { x }` | `export const x = 1` |
| **Loading** | **Synchronous / Runtime** | **Asynchronous / Static (Compile-time)** |
| **Top-Level Await** | No | Yes |
| **Tree Shaking** | Hard (dynamic require) | Easy (static analysis allows dead-code removal) |

---

## 4. What Does `"use strict"` Actually Do?

Adding `"use strict";` at the top of your file enables JavaScript's **Strict Mode**:

1. **Prevents accidental globals**: Assigning to an undeclared variable (`x = 10`) throws an error instead of creating `window.x`.
2. **Eliminates silent failures**: Assigning to read-only properties throws a `TypeError`.
3. **Stops dangerous `this`**: Inside standalone functions, `this` is `undefined` instead of defaulting to the global `window`.
4. **Disallows duplicate parameter names**: `function sum(a, a, b)` throws a `SyntaxError`.
