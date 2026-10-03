# Process Managers: PM2, Systemd & Production Log Management

## 1. What is it?
In production Linux environments, running a Node.js server via `node dist/server.js` inside an active terminal window is an operational anti-pattern: closing the terminal terminates the process, and a single uncaught runtime exception crashes the entire application permanently.

A **Process Manager** is a system utility responsible for supervising, monitoring, auto-restarting, clustering, and logging long-running application processes.
The two dominant approaches in modern Linux environments are:
1. **PM2 (Production Process Manager)**: An application-level Node.js process supervisor featuring built-in multi-core clustering (`cluster mode`), zero-downtime hot reloads, log aggregation, and real-time terminal telemetry.
2. **Systemd**: The native Linux init system and service manager (PID 1). Systemd operates at the OS kernel level, ensuring your application boots on server reboot, restarts on failure, enforces OS-level resource limits (cgroups), and manages system logs via `journald`.

```
                    PM2 MULTI-CORE CLUSTER ARCHITECTURE
                    
                         Incoming HTTP Traffic (Port 80/443)
                                        │
                                        ▼
                         ┌─────────────────────────────┐
                         │ Nginx Reverse Proxy / Load  │
                         └──────────────┬──────────────┘
                                        │
                                        ▼ (Port 4000)
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ PM2 Master Process (Supervisor & Health Sentinel)                           │
 │ • Watches Worker Health                                                     │
 │ • Distributes incoming TCP sockets via Round-Robin                          │
 └──────┬──────────────────────┬──────────────────────┬──────────────────────┬─┘
        │ (IPC)                │ (IPC)                │ (IPC)                │ (IPC)
        ▼                      ▼                      ▼                      ▼
 ┌──────────────┐       ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
 │ Worker 1     │       │ Worker 2     │       │ Worker 3     │       │ Worker 4     │
 │ (CPU Core 0) │       │ (CPU Core 1) │       │ (CPU Core 2) │       │ (CPU Core 3) │
 └──────────────┘       └──────────────┘       └──────────────┘       └──────────────┘
        ▲                      ▲                      ▲                      ▲
        └──────────────────────┴──────────────────────┴──────────────────────┘
                                        │
                 Supervised at OS Level by Linux Systemd Unit
```

---

## 2. Why does it exist?
Node.js architecture introduces unique operational hurdles that process managers solve:

1. **The Single-Threaded Core Limitation**: A Node.js process executes on a single event loop thread, utilizing only one CPU core. On an 8-core or 16-core cloud server, a single Node process leaves 87% to 93% of server hardware completely idle. PM2's cluster mode automatically spawns one worker process per CPU core, multiplying throughput.
2. **Fatal Crashes on Uncaught Exceptions**: When an asynchronous promise rejection goes unhandled, the Node.js runtime exits with code 1. Without a supervisor, the website remains offline until a developer manually restarts the server. PM2 and Systemd detect process termination and reboot the app in $< 500\text{ms}$.
3. **Memory Leaks and Out-Of-Memory (OOM) Freezes**: Node.js applications with slow memory leaks eventually freeze when V8 heap space fills up. PM2 can automatically restart workers when RAM usage exceeds a configured threshold (e.g., `max_memory_restart: '500M'`).
4. **Zero-Downtime Reloads**: Deploying updated code traditionally meant killing the old process and starting the new one (causing 3 to 10 seconds of downtime). PM2's `pm2 reload` performs a rolling restart: it spins up new workers first, waits for them to listen on the port, and only then terminates the old workers.

---

## 3. Mental Model
Think of process management like a restaurant kitchen:
- Node.js is a single master chef: fast and focused, but can only cook one dish at a time. If the chef cuts their finger (an uncaught exception), the entire kitchen shuts down.
- **PM2** is the Head Chef Supervisor: it hires 4 identical chefs (one for each kitchen station / CPU core), monitors them, and if Chef 2 faints, immediately replaces them with a fresh chef in under a second.
- **Systemd** is the City Building Inspector and Utility Authority: it ensures the kitchen building has power, automatically unlocks the restaurant doors at 6:00 AM after a power outage (server reboot), and cuts off the gas if a safety threshold is breached.

---

## 4. Basic Example: Running PM2 via CLI

```bash
# 1. Install PM2 globally
npm install -g pm2

# 2. Start application in Cluster Mode (spawns 1 worker per CPU core automatically!)
pm2 start dist/server.js -i max --name "core-api"

# 3. View real-time interactive process dashboard
pm2 monit

# 4. Zero-downtime hot reload after a code update
pm2 reload core-api

# 5. Save process list and generate systemd startup script (survives server reboot)
pm2 save
pm2 startup systemd
```

