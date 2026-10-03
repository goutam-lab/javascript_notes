# Server Components vs. Client Components

## 1. What is it?
In the Next.js App Router, components are divided into two distinct architectural categories:
1. **React Server Components (RSC):** Components that execute **strictly on the server**. They never download JavaScript to the client browser, can directly access server resources (databases, file systems, internal microservices), and serialize their rendered virtual DOM representation into an RSC payload stream.
2. **Client Components:** Components that are pre-rendered on the server into HTML during initial page load, and then hydrated on the client browser with JavaScript execution. They are declared with the `'use client'` directive at the top of the file, allowing the use of state (`useState`), effects (`useEffect`), event listeners (`onClick`), and browser APIs (`localStorage`, `window`).

```
+-------------------------------------------------------------------------------+
|                      RSC VS CLIENT COMPONENTS COMPARISON                      |
+---------------------------+-----------------------+---------------------------+
| Feature                   | Server Component (RSC)| Client Component ('use..')|
+---------------------------+-----------------------+---------------------------+
| Execution Location        | Server ONLY           | Server (SSR) + Browser    |
| Bundle Size to Client     | 0 KB                  | Size of component + deps  |
| Access to Databases/Files | Yes (Direct queries)  | No (Requires API/action)  |
| State & Lifecycle Hooks   | No (No useState)      | Yes (useState, useEffect) |
| Event Listeners           | No (No onClick)       | Yes                       |
| Browser APIs (window/DOM) | No                    | Yes (Inside useEffect)    |
| Default in App Router     | YES                   | No (Must specify directive|
+---------------------------+-----------------------+---------------------------+
```

---

## 2. Why does it exist?
Before React Server Components, the entire component tree and all imported libraries were packaged into client JavaScript bundles. This caused three major issues:
1. **Bundle Bloat:** If a component needed to render markdown using `marked` (30KB) and format dates using `moment.js` (70KB), every visitor downloaded and parsed 100KB of JavaScript, even if the markdown was purely static reading material.
2. **Security Vulnerabilities:** Developers frequently leaked database credentials or private API tokens by importing server libraries into client components.
3. **Data Fetching Waterfalls:** Components had to mount, run `useEffect`, fetch data from `/api/endpoint`, trigger a re-render, and cause child components to repeat the cycle.

Server Components eliminate client bundle bloat by keeping heavy dependencies on the server, fetching data directly with zero round-trip latency, and sending only the resulting UI structure to the client.

---

## 3. Mental Model
Think of Server Components as **Architectural Blueprints** and Client Components as **Interactive Gadgets**:
- The Server constructs the entire house (walls, roof, wiring) on the construction site and ships the finished solid structure (HTML + serialized tree).
- The Client only receives the interactive light switches and smart thermostats (interactive JS islands).
- You do not need to ship the cement mixer or the crane (database drivers, markdown parsers) to the homeowner!

```
SERVER REALM:
+-------------------------------------------------------------+
| ServerComponentPage (Queries DB directly)                   |
| ├── ServerHeader (Static HTML: 0 KB JS)                     |
| └── ClientInteractiveWidget ('use client' boundary)        |
|     ├── useState(), onClick()                               |
|     └── {children} ---> Can be a Server Component!          |
+-------------------------------------------------------------+
                              | (RSC Stream Protocol)
                              v
CLIENT REALM:
Only ClientInteractiveWidget code is downloaded & hydrated!
```

---

## 4. Basic Example

### Server Component (Default)
```typescript
// app/users/page.tsx
// Zero JS shipped to browser!
import db from '@/lib/db';

export default async function UsersPage() {
  const users = await db.user.findMany({ take: 10 });

  return (
    <div>
      <h1>Verified Users</h1>
      <ul>
        {users.map((u) => (
          <li key={u.id}>{u.name} ({u.email})</li>
        ))}
      </ul>
    </div>
  );
}
```

