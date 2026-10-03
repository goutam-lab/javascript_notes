# Docker & Deployment Cheatsheet & Deep Dive

---

## 1. What is it?

The Docker and Deployment Cheatsheet is an operational reference guide and deep-dive technical manual covering containerization, container runtimes, multi-stage image optimization, Docker Compose orchestration, and production deployment pipelines. It covers the full DevOps spectrum—from **Linux kernel isolation primitives (Cgroups, Namespaces, OverlayFS)** and **Dockerfile instruction nuances (`ENTRYPOINT` vs `CMD`, `ARG` vs `ENV`)** to **Nginx reverse proxy configurations**, **Blue-Green / Canary deployment mechanics**, and **production health checks**.

```
+-----------------------------------------------------------------------------------+
|                        Docker & Deployment Architecture                           |
+-----------------------------------------------------------------------------------+
| Container Runtime:     Docker Daemon -> containerd -> runc -> Linux Kernel        |
| Kernel Primitives:     Namespaces (Process Isolation) + Cgroups (Resource Ceilings)|
| Storage Engine:        Overlay2 / OverlayFS (Immutable LowerDir + Mutable UpperDir)|
| Multi-Stage Build:     Builder Stage (Compiles TS) -> Distroless/Alpine Production|
| Multi-Container Stack: Docker Compose v2 (Health checks, internal bridge networks) |
| Production Routing:    Nginx Reverse Proxy (SSL Termination, Gzip, proxy_pass)    |
| Zero-Downtime Rollout: Blue-Green, Canary Releases, Rolling Updates               |
+-----------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Before modern containerization:
1. **The "Works on My Machine" Dilemma:** Applications behaved differently across developer laptops, staging servers, and production environments due to mismatched Node.js versions, native OS package dependencies, and differing libc implementations (glibc vs musl).
2. **Virtual Machine Overhead:** Traditional Hypervisor Virtual Machines (VMware, VirtualBox) packaged a complete guest operating system, consuming gigabytes of disk and hundreds of megabytes of RAM before the application even started. Containers share the host Linux kernel, starting in sub-seconds with near-zero overhead.
3. **Complex Manual Deployments:** Deploying multi-tier stacks (Node API, Redis cache, PostgreSQL DB) required brittle shell scripts, manual dependency installations, and complex port collision management.

---

## 3. Mental Model

To master Docker in interviews, visualize containers as **Sandboxed OS Processes with Layered Glasses**:

```
[ HOST OPERATING SYSTEM KERNEL (Linux) ]
  |
  +---> [ Cgroups: Limits RAM to 512MB, CPU to 1 Core ]
  |
  +---> [ Namespaces: Creates illusion of isolated OS ]
  |       - PID: Container thinks its main process is PID 1
  |       - NET: Has its own virtual eth0 network interface and IP
  |       - MNT: Mounts its own root filesystem (OverlayFS)
  |
  v
[ STORAGE (OverlayFS Layers) ]
  - Container Write Layer (UpperDir - Mutable: changes discarded on delete)
  -------------------------------------------------------------
  - Image Layer 3: Application Code & Compiled JS (Read-Only)
  - Image Layer 2: Node.js Runtime & Node Modules (Read-Only)
  - Image Layer 1: Base Alpine Linux Rootfs (Read-Only)
```

---

## 4. Basic Example

### Production Multi-Stage Dockerfile for Node.js & Next.js

```dockerfile
# -------------------------------------------------------------
# Stage 1: Dependency Installation & Compilation
# -------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

# Leverage Docker cache: Copy package files first
COPY package*.json ./
RUN npm ci

# Copy application source code
COPY . .

# Compile TypeScript / Next.js bundle
RUN npm run build

# Remove development dependencies to slim down node_modules
RUN npm prune --production

# -------------------------------------------------------------
# Stage 2: Minimal Production Runtime
# -------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=3000

# Security: Never run containers as root!
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

# Copy only production dependencies and build artifacts from builder
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Switch to non-root user
USER appuser

EXPOSE 3000

