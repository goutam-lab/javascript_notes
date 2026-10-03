# `async` and `await`

Introduced in ES2017, `async` and `await` allow us to write asynchronous code that **looks and reads like synchronous code**.

Under the hood, `async/await` is powered completely by **Promises**.

---

## 1. The `async` Keyword

Placing `async` in front of a function does two things:
1. It allows you to use the `await` keyword inside that function.
2. It guarantees that the function **always returns a Promise**.

```javascript
async function getData() {
    return "Hello Placement!";
}

// Even though we returned a simple string, it is wrapped in a Promise:
getData().then((msg) => console.log(msg));
```

**Output:**
```
Hello Placement!
```

---

## 2. The `await` Keyword

`await` does something magical:

> It **pauses execution** of the `async` function at that line until the Promise resolves or rejects, and unpacks the resolved value directly.

Crucially: It pauses **only this async function**—it does **NOT** block the main browser thread or the Call Stack!

### Before (`.then()` chaining):
```javascript
function fetchProfile() {
    getUser()
        .then((user) => getSettings(user.id))
        .then((settings) => console.log(settings));
}
```

### After (`async / await`):
```javascript
async function fetchProfile() {
    const user = await getUser();
    const settings = await getSettings(user.id);
    console.log(settings);
}
```

Notice how clean, linear, and readable that is!

---

## 3. Error Handling with `try ... catch`

With `async/await`, we handle errors using standard JavaScript `try/catch` blocks:

```javascript
async function loadUserData(userId) {
    try {
        const response = await fetch(`https://api.example.com/users/${userId}`);
        const data = await response.json();
        console.log("User Loaded:", data.name);
    } catch (error) {
        console.error("Failed to load user:", error.message);
    } finally {
        console.log("Hide loading spinner.");
    }
}
```

---

## 4. The Massive Performance Trap: Sequential vs Parallel

This is one of the most common mistakes candidates make in technical interviews.

Look at this code:

```javascript
// ❌ SLOW: Sequential Execution (Takes 4 seconds total!)
async function loadDashboardSlow() {
    const user = await fetchUser();     // Takes 2 seconds
    const stats = await fetchStats();   // Takes 2 seconds (waits for user to finish first!)
    return { user, stats };
}
```

If `fetchStats()` does not depend on `fetchUser()`, waiting for the first one to finish before starting the second is a huge waste of time!

### The Fix: Run them in Parallel with `Promise.all`

```javascript
// ✅ FAST: Parallel Execution (Takes only 2 seconds total!)
async function loadDashboardFast() {
    // Both API requests fire off at the exact same moment!
    const [user, stats] = await Promise.all([
        fetchUser(),
        fetchStats()
    ]);

    return { user, stats };
}
```

---

## 💡 Think of it like this

- **Sequential `await`**: Boiling pasta, waiting until it is completely cooked and drained, and only *then* starting to chop onions and garlic for the sauce. You finish cooking in 40 minutes.
- **Parallel `Promise.all`**: Putting pasta on the boil and chopping onions while the water is heating up simultaneously. You finish dinner in 20 minutes!

---

## ⚠️ Common Mistakes

### Using `await` inside a `forEach` loop

```javascript
// ❌ WRONG: forEach does NOT wait for await!
async function processItems(items) {
    items.forEach(async (item) => {
        await saveToDatabase(item);
    });
    console.log("All items saved!"); // ⚠️ Prints BEFORE items are actually saved!
}

// ✅ CORRECT: Use for...of loop with await:
async function processItemsCorrect(items) {
    for (const item of items) {
        await saveToDatabase(item);
    }
    console.log("All items truly saved!");
}
```

---

## 🎯 Interview Points

1. **What happens under the hood when JavaScript hits an `await` statement?**
   - The engine pauses the async function, pops it off the Call Stack, and registers the remaining part of the function as a **Microtask**. The main Call Stack immediately continues running other synchronous tasks. When the awaited promise resolves, the Event Loop pushes the remainder of the async function back onto the Call Stack.

2. **Can you use `await` outside an `async` function?**
   - In standard scripts, no (it throws a `SyntaxError`).
   - However, modern JavaScript allows **Top-Level Await** inside ES Modules (`type="module"` in HTML or `.mjs` files).
