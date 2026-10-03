# Asynchronous Foundations: Timers & Callback Hell

JavaScript is synchronous by default. It executes one statement at a time.

If a task takes 5 seconds (like waiting for a database response or reading a large file), we cannot freeze the entire browser for 5 seconds.

That's where **Asynchronous JavaScript** comes in.

---

## 1. Synchronous vs Asynchronous

- **Synchronous**: Each task must finish completely before the next line of code runs. (Blocking).
- **Asynchronous**: Long-running operations are offloaded to run in the background. The rest of your code keeps running without waiting. When the background task finishes, a callback handles the result. (Non-blocking).

---

## 2. Timers: `setTimeout` and `setInterval`

### 1. `setTimeout(callback, milliseconds)`
Runs a function once after a specified delay.

```javascript
console.log("Ordering coffee...");

const timerId = setTimeout(() => {
    console.log("Coffee is ready! ☕");
}, 2000);

console.log("Browsing phone while waiting...");
```

**Output:**
```
Ordering coffee...
Browsing phone while waiting...
Coffee is ready! ☕ (after 2 seconds)
```

### Cancelling a Timer:
```javascript
clearTimeout(timerId); // Coffee order cancelled!
```

---

### 2. `setInterval(callback, milliseconds)`
Repeats a function continuously every $X$ milliseconds.

```javascript
let seconds = 0;

const intervalId = setInterval(() => {
    seconds++;
    console.log(`Timer: ${seconds}s`);

    if (seconds === 3) {
        clearInterval(intervalId); // Stop the interval!
        console.log("Timer stopped.");
    }
}, 1000);
```

**Output:**
```
Timer: 1s
Timer: 2s
Timer: 3s
Timer: stopped.
```

---

## 3. What is Callback Hell (Pyramid of Doom)?

In early JavaScript, handling consecutive asynchronous steps required nesting callbacks inside callbacks.

Imagine an eCommerce checkout flow:
1. Validate Cart
2. Charge Credit Card
3. Generate Order Invoice
4. Send Email Confirmation

```javascript
// ❌ CALLBACK HELL: Hard to read, maintain, and debug!
validateCart(cart, function(validCart) {
    chargeCard(validCart, function(paymentReceipt) {
        generateInvoice(paymentReceipt, function(invoice) {
            sendEmail(invoice, function(emailResponse) {
                console.log("Order complete!");
            }, handleError);
        }, handleError);
    }, handleError);
}, handleError);
```

This expanding triangle of code (`>`) is called **Callback Hell**.

---

## 4. The Hidden Trap: Inversion of Control

Callback hell is ugly, but the most dangerous flaw of callbacks in interviews is **Inversion of Control**.

> **Inversion of Control** means you hand over control of your program's execution to a third-party function.

Look at this line:
```javascript
chargeCard(cart, proceedToOrder);
```

You are trusting `chargeCard` (which might be an external payment library) to:
- Call your `proceedToOrder` callback at the right time.
- Call it **only once** (what if a bug calls it twice and charges the customer double?).
- Not swallow errors silently.

You lose complete ownership over your own code execution!

---

## 💡 Think of it like this

- **Synchronous**: Standing in line at a fast food counter waiting for your burger. You cannot leave the line or check your phone until the food is in your hand.
- **Asynchronous Callback**: Taking a buzzer pager and sitting at a table. You do your own work; the pager buzzes when the food is ready.
- **Inversion of Control**: Handing your credit card and PIN to a random delivery driver and hoping they only swipe the exact bill amount once!

---

## 🎯 Interview Points

1. **How do we fix Callback Hell and Inversion of Control?**
   - By using **Promises** and **async/await**!
   - Promises return an object representing the eventual completion of an asynchronous task. We attach callbacks to the promise ourselves, retaining full control.