---

## 5. Real Example: Enterprise `ecosystem.config.js` and Production `systemd` Unit

### A. Production PM2 Configuration (`ecosystem.config.js`)
In enterprise environments, PM2 is configured declaratively using an ecosystem file:

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'core-api',
      script: './dist/server.js',
      instances: 'max',          // Scales to all available CPU cores
      exec_mode: 'cluster',      // Enables Node.js cluster module
      watch: false,              // Never enable file watching in production!
      max_memory_restart: '600M',// Auto-restart if a worker leaks memory above 600MB
      autorestart: true,         // Automatically restart if process crashes
      max_restarts: 10,          // Prevent infinite restart loops if code is broken
      restart_delay: 2000,       // Wait 2 seconds between crash restarts
      kill_timeout: 5000,        // Allow 5 seconds for graceful shutdown on SIGINT
      listen_timeout: 8000,      // Wait 8s for worker to emit 'ready' signal
      wait_ready: true,          // Zero-downtime: waits for process.send('ready')
      
      // Output log file paths
      error_file: '/var/log/core-api/error.log',
      out_file: '/var/log/core-api/out.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      
      // Environment-specific configurations
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      env_staging: {
        NODE_ENV: 'staging',
        PORT: 4000,
      }
    },
    {
      // Dedicated background worker running in fork mode (single instance)
      name: 'queue-worker',
      script: './dist/worker.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '800M',
      env_production: {
        NODE_ENV: 'production',
      }
    }
  ]
};
```

### B. Production Linux Systemd Service Unit (`/etc/systemd/system/node-api.service`)
If you prefer running containerless Node.js without PM2, native **Linux Systemd** provides bulletproof OS-level lifecycle supervision:

```ini
[Unit]
Description=Node.js Production Core API Service
Documentation=https://docs.mycompany.com/api
After=network.target postgresql.service redis.service
Wants=postgresql.service redis.service

[Service]
Type=simple
User=appuser
Group=appuser
WorkingDirectory=/var/www/core-api
ExecStart=/usr/bin/node /var/www/core-api/dist/server.js
Restart=always
RestartSec=5s

# Environment Variables
Environment=NODE_ENV=production
Environment=PORT=4000
EnvironmentFile=/etc/core-api/.env.production

# Process Resource & File Descriptor Limits
LimitNOFILE=65535
LimitNPROC=4096
MemoryMax=1G
CPUQuota=200%

# Security Hardening
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
NoNewPrivileges=true

# Standard Output & Error Logging via systemd journald
StandardOutput=journal
StandardError=journal
SyslogIdentifier=node-api

[Install]
WantedBy=multi-user.target
```

```bash
# Register, enable and start the systemd service:
sudo systemctl daemon-reload
sudo systemctl enable node-api
sudo systemctl start node-api
sudo systemctl status node-api

# View live streaming logs via journalctl:
journalctl -u node-api -f -o cat
```

---

## 6. Under the Hood: Node.js Cluster Module & Socket Distribution

How does PM2 run 8 Node.js processes all listening on the exact same port (e.g., `4000`) without a `EADDRINUSE` port collision?

```
                     SOCKET PASSING IN NODE.JS CLUSTER
                     
 1. Client initiates TCP connection to port 4000
                          │
                          ▼
 ┌────────────────────────────────────────────────────────┐
 │ PM2 / Node.js Cluster Master Process (Master Thread)   │
 │ • Opens the single master listening TCP socket         │
 │ • Tracks worker load using Round-Robin algorithm       │
 └────────────────────────┬───────────────────────────────┘
                          │ 2. Hands off TCP Socket File Descriptor
                          ▼    via internal UNIX Domain Socket IPC
 ┌────────────────────────────────────────────────────────┐
 │ Child Worker Process (PID 14022 - CPU Core 3)          │
 │ • Accepts socket, parses HTTP stream, returns response │
 └────────────────────────────────────────────────────────┘