### Client Component (Marked with `'use client'`)
```typescript
// app/users/UserSearchFilter.tsx
'use client'; // This directive defines the boundary

import { useState } from 'react';

export function UserSearchFilter({ onFilter }: { onFilter: (q: string) => void }) {
  const [query, setQuery] = useState('');

  return (
    <input
      type="text"
      value={query}
      placeholder="Filter users..."
      onChange={(e) => {
        setQuery(e.target.value);
        onFilter(e.target.value);
      }}
      className="p-2 border rounded"
    />
  );
}
```

---

## 5. Real Example

### Interleaving Pattern: Passing Server Components as Children to Client Components
A common misconception is that a Client Component cannot render a Server Component. While a Client Component cannot directly *import* a Server Component, it can accept one via the `children` prop!

```typescript
// components/client/Accordion.tsx
'use client';

import { useState, ReactNode } from 'react';

interface AccordionProps {
  title: string;
  children: ReactNode; // Server Component can be passed here!
}

export function Accordion({ title, children }: AccordionProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border rounded-md my-2">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full text-left p-4 font-bold bg-gray-100 flex justify-between"
      >
        <span>{title}</span>
        <span>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && <div className="p-4 bg-white">{children}</div>}
    </div>
  );
}
```

```typescript
// app/reports/page.tsx (Server Component)
import { Accordion } from '@/components/client/Accordion';
import db from '@/lib/db';

export default async function ReportsPage() {
  // Heavy query executed on server
  const auditLogs = await db.auditLog.findMany({ take: 100 });

  return (
    <main className="p-8">
      <h1>Audit Records</h1>
      
      {/* Accordion is a Client Component, but auditLogs remains a 0-bundle Server Component */}
      <Accordion title="Security Audit Logs">
        <ul>
          {auditLogs.map((log) => (
            <li key={log.id}>{log.timestamp}: {log.action} by {log.actor}</li>
          ))}
        </ul>
      </Accordion>
    </main>
  );
}
```

---

## 6. Under the Hood

### 1. The `'use client'` Boundary Rule
The `'use client'` directive does NOT mean "execute only on the client." It defines the **cut-off point** between the server-only module graph and the client bundle module graph:
- When the bundler encounters `'use client'`, it marks that file and **every module imported into it** for compilation into the client JavaScript bundle.
- During initial SSR, the client component is rendered on the server to generate HTML tags.
- In the browser, hydration attaches event listeners and boots the component's state.

### 2. Network Boundary Serialization
When a Server Component passes props to a Client Component, those props cross the network boundary via the RSC protocol stream:
```
Server Component === (JSON-like RSC payload over HTTP) ===> Client Component
```
Because of this boundary:
- **Allowed Props:** Strings, numbers, booleans, arrays, plain objects, null, undefined, BigInt, TypedArrays, React Elements (JSX `children`), and Promises.
- **Forbidden Props:** Functions, class instances, Symbols, and DOM nodes.

---

## 7. Important Rules
1. **Directive Placement:** `'use client'` must be placed at the very top of the file before any `import` statements.
2. **Serialization Constraint:** Never attempt to pass non-serializable objects (like class instances with methods or callback functions) from a Server Component to a Client Component.
3. **Prevent Accidental Leaks with `server-only`:**
   ```bash
   npm install server-only
   ```
   Add `import 'server-only';` at the top of files that query databases or handle private encryption keys. If any developer accidentally imports this file into a Client Component, the build will immediately fail.
4. **Third-Party Component Wrapping:** Many npm libraries (e.g. `react-slick`, old icon libraries) use client hooks but lack the `'use client'` directive. Wrap them in a local Client Component before importing into Server Components.

---

## 8. Common Mistakes

### Mistake 1: Importing a Server-Only Module into a Client Component
```typescript
// components/UserCard.tsx
'use client';

import db from '@/lib/db'; // ❌ FATAL ERROR: Database connection packages cannot run in browser!

export function UserCard() {
  // ...
}
```

### Mistake 2: Directly Importing a Server Component into a Client Component
```typescript
// components/ClientTabs.tsx
'use client';

import ServerProfile from './ServerProfile'; // ❌ WRONG: ServerProfile will be compiled into the client bundle, losing server access!

export function ClientTabs() {
  return <div><ServerProfile /></div>;
}
```
**Fix:** Pass `ServerProfile` as `{children}` from a parent Server Component!

