# Webhooks: Architecture, HMAC SHA-256 Signatures, and Delivery Reliability

## 1. What is it?
A Webhook (also referred to as a "Reverse API" or HTTP Push Notification) is an architectural pattern where a service provider pushes real-time, event-driven HTTP `POST` notifications to a customer's destination URL immediately when a specific business event occurs (e.g. `payment.succeeded`, `invoice.paid`, `order.shipped`). The core engineering components comprise:
1. **Event Dispatcher & Queue Engine:** Background worker queues (BullMQ, Celery, AWS SQS) that decouple event emission from webhook delivery.
2. **Cryptographic Signing (HMAC SHA-256):** Securing the payload so the receiving server can verify authenticity and payload integrity.
3. **Retry Strategy with Exponential Backoff & Jitter:** Automatically retrying failed webhook deliveries across several days.
4. **Dead Letter Queue (DLQ):** Quarantining permanently failed endpoints for customer inspection.

```
+-------------------------------------------------------------------------------+
|                       ENTERPRISE WEBHOOK DELIVERY PIPELINE                    |
+-------------------------------------------------------------------------------+
| Business Event Occurs (e.g. Payment Gateway charges card)                     |
|    |                                                                          |
|    v                                                                          |
| Enqueue Job to Redis / BullMQ: { event: 'charge.successful', customerId: .. } |
|    |                                                                          |
|    v                                                                          |
| Webhook Worker Process:                                                       |
|    ├── 1. Generate Timestamp: t = Date.now()                                  |
|    ├── 2. Compute HMAC SHA-256: crypto.createHmac('sha256', secret)          |
|    │        .update(`${t}.${rawPayload}`).digest('hex')                       |
|    ├── 3. Fire HTTP POST with X-Signature & X-Timestamp headers               |
|    v                                                                          |
| Response:                                                                     |
|    ├── HTTP 2xx ---> SUCCESS: Mark delivered                                  |
|    └── HTTP 4xx/5xx/Timeout ---> RETRY: Enqueue with Exponential Backoff      |
|                                         (After 10 retries -> Send to DLQ)     |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?
Without webhooks, clients must continuously query the server via **polling**:
- A merchant client fires `GET /api/orders/123/status` every 2 seconds to check if a customer finished paying.
- **Consequences:** 99.9% of polling requests return "Still Pending", generating massive server CPU load, database read spikes, and wasted bandwidth.
- Polling introduces latency: an event that happens at 12:00:01 might not be detected until the next poll at 12:00:10.

Webhooks eliminate polling entirely: the moment an event happens on the server, an HTTP POST delivers the event to the merchant in real time (<500ms).

---

## 3. Mental Model
Think of Webhooks as a **Delivery Courier Knocking on Your Door vs. Walking to the Post Office**:
- **Polling (The Anxious Citizen):** You walk to the post office every 15 minutes, stand in line, and ask the clerk: "Has my passport arrived yet?" The clerk says no. You repeat this 50 times a day.
- **Webhooks (The Doorstep Courier with a Sealed Wax Envelope):** You stay home and work peacefully. When the passport arrives, the courier rings your doorbell and hands you the envelope.
- **HMAC Signatures (The Royal Wax Seal):** You don't just accept any package from strangers. You inspect the royal wax seal stamped on the envelope. If the seal matches the secret royal ring (Shared Secret), you know the package is 100% authentic and hasn't been opened or tampered with.

---

## 4. Basic Example

### Verifying an Incoming HMAC SHA-256 Webhook (Node.js Consumer)
```typescript
import crypto from 'crypto';
import { Request, Response } from 'express';

export function verifyWebhookHandler(req: Request, res: Response) {
  // CRITICAL: Must use raw string body, NOT parsed JSON!
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);
  const signatureHeader = req.headers['x-signature-256'] as string;
  const timestampHeader = req.headers['x-timestamp'] as string;
  const webhookSecret = process.env.WEBHOOK_SECRET!;

  // 1. Replay Attack Prevention (Tolerate clock skew up to 5 minutes)
  const currentTime = Math.floor(Date.now() / 1000);
  const webhookTime = parseInt(timestampHeader, 10);
  if (Math.abs(currentTime - webhookTime) > 300) {
    return res.status(400).json({ error: 'Timestamp out of acceptable tolerance window' });
  }

  // 2. Compute Expected HMAC SHA-256 Signature
  const signedPayload = `${timestampHeader}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(signedPayload)
    .digest('hex');

  // 3. Timing-Safe Buffer Comparison (Prevents Timing Attacks)
  const isMatch = crypto.timingSafeEqual(
    Buffer.from(signatureHeader, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );

  if (!isMatch) {
    return res.status(401).json({ error: 'Invalid cryptographic signature' });
  }

  console.log('Authentic webhook verified successfully!');
  return res.status(200).json({ received: true });
}
```

