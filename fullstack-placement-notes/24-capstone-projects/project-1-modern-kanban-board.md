# Capstone Project 1: High-Performance Collaborative Kanban Board (Trello Clone)

## 1. What is it?
A **High-Performance Collaborative Kanban Board** (exemplified by Trello, Jira, and Linear) is an interactive, real-time project management and workflow visualization application. It enables distributed teams to manage tasks across custom workflow stages (Lists: *Backlog*, *In Progress*, *Code Review*, *Done*) using visual Cards that can be dragged, reordered, tagged, assigned, and updated with sub-millisecond perceived latency.

Architecturally, this project is the gold standard for full-stack engineering interviews because it rigorously evaluates:
1. **Fluid Drag-and-Drop & Optimistic UI**: Reordering cards across lists with zero UI lag, executing instant optimistic state transitions while handling background server synchronization and automatic rollbacks on network failure.
2. **List Ordering Algorithms (Lexorank / Fractional Indexing)**: Moving a card between position 2 and position 3 without executing an $O(N)$ database write re-indexing 50,000 subsequent cards.
3. **Multi-User Real-Time Synchronization**: Using WebSockets or Server-Sent Events (SSE) with Redis Pub/Sub so that when Engineer A drops a card into "Done", Engineer B's screen reflects the move in real time without full board refreshes.
4. **Normalized Relational Data Modeling**: High-performance PostgreSQL schema with optimized indexes covering workspaces, boards, lists, cards, comments, and audit logs.

```
                    COLLABORATIVE KANBAN ARCHITECTURE
                    
 [ User Browser A ]                                [ User Browser B ]
         │                                                 ▲
         │ 1. Drag & Drop Card                             │ 5. WebSocket Broadcast
         ▼ (Optimistic UI Update)                          │    (CardMoved Event)
 ┌───────────────────────────┐                     ┌───────┴───────────────────┐
 │ Next.js / Zustand Store   │                     │ Next.js Client (User B)   │
 │ • Reorders locally in <1ms│                     │ • Patches normalized cache│
 └─────────────┬─────────────┘                     └───────▲───────────────────┘
               │ 2. Async PATCH /api/cards/reorder         │
               ▼                                           │
 ┌─────────────────────────────────────────────────────────┴───────────────────┐
 │ Node.js Express API & WebSocket Gateway                                     │
 │ • Computes Lexorank Fractional Position String                              │
 │ • Updates PostgreSQL inside Transaction                                     │
 │ • Emits Redis Pub/Sub Event: `board:update:102`                             │
 └─────────────────────────────┬───────────────────────────────────────────────┘
                               │
                               ▼ 3. Relational Persistence
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ PostgreSQL 16 (Normalized Relational Model)                                 │
 │ `UPDATE cards SET list_id = $1, position = $2 WHERE id = $3`                │
 └─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Building a simple todo list does not test senior engineering competence. Interviewers at top product companies evaluate candidates on a Kanban platform because it directly exposes architectural trade-offs:

1. **The Reordering Catastrophe ($O(N)$ Database Writes)**: In a naive database where card positions are stored as integers (`position: 1, 2, 3, 4...`), dragging Card 50 to Position 1 requires executing an update on all 49 intermediate rows (`UPDATE cards SET position = position + 1 WHERE position < 50`). In a list of 5,000 cards, this locks the database and destroys throughput.
2. **Optimistic UI vs. Network Latency**: Network round-trips take 100–300ms. If a user drags a card and the UI freezes waiting for the server response, the user experience feels sluggish and broken. Implementing instant client-side optimistic UI with rollback on network failure is required.
3. **Concurrent Collaboration Clashes**: If two project managers drag the same card into different columns simultaneously, naive overwrites corrupt board state. The system must implement optimistic concurrency control and distributed event broadcasting.

---

## 3. Mental Model
Think of the Kanban board like physical sticky notes on a glass whiteboard:
- A user picking up a note and moving it to a new column happens instantaneously in the physical world (Optimistic UI).
- Instead of re-numbering every sticky note on the wall with a pen (Integer indexing), each note has a coordinate bookmark (Fractional Lexorank). If Note A is at coordinate `1.0` and Note B is at `2.0`, placing a new note in between simply assigns coordinate `1.5`.
- If someone else in the room is watching, they see the note move immediately because light travels across the room instantly (WebSocket broadcasting).

---

## 4. Basic Example: The Naive Integer Reordering Anti-Pattern

```typescript
// ❌ NAIVE APPROACH: Sequential Integer Shifting (O(N) Database Writes!)
async function moveCardNaive(cardId: string, newListId: string, newIndex: number) {
  // 1. Shift all cards below newIndex down by 1 (Massive table write lock!)
  await db.query(
    'UPDATE cards SET position = position + 1 WHERE list_id = $1 AND position >= $2',
    [newListId, newIndex]
  );
  // 2. Insert card at exact index
  await db.query(
    'UPDATE cards SET list_id = $1, position = $2 WHERE id = $3',
    [newListId, newIndex, cardId]
  );
}
```

---

## 5. Real Example: Production Fractional Indexing (Lexorank Engine)

In production (Linear / Jira), card positions are represented as **strings or floating-point ranks**. Inserting an item between two items requires updating **only a single row** ($O(1)$ database write):

```
Inserting a card between "a" and "b":
Position A = "a0"
Position B = "b0"
New Position = midpoint("a0", "b0") ──► "an" (Only 1 database row updated!)
```

### Fractional Indexing Algorithm Implementation
```typescript
// lexorank.ts
export class FractionalIndexer {
  private static BASE_CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