# Health check to ensure container is responsive
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthz || exit 1

# Execute node application
CMD ["node", "dist/server.js"]
```

---

## 5. Real Example

### Production Docker Compose Stack with PostgreSQL, Redis, and Health Checks

```yaml
version: "3.8"

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: production_api
    restart: always
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://app_user:secret_pass@postgres_db:5432/production_db
      - REDIS_URL=redis://redis_cache:6379
    depends_on:
      postgres_db:
        condition: service_healthy
      redis_cache:
        condition: service_healthy
    networks:
      - internal_network
    deploy:
      resources:
        limits:
          cpus: "1.0"
          memory: 512M

  postgres_db:
    image: postgres:16-alpine
    container_name: production_postgres
    restart: always
    environment:
      POSTGRES_USER: app_user
      POSTGRES_PASSWORD: secret_pass
      POSTGRES_DB: production_db
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app_user -d production_db"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - internal_network

  redis_cache:
    image: redis:7-alpine
    container_name: production_redis
    restart: always
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redisdata:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    networks:
      - internal_network

networks:
  internal_network:
    driver: bridge

volumes:
  pgdata:
  redisdata:
```

---

## 6. Under the Hood

### Linux Kernel Primitives: Namespaces vs Cgroups

```
+------------------------------------------------------------------------------------+
| 1. Linux Namespaces (What the container can SEE):                                  |
|    - PID: Isolates process IDs (Container process is PID 1; cannot see host PIDs). |
|    - NET: Isolates network interfaces, routing tables, and IP addresses.          |
|    - MNT: Isolates filesystem mount points.                                        |
|    - IPC: Isolates inter-process communication resources (POSIX message queues).   |
|    - UTS: Isolates hostname and domain name.                                       |
|    - USER: Maps container root UID 0 to an unprivileged user UID 1000 on the host. |
+------------------------------------------------------------------------------------+
| 2. Linux Cgroups (Control Groups - What the container can USE):                    |
|    - Memory limit (memory.max): Kills process with OOMKiller if exceeded.          |
|    - CPU shares (cpu.weight): Allocates relative CPU execution slices.             |
|    - Disk I/O (io.weight): Throttles read/write IOPS per second.                   |
+------------------------------------------------------------------------------------+
```

---

## 7. Important Rules

1. **The Rule of Single Concern per Container:** One container should run **one process** (e.g., do not run Nginx, Node.js, and PostgreSQL in a single container). Multi-process containers break health checking, crash recovery, and independent horizontal scaling.
2. **The Rule of Cache-Optimized Dockerfile Ordering:** Order Dockerfile commands from **least frequently changing to most frequently changing**. Copy `package.json` and run `npm ci` *before* copying `COPY . .`. This prevents re-installing 800MB of node modules every time a single line of application code changes.
3. **The Rule of Non-Root User:** Never run a production container as the default `root` user (`UID 0`). If an attacker executes arbitrary code via a remote code execution (RCE) vulnerability, running as non-root prevents container breakout to the host system.
4. **The Rule of `.dockerignore`:** Always maintain a `.dockerignore` file excluding `node_modules`, `.git`, `.env`, and build artifacts. Sending an un-ignored 1GB `node_modules` directory inflates Docker build context transfer times by minutes.

---

## 8. Common Mistakes

### Mistake 1: Confusing `ENTRYPOINT` and `CMD`
- `ENTRYPOINT`: Specifies the immutable executable to run (e.g., `ENTRYPOINT ["node"]`).
- `CMD`: Specifies the default arguments passed to the entrypoint (e.g., `CMD ["server.js"]`).
- *Mistake:* Using shell form (`CMD npm start`) instead of exec form (`CMD ["npm", "start"]`). Shell form spawns `/bin/sh -c`, which does **not forward `SIGTERM` signals** to Node.js, completely breaking graceful shutdown!

### Mistake 2: Storing Persistent Data in Container Layers
Storing database files or user uploads inside the container's mutable writable layer. When the container crashes, restarts, or is updated to a new image, all data stored in the writable layer is permanently lost. Always use **Docker Named Volumes**.

### Mistake 3: Hardcoding Secrets in Docker Images
Using `ENV DATABASE_PASSWORD=secret` inside a Dockerfile. Environment variables and build arguments defined in Dockerfiles are permanently baked into image metadata layers and can be viewed by anyone using `docker history` or `docker inspect`.

---

## 9. Best Practices

1. **Multi-Stage Builds:** Compile assets (TypeScript, Webpack) in a heavy build stage with full dev dependencies, and copy only the compiled output into a tiny Alpine or Distroless runtime image, slashing image size from 1.2GB to 65MB.
2. **Explicit Health Checks:** Always define a `HEALTHCHECK` in Dockerfiles or Docker Compose to allow container orchestrators (Docker Swarm, Kubernetes) to detect hung event loops and stop routing traffic.
3. **Use `npm ci` Instead of `npm install`:** `npm ci` strictly adheres to `package-lock.json`, bypasses package resolution algorithms, deletes existing `node_modules`, and is 2x–3x faster in CI/CD pipelines.
4. **Pin Base Image Versions:** Never use `node:latest`. A breaking upstream release can break production builds unexpectedly. Always pin exact versions: `node:20.11.0-alpine3.19`.

---

## 10. Performance Considerations

* **Docker Layer Cache Invalidation:** Any change in a Dockerfile command invalidates the cache for all subsequent lines. Keep `COPY . .` at the very end of the file.
* **Alpine Linux Musl vs Glibc Performance:** Alpine uses `musl libc`, which has a slower memory allocator (`dlmalloc`) than Debian/Ubuntu's `glibc`. For high-throughput Node.js services with heavy threadpool allocation, Debian Slim images (`node:20-slim`) often outperform Alpine.

---

## 11. Security Considerations

* **Docker Socket Exposure:** Never mount `/var/run/docker.sock` inside an untrusted application container. Giving a container access to the Docker socket grants full root privileges over the host machine (complete container escape).
* **Read-Only Root Filesystem:** Deploy containers with `--read-only`, mounting write permissions only to temporary in-memory tmpfs directories (`--tmpfs /tmp`). Prevents attackers from modifying binaries or dropping scripts.

---

## 12. Complete Dockerfile Instruction Matrix

| Instruction | Purpose | Placement Gotcha |
| :--- | :--- | :--- |
| **`FROM`** | Initializes build stage and sets base image | First non-comment instruction |
| **`WORKDIR`** | Sets working directory for all subsequent instructions | Creates directory if missing |
| **`COPY`** | Copies files from host into container filesystem | Preferred over `ADD` for local files |
| **`ADD`** | Copies files; extracts local tar archives; supports URLs | Use only when tar auto-extraction is needed |
| **`RUN`** | Executes command during image build; creates a new layer | Chain commands with `&& \` to minimize layers |
| **`ENV`** | Sets persistent environment variables | Available at build time AND runtime |
| **`ARG`** | Defines build-time variables | Available ONLY during build; not at runtime |
| **`EXPOSE`** | Documents intended port | Purely documentation; does not publish ports! |
| **`USER`** | Sets UID/user for subsequent instructions and runtime | Essential for non-root security |
| **`VOLUME`** | Declares managed mount point | Data bypasses union filesystem |
| **`ENTRYPOINT`** | Configures container executable | Runs in exec form `["executable"]` |
| **`CMD`** | Provides default arguments to `ENTRYPOINT` | Can be overridden via CLI args |

---

## 13. Trade-offs

* **Alpine vs Debian Slim:** Alpine produces the smallest images (~60MB), but runs `musl libc` which can cause compatibility issues with native C++ binaries (e.g., `sharp`, `grpc`). Debian Slim is larger (~150MB), but runs standard `glibc` with 100% binary compatibility.
* **Container Isolation vs Bare Metal Performance:** Containers add near-zero CPU overhead (<1%), but bridge network virtualization and storage OverlayFS layers introduce minor latency penalties (2%–5%) compared to raw bare-metal execution.

---

## 14. Real-World Usage

* **GitHub Actions CI/CD:** Uses Docker containers to spin up isolated, reproducible runners for testing, building, and pushing container images to Amazon ECR and GitHub Packages.
* **Shopify:** Manages over 100,000 container pods across global Kubernetes clusters, utilizing multi-stage builds to deploy code updates hundreds of times per day.

---

## 15. Placement Interview Questions

### Basic Level
1. **Explain the difference between a Docker Image and a Docker Container.**
   * *Answer:* A **Docker Image** is an immutable, read-only template consisting of layered filesystems and execution instructions representing an application and its dependencies. A **Docker Container** is an active, runnable instance of an image. It adds a thin, read-write mutable layer (UpperDir) on top of the immutable image layers and runs as an isolated process on the host OS kernel.

2. **What is the difference between `ENTRYPOINT` and `CMD`?**
   * *Answer:* `ENTRYPOINT` defines the core executable that will always run when the container starts (e.g., `["node"]`). `CMD` defines the default parameters passed to the `ENTRYPOINT` (e.g., `["server.js"]`). If a user passes arguments when starting the container (`docker run my-image app.js`), the CLI arguments override `CMD`, but do not override `ENTRYPOINT`.

3. **What is the difference between `COPY` and `ADD` in a Dockerfile?**
   * *Answer:* `COPY` copies local files or directories from the host build context into the container filesystem. `ADD` has additional features: it can fetch files from remote URLs and automatically unpack/extract local tar archives (e.g., `.tar.gz`) into the target directory. Best practice is to use `COPY` for clarity and predictability, unless tar extraction is specifically required.

4. **Why should you use `npm ci` instead of `npm install` inside a Dockerfile?**
   * *Answer:* `npm ci` (Clean Install) is designed for automated CI/CD and container environments. It strictly installs dependencies matching `package-lock.json` without modifying the lockfile, deletes any existing `node_modules` directory to avoid corrupt state, and runs significantly faster than `npm install`.

5. **What is a Docker Multi-Stage Build and what problem does it solve?**
   * *Answer:* A multi-stage build uses multiple `FROM` instructions in a single Dockerfile. It allows developers to compile code, build assets, and run tests in heavy "builder" stages with full development SDKs, and then copy *only* the compiled production artifacts into a tiny, clean runtime image. It drastically reduces production image sizes (from 1GB+ down to <70MB) and eliminates security attack surfaces by excluding compilers and build tools from production.

---

### Conceptual Level
6. **Explain how Linux Namespaces and Cgroups create a container.**
   * *Answer:*
     - *Namespaces provide Isolation (What the process can SEE):* PID namespace gives the container its own process tree starting at PID 1. NET namespace provides an isolated network stack (IP and ports). MNT namespace isolates filesystem mount points.
     - *Cgroups provide Resource Control (What the process can USE):* Restricts CPU shares, limits maximum memory (RSS), and throttles disk I/O. If a process exceeds its Cgroup memory ceiling, the Linux kernel OOM-killer immediately terminates it.

7. **How does the Docker Overlay2 Storage Driver work under the hood?**
   * *Answer:* Overlay2 is an overlay union filesystem that combines multiple directory layers into a single unified filesystem view:
     - *LowerDir (Read-Only):* Represents the immutable layers of the Docker image.
     - *UpperDir (Read-Write):* Represents the container's thin mutable layer.
     - *MergedDir:* The unified mount point the container process sees.
     - *Copy-on-Write (CoW):* When a container modifies an existing image file, Overlay2 copies the file from the lower layer up to the upper layer before writing, leaving the original base image untouched.

8. **Explain the difference between Blue-Green Deployments and Canary Releases.**
   * *Answer:*
     - *Blue-Green Deployment:* Two identical production environments exist: Blue (current active version) and Green (new release). The new version is deployed to Green and tested. Once verified, the load balancer switches 100% of user traffic from Blue to Green instantly. If an issue occurs, rollback is instantaneous by switching back to Blue.
     - *Canary Release:* The new version is deployed alongside the old version and receives a tiny percentage of live user traffic (e.g., 5%). Telemetry (error rate, latency) is monitored. If stable, traffic is gradually increased (25%, 50%, 100%) before retiring the old version.

9. **Why is it critical to use the Exec form (`["executable", "param"]`) instead of Shell form (`executable param`) for `CMD` and `ENTRYPOINT`?**
   * *Answer:* The shell form runs the command inside `/bin/sh -c`. This makes `/bin/sh` PID 1 inside the container, and your application becomes a child process of the shell. Most shells do **not forward OS signals (`SIGTERM`, `SIGINT`) to child processes**. When Docker attempts to gracefully stop the container (`docker stop`), Node.js never receives `SIGTERM`, preventing graceful connection draining until Docker forcefully kills it with `SIGKILL` after 10 seconds.

10. **Explain how Docker container networking works in the default `bridge` driver.**
    * *Answer:* Docker creates a virtual software bridge (`docker0`) on the host. When a container starts, Docker creates a pair of peer virtual Ethernet interfaces (`veth`). One interface is placed inside the container's network namespace (as `eth0`), and the other is bound to the `docker0` bridge on the host. Docker configures host `iptables` NAT rules to forward traffic between the host's physical network interface and the container's private subnet.

---

### Implementation Level
11. **Write a complete Nginx Reverse Proxy configuration block for a Node.js API with SSL and WebSocket support.**
    * *Answer:*
    ```nginx
    upstream node_backend {
        server 127.0.0.1:3000;
        keepalive 64;
    }

    server {
        listen 80;
        server_name api.example.com;
        return 301 https://$host$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name api.example.com;

        ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;

        location / {
            proxy_pass http://node_backend;
            proxy_http_version 1.1;

            # Forward standard identity headers
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # WebSocket upgrade support
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";

            proxy_read_timeout 60s;
        }
    }
    ```

12. **Write a shell script to automate a Blue-Green deployment swap using Docker Compose.**
    * *Answer:*
    ```bash
    #!/usr/bin/env bash
    set -e

    # Determine current active environment
    if docker ps | grep -q "web_blue"; then
        ACTIVE="blue"
        TARGET="green"
        TARGET_PORT=3002
    else
        ACTIVE="blue"
        TARGET="green"
        TARGET_PORT=3001
    fi

    echo "Deploying to TARGET: $TARGET on port $TARGET_PORT..."
    docker compose up -d --build "web_$TARGET"

    # Health check loop
    echo "Waiting for $TARGET to become healthy..."
    for i in {1..30}; do
        if curl -s "http://localhost:$TARGET_PORT/healthz" | grep -q "UP"; then
            echo "$TARGET is healthy!"
            break
        fi
        sleep 2
    done

    # Update Nginx upstream configuration and reload
    sed -i "s/server 127.0.0.1:[0-9]*/server 127.0.0.1:$TARGET_PORT/" /etc/nginx/conf.d/app.conf
    nginx -s reload

    echo "Swapped traffic to $TARGET. Stopping old ACTIVE: $ACTIVE..."
    docker compose stop "web_$ACTIVE"
    ```

13. **How do you configure non-root user execution in an Alpine Dockerfile?**
    * *Answer:*
    ```dockerfile
    RUN addgroup -S appgroup && adduser -S appuser -G appgroup
    USER appuser
    ```

14. **How do you pass build-time arguments securely into a Docker build without leaking them into image metadata?**
    * *Answer:* Use **Docker BuildKit Secret Mounts**:
    ```dockerfile
    # syntax=docker/dockerfile:1.4
    RUN --mount=type=secret,id=npm_token \
        NPM_TOKEN=$(cat /run/secrets/npm_token) npm ci
    ```
    Build command: `docker build --secret id=npm_token,src=.npmrc .`
    The secret is mounted as a temporary file in memory during the execution of that specific command and is **never recorded in any image layer**.

15. **How do you configure a container to automatically restart on crash, but avoid restarting if manually stopped?**
    * *Answer:* Set restart policy to `unless-stopped`:
    ```bash
    docker run -d --restart unless-stopped my-app
    ```

---

### Debugging Level
16. **Why did a container crash with `Exit Code 137` immediately after starting an image processing job?**
    * *Answer:* `Exit Code 137` represents `128 + 9 (SIGKILL)`. The process was forcefully killed by the Linux Kernel **Out-Of-Memory (OOM) Killer** because memory consumption exceeded the Cgroup limit specified in `docker run --memory 512m` or the Docker Compose resource limits.
    * *Fix:* Increase memory limits or refactor the image processing job to use streaming buffers instead of loading full images into RAM.

17. **Why does running `docker exec -it <container> sh` fail with `OCI runtime error: exec failed: container_linux.go: exec: "sh": executable file not found in $PATH`?**
    * *Answer:* The container image was built using a **Distroless** base image (e.g., `gcr.io/distroless/nodejs20-debian12`). Distroless images contain *only* the application and runtime dependencies, deliberately omitting shell binaries (`sh`, `bash`), package managers, and coreutils for extreme security hardening.
    * *Debugging:* Use ephemeral debug containers (`kubectl debug` in Kubernetes) or temporarily build a development image with an Alpine base.

18. **Why does an Express application inside a container report client IP as `172.17.0.1` instead of the user's real public IP?**
    * *Answer:* Docker's bridge networking uses Network Address Translation (NAT) to forward incoming packets to the container. If the application is behind a reverse proxy (Nginx, Cloudflare), Express reads `req.ip` from the local bridge gateway unless configured to trust proxy headers:
    ```typescript
    app.set('trust proxy', true);
    ```
    With `trust proxy` enabled, Express reads the real user IP from the `X-Forwarded-For` header injected by Nginx.

19. **Why did a Docker build fail with `no space left on device` even though host disk storage has 50GB free?**
    * *Answer:*
      1. Accumulated dangling images, stopped containers, and build cache in `/var/lib/docker`.
      2. The Docker storage driver inode allocation was exhausted.
      * *Fix:* Run `docker system prune -a --volumes` to purge dangling images, stopped containers, and unused build caches.

20. **Why does `docker stop <container>` take exactly 10 seconds before stopping?**
    * *Answer:* The container process did not handle or receive the `SIGTERM` signal. Docker sends `SIGTERM`, waits a default timeout of 10 seconds for graceful exit, and then sends a forceful `SIGKILL`. This happens when `CMD` is written in shell form (`CMD node server.js` instead of `CMD ["node", "server.js"]`), causing `/bin/sh` to swallow `SIGTERM`.

---

### Scenario-Based Questions
21. **Scenario: You are designing a CI/CD pipeline for a high-traffic production application. How do you design the Docker build pipeline to guarantee reproducible builds and minimum build times?**
    * *Answer:*
      1. Enable Docker BuildKit (`DOCKER_BUILDKIT=1`).
      2. Use GitHub Actions Cache or inline registry cache (`--cache-from type=registry`).
      3. Pin base images to immutable SHA digests (`node:20.11.0-alpine3.19@sha256:...`).
      4. Copy `package.json` and `package-lock.json` before application code to leverage cached `npm ci` layers.
      5. Run vulnerability scanners (`trivy image my-image:tag`) in the pipeline before pushing to the container registry.

22. **Scenario: Your application requires persistent local database storage, but developers complain that local Docker database data is wiped whenever they run `docker compose down`. How do you fix this?**
    * *Answer:* Developers are running `docker compose down -v`. The `-v` flag explicitly deletes all named volumes. Instruct developers to run `docker compose down` (without `-v`), or define external persistent named volumes in `docker-compose.yml`:
    ```yaml
    volumes:
      pgdata:
        external: true
    ```

23. **Scenario: You have an application deployed across 3 Docker host VMs. How do you manage centralized log aggregation across all containers?**
    * *Answer:* Configure Docker's native **Logging Driver**:
      - Update `/etc/docker/daemon.json` to use the `fluentd`, `syslog`, or `loki` logging driver:
      ```json
      {
        "log-driver": "loki",
        "log-opts": { "loki-url": "https://logs.example.com/loki/api/v1/push" }
      }
      ```
      - All `stdout` and `stderr` streams emitted by containers are automatically streamed to the centralized logging cluster without writing to local host disk files.

24. **Scenario: How do you achieve zero-downtime rolling updates on a single VPS server running Docker without Kubernetes?**
    * *Answer:*
      1. Run Nginx as a reverse proxy on the host.
      2. Run two application containers on different host ports (`app_1` on 3001, `app_2` on 3002).
      3. During deployment: pull new image, restart `app_1`, wait for health check to pass.
      4. Reload Nginx to route traffic to `app_1`.
      5. Restart `app_2`, wait for health check, and reload Nginx to load balance across both.

25. **Scenario: An attacker attempts to break out of a container to access the host operating system. What Docker security flags neutralize this?**
    * *Answer:*
      - `--cap-drop=ALL`: Drops all Linux kernel capabilities.
      - `--read-only`: Makes root filesystem immutable.
      - `--security-opt=no-new-privileges:true`: Prevents processes from gaining additional privileges via `setuid`.
      - `--user 1000:1000`: Runs container as non-root user.
      - Never run with `--privileged` or mount `/var/run/docker.sock`.

---

### Advanced Architectural Questions
26. **Explain the difference between OCI (Open Container Initiative), CRI (Container Runtime Interface), and runc.**
    * *Answer:*
      - **OCI:** Industry standards organization defining container formats: Image Specification (how images are structured) and Runtime Specification (how containers are run).
      - **runc:** The reference implementation of the OCI runtime specification. It interacts directly with the Linux kernel to configure namespaces and cgroups to spawn the container process.
      - **containerd:** A daemon that manages the complete container lifecycle: downloads images, unpacks rootfs, forwards network calls, and delegates low-level execution to runc.
      - **CRI:** Kubernetes plugin interface allowing kubelet to communicate with container runtimes (like containerd or CRI-O).

27. **What is Rootless Docker and why is it essential in multi-tenant enterprise environments?**
    * *Answer:* In standard Docker, the Docker daemon runs as the host `root` user (`UID 0`). Any security flaw in the daemon or container breakout grants the attacker full root control over the physical host. **Rootless Docker** runs the Docker daemon and containers inside a user namespace where the daemon runs as an unprivileged user (`UID 1000`), ensuring that even if an attacker breaks out of the container, they have zero root permissions on the host system.

28. **How does Docker handle DNS resolution between containers within a user-defined bridge network?**
    * *Answer:* In the default `bridge` network, containers can only communicate via raw IP addresses. In a **user-defined bridge network** (created via `docker network create` or Docker Compose), Docker runs an **embedded internal DNS server** listening at `127.0.0.11`. When Container A queries `http://postgres_db:5432`, the internal DNS server resolves the service name `postgres_db` to its container IP address dynamically.

