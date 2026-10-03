# Fetch API & Promise Combinators

Whether building React frontend applications or Node.js backends, fetching data across networks and handling multiple asynchronous tasks together is everyday work.

Let's look at the modern **Fetch API** and the **4 Promise Combinators**.

---

## 1. The Fetch API

`fetch()` is the modern browser and Node.js (v18+) standard for making HTTP requests.

It returns a Promise that resolves with a `Response` object.

```javascript
async function getGithubUser(username) {
    try {
        const response = await fetch(`https://api.github.com/users/${username}`);

        // ⚠️ CRITICAL CHECK: Fetch does NOT reject on 404 or 500 errors!
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const data = await response.json(); // Parses JSON body stream
        console.log("User:", data.name, "| Repos:", data.public_repos);
    } catch (error) {
        console.error("Fetch failed:", error.message);
    }
}
```

---

## 2. The #1 Fetch Trap: Why `fetch()` Doesn't Reject on 404

Interviewers will test you on this!

> **Rule:** `fetch()` only rejects if there is a **real network failure** (e.g. user is completely offline, DNS lookup failed, or CORS blocked).

If the server responds with a **404 Not Found** or **500 Internal Server Error**, `fetch()` considers the HTTP communication a success!
It resolves the promise normally with `response.ok = false`.

**You must always manually check `if (!response.ok)`!**

---

## 3. The 4 Promise Combinators

When you have multiple promises running concurrently, JavaScript provides 4 helper methods:

---

### 1. `Promise.all([p1, p2, p3])`
- **Goal:** Waits for **ALL** promises to succeed.
- **Behavior:** Returns an array of all results.
- **Failure:** **Fail-Fast!** If even ONE promise rejects, `Promise.all` immediately rejects with that error and ignores the rest.

```javascript
const p1 = Promise.resolve("User Data");
const p2 = Promise.resolve("Order History");

Promise.all([p1, p2])
    .then(([user, orders]) => console.log(user, orders));
```

---

### 2. `Promise.allSettled([p1, p2, p3])` (ES2020)
- **Goal:** Wait for **EVERY** promise to finish, regardless of whether they succeeded or failed.
- **Behavior:** **Never rejects!** Returns an array of objects showing the outcome of each:
  - `{ status: "fulfilled", value: ... }`
  - `{ status: "rejected", reason: ... }`

```javascript
const p1 = Promise.resolve("Emails loaded");
const p2 = Promise.reject("Notifications failed");

Promise.allSettled([p1, p2]).then((results) => {
    results.forEach((res) => {
        if (res.status === "fulfilled") {
            console.log("Success:", res.value);
        } else {
            console.log("Handled Error:", res.reason);
        }
    });
});
```

---

### 3. `Promise.race([p1, p2, p3])`
- **Goal:** The first promise to settle (either **fulfilled OR rejected**) wins the race.
- **Great Use Case:** Implementing a network timeout!

```javascript
const fetchAPI = fetch("/heavy-data");
const timeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error("Request timed out!")), 3000)
);

// If API takes longer than 3 seconds, timeout wins and rejects:
Promise.race([fetchAPI, timeout])
    .then((res) => console.log("Received data"))
    .catch((err) => console.error(err.message));
```

---

### 4. `Promise.any([p1, p2, p3])` (ES2021)
- **Goal:** The first promise to **fulfill (succeed)** wins.
- **Behavior:** Ignores rejections until it finds the first winner.
- **Failure:** Rejects only if **EVERY SINGLE** promise rejects (throws an `AggregateError`).

```javascript
// Fetch from 3 backup mirror servers:
Promise.any([
    fetch("https://mirror-us.com/data"),
    fetch("https://mirror-eu.com/data"),
    fetch("https://mirror-asia.com/data")
]).then((fastestResponse) => {
    console.log("Got data from fastest healthy mirror!");
});
```

---

## 💡 Think of it like this

- `Promise.all`: Like a group project in college. Every member must submit their part. If one person fails, the entire group gets an F!
- `Promise.allSettled`: Like a medical checkup. The doctor checks your blood pressure, eyes, and heart. Even if your cholesterol is high, you get the complete health report for everything.
- `Promise.race`: A 100-meter dash. Whoever crosses the finish line first wins, even if someone tripped and fell along the way.
- `Promise.any`: Hailing a ride from Uber, Lyft, and Ola simultaneously. You get into the first car that arrives and cancel the rest!

---

## 🎯 Interview Points

1. **Which Promise combinator should you use when you don't want one failure to break the whole page?**
   - Use `Promise.allSettled()`. It ensures that independent sections of a dashboard (e.g. notifications, weather, profile) render even if one service is down.


But What Is response?

This is an important point.

When you do:

const response = await fetch(url);

response is not directly your JSON data.

It's a Response object containing information about the HTTP response.

For example:

response
├── status
├── ok
├── headers
├── url
└── body

You might see:

console.log(response.status);

For a successful request:

200


Getting the Actual JSON

Suppose the server returns:

[
    {
        "id": 1,
        "name": "Goutam"
    },
    {
        "id": 2,
        "name": "Rahul"
    }
]

You need:

const data = await response.json();

So the complete pattern is:

async function getUsers() {
    const response = await fetch(url);

    const data = await response.json();

    console.log(data);
}

Think:

fetch()
   ↓
HTTP Response
   ↓
response.json()
   ↓
JavaScript object/array