```
1. The **Master Process** opens the actual TCP listening socket on port 4000.
2. In Linux, child processes created via `child_process.fork()` share file descriptors with the parent.
3. When a new client connection arrives, the master process executes an internal **Round-Robin** load-balancing algorithm and sends the connected client socket handle directly to a child worker across an internal UNIX domain IPC pipe.
4. The worker processes the HTTP request independently; the other workers are unaffected.

---

## 7. Important Rules

1. **Never Store In-Memory State When Using Cluster Mode**:
   Because PM2 spawns multiple independent Node.js processes, **memory is not shared between workers**. If Worker 1 stores a session or cart in an in-memory `Map()`, a subsequent request routed to Worker 2 will not find the session! Always use **Redis** for sessions, caching, and rate limiting in clustered environments.
2. **Signal Readiness for True Zero-Downtime Reloads (`wait_ready: true`)**:
   By default, PM2 assumes a worker is ready the millisecond its process boots. However, database connection pools take 2–3 seconds to initialize. If PM2 terminates old workers immediately, users will encounter 502 errors. Configure `wait_ready: true` in PM2 and add `process.send('ready')` inside your application code after all database connections have connected successfully.
3. **Configure Automated Log Rotation (`pm2-logrotate`)**:
   Unmanaged log files expand continuously until they consume 100% of the server’s hard disk, freezing the OS. Always install and configure `pm2-logrotate` to compress and rotate logs daily:
   ```bash
   pm2 install pm2-logrotate
   pm2 set pm2-logrotate:max_size 100M
   pm2 set pm2-logrotate:retain 14
   ```

---

## 8. Common Mistakes & Anti-Patterns

### 1. Using `pm2 restart` Instead of `pm2 reload` in Production
- `pm2 restart app`: Kills all active workers simultaneously, builds the new ones, and starts them. Causes **3 to 10 seconds of complete service downtime**.
- `pm2 reload app`: Performs a rolling restart one worker at a time. Zero dropped connections; 100% uptime.

### 2. Enabling `watch: true` in Production
Setting `watch: true` instructs PM2 to monitor the filesystem for changes. In production, runtime file writes (such as generating uploaded files or temporary caches) trigger accidental, uncoordinated server reboots. `watch` is strictly for local development.

### 3. Running Background Cron Jobs in Cluster Mode
If an application defines a `cron` task (e.g., "Send daily digest email at 9 AM") and runs under PM2 cluster mode with 8 instances, **the cron job will execute 8 times simultaneously**, sending 8 duplicate emails to every customer. 
**Fix**: Run cron jobs and queues in a separate, dedicated single-instance process (`exec_mode: 'fork'`, `instances: 1`).

---

## 9. Best Practices

- **Graceful Shutdown Interception**: Register `SIGINT` / `SIGTERM` listeners. Stop accepting new HTTP requests, drain database connection pools, and exit with code 0 within PM2’s `kill_timeout` window:
  ```typescript
  process.on('SIGINT', async () => {
    await server.close();
    await db.disconnect();
    process.exit(0);
  });
  ```
- **Systemd Startup Hooks**: Always link PM2 to systemd using `pm2 startup systemd` and `pm2 save`. This guarantees that if the cloud provider reboots the underlying VM for hypervisor maintenance, your application starts up automatically.

---

## 10. Performance Considerations

- **Cluster Sizing Heuristic**: Setting `instances: 'max'` assigns one worker per physical CPU thread. If your server is a shared multi-tenant VM with background database processes, setting `instances: -1` (leaving one core free for OS and database tasks) prevents CPU starvation.
- **File Descriptor Ceiling (`LimitNOFILE`)**: Linux defaults to 1,024 open file descriptors per process. High-concurrency Node.js servers holding thousands of simultaneous WebSockets will throw `EMFILE: too many open files`. In your systemd unit, set `LimitNOFILE=65535`.

---

## 11. Security Considerations

- **Never Run as `root`**: Neither PM2 nor Systemd services should run as the Linux `root` user. Create a dedicated unprivileged user (`adduser --system --no-create-home appuser`) and assign file ownership accordingly.
- **Isolate Environment Secrets**: Store production environment variables in a protected directory (e.g., `/etc/core-api/.env`) readable only by `root` and `appuser` (`chmod 600 .env`).

---

## 12. Alternatives

| Solution | Layer | Pros | Cons |
|---|---|---|---|
| **PM2** | Application / Node.js | Multi-core clustering, zero-downtime reload, log management. | Node.js-specific; higher memory footprint than systemd. |
| **Systemd** | Linux OS Kernel | Standard Linux native service, zero dependencies, OS reboot survival. | No built-in Node cluster load balancing. |
| **Docker + Kubernetes**| Container Orchestrator | Full container isolation, horizontal pod autoscaling. | High operational complexity; excessive for single-node setups. |

---

## 13. Trade-offs

- **PM2 Cluster Mode vs. Docker Containers**:
  PM2 clustering provides effortless multi-core utilization on a single virtual machine with near-zero configuration. However, Docker containers offer strict filesystem, network, and dependency isolation that PM2 cannot provide. In modern architectures, teams often run a single Docker container per host and scale horizontally via container orchestrators (AWS ECS), bypassing the need for PM2 inside the container.
- **Log Buffering vs. Real-Time Write**:
  Writing logs synchronously to disk degrades event loop performance. PM2 captures unbuffered stdout/stderr streams and appends them asynchronously, maintaining high application throughput.

---

## 14. Real-World Usage & Implementation Example

Here is a complete, production-grade **Application Bootstrap Script** demonstrating the `ready` signal for zero-downtime PM2 reloads:

```typescript
// src/server.ts
import express from 'express';
import http from 'http';
import { Pool } from 'pg';

