# 📊 JavaScript Placement Progress Tracker

Keep track of your interview readiness. Every completed checkbox represents tested, revision-ready knowledge.

---

## 🟢 Phase 1: Core Fundamentals (Studied — Ready for Revision)
- [x] **Variables**: `var` vs `let` vs `const`, declaration vs initialization, reassignment
- [x] **Data Types**: Primitive (Number, String, Boolean, Undefined, Null, Symbol, BigInt) vs Non-Primitive, `typeof` operator and quirks (`typeof null === 'object'`)
- [x] **Operators**: Arithmetic, Assignment, Logical (`&&`, `||`, `??`), Comparison (`==` vs `===`), Type Coercion
- [x] **Conditions**: `if`, `else`, `else if`, ternary operator, `switch` statement (strict equality checks)
- [x] **Loops**: `for`, `while`, `do...while`, `for...of`, `for...in`, loop time complexity, `break` & `continue`
- [x] **Arrays Fundamentals**: Indexing, mutative methods (`push`, `pop`, `shift`, `unshift`, `splice`), non-mutative (`slice`, `concat`), search (`indexOf`, `includes`)
- [x] **Functions**: Function declaration vs Expression vs Arrow functions, arguments vs parameters, default parameters, `console.log` vs `return`
- [x] **Scope**: Global, Function/Local, Block scope, Scope Chain, Shadowing & Illegal Shadowing
- [x] **Hoisting**: Variable hoisting (`var` initialized to `undefined`), `let`/`const` in Temporal Dead Zone (TDZ), Function Declaration vs Function Expression hoisting
- [x] **Closures**: Lexical scope retention, closure definition, state encapsulation, counter pattern, closure in loops (`var` vs `let` bug)
- [x] **Callbacks & Higher-Order Functions (HOFs)**: First-class functions, passing callbacks, `forEach`, `map`, `filter`, `reduce`, function factories

---

## 🚀 Phase 2: Arrays & Objects Deep Dive (Next Priority)
- [ ] **Arrays Deep Dive**: Internal memory layout in V8 (packed vs holey), time complexity of methods
- [ ] **Advanced Array Methods**: `map()`, `filter()`, `reduce()`, `find()`, `findIndex()`, `some()`, `every()`, `flat()`, `flatMap()`
- [ ] **Objects Deep Dive**: Object literals, dynamic keys, object references, Object methods (`Object.keys()`, `values()`, `entries()`, `fromEntries()`, `freeze()`, `seal()`)
- [ ] **Destructuring**: Array & Object destructuring, default values, renaming variables, nested destructuring
- [ ] **Spread vs Rest Operator**: Rest parameters in functions vs spread in array/object copies, shallow copy mechanics

---

## ⚡ Phase 3: Functions & `this` Mechanics
- [ ] **The `this` Keyword**: Default binding, Implicit binding, Explicit binding, `new` binding, Arrow function lexical `this`
- [ ] **Explicit Binding Methods**: `call()`, `apply()`, `bind()`, writing polyfills for `bind`, `call`, `apply`
- [ ] **Advanced Function Patterns**: Pure functions, side effects, IIFE (Immediately Invoked Function Expressions), Currying, Function Composition

---

## ⚙️ Phase 4: JavaScript Engine & Execution Internals
- [ ] **Execution Context**: Creation phase (Memory allocation) vs Execution phase (Code execution)
- [ ] **Call Stack**: Stack frame lifecycle, Stack Overflow (`Maximum call stack size exceeded`), debugging call stacks
- [ ] **Event Loop & Concurrency Model**: Call Stack, Web APIs / C++ APIs, Callback Queue (Macrotask) vs Microtask Queue (`Promise`, `queueMicrotask`, `MutationObserver`)
- [ ] **Hoisting Deep Dive & V8 Internals**: Memory allocation phase, how TDZ is enforced at bytecode level

---

