# Controlled vs. Uncontrolled Components in React

## 1. What is it?
In React, form elements (`<input>`, `<textarea>`, `<select>`) maintain their own internal state inside the browser's native DOM. When integrating forms into React, developers choose between two foundational architectural patterns:
1. **Controlled Components**: Form data is handled directly by the **React component state**. React acts as the **"Single Source of Truth"**; the input's displayed value is bound to state via the `value` prop, and changes are handled via `onChange`.
2. **Uncontrolled Components**: Form data is handled directly by the **DOM itself**. React does not manage the input's state on every keystroke; instead, values are pulled from the DOM on-demand using a **`ref`** or the native HTML **`FormData`** API.

---

## 2. Why does it exist?
Native HTML input elements are inherently stateful: when a user types into an `<input>`, the browser updates the input's visual value automatically without JavaScript.
- **The Controlled Pattern Exists Because**: In enterprise apps, developers often need instant feedback—such as validating password strength in real time, formatting credit card numbers with spaces as the user types, or disabling a "Submit" button until all required fields are valid. By controlling the input with React state, React has complete oversight of every single keystroke.
- **The Uncontrolled Pattern Exists Because**: Managing state for a massive 80-field form (e.g. tax software or medical intake forms) in React state can cause 80 re-renders per second, causing typing lag on low-end devices. Furthermore, certain native browser inputs (like `<input type="file" />`) are strictly read-only for security reasons and **must** be uncontrolled.

---

## 3. Mental Model
💡 **Think of it like Drive-by-Wire vs. Mechanical Bicycle Handlebars:**
- **Controlled Component (Modern Jet Fighter / Drive-by-Wire Steering)**:
  - When the pilot turns the control stick, the stick is **not mechanically connected to the wings**.
  - The stick sends an electronic signal to the Flight Computer (**`onChange` event**).
  - The Flight Computer verifies the aerodynamic safety limits (**State update & validation**).
  - The Flight Computer then tells the hydraulic wing flaps to move (**`value` prop**). React controls every millimeter of movement!
- **Uncontrolled Component (Mechanical Bicycle)**:
  - You turn the handlebars; the front wheel turns directly because of a physical steel rod (**The DOM handles state internally**).
  - You only check where the wheel is pointing when you reach a crossroad and want to decide where to go (**Pulling value on form submit via `ref.current.value`**).

### Architectural Comparison
```
CONTROLLED COMPONENT (React is the Single Source of Truth)
[ User Presses Key 'A' ]
           │
           ▼
[ Browser emits onChange event ]
           │
           ▼
[ React State Setter: setValue(e.target.value) ]
           │
           ▼
[ Component Re-renders: <input value={value} /> ]
           │
           ▼
[ Browser displays 'A' in the input box ]
(Every single keystroke triggers a full React render cycle!)

─────────────────────────────────────────────────────────────────────────────

UNCONTROLLED COMPONENT (DOM is the Single Source of Truth)
[ User Presses Key 'A' ] ──► [ DOM updates input text internally: 'A' ]
                             (Zero React re-renders! Zero overhead!)
                                      │
[ User Clicks 'Submit' Button ]       │
           │                          ▼
           └──────────────► [ React reads inputRef.current.value on-demand ]
```

---

## 4. Basic Example: Controlled vs. Uncontrolled Form Side-by-Side

### 1. Controlled Component (React State Driven):
```tsx
import React, { useState } from 'react';

export function ControlledInput() {
  const [email, setEmail] = useState('');

  return (
    <div>
      <input
        type="email"
        value={email} // Bound directly to React state
        onChange={(e) => setEmail(e.target.value)} // Syncs state on keystroke
        placeholder="Enter email..."
      />
      {email.length > 0 && !email.includes('@') && (
        <span style={{ color: 'red' }}>Invalid email address</span>
      )}
    </div>
  );
}
```

### 2. Uncontrolled Component (DOM & Ref Driven):
```tsx
import React, { useRef, FormEvent } from 'react';

export function UncontrolledInput() {
  const emailInputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    // Pull the value directly from the physical DOM node:
    console.log('Submitted Email:', emailInputRef.current?.value);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        ref={emailInputRef} // Attaches direct DOM node reference
        defaultValue="guest@example.com" // Initial value without controlling
        placeholder="Enter email..."
      />
      <button type="submit">Submit</button>
    </form>
  );
}
```

---

