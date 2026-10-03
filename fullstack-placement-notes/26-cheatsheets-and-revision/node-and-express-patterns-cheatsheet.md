# Node.js & Express Architectural Patterns Cheatsheet

---

## 1. What is it?

The Node.js and Express Architectural Patterns Cheatsheet is a high-yield technical blueprint and implementation reference covering production-grade patterns in Node.js backend engineering. It compiles battle-tested patterns for **middleware pipelines**, **centralized asynchronous error handling**, **stream backpressure management**, **Event Emitter subscription lifecycles**, **distributed request tracing via `AsyncLocalStorage`**, **Libuv thread pool tuning**, and **zero-downtime graceful shutdown protocols**.

```
+-----------------------------------------------------------------------------------+
|                     Node.js & Express Production Pattern Stack                    |
+-----------------------------------------------------------------------------------+
| Architectural Patterns: Controller-Service-Repository (3-Tier Layering)          |
| Middleware Chain:       Auth Guard -> Rate Limiter -> Zod Validator -> Controller|
| Error Pipeline:         AsyncWrapper -> Domain Exceptions -> 4-Arg Error Handler  |
| Stream Processing:      pipeline(Readable, Transform, Writable) + Backpressure    |
| Context Propagation:    AsyncLocalStorage (Trace IDs, Tenant Context)             |
| Concurrency & Worker:   Cluster Mode / PM2, worker_threads for CPU Math           |
| Process Lifecycle:      Graceful Drain (SIGTERM/SIGINT -> Stop Listen -> Close DB)|
+-----------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Naive Node.js and Express codebases inevitably degrade under production scale:
1. **Uncaught Async Rejections:** Express 4 does not automatically catch rejected promises inside async route handlers, leading to unhandled rejections that terminate the entire Node.js OS process (`ERR_UNHANDLED_REJECTION`).
2. **"Spaghetti Controllers":** Mixing database queries, authentication checks, validation logic, and HTTP formatting in a single 400-line route handler destroys testability and breaks separation of concerns.
3. **Memory Leaks and Buffer Bloat:** Accumulating unclosed event listeners on `EventEmitter` or using `fs.readFile()` on massive files exhausts the V8 heap and triggers catastrophic OOM crashes.

---

## 3. Mental Model

To master Node.js and Express patterns in interviews, visualize the architecture as an **Assembly Line Pipeline (Express) feeding a Work Dispatch Desk (Libuv)**:

```
[ INCOMING HTTP SOCKET ]
           |
           v
[ EXPRESS PIPELINE ]
  [ Middleware 1: Request Logger & Correlation ID ]
           | (next())
           v
  [ Middleware 2: Authentication / JWT Guard ]
           | (next())
           v
  [ Middleware 3: Zod Schema Validation ]
           | (next())
           v
  [ Route Controller: Invokes Business Service ]
           | (async/await)
           +---> [ Libuv Worker Thread Pool / Epoll Socket ]
           |
           v
  [ Centralized Error Handler (4 Arguments) ]
           |
           v
[ OUTGOING HTTP RESPONSE ]
```

---

## 4. Basic Example

### The 3-Tier Layered Architecture Pattern

```typescript
// 1. Repository Layer (Data Access)
export class UserRepository {
  async findById(id: string) {
    return db.query("SELECT id, name, email FROM users WHERE id = $1", [id]);
  }
}

// 2. Service Layer (Business Logic)
export class UserService {
  constructor(private userRepo: UserRepository) {}

  async getUserProfile(id: string) {
    const user = await this.userRepo.findById(id);
    if (!user) throw new NotFoundError(`User ${id} not found`);
    return user;
  }
}

// 3. Controller Layer (HTTP Interface)
export class UserController {
  constructor(private userService: UserService) {}

  getProfile = asyncHandler(async (req: Request, res: Response) => {
    const profile = await this.userService.getUserProfile(req.params.id);
    return res.status(200).json({ success: true, data: profile });
  });
}
```

---

## 5. Real Example

### Distributed Tracing Context with `AsyncLocalStorage` and Pino Logger

```typescript
import { AsyncLocalStorage } from "node:async_hooks";
import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

export interface RequestStore {
  correlationId: string;
  userId?: string;
  startTime: number;
}

// Global thread-safe continuation-local storage
export const requestContext = new AsyncLocalStorage<RequestStore>();

