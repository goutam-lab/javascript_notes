# useContext & The Context Re-render Performance Trap

## 1. What is it?
The **`useContext`** hook provides a mechanism for sharing data across the React component tree without manually passing props down through every intermediate component (eliminating **Prop Drilling**). 

Context is composed of three pieces:
1. **`createContext(defaultValue)`**: Creates the context object.
2. **`<MyContext.Provider value={data}>`**: Wraps a subtree and broadcasts data downward (In React 19, `<MyContext value={data}>` can be used directly).
3. **`useContext(MyContext)`**: Subscribes a child component to the nearest matching Provider above it.

However, while Context is simple to set up, it has a notorious architectural performance trap: **every component that consumes a context re-renders whenever the context `value` changes, completely bypassing `React.memo`!**

---

## 2. Why does it exist?
In large applications, certain data is needed globally by dozens of components scattered across different branches of the tree:
- Current authenticated user
- Theme (Dark Mode / Light Mode)
- Current language / Localization (i18n)
- Shopping cart contents

Passing these props through 15 layers of container components that have no interest in the data creates brittle codebases where changing a single prop signature requires editing 15 files. Context provides a direct broadcast channel from an ancestor to any descendent.

---

## 3. Mental Model
💡 **Think of it like an FM Radio Broadcast Station:**
- **The Provider (`<ThemeContext.Provider value="dark">`)** is a powerful FM Radio Transmitter on top of a mountain. It broadcasts audio signals over frequency 101.5 FM to an entire valley (**Subtree**).
- **The Consumer (`useContext(ThemeContext)`)** is a car radio tuned to frequency 101.5 FM. The car doesn't need physical wires connecting it to the radio station; it pulls the signal out of the air (**Direct tree injection**).
- **The Performance Trap**: If the radio station changes its song, **every single car with its radio tuned to 101.5 FM wakes up and processes the new song simultaneously**, even if the driver was sleeping and only cared about news alerts!

### Context Propagation Flow
```
[ <App /> ]
     │
     ▼
[ <AuthContext.Provider value={{ user, setUser }}> ]
     │
     ├──► [ <Navbar /> ] (Does not consume AuthContext -> Can be memoized)
     │
     └──► [ <Dashboard /> ]
               │
               ▼
          [ <UserProfileCard /> ] ◄── Calls useContext(AuthContext)
          (Subscribed directly! Updates instantly when 'user' changes!)
```

---

## 4. Basic Example: Building a Theme Context in TypeScript

```tsx
// ThemeContext.tsx
import React, { createContext, useContext, useState, ReactNode } from 'react';

type Theme = 'light' | 'dark';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

// 1. Create Context with undefined default
const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// 2. Custom Provider Component:
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light');

  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <div className={`app-root theme-${theme}`}>{children}</div>
    </ThemeContext.Provider>
  );
}

// 3. Custom Consumer Hook (with safety check):
export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a <ThemeProvider>');
  }
  return context;
}
```

---

## 5. Real Example: The Context Re-render Disaster & The Split Context Pattern

### ❌ The Monolithic Context Anti-Pattern (Performance Disaster):
```tsx
// ❌ MONOLITHIC CONTEXT: Combines everything into one object!
interface AppState {
  user: User;
  cart: CartItem[];
  theme: string;
}
```
If `cart` updates because the user added a pair of socks, **any component that calls `useContext`—even a component that only reads `theme` or `user`—will forcefully re-render**!

### ✅ The Production Solution: The Split Context Pattern (State vs. Dispatch)
By separating data that changes frequently from the functions that update it, we achieve zero wasted re-renders:

```tsx
// SplitCartContext.tsx
import React, { createContext, useContext, useState, useMemo, ReactNode } from 'react';

interface CartItem {
  id: string;
  name: string;
  price: number;
}

type CartState = CartItem[];
type CartDispatch = {
  addItem: (item: CartItem) => void;
  removeItem: (id: string) => void;
};

// 1. Separate State from Dispatch:
const CartStateContext = createContext<CartState | undefined>(undefined);
const CartDispatchContext = createContext<CartDispatch | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);

  // Dispatch functions NEVER change reference across renders:
  const dispatch = useMemo(() => ({
    addItem: (item: CartItem) => setCart(prev => [...prev, item]),
    removeItem: (id: string) => setCart(prev => prev.filter(i => i.id !== id))
  }), []);

  return (
    <CartDispatchContext.Provider value={dispatch}>
      <CartStateContext.Provider value={cart}>
        {children}
      </CartStateContext.Provider>
    </CartDispatchContext.Provider>
  );
}

// Consumer 1: Only needs to add items (NEVER re-renders when cart changes!)
export function useCartDispatch() {
  const context = useContext(CartDispatchContext);
  if (!context) throw new Error('useCartDispatch outside Provider');
  return context;
}

// Consumer 2: Displays the cart badge (Only this re-renders!)
export function useCartState() {
  const context = useContext(CartStateContext);
  if (!context) throw new Error('useCartState outside Provider');
  return context;
}
```

---

## 6. Under the Hood: Why `React.memo` Cannot Block Context Re-renders

Many developers believe wrapping a component in `React.memo()` protects it from Context re-renders:
```tsx
const Child = React.memo(function Child() {
  const { theme } = useContext(ThemeContext);
  return <div>{theme}</div>;
});
```

### The Invariant:
- `React.memo` only checks **incoming `props`** (`prevProps === nextProps`).
- Context subscriptions bypass the props layer entirely!
- Under the hood, calling `useContext(MyContext)` attaches a **dependency subscription object directly to the component's Fiber node**.
- When the Provider's `value` changes according to `Object.is()`, React traverses its list of subscribed fibers and **marks them as "dirty" (needing an update) directly in the work loop**, scheduling a re-render regardless of `React.memo`!

---

## 7. Always Memoize the Provider `value` Prop

```tsx
// ❌ WRONG: Creates a new object reference on EVERY parent render:
<AuthContext.Provider value={{ user, login, logout }}>
  {children}
</AuthContext.Provider>
```
If the parent component re-renders for any reason, `{ user, login, logout }` gets a brand-new memory address. Every consumer in the entire application will re-render!

```tsx
// ✅ CORRECT: Stabilize with useMemo:
const contextValue = useMemo(() => ({
  user,
  login,
  logout
}), [user, login, logout]);

<AuthContext.Provider value={contextValue}>
  {children}
</AuthContext.Provider>
```

---

## 8. Common Mistakes & Anti-Patterns

### ❌ Mistake 1: Using Context for High-Frequency State (e.g. Animations, Mouse Coordinates)
- **The Disaster**: Storing mouse coordinates `(x, y)` or live typing keystrokes in Context.
- **Why it breaks**: Context emits updates to all consumers on every single pixel movement (60-120 times/sec). Because Context does not support **fine-grained selectors**, this floods the main thread and freezes the browser.
- **✅ The Fix**: Use a dedicated store with selectors (like **Zustand**) or local `useRef` for high-frequency events!

### ❌ Mistake 2: Missing the Context Provider Guard Check
- If a developer forgets to wrap a component with `<ThemeProvider>`, `useContext(ThemeContext)` silently returns `undefined`, leading to cryptic `Cannot read properties of undefined` crashes.
- **Always write a custom hook with a guard clause**:
  ```tsx
  if (context === undefined) throw new Error("useTheme must be within ThemeProvider");
  ```

---

## 9. Best Practices in Modern Production
1. **Colocate Context with its Feature**: Don't put all contexts at the root of `App.tsx`. If a context is only used inside `/dashboard`, wrap only the `<Dashboard />` route with that Provider!
2. **Split State and Actions**: Keep data contexts separate from dispatch contexts.
3. **Graduate to Zustand when Selectors are Needed**: If components need to subscribe to small, specific slices of state (`state => state.user.avatar`), use **Zustand** instead of fighting Context performance limitations.

---

