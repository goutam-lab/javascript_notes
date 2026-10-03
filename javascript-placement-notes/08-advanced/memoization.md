# Memoization in JavaScript

**Memoization** is an optimization technique used primarily to speed up computer programs by storing the results of expensive function calls and returning the cached result when the same inputs occur again.

It is heavily used in **Dynamic Programming (DSA)** and in **React (`useMemo`, `React.memo`)**.

---

## 1. What is Memoization?

In simple English:

> **Memoization** is remembering the answer to a question so you never have to recalculate it if someone asks the exact same question again.

---

## 2. Why do we need it?

Look at this expensive calculation:

```javascript
function heavySquare(n) {
    // Simulating heavy mathematical CPU work
    for (let i = 0; i < 100000000; i++) {}
    return n * n;
}

heavySquare(5); // Takes 200 milliseconds
heavySquare(5); // Takes another 200 milliseconds!
```

Since `5` will **always** result in `25`, recalculating it from scratch every time is a waste of CPU power!

---

## 3. The Interview Implementation (Custom `memoize` HOF)

Here is how you build a generic memoization utility using **closures**:

```javascript
function memoize(fn) {
    // Private cache object held in closure
    const cache = {};

    return function(...args) {
        // Create a unique key from arguments:
        const key = JSON.stringify(args);

        // Check if answer already exists in cache:
        if (key in cache) {
            console.log("(Fetching from cache for key:", key, ")");
            return cache[key];
        }

        // Otherwise, calculate, save to cache, and return:
        console.log("(Calculating fresh result for key:", key, ")");
        const result = fn.apply(this, args);
        cache[key] = result;
        return result;
    };
}
```

---

## 4. Testing Memoization with Factorial

```javascript
const factorial = (n) => {
    if (n <= 1) return 1;
    return n * factorial(n - 1);
};

const memoizedFactorial = memoize(factorial);

console.log(memoizedFactorial(5)); // Fresh calculation
console.log(memoizedFactorial(5)); // Instant cache hit!
console.log(memoizedFactorial(6)); // Fresh calculation
```

**Output:**
```
(Calculating fresh result for key: [5] )
120
(Fetching from cache for key: [5] )
120
(Calculating fresh result for key: [6] )
720
```

---

## 💡 Think of it like this

Imagine a student sitting in a math exam:
- Teacher asks: *"What is $37 \times 49$?"*
- Student does scratch calculations on paper for 3 minutes and answers: *"1,813"*.
- But instead of throwing the scratch paper away, the student writes *"37 x 49 = 1,813"* on a cheat sheet on their desk.
- 5 minutes later, the teacher asks: *"What is $37 \times 49$?"*
- The student glances down at the cheat sheet and answers: *"1,813"* in **0.1 seconds**!

---

## ⚠️ Common Mistakes

### Trying to Memoize Impure Functions
Never memoize a function that:
- Relies on current time (`Date.now()`)
- Uses random numbers (`Math.random()`)
- Fetches dynamic live data that updates every second (like stock market tickers)

Memoization **requires** functions to be **Pure** (same input must always equal the same output).

---

## 🎯 Interview Points

1. **How does React use Memoization?**
   - **`useMemo()`**: Caches the result of an expensive calculation across component re-renders.
   - **`useCallback()`**: Caches the function definition itself to prevent unnecessary child re-renders.
   - **`React.memo()`**: Prevents a child component from re-rendering if its props have not changed.

2. **What is the trade-off of Memoization?**
   - Memoization trades **Memory for Speed**.
   - Your function runs much faster ($O(1)$ lookups), but your application uses more RAM to store the cache in heap memory.