  /**
   * Generates a lexicographical midpoint string between two arbitrary strings.
   * e.g., getMidpoint("a", "b") -> "an"
   */
  static getMidpoint(prev: string = '', next: string = ''): string {
    if (!prev && !next) return 'm'; // Initial root item
    if (!prev) return this.getBefore(next);
    if (!next) return this.getAfter(prev);

    let result = '';
    let i = 0;

    while (true) {
      const prevChar = prev[i] || '0';
      const nextChar = next[i] || 'z';

      if (prevChar === nextChar) {
        result += prevChar;
        i++;
        continue;
      }

      const prevIndex = this.BASE_CHARS.indexOf(prevChar);
      const nextIndex = this.BASE_CHARS.indexOf(nextChar);

      // If characters have room in between, pick middle character
      if (nextIndex - prevIndex > 1) {
        const midIndex = Math.floor((prevIndex + nextIndex) / 2);
        result += this.BASE_CHARS[midIndex];
        return result;
      }

      // If characters are consecutive (e.g. 'a' and 'b'), append midpoint of next depth
      result += prevChar;
      i++;
      return result + 'm';
    }
  }

  private static getBefore(next: string): string {
    const firstChar = next[0];
    const index = this.BASE_CHARS.indexOf(firstChar);
    if (index > 0) {
      return this.BASE_CHARS[Math.floor(index / 2)] + next.slice(1);
    }
    return '0' + next;
  }

  private static getAfter(prev: string): string {
    const lastChar = prev[prev.length - 1];
    const index = this.BASE_CHARS.indexOf(lastChar);
    if (index < this.BASE_CHARS.length - 1) {
      return prev.slice(0, -1) + this.BASE_CHARS[index + 1];
    }
    return prev + 'm';
  }
}
```

---

## 6. Under the Hood: Relational Data Model & Normalized State

### A. Production PostgreSQL Schema (`schema.sql`)
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Workspaces & Boards
CREATE TABLE boards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(120) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Workflow Columns (Lists)
CREATE TABLE lists (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    title VARCHAR(100) NOT NULL,
    position VARCHAR(64) NOT NULL, -- Fractional index
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_lists_board_position ON lists (board_id, position ASC);

-- Task Cards
CREATE TABLE cards (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    position VARCHAR(64) NOT NULL, -- Fractional Lexorank string
    version INT NOT NULL DEFAULT 1, -- Optimistic concurrency lock
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
-- Compound Index: Guarantees ultra-fast O(log N) sorted list retrieval!
CREATE INDEX idx_cards_list_position ON cards (list_id, position ASC);
```

### B. Frontend Normalized State Architecture
Instead of storing cards nested inside lists (`List -> Card[]`), modern state management (Zustand / Redux) normalizes entities into relational ID dictionaries to prevent wasted re-renders:

```typescript
interface NormalizedKanbanState {
  boards: Record<string, Board>;
  lists: Record<string, List>;
  cards: Record<string, Card>;
  // Relational link: List contains array of Card UUIDs
  listCardMap: Record<string, string[]>; 
}
```

---

## 7. Important Rules

1. **Always Implement Optimistic Rollback Mechanisms**:
   When a user drags a card, update client Zustand state immediately. Store a snapshot of the previous state. If the background HTTP request fails (e.g., HTTP 500 or network drop), immediately restore the snapshot and trigger a visual toast error: *"Failed to save position. Card restored."*
