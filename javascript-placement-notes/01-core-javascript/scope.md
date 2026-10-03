# Scope & The Scope Chain

Scope determines where your variables can be seen and used in your code.

If a variable is outside of scope, JavaScript cannot find it and throws a `ReferenceError: variable is not defined`.

---

## 1. The 3 Types of Scope

### 1. Global Scope
Variables declared outside any function or block `{}`.

They can be accessed from anywhere in your entire file.

```javascript
let appName = "PlacementTracker";

function showApp() {
    console.log(appName); // Accessible!
}

showApp();
```

---

### 2. Function Scope
Variables declared inside a function are accessible **only inside that function**.

Both `var`, `let`, and `const` obey function scope.

```javascript
function login() {
    let secretToken = "xyz123";
}

login();
console.log(secretToken); // Error!
```

**Output:**
```
ReferenceError: secretToken is not defined
```

---

### 3. Block Scope
A block is simply anything between curly braces: `{ ... }` (like in an `if` statement or `for` loop).

`let` and `const` are **block-scoped**. `var` is NOT.

```javascript
if (true) {
    let blockVar = "I am safe inside";
    var leakyVar = "I leak out";
}

console.log(leakyVar); // Prints: "I leak out"
console.log(blockVar); // ReferenceError!
```

---

## 2. What is the Scope Chain?

When JavaScript tries to read a variable inside a function:
1. It first looks inside its **own local scope**.
2. If it doesn't find it, it looks at the **parent (outer) scope**.
3. It keeps climbing up parent by parent until it reaches the **Global Scope**.
4. If it reaches the top and still cannot find it, it throws `ReferenceError`.

This climb from bottom to top is called the **Scope Chain**.

### Example

```javascript
let globalName = "Earth";

function galaxy() {
    let galaxyName = "Milky Way";

    function solarSystem() {
        let planet = "Mars";

        // Can access: planet (local) + galaxyName (parent) + globalName (global)
        console.log(planet, "in", galaxyName, "near", globalName);
    }

    solarSystem();
}

galaxy();
```

**Output:**
```
Mars in Milky Way near Earth
```

---

## 💡 Think of it like this

Imagine a house with multiple rooms:
- Looking outward: You are sitting inside your bedroom. You can look through the window and see the living room, and through the front door to see the street outside.
- Looking inward: Someone standing on the street outside cannot look inside your private bedroom drawer!

---

## 3. Variable Shadowing

If you declare a variable inside an inner scope with the **same name** as a variable in an outer scope, the inner one "shadows" (hides) the outer one.

```javascript
let city = "Mumbai";

function showCity() {
    let city = "Delhi"; // Shadows the outer 'city'
    console.log("Inside:", city);
}

showCity();
console.log("Outside:", city);
```

**Output:**
```
Inside: Delhi
Outside: Mumbai
```

---

## 4. Illegal Shadowing (Top Placement Trap!)

You can shadow a `var` with `let`.

**BUT you CANNOT shadow a `let` with `var` inside a block!**

```javascript
let a = 10;

{
    var a = 20; // ❌ SYNTAX ERROR!
}
```

**Output:**
```
SyntaxError: Identifier 'a' has already been declared
```

**Why does this happen?**
Because `var` ignores blocks! It tries to expand into the outer scope, where `let a` is already declared in the same space. That causes an illegal clash.

---

## 🎯 Interview Points

1. **What is Lexical Scope?**
   - JavaScript uses lexical scoping. "Lexical" means where code is physically written.
   - A function resolves variables based on where it was **defined**, not where it was called.

2. **Can an inner block access outer variables?**
   - Yes, through the Scope Chain.

3. **Can an outer scope access variables declared inside a child block?**
   - No. Outer scopes have zero visibility into child blocks.
