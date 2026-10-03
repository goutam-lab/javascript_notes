# JavaScript Debugging Traps & Edge Cases

Here are the most notorious JavaScript bugs that trip up developers in live coding rounds and debugging interviews.

---

## 1. The Automatic Semicolon Insertion (ASI) Trap

Look at this function:

```javascript
function getUser() {
    return
    {
        name: "Goutam"
    };
}

console.log(getUser());
```

### What prints?
Most people expect `{ name: "Goutam" }`.

**The Real Output:**
```
undefined
```

### Why?
JavaScript has a feature called **Automatic Semicolon Insertion (ASI)**.
If you place a newline directly after the `return` keyword, JavaScript assumes your statement ended and inserts a semicolon automatically:
```javascript
return; // <-- Semicolon inserted here!
{
    name: "Goutam";
}
```

**Fix:** Always put the opening brace `{` on the **same line** as `return`:
```javascript
function getUser() {
    return {
        name: "Goutam"
    };
}
```

---

## 2. Mutating an Array While Iterating Over It

```javascript
const numbers = [1, 2, 3, 4, 5];

for (let i = 0; i < numbers.length; i++) {
    if (numbers[i] === 2) {
        numbers.splice(i, 1); // Deletes 2
    }
    console.log("Item:", numbers[i]);
}
```

**Output:**
```
Item: 1
Item: 3
Item: 4
Item: 5
```

Notice that **`3` was evaluated at index 1 without being properly inspected!**
When you remove an element with `splice`, all subsequent elements shift left by 1 index, skipping elements!

**Fix:** If you must remove elements while looping, loop **backwards** from `length - 1` down to `0`, or use `.filter()`.

---

## 3. The `Array(n).fill()` Reference Bug

```javascript
const matrix = new Array(3).fill([]);
matrix[0].push("Bug!");

console.log(matrix);
```

**Output:**
```
[ [ 'Bug!' ], [ 'Bug!' ], [ 'Bug!' ] ]
```

Every row points to the exact same array in heap memory!

**Fix:**
```javascript
const matrixFixed = Array.from({ length: 3 }, () => []);
```

---

## 4. The `NaN === NaN` Trap

```javascript
const value = NaN;

if (value === NaN) {
    console.log("It's NaN"); // Never runs!
}
```

`NaN` is the only value in JavaScript that is **never equal to itself**.
Always use `Number.isNaN(value)`.

---

## 5. Accidental Global Variables in Non-Strict Mode

```javascript
function calculate() {
    total = 100; // Forgot 'let' or 'const'!
}

calculate();
console.log(window.total); // 100 (Polluted global window!)
```

**Fix:** Always write `"use strict";` at the top of your scripts, or use ES Modules (which are in strict mode by default). Strict mode turns undeclared assignments into an immediate `ReferenceError`.
