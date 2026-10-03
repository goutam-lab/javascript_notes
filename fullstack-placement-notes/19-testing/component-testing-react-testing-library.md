# Component Testing: React Testing Library, Accessible Queries & User-Centric Interactions

## 1. What is it?
**Component Testing** evaluates an isolated UI component (or small tree of components) by rendering it into a virtual DOM (such as JSDOM) or a headless browser, simulating user interactions, and asserting that the resulting DOM mutations, rendered text, and emitted events conform to design specifications.

**React Testing Library (RTL)**, created by Kent C. Dodds, is the industry-standard component testing library. Its foundational guiding principle is:
> *"The more your tests resemble the way your software is used, the more confidence they can give you."*

Unlike legacy testing libraries (like Enzyme) that inspected internal component state, props, and private methods, RTL forces developers to interact with components **purely through the accessibility tree and visible DOM**, mirroring how a real user or screen reader interacts with the webpage.

```
       Developer Test File (Vitest / Jest + RTL)
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│ 1. Render Component: render(<UserLoginForm />)         │
│    - Mounted into in-memory JSDOM environment          │
└─────────────────────────┬──────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│ 2. Query Elements via Accessibility Tree               │
│    - screen.getByRole('textbox', { name: /email/i })   │ -> Matches how screen readers
│    - screen.getByRole('button', { name: /submit/i })   │    and real humans locate inputs
└─────────────────────────┬──────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│ 3. Simulate Realistic Interactions (@testing-library/user-event)
│    - await user.type(emailInput, 'user@test.com')      │ -> Triggers real browser events:
│    - await user.click(submitButton)                    │    keydown, keyup, input, change,
└─────────────────────────┬──────────────────────────────┘    focus, blur, pointerdown, click
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│ 4. Assert Accessible UI Outcomes                       │
│    - expect(await screen.findByText(/welcome/i))       │ -> Verifies visible text, ARIA
│        .toBeInTheDocument()                            │    attributes, and form feedback
└────────────────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Before React Testing Library, testing frontend components was notoriously flawed and painful due to **Implementation Detail Testing**:

1. **The Enzyme Anti-Pattern**:
   ```javascript
   // ❌ Enzyme approach: Fragile, brittle, zero confidence
   const wrapper = shallow(<Counter />);
   expect(wrapper.state('count')).toBe(0);
   wrapper.instance().incrementCount();
   expect(wrapper.state('count')).toBe(1);
   ```
   If a developer refactored `Counter` from a class component to a functional component with `useState`, or renamed `incrementCount` to `handleClick`, the test suite immediately broke—even though the component still worked perfectly for users!
2. **Accessibility (a11y) Enforcement**: By prioritizing ARIA role queries (`getByRole`), RTL naturally catches inaccessible HTML (e.g., clickable `<div>` tags missing keyboard handlers, form inputs missing `<label>` associations).
3. **Async UI State Synchronization**: Modern web apps fetch data asynchronously. RTL provides declarative async wait utilities (`findBy*`, `waitFor`) that eliminate arbitrary `setTimeout` delays.

---

## 3. Mental Model: The Screen Reader & End-User Perspective
Think of React Testing Library as a **Blindfolded User Navigating with a Screen Reader**:
- The user does not know what state variables exist in React memory (`const [isOpen, setIsOpen] = useState(false)`).
- The user cannot see internal component file boundaries (`<HeaderWrapper>`, `<InnerContainer>`).
- The user navigates strictly by:
  - "Find the button labeled 'Sign In'" (`getByRole('button', { name: /sign in/i })`).
  - "Type my name into the field labeled 'Full Name'" (`getByLabelText(/full name/i)`).
  - "Listen for the alert saying 'Payment Successful'" (`findByRole('alert')`).

If your test cannot locate an element using user-facing queries, your component is likely inaccessible to real humans with assistive technologies.

---

## 4. Basic Example: Counter Component with User Interactions

```tsx
// Counter.tsx
import React, { useState } from 'react';