## 5. Real Example: The Mandatory Uncontrolled File Input
In browser security specifications, an `<input type="file" />` is strictly read-only from JavaScript for user privacy reasons. You **cannot** set its `value` programmatically (otherwise a malicious script could auto-select `/etc/passwd` or your private photos!).
- Therefore, file inputs in React **are always uncontrolled**:

```tsx
// FileUpload.tsx
import React, { useRef, FormEvent } from 'react';

export function FileUploadForm() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: FormEvent) => {
    e.preventDefault();
    const files = fileInputRef.current?.files;

    if (!files || files.length === 0) {
      alert('Please select a file to upload!');
      return;
    }

    const selectedFile = files[0];
    console.log('Selected file name:', selectedFile.name);
    console.log('File size (bytes):', selectedFile.size);

    // Prepare multipart upload
    const formData = new FormData();
    formData.append('avatar', selectedFile);

    // Dispatch upload to backend...
  };

  return (
    <form onSubmit={handleUpload}>
      {/* ⚠️ Value prop is FORBIDDEN on file inputs; use ref! */}
      <input type="file" ref={fileInputRef} accept="image/png, image/jpeg" />
      <button type="submit">Upload Photo</button>
    </form>
  );
}
```

---

## 6. Under the Hood: The "Changing Uncontrolled to Controlled" React Warning

Every React developer has encountered this famous console warning:
```
Warning: A component is changing an uncontrolled input to be controlled. 
This is likely caused by the value changing from undefined to a defined value, 
which should not happen.
```

### Why Does This Happen?
Look at this common junior bug:
```tsx
function BrokenForm() {
  // Initial state is undefined!
  const [name, setName] = useState<string | undefined>(undefined);

  return (
    <input 
      value={name} // 1st Render: value={undefined} -> React treats input as UNCONTROLLED!
      onChange={(e) => setName(e.target.value)} 
    />
  );
}
```
1. On initial mount, `name` is `undefined`. When React sees `value={undefined}`, it assumes you want an **Uncontrolled Input** where the DOM manages its own text.
2. The user types `"A"`. `setName("A")` is called.
3. On the second render, `value={"A"}` (a defined string). React suddenly sees a defined value and attempts to switch the input to **Controlled mode**!
4. React flags this as an error because switching control modes mid-lifecycle causes state desynchronization and resets cursor positions.
- **✅ The Golden Rule**: Always initialize controlled inputs with an empty string: `useState('')`, **never `undefined` or `null`**!

---

## 7. Important Rules of Form Inputs in React
1. **Never Mix `value` and `defaultValue`**:
   - `value`: Makes the input **Controlled** (requires an `onChange` handler).
   - `defaultValue`: Sets the initial value for an **Uncontrolled** input (ignored on subsequent re-renders).
2. **File Inputs are Always Uncontrolled**: Never pass a `value` prop to `<input type="file" />`.
3. **Radio Buttons and Checkboxes**: Use `checked` for controlled, and `defaultChecked` for uncontrolled.

---

## 8. Common Mistakes & Pitfalls

### ❌ Mistake 1: Read-Only Input Trap (Missing `onChange`)
```tsx
// ❌ THE LOCKED INPUT BUG:
<input type="text" value={user.name} />
```
- **The Bug**: The user tries to type into the input box, but **nothing happens**! The cursor won't budge!
- **Why it breaks**: You provided a `value` prop without an `onChange` listener. On every keystroke, React immediately overwrites the input with the unchanged `user.name` state!
- **Fix**: Either provide `onChange={(e) => ...}`, or use `readOnly={true}`, or switch to `defaultValue={user.name}`.

### ❌ Mistake 2: Performance Degradation in Massive Controlled Forms
- **The Problem**: A registration form with 40 inputs, each firing `setState` on every character. Every single keystroke re-renders the entire 40-input form, dropping frames.
- **The Senior Solution**: Use uncontrolled inputs with **React Hook Form** or native `FormData`! React Hook Form registers uncontrolled inputs via `ref`, isolating re-renders strictly to the input being typed into.

---

## 9. Best Practices in Modern Production
1. **Default to Controlled for Small/Medium Forms**: For forms with $<15$ inputs requiring live validation or masking, controlled inputs provide the cleanest, most predictable React architecture.
2. **Use React Hook Form for Enterprise Forms**: Leverages uncontrolled inputs under the hood for blazing $O(1)$ performance while exposing a clean, declarative API.
3. **Leverage the Native `FormData` API on Submit**:
   ```tsx
   function handleSubmit(e: FormEvent<HTMLFormElement>) {
     e.preventDefault();
     const data = new FormData(e.currentTarget);
     console.log(data.get('email'), data.get('password'));
   }
   ```
   Zero `useState` and zero `useRef` required for simple forms!

