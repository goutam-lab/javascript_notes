# Docker Compose: Multi-Service Local Stacks & Orchestration

## 1. What is it?
**Docker Compose** is a declarative orchestration tool used for defining, executing, and managing multi-container Docker applications. Through a single YAML configuration file (`docker-compose.yml`), engineers can specify application services, internal bridge networks, persistent storage volumes, environment variables, health checks, and service dependency graphs.

With a single command (`docker compose up -d`), Docker Compose spins up an entire local production-like microservice ecosystem—such as a Next.js frontend, an Express.js API backend, a PostgreSQL relational database, and a Redis cache—all connected via an isolated, private virtual network with automatic DNS service discovery.

```
                    DOCKER COMPOSE INTERNAL BRIDGE NETWORK
                    
  [ Host Developer Machine: macOS / Windows / Linux ]
  Browser: http://localhost:3000   │   API Client: http://localhost:4000
                                   │
 ┌─────────────────────────────────┼─────────────────────────────────────┐
 │ User-Defined Bridge Network:    ▼ `app-network`                       │
 │                                                                       │
 │  ┌────────────────────────┐           ┌────────────────────────────┐  │
 │  │ Service: `frontend`    │ ────────► │ Service: `backend`         │  │
 │  │ Next.js (Port: 3000)   │ (Internal)│ Node/Express (Port: 4000)  │  │
 │  └────────────────────────┘           └─────────────┬──────────────┘  │
 │                                                     │                 │
 │                           ┌─────────────────────────┴───────────────┐ │
 │                           ▼ (DNS: `postgres`)      ▼ (DNS: `redis`) │ │
 │              ┌─────────────────────────┐ ┌────────────────────────┐ │ │
 │              │ Service: `postgres`     │ │ Service: `redis`       │ │ │
 │              │ Postgres 16 (Port 5432) │ │ Redis 7 (Port 6379)    │ │ │
 │              └────────────┬────────────┘ └───────────┬────────────┘ │ │
 └───────────────────────────┼──────────────────────────┼───────────────┘
                             ▼                          ▼
               ┌──────────────────────────┐ ┌─────────────────────────┐
               │ Named Volume: `pg_data`  │ │ Named Volume:`redis_data│
               │ (Persistent on Host)     │ │ (Persistent on Host)    │
               └──────────────────────────┘ └─────────────────────────┘
```

---

## 2. Why does it exist?
Developing modern full-stack web applications without Docker Compose forces developers into complex manual setup routines:

1. **Manual Host Installation Overhead**: Onboarding a new engineer requires installing Node.js v20, PostgreSQL v16, Redis v7, and configuring local users, passwords, and port conflicts manually across different operating systems.
2. **Missing Network Isolation & Port Collisions**: If an engineer already runs a local PostgreSQL instance on port 5432 for Project A, they cannot run Project B without modifying host port numbers and application connection strings.
3. **Fragile Shell Script Automations**: Maintaining custom Bash scripts with 15 complex `docker run -d --net=... -v=... -e=...` commands is brittle, error-prone, and unmaintainable.
4. **Startup Race Conditions**: If the backend application container starts up 2 seconds faster than PostgreSQL, the backend immediately crashes with `ECONNREFUSED` because the database server is still initializing storage tables.

---

## 3. Mental Model
Think of Docker Compose like a general contractor building a house:
- A single Dockerfile is like a blueprint for an individual room (the kitchen or the bathroom).
- **Docker Compose** is the master architectural plan: it specifies how the kitchen plumbing connects to the main water line (networks), where the foundation is poured (persistent volumes), and ensures the electrical wiring is certified safe before turning on the lights (health checks and service dependencies).

---

## 4. Basic Example: Minimal Compose Stack

```yaml
# docker-compose.yml
services:
  web:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgres://user:password@db:5432/appdb
    depends_on:
      - db

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: user
      POSTGRES_PASSWORD: password
      POSTGRES_DB: appdb
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

---

## 5. Real Example: Complete Production-Grade Local Full-Stack Stack

Here is an enterprise-grade `docker-compose.yml` orchestrating Next.js, Express TypeScript, PostgreSQL, and Redis, complete with health checks, initialization scripts, non-root users, and isolated bridge networks:

```yaml
version: '3.8'

services:
  # ----------------------------------------------------------------------------
  # 1. DATABASE: PostgreSQL 16 with Health Check
  # ----------------------------------------------------------------------------
  postgres:
    image: postgres:16-alpine
    container_name: dev-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-appuser}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-securepassword}
      POSTGRES_DB: ${POSTGRES_DB:-master_db}
    ports:
      - "5432:5432" # Exposed to host for local GUI tools (DBeaver / TablePlus)
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init-db.sql:/docker-entrypoint-initdb.d/init.sql:ro
    networks:
      - app-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-appuser} -d ${POSTGRES_DB:-master_db}"]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 10s

  # ----------------------------------------------------------------------------
  # 2. CACHE & MESSAGE BROKER: Redis 7 with Persistence
  # ----------------------------------------------------------------------------
  redis:
    image: redis:7-alpine
    container_name: dev-redis
    restart: unless-stopped
    command: ["redis-server", "--appendonly", "yes", "--requirepass", "${REDIS_PASSWORD:-redispassword}"]
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    networks:
      - app-network
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD:-redispassword}", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  # ----------------------------------------------------------------------------
  # 3. BACKEND API: Node.js / Express TypeScript (with live code reloading)
  # ----------------------------------------------------------------------------
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile.dev
    container_name: dev-backend
    restart: unless-stopped
    environment:
      NODE_ENV: development
      PORT: 4000
      DATABASE_URL: postgres://${POSTGRES_USER:-appuser}:${POSTGRES_PASSWORD:-securepassword}@postgres:5432/${POSTGRES_DB:-master_db}
      REDIS_URL: redis://:${REDIS_PASSWORD:-redispassword}@redis:6379
    ports:
      - "4000:4000"
    volumes:
      - ./backend:/app # Bind mount for real-time host code editing
      - /app/node_modules # Anonymous volume to prevent host node_modules from overwriting container
    networks:
      - app-network
    depends_on:
      postgres:
        condition: service_healthy # Waits for Postgres to be fully operational!
      redis:
        condition: service_healthy

  # ----------------------------------------------------------------------------
  # 4. FRONTEND: Next.js Client Application
  # ----------------------------------------------------------------------------
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile.dev
    container_name: dev-frontend
    restart: unless-stopped
    environment:
      NEXT_PUBLIC_API_URL: http://localhost:4000
    ports:
      - "3000:3000"
    volumes:
      - ./frontend:/app
      - /app/node_modules
      - /app/.next
    networks:
      - app-network
    depends_on:
      - backend

# ------------------------------------------------------------------------------
# NETWORKS & VOLUMES SPECIFICATION
# ------------------------------------------------------------------------------
networks:
  app-network:
    driver: bridge

volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local
```

---

## 6. Under the Hood: Embedded DNS & Bridge Networking

### A. How Docker Embedded DNS Works
When you create a user-defined bridge network in Docker Compose (e.g., `app-network`):
1. Docker provisions an internal virtual switch (bridge) on the host OS.
2. Every container attached to this network is assigned a private virtual IP (e.g., `172.20.0.3`, `172.20.0.4`).
3. Docker injects an internal DNS nameserver running at IP **`127.0.0.11`** into `/etc/resolv.conf` inside every container.
4. When the `backend` container resolves the hostname `postgres:5432`, the embedded DNS server intercepts the query, translates the service name `postgres` to its current container IP (`172.20.0.2`), and connects directly.

### B. Bind Mounts vs. Named Volumes
```
┌──────────────────────────────────────────────┬──────────────────────────────────────────────┐
│ Bind Mount (`./backend:/app`)                │ Named Volume (`postgres_data:/var/lib/...`)  │
├──────────────────────────────────────────────┼──────────────────────────────────────────────┤
│ Maps an exact directory on host laptop.      │ Managed entirely by Docker inside its storage│
│ Any file edited in VS Code reflects inside   │ location (`/var/lib/docker/volumes`).        │
│ container in real time (for hot reloading).  │ Immune to accidental file deletion; maximum  │
│ Slower I/O on macOS/Windows due to FS layer. │ native Linux disk I/O performance.          │
└──────────────────────────────────────────────┴──────────────────────────────────────────────┘
```