---

## 5. Real Example

### Enterprise Outgoing Webhook Dispatcher with BullMQ and Exponential Backoff
```typescript
// workers/webhookWorker.ts
import { Worker, Queue } from 'bullmq';
import crypto from 'crypto';
import axios from 'axios';

interface WebhookJobData {
  webhookId: string;
  endpointUrl: string;
  secretKey: string;
  event: string;
  payload: Record<string, any>;
}

// 1. Configure Webhook Queue with Exponential Backoff Retry Strategy
export const webhookQueue = new Queue<WebhookJobData>('webhooks', {
  connection: { host: 'localhost', port: 6379 },
  defaultJobOptions: {
    attempts: 5, // Try 5 times before failing to DLQ
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s, 10s, 20s, 40s...
    },
    removeOnComplete: true,
  },
});

// 2. Background Worker executing delivery
export const webhookWorker = new Worker<WebhookJobData>(
  'webhooks',
  async (job) => {
    const { endpointUrl, secretKey, event, payload } = job.data;
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = JSON.stringify({ event, data: payload, timestamp });

    // Compute HMAC SHA-256
    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    // Fire HTTP POST with short 10s timeout
    await axios.post(endpointUrl, rawBody, {
      headers: {
        'Content-Type': 'application/json',
        'X-Signature-256': signature,
        'X-Timestamp': timestamp,
        'User-Agent': 'EnterpriseWebhookDispatcher/1.0',
      },
      timeout: 10000, // 10s socket timeout
    });

    console.log(`Successfully dispatched event ${event} to ${endpointUrl}`);
  },
  { connection: { host: 'localhost', port: 6379 }, concurrency: 25 }
);

webhookWorker.on('failed', (job, err) => {
  console.warn(`Webhook job ${job?.id} failed on attempt ${job?.attemptsMade}: ${err.message}`);
});
```

---

## 6. Under the Hood

### 1. Timing-Safe Comparison (`crypto.timingSafeEqual`)
Why standard string comparison (`signature === expected`) is vulnerable:
- Standard JavaScript string comparison halts on the **first mismatched character**:
  - `a987...` vs `b987...` fails in 0.0001ms.
  - `a987...` vs `a988...` fails in 0.0004ms.
- A remote attacker measuring network latency with nanosecond precision can deduce matching characters one by one (**Timing Attack**).
- `crypto.timingSafeEqual` forces the CPU to compare **every single byte** regardless of match, taking constant execution time and completely neutralizing timing attacks.

### 2. The Replay Attack Defense
If an attacker intercepts a valid webhook over insecure Wi-Fi, they can replay the exact same signed payload 10 times to re-credit an account!
- **Mitigation:** We sign `${timestamp}.${rawBody}`.
- If the receiver checks `Math.abs(Date.now() - timestamp) > 300`, an attacker cannot replay the payload after 5 minutes.

---

## 7. Important Rules
1. **Always Verify with Raw String Bodies:** Never verify HMAC signatures against a re-serialized JSON object (`JSON.stringify(req.body)`). JSON serialization alters whitespace, line breaks, and key ordering, changing the SHA-256 hash. Always capture the raw byte buffer from the incoming network stream.
2. **Return HTTP 200 Fast (<2 Seconds):** When receiving a webhook, **do not execute slow database transactions or send emails synchronously**! Immediately validate the signature, push the job to your internal background queue, and return `HTTP 200 OK`. If you take >5-10 seconds, the sender will time out and trigger duplicate retries!
3. **Idempotent Webhook Processing:** Webhooks are guaranteed to be delivered **at least once**, not exactly once. Receiving servers must use the webhook event ID (`event.id`) to deduplicate events and prevent duplicate processing.
4. **Implement Exponential Backoff with Jitter:** When retrying failed webhooks, always add random jitter (random milliseconds) to avoid the "Thundering Herd" problem on customer servers.

---

## 8. Common Mistakes

### Mistake 1: Verifying Signatures Against `req.body` (Parsed JSON)
```typescript
// ❌ WRONG: Fails signature verification in production!
const signature = crypto.createHmac('sha256', secret).update(JSON.stringify(req.body)).digest('hex');
// Whitespace differences cause hash mismatch!
```
**Fix:** Use `express.raw({ type: 'application/json' })` or capture the raw buffer stream.

