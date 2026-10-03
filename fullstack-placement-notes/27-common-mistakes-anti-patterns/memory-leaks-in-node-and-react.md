# Memory Leaks in Node.js and React: Anti-Patterns and Profiling

## 1. What is it?
A **Memory Leak** occurs when an application allocates memory on the JavaScript engine's heap but fails to release or reclaim it after the memory is no longer needed. Because an unintended, lingering reference remains reachable from the **Root Set** (e.g., the global `window` object in browsers or `global`/module scope in Node.js), the V8 Garbage Collector cannot free the associated memory blocks.

Over time, leaked objects accumulate. In **React applications**, this leads to browser tab bloat, dropped frame rates (jank), sluggish DOM manipulation, and eventual browser tab crashes ("Aw, Snap!"). In **Node.js production servers**, continuous memory leakage forces frequent Garbage Collection pauses (blocking the single-threaded Event Loop), exponentially degrades latency, exhausts container RAM, and terminates the service with a fatal error: `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`.

```
        V8 HEAP REACHABILITY: WHY MEMORY CANNOT BE FREED
        
        [ GC ROOT: global / window / Active Closures ]
                          │
                          ▼
            [ Global Event Listener / Cache Map ]
                          │
                          ▼ (Retaining Reference)
               [ Leaked Component / Huge Buffer ]
                          │
        ┌─────────────────┴─────────────────┐
        ▼                                   ▼
  [ 50 MB Raw JSON ]                [ Detached DOM Tree ]
  
  Even though the React component unmounted or the HTTP request completed,
  the retaining path from the GC ROOT prevents V8 from freeing this memory!
```

---

## 2. Why does it exist?
1. **Implicit Closure Scope Retention:**
   JavaScript closures retain lexical environment references. When an inner function captures an outer variable, the V8 engine preserves the enclosing scope context. If the inner function is registered to a long-lived object (like a global event emitter), everything captured remains pinned in memory indefinitely.
2. **Missing Cleanup Functions in React Hooks:**
   In React, `useEffect` hooks that instantiate subscriptions (`setInterval`, `window.addEventListener`, WebSockets) without returning a cleanup function leave the subscription alive long after the component unmounts.
3. **Unbounded In-Memory Caches in Node.js:**
   Using a plain JavaScript `const cache = new Map()` or object literal without an eviction policy (like LRU) or TTL ensures that memory usage grows monotonically with every incoming request.
4. **Node.js `EventEmitter` Listener Accumulation:**
   Registering listeners (`emitter.on('event', fn)`) on long-lived singleton services per incoming HTTP request without calling `emitter.off()` causes the listener array to grow indefinitely, eventually triggering: `MaxListenersExceededWarning`.

---

## 3. Mental Model
Think of memory allocation as **Checking Out Books from a Public Library**:

```
                       LIBRARY ANALOGY
                       
  ✅ Normal Memory Lifecycle:
     - You borrow 5 books to study a topic (Allocating memory for an HTTP request).
     - You finish the project and return the books to the librarian (GC reclaims memory).
     - The shelves remain clear for the next patron.

  ❌ The Memory Leak (Forgotten Lockbox):
     - You borrow 50 encyclopedias every hour.
     - Instead of returning them, you stack them in a locked storage closet with your
       name on it (An uncleared closure or global Map).
     - The library never gets those books back.
     - Soon, the entire library runs completely out of shelf space and must shut down.
```

---

## 4. Basic Example

### The React Leak: Uncleared `setInterval` and Missing Cleanup
```tsx
// ❌ ANTI-PATTERN: Leaks timer closure on every mount/unmount cycle
import React, { useState, useEffect } from 'react';

export function StockTickerBad() {
  const [price, setPrice] = useState(100);

  useEffect(() => {
    // Timer is created, but no cleanup function is returned!
    setInterval(() => {
      setPrice(prev => prev + (Math.random() * 2 - 1));
      console.log('Ticker running...');
    }, 1000);
  }, []); // Every time component remounts, a NEW interval runs forever!

  return <div>Current Price: {price.toFixed(2)}</div>;
}

// ✅ FIXED: Return a cleanup function to clear timer on unmount
export function StockTickerFixed() {
  const [price, setPrice] = useState(100);

  useEffect(() => {
    const timerId = setInterval(() => {
      setPrice(prev => prev + (Math.random() * 2 - 1));
    }, 1000);

    // V8 can safely garbage collect the timer and captured closure
    return () => clearInterval(timerId);
  }, []);

  return <div>Current Price: {price.toFixed(2)}</div>;
}
```

