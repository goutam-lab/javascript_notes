# Currying Deep Dive & Generalized Curry Function

We previously introduced basic currying. Now, let's look at the **Generalized Auto-Curry function** that top tech interviewers ask candidates to build.

---

## 1. What is Generalized Currying?

An auto-curry function accepts any ordinary function with $N$ arguments and converts it into a curried function that can be called with arguments **one by one, or in batches of any size**, until all required arguments are received.

For example, if you have:
```javascript
function add(a, b, c) { return a + b + c; }
```

An auto-curried version can be called in all these ways:
- `curriedAdd(1)(2)(3)`
- `curriedAdd(1, 2)(3)`
- `curriedAdd(1)(2, 3)`
- `curriedAdd(1, 2, 3)`

---

## 2. How to Build the Generalized `curry()` Function

The secret lies in **`fn.length`**.
In JavaScript, `fn.length` tells you the **number of parameters** the function expects!

```javascript
function curry(fn) {
    return function curried(...args) {
        // If we have received all required arguments:
        if (args.length >= fn.length) {
            return fn.apply(this, args);
        }

        // Otherwise, return a function that collects more arguments:
        return function(...moreArgs) {
            return curried.apply(this, [...args, ...moreArgs]);
        };
    };
}
```

---

## 3. Testing It Out

```javascript
function calculateVolume(length, width, height) {
    return length * width * height;
}

const curriedVolume = curry(calculateVolume);

console.log(curriedVolume(2)(3)(4));    // 24
console.log(curriedVolume(2, 3)(4));    // 24
console.log(curriedVolume(2)(3, 4));    // 24
console.log(curriedVolume(2, 3, 4));    // 24
```

**Output:**
```
24
24
24
24
```

---

## 4. Real-World Use Case: Function Composition & Pipelines

Currying lets you configure specialized functions from generic ones:

```javascript
// Generic discount function:
const discount = curry((rate, price) => price - price * rate);

// Create specialized brand discounts:
const festivalDiscount = discount(0.20); // 20% off
const clearanceDiscount = discount(0.50); // 50% off

console.log("Festival price of $100:", festivalDiscount(100));
console.log("Clearance price of $100:", clearanceDiscount(100));
```

**Output:**
```
Festival price of $100: 80
Clearance price of $100: 50
```

---

## 💡 Think of it like this

Imagine a customized coffee vending machine:
- It requires 3 coins to brew a cup (`fn.length === 3`).
- If you insert 1 coin, it waits and keeps your coin in memory.
- If you insert the next 2 coins together, it recognizes that all 3 coins have arrived and pours your coffee!

---

## 🎯 Interview Points

1. **How does JavaScript know how many arguments a function expects?**
   - Through the `function.length` property. Note: Default parameters and rest parameters (`...args`) do not count towards `function.length`.