---

## 10. Performance Considerations: Keystroke Render Profiling
- **Controlled Input**: $N$ keystrokes = $N$ full component re-renders. If the component has heavy children, wrap children in `React.memo` or push the controlled input down into its own isolated sub-component.
- **Uncontrolled Input**: $N$ keystrokes = **0 component re-renders**. The browser's native C++ engine handles character insertion at 120fps.

---

## 11. Security Considerations: Password Inputs & Memory Retaining
- In controlled inputs, sensitive passwords sit as plaintext strings inside React's Virtual DOM Fiber tree and component closure memory for the duration of the session.
- While generally safe in standard web apps, in high-security banking portals, uncontrolled inputs cleared immediately after submission minimize the time sensitive credentials reside in JavaScript heap memory.

---

## 12. Complete Comparison Matrix
| Feature | Controlled Components | Uncontrolled Components |
|---|---|---|
| **Source of Truth** | React Component State | Native Browser DOM |
| **Data Retrieval** | Instant (already in state) | On-demand via `ref.current.value` or `FormData` |
| **Keystroke Re-renders** | ✅ Re-renders on every keystroke | ❌ Zero re-renders during typing |
| **Real-time Validation**| Trivial (validate inline on change) | Difficult (requires manual DOM listeners) |
| **Input Masking (Credit Cards)**| Easy (format state before render) | Complex |
| **File Inputs (`<input type="file">`)**| ❌ Impossible (Browser security rules) | ✅ **Mandatory** |
| **Best Used For** | Dynamic forms, search bars, modals | Large forms, file uploads, simple submissions |

---

## 13. Trade-offs: When to Pick Which?
- Pick **Controlled** when you need:
  - Instant live validation (password rules turning green/red as you type).
  - Dynamic input formatting (e.g. automatically inserting hyphens into phone numbers `(555) 019-2834`).
  - Disabling the submit button dynamically based on multiple form conditions.
- Pick **Uncontrolled** when you need:
  - High performance across dozens of inputs.
  - File uploads.
  - Quick, simple forms where you only care about values at the exact moment the "Submit" button is clicked.

---

## 14. Real-World Usage: Stripe Elements & Payment Forms
Stripe Elements (the embedded credit card fields on checkout pages) uses a hybrid model:
- The actual sensitive card number and CVV are hosted inside an **isolated cross-origin iframe (Uncontrolled by the host application)** so the merchant's JavaScript cannot accidentally log or steal the credit card number (PCI-DSS compliance).
- Stripe's SDK emits synthetic change events notifying the merchant's parent React app: `{ complete: true, brand: "visa" }`, allowing the parent app to control the "Pay Now" button's disabled state!

---

## 15. Placement Interview Questions

### Basic (Intern)
1. **What is the fundamental difference between a Controlled and an Uncontrolled component in React?**
   - *Spoken Answer*: "In a controlled component, the input's form data is handled by React state, which acts as the single source of truth; its value is passed via the `value` prop and updated via `onChange`. In an uncontrolled component, the form data is handled directly by the browser DOM itself, and React accesses values on-demand using a `ref` or native `FormData`."

### Conceptual (Junior SDE)
2. **What causes the warning: 'A component is changing an uncontrolled input to be controlled'?**
   - *Spoken Answer*: "This warning occurs when an input is initially mounted with its `value` set to `undefined` or `null`, causing React to interpret it as an uncontrolled input. When state updates and passes a defined string (like `'Hello'`), React sees the input switch to controlled mode. To fix it, always initialize controlled input state with an empty string: `useState('')`."

### Implementation (SDE-1)
3. **How do you handle an `<input type="file" />` in React, and can it ever be controlled?**
   - *Spoken Answer*: "An `<input type="file" />` in React **must always be an uncontrolled component**. Because of native browser security restrictions, the `value` of a file input is strictly read-only and cannot be set programmatically via JavaScript. To access the uploaded file in React, we attach a `useRef` to the input element and access the files on-demand via `fileInputRef.current.files` upon submission."

