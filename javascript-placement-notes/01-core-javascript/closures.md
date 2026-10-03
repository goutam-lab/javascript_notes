# Closures & Lexical Memory

Closures are the absolute favorite topic of JavaScript interviewers.

If you understand closures deeply, you will instantly stand out in your technical rounds.

---

## 1. What is a Closure?

In simple English:

> A **closure** is created when an inner function remembers and keeps access to variables from its outer function, even **after** the outer function has finished executing and returned.

Normally, when a function finishes running, all its local variables are destroyed to free up memory.

A closure keeps those variables alive in the heap because the inner function still needs them!

---

## 2. The Classic Counter Example

```javascript
function createCounter() {
    let count = 0; // Private variable

    return function() {
        count++;
        return count;
    };
}

const increment = createCounter();

console.log(increment());
console.log(increment());
console.log(increment());
```

**Output:**
```
1
2
3
```

### What happened step-by-step:
1. `createCounter()` ran and created `let count = 0`.
2. It returned the inner anonymous function and finished executing.
3. Normally, `count` would be destroyed.
4. BUT because the returned function still mentions `count`, JavaScript packs `count` into a **Closure backpack**.
5. Every time you call `increment()`, it opens that backpack and updates the same `count`.

---

## 💡 Think of it like this

Imagine you graduate from college and leave the campus.
Before you leave, your favorite professor gives you a magical backpack that has a direct portal back to their office supplies.

Whenever you need a calculator or pen in your new job, you reach into the backpack and pull it from the professor's office, even though you left college years ago!

The returned inner function is you, and the outer function's variables are the supplies in your backpack.

---

## 3. Real-World Use Case: Data Privacy

JavaScript didn't have true private variables for many years. Developers used closures to hide sensitive data:

```javascript
function bankAccount(initialBalance) {
    let balance = initialBalance; // Private: Nobody can change this directly!

    return {
        deposit(amount) {
            balance += amount;
            return `Deposited ${amount}. Balance: ${balance}`;
        },
        withdraw(amount) {
            if (amount > balance) return "Insufficient funds!";
            balance -= amount;
            return `Withdrew ${amount}. Balance: ${balance}`;
        },
        getBalance() {
            return balance;
        }
    };
}

const myAccount = bankAccount(1000);

console.log(myAccount.deposit(500));
console.log(myAccount.withdraw(200));
console.log(myAccount.balance); // Undefined! Cannot be tampered with.
```

**Output:**
```
Deposited 500. Balance: 1500
Withdrew 200. Balance: 1300
undefined
```

---

## 4. The #1 Interview Question: `setTimeout` Inside a Loop

Every interviewer asks this question. Pay close attention!

### The Broken Code
```javascript
for (var i = 0; i < 3; i++) {
    setTimeout(function() {
        console.log(i);
    }, 1000);
}
```

What will be printed after 1 second?
Most beginners answer: `0, 1, 2`.

**The Real Output:**
```
3
3
3
```

### Why did this happen?
1. `var` is function-scoped (not block-scoped). There is only **one shared `i`** for all iterations.
2. The loop runs very fast synchronously and finishes. By the time it finishes, `i` has become `3`.
3. After 1 second, all three `setTimeout` callbacks run. They all look at the exact same shared variable `i`, which is now `3`!

---

## 5. How to Fix It

### Solution 1: Use `let` (Modern ES6 Way)
`let` is block-scoped. Each iteration of the loop creates a **brand new binding of `i`** with its own closure!

```javascript
for (let i = 0; i < 3; i++) {
    setTimeout(function() {
        console.log(i);
    }, 1000);
}
```

**Output:**
```
0
1
2
```

---

### Solution 2: Use an IIFE (Classic ES5 Way)
If an interviewer asks: *"Fix it without using `let`"*, wrap the timer in an Immediately Invoked Function Expression:

```javascript
for (var i = 0; i < 3; i++) {
    (function(currentNumber) {
        setTimeout(function() {
            console.log(currentNumber);
        }, 1000);
    })(i);
}
```

**Output:**
```
0
1
2
```

Here, `currentNumber` creates a private copy of `i` inside that function's closure.

---

## 🎯 Interview Points

1. **What is a Closure? (Your 20-second interview answer)**
   - *"A closure is the combination of a function bundled together with references to its lexical environment. It allows an inner function to access variables from an enclosing outer scope even after the outer function has closed and returned."*

2. **Can closures cause memory leaks?**
   - Yes! Because closures hold onto variables in heap memory, if you create closures inside long-lived event listeners or global objects and forget to clean them up, those variables cannot be garbage-collected.
