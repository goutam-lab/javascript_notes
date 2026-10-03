# Must-Know JavaScript Machine Coding & Polyfill Challenges

In SDE-1 placement rounds at top product firms, interviewers will ask you to build foundational JavaScript utilities from scratch on a blank editor.

Try solving these on your own first before expanding the solutions!

---

## Challenge 1: Implement `Promise.all` from Scratch

Build a custom function `myPromiseAll(promises)` that behaves identically to native `Promise.all`.

<details>
<summary>Click to reveal solution</summary>

```javascript
function myPromiseAll(promises) {
    return new Promise((resolve, reject) => {
        if (!Array.isArray(promises)) {
            return reject(new TypeError("Arguments must be an array"));
        }

        const results = [];
        let completed = 0;

        if (promises.length === 0) {
            return resolve(results);
        }

        promises.forEach((promiseItem, index) => {
            // Promise.resolve handles both Promises and raw values (like 42)
            Promise.resolve(promiseItem)
                .then((value) => {
                    results[index] = value; // Preserve original index position!
                    completed++;

                    if (completed === promises.length) {
                        resolve(results);
                    }
                })
                .catch((error) => {
                    reject(error); // Fail-fast on first rejection!
                });
        });
    });
}

// Test:
const p1 = Promise.resolve(10);
const p2 = new Promise((res) => setTimeout(() => res(20), 500));
const p3 = 30; // Raw non-promise value

myPromiseAll([p1, p2, p3]).then(console.log); // [ 10, 20, 30 ]
```
</details>

---

## Challenge 2: Implement a Recursive Deep Clone

Create a `deepClone(obj)` function that creates a completely isolated copy of an object, including all nested objects and arrays.

<details>
<summary>Click to reveal solution</summary>

```javascript
function deepClone(value, map = new WeakMap()) {
    // 1. Handle primitives and null:
    if (value === null || typeof value !== "object") {
        return value;
    }

    // 2. Handle circular references:
    if (map.has(value)) {
        return map.get(value);
    }

    // 3. Handle Dates and RegExps:
    if (value instanceof Date) return new Date(value);
    if (value instanceof RegExp) return new RegExp(value);

    // 4. Handle Arrays and Objects:
    const clone = Array.isArray(value) ? [] : {};
    map.set(value, clone);

    for (let key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
            clone[key] = deepClone(value[key], map);
        }
    }

    return clone;
}

// Test:
const original = { a: 1, b: { c: [10, 20] } };
const cloned = deepClone(original);
cloned.b.c.push(30);

console.log("Original untouched:", original.b.c); // [ 10, 20 ]
console.log("Cloned modified:", cloned.b.c);     // [ 10, 20, 30 ]
```
</details>

---

## Challenge 3: Flatten Nested Array Without `Array.prototype.flat`

Write `flatten(arr)` to flatten an array with arbitrary levels of nesting.

<details>
<summary>Click to reveal solution</summary>

```javascript
function flatten(arr) {
    let result = [];

    for (let item of arr) {
        if (Array.isArray(item)) {
            result.push(...flatten(item)); // Recursive unpack
        } else {
            result.push(item);
        }
    }

    return result;
}

console.log(flatten([1, [2, [3, [4, 5]], 6], 7]));
// [ 1, 2, 3, 4, 5, 6, 7 ]
```
</details>

---

## Challenge 4: Deep Object Flattening into Dot Notation

Convert `{ user: { name: "Goutam", address: { city: "Bengaluru" } } }` into:  
`{ "user.name": "Goutam", "user.address.city": "Bengaluru" }`

<details>
<summary>Click to reveal solution</summary>

```javascript
function flattenObject(obj, prefix = "", result = {}) {
    for (let key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            const path = prefix ? `${prefix}.${key}` : key;
            const val = obj[key];

            if (typeof val === "object" && val !== null && !Array.isArray(val)) {
                flattenObject(val, path, result);
            } else {
                result[path] = val;
            }
        }
    }
    return result;
}
```
</details>
