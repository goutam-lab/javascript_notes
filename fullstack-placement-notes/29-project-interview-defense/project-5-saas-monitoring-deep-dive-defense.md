# Project 5: Distributed SaaS Monitoring & Alerting Defense Guide

## 1. What is it?
The **Distributed SaaS API Monitoring & Incident Alerting Platform** (BetterStack/Datadog/PagerDuty clone) is a high-availability infrastructure observability service. It executes continuous synthetic uptime pings, SSL certificate expiration checks, and latency health probes against thousands of external customer URLs from geographically distributed global worker nodes (e.g. US-East, EU-Central, AP-South).

In placement interviews, candidates present this project to demonstrate:
- High-throughput **Time-Series Data Ingestion** using specialized columnar/time-series engines (TimescaleDB / ClickHouse).
- Distributed consensus across multiple monitoring probe regions to eliminate false-positive alerts.
- Fault-tolerant **Alert Notification Pipelines** (Slack, Discord, PagerDuty, Webhooks, Twilio SMS) with alert deduplication and flap-damping heuristics.
- Zero-downtime, independently hosted **Public Status Pages** calculating rolling 90-day SLA availability metrics.

```
       DISTRIBUTED API MONITORING & ALERTING ARCHITECTURE
       
   ┌─────────────────────────────────────────────────────────────┐
   │ DISTRIBUTED PING WORKERS (Go / Node.js in 3 Global Regions)  │
   │  - Probe US-East  (HTTP GET every 30s)                      │
   │  - Probe EU-West  (HTTP GET every 30s)                      │
   │  - Probe AP-South (HTTP GET every 30s)                      │
   └───────────────┬─────────────────────────────────────────────┘
                   │ Stream Metrics via Kafka / Redis Stream
                   ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ INGESTION & CONSENSUS ENGINE (State Machine)                │
   │                                                             │
   │  Is Target DOWN from >= 2 Independent Regions?              │
   │  ├── NO  ──► Record Latency Metric; Status = HEALTHY        │
   │  └── YES ──► Trigger Incident Transition:                   │
   │              HEALTHY ──► DEGRADED ──► DOWN                  │
   └───────────────┬─────────────────────────────────────────────┘
                   │
                   ├── Write Time-Series ──────► [ TimescaleDB / ClickHouse ]
                   │                             (Aggregates p95, p99, Uptime %)
                   ▼ Trigger Incident Event
   ┌─────────────────────────────────────────────────────────────┐
   │ ALERT DISPATCH PIPELINE (BullMQ Queue + Flap Suppressor)    │
   │  - Deduplicates repeated alerts within 15-minute window     │
   │  - Dispatches concurrently to: PagerDuty, Slack, Twilio SMS │
   │  - Automatically updates public status page (WebSockets)    │
   └─────────────────────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
SaaS companies incur severe financial and reputational losses when their APIs crash unnoticed:
1. **The False-Positive Disaster:** A temporary network blip in Frankfurt wakes up on-call engineers at 3:00 AM unless multiple global probes corroborate the outage.
2. **Alert Fatigue:** A flapping server alternating between 200 OK and 500 Internal Server Error every 10 seconds can spam an engineer's phone with 500 SMS messages in an hour without rate limiting and debouncing.
3. **High Write Throughput:** 10,000 monitors pinged every 30 seconds generates millions of data points daily, overwhelming standard relational databases without time-series compression.

---

## 3. Mental Model
Think of the monitoring platform as a **Fire Alarm System with Triple Heat Detectors**:

```
                       FIRE ALARM ANALOGY
                       
  ❌ The Single-Probe Mistake (The Fragile Sensor):
     - A single dust particle lands on one smoke detector.
     - The alarm blares, the building evacuates, and fire trucks arrive (False Positive).
     
  ✅ The Distributed Consensus Model (2-of-3 Quorum):
     - Sensor 1 (US) says: "I detect smoke."
     - Central controller pauses: "Waiting for confirmation..."
     - Sensor 2 (EU) confirms: "I also detect smoke."
     - Quorum verified! Incident confirmed.
     - Sirens activate, fire marshals receive alerts, and the public exit signs light up.
```

---

## 4. Basic Example: The Incident State Machine

```
               MONITOR INCIDENT STATE MACHINE
               
              ┌───────────────┐
              │    HEALTHY    │ ◄────────────────────────┐
              │  (200 OK x3)  │                          │
              └───────┬───────┘                          │
                      │ First Failure (1 probe)          │
                      ▼                                  │
              ┌───────────────┐                          │ All Probes Pass
              │   DEGRADED    │                          │ (3 Consecutive)
              │ (Suspected)   │                          │
              └───────┬───────┘                          │
                      │ Corroborated by >= 2 Probes      │
                      ▼                                  │
              ┌───────────────┐                          │
              │     DOWN      │ ─────────────────────────┘
              │(Alerts Fired) │
              └───────────────┘
```

---

## 5. Real Example: Consensus Verification & Flap Suppression in TypeScript

```typescript
export interface ProbeResult {
  monitorId: string;
  region: 'us-east' | 'eu-west' | 'ap-south';
  statusCode: number;
  latencyMs: number;
  timestamp: number;
  error?: string;
}

