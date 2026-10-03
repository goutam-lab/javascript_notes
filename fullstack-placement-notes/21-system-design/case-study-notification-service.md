# System Design Case Study: Distributed Notification Service

## 1. What is it?
A **Distributed Notification Service** is a centralized, high-throughput, fault-tolerant infrastructure component responsible for dispatching multi-channel notifications (Push notifications, SMS, Email, and In-App alerts) to millions of end users. 

Modern platforms (such as Uber, Netflix, Amazon, and LinkedIn) generate billions of notifications: transactional alerts (OTP verification codes, ride receipts, password resets) and informational updates (friend requests, marketing campaigns, trending content). A notification service abstracts external delivery vendors (Apple APNs, Google FCM, Twilio, SendGrid), handles user communication preferences, prevents notification fatigue via rate limiting, enforces strict idempotency, and manages retries and dead-letter queues.

```
                  DISTRIBUTED NOTIFICATION SERVICE HIGH-LEVEL FLOW
┌─────────────────┐
│ Client Services │ (Auth, Payments, Social, Marketing)
└────────┬────────┘
         │ 1. Ingest Event: POST /v1/notifications
         ▼
┌────────────────────────────────────────────────────────┐
│ Notification Ingestion API Gateway                     │
│ • Authentication & Rate Limiting                       │
│ • Schema Validation (Zod)                              │
│ • Idempotency Check (Redis Deduplication Key)          │
└────────┬───────────────────────────────────────────────┘
         │ 2. Enqueue by Priority
         ▼
┌────────────────────────────────────────────────────────┐
│ Message Broker / Priority Queues (Kafka / RabbitMQ)    │
│ ┌───────────────────────┐   ┌────────────────────────┐ │
│ │ High Priority (OTP)   │   │ Low Priority (Marketing│ │
│ └───────────────────────┘   └────────────────────────┘ │
└────────┬───────────────────────────────────────────────┘
         │ 3. Consume & Process
         ▼
┌────────────────────────────────────────────────────────┐
│ Worker Fleet (Notification Engine)                     │
│ • Fetch User Preferences (Opt-in / DND hours)          │
│ • Template Compilation (Handlebars / Liquid)           │
│ • Provider Routing & Circuit Breakers                  │
└────────┬──────────────────────┬──────────────────────┬─┘
         │ Push                 │ SMS                  │ Email
         ▼                      ▼                      ▼
   ┌───────────┐          ┌───────────┐          ┌───────────┐
   │ APNs/FCM  │          │  Twilio   │          │ SendGrid  │
   └───────────┘          └───────────┘          └───────────┘
```

---

## 2. Why does it exist?
Without a dedicated notification platform, every microservice within an organization directly calls third-party providers (like Twilio or SendGrid). This naive architecture leads to catastrophic failure modes:

1. **Vendor Coupling and Vendor Lock-in**: If SendGrid suffers an outage or changes its API format, 15 different microservices crash or require simultaneous code refactoring.
2. **Missing Priority Routing**: A high-volume marketing campaign blasting 5 million promotional emails clogs HTTP worker threads, delaying time-critical OTP login verification emails by 20 minutes.
3. **No Idempotency / Duplicate Dispatch**: Network timeouts between microservices cause retries that send the same payment receipt or OTP three times to an angry user.
4. **Notification Fatigue & Violation of Privacy Laws**: Users receiving 10 push notifications an hour uninstall the app. Furthermore, sending marketing SMS during quiet hours violates regional regulations (such as TCPA in the US or TRAI regulations in India).
5. **No Centralized Audit Trail**: Regulators and customer support teams cannot verify whether a password reset link was successfully dispatched and delivered.

---

## 3. Step 1: Requirements Clarification

