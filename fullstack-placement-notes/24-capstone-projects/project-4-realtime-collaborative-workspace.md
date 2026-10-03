# Capstone Project 4: Real-Time Collaborative Workspace & Document Editor (Notion / Figma Clone)

## 1. What is it?
A **Real-Time Collaborative Workspace & Document Editor** (exemplified by Google Docs, Notion, Figma, and Miro) is a complex, event-driven distributed system that allows multiple concurrent users to view, edit, comment, and collaborate within a shared document canvas simultaneously with zero perceived latency.

In senior full-stack engineering interviews, this capstone project represents the pinnacle of real-time state synchronization, evaluated across four core architectural pillars:
1. **Concurrent Text & Document Mutation**: Merging conflicting edits from multiple typing users without character loss, cursor jumps, or document corruption using **CRDTs (Conflict-Free Replicated Data Types)** or **Operational Transformation (OT)**.
2. **Ephemeral Live Presence & Multi-Cursor Tracking**: Broadcasting mouse cursor coordinates (`x, y`), active text selections, and user avatar badges at 30–60 frames per second with minimal network bandwidth overhead.
3. **Multi-Server WebSocket Scaling via Redis Pub/Sub**: Allowing User A (connected to WebSocket Server 1 in Virginia) and User B (connected to WebSocket Server 4 in Frankfurt) to collaborate on Document #102 seamlessly through distributed pub/sub routing.
4. **Hybrid Storage & Snapshotting Architecture**: Storing fast, ephemeral document deltas in-memory and in append-only logs, paired with periodic background snapshotting to PostgreSQL and Amazon S3.

```
                    COLLABORATIVE WORKSPACE ARCHITECTURE
                    
 [ User A (Editor) ]                                       [ User B (Viewer / Editor) ]
         │ 1. Move Cursor & Type Block                             ▲ 6. Push Delta & Cursor
         ▼ (WebSocket: WSS)                                        │    (WSS: < 30ms latency)
 ┌───────────────────────────┐                             ┌───────┴───────────────────┐
 │ WebSocket Gateway Node 1  │                             │ WebSocket Gateway Node 2  │
 │ (Holds User A Socket)     │                             │ (Holds User B Socket)     │
 └─────────────┬─────────────┘                             └───────▲───────────────────┘
               │ 2. Publish Document Delta                         │
               ▼    Channel: `doc:room:42`                         │ 5. Local Socket Emit
 ┌─────────────────────────────────────────────────────────────────┴───────────────────┐
 │ Distributed Real-Time Message Bus: Redis Pub/Sub / Dragonfly Cluster                │
 └─────────────────────────────┬───────────────────────────────────────────────────────┘
                               │ 3. Asynchronous Persistence Buffer
                               ▼
 ┌────────────────────────────────────────────────────────┐
 │ Document State Engine (CRDT State Vector: Yjs)         │
 └─────────────────────────────┬──────────────────────────┘
                               │ 4. Periodic Snapshot (Every 60s)
                               ▼
 ┌────────────────────────────────────────────────────────┐
 │ PostgreSQL / S3 (Document Snapshots & Audit Revisions) │
 └────────────────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Traditional request-response REST APIs and standard database writes completely break down in real-time collaborative editing environments:

1. **The Overwrite Collision Catastrophe**: User A and User B open a document containing "Hello". User A types " World" (saving "Hello World"); User B simultaneously types " Friends" (saving "Hello Friends"). Under standard HTTP POST writes, whichever request finishes last overwrites the other, permanently erasing a user's work.
2. **The Socket Network Explosion (C10K Multi-Cursor)**: If 50 users in a shared Figma canvas move their mouse cursors at 60Hz, broadcasting 50 raw WebSocket packets every 16ms generates $50 \times 50 \times 60 = \mathbf{150,000 \text{ network packets / second}}$ for a single room, immediately crashing client browsers and server network cards.
3. **Ghost Presence & Zombie Users**: When a user closes their laptop lid or drives through a cellular dead zone, no standard TCP `FIN` packet is transmitted. The system must reliably detect disconnected sockets without showing "User is still editing" badges indefinitely.
4. **Document Version History & Replay**: Enterprise workspaces require rolling back a document to its exact state from 3 days ago. Storing only the final current text destroys the ability to perform time-travel auditing.

---

## 3. Mental Model
Think of real-time collaborative editing like musicians in an improvisational jazz band:
- Musicians do not submit sheet music proposals to a central committee and wait for approval (REST API).
- Everyone plays instruments simultaneously while listening to the room's acoustics (WebSockets).
- Even if the trumpet and saxophone play notes at the exact same beat, mathematical musical harmony rules ensure the sounds blend together into a cohesive song rather than a chaotic cacophony (CRDT / Operational Transformation).

---

## 4. Basic Example: Operational Transformation (OT) vs. CRDTs

```
┌───────────────────────────────────────┬───────────────────────────────────────┐
│ Operational Transformation (OT)       │ Conflict-Free Replicated Data (CRDT)  │
├───────────────────────────────────────┼───────────────────────────────────────┤
│ • Used by: Google Docs.               │ • Used by: Figma, Linear, Notion.     │
│ • Requires a **centralized server** to│ • **Mathematically decentralized**:   │
│   order and transform operations.     │   operations commute in any order.    │
│ • Complex transformation matrix:      │ • Strong Eventual Consistency: states │
│   `T(OpA, OpB) -> OpA', OpB'`         │   converge to identical data safely.  │
│ • High server computation cost.       │ • Slightly higher memory footprint.   │
└───────────────────────────────────────┴───────────────────────────────────────┘
```

---

## 5. Real Example: Production CRDT Document Sync Engine with Yjs & WebSocket Server

In modern production systems, **Yjs** (the fastest CRDT implementation in the JavaScript ecosystem) is the industry standard.

### Server Implementation (`collab-server.ts`)
```typescript
// collab-server.ts
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Redis } from 'ioredis';
import * as Y from 'yjs';

