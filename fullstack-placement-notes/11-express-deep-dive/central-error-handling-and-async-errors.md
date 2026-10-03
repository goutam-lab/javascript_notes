# Centralized Error Handling and Async Errors in Express

---

## 1. What is it?

**Centralized Error Handling** is an architectural pattern in Express.js where all application errors—synchronous exceptions, asynchronous promise rejections, database errors, validation failures, and unhandled system faults—are routed into a single, dedicated error-handling middleware layer at the bottom of the middleware stack.

Express identifies error-handling middleware specifically by checking the function's arity (the number of declared arguments). A function with **exactly 4 parameters**—`(err, req, res, next)`—is registered as an error handler. When any upstream middleware or route handler invokes `next(err)` with an argument, Express immediately skips all remaining standard middleware and dispatches the request directly to this 4-argument layer.

```
+-------------------------------------------------------------------------------+
|                       CENTRAL ERROR HANDLING DISPATCH PIPELINE                |
+-------------------------------------------------------------------------------+
| [ Normal Route ] ---> Throws Exception or next(new AppError('Not Found', 404))|
|                              |                                                |
|                              v (Bypasses all subsequent normal middleware)    |
| [ Skipped Layer ] (e.g., standard logger, trailing route handlers)           |
|                              |                                                |
|                              v                                                |
| [ Central Error Handler: (err, req, res, next) ]                              |
|   |                                                                           |
|   +--> 1. Is error Operational? (e.g. 400 Bad Request, 404 Not Found)         |
|   |       -> Format clean JSON response, send status code                     |
|   |                                                                           |
|   +--> 2. Is error Programmer Bug / System Fault? (e.g. ReferenceError)       |
|           -> Log full stack trace to APM / Logger                             |
|           -> Hide internal details, return generic 500 Internal Error         |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Without centralized error handling:
1. **Inconsistent Error Responses**: Route A returns `{ error: "User not found" }`, Route B returns `{ message: "Failed", code: 404 }`, and Route C crashes and returns an HTML stack trace.
2. **Security Vulnerabilities (Information Disclosure)**: Raw database exceptions leak table names, SQL queries, column types, and file paths to malicious attackers.
3. **Application Crashes**: In Node.js, an unhandled promise rejection or unhandled exception crashes the entire operating system process, terminating all concurrent user sessions.
4. **Code Bloat**: Every controller function becomes cluttered with repetitive `try { ... } catch (err) { res.status(500).json(...) }` boilerplate.

A centralized error handler provides a uniform API error format, segregates operational errors from bugs, and protects system stability.

---

## 3. Mental Model

Visualize an **Emergency Room (ER) in a Hospital**:

- **The Patients (HTTP Requests)**: Move through various examination rooms (Middleware).
- **Minor Issues (Validation Errors, Missing Auth)**: A nurse notes the patient has a sprained wrist, writes a prescription, and discharges them safely (`400 Bad Request`).
- **Emergency Condition (`next(err)`)**: A surgeon discovers a ruptured appendix. The surgeon doesn't attempt to build an ICU bed on the spot. Instead, they hit the red emergency button (`next(err)`).
- **The Central Trauma Unit (Error Middleware)**: All regular clinic visits are bypassed. The patient is instantly transferred to the trauma bay (`(err, req, res, next)`). The trauma team determines:
  - Is this a known medical emergency? (**Operational Error** $\rightarrow$ Treat with standard procedure).
  - Is this an unknown catastrophic contamination? (**Programmer Bug / Fatal Error** $\rightarrow$ Sound the quarantine alarm, sanitize the environment, evacuate safely).

---

## 4. Basic Example

### 4.1 The 4-Argument Error Middleware
```typescript
import express, { Request, Response, NextFunction } from "express";

const app = express();

app.get("/user/:id", (req, res, next) => {
  if (req.params.id === "0") {
    // Pass error to next()
    return next(new Error("Invalid user ID provided"));
  }
  res.json({ id: req.params.id, name: "Alice" });
});

