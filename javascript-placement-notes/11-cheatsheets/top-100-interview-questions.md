# 💯 Top 100 JavaScript Interview Questions & Answers

Organized by topic, asked across Tier-1 product companies and campus placement rounds.

---

## 🟢 Category 1: Fundamentals (1–12)

1. **What is JavaScript?**  
   A single-threaded, non-blocking, asynchronous, concurrent programming language with a call stack, an event loop, and a callback queue.
2. **What are the 7 primitive types in JavaScript?**  
   String, Number, Boolean, Undefined, Null, BigInt, and Symbol.
3. **What is the difference between `null` and `undefined`?**  
   `undefined` means a variable has been declared but not yet assigned a value; `null` is an explicit assignment representing the intentional absence of any object value.
4. **Why does `typeof null` return `"object"`?**  
   It is a legacy bug from the original 1995 JavaScript implementation where the type tag for objects was `000` and `null` was represented as a NULL pointer (`0x00`).
5. **What is `NaN`, and how do you test for it?**  
   `NaN` represents an invalid numerical calculation. Because `NaN !== NaN`, test using `Number.isNaN(val)`.
6. **What is the difference between `==` and `===`?**  
   `==` performs type coercion before comparison; `===` checks both value and type without coercion.
7. **What are the 8 falsy values in JavaScript?**  
   `false`, `0`, `-0`, `0n`, `""`, `null`, `undefined`, and `NaN`.
8. **What is the output of `[] + []` vs `[] + {}`?**  
   `[] + []` evaluates to `""`; `[] + {}` evaluates to `"[object Object]"`.
9. **What does the unary `+` operator do?**  
   Converts its operand to a number (e.g., `+"42"` becomes `42`).
10. **What is the Nullish Coalescing Operator (`??`)?**  
    Returns the right-hand operand only when the left-hand operand is `null` or `undefined` (unlike `||`, which falls back on any falsy value like `0` or `""`).
11. **What is strict mode (`"use strict"`)?**  
    Enforces cleaner code by eliminating silent errors, preventing accidental global variables, and changing `this` in standalone functions to `undefined`.
12. **Why is `0.1 + 0.2 !== 0.3`?**  
    Binary floating-point arithmetic (IEEE 754) cannot represent fractional powers of 10 exactly, producing `0.30000000000000004`.

---

## ⚡ Category 2: Variables & Hoisting (13–24)

13. **What is the difference between `var`, `let`, and `const`?**  
    `var` is function-scoped and hoisted with `undefined`; `let` and `const` are block-scoped and hoisted into the Temporal Dead Zone (TDZ). `const` prevents variable reassignment.
14. **What is the Temporal Dead Zone (TDZ)?**  
    The time period between entering a block scope and the line where a `let` or `const` is declared. Accessing the variable inside this window throws a `ReferenceError`.
15. **Are `let` and `const` hoisted?**  
    Yes, their identifiers are registered in memory during the compilation phase, but they remain uninitialized in the TDZ.
16. **What is Variable Shadowing?**  
    When an inner-scope variable shares the same identifier as an outer-scope variable, masking the outer one.
17. **What is Illegal Shadowing?**  
    Attempting to shadow a block-scoped `let` with a function-scoped `var` inside a block, which throws a `SyntaxError`.
18. **Can you modify properties of a `const` object?**  
    Yes. `const` protects the memory reference, not the interior properties. To freeze properties, use `Object.freeze()`.
19. **What is the Execution Context?**  
    The abstract environment where JavaScript evaluates code, consisting of a Memory Creation Phase and a Code Execution Phase.
20. **What is the Call Stack?**  
    A LIFO (Last In, First Out) stack that tracks function calls and their execution contexts.
21. **What causes a Stack Overflow?**  
    Excessive nested function calls (like unbounded recursion) exceeding the maximum memory limit of the Call Stack.
22. **What is hoisting precedence between functions and variables?**  
    Function declarations are hoisted before variable declarations in the memory phase.
23. **Are ES6 classes hoisted?**  
    Yes, but they remain in the Temporal Dead Zone until initialized.
24. **Does `var` attach to `window`?**  
    Yes, in a browser environment, global `var` declarations attach to `window.varName`.

---

## 🧠 Category 3: Functions & Closures (25–38)

25. **What is a Closure?**  
    A function bundled with references to its surrounding lexical environment, allowing it to access outer variables even after the outer function has returned.
26. **What is an IIFE?**  
    An Immediately Invoked Function Expression `(function(){})()` that executes immediately after definition to create a private scope.
27. **What is a Higher-Order Function (HOF)?**  
    A function that accepts another function as an argument, returns a function, or both (e.g., `map`, `filter`).
28. **What are First-Class Functions?**  
    Functions that can be assigned to variables, passed as arguments, and returned from other functions.
29. **What is Currying?**  
    Transforming a function with multiple arguments into a chain of functions that each take a single argument: `f(a, b) -> f(a)(b)`.
30. **What is a Pure Function?**  
    A function that always produces the exact same output for the same inputs and causes zero side effects.
31. **What is the difference between Arrow Functions and Regular Functions?**  
    Arrow functions have lexical `this`, lack an `arguments` object, and cannot be used as constructors with `new`.