const redisPub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const redisSub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

const server = http.createServer();
const wss = new WebSocketServer({ server });

// Map of active Document Rooms: docId -> { doc: Y.Doc, clients: Set<WebSocket> }
const activeRooms = new Map<string, { doc: Y.Doc; clients: Set<WebSocket> }>();

// 1. Redis Pub/Sub Listener for Cross-Server Broadcasting
redisSub.psubscribe('room:events:*', (err) => {
  if (err) console.error('[REDIS SUB ERROR]:', err);
});

redisSub.on('pmessage', (pattern, channel, message) => {
  const docId = channel.replace('room:events:', '');
  const room = activeRooms.get(docId);
  if (!room) return;

  const payload = JSON.parse(message);

  // Broadcast to all locally connected clients in this room (except original sender)
  for (const client of room.clients) {
    if (client.readyState === WebSocket.OPEN && (client as any).id !== payload.senderId) {
      client.send(JSON.stringify(payload));
    }
  }
});

// 2. WebSocket Connection Handler
wss.on('connection', (ws: WebSocket, req) => {
  const url = new URL(req.url || '', 'http://localhost');
  const docId = url.searchParams.get('docId') || 'default-room';
  const userId = url.searchParams.get('userId') || 'anon-' + Math.random().toString(36).slice(2);

  (ws as any).id = userId;

  // Initialize or fetch Room
  if (!activeRooms.has(docId)) {
    const doc = new Y.Doc();
    activeRooms.set(docId, { doc, clients: new Set() });
  }

  const room = activeRooms.get(docId)!;
  room.clients.add(ws);

  console.log(`[USER CONNECTED]: User ${userId} joined room ${docId}. Active clients: ${room.clients.size}`);

  // Send initial document state vector to client
  const stateVector = Y.encodeStateAsUpdate(room.doc);
  ws.send(JSON.stringify({ type: 'SYNC_INIT', update: Buffer.from(stateVector).toString('base64') }));

  // Handle Incoming Client Messages
  ws.on('message', async (data: string) => {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'DOC_UPDATE') {
        // Apply binary CRDT delta to in-memory Yjs Document
        const updateBuffer = Buffer.from(message.update, 'base64');
        Y.applyUpdate(room.doc, updateBuffer);

        // Publish to Redis Pub/Sub for cross-server fanout!
        await redisPub.publish(
          `room:events:${docId}`,
          JSON.stringify({
            senderId: userId,
            type: 'DOC_UPDATE',
            update: message.update,
          })
        );
      } else if (message.type === 'CURSOR_MOVE') {
        // Broadcast ephemeral cursor coordinates (Throttled by client)
        await redisPub.publish(
          `room:events:${docId}`,
          JSON.stringify({
            senderId: userId,
            type: 'CURSOR_MOVE',
            cursor: message.cursor, // { x: 420, y: 180, userName: "Alice" }
          })
        );
      }
    } catch (err: any) {
      console.error('[MESSAGE PROCESSING ERROR]:', err.message);
    }
  });

  // Handle Socket Disconnect
  ws.on('close', async () => {
    room.clients.delete(ws);
    console.log(`[USER DISCONNECTED]: User ${userId} left room ${docId}`);

    // Broadcast presence departure
    await redisPub.publish(
      `room:events:${docId}`,
      JSON.stringify({ type: 'USER_LEFT', userId })
    );

    // If room is empty, persist snapshot to database and evict from memory
    if (room.clients.size === 0) {
      await persistDocumentSnapshot(docId, room.doc);
      activeRooms.delete(docId);
    }
  });
});

