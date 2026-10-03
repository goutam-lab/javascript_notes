# Advanced Function Concepts: IIFE, Pure Functions & Currying

Let's explore the architectural concepts that distinguish average programmers from senior engineers.

---

## 1. IIFE (Immediately Invoked Function Expression)

An **IIFE** (pronounced *"iffy"*) is a function that runs the very millisecond it is defined.

### Syntax
Wrap the function declaration in grouping parentheses `( ... )` and call it immediately with `()`:

```javascript
(function() {
    let privateDatabaseKey = "SEC_994821";
    console.log("Database initialized safely!");
})();
```

**Output:**
```
Database initialized safely!
```

### Why did developers use IIFEs?
Before ES6 brought `let`, `const`, and ES Modules, any variable declared in a file was global!

If two libraries both created a `var user`, they crashed each other.
Developers wrapped their entire code in an IIFE to create a private function scope so variables wouldn't leak into the global `window`.

---

## 2. Pure Functions vs Impure Functions

This concept is the core foundation of **React** and **Redux**.

### What makes a function "Pure"?
A function is pure if it meets two strict criteria:
1. **Deterministic**: Given the exact same inputs, it **always** returns the exact same output.
2. **Zero Side Effects**: It does not change anything outside itself (no modifying external variables, no DOM updates, no mutating inputs).

### Example: Pure Function
```javascript
// Pure: Does not touch or change anything outside
function add(a, b) {
    return a + b;
}
```

### Example: Impure Function
```javascript
let total = 0;

// Impure: Modifies an external variable outside its scope!
function addToTotal(amount) {
    total += amount;
    return total;
}
```

Other side effects that make a function impure:
- Mutating an object or array passed as an argument
- `Math.random()` or `Date.now()` (returns different results for same call)
- `console.log()` (writes to external system I/O)
- Fetching data from an API

---

## 3. Currying in JavaScript

**Currying** is a functional programming technique where a function that takes multiple arguments is transformed into a sequence of nested functions, each taking **one single argument at a time**.

Instead of calling:
`f(a, b, c)`

Currying lets you call:
`f(a)(b)(c)`

### Basic Example

```javascript
// Non-curried:
const multiply = (a, b) => a * b;

// Curried version:
function curriedMultiply(a) {
    return function(b) {
        return a * b;
    };
}

const double = curriedMultiply(2);
console.log(double(10)); // 20
console.log(curriedMultiply(3)(4)); // 12
```

---

## 4. Real-World Use Case: Configurable Logger

```javascript
const logger = (prefix) => (message) => {
    console.log(`[${prefix.toUpperCase()}]: ${message}`);
};

const errorLogger = logger("Error");
const authLogger = logger("Auth");

errorLogger("Database connection failed!");
authLogger("User logged in successfully.");
```

**Output:**
```
[ERROR]: Database connection failed!
[AUTH]: User logged in successfully.
```

---

## 5. Legendary Interview Challenge: Infinite Currying `sum(1)(2)(3)...()`

Interviewers love asking candidates to create an accumulator function that can be chained infinitely until called empty:

```javascript
function infiniteSum(a) {
    return function(b) {
        if (b !== undefined) {
            return infiniteSum(a + b);
        }
        return a;
    };
}

console.log(infiniteSum(1)(2)(3)(4)());
console.log(infiniteSum(10)(20)());
```

**Output:**
```
10
30
```

### How this works:
Every time you pass a number `b`, it returns a new function with the accumulated sum `a + b`.
When you finally call it with empty parentheses `()`, `b` is `undefined`, so it breaks the chain and returns the final sum `a`!

---

## 💡 Think of it like this

- **IIFE**: Like a self-destructing envelope. It opens, delivers its message, and leaves no evidence behind.
- **Pure Function**: Like a high-school math formula ($f(x) = x^2$). $f(5)$ is always $25$. It doesn't randomly decide to make coffee or set off a fire alarm.
- **Currying**: Like an assembly line. Station 1 adds the car wheels, Station 2 adds the doors, Station 3 adds the roof, and at the end you get the complete car.

---

## 🎯 Interview Points

1. **Why does React require components and reducers to be Pure Functions?**
   - Because React uses **predictable shallow comparison** to know when to re-render. If a component mutates state directly or produces side effects during render, React's virtual DOM reconciliation breaks.

2. **What is the difference between Currying and Partial Application?**
   - **Currying** always breaks a function down into functions that each take **exactly 1 argument**.
   - **Partial Application** fixes *some* arguments of a function and returns a new function that takes all the remaining arguments at once.
