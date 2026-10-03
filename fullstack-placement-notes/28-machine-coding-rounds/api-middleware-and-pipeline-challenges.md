# API Middleware and Pipeline Architecture: Machine Coding Implementation

## 1. What is it?
An **API Middleware Pipeline** is an architectural pattern for executing a sequence of composable, decoupled processing stages across an incoming request before it reaches the final route handler, as well as intercepting the response before it returns to the client.

In machine coding rounds, interviewers often ask candidates to implement:
1. **Express-Style Linear Middleware Runner:** Each middleware receives `(context, next)` where calling `next()` hands control off to the subsequent function sequentially.
2. **Koa-Style Onion Pipeline:** Modern `async/await` middleware execution where calling `await next()` suspends current function execution, yields to downstream middleware, and resumes execution on the return path (allowing pre-processing and post-processing in a single function).
3. **Error Pipeline Dispatcher:** Specialized error handlers that bypass normal execution chains when an exception or rejection occurs.

```
                    THE KOA ONION MIDDLEWARE MODEL
                    
   Request ──► ┌──────────────────────────────────────────┐ ──► Response
               │ Middleware 1 (Logger / Timer)            │
               │   Before: start = Date.now()             │
               │   ┌──────────────────────────────────┐   │
               │   │ Middleware 2 (Authentication)    │   │
               │   │   Before: verifyToken()          │   │
               │   │   ┌──────────────────────────┐   │   │
               │   │   │ Target Route Handler     │   │   │
               │   │   │   res.body = { ok: true }│   │   │
               │   │   └──────────────────────────┘   │   │
               │   │   After: setSecurityHeaders()    │   │
               │   └──────────────────────────────────┘   │
               │   After: logDuration(Date.now() - start) │
               └──────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Without a modular middleware pipeline, backend logic suffers from:
1. **Boilerplate Duplication:** Every single endpoint manually parses headers, checks JWTs, instantiates database transactions, and catches errors.
2. **Tight Coupling:** Cross-cutting concerns (logging, authentication, tracing, compression) become tangled with core business logic.
3. **Inconsistent Error Handling:** Stray exceptions crash the server or hang open HTTP connections indefinitely without standardized JSON error payloads.

---

## 3. Mental Model
Think of a middleware pipeline as an **Airport Security Checkpoint**:

```
                       AIRPORT CHECKPOINT ANALOGY
                       
  [ Passenger (Request Context) ]
         │
         ▼  [ Station 1: Ticket & ID Scanner ]
  Checks passport. If expired, immediately turns passenger around (Short-circuit).
  If valid, stamps boarding pass and shouts: "Next!"
         │
         ▼  [ Station 2: Baggage X-Ray ]
  Scans luggage. Attaches "Luggage Cleaned" sticker onto context.
  Shouts: "Next!"
         │
         ▼  [ Station 3: Body Scanner ]
  Checks passenger. Shouts: "Next!"
         │
         ▼  [ Final Gate: Boarding Airplane (Route Handler) ]
  Passenger arrives at seat.
```

---

## 4. Basic Example: Linear Middleware Runner (Express Style)

```typescript
type NextFunction = (err?: any) => void;
type Middleware<T> = (context: T, next: NextFunction) => void | Promise<void>;

export class SimplePipeline<T> {
  private stack: Middleware<T>[] = [];

  public use(middleware: Middleware<T>): this {
    this.stack.push(middleware);
    return this;
  }

