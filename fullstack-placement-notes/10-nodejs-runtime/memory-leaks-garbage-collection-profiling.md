# Memory Leaks, V8 Garbage Collection, and Profiling in Node.js

---

## 1. What is it?

In Node.js, application memory is managed by Google's **V8 JavaScript engine** alongside the operating system's native C++ memory allocator. Memory management is automatic via **Garbage Collection (GC)**, an internal runtime process that tracks allocated memory, identifies unreachable objects, and reclaims their space.

However, a **Memory Leak** occurs when an application unintentionally retains references to objects that are no longer needed by business logic. Because a reference path still traces back to a root object (such as the global scope or an active closure), the V8 garbage collector cannot free the memory. Over hours or days in production, memory consumption creeps upward until the process crashes with a fatal error: `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`.

```
+-------------------------------------------------------------------------------+
|                      NODE.JS OPERATING SYSTEM MEMORY LAYOUT                   |
+-------------------------------------------------------------------------------+
| Resident Set Size (RSS) - Total OS RAM occupied by the Node.js Process        |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  | V8 JavaScript Heap (Managed by V8 Garbage Collector)                    |  |
|  |  - New Space (Nursery / Intermediate): Short-lived objects (< ~64MB)   |  |
|  |  - Old Space (Old Pointer / Old Data): Long-lived objects (> ~1.4GB)    |  |
|  |  - Code Space: JIT compiled machine code instructions                   |  |
|  |  - Large Object Space: Objects exceeding size limits of normal spaces   |  |
|  +-------------------------------------------------------------------------+  |
|                                                                               |
|  +-------------------------------------------------------------------------+  |
|  | External Memory (C++ Allocations via malloc/jemalloc)                   |  |
|  |  - Node.js Buffers, SharedArrayBuffers, Socket handles, SSL contexts    |  |
|  +-------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Low-level systems programming languages (like C or C++) require manual memory allocation (`malloc`) and deallocation (`free`). Manual memory management guarantees maximum performance but leads to catastrophic software bugs: **use-after-free** vulnerabilities, **double frees**, and **dangling pointers**.

V8 provides automatic garbage collection to eliminate manual memory bugs while maximizing developer productivity. However, because V8 cannot deduce human intent (it only knows whether an object is *reachable* via a pointer chain from the root, not whether your code actually *plans to use it again*), memory profiling tools and leak detection techniques exist to debug and eliminate unintentional object retainment.

---

## 3. Mental Model

Visualize a municipal **Automated Recycling Center**:

- **Roots (The Ground Anchors)**: Global variables, the active call stack, and running timers are steel posts driven into the bedrock.
- **Reachability (The Tether Ropes)**: Every variable or property reference is a rope. If Object A references Object B, a rope connects them.
- **The Garbage Collector (The Crane)**: Periodically, a giant electromagnetic crane sweeps over the facility. It traces all ropes starting from the steel posts (Roots). Any item connected by a rope is lifted and saved. Any item lying on the floor with **no rope connected to any steel post** is swept into the incinerator.
- **A Memory Leak (A Forgotten Leash)**: You tie a balloon (a 50MB user payload) to a steel post (a global `eventEmitter` or uncleaned `setInterval`). Even though your party ended 3 weeks ago, the crane sees the rope tied to the post and refuses to touch the balloon. Thousands of balloons accumulate until the building roof collapses.

```
[ Root: Global Scope / Call Stack ]
       |
       v
  [ User Object ]
       |
       v
  [ Session Data ]
       |
       +-----> [ Unintended Map Reference ] ---> [ 50MB Buffer Leaked ]