export function Counter({ initialCount = 0 }: { initialCount?: number }) {
  const [count, setCount] = useState(initialCount);

  return (
    <div>
      <h2>Shopping Cart</h2>
      <p aria-live="polite">Current Items: {count}</p>
      <button onClick={() => setCount((prev) => prev - 1)} disabled={count <= 0}>
        Decrease
      </button>
      <button onClick={() => setCount((prev) => prev + 1)}>
        Increase
      </button>
    </div>
  );
}

// Counter.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Counter } from './Counter';

describe('<Counter />', () => {
  it('renders initial count and handles increment / decrement', async () => {
    // 1. Setup user-event actor
    const user = userEvent.setup();

    // 2. Render component into JSDOM
    render(<Counter initialCount={1} />);

    // 3. Query elements by accessible roles
    const increaseBtn = screen.getByRole('button', { name: /increase/i });
    const decreaseBtn = screen.getByRole('button', { name: /decrease/i });
    const statusText = screen.getByText(/current items: 1/i);

    expect(statusText).toBeInTheDocument();
    expect(decreaseBtn).toBeEnabled();

    // 4. Simulate user clicks
    await user.click(increaseBtn);
    expect(screen.getByText(/current items: 2/i)).toBeInTheDocument();

    await user.click(decreaseBtn);
    await user.click(decreaseBtn);
    expect(screen.getByText(/current items: 0/i)).toBeInTheDocument();

    // 5. Verify disabled state
    expect(decreaseBtn).toBeDisabled();
  });
});
```

---

## 5. Real-World Production Example: Asynchronous Form Submission with Error States & MSW

In production applications, components fetch data, validate forms, show loading spinners, and render error alerts.

```tsx
// UserProfileEditor.tsx
import React, { useState } from 'react';

interface UserProfileEditorProps {
  userId: string;
  onSuccess: (updatedName: string) => void;
}

export function UserProfileEditor({ userId, onSuccess }: UserProfileEditorProps) {
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMessage('Name is required');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });

      if (!res.ok) throw new Error('Failed to update profile');

      onSuccess(name);
    } catch (err: any) {
      setErrorMessage(err.message || 'Network error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} aria-label="Edit Profile Form">
      <label htmlFor="user-name">Display Name</label>
      <input
        id="user-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={isLoading}
      />

      {errorMessage && <div role="alert">{errorMessage}</div>}

      <button type="submit" disabled={isLoading}>
        {isLoading ? 'Saving...' : 'Save Profile'}
      </button>
    </form>
  );
}

// ==========================================
// Test Suite: UserProfileEditor.test.tsx
// ==========================================
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { UserProfileEditor } from './UserProfileEditor';

const server = setupServer(
  http.patch('/api/users/:id', async ({ request }) => {
    const body = (await request.json()) as { name: string };
    if (body.name === 'Forbidden') {
      return new HttpResponse(null, { status: 400 });
    }
    return HttpResponse.json({ success: true, name: body.name });
  })
);

beforeAll(() => server.listen());
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

