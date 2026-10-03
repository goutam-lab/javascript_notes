# Frontend Error Handling, Toast Architectures & Optimistic UI Patterns

## 1. What is it?
**Frontend Error Handling & UX Resilience** is the engineering discipline of gracefully communicating failures to users, preserving user input, and maintaining an interface that feels responsive and reliable even under unreliable network conditions.

Rather than dumping raw HTTP status codes or crashing with unhandled exceptions, a resilient frontend classifies errors into four distinct tiers and pairs them with appropriate UX mechanisms:
1. **Field-Level Validation**: Instant feedback right next to the affected form input.
2. **Toast Notifications**: Transient non-blocking notifications for background actions.
3. **Modals / Dialogs**: Blocking interactions for critical actions requiring immediate confirmation.
4. **Optimistic UI Updates**: Instantly rendering the predicted result of a user action (e.g. liking a post or sending a chat message) before the server confirms, paired with an automatic rollback on network failure.

---

## 2. Why does it exist?
In naive web applications:
- When a user submits a 20-field registration form and the backend rejects it with `400 Bad Request`, the page refreshes and wipes out all 20 fields, forcing the user to start over.
- Clicking a "Like" button spins an awkward loading spinner for 800ms before incrementing the counter from `42` to `43`.
- If the user's internet drops while using a web app, clicking buttons appears completely dead with zero visual feedback.
- **The Modern UX Solution**: Inline errors guide the user, optimistic updates make interactions feel instantaneous (0ms perceived latency), and network listeners alert users when they go offline.

---

## 3. Mental Model: The 4 Tiers of Frontend Error UX
💡 **Think of an Airport Terminal System:**

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. FIELD-LEVEL INLINE (e.g., Passport number missing a digit)               │
│    Location: Right under the input field.                                   │
│    Action: Highlight input in red; describe exact format requirement.       │
├─────────────────────────────────────────────────────────────────────────────┤
│ 2. TOAST NOTIFICATION (e.g., "Gate changed to B12")                         │
│    Location: Corner of screen. Non-blocking; auto-dismisses in 4 seconds.   │
│    Action: Informs user of background update without interrupting flow.     │
├─────────────────────────────────────────────────────────────────────────────┤
│ 3. MODAL DIALOG (e.g., "Flight canceled! Rebook now?")                      │
│    Location: Center screen; disables background.                            │
│    Action: Demands explicit user decision before application can continue.  │
├─────────────────────────────────────────────────────────────────────────────┤
│ 4. ERROR BOUNDARY / FALLBACK (e.g., "Airport power failure")                │
│    Location: Entire widget or page replaced with a friendly error screen.   │
│    Action: Prevents white screen crash; provides "Reload App" button.       │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. The Optimistic UI Pattern: Zero-Latency Updates

When a user clicks "Like" on a post, waiting for a 300ms server round-trip makes the app feel sluggish. With **Optimistic UI**:
1. Immediately update local state in RAM $\rightarrow$ UI updates in **0ms**!
2. Dispatch the network request in the background.
3. **If request succeeds**: Silently confirm the state.
4. **If request fails**: **Roll back** to the previous state and show an error toast!

```tsx
import { useState } from 'react';

interface Post {
  id: string;
  isLiked: boolean;
  likeCount: number;
}

export function LikeButton({ post, onLikeApi }: { post: Post; onLikeApi: (id: string) => Promise<void> }) {
  const [isLiked, setIsLiked] = useState(post.isLiked);
  const [likeCount, setLikeCount] = useState(post.likeCount);

  async function handleToggleLike() {
    // 1. Snapshot previous state for rollback
    const prevLiked = isLiked;
    const prevCount = likeCount;

    // 2. OPTIMISTIC UPDATE: Apply predicted state immediately!
    const nextLiked = !prevLiked;
    setIsLiked(nextLiked);
    setLikeCount(prevCount + (nextLiked ? 1 : -1));

    try {
      // 3. Fire network request in background
      await onLikeApi(post.id);
    } catch (error) {
      // 4. ROLLBACK: Revert to snapshot on network failure!
      setIsLiked(prevLiked);
      setLikeCount(prevCount);
      showToast('Failed to update like. Please check your network connection.', 'error');
    }
  }

  return (
    <button onClick={handleToggleLike} className={isLiked ? 'liked' : ''}>
      {isLiked ? '❤️' : '🤍'} {likeCount}
    </button>
  );
}
```

---

## 5. Toast Notification Architecture

