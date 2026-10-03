# React with TypeScript: Props, Events, Hooks & Polymorphic Components

## 1. What is it?
Typing React with TypeScript brings compile-time verification to the frontend component tree. It ensures that every prop passed from parent to child, every synthetic DOM event handler, every ref attachment, and every internal state hook is strictly typed.

In modern React development (React 18 & 19), component typing has evolved: the historical `React.FC` wrapper has been deprecated in favor of **standard function signatures with explicit prop interfaces**, `ref` is passed directly as a native prop (deprecating `forwardRef` in React 19), and native HTML element attributes are extended via `React.ComponentPropsWithRef<'element'>`.

---

## 2. Why does it exist?
In vanilla JavaScript React:
- Passing the wrong prop name (`<UserCard username="alice" />` when the component expects `name="alice"`) renders a broken card with zero warnings.
- Event handlers in JavaScript often crash: `e.target.value` throws an error if an event was attached to a `div` instead of an `input`.
- Form handlers frequently forget to type check input types, causing numbers like `"42"` to be treated as strings.
- **The TypeScript Solution**: Catch 100% of missing required props, typos in event names, and null ref exceptions directly inside the IDE before the browser even opens.

---

## 3. The `React.FC` Critique: Why Modern React Avoids `React.FC`

For years, tutorials recommended typing components like this:
```tsx
// ❌ HISTORICAL PATTERN (Avoid in modern codebases):
const MyButton: React.FC<ButtonProps> = ({ label }) => {
  return <button>{label}</button>;
};
```

### Why Senior Engineers Avoid `React.FC`:
1. **Implicit Children (React 17 and below)**: `React.FC` automatically added `children?: ReactNode` to your props, even for components that should never accept children (like `<Avatar />` or `<Divider />`).
2. **Breaks Generic Components**: `React.FC` cannot easily type generic components like `<List<T> items={items} />`.
3. **Verbose and Clunky**: It requires wrapping every component declaration in a `const` variable rather than a standard named `function`.

### The Modern Industry Standard:
```tsx
// ✅ MODERN BEST PRACTICE: Plain function with typed props interface
interface ButtonProps {
  label: string;
  onClick: () => void;
}

export function MyButton({ label, onClick }: ButtonProps) {
  return <button onClick={onClick}>{label}</button>;
}
```

---

## 4. Typing Props & Native Element Inheritance

When building design system components (like a custom `Button` or `Input`), your component should accept all standard HTML attributes (like `disabled`, `aria-label`, `type`, `className`) without manually listing 50 props:

```tsx
import React, { type ComponentPropsWithoutRef, type ReactNode } from 'react';

// Extend native <button> attributes while adding custom design system props!
interface PrimaryButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: 'primary' | 'secondary' | 'danger';
  isLoading?: boolean;
  leftIcon?: ReactNode;
}

export function PrimaryButton({
  variant = 'primary',
  isLoading = false,
  leftIcon,
  children,
  disabled,
  className = '',
  ...nativeButtonProps // Collects onClick, type, aria-*, etc.
}: PrimaryButtonProps) {
  return (
    <button
      disabled={disabled || isLoading}
      className={`btn btn-${variant} ${className}`}
      {...nativeButtonProps}
    >
      {isLoading ? <span className="spinner" /> : leftIcon}
      {children}
    </button>
  );
}
```

---

## 5. Typing React Synthetic Events

TypeScript provides explicit generic event types for all DOM interactions:

```tsx
import React, { useState, type ChangeEvent, type FormEvent, type MouseEvent } from 'react';

export function UserRegistrationForm() {
  const [email, setEmail] = useState('');

  // 1. ChangeEvent on HTMLInputElement
  function handleEmailChange(e: ChangeEvent<HTMLInputElement>) {
    setEmail(e.target.value); // 'e.target.value' is strictly typed as string!
  }

  // 2. FormEvent on HTMLFormElement
  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    console.log('Submitted:', email);
  }

  // 3. MouseEvent on HTMLButtonElement
  function handleButtonClick(e: MouseEvent<HTMLButtonElement>) {
    console.log('Button coordinates:', e.clientX, e.clientY);
  }

  return (
    <form onSubmit={handleSubmit}>
      <input type="email" value={email} onChange={handleEmailChange} />
      <button type="submit" onClick={handleButtonClick}>Register</button>
    </form>
  );
}
```

---

## 6. Typing Built-in React Hooks

### 1. `useState`
```typescript
// Primitives: Inferred automatically!
const [count, setCount] = useState(0); // number

// Nullable Objects: Explicit Union Required!
const [user, setUser] = useState<User | null>(null);

// Arrays: Explicit generic parameter required!
const [todos, setTodos] = useState<Todo[]>([]);
```

### 2. `useRef` (DOM Ref vs Mutable Container)
The typing of `useRef` changes depending on whether it points to a DOM element or a mutable variable:

