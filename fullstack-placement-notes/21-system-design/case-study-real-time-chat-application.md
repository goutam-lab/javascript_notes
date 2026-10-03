# System Design Case Study: Real-Time Chat & Messaging Platform (WhatsApp / Slack)

## 1. What is it?
A **Real-Time Chat & Messaging Platform** (such as WhatsApp, Slack, Discord, or Microsoft Teams) is an event-driven distributed system designed to deliver bidirectional, low-latency text messages, media, and status events between millions of concurrent users.

Unlike standard REST APIs that operate on a unidirectional request-response cycle (where clients pull data from servers), real-time chat platforms rely on **persistent bidirectional connections** (primarily **WebSockets**) so the server can push incoming messages to recipients instantly (<50ms) without polling.

Core features include 1-to-1 direct messaging, group channels, online presence detection ("User is Online / Away"), typing indicators, delivery/read receipts (single vs. double checkmarks), and offline message queueing.

```
       1-to-1 REAL-TIME CHAT MESSAGE FLOW
┌────────┐     1. Send Message via WebSocket     ┌────────────────────────┐
│ User A │ ────────────────────────────────────► │ Gateway Node 1         │
└────────┘                                       └───────────┬────────────┘
                                                             │
                                                             ▼
                                                 ┌────────────────────────┐
                                                 │ Redis Pub/Sub / Kafka  │
                                                 │ Channel: `chat:user_B` │
                                                 └───────────┬────────────┘
                                                             │
                                                             ▼
┌────────┐     2. Push Message via WebSocket     ┌────────────────────────┐
│ User B │ ◄──────────────────────────────────── │ Gateway Node 2         │
└────────┘                                       └───────────┬────────────┘
                                                             │
                                                             ▼
                                                 ┌────────────────────────┐
                                                 │ Message Store          │
                                                 │ (Apache Cassandra /    │
                                                 │  ScyllaDB Wide-Column) │
                                                 └────────────────────────┘
```

---

## 2. Why does it exist?
Designing a real-time messaging platform at scale introduces unique distributed engineering challenges:

1. **Massive Persistent Socket Concurrency (The C10K / C1000K Problem)**: Supporting 50 Million Daily Active Users means managing tens of millions of active, open TCP WebSocket connections simultaneously across application server fleets.
2. **The Connection-to-Node Routing Dilemma**: User A is connected to WebSocket Server 1 (in Virginia). User B is connected to WebSocket Server 84 (in Frankfurt). Server 1 has no direct memory access to Server 84's sockets. The system requires a distributed message broker (such as **Redis Pub/Sub** or **Kafka**) to route messages across horizontal servers.
3. **High-Throughput Write-Heavy Persistence**: Unlike read-heavy systems (like Twitter or URL shorteners), chat is **heavily write-intensive**: every single message sent must be written to disk with low latency and partitioned chronologically. Traditional relational databases (PostgreSQL) choke under millions of small write commits; distributed wide-column stores (Cassandra/ScyllaDB) are required.
4. **Presence Tracking Overhead**: If 10,000 users in a shared channel constantly broadcast "User is Online / User is Typing" events, naive broadcasting generates $10,000^2 = 100,000,000$ network events per minute, instantly crashing the gateway.

---

## 3. Step 1: Requirements Clarification

### Functional Requirements
1. **1-to-1 Direct Messaging**: Real-time message exchange between two users with sub-50ms delivery latency.
2. **Group Chats**: Support group channels with up to 500 members.
3. **Presence Detection**: Show online/offline status in real time.
4. **Message Receipts**: Track status: *Sent*, *Delivered* (reached device), and *Read* (viewed by user).
5. **Offline Message Storage**: If a user is offline, store messages reliably and push them as soon as they reconnect.

### Non-Functional Requirements
1. **Low Latency**: End-to-end message delivery under 50ms (p99).
2. **High Availability (HA)**: 99.99% availability.
3. **Strict Message Ordering**: Messages must be displayed in strict chronological sequence within a conversation.
4. **Zero Message Loss**: Messages must persist across multi-AZ storage before being marked as sent.

### Out of Scope / Non-Goals
- End-to-end encryption (Signal protocol key exchange) and voice/video calling (WebRTC media relays) deferred to v2.

---

## 4. Step 2: Capacity Estimation & Back-of-the-Envelope Math