  public execute(context: T, callback?: (err?: any) => void): void {
    let index = -1;

    const dispatch = (i: number, err?: any) => {
      if (err) {
        if (callback) return callback(err);
        throw err;
      }

      if (i <= index) {
        throw new Error('next() called multiple times!');
      }

      index = i;

      if (i >= this.stack.length) {
        if (callback) callback();
        return;
      }

      const fn = this.stack[i];
      try {
        fn(context, (errParam) => dispatch(i + 1, errParam));
      } catch (caughtErr) {
        dispatch(i + 1, caughtErr);
      }
    };

    dispatch(0);
  }
}
```

---

## 5. Real Example: Production Koa-Style Onion Pipeline with Context & Error Handling

```typescript
export interface PipelineContext {
  req: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: any;
  };
  res: {
    statusCode: number;
    headers: Record<string, string>;
    body?: any;
  };
  state: Record<string, any>; // Dependency injection & claims
}

export type KoaMiddleware = (
  ctx: PipelineContext,
  next: () => Promise<void>
) => Promise<void>;

export class OnionPipeline {
  private middlewares: KoaMiddleware[] = [];

  public use(fn: KoaMiddleware): this {
    if (typeof fn !== 'function') {
      throw new TypeError('Middleware must be a function!');
    }
    this.middlewares.push(fn);
    return this;
  }

  /**
   * Composes middleware array into a single executable function
   */
  public compose(): (ctx: PipelineContext) => Promise<void> {
    return (ctx: PipelineContext) => {
      let lastInvokedIndex = -1;

      const dispatch = (i: number): Promise<void> => {
        // Prevent calling next() multiple times in the same middleware
        if (i <= lastInvokedIndex) {
          return Promise.reject(new Error(`next() called multiple times in middleware ${i}`));
        }

        lastInvokedIndex = i;

        const fn = this.middlewares[i];

        if (i === this.middlewares.length) {
          // Reached end of pipeline
          return Promise.resolve();
        }

        try {
          // Bind dispatch to next index
          return Promise.resolve(fn(ctx, () => dispatch(i + 1)));
        } catch (err) {
          return Promise.reject(err);
        }
      };

      return dispatch(0);
    };
  }
}
```

### Demonstration: Logging, Authentication, and Route Execution
```typescript
const app = new OnionPipeline();

// 1. Logging & Execution Timing Middleware (Onion Outer Layer)
app.use(async (ctx, next) => {
  const start = Date.now();
  console.log(`--> [INCOMING] ${ctx.req.method} ${ctx.req.url}`);

  await next(); // Suspends and passes control downstream

  const duration = Date.now() - start;
  ctx.res.headers['X-Response-Time'] = `${duration}ms`;
  console.log(`<-- [OUTGOING] ${ctx.res.statusCode} (${duration}ms)`);
});

// 2. Authentication Middleware
app.use(async (ctx, next) => {
  const authHeader = ctx.req.headers['authorization'];
  if (!authHeader) {
    ctx.res.statusCode = 401;
    ctx.res.body = { error: 'Unauthorized: Missing token' };
    return; // Short-circuits! Does NOT call next()!
  }

  // Inject claims into context state
  ctx.state.user = { id: 'u_8842', role: 'ENGINEER' };
  await next();
});

// 3. Final Target Route Handler
app.use(async (ctx) => {
  ctx.res.statusCode = 200;
  ctx.res.body = {
    message: `Hello ${ctx.state.user.id}!`,
    status: 'Pipeline execution successful'
  };
});
```

---

## 6. Under the Hood: Recursive Call Stack and Promise Resolution

```
                  ONION STACK TRACE & EXECUTION ORDER
                  
  Caller: compose()(ctx)
     │
     ├──► dispatch(0) -> Middleware 1 starts
     │       │
     │       └── await next() ──► dispatch(1) -> Middleware 2 starts
     │                              │
     │                              └── await next() ──► dispatch(2) -> Handler
     │                                                     │
     │                                                     └── Handler completes
     │                              ┌──────────────────────┘
     │                              ▼
     │       ◄── Middleware 2 resumes after next() & returns
     │
     ◄── Middleware 1 resumes after next() & returns
  All Promises Resolved!
