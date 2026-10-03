# Error Boundaries & Frontend Application Resilience

## 1. What is it?
An **Error Boundary** is a specialized React component that catches JavaScript errors anywhere in its child component tree during rendering, in lifecycle methods, and in constructors, logs those errors to an observability service (such as Sentry or Datadog), and displays a graceful fallback UI instead of crashing the entire application into a blank white screen.

Error boundaries provide **declarative fault tolerance**: if a single widget (like an advertisement banner or a comment widget) throws an unhandled exception, only that specific widget is replaced with an error fallback, leaving the rest of the application (navigation bar, shopping cart, user profile) fully operational.

---

## 2. Why does it exist?
Prior to React 16:
- A single JavaScript error inside any component's render method corrupted React's internal state machine.
- React would unmount the **entire root component tree** from the DOM, producing the infamous **"White Screen of Death"** (`Uncaught Error: Minified React error...`).
- A user trying to complete a checkout would lose their entire cart because a third-party analytics tracker failed to render an icon.
- **The Error Boundary Solution**: Borrowing the concept of `try / catch` blocks from imperative programming and bringing it declaratively to component hierarchies.

---

## 3. Mental Model: Declarative `try / catch` Blocks
💡 **Think of Electrical Circuit Breakers in a Modern Building:**

```
                  MAIN APARTMENT (App)
                           │
      ┌────────────────────┴────────────────────┐
      ▼                                         ▼
[ Kitchen Circuit Breaker ]           [ Living Room Circuit Breaker ]
(Error Boundary A)                    (Error Boundary B)
      │                                         │
 ┌────┴────┐                               ┌────┴────┐
 ▼         ▼                               ▼         ▼
Toaster   Fridge                          TV       Audio
(Short circuit!)
      │
      ▼
*BREAKER TRIPS!*
Only Toaster & Fridge lose power.
TV and Audio continue playing without interruption!
```

- In a house, if a toaster short-circuits, only the kitchen circuit breaker trips. The entire house doesn't plunge into darkness.
- In a resilient React architecture, wrapping major layout sectors (e.g., `<Sidebar>`, `<MainFeed>`, `<CheckoutCart>`) in distinct Error Boundaries ensures that an isolated component failure is contained within its own subtree.

---

## 4. Basic Example: The Class-Based Error Boundary

As of React 18 & 19, Error Boundaries **must be implemented as Class Components** because there are no hook equivalents for `componentDidCatch` or `getDerivedStateFromError`.

```tsx
import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  // 1. Update state so next render shows fallback UI (Render Phase)
  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  // 2. Catch side-effects: log to telemetry (Commit Phase)
  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Unhandled React Render Error:', error, errorInfo);
    // Send to external monitoring: Sentry.captureException(error, { extra: errorInfo });
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div role="alert" className="error-card">
          <h2>Something went wrong.</h2>
          <p>{this.state.error?.message}</p>
        </div>
      );
    }

    return this.props.children;
  }
}
```

---

## 5. Real Example: Production Resilient Boundary with Reset & Key Recovery

In real enterprise systems, an Error Boundary must allow the user to **retry** after failure, and automatically recover when the user navigates away or changes parameters.

