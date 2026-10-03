# Debounce and Throttle: Vanilla JS and React Implementations

## 1. What is it?
**Debounce** and **Throttle** are rate-limiting design patterns used to regulate the frequency with which a computationally expensive or network-heavy function executes in response to high-frequency events (such as `window.scroll`, `resize`, `mousemove`, `keypress`, and button clicks).

- **Debounce:** Delays function execution until a specified quiet period ($\Delta t$) has elapsed without any new event triggers. If a new trigger occurs before $\Delta t$ expires, the previous timer is cancelled and restarted.
- **Throttle:** Guarantees that the function executes at most **once every $\Delta t$ milliseconds**, regardless of how many times the event is triggered.

```
       DEBOUNCE VS. THROTTLE TIMELINE COMPARISON
       
  Events:    |||||||||||||||||||||||||                    |  |
             ─────────────────────────                    ────
             (User typing continuously)                   (Pause)
             
  Debounce:  ─────────────────────────[ EXECUTE ]─────────[ EXECUTE ]
             (Executes ONLY after user stops typing for 300ms)
             
  Throttle:  [ EXEC ]───[ EXEC ]───[ EXEC ]───[ EXEC ]────[ EXEC ]
             (Executes periodically every 300ms throughout the stream)
```

---

## 2. Why does it exist?
Modern web applications interact with events that can fire 60 to 120 times per second:
1. **API Overload:** Typing in a search bar without debounce issues an HTTP request per keystroke. 10 rapid keystrokes trigger 10 simultaneous backend calls, leading to race conditions and API rate-limit penalties.
2. **Main-Thread Jank:** Calculating layout measurements inside a raw `window.addEventListener('resize')` triggers continuous DOM reflows and layout recalculations, dropping UI framerates below 30 FPS.
3. **Double-Click Disasters:** Rapid clicking on "Pay Now" can charge a credit card multiple times unless protected by leading-edge debounce.

---

## 3. Mental Model
Think of Debounce and Throttle as **Elevator and Traffic Light Control Systems**:

```
                       REAL-WORLD ANALOGY
                       
  🚪 Debounce (The Smart Elevator Door):
     - The elevator door waits 10 seconds before closing and moving.
     - If someone walks in at second 9, the timer resets to 10 seconds.
     - The elevator only moves when everyone has stopped boarding.

  🚦 Throttle (The Regulated Traffic Metering Light):
     - The highway on-ramp traffic light turns green once every 10 seconds.
     - It doesn't matter if 50 cars or 5 cars are waiting in line;
       exactly one car is allowed through every 10 seconds.
```

---

## 4. Basic Example: Pure JavaScript Debounce and Throttle

### Basic Debounce
```javascript
function debounce(fn, delay) {
  let timerId = null;

  return function (...args) {
    const context = this;
    if (timerId) clearTimeout(timerId);

    timerId = setTimeout(() => {
      fn.apply(context, args);
    }, delay);
  };
}
```

### Basic Throttle (Timestamp Approach)
```javascript
function throttle(fn, limit) {
  let lastRan = 0;

  return function (...args) {
    const context = this;
    const now = Date.now();

    if (now - lastRan >= limit) {
      fn.apply(context, args);
      lastRan = now;
    }
  };
}
```

---

## 5. Real Example: Production-Grade Debounce & Throttle with Leading/Trailing & Cancel

### Full Vanilla JavaScript Debounce with Options
```typescript
interface DebounceOptions {
  leading?: boolean;
  trailing?: boolean;
}

export interface DebouncedFunction<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void;
  cancel: () => void;
  flush: () => void;
}

export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  wait: number,
  options: DebounceOptions = { leading: false, trailing: true }
): DebouncedFunction<T> {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: Parameters<T> | null = null;
  let lastThis: any = null;

  const invokeFn = () => {
    if (lastArgs) {
      fn.apply(lastThis, lastArgs);
      lastArgs = null;
      lastThis = null;
    }
  };

  const debounced = function (this: any, ...args: Parameters<T>) {
    lastArgs = args;
    lastThis = this;

    const isInvoking = !timerId && options.leading;

    if (timerId) {
      clearTimeout(timerId);
    }

    timerId = setTimeout(() => {
      timerId = null;
      if (options.trailing && !isInvoking) {
        invokeFn();
      }
    }, wait);

    if (isInvoking) {
      invokeFn();
    }
  };

  debounced.cancel = () => {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
    lastArgs = null;
    lastThis = null;
  };

  debounced.flush = () => {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
      invokeFn();
    }
  };

  return debounced;
}
```