A production toast system must:
- Support stacking multiple toasts without overlapping.
- Auto-dismiss after a configurable timeout (e.g. 4000ms).
- **Pause timer when user hovers mouse over the toast** (critical for accessibility so slow readers can finish reading).
- Announce via `aria-live="polite"`.

```tsx
import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'error';
}

interface ToastContextType {
  addToast: (message: string, type?: Toast['type']) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: Toast['type'] = 'info') => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <aside aria-live="polite" className="toast-viewport">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
        ))}
      </aside>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const startTimer = () => {
    timerRef.current = setTimeout(() => onDismiss(toast.id), 4000);
  };

  const pauseTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  React.useEffect(() => {
    startTimer();
    return () => pauseTimer();
  }, []);

  return (
    <div
      role="status"
      onMouseEnter={pauseTimer}
      onMouseLeave={startTimer}
      className={`toast-card toast-${toast.type}`}
    >
      <span>{toast.message}</span>
      <button onClick={() => onDismiss(toast.id)}>✕</button>
    </div>
  );
}

export const useToast = () => useContext(ToastContext)!;
```

---

## 6. Network Offline Detection & Reconnection

```tsx
import { useState, useEffect } from 'react';

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  });

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

// Banner Component:
export function OfflineBanner() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="offline-banner" role="alert">
      📡 You are currently offline. Changes will sync once connection is restored.
    </div>
  );
}
```

---

## 7. Important Rules

1. **Never Show Raw Backend Errors to Users**: Translating `{ code: "P2002", meta: { target: ["email"] } }` into a user-facing message like *"This email is already in use"* is a frontend responsibility.
2. **Preserve Form Inputs Across Errors**: When a form submission fails, never reset the form inputs.
3. **Optimistic Updates Must Always Have a Rollback Plan**: If an optimistic update cannot be easily reversed, do not make it optimistic; use an explicit loading spinner instead.

---

## 8. Common Mistakes

### Mistake 1: Validating on every single keystroke immediately
```tsx
// ❌ ANNOYING UX: Shows error before user has even finished typing!
<input onChange={(e) => {
  if (!isValidEmail(e.target.value)) setError("Invalid email address!");
}} />
```
**Why this infuriates users**: When typing `g`, the input immediately turns red with *"Invalid email"*. Users haven't even typed `@` yet!
**The Best Practice**: Validate on **Blur** (`onBlur`) for the first interaction, and only switch to on-change validation *after* the field has been touched and failed validation once.

---

## 9. Best Practices

1. **Toast Timer Pause on Hover**: Always allow the user to hover over a toast to keep it visible while reading long error messages.
2. **Combine Optimistic UI with TanStack Query**: Libraries like `@tanstack/react-query` have built-in `onMutate`, `onError`, and `onSettled` hooks specifically designed for optimistic rollbacks.
3. **Limit Active Toasts**: Cap visible toasts to a maximum of 3 or 4 to prevent flooding the viewport.

---

## 10. Performance Considerations

- **Toast Portals**: Render toast viewports using `createPortal` directly into `document.body` to avoid layout thrashing and stacking context (`z-index`) issues inside nested overflow containers.

---

## 11. Security Considerations

- Never display sensitive authentication headers or internal database error strings in toasts, as screenshots taken by users can leak backend infrastructure details.

---

## 12. Alternatives

| Pattern | Interruption Level | Best Use Case |
| :--- | :--- | :--- |
| **Inline Form Error** | Low (Contextual) | Invalid input, missing required fields |
| **Toast** | Low (Ambient) | Success feedback, non-fatal background warnings |
| **Modal Dialog** | High (Blocking) | Destructive confirmations ("Delete Project?"), session expiry |
| **Error Boundary** | Severe (Subtree) | Uncaught render crashes |

---

## 13. Trade-offs

- **Optimistic UI Benefit**: App feels 10x faster; native-like responsiveness.
- **Optimistic UI Cost**: Complex error recovery; requires holding previous snapshots in memory.

---

## 14. Real-World Usage

- **Twitter / X & Instagram**: Likes, retweets, and bookmarks update optimistically in 0ms.
- **Slack & WhatsApp**: Messages appear immediately in the chat thread with a small pending clock icon, rolling back if the socket fails.

---

## 15. Placement Interview Questions

### Basic
**Q: What is Optimistic UI in modern frontend engineering?**  
*Answer*: Optimistic UI is an interaction design pattern where the user interface updates immediately upon user action under the assumption that the backend network request will succeed, without waiting for the server response. If the server request fails, the application rolls back the optimistic changes to the previous snapshot state and informs the user via an error message.

