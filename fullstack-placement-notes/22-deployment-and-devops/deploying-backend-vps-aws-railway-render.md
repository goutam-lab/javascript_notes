# Deploying Backend Services: VPS, AWS (EC2/ECS), Railway & Render

## 1. What is it?
Deploying a Node.js / Express backend service requires hosting a long-running, stateful or stateless process that listens on a network port, maintains persistent database connection pools, handles asynchronous background workloads, and scales horizontally under varying traffic demands.

Backend hosting models span three primary paradigms:
1. **Raw Virtual Private Servers (VPS / AWS EC2 / DigitalOcean Droplets)**: Unmanaged virtual machines providing full `root` access. Engineers manually configure the operating system, Linux systemd services, reverse proxies (Nginx), firewalls, and deployment scripts.
2. **Platform-as-a-Service (PaaS: Railway, Render, Fly.io)**: Fully managed developer platforms. Connect a Git repository or Dockerfile, and the platform automates container builds, private networking, SSL certificates, database provisioning, and auto-deployments on Git push.
3. **Container Orchestrators (AWS ECS Fargate, GCP Cloud Run, Kubernetes)**: Cloud-native container platforms. Run containers without managing underlying VMs (serverless containers), with deep integration into enterprise VPCs, IAM roles, Application Load Balancers, and auto-scaling target groups.

```
                    BACKEND DEPLOYMENT SPECTRUM
                    
 Low Control, Zero Ops                                     Full Control, High Ops
 [ PaaS: Railway / Render ] ──► [ Serverless: AWS ECS Fargate ] ──► [ VPS: AWS EC2 / Linux ]
 ──────────────────────────────────────────────────────────────────────────────────────────
 • Push-to-deploy Git            • Container-native                • Full root access (SSH)
 • Managed TLS & DNS             • VPC & private subnets           • Manual OS updates
 • Automated DBs & Redis         • IAM roles & ALB routing         • Manual Nginx & PM2
 • Fast MVP time-to-market       • Enterprise security & scale     • Lowest raw hardware cost
```

---

## 2. Why does it exist?
Backend deployment choices balance **operational complexity**, **developer velocity**, and **cost**:

1. **The Startup Speed Problem**: An early-stage startup spending 3 weeks configuring AWS VPCs, subnets, NAT Gateways, and ECS task definitions burns valuable runway. A PaaS (Railway / Render) allows launching in 10 minutes.
2. **The "Outgrowing the PaaS" Problem**: As traffic scales to millions of users, PaaS bandwidth and RAM markups become expensive ($500/mo on PaaS vs. $80/mo on AWS or Hetzner). Furthermore, enterprise compliance (HIPAA, SOC2, PCI-DSS) requires custom private VPC topologies, data residency controls, and IAM least-privilege policies that only cloud infrastructure (AWS/GCP) provides.
3. **High Availability & Zero Downtime**: Deploying an API on a single bare VPS means a kernel panic, hardware failure, or server restart takes your entire platform offline. AWS ECS Fargate distributes containers across multiple physical Availability Zones (AZs) behind an Application Load Balancer (ALB).

---

## 3. Mental Model
Think of backend deployment options like transportation:
- **PaaS (Railway / Render)** is like taking a taxi or Uber: you do not worry about maintenance, gas, or changing tires; you just get in and arrive at your destination, but paying by the mile is expensive for cross-country road trips.
- **Serverless Containers (AWS ECS Fargate)** is like an automated corporate bus fleet: fuel, routing, and passenger capacity automatically adapt based on line demand; strict safety regulations apply.
- **Bare VPS (AWS EC2 / DigitalOcean)** is like buying and maintaining your own truck: you have complete freedom to modify the engine and haul whatever you want, but if the transmission breaks at 3 AM on the highway, you are the mechanic holding the wrench.

---

## 4. Basic Example: PaaS Configuration via `render.yaml`

Modern managed platforms use declarative infrastructure files:

```yaml
# render.yaml (Declarative Multi-Service Blueprint)
services:
  # 1. Backend Web API Service
  - type: web
    name: core-api
    env: node
    plan: standard
    buildCommand: npm ci && npm run build
    startCommand: node dist/server.js
    healthCheckPath: /health/ready
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 10000
      - key: DATABASE_URL
        fromDatabase:
          name: production-postgres
          property: connectionString
      - key: REDIS_URL
        fromService:
          type: redis
          name: production-redis
          property: connectionString

  # 2. Asynchronous Background Queue Worker
  - type: worker
    name: queue-worker
    env: node
    buildCommand: npm ci && npm run build
    startCommand: node dist/worker.js
    envVars:
      - key: NODE_ENV
        value: production
      - key: REDIS_URL
        fromService:
          type: redis
          name: production-redis
          property: connectionString

# 3. Managed Database Instances
databases:
  - name: production-postgres
    plan: standard
    databaseName: master_db
    user: dbadmin
```

---

## 5. Real Example: Enterprise AWS ECS Fargate Multi-AZ Architecture

For production enterprise applications, the backend runs in **private subnets** across two Availability Zones behind an Application Load Balancer (ALB):

```
                   AWS ECS FARGATE PRODUCTION TOPOLOGY
                   
                       Internet Gateway (IGW)
                                 │
                                 ▼ (Public HTTPS Traffic: Port 443)
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ PUBLIC SUBNET (US-East-1a)                  PUBLIC SUBNET (US-East-1b)      │
 │  ┌───────────────────────────────────────────────────────────────────────┐  │
 │  │ AWS Application Load Balancer (ALB) - TLS 1.3 Termination (ACM SSL)   │  │
 │  └───────────────────────────────────┬───────────────────────────────────┘  │
 │                                      │                                      │
 │  ┌───────────────────────┐           │           ┌───────────────────────┐  │
 │  │ NAT Gateway (AZ-1a)   │           │           │ NAT Gateway (AZ-1b)   │  │
 └──┴───────────┬───────────┴───────────┼───────────┴───────────┬───────────┴──┘
                │                       │                       │
                ▼                       ▼                       ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ PRIVATE APPLICATION SUBNET (No Direct Public Internet Access)               │
 │                                                                             │
 │  ┌────────────────────────┐                      ┌────────────────────────┐ │
 │  │ ECS Task (Node.js Pod) │ ◄── ALB Target Group ──► ECS Task (Node.js Pod) │ │
 │  │ Availability Zone: 1a  │                      │ Availability Zone: 1b  │ │
 │  └───────────┬────────────┘                      └───────────┬────────────┘ │
 └──────────────┼───────────────────────────────────────────────┼──────────────┘
                │                                               │
                ▼                                               ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ PRIVATE DATABASE SUBNET                                                     │
 │                                                                             │
 │  ┌─────────────────────────────────┐   Streaming    ┌─────────────────────┐ │
 │  │ Amazon RDS PostgreSQL (Master)  │ ─────────────► │ RDS (Read Replica)  │ │
 │  └─────────────────────────────────┘  Replication   └─────────────────────┘ │
 │  ┌─────────────────────────────────┐                                        │
 │  │ Amazon ElastiCache Redis Cluster│                                        │
 │  └─────────────────────────────────┘                                        │
 └─────────────────────────────────────────────────────────────────────────────┘
```

### AWS ECS Task Definition (JSON Snippet)
```json
{
  "family": "backend-api-task",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "1024",
  "memory": "2048",
  "executionRoleArn": "arn:aws:iam::123456789012:role/ecsTaskExecutionRole",
  "taskRoleArn": "arn:aws:iam::123456789012:role/backendApiAppRole",
  "containerDefinitions": [
    {
      "name": "api",
      "image": "123456789012.dkr.ecr.us-east-1.amazonaws.com/core-api:sha-7f9a2",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 4000,
          "hostPort": 4000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT", "value": "4000" }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/db-url"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/core-api",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:4000/health/live || exit 1"],
        "interval": 15,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 30
      }
    }
  ]
}
```

---

## 6. Under the Hood: Rolling Deployments & Target Group Deregistration

How does an AWS Application Load Balancer (ALB) or PaaS achieve zero-downtime rolling updates without dropping in-flight user requests?

