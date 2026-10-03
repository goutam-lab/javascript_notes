# Docker Containers, Images & Multi-Stage Production Builds

## 1. What is it?
**Docker** is an open-source containerization platform that packages an application and all its operating system dependencies, libraries, binaries, and configurations into a standardized, lightweight, and isolated executable package called a **Container**.

Unlike traditional Virtual Machines (VMs) that emulate complete physical hardware and run a heavyweight Guest Operating System, Docker containers share the host machine’s **Linux OS Kernel**. Isolation is achieved at the kernel level using two native Linux primitives:
- **Namespaces**: Provide process isolation (giving each container its own process tree, network interfaces, mount points, and user IDs).
- **Control Groups (cgroups)**: Enforce hardware resource limits (metering and throttling CPU, RAM, and disk I/O per container).

A **Docker Image** is a read-only, immutable blueprint composed of stacked layers. A **Docker Container** is a running, stateful instance of that image with an ephemeral writable layer on top.

```
       VIRTUAL MACHINES (VMs)                       DOCKER CONTAINERS
 ┌─────────────────────────────────┐       ┌─────────────────────────────────┐
 │ App A      │ App B      │ App C │       │ App A      │ App B      │ App C │
 ├────────────┼────────────┼───────┤       ├────────────┼────────────┼───────┤
 │ Bins/Libs  │ Bins/Libs  │ Bins  │       │ Bins/Libs  │ Bins/Libs  │ Bins  │
 ├────────────┼────────────┼───────┤       ├─────────────────────────────────┤
 │ Guest OS   │ Guest OS   │ Guest │       │ Docker Engine (Containerd)      │
 ├─────────────────────────────────┤       ├─────────────────────────────────┤
 │ Hypervisor (Type 1 or Type 2)   │       │ Host Operating System (Linux)   │
 ├─────────────────────────────────┤       ├─────────────────────────────────┤
 │ Physical Hardware (CPU / RAM)   │       │ Physical Hardware (CPU / RAM)   │
 └─────────────────────────────────┘       └─────────────────────────────────┘
 • Heavyweight (Gigabytes per VM)          • Lightweight (Megabytes per container)
 • Slow boot time (minutes)                • Sub-second boot time (<500ms)
 • Duplicated OS kernels                   • Shared Host OS Kernel
```

---

## 2. Why does it exist?
Before containerization, deploying software across physical servers and cloud VMs suffered from critical systemic failures:

1. **Dependency Hell & Matrix Incompatibility**: App A requires Python 3.8 and OpenSSL 1.1; App B on the same server requires Python 3.11 and OpenSSL 3.0. Installing both on a shared OS inevitably corrupts global system libraries.
2. **Resource Inefficiency of VMs**: Running 10 microservices required 10 separate VMs. Each VM reserved 2GB of RAM just to run its own duplicate Linux guest kernel, wasting 80% of server hardware resources on operating system overhead.
3. **Slow Scaling Latency**: Booting a new Virtual Machine in response to a sudden traffic spike takes 2 to 5 minutes. Docker containers boot in under 500 milliseconds because the OS kernel is already running.
4. **Drift Across Environments**: Applications developed on macOS or Windows behave differently when deployed to Ubuntu servers. Docker guarantees that the exact same binary environment runs from the developer's laptop to production.

---

## 3. Mental Model
Think of Docker like standardized global shipping containers:
- Before 1956, cargo (grain, cars, barrels of rum) was loaded individually onto ships by hand. Every cargo type required different cranes and storage handling.
- The standard intermodal shipping container revolutionized global commerce: cranes and ships do not care what is inside the steel box.
- Similarly, cloud platforms (AWS ECS, Kubernetes, GCP Cloud Run) do not care whether your container holds a Node.js API, a Go binary, or a Python ML model. As long as it is packaged in a Docker container, it runs identically everywhere.

---

## 4. Basic Example: Naive vs. Production Multi-Stage Dockerfile

### The Naive Dockerfile (Anti-Pattern)
```dockerfile
# ❌ NAIVE DOCKERFILE: Heavyweight, insecure, slow to build!
FROM node:20

WORKDIR /app
COPY . .
RUN npm install
RUN npm run build

EXPOSE 3000
# Runs as root! Includes TypeScript compiler, source files, and devDependencies!
# Final image size: ~1.2 Gigabytes!
CMD ["node", "dist/server.js"]
```

