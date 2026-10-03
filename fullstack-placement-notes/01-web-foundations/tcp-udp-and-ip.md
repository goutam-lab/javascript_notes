# TCP, UDP, and the Internet Protocol (IP)

## 1. What is it?
The Transport Layer (Layer 4) provides host-to-host communication services for applications. While the **Internet Protocol (IP)** at Layer 3 routes individual, unverified packets between network addresses, it makes no guarantees about whether those packets actually arrive, stay in order, or remain uncorrupted. 

To make this usable for applications, the Transport Layer introduces two foundational protocols:
1. **TCP (Transmission Control Protocol)**: A connection-oriented, highly reliable, ordered byte-stream protocol that guarantees error-free delivery, flow control, and congestion mitigation.
2. **UDP (User Datagram Protocol)**: A lightweight, connectionless, unreliable datagram protocol that transmits messages with minimal overhead, zero handshakes, and zero delivery guarantees.

---

## 2. Why does it exist?
Without Layer 4 protocols, every application would have to implement its own logic to reassemble fragmented packets, detect packet loss, handle retransmissions, adjust to network congestion, and distinguish between different services running on the same machine.
- **Why TCP exists**: Webpages, APIs, financial transactions, and database queries cannot tolerate lost or corrupted data. A single missing byte in an executable file or a JSON payload can crash the program. TCP abstracts the chaotic, lossy internet into a seamless, reliable virtual pipe.
- **Why UDP exists**: For real-time applications (video calls, voice chat, gaming, live streaming), low latency is far more important than 100% reliability. If an audio packet is dropped during a Zoom call, retransmitting it 200ms later is useless—the conversation has already moved on! UDP provides a direct, low-latency pipeline to the network.

---

## 3. Mental Model
💡 **Think of it like this:**
- **TCP is a Registered Courier Delivery with a Signature**:
  1. The courier calls you to confirm you are home (**SYN**).
  2. You say you are home and ready (**SYN-ACK**).
  3. The courier says they are on the way (**ACK**).
  4. Every box handed to you has a numbered sticker (1, 2, 3). If Box #2 falls off the truck, you refuse to sign the final receipt until the driver goes back and redelivers Box #2.
- **UDP is an Artillery Cannon / Megaphone**:
  - You load shells into a cannon and fire them toward a hill. You don't call ahead to check if anyone is there, and you don't know if the shells hit the target or blew up mid-air. You just keep firing as fast as possible.

### TCP 3-Way Handshake & 4-Way Teardown Architecture
```
CLIENT                                                           SERVER
  │                                                                │
  │ ────────────── 1. SYN (seq=x) ───────────────────────────────► │ (Server allocates TCB memory)
  │                                                                │
  │ ◄───────────── 2. SYN-ACK (seq=y, ack=x+1) ─────────────────── │
  │                                                                │
  │ ────────────── 3. ACK (seq=x+1, ack=y+1) ────────────────────► │ (Connection ESTABLISHED)
  │                                                                │
  │ [ ====== RELIABLE BI-DIRECTIONAL DATA TRANSMISSION ====== ]   │
  │                                                                │
  │ ────────────── 1. FIN (Client wants to close) ───────────────► │
  │ ◄───────────── 2. ACK (Server confirms client close) ───────── │ (Server can still send remaining data)
  │ ◄───────────── 3. FIN (Server ready to close) ──────────────── │
  │ ────────────── 4. ACK (Client confirms server close) ────────► │
  │                                                                │
  ▼ [ Client enters TIME_WAIT state (2 * MSL = ~60-120 seconds) ]  ▼
```

---

## 4. Basic Example: UDP Datagram Client and Server in Node.js
Using the native Node.js `node:dgram` module to demonstrate connectionless UDP packet transmission:

```typescript
// udp-demo.ts
import dgram from 'node:dgram';

// 1. Create UDP Server
const server = dgram.createSocket('udp4');

server.on('message', (msg, rinfo) => {
  console.log(`[UDP Server] Received: "${msg.toString()}" from ${rinfo.address}:${rinfo.port}`);
  
  // Echo back a response
  const response = Buffer.from(`ACK: ${msg.toString()}`);
  server.send(response, rinfo.port, rinfo.address);
});

server.bind(41234, () => {
  console.log('[UDP Server] Listening on 0.0.0.0:41234');

  // 2. Create UDP Client (Notice: ZERO handshake needed before sending!)
  const client = dgram.createSocket('udp4');
  const message = Buffer.from('Heartbeat Ping #1');

  client.send(message, 41234, '127.0.0.1', (err) => {
    if (err) console.error('Send error:', err);
    console.log('[UDP Client] Datagram fired into network');
  });

  client.on('message', (reply) => {
    console.log(`[UDP Client] Received server reply: "${reply.toString()}"`);
    client.close();
    server.close();
  });
});
```