```

---

## 7. Important Rules

1. **Never Call `next()` Twice:** Invoking `next()` multiple times inside a single middleware creates race conditions and corrupts downstream state. The pipeline must throw: `next() called multiple times`.
2. **Always Await `next()` in Koa Models:** Forgetting `await next()` causes the outer middleware to finish before downstream middleware finishes, breaking post-processing timers and response headers.
3. **Short-Circuiting Without `next()`:** To abort the pipeline (e.g. on validation or authentication failure), simply set the response status/body and return without invoking `next()`.

---

## 8. Common Mistakes

```typescript
// ❌ MISTAKE 1: Forgetting to await next()
app.use(async (ctx, next) => {
  next(); // BUG: Asynchronous race condition! Outer middleware returns prematurely!
  ctx.res.headers['X-Time'] = 'done'; // Sets header after response already sent!
});

// ❌ MISTAKE 2: Calling next() after sending a response
if (!user) {
  res.status(401).json({ error: 'Auth failed' });
  next(); // BUG: Route handler downstream will execute anyway!
}

// ❌ MISTAKE 3: Dropping async exceptions
app.use((req, res, next) => {
  db.query().then(data => res.json(data)); // BUG: Unhandled promise rejection crashes Node!
  // Fix: .catch(next) or wrap in async with try/catch
});
```

---

## 9. Best Practices
1. **Strong Context Typing:** Always define a strict TypeScript interface for `Context` containing `req`, `res`, and `state`.
2. **Centralized Error Boundary:** Place a global `try/catch` wrapper at the very top of the onion pipeline to catch unhandled downstream errors and format standardized 500 JSON responses.
3. **Async Wrapper for Express:** If working in Express 4.x, wrap all async routes in an `asyncHandler` helper to pass errors to `next(err)`.

---

## 10. Performance Considerations
- **Memory Footprint:** Each layer of middleware allocation creates closures. Keep the pipeline concise (typically 8–15 middleware layers maximum).
- **Early Exit:** Place fast rejecting middleware (IP blocklists, rate limiters, body size verifiers) at the front of the pipeline to discard invalid traffic before running expensive JWT or database operations.

---

## 11. Security Considerations
- **Body Parser Limits:** Place body parsing middleware early and configure strict byte limits (`express.json({ limit: '100kb' })`) to prevent heap exhaustion attacks.
- **Security Headers:** Enforce `helmet` (HSTS, CSP, X-Frame-Options) at the outer edge of the pipeline so every response is protected.

---

## 12. Alternatives
1. **Aspect-Oriented Programming (AOP):** Method decorators (`@UseGuards(AuthGuard)`) in frameworks like NestJS.
2. **Reverse Proxy Layer:** Offload authentication and rate limiting upstream to an Envoy, Kong, or Nginx gateway.

---

## 13. Trade-offs

| Pipeline Architecture | Advantages | Trade-offs |
|---|---|---|
| **Linear (Express)** | Easy to understand, simple callback design | Awkward post-processing (requires hooking into `res.on('finish')`) |
| **Onion (Koa)** | Elegant pre- and post-processing; native `async/await` | Requires understanding recursive Promise suspension |

---

## 14. Real-World Usage
- **Express.js / Koa.js / Hono:** The underlying engine for billions of HTTP requests processed globally each day.
- **Redux Middleware:** Uses the identical nested curried pipeline pattern: `store => next => action => { ... }`.

---

## 15. Placement Interview Questions

### Basic
1. *What happens if a middleware function neither calls `next()` nor sends a response?*
   - **Answer:** The HTTP request hangs indefinitely until the client or gateway times out (typically after 60–120 seconds with a 504 Gateway Timeout).

### Conceptual
2. *How does Koa's "Onion" architecture differ from Express's linear middleware pipeline?*
   - **Answer:** Express middleware executes linearly; once `next()` is called, control passes downstream and the current middleware cannot easily inspect the downstream response without monkey-patching `res.send`. Koa uses async functions where `await next()` suspends execution, allowing the function to run code both *before* and *after* downstream handlers execute.

### Implementation
3. *How do you prevent `next()` from being called multiple times in a custom pipeline runner?*
   - **Answer:** Maintain an index tracking the last invoked middleware index (`let lastIndex = -1`). If `currentIndex <= lastIndex`, throw an error (`"next() called multiple times"`).

### Debugging
4. *An authentication middleware checks a token and calls `res.status(401).send()`, but the console shows "Cannot set headers after they are sent". Why?*
   - **Answer:** The code called `res.status(401).send()` but forgot to `return`, allowing execution to continue down the function body to `next()`, which invoked downstream handlers that attempted to send another response.

### Scenario
5. *How would you implement a request-timing middleware in Express without using Koa's onion model?*
   - **Answer:** Capture `const start = process.hrtime.bigint()` in the middleware, and attach an event listener to the response object: `res.on('finish', () => { const duration = process.hrtime.bigint() - start; })`.

### Advanced
6. *How does Redux's `applyMiddleware` implementation use function composition?*
   - **Answer:** Redux uses functional composition (`compose(...middlewares)`) to transform each middleware with signature `store => next => action` into a single nested dispatch function where the innermost `next` points to the raw `store.dispatch`.

---

## 16. Coding Questions

### Problem: Build a Typed Pipeline Runner with Global Error Handling
Implement a fully functional `AsyncPipeline` class supporting middleware composition and centralized error catching.

```typescript
export type AsyncMiddleware<T> = (context: T, next: () => Promise<void>) => Promise<void>;