```tsx
import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackRender?: (props: { error: Error; resetErrorBoundary: () => void }) => ReactNode;
  onReset?: () => void;
  resetKeys?: Array<unknown>; // Reset boundary automatically if any key changes
}

interface State {
  error: Error | null;
}

export class ResilientErrorBoundary extends Component<Props, State> {
  public state: State = { error: null };

  public static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    // In production: send to Datadog / Sentry with breadcrumbs
    console.error('[Telemetry] Component crashed at:', info.componentStack);
  }

  public componentDidUpdate(prevProps: Props): void {
    const { error } = this.state;
    const { resetKeys } = this.props;

    // Automatically recover if resetKeys changed (e.g. route URL or entity ID changed)
    if (error !== null && resetKeys && prevProps.resetKeys) {
      const hasChanged = resetKeys.some((val, idx) => !Object.is(val, prevProps.resetKeys![idx]));
      if (hasChanged) {
        this.resetErrorBoundary();
      }
    }
  }

  public resetErrorBoundary = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  public render(): ReactNode {
    const { error } = this.state;

    if (error !== null) {
      if (this.props.fallbackRender) {
        return this.props.fallbackRender({
          error,
          resetErrorBoundary: this.resetErrorBoundary,
        });
      }

      return (
        <div className="error-fallback-box" role="alert">
          <h3>Failed to load this module</h3>
          <p className="error-text">{error.message}</p>
          <button onClick={this.resetErrorBoundary} className="retry-btn">
            🔄 Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
```

---

## 6. What Error Boundaries Catch vs. DO NOT Catch

This is one of the most tested placement interview distinctions in React:

```
┌──────────────────────────────────────────────┬──────────────────────────────────────────────┐
│ ✅ WHAT ERROR BOUNDARIES CATCH               │ ❌ WHAT ERROR BOUNDARIES DO NOT CATCH        │
├──────────────────────────────────────────────┼──────────────────────────────────────────────┤
│ 1. Errors thrown during the Render phase.    │ 1. Event Handlers (`onClick`, `onSubmit`).   │
│ 2. Errors inside Component Lifecycle methods │ 2. Asynchronous code (`setTimeout`,          │
│    (`componentDidMount`, `useLayoutEffect`). │    `requestAnimationFrame`, Promises).       │
│ 3. Errors inside Child Component             │ 3. Server-Side Rendering (SSR errors).       │
│    constructors.                             │ 4. Errors thrown INSIDE the Error Boundary   │
│ 4. Errors in subtrees beneath the boundary.  │    component itself (not its children).      │
└──────────────────────────────────────────────┴──────────────────────────────────────────────┘
```

### Why Don't Error Boundaries Catch Event Handlers?
- React does not need an error boundary to recover from an error in an event handler (like `onClick`).
- Unlike the Render method (which produces the visual UI tree), an event handler error **does not corrupt the DOM or React's Fiber state machine**.
- If an `onClick` throws, the UI is still rendered and healthy. You should use standard JavaScript `try / catch` blocks inside event handlers!

---

## 7. Important Rules

1. **`getDerivedStateFromError` Must Be a Pure Function**: It is invoked during the Render Phase. Do not trigger side effects (like API calls) inside it.
2. **`componentDidCatch` Is for Side Effects**: It is executed during the Commit Phase. Perform logging, telemetry reporting, and metrics tracking here.
3. **Error Boundaries Only Catch Errors in Children**: An Error Boundary cannot catch an error thrown inside its own `render()` method. It must be situated higher up in the component tree.
4. **Always Provide a Clear Recovery Path**: Never trap a user in an unrecoverable error state; always provide a "Retry", "Refresh", or "Go Home" button.

---

## 8. Common Mistakes

### Mistake 1: Relying on Error Boundaries to catch broken API calls in `useEffect`
```tsx
// ❌ WRONG: This error will NOT be caught by an Error Boundary!
function UserList() {
  const [users, setUsers] = useState([]);

  useEffect(() => {
    fetch('/api/users')
      .then(res => res.json())
      .then(data => {
        if (!data.success) throw new Error('API failed!'); // 💥 Unhandled rejection!
        setUsers(data.users);
      });
  }, []);

  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}

// ✅ CORRECT: Catch the async error and update state, or re-throw during render
function UserList() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState<Error | null>(null);

  // If you re-throw during render, the Error Boundary WILL catch it!
  if (error) {
    throw error;
  }

  useEffect(() => {
    fetch('/api/users')
      .then(res => res.json())
      .then(data => setUsers(data.users))
      .catch(err => setError(err)); // Set state -> triggers re-render -> re-throws!
  }, []);

  return <ul>{users.map(u => <li key={u.id}>{u.name}</li>)}</ul>;
}
```

