# The Node.js Event Loop: 6 Libuv Phases, Microtask Queues, and Priority Execution

## 1. What is it?
The Event Loop is the central coordinating mechanism within the Libuv C library that enables Node.js to perform non-blocking asynchronous I/O operations despite JavaScript executing on a single thread. The Event Loop continuously cycles through **six distinct phases** in a strict deterministic order. Interleaved between these phases are **two high-priority Microtask Queues** that drain completely whenever the JavaScript Call Stack empties:
1. **The 6 Libuv Event Loop Phases:**
   - **Timers:** Executes callbacks scheduled by `setTimeout()` and `setInterval()`.
   - **Pending Callbacks:** Executes deferred I/O callbacks (e.g. specific TCP system errors).
   - **Idle, Prepare:** Internal Libuv phase for subsystem synchronization.
   - **Poll:** Retrieves new I/O events from the OS; executes I/O callbacks (HTTP, DB, file reads).
   - **Check:** Executes callbacks registered by `setImmediate()`.
   - **Close Callbacks:** Executes socket and handle termination callbacks (`socket.on('close', ...)`).
2. **The 2 Microtask Queues (Highest Priority):**
   - **`process.nextTick` Queue:** Highest priority in the entire runtime; executes before all other microtasks.
   - **Promise Microtask Queue:** Executes resolved `.then()`, `.catch()`, `.finally()`, and `queueMicrotask()` callbacks.

```
+-------------------------------------------------------------------------------+
|                       THE LIBUV EVENT LOOP CYCLE                              |
+-------------------------------------------------------------------------------+
|   [ Incoming JavaScript Call Stack Execution ]                                |
|                        |                                                      |
|   +------------------->+ (Drains process.nextTick & Promise Microtasks!)      |
|   |                    v                                                      |
|   |   +---------------------------------------+                               |
|   |   | 1. TIMERS Phase                       | (setTimeout, setInterval)     |
|   |   +---------------------------------------+                               |
|   |                    | (Drains Microtasks!)                                 |
|   |   +---------------------------------------+                               |
|   |   | 2. PENDING CALLBACKS Phase            | (Deferred system I/O errors)  |
|   |   +---------------------------------------+                               |
|   |                    | (Drains Microtasks!)                                 |
|   |   +---------------------------------------+                               |
|   |   | 3. IDLE, PREPARE Phase                | (Internal Libuv housekeeping) |
|   |   +---------------------------------------+                               |
|   |                    | (Drains Microtasks!)                                 |
|   |   +---------------------------------------+                               |
|   |   | 4. POLL Phase (Heart of Event Loop)   | (Executes I/O, waits for events)|
|   |   +---------------------------------------+                               |
|   |                    | (Drains Microtasks!)                                 |
|   |   +---------------------------------------+                               |
|   |   | 5. CHECK Phase                        | (setImmediate callbacks)      |
|   |   +---------------------------------------+                               |
|   |                    | (Drains Microtasks!)                                 |
|   |   +---------------------------------------+                               |
|   |   | 6. CLOSE CALLBACKS Phase              | (socket.on('close'))          |
|   |   +---------------------------------------+                               |
|   |                    | (Drains Microtasks!)                                 |
|   +--------------------+                                                      |
|                        |                                                      |
|                  (Repeat or Exit)                                             |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?
Without a structured, phased event loop:
- Asynchronous events would fire haphazardly, interrupting synchronous computations and corrupting variable memory state.
- Timers, network packets, file reads, and system errors would compete without priority scheduling.
- Developers would be unable to predict execution order, making deterministic asynchronous programming impossible.

The Libuv phased architecture guarantees a predictable, non-blocking execution lifecycle where critical timers and I/O callbacks are processed in an orderly queue.

---

## 3. Mental Model
Think of the Event Loop as a **Multi-Car Tram on a Circular Track**:
- The tram stops at 6 designated stations in fixed order: Station 1 (Timers), Station 2 (Pending), Station 3 (Idle), Station 4 (Poll), Station 5 (Check), Station 6 (Close).
- At each station, passengers with that specific ticket board or exit.
- **The VIP Security Escalator (Microtasks):** Whenever the tram slows down between any two stations, or whenever the tram's conductor finishes a conversation (Call Stack empties), a VIP Security Escalator drops VIP guests directly onto the platform:
  - First Class VIPs: `process.nextTick` tickets.
  - Second Class VIPs: `Promise.then` tickets.
- The tram is **not allowed to move to the next station** until all VIP guests on the escalator have been completely cleared!

---

## 4. Basic Example

### Microtasks vs. Macrotasks Execution Trace
```javascript
console.log('1: Synchronous Script Start');

