# Application Metrics: Prometheus, Grafana & The Four Golden Signals

## 1. What is it?
While logs provide detailed forensic records of individual events, **Metrics** represent real-time, numeric, aggregated **Time-Series Telemetry** measuring system behavior, health, and throughput over time.

In modern site reliability engineering (SRE), the industry-standard observability architecture pairs **Prometheus** (a time-series database and metric scraping engine) with **Grafana** (an interactive dashboard and alerting visualization interface). Applications instrument their code using client libraries (such as `prom-client` in Node.js) to expose a standardized **`/metrics`** HTTP endpoint. Prometheus scrapes this endpoint at regular intervals (e.g., every 15 seconds) using a **Pull Model**, storing metrics as timestamped key-value pairs with multidimensional labels.

Engineering teams organize their telemetry around Google SRE’s **Four Golden Signals**:
1. **Latency**: How long requests take (measured as p50, p95, p99 percentiles).
2. **Traffic**: How much demand is placed on the system (requests per second / QPS).
3. **Errors**: The rate of requests that fail (HTTP 5xx responses or exception counts).
4. **Saturation**: How full or constrained the system's resources are (CPU, memory, database connection pool usage, event loop lag).

```
                     PROMETHEUS & GRAFANA METRICS PIPELINE
                     
 ┌──────────────────────────────────────────────┐
 │ Node.js Express Application                  │
 │ • `prom-client` library collects telemetry   │
 │ • Exposes HTTP endpoint: `GET /metrics`      │
 └──────────────────────┬───────────────────────┘
                        │
                        ▼ 1. Pull / Scrape (every 15s)
 ┌──────────────────────────────────────────────┐
 │ Prometheus Server                            │
 │ • Scrape Engine (HTTP GET /metrics)          │
 │ • Time-Series Database (TSDB Engine)         │
 │ • Evaluates PromQL Alerting Rules            │
 └──────────┬───────────────────────────┬───────┘
            │ 2. Alert Trigger          │ 3. PromQL Queries
            ▼                           ▼
 ┌──────────────────────┐   ┌──────────────────────────────────────────────┐
 │ Alertmanager         │   │ Grafana Dashboards                           │
 │ • PagerDuty / Slack  │   │ • Real-time P99 Latency & QPS Graphs         │
 │ • Email Escalations  │   │ • Database Connection Pool Saturation Gauges │
 └──────────────────────┘   └──────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Relying exclusively on logs for real-time monitoring leads to severe operational deficiencies:

1. **Massive Computational Cost of Log Parsing**: Calculating your API's 99th percentile latency by parsing and aggregating 20 million log entries in Elasticsearch consumes massive CPU and takes minutes. Prometheus histograms calculate p99 latency in milliseconds.
2. **Delayed Incident Detection**: Logs record events after they complete. If a database locks up, HTTP connections hang for 60 seconds before generating a log. A Prometheus saturation gauge immediately reveals active connection pool exhaustion within 5 seconds.
3. **High Cardinality Storage Costs**: Logs store full strings and context for every request. Storing 1 billion logs per month costs thousands of dollars. Storing numeric counters in Prometheus costs a fraction of that because time-series databases compress float values by up to 90%.

---

## 3. Mental Model
Think of application telemetry like modern aviation:
- **Logs** are the flight data recorder ("black box"): detailed, granular, analyzed primarily after a crash to determine exact causality.
- **Metrics (Prometheus & Grafana)** are the real-time cockpit instrument dials (altimeter, airspeed, fuel gauges, engine temperature): continuously monitored during flight, instantly alerting the pilot if altitude drops or fuel pressure falls below safety thresholds.

---

## 4. Basic Example: Prometheus Metric Types

Prometheus defines four core metric primitives:
1. **Counter**: A cumulative metric that only ever increases or resets to zero on restart (e.g., total requests handled: `http_requests_total`).
2. **Gauge**: A metric that can arbitrarily go up or down (e.g., current active database connections, memory usage).
3. **Histogram**: Samples observations (usually request durations or payload sizes) and counts them in configurable bucket ranges.
4. **Summary**: Similar to histograms, but calculates streaming configurable quantiles (e.g., φ = 0.99) directly on the client side.

```typescript
// basic-metrics.ts
import client from 'prom-client';

