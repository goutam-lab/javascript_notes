# Structured Logging, Correlation IDs, and Observability with Winston

---

## 1. What is it?

**Structured Logging** is the practice of emitting application logs in a standardized, machine-readable format—predominantly serialized **JSON**—rather than unstructured, plain-text strings. Every log entry contains well-defined key-value attributes: ISO-8601 timestamp, log level (`info`, `warn`, `error`), message, environment, service name, error stack traces, and contextual metadata.

A **Correlation ID** (also called a Trace ID or Request ID) is a unique identifier (typically a UUID v4) generated at the network entry point (API Gateway or Express middleware) and attached to an incoming HTTP request via headers (`X-Correlation-ID`). This identifier is propagated through every internal service, database call, asynchronous worker, and downstream microservice. When searching log aggregators (Elasticsearch, Datadog, Grafana Loki), querying a single Correlation ID reconstructs the entire end-to-end lifecycle of that specific request across the entire distributed system.

```
+-------------------------------------------------------------------------------+
|                       DISTRIBUTED TRACING VIA CORRELATION ID                  |
+-------------------------------------------------------------------------------+
| [ Client HTTP Request ]                                                       |
|           | (Headers: X-Correlation-ID: "a81f-442b-911e")                    |
|           v                                                                   |
| [ Express API Gateway ] ---- Log: { "correlationId": "a81f...", "msg": "API" }|
|           |                                                                   |
|           +--> HTTP Call to Payment Service (Forwarding X-Correlation-ID)    |
|           |         |                                                         |
|           |         v                                                         |
|           |    [ Payment Service ] -- Log: { "correlationId": "a81f...", ... }|
|           |                                                                   |
|           +--> Publishes BullMQ Job { data, correlationId: "a81f..." }        |
|                     |                                                         |
|                     v                                                         |
|                [ Background Worker ] - Log: { "correlationId": "a81f...", ... }|
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

In junior-level codebases, developers use `console.log()`:

```typescript
// ❌ PRODUCTION NIGHTMARE: Unstructured plain text
console.log("User logged in: " + user.id);
console.log("Error occurred: " + err);
```

This creates critical production problems:
1. **Unsearchable in Log Aggregators**: When your application processes 10,000 requests per second, searching for errors in a sea of plain text requires expensive, slow full-text regex scanning across terabytes of data.
2. **Missing Distributed Context**: In a microservice architecture, when a user reports that their payment timed out, finding the matching database query or background worker log without a common Correlation ID is like finding a needle in a haystack.
3. **Performance Degradation**: Synchronous terminal writes via `console.log()` can block the single-threaded Node.js event loop under heavy load.
4. **No Log Levels**: You cannot filter out low-priority debugging logs in production while keeping error and warning logs active.

Structured logging transforms logs from raw console printouts into rich, queryable analytical data.

---

## 3. Mental Model

Visualize a **Crime Investigation / Detective Case File**:

- **Unstructured Logging (`console.log`)**: An investigator writing messy, unorganized sticky notes on random walls: *"Found a red shoe."* *"Heard a noise at 2am."* *"Someone broke glass."* Good luck connecting the red shoe to a specific robbery when you have 100,000 sticky notes.
- **Structured Logging with Correlation IDs**: Every piece of evidence is sealed in a barcode-tagged transparent bag.
  - The bag contains structured labels: `Date: 2026-10-03`, `OfficerID: 402`, `EvidenceType: Shoe`, `CaseFileID: #CRIME-9921`.
  - To solve Case #CRIME-9921, the detective simply scans the barcode in the central database. Instantaneously, every interview, photograph, forensic report, and fingerprint matching `#CRIME-9921` appears on the screen in perfect chronological order.

---

## 4. Basic Example

