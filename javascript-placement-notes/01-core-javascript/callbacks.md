# Callbacks & Higher-Order Functions

JavaScript treats functions as **first-class citizens**.

That simply means you can do anything with a function that you can do with a regular variable:
1. Store it in a variable.
2. Pass it as an argument into another function.
3. Return it from another function.

This superpower enables **Callbacks** and **Higher-Order Functions**.

---

## 1. What is a Callback Function?

> A **callback function** is a function passed as an argument to another function, with the intention that it will be called ("called back") later.

### Example

```javascript
function greetUser(name, formatCallback) {
    let formattedName = formatCallback(name);
    console.log(`Hello, ${formattedName}!`);
}

function makeUppercase(text) {
    return text.toUpperCase();
}

// Pass makeUppercase as a callback
greetUser("goutam", makeUppercase);
```

**Output:**
```
Hello, GOUTAM!
```

---

## 2. What is a Higher-Order Function (HOF)?

A function is called a **Higher-Order Function** if it does at least one of these two things:
1. It **takes another function as an argument** (like `greetUser` above).
2. It **returns a new function**.

---

## 3. Function Factories (Functions returning functions)

When a higher-order function uses closures to build customized functions, we call it a **Function Factory**.

### Example

```javascript
function createMultiplier(factor) {
    return function(number) {
        return number * factor;
    };
}

const double = createMultiplier(2);
const triple = createMultiplier(3);

console.log(double(5));
console.log(triple(5));
```

**Output:**
```
10
15
```

---

## 💡 Think of it like this

- **Regular function**: Like a coffee machine with a fixed button. You press it, you get black coffee.
- **Higher-Order function**: Like a customizable smart blender. You supply your own ingredients and recipe card (the callback function), and the blender executes your custom steps!

---

## 4. Built-in Higher-Order Functions on Arrays

JavaScript has powerful built-in HOFs that you will use every day in React and coding rounds:

### 1. `forEach()`
Runs a function for each item to perform side effects. Does **not** return anything.

```javascript
[1, 2, 3].forEach((num) => console.log(num * 10));
```

### 2. `map()`
Transforms each item and returns a **brand new array** of the exact same length.

```javascript
const doubled = [1, 2, 3].map((num) => num * 2);
console.log(doubled);
```

**Output:**
```
[2, 4, 6]
```

### 3. `filter()`
Checks a condition for each item and returns a **brand new array** with only the items that returned `true`.

```javascript
const evens = [1, 2, 3, 4, 5, 6].filter((num) => num % 2 === 0);
console.log(evens);
```

**Output:**
```
[2, 4, 6]
```

### 4. `reduce()`
Boils an entire array down to a **single final value** (sum, average, grouped object, etc.).

```javascript
const total = [10, 20, 30].reduce((accumulator, current) => {
    return accumulator + current;
}, 0); // 0 is the starting initial value

console.log(total);
```

**Output:**
```
60
```

---

## 5. Whiteboard Challenge: Writing a Polyfill for `map`

Interviewers frequently ask: *"Can you write your own `.map()` method without using JavaScript's built-in one?"*

Here is how you write it cleanly:

```javascript
Array.prototype.myMap = function(callback) {
    let result = [];

    // 'this' refers to the array calling myMap
    for (let i = 0; i < this.length; i++) {
        result.push(callback(this[i], i, this));
    }

    return result;
};

// Testing our custom polyfill:
const numbers = [10, 20, 30];
const tripled = numbers.myMap((n) => n * 3);

console.log(tripled);
```

**Output:**
```
[30, 60, 90]
```

---

## ⚠️ Common Mistakes

### Passing an invoked function instead of the function reference

```javascript
function greet() {
    console.log("Hello!");
}

// ❌ WRONG: Calling greet() immediately!
// setTimeout(greet(), 1000); 

// ✅ CORRECT: Pass the function NAME (reference)
setTimeout(greet, 1000);
```

**Why?** `greet()` calls the function instantly and passes its return value (`undefined`) into `setTimeout`. Passing `greet` tells JavaScript: *"Run this function when the 1 second timer is up."*

---

## 🎯 Interview Points

1. **What is Callback Hell?**
   - When multiple nested asynchronous callbacks are chained inside each other (e.g. `step1(function() { step2(function() { step3(...) }) })`), creating a sideways pyramid (`>`) that is hard to read and debug.
   - Solved by **Promises** and **async/await**.

2. **Does `map()` mutate the original array?**
   - No! `map()` returns a brand new array, leaving the original array completely untouched.