2. **Index by `(list_id, position ASC)`**:
   Every time a board loads, the query executes: `SELECT * FROM cards WHERE list_id = $1 ORDER BY position ASC`. Without a compound B-Tree index on `(list_id, position)`, PostgreSQL must perform an expensive sequential scan followed by an in-memory Quicksort (`Sort Method: quicksort`).
3. **Debounce Rapid Consecutive Moves**:
   If an indecisive user drags a card across 4 columns in 2 seconds, do not fire 4 distinct HTTP updates. Debounce the server synchronization by 300ms, persisting only the final resting position.

---

## 8. Common Mistakes & Anti-Patterns

### 1. The Integer Division Precision Underflow
Using standard JavaScript numbers for fractional indices (`position = (prev + next) / 2`). 
After 50 drag operations in the same slot:
`1.5` $\rightarrow$ `1.25` $\rightarrow$ `1.125` ... $\rightarrow$ `1.0000000000000002`.
JavaScript IEEE-754 64-bit floats lose precision after 16 decimal places, causing cards to collide with identical positions. **Solution**: Use string-based Lexorank (arbitrary string midpoints) or periodic background rebalancing.

### 2. Missing Optimistic Concurrency Control (Lost Updates)
User A and User B drag the same card simultaneously. User A's update arrives at second 1; User B's update arrives at second 2, silently overwriting User A's move without User A being notified.
**Fix**: Include a `version` column in the update:
```sql
UPDATE cards 
SET list_id = $1, position = $2, version = version + 1 
WHERE id = $3 AND version = $4;
```
If 0 rows are updated, the version was outdated; return HTTP 409 Conflict and refresh the client's board.

---

## 9. Best Practices

- **Automated Lexorank Rebalancing Cron**:
  Over months of thousands of drag operations, fractional rank strings can grow long (e.g., `"amzz019283"`). Run a low-priority background worker at 2 AM that queries each list and resets positions to clean equidistant intervals (`"1000"`, `"2000"`, `"3000"`).
- **Decouple Heavy Metadata from Card Board Queries**:
  The initial board view requires only card titles, labels, assignees, and positions. Do not fetch heavy rich-text descriptions or full comment histories in the main board query. Fetch detailed card metadata on demand when the user clicks to open the card modal.

---

## 10. Performance Considerations

- **Virtualization for Massive Lists**: If a list contains 5,000 cards, rendering 5,000 DOM elements causes massive browser memory bloat and scroll lag. Use **`@tanstack/react-virtual`** to render only the 15 cards currently visible inside the viewport.
- **WebSocket Broadcast Throttling**: When broadcasting card move events via Redis Pub/Sub, debounce events per board so that rapid multi-user movements do not saturate client WebSocket buffers.

---

## 11. Security Considerations

- **Tenant Isolation on Reorders**:
  When reordering a card, verify not only that the card exists, but that both the `source_list` and `destination_list` belong to a board that the authenticated user has permission to edit:
  ```sql
  SELECT 1 FROM lists l 
  JOIN boards b ON b.id = l.board_id 
  WHERE l.id = $1 AND b.workspace_id = $2;
  ```
- **XSS Prevention in Card Titles**: Sanitize all card markdown and titles using DOMPurify before rendering in the browser.

---

## 12. Alternatives

| Positioning Strategy | Write Complexity | Read Complexity | Implementation Effort |
|---|---|---|---|
| **Sequential Integer Shifting** | $O(N)$ (Massive DB lock) | $O(1)$ | Very Easy |
| **Fractional String (Lexorank)**| **$O(1)$ (1 row updated)** | $O(1)$ | Medium to High |
| **Linked List (`prev_id` / `next_id`)**| $O(1)$ (2 rows updated) | **$O(N)$ (Requires recursive CTE to sort)**| Medium |

---

## 13. Trade-offs

- **Fractional Indexing vs. Integer Simplicity**:
  Fractional indexing eliminates database locking and makes drag-and-drop sub-millisecond, but requires custom string midpoint algorithms and periodic rebalancing routines. For any production system with more than 100 cards per board, the $O(1)$ write performance of fractional indexing is non-negotiable.

---

## 14. Real-World Usage & Implementation Example: React Drag-and-Drop Handler with Optimistic UI

Here is a production-grade TypeScript implementation of an **Optimistic Kanban Store Handler** using Zustand:

```typescript
// useKanbanStore.ts
import { create } from 'zustand';
import { FractionalIndexer } from './lexorank';

interface Card {
  id: string;
  listId: string;
  title: string;
  position: string;
  version: number;
}

interface KanbanStore {
  cards: Record<string, Card>;
  listOrder: Record<string, string[]>; // listId -> cardId[]
  moveCard: (cardId: string, targetListId: string, targetIndex: number) => Promise<void>;
}

export const useKanbanStore = create<KanbanStore>((set, get) => ({
  cards: {},
  listOrder: {},

  moveCard: async (cardId, targetListId, targetIndex) => {
    const state = get();
    const originalCards = { ...state.cards };
    const originalListOrder = { ...state.listOrder };

    const movingCard = state.cards[cardId];
    if (!movingCard) return;

    // 1. Calculate new fractional position
    const currentListCardIds = [...(state.listOrder[targetListId] || [])].filter(id => id !== cardId);
    
    const prevCardId = currentListCardIds[targetIndex - 1];
    const nextCardId = currentListCardIds[targetIndex];

    const prevPos = prevCardId ? state.cards[prevCardId].position : '';
    const nextPos = nextCardId ? state.cards[nextCardId].position : '';
    const newPosition = FractionalIndexer.getMidpoint(prevPos, nextPos);

    // 2. OPTIMISTIC UPDATE: Update client store immediately (<1ms)
    currentListCardIds.splice(targetIndex, 0, cardId);

    const updatedSourceIds = (state.listOrder[movingCard.listId] || []).filter(id => id !== cardId);

    set({
      cards: {
        ...state.cards,
        [cardId]: { ...movingCard, listId: targetListId, position: newPosition },
      },
      listOrder: {
        ...state.listOrder,
        [movingCard.listId]: updatedSourceIds,
        [targetListId]: currentListCardIds,
      },
    });

    // 3. PERSIST TO SERVER ASYNCHRONOUSLY
    try {
      const response = await fetch(`/api/cards/${cardId}/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetListId,
          position: newPosition,
          version: movingCard.version,
        }),
      });

      if (!response.ok) {
        throw new Error('Server rejected reorder transaction');
      }

      const updated = await response.json();
      // Update with server version token
      set((s) => ({
        cards: { ...s.cards, [cardId]: { ...s.cards[cardId], version: updated.version } },
      }));
    } catch (err: any) {
      console.error('[OPTIMISTIC ROLLBACK]: Reorder failed:', err.message);
      // 4. ROLLBACK ON FAILURE: Restore snapshot
      set({ cards: originalCards, listOrder: originalListOrder });
      alert('Unable to move card. Position restored.');
    }
  },
}));
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: Why is storing card positions as sequential integers (1, 2, 3...) bad for a Kanban board?
**Answer**:
Storing positions as sequential integers forces an **$O(N)$ write cascade** on every reorder. If a user moves an item to the top of a column containing 1,000 cards, the database must execute:
`UPDATE cards SET position = position + 1 WHERE list_id = 42 AND position >= 1;`
This updates and locks 1,000 separate database rows, invalidates database query caches, generates massive WAL log traffic, and causes lock contention for other users. **Fractional Indexing (Lexorank)** calculates a midpoint coordinate between surrounding items, allowing the reorder to execute as a single **$O(1)$ update on exactly one row**.

### 2. Conceptual: How does Optimistic UI work, and how do you handle server errors?
**Answer**:
Optimistic UI assumes network operations will succeed:
1. When a user drags a card, the client UI updates local state (e.g., Zustand or TanStack Query cache) immediately ($< 1\text{ms}$).
2. The user sees the card settle into place without waiting for network latency.
3. Concurrently, the client fires an asynchronous HTTP `PATCH` request to the backend.
4. **Error Handling (Rollback)**: The client keeps an in-memory snapshot of the board state prior to the drag. If the server responds with a 4xx/5xx error or the connection times out, the client catches the error, restores the state snapshot, animates the card back to its original slot, and alerts the user.

### 3. Implementation: How would you synchronize board state in real time across multiple concurrent users?
**Answer**:
Using **WebSockets backed by Redis Pub/Sub**:
1. When a user opens Board #102, their browser opens a persistent WebSocket connection to the API gateway. The gateway subscribes the socket to Redis channel: `board:events:102`.
2. When User A moves a card, the backend commits the mutation to PostgreSQL and publishes an event to Redis:
   `PUBLISH board:events:102 '{"type":"CARD_MOVED","cardId":"...","position":"..."}'`.
3. All gateway instances holding active WebSockets for Board #102 receive the Redis event and push the payload down to connected browsers.
4. User B’s client receives the event and applies the delta to its local normalized store without reloading the board.

