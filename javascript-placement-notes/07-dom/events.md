# DOM Events, Bubbling & Event Delegation

Every click, keypress, scroll, or form submit in the browser is an **Event**.

Understanding how events propagate through the DOM tree is a mandatory interview topic.

---

## 1. Adding Event Listeners

Use `addEventListener(event, callback)`:

```javascript
const btn = document.querySelector("#submit-btn");

btn.addEventListener("click", (event) => {
    console.log("Button clicked!");
});
```

---

## 2. `e.target` vs `e.currentTarget` (Top Interview Question!)

Inside an event handler, you get an **Event object (`e`)**:

- **`e.target`**: The **exact element that was clicked** (the deepest child element where the user pressed their mouse).
- **`e.currentTarget`**: The element that has the **`addEventListener` attached to it**.

```javascript
// Suppose we have: <button id="btn"><span>Click Me</span></button>
const button = document.getElementById("btn");

button.addEventListener("click", (e) => {
    console.log("target:", e.target.tagName);           // SPAN (if clicked on text)
    console.log("currentTarget:", e.currentTarget.tagName); // BUTTON
});
```

---

## 3. Event Propagation: Bubbling vs Capturing

When you click an element nested inside other elements, the event does not trigger only on that element!
It travels through **3 phases**:

```
1. CAPTURING PHASE (Trickling Down)
   Window ──► Document ──► <body> ──► <div> (Parent)
                                         │
2. TARGET PHASE                          ▼
   Triggered on the clicked <button> ────┘
                                         │
3. BUBBLING PHASE (Bubbling Up)          ▲
   <button> ──► <div> ──► <body> ──► Document ──► Window
```

- **Event Capturing**: Event travels down from `Window` down to the target. (Rarely used, enabled by passing `{ capture: true }`).
- **Event Bubbling**: The default behavior! The event bubbles straight up from the clicked target element all the way to `window`, like a bubble of air rising through water.

---

## 4. Stopping Events: `stopPropagation()` vs `preventDefault()`

### `e.preventDefault()`
Prevents the browser's default native action:
- Prevents a form from submitting and reloading the page.
- Prevents an `<a>` tag from navigating to a new URL.
- Does **NOT** stop bubbling!

```javascript
const form = document.querySelector("form");
form.addEventListener("submit", (e) => {
    e.preventDefault(); // Stop page reload!
    console.log("Handling form via AJAX / Fetch");
});
```

### `e.stopPropagation()`
Stops the event from bubbling up to parent elements in the DOM tree.

```javascript
button.addEventListener("click", (e) => {
    e.stopPropagation(); // Parent containers will NOT hear this click!
});
```

---

## 5. Event Delegation (The Senior Developer Pattern)

### 1. The Problem
Imagine you have 1,000 buttons inside a container:

```html
<div id="products">
  <button>Buy iPhone</button>
  <button>Buy Laptop</button>
  <!-- ... 998 more buttons -->
</div>
```

The naive approach adds a listener to every button:
```javascript
// ❌ Naive: 1,000 listeners taking up memory!
const buttons = document.querySelectorAll("#products button");
buttons.forEach(button => {
  button.addEventListener("click", () => console.log(button.textContent));
});
```

---

### 2. How Event Delegation Works
Because events **bubble up**, we put **one single listener on the parent container**:

```javascript
const products = document.querySelector("#products");

products.addEventListener("click", (event) => {
  console.log(event.target.textContent);
});
```

```
Click button
     ↓
button receives click (Target Phase)
     ↓
event bubbles up (Bubbling Phase)
     ↓
#products parent listener catches it!
     ↓
event.target tells us which button was clicked
```

---

### 3. The Nested Child Trap: Why `matches()` Can Fail
Real-world buttons often have inner `<span>` or icon tags:

```html
<button class="buy">
  <span>Buy</span>
</button>
```

If the user clicks on the word "Buy", `event.target` is the `<span>`, NOT the `<button>`!