---

## 5. Real Example: Production Multi-Stage Dockerfile for Node.js / TypeScript

A **Multi-Stage Build** divides the build process into separate phases. Intermediate compilers, build tools, and source code are discarded, copying only the final compiled JavaScript and production dependencies into a minimal, stripped-down runtime image.

```dockerfile
# ==============================================================================
# STAGE 1: Dependency Resolver
# ==============================================================================
FROM node:20-alpine3.19 AS deps
WORKDIR /app

# Check https://github.com/nodejs/docker-node/tree/main#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat

# Copy lockfiles first to maximize Docker layer cache hits!
COPY package.json package-lock.json ./
RUN npm ci

# ==============================================================================
# STAGE 2: TypeScript Builder
# ==============================================================================
FROM node:20-alpine3.19 AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Compile TypeScript to JavaScript
ENV NODE_ENV=production
RUN npm run build

# Prune devDependencies to keep only runtime dependencies
RUN npm prune --production

# ==============================================================================
# STAGE 3: Production Minimal Runner
# ==============================================================================
FROM node:20-alpine3.19 AS runner
WORKDIR /app

# Enforce production environment
ENV NODE_ENV=production
ENV PORT=4000

# Install dumb-init to handle PID 1 signal forwarding (SIGTERM / SIGINT)
RUN apk add --no-cache dumb-init

# Create a dedicated non-root user and group
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

# Copy only production dependencies and compiled build artifacts
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Change file ownership to non-root user
USER appuser

EXPOSE 4000

# Wrap execution with dumb-init as PID 1
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["node", "dist/server.js"]
# Final image size: ~110 Megabytes! (10x smaller, zero devDependencies, non-root)
```

---

## 6. Under the Hood: Docker Layers, Union Filesystem & Linux Primitives

### A. How Docker Layers Work (OverlayFS)
Every instruction in a Dockerfile (`FROM`, `COPY`, `RUN`) creates a read-only layer in the **Union File System (OverlayFS)**:

```
┌────────────────────────────────────────────────────────┐
│ Writable Container Layer (Ephemeral state, runtime logs)│
├────────────────────────────────────────────────────────┤
│ Layer 5: CMD ["node", "dist/server.js"]                │
├────────────────────────────────────────────────────────┤
│ Layer 4: COPY --from=builder /app/dist ./dist          │ (Modified on code change)
├────────────────────────────────────────────────────────┤
│ Layer 3: RUN npm ci --production                       │ (Cached unless package.json changes)
├────────────────────────────────────────────────────────┤
│ Layer 2: COPY package.json package-lock.json ./        │ (Cached)
├────────────────────────────────────────────────────────┤
│ Layer 1: Base Alpine Linux OS + Node.js Binary         │ (Shared across containers)
└────────────────────────────────────────────────────────┘
```
- **Layer Caching Rule**: When building an image, Docker checks if the local cache has a layer with the exact same command and inputs. If layer 2 is unchanged, Docker uses the cached layer (`Using cache`). 
- **Cache Invalidation**: Once any layer changes (e.g., `COPY . .`), **all subsequent layers below it are invalidated and must rebuild from scratch**. That is why `package.json` must always be copied and installed *before* copying the application source code.

### B. Linux Namespaces & cgroups
Containers do not run a hypervisor. Isolation is enforced directly by the Linux kernel:
- **PID Namespace**: Isolates process IDs. Inside the container, your Node.js app thinks it is process ID 1 (`PID 1`), while on the host machine it is actually PID 14285.
- **NET Namespace**: Gives each container its own virtual network interface, IP address, and routing table.
- **MNT Namespace**: Isolates filesystem mount points.
- **cgroups (Control Groups)**: Enforces physical limits: e.g., `docker run --cpus="1.5" --memory="512m"`. If the container attempts to allocate 513MB of RAM, the Linux Out-Of-Memory (OOM) killer terminates the process with exit code 137.

---

## 7. Important Rules

1. **Always Use a `.dockerignore` File**:
   Never copy your local `node_modules`, `.git`, `.env`, or build directories into the Docker build context. Copying local `node_modules` overwrites Linux native binary dependencies with your host OS binaries (e.g., macOS ARM binaries copied to an x86 Linux container will crash immediately).