---

## 5. Real Example: Handling TCP Backpressure in Node.js Streams
When writing high-throughput data over a TCP socket, the network buffer can fill up faster than the physical wire can transmit, leading to massive memory bloat if backpressure is ignored:

```typescript
// tcp-backpressure.ts
import net from 'node:net';

const server = net.createServer((socket) => {
  console.log('[TCP Server] Client connected');
  let currentChunk = 0;
  const totalChunks = 1_000_000;

  function sendNextChunk() {
    let canContinue = true;

    while (currentChunk < totalChunks && canContinue) {
      const payload = Buffer.alloc(16 * 1024, `Chunk-${currentChunk}\n`); // 16KB chunk
      currentChunk++;

      // socket.write returns FALSE when the internal buffer exceeds highWaterMark!
      canContinue = socket.write(payload);
    }

    if (currentChunk < totalChunks) {
      // ⚠️ BACKPRESSURE DETECTED: Kernel write buffer is full!
      // Pause writing and wait for the 'drain' event before resuming:
      socket.once('drain', () => {
        // console.log('[TCP] Buffer drained! Resuming stream...');
        sendNextChunk();
      });
    } else {
      socket.end();
    }
  }

  sendNextChunk();
});

server.listen(9000, () => console.log('TCP Stream Server on :9000'));
```

---

## 6. Under the Hood: Protocol Headers & Internal Mechanics

### Packet Header Comparison
```
TCP HEADER (20 - 60 Bytes)                          UDP HEADER (Fixed 8 Bytes)
┌─────────────────────────┬─────────────────────────┐  ┌─────────────────────────┬─────────────────────────┐
│ Source Port (16 bits)   │ Destination Port (16 b) │  │ Source Port (16 bits)   │ Destination Port (16 b) │
├─────────────────────────┴─────────────────────────┤  ├─────────────────────────┼─────────────────────────┤
│ Sequence Number (32 bits)                         │  │ Length (16 bits)        │ Checksum (16 bits)      │
├───────────────────────────────────────────────────┤  └─────────────────────────┴─────────────────────────┘
│ Acknowledgment Number (32 bits)                   │  [Total: 8 Bytes overhead - Ultra lightweight!]
├─────┬───────┬───────────┬─────────────────────────┤
│Offs.│Rsrvd. │Flags (9b) │ Window Size (16 bits)   │  TCP Flags:
├─────┴───────┴───────────┼─────────────────────────┤  • SYN (Synchronize sequence numbers)
│ Checksum (16 bits)      │ Urgent Pointer (16 bits)│  • ACK (Acknowledgment valid)
├─────────────────────────┴─────────────────────────┤  • FIN (Finished sending data)
│ Options (0 - 40 bytes) (e.g., MSS, SACK, Window)  │  • RST (Reset connection immediately)
└───────────────────────────────────────────────────┘  • PSH (Push data to application immediately)
```

### The 4 Pillars of TCP Reliability

1. **Ordering via Sequence Numbers (`SEQ`)**:
   - Every single byte transmitted in a TCP stream is assigned an incremental 32-bit sequence number. If packet 2 arrives before packet 1, the receiver's TCP stack buffers packet 2 and waits for packet 1 before delivering the stream to the application.
2. **Flow Control (`rwnd` - Receive Window)**:
   - Prevents the sender from overwhelming the **receiver's application buffer**. The receiver includes its available buffer space (`rwnd`) in every ACK packet. If `rwnd = 0`, the sender stops transmitting until the receiver processes the buffer.
3. **Congestion Control (`cwnd` - Congestion Window)**:
   - Prevents the sender from overwhelming the **underlying network routers**. Governed by algorithms like TCP Cubic and Google BBR:
     - **Slow Start**: Starts with an initial window (e.g. 10 MSS), doubling `cwnd` every RTT ($10 \rightarrow 20 \rightarrow 40 \rightarrow 80$).
     - **Congestion Avoidance**: Once packet loss is detected (timeout or 3 duplicate ACKs), `cwnd` drops sharply and enters linear growth.
