# Project 1: Collaborative Kanban Board Defense Guide

## 1. What is it?
The **Collaborative Real-Time Kanban Board** (Trello/Jira clone) is a full-stack web application designed for distributed team agile project management. It provides drag-and-drop board organization (Columns, Tasks, Tags, Assignees), real-time multi-user cursor and card synchronization via WebSockets, optimistic UI updates, activity audit logging, and fractional indexing (LexoRank) for collision-free task reordering.

In placement interviews, candidates present this project to demonstrate their mastery over:
- Complex client-side DOM drag-and-drop manipulation and optimistic UI reconciliations.
- Scalable real-time synchronization architectures using WebSockets and Redis Pub/Sub.
- Database design patterns for ordered lists without $O(N)$ reindexing penalties.
- Concurrency conflict resolution and offline-first data synchronization.

```
       COLLABORATIVE KANBAN SYSTEM ARCHITECTURE
       
   ┌─────────────────────────────────────────────────────────────┐
   │ BROWSER CLIENTS (React + dnd-kit + Zustand + Socket.io)     │
   │                                                             │
   │  [ User A (Drag Task 101) ]       [ User B (Viewing Board) ]│
   └───────────────┬─────────────────────────────▲───────────────┘
                   │ HTTPS / WSS                 │ WSS Broadcast
                   ▼                             │
   ┌─────────────────────────────────────────────┴───────────────┐
   │ LOAD BALANCER & GATEWAY (Nginx / ALB)                       │
   └───────────────┬─────────────────────────────▲───────────────┘
                   │ Round-Robin                 │
                   ▼                             │
   ┌─────────────────────────────┐ ┌─────────────┴───────────────┐
   │ Node.js Server Instance 1   │ │ Node.js Server Instance 2   │
   │  - Socket.io Gateway        │ │  - Socket.io Gateway        │
   │  - Optimistic Mutation Sync │ │  - Optimistic Mutation Sync │
   └───────────────┬─────────────┘ └─────────────▲───────────────┘
                   │                             │
                   ▼  Pub/Sub                    │
   ┌─────────────────────────────────────────────┴───────────────┐
   │ REDIS CLUSTER (Pub/Sub Channel: "board:42:events")          │
   └───────────────┬─────────────────────────────────────────────┘
                   │ Write Behind / Direct ACID Transactions
                   ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ POSTGRESQL PRIMARY (ACID Storage + LexoRank Fractional Index)│
   └─────────────────────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Modern distributed engineering teams cannot function on static spreadsheets or slow-reloading dashboards. A production Kanban board solves:
1. **Real-Time Visibility:** Preventing team members from working on identical tasks concurrently.
2. **Instant Tactile Feedback:** High-frequency drag-and-drop interactions requiring sub-16ms UI frame execution.
3. **Auditable Team State:** Clear lineage of who moved what card, when, and why.

---

## 3. Mental Model
Think of the Kanban board as a **Physical Magnetic Whiteboard in a Glass Conference Room**:

```
                       WHITEBOARD ANALOGY
                       
  [ The Physical Board (Database & Redis State) ]
     - Has columns: "To Do", "In Progress", "Done".
     - Every task is a magnetic card.
     
  [ The Engineer (User A) ]
     - Reaches out their hand and physically moves a card (Optimistic UI update).
     - Does not wait for permission from the team; assumes the move is valid.
     
  [ The Overhead Camera & PA System (WebSocket + Redis Pub/Sub) ]
     - The moment User A's magnet hits the new column, the overhead system announces
       to User B across the ocean: "Card #101 moved to 'In Progress' between #12 and #15".
     - User B's clone whiteboard instantly moves the magnetic card automatically.
```

---

## 4. Basic Example: The Task Ordering Problem

### The Naive Approach: Integer Indexing (Why It Fails)
```
  Column: "In Progress"
  Position 0: Task A
  Position 1: Task B
  Position 2: Task C
  Position 3: Task D
  
  What happens when user drags Task D between Task A and Task B?
  Task D becomes Position 1.
  Task B must be updated to Position 2. (UPDATE tasks SET position = 2 WHERE id = B)
  Task C must be updated to Position 3. (UPDATE tasks SET position = 3 WHERE id = C)
  
  💥 In a column of 5,000 tasks:
  A single drag-and-drop triggers 4,999 SQL UPDATE queries ($O(N)$ write amplification)!
```

### The Production Fix: Fractional Indexing (LexoRank)
```
  Instead of integers, position is a floating-point number or alphabetical string!
  
  Position "1000": Task A
  Position "2000": Task B
  
  Drag Task D between A and B:
  New Position = (1000 + 2000) / 2 = "1500"
  
  ✅ Exactly ONE single row updated:
  UPDATE tasks SET rank = 1500 WHERE id = 'D';
  Time Complexity: O(1) write operation!
