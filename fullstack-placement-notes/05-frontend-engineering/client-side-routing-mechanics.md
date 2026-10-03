# Client-Side Routing: History API, SPA Fallback & Route Matching

## 1. What is it?
**Client-Side Routing** is the architectural technique used by Single Page Applications (SPAs)—such as React Router, TanStack Router, and Next.js—to update the URL in the browser's address bar and dynamically re-render the corresponding view without triggering a full page refresh from the web server.

It is powered by the **HTML5 History API** (`pushState`, `replaceState`, and the `popstate` event), which gives JavaScript direct programmatic control over the browser session history stack while maintaining backward and forward navigation buttons.

---

## 2. Why does it exist?
In traditional Multi-Page Applications (MPAs):
- Clicking a link (`<a href="/about">`) forces the browser to destroy the current DOM tree, tear down the JavaScript memory heap, issue a full HTTP GET request across the internet, re-download CSS/JS assets, and re-parse the entire page from scratch.
- The user sees a white screen flicker between pages, and application state (e.g. playing audio, open sidebars, draft form inputs) is completely destroyed.
- **The Client-Side Routing Solution**: When the user clicks a link, the router intercepts the click (`e.preventDefault()`), calls `history.pushState()`, updates the URL instantly, and renders the new component tree in place in **<5ms** with zero network round-trip latency.

---

## 3. Mental Model: The Scenic Bus Window vs. Teleportation
💡 **Think of an MPA as Teleporting between Rooms, and an SPA as a Single Stage with Swapping Sets:**

```
TRADITIONAL MPA (Demolish & Rebuild)
[ User Clicks Link ] ──> [ White Screen ] ──> [ Server Renders Full HTML ] ──> [ Full Re-render ]

CLIENT-SIDE SPA ROUTING (Instant Prop Swap)
┌─────────────────────────────────────────────────────────────┐
│  Browser Window (Persistent Stage)                          │
│  - Top Navbar remains mounted                               │
│  - Audio Player continues playing music                     │
│  - URL bar updates: /products $\rightarrow$ /checkout                   │
│  - Only the central <main> stage swaps sets!                │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. The HTML5 History API in Action

```typescript
// 1. pushState(stateObject, unusedTitle, newUrl)
// Pushes a new entry onto the browser's history stack and updates URL
window.history.pushState({ pageId: 'dashboard' }, '', '/dashboard');

// 2. replaceState(stateObject, unusedTitle, newUrl)
// Replaces the CURRENT history entry without creating a new "Back" button stop
window.history.replaceState({ query: 'filter=active' }, '', '/dashboard?filter=active');

// 3. Listening to Browser Back / Forward Button Clicks
window.addEventListener('popstate', (event) => {
  console.log('User navigated to:', window.location.pathname);
  console.log('Restored state payload:', event.state);
  // Router detects URL change and renders corresponding component!
});
```

> ⚠️ *Critical Rule*: `pushState` and `replaceState` do **NOT** trigger the `popstate` event! The `popstate` event is fired **only** when the user physically clicks the browser's Back/Forward buttons or calls `history.back()`.

---

## 5. The #1 Production Bug in SPAs: The 404 Server Rewrite Trap

In local development with Vite or Webpack Dev Server, clicking links and refreshing pages works seamlessly. But when junior developers deploy a React SPA to Nginx, AWS S3, or Apache, users report a catastrophic error:
> *"Navigating from the home page works fine, but whenever I refresh `https://myapp.com/dashboard`, the server returns a **404 Not Found**!"*

### Why This Happens:
1. When you navigate client-side, the browser never talks to the server; JavaScript simply painted the `/dashboard` screen.
2. When you hit **Refresh** (or paste the URL directly into a new tab), the browser makes a real HTTP network request to the server: `GET /dashboard`.
3. The server looks on its hard drive for a file called `/var/www/dashboard/index.html`. It doesn't exist! There is only a single root `/var/www/index.html`.
4. The server throws a **404 Not Found**.

### The Production Fix: The SPA Fallback Rule
Configure your web server (Nginx / CloudFront / Netlify) to rewrite all non-file requests back to `/index.html`:

```nginx
# Nginx Configuration for React / Vue SPAs:
server {
    listen 80;
    server_name myapp.com;
    root /var/www/my-spa-dist;

    location / {
        # Check if physical file ($uri) exists. If not, fallback to index.html!
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 6. Real Example: Building a Mini Client-Side Router

```tsx
import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

// 1. Router Context
const RouterContext = createContext<{ currentPath: string; navigate: (path: string) => void }>({
  currentPath: window.location.pathname,
  navigate: () => {},
});