Let us establish realistic traffic assumptions:
- **Daily Active Users (DAU)**: 50 Million.
- **Messages per User per Day**: 40 messages sent/received.
- **Peak Traffic Multiplier**: 2x.

### A. Message Throughput & QPS
$$\text{Total Daily Messages} = 50,000,000 \times 40 = \mathbf{2 \text{ Billion messages/day}}$$
$$\text{Average Message Write QPS} = \frac{2,000,000,000}{86,400 \text{ sec}} \approx \mathbf{23,000 \text{ msgs/sec}}$$
$$\text{Peak Message Write QPS (2x)} \approx \mathbf{46,000 \text{ msgs/sec}}$$

### B. Storage Sizing (5 Years)
- **Average Message Size**: 150 bytes (message ID, sender ID, receiver ID, timestamp, text content).
- **Daily Storage Growth**: $2,000,000,000 \times 150 \text{ bytes} = \mathbf{300 \text{ Gigabytes/day}}$.
- **Annual Storage Growth**: $300\text{ GB} \times 365 \approx \mathbf{110 \text{ Terabytes/year}}$.
- **5-Year Storage**: $\approx \mathbf{550 \text{ Terabytes}}$.
  *Insight*: 550 TB of write-heavy, time-ordered data requires a distributed NoSQL wide-column database (such as **Apache Cassandra** or **ScyllaDB**).

### C. Persistent Connection & Memory Sizing
- **Peak Concurrent Open WebSockets**: 20% of DAU connected simultaneously = **10 Million concurrent sockets**.
- Each open WebSocket connection consumes roughly 10KB of memory in Node.js / Go (TCP socket buffer + state).
  $$\text{Total Gateway RAM} = 10,000,000 \times 10 \text{ KB} \approx \mathbf{100 \text{ Gigabytes RAM}}$$
  *Fleet Sizing*: 10 servers with 16GB RAM each, or 50 lightweight container pods with 2GB RAM each, can hold 10 million concurrent WebSockets easily.

---

## 5. Step 3: High-Level Architecture & End-to-End Flow

```
[ Client A (Sender) ]                             [ Client B (Receiver) ]
         │                                                   ▲
         │ 1. WebSocket (WSS)                                │ 6. WebSocket (WSS)
         ▼                                                   │
┌─────────────────────────┐                         ┌────────┴────────────────┐
│ WebSocket Gateway Node 1│                         │ WebSocket Gateway Node 2│
│ (Holds Client A Socket) │                         │ (Holds Client B Socket) │
└────────────┬────────────┘                         └────────▲────────────────┘
             │                                               │
             ├── 2. Auth & Route Message                     │ 5. Local Delivery
             ▼                                               │
┌────────────────────────────────────────────────────────────┴────────┐
│ Distributed Message Router & Pub/Sub (Redis Pub/Sub / Kafka)        │
│ Channel: `user:channel:B`                                           │
└────────────┬────────────────────────────────────────────────────────┘
             │
             ├── 3. Asynchronous Persistence
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Distributed Message Store (Apache Cassandra / ScyllaDB)             │
│ Partition Key: `conversation_id` | Clustering Key: `message_id DESC`│
└─────────────────────────────────────────────────────────────────────┘
             │
             ├── 4. If Client B is Offline
             ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Offline Push Notification Service (Apple APNs / Google FCM)         │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Step 4: Deep Dive & Technical Bottlenecks

### Deep Dive 1: WebSocket Gateway Architecture & Redis Pub/Sub Fanout
How does Gateway 1 send a message to Gateway 2 when User A and User B are on different servers?

1. **User Session Registry (Redis KV)**:
   When User B connects to Gateway Node 2, Gateway 2 registers:
   ```bash
   SET user:connection:user_B "gateway_node_2" EX 300
   ```
2. **Channel-Based Pub/Sub**:
   Each WebSocket Gateway instance subscribes to a specific Redis Pub/Sub channel for all users currently connected to that gateway.
   When User A sends a message to User B:
   - Gateway 1 looks up User B's active server in Redis (`gateway_node_2`).
   - Gateway 1 publishes the message payload to Redis channel: `channel:gateway_node_2`.
   - Gateway 2 receives the event over Redis Pub/Sub, looks up User B's local in-memory socket pointer, and emits the frame over User B's physical WebSocket connection.

---

### Deep Dive 2: Message Storage Model in Apache Cassandra

Relational databases (PostgreSQL) suffer write bottlenecks under 46,000 QPS because B-Tree indexes require in-place disk page updates and locks.
**Apache Cassandra** uses an **LSM-Tree (Log-Structured Merge-Tree)**:
- All writes are appended sequentially to a commit log and written to in-memory **Memtables** in microseconds.
- Zero in-place disk seeks on write.
- Sequential SSTable flushing guarantees sustained 100,000+ writes/sec per cluster.

```sql
-- Cassandra CQL Schema for 1-to-1 and Group Chats
CREATE TABLE messages (
    conversation_id UUID,      -- Partition Key: Groups all messages in a chat together
    message_id TIMEUUID,       -- Clustering Key: Time-based UUID guaranteeing strict chronological order!
    sender_id UUID,
    content TEXT,
    media_url TEXT,
    status VARCHAR,            -- 'SENT', 'DELIVERED', 'READ'
    PRIMARY KEY (conversation_id, message_id)
) WITH CLUSTERING ORDER BY (message_id DESC);

