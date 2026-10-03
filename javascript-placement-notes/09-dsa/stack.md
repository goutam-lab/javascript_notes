# Stacks in JavaScript & The Monotonic Stack Pattern

A **Stack** is a linear data structure that follows the **LIFO (Last In, First Out)** principle.

The last item pushed onto the stack is the first item to be popped off.

---

## 1. Implementing a Stack in JavaScript

In JavaScript, a standard Array with `push()` and `pop()` acts as a high-performance stack ($O(1)$ operations):

```javascript
class Stack {
    constructor() {
        this.items = [];
    }

    push(element) {
        this.items.push(element);
    }

    pop() {
        if (this.isEmpty()) return null;
        return this.items.pop();
    }

    peek() {
        return this.items[this.items.length - 1];
    }

    isEmpty() {
        return this.items.length === 0;
    }

    size() {
        return this.items.length;
    }
}
```

---

## 2. Classic Problem: Valid Parentheses

Given a string containing `'('`, `')'`, `'{'`, `'}'`, `'['`, and `']'`, determine if the input string has valid matching brackets.

```javascript
function isValidParentheses(s) {
    const stack = [];
    const bracketMap = {
        ")": "(",
        "}": "{",
        "]": "["
    };

    for (let char of s) {
        // If it's a closing bracket:
        if (char in bracketMap) {
            const topElement = stack.pop();
            if (topElement !== bracketMap[char]) {
                return false;
            }
        } else {
            // It's an opening bracket, push to stack
            stack.push(char);
        }
    }

    // Stack must be completely empty at the end:
    return stack.length === 0;
}

console.log(isValidParentheses("()[]{}")); // true
console.log(isValidParentheses("(]"));       // false
console.log(isValidParentheses("([)]"));     // false
```

- **Time Complexity:** $O(N)$
- **Space Complexity:** $O(N)$

---

## 3. Advanced Pattern: Monotonic Stack (Next Greater Element)

Find the next greater element for each item in an array. If no greater element exists to its right, output `-1`.

```javascript
function nextGreaterElements(nums) {
    const result = new Array(nums.length).fill(-1);
    const stack = []; // Stores INDICES of elements in monotonic decreasing order

    for (let i = 0; i < nums.length; i++) {
        // While current element is greater than the element represented by top of stack:
        while (stack.length > 0 && nums[i] > nums[stack[stack.length - 1]]) {
            const index = stack.pop();
            result[index] = nums[i];
        }
        stack.push(i);
    }

    return result;
}

console.log(nextGreaterElements([2, 1, 2, 4, 3]));
```

**Output:**
```
[ 4, 2, 4, -1, -1 ]
```

- **Time Complexity:** $O(N)$ (Each element is pushed and popped at most once)
- **Space Complexity:** $O(N)$

---

## 💡 Think of it like this

A stack is like a stack of plates in a cafeteria.
- You place clean plates on top of the pile (`push`).
- You take plates from the top of the pile (`pop`).
- You cannot pull a plate from the very bottom without breaking the entire stack!

---

## 🎯 Interview Points

1. **How do you design a Min Stack with $O(1)$ `getMin()`?**
   - Maintain a second parallel stack called `minStack`. Whenever an element is pushed onto the main stack, push `Math.min(val, minStack.peek())` onto `minStack`. When popping, pop from both. `minStack.peek()` always gives the minimum in $O(1)$ time!
