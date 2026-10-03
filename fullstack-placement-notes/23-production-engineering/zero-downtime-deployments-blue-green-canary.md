# Zero-Downtime Deployments: Rolling Updates, Blue-Green & Canary Releases

## 1. What is it?
A **Zero-Downtime Deployment** is an automated software release strategy that promotes a new application version to production without interrupting active user traffic, dropping network connections, or causing service unavailability.

Engineering teams employ three primary architectural strategies to achieve zero downtime:
1. **Rolling Update**: Incrementally replaces old container instances (v1) with new instances (v2) one by one behind a load balancer until the entire fleet is running the new release.
2. **Blue-Green Deployment**: Maintains two complete, identical production environments side-by-side: **Blue** (currently running live v1 traffic) and **Green** (the idle staging environment where v2 is deployed and tested). Once validated, the router or load balancer switches 100% of live traffic from Blue to Green instantly.
3. **Canary Release**: Introduces the new version (v2) to a small, controlled percentage of real production users (e.g., 2% of traffic). Automated monitoring monitors error rates and latency; if metrics remain healthy, the system progressively increases traffic (5% $\rightarrow$ 25% $\rightarrow$ 100%). If anomalies occur, traffic rolls back to v1 instantly.

```
                    ZERO-DOWNTIME DEPLOYMENT STRATEGIES
                    
 1. ROLLING UPDATE (Incremental Pod Replacement)
    [ Load Balancer ] ──► [ Pod v1 (Old) ] [ Pod v1 (Old) ] [ Pod v2 (New) ] [ Pod v2 (New) ]
    • Replaces instances one-by-one; both versions run concurrently during rollout.

 2. BLUE-GREEN DEPLOYMENT (Instant Cutover via Router)
                         ┌──► [ BLUE ENVIRONMENT: 4 Pods v1 (Live)  ] 100% Traffic
    [ Router / ALB Switch]
                         └─── [ GREEN ENVIRONMENT: 4 Pods v2 (Idle)  ] 0% Traffic
    • Test on Green; switch router in 10ms. Instant rollback by switching router back.

 3. CANARY RELEASE (Progressive Metric-Gated Shift)
                         ┌──► [ 95% Traffic: Fleet v1 (Stable Base) ]
    [ Weighted Routing ] 
                         └──► [  5% Traffic: Fleet v2 (Canary Pod)  ]
    • Validates real user telemetry; automated rollback if 5xx error rate spikes > 1%.
```

---

## 2. Why does it exist?
Traditional maintenance-window deployments (e.g., stopping the server at midnight, showing a "Site Under Maintenance" splash page for 30 minutes, updating code, and rebooting) are unacceptable in modern global commerce:

1. **Global 24/7 Operations**: Platforms like Amazon, Uber, or Stripe serve customers across every time zone simultaneously. There is no such thing as an "idle midnight window".
2. **High-Risk "Big Bang" Releases**: Deploying massive changes all at once without progressive verification means a latent bug instantly impacts 100% of your user base.
3. **Slow Rollback Agony**: If a catastrophic bug is discovered in a traditional deployment, rolling back requires re-checking out the old Git commit, re-running the 20-minute CI/CD pipeline, and redeploying, prolonged downtime by 30 minutes. Blue-Green releases roll back in **10 milliseconds** by flipping a router switch.
4. **Database Migration Conflicts**: When deploying code that requires database schema changes, naive updates fail if the database schema is modified before the application code is updated to match.

---

## 3. Mental Model
Think of zero-downtime deployment strategies like civil aviation and bridge engineering:
- **Rolling Update** is like resurfacing a 4-lane highway by closing one lane at a time: traffic continues flowing across the remaining 3 lanes while each lane is paved sequentially.
- **Blue-Green Deployment** is like building a brand-new parallel suspension bridge (Green) right next to the old bridge (Blue): engineers inspect and stress-test the new bridge with dummy trucks; once certified, traffic cones are moved to direct all cars onto the new bridge.
- **Canary Release** is the historic mining practice of bringing a canary into a coal mine: if the canary shows respiratory distress (error rate spikes on 2% of users), miners evacuate immediately (rollback) before humans are harmed.

---

## 4. Basic Example: Kubernetes RollingUpdate Specification

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: core-api
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1        # Can create 1 extra pod above replica count (5 total)
      maxUnavailable: 0  # Zero pods can be unavailable (always >= 4 healthy pods)
  template:
    metadata:
      labels:
        app: core-api
    spec:
      containers:
        - name: api
          image: ghcr.io/company/core-api:v2.0.0
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 4000
            initialDelaySeconds: 5
            periodSeconds: 5