---

## 5. Real Example: Node.js Memory Leak via Unbounded Request Cache & Event Emitter

### The Anti-Pattern: Memory Leak in Express Request Tracking
```typescript
import express from 'express';
import { EventEmitter } from 'events';

const app = express();
const globalNotifier = new EventEmitter();

// ❌ ANTI-PATTERN 1: Unbounded In-Memory Cache
const userSessionCache = new Map<string, any>();

// ❌ ANTI-PATTERN 2: Adding listener per request to global singleton
app.get('/api/analytics', (req, res) => {
  const requestId = req.headers['x-request-id'] as string;
  const hugePayload = Buffer.alloc(10 * 1024 * 1024); // 10 MB payload

  // Storing in unbounded cache - never cleared!
  userSessionCache.set(requestId, hugePayload);

  // Registering listener to long-lived singleton on EVERY request:
  globalNotifier.on('audit', () => {
    // Closure retains hugePayload and requestId!
    console.log(`Audited request: ${requestId}, size: ${hugePayload.length}`);
  });

  res.json({ status: 'Processed' });
});
```

### The Fix: LRU Cache and Single Event Listener Architecture
```typescript
import express from 'express';
import { EventEmitter } from 'events';
import { LRUCache } from 'lru-cache'; // Bound memory via LRU

const app = express();
const globalNotifier = new EventEmitter();

// ✅ FIXED 1: Bounded LRU Cache with Max Size and TTL
const userSessionCache = new LRUCache<string, Buffer>({
  max: 100, // Maximum 100 entries
  ttl: 1000 * 60 * 5, // 5-minute TTL
  maxSize: 50 * 1024 * 1024, // Maximum 50 MB total memory footprint
  sizeCalculation: (val) => val.length
});

// ✅ FIXED 2: Single Global Listener Pattern (Zero per-request listener leakage)
globalNotifier.on('audit', ({ requestId, size }: { requestId: string; size: number }) => {
  console.log(`Audited request: ${requestId}, size: ${size}`);
});

app.get('/api/analytics', (req, res) => {
  const requestId = (req.headers['x-request-id'] as string) || Math.random().toString();
  const hugePayload = Buffer.alloc(1024); // Reasonable allocation

  userSessionCache.set(requestId, hugePayload);

  // Emit event passing data as parameters, no new closure allocation!
  globalNotifier.emit('audit', { requestId, size: hugePayload.length });

  res.json({ status: 'Processed' });
});
```

---

## 6. Under the Hood: V8 Garbage Collection Mechanics

### How V8 Reclaims Memory: Generational Hypothesis

```
                     V8 HEAP MEMORY ARCHITECTURE
                     
  ┌─────────────────────────────────────────────────────────────┐
  │                      TOTAL HEAP SPACE                       │
  │                                                             │
  │  ┌────────────────────────┐    ┌─────────────────────────┐  │
  │  │    NEW GENERATION      │    │     OLD GENERATION      │  │
  │  │    (Young Space)       │    │     (Old Space)         │  │
  │  │  ┌────────┬─────────┐  │    │  ┌───────────────────┐  │  │
  │  │  │ Nursery│ From/To │  │    │  │ Survives 2 GCs    │  │  │
  │  │  │ 1-64MB │ (Semi)  │  │    │  │ Up to 1.4 - 4 GB  │  │  │
  │  │  └────────┴─────────┘  │    │  └───────────────────┘  │  │
  │  │     Scavenger GC       │    │   Major GC (Mark-Sweep- │  │
  │  │   Fast, Minor Stop     │    │         Compact)        │  │
  │  └───────────┬────────────┘    └─────────────▲───────────┘  │
  │              │                               │              │
  │              └─────── Object Survives ───────┘              │
  │                       (Promotion)                           │
  └─────────────────────────────────────────────────────────────┘
```