4. **Selective Acknowledgment (SACK)**:
   - In basic TCP, if packet 3 is lost out of 10, the receiver asks to retransmit *everything* from packet 3 onwards. With SACK, the receiver tells the sender: *"I received 1, 2, 4, 5. Only retransmit packet 3!"*

---

## 7. Important Rules of TCP/UDP
1. **Ports Identify Processes, Not Machines**: IP addresses identify the network card; Port numbers (0 to 65535) route packets to specific running software processes.
2. **A TCP Connection is Defined by a 4-Tuple**:
   $$\text{Connection ID} = (\text{Source IP}, \text{Source Port}, \text{Destination IP}, \text{Destination Port})$$
   A single server port (e.g. 443) can handle hundreds of thousands of concurrent TCP connections as long as the client IP or client port differs.
3. **TIME_WAIT State Invariant**: When a machine initiates an active close, it remains in `TIME_WAIT` for $2 \times \text{MSL}$ (Maximum Segment Lifetime, ~60s). This ensures any delayed packets still traveling across internet routers die before a new connection reuses the same 4-tuple.

---

## 8. Common Mistakes & Pitfalls

### ❌ Mistake 1: Ephemeral Port Exhaustion
- **Scenario**: A Node.js backend makes microservice calls to another API, opening a brand-new HTTP connection for every request without enabling `keep-alive`.
- **The Crash**: Under 5,000 requests/sec, the client OS exhausts all available ephemeral ports (`~32768` to `65535`). Closed connections sit locked in `TIME_WAIT` for 60 seconds. New requests fail with `EADDRNOTAVAIL` or `ECONNRESET`.
- **✅ Fix**: Always use an HTTP Agent with connection pooling enabled:
  ```typescript
  import http from 'node:http';
  const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });
  // Pass keepAliveAgent to all outbound fetch/axios calls!
  ```