```

---

## 5. Real Example: LexoRank String Midpoint Algorithm in TypeScript

```typescript
export class LexoRank {
  private static readonly ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

  /**
   * Generates a lexicographically midway string between prev and next
   */
  public static getMidpoint(prev: string, next: string): string {
    let p = prev || '0';
    let n = next || 'z';

    // Ensure p is strictly less than n
    if (p >= n) {
      throw new Error(`Invalid rank bounds: ${p} must be < ${n}`);
    }

    let result = '';
    let i = 0;

    while (true) {
      const charP = p[i] ? LexoRank.ALPHABET.indexOf(p[i]) : 0;
      const charN = n[i] ? LexoRank.ALPHABET.indexOf(n[i]) : LexoRank.ALPHABET.length - 1;

      if (charP === charN) {
        result += LexoRank.ALPHABET[charP];
        i++;
        continue;
      }

      if (charN - charP > 1) {
        // Safe midpoint found in current character position
        const midChar = Math.floor((charP + charN) / 2);
        result += LexoRank.ALPHABET[midChar];
        break;
      } else {
        // Consecutive characters (e.g. 'a' and 'b'). Append 'a' and descend to next char!
        result += LexoRank.ALPHABET[charP];
        i++;
        p = p[i] ? p : p + '0';
        n = ''; // Remove upper constraint for sub-character insertion
      }
    }

    return result;
  }
}

// Example Execution:
// LexoRank.getMidpoint('a', 'c') -> 'b'
// LexoRank.getMidpoint('a', 'b') -> 'am'
// LexoRank.getMidpoint('am', 'b') -> 'as'
```

---

## 6. Under the Hood: Optimistic UI with Zustand & Rollback

```
             CLIENT-SIDE OPTIMISTIC RECONCILIATION
             
  [ User Drops Card ]
          │
          ├── 1. Zustand Store mutates state immediately (UI updates in 0ms)
          │
          ├── 2. POST /api/cards/reorder fired asynchronously
          │
          ├── 3. If HTTP 200 OK:
          │        Emit socket event -> Broadcast to other clients
          │
          └── 4. If HTTP 500 / Network Error:
                   Zustand rolls back to cached snapshot!
                   Toast Notification: "Failed to move card. Restoring state."