async function persistDocumentSnapshot(docId: string, doc: Y.Doc) {
  const binarySnapshot = Buffer.from(Y.encodeStateAsUpdate(doc));
  console.log(`[SNAPSHOT PERSISTED]: Saved document ${docId} (${binarySnapshot.length} bytes) to storage.`);
  // In production, execute SQL: UPDATE documents SET snapshot = $1 WHERE id = $2
}

server.listen(4000, () => console.log('[COLLAB SERVER]: Running on port 4000'));
```

---

## 6. Under the Hood: CRDT State Vectors & Binary Commutativity

### How CRDTs Eliminate Concurrency Conflicts
In standard databases, operations are executed sequentially. If Network Packet A arrives after Network Packet B, order matters.
In a **State-based / Operation-based CRDT**:
- Every character inserted into a document is assigned an immutable, globally unique identifier:
  $$\text{ID} = \langle \text{ClientID}, \text{LogicalClockSequence} \rangle$$
- Every character holds relative positional links to its left and right neighbors.
- Operations satisfy the **Semilattice Properties**:
  1. **Commutativity**: $A \cup B = B \cup A$ (Order of arrival does not matter).
  2. **Associativity**: $(A \cup B) \cup C = A \cup (B \cup C)$ (Grouping does not matter).
  3. **Idempotence**: $A \cup A = A$ (Duplicate delivery has zero side effects).
- **Result**: Whether Server 1 receives Edit A and then Edit B, or Server 2 receives Edit B and then Edit A, both servers compute the **exact same final text document** without any centralized coordinator lock!

---

## 7. Important Rules

1. **Client-Side Cursor Throttling (30fps Limit)**:
   Never transmit raw `mousemove` events on every browser animation frame. Mouse movements fire hundreds of times per second. Throttle client cursor emissions using `requestAnimationFrame` or a 30ms throttle timer.
2. **Decouple Ephemeral State from Persistent State**:
   - **Ephemeral State** (Cursor coordinates, active selections, typing indicators): Broadcast exclusively over Redis Pub/Sub; **never write to disk or PostgreSQL**.
   - **Persistent State** (Document blocks, text contents): Buffered in CRDT memory; written periodically to PostgreSQL / S3.
3. **Implement Heartbeat Ping/Pong for Dead Socket Detection**:
   Cellular networks (4G/5G) drop TCP connections silently. The server must send a lightweight WebSocket `ping` every 30 seconds; if the client does not return a `pong` within 5 seconds, terminate the socket and clean up room presence.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Broadcasting Mouse Coordinates to the Origin Sender
Forwarding a user's cursor coordinates back to their own WebSocket connection. The client tries to render its own cursor based on round-trip network events, introducing visual jitter and double-rendering. Filter out the `senderId`.

### 2. Writing Every Keystroke Directly to PostgreSQL
Executing `UPDATE documents SET content = ...` on every single typed letter. At 100 concurrent typing users, this generates 500 writes/sec, saturating database disk I/O and creating database locks. Buffer CRDT deltas in memory and snapshot periodically.

---

## 9. Best Practices

- **Document Versioning via Snapshot Compaction**:
  As users collaborate, Yjs document update logs grow. Periodically take a full document snapshot (`Y.encodeStateAsUpdate(doc)`), persist it to Amazon S3, and truncate the historical delta logs to keep memory footprints lean.
- **Visual Color Assignment via User ID Hashing**:
  Assign consistent cursor colors to collaborators deterministically:
  ```typescript
  const CURSOR_COLORS = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6'];
  const userColor = CURSOR_COLORS[Math.abs(hashCode(userId)) % CURSOR_COLORS.length];
  ```

---

## 10. Performance Considerations

- **Binary WebSocket Payloads**: Transmit CRDT deltas as raw `Uint8Array` binary buffers rather than JSON Base64 strings. Binary frames reduce network packet size by 35% and eliminate JSON serialization CPU costs.
- **Room Multiplexing over a Single Socket**: If a user has 5 tabs or documents open, multiplex all document rooms over a single persistent WebSocket connection to minimize TCP socket exhaustion.

---

## 11. Security Considerations

- **WebSocket Authentication during Upgrade Handshake**:
  Do not allow anonymous WebSocket upgrades. Validate the user’s JWT or session cookie during the HTTP `Upgrade` handshake before establishing the raw WebSocket connection:
  ```typescript
  server.on('upgrade', (req, socket, head) => {
    const token = parseCookie(req).auth_token;
    if (!verifyJwt(token)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
  });
  ```
- **Document Access Authorization**: Verify that the authenticated `userId` has `READ` or `WRITE` permissions for `docId` in PostgreSQL before adding their socket to the collaborative room.

---

## 12. Alternatives

| Technology / Library | State Model | Scalability | Complexity |
|---|---|---|---|
| **Yjs** | High-performance CRDT | Extreme (Client & Server) | Medium (Industry Standard) |
| **Automerge** | JSON-based CRDT | Good | Medium (Higher memory overhead) |
| **ShareDB / ShareJS** | Operational Transformation (OT)| Moderate | High (Requires central coordinator)|
| **Liveblocks / Replicache** | Commercial Managed Collab | Extreme | Low (Proprietary SaaS) |

---

## 13. Trade-offs

- **CRDT Memory Overhead vs. OT Simplicity**:
  CRDTs store historical metadata (client IDs and clock sequence numbers) alongside characters to resolve conflicts, increasing memory usage by $\approx 1.5\text{x}$ compared to plain text. However, they eliminate the need for complex, fragile centralized Operational Transformation servers, making multi-region active-active synchronization possible.

---

## 14. Real-World Usage & Implementation Example: Client-Side React Canvas Cursor & Yjs Provider

```tsx
// CollaborativeEditor.tsx (React Frontend)
import React, { useEffect, useState, useRef } from 'react';
import * as Y from 'yjs';

interface Cursor {
  x: number;
  y: number;
  userName: string;
  color: string;
}

export const CollaborativeCanvas: React.FC<{ docId: string; userId: string; userName: string }> = ({
  docId,
  userId,
  userName,
}) => {
  const [remoteCursors, setRemoteCursors] = useState<Record<string, Cursor>>({});
  const socketRef = useRef<WebSocket | null>(null);
  const lastEmitTime = useRef(0);

  useEffect(() => {
    // 1. Establish persistent WebSocket connection
    const ws = new WebSocket(`wss://api.mycompany.com/collab?docId=${docId}&userId=${userId}`);
    socketRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'CURSOR_MOVE') {
        setRemoteCursors((prev) => ({
          ...prev,
          [data.senderId]: data.cursor,
        }));
      } else if (data.type === 'USER_LEFT') {
        setRemoteCursors((prev) => {
          const next = { ...prev };
          delete next[data.userId];
          return next;
        });
      }
    };

    return () => {
      ws.close();
    };
  }, [docId, userId]);

  // 2. Throttled Mousemove Handler (Max 30 FPS)
  const handleMouseMove = (e: React.MouseEvent) => {
    const now = Date.now();
    if (now - lastEmitTime.current < 33) return; // 33ms throttle = 30 FPS cap!
    lastEmitTime.current = now;

    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(
        JSON.stringify({
          type: 'CURSOR_MOVE',
          cursor: {
            x: e.clientX,
            y: e.clientY,
            userName,
            color: '#3B82F6',
          },
        })
      );
    }
  };

  return (
    <div onMouseMove={handleMouseMove} style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <h1>Collaborative Workspace: {docId}</h1>

      {/* Render Remote User Cursors */}
      {Object.entries(remoteCursors).map(([id, cursor]) => (
        <div
          key={id}
          style={{
            position: 'absolute',
            left: cursor.x,
            top: cursor.y,
            pointerEvents: 'none',
            transition: 'all 50ms linear', // Smooth cursor interpolation
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill={cursor.color}>
            <path d="M3 3l7 18 3-7 7-3L3 3z" />
          </svg>
          <span
            style={{
              backgroundColor: cursor.color,
              color: 'white',
              fontSize: '10px',
              padding: '2px 4px',
              borderRadius: '3px',
            }}
          >
            {cursor.userName}
          </span>
        </div>
      ))}
    </div>
  );
};
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: What is the fundamental difference between Operational Transformation (OT) and CRDTs?
**Answer**:
- **Operational Transformation (OT)**: Relies on a **centralized server** that acts as the single source of truth. When clients send edits (e.g., `insert(pos, char)`), the server transforms the operations against concurrent edits using a transformation matrix before broadcasting. Used by Google Docs.
- **Conflict-Free Replicated Data Types (CRDTs)**: Mathematically structured data types where operations are designed to be **commutative and associative**. Edits can arrive in any order across distributed peers, and all clients are guaranteed to converge to the exact same document state without requiring a centralized coordinator. Used by Figma and Linear.

### 2. Conceptual: How do you scale a WebSocket-based collaboration service across multiple backend server instances?
**Answer**:
By utilizing a **Distributed Pub/Sub Message Broker (Redis Pub/Sub)**:
1. When User A and User B connect, their persistent TCP WebSockets may land on different physical servers (Server 1 in US, Server 2 in Europe) due to load balancing.
2. When User A types in Document #42, Server 1 receives the WebSocket frame and publishes the delta to Redis channel: `doc:42`.
3. All backend server instances that currently have connected clients for Document #42 subscribe to `doc:42`.
4. Server 2 receives the Redis pub/sub event, looks up User B's local in-memory socket, and emits the frame down to User B's browser in real time.

### 3. Implementation: How do you prevent high-frequency cursor tracking from overwhelming network bandwidth?
**Answer**:
1. **Client-Side Throttling**: Cap `mousemove` events to **30 FPS (every 33ms)** or 20 FPS using `requestAnimationFrame`.
2. **Ephemeral Volatile Transport**: Do not persist cursor events to disk or database. Broadcast cursor updates over lightweight volatile Redis channels.
3. **Delta Compression**: Transmit only raw coordinate numbers (`[x, y]`), not heavy JSON wrappers.
4. **Deadband Thresholding**: Only transmit an update if the mouse has moved more than 3 pixels from its last transmitted coordinate.

### 4. Debugging: A user disconnected ungracefully (laptop battery died), but their avatar badge remains stuck on the document for 30 minutes. How do you resolve this?
**Answer**:
1. **Root Cause**: When a machine loses power or signal abruptly, no TCP termination packet (`FIN`) is sent. The server's TCP socket remains open in an idle state until OS-level TCP timeouts expire.
2. **Implementation Fix**: Implement an **Application-Level Heartbeat (Ping/Pong)**:
   - The WebSocket server sends a `ping` frame every 15–30 seconds.
   - If the client does not respond with a `pong` within 5 seconds, the server terminates the socket (`ws.terminate()`).
   - The server catches the socket termination, broadcasts a `USER_LEFT` presence event to the Redis room channel, and cleans up the user from the active collaborator list.

### 5. Scenario: How do you handle offline editing when a user works on a document on an airplane and reconnects hours later?
**Answer**:
CRDTs handle offline editing natively:
1. While offline, all document edits are recorded as local CRDT state updates in browser storage (**IndexedDB**).
2. When internet connectivity is restored, the client establishes a WebSocket connection and transmits its accumulated **State Vector**.
3. The server computes the differential delta (`Y.encodeStateAsUpdate(serverDoc, clientStateVector)`).
4. The server merges the client’s offline changes into the document and broadcasts the merged updates to other collaborators. Because CRDT operations commute deterministically, conflicting edits merge cleanly without overwriting.

### 6. Advanced: What is "Garbage Collection" in CRDTs, and why is it necessary?
**Answer**:
In CRDTs, deleting a character does not simply remove the byte; it replaces the character with an invisible marker called a **Tombstone** to ensure that other concurrent edits referencing that character's relative position know where it previously existed. 
Over years of editing, documents accumulate millions of tombstones, bloating memory. 
**Compaction & Garbage Collection**:
When all active collaborators have acknowledged a specific state vector (the "stable checkpoint"), tombstones older than that checkpoint can be safely pruned, and the document is rewritten into a clean snapshot, reclaiming memory.

---

## 16. Coding Questions & Practical Challenges

1. **Sliding-Window Mouse Throttler**: Write a pure TypeScript utility class that accepts high-frequency coordinate events and yields updates at a maximum configurable frequency of 30Hz using `requestAnimationFrame`.
2. **WebSocket Room Registry**: Implement a Node.js class that manages active rooms, tracks client counts, prevents memory leaks when rooms become empty, and provides a cleanup timer.
3. **CRDT Text Merger Test**: Write a unit test using Vitest and `yjs` that simulates two users inserting text at position 0 simultaneously and asserts that both users converge to an identical string without throwing exceptions.

---

## 17. Common Interview Traps

- **Trap 1: Storing live cursor coordinates in PostgreSQL**: Writing cursor coordinates to a database will destroy database performance within seconds. Cursor tracking is purely transient and must exist only in memory and volatile pub/sub channels.
- **Trap 2: Believing WebSockets automatically reconnect**: Native browser WebSockets do not auto-reconnect. You must implement an exponential backoff reconnection loop on the client (`reconnectDelay = min(30000, 1000 * 2^attempt)`).
- **Trap 3: Forgetting to authenticate WebSocket upgrades**: Never assume WebSockets are secure by default. An unauthenticated WebSocket endpoint allows anyone to listen to private corporate document streams. Always validate credentials on the HTTP `upgrade` request.

---

## 18. Revision Summary

- **Document Consistency**: Use CRDTs (Yjs) for decentralized, mathematically conflict-free real-time document merging.
- **Scale Across Fleets**: Decouple WebSocket instances using **Redis Pub/Sub** room channels.
- **Network Optimization**: Throttle cursor updates to 30 FPS; transmit binary deltas; separate transient presence from persistent document storage.
- **Persistence Strategy**: Buffer CRDT state in memory; periodically write compacted snapshots to PostgreSQL / S3.

---

## 19. Quick Reference Cheatsheet

```typescript
// Essential Yjs Operations Cheatsheet
import * as Y from 'yjs';

const docA = new Y.Doc();
const docB = new Y.Doc();

// 1. Text Manipulation
const textA = docA.getText('content');
textA.insert(0, 'Hello World');

// 2. Compute Differential Update
const updateFromA = Y.encodeStateAsUpdate(docA);

// 3. Apply Update to Peer B (Automatic Conflict Resolution!)
Y.applyUpdate(docB, updateFromA);

console.log(docB.getText('content').toString()); // "Hello World"
```