32. **Can you change the `this` of an arrow function using `bind()`?**  
    No. Arrow functions establish `this` statically at author-time and ignore `call`, `apply`, and `bind`.
33. **What is the `arguments` object?**  
    An array-like object available in regular functions containing all arguments passed in.
34. **Why is the Rest operator (`...args`) preferred over `arguments`?**  
    Rest parameters produce a true JavaScript Array instance and work seamlessly inside arrow functions.
35. **Explain the loop + `setTimeout` closure problem with `var`.**  
    `var` is function-scoped, so all iterations share one single variable `i`. By the time callbacks run, `i` has reached its final value. Fix by using block-scoped `let`.
36. **Can closures lead to memory leaks?**  
    Yes, if an unused closure retains references to large memory structures inside long-lived event listeners.
37. **What is Function Composition?**  
    Combining two or more functions to produce a new function: `compose(f, g)(x) === f(g(x))`.
38. **What is Partial Application?**  
    Fixing a subset of a function's arguments to produce a new function of smaller arity.

---

## 🎯 Category 4: The `this` Keyword & Binding (39–48)

39. **What is `this` in JavaScript?**  
    A keyword referring to the execution context object currently invoking the function.
40. **What are the 4 binding rules of `this`?**  
    1. Default Binding (`window` or `undefined`)  
    2. Implicit Binding (`obj.method()`)  
    3. Explicit Binding (`call`, `apply`, `bind`)  
    4. `new` Binding (Constructor instances)
41. **What is the difference between `call()` and `apply()`?**  
    `call()` accepts arguments as a comma-separated list; `apply()` accepts arguments as an Array.
42. **What does `bind()` do?**  
    Returns a brand new copy of the function with `this` permanently set to the provided context.
43. **Can you re-bind a function that was already bound with `bind()`?**  
    No. Subsequent calls to `bind()`, `call()`, or `apply()` will not change `this`.
44. **What does `new` do internally?**  
    Creates a new empty object, links its `__proto__` to the constructor's `prototype`, binds `this`, and returns the object.
45. **What happens if a constructor returns an explicit object?**  
    The `new` expression will return that explicit object instead of the newly created `this` instance.
46. **What is Method Borrowing?**  
    Invoking a method from one object on another object using `fn.call(targetObj)`.
47. **Why does detaching a method (`const fn = obj.method; fn()`) lose `this`?**  
    Because calling `fn()` has no preceding dot, falling back to Default Binding (`window` or `undefined`).
48. **What is `this` inside an event listener?**  
    In regular functions, `this` refers to the DOM element holding the listener (`e.currentTarget`).

---

## 📦 Category 5: Arrays & Objects (49–62)

49. **What is the difference between `slice()` and `splice()`?**  
    `slice()` is non-mutating (returns a shallow copy of a portion); `splice()` mutates the original array in-place by removing or inserting items.
50. **What does `map()` return?**  
    A brand new array of the same length containing the transformed items.
51. **What is the difference between `find()` and `filter()`?**  
    `find()` returns the first matching element and stops searching; `filter()` checks the entire array and returns an array of all matches.
52. **How does `reduce()` work?**  
    Iterates through an array, accumulating values into a single return value via a reducer callback and an initial value.
53. **Why does `[10, 5, 20].sort()` not sort numbers properly?**  
    `.sort()` converts elements to strings and compares UTF-16 code units alphabetically. Pass `(a, b) => a - b`.
54. **What is `Object.freeze()` vs `Object.seal()`?**  
    `freeze()` prevents all additions, deletions, and value modifications; `seal()` prevents additions and deletions but allows updating existing writable properties.
55. **Are `Object.freeze()` and spread `{ ...obj }` deep or shallow?**  
    Both are **shallow**. Nested objects remain completely mutable and shared by reference.
56. **How do you deep clone an object natively?**  
    Using `structuredClone(obj)`.
57. **What is the difference between `for...in` and `for...of`?**  
    `for...in` iterates over enumerable property keys (including prototype properties); `for...of` iterates over values of an iterable collection.
58. **How do you check if an object has its own property?**  
    Use `Object.hasOwn(obj, prop)` (ES2022).
59. **What is Array Destructuring vs Object Destructuring?**  
    Array destructuring unpacks values by index position; object destructuring unpacks values matching key names.
60. **What is the difference between Spread and Rest?**  
    Spread expands collections into individual items; Rest gathers individual arguments into an array.
61. **What is Optional Chaining (`?.`)?**  
    Safely reads nested properties without throwing a `TypeError` if a parent is `null` or `undefined`.
62. **What is a sparse array?**  
    An array containing unallocated empty slots ("holes"), which downgrades V8 optimization.

---

## ⏳ Category 6: Asynchronous JavaScript (63–76)

63. **What is the Event Loop?**  
    A continuous mechanism that monitors the Call Stack and transfers callbacks from the Microtask and Macrotask queues to the stack when it is empty.
64. **What is the difference between Microtasks and Macrotasks?**  
    Microtasks (`Promise.then`, `queueMicrotask`) have higher priority and drain completely before any Macrotask (`setTimeout`, `setInterval`) is executed.
