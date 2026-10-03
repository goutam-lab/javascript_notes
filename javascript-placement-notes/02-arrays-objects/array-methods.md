# Modern Array Methods (`find`, `some`, `every`, `flat`, `reduce`)

In modern JavaScript and React development, you almost never write manual `for` loops to transform arrays.

Instead, you use expressive, functional array methods.

Let's look at the most important ones you need to master.

---

## 1. `find()` and `findIndex()`

Use these when searching for **a single specific item** inside an array of objects.

- `find()` returns the **first matching element** (or `undefined` if none matches).
- `findIndex()` returns the **index of the first match** (or `-1`).

```javascript
const users = [
    { id: 101, name: "Aman", role: "Viewer" },
    { id: 102, name: "Sneha", role: "Admin" },
    { id: 103, name: "Rahul", role: "Editor" }
];

const admin = users.find((user) => user.role === "Admin");
console.log(admin);

const editorIndex = users.findIndex((user) => user.role === "Editor");
console.log("Editor Index:", editorIndex);
```

**Output:**
```
{ id: 102, name: 'Sneha', role: 'Admin' }
Editor Index: 2
```

> **Performance note:** As soon as `find()` finds a match, it stops looking! It does not waste time scanning the rest of the array.

---

## 2. `some()` vs `every()`

These methods test conditions and return a **Boolean** (`true` or `false`).

### `some()`
Returns `true` if **at least one item** passes the test. (Think of it as a logical OR).

```javascript
const scores = [45, 82, 33, 91];

const hasPassedAnyExam = scores.some((score) => score >= 50);
console.log("Has passed at least one:", hasPassedAnyExam);
```

**Output:**
```
Has passed at least one: true
```

---

### `every()`
Returns `true` only if **every single item** passes the test. (Think of it as a logical AND).

```javascript
const ages = [19, 24, 30, 16];

const isAllAdults = ages.every((age) => age >= 18);
console.log("Are all users adults:", isAllAdults);
```

**Output:**
```
Are all users adults: false
```

---

## 3. `flat()` and `flatMap()`

### `flat(depth)`
Flattens nested arrays into a single level.

```javascript
const nested = [1, [2, 3], [4, [5, 6]]];

console.log(nested.flat()); // Default depth is 1
console.log(nested.flat(2)); // Flatten 2 levels deep
```

**Output:**
```
[ 1, 2, 3, 4, [ 5, 6 ] ]
[ 1, 2, 3, 4, 5, 6 ]
```

> **Pro Tip:** If you have an array with unknown nesting depth, pass `Infinity`:
> `nested.flat(Infinity)` completely flattens any array!

---

## 4. `reduce()` Deep Dive

`reduce` is often called the "Swiss Army Knife" of JavaScript. Any transformation you can imagine can be done with `reduce`.

### How it works:
It takes two arguments:
1. A callback function: `(accumulator, currentItem) => ...`
2. An **initial value** for the accumulator.

### Example: Finding the Maximum Value

```javascript
const numbers = [23, 78, 12, 95, 43];

const maxNum = numbers.reduce((max, current) => {
    return current > max ? current : max;
}, numbers[0]);

console.log("Max is:", maxNum);
```

**Output:**
```
Max is: 95
```

### Example: Tallying / Counting Occurrences (Frequency Map)

```javascript
const votes = ["React", "Vue", "React", "Angular", "React", "Vue"];

const voteCount = votes.reduce((tally, framework) => {
    tally[framework] = (tally[framework] || 0) + 1;
    return tally;
}, {}); // Initial value is an empty object {}

console.log(voteCount);
```

**Output:**
```
{ React: 3, Vue: 2, Angular: 1 }
```

---

## 💡 Think of it like this

- `map`: Converting 5 centimeters into 5 inches. You end up with 5 converted values.
- `filter`: Sifting sand through a mesh to keep only gold nuggets. You end up with fewer items.
- `reduce`: Putting fruits into a juicer. You put many fruits in, and you get **one glass of juice** out.

---

## 5. The Dangerous `sort()` Trap

JavaScript's built-in `.sort()` converts numbers into strings and sorts them in alphabetical (UTF-16) order!

```javascript
const numbers = [10, 5, 40, 25, 100];
numbers.sort();

console.log(numbers);
```

**Output:**
```
[ 10, 100, 25, 40, 5 ]
```

`"100"` comes before `"25"` and `"5"` alphabetically!

### The Fix: Always provide a compare function:

```javascript
// Ascending order:
numbers.sort((a, b) => a - b);
console.log("Ascending:", numbers);

// Descending order:
numbers.sort((a, b) => b - a);
console.log("Descending:", numbers);
```

**Output:**
```
Ascending: [ 5, 10, 25, 40, 100 ]
Descending: [ 100, 40, 25, 10, 5 ]
```

---

## ⚠️ Common Mistakes

### Forgetting to return the accumulator in `reduce`

```javascript
// ❌ WRONG: Missing return statement!
const nums = [1, 2, 3];
const sum = nums.reduce((acc, curr) => {
    acc + curr; // Forgets to return!
}, 0);

console.log(sum); // undefined!
```

---

## 🎯 Interview Points

1. **What is the difference between `find()` and `filter()`?**
   - `find()` returns the first item that matches and immediately stops searching.
   - `filter()` checks the entire array and returns an array of all matching items.

2. **Does `sort()` mutate the original array?**
   - Yes! `.sort()` changes the array in-place.
   - If you want an immutable copy in modern JavaScript (ES2023), use `.toSorted()`.
