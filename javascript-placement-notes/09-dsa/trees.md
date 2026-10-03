# Binary Trees & Binary Search Trees (BST)

A **Tree** is a hierarchical data structure consisting of nodes connected by edges.

In a **Binary Tree**, each node has at most **two children**: `left` and `right`.

---

## 1. Defining a Tree Node

```javascript
class TreeNode {
    constructor(val = 0, left = null, right = null) {
        this.val = val;
        this.left = left;
        this.right = right;
    }
}
```

---

## 2. Tree Traversals (The Foundation)

### 1. Depth-First Search (DFS)
- **In-Order** (Left $\rightarrow$ Root $\rightarrow$ Right): *For a BST, this yields elements in sorted ascending order!*
- **Pre-Order** (Root $\rightarrow$ Left $\rightarrow$ Right): Great for cloning or serializing trees.
- **Post-Order** (Left $\rightarrow$ Right $\rightarrow$ Root): Great for deleting nodes or calculating bottom-up heights.

```javascript
function inOrderTraversal(root, result = []) {
    if (!root) return result;

    inOrderTraversal(root.left, result);  // Left
    result.push(root.val);               // Root
    inOrderTraversal(root.right, result); // Right

    return result;
}
```

---

## 3. High-Frequency Interview Problem 1: Maximum Depth of Binary Tree

Find how many levels deep a binary tree goes.

```javascript
function maxDepth(root) {
    if (root === null) return 0; // Base case

    const leftDepth = maxDepth(root.left);
    const rightDepth = maxDepth(root.right);

    return 1 + Math.max(leftDepth, rightDepth);
}
```

- **Time Complexity:** $O(N)$ (Visits every node once)
- **Space Complexity:** $O(H)$ where $H$ is the height of the tree (recursion call stack).

---

## 4. High-Frequency Interview Problem 2: Invert Binary Tree

Swap the left and right children of every node in the tree.

```javascript
function invertTree(root) {
    if (root === null) return null;

    // Swap children using array destructuring:
    [root.left, root.right] = [invertTree(root.right), invertTree(root.left)];

    return root;
}
```

---

## 5. What is a Binary Search Tree (BST)?

A tree is a **Binary Search Tree** if for every single node:
1. All nodes in its **left subtree** have values **strictly less** than the node's value.
2. All nodes in its **right subtree** have values **strictly greater** than the node's value.

### Search in a BST ($O(\log N)$ on average):
```javascript
function searchBST(root, target) {
    if (!root || root.val === target) return root;

    if (target < root.val) {
        return searchBST(root.left, target); // Search left half
    } else {
        return searchBST(root.right, target); // Search right half
    }
}
```

---

## 💡 Think of it like this

- A **Binary Tree** is like a corporate organizational chart: CEO at the top, two VPs underneath, each VP has two managers, and so on.
- A **Binary Search Tree** is like playing a "Guess My Number" game. If the secret number is 50, and the computer asks "Is it 40?", you say "Higher!", instantly discarding half of all remaining possibilities!

---

## 🎯 Interview Points

1. **How do you validate if a tree is a valid BST?**
   - You must pass down valid ranges `(min, max)` to child nodes recursively. Just checking `node.left.val < node.val` is NOT enough, because a node in the left subtree could violate an ancestor's value further up!
