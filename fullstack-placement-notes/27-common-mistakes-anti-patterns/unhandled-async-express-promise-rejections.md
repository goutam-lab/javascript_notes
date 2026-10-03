# Unhandled Async Express Promise Rejections & Process Crashes Deep Dive

---

## 1. What is it?

The Unhandled Async Express Promise Rejections guide investigates the most common cause of sudden, silent production crashes in Node.js and Express backend services. In Express 4 (the dominant web framework in production today), the internal router is built on synchronous callbacks; it **does not natively await or catch rejected promises** returned by `async` route handlers. When an unhandled error occurs inside an async route, the promise rejects without a handler. In modern Node.js runtimes (Node.js 15+), this triggers an `ERR_UNHANDLED_REJECTION` event that **terminates the entire Node.js operating system process**, bringing down the entire API for all concurrent users.

```
+-----------------------------------------------------------------------------------+
|               Unhandled Promise Rejection Process Crash Lifecycle                 |
+-----------------------------------------------------------------------------------+
| 1. Incoming HTTP Request: GET /api/orders/99                                      |
| 2. Async Route Handler:   async (req, res) => { await db.query(); // DB FAILS! }  |
| 3. Unhandled Exception:   Database throws ConnectionLostError                     |
| 4. Promise Rejection:     Promise rejects; Express 4 router does NOT await it!    |
| 5. Process Crash:         Node.js 15+ emits 'unhandledRejection' -> FATAL EXIT 1   |
| 6. Blast Radius:          All 2,000 inflight user requests terminate abruptly!   |
+-----------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

This vulnerability exists because of a historical timing mismatch in JavaScript language evolution:
1. **Express 4 Pre-dates Async/Await:** Express 4 was designed in 2014, when asynchronous JavaScript was handled exclusively through callbacks (`(err, data) => ...`). Promises and `async/await` were added to ECMAScript years later (ES2017). The Express 4 routing engine (`router.handle`) simply executes `fn(req, res, next)`. If `fn` is an `async` function, it returns a Promise, but Express completely ignores the returned Promise!
2. **Node.js Policy Shift in v15+:** In older Node.js versions (v10–v14), unhandled promise rejections merely logged a `DeprecationWarning: UnhandledPromiseRejectionWarning` to stderr, leaving the process running. In Node.js 15+, the runtime changed the default flag to `--unhandled-rejections=throw`, causing unhandled rejections to crash the process immediately to prevent corrupted state.
3. **The Forgotten `next(err)`:** In synchronous code, throwing an error (`throw new Error()`) inside Express is caught by Express's internal `try/catch`. In asynchronous code, throwing inside an `async` function rejects the returned promise, which escapes Express's synchronous `try/catch` entirely.

---

## 3. Mental Model

To master async error handling in Express, visualize Express as an **Asynchronous Train Track with a Missing Bridge**:

```
[ ASYNC ROUTE EXECUTION ]
  app.get('/users', async (req, res) => {
    const user = await db.find(); // <-- THROWS ERROR HERE!
    res.json(user);
  });

                                  |
                                  v
[ EXPRESS 4 ROUTER: Synchronous try/catch ]
  try {
    const result = fn(req, res, next); // Returns a Promise!
    // EXPRESS 4 DOES NOT AWAIT result! It exits try/catch immediately!
  } catch (syncErr) {
    next(syncErr); // Catches ONLY synchronous errors!
  }

                                  |
                                  v
[ FLOATING PROMISE REJECTION ]
  - Promise rejection escapes to the global Node.js runtime
  - Node.js runtime fires: process.on('unhandledRejection')
  - Operating System sends SIGABRT / Process Exits with Code 1!
```

---

## 4. Basic Example

### The Crash Pattern vs The `asyncHandler` Wrapper

```typescript
// ❌ ANTI-PATTERN: The Silent Process Killer
app.get("/api/users/:id", async (req, res) => {
  // If db.query throws an error (e.g. database timeout),
  // Express 4 never catches it. Node.js process CRASHES with Exit Code 1!
  const user = await db.query("SELECT * FROM users WHERE id = $1", [req.params.id]);
  res.json(user);
});