### Mistake 2: Running Heavy Operations Synchronously in the Webhook Receiver
```typescript
// ❌ TIMEOUT FAILURE:
app.post('/webhook', async (req, res) => {
  verifySignature(req);
  await generatePdfInvoice(); // Takes 8 seconds!
  await sendCustomerEmail();  // Takes 3 seconds!
  res.status(200).send();     // Webhook sender already timed out at 10s and queued a retry!
});
```
**Fix:** Enqueue the job to BullMQ/SQS and respond with `200 OK` in <50ms!

---

## 9. Best Practices
1. **Provide a Customer Webhook Dashboard:** Display recent delivery attempts, status codes, request/response headers, and a "Resend Event" button.
2. **Automatic Endpoint Disabling:** If a customer's webhook endpoint fails continuously for 3 days (>50 failed attempts), mark the endpoint as `INACTIVE` and send an email alert to the account admin.
3. **Dedicated Outbound IP Addresses:** Publish a static list of outgoing webhook IP addresses so enterprise customers can whitelist them in their corporate firewalls.

---

## 10. Performance Considerations
- **Non-Blocking Delivery Workers:** Keep webhook workers isolated from your primary web application servers. If 1,000 webhooks fail simultaneously, your worker pool will handle the backoff delays without starving HTTP web traffic.
- **Connection Pooling:** Use `keep-alive` HTTP connection pools in your worker processes to avoid establishing fresh TCP/SSL handshakes on every delivery.

---

## 11. Security Considerations
- **SSRF (Server-Side Request Forgery) in Outgoing Webhooks:** A user can register a webhook pointing to `http://169.254.169.254/latest/meta-data/` (AWS instance metadata) or `http://localhost:5432` (internal PostgreSQL). **Always validate destination URLs**: resolve DNS and reject private/loopback IP ranges (`10.0.0.0/8`, `127.0.0.0/8`, `192.168.0.0/16`, `169.254.0.0/16`)!
- **Mutual TLS (mTLS):** For ultra-high security financial webhooks, support mutual TLS certificates.

---

## 12. Alternatives
- **Long Polling / Server-Sent Events (SSE):** Suitable for browser-to-server notifications, but unsuitable for server-to-server asynchronous events.
- **Message Brokers (AWS EventBridge / Kafka / RabbitMQ):** Ideal for internal microservice communication within the same cloud ecosystem.

---

## 13. Trade-offs

| Strategy | Advantages | Drawbacks |
| :--- | :--- | :--- |
| **Webhooks (HTTP Push)**| Universal standard; works across any programming language | Receiver server must be publicly accessible |
| **Polling (GET)** | Simple client implementation; works behind NAT/firewall | Massive wasted server load; high event latency |
| **Kafka / SQS Stream** | Guaranteed ordering; massive throughput | Requires client to connect to cloud broker |

---

## 14. Real-World Usage
- **Stripe Webhooks:** Dispatches events for payment completions, subscription churn, and disputed charges, signed via `Stripe-Signature`.
- **GitHub Webhooks:** Powers modern CI/CD pipelines (GitHub Actions, Vercel, CircleCI), triggering builds upon `git push` events.

---

## 15. Placement Interview Questions

### Basic
**Q: What is a Webhook and how does it differ from traditional API polling?**  
*Answer:* A Webhook is an event-driven HTTP push notification where the server sends an HTTP `POST` request to a customer's pre-configured URL immediately when an event occurs. In polling, the client repeatedly sends HTTP `GET` requests at fixed intervals to check if state has changed, wasting significant network bandwidth and server processing power.

### Conceptual
**Q: How does an HMAC SHA-256 signature secure a webhook payload?**  
*Answer:* The sender and receiver share a private secret key. The sender hashes the payload combined with the secret key using HMAC SHA-256 and sends the resulting signature in a header (`X-Signature`). The receiver computes the exact same hash using the shared secret and compares it with the header. This guarantees both **authenticity** (only someone with the shared secret could generate the signature) and **data integrity** (if a single character was altered in transit, the signature check fails).

### Implementation
**Q: Why must timing attacks be prevented during webhook signature verification, and how is it achieved in Node.js?**  
*Answer:* Standard string equality (`===`) short-circuits on the first non-matching character, leaking timing information that an attacker can measure to determine the signature byte-by-byte. In Node.js, timing attacks are prevented by using `crypto.timingSafeEqual(bufferA, bufferB)`, which forces constant-time comparison across all bytes regardless of match.

### Debugging
**Q: A webhook consumer verifies HMAC signatures in Express, but the verification always fails in production while passing in local curl tests. Why?**  
*Answer:* In Express, `express.json()` middleware parses the incoming stream into a JavaScript object. If the developer calls `JSON.stringify(req.body)` to re-generate the string for signature verification, the re-serialized string has altered whitespace, line breaks, or property ordering, causing the SHA-256 hash to differ. The consumer must preserve and verify against the **raw, unmodified byte buffer** received from the socket stream.

