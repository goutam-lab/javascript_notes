# Objects & Object Methods

In JavaScript, almost everything is an Object under the hood.

An **Object** is a collection of key-value pairs used to store structured data.

---

## 1. Creating and Accessing Objects

```javascript
const developer = {
    name: "Goutam",
    skills: ["JS", "React", "Node"],
    "years-of-experience": 2, // Quoted key for hyphens
    greet() {
        return `Hi, I am ${this.name}`;
    }
};

// 1. Dot Notation (Preferred when key name is standard)
console.log(developer.name);

// 2. Bracket Notation (Required for hyphens, numbers, or dynamic variables)
console.log(developer["years-of-experience"]);

const propertyName = "skills";
console.log(developer[propertyName]); // Accessing dynamically via variable
```

**Output:**
```
Goutam
2
[ 'JS', 'React', 'Node' ]
```

---

## 2. Objects are Passed by Reference!

When you assign an object to another variable, you are **not** making a copy.
You are simply creating a second pointer to the same object in heap memory.

```javascript
const userA = { name: "Anil", score: 80 };
const userB = userA; // Points to the exact same object!

userB.score = 95;

console.log(userA.score); // Changed to 95 too!
```

---

## 3. Essential Object Methods

JavaScript provides powerful helper functions on the global `Object`:

### `Object.keys()`
Returns an array of all the **key names**.

```javascript
const student = { name: "Rohan", age: 21, cgpa: 8.9 };
console.log(Object.keys(student));
```

**Output:**
```
[ 'name', 'age', 'cgpa' ]
```

### `Object.values()`
Returns an array of all the **values**.

```javascript
console.log(Object.values(student));
```

**Output:**
```
[ 'Rohan', 21, 8.9 ]
```

### `Object.entries()`
Returns an array of **`[key, value]` pairs**. Very useful for iterating!

```javascript
console.log(Object.entries(student));
```

**Output:**
```
[ [ 'name', 'Rohan' ], [ 'age', 21 ], [ 'cgpa', 8.9 ] ]
```

---

## 4. `Object.freeze()` vs `Object.seal()`

Interviewers love asking how to prevent an object from being modified.

### 1. `Object.freeze(obj)`
Completely locks the object:
- ❌ Cannot add new properties
- ❌ Cannot delete existing properties
- ❌ Cannot change existing property values

```javascript
const config = Object.freeze({
    apiEndpoint: "https://api.myapp.com",
    version: 1
});

config.version = 2; // Silently ignored (or throws error in strict mode)
console.log(config.version);
```

**Output:**
```
1
```

### 2. `Object.seal(obj)`
Slightly more relaxed:
- ❌ Cannot add new properties
- ❌ Cannot delete existing properties
- ✅ **CAN edit/update existing property values!**

---

## 💡 Think of it like this

- `Object.freeze()`: Like putting a document inside a block of solid ice. You cannot add pages, tear pages out, or even write a single word on it.
- `Object.seal()`: Like putting a document inside a locked display case. You cannot add new pages or remove old pages, but if there's a whiteboard page inside, you can still rewrite on it!

---

## 5. Checking if a Property Exists

### Modern ES2022 way: `Object.hasOwn()`

```javascript
const car = { brand: "Tesla", model: "Model 3" };

console.log(Object.hasOwn(car, "brand")); // true
console.log(Object.hasOwn(car, "price")); // false
```

Avoid calling `car.hasOwnProperty()` directly on the object, because an object created with `Object.create(null)` doesn't have prototype methods and will crash.

---

## ⚠️ Common Mistakes

### `Object.freeze()` is Shallow!

If your object has a nested object inside it, `Object.freeze()` does **NOT** freeze the nested object!

```javascript
const user = Object.freeze({
    name: "Goutam",
    location: {
        city: "Bengaluru"
    }
});

user.location.city = "Delhi"; // ⚠️ This works! It was not frozen.
console.log(user.location.city);
```

**Output:**
```
Delhi
```

If you need a true deep freeze, you must recursively freeze every nested object.

---

## 🎯 Interview Points

1. **What types can be used as keys in a plain JavaScript object?**
   - Only **Strings** and **Symbols**.
   - If you pass a number like `{ 1: "one" }`, it is automatically converted into the string `"1"`.
   - If you want to use objects or functions as keys, use an ES6 **`Map`**.

2. **What is the difference between `Object.freeze()` and `const`?**
   - `const` prevents **reassigning the variable** to a new object.
   - `Object.freeze()` prevents **modifying the properties inside** the object.