```

---

## 5. Real Example: Enterprise Canary Deployment with Nginx Ingress & Argo Rollouts

In modern Kubernetes environments, **Argo Rollouts** automates progressive canary traffic shifting paired with automated Prometheus metric analysis:

```yaml
# rollout.yaml (Argo Rollouts Canary Specification)
apiVersion: argoproj.io/v1alpha1
kind: Rollout
metadata:
  name: core-api-rollout
spec:
  replicas: 10
  strategy:
    canary:
      # Step-by-step traffic shifting schedule
      steps:
        # Step 1: Send 5% of traffic to Canary version
        - setWeight: 5
        - pause: { duration: 10m } # Pause 10 mins to gather metric telemetry

        # Step 2: Automated Analysis Gate
        - analysis:
            templates:
              - templateName: success-rate-check
            args:
              - name: service-name
                value: core-api-canary

        # Step 3: Promote to 20% traffic
        - setWeight: 20
        - pause: { duration: 30m }

        # Step 4: Promote to 50% traffic
        - setWeight: 50
        - pause: { duration: 15m }

        # Step 5: Full promotion (100% traffic)
  template:
    spec:
      containers:
        - name: core-api
          image: ghcr.io/company/core-api:v2.4.0
          ports:
            - containerPort: 4000
```

### Automated Metric Analysis Template (`analysis.yaml`)
```yaml
apiVersion: argoproj.io/v1alpha1
kind: AnalysisTemplate
metadata:
  name: success-rate-check
spec:
  metrics:
    - name: success-rate
      interval: 1m
      successCondition: result[0] >= 0.99 # Requires 99% HTTP success rate
      failureLimit: 3
      provider:
        prometheus:
          address: http://prometheus:9090
          query: |
            sum(rate(http_requests_total{status!~"5..", service="core-api-canary"}[2m])) 
            / 
            sum(rate(http_requests_total{service="core-api-canary"}[2m]))
```
*Behavior*: If Prometheus detects that the canary’s success rate drops below 99% for 3 consecutive minutes, Argo Rollouts **aborts the deployment instantly and resets traffic back to 100% stable v1**.

---

## 6. Under the Hood: The Database Expand-Contract (Parallel Run) Pattern

The greatest technical challenge of zero-downtime deployments is **Database Schema Evolution**.
During a rolling update or canary release, **Version 1 (Old Code) and Version 2 (New Code) run concurrently and query the exact same database simultaneously**.

If Version 2 renames a database column from `phone` to `phone_number` in a single migration, Version 1 code will immediately crash with `column "phone" does not exist`!

To prevent this, engineers follow the **Expand-Contract (Parallel Run) Pattern** executed across three distinct release cycles:

```
                  THE EXPAND-CONTRACT (PARALLEL RUN) PATTERN
                  
 PHASE 1: EXPAND (Database Migration 1)
 ┌────────────────────────────────────────────────────────┐
 │ Add new column alongside old column:                   │
 │ `ALTER TABLE users ADD COLUMN phone_number VARCHAR;`   │
 └────────────────────────────────────────────────────────┘
                          │
                          ▼
 PHASE 2: PARALLEL RUN (Deploy Application Code v2)
 ┌────────────────────────────────────────────────────────┐
 │ App v2 writes to BOTH columns; reads from new column.  │
 │ App v1 continues reading and writing to old column.    │
 │ (Both application versions operate safely!)            │
 └────────────────────────────────────────────────────────┘
                          │
                          ▼
 PHASE 3: DATA BACKFILL (Asynchronous Migration)
 ┌────────────────────────────────────────────────────────┐
 │ Copy historical records from old column to new:        │
 │ `UPDATE users SET phone_number = phone WHERE ...;`     │
 └────────────────────────────────────────────────────────┘
                          │
                          ▼
 PHASE 4: CONTRACT (Database Migration 2 - Two weeks later)
 ┌────────────────────────────────────────────────────────┐
 │ Once 100% of pods run v2 and v1 is retired:            │
 │ `ALTER TABLE users DROP COLUMN phone;`                 │
 └────────────────────────────────────────────────────────┘
