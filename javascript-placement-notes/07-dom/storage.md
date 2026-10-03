# Client-Side Storage: LocalStorage, SessionStorage & Cookies

Web applications often need to remember user preferences, authentication tokens, and shopping carts.

JavaScript provides three main ways to store data in the browser.

---

## 1. Quick Summary of the 3 Storage Types

- **`localStorage`**: Stores data with **no expiration date**. It stays saved even if you close the tab, close the browser, or turn off your computer. (~5MB capacity).
- **`sessionStorage`**: Stores data only for the **current browser tab session**. The moment you close that specific tab, the data is wiped out. (~5MB capacity).
- **Cookies**: Small pieces of data (~4KB) that are **automatically sent to the server with every HTTP network request**. Used mainly for user authentication and session management.

---

## 2. Using `localStorage` and `sessionStorage`

The API for both is identical:

```javascript
// 1. Storing data (Keys and values MUST be strings!)
localStorage.setItem("theme", "dark");

// 2. Reading data
const currentTheme = localStorage.getItem("theme");
console.log("Theme:", currentTheme);

// 3. Removing a specific item
localStorage.removeItem("theme");

// 4. Clearing everything
localStorage.clear();
```

---

## 3. Storing Objects & Arrays in Storage

Because `localStorage` only accepts strings, trying to save an object directly results in the dreaded `"[object Object]"` bug!

Always serialize with `JSON.stringify` and `JSON.parse`:

```javascript
const userProfile = {
    name: "Goutam",
    skills: ["JS", "React", "Node"]
};

// ❌ WRONG:
// localStorage.setItem("user", userProfile); // Saves "[object Object]"!

// ✅ CORRECT:
localStorage.setItem("user", JSON.stringify(userProfile));

// When retrieving, parse it back to an object:
const savedUser = JSON.parse(localStorage.getItem("user"));
console.log(savedUser.name); // "Goutam"
```

---

## 4. Cookies & Security (Top Interview Topic!)

Cookies are configured with special security flags:
1. **`HttpOnly`**: When set, JavaScript **cannot access the cookie** (`document.cookie` will not show it). This completely protects your session token from being stolen by **XSS (Cross-Site Scripting)** attacks!
2. **`Secure`**: Cookie is only transmitted over encrypted HTTPS connections.
3. **`SameSite=Strict/Lax`**: Prevents **CSRF (Cross-Site Request Forgery)** attacks by blocking external websites from sending your cookie.

---

## 5. Security Comparison: Where should you store JWT Tokens?

Interviewers love to ask: *"Should you store JWT authentication tokens in `localStorage` or `HttpOnly` Cookies?"*

> **The Senior Answer:**
> Storing JWTs in `localStorage` is vulnerable to **XSS attacks**. If any third-party script or library on your page is compromised, an attacker can run `localStorage.getItem("token")` and steal the user's session.
> 
> Therefore, storing authentication and refresh tokens in an **`HttpOnly`, `Secure` Cookie** is the industry gold standard because JavaScript cannot access it directly.

---

## 💡 Think of it like this

- **`localStorage`**: Like writing notes in a physical spiral diary on your desk. You can shut the room and come back next year; the notes are still there.
- **`sessionStorage`**: Like writing on a hotel room whiteboard. You can use it while you stay, but the moment you check out and shut the door (close the tab), housekeeping wipes it clean.
- **Cookies**: Like a VIP wristband given to you at a club entrance. Every time you walk up to the bar or security gate (make an API call), the staff glances at your wristband automatically to verify who you are!

---

## 🎯 Interview Points

1. **What is the storage capacity limit of Cookies vs LocalStorage?**
   - Cookies: ~4 Kilobytes.
   - LocalStorage / SessionStorage: ~5 to 10 Megabytes per origin.
   - IndexedDB: Hundreds of Megabytes (or gigabytes depending on disk).

2. **Is `localStorage` shared across multiple tabs of the same website?**
   - Yes! Any tab with the same protocol, domain, and port (same origin) shares the same `localStorage`.
   - `sessionStorage` is unique to that specific single tab.