describe('<UserProfileEditor /> Production Integration Test', () => {
  it('validates required name field before submitting', async () => {
    const user = userEvent.setup();
    const handleSuccess = vi.fn();

    render(<UserProfileEditor userId="usr_1" onSuccess={handleSuccess} />);

    // Click submit without entering a name
    await user.click(screen.getByRole('button', { name: /save profile/i }));

    // Assert validation error appears in role="alert"
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/name is required/i);
    expect(handleSuccess).not.toHaveBeenCalled();
  });

  it('submits valid name, toggles loading state, and calls onSuccess callback', async () => {
    const user = userEvent.setup();
    const handleSuccess = vi.fn();

    render(<UserProfileEditor userId="usr_1" onSuccess={handleSuccess} />);

    const input = screen.getByRole('textbox', { name: /display name/i });
    const submitBtn = screen.getByRole('button', { name: /save profile/i });

    // Type new name
    await user.type(input, 'Alex Rivera');
    expect(input).toHaveValue('Alex Rivera');

    // Click submit
    await user.click(submitBtn);

    // Verify button transitions to loading
    expect(screen.getByRole('button', { name: /saving\.\.\./i })).toBeDisabled();

    // Await async completion via callback assertion
    await waitFor(() => {
      expect(handleSuccess).toHaveBeenCalledWith('Alex Rivera');
    });

    // Verify button restored
    expect(screen.getByRole('button', { name: /save profile/i })).toBeEnabled();
  });

  it('handles server API failure gracefully by displaying an alert', async () => {
    const user = userEvent.setup();
    const handleSuccess = vi.fn();

    render(<UserProfileEditor userId="usr_1" onSuccess={handleSuccess} />);

    await user.type(screen.getByRole('textbox', { name: /display name/i }), 'Forbidden');
    await user.click(screen.getByRole('button', { name: /save profile/i }));

    // findByRole automatically waits for element to appear in DOM
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/failed to update profile/i);
    expect(handleSuccess).not.toHaveBeenCalled();
  });
});
```

---

## 6. Under the Hood: The RTL Query Priority Matrix

RTL provides three prefixes (`get`, `query`, `find`) and multiple query types:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Query Prefix Mechanics:                                                │
│ 1. getBy*   -> Synchronous. Returns element. Throws error if 0 or >1.  │
│ 2. queryBy* -> Synchronous. Returns element or NULL. Never throws.    │
│                (Essential for asserting an element DOES NOT exist).    │
│ 3. findBy*  -> Asynchronous. Polls DOM (up to 1000ms). Returns Promise.│
│                Throws if not found before timeout.                     │
└────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────┐
│ Query Type Priority (Recommended by RTL Guidelines):                   │
│                                                                        │
│ Priority 1 (Accessible to Everyone):                                   │
│   - getByRole(role, { name: /.../ })  <- ALWAYS USE FIRST              │
│   - getByLabelText(/.../)             <- Ideal for form inputs         │
│   - getByPlaceholderText(/.../)       <- Fallback if no label          │
│   - getByText(/.../)                  <- Buttons, links, paragraphs    │
│   - getByDisplayValue(/.../)          <- Input values                  │
│                                                                        │
│ Priority 2 (Semantic Queries):                                         │
│   - getByAltText(/.../)               <- Images                        │
│   - getByTitle(/.../)                 <- SVG / tooltips                │
│                                                                        │
│ Priority 3 (Last Resort):                                              │
│   - getByTestId('...')                <- ONLY when no semantic exists │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Important Rules

1. **Always Use `userEvent` Over `fireEvent`**:
   - `fireEvent.click(button)` simply dispatches a synthetic `click` DOM event.
   - `userEvent.click(button)` simulates real browser behavior: it moves mouse, focuses the element, fires `pointerdown`, `mousedown`, `focus`, `mouseup`, and `click`.
2. **Use `queryBy*` When Asserting Absence**:
   ```typescript
   // ❌ CRASHES TEST: getByText throws an immediate error if element is missing!
   expect(screen.getByText('Error')).not.toBeInTheDocument();

   // ✅ CORRECT: queryByText returns null if not found
   expect(screen.queryByText('Error')).not.toBeInTheDocument();
   ```
3. **Do Not Wrap `userEvent` or `render` in `act()` Manually**: RTL and `user-event` already wrap all actions and assertions in React's `act()` internally. Explicit `act(() => ...)` calls in your tests are an anti-pattern indicating missing `await` statements.
4. **Avoid Testing CSS Styles Directly**: Avoid `expect(el).toHaveStyle('color: red')` unless the color conveys semantic business meaning. Test the outcome (e.g., error alert displayed, disabled attribute applied).
5. **Clean Up Custom Providers with a Custom Render Utility**: If your components require Redux, React Query, or React Router, wrap them in a reusable `renderWithProviders` helper rather than duplicating boilerplate across every test file.

---

## 8. Common Mistakes & Anti-Patterns

### 1. The Async `findBy` vs Synchronous `getBy` Confusion
```typescript
// ❌ WRONG: getByText runs immediately before the fetch finishes; throws error!
render(<AsyncUserList />);
const userItem = screen.getByText('John Doe'); 