### Functional Requirements
1. **Multi-Channel Dispatch**: Support Push (iOS APNs, Android FCM), SMS (Twilio, Sinch), Email (SendGrid, AWS SES), and In-App feeds.
2. **Priority Tiers**: Urgent notifications (OTPs, fraud alerts) must be delivered within 2 seconds; bulk informational notifications (marketing) can tolerate up to 10 minutes latency.
3. **Idempotency & Deduplication**: Disallow identical notification events sent within a 10-minute window.
4. **User Preferences & Quiet Hours**: Respect user channel opt-outs (e.g., "SMS disabled") and do-not-disturb (DND) time zones.
5. **Rate Limiting (Anti-Spam)**: Cap marketing messages to a maximum of 3 notifications per user per day.
6. **Delivery Tracking**: Track statuses: `QUEUED`, `SENT`, `DELIVERED`, `FAILED`.

### Non-Functional Requirements
1. **High Availability**: 99.99% system availability (downtime must not halt business operations).
2. **Low Latency**: P99 latency for high-priority transactional notifications < 2 seconds.
3. **Scalability**: Capable of processing 100 million notifications daily with peak spikes of 25,000 events/sec.
4. **Reliability & Zero Message Loss**: All notification events must be durable. Unrecoverable external vendor failures must land in a Dead Letter Queue (DLQ).

### Out of Scope
- Building our own cellular SMS gateway infrastructure (we integrate with telecom aggregators like Twilio/Vonage).
- Building an in-house WYSIWYG rich text template designer.

---

## 4. Step 2: Capacity Estimation & Back-of-the-Envelope Math

### A. Traffic & QPS Calculations
- **Total Notifications**: 100 Million per day.
- **Channel Breakdown**:
  - Push: 60% (60 Million)
  - Email: 25% (25 Million)
  - SMS: 15% (15 Million)
- **Average QPS**:
  $$\text{Average QPS} = \frac{100,000,000 \text{ events}}{86,400 \text{ seconds}} \approx \mathbf{1,160 \text{ notifications/sec}}$$
- **Peak Traffic Multiplier**: 5x (during flash sales or breaking news alerts).
  $$\text{Peak QPS} = 1,160 \times 5 = \mathbf{5,800 \text{ notifications/sec}}$$
- **High-Priority (OTP) Share**: 10% of peak $\approx$ **580 QPS**.
- **Bulk Marketing Share**: 90% of peak $\approx$ **5,220 QPS**.

### B. Storage Sizing (1 Year Retention)
- **Payload Size per Notification Log**:
  - `notification_id`: UUID (16 bytes)
  - `user_id`: UUID (16 bytes)
  - `channel`: Enum (8 bytes)
  - `template_id`: String (16 bytes)
  - `variables`: JSONB ($\approx$ 250 bytes)
  - `status`: Enum (8 bytes)
  - `timestamps`: Created, Sent, Delivered (24 bytes)
  - Total per log record $\approx$ **350 bytes**.
- **Daily Storage**:
  $$100,000,000 \times 350 \text{ bytes} \approx \mathbf{35 \text{ GB / day}}$$
- **Annual Storage (with indexes & replication)**:
  $$35 \text{ GB/day} \times 365 \text{ days} \times 2 (\text{indexes + replication}) \approx \mathbf{25.5 \text{ TB / year}}$$
  *Storage Recommendation*: Use **PostgreSQL / CockroachDB** with monthly table partitioning for active records (last 30 days), and export older logs to **Amazon S3 / BigQuery** for analytics and compliance.

---

## 5. Step 3: High-Level Architecture & End-to-End Flow

