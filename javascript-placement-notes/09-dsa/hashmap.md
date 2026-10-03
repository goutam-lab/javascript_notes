# HashMaps & Sets in JavaScript (`Map` & `Set`)

For DSA and coding interviews, knowing when to use a **`Map`** or **`Set`** is the difference between an $O(N^2)$ brute force solution and an optimal $O(N)$ solution.

---

## 1. Plain Object `{}` vs ES6 `Map`

| Feature | Plain Object `{}` | ES6 `Map` |
| :--- | :--- | :--- |
| **Key Types** | Only Strings & Symbols | **ANY type** (Objects, Functions, Numbers) |
| **Order** | Complex integer sorting rules | **Guaranteed insertion order** |
| **Size** | Manual `Object.keys(obj).length` ($O(N)$) | Built-in `.size` ($O(1)$) |
| **Methods** | `obj[key]` | `.set(k, v)`, `.get(k)`, `.has(k)`, `.delete(k)` |

```javascript
const map = new Map();

// Can use objects as keys!
const userObj = { id: 1 };
map.set(userObj, "Admin Profile");

console.log(map.get(userObj)); // "Admin Profile"
console.log(map.has(userObj)); // true
console.log(map.size);         // 1
```

---

## 2. ES6 `Set` (Unique Value Collection)

A `Set` automatically ignores duplicates:

```javascript
// Quickest way to remove duplicates from an array:
const numbers = [1, 2, 2, 3, 4, 4, 5];
const uniqueNumbers = [...new Set(numbers)];

console.log(uniqueNumbers);
```

**Output:**
```
[ 1, 2, 3, 4, 5 ]
```

---

## 3. The Classic Problem: Two Sum ($O(N)$ with Map)

Given an array of integers `nums` and an integer `target`, return indices of the two numbers such that they add up to `target`.

### The Brute Force: $O(N^2)$ nested loops
### The Optimal Solution: $O(N)$ using a Hash Map

```javascript
function twoSum(nums, target) {
    const seen = new Map(); // Stores: number -> index

    for (let i = 0; i < nums.length; i++) {
        const complement = target - nums[i];

        // Did we see the required complement earlier?
        if (seen.has(complement)) {
            return [seen.get(complement), i];
        }

        // Save current number with its index
        seen.set(nums[i], i);
    }

    return [];
}

console.log(twoSum([2, 7, 11, 15], 9));
```

**Output:**
```
[ 0, 1 ]
```

- **Time Complexity:** $O(N)$
- **Space Complexity:** $O(N)$

---

## 4. Problem: Group Anagrams

Given an array of strings, group the anagrams together.

```javascript
function groupAnagrams(strs) {
    const map = new Map();

    for (let str of strs) {
        // Sort characters of the word to use as the map key:
        // "eat" -> "aet", "tea" -> "aet", "tan" -> "ant"
        const sortedKey = str.split("").sort().join("");

        if (!map.has(sortedKey)) {
            map.set(sortedKey, []);
        }
        map.get(sortedKey).push(str);
    }

    return Array.from(map.values());
}

console.log(groupAnagrams(["eat", "tea", "tan", "ate", "nat", "bat"]));
```

**Output:**
```
[ [ 'eat', 'tea', 'ate' ], [ 'tan', 'nat' ], [ 'bat' ] ]
```

---

## 🎯 Interview Points

1. **What is a `WeakMap` or `WeakSet`?**
   - A `WeakMap` only accepts **objects as keys** and holds **weak references** to them. If the key object has no other references in your code, JavaScript's Garbage Collector will automatically clean it up from memory!
   - Keys in a `WeakMap` cannot be enumerated (no `.size`, no `.keys()`).