29. **Explain Distroless Containers and their security advantages.**
    * *Answer:* Created by Google, Distroless images contain *only* your application and its immediate runtime dependencies (e.g., Node.js binary and libc). They do **not contain package managers (`apt`, `apk`), shells (`bash`, `sh`), or coreutils (`ls`, `curl`, `rm`)**.
    * *Advantages:*
      1. Dramatically smaller image sizes.
      2. Zero vulnerabilities from unnecessary OS packages.
      3. Neutralizes attacker exploits: even if an attacker achieves Remote Code Execution (RCE), they cannot spawn a reverse shell or download malicious payloads because `sh` and `curl` do not exist.

30. **Explain how Kubernetes utilizes Cgroups v2 for enhanced container isolation.**
    * *Answer:* Cgroups v1 had fragmented controllers for memory, CPU, and blkio, leading to unexpected resource leaks and incomplete OOM accounting (e.g., page cache and buffer memory were not attributed properly to containers). Cgroups v2 provides a unified hierarchy:
      - Memory controller accurately tracks kernel memory, socket buffers, and page caches.
      - Pressure Stall Information (PSI): Allows Kubernetes to detect resource starvation *before* the OOM killer fires.
      - Enhanced rootless container management.

---

## 16. Coding Questions

### Coding Challenge 1: Custom Docker Health Check Script in Node.js