1. **Young Generation (Scavenger / Minor GC):**
   - New objects are allocated in the Young Space.
   - Most objects die young (temporary variables, JSON parse trees).
   - Scavenger copies live objects between "From" and "To" semi-spaces, taking only 1–3 milliseconds.
2. **Old Generation (Major GC: Mark-Sweep-Compact):**
   - Objects that survive two consecutive Minor GCs are **promoted** to the Old Space.
   - When Old Space fills up, V8 runs a **Major GC**:
     - **Marking:** Traverses the graph from the Root Set (globals, stack frames, DOM nodes). Live objects are marked.
     - **Sweeping:** Frees memory blocks occupied by un-marked objects.
     - **Compacting:** Moves live objects together to defragment heap memory.
3. **The Cause of the Crash:**
   If an application holds references to leaked objects in the Old Space, Major GC executes repeatedly (`Ineffective mark-compacts`), consuming 100% CPU on GC threads and eventually terminating the process.

---

## 7. Important Rules

1. **Always Return Cleanup Functions in `useEffect`:**
   Every subscription, event listener, timer, or WebSocket created inside `useEffect` must be torn down in the returned cleanup callback.
2. **Never Use Unbounded Objects as Caches:**
   Never use `const cache = {}` or `new Map()` globally. Always use an `LRUCache` with explicit `max` size and TTL constraints.
3. **Be Vigilant with Detached DOM Nodes:**
   Holding a reference to a DOM element in a JavaScript variable (e.g., `window.myButton = document.getElementById('btn')`) prevents the browser from freeing the entire DOM tree even after calling `parent.removeChild(myButton)`.
4. **Remove Listeners in Class and EventEmitter Patterns:**
   Pair every `.on('event', handler)` or `addEventListener` with an identical `.off('event', handler)` or `removeEventListener`.

---

## 8. Common Mistakes

```typescript
// ❌ MISTAKE 1: Arrow function as event listener without cleanup reference
useEffect(() => {
  // Creating an anonymous arrow function inline means removeEventListener cannot match it!
  window.addEventListener('resize', () => handleResize());
  
  return () => {
    // DOES NOTHING: Different function reference! The listener leaks forever!
    window.removeEventListener('resize', () => handleResize());
  };
}, []);

// ❌ MISTAKE 2: Leaking closures through Promise chains or global handlers
let leakingRef: any = null;
function processLargeData() {
  const massiveData = new Array(1000000).fill('leak');
  leakingRef = function() {
    // Retains massiveData in memory forever because leakingRef is global!
    return massiveData.length;
  };
}

// ❌ MISTAKE 3: React state update on unmounted component
// Can hold references and triggers: "Can't perform a React state update on an unmounted component"
```

---

## 9. Best Practices

1. **WeakRef and WeakMap for Ephemeral Caching:**
   Use `WeakMap` or `WeakSet` when associating metadata with objects or DOM elements. `WeakMap` keys are weakly held; when the key object has no other references, V8 reclaims both key and value automatically.
2. **Take Heap Dumps Using Chrome DevTools / `--inspect`:**
   Start Node with `node --inspect server.js`. Connect via `chrome://inspect` and record **Heap Snapshots** before and after load testing. Compare snapshots to find growing constructors.
3. **Monitor Process Memory in Production:**
   ```typescript
   setInterval(() => {
     const memoryUsage = process.memoryUsage();
     console.log({
       rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`,
       heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
       heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`
     });
   }, 30000);
   ```

---

## 10. Performance Considerations

| Metric | Healthy V8 Heap | Leaking V8 Heap |
|---|---|---|
| **Memory Growth Shape** | Sawtooth pattern (rises, then drops after GC) | Continuous upward slope (staircase) |
| **GC Pause Latency** | < 5 ms (Concurrent/Incremental GC) | 500 ms - 3000 ms (Blocking Event Loop) |
| **CPU Utilization** | Normal workload | 100% spent in GC threads (`mark-compact`) |
| **RSS (Resident Set Size)** | Constant within container bounds | Exceeds cgroup limit, triggers Linux OOM killer |

---