### 4.1 Production Winston Logger Setup
```typescript
import winston from "winston";

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DDTHH:mm:ss.SSSZ" }),
  winston.format.errors({ stack: true }), // Automatically extracts Error.stack
  winston.format.json() // Outputs pure machine-readable JSON
);

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: logFormat,
  defaultMeta: { service: "order-service", environment: process.env.NODE_ENV },
  transports: [
    new winston.transports.Console(), // Production best practice: Log to stdout!
  ],
});

// Emitting structured logs
logger.info("Order processed successfully", {
  orderId: "ord_1029",
  userId: "usr_55",
  amount: 49.99,
  correlationId: "req_a98f12",
});

// Emitting an error with automatic stack trace extraction
logger.error("Failed to connect to payment gateway", {
  error: new Error("ETIMEDOUT"),
  correlationId: "req_a98f12",
});
```

---

## 5. Real Example

### Complete Express Correlation ID Middleware with AsyncLocalStorage Context Propagation
In asynchronous Node.js applications, passing `correlationId` manually through 15 function arguments is error-prone. Node's **`AsyncLocalStorage`** solves this by providing "thread-local" context across asynchronous call chains:

```typescript
// logger-context.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import winston from "winston";

// 1. Setup AsyncLocalStorage Store
interface RequestContext {
  correlationId: string;
  userId?: string;
}

export const requestContextStore = new AsyncLocalStorage<RequestContext>();

// 2. Winston Logger with Dynamic Context Injection
const contextFormat = winston.format((info) => {
  const context = requestContextStore.getStore();
  if (context) {
    info.correlationId = context.correlationId;
    if (context.userId) info.userId = context.userId;
  }
  return info;
});

export const appLogger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    contextFormat(),
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: "api-gateway" },
  transports: [new winston.transports.Console()],
});

// 3. Express Correlation ID Middleware
export function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Read incoming header or generate a fresh UUID
  const correlationId = (req.headers["x-correlation-id"] as string) || crypto.randomUUID();

  // Echo header back to client in response
  res.setHeader("X-Correlation-Id", correlationId);

  // Wrap remaining request execution in the AsyncLocalStorage context
  const context: RequestContext = { correlationId };
  requestContextStore.run(context, () => {
    appLogger.info("Incoming HTTP Request", {
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
    });

    res.on("finish", () => {
      appLogger.info("HTTP Request Completed", {
        statusCode: res.statusCode,
      });
    });

    next();
  });
}

// 4. Downstream Service (Zero parameter drilling needed!)
export class OrderProcessor {
  async executePayment(amount: number): Promise<void> {
    // appLogger automatically pulls correlationId from AsyncLocalStorage!
    appLogger.info("Initiating payment gateway charge", { amount });
    
    // Simulate payment call
    await new Promise((r) => setTimeout(r, 100));
    
    appLogger.info("Payment confirmed by gateway", { amount });
  }
}
```

---

## 6. Under the Hood

### 6.1 The 12-Factor App Logging Standard: Log to `stdout`
A common anti-pattern is configuring Winston to write logs directly into local server files (`winston.transports.File({ filename: 'app.log' })`).
In containerized cloud environments (Docker, Kubernetes, AWS ECS), **writing to local disk files is an anti-pattern**:
1. Pods are ephemeral; when a Kubernetes pod terminates, all local files are destroyed.
2. File I/O competes with application threads for local disk bandwidth.
3. The **Twelve-Factor App (Factor XI: Logs)** mandates that applications should treat logs as event streams and write directly to unbuffered **`stdout`**.
4. A dedicated background agent (Promtail, Fluentd, Vector, Datadog Agent) running as a sidecar or daemonset scrapes container `stdout` streams, compresses them, and ships them to long-term storage (Loki, Elasticsearch, S3).

```
[ Node.js Process ] ---> process.stdout.write(JSON)
                                 |
                                 v
                     [ Docker Container stdout ]
                                 |
                                 v
                     [ Fluentd / Promtail Agent ]
                                 |
                                 v
                     [ Grafana Loki / Elasticsearch ]
```

### 6.2 Log Levels (RFC 5424 Standard)
Winston follows the RFC 5424 severity hierarchy:

```
+-------------------------------------------------------------------------------+
|                       RFC 5424 LOG LEVEL HIERARCHY                            |
+-------------------------------------------------------------------------------+
| Priority | Level     | Meaning / Production Guideline                         |
+----------+-----------+--------------------------------------------------------+
|    0     | error     | Fatal errors, DB outages, unhandled exceptions. Alerts!|
|    1     | warn      | Recoverable anomalies (e.g. rate limit hit, retry).    |
|    2     | info      | Milestone events (server booted, order placed). Normal.|
|    3     | http      | HTTP access logs (status code, latency, route).        |
|    4     | verbose   | Granular operational details.                          |
|    5     | debug     | Low-level diagnostic traces (developer inspection).    |
|    6     | silly     | Absolute maximum noise (loop iterations, raw payloads).|
+----------+-----------+--------------------------------------------------------+
```

When `level: 'warn'` is configured, Winston emits `error` and `warn`, suppressing all lower levels (`info`, `http`, `debug`).

---

## 7. Important Rules

1. **Always Output JSON in Production**: Use human-readable colorized text only in local development (`NODE_ENV === 'development'`). In staging and production, always output raw JSON.
2. **Propagate Correlation IDs on External HTTP Calls**: When making downstream calls to other microservices via `fetch` or `axios`, forward the header: `{ 'X-Correlation-ID': correlationId }`.
3. **Never Log Sensitive PII**: Strip or mask credit card numbers, passwords, JWT tokens, social security numbers, and session cookies before logging.
4. **Always Log Errors with Stack Traces**: Never write `logger.error("Failed: " + err)`. This strips the error object's stack trace! Pass the raw Error instance: `logger.error("Failed", { err })`.

---

## 8. Common Mistakes

### Mistake 1: String Concatenation in Log Messages
```typescript
// ❌ WRONG: Destroys structured indexing in Elasticsearch!
logger.info("Order " + orderId + " failed with amount " + amount);

//  CORRECT: Static message + structured metadata object
logger.info("Order processing failed", { orderId, amount });
```

### Mistake 2: Missing Error Object in Catch Blocks
```typescript
// ❌ WRONG: Converts error to string "[object Object]", losing stack trace!
catch (err) {
  logger.error(`Database query failed: ${err}`);
}

//  CORRECT: Pass Error object into metadata
catch (err) {
  logger.error("Database query failed", { err });
}
```

### Mistake 3: Storing Entire Request Bodies Containing Passwords
```typescript
// ❌ SECURITY DISASTER: Logs plain-text passwords into cloud monitoring!
app.post("/login", (req, res) => {
  logger.info("Login attempt", { body: req.body }); // Contains raw password!
});
```

---

## 9. Best Practices

1. **Use PII Redaction Masks**: Configure Winston format filters to automatically redact sensitive fields:
   ```typescript
   const redactFormat = winston.format((info) => {
     if (info.password) info.password = "[REDACTED]";
     if (info.creditCard) info.creditCard = `****-****-****-${info.creditCard.slice(-4)}`;
     return info;
   });
   ```
2. **Standardize Schema Keys Across Microservices**: Ensure every service uses the exact same keys: `timestamp`, `level`, `service`, `message`, `correlationId`, `durationMs`.
3. **Use `AsyncLocalStorage` for Zero-Drilling Context**: Avoid passing `correlationId` manually through business services.

---

## 10. Performance Considerations

```
+-------------------------------------------------------------------------------+
|                       LOGGING LIBRARY BENCHMARKS (100,000 Ops)                |
+-------------------------------------------------------------------------------+
| Logger                       | Operations / Sec | Event Loop Lag Overhead     |
+------------------------------+------------------+-----------------------------+
| console.log()                | ~18,000 ops/sec  | High (Blocks during stdout) |
| Winston (Console Transport)  | ~32,000 ops/sec  | Moderate                    |
| Pino (Extreme Mode / Worker) | ~140,000 ops/sec | Near Zero (4.5x faster 🚀)  |
+------------------------------+------------------+-----------------------------+
```

- **Winston vs Pino**: Winston is the most popular, feature-rich logging library with massive transport ecosystems. **Pino** is designed specifically for extreme high-throughput microservices ($> 50,000$ req/s), using worker threads (`thread-stream`) to serialize JSON without blocking the main event loop.

