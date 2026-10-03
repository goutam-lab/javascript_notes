# Graceful Shutdown & Process Termination in Node.js

## 1. What is it?
**Graceful Shutdown** is the disciplined operational practice of allowing a running application process to terminate cleanly without dropping active user connections, corrupting in-flight database transactions, or abandoning queued background jobs when an operating system or container orchestrator requests a stop.

When Kubernetes, AWS ECS, or PM2 initiates a rolling deployment or scaling event, it does not immediately pull the physical power plug. Instead, it sends standard POSIX termination signals:
- **`SIGTERM` (Signal 15 - Termination)**: A polite request asking the process to terminate. The application intercepts this signal, stops accepting new HTTP connections, completes all active requests, commits open database transactions, disconnects backing resources, and exits with code 0.
- **`SIGINT` (Signal 2 - Interrupt)**: Emitted when a developer presses `Ctrl + C` in a terminal window.
- **`SIGKILL` (Signal 9 - Kill)**: A forceful, uncatchable kernel-level kill. The OS immediately purges the process from memory. If an application fails to exit within a configured grace period (e.g., 30 seconds), the orchestrator issues a `SIGKILL`.

```
                    GRACEFUL SHUTDOWN EXECUTION TIMELINE
                    
 Orchestrator / OS sends SIGTERM
                │
                ▼ (T = 0s)
 ┌────────────────────────────────────────────────────────┐
 │ 1. FLIP READINESS STATE: Set `/health/ready` to 503    │
 │ • Signals Load Balancer to remove instance from pool   │
 └──────────────────────┬─────────────────────────────────┘
                        │
                        ▼ (T = 2s - Load Balancer Stop Ingress)
 ┌────────────────────────────────────────────────────────┐
 │ 2. CLOSE HTTP SERVER: `server.close()`                 │
 │ • Refuses new incoming TCP connections                 │
 │ • Keeps existing in-flight client sockets open         │
 └──────────────────────┬─────────────────────────────────┘
                        │
                        ▼ (T = 3s to 8s - Connection Draining)
 ┌────────────────────────────────────────────────────────┐
 │ 3. DRAIN ACTIVE IN-FLIGHT TRANSACTIONS                 │
 │ • Active checkout queries complete successfully        │
 │ • Active background queue jobs (BullMQ) complete       │
 └──────────────────────┬─────────────────────────────────┘
                        │
                        ▼ (T = 9s - Resource Cleanup)
 ┌────────────────────────────────────────────────────────┐
 │ 4. DISCONNECT BACKING INFRASTRUCTURE                   │
 │ • `await pgPool.end()` (Close database connection pool)│
 │ • `await redis.quit()` (Disconnect cache cleanly)      │
 │ • Flush Sentry / Winston buffers to disk               │
 └──────────────────────┬─────────────────────────────────┘
                        │
                        ▼ (T = 10s)
 ┌────────────────────────────────────────────────────────┐
 │ 5. PROCESS EXIT: `process.exit(0)` (Clean termination) │
 └────────────────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Abruptly terminating an application process (e.g., calling `process.exit(0)` immediately or allowing an unhandled container crash) causes critical production defects:

1. **Severed User Transactions & Dropped Requests**: A customer submits a payment request. Midway through processing the card, the server process is killed. The bank authorizes the charge, but the database order is never written, leaving the user billed with no order receipt.
2. **Broken Database Connection Pools**: Abrupt termination severs TCP sockets without sending TCP `FIN` or `RST` packets. PostgreSQL keeps those server processes and locks alive until TCP keep-alive timeouts expire (up to 15 minutes), exhausting database connection limits.
3. **502 Bad Gateway Spikes During Rolling Updates**: During a deployment, if a container terminates while the load balancer is still routing traffic to it, hundreds of active requests receive `502 Bad Gateway` errors, violating 99.99% SLA targets.
4. **Corrupted Disk & Log Buffers**: Buffered logging libraries (like Winston or Pino) holding unwritten log lines in memory lose those logs on immediate exit, hiding the cause of the termination.

---

## 3. Mental Model
Think of graceful shutdown like closing a busy restaurant at the end of the evening:
- **Abrupt Shutdown (`SIGKILL`)** is like a fire alarm going off: patrons drop their forks, half-eaten food is left on tables, the stove is left burning, and everyone runs out the door.
- **Graceful Shutdown (`SIGTERM`)** is standard closing procedure:
  1. The host locks the front entrance (stops accepting new customers / closes HTTP listener).
  2. Diners already seated finish their meals and pay their checks (connection draining).
  3. The kitchen washes the dishes and shuts down the ovens (drains DB pools and message queues).
  4. The manager locks the back door and turns off the lights (`process.exit(0)`).

---

## 4. Basic Example: Naive vs. Proper Signal Handling

```typescript
// ❌ NAIVE SIGNAL HANDLING (Anti-Pattern)
// Exits immediately! Kills all in-flight checkout requests!
process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Exiting immediately.');
  process.exit(0);
});
```

```typescript
// ✅ PROPER BASIC PATTERN
process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Closing HTTP server...');
  
  // Stops accepting NEW connections; waits for existing ones to finish
  server.close(() => {
    console.log('All HTTP connections closed. Exiting.');
    process.exit(0);
  });
});
```

---

## 5. Real Example: Enterprise Graceful Shutdown Coordinator

Here is a complete, production-grade TypeScript **Graceful Shutdown Coordinator** supporting HTTP connection tracking, readiness probe integration, BullMQ worker pauses, PostgreSQL pool draining, and hard timeout fallbacks.

```typescript
// graceful-shutdown.ts
import http from 'http';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { QueueEvents } from 'bullmq';