## 11. Security Considerations
- **Denial of Service via Heap Exhaustion:** An attacker can intentionally trigger endpoints that leak memory (e.g. sending 10,000 unique search queries to an unbounded cache), crashing the server and causing downtime.
- **Resource Starvation in Multi-Tenant Containers:** A leaking microservice shares physical RAM with other services on a Kubernetes node, causing the Linux kernel OOM killer to terminate neighboring pods.

---

## 12. Alternatives
1. **Redis for Out-of-Process Caching:** Move all caching out of the Node.js process heap into an external Redis or Memcached cluster. This guarantees that your Node.js heap remains tiny and predictable.
2. **Worker Threads for Heavy Data Processing:** Execute memory-intensive tasks (image resizing, PDF generation) inside short-lived Worker Threads (`worker_threads`). Terminating the worker immediately releases all allocated memory back to the OS.

---

## 13. Trade-offs

| Strategy | Advantages | Trade-offs |
|---|---|---|
| **In-Memory Cache (LRU)** | Sub-millisecond latency (no network) | Limited by single Node.js process memory ceiling (typically 1.4GB default). |
| **External Redis Cache** | Scalable, centralized, survives server restarts | Adds 1–2ms network latency per read/write; network serialization overhead. |
| **`WeakMap` Usage** | Zero memory leak potential (automatic GC) | Keys MUST be Objects; cannot be enumerated (`.keys()` or `.size` not available). |

---

## 14. Real-World Usage
- **Netflix & Slack:** Automated production Canary deployments with heap profiling. If memory usage of a new release does not stabilize into a sawtooth pattern after 2 hours, the deployment is automatically rolled back.
- **Meta (Facebook Web):** Utilizes MemLab (open-source E2E memory leak testing framework) in CI to catch detached DOM nodes and uncleared React closures before code reaches production.

---

## 15. Placement Interview Questions

### Basic
1. *What is a memory leak in JavaScript, and why doesn't the Garbage Collector catch it?*
   - **Answer:** A memory leak occurs when memory that is no longer required is still referenced by reachable variables from the GC Root (like global scope, event listeners, or closures). Because V8 uses reachability algorithms (Mark-and-Sweep), any object with an active reference path from the root is considered "live" and cannot be collected.

### Conceptual
2. *Explain the difference between Scavenge (Minor GC) and Mark-Sweep-Compact (Major GC) in the V8 engine.*
   - **Answer:** Scavenge operates on the Young Generation using two semi-spaces (From/To) to rapidly collect short-lived objects. Mark-Sweep-Compact operates on the Old Generation for promoted long-lived objects. It marks live nodes, sweeps away dead blocks, and compacts the heap to prevent memory fragmentation.

### Implementation
3. *How do you reliably remove a window event listener inside a React `useEffect` hook?*
   - **Answer:** Declare a stable function reference inside the hook or wrap an external function in `useCallback`. Pass that identical reference to `addEventListener`, and pass it to `removeEventListener` inside the cleanup return function:
     ```typescript
     useEffect(() => {
       const handler = (e: MouseEvent) => console.log(e.clientX);
       window.addEventListener('mousemove', handler);
       return () => window.removeEventListener('mousemove', handler);
     }, []);
     ```

### Debugging
4. *Your Node.js microservice crashes every 3 days with `Allocation failed - JavaScript heap out of memory`. How do you identify the root cause?*
   - **Answer:**
     1. Start Node with `--max-old-space-size` and `--inspect`, or use the `heapdump` package to trigger heap snapshots on demand.
     2. Take Snapshot 1 immediately after server boot.
     3. Apply synthetic load via Artillery/k6 and take Snapshot 2.
     4. Compare the two snapshots in Chrome DevTools under the **Comparison** view.
     5. Sort by **# Delta** and **Retained Size** to find which constructor (e.g. `Closure`, `Array`, `MapEntry`) is growing continuously without being freed.

### Scenario
5. *You notice that an image gallery modal in a React single-page app makes the browser slower the more times the user opens and closes it. What is happening?*
   - **Answer:** The modal is leaving detached DOM elements or image buffer references alive. Possible culprits include:
     1. Event listeners registered to `document` or `window` on modal open without removal on close.
     2. Storing image URLs or DOM elements in a global Redux/Zustand store or module-level array.
     3. An active canvas context or animation loop (`requestAnimationFrame`) not cancelled on close.

