# Operators & Type Coercion

Operators let us do math, compare values, and make decisions.

In JavaScript interviews, operators are famous for one big reason: **Type Coercion** (JavaScript secretly converting one type into another).

Let's break it down so it makes complete sense.

---

## 1. `==` vs `===` (Loose vs Strict Equality)

This is asked in almost every single placement interview.

### Strict Equality (`===`)
Checks **both the value and the type** without converting anything.

```javascript
console.log(5 === 5);
console.log(5 === "5");
```

**Output:**
```
true
false
```

Since `5` is a number and `"5"` is a string, `===` immediately says `false`.

### Loose Equality (`==`)
Converts the values to the same type first, and then compares them.

```javascript
console.log(5 == "5");
```

**Output:**
```
true
```

JavaScript automatically converted `"5"` into the number `5`, so it returned `true`.

---

## 💡 Think of it like this

- `===` is like a strict airport security officer: "Your name, face, and passport must match 100%."
- `==` is like an easygoing club bouncer: "Ah, close enough, come on in."

In 99.9% of real-world code, **always use `===`** so you never get caught off-guard.

---

## 2. Logical Operators (`&&`, `||`, `??`)

These operators don't just return `true` or `false`. They actually return the **deciding value itself**.

### 1. Logical AND (`&&`)
Looks for the **first falsy value** and returns it. If everything is truthy, it returns the last value.

```javascript
console.log("apple" && 0 && "orange");
console.log("apple" && "banana");
```

**Output:**
```
0
banana
```

### 2. Logical OR (`||`)
Looks for the **first truthy value** and returns it.

```javascript
let enteredName = "";
let displayName = enteredName || "Guest User";

console.log(displayName);
```

**Output:**
```
Guest User
```

Because `""` is falsy, it fell back to `"Guest User"`.

---

## 3. The Modern Hero: Nullish Coalescing (`??`)

Look at this common bug with `||`:

```javascript
let score = 0; // 0 is a valid score!
let finalScore = score || 10;

console.log(finalScore);
```

**Output:**
```
10
```

Because `0` is considered falsy, `||` completely ignored the user's score of `0` and returned `10`!

To fix this, JavaScript introduced `??`. It only falls back if the value is **`null` or `undefined`**.

```javascript
let score = 0;
let finalScore = score ?? 10;

console.log(finalScore);
```

**Output:**
```
0
```

`0` is neither `null` nor `undefined`, so it stays `0`!

---

## 4. The 8 Falsy Values in JavaScript

Whenever JavaScript expects a boolean, it converts these 8 values to `false`. Everything else in JavaScript is `true`.

1. `false`
2. `0` (and `-0`)
3. `0n` (BigInt zero)
4. `""` (Empty string)
5. `null`
6. `undefined`
7. `NaN`
8. `document.all`

> **Note for interviews:** An empty array `[]` and empty object `{}` are **TRUTHY**!
> ```javascript
> if ([]) {
>     console.log("Arrays are truthy!"); // This runs!
> }
> ```

---

## 5. Type Coercion with `+` vs `-`

The `+` operator has two jobs: **Math addition** and **String joining**.

If either side is a string, `+` will convert everything to strings and join them.

```javascript
console.log(1 + "2");
console.log(1 + 2 + "3");
console.log("1" + 2 + 3);
```

**Output:**
```
12
33
123
```

**Why does `1 + 2 + "3"` become `"33"`?**
Because code runs left-to-right:
1. `1 + 2` is `3`.
2. `3 + "3"` becomes `"33"`.

Now look at subtraction `-`:

```javascript
console.log("10" - 2);
console.log("10" * "2");
```

**Output:**
```
8
20
```

Strings cannot be mathematically subtracted, so JavaScript forces them into numbers!

---

## ⚠️ Common Mistakes

### Mistake 1: Confusing `null == undefined` with `===`

```javascript
console.log(null == undefined);
console.log(null === undefined);
```

**Output:**
```
true
false
```

**Why?**
The JavaScript specification has a special rule: `null` and `undefined` are loosely equal (`==`) to each other, but strictly (`===`) they are different types.

---

## 🎯 Interview Points

1. **What is the result of `[] == ![]` and why?**
   - Result is `true`.
   - Step 1: `![]` evaluates to `false` (because `[]` is truthy).
   - Step 2: So the comparison is `[] == false`.
   - Step 3: `false` turns to `0`. `[]` turns to empty string `""`.
   - Step 4: `""` turns to number `0`.
   - Step 5: `0 == 0` is `true`.

2. **When should you use `??` instead of `||`?**
   - Use `??` whenever `0`, `""`, or `false` are valid, acceptable values that should not be replaced by the default fallback.