---

## 9. Best Practices

1. **Granular Placement (Subtree Isolation)**: Place Error Boundaries around independent widgets (e.g. Chat Box, Product Grid, Navigation). Do not just put one boundary at `<App />`.
2. **Key-Based Reset**: Reset an error boundary when routing changes by providing the current URL pathname as a key:
   ```tsx
   <ErrorBoundary key={location.pathname}>
     <PageContent />
   </ErrorBoundary>
   ```
3. **Use the Industry Standard Library**: In real projects, utilize `react-error-boundary` (by Kent C. Dodds), which provides `useErrorBoundary` hook for imperatively throwing errors into boundaries from async code.

---

## 10. Performance Considerations

- Error boundaries introduce negligible overhead during normal rendering; they are lightweight Fiber container nodes.
- When an error occurs, unmounting the broken subtree releases memory and prevents runaway re-render loops or memory leaks caused by failed closures.

---

## 11. Security Considerations

- **Never Expose Raw Stack Traces to End Users in Production**: Stack traces reveal internal folder paths, server endpoints, and implementation details. Only display friendly error messages in production, logging full stack traces securely to your backend monitoring system.

---

## 12. Alternatives

| Technique | Scope | When to Use |
| :--- | :--- | :--- |
| **Error Boundary** | Component Tree (Render phase) | Catching crashes in UI rendering and third-party widgets |
| **`try / catch`** | Imperative code | Event handlers, async fetch calls, data parsing |
| **Window Error Listener** | Global window (`window.onerror`) | Catching unhandled script load errors and resource 404s |
| **Promise Rejection Listener** | `window.onunhandledrejection` | Catching unhandled Promise rejections across the runtime |

---

## 13. Trade-offs

- **Benefit**: Zero blank screen crashes; isolated failure containment; automatic error telemetry.
- **Cost**: Requires class components (or external wrapper libraries); adds boilerplate if overused around trivial single elements.

---

## 14. Real-World Usage

- **E-Commerce Apps (Amazon/Shopify)**: If a recommendation engine fails, the page still renders the product title, images, and "Add to Cart" button.
- **Dashboard Applications (Linear/Jira)**: If an issue comment crashes due to corrupted markdown, the surrounding ticket details remain editable.

---

## 15. Placement Interview Questions

### Basic
**Q: What is an Error Boundary in React?**  
*Answer*: An Error Boundary is a React component that catches JavaScript errors anywhere in its child component tree during rendering, lifecycle methods, and constructors. It logs the error and displays a fallback UI instead of crashing the whole component tree into a blank white screen.

### Conceptual
**Q: Why must Error Boundaries be class components in React 18?**  
*Answer*: React has not yet implemented hook equivalents for the lifecycle methods `static getDerivedStateFromError` (which renders fallback UI) and `componentDidCatch` (which handles side-effects/logging). Until React adds a `useErrorBoundary` hook natively, Error Boundaries must be written as class components.

### Implementation
**Q: How can you catch an asynchronous error (like a failed `fetch`) with an Error Boundary?**  
*Answer*: Error boundaries cannot catch errors thrown inside asynchronous callbacks directly. To catch an async error, you must capture the error in local component state (`setError(err)`) and re-throw the error **during the synchronous render phase**:
```tsx
const [error, setError] = useState(null);
if (error) throw error; // Thrown during render -> Caught by Error Boundary!
```

### Debugging
**Q: A user clicks a button, an error is thrown in `handleFormSubmit`, but the Error Boundary does not trigger. Why?**  
*Answer*: Error boundaries do not catch errors inside **event handlers**. Event handlers run outside the Render Phase and do not corrupt React's Virtual DOM rendering pipeline. Event handlers should be protected using traditional imperative `try / catch` blocks.

