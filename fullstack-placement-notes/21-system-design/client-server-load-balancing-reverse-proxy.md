# Load Balancing & Reverse Proxies: Layer 4 vs. Layer 7, Algorithms & Traffic Routing Architecture

## 1. What is it?
A **Load Balancer (LB)** is a core networking and infrastructure component that distributes incoming client network traffic across a pool of backend servers (the "server farm" or upstream cluster). It prevents any single server from becoming a performance bottleneck, ensures high availability by routing traffic away from failed nodes, and enables seamless horizontal scaling.

A **Reverse Proxy** is an intermediary server that sits in front of one or more origin web servers, intercepting client requests. While a forward proxy acts on behalf of *clients* (e.g., hiding client identity or corporate filtering), a reverse proxy acts on behalf of *servers*, handling TLS/SSL termination, gzip/brotli compression, rate limiting, centralized logging, and static asset caching.

Modern load balancing operates across two distinct layers of the OSI model:
1. **Layer 4 (Transport Layer - TCP/UDP)**: Routes traffic based on IP address and TCP/UDP port without inspecting the packet's application-layer contents (e.g., AWS NLB, HAProxy TCP mode).
2. **Layer 7 (Application Layer - HTTP/HTTPS/gRPC)**: Inspects the actual HTTP content (headers, cookies, URL paths, request bodies) to make intelligent routing decisions (e.g., Nginx, Envoy, AWS ALB, Traefik).

```
                 Incoming Internet Traffic (Port 443 HTTPS)
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 4 Load Balancer (AWS NLB / Maglev / IPVS)                        │
│ - Ultra-fast packet forwarding based on TCP:IP (Millions QPS)          │
│ - Distributes to Layer 7 Reverse Proxy Pool                            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
       ┌────────────────────────────┴────────────────────────────┐
       ▼                                                         ▼
┌──────────────────────────────┐          ┌──────────────────────────────┐
│ Layer 7 Reverse Proxy (Nginx)│          │ Layer 7 Reverse Proxy (Nginx)│
│ - TLS Termination & HTTP/2   │          │ - TLS Termination & HTTP/2   │
│ - Inspects HTTP Host / Path  │          │ - Inspects HTTP Host / Path  │
└──────────────┬───────────────┘          └──────────────┬───────────────┘
               │                                         │
     ┌─────────┴─────────┐                     ┌─────────┴─────────┐
     ▼                   ▼                     ▼                   ▼
┌──────────┐        ┌──────────┐          ┌──────────┐        ┌──────────┐
│ /api/auth│        │ /api/pay │          │ /api/auth│        │ /api/pay │
│ Node Srv1│        │ Go Srv 1 │          │ Node Srv2│        │ Go Srv 2 │
└──────────┘        └──────────┘          └──────────┘        └──────────┘
```

---

## 2. Why does it exist?
Without reverse proxies and load balancers, modern cloud architectures cannot operate:

1. **Eliminating the Single Point of Failure (SPOF)**: If clients connect directly to a single IP address (`203.0.113.1`), and that server's hardware fails or crashes, the entire platform goes offline. An LB automatically performs **health checks** and removes dead instances within seconds.
2. **Horizontal Scalability**: A single server maxes out at its physical hardware limits (vertical scaling). An LB allows you to scale from 2 servers to 2,000 servers behind a single stable public IP/DNS entry.
3. **SSL/TLS Offloading (Termination)**: Cryptographic TLS handshakes (RSA/ECDSA encryption, key exchange) consume significant CPU cycles. Terminating TLS at the reverse proxy boundary offloads the cryptographic burden, allowing backend application servers to communicate over fast, plaintext HTTP within private VPC subnets.
4. **Content-Based Routing**: Directing `/api/v1/video/stream` to GPU-optimized instances and `/api/v1/auth` to lightweight Node.js instances requires Layer 7 URL path inspection.

---