// 1. Counter: Only increments
export const orderCounter = new client.Counter({
  name: 'ecommerce_orders_total',
  help: 'Total count of processed e-commerce orders',
  labelNames: ['status', 'payment_method'],
});

// 2. Gauge: Goes up and down
export const activeConnectionsGauge = new client.Gauge({
  name: 'db_connection_pool_active',
  help: 'Number of currently active database connections',
});

// Incrementing and Updating
orderCounter.inc({ status: 'success', payment_method: 'stripe' });
activeConnectionsGauge.set(14);
```

---

## 5. Real Example: Enterprise Express Metrics Middleware & The 4 Golden Signals

Here is a production-grade TypeScript implementation using **`prom-client`** that automatically captures Google SRE's Four Golden Signals, system defaults, and exposes a clean `/metrics` endpoint:

```typescript
// metrics.ts
import express, { Request, Response, NextFunction } from 'express';
import client from 'prom-client';

// 1. Create a Custom Registry (Prevents global pollution)
export const registry = new client.Registry();

// 2. Collect Default Node.js & OS Metrics (V8 Heap, Event Loop Lag, CPU, GC)
client.collectDefaultMetrics({
  register: registry,
  prefix: 'nodejs_',
});

// ==============================================================================
// THE FOUR GOLDEN SIGNALS INSTRUMENTATION
// ==============================================================================

// SIGNAL 1 & 2: TRAFFIC & LATENCY (Histogram with standard latency buckets)
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds across routes and status codes',
  labelNames: ['method', 'route', 'status_code'],
  // Buckets optimized for web APIs: 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1s, 2.5s, 5s, 10s
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

// SIGNAL 3: ERRORS (Counter tracking 5xx exceptions)
export const appErrorsTotal = new client.Counter({
  name: 'app_exceptions_total',
  help: 'Total count of unhandled internal application exceptions',
  labelNames: ['error_type', 'service'],
  registers: [registry],
});

// SIGNAL 4: SATURATION (Gauges for internal pools)
export const dbPoolSaturation = new client.Gauge({
  name: 'postgres_pool_connections_active',
  help: 'Number of active PostgreSQL client connections currently leased',
  registers: [registry],
});

export const eventLoopLagGauge = new client.Gauge({
  name: 'nodejs_event_loop_lag_milliseconds',
  help: 'Real-time event loop latency in milliseconds',
  registers: [registry],
});

// ==============================================================================
// EXPRESS METRICS MIDDLEWARE
// ==============================================================================
export function metricsMiddleware(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime();

  res.on('finish', () => {
    const diff = process.hrtime(start);
    const durationSeconds = diff[0] + diff[1] / 1e9;

    // Normalize parameterized route path to prevent high cardinality!
    // Example: Use '/api/users/:id' instead of raw '/api/users/98432'
    const route = req.route ? req.route.path : req.baseUrl + (req.path === '/' ? '' : req.path);

    httpRequestDuration.observe(
      {
        method: req.method,
        route: route || 'unmatched_route',
        status_code: res.statusCode.toString(),
      },
      durationSeconds
    );
  });

  next();
}

// ==============================================================================
// METRICS SCRAPE ENDPOINT
// ==============================================================================
export const app = express();
app.use(metricsMiddleware);

// Scraped by Prometheus server every 15s
app.get('/metrics', async (req: Request, res: Response) => {
  res.setHeader('Content-Type', registry.contentType);
  const metrics = await registry.metrics();
  res.send(metrics);
});
```

### Prometheus Scrape Configuration (`prometheus.yml`)
```yaml
global:
  scrape_interval: 15s     # Scrape targets every 15 seconds
  evaluation_interval: 15s # Evaluate alert rules every 15 seconds