## 10. Performance Considerations: Context Selectors (The Missing Feature)
Why do state libraries like Redux and Zustand outperform Context?
- In Zustand:
  ```tsx
  const avatar = useStore(state => state.user.avatar); // Subscribes ONLY to avatar!
  ```
  If `state.user.name` changes, this component **does NOT re-render**.
- In React Context: There are **no native selectors**. If any field on the context object changes, the component re-renders, even if it only read a field that stayed the same.

---

## 11. Security Considerations: Leaking Auth Tokens Through Global Context
Avoid putting sensitive, unencrypted JWT refresh tokens or passwords into global context where third-party UI widgets or analytics trackers might inspect them. Store tokens in `HttpOnly` cookies instead.

---

## 12. Complete Comparison Matrix: Context vs. Redux Toolkit vs. Zustand
| Feature | React Context | Redux Toolkit (RTK) | Zustand |
|---|---|---|---|
| **Bundle Size Overhead** | **0 KB (Native React)** | ~11 KB | **~1.2 KB** |
| **Fine-Grained Selectors**| ❌ No (Re-renders on any change) | ✅ Yes (`useSelector`) | ✅ **Yes (`useStore(s => s.x)`)** |
| **Boilerplate** | Low | High (Actions, Slices, Store) | **Minimal** (Simple store function) |
| **Provider Required?** | ✅ Yes (`<Provider>`) | ✅ Yes (`<Provider>`) | ❌ **No Provider Needed!** |
| **Best Used For** | Theme, Auth, Language | Massive enterprise apps | Fast SPAs, dashboards, gaming |

---

## 13. Trade-offs: When Should You Use React Context?
- **Use Context for**: Low-frequency, global static data:
  - Theme (Dark/Light Mode)
  - Logged-in User Profile
  - Current Language / Translations (i18n)
- **Do NOT Use Context for**: High-frequency, transactional data:
  - Form field inputs
  - Real-time chat message streams
  - Drag-and-drop coordinates
  - Large e-commerce carts with frequent edits

---

## 14. Real-World Usage: React Router & Next.js Navigation
When you call `useNavigate()` or `useParams()` in React Router:
- React Router maintains an internal `<RouterContext.Provider>` at the root of your route tree.
- When the URL changes in the browser address bar, the Router Provider updates its context value, notifying all `<Route />` components to render the matching page without full browser reload.

---

## 15. Placement Interview Questions

### Basic (Intern)
1. **What is React Context, and what problem does it solve?**
   - *Spoken Answer*: "React Context is a built-in mechanism for sharing data across the entire component tree without having to manually pass props down through every intermediate component. It solves the 'Prop Drilling' problem by providing a direct broadcast channel from an ancestor Provider to any descendent Consumer."

### Conceptual (Junior SDE)
2. **Why does `React.memo` fail to prevent a component from re-rendering when a context value changes?**
   - *Spoken Answer*: "`React.memo` only shallowly compares incoming props passed from a parent component. Context subscriptions operate independently of the props pipeline. When a Context Provider's value changes, React traverses the internal fiber tree and marks all fiber nodes that called `useContext(MyContext)` as dirty directly, forcing them to re-render regardless of whether their props changed or if they are wrapped in `React.memo`."

### Implementation (SDE-1)
3. **How does the 'Split Context Pattern' prevent unnecessary re-renders in applications?**
   - *Spoken Answer*: "In the Split Context Pattern, we create two separate contexts: a **State Context** holding the dynamic data (e.g. `CartStateContext`) and a **Dispatch Context** holding the action functions (e.g. `CartDispatchContext`).
     Because action functions can be permanently memoized with `useMemo`, components that only dispatch actions (like an 'Add to Cart' button) subscribe exclusively to the Dispatch Context and **never re-render** when cart items change. Only components that display the data (like the Cart Badge) subscribe to the State Context, isolating re-renders strictly to where they are needed."

