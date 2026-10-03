# Conditions & Control Flow

Conditions let your code make decisions based on different situations.

In JavaScript, we use `if/else`, ternary operators, and `switch` statements.

---

## 1. The `if`, `else if`, and `else`

This is your standard decision maker.

```javascript
let marks = 85;

if (marks >= 90) {
    console.log("Grade A+");
} else if (marks >= 80) {
    console.log("Grade A");
} else {
    console.log("Keep working hard!");
}
```

**Output:**
```
Grade A
```

---

## 2. Ternary Operator (`? :`)

A clean, one-line shortcut for simple `if/else` statements.

### Syntax
```javascript
condition ? doIfTrue : doIfFalse
```

### Example
```javascript
let age = 20;
let canDrive = age >= 18 ? "Yes, can drive" : "No, too young";

console.log(canDrive);
```

**Output:**
```
Yes, can drive
```

> **Pro Tip:** Keep ternaries short. Never nest 3 or 4 ternaries together—it becomes impossible to read.

---

## 3. The `switch` Statement

When you are comparing **one single variable** against multiple possible values, `switch` is often cleaner than a long list of `else if` blocks.

```javascript
let dayNumber = 3;

switch (dayNumber) {
    case 1:
        console.log("Monday");
        break;
    case 2:
        console.log("Tuesday");
        break;
    case 3:
        console.log("Wednesday");
        break;
    default:
        console.log("Invalid day");
}
```

**Output:**
```
Wednesday
```

---

## 4. The `switch` Fall-Through Rule

If you forget the `break` statement inside a case, JavaScript will keep running the code inside the next cases **even if their conditions do not match**!

### Example

```javascript
let fruit = "Apple";

switch (fruit) {
    case "Apple":
        console.log("It's an apple");
    case "Banana":
        console.log("It's a banana");
        break;
    default:
        console.log("Unknown fruit");
}
```

**Output:**
```
It's an apple
It's a banana
```

Because `Apple` didn't have a `break`, execution fell right into `Banana`.

---

## 💡 Think of it like this

A `switch` statement is like an elevator.
- The `case` tells the elevator which floor to open its doors on.
- The `break` tells the elevator to stop and let you out.
- If there is no `break`, the elevator keeps dropping through all lower floors!

---

## 5. Senior Dev Tip: The Object Lookup Pattern

In real engineering interviews and production code, developers often replace long `switch` statements with an **Object Lookup Table**.

It is faster ($O(1)$ lookup) and much cleaner:

```javascript
// Instead of a 10-line switch:
const roleColors = {
    admin: "red",
    editor: "blue",
    viewer: "gray"
};

function getBadgeColor(role) {
    return roleColors[role] ?? "gray";
}

console.log(getBadgeColor("admin"));
console.log(getBadgeColor("guest"));
```

**Output:**
```
red
gray
```

---

## ⚠️ Common Mistakes

### Mistake: Assuming `switch` uses loose equality

```javascript
let id = "5"; // string

switch (id) {
    case 5: // number
        console.log("Found number 5!");
        break;
    default:
        console.log("Not found");
}
```

**Output:**
```
Not found
```

**Why?** `switch` uses strict equality (`===`). It does not convert `"5"` to `5`.

---

## 🎯 Interview Points

1. **Does `switch` convert types?**
   - No. `switch` evaluates using strict equality (`===`).
2. **What is a fall-through in a `switch` statement?**
   - It occurs when a `case` block lacks a `break` or `return`, causing JavaScript to execute the next case automatically.