## ⏳ Phase 5: Asynchronous JavaScript
- [ ] **Async Foundations**: Sync vs Async, Timers (`setTimeout`, `setInterval`), non-guaranteed timer precision
- [ ] **Callback Hell & Inversion of Control**: Pyramids of doom, error handling limitations
- [ ] **Promises Masterclass**: Promise states (pending, fulfilled, rejected), `.then()`, `.catch()`, `.finally()`, chaining, writing custom Promise polyfill
- [ ] **Promise Combinators**: `Promise.all()`, `Promise.allSettled()`, `Promise.race()`, `Promise.any()`
- [ ] **Async / Await**: Syntactic sugar over generators/promises, error handling with `try...catch`, sequential vs parallel execution
- [ ] **Fetch API & Network Operations**: HTTP requests, headers, response parsing (`.json()`, `.blob()`), aborting requests (`AbortController`)
- [ ] **REST APIs & HTTP Methods**: CRUD operations, GET/POST/PUT/PATCH/DELETE, status codes, headers, and request body serialization

---

## 🏛️ Phase 6: Object-Oriented JavaScript & Prototypes
- [ ] **Prototypes & `__proto__`**: Prototype object, prototype chain lookup, `Object.prototype`, `Function.prototype`
- [ ] **Constructor Functions & `new` Operator**: What the `new` keyword actually does step-by-step
- [ ] **ES6 Classes**: Syntax, `constructor`, instance methods, static methods, getters and setters
- [ ] **Inheritance & Polymorphism**: `extends`, `super()`, method overriding
- [ ] **Encapsulation**: Private class fields (`#field`), closures vs private fields

---

## 🌐 Phase 7: DOM & Browser Environment
- [ ] **DOM Fundamentals**: DOM tree hierarchy, Element vs Node, `querySelector`, `getElementById`
- [ ] **DOM Manipulation**: Creating (`createElement`), appending (`append`, `appendChild`), removing, classList manipulation
- [ ] **Dynamic DOM Manipulation**: Creating, inserting (`prepend`/`append`/`before`/`after`), attribute APIs, DocumentFragment optimization
- [ ] **Event Propagation**: Event Bubbling, Event Capturing (Trickling), `e.stopPropagation()`, `e.stopImmediatePropagation()`, `e.preventDefault()`
- [ ] **Event Delegation Deep Dive**: Handling dynamic elements, closest() vs matches(), nested child spans, guard clauses, shopping cart item deletion
- [ ] **Web Storage**: `localStorage` vs `sessionStorage` vs `Cookies` vs `IndexedDB`

---

## 🧠 Phase 8: Advanced JavaScript Techniques
- [ ] **Debouncing**: Implementation, search bar use case, polyfill
- [ ] **Throttling**: Implementation, scroll/resize use case, polyfill
- [ ] **Memoization**: Cache storage, pure function caching, polyfill
- [ ] **Generators & Iterators**: `function*`, `yield`, `next()`, `Symbol.iterator`
- [ ] **Modern Data Structures**: `Map`, `Set`, `WeakMap`, `WeakSet` (garbage collection friendliness)
- [ ] **Shallow vs Deep Copy**: `Object.assign`, spread operator, `JSON.parse(JSON.stringify())`, `structuredClone()`

---

## 🧩 Phase 9: JavaScript for Data Structures & Algorithms
- [ ] **Arrays & Strings**: In-place reversals, two-pointer techniques, sliding window, prefix sums
- [ ] **HashMaps & Sets**: Frequency maps, anagrams, two sum, set lookups in $O(1)$
- [ ] **Stack & Queue**: Array-based implementation, Parentheses matching, Monotonic stack, BFS queue
- [ ] **Linked Lists**: Singly linked list, reversal, cycle detection (Floyd's Tortoise & Hare)
- [ ] **Trees & Binary Search Trees**: Traversals (Pre, In, Post, Level-order), Max Depth, LCA
- [ ] **Recursion & Backtracking**: Subsets, permutations, base condition patterns
- [ ] **Dynamic Programming in JS**: Memoized recursion vs 1D/2D Tabulation

---

## 🎯 Phase 10: Interview Mastery & Practice
- [ ] **Top 50 Output-Based Questions**: Trick questions on hoisting, coercion, closures, event loop order
- [ ] **Common Debugging Traps**: Floating point arithmetic (`0.1 + 0.2 !== 0.3`), mutating parameters, memory leaks
- [ ] **System & Coding Rounds**: Polyfill implementations (`map`, `filter`, `reduce`, `Promise`, `flat`, `debounce`)
- [ ] **Behavioral & Conceptual Rounds**: Explaining technical choices, performance optimization, React rendering mechanics