### Debugging
4. **A component tree wrapped in `<ThemeContext.Provider value={{ theme, setTheme }}>` re-renders every time an unrelated counter in the parent increments. Why?**
   - *Analysis*: The provider's `value` is being instantiated as an **inline object literal** `{ theme, setTheme }`. Every time the parent re-renders due to the counter, a brand-new object reference is created in RAM. React sees `Object.is(oldValue, newValue) === false` and triggers a re-render in all context consumers!
   - *Fix*: Wrap the value in `useMemo`:
     `const value = useMemo(() => ({ theme, setTheme }), [theme]);`

### Scenario-Based
5. **How do you safely consume Context in a custom hook while ensuring developers get clear error messages if they forget the Provider?**
   - *Spoken Answer*: "By checking if the context value is `undefined` inside the custom hook:
     ```tsx
     export function useAuth() {
       const context = useContext(AuthContext);
       if (context === undefined) {
         throw new Error('useAuth must be used within an <AuthProvider>');
       }
       return context;
     }
     ```
     This prevents silent bugs and immediately points the developer to the exact missing provider in their component tree."

### Advanced (Tier-1 Product Company)
6. **What is the difference between Context in React 18 and React 19?**
   - *Spoken Answer*: "In React 19, the context syntax has been streamlined:
     - Developers can render **`<MyContext value={data}>`** directly instead of `<MyContext.Provider value={data}>`, eliminating boilerplate.
     - Additionally, React 19 introduced the **`use(MyContext)`** API, which can be called **conditionally inside `if` statements and loops**, breaking the historic limitation that `useContext` could only be called unconditionally at the top level of a component."

---

## 16. Placement Coding Challenge: Type-Safe Modal Context Manager
Implement an application-wide modal manager in TypeScript that allows any component in the app to open and close modals dynamically without local boolean state:

```tsx
// ModalContext.tsx
import React, { createContext, useContext, useState, ReactNode } from 'react';

interface ModalContextType {
  openModal: (content: ReactNode) => void;
  closeModal: () => void;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export function ModalProvider({ children }: { children: ReactNode }) {
  const [modalContent, setModalContent] = useState<ReactNode | null>(null);

  const openModal = (content: ReactNode) => setModalContent(content);
  const closeModal = () => setModalContent(null);

  return (
    <ModalContext.Provider value={{ openModal, closeModal }}>
      {children}
      {modalContent && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded shadow-lg relative">
            <button 
              className="absolute top-2 right-2 text-gray-500" 
              onClick={closeModal}
            >
              ✕
            </button>
            {modalContent}
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
}

export function useModal() {
  const context = useContext(ModalContext);
  if (!context) throw new Error('useModal must be used within ModalProvider');
  return context;
}
```

---

## 17. Common Interview Traps
- **Trap**: "Is React Context a full state management library like Redux?"
  - *Trap Explanation*: **No.** Context is merely a **transport mechanism (dependency injection tool)**. It does not manage state, handle time-travel debugging, or offer selector subscriptions; it simply transports existing `useState` or `useReducer` values down the component tree.
- **Trap**: "Can a component subscribe to multiple different contexts simultaneously?"
  - *Trap Explanation*: **Yes, absolutely.** A component can call `useContext(ThemeContext)` and `useContext(AuthContext)` in the same function body without any conflict.

---

## 18. Revision Summary
- Context eliminates **Prop Drilling** by broadcasting data across a subtree.
- **The Performance Trap**: When Context value changes, **all consumers re-render automatically**, bypassing `React.memo`.
- Always wrap Provider `value` objects in **`useMemo`** to prevent referential instability.
- Use the **Split Context Pattern** (separate State from Dispatch) to isolate re-renders.
- Use Context for low-frequency global data (Theme, Auth); use **Zustand** for high-frequency transactional data.
- React 19 allows using `<MyContext>` directly as a provider.

---

## 19. Quick Reference Cheat Sheet
```tsx
// 1. Create and Guard Pattern:
const AuthContext = createContext<AuthType | undefined>(undefined);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth missing Provider!");
  return ctx;
}

// 2. Memoized Provider Value:
const value = useMemo(() => ({ user, role }), [user, role]);
return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
```
