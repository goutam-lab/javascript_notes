# Prototypes & The Prototype Chain

JavaScript does not have traditional class-based inheritance like Java or C++.

Instead, JavaScript uses **Prototypal Inheritance**.

Even the modern ES6 `class` syntax is just syntactic sugar over prototypes!

---

## 1. What is a Prototype?

In simple English:

> A **prototype** is a working backup object. Whenever you ask an object for a property or method that it doesn't have itself, JavaScript automatically looks inside its **prototype** to find it.

Every object in JavaScript has an internal link to a prototype object.

---

## 2. Why does `[1, 2].push(3)` work?

Have you ever wondered where `.push()`, `.slice()`, or `.map()` come from?

You never defined them on your array `[1, 2]`.

They live on **`Array.prototype`**!

```javascript
const arr = [1, 2];

// arr does NOT have its own push method:
console.log(Object.hasOwn(arr, "push")); // false

// It inherited it from Array.prototype!
console.log(arr.__proto__ === Array.prototype); // true
```

---

## 3. The Prototype Chain

If JavaScript doesn't find a property on the object, it climbs up the **Prototype Chain** step-by-step until it reaches the very top: **`null`**.

```
myArray ([1, 2])
     │  __proto__
     ▼
Array.prototype (.push, .map, .filter)
     │  __proto__
     ▼
Object.prototype (.hasOwnProperty, .toString)
     │  __proto__
     ▼
   null (End of the line!)
```

If it reaches `null` without finding the property, it returns `undefined`.

---

## 4. `prototype` vs `__proto__` (Huge Interview Question!)

This confuses almost every beginner. Let's make it crystal clear:

- **`prototype`**: A property that exists **only on functions / constructors**. It is the blueprint blueprint that will be attached to future instances.
- **`__proto__`** (or `Object.getPrototypeOf(obj)`): A property that exists on **every object instance**. It points to the prototype it was born from.

```javascript
function Person(name) {
    this.name = name;
}

// Attach a method to the blueprint:
Person.prototype.sayHi = function() {
    console.log(`Hi, I am ${this.name}`);
};

const user = new Person("Aman");

// user's __proto__ points directly to Person.prototype:
console.log(user.__proto__ === Person.prototype); // true
user.sayHi();
```

**Output:**
```
true
Hi, I am Aman
```

---

## 5. Why do we put methods on `prototype` instead of inside constructor?

Look at these two approaches:

```javascript
// ❌ INEFFICIENT: Creates a duplicate function in memory for every user!
function BadUser(name) {
    this.name = name;
    this.login = function() { console.log("Logged in"); };
}

// ✅ EFFICIENT: Only ONE copy of login exists in memory, shared by all 10,000 users!
function GoodUser(name) {
    this.name = name;
}
GoodUser.prototype.login = function() { console.log("Logged in"); };
```

Putting methods on the `prototype` saves massive amounts of memory.

---

## 💡 Think of it like this

- Putting methods inside the constructor is like buying a separate lawnmower for every single house in a neighborhood. 100 houses = 100 lawnmowers.
- Putting methods on the `prototype` is like having one shared neighborhood clubhouse with a single lawnmower. Any resident can borrow it whenever they need to mow their lawn!

---

## ⚠️ Common Mistakes

### Monkey Patching Built-In Prototypes
Never add custom methods to built-in prototypes like `Array.prototype` in production apps:

```javascript
// ❌ DANGEROUS: Might collide with future JavaScript versions or third-party libraries!
Array.prototype.last = function() {
    return this[this.length - 1];
};
```

---

## 🎯 Interview Points

1. **How do you create an object that has NO prototype?**
   - Use `Object.create(null)`.
   - This creates a completely pure, dictionary-like object that doesn't even have `.toString` or `hasOwnProperty`.

2. **What does the `new` keyword do under the hood?**
   - Step 1: Creates a new empty object `{}`.
   - Step 2: Sets the new object's `__proto__` to the constructor function's `.prototype`.
   - Step 3: Binds `this` to the new object and executes the constructor code.
   - Step 4: Automatically returns the new object.
