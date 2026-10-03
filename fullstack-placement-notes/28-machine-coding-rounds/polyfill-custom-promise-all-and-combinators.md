# Polyfill Custom Promise.all and Promise Combinators

## 1. What is it?
**Promise Combinators** are higher-order asynchronous concurrency utilities defined in the ECMAScript standard that coordinate multiple concurrent asynchronous operations (`Promise.all`, `Promise.allSettled`, `Promise.race`, and `Promise.any`). 

In senior full-stack and JavaScript machine coding rounds, implementing polyfills for these combinators from scratch is a core benchmark. Interviewers use this problem to test an engineer's mastery over:
1. Microtask execution and asynchronous control flow.
2. Handling non-Promise values (auto-wrapping via `Promise.resolve`).
3. Preserving array indexing regardless of resolution order.
4. Handling edge cases: empty iterables, synchronous throws, and fail-fast versus wait-all semantics.
5. Implementing **Promise Concurrency Pool / Limit** (controlling $N$ parallel tasks with a maximum concurrency of $K$).

```
                JAVASCRIPT PROMISE COMBINATOR BEHAVIOR
                
   Combinator           Resolves When...                 Rejects When...
  ┌───────────────────┬────────────────────────────────┬────────────────────────────┐
  │ Promise.all       │ ALL promises fulfill           │ ANY promise rejects        │
  │                   │ (Returns array of values)      │ (Fail-fast with 1st reason)│
  ├───────────────────┼────────────────────────────────┼────────────────────────────┤
  │ Promise.allSettled│ ALL promises settle (resolve/  │ NEVER rejects              │
  │                   │ reject) (Returns status array) │ (Always resolves)          │
  ├───────────────────┼────────────────────────────────┼────────────────────────────┤
  │ Promise.race      │ ANY promise settles (resolves  │ ANY promise settles        │
  │                   │ or rejects first)              │ (resolves or rejects 1st)  │
  ├───────────────────┼────────────────────────────────┼────────────────────────────┤
  │ Promise.any       │ ANY promise fulfills first     │ ALL promises reject        │
  │                   │ (Returns 1st resolved value)   │ (AggregateError)           │
  └───────────────────┴────────────────────────────────┴────────────────────────────┘
```

---

## 2. Why does it exist?
Modern distributed systems require concurrent network requests (e.g., querying 5 microservices in parallel). Managing this concurrently using raw callbacks or nested chaining leads to callback hell, race conditions, and unhandled rejections.

Combinators provide structured concurrency primitives:
- `Promise.all` optimizes total latency for dependent parallel jobs ($T_{total} = \max(T_1, T_2, \dots, T_n)$).
- `Promise.allSettled` guarantees that partial failures do not discard successful work (e.g. bulk email dispatch).
- `Promise.race` enables request timeouts.
- `Promise.any` enables high-availability fallback (e.g. querying 3 mirror CDNs and taking the fastest successful response).

---

## 3. Mental Model
Think of Promise combinators as **Olympic Track Races**:

```
                       OLYMPIC ANALOGY
                       
  🏁 Promise.all (Relay Team):
     - Every runner on the team must cross the finish line safely to win.
     - If a single runner trips and falls (rejects), the entire team is immediately
       disqualified on the spot (fail-fast).

  🏁 Promise.allSettled (Census Survey):
     - Wait until every single runner finishes or drops out.
     - Record a report card for every participant: "Finished" or "Injured".

  🏁 Promise.race (First-Across-The-Line Sprint):
     - Whoever crosses the line first wins—even if the first thing that happens is a
       runner falling over (first settled wins).

  🏁 Promise.any (First Successful Gold Medal):
     - The first runner to cleanly cross the finish line wins.
     - Disqualifications are ignored unless EVERY SINGLE runner gets disqualified.
```

---

## 4. Basic Example: Writing `Promise.all` from Scratch