### 4. Debugging: Two users move the same card at the exact same second. How do you prevent a lost update?
**Answer**:
By utilizing **Optimistic Concurrency Control (Version Tokens)**:
1. The `cards` table includes an integer column: `version INT NOT NULL DEFAULT 1`.
2. When User A and User B fetch the board, both have `version = 5`.
3. User A moves the card; the server executes:
   `UPDATE cards SET list_id = $1, version = version + 1 WHERE id = $2 AND version = 5;`
   The update succeeds and increments `version` to 6.
4. User B's update arrives 200ms later with `WHERE version = 5`. The update affects **0 rows** because the version is now 6.
5. The API detects 0 rows affected, aborts the transaction, returns **HTTP 409 Conflict**, and sends the latest board state to User B.

### 5. Scenario: How do you prevent fractional indexing strings from growing infinitely long?
**Answer**:
Over repeated drag-and-drops into the exact same slot, string midpoints append characters (e.g., `"a"`, `"am"`, `"amm"`, `"ammm"`).
**Solution**:
1. **Precision Threshold Trigger**: If the position string exceeds a configured length (e.g., $> 32$ characters), trigger a rebalance.
2. **Background Lexorank Rebalancing**: Run an asynchronous background job for that specific list. Fetch all card IDs in order, and re-assign clean, equidistant positions:
   - Card 1: `"1000"`
   - Card 2: `"2000"`
   - Card 3: `"3000"`
   This resets string length back to 4 characters without interrupting board usage.

### 6. Advanced: What index structure would you create in PostgreSQL to optimize fetching all cards for a board in strict display order?
**Answer**:
Create a **Composite B-Tree Index**:
```sql
CREATE INDEX idx_cards_list_position ON cards (list_id, position ASC);
```
**Why this works**:
The composite index clusters the index pages first by `list_id` (equality match) and second by `position` in ascending order. When the query `SELECT * FROM cards WHERE list_id = $1 ORDER BY position ASC` executes, PostgreSQL performs an **Index Scan**: it locates the list in $O(\log N)$ time and reads the pre-sorted card rows directly from the index leaves, completely avoiding an expensive in-memory sort operation.

---

## 16. Coding Questions & Practical Challenges

1. **Midpoint String Generator**: Write a pure TypeScript function that accepts two arbitrary alphabetical strings (e.g., `"az"` and `"b"`) and returns the exact lexicographical midpoint.
2. **Optimistic Mutation Wrapper**: Implement a custom React hook using `@tanstack/react-query`'s `useMutation` that implements `onMutate` (optimistic cache update), `onError` (rollback using context), and `onSettled` (server invalidation).
3. **Compound Rebalance SQL Transaction**: Write a PostgreSQL stored procedure or script that re-indexes all cards in a list to clean intervals of 1,000 inside a single transaction.

---

## 17. Common Interview Traps

- **Trap 1: Fetching full card descriptions and attachments on board load**: Boards can have hundreds of cards. Loading markdown text, comments, and attachments on the board view inflates the JSON payload to megabytes. Only fetch minimal card summaries for the board; fetch details on card click.
- **Trap 2: Storing state denormalized in frontend stores**: Storing cards inside list objects (`lists: [{ id: 1, cards: [...] }]`) causes the entire list component and all its cards to re-render whenever a single card's title is edited. Always normalize state.
- **Trap 3: Using client timestamps for card activity logs**: Never rely on `new Date()` from the client browser for audit logs or card comments. Client clocks can be manipulated or out of sync; always generate timestamps using PostgreSQL `CURRENT_TIMESTAMP` or the backend server clock.

---

## 18. Revision Summary

- **Core Problem**: Reordering cards across lists without $O(N)$ database write cascades or UI latency.
- **Lexorank / Fractional Indexing**: Assigns string coordinates; inserting between two items updates only **1 database row** ($O(1)$ write).
- **Optimistic UI**: Mutate client Zustand state in $<1\text{ms}$; persist asynchronously; rollback on HTTP failure.
- **Concurrency & Real-Time**: Optimistic concurrency control via `version` columns; WebSocket broadcast via Redis Pub/Sub.
- **Database Optimization**: Composite index `(list_id, position ASC)` eliminates in-memory sorting.

---

## 19. Quick Reference Cheatsheet

```sql
-- Composite Index for Instant Sorted Retrieval
CREATE INDEX idx_cards_list_position ON cards (list_id, position ASC);

-- Optimistic Lock Update
UPDATE cards 
SET list_id = $1, position = $2, version = version + 1 
WHERE id = $3 AND version = $4;

-- Fractional Indexing Concept
Position A = "1000"
Position B = "2000"
Midpoint   = "1500" -- Inserted without modifying A or B!
```