// ✅ CORRECT: findByText polls DOM until data resolves or timeout expires
const userItem = await screen.findByText('John Doe');
```

### 2. Over-Relying on `data-testid`
Sprinkling `data-testid="submit-btn"` across every HTML tag. This decouples tests from accessibility. If a developer accidentally renders a `<div>` instead of a `<button>`, `getByTestId` will pass, but keyboard and screen reader users will be completely locked out. Use `getByRole('button', { name: /submit/i })`.

### 3. Misusing `waitFor`
```typescript
// ❌ ANTI-PATTERN: Putting userEvent inside waitFor
await waitFor(async () => {
  await user.click(button);
  expect(screen.getByText('Success')).toBeInTheDocument();
});

// ✅ CORRECT: Perform the action, then await the assertion
await user.click(button);
await waitFor(() => {
  expect(screen.getByText('Success')).toBeInTheDocument();
});
```

---

## 9. Best Practices

- **Create a Custom Render Wrapper (`test-utils.tsx`)**:
  ```tsx
  import React, { ReactElement } from 'react';
  import { render, RenderOptions } from '@testing-library/react';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { MemoryRouter } from 'react-router-dom';

  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function AllProviders({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }

  export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
    return render(ui, { wrapper: AllProviders, ...options });
  }
  ```
- **Use Regex Case-Insensitive Matching**: Match text with `/submit/i` instead of `'Submit'` to ensure tests remain resilient to minor copy/capitalization changes.

---

## 10. Performance Considerations

- **JSDOM vs. Happy-DOM**: JSDOM provides complete DOM and HTML specification compliance but is heavier. **Happy-DOM** is up to 3x faster in Vitest, making it ideal for massive component test suites, though it occasionally lacks obscure browser APIs.
- **Avoid Unnecessary `waitFor` Timers**: A failing `waitFor` polls the DOM every 50ms up to 1000ms. If you have 20 failing tests with timeouts, your test run slows down by 20 seconds. Ensure assertions fail fast.

---

## 11. Security Considerations

- **XSS Rendering Checks in Components**: When testing components that display rich user-generated content or markdown, verify that HTML tags are sanitized and never executed:
  ```tsx
  render(<CommentBody text="<img src=x onerror=alert(1)>" />);
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  ```

---

## 12. RTL vs. Enzyme Comparison Matrix

| Feature | React Testing Library (RTL) | Enzyme (Deprecated) |
| :--- | :--- | :--- |
| **Philosophy** | Test user behavior and DOM output | Test React internals (state, props) |
| **Component Rendering** | Full mount into JSDOM | Shallow rendering (`shallow()`) |
| **Resilience to Refactoring**| ⭐⭐⭐⭐⭐ (Very High) | ⭐ (Very Low - breaks on refactors) |
| **Accessibility Encouraged**| Enforced via ARIA role queries | Ignored |
| **Modern React Support** | Complete (Hooks, Suspense, Concurrent)| Abandoned (no React 18 support) |

---

## 13. Trade-offs

- **Full DOM Mounting vs. Shallow Rendering**: RTL mounts the full component tree. If a child component performs a heavy calculation, it runs in the test. The trade-off is higher fidelity and real integration confidence over artificial isolation.
- **Accessibility Discipline vs. Convenience**: Locating an element by `getByRole` requires writing proper HTML (`<button>`, `<label for="...">`). While this forces you to write accessible code, it takes slightly more effort than slapping `data-testid="xyz"` on a `<div>`.

---

## 14. Real-World Usage Case Studies

1. **Meta (Facebook / Instagram)**: Core React components across design systems (e.g., Blueprint, Material UI, Shadcn) mandate RTL tests verifying keyboard accessibility (`Tab`, `Enter`, `Escape`) and ARIA roles.
2. **Gov.uk & High-Accessibility Portals**: Enforce RTL queries exclusively via `getByRole` and `getByLabelText` to guarantee WCAG 2.1 AA compliance before any frontend component is merged.

---

## 15. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: What is the main difference between `getByText`, `queryByText`, and `findByText` in React Testing Library?**
> **Answer**:
> - `getByText`: Synchronously searches for the element. Throws an immediate error if not found or if multiple elements match.
> - `queryByText`: Synchronously searches for the element. Returns `null` if not found (used to assert an element is absent from the DOM).
> - `findByText`: Asynchronous. Returns a Promise that polls the DOM for up to 1000ms until the element appears. Used when waiting for async data fetching or animations.

### Tier 2: Conceptual
**Q: Why does React Testing Library advocate avoiding testing component state directly?**
> **Answer**: Users cannot see or interact with component state; they only see the rendered DOM and interact with buttons and inputs. If you test internal state (e.g., `wrapper.state('isOpen')`), your test becomes brittle and will break whenever the component is refactored (e.g., moving state to Zustand, a custom hook, or parent props), even if the UI still behaves identically for users.

### Tier 3: Implementation
**Q: How do you test that a modal closes when the user presses the `Escape` key?**
> **Answer**:
> ```typescript
> const user = userEvent.setup();
> render(<ConfirmationModal isOpen={true} title="Delete Account" />);
> expect(screen.getByRole('dialog', { name: /delete account/i })).toBeInTheDocument();
>
> await user.keyboard('{Escape}');
>
> expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
> ```

### Tier 4: Debugging
**Q: You run a test and see the error: `Warning: An update to MyComponent inside a test was not wrapped in act(...)`. What is the root cause and how do you resolve it?**
> **Answer**: The warning indicates that a state update occurred in your React component after the test had already completed, or without the test awaiting its async resolution (e.g., an un-awaited Promise, un-cleared `setTimeout`, or unhandled API call).
> **Fix**: Ensure all user events are awaited (`await user.click(...)`), and wait for async UI side-effects to settle using `await screen.findByRole(...)` or `await waitFor(...)` before ending the test.

### Tier 5: Scenario
**Q: You are testing a Paginated Data Table component that fetches 10 rows from an API. How do you test that clicking the "Next Page" button correctly updates the table without making real network requests?**
> **Answer**:
> 1. Use Mock Service Worker (MSW) to intercept `GET /api/items?page=1` and `GET /api/items?page=2`.
> 2. Render the table component wrapped in required providers (e.g., React Query).
> 3. Use `await screen.findByText('Item 1')` to verify Page 1 loads.
> 4. Use `await user.click(screen.getByRole('button', { name: /next page/i }))`.
> 5. Assert that the old items disappear and `await screen.findByText('Item 11')` appears in the table.

### Tier 6: Advanced
**Q: How does React's `act()` function work under the hood, and why is it necessary in testing asynchronous components?**
> **Answer**:
> React batches state updates, layout effects, and re-renders asynchronously. In a real browser, the browser event loop processes these tasks before painting frames. In a headless Node/JSDOM test runner, there is no browser paint cycle. `act()` creates a synthetic scope: it intercepts React's work queue and flushes all microtasks, scheduled state transitions, and `useEffect` hooks synchronously before control is returned to the test assertion. This guarantees that your assertions evaluate the *final*, fully-updated DOM state.

---

## 16. Coding Question: Test a Search Autocomplete Component

### Problem
Write a complete Vitest + RTL test suite for an `<Autocomplete />` component that:
1. Renders an input field labeled "Search Cities".
2. When the user types "New", renders a list of suggestions: "New York", "New Delhi".
3. When the user clicks "New York", populates the input with "New York" and hides the suggestion list.

### Solution

```tsx
// Autocomplete.tsx
import React, { useState } from 'react';