// ✅ BEST PRACTICE: The Universal asyncHandler Wrapper
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => (req: Request, res: Response, next: NextFunction) => {
  // Catches any rejected promise and forwards to next(err)
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Clean, Crash-Proof Route:
app.get(
  "/api/users/:id",
  asyncHandler(async (req, res) => {
    const user = await db.query("SELECT * FROM users WHERE id = $1", [req.params.id]);
    res.json(user);
  })
);
```

---

## 5. Real Example

### Production Centralized Error Handling Stack with Domain Exceptions

```typescript
import express, { Request, Response, NextFunction } from "express";

// 1. Base Domain Error Hierarchy
export class AppError extends Error {
  constructor(
    public override message: string,
    public statusCode: number = 500,
    public isOperational: boolean = true // Differentiates operational bugs from programmer bugs
  ) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404);
  }
}

// 2. Centralized 4-Argument Error Middleware
export function globalErrorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  const statusCode = err.statusCode || 500;
  const isOperational = err.isOperational || false;

  // Log all non-operational technical bugs (database crashes, syntax bugs)
  if (!isOperational) {
    console.error(`[CRITICAL SERVER ERROR] ${req.method} ${req.url}:`, err);
  }

  res.status(statusCode).json({
    success: false,
    status: statusCode >= 500 ? "error" : "fail",
    message: isOperational ? err.message : "An unexpected internal error occurred.",
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
}

// 3. Process-Level Failsafes
export function registerProcessGuards(server: any) {
  process.on("unhandledRejection", (reason: unknown) => {
    console.error("FATAL: Unhandled Promise Rejection detected:", reason);
    // Graceful drain before exiting
    server.close(() => process.exit(1));
  });

  process.on("uncaughtException", (error: Error) => {
    console.error("FATAL: Uncaught Exception detected:", error);
    process.exit(1); // Process state is corrupted; must exit immediately
  });
}
```

---

## 6. Under the Hood

### Express 4 Layer Execution Algorithm vs Express 5

In Express 4 source code (`router/layer.js`):
```javascript
Layer.prototype.handle_request = function handle(req, res, next) {
  var fn = this.handle;
  try {
    fn(req, res, next); // Synchronous invocation! Returned promise is discarded!
  } catch (err) {
    next(err);
  }
};
```

In Express 5 (native promise support):
```javascript
Layer.prototype.handle_request = function handle(req, res, next) {
  var fn = this.handle;
  try {
    var result = fn(req, res, next);
    // Express 5 checks if result is a Promise and attaches a .catch handler!
    if (result && typeof result.then === 'function') {
      result.catch(function(err) {
        next(err);
      });
    }
  } catch (err) {
    next(err);
  }
};
```

---

## 7. Important Rules

1. **The Rule of 4-Argument Error Handlers:** An Express error handler **must have exactly 4 arguments**: `(err, req, res, next)`. Omitting `next` (even if unused) changes `fn.length` to 3, causing Express to treat it as a normal request handler and ignoring errors!
2. **The Rule of Mandatory Catch:** Every asynchronous route handler in Express 4 **must be wrapped in `asyncHandler`** or the project must import `express-async-errors`.
3. **The Rule of Operational vs Programmer Errors:**
   - *Operational Errors (Known failures):* Invalid input, resource not found, rate limit exceeded. Log message, return 4xx error, keep process running.
   - *Programmer Errors (Bugs):* `TypeError: Cannot read properties of undefined`, database connection deadlocks. Log critical alert, trigger graceful drain, and restart the process.
4. **The Rule of Crash-on-Uncaught-Exception:** Never continue running a Node.js process after an `uncaughtException` occurs. The memory heap, file descriptors, and socket states are in an undefined, corrupted state. Exit and let PM2 or Kubernetes restart the container cleanly.

---

## 8. Common Mistakes

### Mistake 1: The Forgotten `next(err)` Hanging Request
```typescript
// ANTI-PATTERN: Catching error but forgetting to call next(err)
app.get("/items", async (req, res, next) => {
  try {
    const items = await db.getItems();
    res.json(items);
  } catch (err) {
    console.error(err);
    // BUG: Neither res.status().json() NOR next(err) was called!
    // The HTTP connection HANGS indefinitely until client times out!
  }
});
```

### Mistake 2: Calling `next(err)` After Sending Headers
```typescript
// ANTI-PATTERN: Calling next(err) after partial send
app.get("/download", async (req, res, next) => {
  try {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write('{"data":');
    const data = await getSlowData(); // Throws error!
    res.end(JSON.stringify(data));
  } catch (err) {
    next(err); // CRASH: Cannot set headers after they are sent to the client!
  }
});
```

### Mistake 3: Swallowing Errors in `process.on('unhandledRejection')`
```typescript
// ANTI-PATTERN: Ignoring unhandled rejections to "prevent crashes"
process.on("unhandledRejection", (err) => {
  console.log("Ignored error:", err); // DISASTER: Hides memory leaks and corrupted state!
});
```

---

## 9. Best Practices

1. **Adopt `express-async-errors` Monkey Patch:** In Express 4 apps, import `express-async-errors` at the very top of your entry file (`import 'express-async-errors';`). It automatically patches Express's Layer prototype to catch all rejected promises without needing manual wrappers.
2. **Upgrade to Express 5:** When possible, upgrade to Express 5, which natively awaits returned promises in middleware and route handlers.
3. **Always Place Error Handler at the Bottom:** Register `app.use(globalErrorHandler)` **after all routes and middleware**. If a route is mounted after the error handler, errors from that route bypass the handler!
4. **Structured Error Logging with Correlation IDs:** Ensure all errors logged by the global error handler include `req.headers['x-correlation-id']` for distributed tracing.

---

## 10. Performance Considerations

* **V8 Stack Trace Capture Cost:** Constructing `new Error()` captures the V8 execution call stack, which incurs a minor CPU cost. Avoid throwing and catching errors for standard control flow (e.g., validating routine form fields); use explicit return objects for expected branch logic.
* **Hanging Connections Exhausting File Descriptors:** If errors are swallowed without ending the HTTP response (`res.end()`), open TCP sockets accumulate on the server, eventually exhausting the operating system's ephemeral socket pool (`EMFILE` / `ENFILE`).

---

## 11. Security Considerations

* **Stack Trace Information Leakage:** Never send raw `err.stack` or internal SQL query strings back to the client in production responses (`res.status(500).json({ stack: err.stack })`). Attackers use stack traces to identify internal server file paths, database table names, and vulnerable third-party library versions.
* **Denial of Service via Uncaught Rejection Floods:** An attacker who discovers an unhandled rejection endpoint can spam requests to force the Node.js process into an immediate crash loop, creating a Denial of Service (DoS) attack.

---

## 12. Alternatives: Error Handling Solutions

| Strategy | Mechanism | Pros | Cons |
| :--- | :--- | :--- | :--- |
| **`asyncHandler` Wrapper** | Explicit higher-order function | Zero magic, standard TypeScript | Must remember to wrap every route |
| **`express-async-errors`** | Patches Express `Layer` prototype | Automatic, zero boilerplate | Monkey-patches framework internals |
| **Express 5** | Native promise awaiting | Official framework standard | Breaking changes from Express 4 |
| **Fastify** | Built-in async route support | 3x faster than Express, native async | Migration required from Express |

---

## 13. Trade-offs

* **Fail-Fast Crash vs Inflight Request Preservation:** Restarting a process on an uncaught exception drops active in-flight requests, but prevents corrupted state from executing fraudulent database writes. In modern containerized environments (Kubernetes), failing fast and restarting pods in <2 seconds is the industry standard.
* **Generic Error Messages vs Debuggability:** Sanitizing error messages protects against information leakage, but forces developers to search centralized server logs (Datadog/ELK) using correlation IDs to debug customer issues.

---

## 14. Real-World Usage

* **Netflix API Gateway:** Enforces strict isolation of operational vs technical errors; any unhandled technical exception immediately triggers circuit breaker tripping and health-check drainage.
* **Uber Backend Services:** Automatically wraps all Express handlers with continuation-local tracing context, attaching user IDs and geo-coordinates to every error log before graceful process termination.

---

## 15. Placement Interview Questions

### Basic Level
1. **Why does an unhandled promise rejection crash a Node.js 18/20 application?**
   * *Answer:* Node.js 15+ changed the default behavior of unhandled promise rejections from emitting a deprecation warning to **throwing an `ERR_UNHANDLED_REJECTION` fatal exception**. Because unhandled rejections leave the application state unpredictable, the Node.js runtime terminates the process with Exit Code 1 to prevent data corruption.

2. **Why does Express 4 fail to catch errors in `async` route handlers?**
   * *Answer:* Express 4 was written before `async/await` was part of the JavaScript standard. Express's internal router executes route functions synchronously inside a standard `try/catch` block. When an `async` function throws an error, it returns a rejected Promise. Express 4 does not await the promise or attach a `.catch()` handler, allowing the rejection to escape into the global runtime.

3. **What is the purpose of the 4th parameter in Express error-handling middleware?**
   * *Answer:* The 4th parameter (`next`) is required for Express to recognize the function as an **Error Handling Middleware** via function arity reflection (`fn.length === 4`). If a developer writes `(err, req, res)`, Express sees only 3 parameters and registers it as a standard request handler, meaning errors passed to `next(err)` will never reach it.

4. **What is the difference between an Operational Error and a Programmer Error?**
   * *Answer:*
     - *Operational Errors:* Predictable runtime errors expected during normal system operation (e.g., invalid user input, resource not found, external API timeout). Handled by returning appropriate 4xx/5xx HTTP responses.
     - *Programmer Errors:* Bugs in the code that represent unexpected states (e.g., `TypeError: Cannot read properties of undefined`, syntax errors, passing wrong argument types). Require process termination and container restart.

5. **What happens if an Express route handler throws an error, but neither `res.send()` nor `next(err)` is called?**
   * *Answer:* The HTTP connection **hangs indefinitely**. The client browser or API consumer remains blocked waiting for a response until the client's socket timeout expires (often 60–120 seconds). On the server, the open socket consumes file descriptors and memory.

---

### Conceptual Level
6. **How does the `asyncHandler` wrapper solve the Express 4 promise rejection problem?**
   * *Answer:* The `asyncHandler` is a higher-order function that wraps an async controller:
     ```typescript
     const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
     ```
     It executes the async function, wraps the return value in `Promise.resolve()`, and chains a `.catch(next)` handler. If the promise rejects, the `.catch` block automatically intercepts the error and forwards it to Express's `next(err)` pipeline.

7. **Why should you NEVER continue running a Node.js process after an `uncaughtException` event?**
   * *Answer:* According to official Node.js documentation, `uncaughtException` means the application was in an unhandled, unexpected state. Continuing to run is dangerous because:
     - Memory allocations may be corrupted.
     - Database transactions may be left half-committed.
     - Mutex locks and socket file descriptors may be leaked.
     - The only safe action is to log the error, gracefully close existing server connections, and exit (`process.exit(1)`), allowing process managers (PM2/Kubernetes) to spawn a fresh, clean instance.

8. **What is the difference between `process.on('uncaughtException')` and `process.on('unhandledRejection')`?**
   * *Answer:*
     - `uncaughtException`: Fired when an unhandled synchronous exception bubbles all the way back to the event loop without being caught in a `try/catch` block.
     - `unhandledRejection`: Fired when a JavaScript Promise is rejected and no `.catch()` handler is attached to the promise within the current turn of the event loop.

9. **How does Express 5 natively handle asynchronous errors compared to Express 4?**
   * *Answer:* Express 5 inspects the return value of every middleware and route handler. If the return value is a Promise (`typeof result.then === 'function'`), Express 5 automatically attaches an internal `.catch(next)` handler. Any rejected promise is automatically routed to the global error middleware without requiring manual wrappers or monkey-patch packages.

10. **Explain why error middleware must be registered AFTER all other routes in Express.**
    * *Answer:* Express evaluates middleware sequentially in the order registered in `app._router.stack`. When a route handler calls `next(err)`, Express scans forward through the stack starting from the current index to find the next middleware with 4 arguments. If the error handler was registered *above* the route, Express cannot scan backwards, and the error remains unhandled.

---

### Implementation Level
11. **Write a complete production Express application with `express-async-errors` and a centralized error pipeline.**
    * *Answer:*
    ```typescript
    import "express-async-errors"; // Must be FIRST import!
    import express, { Request, Response, NextFunction } from "express";

    const app = express();
    app.use(express.json());

    // Route that throws asynchronously without try/catch
    app.get("/api/data", async (req, res) => {
      // Automatically caught by express-async-errors!
      const data = await Promise.reject(new Error("Database connection dropped!"));
      res.json(data);
    });

    // Centralized 4-argument error handler (MUST be at the very bottom)
    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      console.error("[Logged Error]:", err.message);
      res.status(500).json({ success: false, error: err.message });
    });
    ```

12. **Implement a Graceful Termination Drain on `SIGTERM` in Node.js.**
    * *Answer:*
    ```typescript
    import http from "http";

    export function enableGracefulShutdown(server: http.Server, cleanupTasks: () => Promise<void>) {
      const shutdown = async (signal: string) => {
        console.log(`Received ${signal}. Draining connections...`);
        server.close(async () => {
          console.log("HTTP server closed.");
          try {
            await cleanupTasks();
            console.log("Cleanup finished. Clean exit.");
            process.exit(0);
          } catch (err) {
            console.error("Error during cleanup:", err);
            process.exit(1);
          }
        });

        // Force kill if shutdown hangs longer than 10 seconds
        setTimeout(() => {
          console.error("Graceful shutdown timeout exceeded. Force exit.");
          process.exit(1);
        }, 10000).unref();
      };

      process.on("SIGTERM", () => shutdown("SIGTERM"));
      process.on("SIGINT", () => shutdown("SIGINT"));
    }
    ```

13. **Write a custom Domain Error class that automatically captures HTTP status codes and operational flags.**
    * *Answer:*
    ```typescript
    export class HttpError extends Error {
      constructor(
        public statusCode: number,
        public override message: string,
        public details: any = null
      ) {
        super(message);
        this.name = this.constructor.name;
        Error.captureStackTrace(this, this.constructor);
      }
    }

    export class BadRequestError extends HttpError {
      constructor(message = "Bad Request", details = null) {
        super(400, message, details);
      }
    }
    ```

14. **How do you handle errors thrown inside streaming response pipelines?**
    * *Answer:*
    ```typescript
    import { pipeline } from "stream/promises";

    app.get("/stream", async (req, res, next) => {
      try {
        const readStream = fs.createReadStream("huge-file.log");
        // pipeline automatically cleans up streams on error
        await pipeline(readStream, res);
      } catch (err) {
        // If headers are already sent, destroy socket
        if (res.headersSent) {
          res.destroy();
        } else {
          next(err);
        }
      }
    });
    ```

15. **How do you safely catch errors thrown inside background asynchronous tasks decoupled from the HTTP cycle?**
    * *Answer:*
    ```typescript
    function triggerBackgroundJob(jobData: any) {
      // Detached async promise must have its own .catch()!
      Promise.resolve()
        .then(() => executeJob(jobData))
        .catch((err) => {
          console.error("[Background Job Error]:", err);
          // Log to Sentry / APM without crashing main process
        });
    }
    ```

---

### Debugging Level
16. **Why did an Express application suddenly terminate with `code: 'ERR_UNHANDLED_REJECTION'` after deploying to production on Node.js 20?**
    * *Answer:* A route handler was declared as `async` without a `try/catch` or `asyncHandler` wrapper. In local testing, the database query succeeded. In production, a database timeout occurred. Because Node.js 15+ enforces fatal exits on unhandled promise rejections, the unhandled database error caused the Node.js runtime to terminate the process immediately.

17. **Why does an error handler throw `ERR_HTTP_HEADERS_SENT: Cannot set headers after they are sent to the client`?**
    * *Answer:* The route handler partially sent an HTTP response (or sent headers via `res.write()`), and then an error occurred downstream that called `next(err)`. The error handler attempted to send `res.status(500).json(...)`, but the HTTP response was already flushed to the client socket. Fix: In the error handler, check `if (res.headersSent) return next(err);` to delegate to Express's default socket terminator.

18. **Why does an Express error handler with signature `(err, req, res)` never get called?**
    * *Answer:* Express inspects `fn.length` using JavaScript function reflection. An error handler **must declare 4 parameters**: `(err, req, res, next)`. With only 3 parameters, `fn.length === 3`, so Express registers it as a standard request handler and completely ignores it during error routing.

19. **Why did an Express route hang forever when an external API timed out?**
    * *Answer:* The external API client (e.g., `axios` or `fetch`) did not have an explicit network timeout configured. The HTTP socket waited indefinitely for bytes that never arrived. The async function never resolved or rejected, leaving the Express request hanging. Solution: Always configure an explicit network timeout (e.g., `timeout: 5000`) on all external HTTP clients.

20. **Why did PM2 restart a Node.js process 15 times in 30 seconds (CrashLoopBackOff)?**
    * *Answer:* A syntax error, missing environment variable, or port conflict occurred during the server startup phase (synchronous execution before `server.listen()`). Because the startup crashed immediately upon launch, PM2 repeatedly restarted the script until reaching the restart ceiling.

---

### Scenario-Based Questions
21. **Scenario: You are designing an Express microservice where payment processing calls an external gateway (Stripe). If the gateway times out after 10 seconds, how do you handle the error without double-charging or crashing?**
    * *Answer:*
      1. Wrap the controller in `asyncHandler`.
      2. Configure a strict 5-second timeout on the Stripe client.
      3. Use an `Idempotency-Key` (UUID) on the Stripe request.
      4. If the request times out: do NOT retry blindly! Catch the `TimeoutError`, mark the order state as `PAYMENT_PENDING`, and schedule an asynchronous reconciliation job to query Stripe's status endpoint before attempting any retry.

22. **Scenario: Your Node.js server experiences an unhandled database pool connection error (`ECONNREFUSED`) at 3:00 AM. How should the system handle this failure?**
    * *Answer:*
      1. The database pool emits an `error` event: `pool.on('error', err => { ... })`. (If unhandled, an `error` event on an EventEmitter crashes Node!).
      2. Log critical alert to PagerDuty.
      3. Trigger graceful termination: stop listening for new HTTP requests via `server.close()`.
      4. Terminate process with `process.exit(1)`.
      5. Docker/Kubernetes detects pod termination, starts a fresh pod, and connects to the recovered database.

23. **Scenario: You are building an Express file-upload endpoint. A malicious user uploads a 5GB file, disconnecting halfway through. How do you prevent resource exhaustion?**
    * *Answer:*
      - Listen to the `close` event on `req`:
      ```typescript
      req.on('close', () => {
        if (!res.writableEnded) {
          console.warn("Client disconnected prematurely. Aborting upload pipeline.");
          uploadStream.destroy();
        }
      });
      ```
      - Use `multer` with strict `limits: { fileSize: 10 * 1024 * 1024 }` (10MB limit) to immediately reject oversize payloads.

24. **Scenario: You have an Express application with 200 routes across 20 router files. How do you ensure that NO route can EVER crash the process due to an unhandled rejection without manually editing all 200 routes?**
    * *Answer:*
      Install and import `express-async-errors` at the very first line of the server entry file:
      ```typescript
      import 'express-async-errors';
      import express from 'express';
      ```
      This monkey-patches Express's Layer prototype at runtime, automatically wrapping every single route handler in a promise catch block that forwards errors to `next(err)`.

25. **Scenario: An API endpoint throws an error inside an asynchronous `setTimeout` callback. Why did `try/catch` around the controller fail to catch it?**
    * *Answer:*
      - In JavaScript, `setTimeout` pushes its callback to the **Macrotask Queue**, which executes on a completely different turn of the event loop *after* the controller function and its `try/catch` block have already returned!
      - Fix: Wrap the timer in a Promise (`await new Promise(res => setTimeout(res, 1000))`) so the controller awaits it within the active `try/catch` scope.

---

### Advanced Architectural Questions
26. **Explain the V8 Event Loop Unhandled Rejection Tracking Algorithm.**
    * *Answer:* In V8, when a Promise is rejected without a handler, V8 invokes its internal `PromiseRejectCallback` with `kPromiseRejectWithNoHandler`. V8 places the rejected promise into an **Unhandled Rejection List**. At the end of the current microtask turn, Node.js inspects this list. If no handler has been attached, Node.js emits the `unhandledRejection` event. If `--unhandled-rejections=throw` is active, Node.js wraps the rejection in an `ERR_UNHANDLED_REJECTION` and terminates the process.

27. **What is the difference between Error Propagation via `next(err)` vs Domain Event Emitters?**
    * *Answer:*
      - `next(err)`: Request-scoped HTTP error propagation. Passes control through the Express middleware pipeline specifically to return an HTTP status and JSON response to the connected client socket.
      - *Domain Event Emitters:* System-scoped event bus (`eventBus.emit('order:failed', err)`). Decouples error handling for auditing, alerting, and metrics aggregation from the HTTP request-response cycle.

28. **How does Express 5 handle router errors compared to Koa and Fastify?**
    * *Answer:*
      - *Express 5:* Natively awaits returned promises and forwards rejections to `next(err)`.
      - *Koa:* Built on async functions from day one (`async (ctx, next) => { await next(); }`). Errors are caught using standard `try/catch` in outer middleware.
      - *Fastify:* Compares JSON schemas at compile time and natively handles returned promises or `reply.send(new Error())`, providing structured error objects automatically.

29. **What is the "Zombie Process" problem during graceful shutdown and how is it prevented?**
    * *Answer:* When a process receives `SIGTERM`, it calls `server.close()` to stop accepting new requests and wait for active requests to finish. If an active request is stuck in an infinite loop or hanging database query, `server.close()` will **never finish**, leaving the container as a "Zombie Process" that consumes memory forever.
    * *Prevention:* Always set a hard **Forceful Termination Timeout**:
      ```typescript
      setTimeout(() => process.exit(1), 10000).unref();
      ```
      Guarantees the process exits within 10 seconds even if active requests hang.

30. **Explain how OpenTelemetry Distributed Tracing captures unhandled Express errors.**
    * *Answer:* OpenTelemetry instruments Express by monkey-patching `Layer.prototype.handle_request`. When an error is forwarded to `next(err)` or an unhandled exception occurs, the active OpenTelemetry `Span` automatically records the exception event (`span.recordException(err)`), sets the span status to `StatusCode.ERROR`, captures the HTTP status code, and ends the trace before sending it to Jaeger or Datadog.

---

## 16. Coding Questions

### Coding Challenge 1: Custom Production `asyncHandler` with Timeout Protection

```typescript
import { Request, Response, NextFunction, RequestHandler } from "express";

