# Reverse Proxies: Nginx, SSL Termination & Certbot Automation

## 1. What is it?
A **Reverse Proxy** is an intermediary edge server positioned between the public internet and private backend application servers. When client browsers make requests, they connect directly to the reverse proxy (on standard public ports 80 and 443). The reverse proxy terminates the TLS connection, enforces security filters, applies rate limiting, compresses responses, and forwards the cleaned request to internal backend application servers (running on private ports like 3000 or 4000).

**Nginx** (pronounced "Engine-X") is the industry-standard, high-performance, asynchronous, event-driven HTTP server and reverse proxy. Combined with **Certbot** (the automated client for **Let's Encrypt**), Nginx provides automated, free, renewing TLS/SSL encryption for modern web platforms.

```
                    NGINX REVERSE PROXY ARCHITECTURE
                    
  [ Client Browsers Globally ] 
                │
                ▼ (Public HTTPS: Port 443 / HTTP: Port 80)
 ┌─────────────────────────────────────────────────────────────┐
 │ NGINX REVERSE PROXY & EDGE GATEWAY                          │
 │ • SSL / TLS 1.3 Termination (Let's Encrypt Certbot)         │
 │ • HTTP to HTTPS Auto-Redirect                               │
 │ • Gzip / Brotli Compression                                 │
 │ • Rate Limiting (`limit_req_zone`: 10 req/s per IP)         │
 │ • Direct High-Speed Static Asset Serving (`/public/`)       │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                │ Internal Forwarding (`proxy_pass`)
                                │ Headers: X-Real-IP, X-Forwarded-For, X-Forwarded-Proto
                                │
        ┌───────────────────────┴───────────────────────┐
        ▼ (Private Port 3000)                           ▼ (Private Port 4000)
 ┌─────────────────────────────┐                 ┌─────────────────────────────┐
 │ Next.js Frontend App        │                 │ Express.js Backend API      │
 │ (Node.js Process)           │                 │ (Node.js Process)           │
 └─────────────────────────────┘                 └─────────────────────────────┘
```

---

## 2. Why does it exist?
Exposing a Node.js / Express application directly to the public internet on port 80/443 without a reverse proxy is an operational and architectural anti-pattern:

1. **Slow Client Attacks (Slowloris)**: Node.js is single-threaded. If an attacker opens 1,000 slow connections that send 1 byte every 10 seconds, Node.js exhausts its socket pool and crashes. Nginx’s asynchronous, event-driven architecture buffers slow clients effortlessly.
2. **Heavy Cryptographic TLS Overhead**: Performing asymmetric TLS 1.3 handshakes (RSA/ECDSA encryption) consumes significant CPU cycles. Offloading SSL termination to Nginx frees the Node.js event loop to focus entirely on application business logic.
3. **Inefficient Static File Serving**: Serving static images, CSS, and JavaScript files through Express (`express.static`) consumes Node.js event loop cycles and memory buffers. Nginx leverages the Linux kernel’s zero-copy `sendfile` syscall, serving static assets directly from disk to network interface cards at near-wire speeds.
4. **Multiple Applications on a Single IP**: A cloud VPS has one public IP address. You cannot bind both an Express API (port 443) and a Python service (port 443) to the same port. Nginx routes traffic based on the requested domain or path (`api.domain.com` $\rightarrow$ port 4000; `domain.com` $\rightarrow$ port 3000).

---

## 3. Mental Model
Think of Nginx like the security reception desk of a high-rise office building:
- The public never walks directly into employee cubicles (the Node.js backend).
- Everyone enters through the main revolving door (Ports 80/443).
- The security guard verifies badges (SSL/TLS certificate verification), scans bags for weapons (Rate limiting & WAF filtering), and hands visitors a visitor pass (Forwarded headers).
- The guard then directs the visitor to the exact elevator taking them to the 3rd floor (Express API) or 4th floor (Next.js frontend).

---

## 4. Basic Example: Minimal Nginx Reverse Proxy Configuration

```nginx
# /etc/nginx/sites-available/default
server {
    listen 80;
    server_name api.mycompany.com;

    location / {
        # Forward all traffic to internal Node.js server
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 5. Real Example: Production Enterprise Nginx Configuration with SSL, Rate Limiting & WebSockets

Here is an enterprise-grade Nginx configuration file (`/etc/nginx/conf.d/production.conf`) featuring security headers, Gzip compression, WebSocket support, rate limiting, and Let's Encrypt SSL:

```nginx
# ------------------------------------------------------------------------------
# 1. UPSTREAM BACKEND DEFINITIONS
# ------------------------------------------------------------------------------
upstream backend_api {
    # Distribute traffic across PM2 worker ports or container instances
    server 127.0.0.1:4000 max_fails=3 fail_timeout=10s;
    server 127.0.0.1:4001 max_fails=3 fail_timeout=10s;
    keepalive 32; # Maintain 32 persistent keep-alive connections to upstream
}

# ------------------------------------------------------------------------------
# 2. RATE LIMITING ZONES (Mitigates DDoS and Brute Force)
# ------------------------------------------------------------------------------
# Allocate 10MB shared memory zone to track client IPs; limit to 10 requests/second
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
limit_req_status 429;

# ------------------------------------------------------------------------------
# 3. HTTP TO HTTPS AUTO-REDIRECT
# ------------------------------------------------------------------------------
server {
    listen 80;
    listen [::]:80;
    server_name api.mycompany.com;

    # Let's Encrypt ACME challenge endpoint for Certbot renewals
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # Redirect all HTTP requests permanently to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

# ------------------------------------------------------------------------------
# 4. PRIMARY SECURE HTTPS SERVER BLOCK
# ------------------------------------------------------------------------------
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.mycompany.com;

    # SSL Certificates (Automated by Certbot)
    ssl_certificate /etc/letsencrypt/live/api.mycompany.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.mycompany.com/privkey.pem;

    # Modern TLS Security Configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;

    # OCSP Stapling (Speeds up SSL handshake verification)
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate /etc/letsencrypt/live/api.mycompany.com/chain.pem;
    resolver 8.8.8.8 1.1.1.1 valid=300s;

    # Security Headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;

    # Client Request Body Limits (Uploads)
    client_max_body_size 25M;

    # Gzip Dynamic Compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript application/rss+xml image/svg+xml;

    # Static Assets Direct Serving (Bypasses Node.js completely!)
    location /static/ {
        alias /var/www/core-api/public/;
        expires 365d;
        access_log off;
        add_header Cache-Control "public, max-age=31536000, immutable";
        try_files $uri =404;
    }

    # Core Reverse Proxy to Upstream Express Cluster
    location / {
        # Apply rate limiting: allow burst of 20 requests with nodelay
        limit_req zone=api_limit burst=20 nodelay;

        proxy_pass http://backend_api;
        proxy_http_version 1.1;

        # WebSocket Connection Upgrade Support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Forwarded Identity & Network Headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Upstream Connection Timeouts
        proxy_connect_timeout 5s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
        proxy_buffering on;
    }
}
```

---

## 6. Under the Hood: Event-Driven Architecture & the Epoll Syscall

### A. How Nginx Handles 100,000+ Concurrent Sockets
Unlike Apache HTTP Server (which spawns a heavy operating system thread per connection), Nginx uses an **Asynchronous, Non-Blocking, Event-Driven Architecture**:

```
                       NGINX PROCESS & EVENT MODEL
                       
                     ┌─────────────────────────────┐
                     │ Nginx Master Process (Root) │ (Reads config, binds ports)
                     └──────────────┬──────────────┘
                                    │ Spawns 1 Worker per CPU core
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
 ┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
 │ Nginx Worker 1      │ │ Nginx Worker 2      │ │ Nginx Worker 3      │
 │ (Single Thread)     │ │ (Single Thread)     │ │ (Single Thread)     │
 │ • Linux `epoll` loop│ │ • Linux `epoll` loop│ │ • Linux `epoll` loop│
 └─────────────────────┘ └─────────────────────┘ └─────────────────────┘
            │                       │                       │
 ┌──────────┴───────────────────────┴───────────────────────┴──────────┐
 │ Operating System Kernel Network Sockets (epoll event notification)  │
 └─────────────────────────────────────────────────────────────────────┘
```
1. Each Nginx worker runs an infinite event loop powered by the Linux kernel’s **`epoll`** mechanism (or `kqueue` on BSD/macOS).
2. The OS kernel notifies the Nginx worker *only* when a socket has data ready to read or write.
3. An idle TCP connection consumes virtually zero CPU and only $\approx 2.5\text{KB}$ of memory in Nginx, allowing a single 2GB RAM server to hold over 100,000 idle connections simultaneously (conquering the C10K problem).

---

## 7. Important Rules

1. **Configure `trust proxy` in Express**:
   When behind an Nginx reverse proxy, Express sees all incoming requests originating from IP `127.0.0.1` (the proxy's local address). You **must** enable `trust proxy` in Express:
   ```typescript
   app.set('trust proxy', 1); // Trust first hop reverse proxy
   ```
   Without this, `req.ip` will always return `127.0.0.1`, breaking rate limiters and IP-based geo-blocking!
2. **Always Run `nginx -t` Before Reloading**:
   Never execute `systemctl restart nginx` blindly. A typo or misplaced semicolon in `nginx.conf` will crash Nginx, taking all hosted websites down instantly. Always test the syntax first:
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```
3. **Configure `client_max_body_size`**:
   Nginx defaults to a maximum upload body size of **1 Megabyte** (`client_max_body_size 1m`). If users attempt to upload a 2MB image or avatar, Nginx intercepts the request and returns `HTTP 413 Request Entity Too Large` before the request ever reaches Node.js. Increase this limit in your `server` or `location` block.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Missing Forwarded Protocol (`X-Forwarded-Proto`)
If Nginx terminates SSL but fails to pass `proxy_set_header X-Forwarded-Proto $scheme;`, Express thinks the connection is plain HTTP (`req.secure === false`). If your application enforces HTTPS redirects, an **infinite redirect loop** occurs: Express redirects to HTTPS, Nginx terminates SSL and forwards via HTTP, Express redirects again.

### 2. Forgetting WebSocket Connection Upgrade Headers
Attempting to connect a Socket.io or native WebSocket client through Nginx without:
```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```
results in Nginx stripping the HTTP `Upgrade` header, causing WebSocket handshakes to fail with `Error during WebSocket handshake: Unexpected response code: 200` or `400 Bad Request`.

---

## 9. Best Practices

- **Automate SSL Issuance with Certbot**:
  Use Certbot’s official Nginx plugin to automatically obtain certificates and configure renewal cron timers:
  ```bash
  sudo certbot --nginx -d api.mycompany.com --agree-tos -m admin@mycompany.com --redirect
  ```
- **Verify Automated Certbot Renewals**:
  Certbot installs a systemd timer (`certbot.timer`) that runs twice daily. Verify the renewal process works with a dry run:
  ```bash
  sudo certbot renew --dry-run
  ```
- **Enable HTTP/2 (`listen 443 ssl http2;`)**:
  HTTP/2 enables multiplexing multiple requests over a single TCP connection, header compression (HPACK), and eliminates head-of-line blocking for frontend static assets.

---

## 10. Performance Considerations

- **Nginx Upstream Connection Keep-Alive**:
  By default, Nginx opens a new TCP connection to the upstream Node.js backend for *every incoming request*, closing it immediately afterward. Adding `keepalive 32;` inside the `upstream` block maintains persistent open sockets to Node.js, eliminating internal TCP handshake latency.
- **Buffer Tuning for High Throughput**:
  Enable `proxy_buffering on;`. Nginx reads the entire response from Node.js rapidly, frees the Node.js event loop to process other requests, and streams the buffered response back to slow mobile clients at their own pace.

---

## 11. Security Considerations

- **Disable Server Tokens (`server_tokens off;`)**:
  By default, Nginx appends its version number to the `Server` HTTP response header and default error pages (`Server: nginx/1.18.0`). Attackers use version numbers to target known CVE vulnerabilities. Add `server_tokens off;` to suppress version leakage.
- **Block Common Exploit Probes**:
  Drop traffic seeking hidden files, Git repositories, or WordPress admin panels:
  ```nginx
  location ~ /\. {
      deny all;
      access_log off;
      log_not_found off;
  }
  ```

---

## 12. Alternatives

| Solution | Best Suited For | Key Differentiator |
|---|---|---|
| **Nginx** | General-purpose reverse proxy & static hosting | Industry-standard speed, massive ecosystem, low memory. |
| **Traefik** | Dynamic Docker & Kubernetes microservices | Automatic container service discovery without manual config reload. |
| **Caddy** | Zero-config modern web server | Automated HTTPS by default via Let's Encrypt out of the box. |
| **HAProxy** | Dedicated Layer 4 & Layer 7 Load Balancing | Unmatched raw load-balancing throughput and stats telemetry. |

---

## 13. Trade-offs

- **Nginx vs. Cloud Managed Load Balancers (AWS ALB / Cloudflare)**:
  An AWS ALB requires zero server maintenance, auto-scales infinitely, and integrates natively with ACM SSL certificates, but costs $\approx \$20 - \$30/\text{mo}$ plus bandwidth fees. Nginx on a $5/mo VPS provides identical routing flexibility, custom caching, and rate limiting at a fraction of the cost, but requires manual OS patching and configuration maintenance.
- **Compression Overhead vs. Network Bandwidth**:
  Setting `gzip_comp_level 9` achieves maximum compression but consumes excessive CPU. Level 5 or 6 provides 95% of the compression benefits with only 20% of the CPU cost.

---

## 14. Real-World Usage & Implementation Example

Here is a complete setup script showing how to provision Nginx, install Certbot, and generate SSL certificates on an Ubuntu Linux server:

```bash
#!/usr/bin/env bash
# setup-nginx-ssl.sh
set -euo pipefail

DOMAIN="api.mycompany.com"
ADMIN_EMAIL="admin@mycompany.com"

echo "==> 1. Updating APT repositories and installing Nginx..."
sudo apt update
sudo apt install -y nginx certbot python3-certbot-nginx

echo "==> 2. Verifying Nginx service is running..."
sudo systemctl enable nginx
sudo systemctl start nginx

echo "==> 3. Configuring UFW Firewall to allow HTTP & HTTPS..."
sudo ufw allow 'Nginx Full'
sudo ufw status

echo "==> 4. Obtaining and installing Let's Encrypt SSL certificate via Certbot..."
# The --nginx plugin reads your server block, requests the cert, and configures SSL automatically!
sudo certbot --nginx \
  --non-interactive \
  --agree-tos \
  --redirect \
  --email "${ADMIN_EMAIL}" \
  -d "${DOMAIN}"

echo "==> 5. Testing Nginx configuration syntax..."
sudo nginx -t

echo "==> 6. Reloading Nginx with new SSL parameters..."
sudo systemctl reload nginx

echo "==> 7. Verifying automated SSL renewal systemd timer..."
sudo systemctl status certbot.timer

echo "✅ SUCCESS: HTTPS reverse proxy active for https://${DOMAIN}!"
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: What is the fundamental difference between a Forward Proxy and a Reverse Proxy?
**Answer**:
- **Forward Proxy**: Sits in front of a group of **client devices** (e.g., inside a corporate office network). It hides client identities, restricts employee outbound browsing, and caches outgoing web requests. The internet sees the proxy's IP, not the individual client's IP.
- **Reverse Proxy**: Sits in front of a group of **backend origin servers**. It hides server identities, terminates SSL encryption, balances traffic across backend instances, and shields applications from direct internet exposure. The client thinks it is communicating directly with the origin.

### 2. Conceptual: Why must you configure `app.set('trust proxy', 1)` in Express when running behind Nginx?
**Answer**:
When Nginx proxies a request to Express via `proxy_pass http://127.0.0.1:4000`, the immediate TCP connection originates from the local machine (`127.0.0.1`). 
By default, Express reads `req.ip` directly from the TCP socket connection address. Therefore, every single user request appears to originate from `127.0.0.1`. 
Enabling `app.set('trust proxy', 1)` instructs Express to trust the first hop upstream proxy and parse the **`X-Forwarded-For`** HTTP header, correctly restoring the real client's public IP address for rate limiters, session stores, and audit logs.

### 3. Implementation: How does Let's Encrypt / Certbot verify domain ownership before issuing a free SSL certificate?
**Answer**:
Certbot uses the **ACME (Automated Certificate Management Environment)** protocol, typically via the **HTTP-01 Challenge**:
1. Certbot contacts Let's Encrypt CA stating: "I want an SSL certificate for `api.mycompany.com`".
2. Let's Encrypt generates a unique cryptographic token and instructs Certbot to make it available at `http://api.mycompany.com/.well-known/acme-challenge/<token>`.
3. Certbot writes this token file to disk or modifies Nginx configuration temporarily to serve it.
4. Let's Encrypt sends an HTTP GET request to that exact URI over the public internet. If the retrieved token matches the challenge token, Let's Encrypt verifies you control the domain’s DNS and signs the SSL certificate.

### 4. Debugging: A user encounters `502 Bad Gateway` when trying to access your API through Nginx. What does this mean and how do you fix it?
**Answer**:
A `502 Bad Gateway` error means **Nginx is running successfully, but the upstream backend server it tried to connect to failed to respond or refused the connection**.
1. **Diagnosis**: Check Nginx error logs: `sudo tail -n 50 /var/log/nginx/error.log`.
2. Look for `connect() failed (111: Connection refused) while connecting to upstream`.
3. **Common Causes**:
   - The Node.js application crashed or is not running (`pm2 status` or `systemctl status node-api`).
   - The Node.js application is listening on a different port than what Nginx configured (e.g., app is on 3000, Nginx is proxying to 4000).
   - The Node.js application is bound to a specific IP that Nginx cannot reach.
4. **Fix**: Restart the backend service and verify it is actively listening with `netstat -tulpn | grep LISTEN`.

### 5. Scenario: What is OCSP Stapling and why should it be enabled in Nginx?
**Answer**:
When a browser connects via HTTPS, it must verify that the server's SSL certificate has not been revoked by the Certificate Authority (CA). 
- Without OCSP Stapling, the user's browser must open an additional network connection to the CA's OCSP server, introducing 50–200ms of latency during the initial page load.
- With **OCSP Stapling** (`ssl_stapling on;`), Nginx periodically queries the CA in the background, obtains a cryptographically timestamped revocation status proof, and "staples" this proof directly to the initial TLS handshake response. The browser verifies revocation instantly without contacting third-party CA servers.

### 6. Advanced: How does Nginx's `sendfile` directive optimize static file downloads compared to application-level serving?
**Answer**:
Traditional application-level file serving (e.g., via Express) requires 4 context switches and 2 buffer copies:
1. Disk $\rightarrow$ OS Kernel buffer (read)
2. Kernel buffer $\rightarrow$ Application memory space (context switch)
3. Application memory $\rightarrow$ Socket buffer (write / context switch)
4. Socket buffer $\rightarrow$ Network Interface Card (NIC)

When Nginx enables `sendfile on;`, it uses the Linux kernel's **zero-copy `sendfile()` system call**. The operating system transfers data directly from the disk page cache to the Network Interface Card buffer inside kernel space, completely bypassing user-space application memory. This eliminates CPU context switches and memory copies, delivering static files at maximum physical disk/network throughput.

---

## 16. Coding Questions & Practical Challenges

1. **Nginx Upstream Load Balancer**: Write an Nginx configuration snippet that balances traffic across 3 Node.js backend servers using the `least_conn` (least connections) algorithm with active health check parameters.
2. **Reverse Proxy Header Auditor**: Write an Express middleware in TypeScript that verifies incoming requests contain valid `X-Forwarded-For` and `X-Forwarded-Proto` headers, throwing a 400 Bad Request error if accessed directly bypassing the reverse proxy.
3. **Automated Certbot Renewal Verification Script**: Write a Bash cron script that tests SSL certificate expiration date using `openssl s_client -connect`, triggering an alert email if fewer than 15 days remain before expiration.

---

## 17. Common Interview Traps

- **Trap 1: Believing Nginx caching eliminates the need for Redis**: Nginx caching is excellent for caching entire HTTP responses (e.g., GET `/api/products`), but it cannot handle dynamic, fine-grained application-level data caching (such as user session objects, database query results, or distributed inventory locks).
- **Trap 2: Placing rate limiting behind an un-trusted reverse proxy without real-ip configuration**: If your Nginx server is behind Cloudflare or an AWS ALB and you use `$remote_addr` for rate limiting, Nginx will rate limit the Cloudflare IP address, blocking all global users simultaneously! You must configure Nginx's `real_ip` module (`set_real_ip_from`).
- **Trap 3: Using self-signed SSL certificates in production**: Self-signed certificates trigger prominent browser security warnings ("Your connection is not private") that destroy user trust. Let's Encrypt provides free, globally trusted CA certificates via automated Certbot scripts.

---

## 18. Revision Summary

- **Role of Nginx**: Acts as public-facing gateway; terminates SSL/TLS, buffers slow clients, serves static files via zero-copy `sendfile`, and forwards cleaned traffic to private application backends.
- **Essential Proxy Headers**: `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` (paired with Express `trust proxy`).
- **WebSocket Compatibility**: Requires explicit `Upgrade` and `Connection "upgrade"` proxy headers.
- **Certbot Automation**: Uses ACME HTTP-01 challenges to issue and automatically renew free Let's Encrypt SSL certificates.
- **Architecture Efficiency**: Asynchronous `epoll` event loop enables Nginx to manage tens of thousands of concurrent connections with minimal RAM and CPU.

---

## 19. Quick Reference Cheatsheet

```bash
# Nginx Lifecycle Commands
sudo nginx -t                       # Test configuration syntax (CRITICAL)
sudo systemctl reload nginx         # Zero-downtime configuration reload
sudo systemctl restart nginx        # Hard restart
sudo tail -f /var/log/nginx/error.log # Inspect proxy errors (502 diagnostics)

# Certbot SSL Commands
sudo certbot --nginx -d example.com # Auto-issue and configure SSL
sudo certbot renew --dry-run        # Test automatic renewal timer
certbot certificates               # Inspect certificate validity & expiry

# Essential Nginx Proxy Snippet
location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```