### ❌ Mistake 2: Assuming UDP is Always Faster than TCP in Web Browsers
- **Trap**: Thinking you can open raw UDP sockets inside a browser for web apps.
- **Reality**: Standard web browsers do not allow arbitrary UDP sockets for security reasons (to prevent using visitors' browsers as DDoS botnets). Real-time web communication over UDP must use **WebRTC DataChannels** or **HTTP/3 (QUIC)**.

---

## 9. Best Practices in Modern Production
1. **Tune Initial Congestion Window (`initcwnd`)**: Modern Linux kernels default `initcwnd` to 10 MSS (~14.6 KB). This allows modern web pages to transfer small JSON APIs and critical HTML in a single RTT without waiting for slow start.
2. **Switch from TCP Cubic to Google BBR**: BBR (Bottleneck Bandwidth and RTT) models network capacity rather than treating packet loss as congestion, delivering up to $10\times$ higher throughput on lossy mobile networks.
3. **Handle Backpressure Explicitly**: In Node.js or Go, never push unlimited chunks into a socket without monitoring return status or using `.pipe()`.

---

## 10. Performance Considerations: Head-of-Line (HoL) Blocking
The biggest flaw in TCP for the modern web is **Transport Layer Head-of-Line Blocking**:
- In HTTP/2, multiple requests are multiplexed over a single TCP connection.
- If packet #2 is dropped by an ISP router, the receiving operating system's TCP stack **refuses to deliver packets #3, #4, and #5 to the browser** until packet #2 is retransmitted and acknowledged.
- Even though packets #3, #4, and #5 belong to completely unrelated files (like an avatar image or CSS file), they are blocked!
- **The Modern Solution**: **HTTP/3 uses QUIC**, an application-layer transport protocol running on top of **UDP**. Each stream inside QUIC is independent: if one stream loses a packet, other streams continue flowing without delay!

---

## 11. Security Considerations: Transport Attacks
1. **SYN Flood Attack (Denial of Service)**:
   - Attacker sends millions of `SYN` packets with forged IP addresses.
   - The victim server allocates memory (Transmission Control Block - TCB) for each connection and waits for the final `ACK`. The connection table fills up, causing the server to reject legitimate users.
   - *Mitigation*: **SYN Cookies**. The server encodes connection state into the initial sequence number (`y`) and allocates **zero memory** until the client returns the valid `ACK`.
2. **TCP Reset (RST) Injection**:
   - An attacker on the network path injects a forged packet with the `RST` flag set, abruptly killing the connection between client and server.

---

## 12. Complete Comparison Matrix: TCP vs. UDP
| Feature | TCP | UDP |
|---|---|---|
| **Connection State** | Connection-oriented (Handshake required) | Connectionless (Fire and forget) |
| **Header Overhead** | 20 to 60 bytes | Exactly 8 bytes |
| **Reliability** | Guaranteed delivery (retransmissions) | Best-effort (packets can drop) |
| **Ordering** | Guaranteed ordered stream | Packets can arrive out of order |
| **Flow & Congestion Control**| Advanced (`rwnd`, `cwnd`, BBR) | None (transmits at application rate) |
| **Speed / Latency** | Higher latency (handshake + ACKs) | Ultra-low latency (0-RTT) |
| **Use Cases** | Web/HTTPS, REST APIs, SSH, Postgres, File Transfer | DNS, WebSockets WebRTC, Video Streaming, Gaming, HTTP/3 (QUIC) |

---

## 13. Trade-offs: Choosing TCP vs. UDP
- Choose **TCP** when:
  - Correctness and completeness are strictly non-negotiable.
  - You are building transactional backends, REST APIs, or database drivers.
- Choose **UDP (or protocols built on UDP like QUIC/WebRTC)** when:
  - Latency and throughput matter more than occasional packet loss.
  - You are streaming live audio/video, multiplayer game physics, or DNS queries.

---

## 14. Real-World Usage: Multiplayer Gaming Architecture (Valorant / Fortnite)
High-tick-rate games (like *Valorant* at 128Hz tick rate) use a hybrid architecture:
- **Game Physics & Player Movement**: Transmitted exclusively via **UDP**. 128 times per second, the client sends mouse and keyboard position datagrams. If packet #100 drops, the server discards it because packet #101 arrives 7 milliseconds later with newer coordinates.
- **In-Game Store & Payments**: Handled over **TCP (HTTPS)**. Purchasing a weapon skin requires guaranteed delivery and database consistency.

---

## 15. Placement Interview Questions

### Basic (Intern)
1. **Why does the TCP Handshake require 3 steps instead of 2?**
   - *Spoken Answer*: "A two-way handshake only verifies that the server can hear the client. The client must send the third packet (`ACK`) to confirm that it received the server's sequence number and that the communication path is fully functioning bidirectionally before data transfer begins. Furthermore, 3 steps prevent old, delayed duplicate `SYN` packets from unintentionally establishing zombie connections on the server."

### Conceptual (Junior SDE)
2. **What is the difference between Flow Control and Congestion Control in TCP?**
   - *Spoken Answer*: "Flow Control protects the **receiver** from being overwhelmed by a fast sender; it is managed by the receiver announcing its available buffer space (`rwnd`). Congestion Control protects the **underlying network routers** from being overwhelmed; it is calculated independently by the sender using dynamic algorithms like Cubic or BBR that adjust the congestion window (`cwnd`)."

### Implementation (SDE-1)
3. **What is the purpose of the `TIME_WAIT` state, and why is it problematic for high-concurrency microservices?**
   - *Spoken Answer*: "The side that performs the active close enters `TIME_WAIT` for $2 \times \text{MSL}$ (~60-120 seconds) to ensure that the final ACK was received by the remote peer and that any stray packets from the closed connection expire before the port combination can be reused. In microservices making rapid outbound HTTP requests without connection pooling, thousands of sockets accumulate in `TIME_WAIT`, exhausting the OS ephemeral port range and causing connection failure errors."

### Debugging
4. **Your Node.js backend CPU spikes to 100% and memory explodes when streaming a 2GB file over a socket. What is the bug?**
   - *Analysis*: The application code is reading from disk faster than the network socket can write, failing to respect **TCP Backpressure**. The unwritten data buffers accumulate in Node.js V8 memory.
   - *Fix*: Use `stream.pipeline()` or monitor `socket.write()` return value and pause the read stream until the socket emits `'drain'`.

### Scenario-Based
5. **Why did Google invent QUIC on top of UDP instead of creating a brand new Layer 4 protocol?**
   - *Spoken Answer*: "Because of **Middlebox Ossification**. Over decades, enterprise firewalls, NAT routers, and middleboxes across the global internet were hardcoded to only recognize TCP and UDP. Any new protocol number at Layer 3 or 4 would be dropped as unrecognized malicious traffic by millions of routers. Building QUIC over UDP allowed immediate worldwide deployment while bypassing TCP's Head-of-Line blocking and handshake delays."

### Advanced (Tier-1 Product Company)
6. **Explain what a TCP SYN Cookie is and how it mathematically prevents SYN Flood DoS attacks.**
   - *Spoken Answer*: "When a server's SYN queue overflows, instead of dropping connections or allocating memory for a Transmission Control Block (TCB), the server computes a cryptographically hashed 32-bit Initial Sequence Number (`y`):
     $$\text{ISN} = \text{Hash}(\text{Source IP}, \text{Source Port}, \text{Dest IP}, \text{Dest Port}, \text{Secret Key}) + \text{Timestamp}$$
     The server sends this in the `SYN-ACK` and forgets the connection completely. When the legitimate client sends back the final `ACK` containing `ack = ISN + 1`, the server recomputes the hash. If the math verifies, it allocates memory and establishes the connection retroactively, completely defeating memory exhaustion."

---

## 16. Placement Coding Challenge: Sliding Window Packet Buffer
Implement a simplified client-side sliding window buffer that accepts out-of-order packets and releases them in strict contiguous order to the application layer:

```typescript
// packet-reorder-buffer.ts
export interface Packet {
  seq: number;
  data: string;
}

export class TCPReorderBuffer {
  private expectedSeq: number;
  private buffer = new Map<number, string>();

  constructor(initialSeq: number) {
    this.expectedSeq = initialSeq;
  }

  /**
   * Receives an incoming packet and returns any contiguous ready data chunks
   */
  receivePacket(packet: Packet): string[] {
    // If packet is duplicate or already processed, discard
    if (packet.seq < this.expectedSeq) {
      return [];
    }

    // Buffer incoming packet
    this.buffer.set(packet.seq, packet.data);

    const orderedChunks: string[] = [];

    // Drain buffer in contiguous order
    while (this.buffer.has(this.expectedSeq)) {
      const chunk = this.buffer.get(this.expectedSeq)!;
      orderedChunks.push(chunk);
      this.buffer.delete(this.expectedSeq);
      this.expectedSeq++;
    }

    return orderedChunks;
  }

  getExpectedSeq(): number {
    return this.expectedSeq;
  }
}
```

---

## 17. Common Interview Traps
- **Trap**: "Does a UDP packet guarantee that the data arrived uncorrupted?"
  - *Trap Explanation*: UDP includes an optional 16-bit **checksum** in its header. If the checksum fails due to physical electrical interference or bit-flips, the receiving OS silently **drops the packet**. So UDP guarantees that *if* data reaches the application, it wasn't corrupted—but it gives zero guarantee that the packet arrives at all!
- **Trap**: "Can a server listen on port 80 for both TCP and UDP simultaneously?"
  - *Correct Answer*: **Yes!** Ports are namespaced by protocol. The OS network stack maintains separate port allocation tables for TCP and UDP. A web server can bind to TCP:80 while a DNS or telemetry daemon binds to UDP:80 simultaneously.

---

## 18. Revision Summary
- IP routes packets; TCP ensures reliability; UDP enables low-latency streaming.
- **TCP 3-Way Handshake**: `SYN` $\rightarrow$ `SYN-ACK` $\rightarrow$ `ACK`.
- **Reliability Tools**: Sequence numbers (ordering), Checksums (integrity), SACK (smart retransmits).
- **Flow Control (`rwnd`)** protects the receiver's buffer; **Congestion Control (`cwnd`)** protects the network pipes.
- **Head-of-Line Blocking**: In TCP, one dropped packet halts all streams; this is why modern web architecture created HTTP/3 over UDP (QUIC).
- Always reuse TCP connections with HTTP Keep-Alive to avoid `TIME_WAIT` socket exhaustion.

---

## 19. Quick Reference Cheat Sheet
```
TCP Flags:
  SYN -> Synchronize / Initiate handshake
  ACK -> Acknowledge receipt of bytes
  FIN -> Graceful connection termination
  RST -> Abrupt abort / reset
  PSH -> Force push buffer directly to application

Key Commands:
  netstat -s                 # View TCP retransmissions, errors, and dropped packets
  ss -t -a                   # Modern Linux socket statistics (TCP connections)
  curl --http3 https://...   # Test HTTP/3 (QUIC over UDP port 443)
```