---

## 9. Best Practices
1. **Push Interactivity to the Leaves:** Design your component tree so that 80-90% of components are Server Components. Only wrap small interactive leaves (buttons, toggles, form fields) with `'use client'`.
2. **Third-Party Wrapper Pattern:**
   ```typescript
   // components/providers/ThemeProvider.tsx
   'use client';
   export { ThemeProvider } from 'styled-components'; // Re-export client-only package safely
   ```
3. **Use `client-only` for Browser-Specific Code:**
   ```typescript
   import 'client-only';
   // Ensures this utility (e.g. window.speechSynthesis helper) is never invoked during SSR
   ```

---

## 10. Performance Considerations
- **Bundle Weight Elimination:** In typical production migrations from Pages Router to App Router, client bundle sizes drop by 30% to 60% because data-fetching libraries, templating utilities, and formatting helpers remain on the server.
- **Parallel Data Fetching:** Multiple Server Components can fetch data in parallel without blocking parent components when wrapped in React Suspense.

---

## 11. Security Considerations
- **Automatic Secret Isolation:** Environment variables without the `NEXT_PUBLIC_` prefix are strictly inaccessible inside Client Components. In Server Components, all `process.env.SECRET_KEY` variables are completely accessible and physically cannot leak to the client browser.
- **Defense with `server-only`:** Always install and import `server-only` inside database connectors and payment service modules.

---

## 12. Alternatives
- **Traditional SSR (Pages Router `getServerSideProps`):** Ships full component JavaScript to the client even if the component is never interactive.
- **Static Site Generation (SSG `getStaticProps`):** Static HTML build, but all components still hydrate with JavaScript.

---

## 13. Trade-offs

| Criterion | Server Component | Client Component |
| :--- | :--- | :--- |
| **Initial Bundle Impact** | **0 KB** | Increases with code size |
| **Interactivity (onClick, state)** | None | Full React interactivity |
| **Data Fetching Speed** | Direct DB / zero client latency | Requires network fetch / Server Action |
| **SSR HTML Generation** | Yes | Yes (during initial load) |
| **Complexity** | High (serialization boundary) | Standard familiar React |

---

## 14. Real-World Usage
- **E-Commerce Product Detail Page:**
  - Product title, description, specifications, and related items: **Server Components** (0 KB bundle).
  - Image gallery carousel and color swatch selector: **Client Component** (`'use client'`).
  - Add to Cart button with optimistic feedback: **Client Component** (`'use client'`).
  - Customer review list with pagination: **Server Component passed as children**.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the purpose of the `'use client'` directive in Next.js?**  
*Answer:* `'use client'` marks the boundary between the server-only component tree and the client-rendered module graph. It instructs Next.js to package the component and all its dependencies into the client JavaScript bundle, allowing the use of React state, effects, event listeners, and browser APIs.

### Conceptual
**Q: Can a Client Component import a Server Component directly? How do you compose them?**  
*Answer:* No, a Client Component cannot directly import a Server Component because the Server Component code cannot run in the browser. However, a Server Component can be passed as a prop (most commonly the `children` prop) to a Client Component. The Server Component is rendered on the server, and its rendered output is passed through to the Client Component slot.

### Implementation
**Q: How do you prevent a database utility file from ever being imported into a Client Component?**  
*Answer:* Install `server-only` (`npm i server-only`) and add `import 'server-only';` at the top of the file. If imported into a Client Component, Next.js will throw a compile-time build error.

### Debugging
**Q: You pass an instance of `new Date()` as a prop from a Server Component to a Client Component, and React throws a warning/error during hydration. Why?**  
*Answer:* While Date objects can be serialized to ISO strings in recent versions of the RSC protocol, older setups or complex classes with methods lose their prototype methods during serialization, causing hydration mismatches. Always serialize values to plain strings or numbers (e.g. `date.toISOString()`).

