# Health Checks: Liveness, Readiness & Startup Probes

## 1. What is it?
In distributed systems and containerized architectures (such as Kubernetes, AWS ECS, and Docker Swarm), **Health Checks** are automated diagnostic HTTP endpoints or command probes evaluated periodically by container orchestrators and load balancers to determine the operational state of an application instance.

Modern production platforms distinguish between three distinct probe types:
1. **Liveness Probe (`/health/live`)**: Answers: *"Is the application process alive and running?"* If this probe fails repeatedly, the orchestrator assumes the process is deadlocked or frozen and **kills and restarts the container**.
2. **Readiness Probe (`/health/ready`)**: Answers: *"Is the application currently ready to process user traffic?"* If this probe fails, the load balancer **removes the container from the active routing pool** without restarting it, preventing users from receiving 502/503 errors while dependencies recover.
3. **Startup Probe (`/health/startup`)**: Answers: *"Has the application finished its initial boot and initialization routines?"* Disables liveness and readiness checks until the application has fully initialized (essential for slow-starting apps running schema migrations or loading large machine learning models).

```
                 KUBERNETES & LOAD BALANCER PROBE LIFECYCLE
                 
 ┌─────────────────────────────────────────────────────────────┐
 │ Container Boots Up                                          │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ 1. Startup Probe Active (`/health/startup`)                 │
 │ • Holds back Liveness & Readiness checks                    │
 │ • Allows up to 60s for slow DB migrations or cache warming  │
 └──────────────────────────────┬──────────────────────────────┘
                                │ Startup succeeds (HTTP 200)
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ 2. Readiness Probe (`/health/ready`)                        │
 │ • Tests PostgreSQL Connection Pool & Redis Ping             │
 └──────────────┬──────────────────────────────┬───────────────┘
                │ PASS (HTTP 200)              │ FAIL (HTTP 503)
                ▼                              ▼
 ┌─────────────────────────────┐ ┌─────────────────────────────┐
 │ Attached to Load Balancer   │ │ Detached from Load Balancer │
 │ Routes active user traffic  │ │ NO traffic sent (No 502s!)  │
 └─────────────────────────────┘ └─────────────────────────────┘
                │
                ▼ (Continuous Monitoring)
 ┌─────────────────────────────────────────────────────────────┐
 │ 3. Liveness Probe (`/health/live`)                          │
 │ • Checks event loop responsiveness                         │
 └──────────────┬──────────────────────────────┬───────────────┘
                │ PASS (HTTP 200)              │ FAIL (3 consecutive)
                ▼                              ▼
 ┌─────────────────────────────┐ ┌─────────────────────────────┐
 │ Keep Container Running      │ │ RESTART CONTAINER (Killed)  │
 └─────────────────────────────┘ └─────────────────────────────┘
```

---

## 2. Why does it exist?
Relying on a single naive health check (e.g., `app.get('/health', (req, res) => res.send('OK'))`) leads to systemic production failures:

1. **Routing Traffic to Booting Containers**: When a new container spawns during an auto-scaling event, Node.js opens port 4000 in 200ms, but establishing database connection pools takes 3 seconds. The load balancer sends traffic immediately, resulting in hundreds of failed checkout requests.
2. **The Cascading Restart Death Spiral**: If a database experiences a temporary 10-second query spike, a naive liveness probe that checks the database fails. The orchestrator immediately kills and restarts all 50 application containers simultaneously. When the containers reboot, they all execute connection handshakes simultaneously, causing a thundering herd that completely crashes the database.
3. **Silent Deadlocks & Frozen Event Loops**: A Node.js application process can remain running in the OS process table while its event loop is 100% blocked by an infinite `while(true)` loop or deadlocked thread. It cannot accept any HTTP requests, yet simple process-running checks report it as healthy.

---

