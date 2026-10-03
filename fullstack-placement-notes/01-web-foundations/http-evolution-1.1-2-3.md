# HTTP Evolution: HTTP/1.1 vs. HTTP/2 vs. HTTP/3

## 1. What is it?
**Hypertext Transfer Protocol (HTTP)** is the foundational application-layer protocol of the World Wide Web. It defines the message format and communication rules that web browsers, mobile apps, and microservices use to request and exchange web pages, JSON documents, media assets, and API payloads over the internet.

Over three decades, HTTP has evolved from a primitive plaintext file-fetching script into a high-performance, binary, multiplexed protocol designed for modern low-latency internetworking:
- **HTTP/1.1 (1997)**: Plaintext, persistent connections, chunked transfer, sequential request pipeline.
- **HTTP/2 (2015)**: Binary framing, multiplexed streams over a single TCP connection, HPACK header compression.
- **HTTP/3 (2022)**: Built on **QUIC over UDP**, 0-RTT handshakes, connection migration, zero transport head-of-line blocking.

---

## 2. Why does it exist?
The original web delivered small, static HTML text pages. A webpage in 1995 required 1 or 2 network requests. Today, a single web application page (like Amazon or YouTube) demands **150+ individual requests** (JavaScript bundles, CSS stylesheets, images, tracking scripts, API calls).
- **The Bottleneck**: As web complexity exploded, the underlying protocols became the primary performance bottleneck. Sequential TCP connections, uncompressed headers, and packet-loss stalling created unacceptable page load delays. Each evolution of HTTP was engineered specifically to reduce round-trip times (RTT) and maximize network link utilization.

---

## 3. Mental Model
💡 **Think of it like this:**
- **HTTP/1.1 is a Single-Lane Country Road**: Each vehicle (HTTP request) must wait for the vehicle in front of it to reach the destination before the next car can drive. If you want more throughput, you must pave 6 separate parallel roads (browsers opening 6 TCP connections).
- **HTTP/2 is a Multi-Car Train on a Single Railway Track**: Instead of waiting for a car to finish, all boxes are sliced into standardized small containers (**Binary Frames**), tagged with a ticket number (**Stream ID**), and packed into a single continuous high-speed train. However, if a tree falls on the track (a single TCP packet is lost), the entire train stops!
- **HTTP/3 is a Fleet of Autonomous Drones over Open Air**: Each parcel is carried independently through the sky (**QUIC over UDP**). If one drone is shot down, all the other drones keep flying to the warehouse at full speed without stopping.

### Visualizing the Evolution
```
HTTP/1.1 (Sequential over 6 separate TCP connections)
Conn 1: ──[ Req 1 ]──► [ Resp 1 ] ──► [ Req 4 ]──► [ Resp 4 ]
Conn 2: ──[ Req 2 ]──► [ Resp 2 ] ──► [ Req 5 ]──► [ Resp 5 ]
Conn 3: ──[ Req 3 ]──► [ Resp 3 ] ──► [ Req 6 ]──► [ Resp 6 ]
(High TCP Handshake overhead, high memory on servers)

HTTP/2 (Multiplexed Frames over ONE single TCP connection)
Single TCP: ──[Strm 1: Frame A][Strm 2: Frame A][Strm 1: Frame B][Strm 3: Frame A]──►
(Zero application HoL blocking; BUT TCP-level packet loss stalls ALL streams)

HTTP/3 (QUIC over UDP - Independent UDP streams)
UDP Datagrams: ──[Stream 1 Packet] [Stream 2 Packet] [Stream 3 Packet]──►
(Zero transport HoL blocking; Packet drop in Stream 1 has ZERO effect on Stream 2 or 3!)
```

---

## 4. Basic Example: Inspecting Protocol in cURL
You can query any modern web property to observe protocol negotiation:

```bash
# Force HTTP/1.1:
curl -I --http1.1 https://www.google.com

# Force HTTP/2 (ALPN negotiation over TLS):
curl -I --http2 https://www.google.com

# Force HTTP/3 (QUIC):
curl -I --http3 https://www.google.com
```

**Output Snippet (HTTP/2):**
```http
HTTP/2 200
content-type: text/html; charset=ISO-8859-1
cache-control: private, max-age=0
date: Sat, 03 Oct 2026 10:45:00 GMT
server: gws
```

---

## 5. Real Example: Native Node.js HTTP/2 Server with Multiplexing
Node.js provides a native `node:http2` module that creates real multiplexed binary HTTP/2 connections over TLS:

```typescript
// http2-server.ts
import http2 from 'node:http2';
import fs from 'node:fs';

// HTTP/2 over TLS (h2) requires SSL/TLS certificates
const server = http2.createSecureServer({
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.crt'),
  allowHTTP1: true // Fallback to HTTP/1.1 if client does not support h2
});

server.on('stream', (stream, headers) => {
  const path = headers[':path'];
  const method = headers[':method'];
  console.log(`[HTTP/2] New Stream #${stream.id} for ${method} ${path}`);

  if (path === '/') {
    // Send primary HTML response
    stream.respond({
      ':status': 200,
      'content-type': 'text/html; charset=utf-8'
    });
    stream.end('<h1>HTTP/2 Multiplexed Application</h1>');
  } else {
    stream.respond({ ':status': 404 });
    stream.end('Not Found');
  }
});

server.listen(8443, () => {
  console.log('[HTTP/2] Server running on https://localhost:8443');
});
```

---

## 6. Under the Hood: Deep Protocol Comparison

### 1. HTTP/1.1 Mechanics & Limitations
- **Persistent Connections (`Connection: keep-alive`)**: Solved the HTTP/1.0 flaw of tearing down the TCP connection after every single request. A single TCP socket could now handle multiple requests sequentially.
- **Pipelining Failure**: HTTP/1.1 introduced pipelining (sending request B before response A arrived). However, responses had to be returned in the **exact same order** requests were sent. If response A was slow (e.g. expensive database query), response B was blocked. This is **Application Layer Head-of-Line (HoL) Blocking**. Due to buggy intermediate proxies, pipelining was disabled by default in all browsers.
- **The Browser Hack**: To bypass this bottleneck, web browsers arbitrarily decided to open **up to 6 parallel TCP connections** per unique domain name.

### 2. HTTP/2 Mechanics & The Binary Framing Layer
HTTP/2 replaced plaintext ASCII strings (`GET /index.html HTTP/1.1`) with a binary protocol divided into logical units:
```
┌────────────────────────────────────────────────────────┐
│                      HTTP/2 FRAME                      │
├─────────────────────┬──────────────────┬───────────────┤
│ Length (24 bits)    │ Type (8 bits)    │ Flags (8 bits)│
├─────────────────────┴──────────────────┴───────────────┤
│ Stream Identifier (31 bits)                            │
├────────────────────────────────────────────────────────┤
│ Frame Payload (variable length: HEADERS, DATA, etc.)   │
└────────────────────────────────────────────────────────┘
```
1. **Binary Framing**:
   - `HEADERS` Frame: Carries compressed HTTP headers.
   - `DATA` Frame: Carries the raw message body (JSON, HTML, images).
   - `RST_STREAM`: Cancels an in-flight stream instantly without killing the underlying TCP connection.
2. **Stream Multiplexing**:
   - Multiple bidirectional streams interleave simultaneously inside a single TCP socket. Each stream has a unique 31-bit Stream ID.
3. **HPACK Header Compression**:
   - In HTTP/1.1, identical headers (like 1000-byte Cookie strings and User-Agents) were retransmitted on every single request.
   - HPACK maintains a **Static Table** (61 common header definitions) and a **Dynamic Table** shared between client and server. If the same `Cookie` is sent twice, HTTP/2 sends an index reference (1 byte) instead of the full string!

### 3. HTTP/3 & The QUIC Revolution
While HTTP/2 fixed application-level HoL blocking, it amplified **TCP-level HoL blocking**. If 100 streams share 1 TCP socket, and a single packet is dropped by Wi-Fi interference, the operating system stops all 100 streams until that missing packet is retransmitted.
- **HTTP/3 solves this by replacing TCP with QUIC on top of UDP**:
  - **Independent Streams**: Streams are first-class citizens in the transport layer. A lost packet in Stream 4 halts *only* Stream 4; Streams 1, 2, 3, and 5 continue uninterrupted.
  - **0-RTT Handshake**: QUIC merges the transport handshake (TCP SYN) and the cryptographic security handshake (TLS 1.3) into a single exchange. Returning clients can send encrypted application data on the very first packet (**0-RTT**)!
  - **Connection Migration**: TCP connections are bound to an IP address. If you walk out of your house and switch from Home Wi-Fi to 5G Cellular, your IP address changes, killing all active TCP downloads. QUIC uses a **64-bit Connection ID**. When your IP changes, the connection seamlessly survives without restarting!

---

## 7. Important Rules & Invariants
1. **HTTP/2 & HTTP/3 Require HTTPS**: While the RFC specifications theoretically allow plaintext h2c, all major web browsers (Chrome, Firefox, Safari) enforce encryption (TLS 1.2+ for HTTP/2, TLS 1.3 for HTTP/3).
2. **Header Case Invariance**: HTTP/2 and HTTP/3 mandate that all HTTP header names **must be strictly lowercase** (e.g. `:method`, `content-type`, `authorization`). Sending uppercase headers in HTTP/2 causes a protocol error (`PROTOCOL_ERROR`).
3. **Pseudo-Headers**: Core metadata in HTTP/2 and HTTP/3 are prepended with a colon (`:method`, `:path`, `:scheme`, `:authority`, `:status`). They must appear before regular headers.

---

## 8. Common Mistakes & Anti-Patterns

### ❌ Mistake 1: Continuing to "Domain Shard" in the HTTP/2 Era
- **The Anti-Pattern**: In the HTTP/1.1 era, frontend engineers split assets across multiple subdomains (`cdn1.site.com`, `cdn2.site.com`, `cdn3.site.com`) to bypass the browser's 6-connection-per-domain limit.
- **Why it hurts in HTTP/2**: In HTTP/2, domain sharding forces the browser to open multiple distinct TCP connections, triggering duplicate DNS lookups, duplicate TLS handshakes, and disabling HTTP/2's single-connection multiplexing and HPACK compression efficiencies!
- **✅ Fix**: Consolidate all assets onto a single domain or origin.

### ❌ Mistake 2: Aggressive CSS Spriting and JS Bundling into Giant Files
- **The Anti-Pattern**: Combining 50 images into a single CSS image sprite, or bundling all application code into one monolithic `bundle.js` (10MB) to minimize HTTP request count.
- **Why it hurts in HTTP/2/3**: In HTTP/2/3, request overhead is tiny. Splitting assets into granular, modular chunks allows fine-grained browser caching: if you change 1 line of code, the user only downloads that single 10KB module instead of invalidating a 10MB bundle!

---

## 9. Best Practices in Modern Production
1. **Enable ALPN (Application-Layer Protocol Negotiation)**: Ensure your Nginx/Cloudflare reverse proxies negotiate protocols cleanly during the TLS handshake (`h3`, `h2`, `http/1.1`).
2. **Avoid HTTP/2 Server Push**: HTTP/2 Server Push was originally designed to send CSS/JS before the browser asked for it. In practice, servers frequently pushed files that the browser already had cached, wasting mobile data. Chrome deprecated Server Push; use `<link rel="preload">` or **103 Early Hints** instead.
3. **Use 103 Early Hints**: The modern standard where the server sends an early HTTP 103 response with `Link: </style.css>; rel=preload` while your backend database query is still executing.

---

## 10. Performance Considerations: Connection Latency Comparison
```
HTTP/1.1 + TLS 1.2:
  DNS (1 RTT) + TCP (1 RTT) + TLS (2 RTTs) + HTTP GET (1 RTT) = 5 RTTs before first byte!