// MUST have all 4 parameters declared!
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error("[ERROR CAUGHT]:", err.message);
  res.status(500).json({
    status: "error",
    message: err.message || "Internal Server Error",
  });
});
```

---

## 5. Real Example

### Production-Grade Enterprise Error Handling Architecture
This architecture segregates **Operational Errors** (client errors, business validation, resource missing) from **Programmer Errors** (null pointer exceptions, syntax errors, native crashes) with environment-aware serialization:

```typescript
// error-handling.ts
import { Request, Response, NextFunction } from "express";

// 1. Base Domain Operational Error Class
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly errorCode: string;
  public readonly details?: unknown;

  constructor(message: string, statusCode: number = 500, errorCode: string = "INTERNAL_ERROR", details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.details = details;
    this.isOperational = true; // Flag distinguishing operational errors from bugs

    // Restore correct prototype chain
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

// 2. Specialized Operational Errors
export class NotFoundError extends AppError {
  constructor(resource: string = "Resource") {
    super(`${resource} not found`, 404, "NOT_FOUND");
  }
}

export class ValidationError extends AppError {
  constructor(details: unknown) {
    super("Request validation failed", 400, "VALIDATION_FAILED", details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = "Authentication required") {
    super(message, 401, "UNAUTHORIZED");
  }
}

// 3. Async Handler Higher-Order Function (for Express 4 compatibility)
export const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// 4. Centralized Error-Handling Middleware
export function centralErrorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // If headers were already sent to client, delegate to default Express handler
  if (res.headersSent) {
    return next(err);
  }

  const isProduction = process.env.NODE_ENV === "production";

  // Determine if error is an expected Operational Error or an unexpected Bug
  if (err instanceof AppError && err.isOperational) {
    res.status(err.statusCode).json({
      status: "fail",
      code: err.errorCode,
      message: err.message,
      details: err.details,
      ...(isProduction ? {} : { stack: err.stack }),
    });
    return;
  }

  // Programmer Error / Unhandled Exception: Do NOT leak internal stack trace in prod!
  console.error("💥 CRITICAL UNHANDLED ERROR:", err);

  res.status(500).json({
    status: "error",
    code: "INTERNAL_SERVER_ERROR",
    message: isProduction ? "An unexpected error occurred. Please try again later." : err.message,
    ...(isProduction ? {} : { stack: err.stack }),
  });
}
```

---

## 6. Under the Hood

### 6.1 Operational vs Programmer Errors
Understanding this distinction is the cornerstone of robust Node.js backend engineering:

```
+-------------------------------------------------------------------------------+
|                       OPERATIONAL vs PROGRAMMER ERRORS                        |
+-------------------------------------------------------------------------------+
| Feature              | Operational Errors             | Programmer Errors     |
+----------------------+--------------------------------+-----------------------+
| Definition           | Foreseeable runtime failures   | Bugs in the software  |
| Examples             | Invalid input, 404 Not Found,  | SyntaxError, null.foo,|
|                      | DB unique constraint, timeout  | ReferenceError        |
| Recovery Strategy    | Return clean HTTP error code   | Log crash, restart    |
| Safe to Continue?    | YES (Process state is clean)   | NO (Process corrupted)|
| HTTP Status Codes    | 400, 401, 403, 404, 409, 422   | 500 Internal Error    |
+----------------------+--------------------------------+-----------------------+
```

### 6.2 Async Errors in Express 4 vs Express 5
- **Express 4.x Internals**: Express 4 was written when callbacks were standard. When you pass an `async` function to `app.get('/', async (req, res) => { ... })`, the function returns a `Promise`. If that promise rejects (e.g., `throw new Error()`), Express 4 has no `.catch()` handler on that promise. The rejection bubbles up to Node's global `process.on('unhandledRejection')`.
- **Express 5.x Native Async Support**: In Express 5, `Layer.prototype.handle_request` wraps the return value in `Promise.resolve(fn(req, res, next)).catch(next)`. Native `throw` statements in `async` functions are caught automatically!

### 6.3 Global Process Safety Nets: Uncaught Exceptions & Unhandled Rejections
Even with the best middleware, errors can occur outside the Express request lifecycle (e.g., in background cron jobs, unhandled Kafka consumers, or detached timers). You must install process-level listeners:

```typescript
// Safe Process Guardians
process.on("unhandledRejection", (reason: unknown) => {
  console.error("Unhandled Rejection at:", reason);
  // In production, log to APM and initiate graceful shutdown if fatal
});

process.on("uncaughtException", (error: Error) => {
  console.error("Uncaught Exception thrown:", error);
  // State is corrupted! Must exit process immediately!
  process.exit(1);
});
```

---

## 7. Important Rules

1. **Always Place Error Middleware at the Very End**: The central error handler must be registered using `app.use(centralErrorHandler)` **after all routes and other middleware**. If registered before a route, it cannot catch errors thrown by that route.
2. **Never Omit the 4th Parameter `next`**: Even if you do not call `next` inside your error handler, you MUST declare `(err, req, res, next)`. If you declare only 3 parameters `(err, req, res)`, Express's `fn.length` check fails and the handler is ignored during error dispatch.
3. **Check `res.headersSent`**: If a streaming response or chunked transfer failed midway, headers are already sent. You cannot call `res.status(500)`. Delegate to `next(err)` to let Node terminate the socket.
4. **Distinguish Dev vs Prod Responses**: Never expose `err.stack` or raw SQL errors in production.

---

## 8. Common Mistakes

### Mistake 1: Forgetting to Return when Invoking `next(err)`
```typescript
// ❌ WRONG: Code continues to execute after next(err)!
app.get("/item", (req, res, next) => {
  if (!req.query.id) {
    next(new Error("ID missing")); // MISSING 'return'!
  }
  // This continues to run, calling db and attempting a second response!
  res.json({ id: req.query.id });
});

//  CORRECT: Always return next(err)
app.get("/item", (req, res, next) => {
  if (!req.query.id) {
    return next(new Error("ID missing"));
  }
  return res.json({ id: req.query.id });
});
```

### Mistake 2: Swallowing Errors Silently in `catch` Blocks
```typescript
// ❌ WRONG: Catches error, logs it, but never notifies Express! Request hangs forever.
app.get("/data", async (req, res, next) => {
  try {
    const data = await fetchData();
    res.json(data);
  } catch (err) {
    console.log(err); // Never called next(err) or res.status()!
  }
});

//  CORRECT: Pass to next(err)
app.get("/data", async (req, res, next) => {
  try {
    const data = await fetchData();
    res.json(data);
  } catch (err) {
    next(err);
  }
});
```

---

## 9. Best Practices

1. **Use Type Guards for Error Inspection**:
   ```typescript
   function isPrismaKnownError(error: unknown): error is PrismaClientKnownRequestError {
     return typeof error === "object" && error !== null && "code" in error;
   }
   ```
2. **Normalize Foreign Errors**: When third-party libraries (Prisma, Mongoose, Axios, Stripe) throw their proprietary errors, translate them into domain `AppError` instances before sending HTTP responses.
3. **Assign Unique Error Trace IDs**: Attach `req.correlationId` to the error response so clients can quote the ID to customer support.

---

## 10. Performance Considerations

```
+-------------------------------------------------------------------------------+
|                       ERROR STACK TRACE GENERATION COST                       |
+-------------------------------------------------------------------------------+
| Operation                             | Overhead (Nanoseconds / Call)         |
+---------------------------------------+---------------------------------------+
| Instantiating `new Error()`           | ~2,500 ns (Captures V8 stack trace)   |
| Instantiating Plain Object `{}`       | ~5 ns                                 |
| Capturing Stack via `Error.capture...`| ~3,000 ns                             |
+---------------------------------------+---------------------------------------+
```

- **V8 Stack Capture Overhead**: Creating `new Error()` captures the entire V8 JavaScript call stack. Avoid throwing errors for normal control flow (e.g., standard form validation loops); use return values or result objects instead.

---

## 11. Security Considerations

1. **Stack Trace Leaks (CWE-209)**: In development, stack traces help developers locate bugs. In production, stack traces reveal operating system paths (`/home/deploy/server/controllers/auth.ts`), database drivers, and internal library versions. Always guard stack output behind `process.env.NODE_ENV !== 'production'`.
2. **Denial of Service via Uncaught Exceptions**: An attacker who discovers a payload that triggers an unhandled `TypeError` can repeatedly hit that endpoint to continually crash the Node process, rendering the site unavailable.

---

## 12. Alternatives

| Approach | Mechanism | Pros / Cons |
| :--- | :--- | :--- |
| **Express Central Error Handler** | 4-arg middleware pipeline. | Standard, simple; requires `asyncHandler` in Express 4. |
| **`express-async-errors` Package** | Monkey-patches Express router to auto-catch promises. | Zero boilerplate; magic monkey-patching. |
| **Domain / Result Pattern (`Either`)** | Functions return `Result<T, E>`. | Pure functional; prevents exceptions entirely. |
| **NestJS Exception Filters** | Decorator-based `@Catch()` classes. | High structure; tied to NestJS framework. |

---

## 13. Trade-offs

- **Crashing on Programmer Errors vs Catching Everything**:
  - *Crashing (Fail-Fast)*: If a programmer bug corrupts application memory or a database transaction state, restarting the process via a process manager (PM2/Kubernetes) is safest to prevent data corruption.
  - *Catching Everything*: Keeps the server up for other users, but risks operating in an undefined, corrupted memory state.
  - *The Senior Consensus*: Catch and handle **operational** errors cleanly; log and **gracefully restart** on fatal **programmer** errors.

---

## 14. Real-World Usage

- **Sentry / Datadog APM**: Error-handling middleware captures the `err` object, attaches request headers and user metadata, and transmits the error payload to Sentry before returning a sanitized JSON response.
- **Fintech Payment Gateways**: Translates raw Stripe/Banking API rejection codes into localized, customer-safe error messages.

---

## 15. Placement Interview Questions

### 15.1 Basic Questions
1. *How does Express know a middleware function is an error handler?*
   - Answer: By checking the number of parameters declared in the function definition (`fn.length`). An error handler must declare exactly 4 parameters: `(err, req, res, next)`.
2. *What is the difference between operational errors and programmer errors?*
   - Answer: Operational errors are foreseeable runtime issues (e.g., 404 Not Found, invalid inputs, database timeouts) that an application should handle gracefully. Programmer errors are bugs in the code (e.g., syntax errors, null reference dereferences) that indicate flawed logic.

### 15.2 Conceptual Questions
3. *Why does Express 4 fail to catch errors thrown inside asynchronous functions?*
   - Answer: Express 4 executes route handlers synchronously. When an `async` function is invoked, it immediately returns a Promise. If an exception occurs after an `await`, the promise rejects asynchronously; Express 4 does not attach a `.catch()` handler to that returned promise, causing an unhandled promise rejection.
4. *What happens if you invoke `next(err)` when `res.headersSent` is already `true`?*
   - Answer: If HTTP response headers have already been sent down the network wire, attempting to write a new status code (like 500) will throw `ERR_HTTP_HEADERS_SENT`. In this case, you must delegate to Express's default error handler by calling `return next(err)`, which closes the connection.

### 15.3 Implementation Questions
5. *Implement a custom `AppError` class in TypeScript that captures the HTTP status code and distinguishes operational errors from bugs.*
   - Answer:
     ```typescript
     export class AppError extends Error {
       public readonly statusCode: number;
       public readonly isOperational: boolean;
       constructor(message: string, statusCode: number) {
         super(message);
         this.statusCode = statusCode;
         this.isOperational = true;
         Error.captureStackTrace(this, this.constructor);
       }
     }
     ```

### 15.4 Debugging Questions
6. *A developer writes `app.use((err, req, res) => { res.status(500).send("Error"); })` and reports that the error handler never executes. What is the bug?*
   - Answer: The developer declared only 3 arguments `(err, req, res)`, omitting `next`. Express checks `fn.length === 4`. Because `fn.length` is 3, Express treats it as standard middleware and skips it during error dispatch. Fix by declaring `(err, req, res, next)`.

### 15.5 Scenario Questions
7. *Design a graceful shutdown sequence when an uncaught exception occurs in a multi-instance Express production service.*
   - Answer:
     1. Log the fatal exception with full stack trace to persistent logging/APM.
     2. Stop the HTTP server from accepting new connections (`server.close()`).
     3. Allow existing in-flight HTTP requests a grace period (e.g., 10 seconds) to finish.
     4. Close database connection pools (`db.pool.end()`) and Redis clients.
     5. Terminate the process via `process.exit(1)`, allowing Kubernetes/PM2 to spawn a fresh, clean container.

### 15.6 Advanced Questions
8. *How does Express 5 natively resolve the async error handling problem?*
   - Answer: In Express 5, the router internally wraps every middleware and route handler invocation in `Promise.resolve(fn(req, res, next)).catch(next)`. This ensures any rejected promise or thrown error in an async function is automatically intercepted and passed to `next(err)` without requiring third-party libraries or manual `try/catch` wrappers.

---

## 16. Coding Questions

### Problem 1: Implement an Automated Unhandled Route (404) & Central Error Handling System
**Question**: Write a complete, self-contained Express application in TypeScript featuring:
1. A catch-all 404 handler that generates an operational `NotFoundError`.
2. A route that simulates an asynchronous database failure.
3. A centralized error handler that maps different error types to appropriate JSON responses.

```typescript
// central-error-demo.ts
import express, { Request, Response, NextFunction } from "express";

class AppError extends Error {
  constructor(public message: string, public statusCode: number) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

const app = express();
app.use(express.json());

// Normal Route
app.get("/api/items", (req, res) => {
  res.json({ items: ["Item 1", "Item 2"] });
});

// Route with Async Error
app.get("/api/broken", async (req, res, next) => {
  try {
    // Simulate failed DB call
    throw new AppError("Database connection failed", 503);
  } catch (err) {
    next(err);
  }
});

// 1. Catch-All 404 Handler for Unmatched Routes
app.all("*", (req: Request, res: Response, next: NextFunction) => {
  next(new AppError(`Cannot find ${req.method} ${req.originalUrl} on this server`, 404));
});

// 2. Centralized Error-Handling Middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  const statusCode = err.statusCode || 500;
  const status = `${statusCode}`.startsWith("4") ? "fail" : "error";

  res.status(statusCode).json({
    status,
    message: err.message || "Internal Server Error",
    ...(process.env.NODE_ENV === "development" ? { stack: err.stack } : {}),
  });
});