export class AsyncPipeline<T> {
  private middlewares: AsyncMiddleware<T>[] = [];

  public use(middleware: AsyncMiddleware<T>): this {
    this.middlewares.push(middleware);
    return this;
  }

  public async run(context: T): Promise<void> {
    let index = -1;

    const dispatch = async (i: number): Promise<void> => {
      if (i <= index) {
        throw new Error('next() called multiple times in pipeline!');
      }

      index = i;

      if (i === this.middlewares.length) {
        return;
      }

      const fn = this.middlewares[i];
      await fn(context, () => dispatch(i + 1));
    };

    try {
      await dispatch(0);
    } catch (error) {
      console.error('Unhandled pipeline exception caught at boundary:', error);
      throw error;
    }
  }
}
```

---

## 17. Common Interview Traps
- **Trap 1:** Forgetting to return `Promise.resolve()` for the terminating condition when `i === middlewares.length`.
  *Reality:* If the terminal case returns `undefined`, `await next()` will resolve immediately without waiting on downstream tasks.
- **Trap 2:** Not wrapping `fn(context, next)` in a `try/catch` or `Promise.resolve()`.
  *Reality:* Synchronous throws inside an async middleware must be caught and routed into Promise rejections.

---

## 18. Revision Summary
- **Pipeline Pattern:** Deconstructs monolithic endpoints into modular, reusable steps.
- **Linear vs. Onion:** Linear only passes downstream; Onion wraps downstream with `await next()`.
- **Short-Circuiting:** Do not call `next()` when terminating early.
- **Safety:** Always guard against calling `next()` multiple times using index tracking.

---

## 19. Quick Reference

```
┌─────────────────────────────────┬───────────────────────────────────────────────┐
│ REQUIREMENT                     │ IMPLEMENTATION KEY POINT                      │
├─────────────────────────────────┼───────────────────────────────────────────────┤
│ Express Style                   │ fn(req, res, next) with explicit dispatch(i+1)│
│ Koa Onion Style                 │ async (ctx, next) => { ... await next(); ... }│
│ Prevent Double Next             │ if (i <= lastInvokedIndex) throw Error(...)   │
│ Early Termination               │ Set ctx.res and return without calling next() │
│ Centralized Error Boundary      │ Outer try/catch wrapping initial dispatch(0)  │
└─────────────────────────────────┴───────────────────────────────────────────────┘
```
