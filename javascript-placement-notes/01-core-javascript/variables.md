# Variables in JavaScript (`var`, `let`, `const`)

Hey! Let's start with the absolute foundation.

Variables are just containers to store data in memory so we can use and change it later.

In modern JavaScript, you have three keywords: `var`, `let`, and `const`.

---

## 1. What is `var`?

`var` is the oldest way to declare variables in JavaScript (from 1995).

It is **function-scoped**. That means if you declare a `var` inside an `if` block or a `for` loop, it leaks outside that block.

### Example

```javascript
if (true) {
    var age = 22;
}

console.log(age);
```

**Output:**
```
22
```

Even though `age` was created inside the `{}` block, it is accessible outside. This used to cause huge bugs in large codebases.

---

## 2. What is `let`?

Introduced in ES6 (2015), `let` fixed the biggest problem with `var`.

`let` is **block-scoped**. It lives only inside the `{}` where you declared it.

You can reassign a `let` variable, but you cannot re-declare it in the same scope.

### Example

```javascript
let score = 10;
score = 20; // Allowed!

console.log(score);
```

**Output:**
```
20
```

### Block Scope in Action

```javascript
if (true) {
    let city = "Bengaluru";
}

console.log(city);
```

**Output:**
```
ReferenceError: city is not defined
```

`city` exists only inside the `{}` block. Once the block finishes, it is gone.

---

## 3. What is `const`?

`const` stands for **constant**.

Like `let`, it is **block-scoped**. But once you assign a value to `const`, you **cannot reassign** it.

You must also give it an initial value when you declare it.

### Example

```javascript
const birthYear = 2003;
birthYear = 2004; // Error!
```

**Output:**
```
TypeError: Assignment to constant variable.
```

---

## 💡 Think of it like this

- `var`: Like leaving a notebook in the hallway. Anyone on that floor can write on it and mess up your notes.
- `let`: Like a pencil in your private study room. You can erase and rewrite notes, but nobody outside your room can touch it.
- `const`: Like a permanent tattoo in your private study room. You cannot change it, and nobody outside your room can touch it.

---

## 4. The `const` with Objects Trap (Very Common!)

Many students think `const` makes an object completely unchangeable. That is **not true**.

`const` only locks the **reference** (the memory address). It does NOT lock the contents inside the object.

### Example

```javascript
const user = {
    name: "Goutam",
    role: "Developer"
};

// Allowed: Modifying a property inside
user.role = "Senior SDE";
console.log(user.role);

// NOT Allowed: Reassigning the whole variable
// user = { name: "Rahul" }; // TypeError!
```

**Output:**
```
Senior SDE
```

---

## ⚠️ Common Mistakes

### Mistake 1: Trying to declare `const` without a value

```javascript
// ❌ WRONG
const apiKey;
apiKey = "12345";
```

**Why it fails:** JavaScript requires `const` to have an initial value immediately.

```javascript
// ✅ CORRECT
const apiKey = "12345";
```

---

### Mistake 2: Leaking loop counters with `var`

```javascript
// ❌ WRONG
for (var i = 0; i < 3; i++) {
    // some code
}
console.log(i); // i is still 3! It leaked into the outer scope.

// ✅ CORRECT
for (let j = 0; j < 3; j++) {
    // some code
}
// j does not exist here. Clean memory!
```

---

## 🎯 Interview Points

1. **Which one should you use in real projects?**
   - Use `const` by default for 90% of your code.
   - Use `let` only when you know the variable value needs to change (like counters or accumulator variables).
   - **Never** use `var` in modern code.

2. **Does `var` attach to the `window` object in browsers?**
   - Yes. Writing `var a = 10` in the global scope creates `window.a = 10`.
   - `let` and `const` do NOT attach to `window`.

3. **What is the Temporal Dead Zone (TDZ)?**
   - It is the zone between the start of a block and the line where a `let` or `const` is declared.
   - If you try to access the variable inside this zone, JavaScript throws a `ReferenceError`.