```

---

## 4. Basic Example

### 4.1 Inspecting Memory Consumption via `process.memoryUsage()`
```typescript
// memory-inspection.ts
function logMemory(): void {
  const mem = process.memoryUsage();
  console.log({
    rss: `${(mem.rss / 1024 / 1024).toFixed(2)} MB`, // Total process memory
    heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(2)} MB`, // V8 allocated heap
    heapUsed: `${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB`, // V8 actively used heap
    external: `${(mem.external / 1024 / 1024).toFixed(2)} MB`, // C++ external objects (Buffers)
  });
}

logMemory();
// Allocate 100MB of external buffer memory
const giantBuffer = Buffer.alloc(100 * 1024 * 1024);
logMemory();
```

### 4.2 The Accidental Global Variable Leak
```typescript
function processUserData(user: { id: string; name: string }) {
  // ❌ LEAK: Missing 'const' / 'let' attaches variable directly to global object!
  // In non-strict mode, this binds to globalThis.cachedUser
  // @ts-ignore
  cachedUser = user; 
}
```

---

## 5. Real Example

### The Infamous "Meteor Closure Leak" in Production
One of the most insidious memory leaks in JavaScript occurs when closures share the same lexical context scope:

```typescript
// closure-leak.ts
import http from "node:http";

let leakyHolder: (() => void) | null = null;

function produceLeak(): void {
  // 1. A large 10MB chunk of data
  const giantData = Buffer.alloc(10 * 1024 * 1024);

  // 2. An unused function that references giantData
  const unusedFunction = function () {
    if (giantData) console.log("Using giantData");
  };

  // 3. A function that DOES NOT reference giantData, BUT shares the lexical scope
  // with unusedFunction!
  const previousHolder = leakyHolder;
  leakyHolder = function () {
    if (previousHolder) previousHolder();
  };
}

// Every time this endpoint is hit, 10MB is PERMANENTLY leaked!
// Why? V8 generates a single shared Lexical Scope object for all functions declared
// in the same parent scope. Because unusedFunction references giantData, the entire
// shared scope object retains giantData. Because previousHolder is closed over by leakyHolder,
// a linked list of shared scopes is created, pinning every single 10MB buffer in RAM!
const server = http.createServer((req, res) => {
  if (req.url === "/leak") {
    produceLeak();
    res.end(`Heap Used: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB\n`);
  } else {
    res.end("OK\n");
  }
});

server.listen(3000, () => console.log("Server running on port 3000. Hit /leak to see heap grow."));
```

---

## 6. Under the Hood

### 6.1 The Generational Hypothesis of V8 Garbage Collection
V8's GC design is founded on the **Weak Generational Hypothesis**: *The vast majority of allocated objects die young.* (e.g., local variables inside a function die the moment the function returns).

To optimize CPU usage, V8 divides its heap into two major generations:

```
+-------------------------------------------------------------------------------+
|                       V8 GENERATIONAL GARBAGE COLLECTION                      |
+-------------------------------------------------------------------------------+
| 1. YOUNG GENERATION (New Space: ~16MB - 64MB)                                 |
|    - Subdivided into two equal halves: "From-Space" and "To-Space"            |
|    - Minor GC (Scavenger / Cheney's Copying Algorithm):                       |
|      - Ultra-fast (1-3ms). Copies live objects from From-Space to To-Space.   |
|      - Swaps the roles of From and To spaces.                                 |
|      - If an object survives two Scavenge cycles, it is PROMOTED to Old Space.|
+-------------------------------------------------------------------------------+
| 2. OLD GENERATION (Old Space: ~1.4GB - 4GB+)                                  |
|    - Stores objects that have survived multiple young generation cycles.      |
|    - Major GC (Mark-Sweep-Compact Algorithm):                                 |
|      - Phase 1 (Marking): Traces root pointers, marking reachable objects.   |
|      - Phase 2 (Sweeping): Scans memory addresses; adds unreachable memory   |
|        to free-lists.                                                         |
|      - Phase 3 (Compacting): Moves scattered live objects together to         |
|        eliminate memory fragmentation.                                        |
|      - Uses "Incremental Marking" & "Concurrent Sweeping" to avoid            |
|        stopping the main JavaScript thread for long periods.                  |
+-------------------------------------------------------------------------------+
```

### 6.2 The Anatomy of a Heap Snapshot
A **Heap Snapshot** is a serialized graph representation of every JavaScript object currently in V8 memory.
Each object is called a **Node**, and each reference is called an **Edge**.

Two critical metrics appear in Heap Profilers:
1. **Shallow Size**: The byte memory directly consumed by the object itself (its own primitive properties and pointer descriptors, usually small: 32-128 bytes).
2. **Retained Size**: The total amount of memory that **would be freed if this object were deleted**. This equals the shallow size plus the size of all objects kept alive exclusively by this object down the dominator tree.

---

## 7. Important Rules

1. **Avoid Unbounded In-Memory Caching**: Never use a plain `const cache = new Map()` or `const cache = {}` without an eviction policy. In high-traffic services, caches without Least Recently Used (LRU) size limits or TTL expiration will inevitably exhaust server RAM.
2. **Always Clear Timers and Listeners on Teardown**: When removing or closing a component (e.g., closing a WebSocket or ending an HTTP stream), explicitly call `clearInterval()`, `clearTimeout()`, and `emitter.off()`.
3. **Beware of Large Objects in Closures**: Be mindful of what variables are in scope when defining functions that will be stored long-term.
4. **V8 Heap Size Defaults**: On 64-bit systems, Node.js defaults to approximately ~1.4GB - 2GB of max heap. You can expand this using the flag `--max-old-space-size=4096` (e.g., 4GB), but increasing the heap size simply delays crashes if a true memory leak exists!

---

## 8. Common Mistakes

### Mistake 1: Forgotten `setInterval` Retaining Scope
```typescript
// ❌ WRONG: Timer runs forever; closure retains 'largeUserData' indefinitely
function monitorUser(userId: string) {
  const largeUserData = fetchBigAuditHistory(userId); // 20MB
  setInterval(() => {
    // Even if user logs out, this timer ticks forever, keeping largeUserData in RAM
    pingHealthCheck(userId);
  }, 10000);
}

//  CORRECT: Store timer handle and clear on logout
function monitorUserSafe(userId: string, onLogout: EventEmitter) {
  const timer = setInterval(() => pingHealthCheck(userId), 10000);
  onLogout.once("logout", () => clearInterval(timer));
}
```

### Mistake 2: Memory Leak via Global Event Listeners
```typescript
// ❌ WRONG: Attaching a new listener to a singleton emitter on every HTTP request
const globalAlerts = new EventEmitter();

app.get("/subscribe", (req, res) => {
  // Leaks 1 listener per HTTP request!
  globalAlerts.on("alert", (msg) => res.write(msg));
});

//  CORRECT: Remove listener when HTTP client disconnects
app.get("/subscribe", (req, res) => {
  const onAlert = (msg: string) => res.write(msg);
  globalAlerts.on("alert", onAlert);

  req.on("close", () => {
    globalAlerts.off("alert", onAlert);
  });
});
```

---

## 9. Best Practices

1. **Use Weak References for Caching (`WeakMap` & `WeakSet`)**:
   `WeakMap` keys must be objects and are held *weakly*. If no other references to the key object exist, the entry is automatically collected by GC, preventing memory leaks:
   ```typescript
   const metadataCache = new WeakMap<object, UserMetadata>();
   ```
2. **Use Bound LRU Caches**: Always wrap in-memory caches with libraries like `lru-cache`:
   ```typescript
   import { LRUCache } from "lru-cache";
   const cache = new LRUCache<string, any>({ max: 5000, ttl: 1000 * 60 * 5 });
   ```
3. **Capture Heap Dumps Programmatically on High Memory Alerts**:
   Automate heap snapshot creation when `heapUsed` exceeds a danger threshold (e.g., 85% of max old space):
   ```typescript
   import v8 from "node:v8";
   import fs from "node:fs";

   function dumpHeapOnDemand() {
     const snapshotStream = v8.getHeapSnapshot();
     const fileName = `heap-${Date.now()}.heapsnapshot`;
     const fileStream = fs.createWriteStream(fileName);
     snapshotStream.pipe(fileStream);
     console.log(`Heap dump saved to ${fileName}`);
   }
   ```

---

## 10. Performance Considerations

```
+-------------------------------------------------------------------------------+
|                       GARBAGE COLLECTION PAUSE LATENCIES                      |
+-------------------------------------------------------------------------------+
| Phase                  | Mechanism           | Typical Stop-The-World Pause   |
+------------------------+---------------------+--------------------------------+
| Minor GC (Scavenge)    | Cheney Copying      | 0.5 ms - 3 ms                  |
| Major GC (Marking)     | Incremental Marking | Split into 1ms slices          |
| Major GC (Compacting)  | Pointer Relocation  | 15 ms - 150 ms (Causes lag!)   |
+------------------------+---------------------+--------------------------------+
```

- **Stop-The-World (STW) Pauses**: During compaction, V8 must momentarily pause JavaScript execution to update pointer memory addresses. Keeping your active heap clean and small ensures STW pauses remain under 5ms, preventing API latency spikes.
- **Memory Thrashing**: Rapidly creating and discarding millions of short-lived objects causes the Scavenger to run constantly, burning CPU cycles purely on garbage collection. Reuse objects or use Buffers when possible.

---

## 11. Security Considerations

1. **Denial of Service via Heap Exhaustion**: If an unauthenticated endpoint allows clients to submit arbitrarily large payloads that are retained in memory (e.g., `req.body` parsed into memory without size limits), an attacker can easily exhaust the 1.4GB heap and crash the entire service.
2. **Core Dump Data Exposure**: Heap snapshots contain everything stored in memory at that instant—including plain-text database passwords, decrypted JWT secrets, and user credit card numbers. Never store heap snapshots in public S3 buckets or unencrypted storage.

---

## 12. Alternatives & Profiling Tooling

| Tool | How It Works | Best Use Case |
| :--- | :--- | :--- |
| **Chrome DevTools (`--inspect`)** | Connects Chrome directly to Node.js V8 debugger. | Visual memory inspection and heap snapshot comparison. |
| **`v8.getHeapSnapshot()`** | Built-in Node.js API to generate `.heapsnapshot` files. | Capturing snapshots in production without restarting. |
| **Clinic.js Doctor / Flame** | Analyzes Node.js event loop delay, CPU, and memory graphs. | Automated root-cause diagnostics of memory vs event loop issues. |
| **Prometheus + Grafana** | Monitors `nodejs_heap_size_used_bytes` metric over time. | Continuous production alerting on gradual memory growth. |

---

## 13. Trade-offs

- **In-Memory Cache vs Remote Redis Cache**:
  - *In-Memory (`Map`)*: Zero network latency ($< 0.01$ms), but consumes Node.js heap and risks memory leaks.
  - *Remote Redis*: Adds $1-2$ms network latency per query, but completely isolates memory from the Node.js process, scales independently, and shares state across cluster workers.

---

## 14. Real-World Usage

- **Automated Memory Canary Alerts**: High-scale companies (Uber, Netflix) monitor the gradient (slope) of `process.memoryUsage().heapUsed` across canary deployments. If heap usage continuously slopes upward after 2 hours without stabilizing, the deployment is automatically rolled back.
- **Microservices Pod Restarts**: In Kubernetes, pods set memory limits (e.g., `resources.limits.memory: 2Gi`). If a memory leak triggers, the Linux kernel OOM-killer sends `SIGKILL`, and Kubernetes automatically restarts the pod.

---

## 15. Placement Interview Questions

### 15.1 Basic Questions
1. *What is the difference between RSS, Heap Total, and Heap Used in Node.js?*
   - Answer: `RSS` (Resident Set Size) is the total physical RAM allocated to the Node.js process by the operating system (including V8 heap, C++ external memory, code space, and thread stacks). `Heap Total` is the amount of memory V8 has allocated for its JavaScript heap. `Heap Used` is the actual memory actively occupied by JavaScript objects within that heap.
2. *What is the default heap memory limit in Node.js on a 64-bit system, and how do you increase it?*
   - Answer: The default limit is approximately 1.4GB to 2GB. It can be increased using the command-line flag `--max-old-space-size=<megabytes>` (e.g., `--max-old-space-size=4096` for 4GB).

### 15.2 Conceptual Questions
3. *Explain the Generational Hypothesis and how V8 leverages it in Garbage Collection.*
   - Answer: The Generational Hypothesis observes that most objects die shortly after creation. V8 splits heap memory into New Space (young generation) and Old Space (tenured generation). Young objects are collected frequently and rapidly using a copying Scavenger algorithm. Objects that survive multiple young cycles are promoted to Old Space, which is collected less frequently using the more expensive Mark-Sweep-Compact algorithm.
4. *What is the difference between Shallow Size and Retained Size in a Heap Snapshot?*
   - Answer: Shallow size is the direct byte memory consumed by the object itself. Retained size is the total memory freed if that object is garbage collected, including all downstream child objects that are reachable exclusively through it.

### 15.3 Implementation Questions
5. *How do you configure Node.js to automatically capture a heap snapshot right before an Out Of Memory crash occurs?*
   - Answer: Start Node.js with the V8 flag `--heapsnapshot-near-heap-limit`:
     ```bash
     node --heapsnapshot-near-heap-limit=1 app.js
     ```
     This instructs V8 to generate a `.heapsnapshot` file immediately upon approaching the heap ceiling before terminating.

### 15.4 Debugging Questions
6. *You open two heap snapshots in Chrome DevTools taken 30 minutes apart. What exact feature in Chrome DevTools do you use to locate the leaking objects?*
   - Answer: Select the second snapshot, switch the view dropdown from "Summary" to **"Comparison"**, and select the first snapshot as the baseline. Sort the table by **"# Delta"** or **"Size Delta"** in descending order. This immediately highlights the exact constructor types whose instance counts and retained memory grew abnormally between the two captures.

### 15.5 Scenario Questions
7. *Your microservice memory graph in Grafana shows a classic "sawtooth" pattern (gradual rise, sharp drop, gradual rise, sharp drop), while another microservice shows a continuous upward diagonal line without drops. Diagnose both.*
   - Answer: The "sawtooth" pattern is healthy normal behavior: memory climbs as requests are handled, and drops when V8 triggers a Major GC cycle. The continuous diagonal upward line without drops is a severe memory leak: objects are permanently retained, preventing GC from reclaiming space, leading to an eventual OOM crash.

### 15.6 Advanced Questions
8. *Why does using `WeakMap` prevent memory leaks when associating metadata with objects?*
   - Answer: `WeakMap` holds "weak" references to its keys. Unlike a standard `Map`, the presence of an object as a key in a `WeakMap` does not prevent the V8 garbage collector from reclaiming that object if all other external references are gone. Once the key object is collected, its entry in the `WeakMap` is automatically removed.

---

## 16. Coding Questions

### Problem 1: Implement an In-Memory Cache with Strict LRU Eviction and Time-To-Live (TTL)
**Question**: Write a type-safe `LRUCache<K, V>` class that stores at most $N$ entries and supports an optional TTL (in milliseconds) per key, ensuring memory never leaks.

```typescript
// lru-cache.ts
interface CacheEntry<V> {
  value: V;
  expiry: number | null;
}

export class SafeLRUCache<K, V> {
  private readonly capacity: number;
  private readonly map: Map<K, CacheEntry<V>> = new Map();

  constructor(capacity: number) {
    if (capacity <= 0) throw new Error("Capacity must be positive");
    this.capacity = capacity;
  }

  public get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    // Check TTL expiration
    if (entry.expiry !== null && Date.now() > entry.expiry) {
      this.map.delete(key);
      return undefined;
    }

    // Refresh LRU order: delete and re-insert at the end
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  public set(key: K, value: V, ttlMs?: number): void {
    // If key already exists, delete it so re-insertion updates position
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // Evict the least recently used item (the first key in Map iteration order)
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }

    const expiry = ttlMs ? Date.now() + ttlMs : null;
    this.map.set(key, { value, expiry });
  }

  public size(): number {
    return this.map.size;
  }
}

// Verification Test
const cache = new SafeLRUCache<string, number>(2);
cache.set("a", 1);
cache.set("b", 2);
cache.get("a");    // 'a' accessed, 'b' is now oldest
cache.set("c", 3); // 'b' evicted!

console.log("Has 'b' (expected undefined):", cache.get("b")); // undefined
console.log("Has 'a' (expected 1):", cache.get("a"));         // 1
console.log("Has 'c' (expected 3):", cache.get("c"));         // 3
```

---

## 17. Common Interview Traps

- **Trap 1**: "Does setting `myObject = null` immediately delete the object from memory?"
  - *Reality*: No. Setting a variable to `null` merely severs one reference. Memory is only reclaimed when the V8 Garbage Collector runs its next cycle and finds that zero remaining paths lead to that object from the roots.
- **Trap 2**: "Does increasing `--max-old-space-size` fix a memory leak?"
  - *Reality*: Absolutely not. It only increases the time it takes for the application to crash. In fact, it often makes production worse by causing longer Stop-The-World GC pauses (e.g., a 1000ms freeze on an 8GB heap).
- **Trap 3**: "Are Node.js Buffers garbage collected by V8's Scavenger?"
  - *Reality*: No. Buffer contents are stored outside the V8 heap in external C++ memory. While the small JavaScript wrapper object is collected on the heap, the raw memory is freed via native C++ finalizers.

---

## 18. Revision Summary

- **Memory Structure**: RSS (total OS RAM) = V8 Heap (New + Old Space) + External C++ Memory (Buffers) + Code/Stack.
- **Generational GC**:
  - Minor GC (Scavenger): Cleans New Space quickly using Cheney's copying algorithm.
  - Major GC (Mark-Sweep-Compact): Reclaims and defragments Old Space; uses incremental marking to reduce latency.
- **Key Leak Vectors**: Unbounded global caches, uncleared intervals/timers, dangling `EventEmitter` listeners, and lexical closure retainment.
- **Profiling Tools**: `node --inspect`, `v8.getHeapSnapshot()`, Chrome DevTools Comparison view, and `--heapsnapshot-near-heap-limit`.

---

## 19. Quick Reference

```typescript
// 1. Inspect memory usage
const { rss, heapUsed, external } = process.memoryUsage();

// 2. Programmatic Heap Dump
import v8 from "node:v8";
import fs from "node:fs";
v8.getHeapSnapshot().pipe(fs.createWriteStream("dump.heapsnapshot"));

// 3. Flags for production debugging
// node --inspect=0.0.0.0:9229 app.js
// node --max-old-space-size=2048 app.js
// node --heapsnapshot-near-heap-limit=1 app.js
```