## 3. Mental Model
Think of health checks like a commercial airline flight crew:
- **Liveness Probe** is the pilot's pulse and breathing: if the pilot loses consciousness (deadlocked process), the copilot immediately takes over (orchestrator restarts container).
- **Readiness Probe** is checking if the aircraft cabin doors are closed, fuel is loaded, and air traffic control has granted runway clearance: if fuel is still pumping, the plane is perfectly functional (alive), but not ready for takeoff (detached from load balancer).
- **Startup Probe** is the cold-engine ignition and pre-flight instrument diagnostic sequence: normal flight checks are paused until the jet engines are running at operating temperature.

---

## 4. Basic Example: Naive vs. Segmented Probes

```typescript
// ❌ NAIVE HEALTH CHECK (Anti-Pattern)
// If the DB has a 2-second glitch, Kubernetes kills and restarts this container!
app.get('/health', async (req, res) => {
  await db.query('SELECT 1');
  res.send('OK');
});
```

```typescript
// ✅ SEGMENTED PRODUCTION PATTERN
// 1. Liveness: Checks ONLY process and event loop health (never checks DB!)
app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'ALIVE' });
});

// 2. Readiness: Verifies backing services before accepting user traffic
app.get('/health/ready', async (req, res) => {
  const isDbHealthy = await checkDatabase();
  const isRedisHealthy = await checkRedis();

  if (isDbHealthy && isRedisHealthy) {
    return res.status(200).json({ status: 'READY' });
  }
  return res.status(503).json({ status: 'NOT_READY' });
});
```

---

## 5. Real Example: Enterprise Multi-Dependency Health Sentinel

Here is a production-grade TypeScript Health Check service featuring connection pool verification, memory usage assertions, short-term caching to prevent DB query saturation, and Kubernetes probe definitions.

```typescript
// health-sentinel.ts
import { Request, Response } from 'express';
import { Pool } from 'pg';
import { Redis } from 'ioredis';

export class HealthSentinel {
  private pgPool: Pool;
  private redis: Redis;
  private isShuttingDown = false;
  
  // Cache readiness result for 2 seconds to prevent health probes from DOS-ing the database
  private lastReadinessCheck = 0;
  private cachedReadinessResult: { isHealthy: boolean; details: any } | null = null;

  constructor(pgPool: Pool, redis: Redis) {
    this.pgPool = pgPool;
    this.redis = redis;
  }

  setShuttingDown(state: boolean) {
    this.isShuttingDown = state;
  }

  /**
   * LIVENESS PROBE (/health/live)
   * Must be ultra-fast (<5ms). Validates event loop responsiveness and heap limits.
   */
  handleLiveness = (req: Request, res: Response) => {
    // If the process is shutting down, declare it un-alive
    if (this.isShuttingDown) {
      return res.status(503).json({ status: 'TERMINATING' });
    }

    const memoryUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memoryUsage.heapUsed / 1024 / 1024);

    return res.status(200).json({
      status: 'UP',
      uptimeSeconds: Math.floor(process.uptime()),
      heapUsedMB,
      timestamp: new Date().toISOString(),
    });
  };

  /**
   * READINESS PROBE (/health/ready)
   * Validates database and cache connectivity before accepting user traffic.
   */
  handleReadiness = async (req: Request, res: Response) => {
    if (this.isShuttingDown) {
      return res.status(503).json({ status: 'DRAINING', message: 'Instance is draining traffic' });
    }

    const now = Date.now();
    // Return cached result if checked within the last 2000ms
    if (this.cachedReadinessResult && now - this.lastReadinessCheck < 2000) {
      const code = this.cachedReadinessResult.isHealthy ? 200 : 503;
      return res.status(code).json(this.cachedReadinessResult.details);
    }

    const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};
    let isOverallHealthy = true;

    // 1. Check PostgreSQL Connection Pool
    const dbStart = Date.now();
    try {
      // Fast lightweight query using connection pool timeout
      await Promise.race([
        this.pgPool.query('SELECT 1'),
        new Promise((_, reject) => setTimeout(() => reject(new Error('DB Timeout')), 1500)),
      ]);
      checks.postgres = {
        status: 'UP',
        latencyMs: Date.now() - dbStart,
      };
    } catch (err: any) {
      isOverallHealthy = false;
      checks.postgres = { status: 'DOWN', error: err.message };
    }

    // 2. Check Redis Cache
    const redisStart = Date.now();
    try {
      const pingResult = await Promise.race([
        this.redis.ping(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Redis Timeout')), 1000)),
      ]);
      checks.redis = {
        status: pingResult === 'PONG' ? 'UP' : 'DEGRADED',
        latencyMs: Date.now() - redisStart,
      };
    } catch (err: any) {
      isOverallHealthy = false;
      checks.redis = { status: 'DOWN', error: err.message };
    }

    const result = {
      status: isOverallHealthy ? 'READY' : 'UNAVAILABLE',
      checks,
      timestamp: new Date().toISOString(),
    };

    // Update cache
    this.lastReadinessCheck = now;
    this.cachedReadinessResult = { isHealthy: isOverallHealthy, details: result };

    const statusCode = isOverallHealthy ? 200 : 503;
    return res.status(statusCode).json(result);
  };
}
```

