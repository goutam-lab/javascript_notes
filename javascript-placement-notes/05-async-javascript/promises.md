# Promises in JavaScript

A **Promise** is modern JavaScript's solution to Callback Hell and Inversion of Control.

---

## 1. What is a Promise?

In simple English:

> A **Promise** is a placeholder object representing the **eventual completion (or failure)** of an asynchronous operation and its resulting value.

Instead of passing your callback into a black-box function, the asynchronous function returns a **Promise object** directly to you.
You then attach your own handlers using `.then()`, `.catch()`, and `.finally()`.

---

## 2. The 3 States of a Promise

A Promise can only be in one of these three states at any given moment:

```
                  ┌───────────────► FULFILLED (Success: resolve)
                  │
PENDING (Initial) ┤
                  │
                  └───────────────► REJECTED  (Error: reject)
```

1. **`pending`**: The async task is still running (e.g. downloading data).
2. **`fulfilled`**: The operation completed successfully. Calls `resolve(value)`.
3. **`rejected`**: The operation failed. Calls `reject(error)`.

> **The Immutability Rule:** Once a Promise is settled (`fulfilled` or `rejected`), its state and value are **frozen forever**. It can never transition again!

---

## 3. Creating a Promise from Scratch

We use the `new Promise()` constructor:

```javascript
const orderPizza = new Promise((resolve, reject) => {
    let ovenWorking = true;

    setTimeout(() => {
        if (ovenWorking) {
            resolve("Hot Margherita Pizza 🍕");
        } else {
            reject("Oven broke down! ❌");
        }
    }, 1500);
});
```

---

## 4. Consuming a Promise: `.then()`, `.catch()`, `.finally()`

```javascript
orderPizza
    .then((food) => {
        console.log("Success:", food);
    })
    .catch((error) => {
        console.error("Failed:", error);
    })
    .finally(() => {
        console.log("Cleaning the kitchen table regardless of outcome!");
    });
```

**Output (when successful):**
```
Success: Hot Margherita Pizza 🍕
Cleaning the kitchen table regardless of outcome!
```

---

## 5. Promise Chaining (Eliminating Callback Hell)

Every call to `.then()` returns a **brand new Promise**.
This allows us to chain asynchronous steps in a clean, vertical, readable line!

```javascript
validateCart(cart)
    .then((validCart) => chargeCard(validCart))
    .then((receipt) => generateInvoice(receipt))
    .then((invoice) => sendEmail(invoice))
    .then(() => console.log("Order successfully finished!"))
    .catch((error) => {
        // One single .catch catches ANY error from ANY step above!
        console.error("Order failed:", error);
    });
```

---

## 💡 Think of it like this

A Promise is like a token you get when you order food at a restaurant counter:
- When the cashier hands you the plastic number slip, the food is **Pending**.
- If the kitchen cooks your burger, your token is **Fulfilled** $\rightarrow$ you exchange it for food (`.then`).
- If the kitchen ran out of burgers, your token is **Rejected** $\rightarrow$ you get your money back (`.catch`).
- Either way, you leave the counter (`.finally`).

---

## ⚠️ Common Mistakes

### Forgetting to return a promise or value in `.then()`

```javascript
// ❌ BROKEN CHAIN:
fetchUser()
    .then((user) => {
        getUserPosts(user.id); // Forgets the 'return' keyword!
    })
    .then((posts) => {
        console.log(posts); // undefined! Because previous step returned nothing.
    });

// ✅ CORRECT:
fetchUser()
    .then((user) => {
        return getUserPosts(user.id); // Returns the promise to next .then
    })
    .then((posts) => {
        console.log(posts); // Receives real posts!
    });
```

---

## 🎯 Interview Points

1. **How does Promise solve Inversion of Control?**
   - With callbacks, we passed our function into another function, giving them control.
   - With Promises, the function returns a Promise object to us. We retain control over how, when, and where we attach our `.then()` and `.catch()` listeners.

2. **Does a Promise execute immediately upon creation?**
   - **Yes!** The executor function passed into `new Promise((resolve, reject) => { ... })` runs **synchronously** the moment the constructor is called.

promise.allsettled()
sometimes you dont care if some operations fail, you just want to wait for all of them to complete
const p1 = Promise.resolve(1)
const p2 = Promise.resolve(2)
const p3 = Promise.resolve(3)

Promise.allSettled([p1, p2, p3])
    .then((results) => {
        console.log(results); // [ { status: 'fulfilled', value: 1 }, { status: 'fulfilled', value: 2 }, { status: 'fulfilled', value: 3 } ]
    });

Promise.all()
→ one failure can reject the whole result

Promise.allSettled()
→ gives you every result

promise.race()
you only care about whichever settle first

promise.race(promise1, promise2, promise3) returns the result of the first promise that settles

if promise2 rejected first it will settle and return the result

promise.any()
This one is slightly different.

Promise.any() waits for the first successful Promise.

const p1 = Promise.reject("Error 1");

const p2 = Promise.resolve("Success");

const p3 = Promise.resolve("Success 2");

Promise.any([p1, p2, p3])
    .then((result) => {
        console.log(result);
    });

output : success