### Production React Hook: `useDebouncedCallback` (Stale Closure-Proof)
In React, wrapping a raw `debounce()` inside a component causes bugs: either the debounced function is recreated on every render (resetting timers), or it captures stale props in its closure.

```typescript
import { useRef, useEffect, useCallback } from 'react';

export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): [(...args: Parameters<T>) => void, () => void] {
  const callbackRef = useRef<T>(callback);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Always keep ref up-to-date with the latest callback instance
  // Eliminates stale closure traps without resetting the debounce timer!
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Cancel function
  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const debouncedFn = useCallback(
    (...args: Parameters<T>) => {
      cancel();

      timerRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    },
    [delay, cancel]
  );

  // Auto-cleanup on component unmount
  useEffect(() => {
    return () => cancel();
  }, [cancel]);

  return [debouncedFn, cancel];
}
```

### Production React Hook: `useThrottledCallback`
```typescript
import { useRef, useEffect, useCallback } from 'react';

export function useThrottledCallback<T extends (...args: any[]) => any>(
  callback: T,
  limit: number
): (...args: Parameters<T>) => void {
  const callbackRef = useRef<T>(callback);
  const lastRan = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  const throttledFn = useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      const remainingTime = limit - (now - lastRan.current);

      if (remainingTime <= 0) {
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
        lastRan.current = now;
        callbackRef.current(...args);
      } else if (!timerRef.current) {
        // Trailing execution: captures the last event within the throttle window
        timerRef.current = setTimeout(() => {
          lastRan.current = Date.now();
          timerRef.current = null;
          callbackRef.current(...args);
        }, remainingTime);
      }
    },
    [limit]
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return throttledFn;
}
```

---

## 6. Under the Hood: The Macrotask Timer and Clock Skew

```
              EVENT LOOP INTERACTION FOR DEBOUNCE
              
  [ CALL STACK ]
  Keypress Event ──► debouncedInput()
                     ├── clearTimeout(timerRef)
                     └── setTimeout(callback, 300) ──► Registered with Browser Timer API
  Stack Empty
         │
         ▼ (User pauses typing for > 300ms)
  [ MACROTASK QUEUE ]
  [ Timer Callback (callbackRef.current) ] ──► Pushed to Call Stack ──► Executes API call!
```

1. **Macrotask Execution:** `setTimeout` delegates timing to the operating system/host environment. When the timer fires, the callback is enqueued into the **Macrotask (Task) Queue**.
2. **Clock Skew and CPU Throttling:** In background browser tabs, timers are throttled to a minimum of 1,000ms by modern browsers to preserve battery life.

---

## 7. Important Rules

1. **Clean Up Timers on Unmount:** If a debounced timer fires after a React component unmounts, it can trigger memory leaks or state update warnings. Always invoke `cancel()` in `useEffect` cleanup.
2. **Maintain Reference Stability:** In React, wrap the returned debounced function in `useCallback` or store it in `useRef` so child components don't re-render needlessly.
3. **Preserve `this` and Arguments:** In vanilla JS, always preserve `this` via `fn.apply(this, args)` so the debounced function works when attached as an object method or DOM handler.

---

## 8. Common Mistakes