```
                      END-TO-END NOTIFICATION ARCHITECTURE
                      
    [ Microservices: Auth / Billing / Orders / Social / Marketing ]
                                  │
                                  ▼ (gRPC / HTTPS POST)
    ┌─────────────────────────────────────────────────────────────┐
    │          Notification Ingestion API Service (Node.js)       │
    │  - Authenticates internal client using JWT / API Keys       │
    │  - Checks Idempotency Key in Redis (SET NX EX 600)          │
    │  - Validates payload against Zod Template Schema            │
    └──────────────┬───────────────────────────────┬──────────────┘
                   │                               │
    [ High-Priority OTP / Receipts ]  [ Low-Priority Marketing / Social ]
                   │                               │
                   ▼                               ▼
    ┌─────────────────────────────┐ ┌─────────────────────────────┐
    │ Kafka: `priority-high-topic`│ │ Kafka: `priority-low-topic` │
    │ 32 Partitions               │ │ 64 Partitions               │
    └──────────────┬──────────────┘ └──────────────┬──────────────┘
                   │                               │
                   ▼                               ▼
    ┌─────────────────────────────────────────────────────────────┐
    │                  Worker Pool (Consumer Fleet)               │
    │  1. Check User Notification Preferences (Redis Cache / DB)  │
    │  2. Check Frequency Capping (Sliding Window Log in Redis)   │
    │  3. Compile Template with dynamic variables (Mustache)      │
    │  4. Route to specific Channel Dispatcher Queue              │
    └───────┬──────────────────────┬──────────────────────┬───────┘
            │                      │                      │
            ▼                      ▼                      ▼
    ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
    │ Push Worker  │       │  SMS Worker  │       │ Email Worker │
    └───────┬──────┘       └───────┬──────┘       └───────┬──────┘
            │                      │                      │
     (Circuit Breaker)      (Circuit Breaker)      (Circuit Breaker)
            ▼                      ▼                      ▼
    ┌──────────────┐       ┌──────────────┐       ┌──────────────┐
    │ Apple APNs   │       │ Twilio /     │       │ SendGrid /   │
    │ Google FCM   │       │ Vonage       │       │ AWS SES      │
    └──────────────┘       └──────────────┘       └──────────────┘
            │                      │                      │
            └──────────────────────┼──────────────────────┘
                                   │
                                   ▼
    ┌─────────────────────────────────────────────────────────────┐
    │ Delivery Webhook Ingestion API ──► Kafka: `delivery-status` │
    │ ──► Updates Notification DB (PostgreSQL)                    │
    │ ──► On Exhausted Retries ──► Dead Letter Queue (DLQ)        │
    └─────────────────────────────────────────────────────────────┘
```

---

## 6. Step 4: Deep Dive & Technical Bottlenecks

### Deep Dive 1: Priority Queueing & Starvation Prevention
If all notifications flow into a single unified FIFO queue, a single marketing batch of 10 million promotional emails dispatched on Black Friday completely halts authentication OTP emails for hours.

**Solution: Strict Channel & Priority Segregation**:
1. **Isolated Broker Topics**:
   - `notifications.transactional.high`: Consumed by dedicated high-priority worker fleets with auto-scaling based on consumer lag. Target processing latency: **< 500ms**.
   - `notifications.promotional.low`: Consumed by a standard worker fleet with rate limit throttling.
2. **Guaranteed Capacity Allocation**:
   Worker pools are physically separated. High-priority workers never consume low-priority messages. Even if the low-priority queue backs up to 20 million messages, transactional workers operate with zero queue contention.

---

### Deep Dive 2: Idempotency & Deduplication Engine
Distributed systems inevitably produce duplicate network events due to network timeouts and client retries.

```
Incoming Request ──► Generate Key: SHA256(userId + eventType + idempotencyKey)
                             │
                             ▼
               Redis: SET notification:dedup:<hash> "PENDING" NX EX 600
                             │
            ┌────────────────┴────────────────┐
            │ Key Existed (False)             │ Key Did NOT Exist (True)
            ▼                                 ▼
   Reject duplicate event!             Proceed to enqueue in
   Return HTTP 200 with                Kafka broker; update status
   cached response                     to "DISPATCHED" upon send
```

**Implementation Strategy**:
1. The calling service passes an `idempotency_key` (e.g., `order_paid_ord_98432`).
2. The ingestion gateway computes `hash = sha256(clientId + idempotencyKey)`.
3. An atomic Redis operation executes: `SET notification:dedup:${hash} "PROCESSING" NX EX 600`.
4. If Redis returns `null`, the request is a duplicate; the gateway skips queueing and immediately responds with `HTTP 200 OK: { status: "already_queued" }`.