---

## 7. Important Rules

1. **Never Use `localhost` for Inter-Container Communication**:
   Inside the `backend` container, `localhost` refers to the `backend` container itself! To connect to PostgreSQL from the backend, you must use the **Docker Compose service name**:
   - ❌ `postgres://user:pass@localhost:5432/db` (Will fail with `ECONNREFUSED`)
   - ✅ `postgres://user:pass@postgres:5432/db` (Resolves via Docker DNS)
2. **Always Use `service_healthy` Startup Conditions**:
   A standard `depends_on: [postgres]` only waits for the PostgreSQL container to *start*, not for the database engine to finish initializing its internal catalogs. Always define a `healthcheck` and use `condition: service_healthy`.
3. **Isolate `node_modules` with Anonymous Volumes**:
   When using a bind mount (`./backend:/app`), your host's local `node_modules` directory will overwrite the container's Linux-native `node_modules`. Adding `- /app/node_modules` creates an isolated container volume that shields container dependencies.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Hardcoding Credentials in Compose Files
```yaml
# ❌ SECURITY ANTI-PATTERN: Hardcoded plaintext secrets
POSTGRES_PASSWORD: "SuperSecretProductionPassword123"
```
**Fix**: Use environment variable interpolation from a git-ignored `.env` file:
```yaml
POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
```

### 2. Losing Database Data on `docker compose down`
Running `docker compose down -v` deletes all attached **named volumes** (`-v` stands for `--volumes`), destroying your local database data.
**Rule**: Use `docker compose down` (without `-v`) to stop and remove containers while preserving persistent database records in named volumes.

### 3. Exposing Internal Database Ports in Production
Mapping ports `5432:5432` on a production cloud server exposes PostgreSQL to the public internet. Port mappings (`ports:`) should only be used in local development or for external-facing web proxies. In production, keep internal backing services on private bridge networks without public port exposure.

---

## 9. Best Practices

- **Provide a Clean `.env.example`**:
  Maintain a checked-in `.env.example` file documenting all default variables needed for Docker Compose to boot cleanly with zero configuration:
  ```bash
  cp .env.example .env
  docker compose up -d
  ```
- **Leverage Docker Compose Overrides (`docker-compose.override.yml`)**:
  Docker Compose automatically merges `docker-compose.yml` with `docker-compose.override.yml`. Keep base service definitions in `docker-compose.yml` and put local developer-specific tweaks (such as exposed debugger ports) in the override file.
- **Run Containers with Resource Limits in Local Compose**:
  Prevent a runaway memory leak in your local Node.js app from freezing your entire laptop by adding resource reservations:
  ```yaml
  deploy:
    resources:
      limits:
        cpus: '1.0'
        memory: 512M
  ```

---

## 10. Performance Considerations

- **macOS / Windows Filesystem Mount Performance**:
  Docker Desktop on macOS runs inside a Linux hypervisor (Virtualization.framework). Heavy bind mounts across thousands of files in `node_modules` can slow down builds. Use **VirtioFS** in Docker Desktop settings and anonymous volumes for `node_modules` to maintain near-native I/O performance.
- **Cache Pre-warming**:
  Run `docker compose build --parallel` to build the frontend and backend service images simultaneously utilizing all available CPU cores.

---

## 11. Security Considerations

- **Separate Networks for Sensitive Backends**:
  Create multiple isolated networks if necessary. For instance, the `frontend` container should never be able to reach `postgres` directly:
  ```yaml
  networks:
    frontend-net: # Only frontend and backend
    backend-net:  # Only backend, postgres, and redis
  ```
- **Read-Only Volume Mounts for Configuration Files**:
  When mounting initialization SQL scripts or Nginx configs into containers, always append `:ro` (read-only) to prevent the container process from tampering with host configuration files:
  ```yaml
  - ./init-db.sql:/docker-entrypoint-initdb.d/init.sql:ro
  ```

---

## 12. Alternatives