```javascript
function promiseAllPolyfill(iterable) {
  return new Promise((resolve, reject) => {
    // 1. Handle non-iterable inputs
    if (iterable == null || typeof iterable[Symbol.iterator] !== 'function') {
      return reject(new TypeError('Argument must be an iterable'));
    }

    const items = Array.from(iterable);
    const results = new Array(items.length);
    let completedCount = 0;

    // 2. Handle empty iterable edge case synchronously
    if (items.length === 0) {
      return resolve([]);
    }

    // 3. Iterate over items
    items.forEach((item, index) => {
      // Must wrap in Promise.resolve to handle primitive values (e.g., numbers, strings)
      Promise.resolve(item)
        .then((value) => {
          // Store result at the EXACT ORIGINAL index, preserving order!
          results[index] = value;
          completedCount += 1;

          // When all promises have resolved, resolve the outer promise
          if (completedCount === items.length) {
            resolve(results);
          }
        })
        .catch((error) => {
          // Fail-fast: immediately reject on the FIRST error!
          reject(error);
        });
    });
  });
}
```

---

## 5. Real Example: Complete Suite of All 4 Combinators in TypeScript

```typescript
// 1. Production Promise.all Polyfill
export function myPromiseAll<T>(iterable: Iterable<T | PromiseLike<T>>): Promise<T[]> {
  return new Promise<T[]>((resolve, reject) => {
    if (iterable == null || typeof (iterable as any)[Symbol.iterator] !== 'function') {
      return reject(new TypeError('Argument is not iterable'));
    }

    const promises = Array.from(iterable);
    const results: T[] = new Array(promises.length);
    let resolvedCount = 0;

    if (promises.length === 0) {
      return resolve([]);
    }

    promises.forEach((p, idx) => {
      Promise.resolve(p).then(
        (val) => {
          results[idx] = val;
          resolvedCount++;
          if (resolvedCount === promises.length) {
            resolve(results);
          }
        },
        (err) => {
          reject(err); // First rejection terminates immediately
        }
      );
    });
  });
}

// 2. Production Promise.allSettled Polyfill
export type SettledResult<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: any };

export function myPromiseAllSettled<T>(
  iterable: Iterable<T | PromiseLike<T>>
): Promise<SettledResult<T>[]> {
  return new Promise<SettledResult<T>[]>((resolve, reject) => {
    if (iterable == null || typeof (iterable as any)[Symbol.iterator] !== 'function') {
      return reject(new TypeError('Argument is not iterable'));
    }

    const items = Array.from(iterable);
    const results: SettledResult<T>[] = new Array(items.length);
    let settledCount = 0;

    if (items.length === 0) {
      return resolve([]);
    }

    items.forEach((item, index) => {
      Promise.resolve(item)
        .then((value) => {
          results[index] = { status: 'fulfilled', value };
        })
        .catch((reason) => {
          results[index] = { status: 'rejected', reason };
        })
        .finally(() => {
          settledCount++;
          if (settledCount === items.length) {
            resolve(results);
          }
        });
    });
  });
}

// 3. Production Promise.race Polyfill
export function myPromiseRace<T>(iterable: Iterable<T | PromiseLike<T>>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (iterable == null || typeof (iterable as any)[Symbol.iterator] !== 'function') {
      return reject(new TypeError('Argument is not iterable'));
    }

    const items = Array.from(iterable);

    // Note: An empty iterable in Promise.race remains pending forever!
    items.forEach((item) => {
      Promise.resolve(item).then(resolve, reject);
    });
  });
}

// 4. Production Promise.any Polyfill
export function myPromiseAny<T>(iterable: Iterable<T | PromiseLike<T>>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (iterable == null || typeof (iterable as any)[Symbol.iterator] !== 'function') {
      return reject(new TypeError('Argument is not iterable'));
    }

    const items = Array.from(iterable);
    const errors: any[] = new Array(items.length);
    let rejectedCount = 0;

    if (items.length === 0) {
      return reject(new AggregateError([], 'All promises were rejected'));
    }

    items.forEach((item, index) => {
      Promise.resolve(item).then(
        (value) => {
          resolve(value); // Resolves on FIRST fulfillment!
        },
        (error) => {
          errors[index] = error;
          rejectedCount++;
          if (rejectedCount === items.length) {
            reject(new AggregateError(errors, 'All promises were rejected'));
          }
        }
      );
    });
  });
}
```

