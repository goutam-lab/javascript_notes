# Throttling in JavaScript

Like debouncing, **Throttling** is a rate-limiting technique.

However, while debouncing waits for silence, throttling guarantees regular, paced execution during continuous activity.

---

## 1. What is Throttling?

In simple English:

> **Throttling** limits the execution of a function so that it runs at most **once every $X$ milliseconds**, no matter how many hundreds of times the event is triggered.

---

## 2. Debouncing vs Throttling (The Classic Comparison)

- **Debounce**: "Wait until the user **stops** doing this for 500ms, then run." (Search bar typing, window resize finished).
- **Throttle**: "Run right now, and then **ignore all further triggers for the next 500ms**." (Window scrolling, mouse move tracking, game attack buttons).

---

## 3. Real-World Use Case: Window Scroll Tracker

When a user scrolls down a webpage, the browser can fire 60 to 100 `scroll` events per second!

If your scroll listener performs heavy DOM calculations (like computing positions for an infinite scroll or animation), the page will lag and drop frames.

By throttling the scroll handler to run **once every 200ms**, you reduce 100 calls down to 5 smooth, perfectly-spaced calls.

---

## 4. The Interview Implementation (Polyfill)

Here is the clean, timestamp-based throttling implementation:

```javascript
function throttle(fn, limit) {
    let lastRunTime = 0;

    return function(...args) {
        const now = Date.now();

        // Check if enough time has passed since the last execution:
        if (now - lastRunTime >= limit) {
            fn.apply(this, args);
            lastRunTime = now; // Update timestamp
        }
    };
}
```

---

## 5. Alternative Flag-Based Implementation

Another popular implementation uses a `boolean` flag with `setTimeout`:

```javascript
function throttleWithTimer(fn, limit) {
    let isWaiting = false;

    return function(...args) {
        if (!isWaiting) {
            fn.apply(this, args);
            isWaiting = true;

            setTimeout(() => {
                isWaiting = false; // Re-open the gate after limit expires!
            }, limit);
        }
    };
}
```

---

## 💡 Think of it like this

Imagine an amusement park roller coaster:
- A crowd of 200 people is pushing against the gate continuously (rapid scroll events).
- The roller coaster operator doesn't launch 200 individual coasters.
- Instead, the coaster departs on a strict, steady schedule: **one train every 3 minutes**, regardless of how many people are knocking on the gate!

---

## 🎯 Interview Points

1. **When should you choose Throttle over Debounce?**
   - Use **Throttle** when you need continuous visual updates during an ongoing action (e.g., updating a scroll progress bar, resizing a canvas chart, dragging an element across the screen).
   - Use **Debounce** when you only care about the final state after the user has completely finished (e.g., form input validation, search autocomplete).