scrape_configs:
  - job_name: 'core-backend-api'
    scrape_interval: 5s     # High-frequency scraping for critical API
    metrics_path: '/metrics'
    static_configs:
      - targets: ['api-service:4000']
        labels:
          environment: 'production'
          region: 'us-east-1'
```

---

## 6. Under the Hood: PromQL & TSDB Storage Compression

### A. How Prometheus Calculates Percentiles (`histogram_quantile`)
In Prometheus, computing the 99th percentile (p99) latency across 50 container pods over the last 5 minutes uses the **`histogram_quantile`** function:

```promql
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))
```
- Prometheus groups request durations into pre-configured **`le` (less-than-or-equal)** buckets (e.g., $\le 0.1\text{s}$, $\le 0.5\text{s}$).
- Rather than storing every individual float latency, it calculates the rate of change per bucket across all pods and uses linear interpolation to estimate the exact p99 threshold in microseconds.

### B. Time-Series Compression (Gorilla Algorithm)
Prometheus stores data in its custom **Time Series Database (TSDB)**:
- Timestamps are compressed using **Double Delta compression** (storing the difference between successive time deltas), reducing an 8-byte 64-bit integer timestamp to an average of **1.37 bits**.
- Float64 values are compressed using **XOR delta compression** (the Gorilla algorithm).
- Result: Prometheus can store **1 million metrics per second using less than 1.5 bytes per sample**, allowing multi-terabyte metric datasets to reside entirely in high-speed server RAM.

---

## 7. Important Rules

1. **BEWARE OF LABEL CARDINALITY EXPLOSION (The #1 Prometheus Trap)**:
   Never use dynamic, unbounded user-generated values as metric labels:
   - ❌ `httpRequestDuration.observe({ userId: req.user.id }, duration);`
   - ❌ `httpRequestDuration.observe({ email: req.body.email }, duration);`
   - ❌ `httpRequestDuration.observe({ path: '/orders/' + orderId }, duration);`
   **Why it is fatal**: Each unique combination of label keys and values creates a brand-new, permanent time-series stream in Prometheus RAM. If you have 1 million users, adding `userId` creates 1 million new streams, exhausting Prometheus memory within minutes and crashing the TSDB! Keep label values bounded to finite enums (e.g., `method: 'GET'`, `status_code: '200'`).
2. **Always Parameterize Routes**:
   Ensure your metrics middleware records the Express route template (e.g., `/api/users/:id`), never the raw request path (`/api/users/12345`). Un-parameterized paths cause cardinality explosions.
3. **Keep Scraping Pull Lightweight**:
   The `/metrics` endpoint must generate output instantaneously. Never execute blocking database calls inside the `/metrics` request handler; update gauges and counters asynchronously in the background.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Using Counters Where Gauges Are Required
Using a Counter for memory usage or active connections. Counters only increment; if your memory usage drops from 800MB to 400MB, a Counter cannot reflect the reduction. Always use a **Gauge** for values that fluctuate up and down.

### 2. Ill-Fitted Histogram Buckets
Using default histogram buckets designed for seconds (`0.005, 0.01, 0.025... 10`) on an internal microservice where all operations execute in sub-millisecond time ($< 1\text{ms}$). All observations fall into the lowest bucket, rendering p95/p99 calculations completely inaccurate. Tailor bucket boundaries to your application's expected latency profile.

---

## 9. Best Practices

- **Create Standard Grafana SRE Dashboards**:
  Structure your Grafana board into 4 clear visual panels representing the Golden Signals:
  - Top Left: **Traffic** (Total requests/sec graph).
  - Top Right: **Errors** (Error rate percentage: `(5xx / Total) * 100`).
  - Bottom Left: **Latency** (p50, p95, p99 duration lines).
  - Bottom Right: **Saturation** (CPU %, RAM %, DB Connection Pool leased vs max).
- **Proactive Alerting on Slopes, Not Just Static Ceilings**:
  Do not wait for disk space to hit 100% or connection pools to completely exhaust. Write PromQL alerts that predict failure based on rate of increase:
  ```promql
  # Alert if disk will fill up in less than 4 hours based on current 1-hour rate
  predict_linear(node_filesystem_free_bytes[1h], 4 * 3600) < 0
  ```

---

## 10. Performance Considerations

- **Scrape Interval vs. Metric Resolution**:
  Scraping every 1 second provides ultra-high resolution but multiplies storage footprint by 15x. Standard production environments scrape every **15 seconds**; high-frequency critical APIs scrape every **5 seconds**.
- **Pre-Allocating Buckets**: In high-throughput Node.js microservices handling 20,000 QPS, measuring every request with histograms incurs slight memory allocation overhead. Instrument selectively at the API Gateway or edge rather than inside every internal utility function.

---

## 11. Security Considerations

- **Protect the `/metrics` Endpoint**:
  The `/metrics` endpoint exposes sensitive infrastructure telemetry (internal service names, routing topologies, memory footprints, active user counts). Never expose `/metrics` to the public internet. Restrict access via Nginx or Kubernetes NetworkPolicies so only the internal Prometheus scraper IP can access the port.
- **TLS Authentication for Scraping**:
  In multi-tenant cloud environments, configure **mTLS (Mutual TLS)** between Prometheus and application endpoints to authenticate scraper identities.

---

## 12. Alternatives

| Observability Model | Collection Paradigm | Strengths | Weaknesses |
|---|---|---|---|
| **Prometheus** | Pull (Scrapes `/metrics`) | Standardized, powerful PromQL, decentralized scrapers. | Difficult horizontal scaling; single-node storage limits. |
| **StatsD / Telegraf** | Push (UDP packets) | Low app overhead; push-based architecture. | UDP packet loss; lacks native dimensional query language. |
| **Datadog / New Relic**| Managed SaaS Agent | Zero infrastructure setup; unified metrics, traces & logs. | Prohibitive costs at scale; data lock-in. |
| **VictoriaMetrics / Thanos** | Long-Term Prometheus Storage | Scales Prometheus horizontally across petabytes of S3 storage. | Added cluster operational complexity. |

---

## 13. Trade-offs

- **Pull Model (Prometheus) vs. Push Model (StatsD)**:
  In the Pull model, Prometheus controls scrape timing and automatically detects when a service goes down (if the scrape times out, the target is marked `DOWN`). However, pulling requires the application to expose an open network port, which is challenging for short-lived ephemeral serverless functions (AWS Lambda). For Lambda, metrics are pushed to CloudWatch or a Prometheus Pushgateway.
- **Histogram Accuracy vs. Memory**:
  Adding 20 buckets to a histogram provides granular percentile accuracy, but multiplies the number of stored time-series per endpoint by 20.

---

## 14. Real-World Usage & Implementation Example

Here are the essential **PromQL Production Alerting Rules** configured in Prometheus Alertmanager:

```yaml
# alert-rules.yml
groups:
  - name: CoreApiAlerts
    rules:
      # 1. LATENCY ALERT: Trigger if p99 latency exceeds 1.5 seconds for 5 consecutive minutes
      - alert: HighP99Latency
        expr: histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket{route!="/health/live"}[5m])) by (le)) > 1.5
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Core API experiencing high P99 latency (> 1.5s)"
          description: "Current P99 latency is {{ $value }} seconds on environment production."

      # 2. ERROR RATE ALERT: Trigger if 5xx errors exceed 2% of total traffic
      - alert: HighHttp5xxErrorRate
        expr: (sum(rate(http_request_duration_seconds_count{status_code=~"5.."}[5m])) / sum(rate(http_request_duration_seconds_count[5m]))) * 100 > 2
        for: 3m
        labels:
          severity: page
        annotations:
          summary: "HTTP 5xx error rate exceeds 2%"
          description: "API is throwing {{ $value }}% 5xx errors over the last 5 minutes."

      # 3. DATABASE SATURATION: Trigger if PostgreSQL connection pool exceeds 90% capacity
      - alert: DatabasePoolNearlyExhausted
        expr: (postgres_pool_connections_active / 20) * 100 > 90
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Postgres Connection Pool Saturation > 90%"
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: What are Google SRE's "Four Golden Signals", and why are they important?
**Answer**:
1. **Latency**: Time taken to service a request (differentiating between successful request latency and failed request latency).
2. **Traffic**: Demand placed on the system (e.g., HTTP requests/sec or concurrent sessions).
3. **Errors**: The rate of requests that fail explicitly (HTTP 500s) or implicitly (wrong content returned).
4. **Saturation**: How full the most constrained system resource is (e.g., CPU, RAM, database connection pool, disk I/O).
They are important because they provide a holistic, high-level view of system health: if all four signals are normal, the application is almost certainly functioning properly from the end-user's perspective.

