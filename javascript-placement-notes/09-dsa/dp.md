# Dynamic Programming in JavaScript

Dynamic Programming (DP) is simply **recursion without repeating identical work**.

If a problem has **overlapping subproblems** and **optimal substructure**, you can use DP to turn exponential $O(2^N)$ algorithms into blistering fast $O(N)$ solutions.

---

## 1. Top-Down (Memoization) vs Bottom-Up (Tabulation)

- **Top-Down (Memoization)**: Start at the main problem $N$, break it into subproblems with recursion, and cache the answers in an object or array.
- **Bottom-Up (Tabulation)**: Start from the base case (problem $0$ and $1$), and iteratively build an array forward until reaching $N$.

---

## 2. Problem 1: Climbing Stairs (The Foundation)

You are climbing a staircase with $n$ steps. Each time you can climb either **1 step or 2 steps**. In how many distinct ways can you reach the top?

### Recurrence Relation:
To reach step $n$, you must have come from either step $n-1$ or step $n-2$:
`ways(n) = ways(n - 1) + ways(n - 2)`

```javascript
// Iterative Bottom-Up with O(1) Space:
function climbStairs(n) {
    if (n <= 2) return n;

    let prev2 = 1; // ways to reach step 1
    let prev1 = 2; // ways to reach step 2

    for (let i = 3; i <= n; i++) {
        let current = prev1 + prev2;
        prev2 = prev1;
        prev1 = current;
    }

    return prev1;
}

console.log(climbStairs(5)); // 8
```

- **Time Complexity:** $O(N)$
- **Space Complexity:** $O(1)$

---

## 3. Problem 2: House Robber

You are planning to rob houses along a street. Each house has a certain amount of money stashed.
Adjacent houses have connected security systems: **you cannot rob two adjacent houses on the same night**.

Determine the maximum money you can rob tonight.

```javascript
function rob(nums) {
    if (!nums || nums.length === 0) return 0;
    if (nums.length === 1) return nums[0];

    let rob1 = 0; // Max money robbed up to house i-2
    let rob2 = 0; // Max money robbed up to house i-1

    // [rob1, rob2, currentHouse, ...]
    for (let currentMoney of nums) {
        // Option A: Rob current house + rob1
        // Option B: Skip current house, keep rob2
        let maxProfit = Math.max(currentMoney + rob1, rob2);
        rob1 = rob2;
        rob2 = maxProfit;
    }

    return rob2;
}

console.log(rob([1, 2, 3, 1])); // 4 (Rob house 1 and house 3: 1 + 3 = 4)
console.log(rob([2, 7, 9, 3, 1])); // 12 (Rob houses 1, 3, 5: 2 + 9 + 1 = 12)
```

- **Time Complexity:** $O(N)$
- **Space Complexity:** $O(1)$

---

## 4. Problem 3: Coin Change (Minimum Coins)

Given an array of coin denominations and a total `amount`, return the fewest number of coins needed to make up that amount. If impossible, return `-1`.

```javascript
function coinChange(coins, amount) {
    // dp[i] stores minimum coins to make amount i
    const dp = new Array(amount + 1).fill(Infinity);
    dp[0] = 0; // 0 coins needed to make amount 0

    for (let coin of coins) {
        for (let i = coin; i <= amount; i++) {
            dp[i] = Math.min(dp[i], dp[i - coin] + 1);
        }
    }

    return dp[amount] === Infinity ? -1 : dp[amount];
}

console.log(coinChange([1, 2, 5], 11)); // 3 (5 + 5 + 1)
```

- **Time Complexity:** $O(\text{amount} \times \text{coins.length})$
- **Space Complexity:** $O(\text{amount})$

---

## 💡 Think of it like this

- Plain recursion without DP is like an amnesiac carpenter rebuilding a wooden chair from raw lumber every single day.
- Dynamic Programming is taking a photo of the completed chair blueprints and keeping it in a desk drawer. The next time someone orders a chair, you follow your cached blueprint instantly!

---

## 🎯 Interview Points

1. **How do you identify a Dynamic Programming problem?**
   - Look for two keywords in the problem description:
     - *"Find the maximum / minimum..."* (Min cost, max profit, fewest coins).
     - *"Count the total number of ways to..."* (Climbing stairs, grid paths).