const app = express();
const PORT = process.env.PORT || 4000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'HEALTHY', workerPid: process.pid });
});

const server = http.createServer(app);

// Bootstrap async dependencies before opening port
async function bootstrap() {
  try {
    // 1. Verify database connectivity
    const client = await pool.connect();
    console.log(`[BOOT] Worker ${process.pid} connected to PostgreSQL successfully.`);
    client.release();

    // 2. Start listening on HTTP port
    server.listen(PORT, () => {
      console.log(`[READY] Worker ${process.pid} listening on port ${PORT}`);

      // 3. Notify PM2 that this worker is ready to receive traffic!
      // This is the trigger that enables 100% zero-downtime rolling reloads!
      if (process.send) {
        process.send('ready');
      }
    });
  } catch (error: any) {
    console.error('[FATAL BOOT ERROR]:', error.message);
    process.exit(1);
  }
}

// 4. Graceful Shutdown on SIGINT (triggered by pm2 reload)
process.on('SIGINT', () => {
  console.log(`[SHUTDOWN] Worker ${process.pid} received SIGINT. Draining connections...`);

  server.close(async () => {
    console.log(`[SHUTDOWN] HTTP server closed for worker ${process.pid}. Closing DB pool...`);
    await pool.end();
    console.log(`[SHUTDOWN] Worker ${process.pid} cleanly terminated.`);
    process.exit(0);
  });

  // Force exit after 4 seconds if draining hangs
  setTimeout(() => {
    console.error(`[SHUTDOWN] Forceful termination timeout reached for worker ${process.pid}.`);
    process.exit(1);
  }, 4000);
});

bootstrap();
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: What is the purpose of PM2's "Cluster Mode"?
**Answer**:
Node.js is fundamentally single-threaded, meaning a single Node process can only utilize one CPU core. On multi-core servers (e.g., 4 or 8 cores), running in fork mode leaves the remaining cores idle. PM2's Cluster Mode leverages Node's native `cluster` module to spawn one worker process per CPU core, sharing the same listening port via master socket handoffs, multiplying the server's overall request-handling capacity without altering application code.

### 2. Conceptual: Explain the difference between `pm2 restart` and `pm2 reload`.
**Answer**:
- **`pm2 restart`**: Terminates all active worker processes simultaneously and reboots them. During the 3–5 seconds while workers are initializing, incoming requests cannot be accepted, resulting in `502 Bad Gateway` downtime for active users.
- **`pm2 reload`**: Implements a rolling restart. It spawns a new worker, waits for it to become healthy and start listening on the port, and only then terminates one old worker, repeating this sequence one-by-one across all cores. This achieves **100% zero-downtime** deployments.

### 3. Implementation: How does PM2 distribute incoming requests across cluster workers?
**Answer**:
PM2 uses the **Round-Robin** load-balancing algorithm provided by Node.js's native cluster module on Linux:
1. The master process opens and binds to the primary TCP server socket.
2. When a new incoming TCP connection request arrives, the master process selects the next child worker in sequential order.
3. The master transmits the connection socket handle across an internal IPC channel (UNIX domain socket) to that child worker process.
4. The selected worker executes the request/response logic and writes back to the client socket.

### 4. Debugging: A Node.js API supervised by PM2 is repeatedly restarting every 30 seconds (`Restart Count: 142`). How do you diagnose it?
**Answer**:
1. Run `pm2 logs --err --lines 50` to inspect error logs. Common causes:
   - Missing required environment variable causing immediate startup failure.
   - Unhandled database connection error during boot (`ECONNREFUSED`).
   - Port collision (`EADDRINUSE`) if another process is occupying the port.
2. Check memory thresholds: Run `pm2 show <app_id>`. If `max_memory_restart` was set too low (e.g., 100MB), normal garbage collection spikes can cause PM2 to prematurely terminate healthy workers.
3. Check `wait_ready` configuration: If `wait_ready: true` is set in the ecosystem file, but the application code forgets to call `process.send('ready')`, PM2 will assume the worker hung and kill it after `listen_timeout`.