-- Query: Fetch latest 50 messages for a chat in < 2ms!
SELECT * FROM messages 
WHERE conversation_id = 7a8b9c0d-1234-5678-9abc-def012345678 
LIMIT 50;
```

---

### Deep Dive 3: Real-Time Presence Service & Heartbeat Mechanics
How do you track whether 50 million users are "Online" without crashing servers?

1. **Heartbeat Pings**:
   Connected clients send a lightweight WebSocket ping every 30 seconds.
   The gateway writes a heartbeat timestamp into an in-memory Redis sorted set or key with a 60-second TTL:
   ```bash
   SET user:presence:user_A "ONLINE" EX 60
   ```
2. **Disconnection Detection**:
   If the user closes the app or loses cellular connection, no explicit "disconnect" packet is sent. When the 60-second TTL in Redis expires without a renewal ping, the presence service marks the user as **Offline**.
3. **Presence Fanout Optimization (Lazy Fetching)**:
   Do NOT broadcast presence updates to all 5,000 friends simultaneously.
   Only fetch presence for friends **currently visible in the user's active viewport screen** (e.g., top 10 recent chats) using batch `MGET` queries.

---

### Deep Dive 4: Group Chat Message Fanout Strategies

```
┌────────────────────────────────┬────────────────────────────────────────┐
│ Fanout-on-Write (Push Model)   │ Fanout-on-Read (Pull Model)            │
├────────────────────────────────┼────────────────────────────────────────┤
│ When a user sends a message to │ The message is written to a single     │
│ a group, the server duplicates │ group inbox table once.                │
│ and writes the message into    │ All 10,000 members poll or read from   │
│ every member's personal inbox. │ the shared group inbox.                │
│ Best for: Small groups (<500). │ Best for: Massive channels (>10,000)   │
│ Fast reads; expensive writes.  │ like Discord servers or Slack channels.│
└────────────────────────────────┴────────────────────────────────────────┘
```
*Hybrid Solution*: For standard WhatsApp groups ($\le 500$ members), use **Fanout-on-Write** via Redis Pub/Sub. For massive public channels (Discord / Telegram channels with 100,000+ members), use **Fanout-on-Read** backed by Kafka partitions.

---

## 7. Important Rules

1. **Use `TIMEUUID` or Snowflake for Chronological Ordering**: Never rely on client device timestamps for message sorting. A user with an incorrect device clock (set to year 2030) will have their messages permanently pinned to the bottom of the conversation. Always assign `TIMEUUID` or Snowflake IDs on the **gateway server** upon message receipt.
2. **Enforce End-to-End Delivery Acknowledgment (Double Checkmark)**:
   - *Single Gray Check*: Message received and persisted by the server.
   - *Double Gray Check*: Message delivered to recipient's device via WebSocket or APNs push.
   - *Double Blue Check*: Recipient opened the conversation screen (emits a `MessageRead` event).
3. **Queue Messages for Offline Users**:
   If a recipient is offline (no active WebSocket), do not drop the message. Write it to Cassandra, enqueue a push notification to Apple Push Notification Service (APNs) or Firebase Cloud Messaging (FCM), and deliver all unread messages in a single batch when the client reconnects.
4. **Decouple Media from Text**:
   Never stream heavy image or video bytes through the WebSocket connection! Upload media directly to **Amazon S3** via Presigned URLs, and send only the resulting media metadata and thumbnail URL across the WebSocket channel.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Polling HTTP (`setInterval` every 2 seconds)
Attempting to build a chat app by having 10 million mobile phones make HTTP GET requests every 2 seconds. This creates 5 million requests/sec of useless traffic, draining mobile battery and crashing web servers. Always use persistent **WebSockets**.

### 2. Broadcasting Presence Changes to All Followers
Broadcasting an online status change to 5,000 friends whenever a user unlocks their phone. This triggers a combinatorial explosion of network traffic ($N^2$). Use lazy viewport-based presence queries.

### 3. Missing TCP Keep-Alive and Idle Timeout Handling
Mobile cellular networks (LTE/5G) aggressively kill idle TCP connections after 60 seconds of inactivity without notifying the client. If your app does not send periodic WebSocket heartbeats (`ping`/`pong`), messages sent to the client will silently vanish into dead sockets.

---

## 9. Best Practices

- **WebSocket Connection State Recovery**:
  When a mobile user drives through a tunnel and loses signal for 10 seconds, the client should reconnect with the last acknowledged message ID (`lastMessageId: "12345"`). The gateway streams only the missed messages since that ID, eliminating full channel reload latency.
- **Message Compression**:
  Enable WebSocket permessage-deflate compression or use binary protocols like **Protocol Buffers (Protobuf)** instead of raw JSON to reduce message byte payloads by 60%.

---

## 10. Performance Considerations

- **Epoll & Non-Blocking Sockets**:
  Use high-performance asynchronous networking engines (such as **Netty** in Java, **ws** in Node.js, or Go native goroutines) that leverage OS `epoll`/`kqueue` to manage 100,000 idle connections per machine with minimal memory overhead.

---

## 11. Security Considerations

- **WebSocket Handshake Authentication**:
  Authenticate the client during the initial HTTP upgrade handshake using an `Authorization: Bearer <JWT>` header or short-lived handshake ticket. Reject unauthorized connections before upgrading the socket to WebSocket.

---

## 12. Database Technology Comparison Matrix for Chat

| Technology | Write Performance | Read Query Pattern | Scalability | Best Used For |
| :--- | :--- | :--- | :--- | :--- |
| **Apache Cassandra** | Extremely High (LSM)| Time-range queries by `conversation_id`| Linear (Masterless)| Global message persistence |
| **PostgreSQL** | Moderate (B-Tree)| Complex joins, user accounts, auth | Requires sharding | User profiles, channel metadata |
| **Redis** | In-Memory (<1ms) | Key-value presence, Pub/Sub fanout | Cluster Sharding | Real-time routing & presence |
| **MongoDB** | Moderate to High | Document-based conversation nesting | Replica Sets | Prototyping / Small-scale chat |

---

## 13. Trade-offs

- **Cassandra vs. PostgreSQL for Chat**: Cassandra provides infinite write scaling and time-series clustering for messages, but lacks relational integrity, joins, and ACID transactions. PostgreSQL provides ACID safety, but requires complex manual sharding to handle billions of chat rows.
- **Redis Pub/Sub vs. Apache Kafka**: Redis Pub/Sub is in-memory and delivers messages with microsecond latency, but does not buffer messages (fire-and-forget). Kafka persists messages on disk, enabling replayability, at the cost of higher latency (~5–10ms).

---

## 14. Real-World Usage Case Studies

1. **Discord**: Scaled their real-time chat infrastructure to millions of concurrent voice and text users by migrating message storage from MongoDB to Apache Cassandra, and subsequently to **ScyllaDB** (a C++ rewrite of Cassandra) to eliminate Java garbage collection latency spikes.
2. **Slack**: Uses WebSockets connected to a fleet of edge servers running Envoy and a custom job queuing system backed by Redis and MySQL to handle real-time enterprise workspace collaboration.

---

## 15. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: Why are WebSockets preferred over HTTP Long Polling for real-time chat applications?**
> **Answer**: HTTP Long Polling requires repeatedly establishing new HTTP request-response cycles, re-transmitting heavy HTTP headers (cookies, user-agents), and incurring TCP handshake overhead for every message. WebSockets establish a single persistent, bidirectional TCP connection via an initial HTTP upgrade handshake. Once established, both client and server can send lightweight, binary frames with minimal header overhead (2 to 10 bytes), achieving sub-50ms latency with minimal bandwidth.

### Tier 2: Conceptual
**Q: How do you guarantee message ordering in a group chat across distributed servers?**
> **Answer**:
> 1. Assign a monotonically increasing, time-ordered sequence identifier on the **centralized gateway server** (using **Twitter Snowflake** or Cassandra `TIMEUUID`), never trusting client device clocks.
> 2. Colocate all messages for a specific conversation in the same database partition (e.g., Cassandra `PRIMARY KEY (conversation_id, message_id) WITH CLUSTERING ORDER BY (message_id ASC)`).
> 3. Clients render messages strictly sorted by this sequence ID.

### Tier 3: Implementation
**Q: How do you implement a heartbeat-based presence detection system in Redis?**
*(Refer to Section 16 for full code implementation)*.

### Tier 4: Debugging
**Q: During peak hours, WebSocket Gateway nodes report high memory usage and begin crashing with OOM errors, even though active message volume is normal. What is happening?**
> **Answer**:
> The servers are suffering from **Zombie Socket Leaks**:
> 1. Mobile devices that lose connection abruptly (e.g., entering an elevator or airplane mode) do not send a TCP `FIN` packet.
> 2. The server's OS socket remains open in an active state, continuing to allocate memory buffers for dead connections.
> 3. **Fix**: Implement a strict **Heartbeat / Ping-Pong Protocol**: the server sends a `ping` every 30 seconds; if the client does not return a `pong` within 60 seconds, the server forcefully terminates the socket (`socket.terminate()`) and frees its memory.

### Tier 5: Scenario
**Q: How would you design a channel with 100,000 concurrent active users (e.g., a Twitch live stream chat or Discord gaming event) without crashing WebSocket servers?**
> **Answer**:
> 1. **Do Not Fan Out Every Message to Every User**: Broadcasting 1,000 messages/sec to 100,000 users generates 100,000,000 packets/sec, crashing network interfaces.
> 2. **Rate Limiting & Slow Mode**: Enforce chat slow mode (users can post once every 30 seconds).
> 3. **Client-Side Throttling / Sampling**: At the gateway, aggregate messages into batches (e.g., sending a batch of 10 messages every 500ms instead of 10 individual frames).
> 4. **Ephemereal In-Memory Ring Buffer**: Do not persist twitch-style live stream comments to Cassandra; store only the last 100 messages in a Redis cyclic buffer.

### Tier 6: Advanced
**Q: How do you handle End-to-End Encryption (E2EE) in a group chat without allowing the chat server to read message contents?**
> **Answer**:
> Use the **Signal Protocol with Sender Keys**:
> 1. In 1-to-1 chats, the Double Ratchet Algorithm derives unique ephemeral encryption keys per message using Diffie-Hellman key exchanges.
> 2. In Group Chats: To prevent the sender from encrypting the message 500 times for 500 members, the sender creates a symmetric **Sender Key**.
> 3. The sender encrypts the Sender Key individually for each group member using their 1-to-1 Signal ratchet session and distributes it once.
> 4. Subsequent group messages are encrypted once with the Sender Key. The server routes the encrypted ciphertext blob without possessing the decryption key, guaranteeing privacy.

---

## 16. Coding Question: Real-Time WebSocket Message Routing with Redis Pub/Sub in TypeScript

### Problem
Write an Express + `ws` WebSocket gateway in TypeScript that:
1. Authenticates incoming WebSocket connections via a ticket/token query parameter.
2. Registers the user's connection in a local in-memory socket registry.
3. Subscribes to a Redis Pub/Sub channel for that user.
4. When another user sends a message, publishes it to the recipient's Redis channel for real-time cross-server delivery.

### Solution

```typescript
import http from 'http';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import Redis from 'ioredis';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Redis clients: Publisher and Dedicated Subscriber
const redisPublisher = new Redis();
const redisSubscriber = new Redis();