```javascript
// healthcheck.js
const http = require("http");

const options = {
  host: "127.0.0.1",
  port: process.env.PORT || 3000,
  path: "/healthz",
  timeout: 2000,
};

const request = http.request(options, (res) => {
  if (res.statusCode === 200) {
    process.exit(0); // Health check SUCCESS
  } else {
    console.error(`Health check failed with status: ${res.statusCode}`);
    process.exit(1); // Health check FAILURE
  }
});

request.on("error", (err) => {
  console.error("Health check network error:", err.message);
  process.exit(1);
});

request.end();
```

### Coding Challenge 2: Minimal Distroless Dockerfile for TypeScript Application

```dockerfile
# Stage 1: Build TypeScript bundle
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm ci
COPY src/ ./src
RUN npm run build
RUN npm prune --production

# Stage 2: Distroless Minimal Production Image
FROM gcr.io/distroless/nodejs20-debian12
WORKDIR /app

ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

# Distroless runs as non-root user 65532 by default
USER 65532

EXPOSE 3000
CMD ["dist/server.js"]
```

---

## 17. Common Interview Traps

* **The Trap:** The interviewer asks: *"Does specifying `EXPOSE 8080` in a Dockerfile publish port 8080 to the host machine?"*
  * **How candidates fail:** Saying "Yes, it binds the container port to the host."
  * **The Winning Answer:** **No!** `EXPOSE` is purely **metadata and documentation** between the image author and the consumer. It does not publish or bind any ports on the host. To actually bind and expose a port to the host network, you **must use the `-p` flag** during runtime (e.g., `docker run -p 8080:8080`) or specify `ports:` in Docker Compose.