```typescript
// Case A: DOM Element Ref (Readonly .current for DOM attachments)
// Initial value MUST be null!
const inputRef = useRef<HTMLInputElement>(null);
// inputRef.current?.focus();

// Case B: Mutable Variable Container (Mutable .current)
// Initial value must match type T
const timerRef = useRef<number>(0);
timerRef.current = window.setInterval(...); // ✅ Allowed!
```

### 3. `useReducer`
```typescript
interface State { count: number; }
type Action = { type: 'INCREMENT' } | { type: 'RESET'; payload: number };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'INCREMENT': return { count: state.count + 1 };
    case 'RESET': return { count: action.payload };
  }
}

// In component:
const [state, dispatch] = useReducer(reducer, { count: 0 });
```

---

## 7. Polymorphic Components (The `as` Prop)

A **Polymorphic Component** can render as different HTML tags or React components depending on an `as` prop (e.g. `<Button as="a" href="..." />` renders an `<a>` tag with typed `href`):

```tsx
import React, { type ElementType, type ComponentPropsWithRef } from 'react';

type PolymorphicProps<E extends ElementType, P = {}> = P & {
  as?: E;
} & Omit<ComponentPropsWithRef<E>, keyof P | 'as'>;

interface CustomTextProps {
  weight?: 'bold' | 'normal';
}

export function Text<E extends ElementType = 'span'>({
  as,
  weight = 'normal',
  children,
  ...rest
}: PolymorphicProps<E, CustomTextProps>) {
  const Component = as || 'span';
  return (
    <Component style={{ fontWeight: weight === 'bold' ? 700 : 400 }} {...rest}>
      {children}
    </Component>
  );
}

// Usage with 100% type safety!
<Text as="h1">Header</Text>;                 // Valid
<Text as="a" href="https://google.com">Link</Text>; // Valid: accepts 'href'!
// <Text as="span" href="...">Link</Text>;   // ❌ Compile Error: 'href' does not exist on 'span'!
```

---

## 8. Common Mistakes

### Mistake 1: Untyped empty array in `useState`
```tsx
// ❌ WRONG: Inferred as never[]! You will never be able to add items!
const [items, setItems] = useState([]);
// setItems([{ id: 1 }]); // 💥 Error: Argument of type '{ id: number }' is not assignable to 'never'!

// ✅ CORRECT: Provide explicit generic type
const [items, setItems] = useState<Item[]>([]);
```

---

## 9. Best Practices

1. **Use `PropsWithChildren<P>` for Containers**:
   ```tsx
   import { type PropsWithChildren } from 'react';
   interface CardProps { title: string; }
   export function Card({ title, children }: PropsWithChildren<CardProps>) { ... }
   ```
2. **React 19 Native Ref**: In React 19, pass `ref` as a normal prop:
   ```tsx
   interface InputProps {
     ref?: React.Ref<HTMLInputElement>;
   }
   export function Input({ ref, ...props }: InputProps) {
     return <input ref={ref} {...props} />;
   }
   ```
3. **Prefer `ComponentPropsWithoutRef<'tag'>` over `HTMLAttributes`**: It provides full native attribute compatibility including `aria-*` attributes.

---

## 10. Performance Considerations

- Typing React components has zero runtime overhead. In the IDE, avoid deep conditional polymorphic types for high-frequency components if compile times slow down; standardize on explicit variants when possible.

---

## 11. Security Considerations

- When typing components that render raw HTML, explicitly type the prop as a branded or sanitized string to signal that DOMPurify has validated it:
  ```tsx
  interface SafeHtmlProps {
    sanitizedHtml: Brand<string, 'SanitizedHtml'>;
  }
  ```

---

## 12. Alternatives

| Approach | Description | Recommendation |
| :--- | :--- | :--- |
| **Plain Function Components** | `function Component(props: Props)` | 🌟 Modern Industry Standard |
| **`React.FC`** | `const Component: React.FC<Props>` | ⚠️ Deprecated / Avoid |
| **`React.forwardRef`** | Wrapper for ref forwarding | ⚠️ Deprecated in React 19 |

---

## 13. Trade-offs

- **Benefit**: Eliminates runtime prop crashes; automatic documentation of component APIs; instant refactoring confidence.
- **Cost**: Polymorphic components can introduce complex generic type signatures.

---

## 14. Real-World Usage

- **Shadcn UI & Radix UI**: Fully typed component primitives utilizing Radix Slot and polymorphic props.
- **Next.js**: Extended `<Link>` component typed with exact application route strings.

---

## 15. Placement Interview Questions

### Basic
**Q: Why is `React.FC` discouraged in modern React with TypeScript?**  
*Answer*: In older React versions, `React.FC` automatically included an implicit `children?: ReactNode` prop on every component, which made typing inaccurate for components that shouldn't accept children. Furthermore, it complicates typing generic components, does not work cleanly with `defaultProps`, and adds unnecessary syntactic boilerplate compared to plain function declarations.