---

## 6. Under the Hood: V8 Microtask Queue and Internal Promise Reaction

```
              V8 EVENT LOOP & PROMISE REACTION RECORDS
              
  [ CALL STACK ]                  [ MICROTASK QUEUE ]
  promiseAllPolyfill() ─────────► [ PromiseReactionJob (resolve #1) ]
  Promise.resolve(item)            [ PromiseReactionJob (resolve #2) ]
  forEach loop completes           [ PromiseReactionJob (reject #3)  ]
         │                                   │
         ▼                                   ▼
  Stack Empty ────────────────────► Execute Microtasks in order!
                                    - Increments completedCount
                                    - Sets results[idx] = val
                                    - Triggers outer resolve/reject
```

1. **PromiseReaction Objects:**
   When you invoke `.then(onFulfilled, onRejected)` on a Promise, V8 allocates an internal `PromiseReaction` record and attaches it to the Promise's reaction list.
2. **Microtask Queue Enqueueing:**
   When the asynchronous operation settles, V8 creates a `PromiseReactionJob` and places it onto the **Microtask Queue**.
3. **Execution Order Guarantee:**
   Microtasks run immediately after the current synchronous script execution frame completes and before any Macrotasks (like `setTimeout` or I/O callbacks) or browser rendering ticks can execute.

---

## 7. Important Rules

1. **Preserve Array Ordering:**
   In `Promise.all` and `Promise.allSettled`, the returned array index **must match the input array index**, NOT the order in which the promises resolved! Use `results[index] = value;`, never `results.push(value);`.
2. **Handle Non-Promise Values:**
   The iterable may contain primitive numbers, strings, or plain objects: `Promise.all([1, 'hello', Promise.resolve(2)])`. Always wrap each element in `Promise.resolve(item)`.
3. **Handle Empty Iterable Edge Case:**
   - `Promise.all([])` resolves **immediately** to `[]`.
   - `Promise.allSettled([])` resolves **immediately** to `[]`.
   - `Promise.any([])` rejects **immediately** with `AggregateError`.
   - `Promise.race([])` **remains pending forever** per ECMAScript specification!
4. **Reject with the First Reason:**
   In `Promise.all`, the outer promise must reject with the error of the *first* promise that rejects, ignoring any subsequent resolutions or rejections.

---

## 8. Common Mistakes

```javascript
// ❌ MISTAKE 1: Using results.push() inside .then()
// Broken! Fast promises will end up at the front, destroying index order!
items.forEach(p => {
  Promise.resolve(p).then(val => results.push(val));
});

// ❌ MISTAKE 2: Checking results.length === items.length
// Broken! In JavaScript, sparse arrays have length even if slots are empty:
// const arr = []; arr[5] = 'x'; arr.length is 6, but only 1 promise finished!
// Fix: Use an explicit integer counter: completedCount += 1.

// ❌ MISTAKE 3: Not wrapping with Promise.resolve
// items.forEach(item => item.then(...)) -> CRASHES if item is a number!
```

---

## 9. Best Practices
1. **Support Any Iterable (Not Just Arrays):** Use `Array.from(iterable)` or `for...of` so the polyfill works on Sets, Maps, and custom generators.
2. **Defend Against Prototype Pollution:** Polyfills should be isolated or assigned using `Object.defineProperty` if attaching to the global `Promise` constructor.
3. **AggregateError Polyfill:** If running in an older environment where `AggregateError` is not defined globally, provide a fallback class extending `Error`.