HTTP/2 + TLS 1.3:
  DNS (1 RTT) + TCP (1 RTT) + TLS 1.3 (1 RTT) + HTTP GET (1 RTT) = 4 RTTs (3 RTTs on connection reuse).

HTTP/3 (QUIC 0-RTT):
  DNS (1 RTT) + Combined QUIC/TLS 1.3 Handshake + Data = 1 RTT (0-RTT on resumed connections)!
```

---

## 11. Security Considerations
1. **HTTP/2 Rapid Reset Attack (CVE-2023-44487)**:
   - In late 2023, attackers exploited HTTP/2's `RST_STREAM` frame. By sending a request and immediately canceling it with `RST_STREAM` thousands of times per second, attackers caused massive server CPU exhaustion while bypassing standard rate limiters, generating attacks exceeding 398 million requests per second.
   - *Mitigation*: Update reverse proxies (Nginx, Envoy, Cloudflare) with patch limits that terminate connections with abnormal `RST_STREAM` ratios.
2. **HPACK CRIME/BREACH Vulnerabilities**:
   - Compression of secret data (e.g. CSRF tokens) alongside attacker-controlled input can allow attackers to deduce secrets by analyzing ciphertext length variations.

---

## 12. Complete Evolutionary Comparison Table
| Feature | HTTP/1.1 | HTTP/2 | HTTP/3 |
|---|---|---|---|
| **Underlying Transport** | TCP | TCP | **QUIC (UDP)** |
| **Data Format** | Plaintext ASCII | Binary Frames | Binary Frames |
| **Multiplexing** | ❌ No (Pipelining failed) | ✅ Yes (Single TCP stream) | ✅ Yes (Independent UDP streams) |
| **Transport HoL Blocking** | Yes | Yes (at TCP level) | **❌ Completely Eliminated** |
| **Header Compression** | ❌ None | ✅ HPACK | ✅ QPACK |
| **Handshake Latency** | 2-3 RTTs | 2-3 RTTs | **0-1 RTT** |
| **Connection Migration** | ❌ Fails on IP change | ❌ Fails on IP change | **✅ Survives IP / Network changes** |
| **Standard Port** | 80 (HTTP) / 443 (HTTPS) | 443 (TCP) | **443 (UDP)** |

---

## 13. Trade-offs: When to use HTTP/2 vs. HTTP/3
- **HTTP/3 Advantages**: Outstanding for mobile users moving between cell towers and Wi-Fi, high-packet-loss networks (emerging markets, cellular dead zones), and ultra-low-latency financial/gaming APIs.
- **HTTP/3 Drawbacks**: Higher server CPU overhead (UDP in user space requires more CPU than kernel-offloaded TCP); some strict enterprise corporate firewalls block outbound UDP port 443, forcing fallback to HTTP/2.

---

## 14. Real-World Usage: Cloudflare & Google Infrastructure
Over 80% of Google's global web traffic runs on **HTTP/3 (QUIC)**. When a smartphone user watches YouTube while riding a train, the phone switches between 4G, 5G, and station Wi-Fi seamlessly without the video buffering or restarting, thanks to QUIC's Connection ID migration.

---

## 15. Placement Interview Questions

### Basic (Intern)
1. **What is the difference between HTTP and HTTPS?**
   - *Spoken Answer*: "HTTP transmits data in plaintext over TCP port 80, making it vulnerable to eavesdropping and tampering. HTTPS runs HTTP over a cryptographic TLS (Transport Layer Security) tunnel on TCP port 443, providing data confidentiality (encryption), integrity (tamper detection), and authenticity (verifying server identity via digital certificates)."

### Conceptual (Junior SDE)
2. **What is Head-of-Line (HoL) Blocking, and how did HTTP/2 and HTTP/3 fix it?**
   - *Spoken Answer*: "HoL blocking occurs when a single delayed request or packet prevents all subsequent requests from being processed. HTTP/1.1 suffered from Application-layer HoL blocking because responses had to arrive in the exact order requested over a TCP connection. HTTP/2 solved this by introducing binary framing and multiplexing multiple streams over one TCP connection. However, HTTP/2 still suffered from Transport-layer HoL blocking because a single lost TCP packet halted the entire connection. HTTP/3 solved this permanently by switching to QUIC over UDP, ensuring that packet loss on one stream does not impact any other stream."

### Implementation (SDE-1)
3. **How does HPACK compression work in HTTP/2, and why didn't they just use GZIP?**
   - *Spoken Answer*: "They couldn't use standard GZIP/Deflate due to security vulnerabilities like CRIME and BREACH, where an attacker guessing secret cookie characters can observe changes in compressed payload size. HPACK was custom-built for HTTP headers. It combines:
     1. A **Static Table** of 61 predefined common headers.
     2. A **Dynamic Table** that remembers headers transmitted earlier in the same connection.
     3. Static Huffman Coding for string literals. If a header was already sent, only its integer index is transmitted in subsequent frames."

### Debugging
4. **Your web app serves static images from 4 different domains (`img1.site.com`, `img2.site.com`, etc.). After upgrading to HTTP/2, performance actually degraded. Why?**
   - *Analysis*: Domain sharding was an HTTP/1.1 workaround to bypass the 6-connection browser limit. In HTTP/2, splitting across 4 domains forces the browser to establish 4 separate TCP and TLS connections, multiplying handshake latency and fragmenting HTTP/2's single-connection multiplexing and HPACK compression.
   - *Fix*: Consolidate all image assets under a single domain (`assets.site.com`) to allow full single-connection multiplexing.

### Scenario-Based
5. **How does a browser know that a server supports HTTP/3 before making a UDP request?**
   - *Spoken Answer*: "A browser initially connects over TCP using HTTP/1.1 or HTTP/2. The server responds with an **`Alt-Svc` (Alternative Services)** HTTP response header:
     `Alt-Svc: h3=":443"; ma=86400`
     This informs the browser: *'For the next 86400 seconds (24h), I support HTTP/3 on UDP port 443'*. The browser caches this and upgrades future requests directly to QUIC/HTTP/3."

### Advanced (Tier-1 Product Company)
6. **Explain the HTTP/2 Rapid Reset DDoS vulnerability and why it caused the largest DDoS attacks in internet history.**
   - *Spoken Answer*: "In HTTP/2, a client can open a stream using a `HEADERS` frame and immediately cancel it using an `RST_STREAM` frame. RFC 7540 permitted this without restriction. Attackers automated sending a pipeline of `HEADERS` followed instantly by `RST_STREAM` millions of times per second on a single connection. The server was forced to allocate expensive resources to process the request, parse the headers, and handle the cancellation, while the client incurred near-zero cost. It saturated server CPU and event loops, generating attacks peaking at 398M req/s. It was patched by tracking rapid cancellation rates and killing abusive connections."

---

## 16. Placement Coding Challenge: Parse HTTP/1.1 Request Buffer
Write a TypeScript function that parses a raw TCP Buffer into an HTTP/1.1 request object:

```typescript
// http-parser.ts
export interface ParsedHTTPRequest {
  method: string;
  path: string;
  version: string;
  headers: Record<string, string>;
  body: string;
}