// Macrotask (Timers Phase)
setTimeout(() => {
  console.log('5: setTimeout (Timers Phase)');
}, 0);

// Macrotask (Check Phase)
setImmediate(() => {
  console.log('6: setImmediate (Check Phase)');
});

// Promise Microtask
Promise.resolve().then(() => {
  console.log('4: Promise.then (Microtask Queue)');
});

// NextTick Microtask (Highest VIP priority!)
process.nextTick(() => {
  console.log('3: process.nextTick (VIP Microtask)');
});

console.log('2: Synchronous Script End');

// ACTUAL OUTPUT ORDER:
// 1: Synchronous Script Start
// 2: Synchronous Script End
// 3: process.nextTick (VIP Microtask)
// 4: Promise.then (Microtask Queue)
// 5: setTimeout (Timers Phase)  [or setImmediate depending on process startup timing]
// 6: setImmediate (Check Phase)
```

---

## 5. Real Example

### Deterministic `setImmediate` vs. `setTimeout(fn, 0)` Inside I/O Callbacks
When run in the top-level main module, `setTimeout(fn, 0)` and `setImmediate(fn)` can execute in non-deterministic order depending on the machine's CPU load. However, **inside an I/O callback, `setImmediate` ALWAYS executes before `setTimeout`**!

```typescript
// demonstratingDeterministicExecution.ts
import fs from 'fs';

fs.readFile(__filename, () => {
  // We are currently inside the POLL Phase!
  console.log('1: Inside File Read Callback (POLL Phase)');

  // Schedules in Timers Phase (Next loop iteration)
  setTimeout(() => {
    console.log('3: setTimeout (TIMERS Phase)');
  }, 0);

  // Schedules in Check Phase (IMMEDIATELY following Poll Phase in current iteration!)
  setImmediate(() => {
    console.log('2: setImmediate (CHECK Phase)');
  });
});

// GUARANTEED OUTPUT:
// 1: Inside File Read Callback (POLL Phase)
// 2: setImmediate (CHECK Phase)
// 3: setTimeout (TIMERS Phase)
```

---

## 6. Under the Hood

### 1. The Poll Phase Deep Dive (The Heart of the Loop)
The **Poll Phase** has two primary responsibilities:
1. **Executing I/O Callbacks:** Processes all scripts in the poll queue until the queue is exhausted.
2. **Calculating Block Timeout:**
   - If the poll queue is empty and callbacks are scheduled in `setImmediate()` (Check Phase), the Event Loop leaves the Poll phase immediately and moves to the **Check Phase**.
   - If no `setImmediate()` callbacks exist, the Event Loop **blocks and waits** for incoming OS I/O events (network packets, file reads) until the nearest timer's threshold expires!

### 2. Node.js v11+ Microtask Timing Change
Prior to Node.js v11, Node would execute all timers in the Timers queue before running microtasks. In modern Node.js (v11 to v22+), Node.js aligns with the HTML5 browser specification: **Microtasks (Promises, nextTick) are drained immediately after every individual callback completes**, even within the same phase!

---

## 7. Important Rules
1. **`process.nextTick` Starvation Risk:** `process.nextTick()` does NOT belong to the Libuv Event Loop; it is a Node.js specific microtask queue. Recursively calling `process.nextTick()` causes **Event Loop Starvation**, permanently blocking all I/O, timers, and HTTP requests!
2. **`setTimeout(fn, 0)` Has a Minimum 1ms Threshold:** In Node.js, `setTimeout(fn, 0)` is internally normalized to `setTimeout(fn, 1)`. If the timer phase is checked before the clock advances 1 millisecond, the timer is skipped to the next loop iteration.
3. **`setImmediate` is for Immediate Post-I/O Execution:** Use `setImmediate` when you want code to execute immediately after the current Poll/I/O phase completes.
4. **Promises Run Before Macrotasks:** Even if a Promise resolves 0.001ms after a timer is registered, the Promise `.then()` callback drains before the Event Loop enters the next phase.

---

## 8. Common Mistakes

### Mistake 1: Recursive `process.nextTick` Freezing the Server
```typescript
// ❌ CRITICAL BUG: Starves the Event Loop completely!
function recursiveTick() {
  process.nextTick(recursiveTick); // Microtask queue NEVER empties!
}
recursiveTick();
// Result: Node.js CANNOT accept any HTTP requests or fire timers! Process hangs.

