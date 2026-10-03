# Placement-Grade JavaScript Projects Guide

Having 2 or 3 solid, well-architected JavaScript projects on your resume will set you apart from 95% of candidates who only have basic to-do apps.

Here is a curated roadmap of projects from beginner to full-stack, with the exact technical skills each project proves to an interviewer.

---

## 🟢 Level 1: DOM & Core Logic Projects (Beginner)

### 1. Interactive Expense Tracker & Splitter
- **Concepts Demonstrated:** DOM manipulation, Event delegation, `localStorage` persistence, array filtering, dynamic calculation.
- **Key Feature:** Users can add expenses with categories, filter by month, split bills between roommates, and persist data in `localStorage`.
- **Resume Bullet:** *"Engineered an expense splitting app with client-side localStorage synchronization and event delegation for high DOM rendering performance."*

### 2. Multi-Step Quiz Application with Timer
- **Concepts Demonstrated:** Closures, `setInterval` timer management, array shuffling algorithms (Fisher-Yates), state transitions.
- **Key Feature:** 15-second countdown timer per question, score tracking, dynamic question rendering, and detailed review screen at the end.

---

## 🟡 Level 2: Async & API Projects (Intermediate)

### 3. GitHub Developer Portfolio & Repository Inspector
- **Concepts Demonstrated:** `fetch()` API, `async/await`, error handling (404 / rate limiting), Debounced search input, DOM templating.
- **Key Feature:** Search any GitHub username with a 400ms debounced input. Displays stats (stars, top languages, follower counts) with skeleton loading spinners.
- **Resume Bullet:** *"Built a developer lookup dashboard leveraging GitHub REST API, implementing custom debouncing to cut redundant network calls by 70%."*

### 4. Real-Time Weather & Air Quality Radar
- **Concepts Demonstrated:** Geolocation API, Promise chaining, `Promise.all` for multi-source data (Weather API + Air Quality API), conditional CSS themes (Rain/Sun/Snow).

---

## 🔴 Level 3: Advanced Frontend & Engineering Projects

### 5. Infinite Scroll Image Gallery with Virtualization
- **Concepts Demonstrated:** `IntersectionObserver` API, Throttling scroll events, memory cleanup, lazy image loading.
- **Key Feature:** Fetches photos dynamically as the user scrolls. Unloads off-screen DOM nodes to keep browser memory footprint minimal.
- **Resume Bullet:** *"Implemented high-performance infinite scroll gallery using IntersectionObserver API, achieving 60fps rendering without memory bloat."*

### 6. Interactive Kanban Board (Trello Clone)
- **Concepts Demonstrated:** HTML5 Drag & Drop API, Object-Oriented JavaScript (Classes), State immutability, LocalStorage serialization.
- **Key Feature:** Drag tasks between "To Do", "In Progress", and "Done" columns with live re-ordering and custom tagging.

---

## 🚀 Level 4: Full-Stack JavaScript Projects (Top Tier)

### 7. Real-Time Collaborative Whiteboard / Chat App
- **Tech Stack:** Node.js, Express, WebSockets (`Socket.io`), HTML5 Canvas, Vanilla JS.
- **Concepts Demonstrated:** Full-duplex asynchronous communication, Event-driven architecture, binary canvas streaming, connection heartbeat.
- **Resume Bullet:** *"Architected real-time multi-user drawing board using WebSockets and Canvas API with sub-50ms latency synchronization."*

### 8. Custom Frontend Build Tool / State Store (Redux from Scratch)
- **Concepts Demonstrated:** Observer Pattern, Publish/Subscribe, Pure Functions, Reducers, Deep Object Immutability.
- **Key Feature:** Build a minimal clone of Redux (`createStore(reducer)`) with `dispatch`, `subscribe`, and `getState`.
- **Why Interviewers Love This:** It proves you understand state management libraries from the inside out, not just as a consumer!
