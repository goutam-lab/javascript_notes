# Functions in JavaScript

A function is a reusable block of code designed to perform a specific task.

In JavaScript, functions are **first-class citizens**. That means functions can be:
- Assigned to variables
- Passed as arguments to other functions
- Returned from other functions

Let's look at the three main ways to write functions.

---

## 1. Function Declaration

This is the traditional way.

```javascript
function greet(name) {
    return `Hello, ${name}!`;
}

console.log(greet("Goutam"));
```

**Output:**
```
Hello, Goutam!
```

### Key Feature: Complete Hoisting
Function declarations are hoisted completely with their code. You can call the function **before** the line where it is written!

```javascript
sayHello(); // Works!

function sayHello() {
    console.log("Hey there!");
}
```

---

## 2. Function Expression

Here, we create an anonymous function and assign it to a variable.

```javascript
const add = function(a, b) {
    return a + b;
};

console.log(add(5, 3));
```

**Output:**
```
8
```

Because it is stored in a `const` or `let` variable, it is **not hoisted** with its definition. If you try to call it before declaring it, you get a `ReferenceError`.

---

## 3. Arrow Function (ES6)

Introduced in 2015 to give us shorter syntax and cleaner `this` handling.

```javascript
const multiply = (a, b) => {
    return a * b;
};

// Even shorter if it has a single return statement:
const square = (n) => n * n;

console.log(square(4));
```

**Output:**
```
16
```

---

## 💡 Think of it like this

- **Function Declaration**: Like a recipe printed in a textbook. You can flip directly to it and cook anytime.
- **Function Expression**: Like writing a recipe on a piece of paper and placing it in a folder labeled `add`. You cannot use the recipe until you actually open the folder.
- **Arrow Function**: Like a quick sticky note shorthand recipe. It also uses whatever ingredients (the `this` context) happen to be on the table where it was written.

---

## 4. Parameters vs Arguments

- **Parameters**: The variable names listed in the function definition.
- **Arguments**: The real values you pass into the function when invoking it.

```javascript
function welcome(firstName, lastName) { // firstName, lastName are PARAMETERS
    console.log(`Welcome, ${firstName} ${lastName}`);
}

welcome("Aman", "Kumar"); // "Aman", "Kumar" are ARGUMENTS
```

---

## 5. `console.log()` vs `return`

A very common beginner confusion!

- `console.log()` prints a message to the developer console for you to see. It returns `undefined`.
- `return` sends a value back to the code that called the function so it can be saved or used in further calculations.

```javascript
function calculateTax(amount) {
    return amount * 0.18;
}

let tax = calculateTax(1000);
let totalBill = 1000 + tax;

console.log("Total Bill:", totalBill);
```

**Output:**
```
Total Bill: 1180
```

---

## ⚠️ Common Mistakes

### Mistake 1: Returning an Object Literal from an Arrow Function

```javascript
// ❌ WRONG: JavaScript thinks the curly braces are the function body!
const createUser = (name) => { username: name };
console.log(createUser("Goutam")); // undefined

// ✅ CORRECT: Wrap the object in parentheses ()
const createUserCorrect = (name) => ({ username: name });
console.log(createUserCorrect("Goutam"));
```

**Output:**
```
{ username: 'Goutam' }
```

---

### Mistake 2: Calling a Function Expression before declaring it

```javascript
// ❌ WRONG
speak(); // TypeError or ReferenceError!

const speak = function() {
    console.log("Speaking...");
};
```

---

## 🎯 Interview Points

1. **What are the 3 major differences between Arrow Functions and Regular Functions?**
   - **`this` binding**: Regular functions have dynamic `this` (based on who calls it). Arrow functions have lexical `this` (inherit `this` from the parent scope).
   - **`arguments` object**: Regular functions have the `arguments` object. Arrow functions do not (use `...args` instead).
   - **Constructors**: Regular functions can be used with `new` (like `new Person()`). Arrow functions cannot be used as constructors.

2. **What does a function return if there is no `return` statement?**
   - It returns `undefined` automatically.