### 2. Conceptual: Explain "Cardinality Explosion" in Prometheus and how it can crash your monitoring cluster.
**Answer**:
In Prometheus, every metric name combined with a unique set of label key-value pairs defines a **unique time-series stream**. 
If a developer adds a high-cardinality label like `user_id` or `order_id` (which can take millions of distinct values) to an HTTP metric:
$$\text{Total Streams} = (\text{Methods: 5}) \times (\text{Routes: 50}) \times (\text{Status Codes: 10}) \times (\text{Users: 1,000,000}) = \mathbf{2,500,000,000 \text{ streams}}$$
Prometheus must allocate in-memory data structures and chunk buffers for every individual stream. This causes Prometheus memory usage to explode exponentially, triggering the Linux Out-Of-Memory (OOM) killer and crashing the monitoring system. Labels must always have a low, finite set of predictable values.

### 3. Implementation: Why does calculating the average latency (sum / count) hide performance issues, and why are percentiles (p95, p99) required?
**Answer**:
Average latency is heavily distorted by the majority of fast requests. 
For example, if 99 users experience 10ms latency and 1 user experiences 10,000ms (10 seconds) latency:
$$\text{Average Latency} = \frac{(99 \times 10) + 10,000}{100} = \frac{10,990}{100} \approx \mathbf{109.9 \text{ms}}$$
An average of 109ms appears completely acceptable on a monitoring dashboard, masking the fact that 1% of your customers are experiencing complete 10-second timeouts. **Percentiles** (p95, p99) measure tail latency directly: p99 indicates that 99% of requests completed faster than that value, accurately exposing worst-case user experiences.