export default app;
```

---

## 17. Common Interview Traps

- **Trap 1**: "Can you have multiple error-handling middleware functions in Express?"
  - *Reality*: Yes! You can chain multiple error handlers:
    ```typescript
    app.use(logErrors);
    app.use(clientErrorHandler);
    app.use(catchAllErrorHandler);
    ```
    Each error handler must call `next(err)` to pass the error to the next error handler in line.
- **Trap 2**: "Does `try/catch` catch errors inside callbacks like `fs.readFile`?"
  - *Reality*: No! A `try/catch` block only catches synchronous exceptions within its immediate execution frame. Errors passed to standard Node callbacks `(err, data)` must be checked manually via `if (err) return next(err);`.
- **Trap 3**: "Is `process.on('uncaughtException')` meant to keep the server running without restarting?"
  - *Reality*: Absolutely not. The official Node.js documentation explicitly states that `uncaughtException` leaves the runtime in an undefined state. It should only be used to log the incident and perform cleanup before calling `process.exit(1)`.

---

## 18. Revision Summary

- **4-Parameter Signature**: Must declare `(err, req, res, next)`.
- **Placement**: Must be mounted at the very end of the middleware stack.
- **Operational vs Bugs**: Segregate expected domain failures (4xx) from unexpected software bugs (500).
- **Async Handling**: In Express 4, wrap async functions with `asyncHandler` or use `express-async-errors`. Express 5 catches async rejections natively.
- **Production Sanitation**: Never leak stack traces or internal database schema errors to end clients.

---

## 19. Quick Reference

```typescript
// 1. Custom Error Class
class AppError extends Error {
  constructor(message: string, public statusCode: number = 500) {
    super(message);
  }
}

// 2. Async Wrapper
const asyncHandler = (fn: Function) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// 3. Central Handler
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) return next(err);
  res.status(err.statusCode || 500).json({ error: err.message });
});
```
