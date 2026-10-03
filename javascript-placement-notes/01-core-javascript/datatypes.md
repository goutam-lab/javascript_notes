# Data Types in JavaScript

In JavaScript, data types tell the computer what kind of value a variable is holding.

JavaScript is **dynamically typed**. That means you don't have to specify if a variable is an `int` or a `string`. JavaScript figures it out automatically at runtime.

---

## 1. The Two Main Categories

JavaScript divides data into two groups:

1. **Primitive Data Types** (Stored directly by value)
2. **Reference Data Types** (Stored as a memory reference to an object in the heap)

---

## 2. The 7 Primitive Types

Primitives are the simplest building blocks. They are immutable (cannot be changed in-place).

### 1. Number
JavaScript has only one number type. It handles both integers and decimal numbers.

```javascript
let count = 42;
let price = 99.99;

console.log(typeof count);
console.log(typeof price);
```

**Output:**
```
number
number
```

### 2. String
Text wrapped in single quotes, double quotes, or backticks.

```javascript
let name = "Goutam";
console.log(typeof name);
```

**Output:**
```
string
```

### 3. Boolean
Only two possible values: `true` or `false`.

```javascript
let isPlaced = true;
console.log(typeof isPlaced);
```

**Output:**
```
boolean
```

### 4. Undefined
A variable has been declared, but **no value has been assigned yet**.

```javascript
let marks;
console.log(marks);
console.log(typeof marks);
```

**Output:**
```
undefined
undefined
```

### 5. Null
Represents the **intentional absence** of any object value. You set this manually when you want a variable to be empty.

```javascript
let selectedJob = null;
console.log(selectedJob);
console.log(typeof selectedJob);
```

**Output:**
```
null
object
```

*(Notice `typeof null` is `"object"`. This is a famous JavaScript bug from 1995 that was never fixed to avoid breaking old websites!)*

### 6. BigInt
Used for numbers bigger than `2^53 - 1` (the maximum safe integer in JS).

```javascript
let hugeNumber = 9007199254740991n;
console.log(typeof hugeNumber);
```

**Output:**
```
bigint
```

### 7. Symbol
Used to create completely unique, hidden identifiers for object properties.

```javascript
let id1 = Symbol("id");
let id2 = Symbol("id");

console.log(id1 === id2);
```

**Output:**
```
false
```

---

## 3. What is a Reference Type?

Everything that is not a primitive is an **Object** (Plain Objects, Arrays, Functions, Dates).

When you assign an object to a variable, JavaScript does not copy the data. It copies the **memory address** (reference).

### Example

```javascript
let user1 = { name: "Aman" };
let user2 = user1; // user2 points to the SAME memory

user2.name = "Rahul";

console.log(user1.name);
```

**Output:**
```
Rahul
```

Changing `user2` also changed `user1` because they both point to the exact same house in memory.

---

## 💡 Think of it like this

- **Primitive values**: Like handing someone a photocopy of your notes. If they scribble on their paper, your original paper remains untouched.
- **Reference values**: Like sharing a Google Doc link. If they edit the document, you see the edits immediately because you are both looking at the exact same file online.

---

## 4. What is `NaN`?

`NaN` stands for **Not-a-Number**.

It happens when a mathematical calculation fails or produces an invalid result.

```javascript
let result = "apple" / 2;
console.log(result);
console.log(typeof result);
```

**Output:**
```
NaN
number
```

### The Big `NaN` Trap
In JavaScript, `NaN` is not equal to anything—not even itself!

```javascript
console.log(NaN === NaN);
```

**Output:**
```
false
```

To check if a value is `NaN`, always use `Number.isNaN()`:

```javascript
console.log(Number.isNaN(result));
```

**Output:**
```
true
```

---

## ⚠️ Common Mistakes

### Mistake 1: Comparing with `null` using `typeof`

```javascript
// ❌ WRONG
if (typeof data === "object") {
    // If data is null, this code still runs and might crash!
}

// ✅ CORRECT
if (data === null) {
    console.log("Value is null");
}
```

---

### Mistake 2: Floating point precision trap

```javascript
console.log(0.1 + 0.2 === 0.3);
```

**Output:**
```
false
```

**Why?** In computer memory, decimal numbers are stored in binary base-2 floating-point format. `0.1 + 0.2` actually produces `0.30000000000000004`.

In an interview, if you need to compare decimals safely:

```javascript
// ✅ Safe way: Check if difference is very tiny
const isEqual = Math.abs((0.1 + 0.2) - 0.3) < Number.EPSILON;
console.log(isEqual); // true
```

---

## 🎯 Interview Points

1. **What is the difference between `undefined` and `null`?**
   - `undefined` means a variable was declared but JavaScript automatically left it empty.
   - `null` is an explicit, intentional value assigned by the developer to say "this is empty".

2. **Why does `typeof null` return `"object"`?**
   - In the first version of JavaScript, values were stored with a type tag. Objects had tag `0`. The null pointer was `0x00`, so JavaScript incorrectly read it as an object. It was left in place for backwards compatibility.

3. **How do you check if an array is an array?**
   - `typeof []` returns `"object"`.
   - Always use `Array.isArray(myArr)`.