```

---

## 7. Important Rules

1. **Rule of Backward & Forward Database Compatibility**:
   Every database schema migration must be compatible with both the newly deployed version *and* the previously running version. Never rename or delete a column in the same deployment that introduces code changes.
2. **Sticky Sessions for Canary Releases**:
   If an e-commerce checkout flow spans 3 sequential pages (`/cart` $\rightarrow$ `/shipping` $\rightarrow$ `/payment`), a user assigned to the Canary version (v2) must remain routed to v2 for their entire session. Bouncing a user between v1 and v2 across page reloads causes state mismatches and session drops. Use cookie-based canary hashing (`set-cookie: canary=true`).
3. **Automate Rollback Triggers**:
   Never rely on a human engineer staring at a Grafana graph to manually click "Rollback" at 3 AM. Canary controllers must evaluate automated health gates (error rate, p99 latency) and trigger automated rollback within 60 seconds of anomaly detection.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Incompatible Synchronous Schema Migrations
```sql
-- ❌ FATAL DEPLOYMENT ERROR:
-- Running this while old pods are active crashes production immediately!
ALTER TABLE orders DROP COLUMN user_id;
ALTER TABLE orders ADD COLUMN customer_uuid UUID NOT NULL;
```
**Why it fails**: Old pods executing active checkout requests will attempt `INSERT INTO orders (user_id)` and crash with fatal database constraint errors. Always follow Expand-Contract.

### 2. Under-Provisioning Blue-Green Environments
Running Blue on 10 nodes, but provisioning Green on only 2 nodes to "save money during testing". When traffic is switched 100% from Blue to Green, the Green environment is immediately overwhelmed by the 5x load spike, crashing the entire service. Green must match Blue's exact production capacity.

---

## 9. Best Practices

- **Synthetic Canary Smoke Tests**:
  Before routing real customer traffic to a canary instance, have an automated synthetic runner (Playwright headless script) execute critical business paths (`/login`, `/add-to-cart`, `/checkout`) against the canary internal endpoint.
- **Dark Launches via Feature Flags**:
  Separate code deployment from feature activation using feature flag platforms (LaunchDarkly / Unleash). Deploy code with the new feature wrapped in a flag (`if (flags.isEnabled('new_checkout'))`). Even if the code is running on 100% of servers, the feature can be toggled on for 1% of internal beta testers with zero redeployment.

---

## 10. Performance Considerations

- **Traffic Shifting via Layer 7 Weighted Routing**: Use Layer 7 Reverse Proxies (Envoy, Nginx, AWS ALB) for traffic splitting rather than DNS weighted records. DNS records respect client-side caching (TTL); a user’s browser may cache a DNS record for 1 hour, preventing fast canary rollback. L7 load balancers switch traffic in milliseconds.
- **Connection Draining (Deregistration Delay)**: Ensure your load balancer maintains a deregistration delay (30 seconds) so that when old pods are terminated during a rolling update, in-flight requests finish cleanly.

---

## 11. Security Considerations

- **Canary Blast Radius Containment**: If a security vulnerability or critical authorization flaw exists in v2, canary routing limits exposure to only 2–5% of traffic, preventing organization-wide credential or data exposure.
- **Parity of Security Groups & IAM Roles**: Ensure Blue and Green environments share identical VPC security group restrictions, SSL configurations, and IAM permissions to prevent environmental security regressions.

---

## 12. Alternatives: Comparison Matrix

| Deployment Strategy | Resource Cost | Rollback Speed | Complexity | Risk Exposure |
|---|---|---|---|---|
| **Rolling Update** | Low (Zero extra hardware)| Medium (Takes 2–5 mins to roll back) | Low | High (Exposes 100% of users over time)|
| **Blue-Green** | **High** (Requires 2x infrastructure)| **Instant** (<100ms router switch) | Medium | Medium (Switches 100% of traffic at once)|
| **Canary Release** | Low to Medium | **Instant** (Reset weights to 0) | **High** (Requires automated metrics)| **Minimal** (Affects only 2–5% of users)|

---

## 13. Trade-offs

- **Blue-Green Hardware Costs vs. Instant Safety**:
  Blue-Green requires doubling your cloud infrastructure capacity (running two identical 20-node clusters during deployment), which increases cloud hosting bills by 10–20%. However, the ability to roll back in 100ms without redeploying makes it the preferred strategy for financial and healthcare platforms.
- **Canary Telemetry Duration vs. Deployment Velocity**:
  A comprehensive canary release that pauses for 30 minutes at each step (5%, 20%, 50%) takes 2 hours to achieve full rollout. This delays deployment velocity, but provides maximum confidence against subtle memory leaks or edge-case bugs that only manifest under sustained production load.

---

## 14. Real-World Usage & Implementation Example: Nginx Canary Weight Routing

Here is a production **Nginx Configuration** demonstrating cookie-based sticky Canary traffic splitting using the native `split_clients` module:

```nginx
# /etc/nginx/conf.d/canary.conf

