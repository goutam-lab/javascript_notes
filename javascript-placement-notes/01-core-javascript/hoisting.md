# Hoisting & Temporal Dead Zone (TDZ)

Hoisting is one of the most frequently asked JavaScript interview questions.

Many people think JavaScript physically "moves code to the top of the file."
That is **not true**. Your code stays exactly where you typed it.

Let's understand what actually happens.

---

## 1. What is Hoisting?

Before JavaScript executes even a single line of your code, it runs a **Compilation / Memory Creation Phase**.

During this phase, JavaScript scans through your file and reserves memory slots for all variables and function declarations.

Only after memory is allocated does it run your code line by line (the **Execution Phase**).

---

## 2. Hoisting with `var`

When JavaScript finds a `var`, it reserves memory for it and initializes it with the value **`undefined`**.

```javascript
console.log(score);

var score = 100;

console.log(score);
```

**Output:**
```
undefined
100
```

### What JavaScript did internally:
```javascript
// Phase 1 (Memory): var score = undefined;
// Phase 2 (Execution):
console.log(score); // undefined
score = 100;
console.log(score); // 100
```

---

## 3. Hoisting with `let` and `const` (The TDZ)

Does `let` and `const` get hoisted?

**YES!** They are also scanned and allocated in memory before code runs.

However, unlike `var`, JavaScript does **NOT** initialize them with `undefined`. They are kept in a special state called the **Temporal Dead Zone (TDZ)**.

If you try to read or write to a variable while it is in the TDZ, JavaScript throws an error.

```javascript
console.log(marks);

let marks = 95;
```

**Output:**
```
ReferenceError: Cannot access 'marks' before initialization
```

---

## 💡 Think of it like this

- **`var`**: Like ordering a book online. The delivery company delivers an empty placeholder box to your house in the morning (`undefined`). You can touch the box anytime. Later in the evening, they put the actual book inside (`100`).
- **`let` / `const`**: Like reserving a table at a luxury restaurant. The restaurant knows your name is on the list (it is hoisted into memory), but the guards will not let you enter the door (TDZ) until your exact reservation time arrives. Try to enter early? Security kicks you out (`ReferenceError`)!

---

## 4. Visualizing the Temporal Dead Zone

```
{
    // === TDZ for 'name' starts here ===
    // 
    // console.log(name); // ❌ ReferenceError!
    // 
    // === TDZ continues... ===
    
    let name = "Goutam"; // 🏁 TDZ ends right here!
    
    console.log(name); // ✅ Accessible: "Goutam"
}
```

---

## 5. Function Declaration vs Function Expression Hoisting

### Function Declarations: Completely Hoisted
The whole function body is saved in memory during Phase 1. You can call it anytime!

```javascript
sayHello(); // Works perfectly!

function sayHello() {
    console.log("Hello SDE!");
}
```

### Function Expressions: Variable Rules Apply!
If you assign a function to a variable, it follows variable hoisting rules:

```javascript
sayHi(); // Error!

var sayHi = function() {
    console.log("Hi!");
};
```

**Output:**
```
TypeError: sayHi is not a function
```

**Why `TypeError`?**
Because in Phase 1, `var sayHi` is set to `undefined`.
So at line 1, JavaScript is trying to do: `undefined()`! And `undefined` is not a function.

---

## 🎯 Interview Points

1. **Are `let` and `const` hoisted?**
   - Yes, they are hoisted into memory, but uninitialized. They remain in the Temporal Dead Zone (TDZ) from the beginning of the block until the declaration line is reached.

2. **What is the difference between `ReferenceError` and `TypeError` in hoisting?**
   - `ReferenceError`: You tried to access a `let`/`const` inside TDZ, or an undeclared variable.
   - `TypeError`: The variable exists (like `var fn = undefined`), but you tried to execute it like a function.