```
                ZERO-DOWNTIME ROLLING DEPLOYMENT LIFECYCLE
                
 1. Launch New Tasks       2. Health Check Validation   3. Deregistration & Drain
 ┌──────────────────────┐  ┌────────────────────────┐   ┌────────────────────────┐
 │ ALB routes 100% of   │  │ New Task v2 boots up.  │   │ Old Task v1 enters     │
 │ traffic to Task v1.  │  │ ALB probes `/health/ ready`│ Deregistration Delay.  │
 │                      │  │ every 5s.              │   │ No new requests sent.  │
 │ Task v2 is spawned   │  │ Once 2 checks pass,    │   │ Waits 30s to finish    │
 │ concurrently.        │  │ ALB begins routing 50% │   │ in-flight requests.    │
 │                      │  │ traffic to v2.         │   │ Task v1 terminated.    │
 └──────────────────────┘  └────────────────────────┘   └────────────────────────┘
```
- **Deregistration Delay (Connection Draining)**: When Task v1 is replaced, the load balancer stops routing *new* requests to it, but keeps existing TCP connections alive for a configured draining period (typically 30 seconds) to allow in-flight database transactions and HTTP responses to complete cleanly.

---

## 7. Important Rules

1. **Bind to `0.0.0.0`, Never `127.0.0.1` Inside Containers**:
   Inside a Docker container, binding your server to `localhost` (`127.0.0.1`) restricts connections strictly to internal container loopback. External requests from the host or load balancer will be rejected with `Connection Refused`. Always bind to `0.0.0.0`:
   ```typescript
   app.listen(PORT, '0.0.0.0', () => { ... });
   ```
2. **Never Place Databases in Public Subnets**:
   Production database instances (PostgreSQL, MySQL, Redis) must reside exclusively in **Private Database Subnets** without an Internet Gateway route. Application servers reach the database through internal VPC routing; unauthorized internet traffic has zero physical route to the database.
3. **Always Separate Web API Services from Background Worker Queues**:
   Do not run CPU-intensive video encoding or bulk email queues inside the same process handling HTTP requests. If a background job consumes 100% CPU, the HTTP server cannot process health checks or API requests. Deploy separate services: a Web Service and a Worker Service.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Hardcoding Credentials in Task Definitions or Git Repos
Embedding raw database passwords in Dockerfiles or ECS JSON definitions.
**Fix**: Use **AWS Secrets Manager** or **AWS Systems Manager Parameter Store**. Inject secrets directly into container environment variables at launch time using IAM execution roles.

### 2. Missing Connection Pool Tuning for Container Auto-Scaling
If each Node.js container allocates a connection pool of 20 database connections, auto-scaling from 5 to 50 containers creates $50 \times 20 = 1,000$ active connections, crashing PostgreSQL's connection limits (`max_connections = 100`).
**Fix**: Deploy **PgBouncer** or **AWS RDS Proxy** in front of PostgreSQL to pool and multiplex thousands of application connections over a stable pool of 50 physical database sockets.

---

## 9. Best Practices

- **Distinct Liveness vs. Readiness Probes**:
  - `/health/live`: Checks if the Node.js process is alive (returns HTTP 200). If it fails, restart the container.
  - `/health/ready`: Checks if the database connection pool and Redis are connected and able to process traffic. If it fails, remove the container from the load balancer target group without restarting it.
- **NAT Gateway Cost Awareness**:
  In AWS, outbound traffic from private subnets passes through a NAT Gateway ($\approx \$32/\text{month}$ per AZ + $\$0.045/\text{GB}$ data processing fee). For heavy internal AWS communication (e.g., uploading to S3 or pulling from ECR), configure **VPC Endpoints** (PrivateLink) to route traffic over internal AWS backbones, saving thousands of dollars in NAT data transfer fees.

---

## 10. Performance Considerations