---

### Deep Dive 3: User Notification Preferences & Frequency Capping
Before sending any non-transactional notification, the system must evaluate two checks:

1. **User Channel Preference Engine**:
   - User profile contains granular opt-ins:
     ```json
     {
       "userId": "usr_42",
       "preferences": {
         "marketing_email": false,
         "marketing_push": true,
         "security_sms": true
       },
       "timezone": "America/New_York",
       "quietHours": { "start": "22:00", "end": "08:00" }
     }
     ```
   - These profiles are cached in Redis with a 24-hour TTL (`user:prefs:usr_42`).
   - If current time in user's timezone is within quiet hours and the notification is not classified as `EMERGENCY_TRANSACTIONAL`, the notification is delayed: scheduled into a Redis Sorted Set (`ZADD scheduled_notifications <unix_timestamp_8am> <notificationId>`).

2. **Frequency Capping (Anti-Spam)**:
   - To avoid overwhelming users, cap marketing push notifications to **3 per day**.
   - Redis Sliding Window Log using Sorted Sets:
     ```bash
     # Remove records older than 24 hours
     ZREMRANGEBYSCORE user:push_limit:usr_42 0 <now - 86400>
     # Count events in the last 24 hours
     ZCARD user:push_limit:usr_42
     # If count < 3, add current timestamp and allow
     ZADD user:push_limit:usr_42 <now> <notificationId>
     ```

---

### Deep Dive 4: Third-Party Vendor Failure, Circuit Breakers & Retries
Third-party providers (Twilio, SendGrid, APNs) experience periodic rate limits, 502 bad gateways, and regional brownouts.

1. **Exponential Backoff with Jitter**:
   Failed requests retry using formula:
   $$T_{\text{wait}} = \min(M, B \times 2^{\text{attempt}}) + \text{random\_jitter}$$
   Attempts are capped at 3 retries.
2. **Vendor Circuit Breaker Pattern**:
   If Twilio starts returning HTTP 500/503 errors at an error rate $> 50\%$ over a 30-second window, the circuit breaker opens:
   - Traffic automatically falls back to a secondary SMS vendor (**Vonage / AWS SNS**).
   - After a 60-second cooldown, the circuit enters `HALF-OPEN` state, testing 5% of traffic against Twilio before restoring full volume.
3. **Dead Letter Queue (DLQ)**:
   If all 3 retries across both primary and fallback vendors fail, the message is placed onto a dead-letter queue (`notifications-dlq`). A DLQ inspection dashboard alerts DevOps engineers and allows manual re-driving once vendor connectivity recovers.

---

## 7. Important Rules

1. **Never Send Plaintext OTPs / Sensitive Tokens to Logging Platforms**: Mask phone numbers, email addresses, and OTP secret codes in Winston/Datadog logs to remain GDPR and PCI-DSS compliant.
2. **Transaction Isolation**: Transactional notifications (payment receipts, account lockout) must completely bypass user frequency caps and quiet hours.
3. **Handle Channel Delivery Receipts Asynchronously**: Providers deliver status updates via HTTP webhooks (`delivered`, `bounced`, `spam_report`). Never process webhooks synchronously against your primary database. Push webhook events to a Kafka topic (`notification-receipts`) and update records via background consumers.
4. **Enforce Hard Timeouts on External HTTP Calls**: When invoking external vendor APIs (SendGrid, Twilio), set a strict connection timeout of 1,000ms and read timeout of 3,000ms. Never allow a hanging third-party connection to tie up your application worker pool.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Synchronous Vendor Dispatch in API Handlers
```typescript
// ❌ ANTI-PATTERN: Calling third-party API synchronously inside request handler!
app.post('/api/orders', async (req, res) => {
  const order = await createOrder(req.body);
  // If Twilio takes 4 seconds or times out, the user's checkout button spins!
  await twilioClient.messages.create({ to: req.user.phone, body: 'Order confirmed!' });
  res.status(201).json(order);
});
```
**Fix**: Immediately commit the order, write an event to Kafka / BullMQ, and respond to the user in $< 100\text{ms}$. The notification service consumes the event asynchronously.