interface ShutdownDependencies {
  server: http.Server;
  pgPool: Pool;
  redisClient: Redis;
  queueEvents?: QueueEvents;
  setReadinessFalse: () => void;
}

export class GracefulShutdownCoordinator {
  private isShuttingDown = false;
  private readonly timeoutMs: number;
  private readonly deps: ShutdownDependencies;

  constructor(deps: ShutdownDependencies, timeoutMs = 25000) {
    this.deps = deps;
    this.timeoutMs = timeoutMs;
  }

  init() {
    // Intercept standard POSIX termination signals
    process.on('SIGTERM', () => this.handleSignal('SIGTERM'));
    process.on('SIGINT', () => this.handleSignal('SIGINT'));
  }

  private async handleSignal(signal: string) {
    if (this.isShuttingDown) {
      console.warn(`[SHUTDOWN] Already shutting down. Ignoring duplicate ${signal}.`);
      return;
    }

    this.isShuttingDown = true;
    console.log(`[SHUTDOWN] Intercepted ${signal}. Initiating graceful termination sequence...`);

    // 1. Hard Fallback Timer: Force kill if cleanup hangs
    const forceKillTimer = setTimeout(() => {
      console.error(`[SHUTDOWN] Forceful termination: Cleanup exceeded ${this.timeoutMs}ms limit!`);
      process.exit(1);
    }, this.timeoutMs);
    // Unref timer so it does not keep the event loop alive if everything else exits
    forceKillTimer.unref();

    try {
      // Step A: Signal unreadiness to Load Balancers
      console.log('[STEP 1/5] Setting readiness probe to UNAVAILABLE (HTTP 503)...');
      this.deps.setReadinessFalse();

      // Step B: Sleep briefly to allow load balancers (ALB / Kube-Proxy) to deregister IP
      console.log('[STEP 2/5] Waiting 3 seconds for load balancer endpoint deregistration...');
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Step C: Stop accepting new HTTP connections
      console.log('[STEP 3/5] Closing HTTP server listener and draining connections...');
      await this.closeHttpServer();

      // Step D: Pause Background Queues (allow active jobs to finish, prevent pulling new ones)
      if (this.deps.queueEvents) {
        console.log('[STEP 4/5] Pausing background queue workers...');
        await this.deps.queueEvents.close();
      }

      // Step E: Drain Database Pools & Caches
      console.log('[STEP 5/5] Draining PostgreSQL pool and disconnecting Redis...');
      await this.deps.pgPool.end();
      await this.deps.redisClient.quit();

      console.log('✅ [SHUTDOWN COMPLETE] All resources cleanly finalized. Exiting with code 0.');
      clearTimeout(forceKillTimer);
      process.exit(0);
    } catch (error: any) {
      console.error('❌ [SHUTDOWN ERROR] Error occurred during shutdown sequence:', error.message);
      clearTimeout(forceKillTimer);
      process.exit(1);
    }
  }

