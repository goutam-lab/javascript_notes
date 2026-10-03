# Hoisting Deep Dive: V8 Engine & Bytecode

Let's look under the hood at how modern engines like Google V8 actually handle hoisting at the compiler level.

---

## 1. What Happens at the Bytecode Level?

When V8 compiles your JavaScript, it generates two things for every scope:
1. **Bytecode instructions** to run.
2. A **Scope / Lexical Environment Record** with fixed slots for all variables.

```
Compilation creates Scope Table:
+---------------+-------------------+----------------------------+
| Identifier    | Keyword           | Initial State in Slot      |
+---------------+-------------------+----------------------------+
| username      | var               | undefined                  |
| calculateSum  | function          | Points to function object  |
| userAge       | let               | <Uninitialized> (TDZ flag) |
| API_KEY       | const             | <Uninitialized> (TDZ flag) |
+---------------+-------------------+----------------------------+
```

When bytecode runs:
- Reading a `var` slot returns `undefined`.
- Reading an `<Uninitialized>` slot causes the CPU to trap into a V8 runtime exception $\rightarrow$ **`ReferenceError`**.

---

## 2. Hoisting Precedence: Functions Always Beat Variables

What happens if a `var` and a `function` share the exact same name?

```javascript
console.log(typeof greeting);

var greeting = "Hello World";

function greeting() {
    return "Hi from function";
}

console.log(typeof greeting);
```

### The Output:
```
function
string
```

### Why?
1. In the Memory Phase, `function greeting` is registered first.
2. When the engine encounters `var greeting`, it checks its scope table and sees an entry for `greeting` already exists. It ignores the redundant declaration!
3. So before execution starts, `greeting` is a **function**.
4. During the Execution Phase, line 3 runs: `greeting = "Hello World"`. The string overwrites the function!
5. Now `greeting` is a **string**.

---

## 3. Are ES6 Classes Hoisted?

This is a classic senior-level interview question:

> **Answer:** Like `let` and `const`, **ES6 classes are hoisted, but remain in the Temporal Dead Zone (TDZ)**!

```javascript
// ❌ ReferenceError: Cannot access 'Car' before initialization
const myCar = new Car("BMW");

class Car {
    constructor(brand) {
        this.brand = brand;
    }
}
```

Unlike function declarations, you **cannot** instantiate a class before its declaration line.

---

## 4. Tricky Output Question: TDZ Inside Default Parameters

```javascript
let x = 1;

function test(a = x, x = 2) {
    console.log(a);
}

test();
```

**Output:**
```
ReferenceError: Cannot access 'x' before initialization
```

### Why?
Parameters evaluate from left to right in their own scope.
When `a = x` is evaluated, the parameter `x` is declared on the right, meaning `x` is currently inside its **own parameter TDZ**! It does not fall back to the outer `let x = 1`.

---

## 🎯 Interview Points

1. **Why was the Temporal Dead Zone added to JavaScript in ES6?**
   - In ES5, accessing variables before declaration silently returned `undefined`, creating subtle, hard-to-detect bugs. TDZ was deliberately designed to fail loudly with a `ReferenceError` so developers fix their code order immediately.

2. **Is `import` hoisted in ES Modules?**
   - Yes! All ES Module `import` statements are hoisted to the very top of the file and evaluated before any other code runs.