// Middleware running at the very top of Express stack
export function contextMiddleware(req: Request, res: Response, next: NextFunction) {
  const correlationId = (req.headers["x-correlation-id"] as string) || crypto.randomUUID();
  res.setHeader("X-Correlation-Id", correlationId);

  const store: RequestStore = {
    correlationId,
    userId: req.headers["x-user-id"] as string,
    startTime: Date.now(),
  };

  // Run all downstream handlers within this asynchronous context
  requestContext.run(store, () => {
    next();
  });
}

// Any helper function anywhere in the deep call stack can read context without prop drilling!
export function logInfo(message: string, meta: Record<string, any> = {}) {
  const store = requestContext.getStore();
  console.log(
    JSON.stringify({
      level: "INFO",
      timestamp: new Date().toISOString(),
      correlationId: store?.correlationId ?? "none",
      userId: store?.userId ?? "anonymous",
      message,
      ...meta,
    })
  );
}
```

---

## 6. Under the Hood

### Express Middleware Call Stack & Execution Mechanics

Express internal routing is an array of Layer objects (`app._router.stack`).
```typescript
interface Layer {
  handle: Function; // The middleware function
  name: string;
  params: any;
  path: string;
  regexp: RegExp;
  route: any;
}
```
* When a request arrives, Express invokes `router.handle(req, res, out)`.
* It maintains an index cursor (`idx = 0`). Calling `next()` increments `idx` and invokes the next matching layer function.
* If a layer throws or calls `next(err)` with an argument, Express **skips all standard middleware layers** and jumps straight to the next layer whose function arity (`fn.length === 4`) has 4 arguments (the error-handling middleware).

---

## 7. Important Rules

1. **The Rule of 4 Arguments for Error Handlers:** An Express error middleware **must declare exactly four arguments**: `(err, req, res, next)`. If you declare `(err, req, res)`, JavaScript function reflection (`fn.length === 3`) causes Express to treat it as a standard request handler!
2. **The Rule of Stream Pipelines:** Never use raw `.pipe()` in production. Raw `readable.pipe(writable)` does **not** forward errors or destroy streams if one side fails, leaking file descriptors. Always use `stream.pipeline` or `stream/promises`.
3. **The Rule of Safe Async Handler Wrapping:** Always wrap asynchronous route handlers with an async wrapper to catch unhandled promise rejections and forward them to `next(err)`.
4. **The Rule of Non-Blocking Event Loop:** Never execute synchronous operations (`crypto.pbkdf2Sync`, `fs.readFileSync`, `JSON.parse` on 50MB files) on the main thread.

---

## 8. Common Mistakes

### Mistake 1: Forgetting to Return After `res.json()`
```typescript
// BAD: Continues execution after sending response!
if (!user) {
  res.status(404).json({ error: "Not found" });
}
doSomethingExpensive(); // Executes anyway and crashes with ERR_HTTP_HEADERS_SENT!

