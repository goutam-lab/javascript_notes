# The JavaScript Call Stack & Stack Overflow

JavaScript is single-threaded: it can only do **one thing at a time**.

How does the engine keep track of which function is running, which function called it, and where to return when it finishes?

It uses a data structure called the **Call Stack**.

---

## 1. What is the Call Stack?

> The **Call Stack** is a **LIFO (Last In, First Out)** stack that manages the lifecycle of Execution Contexts during program execution.

- When a script starts, the **Global Execution Context (GEC)** is pushed to the bottom of the stack.
- When a function is called, its **Function Execution Context** is pushed onto the top of the stack.
- When that function returns or finishes, it is popped off the top of the stack.
- The engine always executes whatever function is currently sitting at the **very top** of the stack.

---

## 2. Visualizing Stack Frames

Look at this nested code:

```javascript
function first() {
    console.log("Entering first");
    second();
    console.log("Exiting first");
}

function second() {
    console.log("Entering second");
    third();
    console.log("Exiting second");
}

function third() {
    console.log("Inside third!");
}

first();
```

### Watching the Call Stack in Action:

```
Step 1: Script starts
|                     |
|                     |
| Global Context (GEC)|
+---------------------+

Step 2: first() called
|                     |
| first() Context     |
| Global Context (GEC)|
+---------------------+

Step 3: second() called
| second() Context    |
| first() Context     |
| Global Context (GEC)|
+---------------------+

Step 4: third() called (Peak Stack!)
| third() Context     | <--- Currently Running!
| second() Context    |
| first() Context     |
| Global Context (GEC)|
+---------------------+

Step 5: third() finishes and pops off
| second() Context    | <--- Resumes!
| first() Context     |
| Global Context (GEC)|
+---------------------+

Step 6: second() finishes, then first() finishes, and finally GEC pops off when script ends.
```

---

## 3. What is Stack Overflow?

The Call Stack has a limited size in memory (typically around 10,000 frames in V8/Node.js).

If functions keep calling each other without ever returning, the stack runs out of memory and crashes with:

```
RangeError: Maximum call stack size exceeded
```

This is called **Stack Overflow**.

### The Classic Infinite Recursion Bug:

```javascript
function infinite() {
    infinite(); // Calls itself endlessly with no base case!
}

infinite();
```

**Output:**
```
RangeError: Maximum call stack size exceeded
```

---

## 💡 Think of it like this

Imagine a tall, narrow spring-loaded tube used to stack cafeteria trays.
- The kitchen places the first tray at the bottom (Global context).
- Every time a customer grabs food, they place a new tray on top (Function call).
- You can only ever take or wash the tray that is on the **very top** (LIFO).
- If the dishwasher keeps piling trays on without anyone taking them, the tray stack hits the ceiling and crashes onto the floor (Stack Overflow)!

---

## 🎯 Interview Points

1. **What is a "Stack Trace"?**
   - When an uncaught error occurs, JavaScript prints the Call Stack history at that exact moment. Reading the stack trace from top to bottom reveals the exact line where the error happened and the chain of functions that called it.

2. **Can asynchronous callbacks block the Call Stack?**
   - The Call Stack only runs synchronous code. Long-running synchronous calculations (like a massive loop of 10 billion items) will "freeze" the stack, locking up the browser UI until it finishes.