```

---

## 7. Important Rules

1. **Never Reindex Whole Columns Synchronously:** Always use fractional indexing or LexoRank for card positioning. Schedule background rebalancing only when string lengths exceed 64 characters.
2. **Never Broadcast to the Originating Socket:** When broadcasting card movements via Socket.io, always use `socket.to(boardRoom).emit()`, not `io.to(boardRoom).emit()`. The sender has already optimistically rendered the change!
3. **Database Transactions on Column Swaps:** Moving a card to another column changes both `column_id` and `rank`. This must execute within an ACID `BEGIN...COMMIT` block.

---

## 8. Common Mistakes

- **Mistake 1:** Storing column arrays as JSON blobs in a single row. This prevents concurrent task edits.
- **Mistake 2:** Missing socket room isolation, broadcasting user movements across different boards.
- **Mistake 3:** Not virtualizing task lists, causing DOM thrashing when a column has > 200 cards.

---

## 9. Best Practices

1. **Use `dnd-kit` Over `react-beautiful-dnd`:** Modern accessibility, touch support, and zero deprecated React 18 warnings.
2. **Redis Adapter for Socket.io:** Always configure `@socket.io/redis-adapter` so multi-instance Node servers communicate seamlessly.
3. **Window Virtualization:** Integrate `@tanstack/react-virtual` for boards containing thousands of tasks.

---

## 10. Performance Considerations

| Metric | Integer Reindexing | LexoRank Fractional Indexing |
|---|---|---|
| **SQL Writes per Move** | $O(N)$ (e.g., 500 updates) | $O(1)$ (Exactly 1 update) |
| **Lock Contention** | High (Locks entire column table range) | Row-level lock on moved card only |
| **API Latency** | 250ms - 1,200ms | < 15ms |

---

## 11. Security Considerations
- **Board Authorization Guard:** Validate that `req.user.id` is an authorized member of `board_id` in middleware before processing WebSocket events.
- **Payload Validation:** Validate incoming rank strings and column UUIDs with Zod to prevent SQL injection or corrupted rank values.

---

## 12. Alternatives
1. **CRDTs (Conflict-Free Replicated Data Types):** Use Yjs or Automerge for peer-to-peer real-time collaboration.
2. **Operational Transformation (OT):** Used in Google Docs, but overkill for discrete card movement.

---

## 13. Trade-offs

| Ordering Strategy | Advantages | Trade-offs |
|---|---|---|
| **LexoRank Strings** | $O(1)$ single-row updates | Requires occasional background rebalancing when strings grow long |
| **Linked List (prev_id / next_id)** | Pure relational model | Requires updating 3 rows per move; complex multi-row pointer queries |

---

## 14. Real-World Usage
- **Jira & Atlassian:** Jira engineered the original **LexoRank** algorithm to power sprint boards with millions of issues without database deadlocks.
- **Trello:** Uses floating-point positional midpoints with automatic background rebalancing.

---

## 15. Placement Interview Questions (Defense & System Design)

### Basic
1. *How does optimistic UI work in your Kanban project?*
   - **Answer:** When a user drops a card, client-side state is updated immediately via Zustand/React state before making the network request. If the backend fails or returns an error, the state is rolled back to a snapshot taken prior to the drag action.

### Conceptual
2. *Why did you choose WebSockets over Server-Sent Events (SSE) or HTTP Long Polling?*
   - **Answer:** Kanban boards require bidirectional, low-latency interaction. Users both push rapid card updates and receive real-time updates from others. While SSE is great for unidirectional feeds, WebSockets provide lightweight full-duplex communication over a single persistent TCP connection.

### Implementation
3. *How do you synchronize WebSockets across multiple horizontal Node.js servers?*
   - **Answer:** By using Redis Pub/Sub with the `@socket.io/redis-adapter`. When Server 1 receives a move event, it publishes it to a Redis channel (`board:42`). All other server instances subscribed to that channel receive the message and forward it to their locally connected WebSocket clients.

### Debugging
4. *Two users drag the same card into different columns simultaneously. How do you resolve this conflict?*
   - **Answer:** Using **Optimistic Concurrency Control (OCC)** with a `version` column. Each update sends `WHERE id = cardId AND version = currentVersion`. The first write succeeds and increments the version. The second write returns 0 rows updated, triggers a conflict error, and emits a socket refresh event to restore the winning state on the losing client.

### Scenario
5. *How would you support offline editing in your Kanban board?*
   - **Answer:** Store local mutations in IndexedDB using Dexie.js. Tag each mutation with a timestamp and client UUID. When internet connection is restored, replay the mutation queue against the server using Last-Write-Wins or CRDT reconciliation.

---

## 16. Coding Questions

### Problem: Optimistic Concurrency Control (OCC) Card Update in SQL
Write an atomic PostgreSQL query updating a card's column and rank, ensuring no overwrite if another user modified it concurrently.

```sql
-- Atomic OCC Update
UPDATE cards
SET 
  column_id = $new_column_id,
  rank = $new_rank,
  version = version + 1,
  updated_at = NOW()
WHERE id = $card_id AND version = $expected_version
RETURNING id, column_id, rank, version;
```

---

## 17. Common Interview Traps
- **Trap 1:** Claiming integers with step sizes (10, 20, 30) solve the reindexing problem.
  *Reality:* Rapid reordering between 10 and 20 quickly collapses to integers (10, 15, 12, 11) until no gaps remain, forcing full column reindexing.
- **Trap 2:** Storing connected WebSockets in a global JavaScript array on the server.
  *Reality:* Breaks the moment you scale to 2 server instances. Always use Redis Pub/Sub.

---

## 18. Revision Summary
- **Positioning:** LexoRank string midpoints provide $O(1)$ single-row updates.
- **Real-Time:** WebSockets backed by Redis Pub/Sub adapter for horizontal clustering.
- **Client UX:** Optimistic UI with rollback snapshots and drag-and-drop virtualization.
- **Conflict Handling:** Optimistic Concurrency Control using version integers.

---

## 19. Quick Reference

```
┌─────────────────────────────────┬───────────────────────────────────────────────┐
│ ARCHITECTURAL PILLAR            │ IMPLEMENTATION CHOICE                         │
├─────────────────────────────────┼───────────────────────────────────────────────┤
│ Drag and Drop Library           │ @dnd-kit/core & @dnd-kit/sortable             │
│ State Management                │ Zustand with snapshot rollback middleware     │
│ Ordering Strategy               │ LexoRank String Midpoints (O(1) writes)       │
│ Real-Time Layer                 │ Socket.io with Redis Pub/Sub Cluster Adapter  │
│ Conflict Resolution             │ Optimistic Concurrency Control (Version check)│
└─────────────────────────────────┴───────────────────────────────────────────────┘
```