// GOOD:
if (!user) {
  return res.status(404).json({ error: "Not found" });
}
```

### Mistake 2: Leaking Event Listeners on Custom EventEmitters
Attaching `.on("event")` inside an HTTP route handler without removing the listener:
```typescript
app.get('/events', (req, res) => {
  globalEmitter.on('update', (data) => res.json(data)); // LEAKS memory on every single HTTP request!
});
```
Every request permanently adds a listener to `globalEmitter`, eventually triggering `MaxListenersExceededWarning` and crashing the server.

### Mistake 3: Blocking Main Thread with Heavy Regex (ReDoS)
Using un-anchored, nested quantifier regexes (`/(a+)+$/`) on user input, causing catastrophic backtracking that freezes the single-threaded event loop at 100% CPU.

---

## 9. Best Practices

1. **Custom Domain Error Hierarchy:** Inherit from a base `AppError` class with HTTP status codes:
   ```typescript
   export class AppError extends Error {
     constructor(public message: string, public statusCode = 500, public isOperational = true) {
       super(message);
       Object.setPrototypeOf(this, new.target.prototype);
     }
   }
   export class NotFoundError extends AppError { constructor(m = "Not found") { super(m, 404); } }
   export class BadRequestError extends AppError { constructor(m = "Bad request") { super(m, 400); } }
   ```
2. **Schema-Driven Input Validation Middleware:** Validate `req.body`, `req.query`, and `req.params` with Zod before hitting controller code.
3. **Process Supervision & Clustering:** Use PM2 or Kubernetes Pods to spawn one worker process per physical CPU core.
4. **Graceful Drain on SIGTERM:** Implement a graceful shutdown script that drains incoming TCP connections and closes open DB pools before exiting.

---

## 10. Performance Considerations

* **Libuv Threadpool Tuning:** Default `UV_THREADPOOL_SIZE=4`. If your app relies heavily on `bcrypt`, `crypto`, `zlib`, or `fs`, increase `UV_THREADPOOL_SIZE=64` to prevent I/O queues from bottlenecking event loop execution.
* **Keep-Alive Connection Re-use:** When calling external microservices via `fetch` or `axios`, configure an HTTP Agent with `keepAlive: true` to eliminate TCP 3-way handshakes and TLS handshakes on every outbound request.

---

## 11. Security Considerations

* **Rate Limiting & Brute Force Defense:** Apply rate limiters (`express-rate-limit` with Redis store) on auth endpoints.
* **Security Headers via Helmet:** Always use `helmet()` to enforce HSTS, no-sniff, and clickjacking defenses.
* **Prototype Pollution Prevention:** Sanitize untrusted JSON payloads to strip `__proto__` and `constructor` keys before deep merging.

---

## 12. Alternatives: Framework Comparison

| Framework | Architecture | Throughput (Req/sec) | Pros | Cons |
| :--- | :--- | :--- | :--- | :--- |
| **Express.js** | Callback/Middleware pipeline | ~15,000 | Massive ecosystem, millions of packages | Older callback core, slower than Fastify |
| **Fastify** | Schema-compiled pipeline | ~45,000 | 3x faster than Express, built-in validation | Smaller plugin ecosystem |
| **NestJS** | Angular-like OOP / Decorators | ~14,000 | Strong enterprise structure, DI container | Heavy boilerplate, steep learning curve |
| **Hono** | Web Standards / Fetch API | ~60,000 | Runs on Node, Bun, Cloudflare Workers, Edge | Newer ecosystem |

---

## 13. Trade-offs

* **Layered 3-Tier Architecture vs Rapid Route Scripts:** 3-tier layering adds files and interfaces, but enables unit testing without mocking HTTP sockets.
* **Worker Threads vs Child Processes:** Worker threads share memory via `ArrayBuffer` and have low overhead (~5MB RAM), but crash the entire process if an unhandled segfault occurs in C++ bindings. Child processes isolate crashes entirely, but consume 30MB+ RAM per process.

---

## 14. Real-World Usage

* **PayPal:** Replaced Java Spring application layers with Node.js, doubling requests handled per second while reducing average response latency by 35%.
* **LinkedIn:** Migrated mobile backend to Node.js, cutting server instances from 30 down to 3 while handling 10x the traffic.

---

## 15. Placement Interview Questions

### Basic Level
1. **What is an Express middleware function and what are its parameters?**
   * *Answer:* An Express middleware is a function that has access to the Request object (`req`), the Response object (`res`), and the next middleware function in the application’s request-response cycle (`next`). Middleware functions can execute code, modify `req` and `res`, end the request-response cycle, or call `next()` to pass control to the subsequent middleware.

2. **Why does Express error middleware require 4 parameters?**
   * *Answer:* Express inspects the function's arity using `fn.length`. If a function declares 4 parameters `(err, req, res, next)`, Express registers it as an **Error Handling Middleware**. If it has fewer than 4 parameters, Express treats it as a standard request handler and will not route errors to it when `next(err)` is called.

3. **What is the purpose of `process.nextTick()` in Node.js?**
   * *Answer:* `process.nextTick()` registers a callback to be executed immediately after the current operation completes, before the event loop advances to ANY next phase. It has higher priority than Promise microtasks and macrotasks.

4. **What is the difference between `fs.readFile` and `fs.createReadStream`?**
   * *Answer:* `fs.readFile()` reads the entire file into a V8 memory buffer before invoking the callback. Reading a 2GB file will crash the process with an Out of Memory error. `fs.createReadStream()` reads the file in small, sequential chunks (default 64KB) over time, keeping memory consumption flat and minimal.

5. **What is backpressure in Node.js streams?**
   * *Answer:* Backpressure occurs when a Readable stream produces data faster than the Writable stream can write/consume it. If unhandled, data accumulates in RAM buffers (`highWaterMark`), exhausting memory. Stream piping or `stream.pipeline` automatically pauses the readable stream until the writable stream emits the `'drain'` event.

---

### Conceptual Level
6. **Explain the 6 phases of the Libuv Event Loop in detail.**
   * *Answer:*
     1. *Timers:* Executes callbacks scheduled by `setTimeout` and `setInterval`.
     2. *Pending Callbacks:* Executes deferred I/O callbacks (e.g., TCP socket errors).
     3. *Idle, Prepare:* Used internally by Libuv.
     4. *Poll:* Retrieves new I/O events; executes I/O callbacks; blocks if no timers are pending.
     5. *Check:* Executes callbacks scheduled by `setImmediate`.
     6. *Close Callbacks:* Executes cleanup handlers (e.g., `socket.on('close')`).

7. **How does `AsyncLocalStorage` work and what problem does it solve in Express?**
   * *Answer:* In multithreaded runtimes (Java, C#), Thread-Local Storage (TLS) associates data with the active thread. Because Node.js is single-threaded and executes asynchronous operations concurrently, standard thread-local storage is impossible. `AsyncLocalStorage` tracks asynchronous execution context across promise chains and callbacks, allowing request-scoped data (like `correlationId` or `userId`) to be accessed anywhere without passing it through every function argument.

8. **What operations run in the Libuv thread pool vs the OS kernel?**
   * *Answer:*
     - *OS Kernel (Epoll/Kqueue - truly non-blocking):* Network I/O (TCP/UDP sockets, incoming HTTP requests, outgoing HTTP calls).
     - *Libuv Thread Pool (default 4 threads):* File system operations (`fs.*`), DNS lookups (`dns.lookup`), cryptography (`crypto.pbkdf2`, `crypto.scrypt`), compression (`zlib.*`).

9. **Explain the difference between `child_process.fork()` and `worker_threads`.**
   * *Answer:*
     - `child_process.fork()` spawns an independent operating system process with its own V8 instance, event loop, and memory heap (~30MB RAM). Communication requires serialized IPC messages.
     - `worker_threads` spawns an OS thread within the *same* process. Each worker has its own V8 isolate, but threads can share memory directly using `SharedArrayBuffer` without serialization overhead.

10. **What is the difference between `setImmediate()` and `setTimeout(fn, 0)`?**
    * *Answer:* Inside an I/O callback (Poll phase), `setImmediate()` will **always execute before `setTimeout(fn, 0)`** because the event loop advances directly from the Poll phase to the Check phase (where `setImmediate` lives) before wrapping around to the Timers phase.

---

### Implementation Level
11. **Write a generic Async Handler wrapper for Express route controllers.**
    * *Answer:*
    ```typescript
    import { Request, Response, NextFunction, RequestHandler } from "express";

    export const asyncHandler = (
      fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
    ): RequestHandler => {
      return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
      };
    };
    ```

12. **Write a complete Graceful Shutdown handler for an Express app with PostgreSQL.**
    * *Answer:*
    ```typescript
    import http from "http";
    import { Pool } from "pg";

    export function setupGracefulShutdown(server: http.Server, dbPool: Pool) {
      const shutdown = async (signal: string) => {
        console.log(`Received ${signal}. Starting graceful shutdown...`);

        // 1. Stop accepting new incoming HTTP connections
        server.close(async () => {
          console.log("HTTP server closed. In-flight requests finished.");
          try {
            // 2. Drain database connections
            await dbPool.end();
            console.log("Database connection pool closed.");
            process.exit(0);
          } catch (err) {
            console.error("Error during DB shutdown:", err);
            process.exit(1);
          }
        });

        // 3. Force exit if shutdown hangs longer than 10 seconds
        setTimeout(() => {
          console.error("Graceful shutdown timeout exceeded. Forcefully terminating.");
          process.exit(1);
        }, 10000).unref();
      };

      process.on("SIGTERM", () => shutdown("SIGTERM"));
      process.on("SIGINT", () => shutdown("SIGINT"));
    }
    ```

13. **Implement a generic Schema Validation middleware using Zod.**
    * *Answer:*
    ```typescript
    import { Request, Response, NextFunction } from "express";
    import { AnyZodObject, ZodError } from "zod";

    export const validateRequest = (schema: AnyZodObject) => {
      return async (req: Request, res: Response, next: NextFunction) => {
        try {
          const parsed = await schema.parseAsync({
            body: req.body,
            query: req.query,
            params: req.params,
          });
          req.body = parsed.body;
          req.query = parsed.query;
          req.params = parsed.params;
          next();
        } catch (error) {
          if (error instanceof ZodError) {
            return res.status(400).json({
              error: "Validation Error",
              issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
            });
          }
          next(error);
        }
      };
    };
    ```

14. **How do you stream a large CSV file export directly from PostgreSQL to the client without memory accumulation?**
    * *Answer:*
    ```typescript
    import { pipeline } from "stream/promises";
    import QueryStream from "pg-query-stream";
    import { Transform } from "stream";

    app.get("/export/users", async (req, res) => {
      const client = await pool.connect();
      try {
        const query = new QueryStream("SELECT id, name, email FROM users");
        const stream = client.query(query);

        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", 'attachment; filename="users.csv"');

        const csvTransformer = new Transform({
          objectMode: true,
          transform(row, _, cb) {
            cb(null, `${row.id},${row.name},${row.email}\n`);
          },
        });

        await pipeline(stream, csvTransformer, res);
      } finally {
        client.release();
      }
    });
    ```

15. **How do you cluster an Express app across all CPU cores using the `node:cluster` module?**
    * *Answer:*
    ```typescript
    import cluster from "node:cluster";
    import os from "node:os";

    if (cluster.isPrimary) {
      const numCPUs = os.cpus().length;
      for (let i = 0; i < numCPUs; i++) cluster.fork();

      cluster.on("exit", (worker) => {
        console.warn(`Worker ${worker.process.pid} died. Forking replacement...`);
        cluster.fork();
      });
    } else {
      require("./server"); // Worker processes run the express server
    }
    ```

---

### Debugging Level
16. **Why did an unhandled promise rejection crash a production Express application?**
    * *Answer:* In Node.js 15+, the runtime changed the default behavior of unhandled promise rejections from emitting a warning to terminating the process with a non-zero exit code (`ERR_UNHANDLED_REJECTION`). If an `async` route handler throws an error and is not wrapped in `try/catch` or an `asyncHandler` calling `next(err)`, the promise rejects unhandled, crashing the server.

17. **Why is an Express application's memory usage climbing linearly by 100MB every hour despite low traffic?**
    * *Answer:* A memory leak. Common culprits:
      1. Registering event listeners on global singletons inside request handlers (`eventEmitter.on()` inside route).
      2. Appending data to an unbounded in-memory cache object or array.
      3. Closure retention where a long-lived callback retains references to the `req` or `res` objects.

18. **Why does an Express app throw `Error [ERR_HTTP_HEADERS_SENT]: Cannot set headers after they are sent to the client`?**
    * *Answer:* The application attempted to send an HTTP response (e.g., `res.status(500).json(...)`) after the response headers were already flushed to the client socket (e.g., an earlier `res.json()` or streaming chunks). This usually occurs when a developer forgets to `return` after sending an early response inside an `if` branch.

19. **Why does `bcrypt.hash()` cause API latency to spike across ALL endpoints on a 4-core server?**
    * *Answer:* `bcrypt` is CPU-heavy and runs in the Libuv thread pool. By default, `UV_THREADPOOL_SIZE=4`. If 4 concurrent password hash operations run simultaneously, all 4 Libuv worker threads are saturated. Inbound file operations, DNS lookups, and crypto tasks are queued, causing latency across unrelated endpoints to jump from 10ms to several seconds.

20. **Why did a file upload crash the Node.js server with `JavaScript heap out of memory`?**
    * *Answer:* The upload handler buffered the entire file in RAM using `req.body` or `fs.readFile()` instead of streaming it. When multiple users uploaded 100MB files simultaneously, total heap usage exceeded V8's memory ceiling (~1.4GB), triggering a fatal process crash.

---

### Scenario-Based Questions
21. **Scenario: You are designing an Express microservice that consumes webhook events from Stripe. How do you ensure webhooks are processed reliably without dropping requests under load?**
    * *Answer:*
      1. Fast Acknowledgment: Verify the webhook signature against the raw body buffer. If valid, immediately push the event payload into a Redis/BullMQ background queue and return `HTTP 200 OK` in <50ms.
      2. Asynchronous Worker: A separate background worker pulls jobs from the queue, processes business logic, and retries with exponential backoff on transient errors.

22. **Scenario: Your Node.js API must execute heavy computational report math (calculating statistical standard deviations across 10 million data points). How do you prevent blocking the main event loop?**
    * *Answer:* Offload the computation to a **Worker Thread** using `worker_threads`:
      - The main thread accepts the request and spawns or delegates to a pooled worker thread.
      - Pass data via `SharedArrayBuffer` for zero-copy memory transfer.
      - Worker computes math in parallel on a separate CPU core, posting the result back to the main thread via `parentPort.postMessage()`.

23. **Scenario: You have an Express server running behind an AWS Application Load Balancer. Health checks intermittently fail, causing pods to be killed. How do you fix this?**
    * *Answer:*
      - Add a dedicated, lightweight `/healthz` route that returns `200 OK` instantly without querying the database or performing heavy I/O.
      - Separate liveness (is process alive?) from readiness (can process reach DB?).
      - Configure ALB health check intervals (e.g., check every 15s, require 2 consecutive successes, 3 failures to mark unhealthy).

24. **Scenario: Multiple microservices need to pass authorization and tracing tokens across asynchronous chains. How do you implement this cleanly?**
    * *Answer:* Use `AsyncLocalStorage` in an Express entry middleware to store `{ correlationId, tenantId, userToken }`. Write an outgoing HTTP interceptor (via `axios` or custom `fetch` wrapper) that automatically reads from `AsyncLocalStorage` and injects these headers into all outgoing requests.

25. **Scenario: How do you build an API gateway in Express that handles routing and rate limiting for 10 downstream microservices?**
    * *Answer:* Use `http-proxy-middleware` or Fastify Gateway. In Express:
      - Authenticate and rate-limit at the gateway layer using Redis sliding window counters.
      - Route paths: `app.use('/api/users', createProxyMiddleware({ target: 'http://user-service:4000', changeOrigin: true }))`.
      - Inject distributed tracing headers (`X-Correlation-Id`) before proxying.

---

### Advanced Architectural Questions
26. **Explain the V8 Garbage Collection phases and how memory leaks manifest.**
    * *Answer:* V8 divides memory into Young Generation (Nursery and Intermediate spaces) and Old Generation.
      - *Scavenge (Minor GC):* Fast Cheney copying algorithm that collects short-lived objects in Young Gen.
      - *Mark-Sweep-Compact (Major GC):* Slow, full-stop cycle that marks reachable objects from root references, sweeps unreachable memory, and compacts fragmented pages in Old Gen.
      - *Memory Leak:* Occurs when unused objects remain reachable from root references (global variables, uncleared closures, event listeners), preventing Mark-Sweep from freeing their memory.

27. **What is the Difference between Domain Exceptions and Technical Exceptions?**
    * *Answer:*
      - *Domain Exceptions:* Operational, predictable errors expected during normal business flow (e.g., `InsufficientBalanceError`, `UserNotFoundError`). They inherit from a base `AppError`, carry HTTP status codes, and return safe, formatted messages to clients.
      - *Technical Exceptions:* Programmer errors or infrastructure bugs (e.g., `TypeError`, database connection drop, syntax error). They represent unhandled states, must be logged with full stack traces, and should return a generic `500 Internal Server Error` to prevent leaking system details.

28. **Explain the Node.js C++ Addon Bridge (N-API / Node-API).**
    * *Answer:* Node-API is an ABI-stable C API that allows developers to write native C/C++ or Rust modules that run directly in Node.js. Unlike earlier V8 bindings that broke whenever Node updated its V8 version, Node-API provides binary stability across Node versions, allowing high-performance native code (image processing via `sharp`, cryptography, database drivers) to execute without re-compilation.

29. **How do you monitor Node.js Event Loop Lag in production?**
    * *Answer:* Use `perf_hooks.monitorEventLoopDelay({ resolution: 20 })`. It samples event loop delay every 20ms and generates a histogram of p50, p95, and p99 lag in milliseconds. If p99 exceeds 50ms, the event loop is experiencing severe blocking, signaling the need for load shedding or worker thread offloading.

30. **What is the Transactional Outbox Pattern implementation in Express with PostgreSQL?**
    * *Answer:* When handling an order creation endpoint:
      1. Open PostgreSQL transaction (`BEGIN`).
      2. Insert into `orders` table.
      3. Insert event message into `outbox` table (`(id, event_type, payload, status)`).
      4. Commit transaction (`COMMIT`).
      5. A background worker (Debezium CDC or polling cron) reads pending outbox records and publishes them to Kafka, guaranteeing **At-Least-Once event delivery** without distributed dual-write inconsistencies.

---

## 16. Coding Questions

### Coding Challenge 1: Type-Safe Centralized Error Handling Middleware

```typescript
import { Request, Response, NextFunction } from "express";