// ✅ FIXED: Use setImmediate to allow Event Loop to breathe between iterations
function recursiveImmediate() {
  setImmediate(recursiveImmediate); // Gives Poll and Timers phases time to execute!
}
recursiveImmediate();
```

### Mistake 2: Assuming `setTimeout(fn, 0)` Runs Synchronously
```typescript
// ❌ WRONG:
let user = null;
setTimeout(() => { user = { id: 1 }; }, 0);
console.log(user); // Output: null! setTimeout is asynchronous macrotask!
```

---

## 9. Best Practices
1. **Prefer `setImmediate()` Over `process.nextTick()`:** In 99% of application scenarios, use `setImmediate()`. It allows the Event Loop to process I/O events between iterations, preventing event loop starvation.
2. **Break Up Heavy Iterations with `setImmediate`:** When processing a massive array of 100,000 items on the main thread, chunk the array into batches of 1,000 and schedule subsequent batches with `setImmediate()` to keep the HTTP server responsive:
   ```typescript
   function processInChunks(items: any[], index: number = 0) {
     const chunk = items.slice(index, index + 1000);
     for (const item of chunk) { doWork(item); }
     if (index + 1000 < items.length) {
       setImmediate(() => processInChunks(items, index + 1000));
     }
   }
   ```
3. **Use `queueMicrotask` for Standard Web Compliance:** Instead of `process.nextTick`, use standard JavaScript `queueMicrotask()` for portable code that runs identically in both Node.js and web browsers.

---

## 10. Performance Considerations
- **Event Loop Lag:** If a single phase takes >20ms to execute, Event Loop Lag accumulates, delaying timers and causing latency spikes on incoming HTTP requests.
- **Microtask Queue Flooding:** Resolving thousands of Promises inside a single synchronous loop blocks the Event Loop from entering the Poll phase, causing network socket packet drops.

---

## 11. Security Considerations
- **Event Loop Starvation Denial of Service (DoS):** If an unauthenticated public API endpoint triggers an un-chunked synchronous computation or recursive `process.nextTick`, an attacker can freeze the entire Node.js server with a single HTTP request! Always cap computation limits.

---

## 12. Alternatives
- **Worker Threads (`worker_threads`):** If an operation cannot be broken into non-blocking chunks, move it completely off the Event Loop to an isolated Worker Thread.
- **Child Processes (`child_process.fork`):** Spawn separate OS processes for massive compute pipelines.

---

## 13. Trade-offs

| Mechanism | Queue Type | Execution Timing | Starvation Risk |
| :--- | :--- | :--- | :--- |
| **`process.nextTick()`** | VIP Microtask | Immediately after current operation | **High (Can starve loop)** |
| **`Promise.then()`** | Microtask | After nextTick queue drains | Medium |
| **`setImmediate()`** | Macrotask | In the **Check** phase of loop | **None (Allows I/O)** |
| **`setTimeout(fn, 0)`** | Macrotask | In the **Timers** phase of loop | None |

---

## 14. Real-World Usage
- **Express.js Middleware Chaining:** Asynchronous middleware chains pass control via Promises and `next()`, relying on microtask queues to sequence authentication, parsing, and route execution.
- **WebSocket Heartbeat Monitors:** Using `setInterval` in the Timers phase to ping connected clients and socket `close` callbacks in the Close phase to clean up dead sessions.

---

## 15. Placement Interview Questions

### Basic
**Q: Name the 6 phases of the Node.js Event Loop in their exact order of execution.**  
*Answer:*
1. **Timers Phase** (`setTimeout`, `setInterval`)
2. **Pending Callbacks Phase** (System I/O callbacks, e.g. TCP errors)
3. **Idle, Prepare Phase** (Internal Libuv usage only)
4. **Poll Phase** (Retrieves I/O events, executes I/O callbacks)
5. **Check Phase** (`setImmediate`)
6. **Close Callbacks Phase** (`socket.on('close')`)

### Conceptual
**Q: How does `process.nextTick()` differ from `setImmediate()`?**  
*Answer:*
- `process.nextTick()` is a **microtask** that executes immediately after the current operation finishes on the Call Stack, *before* the Event Loop continues to any subsequent phase. It has the highest execution priority and can starve the Event Loop if called recursively.
- `setImmediate()` is a **macrotask** that is queued in the **Check phase** of the Event Loop. It executes after the Poll phase, allowing other I/O events and timers to be processed between invocations.

### Implementation
**Q: What is the output of this code snippet, and why?**
```javascript
fs.readFile('test.txt', () => {
  setTimeout(() => console.log('A'), 0);
  setImmediate(() => console.log('B'));
});
```
*Answer:* The output is **strictly guaranteed** to be `B` followed by `A`. When `fs.readFile` finishes, execution is in the **Poll Phase**. After the Poll phase finishes, the very next phase in the loop cycle is the **Check Phase**, which immediately executes `setImmediate` (`B`). The timer (`A`) is queued in the **Timers Phase**, which will not execute until the Event Loop circles around to the next iteration.

### Debugging
**Q: Why is the execution order of `setTimeout(fn, 0)` and `setImmediate(fn)` non-deterministic when run at the top level of a file?**  
*Answer:* At the top level (outside an I/O callback), the execution order depends on system performance and the clock accuracy of the OS. In Node.js, `setTimeout(fn, 0)` is normalized to a 1ms timer. If the Event Loop starts in under 1ms, the timer is not ready yet, so the loop moves through Poll and hits the Check phase first (`setImmediate` runs first). If the process startup took >1ms, the timer is ready and runs first.

### Scenario
**Q: You have a batch processing script that processes 500,000 records. While running, the HTTP `/health` check fails and Kubernetes restarts the pod. How do you fix this without adding worker threads?**  
*Answer:* The batch processing loop is monopolizing the single-threaded Call Stack, starving the Event Loop and preventing incoming `/health` network requests from reaching the Poll phase. Break the batch loop into chunks of 1,000 items and yield control back to the Event Loop using `setImmediate()`. This allows the Event Loop to enter the Poll phase between chunks, process incoming `/health` HTTP requests, and prevent Kubernetes restarts.

### Advanced
**Q: How did Node.js v11 change the execution order between timers and microtasks?**  
*Answer:* Prior to Node.js v11, Node would execute all timers ready in the Timers queue before running the microtask queue. In Node.js v11 and later (aligning with the browser WHATWG standard), microtasks are executed **immediately after each individual timer callback finishes**, before the next timer in the queue runs.

---

## 16. Coding Questions

### Problem: Build a Non-Blocking Large Array Processor Using `setImmediate`
```typescript
// utils/chunkProcessor.ts