const CITIES = ['New York', 'New Delhi', 'London', 'Tokyo', 'Paris'];

export function Autocomplete() {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  const filtered = query.trim()
    ? CITIES.filter((c) => c.toLowerCase().includes(query.toLowerCase()))
    : [];

  const handleSelect = (city: string) => {
    setQuery(city);
    setIsOpen(false);
  };

  return (
    <div>
      <label htmlFor="city-search">Search Cities</label>
      <input
        id="city-search"
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
        }}
      />

      {isOpen && filtered.length > 0 && (
        <ul role="listbox" aria-label="City Suggestions">
          {filtered.map((city) => (
            <li
              key={city}
              role="option"
              onClick={() => handleSelect(city)}
            >
              {city}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ==========================================
// Test Suite: Autocomplete.test.tsx
// ==========================================
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect } from 'vitest';
import { Autocomplete } from './Autocomplete';

describe('<Autocomplete /> Component', () => {
  it('displays matching suggestions when user types and selects an item', async () => {
    const user = userEvent.setup();
    render(<Autocomplete />);

    const searchInput = screen.getByRole('textbox', { name: /search cities/i });

    // 1. Initial State: No listbox rendered
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // 2. Type "New" into search input
    await user.type(searchInput, 'New');

    // 3. Suggestions listbox should appear
    const listbox = screen.getByRole('listbox', { name: /city suggestions/i });
    expect(listbox).toBeInTheDocument();

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('New York');
    expect(options[1]).toHaveTextContent('New Delhi');

    // 4. Click "New York" option
    await user.click(options[0]);

    // 5. Input should update with selection and listbox should close
    expect(searchInput).toHaveValue('New York');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });
});
```

---

## 17. Common Interview Traps

- **Trap 1**: Using `fireEvent.change` instead of `userEvent.type`.
  *Gotcha*: `fireEvent.change` does not trigger `keyDown`, `keyPress`, or input masking listeners. `userEvent.type` types characters one by one, properly testing debounced inputs and validation rules.
- **Trap 2**: Expecting `getByText` to find text split across multiple nested spans.
  *Gotcha*: If a button renders `<button><span>Save</span> <span>Changes</span></button>`, `getByText('Save Changes')` will fail because the text is split across sibling nodes. Use a custom matcher function or `getByRole('button', { name: /save changes/i })`, which computes the accessible text across children.
- **Trap 3**: Asserting `waitFor` with empty callback `await waitFor(() => {})`.
  *Gotcha*: This produces a no-op that risks false positives. Always include an explicit assertion inside `waitFor`.

---

## 18. Revision Summary

- **Philosophy**: Test components from the user's perspective; test behavior, not internal implementation details.
- **Query Hierarchy**:
  1. `getByRole` (Most preferred - verifies accessibility).
  2. `getByLabelText` (Form inputs).
  3. `getByText` (Display content).
  4. `getByTestId` (Last resort).
- **Prefixes**:
  - `getBy*`: Synchronous, throws if missing.
  - `queryBy*`: Synchronous, returns `null` if missing (use for negative assertions).
  - `findBy*`: Asynchronous, returns Promise, waits for DOM changes.
- **Interactions**: Always use `@testing-library/user-event` with `userEvent.setup()` for high-fidelity browser event simulation.

---

## 19. Quick Reference

| Action | RTL Code | Note |
| :--- | :--- | :--- |
| **Locate Button** | `screen.getByRole('button', { name: /save/i })` | Primary accessible query |
| **Locate Input** | `screen.getByRole('textbox', { name: /email/i })` | Matches `<label>` text |
| **Assert Element Exists** | `expect(el).toBeInTheDocument()` | Uses `jest-dom` matchers |
| **Assert Element Absent** | `expect(screen.queryByRole('alert')).not.toBeInTheDocument()` | Must use `queryBy` |
| **Wait for Async Element** | `const el = await screen.findByRole('dialog')` | Auto-waits up to 1000ms |
| **Simulate Click** | `await user.click(element)` | Always await user-event |
| **Simulate Typing** | `await user.type(input, 'Text')` | Types character by character |