### 4. Debugging: Prometheus is scraping an application, but Grafana shows `Target Down` (status 0). How do you troubleshoot?
**Answer**:
1. **Verify Target Connectivity**: Access the Prometheus web UI (`http://prometheus:9090/targets`). Inspect the error message under the down target.
2. **Common Causes**:
   - `connection refused`: The application process crashed or is not listening on the specified port.
   - `context deadline exceeded`: The application took longer to respond than the configured `scrape_timeout` (e.g., `/metrics` handler is blocked by event loop lag).
   - `HTTP 404 / 401`: The metrics endpoint path is incorrect or an authentication middleware is intercepting the scraper without credentials.
   - Network Policy / Security Group: Firewall rules in Kubernetes or AWS are blocking ingress traffic from the Prometheus pod IP to port 4000.

### 5. Scenario: How does Prometheus scrape metrics from ephemeral serverless functions (AWS Lambda) that terminate in seconds?
**Answer**:
Because serverless functions boot up, execute, and freeze or terminate in milliseconds, Prometheus cannot pull metrics via its standard scraper loop.
**Solution**:
1. Use the **Prometheus Pushgateway**: Lambda functions push their metrics to an intermediary Pushgateway instance via HTTP POST before exiting. Prometheus then scrapes the Pushgateway normally.
2. Alternatively (recommended for AWS), emit metrics using **AWS CloudWatch Embedded Metric Format (EMF)** via stdout. CloudWatch automatically converts the JSON logs into CloudWatch metrics without adding network latency to the Lambda execution.