### Kubernetes Pod Probe Specification (`deployment.yaml`)
```yaml
spec:
  containers:
    - name: core-api
      image: ghcr.io/company/core-api:sha-7f9a2
      ports:
        - containerPort: 4000
      
      # 1. STARTUP PROBE: Protects slow container boot
      startupProbe:
        httpGet:
          path: /health/live
          port: 4000
        failureThreshold: 30 # Up to 30 * 2s = 60s startup grace period
        periodSeconds: 2

      # 2. LIVENESS PROBE: Detects frozen event loops
      livenessProbe:
        httpGet:
          path: /health/live
          port: 4000
        initialDelaySeconds: 5
        periodSeconds: 10
        timeoutSeconds: 3
        failureThreshold: 3 # Restarts container after 3 consecutive failures

      # 3. READINESS PROBE: Controls load balancer routing
      readinessProbe:
        httpGet:
          path: /health/ready
          port: 4000
        initialDelaySeconds: 5
        periodSeconds: 5
        timeoutSeconds: 2
        failureThreshold: 2 # Removes from ALB after 2 consecutive failures
```

---

## 6. Under the Hood: Kubernetes Kubelet & Load Balancer Probe Mechanics

How does the Kubernetes `kubelet` process health probes without impacting application runtime?

```
                     KUBELET HEALTH POLLING LOOP
                     
 ┌────────────────────────────────────────────────────────┐
 │ Kubelet Daemon (Node-Level Supervisor)                 │
 └──────────────────────────┬─────────────────────────────┘
                            │ Periodic timer trigger (e.g. every 5s)
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │ In-Pod HTTP GET: http://10.244.1.42:4000/health/ready  │
 └──────────────────────────┬─────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            │ HTTP 200 OK                   │ HTTP 503 Service Unavailable
            ▼                               ▼
 ┌─────────────────────────────┐ ┌─────────────────────────────────┐
 │ Updates Pod Status:         │ │ Updates Pod Status:             │
 │ `Ready: True`               │ │ `Ready: False`                  │
 └──────────┬──────────────────┘ └──────────┬──────────────────────┘
            │                               │
            ▼                               ▼
 ┌─────────────────────────────┐ ┌─────────────────────────────────┐
 │ Endpoints Controller:       │ │ Endpoints Controller:           │
 │ Adds Pod IP to Endpoints    │ │ Strips Pod IP from Endpoints    │
 │ slice; Kube-Proxy allows    │ │ list; Kube-Proxy immediately    │
 │ traffic forwarding.         │ │ blocks new incoming traffic.    │
 └─────────────────────────────┘ └─────────────────────────────────┘
```

---

## 7. Important Rules

1. **NEVER Check External Third-Party APIs in Readiness Probes**:
   Checking third-party services (e.g., Stripe, Twilio, SendGrid) inside your `/health/ready` probe is an architectural disaster. If Stripe experiences a brief regional outage, **your readiness probe will fail across all 100 pods simultaneously**, taking your entire application, website, and authentication offline even though 95% of your product does not require Stripe to function.