### Conceptual
**Q: How does `useRef` change its returned type based on its initial value?**  
*Answer*:
1. When passed a DOM element generic with an initial value of `null` (`useRef<HTMLInputElement>(null)`), TypeScript returns a `RefObject<HTMLInputElement>` where `.current` is **read-only**, intended to be managed by React's DOM engine.
2. When passed a non-null initial value or typed without `null` (`useRef<number>(0)`), TypeScript returns a `MutableRefObject<number>` where `.current` is **mutable**, intended to serve as an arbitrary persistent value container.

### Implementation
**Q: How do you type an event handler function that is defined separately from the JSX element?**  
*Answer*:
```tsx
import { type ChangeEvent } from 'react';

const handleChange = (e: ChangeEvent<HTMLInputElement>): void => {
  console.log(e.target.value);
};
<input onChange={handleChange} />;
```

### Debugging
**Q: A developer writes `const [data, setData] = useState(null);` and later attempts `setData({ name: 'Alice' });`. Why does TypeScript throw an error?**  
*Answer*: Because the initial value is `null` without an explicit generic parameter, TypeScript infers the state type as `null`. The setter function expects `null`, so passing `{ name: 'Alice' }` causes a type mismatch. To fix this, provide an explicit generic union: `useState<UserData | null>(null)`.

### Scenario
**Q: How do you create a custom `Input` component that inherits all native HTML input attributes (like `autoFocus`, `maxLength`, `placeholder`) without redefining them?**  
*Answer*:
```tsx
import { type ComponentPropsWithoutRef } from 'react';

interface CustomInputProps extends ComponentPropsWithoutRef<'input'> {
  label: string;
  errorMessage?: string;
}

export function CustomInput({ label, errorMessage, ...inputProps }: CustomInputProps) {
  return (
    <label>
      {label}
      <input {...inputProps} />
      {errorMessage && <span className="error">{errorMessage}</span>}
    </label>
  );
}
```

### Advanced
**Q: How has `ref` forwarding changed between React 18 and React 19 in TypeScript?**  
*Answer*: In React 18 and below, forwarding a ref to a child component required wrapping the component in `React.forwardRef<RefType, PropsType>((props, ref) => ...)`, which was clumsy to type with generics. In React 19, `ref` is a native prop in all function components: you simply define `ref?: React.Ref<HTMLInputElement>` directly in your component's prop interface, and `forwardRef` is completely deprecated.

---

## 16. Coding Challenge: Strongly Typed Generic List Component

**Task**: Implement a reusable generic `<List />` component that takes an array of items of type `T`, an `extractKey` function, and a `renderItem` callback, ensuring strict type propagation across all props.

```tsx
import React, { type ReactNode } from 'react';

interface ListProps<T> {
  items: T[];
  extractKey: (item: T) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
  emptyFallback?: ReactNode;
}

export function List<T>({
  items,
  extractKey,
  renderItem,
  emptyFallback = <p>No items found.</p>,
}: ListProps<T>): ReactNode {
  if (items.length === 0) {
    return emptyFallback;
  }

  return (
    <ul className="typed-list">
      {items.map((item, index) => (
        <li key={extractKey(item)}>{renderItem(item, index)}</li>
      ))}
    </ul>
  );
}

// Verification:
interface Product { id: number; title: string; price: number; }

export function ProductView() {
  const products: Product[] = [
    { id: 1, title: 'Laptop', price: 999 },
    { id: 2, title: 'Mouse', price: 49 },
  ];

  return (
    <List
      items={products}
      extractKey={(p) => p.id} // 'p' is automatically inferred as Product!
      renderItem={(p) => (
        <div>
          <h4>{p.title}</h4>
          <p>${p.price}</p>
        </div>
      )}
    />
  );
}
```

---

## 17. Common Interview Traps

1. **"You must use `React.FC` to get TypeScript autocomplete for props."**  
   *Trap*: Repeating old documentation.  
   *Reality*: Plain functions `function Component(props: Props)` provide identical autocomplete and cleaner type safety.
2. **"Event handlers can always use `any`."**  
   *Trap*: Writing `(e: any) => ...`.  
   *Reality*: Senior candidates are expected to know the exact SyntheticEvent types (`ChangeEvent<HTMLInputElement>`, `MouseEvent<HTMLButtonElement>`).

---

## 18. Revision Summary

- Prefer **plain function components** with an `interface Props` over `React.FC`.
- Use **`ComponentPropsWithoutRef<'element'>`** to inherit native HTML attributes.
- Use explicit SyntheticEvent types: `ChangeEvent<HTMLInputElement>`, `FormEvent<HTMLFormElement>`.
- For nullable state: **`useState<T | null>(null)`**.
- For DOM refs: **`useRef<HTMLElement>(null)`** (initial value `null`).
- In React 19, `ref` is a native prop; `forwardRef` is deprecated.

---

## 19. Quick Reference

```tsx
// Standard Component
interface CardProps {
  title: string;
  onSelect: (id: string) => void;
  children: React.ReactNode;
}

export function Card({ title, onSelect, children }: CardProps) {
  return <div>{title}{children}</div>;
}

// Input Event Handler
const onInput = (e: React.ChangeEvent<HTMLInputElement>) => {
  console.log(e.target.value);
};
```