# 1. Split client requests based on User IP or Session Cookie
split_clients "${remote_addr}${http_cookie}" $upstream_variant {
    5%      backend_canary;   # 5% of users route to new v2 release
    *       backend_stable;   # 95% of users route to stable v1 release
}

# 2. Upstream Clusters
upstream backend_stable {
    server 10.0.1.10:4000;
    server 10.0.1.11:4000;
    keepalive 32;
}

upstream backend_canary {
    server 10.0.2.20:4000; # Running new release v2
    keepalive 32;
}

server {
    listen 80;
    server_name api.mycompany.com;

    location / {
        # Check for QA Override Header: allows internal developers to test canary directly!
        set $target_backend $upstream_variant;
        if ($http_x_canary_override = "true") {
            set $target_backend backend_canary;
        }

        proxy_pass http://$target_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Inject diagnostic response header so clients know which version answered
        add_header X-Release-Variant $target_backend always;
    }
}
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: What is the main operational difference between Blue-Green and Rolling Deployments?
**Answer**:
- **Rolling Deployment**: Gradually updates pods inside a single cluster. Instances running Version 1 and Version 2 exist simultaneously within the same environment behind the load balancer until rollout completes. Requires zero additional hardware infrastructure, but rollback takes minutes (rolling backwards).
- **Blue-Green Deployment**: Provisions two completely separate, identical environments (**Blue** running v1, **Green** running v2). 100% of live traffic points to Blue. After Green is tested and certified, the router flips 100% of traffic to Green in milliseconds. Rollback is instantaneous by simply pointing the router back to Blue, but requires double the infrastructure during deployment.

### 2. Conceptual: Explain the "Expand-Contract" (or Parallel Run) database migration pattern.
**Answer**:
Because modern zero-downtime deployments run old (v1) and new (v2) application instances simultaneously against a shared database, schema changes must never break backward compatibility:
1. **Expand**: Add new columns or tables alongside existing ones (e.g., add `phone_number` while keeping `phone`). Both columns exist concurrently.
2. **Parallel Run**: Deploy application v2, which writes to both columns and reads from the new column. Old v1 instances continue writing to the old column.
3. **Backfill**: Asynchronously migrate historical records from the old column to the new column.
4. **Contract**: Once 100% of application traffic is migrated to v2 and v1 is decommissioned, execute a final migration to safely drop the old column (`ALTER TABLE ... DROP COLUMN phone`).

### 3. Implementation: How does an automated Canary deployment know when to abort and roll back?
**Answer**:
Using **Automated Metric Analysis**:
1. The Canary controller (such as Argo Rollouts or Flagger) continuously queries a monitoring time-series database (Prometheus / Datadog) for key health signals on the canary pods.
2. **Success Metrics Evaluated**:
   - HTTP 5xx error rate: `rate(http_requests_total{status=~"5.."}[2m]) < 0.01` (less than 1%).
   - Latency: `histogram_quantile(0.95, ...) < 500ms`.
3. If metric thresholds are breached for consecutive check intervals (e.g., 3 consecutive failures), the controller immediately sets the canary traffic weight to 0%, alerts the engineering team on Slack/PagerDuty, and aborts the release without human intervention.

### 4. Debugging: A team executed a Rolling Update, and users started reporting random logged-out sessions and cart-empty errors during the 5-minute rollout window. What caused this?
**Answer**:
1. **In-Memory Session Storage**: The application stored user session data or shopping cart state in **local container RAM** rather than a centralized Redis cluster.
2. **Cross-Version Socket Bouncing**: As old pods and new pods ran concurrently behind the load balancer, a user's first request hit a v1 pod (creating an in-memory session), while their next request hit a v2 pod. Because memory is not shared between pods, the v2 pod did not find the session, forcing a logout.
3. **Fix**: Ensure all session state, shopping carts, and cache objects reside in an external, centralized Redis cluster, and configure cookie-based sticky sessions on the load balancer during rollouts.