2. **Never Check Heavy Database Aggregations**:
   Executing `SELECT COUNT(*) FROM users` inside `/health/ready` places heavy disk I/O load on the database. If 50 pods query the database every 5 seconds, the health checks alone generate 600 heavy queries a minute. Use lightweight assertions: `SELECT 1` or check connection pool availability.
3. **Enforce Short Timeouts on Health Checks**:
   Set `timeoutSeconds: 2`. If a probe hangs for 30 seconds waiting for a locked database socket, the kubelet or load balancer marks the probe as failed and cannot reliably evaluate container health.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Coupling Liveness Directly to Database Health
```typescript
// ❌ DANGEROUS ANTI-PATTERN:
app.get('/health/live', async (req, res) => {
  await db.query('SELECT 1'); // If DB restarts, ALL pods get killed!
  res.send('OK');
});
```
**Why it fails**: When PostgreSQL restarts for a version update or failover, every single application container fails its liveness probe and is killed by Kubernetes. The entire cluster enters a `CrashLoopBackOff`, prolonging downtime by 15 minutes.
**Rule**: Liveness probes check **only local process health**; readiness probes check **dependencies**.

### 2. Missing Caching on Health Endpoints Under Heavy Fleet Scaling
When running a cluster with 500 microservice pods, having every pod execute `SELECT 1` against PostgreSQL every 3 seconds saturates the database connection pool. Cache readiness check results internally for 1 to 2 seconds.

---

## 9. Best Practices

- **Integrate Graceful Shutdown with Readiness Probes**:
  The moment an instance receives a `SIGTERM` signal, immediately flip an internal boolean (`isShuttingDown = true`). The `/health/ready` endpoint immediately starts returning HTTP 503. The load balancer removes the instance from the routing table *before* in-flight requests are terminated.
- **Structured JSON Diagnostics**:
  Always return structured JSON payloads detailing the individual status and latency of each dependency (`postgres`, `redis`). This allows SREs and monitoring dashboards to identify whether a readiness failure is caused by the database, the cache, or memory starvation.

---

## 10. Performance Considerations

- **Dedicated Connection for Health Checks**: Avoid using a standard application connection pool worker for health checks if the pool can be exhausted. If all 20 pool connections are locked executing slow reports, the health check will time out, falsely reporting the database as offline.
- **Probe Frequency Tuning**: Balance detection speed against overhead:
  - Startup Probe: `periodSeconds: 2` (Rapid detection of boot completion).
  - Readiness Probe: `periodSeconds: 5` (Detects failures within 5s).
  - Liveness Probe: `periodSeconds: 15` (Low overhead monitoring).

---

## 11. Security Considerations

- **Restrict Diagnostic Payload Visibility**:
  Do not expose sensitive database connection strings, server IPs, or stack traces in public health check JSON responses. An unauthenticated attacker scraping `/health/ready` could learn internal network topology and version numbers.
- **Internal Network Only for Deep Probes**:
  Expose simple liveness checks publicly if required by external pingers, but restrict deep dependency readiness probes to internal cluster VPC traffic (or behind internal reverse proxy path blocks).

---

## 12. Alternatives

| Mechanism | Best Suited For | Pros | Cons |
|---|---|---|---|
| **HTTP Probes (`httpGet`)** | Web APIs & Microservices | Deep application-level validation; returns status codes. | Requires HTTP server stack to be initialized. |
| **TCP Socket Probes (`tcpSocket`)** | Database / Message Brokers | Tests socket connectivity with zero HTTP overhead. | Cannot verify internal application logic or deadlocks. |
| **Exec Probes (`exec.command`)** | Specialized CLI Tools | Runs arbitrary shell scripts inside container. | High CPU overhead spawning subshells repeatedly. |

---

## 13. Trade-offs

- **Aggressive Failure Thresholds vs. False Positives**:
  Setting `failureThreshold: 1` removes a pod instantly on the first dropped packet, but causes healthy pods to flap in and out of the load balancer during brief network blips. A threshold of `2` or `3` failures prevents transient false positives while still detaching failing pods within 10 seconds.
