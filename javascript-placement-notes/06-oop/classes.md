# ES6 Classes & Object-Oriented JavaScript

In ES6 (2015), JavaScript introduced the `class` keyword.

It makes JavaScript look and feel like classical OOP languages (Java, C++, Python), while keeping the underlying prototypal engine intact.

---

## 1. Basic Class Syntax

```javascript
class User {
    // Constructor runs automatically when 'new User()' is called
    constructor(name, email) {
        this.name = name;
        this.email = email;
    }

    // Instance method (automatically placed on User.prototype!)
    greet() {
        return `Hello, I am ${this.name}`;
    }
}

const user1 = new User("Goutam", "goutam@example.com");
console.log(user1.greet());
```

**Output:**
```
Hello, I am Goutam
```

---

## 2. Static Methods and Properties

A **static** method or property belongs to the **Class itself**, not to any individual instance created from it.

You call them directly on the Class name without using `new`.

```javascript
class MathUtils {
    static PI = 3.14159;

    static square(x) {
        return x * x;
    }
}

console.log(MathUtils.PI);
console.log(MathUtils.square(6));

// ❌ Instances do NOT have static methods:
// const u = new MathUtils();
// u.square(6); // TypeError: u.square is not a function
```

**Output:**
```
3.14159
36
```

Think of `Math.max()` or `Array.isArray()`—those are built-in static methods!

---

## 3. Getters and Setters (`get` and `set`)

Getters and Setters allow you to execute code when someone reads or writes to a property, while making it look like a regular property on the outside.

```javascript
class Temperature {
    constructor(celsius) {
        this.celsius = celsius;
    }

    // Getter
    get fahrenheit() {
        return (this.celsius * 9) / 5 + 32;
    }

    // Setter
    set fahrenheit(f) {
        this.celsius = ((f - 32) * 5) / 9;
    }
}

const temp = new Temperature(25);
console.log("In Fahrenheit:", temp.fahrenheit); // Accessed without ()!

temp.fahrenheit = 86; // Triggers setter!
console.log("In Celsius:", temp.celsius);
```

**Output:**
```
In Fahrenheit: 77
In Celsius: 30
```

---

## 4. True Private Class Fields (`#`) (ES2022)

Before ES2022, JavaScript had no real private fields. Developers used an underscore like `_balance` as an informal convention.

Now, prefixing a variable with **`#`** creates a true, compiler-enforced **Private Field**:

```javascript
class BankAccount {
    #balance = 0; // Truly private!

    constructor(initialDeposit) {
        this.#balance = initialDeposit;
    }

    deposit(amount) {
        this.#balance += amount;
    }

    getBalance() {
        return `Current Balance: $${this.#balance}`;
    }
}

const account = new BankAccount(100);
account.deposit(50);
console.log(account.getBalance());

// ❌ SyntaxError: Private field '#balance' must be declared in an enclosing class
// console.log(account.#balance);
```

**Output:**
```
Current Balance: $150
```

---

## 💡 Think of it like this

- A **Class** is like an architectural blueprint for a house.
- `new User()` is the physical construction of a house using that blueprint.
- A **Static Method** is like the architect's office telephone. You call the architect directly, not each individual house!
- A **Private Field (`#`)** is like a high-security safe inside the master bedroom. Nobody from outside the house can see or touch it.

---

## 🎯 Interview Points

1. **Are ES6 classes hoisted?**
   - Yes, they are hoisted, but remain in the **Temporal Dead Zone (TDZ)**. You cannot use a class before declaring it.

2. **Do ES6 classes run in strict mode?**
   - Yes! The entire body of an ES6 class runs automatically in **strict mode** (`"use strict"`), even if you didn't write the string.
