# Spread Operator vs Rest Operator (`...`)

In modern JavaScript, three dots `...` appear everywhere.

Even though they look identical, they perform two completely opposite tasks depending on where you use them:
1. **Spread Operator**: Expands / unpacks elements.
2. **Rest Operator**: Gathers / packs elements together into an array.

---

## 1. The Spread Operator (Unpacking)

Think of Spread as **taking items out of a container and spreading them onto a table**.

### 1. Combining Arrays
```javascript
const frontend = ["HTML", "CSS", "JS"];
const backend = ["Node", "Express", "MongoDB"];

const fullStack = [...frontend, ...backend, "Docker"];
console.log(fullStack);
```

**Output:**
```
[ 'HTML', 'CSS', 'JS', 'Node', 'Express', 'MongoDB', 'Docker' ]
```

### 2. Passing Array Items into Functions
`Math.max` expects individual numbers, not an array. Spread makes it effortless:

```javascript
const scores = [88, 94, 76, 99, 82];

console.log(Math.max(...scores)); // Expands into: Math.max(88, 94, 76, 99, 82)
```

**Output:**
```
99
```

### 3. Cloning and Updating Objects (The React State Pattern)
```javascript
const state = {
    user: "Goutam",
    theme: "light",
    notifications: true
};

// Create a copy and update theme to dark:
const updatedState = {
    ...state,
    theme: "dark" // Overrides old theme
};

console.log(updatedState);
```

**Output:**
```
{ user: 'Goutam', theme: 'dark', notifications: true }
```

---

## 2. The Rest Operator (Gathering)

Think of Rest as **gathering loose items and packing them into a single box**.

### 1. Rest Parameters in Functions
Allows a function to accept any number of arguments as a real JavaScript Array:

```javascript
function calculateTotal(...prices) {
    // prices is a real array!
    return prices.reduce((acc, curr) => acc + curr, 0);
}

console.log(calculateTotal(10, 20, 30));
console.log(calculateTotal(5, 15, 25, 35, 45));
```

**Output:**
```
60
125
```

### 2. Rest in Destructuring
Captures the "rest" of the unused items:

```javascript
const podium = ["Gold - Aman", "Silver - Priya", "Bronze - Rahul", "Deepak", "Sneha"];

const [winner, runnerUp, ...others] = podium;

console.log("Winner:", winner);
console.log("Runner Up:", runnerUp);
console.log("Others:", others);
```

**Output:**
```
Winner: Gold - Aman
Runner Up: Silver - Priya
Others: [ 'Bronze - Rahul', 'Deepak', 'Sneha' ]
```

---

## 3. Shallow Copy vs Deep Copy (Crucial Interview Topic!)

When you copy an array or object using `...spread`, you are making a **Shallow Copy**.

If the object contains nested objects, their references are still shared!

```javascript
const original = {
    name: "Aman",
    details: { city: "Bengaluru" }
};

const copy = { ...original };

copy.details.city = "Delhi"; // ⚠️ Modifies original too!

console.log(original.details.city);
```

**Output:**
```
Delhi
```

---

## 4. How to Create a True Deep Copy

### Method 1: Modern `structuredClone()` (ES2022 — Best Practice)
Supported natively in modern Node.js and all modern browsers:

```javascript
const deepCopy = structuredClone(original);
deepCopy.details.city = "Mumbai";

console.log(original.details.city); // Still "Delhi"! Completely isolated.
```

### Method 2: `JSON.parse(JSON.stringify(obj))` (Legacy Way)
Works for simple data, but fails if the object has functions, `Date` objects, `undefined`, or `Infinity`.

---

## 💡 Think of it like this

- **Spread**: Like unboxing a box of donuts and laying them out individually on plates.
- **Rest**: Like collecting all remaining donuts on the table and putting them into a takeaway box.
- **Shallow Copy**: Photocopying a sheet that has a link to an online spreadsheet. You have a new physical paper, but the link still points to the same online sheet everyone is editing!
- **Deep Copy**: Downloading an entirely offline, private copy of that spreadsheet so nobody else can ever affect it.

---

## ⚠️ Common Mistakes

### Placing the Rest parameter before other parameters

```javascript
// ❌ SYNTAX ERROR: Rest parameter must be last!
// function logData(...items, category) {}

// ✅ CORRECT: Rest must always be at the very end
function logData(category, ...items) {
    console.log(category, items);
}
```

---

## 🎯 Interview Points

1. **How do you tell if `...` is Spread or Rest?**
   - If it is on the **left side** of an assignment (destructuring) or inside a **function definition parameter list**, it is **REST** (gathering).
   - If it is on the **right side** of an assignment, inside an array/object literal, or in a **function call argument list**, it is **SPREAD** (unpacking).

2. **Why is Rest parameter preferred over the old `arguments` object?**
   - Rest parameters produce a real `Array`, so you can immediately use `map`, `filter`, `reduce`.
   - The legacy `arguments` object was only "array-like" (had `.length`, but lacked array methods).
   - Rest parameters work seamlessly in arrow functions, whereas `arguments` is not available in arrow functions.