- **Readiness Check Depth vs. Blast Radius**:
  The more dependencies you check in `/health/ready`, the more strictly you enforce readiness, but the higher the risk of a non-critical dependency failure taking down your entire API routing tier.

---

## 14. Real-World Usage & Implementation Example

Here is a complete Express integration demonstrating how to wire the `HealthSentinel` into a production application with graceful shutdown hooks:

```typescript
// app.ts
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { HealthSentinel } from './health-sentinel';

const app = express();
const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const healthSentinel = new HealthSentinel(pgPool, redis);

// Register dedicated probe endpoints
app.get('/health/live', healthSentinel.handleLiveness);
app.get('/health/ready', healthSentinel.handleReadiness);

// Normal Application Routes
app.get('/api/v1/products', async (req, res) => {
  const result = await pgPool.query('SELECT * FROM products LIMIT 10');
  res.json({ products: result.rows });
});

const server = http.createServer(app);
server.listen(4000, () => {
  console.log('[BOOT] Server operational on port 4000.');
});

// Handle Container Termination Signal (SIGTERM from Kubernetes/ECS)
process.on('SIGTERM', () => {
  console.log('[SIGTERM] Container termination requested.');

  // 1. Immediately fail readiness checks to stop incoming traffic from load balancer
  healthSentinel.setShuttingDown(true);

  // 2. Wait 5 seconds for Kubernetes to update endpoints and load balancers to drain
  setTimeout(() => {
    console.log('[DRAIN] Closing HTTP server listener...');
    server.close(async () => {
      console.log('[CLEANUP] Closing database and cache connections...');
      await pgPool.end();
      redis.disconnect();
      console.log('[EXIT] Graceful shutdown complete. Exiting.');
      process.exit(0);
    });
  }, 5000);
});
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: What is the difference between a Liveness Probe and a Readiness Probe?
**Answer**:
- **Liveness Probe**: Determines if the container process is alive and healthy. If it fails, the container orchestrator (Kubernetes) **terminates and restarts the container**. It is used to recover from deadlocks and fatal memory freezes.
- **Readiness Probe**: Determines if the container is currently prepared to accept incoming network traffic. If it fails, the container is **temporarily removed from the load balancer target pool**, but the container is *not* restarted. It is used during startup, warm-up phases, and temporary dependency slowdowns.

### 2. Conceptual: Why should a Liveness Probe NEVER check the health of a database?
**Answer**:
If a liveness probe checks external database connectivity, a brief database network blip or scheduled restart will cause *every single running application pod* to fail its liveness check simultaneously. 
Kubernetes will immediately kill and restart every pod in the entire cluster at the exact same time. When the database comes back online, it will be hit by an overwhelming thundering herd of hundreds of containers restarting and attempting connection handshakes, causing a catastrophic cascading outage. Liveness probes must check **only local in-process health**.

### 3. Implementation: How does a Startup Probe protect applications with slow startup times?
**Answer**:
Certain applications take 30 to 60 seconds to boot (running heavy database migrations, pre-warming large memory caches, or loading machine learning models). 
Without a **Startup Probe**, the fast-checking Liveness Probe (`periodSeconds: 5`) will fail 3 times within 15 seconds, killing and restarting the container before it ever has a chance to finish booting, trapping the pod in an infinite `CrashLoopBackOff`. 
A Startup Probe disables liveness and readiness checks until it succeeds, providing an isolated initialization grace window (e.g., `failureThreshold: 30`, `periodSeconds: 2` allows up to 60 seconds).

### 4. Debugging: An application in production is restarting every 3 minutes, but application logs show no errors or crashes. What is happening?
**Answer**:
1. **Liveness Probe Timeout**: The application is failing its liveness probe. Check `kubectl describe pod <name>` and look for: `Liveness probe failed: HTTP probe failed with statuscode: 500` or `context deadline exceeded (Client.Timeout)`.
2. **Event Loop Starvation**: Node.js is executing a heavy CPU-bound computation (e.g., parsing a 50MB JSON string or running an un-indexed regex), blocking the event loop for 5 seconds. The liveness probe probe hits `timeoutSeconds: 3`, fails 3 times, and Kubernetes terminates the container with exit code 137 or 143.
3. **Remediation**: Offload CPU-bound tasks to worker threads or background queues, and ensure health check routes are lightweight.

### 5. Scenario: What happens to active in-flight user requests when a container fails its Readiness Probe?
**Answer**:
When a readiness probe fails, the load balancer or kube-proxy removes the pod IP from the active Endpoints list. 
- **New requests** are immediately directed to remaining healthy pods.
- **Existing, in-flight requests** already established on open TCP sockets are **not abruptly killed**. The container continues processing them to completion. Only when a container receives `SIGTERM` and exceeds its graceful termination grace period will connections be forcefully severed.

### 6. Advanced: How should health checks behave during application graceful shutdown?
**Answer**:
1. When the container receives `SIGTERM`, it enters the **Termination Lifecycle**.
2. The readiness probe must **immediately return HTTP 503 Service Unavailable**.
3. The application sleeps for 5 seconds (`preStop` hook or internal timer) without closing its HTTP socket to give the load balancer time to update its routing table and drain connections.
4. The liveness probe must **continue returning HTTP 200** during this draining period so Kubernetes does not forcefully kill the process with `SIGKILL` before active transactions finish.
5. Once in-flight requests drain, close the database connection pools and exit with code 0.

---

## 16. Coding Questions & Practical Challenges

1. **Lightweight Event Loop Lag Probe**: Write a Node.js health check function that measures event loop lag using `perf_hooks.monitorEventLoopDelay()` and returns HTTP 503 if p99 lag exceeds 100ms.
2. **Cascading Health Circuit Breaker**: Implement an Express middleware that monitors database failure counts and automatically disables the readiness probe for 30 seconds if 5 consecutive DB query timeouts occur.
3. **Docker Compose Healthcheck**: Write a `docker-compose.yml` service definition for a Node.js application that uses `curl` to probe `/health/ready` every 10 seconds, retrying 3 times before declaring the service unhealthy.

---

## 17. Common Interview Traps

- **Trap 1: Believing a health check must be a complex integration test**: Health checks are invoked thousands of times an hour by orchestrators. Designing them like full end-to-end integration tests overloads the system. They should be lean, fast, and lightweight.
- **Trap 2: Using the same endpoint for Liveness and Readiness**: Conflating `/health/live` and `/health/ready` into a single `/health` endpoint robs the orchestrator of the ability to distinguish between a dead process needing a reboot and an unready process needing temporary detachment from the load balancer.
- **Trap 3: Forgetting to set a timeout on the health check endpoint**: If the health check handler queries a database without a query timeout, a locked database connection causes the health check HTTP handler to hang indefinitely, consuming web server connection sockets.

---

## 18. Revision Summary

- **Three Probe Types**:
  - **Startup**: Grants grace window for cold starts; disables other probes until boot completes.
  - **Liveness**: Validates local process responsiveness; failure triggers container **restart**.
  - **Readiness**: Validates dependency connectivity (DB, Redis); failure **removes instance from load balancer routing**.
- **Golden Rule**: Never check third-party external APIs or run heavy SQL queries in health probes.
- **Graceful Termination**: Flip readiness to HTTP 503 immediately on `SIGTERM` to drain load balancer traffic before shutting down.

---

## 19. Quick Reference Cheatsheet

```yaml
# Kubernetes Standard Probe Setup
startupProbe:
  httpGet: { path: /health/live, port: 4000 }
  failureThreshold: 30
  periodSeconds: 2

livenessProbe:
  httpGet: { path: /health/live, port: 4000 }
  periodSeconds: 15
  timeoutSeconds: 3
  failureThreshold: 3

readinessProbe:
  httpGet: { path: /health/ready, port: 4000 }
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 2

# Probe Response Codes
HTTP 200-399: Probe considered SUCCESSFUL
Any other code (e.g. 503) or timeout: Probe considered FAILED
```
