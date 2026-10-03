# Top Tricky JavaScript Output Questions

Placement interviewers love output-based questions because they immediately reveal if a candidate truly understands how JavaScript executes behind the scenes.

Let's walk through the most famous ones with crystal-clear explanations.

---

## Question 1: The Event Loop & Priority Race

```javascript
console.log("A");

setTimeout(() => console.log("B"), 0);

Promise.resolve().then(() => console.log("C"));

Promise.resolve().then(() => {
    console.log("D");
    setTimeout(() => console.log("E"), 0);
});

console.log("F");
```

### Output:
```
A
F
C
D
B
E
```

### Why?
1. `"A"` and `"F"` log first because synchronous code on the Call Stack runs before anything else.
2. The Microtask Queue gets `"C"` and `"D"`. Both microtasks are executed next $\rightarrow$ logs `"C"` and `"D"`.
3. Inside `"D"`, a new timeout `"E"` is scheduled to the Macrotask Queue (behind `"B"`).
4. With the Microtask Queue now empty, the Event Loop processes the Macrotask Queue:
   - First task: `"B"` $\rightarrow$ logs `"B"`.
   - Next task: `"E"` $\rightarrow$ logs `"E"`.

---

## Question 2: Object Keys Coercion

```javascript
const a = {};
const b = { key: "b" };
const c = { key: "c" };

a[b] = 123;
a[c] = 456;

console.log(a[b]);
```

### Output:
```
456
```

### Why?
Plain JavaScript objects only accept **strings** or **symbols** as keys.
When you pass object `b` as a key, JavaScript converts it to string: `b.toString()` $\rightarrow$ `"[object Object]"`.
When you pass object `c`, it also converts to `"[object Object]"`!
So line 5 simply overwrites `a["[object Object]"] = 456`.
Printing `a[b]` looks up `a["[object Object]"]`, which is `456`.

---

## Question 3: Array Mapping with `parseInt`

```javascript
console.log(["1", "2", "3"].map(parseInt));
```

### Output:
```
[ 1, NaN, NaN ]
```

### Why?
`map` passes **3 arguments** to its callback: `(element, index, array)`.
`parseInt` accepts **2 arguments**: `parseInt(string, radix)`.

So `map` calls `parseInt` like this:
1. `parseInt("1", 0)` $\rightarrow$ Radix `0` defaults to decimal (base 10) $\rightarrow$ **`1`**.
2. `parseInt("2", 1)` $\rightarrow$ Radix `1` does not exist! Base must be between 2 and 36 $\rightarrow$ **`NaN`**.
3. `parseInt("3", 2)` $\rightarrow$ Base 2 (binary) only allows digits 0 and 1. `"3"` is invalid in binary $\rightarrow$ **`NaN`**.

---

## Question 4: Scope Shadowing & Hoisting Clash

```javascript
var x = 21;

var girl = function() {
    console.log(x);
    var x = 20;
};

girl();
```

### Output:
```
undefined
```

### Why?
Inside `girl()`, the local declaration `var x = 20` is hoisted to the top of `girl()`'s local function scope with value `undefined`.
Because of shadowing, it hides the outer global `x = 21`.
When `console.log(x)` runs, the local `x` is still `undefined`!

---

## Question 5: `this` Inside Arrow vs Regular Functions

```javascript
const obj = {
    name: "Placement Prep",
    regular: function() {
        console.log(this.name);
    },
    arrow: () => {
        console.log(this.name);
    }
};

obj.regular();
obj.arrow();
```

### Output:
```
Placement Prep
undefined
```

### Why?
- `obj.regular()` is an implicit method call: `this` points to `obj`.
- `obj.arrow()` is an arrow function: it has no `this` of its own. It inherits `this` from the enclosing scope where `obj` was defined (the global `window` / module scope), where `this.name` is `undefined`.