export function parseRawHTTPRequest(rawBuffer: Buffer): ParsedHTTPRequest {
  const rawString = rawBuffer.toString('utf-8');
  const [headerSection, ...bodyParts] = rawString.split('\r\n\r\n');
  const body = bodyParts.join('\r\n\r\n');

  const lines = headerSection.split('\r\n');
  const requestLine = lines[0];
  const [method, path, version] = requestLine.split(' ');

  const headers: Record<string, string> = {};
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const colonIndex = line.indexOf(':');
    if (colonIndex !== -1) {
      const key = line.slice(0, colonIndex).trim().toLowerCase();
      const val = line.slice(colonIndex + 1).trim();
      headers[key] = val;
    }
  }

  return { method, path, version, headers, body };
}
```

---

## 17. Common Interview Traps
- **Trap**: "Does HTTP/2 make web applications faster in all network conditions?"
  - *Trap Explanation*: No! On **lossy networks** (e.g. mobile networks with 2-5% packet loss), HTTP/2 can actually perform **worse than HTTP/1.1**. In HTTP/1.1, with 6 independent TCP connections, a dropped packet on connection 1 only stalls 1/6th of your requests. In HTTP/2, because all requests share a single TCP connection, a single dropped packet stalls **100% of all in-flight streams** due to TCP-level HoL blocking! This is the exact reason HTTP/3 was created.
- **Trap**: "Can HTTP headers have uppercase letters in HTTP/2?"
  - *Trap Explanation*: **No.** In HTTP/1.1, headers were case-insensitive (`Content-Type` vs `content-type`). In HTTP/2 and HTTP/3, the binary framing spec mandates that all header names **must be strictly lowercase**. Sending an uppercase character in an HTTP/2 header results in an immediate connection termination (`PROTOCOL_ERROR`).

---

## 18. Revision Summary
- **HTTP/1.1**: Plaintext ASCII, persistent connections (`keep-alive`), application-level HoL blocking, solved by opening up to 6 parallel TCP connections.
- **HTTP/2**: Binary framing layer, stream multiplexing over 1 TCP connection, HPACK header compression, stream prioritization.
- **HTTP/2 Flaw**: TCP transport HoL blocking (one dropped TCP packet freezes all multiplexed streams).
- **HTTP/3**: Runs on **QUIC over UDP**, eliminates transport HoL blocking, provides 0-RTT handshakes, survives IP changes via 64-bit Connection IDs.
- Deprecated patterns: Domain sharding and CSS spriting are obsolete in HTTP/2/3.

---

## 19. Quick Reference Cheat Sheet
```
Evolution Timeline:
  1997: HTTP/1.1 -> Keep-Alive, 6 parallel TCP connections, ASCII
  2015: HTTP/2   -> Binary Framing, Multiplexing, HPACK, Single TCP
  2022: HTTP/3   -> QUIC over UDP, 0-RTT, Connection Migration

Key HTTP/2 Frame Types:
  HEADERS    (0x01) -> Transmit metadata & compressed headers
  DATA       (0x00) -> Transmit payload body chunks
  RST_STREAM (0x03) -> Cancel an individual stream immediately
  SETTINGS   (0x04) -> Negotiate stream limits and window sizes
  PING       (0x06) -> Measure round-trip time and liveness
```