| Orchestrator | Primary Use Case | Complexity | Production Suitability |
|---|---|---|---|
| **Docker Compose** | Local Development & Single-Node VPS | Low | Excellent for dev; suitable for small single-server VPS deploys. |
| **Kubernetes (K8s)** | Enterprise Multi-Node Clusters | High | The industry standard for massive auto-scaling multi-cloud fleets. |
| **Docker Swarm** | Lightweight Multi-Node Clustering | Medium | Simpler than K8s, but limited ecosystem and declining adoption. |

---

## 13. Trade-offs

- **Docker Compose for Local Dev vs. Direct Host Execution**:
  Running everything in Docker Compose consumes more RAM and battery than running `npm run dev` directly on the host machine. However, it completely eliminates environment discrepancies and makes onboarding instant for new team members.
- **Health Check Interval Tuning**:
  Setting health check intervals too short (e.g., every 1 second) consumes unnecessary CPU cycles running ping commands. Setting intervals too long (e.g., every 30 seconds) causes dependent services to wait unnecessarily before booting. A 5-second interval represents the optimal balance.

---

## 14. Real-World Usage & Implementation Example

Here is an accompanying **Database Initialization Script** (`init-db.sql`) and a development **Dockerfile** (`backend/Dockerfile.dev`) designed for hot-reloading with Docker Compose.

### A. Database Seed & Schema (`init-db.sql`)
```sql
-- Automatically executed by Postgres container on initial first-time startup
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Insert dummy seed record for local testing
INSERT INTO users (email) 
VALUES ('dev-tester@example.com')
ON CONFLICT (email) DO NOTHING;
```

### B. Development Dockerfile (`backend/Dockerfile.dev`)
```dockerfile
FROM node:20-alpine3.19

WORKDIR /app

# Install nodemon or ts-node-dev globally for live reloading
RUN npm install -g ts-node-dev

COPY package.json package-lock.json ./
RUN npm install

# Note: Source code is mounted dynamically via Docker Compose volume!
EXPOSE 4000

CMD ["ts-node-dev", "--respawn", "--transpile-only", "src/server.ts"]
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: How do two containers communicate with each other in Docker Compose?
**Answer**:
Containers attached to the same user-defined bridge network communicate using **Docker's embedded DNS service** (`127.0.0.11`). Docker assigns each container an internal IP address and automatically maps the Compose **service name** (e.g., `postgres` or `backend`) to that container's IP. A container can connect to another container simply by using the service name as the hostname (e.g., `http://backend:4000`).

### 2. Conceptual: Why does `depends_on` without `condition: service_healthy` often fail in production stacks?
**Answer**:
By default, `depends_on` only waits for the dependency container to transition into the `RUNNING` state (i.e., the container process has spawned). However, complex services like PostgreSQL take 5 to 15 seconds to allocate shared memory buffers, replay WAL logs, and open TCP listening sockets. If the application starts immediately, it attempts to query the database before PostgreSQL is ready to accept connections, crashing with `ECONNREFUSED`. Configuring a health check with `condition: service_healthy` ensures dependent containers wait until the database answers queries successfully.

### 3. Implementation: How do you achieve hot-reloading for code changes when running a Node.js app inside Docker Compose?
**Answer**:
By configuring a **Bind Mount** and an **Anonymous Volume**:
1. Mount the local source code into the container: `- ./backend:/app`. Any file edited on the host is instantly visible inside the container.
2. Prevent the host machine's `node_modules` from overwriting container dependencies by adding an anonymous volume: `- /app/node_modules`.
3. Use a file watcher like `ts-node-dev` or `nodemon` inside the container `CMD` to restart the server process whenever changes are detected on the mounted volume.

### 4. Debugging: A developer runs `docker compose up` and gets: `Bind for 0.0.0.0:5432 failed: port is already allocated`. How do you diagnose and fix this?
**Answer**:
1. **Diagnosis**: Another process on the host machine is already listening on port 5432 (most commonly a native PostgreSQL service installed on the host OS or another running Docker container).
2. **Investigation Command**:
   - macOS / Linux: `lsof -i :5432` or `sudo netstat -nlp | grep 5432`
   - Windows: `netstat -ano | findstr :5432`