### Scenario
**Q: How do you design an enterprise dashboard so that if the "Stock Ticker" widget crashes, the user can still trade stocks?**  
*Answer*: We implement granular Error Boundaries. Instead of wrapping the entire `<Dashboard />` in a single global Error Boundary, we isolate the `<StockTicker />` inside its own dedicated `<ErrorBoundary fallback={<TickerOfflineMessage />}>`. If the ticker crashes, only its bounding box displays the fallback, while the adjacent `<TradeExecutionPanel />` continues functioning normally.

### Advanced
**Q: How does React Fiber handle an unhandled exception thrown in `beginWork` during the Render Phase?**  
*Answer*: When an exception is thrown during `beginWork`, React catches it in the work loop and enters `throwException()`. It traverses up the Fiber tree using the `return` pointers until it discovers a Fiber node with the `ClassComponent` tag that implements `getDerivedStateFromError`. React marks that Fiber with the `DidCapture` flag, queues an update to render its fallback UI, and unmounts the throwing child subtree. If no Error Boundary is found, React unmounts the entire root container.

---

## 16. Coding Challenge: Custom `useErrorHandler` Bridge

**Task**: Implement a custom hook `useErrorHandler` that allows functional components to dispatch asynchronous errors (from `setTimeout` or `fetch`) directly to the nearest parent Error Boundary.

```tsx
import { useState, useCallback } from 'react';

/**
 * A custom hook that returns a function to dispatch async errors
 * to the nearest React Error Boundary by throwing during render.
 */
export function useErrorHandler(): (error: unknown) => void {
  const [, setError] = useState<() => void>();

  return useCallback((error: unknown) => {
    setError(() => {
      // Throwing inside this state updater runs during the next render cycle,
      // which allows the parent Error Boundary to catch it!
      throw error instanceof Error ? error : new Error(String(error));
    });
  }, []);
}

// Usage Example in a Functional Component:
export function AsyncProfileWidget() {
  const handleError = useErrorHandler();

  function triggerAsyncOperation() {
    setTimeout(() => {
      try {
        // Risky async calculation or network call
        throw new Error('Async timer operation failed catastrophically!');
      } catch (err) {
        handleError(err); // Bridges async error directly into Error Boundary!
      }
    }, 1000);
  }

  return <button onClick={triggerAsyncOperation}>Trigger Async Crash</button>;
}
```

---

## 17. Common Interview Traps

1. **"Can an Error Boundary catch errors inside its own render method?"**  
   *Trap*: Thinking it protects itself.  
   *Reality*: No! It only catches errors in its **descendant children**. If the Error Boundary's own `render()` fails, the error bubbles up to the next parent boundary.
2. **"Does `try / catch` work around JSX?"**  
   *Trap*: Wrapping JSX in `try { return <Child />; } catch (e) {}`.  
   *Reality*: JSX is just a JavaScript object description (`React.createElement`). The component code is not evaluated until React performs reconciliation later. The `try/catch` block will finish long before the component renders, catching nothing.

---

## 18. Revision Summary

- Error boundaries prevent the "White Screen of Death" by catching render errors in children.
- Implemented via `static getDerivedStateFromError` (pure fallback) and `componentDidCatch` (telemetry/logging).
- **DO NOT** catch: event handlers, async code, SSR, or their own render errors.
- Always use granular boundaries around independent widgets.
- Use key changes (`key={route}`) to reset boundaries on navigation.

---

## 19. Quick Reference

```tsx
// Pattern: Standard Resilient Layout
function DashboardLayout() {
  return (
    <div className="layout">
      <Navbar /> {/* Stays mounted */}
      
      <main>
        <ErrorBoundary fallback={<FeedError />}>
          <UserFeed />
        </ErrorBoundary>

        <ErrorBoundary fallback={<SidebarError />}>
          <AnalyticsSidebar />
        </ErrorBoundary>
      </main>
    </div>
  );
}
```
