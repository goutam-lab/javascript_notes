# Graphs in JavaScript & 2D Grid Algorithms

A **Graph** is a non-linear data structure consisting of **vertices (nodes)** connected by **edges**.

Unlike trees, graphs can have cycles and do not have a designated "root" node.

---

## 1. Representing Graphs: The Adjacency List

In JavaScript, the cleanest way to store a graph is using a **Map** or plain **Object** where keys are nodes and values are arrays of neighbors:

```javascript
const graph = {
    A: ["B", "C"],
    B: ["A", "D", "E"],
    C: ["A", "F"],
    D: ["B"],
    E: ["B", "F"],
    F: ["C", "E"]
};
```

---

## 2. Graph Traversals: BFS vs DFS

To prevent infinite loops when traversing graphs with cycles, you **must track visited nodes** using a `Set`.

### Breadth-First Search (BFS) — Uses a Queue
Explores neighbor by neighbor in concentric circles (finds shortest paths!):

```javascript
function bfsGraph(graph, startNode) {
    const visited = new Set([startNode]);
    const queue = [startNode];

    while (queue.length > 0) {
        const node = queue.shift();
        console.log("Visited:", node);

        for (const neighbor of graph[node] || []) {
            if (!visited.has(neighbor)) {
                visited.add(neighbor);
                queue.push(neighbor);
            }
        }
    }
}
```

### Depth-First Search (DFS) — Uses Recursion
Dives deep down a single path until hitting a dead end:

```javascript
function dfsGraph(graph, startNode, visited = new Set()) {
    visited.add(startNode);
    console.log("Visited:", startNode);

    for (const neighbor of graph[startNode] || []) {
        if (!visited.has(neighbor)) {
            dfsGraph(graph, neighbor, visited);
        }
    }
}
```

---

## 3. The #1 Placement Problem: Number of Islands (Grid DFS)

Given an $m \times n$ 2D binary grid where `'1'` represents land and `'0'` represents water, return the number of distinct islands.

```javascript
function numIslands(grid) {
    if (!grid || grid.length === 0) return 0;

    let count = 0;
    const rows = grid.length;
    const cols = grid[0].length;

    // Helper: Sinks the current island by turning connected '1's into '0's
    function sinkIsland(r, c) {
        // Boundary checks and water check:
        if (r < 0 || c < 0 || r >= rows || c >= cols || grid[r][c] === "0") {
            return;
        }

        // Mark as visited by mutating to '0'
        grid[r][c] = "0";

        // Explore 4 directions (Up, Down, Left, Right):
        sinkIsland(r + 1, c);
        sinkIsland(r - 1, c);
        sinkIsland(r, c + 1);
        sinkIsland(r, c - 1);
    }

    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (grid[r][c] === "1") {
                count++;
                sinkIsland(r, c); // Sink the whole connected island!
            }
        }
    }

    return count;
}
```

- **Time Complexity:** $O(M \times N)$
- **Space Complexity:** $O(M \times N)$ (worst-case recursion stack)

---

## 💡 Think of it like this

- **BFS**: Dropping a stone into a still pond. Ripples expand outward uniformly layer by layer.
- **DFS**: Exploring a winding maze. You walk as far forward as possible down a corridor until you hit a dead-end wall, then backtrack to the last intersection!

---

## 🎯 Interview Points

1. **How do you find the shortest path in an unweighted graph?**
   - **Always use BFS!** Because BFS searches layer by layer, the first time it reaches the target node, it is mathematically guaranteed to be the shortest path.