Checking `event.target.matches(".buy")` **fails** because the `span` doesn't have class `.buy`.

This is where **`closest()`** saves the day!

---

### 4. The Power of `closest()`
`closest()` searches **upward** from the clicked element through its ancestors until it finds the matching selector:

```javascript
const button = event.target.closest(".buy");
```

If the user clicked the `<span>`:
- `event.target` is `span`.
- `event.target.closest(".buy")` checks `span` (no), checks its parent `button.buy` (MATCH!), and returns the button.

---

### 5. The Real Implementation & Guard Clause
```javascript
const products = document.querySelector("#products");

products.addEventListener("click", (event) => {
  const button = event.target.closest(".buy");

  // Guard clause: stop if the click was outside any .buy button
  if (!button) return;

  console.log(button.textContent.trim());
});
```

**Why `if (!button) return;`?**  
If the container has headers, padding, or text outside buttons (e.g. `<h1>Products</h1>`), clicking them returns `null`. The guard clause prevents `TypeError` crashes!

---

### 6. `matches()` vs `closest()`

- **`matches(selector)`**: Checks **only THIS element**. Is the clicked element itself `.buy`?
- **`closest(selector)`**: Checks **THIS element + all ancestors upward**. Is this element or any of its parents `.buy`?

---

### 7. Real Shopping Cart Example
```html
<div id="cart">
  <div class="product">
    <span>iPhone 15</span>
    <button class="remove">Remove</button>
  </div>
  <div class="product">
    <span>MacBook Pro</span>
    <button class="remove">Remove</button>
  </div>
</div>
```

```javascript
const cart = document.querySelector("#cart");

cart.addEventListener("click", (event) => {
  const removeBtn = event.target.closest(".remove");
  if (!removeBtn) return;

  // Navigate up from the button to find its parent product card:
  const productCard = removeBtn.closest(".product");
  productCard.remove(); // Deletes the entire item row!
});
```

---

### 8. Dynamic Elements (The Killer Feature)
If you dynamically create and append new elements via JavaScript later:
```javascript
const newBtn = document.createElement("button");
newBtn.className = "buy";
newBtn.textContent = "Buy Tablet";
products.appendChild(newBtn);
```
You **do NOT need to attach a new event listener**. The parent delegation handler handles it automatically!

---

## 💡 Think of it like this

- **Event Bubbling**: You tap on a microphone inside your bedroom. The sound travels into the hallway, then down the stairs, and out into the front yard (up the hierarchy).
- **Event Delegation**: Instead of hiring 50 security guards to stand outside 50 individual hotel room doors, you place one single security guard at the main hotel lobby entrance (parent element) to check everyone as they pass through!
- **`closest()`**: Looking up your family tree until you find the first relative with a college degree. If you have one, it stops at you. If not, it checks your parents, then grandparents!

---

## 🎯 Interview Points

1. **Top Placement Question:**
   ```html
   <ul id="list">
     <li class="item">
       <span>Apple</span>
     </li>
   </ul>
   ```
   ```javascript
   list.addEventListener("click", (event) => {
     const item = event.target.closest(".item");
     if (!item) return;
     console.log(item.textContent.trim());
   });
   ```
   **Q: If you click the `<span>` containing "Apple", what prints, and why does `closest(".item")` find the `<li>`?**  
   - **Output:** It prints `"Apple"`.  
   - **Why:** The click target (`event.target`) is the `<span>`. When `event.target.closest(".item")` runs, it checks `span` (doesn't match), and immediately traverses upward to its parent `<li class="item">`. Because the parent matches `.item`, `closest()` returns that `<li>`!

2. **What is the difference between `e.stopPropagation()` and `e.stopImmediatePropagation()`?**
   - `e.stopPropagation()` stops the event from bubbling to parent elements, but allows other listeners on the **same element** to run.
   - `e.stopImmediatePropagation()` stops the event from bubbling AND prevents all other click listeners on that **exact same element** from firing!