export function RouterProvider({ children }: { children: ReactNode }) {
  const [currentPath, setCurrentPath] = useState(window.location.pathname);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (to: string) => {
    window.history.pushState({}, '', to);
    setCurrentPath(to); // Triggers re-render of active route!
  };

  return (
    <RouterContext.Provider value={{ currentPath, navigate }}>
      {children}
    </RouterContext.Provider>
  );
}

// 2. Custom Link Component (Prevents full page reload!)
export function Link({ to, children }: { to: string; children: ReactNode }) {
  const { navigate } = useContext(RouterContext);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    // Allow standard browser behavior for middle clicks or Ctrl+Click (new tab)
    if (e.metaKey || e.ctrlKey || e.button !== 0) return;

    e.preventDefault(); // HALT FULL PAGE RELOAD!
    navigate(to);
  };

  return <a href={to} onClick={handleClick}>{children}</a>;
}

// 3. Route Component
export function Route({ path, element }: { path: string; element: ReactNode }) {
  const { currentPath } = useContext(RouterContext);
  return currentPath === path ? <>{element}</> : null;
}
```

---

## 7. Route Matching: Radix Tree vs. Regex Matching

Modern routers (like Next.js App Router and TanStack Router) do not check routes using a linear array of regular expressions ($O(N)$). They organize routes into a **Radix Tree (Prefix Tree)**:

```
                      ROOT (/)
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
       /users                        /products
          │                             │
    /:userId (Dynamic param)      /:productId
          │
       /settings
```
- **Lookup Complexity**: Lookup in a Radix Tree is proportional to the **number of URL segments ($O(K)$)**, not the total number of routes in the app. A 2,000-route enterprise app matches routes in microseconds.

---

## 8. Common Mistakes

### Mistake 1: Using regular `<a>` tags instead of router `<Link>` components
```tsx
// ❌ WRONG: Destroys SPA benefits; causes full browser refresh and resets state!
<a href="/dashboard">Dashboard</a>

// ✅ CORRECT: Intercepts click via History API
<Link to="/dashboard">Dashboard</Link>
```

---

## 9. Best Practices

1. **Manage Scroll Restoration**: When navigating forward, scroll to top; when navigating back, restore previous scroll position:
   ```typescript
   if ('scrollRestoration' in window.history) {
     window.history.scrollRestoration = 'manual';
   }
   ```
2. **Support Keyboard Modifier Clicks**: Always allow users to Ctrl+Click or Cmd+Click a `<Link>` to open it in a new background browser tab.
3. **Use URL for Shareable UI State**: Filters, tabs, search queries, and page pagination should live in `URLSearchParams` (`?tab=billing&page=2`), not in local `useState`.

---

## 10. Performance Considerations

- **Code-Splitting per Route**: Never bundle every route into a single 5MB `bundle.js`. Pair routing with `React.lazy` and dynamic `import()` so the user only downloads the JavaScript required for the page they are currently visiting.

---

## 11. Security Considerations

- **Open Redirect Vulnerabilities**: When reading redirect target URLs from query parameters (`/login?redirect=https://evil.com`), always validate that the destination domain matches your own host origin to prevent phishing redirects.

---

## 12. Alternatives: Hash Routing vs Path Routing

| Feature | Path-based (`/users/123`) | Hash-based (`/#/users/123`) |
| :--- | :--- | :--- |
| **History API** | HTML5 `pushState` | `location.hash` / `hashchange` |
| **Server Requirements** | Requires SPA fallback rewrite | **Zero server setup** (hash never sent to server) |
| **SEO & Social Sharing** | Excellent | Poor (Search bots ignore hashes) |
| **Modern Recommendation** | 🌟 Standard | Legacy / Static hosting without rewrites |

---

## 13. Trade-offs

- **Benefit**: Native app-like transitions; zero white screen flickers; persistent layout state.
- **Cost**: Requires server-side fallback configuration; increases initial JS bundle size.

---

## 14. Real-World Usage

- **React Router & TanStack Router**: Powers 90% of client-side React single-page applications.
- **Next.js**: Hybrid router that combines client-side page transitions with Server Components.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the HTML5 History API and how does it enable Single Page Applications?**  
*Answer*: The HTML5 History API provides methods (`history.pushState()` and `history.replaceState()`) that allow JavaScript to update the URL in the browser's address bar without triggering a full page reload. By listening to the `window.onpopstate` event, client-side routers detect browser Back and Forward navigation and dynamically re-render the corresponding UI components in place.