  /**
   * Promisified HTTP server close with idle socket destruction
   */
  private closeHttpServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      // In modern Node.js (v18.2.0+), closeIdleConnections() closes open keep-alive sockets!
      if (typeof this.deps.server.closeIdleConnections === 'function') {
        this.deps.server.closeIdleConnections();
      }

      this.deps.server.close((err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}
```

### Express Server Wiring
```typescript
// app.ts
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { GracefulShutdownCoordinator } from './graceful-shutdown';

const app = express();
const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

let isReady = true;

// Readiness Probe Endpoint
app.get('/health/ready', (req, res) => {
  if (!isReady) {
    return res.status(503).json({ status: 'DRAINING', message: 'Shutting down' });
  }
  res.status(200).json({ status: 'READY' });
});

// Primary Business Route (Simulating a 3-second database transaction)
app.post('/api/checkout', async (req, res) => {
  console.log('[CHECKOUT] Processing order...');
  const result = await pgPool.query('SELECT pg_sleep(3), NOW()');
  res.json({ success: true, timestamp: result.rows[0].now });
});

const server = http.createServer(app);
server.listen(4000, () => {
  console.log('[BOOT] Server operational on port 4000.');
});

// Initialize Graceful Shutdown Coordinator
const shutdownCoordinator = new GracefulShutdownCoordinator({
  server,
  pgPool,
  redisClient: redis,
  setReadinessFalse: () => { isReady = false; },
});

shutdownCoordinator.init();
```

---

## 6. Under the Hood: Node.js Event Loop Termination & Socket Keep-Alive

### A. How `server.close()` Operates Internally
When you call `server.close(callback)`:
1. Node.js invokes the OS `close()` syscall on the underlying master listening socket file descriptor.
2. The server **immediately ceases listening for new incoming TCP handshakes** (subsequent client connection attempts are rejected with `ECONNREFUSED`).
3. **Existing established connections are NOT killed**. They remain active in the event loop until:
   - The active HTTP request completes and sends its response.
   - The client explicitly terminates the connection.
4. Once the last socket terminates, Node.js fires the `callback` passed to `server.close()`.

### B. The HTTP Keep-Alive Problem
HTTP/1.1 and HTTP/2 clients reuse connections across requests (**Keep-Alive**). An idle browser socket can remain open for 60 seconds waiting for the user to click another link. If you call `server.close()` without closing idle sockets, **the server will hang for 60 seconds waiting for the idle sockets to close**, until the orchestrator issues a forceful `SIGKILL`.
**Solution**: In Node.js 18.2.0+, invoke **`server.closeIdleConnections()`** immediately after calling `server.close()`. This severs idle sockets instantly while leaving active, executing requests intact.

---

## 7. Important Rules

1. **Order of Shutdown Matters (Reverse Dependency Order)**:
   Always terminate resources in strict reverse dependency order:
   1. Stop ingress traffic (`/health/ready` $\rightarrow$ 503).
   2. Stop accepting new HTTP requests (`server.close()`).
   3. Wait for in-flight requests to complete.
   4. Stop background queues (BullMQ).
   5. Close database connection pools (`pgPool.end()`).
   *Never close the database connection pool first!* If an active HTTP request is midway through executing an SQL query and you close the DB pool, the query will immediately crash with `Error: Connection pool is closed`.
2. **Always Implement a Hard Termination Timeout**:
   If an in-flight database query enters an infinite lock or a network socket hangs, your cleanup sequence could hang forever. Always set a hard fallback timer (e.g., 25 seconds):
   ```typescript
   setTimeout(() => process.exit(1), 25000).unref();
   ```
3. **Align Application Timeouts with Kubernetes Grace Periods**:
   Kubernetes defaults to `terminationGracePeriodSeconds: 30`. If your application's hard shutdown timeout is 45 seconds, Kubernetes will forcefully issue a `SIGKILL` at second 30, truncating your shutdown. Ensure your application's internal timeout (25s) is shorter than Kubernetes' grace period (30s).

---

## 8. Common Mistakes & Anti-Patterns

### 1. The Missing Load Balancer Deregistration Window
Calling `server.close()` the exact millisecond `SIGTERM` is received.
**Why it fails**: When Kubernetes initiates pod termination, it informs the pod (`SIGTERM`) and updates the Load Balancer / iptables simultaneously. Because network propagation takes 1 to 2 seconds, the load balancer may forward 5 more requests to the pod *after* it received `SIGTERM`. If the pod closed its port immediately, those 5 requests fail with `502 Bad Gateway`.
**Fix**: Introduce a **2 to 5 second initial delay** (or a Kubernetes `preStop` hook) before closing the HTTP listener.

### 2. Failing to Unref the Fallback Timer
If you create a fallback timeout (`setTimeout(..., 25000)`) without calling `.unref()`, that timer handle will keep the Node.js event loop alive for the full 25 seconds even if all database connections and HTTP sockets closed in 200ms.

---

## 9. Best Practices

- **Use Kubernetes `preStop` Lifecycle Hooks**:
  Configure a `preStop` sleep hook in your Kubernetes deployment manifest:
  ```yaml
  lifecycle:
    preStop:
      exec:
        command: ["/bin/sh", "-c", "sleep 5"]
  ```
  This delays sending `SIGTERM` to the container process by 5 seconds, guaranteeing that Kubernetes iptables and external load balancers have completely removed the pod IP before the application begins its shutdown sequence.
- **Drain Background Worker Queues via `worker.close()`**:
  In BullMQ or Celery, calling `worker.close()` instructs the worker to stop pulling new jobs from Redis while allowing jobs currently running on the worker to complete cleanly before disconnecting.

---

## 10. Performance Considerations

- **Fast Shutdown Accelerates Deployments**:
  A clean, responsive graceful shutdown that finishes in 2 seconds enables CI/CD rolling deployments to complete in 2 minutes instead of 10 minutes.
- **Active Socket Tracking**: For legacy Node.js versions (<18.2.0), track sockets manually by listening to `server.on('connection', socket => ...)` and destroy idle sockets using `socket.destroy()` upon `SIGTERM`.

---

## 11. Security Considerations

- **Audit Logging of Termination Events**:
  Always emit a structured log when a shutdown begins, including the triggering signal (`SIGTERM` vs `SIGINT`) and the initiating process PID. If an unauthorized process or attacker sends termination signals to your server, audit logs will preserve the event.
- **Preventing Denial-of-Service via Shutdown Injection**:
  Ensure health check endpoints and administrative endpoints cannot trigger shutdown routines unless authenticated via local UNIX domain sockets or administrative credentials.

---

## 12. Alternatives

| Orchestration Context | Shutdown Strategy | Pros | Cons |
|---|---|---|---|
| **Node.js Native (`process.on`)** | In-application coordinator | Direct control over DB pools, caches, and queues. | Requires boilerplate code in every service. |
| **Kubernetes `preStop` Hooks** | Cluster-level HTTP / Exec hook | Decouples networking delay from application code. | Kubernetes-specific; ineffective in local dev. |
| **Tini / Dumb-Init** | Container PID 1 Sub-Reaper | Guarantees signal forwarding to child Node processes. | Only handles signal forwarding, not application logic. |

---

## 13. Trade-offs

- **Short Grace Period vs. Long-Running Transactions**:
  Setting a short grace period (10 seconds) accelerates deployment speed, but risks killing long-running reports or complex batch operations. For operations taking longer than 30 seconds, offload the work to an asynchronous background worker queue (BullMQ / AWS SQS) rather than processing it inside a synchronous HTTP request.
- **Connection Draining Latency vs. CI/CD Pipeline Velocity**:
  Adding a 5-second `preStop` sleep guarantees zero dropped packets on load balancers, but adds 5 seconds to every pod termination during deployment rollouts.

---

## 14. Real-World Usage & Implementation Example

Here is a production **Kubernetes Deployment Manifest** configured with pre-stop draining hooks and matched termination grace periods:

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: core-api-deployment
  labels:
    app: core-api
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 25%        # Create 1 new pod before killing an old pod
      maxUnavailable: 0    # Never allow available pods to drop below 100%
  template:
    metadata:
      labels:
        app: core-api
    spec:
      # Grace period must be longer than the application's internal shutdown timeout!
      # App timeout = 25s; K8s grace period = 35s (5s preStop + 25s app + 5s buffer)
      terminationGracePeriodSeconds: 35
      
      containers:
        - name: core-api
          image: ghcr.io/company/core-api:v2.1.0
          ports:
            - containerPort: 4000
          
          # Container Lifecycle Hooks
          lifecycle:
            preStop:
              exec:
                # 1. Sleep 5s to allow Kube-Proxy & Ingress Controller to update routing tables
                command: ["/bin/sh", "-c", "sleep 5"]

          readinessProbe:
            httpGet:
              path: /health/ready
              port: 4000
            periodSeconds: 5
            failureThreshold: 2

          livenessProbe:
            httpGet:
              path: /health/live
              port: 4000
            periodSeconds: 15
            failureThreshold: 3
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: What is the difference between `SIGTERM` and `SIGKILL`?
**Answer**:
- **`SIGTERM` (Signal 15)**: The standard termination signal sent by an operating system or container orchestrator asking a process to stop. It can be intercepted and handled by application code (`process.on('SIGTERM', ...)`), allowing the application to drain active requests, close database connections, and exit cleanly.
- **`SIGKILL` (Signal 9)**: An immediate, forceful termination executed directly by the operating system kernel. It **cannot be caught, handled, or ignored** by the application. The OS instantly frees the process’s memory space and severs all network sockets, which can corrupt in-flight transactions and unwritten files.

### 2. Conceptual: Explain why calling `server.close()` alone is not enough to immediately shut down a Node.js web server.
**Answer**:
`server.close()` stops the HTTP server from accepting *new* incoming TCP connections. However, by default, it does **not** terminate existing connections. 
Because HTTP/1.1 and HTTP/2 utilize persistent **Keep-Alive connections**, modern browsers keep TCP sockets open to reuse them for subsequent requests. If these idle keep-alive sockets remain open, Node.js will keep the event loop running and hang indefinitely waiting for the client to close the socket. To fix this, you must invoke **`server.closeIdleConnections()`** (available in Node.js v18.2.0+) or manually track and destroy idle sockets.

### 3. Implementation: What is the correct order of operations during a graceful shutdown sequence?
**Answer**:
Resources must be closed in **reverse dependency order**:
1. **Deregister Routing**: Set `/health/ready` to HTTP 503 so load balancers stop sending new traffic.
2. **Wait for Network Propagation**: Sleep 2–5 seconds to allow cloud routing tables and iptables to update.
3. **Stop Ingress**: Call `server.close()` and `server.closeIdleConnections()` to halt new HTTP requests.
4. **Complete In-Flight Work**: Wait for active HTTP request handlers and active background worker jobs (e.g., BullMQ) to complete.
5. **Drain Backing Services**: Close PostgreSQL connection pools (`pgPool.end()`) and Redis clients (`redis.quit()`).
6. **Flush Observability**: Flush remaining Winston/Pino log buffers and Sentry event queues.
7. **Exit**: Terminate the process cleanly with `process.exit(0)`.

### 4. Debugging: During a Kubernetes rolling deployment, users report receiving intermittent `502 Bad Gateway` errors for 2 seconds. What is the cause?
**Answer**:
This is the classic **Race Condition between Pod Termination and Ingress Deregistration**:
1. When Kubernetes terminates a pod, it sends `SIGTERM` to the container and removes the pod IP from the Service Endpoints list **in parallel**.
2. Updating iptables across all nodes and notifying the ingress controller (e.g., Nginx Ingress or AWS ALB) takes 1 to 3 seconds.
3. If the Node.js application intercepts `SIGTERM` and immediately calls `server.close()`, the pod stops listening on port 4000 while the load balancer is still forwarding requests to it, resulting in `502 Bad Gateway / Connection Refused`.
4. **Fix**: Add a Kubernetes `preStop` hook with `sleep 5` or introduce an initial delay in the application before closing the HTTP listener.

### 5. Scenario: What happens if an in-flight database query hangs during graceful shutdown?
**Answer**:
If a query hangs (e.g., waiting on an exclusive row lock held by another deadlocked transaction), `await pgPool.end()` will block indefinitely, preventing the process from ever exiting.
**Remediation**:
Implement a **Hard Termination Fallback Timer**:
```typescript
const forceKill = setTimeout(() => {
  console.error('Shutdown timed out. Forcing exit.');
  process.exit(1);
}, 25000);
forceKill.unref();
```
If the cleanup steps do not finish within 25 seconds, the timer fires and forcefully terminates the process with code 1 before the orchestrator's `SIGKILL` timeout.

### 6. Advanced: Why does Node.js not respond to `SIGTERM` when run as PID 1 inside a Docker container without an init system?
**Answer**:
In Linux, **PID 1 (the init process)** has special kernel-level protections: the kernel will not apply default signal actions (like terminating on `SIGTERM`) to PID 1 to prevent accidental system crashes. 
Node.js is not engineered to act as an OS init system. Unless you explicitly register a `process.on('SIGTERM')` handler in your JavaScript code, Node.js simply ignores the signal. 
If no handler exists, Docker waits for the full 10-second timeout and forcefully kills the container with `SIGKILL`. 
**Fix**: Use a lightweight init system like **`dumb-init`** or **`tini`** as the container `ENTRYPOINT`, which registers signal handlers at PID 1 and properly forwards `SIGTERM` to the child Node.js process.

---

## 16. Coding Questions & Practical Challenges

1. **Active Request Tracking Middleware**: Write an Express middleware in TypeScript that increments an `activeRequests` counter on incoming requests, decrements it on `res.on('finish')`, and provides a `drain(timeout)` method that returns a promise resolving only when active requests reach zero.
2. **Promisified BullMQ Graceful Closer**: Implement a shutdown hook for a BullMQ Worker instance that pauses the queue, waits for all active jobs to complete, and closes the Redis connection with a 10-second timeout.
3. **Socket Destroyer for Legacy Node**: Write an HTTP server wrapper for Node.js v16 that tracks every connected socket in a `Set<Socket>`, tags sockets as idle or active based on HTTP request events, and provides a `destroyIdle()` method.

---

## 17. Common Interview Traps

- **Trap 1: Closing database pools before stopping the HTTP server**: If you call `pgPool.end()` while the HTTP server is still accepting requests, any request that attempts to query the database during the next 500ms will immediately crash with an unhandled rejection. Always close the HTTP listener first.
- **Trap 2: Forgetting to `.unref()` the safety timeout**: Creating a fallback timeout `setTimeout(..., 30000)` without calling `.unref()` prevents the Node.js event loop from draining naturally. Even if all connections close in 100ms, the process will unnecessarily sit idle for 30 seconds before terminating.
- **Trap 3: Believing `process.exit(0)` is mandatory for exit**: In Node.js, if all active socket listeners are closed, all timers are cleared, and all database connection handles are destroyed, the event loop runs out of tasks and the process **exits automatically with code 0**. Explicitly calling `process.exit(0)` is only necessary as a deliberate termination action.

---

## 18. Revision Summary

- **Signal Protocol**: Intercept `SIGTERM` and `SIGINT`; handle graceful draining before the orchestrator enforces `SIGKILL`.
- **Shutdown Lifecycle**: Set readiness to 503 $\rightarrow$ Wait 3s for load balancer deregistration $\rightarrow$ `server.close()` $\rightarrow$ Drain in-flight requests & queues $\rightarrow$ Close DB pool (`pgPool.end()`) $\rightarrow$ Flush logs $\rightarrow$ Exit.
- **Keep-Alive Protection**: Call `server.closeIdleConnections()` to terminate persistent idle browser sockets.
- **Safety Mechanism**: Always run a hard timeout (e.g., 25s) with `.unref()` to guarantee termination if dependencies deadlock.

---

## 19. Quick Reference Cheatsheet

```typescript
// Standard Production Graceful Shutdown Skeleton
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Starting shutdown...');
  
  // 1. Hard kill safety timer (25s)
  setTimeout(() => process.exit(1), 25000).unref();

  // 2. Set readiness false (ALB deregistration)
  isReady = false;
  await new Promise(r => setTimeout(r, 3000));

  // 3. Stop accepting new HTTP requests & close idle sockets
  server.closeIdleConnections();
  await new Promise(r => server.close(r));

  // 4. Drain databases and backing services
  await dbPool.end();
  await redis.quit();

  console.log('Clean exit complete.');
  process.exit(0);
});
```