### 6. Advanced: What is the architectural difference between a Prometheus Histogram and a Summary?
**Answer**:
- **Histogram**: The client categorizes request durations into configurable static bucket boundaries (`le`). Percentiles are calculated **server-side in Prometheus** using the `histogram_quantile()` function. Multiple histograms from 50 different pods can be aggregated across clusters (`sum by (le)`).
- **Summary**: The client application calculates streaming quantiles (e.g., p50, p90, p99) **directly inside application memory** using sliding-window algorithms and exports the pre-calculated percentiles. 
- **Trade-off**: Summaries provide mathematically exact percentiles without bucket approximations, but **cannot be aggregated across multiple pods**. (Averaging the p99 of Pod A and Pod B is statistically invalid). For multi-instance microservices, **Histograms are mandatory**.

---

## 16. Coding Questions & Practical Challenges

1. **PromQL SLA Availability Calculation**: Write a PromQL expression that computes the 30-day percentage uptime SLA (success rate where HTTP status < 500) for a given service.
2. **Custom Gauge Collector**: Write a TypeScript class that periodically queries PostgreSQL `pg_stat_activity` and updates a Prometheus Gauge measuring active vs idle connection states.
3. **Adaptive Histogram Bucket Generator**: Implement a helper function in Node.js that generates logarithmic bucket boundaries given a minimum latency (1ms) and maximum latency (10s) with 10 target steps.

---

## 17. Common Interview Traps

- **Trap 1: Averaging pre-computed percentiles across multiple servers**: Taking the average of p99 latencies reported by 5 servers is a mathematical fallacy that yields meaningless data. Always aggregate raw histogram buckets across servers (`sum by (le)`) and compute the quantile on the aggregated result in PromQL.
- **Trap 2: Using Gauges for monotonically increasing counts**: Using a Gauge for total requests makes it impossible to compute rates over time using `rate()`. The `rate()` function requires a **Counter** because it is mathematically engineered to handle process restarts and counter resets.
- **Trap 3: Forgetting to remove unmapped route labels**: If your router captures 404s without route normalization, an attacker sending 100,000 random URLs (`/abc1`, `/abc2`) will inject 100,000 unique `route` labels, triggering a cardinality crash.

---

## 18. Revision Summary

- **Prometheus Core**: Pull-based scraping of standardized `/metrics` endpoints; stores compressed time-series data using Gorilla XOR compression.
- **Four Golden Signals**: Latency (Histograms), Traffic (Counters), Errors (Counters), Saturation (Gauges).
- **Golden Rule of Labels**: Never include dynamic high-cardinality values (User IDs, Emails, raw un-parameterized URLs) in metric labels.
- **Percentile Calculation**: Use `histogram_quantile(0.99, sum(rate(..._bucket[5m])) by (le))` to calculate accurate p99 tail latency across fleets.

---

## 19. Quick Reference Cheatsheet

```promql
# Essential PromQL Production Queries

# 1. Total Request Rate (QPS)
sum(rate(http_request_duration_seconds_count[1m]))

# 2. HTTP 5xx Error Percentage Rate
(sum(rate(http_request_duration_seconds_count{status_code=~"5.."}[5m])) / 
 sum(rate(http_request_duration_seconds_count[5m]))) * 100

# 3. P99 Latency across all pods
histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))

# 4. P95 Latency grouped by Route
histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, route))
```