---

## 11. Security Considerations

1. **Log Injection (CWE-117)**: If an attacker submits a username containing newline characters (`\n`), naive plain-text loggers create fake log entries:
   ```
   User logged in: admin\n[2026-10-03] [ERROR] Admin privileges granted to attacker
   ```
   **JSON Structured Logging completely neutralizes Log Injection** because the entire string is serialized into an escaped JSON string literal (`"admin\\n[2026..."`).
2. **GDPR / Compliance Violations**: Storing unmasked customer emails, phone numbers, or IP addresses in centralized log servers violates GDPR's "Right to be Forgotten" since logs cannot easily be edited retroactively.

---

## 12. Alternatives & Tooling

| Logger / System | Role | Best Use Case |
| :--- | :--- | :--- |
| **Winston** | Standard enterprise logger. | General Node.js / Express backend services. |
| **Pino** | Ultra-high-speed JSON logger. | High-throughput microservices, Fastify. |
| **OpenTelemetry (OTel)** | Vendor-neutral distributed tracing standard. | Complex multi-language microservices. |
| **Grafana Loki / Logstash** | Centralized log ingestion engines. | Cloud infrastructure log storage and indexing. |

---

## 13. Trade-offs

- **Verbose Logging vs Storage Costs**:
  - Emitting detailed debug logs for every request makes debugging easy, but in production, ingesting 50GB of logs per day into Datadog or AWS CloudWatch can cost thousands of dollars per month.
  - Set production log levels to `info` or `warn`, with the ability to dynamically toggle to `debug` via environment variables or feature flags.

---

## 14. Real-World Usage

- **Fintech Payment Audits**: Every bank transaction produces an immutable structured JSON log tagged with transaction ID, account ID, and latency, retained for 7 years for compliance audits.
- **Incident Post-Mortems**: Engineering teams trace outages by filtering logs for `level: "error"` and grouping by `correlationId`.

---

## 15. Placement Interview Questions

### 15.1 Basic Questions
1. *What is Structured Logging and why is JSON the preferred format?*
   - Answer: Structured logging formats log messages as structured key-value pairs rather than unstructured plain text. JSON is the preferred format because it is universally machine-readable, easily parsed by log aggregation tools (Elasticsearch, CloudWatch, Loki), and supports typed properties (numbers, booleans, objects).
2. *What is a Correlation ID (Request ID) in backend systems?*
   - Answer: A Correlation ID is a unique identifier assigned to an incoming request at the entry point of a system and passed along through all internal function calls, database queries, and downstream microservices. It allows engineers to trace the full lifecycle of a single request across distributed logs.

### 15.2 Conceptual Questions
3. *Why is `console.log()` considered an anti-pattern in production Node.js applications?*
   - Answer: `console.log()` outputs unstructured plain text that cannot be easily indexed or queried, lacks configurable log levels (`warn`, `info`, `debug`), cannot attach standardized metadata automatically, and is synchronous when writing to terminals/files, which can cause Event Loop blocking under high load.
4. *How does `AsyncLocalStorage` help with logging in Node.js?*
   - Answer: `AsyncLocalStorage` allows storing data (such as a Correlation ID or authenticated user ID) that persists across the entire asynchronous execution chain of a request. This enables logging functions to access the current request's context anywhere in the codebase without having to manually pass the ID through every function argument.

### 15.3 Implementation Questions
5. *How do you configure an Express middleware to forward an incoming `X-Correlation-ID` or generate a new one if missing?*
   - Answer:
     ```typescript
     app.use((req, res, next) => {
       const correlationId = (req.headers["x-correlation-id"] as string) || crypto.randomUUID();
       req.correlationId = correlationId;
       res.setHeader("X-Correlation-Id", correlationId);
       next();
     });
     ```

### 15.4 Debugging Questions
6. *Your production error logs contain `[object Object]` instead of stack traces. What is the bug and how do you resolve it?*
   - Answer: The developer logged errors using template string interpolation (`logger.error(`Failed: ${err}`)`), which calls `err.toString()`. To fix this, pass the error object as a dedicated property in the metadata object (`logger.error("Failed", { err })`) and enable Winston's `winston.format.errors({ stack: true })`.