### Conceptual
**Q: What are the three phases of a TanStack Query optimistic mutation?**  
*Answer*:
1. `onMutate`: Fires before the network request is made. Cancels outgoing refetches, takes a snapshot of current cache data, and optimistically updates the cache with the new value.
2. `onError`: Fires if the mutation fails. Uses the snapshot taken in `onMutate` to roll back the cache to its previous state.
3. `onSettled`: Fires whether the mutation succeeded or failed. Invalidates the query cache to refetch the true server state from the database.

### Implementation
**Q: Write an `onBlur` form validation hook pattern in React.**  
*Answer*:
```tsx
function useFormField(validator: (val: string) => string | null) {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBlur = () => {
    setTouched(true);
    setError(validator(value));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(e.target.value);
    if (touched) setError(validator(e.target.value));
  };

  return { value, error: touched ? error : null, handleBlur, handleChange };
}
```

### Debugging
**Q: A user clicks "Delete Task", the task disappears optimistically, the server returns 500 Internal Error, but the task never reappears on the screen. What bug was introduced?**  
*Answer*: The developer performed an optimistic state update without saving a **rollback snapshot** of the previous state list prior to mutating state, or forgot to call the rollback setter inside the `catch` block of the asynchronous operation.

### Scenario
**Q: A user is filling out a complex form while on a train with intermittent cellular signal. How do you design the application so they do not lose their work if they lose connection?**  
*Answer*:
1. Listen to `window.addEventListener('offline')` and display an ambient non-blocking warning banner: *"Offline mode - changes saved locally"*.
2. Persist form drafts to `localStorage` or `IndexedDB` on every input change with debouncing.
3. Queue outgoing mutations into a local offline queue (e.g. using TanStack Query's `persistClient` or Redux-Persist).
4. When `window.addEventListener('online')` fires, automatically drain the queue and sync draft data to the server.

### Advanced
**Q: How do Toast notification systems avoid breaking keyboard accessibility when auto-dismissing?**  
*Answer*:
1. Use an ARIA Live Region (`role="status"`, `aria-live="polite"`), which allows assistive screen readers to announce notifications without stealing keyboard focus from the active form input.
2. Provide a pause-on-focus and pause-on-hover mechanism so keyboard-only users who navigate to the toast dismiss button have sufficient time to read and interact with the notification before it disappears.

---

## 16. Coding Challenge: Generic Optimistic State Hook

**Task**: Implement a reusable `useOptimisticAction` hook that manages optimistic values, async actions, and automatic rollback on error.

```tsx
import { useState, useCallback } from 'react';

export function useOptimisticAction<T>(
  initialState: T,
  asyncAction: (optimisticState: T) => Promise<void>
) {
  const [state, setState] = useState<T>(initialState);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const execute = useCallback(
    async (nextState: T) => {
      const rollbackState = state;
      setState(nextState); // Apply immediately!
      setIsPending(true);
      setError(null);

      try {
        await asyncAction(nextState);
      } catch (err) {
        // Rollback on failure!
        setState(rollbackState);
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setIsPending(false);
      }
    },
    [state, asyncAction]
  );

  return { state, execute, isPending, error };
}
```

---

## 17. Common Interview Traps

1. **"Optimistic UI is suitable for financial transfers and payments."**  
   *Trap*: Suggesting optimistic updates for banking transactions.  
   *Reality*: Never use optimistic UI for high-consequence actions (e.g. wire transfers, stock trades, deleting accounts). These require explicit confirmation and server validation before updating the UI.
2. **"Toasts should steal focus so the user reads them."**  
   *Trap*: Forcing `.focus()` on every new toast.  
   *Reality*: Stealing focus disorients keyboard users and interrupts active typing. Use `aria-live` for ambient awareness instead.

---

## 18. Revision Summary

- **4 Error Tiers**: Inline $\rightarrow$ Toast $\rightarrow$ Modal $\rightarrow$ Error Boundary.
- **Optimistic UI**: Update RAM $\rightarrow$ Send network request $\rightarrow$ Rollback on error.
- **Form Validation**: Validate on Blur first, then on Change once touched.
- **Toasts**: Auto-dismiss with pause on hover; announce via `aria-live="polite"`.
- Use `navigator.onLine` and `offline` events to alert users of connection loss.

---

## 19. Quick Reference

```tsx
// Optimistic Template
const previous = state;
setState(optimistic);
try {
  await apiCall();
} catch (err) {
  setState(previous); // Rollback
  showToast(err.message, 'error');
}
```