- **VPC Peering & Network Latency**: Ensure your application cluster and database cluster reside in the same AWS Region and Availability Zones. Cross-AZ network traffic introduces $\approx 1-2\text{ms}$ of latency; cross-region traffic introduces $50-100\text{ms}$ of latency.
- **Node.js Memory Limit Alignment with Container RAM**:
  V8 defaults to a max heap size of $\approx 1.4\text{GB}$ on 64-bit systems. If your container limit is 512MB, V8 may attempt to allocate 700MB before triggering garbage collection, causing the Linux OOM killer to terminate the container. Always set:
  ```bash
  NODE_OPTIONS="--max-old-space-size=400"
  ```
  to ensure V8 garbage collection runs before hitting the 512MB container ceiling.

---

## 11. Security Considerations

- **Security Group Chaining**:
  Configure AWS Security Groups with strict least-privilege references:
  - ALB Security Group: Ingress 443 from `0.0.0.0/0`.
  - ECS Container Security Group: Ingress 4000 **only from the ALB Security Group ID** (blocks any traffic bypassing the load balancer).
  - RDS Database Security Group: Ingress 5432 **only from the ECS Container Security Group ID**.
- **IAM Least Privilege**: Never use root IAM keys. Assign an **ECS Task Role** granting the application only the exact permissions needed (e.g., `s3:PutObject` on a single specific bucket).

---

## 12. Alternatives

| Platform | Best Suited For | Operational Overhead | Monthly Cost (Baseline) |
|---|---|---|---|
| **Railway / Render** | MVPs, Startups, Indie Hackers | Near Zero | $5 – $50 / mo |
| **AWS ECS Fargate** | Growing Tech Startups, Scale-ups | Medium | $50 – $300 / mo |
| **Self-Hosted VPS (Hetzner / DO)** | Cost-conscious workloads | High | $5 – $40 / mo (Fixed) |
| **Kubernetes (EKS / GKE)** | Large Enterprise Fleets | Very High | $150+ / mo cluster base fee |

---

## 13. Trade-offs

- **PaaS (Railway) vs. Cloud Native (AWS ECS)**:
  Railway offers instant deployment and effortless DX, but costs scale steeply at high bandwidth. AWS ECS requires deep knowledge of networking, IAM, and Terraform, but provides enterprise compliance, custom VPCs, and massive scale discounts.
- **Serverless Containers (Fargate) vs. EC2 Worker Instances**:
  ECS Fargate charges a slight premium per vCPU/RAM hour compared to raw EC2 instances, but completely eliminates the need to patch operating systems, manage AMI images, or size underlying VM clusters.

---

## 14. Real-World Usage & Implementation Example

Here is a production **Express.js Server** configured with dual health probes, graceful shutdown handling, and host-binding guards:

```typescript
// server.ts
import express from 'express';
import http from 'http';
import { Pool } from 'pg';

const app = express();
const PORT = parseInt(process.env.PORT || '4000', 10);
const HOST = '0.0.0.0'; // Mandatory for container deployment!

// Database Connection Pool
const dbPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

let isShuttingDown = false;

// 1. Liveness Probe: Quick check if event loop is running
app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'UP', timestamp: new Date().toISOString() });
});

// 2. Readiness Probe: Verifies database connectivity before accepting ALB traffic
app.get('/health/ready', async (req, res) => {
  if (isShuttingDown) {
    return res.status(503).json({ status: 'DRAINING', message: 'Server is terminating' });
  }

  try {
    // Quick query to confirm DB connection pool health
    await dbPool.query('SELECT 1');
    return res.status(200).json({ status: 'READY', db: 'CONNECTED' });
  } catch (err: any) {
    console.error('[HEALTH CHECK FAILED]: Database unreachable:', err.message);
    return res.status(503).json({ status: 'NOT_READY', db: 'DISCONNECTED', error: err.message });
  }
});

// Primary Business API Route
app.get('/api/v1/orders', async (req, res) => {
  const result = await dbPool.query('SELECT id, total_amount, status FROM orders LIMIT 20');
  res.json({ orders: result.rows });
});

const server = http.createServer(app);

server.listen(PORT, HOST, () => {
  console.log(`[BOOT] Server listening on http://${HOST}:${PORT} in ${process.env.NODE_ENV} mode.`);
});