### Scenario
**Q: You are architecting an outgoing webhook system. A customer's server crashes, and their endpoint returns 500 errors. How do you prevent your webhook queue from being clogged while ensuring eventual delivery?**  
*Answer:*
1. Implement **Exponential Backoff with Jitter** (e.g., retry after 5s, 30s, 5m, 30m, 2h, 12h, 24h).
2. Isolate retries into a separate delayed queue so fresh webhooks are not delayed by failing endpoints.
3. If delivery fails after maximum attempts (e.g. 10 retries over 3 days), move the job to a **Dead Letter Queue (DLQ)** and flag the endpoint as paused in the database.

### Advanced
**Q: How do you prevent Server-Side Request Forgery (SSRF) when allowing users to register arbitrary webhook URLs?**  
*Answer:* An attacker could register internal intranet URLs (e.g. `http://169.254.169.254/latest/meta-data/` or `http://10.0.0.5/admin`). To defend against this:
1. Parse the destination URL hostname and execute DNS resolution (`dns.lookup`).
2. Verify that the resolved IP address is NOT in a private, loopback, or link-local range (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`).
3. Disallow redirect following (`maxRedirects: 0`) to prevent the destination URL from redirecting to an internal IP.

---

## 16. Coding Questions

### Problem: Implement a Safe Webhook Dispatcher with SSRF IP Filtering
```typescript
// utils/safeWebhookDispatcher.ts
import dns from 'dns/promises';
import ipaddr from 'ipaddr.js';
import axios from 'axios';

export async function safePostWebhook(url: string, payload: any, headers: Record<string, string>) {
  const parsedUrl = new URL(url);

  // 1. Enforce HTTPS in production
  if (process.env.NODE_ENV === 'production' && parsedUrl.protocol !== 'https:') {
    throw new Error('Webhooks must use HTTPS');
  }

  // 2. Resolve DNS and Prevent SSRF to Internal IPs
  const addresses = await dns.lookup(parsedUrl.hostname, { all: true });

  for (const { address } of addresses) {
    const addr = ipaddr.parse(address);
    const range = addr.range();

    // Reject private, loopback, linkLocal, carrierGradeNat, etc.
    if (['loopback', 'private', 'linkLocal', 'carrierGradeNat'].includes(range)) {
      throw new Error(`SSRF Blocked: Destination resolves to restricted IP range: ${address}`);
    }
  }

  // 3. Dispatch HTTP POST with disabled redirects
  return await axios.post(url, payload, {
    headers,
    timeout: 5000,
    maxRedirects: 0, // Prevent redirecting to internal intranet
  });
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "Webhooks guarantee exactly-once delivery."  
  *Truth:* False! Webhooks provide **at-least-once delivery**. Network failures, timeouts, and retries can cause duplicate events to be received. Consumers must implement idempotent deduplication using event IDs.
- **Trap 2:** "The receiver should process all business logic before responding with HTTP 200."  
  *Truth:* False. Heavy synchronous processing causes request timeouts. The receiver must enqueue the event and return `200 OK` immediately within 50-100ms.

---

## 18. Revision Summary
- Webhooks push real-time event notifications via HTTP `POST`, eliminating wasteful polling.
- Secure payloads using HMAC SHA-256 signatures and timestamp headers to prevent tampering and replay attacks.
- Use `crypto.timingSafeEqual` to prevent timing attacks during signature verification.
- Consumers must respond with `200 OK` immediately and process tasks asynchronously in a background worker.
- Implement exponential backoff, jitter, and Dead Letter Queues (DLQ) for failed outgoing webhooks.

---

## 19. Quick Reference

```
+--------------------+---------------------------+-----------------------------------------------+
| Webhook Header     | Example Value             | Architectural Purpose                         |
+--------------------+---------------------------+-----------------------------------------------+
| X-Signature-256    | 8f9b2d... (Hex SHA-256)   | Verifies authenticity and payload integrity   |
| X-Timestamp        | 1773582400                | Replay attack prevention (5m tolerance)       |
| crypto.timingSafeEqual | Constant-time compare | Eliminates timing attacks on signature checks |
| Response Policy    | Immediate HTTP 200 OK     | Acknowledges receipt; prevents retry cascade  |
| Consumer Model     | At-Least-Once Delivery    | Consumer must deduplicate events idempotently |
| Outgoing Defense   | DNS SSRF IP Whitelisting  | Blocks calls to internal metadata / intranet  |
+--------------------+---------------------------+-----------------------------------------------+
```