2. **Never Run Containers as Root (`USER appuser`)**:
   By default, Docker containers run as `root` (`UID 0`). If an attacker exploits a remote code execution (RCE) vulnerability in an Express route, they obtain root privileges inside the container, increasing the risk of a container-escape exploit accessing the host server.
3. **Use an Init Process (`dumb-init` / `tini`) for PID 1**:
   In Linux, PID 1 has special responsibilities: it must adopt orphaned child processes (zombie reaping) and forward OS signals (`SIGTERM`, `SIGINT`). Node.js is not designed to run as PID 1; it ignores `SIGTERM` by default, causing container orchestrators to wait 10 seconds before forcibly killing the app (`SIGKILL`), corrupting in-flight requests.
4. **Pin Base Image Versions**:
   Never use `FROM node:latest`. An unpinned tag can silently update major Node.js or Alpine versions overnight, breaking your production build. Pin explicit versions: `FROM node:20.11.0-alpine3.19`.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Inefficient Layer Ordering (Busting the Dependency Cache)
```dockerfile
# ❌ ANTI-PATTERN: Copying code before dependencies!
COPY . .
RUN npm install
```
**Why it fails**: Every time you modify a single comment in `src/index.ts`, Docker invalidates the cache for `COPY . .` and is forced to re-run `npm install` from scratch, wasting 3 minutes on every single CI build.
**Fix**:
```dockerfile
# ✅ BEST PRACTICE: Copy lockfiles first
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
```

### 2. Leaking Build Secrets into Image Layers
Executing `RUN curl -u $GITHUB_TOKEN ...` leaves the secret token baked permanently into the image layer history (`docker history <image>`). Anyone with pull access can extract the token.
**Fix**: Use Docker BuildKit secret mounts:
```dockerfile
RUN --mount=type=secret,id=gh_token \
    TOKEN=$(cat /run/secrets/gh_token) && curl ...
```

---

## 9. Best Practices

- **Use Minimal Base Images (Alpine or Distroless)**: Standard `node:20` is over 1GB and contains hundreds of unnecessary system utilities (bash, curl, python, perl). `node:20-alpine` is $\approx 150\text{MB}$, reducing attack surface and network transfer times.
- **Use `npm ci` Instead of `npm install`**: `npm ci` (Clean Install) strictly requires a `package-lock.json` file, deletes existing `node_modules`, and installs exact pinned versions without mutating the lockfile, guaranteeing 100% reproducible builds.
- **Single Responsibility per Container**: A container should run exactly one process. Do not run Nginx, Node.js, and Redis inside the same Docker container using `supervisord`. Run three separate containers linked via Docker networks.

---

## 10. Performance Considerations

