# The Event Loop & Concurrency Model

JavaScript is **single-threaded**. It has only one Call Stack and can only do one thing at a time.

Yet, you can fetch data from an API, run a 5-second timer, and click buttons without freezing your webpage.

How is this possible?

The answer is the **Event Loop**, supported by the browser's **Web APIs** and task queues.

---

## 1. The 4 Key Pieces of the System

```
+-------------------+           +----------------------------+
|    CALL STACK     |           |          WEB APIs          |
|  (JavaScript V8)  |           | (Timers, Fetch, DOM, etc.) |
|                   |           |                            |
| Runs sync code    |           | Offloads async work        |
+-------------------+           +----------------------------+
          ▲                                    │
          │                                    ▼
+───────────────────+           +────────────────────────────+
|    EVENT LOOP     |           |      MICROTASK QUEUE       |
| Constantly checks |           | (Promises, queueMicrotask) |
| if Stack is empty ◄───────────┤ HIGHEST PRIORITY!          |
+───────────────────+           +────────────────────────────+
                                               │
                                +────────────────────────────+
                                |      MACROTASK QUEUE       |
                                | (setTimeout, setInterval)  |
                                | Normal priority            |
                                +────────────────────────────+
```

---

## 2. What Does the Event Loop Actually Do?

The Event Loop has one single job:

> **Rule:** If and only if the Call Stack is **completely empty**, the Event Loop checks the queues.
> 1. It first executes **ALL tasks in the Microtask Queue** until it is totally empty.
> 2. Then, it takes **ONE task from the Macrotask Queue** and pushes it onto the Call Stack.
> 3. It repeats this loop endlessly.

---

## 3. Microtask vs Macrotask (The Priority War)

Not all async callbacks are treated equally!

### 1. Microtask Queue (VIP Fast Track 🚀)
- Handled by: `Promise.then()`, `catch()`, `finally()`, `async/await`, `queueMicrotask()`
- **Highest Priority**: The Event Loop will drain the entire microtask queue before even looking at `setTimeout`.

### 2. Macrotask / Callback Queue (Standard Economy ✈️)
- Handled by: `setTimeout()`, `setInterval()`, `setImmediate()`, DOM UI events
- **Lower Priority**: Runs only after the call stack and microtasks are completely clear.

---

## 4. The #1 Output Question Asked in Tech Interviews

Trace this code carefully:

```javascript
console.log("1 - Start");

setTimeout(() => {
    console.log("2 - Timeout");
}, 0);

Promise.resolve().then(() => {
    console.log("3 - Promise");
});

console.log("4 - End");
```

### The Output:
```
1 - Start
4 - End
3 - Promise
2 - Timeout
```

### Step-by-Step Execution Trace:
1. `console.log("1 - Start")` runs immediately on Call Stack $\rightarrow$ **Logs `1 - Start`**.
2. `setTimeout(..., 0)` is encountered. JS offloads the timer to the browser Web API. When timer expires (0ms), the callback is placed in the **Macrotask Queue**.
3. `Promise.resolve().then(...)` is encountered. Its callback is placed in the **Microtask Queue**.
4. `console.log("4 - End")` runs on Call Stack $\rightarrow$ **Logs `4 - End`**.
5. The Call Stack is now completely empty!
6. The Event Loop wakes up:
   - It checks the **Microtask Queue** first! Finds the Promise callback $\rightarrow$ **Logs `3 - Promise`**.
   - Microtask queue is now empty.
   - It turns to the **Macrotask Queue** and finds the Timeout callback $\rightarrow$ **Logs `2 - Timeout`**.

---

## 💡 Think of it like this

Imagine a busy bank with one teller window (The Call Stack):
- **Synchronous code**: The customers already standing in front of the teller. The teller serves them first without looking away.
- **Microtask Queue**: VIP customers holding special priority tokens (Promises). As soon as the current customer leaves, the teller calls ALL VIP customers before anyone else.
- **Macrotask Queue**: Regular customers sitting in the waiting area chairs (`setTimeout`). They only get called once the VIP line has zero people left.

---

## 5. Why `setTimeout(fn, 0)` Does NOT Run Instantly

When you write `setTimeout(fn, 0)`, you are **not** saying *"run this after 0 milliseconds"*.

You are saying:
> *"Register this callback and put it into the Macrotask Queue as soon as possible, but **wait until the Call Stack has finished all current synchronous code and all microtasks**."*

If the main thread has a synchronous loop running for 5 seconds, your `setTimeout(fn, 0)` will have to wait at least 5 seconds before it can touch the Call Stack!

---

## 🎯 Interview Points

1. **What is starvation in the Event Loop?**
   - If microtasks continuously schedule more microtasks (e.g. an infinite chain of `Promise.resolve().then(...)`), the Event Loop will stay trapped in the Microtask Queue forever, starving the Macrotask Queue and freezing the browser UI!

2. **Where does `requestAnimationFrame` fit into the browser Event Loop?**
   - `requestAnimationFrame` runs just before the browser calculates styles and repaints the screen (usually 60 times a second), giving you smooth 60fps animations.
