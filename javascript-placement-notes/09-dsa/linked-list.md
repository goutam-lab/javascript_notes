# Linked Lists in JavaScript

Unlike an Array, elements in a **Linked List** are not stored in contiguous memory slots.

Each element is an independent object called a **Node**, which contains:
1. The **data value** (`val`).
2. A **pointer (reference)** to the next node in line (`next`).

---

## 1. Defining a Linked List Node

```javascript
class ListNode {
    constructor(val = 0, next = null) {
        this.val = val;
        this.next = next;
    }
}

// Building a list: 1 -> 2 -> 3 -> null
const head = new ListNode(1);
head.next = new ListNode(2);
head.next.next = new ListNode(3);
```

---

## 2. Core Problem 1: Reverse a Linked List (Iterative)

Given the head of a singly linked list, reverse the list in-place and return the new head.

```javascript
function reverseList(head) {
    let prev = null;
    let curr = head;

    while (curr !== null) {
        let nextTemp = curr.next; // 1. Save reference to next node
        curr.next = prev;         // 2. Reverse the arrow backwards!
        prev = curr;              // 3. Move prev forward
        curr = nextTemp;          // 4. Move curr forward
    }

    return prev; // prev is now the new head of the reversed list!
}
```

- **Time Complexity:** $O(N)$
- **Space Complexity:** $O(1)$

---

## 3. Core Problem 2: Detect Cycle (Floyd's Tortoise & Hare)

Determine if a linked list has a loop/cycle where nodes loop endlessly back on themselves.

### Algorithm:
- Use two pointers: a **`slow`** pointer moving 1 step at a time, and a **`fast`** pointer moving 2 steps at a time.
- If there is a cycle, the fast pointer will eventually lap the slow pointer and they will collide (`slow === fast`)!
- If the fast pointer reaches `null`, there is no cycle.

```javascript
function hasCycle(head) {
    let slow = head;
    let fast = head;

    while (fast !== null && fast.next !== null) {
        slow = slow.next;        // Moves 1 step
        fast = fast.next.next;   // Moves 2 steps

        if (slow === fast) {
            return true; // Cycle detected!
        }
    }

    return false; // Reached end, no cycle
}
```

- **Time Complexity:** $O(N)$
- **Space Complexity:** $O(1)$

---

## 4. Core Problem 3: Find Middle of Linked List

Given the head of a singly linked list, return the middle node.

```javascript
function middleNode(head) {
    let slow = head;
    let fast = head;

    // When fast reaches the end, slow is precisely at the middle!
    while (fast !== null && fast.next !== null) {
        slow = slow.next;
        fast = fast.next.next;
    }

    return slow;
}
```

---

## 💡 Think of it like this

- **Array**: Like a row of numbered lockers in a school hallway. You know where locker #5 is immediately ($O(1)$ access).
- **Linked List**: A treasure hunt scavenger hunt. Clue 1 tells you where Clue 2 is hidden, Clue 2 tells you where Clue 3 is. You cannot jump directly to Clue 5 without following the clues one by one!
- **Fast and Slow Pointers**: Two runners on a circular race track. The faster runner will eventually lap the slower runner from behind.

---

## 🎯 Interview Points

1. **What is a Dummy Head node?**
   - A dummy node (`const dummy = new ListNode(0); dummy.next = head;`) is a temporary placeholder placed before `head`. It simplifies edge cases when removing or inserting nodes at the very beginning of the list.
