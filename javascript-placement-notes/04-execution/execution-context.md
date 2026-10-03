# JavaScript Execution Context

Everything in JavaScript happens inside an **Execution Context**.

If you truly want to understand how JavaScript runs behind the scenes—and answer questions about hoisting, scope, and closures like a pro—you must master this concept.

---

## 1. What is an Execution Context?

In simple English:

> An **Execution Context** is an abstract environment or "box" created by the JavaScript engine to evaluate and execute your code.

Think of it as the container that holds:
1. The memory for your variables and functions.
2. The scope chain references.
3. The value of the `this` keyword.

---

## 2. The Two Types of Execution Context

1. **Global Execution Context (GEC)**:
   - Created the moment your JavaScript file loads.
   - Only **one** Global Execution Context exists for a program.
   - In browsers, it creates the global `window` object and binds `this = window`.

2. **Function Execution Context (FEC)**:
   - A brand new execution context is created **every single time a function is invoked**.
   - If a function is called 5 times, 5 separate Function Execution Contexts are created!

---

## 3. The Two Phases of Every Execution Context

Whenever an execution context is created, it runs in **two distinct phases**:

```
+-----------------------------------------------------------------+
| EXECUTION CONTEXT                                               |
|                                                                 |
| 1. MEMORY CREATION PHASE (Variable Environment)                 |
|    - Scans declarations                                         |
|    - var variables  --> allocated and set to undefined          |
|    - let / const    --> allocated, kept in Temporal Dead Zone   |
|    - Functions      --> allocated with full code body           |
|                                                                 |
| 2. CODE EXECUTION PHASE (Thread of Execution)                   |
|    - Runs line-by-line                                          |
|    - Variables are assigned real values                         |
|    - Functions are executed                                     |
+-----------------------------------------------------------------+
```

---

## 4. Walking Through a Real Code Example

Let's trace this simple script:

```javascript
var n = 2;

function square(num) {
    var ans = num * num;
    return ans;
}

var square2 = square(n);
```

### Step 1: Memory Creation Phase (GEC)
Before running line 1:
- `n` $\rightarrow$ `undefined`
- `square` $\rightarrow$ `{ function body }`
- `square2` $\rightarrow$ `undefined`

### Step 2: Code Execution Phase (GEC)
- Line 1: `n = 2` (replaces `undefined` with `2`).
- Line 3-6: Function definition skipped because it was already stored in memory.
- Line 8: `square(n)` is called!
  - 🛑 **A brand new Function Execution Context is born for `square()`!**

### Step 3: Inside `square()`'s Execution Context
1. **Memory Phase**:
   - Parameter `num` $\rightarrow$ gets value `2`.
   - Local variable `ans` $\rightarrow$ `undefined`.
2. **Execution Phase**:
   - `ans = num * num` $\rightarrow$ `ans = 4`.
   - `return ans` sends `4` back to the Global Execution Context.
   - 🏁 **`square()` finishes! Its execution context is completely deleted from memory.**

### Step 4: Back to GEC
- `square2` is assigned `4`.
- End of file reached! Global Execution Context is destroyed.

---

## 💡 Think of it like this

- The **Global Execution Context** is like the main restaurant kitchen.
- A **Function Execution Context** is like a chef opening a clean prep-station for a specific dish. The chef lays out the ingredients (Memory Phase), cooks the meal (Execution Phase), serves the plate (Return value), and wipes the counter completely clean (Garbage collection).

---

## 🎯 Interview Points

1. **Is JavaScript single-threaded?**
   - Yes! JavaScript has a **single call stack** and runs on a **single thread of execution** (one command at a time from top to bottom).

2. **Why does JavaScript have Hoisting?**
   - Hoisting is not a special feature or magic trick. It is simply the natural consequence of Phase 1 (Memory Creation Phase) scanning all declarations before Phase 2 (Code Execution) starts.