* **The Trap:** *"Can containers share memory with each other on the same physical host?"*
  * **How candidates fail:** Saying "No, containers are completely isolated and can only communicate over network sockets."
  * **The Winning Answer:** **Yes, they can!** While containers are isolated by default via IPC namespaces, Docker allows containers to share memory using the **`--ipc=container:<name>` flag or shared POSIX memory mounts (`--shm-size`)**. This enables ultra-fast zero-copy Inter-Process Communication (IPC) across containers on the same physical host without network latency.

---

## 18. Revision Summary

```
+-----------------------------------------------------------------------------------+
|               Docker & Deployment High-Yield Revision Matrix                      |
+-----------------------------------------------------------------------------------+
| Multi-Stage:         Compile in heavy builder; copy output to clean runtime image  |
| Non-Root Security:   Never run as root (UID 0); always adduser and USER appuser   |
| Layer Caching:       Copy package.json and npm ci BEFORE copying app code         |
| Exec Form Rule:      Always use exec form ["node", "app.js"] so SIGTERM works     |
| Compose Health:      depends_on with condition: service_healthy for DB readiness  |
| Reverse Proxy:       Nginx handles SSL termination, gzip compression, proxy_pass  |
| Rollout Strategy:    Blue-Green for instant rollback; Canary for gradual rollout  |
+-----------------------------------------------------------------------------------+
```

---

## 19. Quick Reference

* **`docker build -t app:v1 .`:** Builds image from local Dockerfile.
* **`docker run -d -p 3000:3000 --memory 512m app:v1`:** Runs container with resource ceiling.
* **`docker system prune -a --volumes`:** Purges all unused images, containers, and volumes.
* **`docker compose up -d --build`:** Builds and starts multi-container stack in background.
* **`ENTRYPOINT ["node"]`:** Defines immutable container executable.
* **`CMD ["server.js"]`:** Defines default overridable parameters for entrypoint.
* **`HEALTHCHECK`:** Configures automated container liveness testing.