### Advanced
6. *What are "Detached DOM Nodes" and how do they cause memory leaks?*
   - **Answer:** A detached DOM node is a DOM element that has been removed from the visible document DOM tree (e.g. via `element.remove()`), but is still referenced by a JavaScript variable. Because DOM nodes have internal C++ references to their parent and child trees, retaining a single detached `<li>` node can keep the entire detached `<ul>`, surrounding `<div>`s, and all child nodes in memory.

---

## 16. Coding Questions

### Problem: Build a Leak-Free Safe Event Emitter Hook for React
Write a production-ready custom hook `useEventListener` in TypeScript that attaches an event listener to any target (window, document, or HTML element) and guarantees zero memory leaks even if the handler function changes on every render.

```typescript
import { useEffect, useRef } from 'react';

export function useEventListener<K extends keyof WindowEventMap>(
  eventName: K,
  handler: (event: WindowEventMap[K]) => void,
  element: Window = window,
  options?: boolean | AddEventListenerOptions
): void {
  // Create a ref to store the latest handler function
  const savedHandler = useRef(handler);

  // Update ref.current value if the handler changes
  // This allows the event listener to always invoke the latest logic
  // WITHOUT re-registering the DOM listener on every render!
  useEffect(() => {
    savedHandler.current = handler;
  }, [handler]);

  useEffect(() => {
    // Ensure target supports addEventListener
    const isSupported = element && element.addEventListener;
    if (!isSupported) return;

    // Create event listener that calls function stored in ref
    const eventListener = (event: Event) => {
      savedHandler.current(event as WindowEventMap[K]);
    };

    element.addEventListener(eventName, eventListener, options);

    // Guaranteed cleanup: removes the listener when component unmounts
    // or when the eventName/element changes
    return () => {
      element.removeEventListener(eventName, eventListener, options);
    };
  }, [eventName, element, options]);
}
```

---

## 17. Common Interview Traps
- **Trap 1:** Believing setting `variable = null` immediately forces the Garbage Collector to run.
  *Reality:* Setting a reference to `null` merely makes the object unreachable. The Garbage Collector runs autonomously according to its own internal heuristics and memory thresholds. You cannot force GC in standard browser JavaScript.
- **Trap 2:** Assuming modern React function components cannot leak memory like class components with `componentDidMount`.
  *Reality:* Function components leak memory just as easily if `useEffect` callbacks instantiate intervals, observers (`IntersectionObserver`), or socket connections without cleanup returns.
- **Trap 3:** Confusing **Shallow Size** with **Retained Size** in Chrome DevTools heap profiles.
  *Reality:* Shallow size is the memory directly allocated by the object itself (e.g. primitive fields). Retained size is the total memory freed if that object is deleted (including all children it exclusively retains). Always optimize for Retained Size.

---

## 18. Revision Summary
- **Root Cause:** A memory leak is an unintended retaining path from a GC Root to an unused object.
- **React Patterns:** Always return a cleanup function in `useEffect` for `setInterval`, `addEventListener`, and subscriptions.
- **Node.js Patterns:** Never use unbounded Maps or global object literals for caching; use an LRU Cache with explicit size bounds.
- **Profiling Workflow:** Use Chrome DevTools Heap Snapshots under the **Comparison View** to inspect constructor deltas and retaining trees.

---

## 19. Quick Reference

```
┌──────────────────────────────────────┬──────────────────────────────────────────┐
│ COMMON LEAK PATTERN                  │ LEAK-FREE REMEDIATION                    │
├──────────────────────────────────────┼──────────────────────────────────────────┤
│ setInterval in useEffect             │ return () => clearInterval(timerId)      │
│ window.addEventListener              │ Pass stable reference + remove in cleanup│
│ Unbounded Global Map Cache           │ Use LRUCache with max size and TTL       │
│ WebSocket / SSE Subscription         │ socket.disconnect() on component unmount │
│ Event listener on singleton Emitter  │ Remove listener or emit data by value    │
│ Detached DOM tree retained by JS     │ Set DOM references to null on removal    │
└──────────────────────────────────────┴──────────────────────────────────────────┘
```