export class AppError extends Error {
  constructor(
    public override message: string,
    public statusCode: number = 500,
    public isOperational: boolean = true
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function globalErrorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const statusCode = err.statusCode || 500;
  const isOperational = err.isOperational || false;

  // Log all non-operational technical bugs
  if (!isOperational) {
    console.error("[FATAL TECHNICAL BUG]:", err);
  }

  res.status(statusCode).json({
    success: false,
    status: statusCode >= 500 ? "error" : "fail",
    message: isOperational ? err.message : "Internal Server Error",
    ...(process.env.NODE_ENV === "development" && {
      stack: err.stack,
      rawError: err,
    }),
  });
}
```

### Coding Challenge 2: Streaming File Copy Pipeline with Custom Transform Stream

```typescript
import fs from "fs";
import { Transform } from "stream";
import { pipeline } from "stream/promises";

/**
 * Transforms an uppercase text stream to lowercase while writing to destination.
 * Automatically manages stream backpressure and resource destruction on failure.
 */
export async function transformAndCopyFile(sourcePath: string, destPath: string) {
  const readStream = fs.createReadStream(sourcePath);
  const writeStream = fs.createWriteStream(destPath);

  const lowerCaseTransform = new Transform({
    transform(chunk: Buffer, encoding, callback) {
      const lower = chunk.toString().toLowerCase();
      callback(null, Buffer.from(lower));
    },
  });

  await pipeline(readStream, lowerCaseTransform, writeStream);
  console.log("File transformation and copy completed successfully.");
}
```

---

## 17. Common Interview Traps

* **The Trap:** The interviewer asks: *"Does Express automatically handle asynchronous errors thrown inside `async` route handlers in Express 4?"*
  * **How candidates fail:** Saying "Yes, Express catches all thrown errors and routes them to the error middleware."
  * **The Winning Answer:** **No!** Express 4 was built before async/await existed; its internal router does not await the returned promise. Any uncaught error thrown inside an `async` function results in an unhandled promise rejection that crashes the process. You **must wrap async route handlers in an `asyncHandler` wrapper** or use the `express-async-errors` monkey-patch. (Note: Express 5 natively supports async error forwarding).
* **The Trap:** *"Can you use `worker_threads` to speed up database queries in Node.js?"*
  * **How candidates fail:** Saying "Yes, spawning worker threads will make database queries run in parallel."
  * **The Winning Answer:** **No!** Database queries are **I/O-bound**, not CPU-bound. In Node.js, database queries are already completely non-blocking and handled asynchronously via kernel network sockets. Spawning worker threads for database queries merely adds thread instantiation and IPC communication overhead without any performance benefit. Worker threads are strictly for **CPU-bound computation** (cryptography, image rendering, parsing large datasets).

---

## 18. Revision Summary

```
+-----------------------------------------------------------------------------------+
|               Node.js & Express Patterns High-Yield Revision Matrix               |
+-----------------------------------------------------------------------------------+
| 3-Tier Layering:     Controller (HTTP) -> Service (Business) -> Repository (Data) |
| Error Middleware:    MUST have 4 arguments: (err, req, res, next)                 |
| Async Safety:        Wrap async routes in asyncHandler or use Express 5           |
| AsyncLocalStorage:   Propagates correlation IDs across async chains without props |
| Streams:             Use stream.pipeline to handle backpressure and error teardown|
| Thread Pool Tuning:  UV_THREADPOOL_SIZE for crypto/fs/zlib; default is 4          |
| Shutdown Protocol:   SIGTERM -> server.close() -> db.end() -> process.exit(0)     |
+-----------------------------------------------------------------------------------+
```

---

## 19. Quick Reference

* **`asyncHandler(fn)`:** Wraps async controllers to forward errors to `next(err)`.
* **`(err, req, res, next)`:** Mandatory 4-argument signature for Express error handlers.
* **`stream.pipeline()`:** Connects streams with automatic backpressure and error cleanup.
* **`AsyncLocalStorage`:** Node.js continuation-local storage for request context.
* **`UV_THREADPOOL_SIZE=N`:** Environment variable controlling Libuv worker threads.
* **`server.close()`:** Stops server from accepting new connections; drains active requests.
* **`cluster.fork()`:** Spawns worker process sharing server socket.