export class TimeoutError extends Error {
  constructor(message = "Request processing timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Wraps an async route handler with automatic error catching AND execution timeout.
 * Prevents hanging sockets from exhausting server resources.
 */
export function asyncTimeoutHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
  timeoutMs = 15000
): RequestHandler {
  return (req, res, next) => {
    let hasTimedOut = false;

    const timer = setTimeout(() => {
      hasTimedOut = true;
      next(new TimeoutError(`Request exceeded timeout of ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve(fn(req, res, next))
      .then(() => {
        clearTimeout(timer);
      })
      .catch((err) => {
        clearTimeout(timer);
        if (!hasTimedOut) {
          next(err);
        }
      });
  };
}
```

### Coding Challenge 2: Self-Healing Process Crash Guard with Audit Logging

```typescript
import http from "http";

export function initProcessFailsafes(server: http.Server) {
  process.on("unhandledRejection", (reason: unknown, promise: Promise<any>) => {
    console.error(
      JSON.stringify({
        level: "FATAL",
        timestamp: new Date().toISOString(),
        event: "UNHANDLED_PROMISE_REJECTION",
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined,
      })
    );

    // Gracefully drain connections before exit
    server.close(() => {
      process.exit(1);
    });

    // Fallback force exit
    setTimeout(() => process.exit(1), 5000).unref();
  });

  process.on("uncaughtException", (error: Error) => {
    console.error(
      JSON.stringify({
        level: "FATAL",
        timestamp: new Date().toISOString(),
        event: "UNCAUGHT_EXCEPTION",
        message: error.message,
        stack: error.stack,
      })
    );
    // Immediate exit: memory state is corrupted
    process.exit(1);
  });
}
```

---

## 17. Common Interview Traps

* **The Trap:** The interviewer asks: *"If an Express error occurs, can you just catch it in `process.on('uncaughtException')` and choose NOT to exit the process so the server stays online?"*
  * **How candidates fail:** Saying "Yes, that keeps the server alive for other users."
  * **The Winning Answer:** **No! That is a catastrophic production anti-pattern!** According to official Node.js documentation, continuing to run after an `uncaughtException` leaves your process in an **unpredictable, corrupted state**. File descriptors, database connection pools, memory allocations, and socket listeners may be leaked or corrupted. Future requests may execute fraudulent transactions or hang. You **must log the error and terminate immediately (`process.exit(1)`)**, relying on PM2 or Kubernetes to restart the container cleanly.
* **The Trap:** *"Does adding a `try/catch` block around `app.use(routes)` catch errors thrown inside the routes?"*
  * **How candidates fail:** Saying "Yes, try/catch catches all errors thrown inside the block."
  * **The Winning Answer:** **No!** `app.use(routes)` merely **registers the route functions in the routing table**; it does not execute them! The routes execute asynchronously minutes or hours later when HTTP requests arrive. Wrapping `app.use()` in `try/catch` catches only synchronous registration syntax errors during boot, and catches zero runtime request errors.

---

## 18. Revision Summary

```
+-----------------------------------------------------------------------------------+
|               Express Async Errors & Crashes High-Yield Matrix                    |
+-----------------------------------------------------------------------------------+
| Core Vulnerability:  Express 4 does NOT await returned promises in async routes   |
| Node.js 15+ Rule:    Unhandled promise rejections crash process with Exit Code 1  |
| Fix Options:         asyncHandler wrapper, express-async-errors, or Express 5     |
| 4-Arg Error Rule:    (err, req, res, next) signature is mandatory for error catch |
| Placement:           Error middleware MUST be registered AFTER all routes         |
| Failsafe Protocol:   Log fatal error, server.close(), process.exit(1) on crash    |
| Operational vs Bug:  Operational = 4xx/5xx response; Bug = Terminate & Restart   |
+-----------------------------------------------------------------------------------+
```

---

## 19. Quick Reference

* **`asyncHandler(fn)`:** Higher-order function that catches async errors and forwards to `next(err)`.
* **`import "express-async-errors"`:** Patches Express 4 to catch rejected promises automatically.
* **`ERR_UNHANDLED_REJECTION`:** Node.js fatal process crash event on unhandled rejection.
* **`(err, req, res, next)`:** Mandatory 4-argument signature for Express error handlers.
* **`server.close()`:** Stops server from accepting new sockets; drains active requests.
* **`process.exit(1)`:** Non-zero exit code indicating fatal crash.