## 3. Mental Model: The Airport Check-in Hall
Think of Load Balancing as **Airport Terminal Operations**:
- **Layer 4 Load Balancer (The Traffic Cop on the Access Road)**: Directs cars to Terminal A or Terminal B based purely on whether they are taxis or buses (packet headers / port numbers). The cop does not look inside passengers' suitcases.
- **Layer 7 Reverse Proxy & Load Balancer (The Airline Check-in Attendant)**: Opens the customer's passport and ticket (inspects HTTP headers and cookies):
  - If First Class ticket (VIP user header) $\rightarrow$ Fast-Track Lane.
  - If Economy ticket $\rightarrow$ Standard Lanes.
  - Balances passengers across 20 open check-in desks using **Least Connections** (sending the passenger to the shortest physical queue).

---

## 4. Basic Example: Production Nginx Reverse Proxy & Load Balancer Configuration

```nginx
# /etc/nginx/nginx.conf

events {
    worker_connections 4096; # High concurrency worker configuration
}

http {
    # 1. Define the upstream backend server pool
    upstream backend_nodes {
        # Load balancing algorithm: Least Connections
        least_conn;

        # Health checks and failure limits
        server 10.0.1.10:3000 max_fails=3 fail_timeout=10s weight=3; # Higher weight for powerful server
        server 10.0.1.11:3000 max_fails=3 fail_timeout=10s weight=1;
        server 10.0.1.12:3000 backup; # Backup server, receives traffic ONLY if both primary nodes die!
    }

    server {
        listen 80;
        server_name api.platform.com;
        return 301 https://$host$request_uri; # Force HTTPS
    }

    server {
        listen 443 ssl http2;
        server_name api.platform.com;

        # TLS Termination Configuration
        ssl_certificate /etc/letsencrypt/live/api.platform.com/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/api.platform.com/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;

        # Security Headers
        add_header X-Frame-Options "DENY" always;
        add_header X-Content-Type-Options "nosniff" always;

        location / {
            # Proxy traffic to upstream pool
            proxy_pass http://backend_nodes;

            # Forward real client identity to backend Node.js apps
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # Timeouts
            proxy_connect_timeout 5s;
            proxy_read_timeout 30s;
        }
    }
}
```

---

## 5. Real-World Production Example: Layer 4 vs. Layer 7 Comparison & AWS Architecture