65. **What are the 3 states of a Promise?**  
    `pending`, `fulfilled`, and `rejected`.
66. **What is Promise Chaining?**  
    Returning a promise or value from a `.then()` callback to allow sequential `.then()` invocations.
67. **What is `Promise.all()`?**  
    Waits for all promises to fulfill. Rejects immediately if any single promise rejects (Fail-Fast).
68. **What is `Promise.allSettled()`?**  
    Waits for all promises to settle regardless of outcome. Never rejects.
69. **What is `Promise.race()`?**  
    Settles as soon as the first promise settles (either fulfilled or rejected).
70. **What is `Promise.any()`?**  
    Fulfills as soon as the first promise fulfills. Rejects only if all promises reject (`AggregateError`).
71. **What does the `async` keyword do?**  
    Ensures that a function always returns a Promise.
72. **What does the `await` keyword do?**  
    Pauses execution of the `async` function until the promise settles, without blocking the main Call Stack.
73. **Why does `fetch()` not reject on 404 HTTP errors?**  
    `fetch()` only rejects on network failures (like being offline). A 404 is a valid HTTP response (`response.ok = false`).
74. **How do you abort a fetch request?**  
    Using an `AbortController` instance and passing its `signal` to `fetch()`.
75. **What is Callback Hell?**  
    Deeply nested callback functions creating an unreadable pyramid of code (`>`).
76. **Why shouldn't you use `await` inside a `forEach` loop?**  
    `forEach` does not await promises; use a standard `for...of` loop instead.

---

## 🌐 Category 7: DOM & Browser APIs (77–88)

77. **What is the DOM?**  
    Document Object Model: a tree of objects representing HTML tags in memory.
78. **What is Event Bubbling?**  
    When an event fires on a target element and bubbles upwards through its ancestor tree to `window`.
79. **What is Event Capturing (Trickling)?**  
    When an event travels down from `window` to the target element before bubbling begins.
80. **What is Event Delegation?**  
    Attaching a single event listener to a parent element to handle events for all existing and future child elements via bubbling.
81. **What is the difference between `e.target` and `e.currentTarget`?**  
    `e.target` is the exact element clicked; `e.currentTarget` is the element to which the event listener is attached.
82. **What does `e.preventDefault()` do?**  
    Cancels the browser's default behavior for that event (such as preventing form submit page reload).
83. **What is the difference between `e.stopPropagation()` and `e.stopImmediatePropagation()`?**  
    `stopPropagation()` stops bubbling to parent elements; `stopImmediatePropagation()` also prevents other listeners on the exact same element from running.
84. **What is the difference between `textContent` and `innerHTML`?**  
    `textContent` renders raw text and protects against XSS; `innerHTML` parses HTML tags and exposes script injection vulnerabilities.
85. **What is the difference between `localStorage` and `sessionStorage`?**  
    `localStorage` persists indefinitely; `sessionStorage` clears when the browser tab is closed.
86. **What is an `HttpOnly` cookie?**  
    A cookie that cannot be accessed by client-side JavaScript (`document.cookie`), preventing XSS credential theft.
87. **What is DOM Reflow vs Repaint?**  
    Reflow recalculates page geometry and layout ($O(\text{expensive})$); Repaint updates pixel appearance (color, background) without changing layout.
88. **What is `requestAnimationFrame`?**  
    Schedules a callback to run right before the next browser repaint (~60fps).

---

## 🏛️ Category 8: OOP & Prototypes (89–95)

89. **What is Prototypal Inheritance?**  
    Objects inheriting properties and methods directly from other objects via a prototype link.
90. **What is `__proto__` vs `prototype`?**  
    `prototype` is a property on constructor functions used to build instances; `__proto__` is the internal link on instances pointing to their prototype.
91. **What is the end of the Prototype Chain?**  
    `Object.prototype.__proto__`, which is `null`.
92. **What does `super()` do in ES6 classes?**  
    Calls the constructor of the parent class. Mandatory before accessing `this` in child constructors.
93. **How do you define private fields in ES6 classes?**  
    Prefix the field name with `#` (e.g., `#privateField`).
94. **What are static methods in ES6 classes?**  
    Methods defined on the class itself, called directly on the class rather than on instances.
95. **Does JavaScript support multiple inheritance?**  
    No. A class can extend only one single parent class.

---

## 🚀 Category 9: Advanced Concepts & DSA (96–100)

96. **What is Debouncing?**  
    Ensures a function runs only after a specified period of inactivity since the last event trigger (e.g., search autocomplete).
97. **What is Throttling?**  
    Limits function execution to at most once per fixed time interval during continuous events (e.g., window scrolling).
98. **What is Memoization?**  
    An optimization technique that caches the return values of pure functions based on their input parameters.
99. **How do you detect a cycle in a Linked List?**  
    Floyd’s Tortoise and Hare algorithm: use slow (1 step) and fast (2 step) pointers; if they collide, a cycle exists.
100. **What is Kadane’s Algorithm?**  
     An $O(N)$ dynamic programming technique to find the maximum sum of a contiguous subarray in an array.
