# `call()`, `apply()`, and `bind()`

In JavaScript, every function is also an object. Because of that, functions have their own built-in methods: `call()`, `apply()`, and `bind()`.

These three methods allow you to **manually control what the `this` keyword points to**.

Let's understand how they work and the exact difference between them.

---

## 1. Quick Memory Trick

Before looking at code, memorize this simple mnemonic:

- **C** for **`call`** $\rightarrow$ Takes arguments as a **C**omma-separated list. Invokes immediately.
- **A** for **`apply`** $\rightarrow$ Takes arguments as an **A**rray. Invokes immediately.
- **B** for **`bind`** $\rightarrow$ **B**inds `this` and returns a new function to call **later**.

---

## 2. The `call()` Method

`call()` invokes the function immediately, setting its `this` to the object you pass as the first argument.

```javascript
function introduce(city, country) {
    console.log(`Hello, I am ${this.name} from ${city}, ${country}.`);
}

const user = { name: "Goutam" };

// Arguments passed one by one:
introduce.call(user, "Bengaluru", "India");
```

**Output:**
```
Hello, I am Goutam from Bengaluru, India.
```

---

## 3. The `apply()` Method

`apply()` does the exact same thing as `call()`, with only one difference:
It takes additional arguments as an **Array** (or array-like list).

```javascript
const user = { name: "Ananya" };

// Arguments passed as an Array:
introduce.apply(user, ["Mumbai", "India"]);
```

**Output:**
```
Hello, I am Ananya from Mumbai, India.
```

---

## 4. The `bind()` Method

Unlike `call` and `apply`, **`bind()` does NOT execute the function immediately**.

Instead, it makes a copy of the function with `this` permanently locked to the object, and **returns that new function** for you to execute whenever you want.

```javascript
const user = { name: "Rahul" };

// Returns a new bound function:
const introduceRahul = introduce.bind(user, "Delhi", "India");

// Execute it later:
introduceRahul();
```

**Output:**
```
Hello, I am Rahul from Delhi, India.
```

---

## 5. Practical Superpower: Method Borrowing

One of the coolest patterns in JavaScript is "borrowing" a method from one object to use on another:

```javascript
const person1 = {
    firstName: "Aman",
    lastName: "Gupta",
    getFullName() {
        return `${this.firstName} ${this.lastName}`;
    }
};

const person2 = {
    firstName: "Sneha",
    lastName: "Sharma"
    // person2 has no getFullName method!
};

// Borrow person1's method for person2:
console.log(person1.getFullName.call(person2));
```

**Output:**
```
Sneha Sharma
```

---

## 6. Legendary Placement Question: Writing a Polyfill for `bind()`

Top tech companies (Amazon, Microsoft, Uber) frequently ask candidates to build a custom `myBind` from scratch.

Here is the clean, interview-ready implementation using closures:

```javascript
Function.prototype.myBind = function(context, ...boundArgs) {
    // 'this' is the original function being bound
    const originalFunction = this;

    if (typeof originalFunction !== "function") {
        throw new TypeError("Must be called on a function");
    }

    return function(...laterArgs) {
        // Combine args passed during bind and args passed during call
        return originalFunction.apply(context, [...boundArgs, ...laterArgs]);
    };
};

// Testing our custom polyfill:
function printScore(subject, marks) {
    console.log(`${this.studentName} scored ${marks} in ${subject}`);
}

const studentObj = { studentName: "Rohan" };
const rohanMath = printScore.myBind(studentObj, "Math");

rohanMath(98);
```

**Output:**
```
Rohan scored 98 in Math
```

---

## 💡 Think of it like this

- `call`: Walking up to someone, handing them a microphone, and asking them to speak right now with questions typed out individually.
- `apply`: Handing them a microphone right now, but handing all the questions packed neatly in a single envelope (array).
- `bind`: Handing someone a script and scheduling them to speak on stage next week at your conference.

---

## 🎯 Interview Points

1. **Can you re-bind a function that has already been bound with `.bind()`?**
   - **No!** Once a function is bound via `.bind()`, its `this` is permanently hard-coded. Subsequent calls to `.bind()`, `.call()`, or `.apply()` will NOT change `this` again.

2. **Can `call` or `bind` override an Arrow function's `this`?**
   - **No.** Arrow functions inherit `this` lexically at creation. They ignore `call`, `apply`, and `bind`.