3. **Fix**:
   - Stop the local host service (`brew services stop postgresql` or `systemctl stop postgresql`).
   - Alternatively, change the host-exposed port in `docker-compose.yml` to an unallocated port (e.g., `"5433:5432"`). The internal port remains 5432, eliminating conflicts while preserving internal container DNS resolution.

### 5. Scenario: How do you completely reset a corrupted local Docker database back to a clean initial state?
**Answer**:
1. Stop the running containers and delete the associated persistent volumes:
   ```bash
   docker compose down -v
   ```
2. The `-v` flag instructs Docker to remove the named volume (e.g., `postgres_data`).
3. Re-run `docker compose up -d`. Docker creates a fresh, empty volume and triggers the `/docker-entrypoint-initdb.d/init.sql` script to recreate and seed the database tables from scratch.

### 6. Advanced: What is the difference between a Docker Host Network and a Docker Bridge Network?
**Answer**:
- **Bridge Network**: The default virtualized software bridge. Containers receive their own private network namespace, distinct IP addresses, and isolated port space. Container ports are inaccessible from the host unless explicitly published (`ports: - "3000:3000"`).
- **Host Network (`network_mode: "host"`)**: Removes network isolation between the container and the Docker host. The container shares the host's exact IP address and network interfaces; a container listening on port 3000 binds directly to port 3000 on the host machine without any network address translation (NAT). Host mode offers slightly higher network throughput, but sacrifices port isolation and multi-container name resolution.

---

## 16. Coding Questions & Practical Challenges

1. **Compose Configuration Validator**: Write a Node.js script using `yaml` to parse `docker-compose.yml`, verify that every service has a health check, and assert that no plaintext passwords are hardcoded in the `environment:` section.
2. **Wait-For-Port Bash Script**: Write a resilient `wait-for-it.sh` shell script that uses `nc -z` (netcat) to poll a database host and port, exiting with success when ready or timing out after 30 seconds.
3. **Multi-Environment Compose Inheritance**: Create a base `docker-compose.base.yml` and two overlay files (`docker-compose.dev.yml` and `docker-compose.prod.yml`) demonstrating how to override environment variables and volume mounts cleanly.

---

## 17. Common Interview Traps

- **Trap 1: Believing `expose:` and `ports:` do the same thing in Docker Compose**: `ports:` publishes container ports to the host machine (accessible by your browser or host tools). `expose:` only makes ports accessible to other containers on the same Docker network without opening them to the host laptop.
- **Trap 2: Assuming containers on different bridge networks can communicate by default**: Docker isolates bridge networks. If Service A is on `frontend-net` and Service B is on `backend-net`, they cannot communicate unless a container is explicitly connected to both networks.
- **Trap 3: Using `docker compose up` without `-d` in scripts**: Running without detached mode (`-d`) attaches the terminal session to container logs; terminating the terminal session shuts down the entire multi-service stack.

---

## 18. Revision Summary

- **Docker Compose**: Multi-container declarative orchestration driven by `docker-compose.yml`.
- **Core Components**: Services (containers), Networks (virtual switches), Volumes (persistent storage).
- **Embedded DNS**: Docker resolves Compose service names (e.g., `postgres`, `redis`) to internal container IPs automatically.
- **Startup Integrity**: Combine `healthcheck:` with `depends_on: { condition: service_healthy }` to avoid startup race conditions.
- **Local Development Flow**: Use bind mounts for application source code, anonymous volumes for `/app/node_modules`, and named volumes for persistent database files.

---

## 19. Quick Reference Cheatsheet

```bash
# Core Docker Compose CLI Commands (v2 Syntax)
docker compose up -d                # Start all services in background
docker compose down                 # Stop and remove containers and networks
docker compose down -v              # DANGER: Stop and destroy all database volumes
docker compose logs -f backend      # Stream logs for specific service
docker compose ps                   # Inspect running service status & health
docker compose exec postgres psql -U appuser -d master_db # Open interactive DB shell
docker compose restart backend      # Restart individual service
docker compose build --no-cache     # Rebuild container images from scratch
```