export class MonitoringConsensusEngine {
  // Tracks recent probe reports: monitorId -> Region -> Results
  private recentChecks = new Map<string, Map<string, ProbeResult>>();

  public async evaluateProbeResult(result: ProbeResult): Promise<'TRIGGER_INCIDENT' | 'RESOLVE_INCIDENT' | 'NOOP'> {
    let regionMap = this.recentChecks.get(result.monitorId);
    if (!regionMap) {
      regionMap = new Map();
      this.recentChecks.set(result.monitorId, regionMap);
    }

    regionMap.set(result.region, result);

    // Need reports from at least 3 regions to form quorum
    if (regionMap.size < 3) {
      return 'NOOP';
    }

    const results = Array.from(regionMap.values());
    const failedProbes = results.filter(r => r.statusCode < 200 || r.statusCode >= 400 || !!r.error);

    // Quorum Rule: >= 2 regions must agree the site is down to trigger an incident!
    if (failedProbes.length >= 2) {
      return 'TRIGGER_INCIDENT';
    }

    // All 3 regions reporting healthy resolves any active incident
    if (failedProbes.length === 0) {
      return 'RESOLVE_INCIDENT';
    }

    return 'NOOP';
  }
}
```

---

## 6. Under the Hood: TimescaleDB Hypertables & Chunk Compression

```
             POSTGRESQL TIMESCALEDB HYPERTABLE
             
  Table: "monitor_metrics" (Single logical table to the developer)
  ┌─────────────────────────────────────────────────────────────┐
  │ timestamp | monitor_id | latency_ms | status_code | region  │
  └──────────────────────────────┬──────────────────────────────┘
                                 │
                 Automatic Partitioning by Time
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
  [ Chunk 1: Today ]      [ Chunk 2: Yesterday ]   [ Chunk 3: 7 Days Ago ]
  Uncompressed, Writeable Compressed (Parquet-like) Compressed (95% disk save)
```

By partitioning metrics into internal time chunks:
- Writes append sequentially to the newest chunk in memory.
- Old chunks are compressed into columnar formats, reducing disk usage by up to 90% and accelerating analytical aggregation queries (`AVG(latency)` over 90 days) by 100x.

---

## 7. Important Rules

1. **Always Require Multi-Region Quorum:** Never dispatch a high-severity alert based on a single failed HTTP ping. At least 2 geographically separate probe regions must confirm the failure within a 60-second window.
2. **Follow HTTP Redirects with Depth Limits:** Limit HTTP redirect following to 5 hops to prevent malicious infinite redirect loops.
3. **Validate SSL Expiration in Background:** Run dedicated SSL certificate inspection jobs once every 24 hours, alerting when remaining validity drops below 30, 14, and 7 days.

---

## 8. Common Mistakes

- **Mistake 1:** Storing high-frequency raw pings in standard PostgreSQL without partitioning. The table bloats to billions of rows, slowing indexes and crashing backups.
- **Mistake 2:** Missing alert deduplication. If a site stays down for 4 hours, sending an SMS every 30 seconds will exhaust Twilio budgets and alienate users.
- **Mistake 3:** Hosting the Public Status Page on the same infrastructure as the primary app. When the cloud region crashes, the status page crashes with it!

---

## 9. Best Practices

1. **Flap Damping:** If a service changes state between UP and DOWN more than 3 times in 10 minutes, mark the status as "FLAPPING" and silence repeat notifications until stable.
2. **Independent Status Page Hosting:** Deploy the status page to an isolated edge network (e.g. Cloudflare Pages or AWS S3 + CloudFront) powered by decoupled static JSON feeds.
3. **Escalation Policies:** Notify Slack immediately; if unacknowledged after 5 minutes, call on-call engineers via Twilio/PagerDuty.

---

## 10. Performance Considerations

| Component | Architecture | Throughput |
|---|---|---|
| **Synthetic Pings** | Go / Node.js worker pools using HTTP Keep-Alive | 20,000 pings/sec per worker node |
| **Metrics Ingestion** | Micro-batched inserts into TimescaleDB / ClickHouse | 250,000 writes/sec |
| **SLA Calculations** | Materialized Continuous Aggregates (1-hour buckets) | Sub-10ms query execution |

---

## 11. Security Considerations
- **Server-Side Request Forgery (SSRF) via Webhooks:** Prevent customers from configuring monitors that target internal infrastructure (`http://169.254.169.254` AWS metadata or `http://localhost:5432`). Use strict IP blocklisting before initiating HTTP requests.
- **DDoS via Distributed Probes:** Validate domain ownership (e.g. via DNS TXT record or HTML meta tag) before allowing high-frequency monitoring on external targets.

---

## 12. Alternatives
1. **Prometheus + Alertmanager:** Industry standard for internal Kubernetes metric scraping.
2. **Datadog / New Relic:** Comprehensive commercial APM suites.

---

## 13. Trade-offs