### 2. Lack of In-Flight Lock during Template Rendering
If 5 events for the same user arrive concurrently, rendering templates and updating notification history without concurrency controls causes race conditions in user daily limits.

### 3. Missing Unsubscribe Header in Emails
Omitting the `List-Unsubscribe` header in automated promotional emails causes Gmail and Yahoo to route your domain's emails directly into spam folders, destroying domain reputation.

---

## 9. Best Practices

- **Dynamic Template Management**: Store notification copy in a centralized template repository (backed by S3 or MongoDB) supporting variable interpolation (`{{firstName}}`, `{{orderId}}`). This enables product and marketing teams to edit copy without deploying backend application code.
- **Provider Fallback Cascading**:
  - Primary SMS: Twilio
  - Secondary SMS: MessageBird / Sinch
  - Primary Email: SendGrid
  - Secondary Email: AWS SES
- **Structured Correlation IDs**: Generate an `X-Notification-ID` at the ingestion gateway. Pass this ID into Kafka headers, vendor custom metadata fields, and database logs to enable end-to-end distributed tracing.

---

## 10. Performance Considerations

- **Connection Reuse via HTTP/2**: APNs requires HTTP/2 with persistent connection pools. Establishing a new TLS connection for every push notification incurs 100ms+ overhead. Maintain long-lived HTTP/2 client connections to Apple and Google endpoints.
- **Batching API Invocations**: Use vendor batch endpoints where available (e.g., SendGrid Personalizations allows sending 1,000 distinct customized emails in a single HTTP request).
- **In-Memory Cache for User Preferences**: Cache user notification settings and push device tokens in Redis with an eviction policy of LRU. 90% of push notifications hit active devices whose tokens are hot in memory.

---

## 11. Security Considerations

- **PII Encryption at Rest**: Encrypt user phone numbers and email addresses in the notification database using AES-256 (PostgreSQL `pgcrypto` or application-level KMS encryption).
- **Webhook Signature Verification**: Verify HMAC SHA-256 signatures on incoming provider webhooks (e.g., Twilio `X-Twilio-Signature`, SendGrid `X-Twilio-Email-Event-Webhook-Signature`) to prevent attackers from spoofing delivery receipts.
- **Rate Limit Abuse Protection**: Protect public OTP request endpoints with Cloudflare Turnstile / reCAPTCHA and strict IP rate limits to prevent SMS toll fraud (SMS pumping attacks).

---

## 12. Alternatives

| Technology / Component | Chosen Approach | Alternative | Why We Chose It |
|---|---|---|---|
| **Message Broker** | Apache Kafka | RabbitMQ / Redis Streams | Kafka handles millions of events with replayable log retention and deterministic partition ordering per user. |
| **Worker Queue Engine** | BullMQ (Redis-backed) | Celery (Python) / AWS SQS | BullMQ provides native delayed scheduling (quiet hours) and sub-millisecond priority queues. |
| **Log Store** | PostgreSQL (Partitioned) | MongoDB | Relational integrity for user relationships and ACID compliance during state transitions. |
| **Cache & Deduplication**| Redis Cluster | Memcached | Atomic `SET NX EX`, rich data types (Sorted Sets for sliding window frequency capping). |

---

## 13. Trade-offs

