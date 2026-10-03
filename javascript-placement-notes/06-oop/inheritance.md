# Class Inheritance & OOP Principles

Inheritance lets a new class adopt methods and properties from an existing parent class.

This promotes code reusability and clean architecture.

---

## 1. The `extends` and `super` Keywords

To inherit from a parent class, use `extends`.

Inside the child's constructor, you **must call `super()`** before you are allowed to use the `this` keyword!

```javascript
// Parent Class
class Animal {
    constructor(name) {
        this.name = name;
    }

    eat() {
        console.log(`${this.name} is eating.`);
    }

    makeSound() {
        console.log("Some generic animal sound...");
    }
}

// Child Class
class Dog extends Animal {
    constructor(name, breed) {
        // Calls the parent Animal constructor:
        super(name);
        this.breed = breed;
    }

    // Method Overriding (Polymorphism)
    makeSound() {
        console.log(`${this.name} barks: Woof! Woof!`);
    }

    fetchBall() {
        console.log(`${this.name} is fetching the tennis ball!`);
    }
}

const myDog = new Dog("Bruno", "Golden Retriever");

myDog.eat();        // Inherited from Animal
myDog.makeSound();  // Overridden in Dog
myDog.fetchBall();  // Unique to Dog
```

**Output:**
```
Bruno is eating.
Bruno barks: Woof! Woof!
Bruno is fetching the tennis ball!
```

---

## 2. Calling Parent Methods with `super.method()`

If a child class overrides a method but still wants to execute the parent's logic too, use `super.parentMethod()`:

```javascript
class SmartDog extends Dog {
    makeSound() {
        super.makeSound(); // Call Dog's bark
        console.log("...and wags its tail happily!");
    }
}

const buddy = new SmartDog("Buddy", "Labrador");
buddy.makeSound();
```

**Output:**
```
Buddy barks: Woof! Woof!
...and wags its tail happily!
```

---

## 3. The 4 Pillars of OOP in JavaScript

Placement interviewers frequently ask: *"How does JavaScript implement the 4 pillars of OOP?"*

1. **Encapsulation**: Bundling data and methods into a single unit (Class) and restricting direct outside access using private fields (`#balance`).
2. **Inheritance**: Creating child classes from parent classes via `extends` and prototype chaining.
3. **Polymorphism**: The ability of child classes to provide their own custom implementation of a method defined in a parent class (like `makeSound()` above).
4. **Abstraction**: Hiding complex internal logic and exposing simple public APIs (like calling `.startEngine()` without needing to know how spark plugs work).

---

## 💡 Think of it like this

- **Parent Class**: Like a smartphone operating system blueprint (handles battery, screen, Wi-Fi).
- **Child Class**: A specific model like the Pro Max. It extends the core OS, but adds a high-end camera lens and specialized buttons. It doesn't rewrite Wi-Fi from scratch; it inherits it!

---

## ⚠️ Common Mistakes

### Forgetting to call `super()` before accessing `this`

```javascript
class Child extends Animal {
    constructor(name, age) {
        // ❌ WRONG: Touching 'this' before super()
        // this.age = age; // ReferenceError: Must call super constructor in derived class before accessing 'this'!
        
        // ✅ CORRECT:
        super(name);
        this.age = age;
    }
}
```

---

## 🎯 Interview Points

1. **Does JavaScript support multiple inheritance (inheriting from two classes)?**
   - **No.** A class can only extend one single parent class (`extends A, B` is invalid).
   - If you need multiple features from different sources, use **Mixins** or **Object Composition**.

2. **What does `instanceof` check?**
   - `myDog instanceof Animal` returns `true` because `instanceof` walks up the prototype chain to see if `Animal.prototype` is anywhere in `myDog`'s lineage.