In modern hyperscale cloud setups (like AWS), L4 and L7 are chained together to achieve both raw packet throughput and intelligent routing.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Feature / Attribute    │ Layer 4 (e.g. AWS NLB)   │ Layer 7 (e.g. AWS ALB)     │
├────────────────────────┼──────────────────────────┼────────────────────────────┤
│ OSI Layer              │ Transport Layer (TCP/UDP)│ Application Layer (HTTP/gRPC)│
│ Routing Data Used      │ Source IP, Port, Protocol│ URL path, Host, Cookies,   │
│                        │                          │ HTTP Headers, Query params │
│ Latency Overhead       │ Ultra-Low (< 1 ms)       │ Moderate (2 ms - 5 ms)     │
│ Throughput             │ Tens of Millions QPS     │ Hundreds of Thousands QPS  │
│ TLS Termination        │ Optional (TCP Pass-thru) │ Native (inspects decrypted)│
│ WebSocket Support      │ Raw TCP stream passthru  │ Native HTTP Upgrade support│
│ Path-Based Routing     │ IMPOSSIBLE (Cannot see)  │ Supported (`/api/*` vs `/*`)│
│ Cost per Million Reqs  │ Cheaper (raw packets)    │ Slightly higher (CPU deep) │
└────────────────────────┴──────────────────────────┴────────────────────────────┘
```

---

## 6. Under the Hood: The 6 Core Load Balancing Algorithms

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. Round Robin:                                                        │
│ Requests are distributed sequentially: Node 1 -> Node 2 -> Node 3.     │
│ Best for: Homogeneous servers handling requests of equal duration.     │
├────────────────────────────────────────────────────────────────────────┤
│ 2. Weighted Round Robin:                                               │
│ Higher-spec machines receive proportionally more requests (Weight 3    │
│ receives 3 requests for every 1 sent to Weight 1).                     │
├────────────────────────────────────────────────────────────────────────┤
│ 3. Least Connections:                                                  │
│ Routes incoming request to the server with the fewest active TCP/HTTP  │
│ connections. Best for: Long-running requests (file uploads, WebSockets)│
├────────────────────────────────────────────────────────────────────────┤
│ 4. Weighted Least Connections:                                         │
│ Accounts for both active connections and server hardware capacity.     │
├────────────────────────────────────────────────────────────────────────┤
│ 5. IP Hash:                                                            │
│ Hash(client_ip) % N determines server index.                           │
│ Provides "sticky" routing for unauthenticated sessions, but uneven     │
│ distribution behind corporate NAT proxies.                             │
├────────────────────────────────────────────────────────────────────────┤
│ 6. Consistent Hashing (Virtual Nodes):                                 │
│ Distributes requests along a 360-degree hash ring. When a server node  │
│ is added or removed, only 1/N of keys are re-mapped. Ideal for caches! │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Important Rules

1. **Keep Application Servers Stateless**: Never rely on "Sticky Sessions" (session affinity) as an architectural shortcut to preserve local in-memory session data. If Server 3 crashes, all users pinned to Server 3 lose their shopping carts. Store session state in an external Redis cluster so *any* server can handle any request.
2. **Configure Active and Passive Health Checks**:
   - **Active Health Check**: The load balancer proactively sends a `GET /health` probe every 5 seconds. If 3 consecutive probes fail, the server is marked unhealthy.
   - **Passive Health Check**: If a server returns an HTTP 502/504 error during real traffic, the LB immediately shifts that specific user to another node and increments the error counter.
3. **Always Forward Proxy Headers**: Backend servers running behind a reverse proxy will see the proxy's private subnet IP (e.g., `10.0.1.5`) as the client IP unless you forward headers:
   `X-Forwarded-For: <client_ip>, <proxy_ip>` and `X-Forwarded-Proto: https`.
4. **Prevent Connection Pool Starvation via Keep-Alive**: Enable HTTP Keep-Alive between the reverse proxy and upstream application servers (`proxy_http_version 1.1; proxy_set_header Connection "";`). This reuses established TCP connections, eliminating the latency of opening a new TCP three-way handshake for every incoming request.
5. **Mitigate Slowloris Attacks at the Proxy**: Configure aggressive client header and body timeouts (`client_header_timeout 5s; client_body_timeout 10s;`) at the reverse proxy to prevent malicious slow-drip connections from exhausting worker sockets.

---

## 8. Common Mistakes & Anti-Patterns

### 1. The Corporate NAT IP Hash Collapse
Using simple `IP Hash` load balancing for public web applications. If 5,000 employees at a major enterprise access your application through a single corporate NAT gateway (sharing one public IP address), the IP Hash algorithm routes all 5,000 users to the exact same backend server, overloading it while other servers sit idle.

### 2. Missing Keep-Alive Upstream Connections
```nginx
# ❌ INEFFICIENCY: Forces a new TCP handshake for every upstream request
location / {
    proxy_pass http://backend_pool;
    # Missing proxy_http_version 1.1!
}
```
Under high traffic, opening 10,000 new TCP sockets per second between Nginx and Node.js exhausts local OS ephemeral ports (`TIME_WAIT` socket starvation).

### 3. Synchronous Health Check Blocking
Writing a `/health` endpoint that runs a heavy `SELECT COUNT(*) FROM all_tables` database query. Under high load, the health check itself times out, causing the load balancer to falsely declare healthy application servers as dead and kill the entire cluster.

---

## 9. Best Practices

- **Graceful Draining (Connection Draining / Deregistration Delay)**: When deploying a new version of your application, instruct the load balancer to stop sending *new* requests to old servers while allowing *in-flight* requests up to 30–60 seconds to finish before terminating the instance.
- **Circuit Breaking at the Proxy**: If a backend service fails with >50% errors over a 10-second window, the reverse proxy immediately returns an instantaneous fallback response or HTTP 503 without forwarding traffic, allowing the backend service to recover.

---

## 10. Performance Considerations

- **Epoll & Non-Blocking Event Loops**: Modern reverse proxies (Nginx, Envoy, HAProxy) use OS event notification systems (`epoll` on Linux, `kqueue` on BSD/macOS). A single Nginx worker process can comfortably maintain 50,000+ concurrent idle keep-alive connections with minimal RAM (~2.5MB per 1,000 connections).
- **Direct Server Return (DSR)**: In massive streaming or CDN applications, Layer 4 LBs use Direct Server Return: client request packets pass through the LB, but the server's massive outbound video response packets bypass the LB and route directly back to the client, preventing the LB from becoming a bandwidth bottleneck.

---

## 11. Security Considerations

- **Request Smuggling Defense**: Discrepancies between how a reverse proxy and an upstream backend server interpret HTTP `Content-Length` vs. `Transfer-Encoding: chunked` headers enable **HTTP Request Smuggling** attacks. Modern Nginx and AWS ALB versions automatically normalize and drop ambiguous headers.

---

## 12. Load Balancer Technology Comparison Matrix

| Technology | Layer | Primary Strength | Typical Placement |
| :--- | :--- | :--- | :--- |
| **AWS NLB** | Layer 4 | Millions QPS, ultra-low latency, static IP | Internet Ingress Gateway |
| **AWS ALB** | Layer 7 | Path/Host routing, Cognito auth, WAF | Application Service Gateway |
| **Nginx** | Layer 7 | Fast, lightweight reverse proxy, caching | Ingress controller / VM proxy |
| **HAProxy** | L4 & L7 | Industry gold-standard TCP/HTTP throughput | High-performance enterprise mesh |
| **Envoy** | Layer 7 | Dynamic service discovery, gRPC, observability | Kubernetes Sidecar / Service Mesh |

---

## 13. Trade-offs

- **Layer 4 vs. Layer 7**: Layer 4 gives you maximum raw throughput with microsecond latency, but you cannot inspect cookies, terminate TLS, or perform path routing. Layer 7 gives you total routing intelligence and header manipulation, at the cost of parsing overhead and higher CPU consumption.
- **Sticky Sessions vs. Statelessness**: Sticky sessions simplify legacy stateful applications, but prevent even load distribution and cause user disconnects during auto-scaling events.

---

## 14. Real-World Usage Case Studies

1. **Netflix**: Uses AWS Route 53 DNS load balancing at the global level, routing users to the nearest AWS region, followed by Zuul / Envoy Layer 7 edge gateways to route millions of concurrent streaming requests to backend microservices.
2. **GitHub**: Uses **GLB Director** (GitHub Load Balancer), a custom Layer 4 load balancer built on DPDK and IPVS that provides zero-downtime failover and Direct Server Return (DSR) for Git SSH and HTTPS traffic.

---

## 15. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: What is the primary difference between a Forward Proxy and a Reverse Proxy?**
> **Answer**: A **Forward Proxy** sits in front of *clients* and acts on their behalf (e.g., hiding client IP addresses, bypassing firewalls, or filtering employee internet access). A **Reverse Proxy** sits in front of *backend servers* and acts on their behalf (e.g., intercepting incoming client requests, balancing load across server pools, terminating TLS/SSL, and caching static responses).

### Tier 2: Conceptual
**Q: What is the difference between Layer 4 and Layer 7 load balancing?**
> **Answer**:
> - **Layer 4 (Transport Layer)**: Inspects only the network and transport layer headers (source/destination IP address and TCP/UDP port). It does not decrypt or inspect the application payload. It is blazing fast and handles millions of packets per second.
> - **Layer 7 (Application Layer)**: Decrypts and inspects the application-level HTTP/HTTPS payload (URL paths, HTTP headers, cookies, query parameters). It enables intelligent routing (e.g., routing `/api/orders` to Order Service and `/api/users` to User Service), but incurs slightly higher CPU and latency overhead.

### Tier 3: Implementation
**Q: How do you configure an Nginx reverse proxy so that the backend Node.js application receives the user's real public IP address instead of Nginx's private IP?**
> **Answer**: Set the `X-Forwarded-For` and `X-Real-IP` proxy headers:
> ```nginx
> proxy_set_header X-Real-IP $remote_addr;
> proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
> proxy_set_header Host $host;
> ```
> In Express, configure `app.set('trust proxy', 1);` to automatically read the verified client IP from these headers.

### Tier 4: Debugging
**Q: A backend server running behind a load balancer is running out of available file descriptors and logging `TIME_WAIT` socket errors under load. What is the cause?**
> **Answer**: The load balancer or reverse proxy is establishing a **new TCP connection** for every single incoming request to the upstream server instead of reusing connections. When connections are rapidly closed, TCP sockets enter the `TIME_WAIT` state for 60 seconds to catch delayed packets, consuming all available ephemeral ports.
> **Fix**: Enable HTTP Keep-Alive connections between the reverse proxy and upstream servers (e.g., `keepalive 64;` and `proxy_http_version 1.1;` in Nginx).

### Tier 5: Scenario
**Q: How would you design a load-balancing architecture for a high-traffic gaming service that requires both low-latency UDP packet streams for game physics and HTTPS for in-game purchases?**
> **Answer**:
> 1. Use an **AWS Network Load Balancer (NLB) at Layer 4**:
>    - Listen on UDP Port 7777: Route raw UDP game packets directly to dedicated C++ game server instances using Direct Server Return (DSR) for sub-millisecond latency.
>    - Listen on TCP Port 443: Route HTTPS traffic to an **Application Load Balancer (ALB) or Nginx cluster at Layer 7**.
> 2. The Layer 7 ALB terminates TLS, validates JWT authentication headers, and routes `/shop/*` to the e-commerce checkout microservices.

### Tier 6: Advanced
**Q: What is Consistent Hashing, and why is it vastly superior to Modulo Hashing (`hash(key) % N`) when load balancing requests to a caching tier?**
> **Answer**:
> In simple modulo hashing (`hash(key) % N` where $N$ is the number of servers), if one server crashes or a new server is added ($N$ changes to $N-1$ or $N+1$), **nearly 100% of all keys are remapped to different servers**. This triggers a catastrophic global cache wipe and overloads the primary database.
> **Consistent Hashing** maps both servers and keys to a continuous 360-degree circular hash ring. Each key is assigned to the next server found moving clockwise on the ring. When a server is added or removed, **only $K/N$ keys are remapped** (where $K$ is total keys and $N$ is total servers). Using virtual nodes (replicas of each server on the ring) ensures perfectly uniform distribution and prevents hot spots.

---

## 16. Coding Question: Implement Consistent Hashing with Virtual Nodes in TypeScript

### Problem
Implement a production-grade `ConsistentHashRing` class in TypeScript that:
1. Adds and removes server nodes dynamically.
2. Uses virtual nodes (replicas) to ensure uniform key distribution.
3. Maps an arbitrary client request key (e.g., User ID) to the correct server node in $O(\log M)$ time using binary search.

### Solution

```typescript
import crypto from 'crypto';

export class ConsistentHashRing {
  private virtualReplicas: number;
  private ring: Map<number, string>; // Hash -> Server Node
  private sortedHashes: number[];

  constructor(virtualReplicas: number = 100) {
    this.virtualReplicas = virtualReplicas;
    this.ring = new Map();
    this.sortedHashes = [];
  }

  private hash(key: string): number {
    const md5 = crypto.createHash('md5').update(key).digest();
    // Read 32-bit unsigned integer from first 4 bytes of MD5
    return md5.readUInt32BE(0);
  }

  public addNode(node: string): void {
    for (let i = 0; i < this.virtualReplicas; i++) {
      const virtualNodeKey = `${node}#vnode_${i}`;
      const hash = this.hash(virtualNodeKey);
      this.ring.set(hash, node);
      this.sortedHashes.push(hash);
    }
    this.sortedHashes.sort((a, b) => a - b);
  }

  public removeNode(node: string): void {
    for (let i = 0; i < this.virtualReplicas; i++) {
      const virtualNodeKey = `${node}#vnode_${i}`;
      const hash = this.hash(virtualNodeKey);
      this.ring.delete(hash);
    }
    this.sortedHashes = this.sortedHashes.filter((h) => this.ring.has(h));
  }

  public getNode(key: string): string | null {
    if (this.sortedHashes.length === 0) return null;

    const hash = this.hash(key);

    // Binary search for first hash in ring >= key hash (Clockwise traversal)
    let low = 0;
    let high = this.sortedHashes.length - 1;

    if (hash > this.sortedHashes[high]) {
      // Wrap around the circle to the first node
      return this.ring.get(this.sortedHashes[0])!;
    }

    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.sortedHashes[mid] >= hash) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    return this.ring.get(this.sortedHashes[low])!;
  }
}

// ==========================================
// Demonstration
// ==========================================
const ring = new ConsistentHashRing(100);
ring.addNode('Server_A');
ring.addNode('Server_B');
ring.addNode('Server_C');

console.log('User 101 routes to:', ring.getNode('usr_101'));
console.log('User 202 routes to:', ring.getNode('usr_202'));

// Remove Server_B: Only keys assigned to B are redistributed; A and C remain unchanged!
ring.removeNode('Server_B');
```

---

## 17. Common Interview Traps

- **Trap 1**: Thinking DNS load balancing can replace hardware/software load balancers.
  *Gotcha*: DNS round-robin cannot perform fast health checks. Browsers and local ISPs aggressively cache DNS records (TTL). If a server dies, traffic will continue hitting the dead server for minutes or hours until DNS caches expire.
- **Trap 2**: Putting SSL termination on every individual microservice container.
  *Gotcha*: Managing certificates, renewals, and cryptographic overhead on 500 individual Docker containers is an operational nightmare. Terminate TLS at the edge load balancer / ingress controller.
- **Trap 3**: Believing Least Connections is always better than Round Robin.
  *Gotcha*: For fast, uniform REST API requests (<5ms), the synchronization overhead of tracking active connection states across a load balancer cluster can actually make Least Connections slightly slower than stateless Round Robin.

---

## 18. Revision Summary

- **Layer 4 vs. Layer 7**:
  - *Layer 4*: High throughput, packet-level routing based on IP/Port (TCP/UDP); cannot see HTTP headers.
  - *Layer 7*: Content-based routing based on URLs, headers, cookies; handles TLS termination and compression.
- **Algorithms**: Round Robin (simple), Least Connections (unequal/long requests), Consistent Hashing (caching tiers).
- **Reverse Proxy Core Tasks**: SSL termination, health checking, header forwarding (`X-Forwarded-For`), load balancing.
- **State Rule**: Never use sticky sessions for business state; keep servers completely stateless.

---

## 19. Quick Reference

| Concept | OSI Layer | Common Implementation | Key Advantage |
| :--- | :--- | :--- | :--- |
| **Layer 4 LB** | Transport | AWS NLB / HAProxy / IPVS | Millions QPS, sub-ms latency |
| **Layer 7 LB** | Application | AWS ALB / Nginx / Envoy | Path/Host routing, TLS offload |
| **Round Robin** | - | Default Algorithm | Equal distribution, zero overhead |
| **Least Conn** | - | `least_conn` in Nginx | Ideal for WebSockets & uploads |
| **Consistent Hash**| - | Hash Ring with Virtual Nodes | Remaps only $1/N$ keys on scaling |
| **Health Check** | - | Active HTTP probe (`/health`) | Auto-removes dead nodes in <5s |