// 3. Graceful Shutdown & Connection Draining (for zero-downtime rolling updates)
function shutdown(signal: string) {
  console.log(`[SHUTDOWN] Received ${signal}. Initiating connection draining...`);
  isShuttingDown = true;

  // Stop accepting new HTTP requests from ALB
  server.close(async () => {
    console.log('[SHUTDOWN] HTTP listener closed. Draining database connection pool...');
    try {
      await dbPool.end();
      console.log('[SHUTDOWN] Database pool closed successfully. Exiting cleanly.');
      process.exit(0);
    } catch (err: any) {
      console.error('[SHUTDOWN ERROR]: Error closing DB pool:', err.message);
      process.exit(1);
    }
  });

  // Hard timeout: Force kill if connections take longer than 25 seconds
  setTimeout(() => {
    console.error('[SHUTDOWN] Forced shutdown after timeout.');
    process.exit(1);
  }, 25000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: What does it mean to bind a server to `0.0.0.0` vs `127.0.0.1`?
**Answer**:
- `127.0.0.1` (loopback): Binds the server exclusively to the local virtual loopback interface. Only processes running inside the exact same operating system or container can connect.
- `0.0.0.0` (all interfaces): Instructs the operating system to listen on every available network interface (including Ethernet, Wi-Fi, and virtual container bridges). Inside a Docker container or cloud VM, binding to `0.0.0.0` is mandatory so external traffic forwarded by load balancers or Docker port mappings can reach the application.

### 2. Conceptual: Explain the difference between Public Subnets and Private Subnets in an AWS VPC.
**Answer**:
- **Public Subnet**: Associated with a route table containing a route to an **Internet Gateway (IGW)** (`0.0.0.0/0 -> igw-xxxx`). Resources located here (such as Application Load Balancers or Bastion hosts) have public IP addresses and can send/receive traffic directly to/from the internet.
- **Private Subnet**: Has no route to an Internet Gateway. Resources here (such as backend API containers and databases) only have private IP addresses (`10.0.x.x`). They are completely inaccessible from the public internet. Outbound internet access (e.g., to pull packages or call third-party APIs) is routed through a **NAT Gateway** located in a public subnet.

### 3. Implementation: How do you configure rolling zero-downtime updates in AWS ECS?
**Answer**:
1. Configure ECS service deployment settings:
   - `minimumHealthyPercent = 100%`
   - `maximumPercent = 200%`
2. When deploying a new image, ECS does not kill existing Task v1. Instead, it launches Task v2 concurrently alongside v1 (scaling to 200%).
3. The Application Load Balancer executes periodic HTTP health checks against `/health/ready` on Task v2.
4. Once Task v2 passes health checks, the ALB begins routing traffic to it.
5. The ALB initiates **Connection Draining (Deregistration Delay)** on Task v1 (waiting 30s for active requests to finish), sends `SIGTERM`, and terminates Task v1. Traffic was never interrupted.

### 4. Debugging: A newly deployed backend service on Render or AWS ECS fails to start and enters an infinite reboot loop (`CrashLoop`). How do you diagnose it?
**Answer**:
1. **Inspect Application Logs**: Check CloudWatch Logs or Render deployment logs for runtime crash traces (e.g., `ZodError: missing required environment variable DATABASE_URL`).
2. **Check Port Binding Mismatch**: Ensure the application listens on the port specified by the platform's `PORT` environment variable. If the platform expects port 10000 but the app hardcoded port 3000, the platform's health check will time out.
3. **Verify Host Interface**: Check if the code bound to `localhost` instead of `0.0.0.0`.
4. **Inspect Health Check Path**: Verify that the platform's configured health check endpoint (e.g., `/health`) returns HTTP 200 and does not require an unauthorized JWT token.

### 5. Scenario: When should an engineering team migrate from Railway/Render to AWS ECS or EKS?
**Answer**:
A migration is justified when:
1. **Cost Crossover**: Monthly PaaS resource bills (RAM, CPU, egress bandwidth) exceed $\approx \$1,000 - \$2,000/\text{mo}$, where running on AWS with reserved instances or Savings Plans provides 60% cost reductions.
2. **Security & Regulatory Compliance**: Enterprise customers require SOC2, HIPAA, or PCI-DSS certifications necessitating custom private VPCs, AWS WAF, AWS GuardDuty, and static egress IP whitelisting.
3. **Complex Architecture**: The system requires low-latency private integration with specialized cloud services (e.g., AWS SQS FIFO, Kinesis, Amazon OpenSearch, Aurora Serverless).

### 6. Advanced: Why is PgBouncer or AWS RDS Proxy required when running auto-scaling containerized backend services?
**Answer**:
PostgreSQL allocates a dedicated OS process for every open client connection, consuming $\approx 10\text{MB}$ of server RAM per connection and incurring process context-switching overhead. A standard PostgreSQL instance cannot support more than 200–500 direct connections.
When a containerized backend auto-scales to 100 pods, each running 20 pool connections, the database faces 2,000 connection requests, leading to connection timeouts and crashes. **PgBouncer / RDS Proxy** acts as an intermediary connection pooler using **Transaction Pooling**: it holds thousands of application client connections open cheaply, multiplexing them across a small, fixed pool of 50 physical PostgreSQL connections, protecting database health.

---

## 16. Coding Questions & Practical Challenges

1. **Database Health Check Middleware**: Write a robust TypeScript health check endpoint in Express that tests PostgreSQL, Redis, and disk space availability, returning HTTP 200 if all pass or HTTP 503 with individual service failure breakdowns.
2. **Graceful Connection Drainer**: Implement a custom Node.js HTTP server wrapper that tracks all active socket connections in a `Set<Socket>`, destroys idle keep-alive sockets immediately upon `SIGTERM`, and waits up to 20 seconds for in-flight requests to complete.
3. **Terraform ECS Service Definition**: Write a minimal HCL Terraform configuration that provisions an AWS ECS Fargate Service, an Application Load Balancer Target Group, and a CloudWatch Log Group.

---

## 17. Common Interview Traps

- **Trap 1: Putting the database in a public subnet to make debugging easier**: Exposing your production database port 5432 to the internet (even with a password) invites brute-force credential stuffing and zero-day database exploit attacks. Use a Bastion host with SSH port forwarding or AWS SSM Session Manager to access private databases securely.
- **Trap 2: Ignoring NAT Gateway data transfer costs**: In AWS, sending terabytes of video or analytics traffic through a NAT Gateway generates massive surprise bills. Use VPC Endpoints (S3 Gateway Endpoints are free!) to bypass NAT gateways for AWS internal services.
- **Trap 3: Not setting a memory limit on the Node.js V8 process**: Leaving Node.js without `--max-old-space-size` inside a 512MB container causes the container to be killed by the Linux kernel OOM killer instead of allowing Node.js to trigger garbage collection.

---

## 18. Revision Summary

- **Hosting Spectrum**: PaaS (Railway/Render) for speed & developer velocity $\rightarrow$ Serverless Containers (AWS ECS Fargate) for enterprise scale, compliance, and custom VPCs $\rightarrow$ Bare VPS for lowest raw hardware cost.
- **Networking Guardrails**:
  - Load balancers reside in Public Subnets; APIs and databases reside in Private Subnets.
  - Always bind backend HTTP listeners to `0.0.0.0`.
- **Zero-Downtime Releases**: Rolling updates require health check probes (`/health/ready`), target group deregistration delays (30s draining), and graceful shutdown listeners (`SIGTERM`).
- **Scale Protection**: Use RDS Proxy / PgBouncer to prevent auto-scaling backend pods from exhausting PostgreSQL database connection pools.

---

## 19. Quick Reference Cheatsheet

```bash
# Node.js Container Memory Allocation Rule of Thumb
# If container RAM is 512MB, allocate ~75% to V8 heap:
NODE_OPTIONS="--max-old-space-size=384"

# Inspecting Listening Network Interfaces
netstat -tulpn | grep LISTEN
# Output showing correct 0.0.0.0 binding:
# tcp 0 0 0.0.0.0:4000 0.0.0.0:* LISTEN 1/node

# Standard ECS Fargate Rolling Update Settings
MinimumHealthyPercent: 100%
MaximumPercent:        200%
DeregistrationDelay:   30 seconds
```