### 15.5 Scenario Questions
7. *Design an automated PII-masking sanitizer for Winston that prevents credit card numbers and passwords from ever appearing in logs.*
   - Answer: Create a custom Winston format that recursively inspects log metadata keys. If a key matches `/password|secret|token/i`, replace its value with `"[REDACTED]"`. If a value matches a credit card regex (`/\b(?:\d[ -]*?){13,16}\b/`), mask all but the last 4 digits.

### 15.6 Advanced Questions
8. *How does Log Injection (CWE-117) work, and how does structured JSON logging mathematically prevent it?*
   - Answer: In plain-text logging, if an attacker passes input containing carriage return and newline characters (`\r\n`), they can forge fake log entries that deceive log parsers and auditors. Structured JSON logging mathematically prevents this because JSON serialization escapes all control characters (`\n` becomes `\n`), keeping the input safely encapsulated within a single string value inside the JSON document.

---

## 16. Coding Questions

### Problem 1: Implement an AsyncLocalStorage-Powered Logging Pipeline
**Question**: Implement a self-contained TypeScript module that uses Node's native `AsyncLocalStorage` to maintain request context (Correlation ID) and exposes a `logInfo(message, meta)` function that automatically merges the active Correlation ID into the output JSON.

```typescript
// tracing-logger.ts
import { AsyncLocalStorage } from "node:async_hooks";

interface TracingContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<TracingContext>();

export function runWithCorrelationId<T>(correlationId: string, fn: () => T): T {
  return storage.run({ correlationId }, fn);
}

export function logInfo(message: string, meta: Record<string, any> = {}): void {
  const context = storage.getStore();
  const entry = {
    timestamp: new Date().toISOString(),
    level: "INFO",
    message,
    correlationId: context?.correlationId ?? "NONE",
    ...meta,
  };
  process.stdout.write(JSON.stringify(entry) + "\n");
}

// Verification Test
async function simulateWorkerTask() {
  logInfo("Starting background worker task");
  await new Promise((r) => setTimeout(r, 50));
  logInfo("Worker task completed successfully", { itemsProcessed: 42 });
}

// Execute inside context
runWithCorrelationId("corr_uuid_998877", async () => {
  await simulateWorkerTask();
});

// Execute outside context
simulateWorkerTask();
```

---

## 17. Common Interview Traps

- **Trap 1**: "Should logs be written directly to a database table like MongoDB or PostgreSQL?"
  - *Reality*: Never! Writing logs synchronously to a database introduces high database write contention, saturates connection pools, and if the database goes down, your logging system goes down with it. Logs must be written to `stdout`, allowing external ingestion agents to handle persistence asynchronously.
- **Trap 2**: "Does `AsyncLocalStorage` cause memory leaks?"
  - *Reality*: Only if you store massive objects or forget that the context is held in memory for the duration of the asynchronous chain. Keep context lightweight (e.g. correlation ID, user ID, tenant ID).
- **Trap 3**: "Is Pino always better than Winston?"
  - *Reality*: Pino is faster in extreme high-load scenarios. However, Winston is simpler to configure, has a larger plugin ecosystem, and is more than fast enough for 90% of production workloads.

---

## 18. Revision Summary

- **Structured Logging**: Outputs machine-readable JSON with standardized fields (`timestamp`, `level`, `message`, `correlationId`).
- **Correlation ID**: Unique UUID propagated across headers (`X-Correlation-ID`) and asynchronous contexts to trace requests across microservices.
- **AsyncLocalStorage**: Eliminates parameter drilling by maintaining request context across async call stacks.
- **12-Factor Rule**: Always log to `stdout`; let container orchestrators (Fluentd/Promtail) ship logs to Loki/Elasticsearch.
- **Security**: Neutralizes Log Injection; always redact PII and passwords.

---

## 19. Quick Reference

```typescript
import winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

// Logging with metadata
logger.info("Payment received", { amount: 99.00, correlationId: "abc-123" });
```