export async function processLargeArrayNonBlocking<T>(
  items: T[],
  batchSize: number,
  workerFn: (item: T) => void
): Promise<void> {
  return new Promise((resolve) => {
    let currentIndex = 0;

    function processBatch() {
      const end = Math.min(currentIndex + batchSize, items.length);

      // Process synchronous chunk
      while (currentIndex < end) {
        workerFn(items[currentIndex]);
        currentIndex++;
      }

      // Check if finished
      if (currentIndex < items.length) {
        // Yield control back to the Event Loop so I/O and HTTP requests can process!
        setImmediate(processBatch);
      } else {
        resolve();
      }
    }

    // Start first batch
    setImmediate(processBatch);
  });
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "`process.nextTick` executes in the Timers phase."  
  *Truth:* False! `process.nextTick` is not a phase of the Libuv Event Loop at all. It is a separate Node.js microtask queue that drains immediately whenever the current Call Stack empties.
- **Trap 2:** "`setTimeout(fn, 0)` executes with 0ms delay."  
  *Truth:* False. The minimum timer resolution in Node.js and browsers is 1ms.

---

## 18. Revision Summary
- The Libuv Event Loop has 6 phases: Timers, Pending, Idle/Prepare, Poll, Check, and Close.
- Microtasks (`process.nextTick` and `Promise.then`) have priority over all Event Loop phases.
- Inside an I/O callback, `setImmediate` always runs before `setTimeout(fn, 0)`.
- Never call `process.nextTick` recursively; it starves the Event Loop.
- Yield control to the Event Loop using `setImmediate` when processing large CPU iterations.

---

## 19. Quick Reference

```
+--------------------+---------------------------+-----------------------------------------------+
| Mechanism          | Execution Phase           | Typical Use Case                              |
+--------------------+---------------------------+-----------------------------------------------+
| setTimeout(fn, ms) | 1. TIMERS Phase           | Timeouts and delayed schedules                |
| I/O Callbacks      | 4. POLL Phase             | File reads, network packets, DB query returns |
| setImmediate(fn)   | 5. CHECK Phase            | Non-blocking iteration chunks; runs post-I/O  |
| socket.on('close') | 6. CLOSE Phase            | Cleanup and socket teardown                   |
| process.nextTick() | VIP Microtask (Before all)| Immediate cleanup before any phase transition |
| Promise.then()     | Standard Microtask        | Resolved asynchronous Promise logic           |
+--------------------+---------------------------+-----------------------------------------------+
```
