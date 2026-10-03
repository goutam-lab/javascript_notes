# Loops in JavaScript

Loops help us repeat a block of code multiple times until a condition is met.

For placement interviews and DSA, you need to know when to use which loop, and which loop you should **never** use for arrays.

---

## 1. Standard `for` Loop

Best for:
- When you know the exact start and end points.
- DSA problems where you need the index for swapping, pointers, or window slicing.

```javascript
for (let i = 0; i < 3; i++) {
    console.log("Count:", i);
}
```

**Output:**
```
Count: 0
Count: 1
Count: 2
```

---

## 2. `while` and `do...while`

### `while`
Checks the condition **first**. If false at the beginning, it never runs ($0$ times).

```javascript
let energy = 3;
while (energy > 0) {
    console.log("Working, energy left:", energy);
    energy--;
}
```

### `do...while`
Runs the body **at least once** before checking the condition.

```javascript
let count = 0;
do {
    console.log("Executed once!");
} while (count > 5);
```

**Output:**
```
Executed once!
```

---

## 3. `for...of` (The Array Champion)

Introduced in ES6. It gives you the **values** directly without messing with indices.

Works on any **iterable** (Arrays, Strings, Sets, Maps).

```javascript
const skills = ["JavaScript", "React", "Node"];

for (const skill of skills) {
    console.log(skill);
}
```

**Output:**
```
JavaScript
React
Node
```

---

## 4. `for...in` (For Objects Only!)

Iterates over the **keys (property names)** of an Object.

```javascript
const student = {
    name: "Goutam",
    branch: "CSE",
    year: 4
};

for (const key in student) {
    console.log(key, "->", student[key]);
}
```

**Output:**
```
name -> Goutam
branch -> CSE
year -> 4
```

---

## 5. Why You Should NEVER Use `for...in` on Arrays!

This is a classic trap interviewers look for.

If you use `for...in` on an array:
1. The index returned is a **String**, not a Number (`"0"`, `"1"`).
2. If any external library or code adds a property to `Array.prototype`, `for...in` will iterate over that prototype property too!

### Example

```javascript
const nums = [10, 20];
Array.prototype.customMethod = function() {};

for (const index in nums) {
    console.log(index);
}
```

**Output:**
```
0
1
customMethod
```

**Rule:**
- Arrays: Use `for`, `for...of`, or array methods (`forEach`, `map`).
- Objects: Use `for...in` or `Object.keys()`.

---

## 6. `break` vs `continue`

- `break`: Immediately exits the loop completely.
- `continue`: Skips the rest of the current iteration and jumps to the next one.

```javascript
for (let i = 1; i <= 5; i++) {
    if (i === 3) continue; // Skip 3
    if (i === 5) break;    // Stop at 5
    console.log(i);
}
```

**Output:**
```
1
2
4
```

---

## ⚠️ Common Mistakes

### Trying to `break` inside a `forEach` loop

```javascript
// ❌ THIS WILL THROW A SYNTAX ERROR!
[1, 2, 3, 4].forEach((num) => {
    if (num === 2) {
        // break; // SyntaxError: Illegal break statement
    }
});
```

**Why?** `forEach` executes a callback function for every element. `break` only works inside native loops (`for`, `while`, `for...of`).

If you need to stop early, use `for...of` or `.some()`.

---

## 🎯 Interview Points

1. **Which loop is fastest in JavaScript?**
   - The classic `for` loop (or `while` loop) is the fastest because it avoids function call overhead.
2. **Can you iterate over a plain object with `for...of`?**
   - No. Plain objects are not iterables by default (they lack `[Symbol.iterator]`). It will throw a `TypeError: obj is not iterable`.
   - Use `Object.entries(obj)` with `for...of`:
     ```javascript
     for (const [key, value] of Object.entries(student)) {
         console.log(key, value);
     }
     ```