---

## 10. Performance Considerations

| Combinator | Concurrency Model | Memory Footprint | Network Utilization |
|---|---|---|---|
| `Promise.all` | All in parallel | Allocates result array of size $N$ | High simultaneous burst |
| `Promise.allSettled` | All in parallel | Allocates object wrappers for all $N$ | High simultaneous burst |
| `Promise.race` | All in parallel | Lowest (settles on 1st reaction) | Wasted bandwidth on discarded calls |
| `Promise.any` | All in parallel | Allocates errors array on failure | Wasted bandwidth on discarded calls |

---

## 11. Security Considerations
- **Resource Starvation (DOS via Unbounded `Promise.all`):** Calling `Promise.all(urls.map(fetch))` with 10,000 URLs will exhaust OS socket handles, saturate memory, and trigger rate limiting. Always use a **Concurrency Pool / Rate Limiter** (e.g., `p-limit`).
- **Unhandled Rejection Leaks:** In `Promise.race` and `Promise.any`, discarded promises continue running in the background. If one rejects later, ensure error handlers are attached or use `AbortController` to cancel discarded in-flight HTTP requests.

---

## 12. Alternatives
1. **Sequential Async Iteration (`for...of` with `await`):** When tasks depend on prior results or memory is strictly constrained.
2. **Worker Pool Concurrency:** When parallel tasks are CPU-bound rather than I/O-bound (Node.js `worker_threads`).
3. **Reactive Streams (RxJS):** When asynchronous events are continuous streams rather than single-shot operations.

---

## 13. Trade-offs

| Strategy | Advantages | Trade-offs |
|---|---|---|
| **Unbounded `Promise.all`** | Maximum throughput, lowest total latency | High memory spikes, can crash network sockets |
| **Sequential `for...await`** | Minimum memory usage, predictable order | Maximum latency ($T_{total} = \sum T_i$), underutilizes CPU/network |
| **Concurrency Pool ($K$ at a time)** | Ideal balance of speed and stability | Slightly more code complexity |

---

## 14. Real-World Usage
- **Next.js Server Components:** Executing parallel database queries in Server Components using `await Promise.all([fetchUser(), fetchPosts(), fetchComments()])`.
- **E-Commerce Order Checkout:** Using `Promise.allSettled` when sending notifications (SMS, Email, Push Notifications) so a failure in SMS does not fail email delivery.

---

## 15. Placement Interview Questions

### Basic
1. *What is the fundamental difference between `Promise.all` and `Promise.allSettled`?*
   - **Answer:** `Promise.all` short-circuits (fails fast) as soon as any single promise rejects, discarding pending results. `Promise.allSettled` never rejects; it waits for all input promises to settle and returns an array of status objects detailing the outcome of each.

### Conceptual
2. *Why does `Promise.race([])` remain pending forever according to the ES6 specification?*
   - **Answer:** `Promise.race` settles when the *first* promise settles. If the iterable is empty, there is no first promise to resolve or reject, so it remains in the pending state permanently.

### Implementation
3. *Why must you use an explicit counter (`completedCount++`) instead of `results.length === items.length` when implementing `Promise.all`?*
   - **Answer:** Because promises resolve asynchronously in arbitrary order. If promise at index 3 resolves first, setting `results[3] = value` expands `results.length` to 4 immediately on a sparse array, even though indices 0, 1, and 2 have not completed.

### Debugging
4. *In your `Promise.all` polyfill, `results.push(val)` was used inside `.then()`. What bug does this introduce?*
   - **Answer:** It corrupts index order. If the input is `[slowPromise, fastPromise]`, `fastPromise` will resolve first and be pushed to index 0, violating the guarantee that the output array preserves the input's original positions.

