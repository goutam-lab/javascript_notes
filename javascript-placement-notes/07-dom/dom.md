# DOM Manipulation & Tree Architecture

The **DOM (Document Object Model)** is the bridge between HTML and JavaScript.

When a browser loads an HTML document, it translates all tags into a tree of JavaScript objects. JavaScript can then read, modify, add, or delete elements in real time.

---

## 1. Selecting Elements

In modern JavaScript, you primarily use `querySelector` and `querySelectorAll`.

```javascript
// 1. By ID (Fastest)
const header = document.getElementById("main-header");

// 2. Query Selector (First matching CSS selector)
const button = document.querySelector(".btn-submit");
const emailInput = document.querySelector("input[type='email']");

// 3. Query Selector All (All matching elements as a NodeList)
const allCards = document.querySelectorAll(".card");
allCards.forEach((card) => {
    // You can loop over a NodeList directly!
});
```

---

## 2. Changing Content: `textContent` vs `innerText` vs `innerHTML`

Interviewers frequently ask the difference between these three:

```javascript
const box = document.getElementById("box");

// 1. textContent (Best Practice for text):
// Returns all raw text, even hidden text. Very fast and safe.
box.textContent = "Welcome back, Goutam!";

// 2. innerText:
// Aware of styling. Does NOT return text hidden by CSS (e.g. display: none).

// 3. innerHTML (Danger zone):
// Parses strings as actual HTML elements.
box.innerHTML = "<strong>Bold Warning!</strong>";
```

### ⚠️ Security Warning on `innerHTML` (XSS Attack!)
Never use `innerHTML` to display user input (like a chat message or comment).
A malicious user can inject a script:
`<img src="invalid" onerror="stealCookies()">`
This is called a **Cross-Site Scripting (XSS)** vulnerability! Always prefer `textContent`.

---

## 3. Modifying Styles and Classes

Avoid directly editing inline styles with `element.style.color = "red"`.
Instead, toggle CSS classes with **`classList`**:

```javascript
const card = document.querySelector(".card");

card.classList.add("highlight");
card.classList.remove("dim");
card.classList.toggle("active"); // Adds if missing, removes if present!
console.log(card.classList.contains("active")); // true or false
```

---

## 4. Creating, Inserting & Appending Elements

```javascript
// 1. Create element in memory:
const newBadge = document.createElement("span");

// 2. Add text and classes:
newBadge.textContent = "New Feature";
newBadge.classList.add("badge", "badge-primary");

// 3. Attach to parent in the DOM tree:
const container = document.getElementById("container");

container.append(newBadge);  // Inserts at the END
container.prepend(newBadge); // Inserts at the BEGINNING

// 4. Removing an element:
newBadge.remove(); // Deletes from DOM
```

---

## 5. `append()` vs `appendChild()` vs `prepend()`

- **`append()`**: Modern method. Accepts **multiple nodes AND plain text strings** (`container.append(li, "Hello")`). Returns `undefined`.
- **`appendChild()`**: Legacy method. Accepts **only one single Node**. Throws error on strings. Returns the appended node.
- **`prepend()`**: Inserts at the **beginning** of the parent container.

---

## 6. High-Performance DOM Batching: `DocumentFragment`

Appending elements in a loop triggers multiple browser **reflows and repaints**:
```javascript
// ❌ Bad Performance (1,000 reflows):
for (let i = 0; i < 1000; i++) {
  const li = document.createElement("li");
  li.textContent = i;
  list.append(li);
}

// ✅ High-Performance Senior Way (1 single reflow!):
const fragment = document.createDocumentFragment();
for (let i = 0; i < 1000; i++) {
  const li = document.createElement("li");
  li.textContent = i;
  fragment.append(li);
}
list.append(fragment); // Single DOM touch!
```

---

## 7. Working with Attributes

```javascript
const link = document.createElement("a");

link.setAttribute("href", "https://google.com");
link.setAttribute("target", "_blank");
console.log(link.getAttribute("href")); // "https://google.com"

link.removeAttribute("target"); // Removes target attribute
```

---

## 💡 Think of it like this

- HTML is the blueprinted frame of a house.
- The DOM is the living, furnished house.
- JavaScript is your smart home system that can paint the walls a new color, knock down a drywall partition, or hang up a new photo frame anytime you press a button!

---

## 🎯 Interview Points

1. **What is the difference between an `HTMLCollection` and a `NodeList`?**
   - `HTMLCollection` (returned by `getElementsByClassName` or `getElementsByTagName`) is **live**—if the DOM changes, the collection updates automatically. It lacks array methods.
   - `NodeList` (returned by `querySelectorAll`) is usually **static** (a snapshot in time) and supports `.forEach()`.

2. **What is DOM Reflow and Repaint?**
   - **Reflow**: When a change affects the layout of the page (geometry, width, height, position). The browser recalculates the position of all affected elements. (Expensive!).
   - **Repaint**: When a visual change occurs that doesn't alter geometry (background color, visibility). Faster than reflow.