### Conceptual
**Q: Why does refreshing an SPA route like `/users/42` return a 404 error on a standard production web server, and how is it resolved?**  
*Answer*: A standard web server interprets HTTP requests as paths to static files on its filesystem. When a user requests `/users/42`, the server looks for an actual file located at that directory path and returns a 404 when it is not found. To fix this, the server must be configured with an **SPA Fallback Rewrite Rule** (such as Nginx `try_files $uri /index.html;`) which serves the root `index.html` file for all incoming requests, allowing the client-side router to load and resolve the path in the browser.

### Implementation
**Q: How do you parse and update URL query parameters cleanly in modern vanilla JavaScript?**  
*Answer*: Use the native `URLSearchParams` API:
```typescript
// Reading:
const params = new URLSearchParams(window.location.search);
const page = params.get('page'); // '1'

// Updating without page refresh:
params.set('page', '2');
window.history.pushState({}, '', `${window.location.pathname}?${params.toString()}`);
```

### Debugging
**Q: A developer calls `history.pushState({}, '', '/new-path')`, but their `window.addEventListener('popstate')` handler does not run. Why?**  
*Answer*: By specification, `history.pushState` and `history.replaceState` **do not fire the `popstate` event**. The `popstate` event is exclusively fired by browser navigation actions, such as clicking the Back or Forward buttons or invoking `history.back()`. A custom client-side router must trigger state updates manually whenever it invokes `pushState`.

### Scenario
**Q: How do you prevent a user from accidentally losing unsaved form data when they click a navigation link or the browser Back button?**  
*Answer*: 
1. For page close / refresh: Listen to the `window.onbeforeunload` event and set `e.preventDefault()`.
2. For client-side route transitions: Intercept the router navigation pipeline (using React Router's `useBlocker` or `unstable_usePrompt`), inspect a dirty form flag, and present a confirmation modal before permitting the route change.

### Advanced
**Q: How does TanStack Router achieve 100% compile-time type safety for search params and dynamic route paths?**  
*Answer*: TanStack Router uses a file-based route tree generator and advanced TypeScript mapped and conditional types. It builds a global route declaration interface representing all static and dynamic paths, parameter types (`$id`), and Zod-validated search schemas. When writing `<Link to="/users/$id" params={{ id: '123' }} />`, TypeScript validates the path literal and enforces that all required route params and typed search parameters are provided at compile time.

---

## 16. Coding Challenge: Path Matcher Algorithm

**Task**: Implement a lightweight route matching function `matchPath(routePattern, currentPath)` that extracts dynamic parameters (e.g. `/users/:id/posts/:postId`).

```typescript
export function matchPath(
  pattern: string,
  pathname: string
): { matches: boolean; params: Record<string, string> } {
  const patternSegments = pattern.split('/').filter(Boolean);
  const pathSegments = pathname.split('/').filter(Boolean);

  if (patternSegments.length !== pathSegments.length) {
    return { matches: false, params: {} };
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < patternSegments.length; i++) {
    const patternSeg = patternSegments[i];
    const pathSeg = pathSegments[i];

    if (patternSeg.startsWith(':')) {
      // Dynamic Parameter: extract key name
      const paramName = patternSeg.slice(1);
      params[paramName] = decodeURIComponent(pathSeg);
    } else if (patternSeg !== pathSeg) {
      // Static segment mismatch
      return { matches: false, params: {} };
    }
  }

  return { matches: true, params };
}

// Verification:
const res = matchPath('/users/:userId/orders/:orderId', '/users/u101/orders/ord_999');
console.log(res);
// Output: { matches: true, params: { userId: 'u101', orderId: 'ord_999' } }
```

---

## 17. Common Interview Traps

1. **"`pushState` sends an HTTP request to the server."**  
   *Trap*: Thinking pushState makes an HTTP call.  
   *Reality*: `pushState` is entirely local to the browser. Zero network requests are sent.
2. **"Single Page Applications cannot have good SEO."**  
   *Trap*: Repeating early 2015 SPA myths.  
   *Reality*: While pure client-rendered SPAs can be slower for search crawlers, modern engines (Googlebot) execute JavaScript, and modern full-stack frameworks (Next.js, Remix) solve SEO completely via SSR and Server Components.

---

## 18. Revision Summary

- **History API**: `pushState`, `replaceState`, and `popstate` event.
- **SPA Fallback**: Nginx `try_files $uri /index.html;` is mandatory to avoid 404 on refresh.
- `pushState` updates the URL without network requests; `popstate` fires on Back/Forward clicks.
- Manage scroll restoration via `history.scrollRestoration = 'manual'`.

---

## 19. Quick Reference

```typescript
// Navigate programmatically
history.pushState({ id: 1 }, '', '/new-url');

// Listen to Back/Forward
window.addEventListener('popstate', (e) => {
  renderPath(window.location.pathname);
});
```