### 5. Scenario: When would you choose a Canary deployment over a Blue-Green deployment?
**Answer**:
Choose a **Canary Deployment** when:
1. **High Risk of Edge-Case Bugs**: Releasing complex algorithmic changes (e.g., a new search ranking algorithm or payments processing engine) where bugs only manifest under subtle, real-world user data patterns. Exposing 100% of users immediately (Blue-Green) would cause widespread outages; Canary restricts the blast radius to 2%.
2. **Infrastructure Cost Constraints**: Running two full copies of a massive 500-node cluster (Blue-Green) is cost-prohibitive. Canary only requires provisioning 1 or 2 small canary instances (5% extra capacity).

### 6. Advanced: Why should you avoid using DNS weighting (e.g., Route 53 Weighted Records) as the primary traffic-shifting mechanism for Canary releases?
**Answer**:
DNS-based traffic shifting relies on client browsers and intermediate ISP resolvers honoring DNS **TTL (Time-To-Live)** settings:
1. **Aggressive Client Caching**: Many mobile operating systems, corporate proxies, and browser runtimes aggressively cache DNS answers for minutes or hours, ignoring low TTL values (e.g., 5 seconds).
2. **Loss of Instant Rollback**: If a canary bug is detected and you update the DNS record back to 100% stable, millions of users who cached the canary IP will continue routing to the broken version for the remainder of their local DNS cache window.
3. **Superior Approach**: Use **Layer 7 Load Balancers / Reverse Proxies** (AWS ALB, Envoy, Nginx Ingress). The DNS resolves to a stable load balancer IP; the load balancer performs instant, millisecond-accurate internal weighted routing.

---

## 16. Coding Questions & Practical Challenges

1. **Feature Flag Middleware**: Implement a TypeScript Express middleware that checks for a `x-feature-flag` header or user ID hash to route 10% of users to an experimental checkout controller while routing 90% to the legacy controller.
2. **Prometheus Metric Canary Evaluator**: Write a Node.js script using `axios` that queries Prometheus HTTP API, computes the error percentage for a canary service, and exits with code 0 (pass) or code 1 (trigger rollback).
3. **Database Migration Script (Expand Phase)**: Write a pair of TypeScript migration scripts using Kysely or Knex demonstrating the Expand phase for splitting a `full_name` column into `first_name` and `last_name` without data loss.

---

## 17. Common Interview Traps

- **Trap 1: Dropping a database column in the same PR that updates application code**: Always remember that zero-downtime means old and new code run concurrently. A database migration that drops or renames a column will immediately crash the running old pods before the new pods can finish booting.
- **Trap 2: Forgetting to warm up caches in Blue-Green releases**: Pointing 100% of production traffic instantly from Blue to Green where Green has an empty, cold Redis cache can cause a catastrophic **Cache Avalanche** that immediately overwhelms the primary database. Always pre-warm caches on the Green cluster before flipping the router.
- **Trap 3: Believing zero-downtime eliminates the need for testing in staging**: Zero-downtime deployment strategies minimize release risk in production, but are never a substitute for thorough staging integration tests and automated CI/CD pipeline verification.

---

## 18. Revision Summary

- **Three Core Paradigms**:
  - **Rolling Update**: Incrementally swaps pods (low cost, concurrent versions).
  - **Blue-Green**: Instant switch between two identical environments (instant rollback, 2x hardware cost).
  - **Canary**: Progressive traffic shift (5% $\rightarrow$ 25% $\rightarrow$ 100%) gated by automated Prometheus error/latency metrics.
- **Database Rule**: Always apply the **Expand-Contract (Parallel Run)** pattern to maintain dual-version compatibility.
- **Traffic Shifting**: Implement weighted routing at Layer 7 (Load Balancers / Envoy) with cookie session stickiness, never via DNS records.

---

## 19. Quick Reference Cheatsheet

```yaml
# Deployment Strategy Decision Matrix
Strategy       | Ideal For                         | Rollback Latency | Hardware Cost
---------------|-----------------------------------|------------------|---------------
Rolling Update | Standard stateless web services   | 2 - 5 minutes    | 1x (Baseline)
Blue-Green     | Mission-critical / financial APIs | < 100 ms (Instant)| 2x (High)
Canary Release | Massive-scale, high-risk features | < 500 ms (Instant)| 1.05x (Low)

# Expand-Contract Migration Steps
Step 1: Add new column (nullable)
Step 2: Deploy app writing to both columns
Step 3: Backfill historical rows
Step 4: Deploy app reading only new column
Step 5: Drop old column
```