- **BuildKit Concurrency**: Enable Docker BuildKit (`DOCKER_BUILDKIT=1`). BuildKit analyzes your Dockerfile dependency graph and executes independent build stages in parallel, cutting build times by up to 50%.
- **Layer Count Optimization**: Chain related shell commands together with `&& \` within a single `RUN` instruction (e.g., `apt-get update && apt-get install -y ... && rm -rf /var/lib/apt/lists/*`) to prevent intermediate temporary files from being saved into permanent image layers.

---

## 11. Security Considerations

- **Container Image Scanning (Trivy / Snyk)**: Integrate automated container image vulnerability scanning in CI/CD. Trivy scans OS packages and NPM dependencies for known CVEs before images are pushed to registries:
  ```bash
  trivy image my-api:v1.0.0
  ```
- **Read-Only Root Filesystem**: Run production containers with `--read-only`, mounting writable volumes only where strictly necessary (e.g., `/tmp`).
- **Drop Kernel Capabilities**: Drop all default Linux capabilities and add back only what is required:
  ```bash
  docker run --cap-drop=ALL --cap-add=NET_BIND_SERVICE ...
  ```

---

## 12. Alternatives

| Solution | Model | Pros | Cons |
|---|---|---|---|
| **Docker (OCI Containers)** | Shared OS Kernel | Standardized, ultra-fast boot, minimal resource overhead. | Does not isolate kernel exploits between containers. |
| **Virtual Machines (KVM/VMware)** | Full Hardware Emulation | Complete OS & kernel isolation; maximum security. | Heavyweight; slow boot times; high RAM and CPU overhead. |
| **Serverless (AWS Lambda)** | Managed Micro-VMs (Firecracker) | Zero server management; scale-to-zero economics. | Cold-start latency; 15-minute execution limits; vendor lock-in. |

---

## 13. Trade-offs

- **Alpine Linux vs. Debian/Ubuntu Slim**:
  Alpine uses `musl libc` instead of `glibc`. While Alpine images are 80% smaller, certain C++ native Node addons (e.g., `sharp`, `bcrypt`, or `canvas`) must either compile from source during build or download specialized musl pre-compiled binaries. If compatibility issues arise, `node:20-slim` (based on Debian) is a dependable alternative.
- **Multi-Stage Build Complexity vs. Image Size**:
  Writing a 3-stage Dockerfile requires more boilerplate and maintenance than a 5-line naive file, but reduces production images from 1.2GB down to 100MB, slashing deployment times and container registry storage costs.

---

## 14. Real-World Usage & Implementation Example

Here is a production `.dockerignore` file and a sample shell script demonstrating how to build, scan, and run the production container with resource limits.

### A. `.dockerignore`
```
node_modules
npm-debug.log
dist
.git
.github
.env*
Dockerfile*
docker-compose*
README.md
coverage
.vscode
```

### B. Build, Scan & Run Script (`deploy-container.sh`)
```bash
#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="production-api"
IMAGE_TAG=$(git rev-parse --short HEAD)
FULL_IMAGE="${IMAGE_NAME}:${IMAGE_TAG}"

echo "==> Building Docker image with BuildKit..."
DOCKER_BUILDKIT=1 docker build \
  --target runner \
  --tag "${FULL_IMAGE}" \
  --file Dockerfile .

echo "==> Scanning image for high and critical CVEs with Trivy..."
# Fail build if CRITICAL vulnerabilities exist
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  aquasec/trivy:latest image --severity HIGH,CRITICAL --exit-code 1 "${FULL_IMAGE}"

echo "==> Running container with non-root security and cgroup limits..."
docker run -d \
  --name "api-prod" \
  --restart unless-stopped \
  --publish 4000:4000 \
  --cpus="2.0" \
  --memory="512m" \
  --memory-reservation="256m" \
  --env-file .env.production \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  "${FULL_IMAGE}"

echo "==> Container running successfully!"
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: What is the fundamental difference between a Docker Image and a Docker Container?
**Answer**:
A Docker Image is an immutable, read-only template built from a series of stacked layers containing the application code, runtime libraries, and OS utilities. A Docker Container is an active, running instance of an image. When a container starts, Docker mounts a thin, read-write layer (the container layer) on top of the immutable image layers, allowing the running process to create temporary files without altering the underlying image.

### 2. Conceptual: Explain how Docker achieves process isolation without running a hypervisor.
**Answer**:
Docker leverages native Linux kernel primitives:
- **Namespaces**: Provide a virtualized view of system resources for each container. `pid` isolates processes, `net` isolates network interfaces and IP addresses, `mnt` isolates filesystems, and `ipc` isolates inter-process communications.
- **Control Groups (cgroups)**: Allocate, meter, and throttle hardware resources (limiting CPU cores, RAM allocations, disk I/O).
Because containers run directly on the host Linux kernel without a guest OS or hypervisor translation layer, there is virtually zero CPU or memory virtualization overhead.

### 3. Implementation: Why is a multi-stage build essential for production Node.js applications?
**Answer**:
TypeScript projects require heavy compilers (`typescript`, `ts-node`), build tools, and devDependencies (`@types/*`, `eslint`, `vitest`) during development. If packaged into production, these devDependencies bloat image size to over 1GB and expose unnecessary security vulnerabilities. A multi-stage build compiles TypeScript to JavaScript in an intermediate `builder` stage, runs `npm prune --production`, and copies *only* the compiled `/dist` directory and production `node_modules` into a clean, minimal runtime container ($\approx 100\text{MB}$).

### 4. Debugging: A Node.js container in Kubernetes takes exactly 10 seconds to stop during a rolling deployment. What is the issue?
**Answer**:
The application process is ignoring the `SIGTERM` signal.
1. When Docker or Kubernetes stops a container, it sends `SIGTERM` to **PID 1**.
2. If Node.js is executed directly as PID 1 (`CMD ["node", "server.js"]`), Node.js intentionally does not apply default signal handlers for `SIGTERM`.
3. Kubernetes waits for its grace termination period (default 10 or 30 seconds). Because Node.js never acknowledges `SIGTERM`, Kubernetes is forced to send `SIGKILL` (force termination).
4. **Fix**: Use a lightweight init system like `dumb-init` or `tini` as the container `ENTRYPOINT`, or explicitly register `process.on('SIGTERM', ...)` in Node.js to close HTTP listeners and exit cleanly.

### 5. Scenario: What happens if a container exceeds its configured `--memory="512m"` limit?
**Answer**:
The Linux kernel **OOM (Out-of-Memory) Killer** terminates the process running inside the container.
1. The container crashes immediately with exit code **137** ($128 + 9$, representing `SIGKILL`).
2. Docker or Kubernetes flags the container as `OOMKilled`.
3. If a restart policy is configured (`--restart unless-stopped`), Docker restarts the container, often resulting in an infinite `CrashLoopBackOff` if the application continually hits the memory ceiling during startup.

### 6. Advanced: What is the Docker build context, and why does a large build context hurt CI/CD pipelines?
**Answer**:
When you run `docker build .`, the Docker CLI tar-archives the entire directory specified as the build context (`.`) and sends it over a UNIX socket or HTTP network to the Docker daemon *before* executing the first Dockerfile instruction. If directories like `node_modules`, `.git`, or temporary media uploads are not listed in `.dockerignore`, gigabytes of unnecessary data are transferred to the daemon on every build, wasting minutes of CI build time.

---

## 16. Coding Questions & Practical Challenges

1. **Docker Layer Optimization**: Given an un-optimized 6-layer Dockerfile that takes 4 minutes to rebuild on code changes, reorder instructions and introduce caching to reduce rebuild times to under 10 seconds.
2. **Container Signal Forwarder**: Write a minimal C or Node.js wrapper that registers `SIGTERM` and `SIGINT` handlers, spawns a child process, forwards signals to the child, and reaps zombie processes.
3. **Multi-Stage Next.js Dockerfile**: Write a complete production Dockerfile for a Next.js App Router application utilizing Next.js `output: 'standalone'` mode to produce an ultra-lean (<120MB) runtime image.

---

## 17. Common Interview Traps

- **Trap 1: Assuming `ADD` and `COPY` are identical in Dockerfiles**: `COPY` simply copies local files from the build context into the container. `ADD` has extra features: it can automatically extract local `.tar.gz` archives and download files from remote URLs. Best practice: always use `COPY` for predictability unless you specifically need automatic tarball extraction.
- **Trap 2: Believing containers provide hardware-level physical isolation**: Containers share the host Linux kernel. If a vulnerability exists in the host kernel (e.g., Dirty COW), an attacker who breaks out of container namespaces can compromise the entire host server. For multi-tenant hostile workloads, use micro-VMs (AWS Firecracker) or gVisor.
- **Trap 3: Using `npm install` instead of `npm ci` in Dockerfiles**: `npm install` can update minor/patch versions of dependencies based on `^` in `package.json`, causing the image built in CI to differ from what the developer tested locally. Always use `npm ci`.

---

## 18. Revision Summary

- **Container Core**: Namespaces (isolation) + cgroups (resource limits) running on a shared Linux host kernel.
- **Image Architecture**: Stack of immutable read-only layers with copy-on-write storage driver (OverlayFS).
- **Multi-Stage Pipelines**: Separate build environment (compilers, devDependencies) from minimal production runtime image (Alpine Linux + dumb-init + non-root user).
- **Layer Caching Rule**: Copy `package.json` and install dependencies *before* copying source code.
- **Production Guardrails**: Always include `.dockerignore`, run as non-root (`USER appuser`), handle PID 1 signals, and scan images with Trivy.

---

## 19. Quick Reference Cheatsheet

```bash
# Production Docker CLI Commands
docker build -t my-app:v1.0.0 --target runner .
docker run -d -p 3000:3000 --cpus="1.0" --memory="512m" --read-only my-app:v1.0.0

# Inspecting Image Layers & Storage
docker history my-app:v1.0.0
docker system prune -a --volumes # Cleanup unused images & build caches

# Checking Container Resource Usage
docker stats api-prod
docker logs --tail 100 -f api-prod

# Exit Code Diagnostics
Exit Code 0:   Clean exit (success)
Exit Code 1:   Application exception / crash
Exit Code 137: OOM Killer (Killed via SIGKILL / Memory exceeded)
Exit Code 143: Gracefully terminated via SIGTERM
```