### Scenario
5. *You need to download 50,000 images from S3. Why will `Promise.all` crash your server, and how do you fix it?*
   - **Answer:** `Promise.all` will create 50,000 simultaneous sockets, exhausting file descriptors and triggering `EMFILE: too many open files` or running out of memory. Fix by implementing a promise concurrency limiter (batching or worker pool) that runs a maximum of 20 to 50 concurrent downloads at any given time.

### Advanced
6. *How does `Promise.any` handle errors differently from `Promise.all`?*
   - **Answer:** `Promise.any` ignores rejections until *every single* input promise has rejected. If all reject, it rejects with a native `AggregateError` containing an array of all rejection reasons in their original index order.

---

## 16. Coding Questions

### Problem: Implement a Promise Concurrency Pool (`promiseLimit`)
Write a TypeScript function that takes an array of asynchronous task factories and a concurrency limit $K$, executing them so that **no more than $K$ promises run in parallel at any given instant**.

```typescript
type Task<T> = () => Promise<T>;

export async function promisePool<T>(tasks: Task<T>[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextTaskIndex = 0;
  let activeWorkers = 0;

  return new Promise<T[]>((resolve, reject) => {
    if (tasks.length === 0) {
      return resolve([]);
    }

    // Worker function that continuously pulls the next available task
    function runNext() {
      // Check if all tasks have been picked up and finished
      if (nextTaskIndex >= tasks.length && activeWorkers === 0) {
        return resolve(results);
      }

      while (activeWorkers < limit && nextTaskIndex < tasks.length) {
        const currentIndex = nextTaskIndex;
        const currentTask = tasks[currentIndex];
        nextTaskIndex++;
        activeWorkers++;

        // Execute task
        currentTask()
          .then((val) => {
            results[currentIndex] = val;
          })
          .catch((err) => {
            // Terminate entire pool on error (or handle according to strategy)
            reject(err);
          })
          .finally(() => {
            activeWorkers--;
            runNext(); // Immediately trigger next task in queue
          });
      }
    }

    // Kick off initial batch of K workers
    runNext();
  });
}
```

---

## 17. Common Interview Traps
- **Trap 1:** Forgetting to wrap elements in `Promise.resolve(item)`.
  *Reality:* If an interviewer passes `[Promise.resolve(1), 2, 3]`, calling `item.then()` will throw `TypeError: item.then is not a function`.
- **Trap 2:** Not handling `new Promise` synchronous throwing.
  *Reality:* If the input iterable throws during iteration, the polyfill should reject the returned promise, not crash the synchronous stack.
- **Trap 3:** Using `Promise.any` and rejecting with a plain `Error` instead of `AggregateError`.

---

## 18. Revision Summary
- **`Promise.all`:** Resolves when all fulfill; rejects on first rejection.
- **`Promise.allSettled`:** Resolves when all finish, returning an array of `{ status, value/reason }`.
- **`Promise.race`:** Settles as soon as the first promise settles (resolves or rejects).
- **`Promise.any`:** Resolves on first fulfillment; rejects with `AggregateError` only if all reject.
- **Implementation Rules:** Always preserve indices with `results[index] = val;`, wrap with `Promise.resolve()`, and check `completedCount === items.length`.

---

## 19. Quick Reference

```
┌─────────────────────┬───────────────────┬───────────────────┬─────────────────────┐
│ COMBINATOR          │ RESOLVES IF       │ REJECTS IF        │ EMPTY ITERABLE []   │
├─────────────────────┼───────────────────┼───────────────────┼─────────────────────┤
│ Promise.all         │ All fulfill       │ Any 1 rejects     │ Resolves [] (sync)  │
│ Promise.allSettled  │ All settle        │ Never rejects     │ Resolves [] (sync)  │
│ Promise.race        │ First settles     │ First settles     │ Remains PENDING     │
│ Promise.any         │ First fulfills    │ All reject        │ Rejects AggregateErr│
└─────────────────────┴───────────────────┴───────────────────┴─────────────────────┘
```
