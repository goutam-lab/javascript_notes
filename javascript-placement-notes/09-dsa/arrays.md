# JavaScript for DSA: Core Array Patterns

In technical interviews (LeetCode style rounds), array questions test your ability to avoid brute force $O(N^2)$ solutions and write optimal $O(N)$ algorithms.

Here are the 4 fundamental array patterns you must know.

---

## 1. Pattern 1: Two Pointers (Opposite Direction)

### When to use:
- The array is **sorted** (or can be sorted).
- You need to find a pair, reverse in-place, or trap water.

### Problem: Two Sum II (Sorted Array)
Find two numbers that add up to `target`. Return their 1-based indices.

```javascript
function twoSumSorted(numbers, target) {
    let left = 0;
    let right = numbers.length - 1;

    while (left < right) {
        const sum = numbers[left] + numbers[right];

        if (sum === target) {
            return [left + 1, right + 1]; // 1-based index
        } else if (sum < target) {
            left++; // Need a bigger sum, move left pointer right
        } else {
            right--; // Need a smaller sum, move right pointer left
        }
    }

    return [];
}

console.log(twoSumSorted([2, 7, 11, 15], 9));
```

**Output:**
```
[ 1, 2 ]
```

- **Time Complexity:** $O(N)$ (One single pass)
- **Space Complexity:** $O(1)$ (No extra memory)

---

## 2. Pattern 2: Sliding Window

### When to use:
- The problem asks for a **contiguous subarray or substring** satisfying a condition (max, min, length $K$).

### Problem: Maximum Sum of Subarray of Size $K$
Given an array and an integer $k$, find the maximum sum of any contiguous subarray of size $k$.

```javascript
function maxSubarraySumOfSizeK(arr, k) {
    let windowSum = 0;
    let maxSum = -Infinity;

    // Step 1: Calculate sum of the first window of size k
    for (let i = 0; i < k; i++) {
        windowSum += arr[i];
    }
    maxSum = windowSum;

    // Step 2: Slide the window across the array:
    // Add the new element entering the window, subtract the one exiting!
    for (let i = k; i < arr.length; i++) {
        windowSum += arr[i] - arr[i - k];
        maxSum = Math.max(maxSum, windowSum);
    }

    return maxSum;
}

console.log(maxSubarraySumOfSizeK([2, 1, 5, 1, 3, 2], 3));
```

**Output:**
```
9 (from subarray [5, 1, 3])
```

- **Time Complexity:** $O(N)$ (Avoids recalculating sums from scratch)
- **Space Complexity:** $O(1)$

---

## 3. Pattern 3: Prefix Sum

### When to use:
- Multiple queries asking for the sum of elements between indices `L` and `R`.

```javascript
class PrefixSumArray {
    constructor(nums) {
        // prefix[i] stores the sum of nums from 0 up to i-1
        this.prefix = new Array(nums.length + 1).fill(0);
        for (let i = 0; i < nums.length; i++) {
            this.prefix[i + 1] = this.prefix[i] + nums[i];
        }
    }

    // Range sum query in O(1) time!
    rangeSum(left, right) {
        return this.prefix[right + 1] - this.prefix[left];
    }
}

const p = new PrefixSumArray([10, 20, 30, 40, 50]);
console.log("Sum between index 1 and 3:", p.rangeSum(1, 3)); // 20 + 30 + 40
```

**Output:**
```
Sum between index 1 and 3: 90
```

- **Query Time:** $O(1)$
- **Space Complexity:** $O(N)$

---

## 4. Pattern 4: Kadane's Algorithm (Max Subarray Sum)

Find the contiguous subarray that has the largest sum and return its sum.

```javascript
function maxSubArray(nums) {
    let currentSum = nums[0];
    let maxSum = nums[0];

    for (let i = 1; i < nums.length; i++) {
        // Either extend current subarray, or start fresh from current number:
        currentSum = Math.max(nums[i], currentSum + nums[i]);
        maxSum = Math.max(maxSum, currentSum);
    }

    return maxSum;
}

console.log(maxSubArray([-2, 1, -3, 4, -1, 2, 1, -5, 4]));
```

**Output:**
```
6 (from subarray [4, -1, 2, 1])
```

- **Time:** $O(N)$
- **Space:** $O(1)$

---

## ⚠️ The #1 JavaScript 2D Array Trap!

When creating a 2D grid of size $3 \times 3$, **NEVER do this**:

```javascript
// ❌ CRITICAL BUG:
const grid = new Array(3).fill(new Array(3).fill(0));

grid[0][0] = 99;
console.log(grid);
```

**Output:**
```
[ [ 99, 0, 0 ], [ 99, 0, 0 ], [ 99, 0, 0 ] ]
```

**Why?** `fill()` copies the **same array reference** to all 3 rows! Modifying one row changes all of them!

### The Correct Way:
```javascript
// ✅ CORRECT: Creates an independent array for each row
const gridCorrect = Array.from({ length: 3 }, () => new Array(3).fill(0));
gridCorrect[0][0] = 99;
console.log(gridCorrect[1][0]); // 0 (Isolated!)
```

---

## 🎯 Interview Points

1. **How do you reverse an array in-place without using `.reverse()`?**
   - Use two pointers (`start = 0`, `end = arr.length - 1`), swap elements using `[arr[start], arr[end]] = [arr[end], arr[start]]`, and increment/decrement pointers until they meet.
