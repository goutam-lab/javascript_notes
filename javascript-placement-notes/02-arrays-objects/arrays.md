# Arrays in JavaScript

Arrays are ordered collections of items.

In JavaScript, arrays are flexible: they can grow or shrink dynamically, and they can hold different types of data at the same time.

For placements and DSA, arrays are your most frequently used data structure.

---

## 1. Creating Arrays

The most common and recommended way is using square brackets `[]` (the array literal):

```javascript
const fruits = ["Apple", "Mango", "Banana"];
console.log(fruits[0]); // First item
console.log(fruits.length); // Total count
```

**Output:**
```
Apple
3
```

---

## 2. Essential Methods: Adding & Removing Elements

Think of an array with two ends: the **front (start)** and the **back (end)**.

### Adding & Removing at the End (Fast: $O(1)$)
- `push()`: Adds an item to the **end**.
- `pop()`: Removes the last item and returns it.

```javascript
const stack = [10, 20];

stack.push(30);
console.log(stack);

let lastItem = stack.pop();
console.log("Removed:", lastItem);
console.log("Array now:", stack);
```

**Output:**
```
[ 10, 20, 30 ]
Removed: 30
Array now: [ 10, 20 ]
```

---

### Adding & Removing at the Beginning (Slow: $O(N)$)
- `unshift()`: Inserts an item at the **beginning**.
- `shift()`: Removes the first item from the **beginning**.

```javascript
const queue = ["Bob", "Charlie"];

queue.unshift("Alice"); // Adds Alice to front
console.log(queue);

let served = queue.shift(); // Removes Alice
console.log("Served:", served);
```

**Output:**
```
[ 'Alice', 'Bob', 'Charlie' ]
Served: Alice
```

---

## 💡 Think of it like this

- `push` and `pop` are like stacking plates on top of each other. You only touch the top plate. It is instantaneous ($O(1)$).
- `unshift` and `shift` are like adding or removing someone at the front of a movie ticket line. Every single person behind them has to take one step forward or backward. That takes extra time ($O(N)$).

---

## 3. `slice()` vs `splice()` (Top Interview Question!)

Many students get confused between these two names. Here is the golden rule:

- **`slice()`**: Cuts a piece out. It does **NOT change** the original array (Pure).
- **`splice()`**: Cuts, removes, or inserts items **in-place**. It **MUTATES** the original array!

### Example: `slice(startIndex, endIndex)`
The end index is **not included**.

```javascript
const letters = ["a", "b", "c", "d", "e"];
const sub = letters.slice(1, 4);

console.log("Extracted:", sub);
console.log("Original untouched:", letters);
```

**Output:**
```
Extracted: [ 'b', 'c', 'd' ]
Original untouched: [ 'a', 'b', 'c', 'd', 'e' ]
```

### Example: `splice(startIndex, deleteCount, ...itemsToAdd)`

```javascript
const colors = ["Red", "Green", "Blue", "Yellow"];

// Start at index 1, delete 2 items, add "Purple"
const removed = colors.splice(1, 2, "Purple");

console.log("Removed items:", removed);
console.log("Original mutated array:", colors);
```

**Output:**
```
Removed items: [ 'Green', 'Blue' ]
Original mutated array: [ 'Red', 'Purple', 'Yellow' ]
```

---

## 4. Searching in Arrays

```javascript
const tech = ["JavaScript", "Python", "Go"];

// 1. includes() - returns true or false
console.log(tech.includes("Python")); // true

// 2. indexOf() - returns the index or -1 if not found
console.log(tech.indexOf("Go"));      // 2
console.log(tech.indexOf("Java"));    // -1
```

---

## ⚠️ Common Mistakes

### Mistake 1: Checking if a variable is an Array using `typeof`

```javascript
// ❌ WRONG
console.log(typeof [1, 2, 3]); // "object"
```

In JavaScript, arrays are objects. Using `typeof` will never tell you if something is an array!

```javascript
// ✅ CORRECT
console.log(Array.isArray([1, 2, 3])); // true
```

---

### Mistake 2: Emptying an array by setting `arr = []`

If another variable points to that same array, reassigning `arr = []` will leave the other variable pointing to the old data!

```javascript
let arr1 = [1, 2, 3];
let arr2 = arr1;

// ❌ Flawed: Leaves arr2 holding the old array
arr1 = []; 
console.log(arr2); // Still [1, 2, 3]!

// ✅ CORRECT: Empty in-place
arr1 = [1, 2, 3];
arr2 = arr1;

arr1.length = 0; // Truncates in memory
console.log(arr2); // []
```

---

## 🎯 Interview Points

1. **What is the time complexity of `push()` vs `unshift()`?**
   - `push()` is $O(1)$ amortized because elements are simply added to the end.
   - `unshift()` is $O(N)$ because every single existing element must be shifted to the right to make room at index 0.

2. **Does `arr.length = 0` mutate the array?**
   - Yes! Setting `length` to 0 drops all elements in-place and clears the memory buffer without creating a new array reference.