### Scenario
**Q: You are adding a heavy charting library (Chart.js / Recharts, ~200KB) to a dashboard. How do you prevent it from slowing down the entire page?**  
*Answer:* Isolate the chart inside a small leaf Client Component (`<AnalyticsChart />`). Wrap it in a React Suspense boundary or use dynamic import with `ssr: false` (`next/dynamic`) so the heavy library is downloaded lazily in the background without blocking the initial page load.

### Advanced
**Q: Describe the exact sequence of events when a Client Component is rendered on initial page load vs on client-side navigation.**  
*Answer:*
- **Initial Load:** The Client Component is first executed on the server to produce initial HTML markup for fast First Contentful Paint (FCP). The client browser receives this HTML, downloads the client JS bundle, and executes hydration to attach event handlers.
- **Client Navigation (via `<Link>`):** The server does NOT generate full HTML. Next.js fetches only the RSC payload. The client-side router reconciles the tree, instantiates the Client Component directly in the browser DOM, and runs its hooks.

---

## 16. Coding Questions

### Problem: Build a Client-Side Modal that Renders Server-Fetched Content via Children Composition
```typescript
// components/Modal.tsx
'use client';

import { useState, ReactNode } from 'react';

export function Modal({ triggerLabel, children }: { triggerLabel: string; children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className="px-4 py-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700"
      >
        {triggerLabel}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-lg p-6 max-w-lg w-full shadow-2xl relative">
            <button 
              onClick={() => setIsOpen(false)}
              className="absolute top-3 right-3 text-gray-400 hover:text-gray-700"
            >
              ✕
            </button>
            <div className="mt-2">{children}</div>
          </div>
        </div>
      )}
    </>
  );
}
```

```typescript
// app/admin/users/page.tsx (Server Component)
import { Modal } from '@/components/Modal';
import db from '@/lib/db';

export default async function AdminUsersPage() {
  // Direct Server Database Query
  const sensitiveAuditData = await db.adminAudit.findMany({ take: 5 });

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Administration Console</h1>

      <Modal triggerLabel="View Sensitive Audit Logs">
        <h2 className="text-xl font-bold mb-2">Audit Trails (Confidential)</h2>
        <ul className="space-y-2">
          {sensitiveAuditData.map((log) => (
            <li key={log.id} className="text-sm border-b pb-1">
              <strong>{log.action}</strong> by {log.userEmail} at {log.createdAt.toISOString()}
            </li>
          ))}
        </ul>
      </Modal>
    </div>
  );
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "Server Components render once at build time and cannot be dynamic."  
  *Truth:* False. Server Components can be fully dynamic, executing on every incoming request when using dynamic functions (`cookies()`, `headers()`, or `no-store` fetches).
- **Trap 2:** "'use client' means the component will NOT be rendered on the server at all."  
  *Truth:* False. Client Components are pre-rendered into HTML on the server during initial page load for fast paint; they only skip server execution during subsequent client-side navigations.

---

## 18. Revision Summary
- Server Components are the default in App Router, have 0 KB client bundle size, and can access server resources directly.
- Client Components (`'use client'`) are required for interactivity, state, event listeners, and browser APIs.
- Compose them using the children pattern: pass Server Components as children to Client Components to preserve 0 KB bundle benefits.
- Use `server-only` to guarantee private secrets and database code never leak into the client bundle.

---

## 19. Quick Reference

```
+------------------------------------+------------------+--------------------+
| Need to perform:                   | Server Component | Client Component   |
+------------------------------------+------------------+--------------------+
| Fetch data from Database / Files   | ✅ Supported     | ❌ Forbidden       |
| Keep API keys / tokens secret      | ✅ Supported     | ❌ Leak risk       |
| Add onClick / onChange handlers    | ❌ Forbidden     | ✅ Supported       |
| Use useState / useEffect / hooks   | ❌ Forbidden     | ✅ Supported       |
| Use custom browser APIs (window)   | ❌ Forbidden     | ✅ Supported       |
| Zero client bundle size impact     | ✅ 0 KB shipped  | ❌ Adds JS bundle  |
+------------------------------------+------------------+--------------------+
```