### Debugging
4. **A developer wrote `<input value="John" />`. When the user types on the keyboard, the input text never changes. Why?**
   - *Analysis*: Setting a hardcoded `value` prop without an `onChange` handler locks the input. On every keystroke, React's re-render forces the input back to `"John"`.
   - *Fix*: If the value should be editable, wire it to state with `onChange`: `<input value={name} onChange={e => setName(e.target.value)} />`. If it is just an initial default, use `defaultValue="John"`.

### Scenario-Based
5. **How does the popular library 'React Hook Form' achieve superior performance compared to traditional controlled form libraries like Formik?**
   - *Spoken Answer*: "Traditional form libraries like Formik use controlled components, binding every input to central state and re-rendering the entire form component tree on every keystroke. React Hook Form adopts an **uncontrolled architecture by default**: it registers inputs using `ref` callbacks and lets the native DOM manage typing performance, eliminating re-renders entirely until validation or submission occurs."

### Advanced (Tier-1 Product Company)
6. **How can you implement custom formatted input masking (e.g. credit card formatting `XXXX XXXX XXXX XXXX`) while preserving the user's cursor position?**
   - *Spoken Answer*: "Input masking must be implemented as a **Controlled Component**. Inside `onChange`, we strip non-numeric characters, format the string with spaces, and update React state.
     However, formatting resets the native input cursor to the end of the input! To preserve cursor position:
     1. Record `e.target.selectionStart` before formatting.
     2. In a `useLayoutEffect`, calculate how many spaces were added before the cursor.
     3. Call `inputRef.current.setSelectionRange(newPosition, newPosition)` synchronously before the browser repaints the screen."

---

## 16. Placement Coding Challenge: Custom Credit Card Masked Input
Implement a controlled credit card input component in TypeScript that automatically formats numbers into groups of 4 digits (`1234 5678 9012 3456`) and restricts input to a maximum of 16 digits:

```tsx
// CreditCardInput.tsx
import React, { useState, ChangeEvent } from 'react';

export function CreditCardInput() {
  const [formattedCard, setFormattedCard] = useState('');
  const [rawDigits, setRawDigits] = useState('');

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    // 1. Strip all non-digit characters:
    const input = e.target.value.replace(/\D/g, '');

    // 2. Restrict to max 16 digits:
    const truncated = input.slice(0, 16);

    // 3. Format into 4-digit chunks:
    const parts = truncated.match(/.{1,4}/g);
    const formatted = parts ? parts.join(' ') : '';

    setRawDigits(truncated);
    setFormattedCard(formatted);
  };

  return (
    <div className="card-input-container">
      <label>Credit Card Number:</label>
      <input
        type="text"
        value={formattedCard}
        onChange={handleChange}
        placeholder="4111 2222 3333 4444"
        maxLength={19} // 16 digits + 3 spaces
      />
      <small>Raw Value for API: {rawDigits}</small>
    </div>
  );
}
```

---

## 17. Common Interview Traps
- **Trap**: "Is `defaultValue` reactive if the parent passes a new prop later?"
  - *Trap Explanation*: **No!** `defaultValue` (and `defaultChecked`) only sets the initial value during the component's **initial mount**. If the parent re-renders with a different `defaultValue`, the input **ignores the new prop** and keeps its current DOM text! To force an uncontrolled input to reset to a new default, you must pass a unique `key` prop (e.g. `<input key={userId} defaultValue={user.email} />`).
- **Trap**: "Can an uncontrolled component perform validation?"
  - *Trap Explanation*: Yes! Uncontrolled inputs can leverage native HTML5 validation (`required`, `pattern`, `min/max`), or validate values on submit, or listen to native `onBlur` events using refs.

---

## 18. Revision Summary
- **Controlled**: React state is the single source of truth via `value` + `onChange`.
- **Uncontrolled**: Browser DOM is the source of truth via `defaultValue` + `ref` or `FormData`.
- File inputs (`<input type="file" />`) are **strictly uncontrolled**.
- Never initialize controlled state with `undefined` (causes uncontrolled-to-controlled warning).
- Controlled inputs re-render on every keystroke; uncontrolled inputs have zero re-render overhead.
- Use `key` on uncontrolled inputs to force a reset when initial defaults change.

---

## 19. Quick Reference Cheat Sheet
```tsx
// 1. Controlled Pattern:
<input value={text} onChange={e => setText(e.target.value)} />

// 2. Uncontrolled Pattern:
<input ref={inputRef} defaultValue="Initial" />
// Access value on submit: inputRef.current.value

// 3. Native FormData Pattern (No state, No refs):
const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  const formData = new FormData(e.currentTarget);
  const email = formData.get('email');
};
```