- **At-Least-Once Delivery vs. Exactly-Once Delivery**:
  Achieving true distributed exactly-once delivery across external third-party telecommunication networks is mathematically impossible (the Two Generals' Problem). If Twilio sends the SMS but the network drops the HTTP 200 response, retrying may result in a duplicate message. We prioritize **reliability (at-least-once)** combined with **aggressive 10-minute client deduplication**, accepting that a rare network disruption could trigger a duplicate SMS rather than risking an undelivered message.
- **Decoupled Architecture vs. Operational Complexity**:
  Running Kafka, Redis Cluster, worker fleets, and circuit breakers introduces significant infrastructure overhead compared to a single monolith calling Twilio. However, this is mandatory to withstand 100M daily events without systemic cascading failures.

---

## 14. Real-World Usage & Implementation Example

Here is a production-grade TypeScript implementation of a **Notification Dispatch Engine** featuring Redis-based idempotency checks, frequency capping, priority queueing, and fallback routing.

```typescript
// notification-engine.ts
import { Redis } from 'ioredis';
import { z } from 'zod';

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// 1. Notification Event Schema
export const NotificationRequestSchema = z.object({
  idempotencyKey: z.string().min(8),
  userId: z.string().uuid(),
  channel: z.enum(['PUSH', 'SMS', 'EMAIL']),
  priority: z.enum(['HIGH', 'LOW']),
  templateId: z.string(),
  variables: z.record(z.string(), z.any()),
  isMarketing: z.boolean().default(false),
});

export type NotificationRequest = z.infer<typeof NotificationRequestSchema>;

export interface DeliveryResult {
  success: boolean;
  provider: string;
  messageId?: string;
  error?: string;
}

// 2. Mock Providers with Fallback
class SmsDispatcher {
  async dispatchWithFallback(phone: string, message: string): Promise<DeliveryResult> {
    try {
      // Primary Provider: Twilio
      return await this.sendTwilio(phone, message);
    } catch (err: any) {
      console.warn(`[TWILIO FAILED]: ${err.message}. Cascading to secondary provider...`);
      // Secondary Fallback: Vonage
      return await this.sendVonage(phone, message);
    }
  }

  private async sendTwilio(phone: string, message: string): Promise<DeliveryResult> {
    // Simulated Twilio API call
    if (Math.random() < 0.1) throw new Error('Twilio 503 Service Unavailable');
    return { success: true, provider: 'TWILIO', messageId: `tw_${Date.now()}` };
  }

  private async sendVonage(phone: string, message: string): Promise<DeliveryResult> {
    // Simulated Vonage Fallback API call
    return { success: true, provider: 'VONAGE', messageId: `vg_${Date.now()}` };
  }
}

// 3. Core Notification Router
export class NotificationService {
  private smsDispatcher = new SmsDispatcher();

  /**
   * Evaluates idempotency and frequency caps before dispatch
   */
  async processNotification(payload: NotificationRequest): Promise<{ status: string; details?: any }> {
    const validated = NotificationRequestSchema.parse(payload);

    // Step A: Idempotency Lock
    const dedupKey = `notif:dedup:${validated.userId}:${validated.idempotencyKey}`;
    const acquired = await redis.set(dedupKey, 'IN_PROGRESS', 'EX', 600, 'NX');
    if (!acquired) {
      return { status: 'SKIPPED_DUPLICATE', details: 'Notification already processed or in progress' };
    }

    try {
      // Step B: Frequency Capping for Marketing
      if (validated.isMarketing) {
        const canSend = await this.checkFrequencyCap(validated.userId);
        if (!canSend) {
          return { status: 'RATE_LIMITED', details: 'User exceeded daily marketing notification quota' };
        }
      }

      // Step C: Compile Template (simulated)
      const messageBody = `Template [${validated.templateId}]: Hi user, your code is ${validated.variables.otp || 'N/A'}`;

      // Step D: Dispatch to Provider
      let result: DeliveryResult;
      if (validated.channel === 'SMS') {
        result = await this.smsDispatcher.dispatchWithFallback('+1234567890', messageBody);
      } else {
        result = { success: true, provider: 'MOCK_PUSH_OR_EMAIL', messageId: `mock_${Date.now()}` };
      }

      // Step E: Update Deduplication status to COMPLETED
      await redis.set(dedupKey, JSON.stringify(result), 'EX', 600);

      return { status: 'DISPATCHED', details: result };
    } catch (error: any) {
      // Release lock on fatal processing error so caller can retry
      await redis.del(dedupKey);
      throw error;
    }
  }

  /**
   * Redis Sliding Window Rate Limiter: Max 3 marketing messages per 24 hours
   */
  private async checkFrequencyCap(userId: string): Promise<boolean> {
    const key = `notif:freq:${userId}`;
    const now = Date.now();
    const windowStart = now - 24 * 60 * 60 * 1000;

    const multi = redis.multi();
    multi.zremrangebyscore(key, 0, windowStart);
    multi.zcard(key);
    multi.zadd(key, now, `${now}-${Math.random()}`);
    multi.expire(key, 86400);

    const results = await multi.exec();
    if (!results) return false;

    const count = (results[1][1] as number) || 0;
    return count < 3;
  }
}
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: What is the difference between Push, SMS, and In-App notifications?
**Answer**:
- **Push Notifications**: Delivered to the device OS (iOS APNs, Android FCM) over a persistent OS-level socket. Cheap, fast, but requires user permission; messages can be silently dropped if the device is offline or token expires.
- **SMS**: Delivered over telecom cellular signaling channels (SS7 protocol). Universal reach without internet, highly reliable, but expensive ($\approx \$0.01 - \$0.08$ per message) with lower throughput.
- **In-App Notifications**: Displayed only while the user has the application actively open (bell icon feed). Delivered via WebSockets or polling; zero external carrier costs.

### 2. Conceptual: How do you prevent low-priority promotional batches from starving time-sensitive OTP notifications?
**Answer**:
By establishing **physical consumer and queue decoupling**:
1. High-priority (OTP, password reset) and low-priority (marketing blasts) messages are published to completely distinct Kafka topics (`notif.priority.high` vs `notif.priority.low`).
2. High-priority topics are consumed by dedicated worker fleets provisioned with minimum baseline concurrency and aggressive auto-scaling on consumer lag.
3. High-priority workers never touch low-priority queues. Even if the low-priority queue backs up by millions of events, the high-priority pipeline operates with zero queue lag.

### 3. Implementation: How would you design the idempotency mechanism to avoid duplicate SMS charges?
**Answer**:
1. Client microservices must supply a unique `idempotency_key` (e.g., `order_10092_auth_sms`).
2. Upon receiving the dispatch request, the ingestion gateway performs an atomic `SET notif:dedup:<key> "PROCESSING" EX 600 NX` in Redis.
3. If Redis returns `null`, the request is rejected as a duplicate.
4. When the SMS provider responds with a confirmation `messageId`, Redis updates the key value to the result JSON.
5. If the provider fails transiently, the key is deleted to allow legitimate immediate retries.

### 4. Debugging: During a flash sale, notification latency spikes from 1s to 45s. How do you diagnose the bottleneck?
**Answer**:
1. **Check Consumer Lag**: Inspect Kafka consumer lag per partition. If lag is growing, workers cannot keep pace with ingress.
2. **Profile Worker Latency Breakdown**:
   - Time spent reading Redis preferences?
   - Time waiting on external vendor HTTP connections (Twilio/SendGrid)?
3. **Inspect Thread & Socket Pools**: A saturated HTTP keep-alive connection pool or missing DNS resolution caching can cause worker HTTP calls to block.
4. **Identify Rate Limiting / 429s from Vendors**: If Twilio or APNs returns HTTP 429 Too Many Requests, worker threads get blocked backing off and retrying.

### 5. Scenario: How do you respect quiet hours (no marketing SMS between 10 PM and 8 AM) across worldwide time zones?
**Answer**:
1. Query the recipient’s user profile to retrieve their IANA time zone (e.g., `Europe/London`).
2. Convert current UTC time to the user’s local time.
3. If local time falls between 22:00 and 08:00:
   - Calculate the Unix timestamp corresponding to 08:01 AM the following morning in their local zone.
   - Enqueue the notification into a **Redis Sorted Set** (`ZADD scheduled_tasks <target_unix_ts> <notification_id>`) or a delayed message queue.
   - A cron-like scheduler daemon runs `ZRANGEBYSCORE scheduled_tasks 0 <now>`, pulls matured notifications, and re-injects them into the standard processing queue at 8 AM.

### 6. Advanced: If APNs reports that an Apple device push token is invalid (`BadDeviceToken` or `Unregistered`), what should your system do?
**Answer**:
When an iOS user uninstalls an app, APNs invalidates the push token and returns HTTP 410 `Gone` (`Unregistered`). 
The worker must:
1. Immediately flag the token as `INACTIVE` in the user device database.
2. Evict the cached token from Redis.
3. Stop sending further push events to this token (avoiding wasted network bandwidth and preventing Apple from throttling the app for repeatedly calling dead tokens).

---

## 16. Coding Questions & Practical Challenges

1. **Sliding Window Counter in Redis**: Write a Lua script for Redis that atomically checks if a user has received more than 5 notifications in the last 60 minutes and increments the counter if permitted.
2. **Exponential Backoff with Full Jitter**: Implement a retry function in TypeScript that catches external API failures, applies randomized exponential delay, and abandons after 4 attempts.
3. **Template Token Replacer**: Write a high-performance string replacement engine that parses `Hello {{name}}, your order {{orderId}} is ready!` and injects variables without regex catastrophic backtracking.

---

## 17. Common Interview Traps

- **Trap 1: Assuming APNs/FCM provide 100% delivery guarantees**: APNs is a best-effort delivery service. If an iPhone is offline or in low-power mode, Apple may coalesce or drop background push notifications. Never use Push as the sole delivery mechanism for critical financial alerts without an SMS or Email fallback.
- **Trap 2: Storing device push tokens as single values on the user table**: A single user may own an iPhone, an iPad, and an Android tablet. The schema must support a `1-to-many` relationship: `user_devices (user_id, device_token, platform, last_seen_at)`.
- **Trap 3: Forgetting to handle Webhook race conditions**: A provider delivery webhook (`status: DELIVERED`) can arrive *before* your worker finishes writing the initial `status: SENT` record due to network timing. The webhook ingestion handler must perform an upsert or check state transition validity.

---

## 18. Revision Summary

- **Architecture**: Ingestion API $\rightarrow$ Redis Deduplication $\rightarrow$ Priority Kafka Topics $\rightarrow$ Worker Fleets $\rightarrow$ Multi-Channel Vendors (APNs, FCM, Twilio, SendGrid) $\rightarrow$ DLQ.
- **Key Mechanics**:
  - **Priority Queues**: Segregate critical transactional OTPs from marketing batches.
  - **Idempotency**: Atomic `SET NX EX` in Redis using `sha256(userId + idempotencyKey)`.
  - **User Preferences**: Enforce opt-outs, quiet hours scheduling via Sorted Sets, and sliding window frequency capping.
  - **Fault Tolerance**: Circuit breaker pattern with automatic fallback vendors (e.g., Twilio $\rightarrow$ Vonage).
  - **Receipt Tracking**: Asynchronous webhook processing via message streams.

---

## 19. Quick Reference Cheatsheet

```bash
# Redis Deduplication Key Pattern
SET notif:dedup:<user_id>:<idempotency_key> "LOCKED" NX EX 600

# Redis Frequency Capping (Sliding Window Log)
ZREMRANGEBYSCORE notif:freq:<user_id> 0 <now - 86400>
ZCARD notif:freq:<user_id>
ZADD notif:freq:<user_id> <now> <unique_event_id>

# Kafka Topic Layout
notif.transactional.high   # OTPs, Security alerts (Target: <500ms)
notif.transactional.normal # Order updates, Receipts (Target: <5s)
notif.promotional.low      # Marketing, Product news (Target: <10m)
notif.dead-letter-queue    # Exhausted retries for manual triage

# Typical Latency SLAs
Transactional Push/SMS: < 2 seconds (P99)
Promotional Email:       < 15 minutes (P99)
```
