# Queues in JavaScript & High-Performance $O(1)$ Implementation

A **Queue** is a linear data structure that operates on the **FIFO (First In, First Out)** principle.

The first element added to the queue is the first one to be removed.

---

## 1. The Hidden Trap with Array `.shift()`

Many candidates implement a queue like this:
```javascript
// ❌ NAIVE: Slow O(N) dequeue!
const queue = [];
queue.push(item); // Enqueue: O(1)
const next = queue.shift(); // Dequeue: O(N)!!
```

### Why is `shift()` bad for interviews?
When you call `arr.shift()`, the JavaScript engine must re-index every single remaining element in the array.
If your queue has 100,000 items (like in a graph BFS problem), your code will get a **Time Limit Exceeded (TLE)** error!

---

## 2. High-Performance $O(1)$ Queue Implementation

Here is how senior developers implement an $O(1)$ Queue using a JavaScript object and index pointers:

```javascript
class OptimalQueue {
    constructor() {
        this.items = {};
        this.front = 0;
        this.rear = 0;
    }

    // Add to back: O(1)
    enqueue(element) {
        this.items[this.rear] = element;
        this.rear++;
    }

    // Remove from front: O(1)
    dequeue() {
        if (this.isEmpty()) return null;

        const item = this.items[this.front];
        delete this.items[this.front]; // Clean memory
        this.front++;
        return item;
    }

    peek() {
        if (this.isEmpty()) return null;
        return this.items[this.front];
    }

    isEmpty() {
        return this.rear - this.front === 0;
    }

    size() {
        return this.rear - this.front;
    }
}
```

### Testing the Queue:
```javascript
const q = new OptimalQueue();
q.enqueue("Ticket #1");
q.enqueue("Ticket #2");
q.enqueue("Ticket #3");

console.log(q.dequeue()); // Ticket #1 (First In, First Out!)
console.log(q.peek());    // Ticket #2
console.log(q.size());    // 2
```

---

## 3. Classic DSA Use Case: Breadth-First Search (BFS)

Queues are the foundational engine behind **Breadth-First Search (Level-Order Traversal)** in trees and graphs:

```javascript
function bfs(treeRoot) {
    if (!treeRoot) return [];

    const queue = [treeRoot];
    const result = [];

    let head = 0; // Pointer index avoiding O(N) shift()
    while (head < queue.length) {
        const currentNode = queue[head++];
        result.push(currentNode.val);

        if (currentNode.left) queue.push(currentNode.left);
        if (currentNode.right) queue.push(currentNode.right);
    }

    return result;
}
```

---

## 💡 Think of it like this

A Queue is like standing in line at an airport security checkpoint:
- The first passenger to step into line is the first passenger checked and sent to the gate (FIFO).
- No cutting in line allowed!

---

## 🎯 Interview Points

1. **How can you implement a Queue using two Stacks?**
   - Use `inStack` for `enqueue` (push to `inStack`).
   - For `dequeue`: If `outStack` is empty, pop all items from `inStack` and push them into `outStack` (reversing their order to FIFO!). Then pop from `outStack`.