```tsx
// ❌ MISTAKE 1: Calling debounce() directly inside a React component render
function SearchComponent() {
  const [query, setQuery] = useState('');

  // BUG: Creates a brand new debounced function on EVERY render!
  // The internal timerId is wiped out every keystroke, breaking debounce completely!
  const handleSearch = debounce((q) => fetchResults(q), 300);

  return <input onChange={(e) => handleSearch(e.target.value)} />;
}

// ❌ MISTAKE 2: Stale closures when memoizing with useMemo
// If useMemo(() => debounce((q) => doSomething(state), 300), []) has empty deps,
// doSomething will permanently read initial state!
```

---

## 9. Best Practices
1. **Use `useRef` for Storing the Latest Callback:** Decouple the timer mechanism from component state so changing state doesn't reset the timer.
2. **Provide `.cancel()` and `.flush()`:** Allow forms to flush pending auto-save operations immediately when the user clicks "Submit" or navigates away.
3. **Choose the Right Tool for the Job:**
   - **Debounce:** Search auto-complete, window resize layout adjustments, form autosave.
   - **Throttle:** Infinite scroll (`onScroll`), drag-and-drop mouse movements, gaming render loops.

---

## 10. Performance Considerations

| Feature | Debounce | Throttle | `requestAnimationFrame` |
|---|---|---|---|
| **Execution Frequency** | 1 burst after inactivity | Steady periodic intervals | Locked to 60/120 Hz display refresh |
| **Best For** | Typing, Form submission | Scroll tracking, window resizing | DOM animations, canvas rendering |
| **Timer Overhead** | Clears & starts `setTimeout` | Arithmetic timestamp comparison | Browser V-Sync aligned (Zero drift) |

---

## 11. Security Considerations
- **API DDoS Mitigation:** Client-side debouncing prevents accidental self-DDoS, but **servers must never rely on client debouncing**. Always enforce token bucket or sliding window rate limiting on backend APIs.

---

## 12. Alternatives
1. **`requestAnimationFrame` (rAF):** For UI animations or visual scroll effects, throttling with `rAF` is smoother and more battery-efficient than `setTimeout`.
2. **RxJS Operators:** `debounceTime(300)` and `throttleTime(300)` for reactive streaming architectures.

---

## 13. Trade-offs

| Implementation | Advantages | Trade-offs |
|---|---|---|
| **Leading Edge Debounce** | Immediate UI response on first click | Must wait for full timeout before next allowed trigger |
| **Trailing Edge Debounce** | Guarantees final user input is processed | Introduces visual latency equal to `wait` ms |
| **Throttle with Trailing** | Guarantees regular updates AND final state capture | Complex logic coordinating both timers and timestamps |

---

## 14. Real-World Usage
- **Google Docs / Notion:** Debounces autosave API requests until 1,500ms after the user pauses typing.
- **Twitter / Instagram Feed:** Throttles infinite scroll event listeners to 200ms to calculate scroll position and trigger next page fetches without dropping frames.

---

## 15. Placement Interview Questions

### Basic
1. *What is the difference between debounce and throttle?*
   - **Answer:** Debounce groups multiple sequential events into a single execution that runs only after a designated quiet period. Throttle guarantees execution at regulated periodic intervals (at most once every $T$ ms) regardless of event volume.

### Conceptual
2. *Why does creating a debounced function directly inside a React component body fail?*
   - **Answer:** On every component re-render (e.g. triggered by typing into a controlled input), the component function re-executes, instantiating a brand-new debounced wrapper with a brand-new timer variable. The previous timer is abandoned, meaning every keystroke fires independently without debouncing.

### Implementation
3. *How do you solve the Stale Closure problem in a custom `useDebounce` hook?*
   - **Answer:** Use a `useRef` to hold the latest callback function (`callbackRef.current = callback;` inside `useEffect`). The debounced timer then calls `callbackRef.current(...args)`, ensuring it always accesses current state and props without resetting the active timer.

### Debugging
4. *A developer uses throttle on a scroll listener, but when the user scrolls to the absolute bottom and stops, the final fetch never fires. Why?*
   - **Answer:** The throttle implementation lacked **trailing edge execution**. If the final scroll event arrived within the throttle window and no trailing timer was scheduled, the final event was discarded.