### 5. Scenario: Why should you avoid storing user session data in local memory (`Map` or global variables) when running PM2 in cluster mode?
**Answer**:
In cluster mode, each worker is an entirely independent operating system process with its own private V8 memory heap. 
If a user logs in and their session is saved in Worker 1's memory:
- Subsequent HTTP requests may be routed by the Round-Robin master to Worker 2 or Worker 3.
- Worker 2 has no access to Worker 1's memory space, causing the request to fail with `401 Unauthorized`.
- **Solution**: Decouple state entirely. Store session data in an external, centralized **Redis** instance shared by all cluster workers.

### 6. Advanced: How does Linux Systemd compare to PM2 for production process management?
**Answer**:
- **Systemd**: Operates at PID 1 (the root of the OS process tree). It supervises system services directly via the Linux kernel, handles system boots, enforces OS-level `cgroups` resource limits, and logs via the binary `journald` daemon. However, it has no native awareness of Node.js clustering or rolling zero-downtime reloads.
- **PM2**: An application-level supervisor specifically built for Node.js. It handles multi-core clustering, rolling zero-downtime code reloads, and ecosystem configurations.
- **Best Practice Hybrid**: Use **Systemd to supervise the PM2 daemon itself** (`pm2 startup systemd`). Systemd ensures PM2 boots on OS restart; PM2 manages the Node.js application clustering and rolling reloads.

---

## 16. Coding Questions & Practical Challenges

1. **Custom Cluster Implementation**: Write a pure Node.js script using the built-in `node:cluster` module (without PM2) that detects the number of CPU cores, forks worker processes, and implements an auto-restart listener on `cluster.on('exit')`.
2. **Log Rotator CLI Tool**: Implement a Node.js utility using `fs.createReadStream` and `zlib.createGzip` that compresses log files older than 24 hours and deletes archives older than 30 days.
3. **Graceful Ready Emitter**: Write an Express application helper that intercepts uncaught exceptions, sends an alert webhook to Discord/Slack, and delays process exit by 2 seconds to allow inflight requests to terminate cleanly.

---

## 17. Common Interview Traps

- **Trap 1: Believing `instances: 'max'` will indefinitely increase performance**: Assigning 16 instances on a server with only 4 CPU cores causes heavy OS thread context-switching overhead, degrading throughput. Match instances to the number of physical CPU cores.
- **Trap 2: Assuming PM2 restarts protect against memory leak root causes**: While `max_memory_restart` prevents a memory leak from freezing the server, restarting the worker drops in-flight connections and causes transient latency spikes. Memory leaks must be diagnosed and resolved using V8 heap profiling.
- **Trap 3: Forgetting to run `pm2 save` after starting services**: If you start applications via `pm2 start` but forget to run `pm2 save`, rebooting the Linux server will result in an empty PM2 process table on reboot.

---

## 18. Revision Summary

- **Process Supervision**: Keeps Node.js services running 24/7, auto-restarting on uncaught exceptions and memory threshold breaches.
- **PM2 Clustering**: Spawns multiple worker processes across CPU cores, utilizing round-robin socket handoffs to multiply throughput.
- **Zero-Downtime Reload**: `pm2 reload` replaces workers one by one, waiting for `process.send('ready')` before killing old workers.
- **Systemd Integration**: Binds PM2 to Linux PID 1 via `pm2 startup systemd` to ensure applications survive cloud server reboots.
- **Statelessness Requirement**: Memory is isolated per worker; shared state (sessions, rate limits) must reside in Redis.

---

## 19. Quick Reference Cheatsheet

```bash
# PM2 Core Command Cheatsheet
pm2 start ecosystem.config.js --env production  # Boot multi-service stack
pm2 reload all                                  # Zero-downtime rolling reload
pm2 restart all                                 # Hard restart (brief downtime)
pm2 stop <id|name>                              # Stop specific service
pm2 delete <id|name>                            # Remove from PM2 table
pm2 logs --lines 100                            # View live streaming logs
pm2 monit                                       # Terminal dashboard (CPU/RAM)
pm2 save                                        # Save current state for reboot
pm2 startup systemd                             # Generate OS systemd startup hook

# Systemd Core Command Cheatsheet
sudo systemctl daemon-reload                    # Reload systemd configuration
sudo systemctl start node-api                   # Start service
sudo systemctl restart node-api                 # Restart service
sudo systemctl status node-api                  # Check status & health
journalctl -u node-api -f                       # Follow service logs
```