| Ingestion Engine | Advantages | Trade-offs |
|---|---|---|
| **TimescaleDB (PostgreSQL)** | Full SQL capabilities; joins with user/tenant tables | Moderate resource consumption compared to pure columnar engines |
| **ClickHouse** | Extreme analytical speed and compression | More complex cluster operations; lacks native relational transactions |

---

## 14. Real-World Usage
- **BetterStack & Pingdom:** Powering uptime monitoring for millions of public websites with distributed multi-region consensus.
- **Cloudflare & GitHub Status:** Serving public status pages with independent edge failover.

---

## 15. Placement Interview Questions (Defense & System Design)

### Basic
1. *How do you calculate 90-day uptime SLA percentage?*
   - **Answer:** $\text{Uptime \%} = \frac{\text{Total Monitored Seconds} - \text{Total Downtime Seconds}}{\text{Total Monitored Seconds}} \times 100$. For example, $99.9\%$ ("three nines") allows a maximum of 43 minutes and 49 seconds of downtime over a 30-day period.

### Conceptual
2. *What is "Flapping" in monitoring and how do you prevent alert spam from it?*
   - **Answer:** Flapping occurs when a service rapidly alternates between UP and DOWN states due to unstable network connections or failing health checks. We prevent alert spam through **Flap Damping**: if a monitor changes state more than $N$ times within a rolling window (e.g., 3 times in 10 minutes), alerts are suppressed and the monitor is marked "FLAPPING" until it demonstrates sustained stability.

### Implementation
3. *How do you prevent SSRF attacks when users submit URLs to be monitored?*
   - **Answer:** Resolve the hostname's DNS first, verify that the resolved IP address does not fall into private, loopback, or cloud-metadata CIDR blocks (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.169.254`), and configure HTTP client socket binders to strictly reject connections to private IP spaces.

### Debugging
4. *Your monitoring workers run out of memory when pinging 5,000 URLs every 30 seconds. How do you fix it?*
   - **Answer:** The workers are leaking open TCP sockets and buffers.
     1. Enforce strict HTTP timeouts (e.g. 10s socket timeout).
     2. Reuse connections using an `http.Agent` with `keepAlive: true`.
     3. Stream and discard response bodies with `.destroy()` immediately after reading HTTP status headers instead of buffering megabytes of response HTML.

### Scenario
5. *Design a resilient alerting pipeline that guarantees delivery even if your primary database goes down.*
   - **Answer:** When an incident triggers, write the alert event directly to a distributed message queue (Redis Streams, RabbitMQ, or AWS SQS). Alert workers consume from the queue and dispatch to external APIs (Twilio, Slack, PagerDuty). If the primary relational database is unreachable, alert workers operate independently from in-memory queue payloads.

---

## 16. Coding Questions

### Problem: TimescaleDB Rolling 24-Hour Availability Metric Calculation
Write an optimized SQL query that computes the hourly uptime percentage and p95 latency for a specific monitor.

```sql
SELECT 
  time_bucket('1 hour', recorded_at) AS hour_window,
  ROUND(
    COUNT(CASE WHEN is_up = TRUE THEN 1 END)::numeric / COUNT(*)::numeric * 100, 
    2
  ) AS uptime_percentage,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms) AS p95_latency_ms
FROM monitor_health_checks
WHERE 
  monitor_id = $1 
  AND recorded_at >= NOW() - INTERVAL '24 hours'
GROUP BY hour_window
ORDER BY hour_window ASC;
```

---

## 17. Common Interview Traps
- **Trap 1:** Triggering alerts immediately on a single failed ping.
  *Reality:* Temporary network packet drops occur constantly on the public internet. Firing alerts without confirmation from another geographic region results in un-actionable false positives.
- **Trap 2:** Ignoring DNS resolution time in synthetic latency measurements.
  *Reality:* A complete synthetic probe must measure DNS lookup time, TCP handshake time, TLS negotiation time, and Time to First Byte (TTFB) independently.

---

## 18. Revision Summary
- **Multi-Region Consensus:** Outages are only confirmed when $\ge 2$ independent probe regions agree.
- **Time-Series Storage:** Use TimescaleDB hypertables with columnar compression for high-throughput metrics.
- **Alert Hygiene:** Flap damping and deduplication windows prevent engineer alert fatigue.
- **SSRF Hardening:** Strict DNS resolution and private CIDR block filtering protect internal networks.

---

## 19. Quick Reference

```
┌─────────────────────────────────┬───────────────────────────────────────────────┐
│ MONITORING SYSTEM COMPONENT     │ ARCHITECTURAL PATTERN                         │
├─────────────────────────────────┼───────────────────────────────────────────────┤
│ Probe Architecture              │ Distributed worker nodes across 3+ AWS regions│
│ Consensus Strategy              │ 2-of-3 Quorum agreement within 60 seconds     │
│ Time-Series Storage             │ TimescaleDB Hypertables (Continuous Aggregate)│
│ Alert Deduplication             │ Redis rolling lock + BullMQ queue workers     │
│ Flap Damping                    │ State transition thresholding (3 flips/10min) │
│ SSRF Defense                    │ DNS resolution + Private IP CIDR filtering   │
└─────────────────────────────────┴───────────────────────────────────────────────┘
```