// Local registry of connected sockets on THIS server instance: UserId -> WebSocket
const localSockets = new Map<string, WebSocket>();

// 1. Listen for cross-server messages delivered via Redis Pub/Sub
redisSubscriber.on('message', (channel, messageStr) => {
  const payload = JSON.parse(messageStr);
  const recipientSocket = localSockets.get(payload.recipientId);

  if (recipientSocket && recipientSocket.readyState === WebSocket.OPEN) {
    recipientSocket.send(JSON.stringify(payload));
    console.log(`[Delivered] Message pushed to user ${payload.recipientId} via local socket.`);
  }
});

// 2. Handle incoming WebSocket connections
wss.on('connection', async (ws: WebSocket, req: http.IncomingMessage) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const userId = url.searchParams.get('userId');

  if (!userId) {
    ws.close(1008, 'Missing userId authentication parameter');
    return;
  }

  // Register user locally
  localSockets.set(userId, ws);
  // Subscribe Redis to this user's private channel
  await redisSubscriber.subscribe(`chat:user:${userId}`);
  console.log(`[Connected] User ${userId} connected to gateway node.`);

  // Handle incoming messages from Client
  ws.on('message', async (data: string) => {
    try {
      const message = JSON.parse(data.toString());
      // message = { recipientId: "u2", text: "Hello!" }

      const enrichedPayload = {
        messageId: crypto.randomUUID(),
        senderId: userId,
        recipientId: message.recipientId,
        text: message.text,
        timestamp: Date.now(),
      };

      // Publish to recipient's Redis channel (routes to whichever server holds recipient's socket!)
      await redisPublisher.publish(
        `chat:user:${message.recipientId}`,
        JSON.stringify(enrichedPayload)
      );

      // Acknowledge receipt to sender
      ws.send(JSON.stringify({ status: 'SENT', messageId: enrichedPayload.messageId }));
    } catch (err) {
      console.error('[Error] Failed to process incoming WS frame:', err);
    }
  });

  // Handle disconnection
  ws.on('close', async () => {
    localSockets.delete(userId);
    await redisSubscriber.unsubscribe(`chat:user:${userId}`);
    console.log(`[Disconnected] User ${userId} disconnected.`);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`Chat Gateway running on port ${PORT}`);
});
```

---

## 17. Common Interview Traps

- **Trap 1**: Trying to store chat messages in a relational database without sharding.
  *Gotcha*: At 46,000 writes/sec, a single PostgreSQL instance will crash under transaction log contention. Always propose an LSM-tree wide-column store like **Apache Cassandra** or **ScyllaDB**.
- **Trap 2**: Relying on device clocks for message sequencing.
  *Gotcha*: Client phone clocks are notoriously desynchronized and easily manipulated by users. Always generate message sequence IDs on the server side using Snowflake or TimeUUIDs.
- **Trap 3**: Forgetting about offline users.
  *Gotcha*: If User B is offline when User A sends a message, dropping the message because there is no open WebSocket connection will fail your interview. Explain how messages are persisted to disk and delivered via Apple/Google Push Notifications.

---

## 18. Revision Summary

- **Core Protocol**: Persistent **WebSockets** for bidirectional, sub-50ms message push.
- **Cross-Node Routing**: Use **Redis Pub/Sub** or Kafka to route messages across horizontal gateway server nodes.
- **Persistence Engine**: **Apache Cassandra / ScyllaDB** partitioned by `conversation_id` and clustered chronologically by `message_id DESC`.
- **Presence Detection**: Heartbeat pings with a 60-second Redis TTL; lazy viewport-based fetching.
- **Media Pipeline**: Upload media directly to S3 via Presigned URLs; transmit only metadata across WebSockets.

---

## 19. Quick Reference

| Component | Technology Choice | Architectural Reason |
| :--- | :--- | :--- |
| **Transport** | WebSockets (WSS) | Full-duplex persistent connections (<50ms latency) |
| **Message Router** | Redis Pub/Sub | Microsecond cross-node fanout across gateway fleet |
| **Message Storage** | Apache Cassandra / ScyllaDB | LSM-Tree handles 50,000+ writes/sec without locking |
| **Presence Cache** | Redis Sorted Sets / TTLs | In-memory heartbeat tracking with auto-expiry |
| **Push Notifications**| APNs / Firebase FCM | Wakes up offline mobile clients |
| **Media Storage** | Amazon S3 + CloudFront | Decouples large binary files from WebSocket servers |