### Scenario
5. *Design a button to prevent multiple form submissions from rapid double-clicks.*
   - **Answer:** Use **Leading-Edge Debounce** (or disable the button immediately on first click). The first click executes immediately (`leading: true`), while subsequent clicks within 1,000ms are ignored.

### Advanced
6. *When would you choose `requestAnimationFrame` over throttle for scroll listeners?*
   - **Answer:** When the scroll callback performs direct DOM manipulations, styling updates (e.g., sticky headers or parallax transforms), or canvas rendering. `requestAnimationFrame` aligns execution with the browser's hardware display refresh rate (16.6ms for 60Hz), eliminating visual tearing and dropped frames.

---

## 16. Coding Questions

### Problem: Implement `throttle` with Both Leading and Trailing Support in TypeScript
Write a pure TypeScript `throttle` function supporting `{ leading: boolean, trailing: boolean }`.

```typescript
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  wait: number,
  options: { leading?: boolean; trailing?: boolean } = { leading: true, trailing: true }
): { (...args: Parameters<T>): void; cancel: () => void } {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let lastRan = 0;
  let lastArgs: Parameters<T> | null = null;
  let lastThis: any = null;

  const invokeTrailing = () => {
    lastRan = options.leading === false ? 0 : Date.now();
    timerId = null;
    if (lastArgs) {
      fn.apply(lastThis, lastArgs);
      lastArgs = null;
      lastThis = null;
    }
  };

  const throttled = function (this: any, ...args: Parameters<T>) {
    const now = Date.now();
    lastArgs = args;
    lastThis = this;

    // First call without previous run
    if (!lastRan && options.leading === false) {
      lastRan = now;
    }

    const remaining = wait - (now - lastRan);

    if (remaining <= 0 || remaining > wait) {
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      lastRan = now;
      fn.apply(lastThis, lastArgs);
      lastArgs = null;
      lastThis = null;
    } else if (!timerId && options.trailing !== false) {
      timerId = setTimeout(invokeTrailing, remaining);
    }
  };

  throttled.cancel = () => {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
    lastRan = 0;
    lastArgs = null;
    lastThis = null;
  };

  return throttled;
}
```

---

## 17. Common Interview Traps
- **Trap 1:** Forgetting to clear `timerId = null` after execution.
  *Reality:* If `timerId` isn't reset, future leading-edge calls think a timer is already running and fail to execute immediately.
- **Trap 2:** Losing `this` context when debouncing class methods or DOM handlers.
  *Reality:* Using a standard function without capturing `this` or using arrow functions incorrectly can break callbacks that rely on `event.currentTarget`.
- **Trap 3:** Not handling component unmount in React.
  *Reality:* Firing a debounced state update after unmount triggers memory leak warnings.

---

## 18. Revision Summary
- **Debounce:** Waits for quiet period; restarts timer on every trigger.
- **Throttle:** Limits execution rate to once every $T$ ms.
- **React Stale Closures:** Solved by keeping the latest callback in `useRef`.
- **Leading vs Trailing:** Leading fires immediately on first trigger; Trailing fires at the end of the delay window.
- **Always Clean Up:** Return a cleanup function in `useEffect` that invokes `.cancel()`.

---

## 19. Quick Reference

```
┌─────────────────────────┬───────────────────────────────┬─────────────────────────┐
│ USE CASE                │ CHOSEN PATTERN                │ CONFIGURATION           │
├─────────────────────────┼───────────────────────────────┼─────────────────────────┤
│ Search Auto-complete    │ Debounce                      │ wait: 300ms, trailing   │
│ Form Autosave           │ Debounce                      │ wait: 1000ms, flushable │
│ Infinite Scroll Check   │ Throttle                      │ wait: 200ms, trailing   │
│ Double-Click Prevent    │ Debounce                      │ wait: 500ms, leading    │
│ Window Resize Layout    │ Debounce or rAF               │ wait: 150ms             │
└─────────────────────────┴───────────────────────────────┴─────────────────────────┘
```
