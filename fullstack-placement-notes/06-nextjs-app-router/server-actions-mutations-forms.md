# Server Actions: Mutations, Forms, and Progressive Enhancement

## 1. What is it?
Server Actions are asynchronous server-side functions defined with the `'use server'` directive that can be called directly from Client Components, Server Components, or native HTML `<form>` elements. They enable full-stack data mutations without the developer having to manually create, maintain, or secure dedicated REST API endpoints (`/api/items/create`).
- **Progressive Enhancement:** Works natively with HTML `<form action={serverAction}>`, allowing forms to submit and mutate data even if JavaScript is disabled or still loading on the client!
- **State Integration:** Pairs with React hooks like `useActionState`, `useFormStatus`, and `useOptimistic` to provide loading spinners, error feedback, and instantaneous UI updates.

```
+-------------------------------------------------------------------------------+
|                        SERVER ACTIONS ARCHITECTURE                            |
+-------------------------------------------------------------------------------+
| Client Form (<form action={createPost}>)                                      |
|    |                                                                          |
|    | (POST Request with FormData over HTTP POST)                              |
|    v                                                                          |
| Server Action ('use server')                                                  |
|    ├── 1. Validates input schema (Zod)                                        |
|    ├── 2. Authenticates caller & verifies session cookies                     |
|    ├── 3. Executes direct database mutation (SQL / Prisma)                    |
|    ├── 4. Invalidates cached pages (revalidatePath / revalidateTag)           |
|    └── 5. Returns structured state or redirects user                          |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?
In traditional React applications:
- Performing a mutation required creating an API endpoint (`pages/api/todos.ts`), handling HTTP methods (`if (req.method === 'POST')`), parsing JSON, and writing boilerplate `fetch()` calls on the client with `onSubmit={e => { e.preventDefault(); ... }}`.
- If client JavaScript had not finished downloading, clicking the Submit button did nothing or broke the page.
- Managing optimistic updates and re-fetching stale data required complex state coordination libraries.

Server Actions bridge the frontend-backend divide by allowing developers to invoke server code as if it were a local function, while maintaining full progressive enhancement and type safety.

---

## 3. Mental Model
Think of Server Actions as a **Pneumatic Tube System in a Bank Drive-Through**:
- You (the client) fill out a paper deposit slip (the `<form>`).
- You place the slip in the capsule and press the button (submit).
- The pneumatic tube physically sends the slip to the teller behind bulletproof glass (the server).
- Even if the bank's digital touchscreen is rebooting (JS not ready), the pneumatic physical tube still drops the paper slip onto the teller's desk!
- The teller verifies the slip, stamps your account, updates the balance, and sends back your receipt.

---

## 4. Basic Example

### Server Action with Native Progressive Enhancement
```typescript
// app/actions/todos.ts
'use server';

import db from '@/lib/db';
import { revalidatePath } from 'next/cache';

export async function createTodo(formData: FormData) {
  const title = formData.get('title') as string;

  if (!title || title.trim().length === 0) {
    throw new Error('Title cannot be empty');
  }

  // Direct database query on server
  await db.todo.create({
    data: { title: title.trim(), completed: false },
  });

  // Automatically refresh the todo list route
  revalidatePath('/todos');
}
```

```typescript
// app/todos/page.tsx (Server Component)
import db from '@/lib/db';
import { createTodo } from '@/app/actions/todos';

export default async function TodosPage() {
  const todos = await db.todo.findMany({ orderBy: { createdAt: 'desc' } });

  return (
    <main className="p-8 max-w-md mx-auto">
      <h1 className="text-2xl font-bold mb-4">Todo Task Manager</h1>

      {/* Progressively Enhanced: Submits even if JS is disabled! */}
      <form action={createTodo} className="flex gap-2 mb-6">
        <input
          type="text"
          name="title"
          placeholder="New task..."
          required
          className="flex-1 p-2 border rounded"
        />
        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded">
          Add
        </button>
      </form>

      <ul className="space-y-2">
        {todos.map((t) => (
          <li key={t.id} className="p-2 border rounded">{t.title}</li>
        ))}
      </ul>
    </main>
  );
}
```

---

## 5. Real Example

### Production Form with `useActionState`, Zod Validation, and Pending States
```typescript
// app/actions/authActions.ts
'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';

const RegisterSchema = z.object({
  email: z.string().email('Invalid email address format'),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
});

export interface ActionState {
  errors?: {
    email?: string[];
    password?: string[];
  };
  message?: string;
}

export async function registerUserAction(
  prevState: ActionState,
  formData: FormData
): Promise<ActionState> {
  // 1. Validate Form Data with Zod
  const validatedFields = RegisterSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!validatedFields.success) {
    return {
      errors: validatedFields.error.flatten().fieldErrors,
      message: 'Validation failed. Please correct the errors below.',
    };
  }

  const { email, password } = validatedFields.data;

  // 2. Perform Account Creation Mutation
  try {
    // Simulated DB write
    console.log(`Creating user record: ${email}`);
  } catch (err) {
    return { message: 'Database error: Account already exists.' };
  }

  // 3. Server-side redirect to dashboard
  redirect('/dashboard');
}
```

```typescript
// components/auth/RegisterForm.tsx
'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { registerUserAction, ActionState } from '@/app/actions/authActions';

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full py-2 bg-indigo-600 text-white font-semibold rounded disabled:bg-indigo-300"
    >
      {pending ? 'Registering Account...' : 'Create Account'}
    </button>
  );
}

export function RegisterForm() {
  const [state, formAction] = useActionState(registerUserAction, initialState);

  return (
    <form action={formAction} className="space-y-4 max-w-sm mx-auto p-6 border rounded-lg bg-white">
      {state.message && (
        <div className="p-3 bg-red-100 text-red-800 rounded text-sm">{state.message}</div>
      )}

      <div>
        <label className="block text-sm font-medium">Email</label>
        <input name="email" type="email" className="w-full p-2 border rounded mt-1" />
        {state.errors?.email && (
          <p className="text-red-500 text-xs mt-1">{state.errors.email[0]}</p>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium">Password</label>
        <input name="password" type="password" className="w-full p-2 border rounded mt-1" />
        {state.errors?.password && (
          <p className="text-red-500 text-xs mt-1">{state.errors.password[0]}</p>
        )}
      </div>

      <SubmitButton />
    </form>
  );
}
```

---

## 6. Under the Hood

### 1. The RPC Protocol
When a Client Component invokes a Server Action:
1. The browser does NOT perform a traditional page reload. It makes an HTTP `POST` request to the current URL.
2. An internal header `Next-Action: <ACTION_ID_HASH>` is transmitted.
3. The Next.js server matches the hash to the compiled server action closure, executes it with the submitted `FormData` or JSON parameters, and returns an updated RSC payload stream.
4. The client receives the response and seamlessly reconciles the DOM, executing any cache revalidations without a page refresh!

### 2. Progressive Enhancement Fallback
If JavaScript is disabled or blocked:
- The browser submits the form via standard HTTP `POST` with `multipart/form-data`.
- The Next.js server handles the POST, runs the action, calls `revalidatePath()`, and returns a full, newly-rendered HTML page.

---

## 7. Important Rules
1. **Mark Files or Functions with `'use server'`:** Place `'use server'` at the top of a dedicated action file to export multiple actions, or declare it inline at the top of an async function body inside a Server Component.
2. **Arguments Must Be Serializable:** If invoking an action imperatively (e.g. `onClick={() => myAction(data)}`), all arguments must be serializable.
3. **Never Trust Form Input:** Client-side HTML validation attributes (`required`, `type="email"`) can be bypassed trivially. Always validate inputs on the server using Zod.
4. **`redirect()` Throws a Special Error:** Next.js implements redirects by throwing a special `NEXT_REDIRECT` error. Never wrap `redirect()` inside a generic `try/catch` block without re-throwing it:
   ```typescript
   try {
     redirect('/dashboard');
   } catch (err) {
     if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err;
     // Handle real errors...
   }
   ```

---

## 8. Common Mistakes

### Mistake 1: Swallowing `redirect()` Inside a Try/Catch Block
```typescript
// ❌ WRONG: Catching all errors prevents Next.js redirect from executing!
try {
  // mutation...
  redirect('/success');
} catch (error) {
  return { message: 'Something went wrong' }; // Caught the redirect error!
}
```

### Mistake 2: Using `useFormStatus` in the Same Component That Contains the `<form>`
```typescript
// ❌ WRONG: useFormStatus reads context from a PARENT form. It must be a child component!
export function Form() {
  const { pending } = useFormStatus(); // Always false!
  return <form>...</form>;
}
```

---

## 9. Best Practices
1. **Combine with `useOptimistic` for Instant Feedback:** Display the newly added comment or like counter immediately on the client before the server network round-trip finishes.
2. **Dedicated Actions Directory:** Keep actions clean and organized in `app/actions/` (e.g., `userActions.ts`, `billingActions.ts`).
3. **Always Check Authentication Inside the Action:** Do not assume that because the user is on an authenticated page, the action call is authorized. Verify session tokens on the server:
   ```typescript
   const session = await getSession();
   if (!session) throw new Error('Unauthorized');
   ```

---

## 10. Performance Considerations
- **Eliminates Client API Code:** No need for Axios, TanStack Query mutation boilerplate, or custom fetch handlers. The entire client mutation code reduces to passing the action reference.
- **Combined Mutation and Invalidation:** A single Server Action call executes the database write and returns the updated RSC payload in the same HTTP round-trip, eliminating the "mutate then re-fetch" waterfall.

---

## 11. Security Considerations
- **CSRF Protection Built-in:** Next.js Server Actions compare the `Origin` and `Host` headers on incoming requests to prevent Cross-Site Request Forgery attacks automatically.
- **Closure Variable Poisoning:** Avoid referencing outer scope variables in inline server actions if they contain sensitive data that should not be serialized into hidden fields.

---

## 12. Alternatives
- **Route Handlers (`app/api/.../route.ts`):** Standard REST endpoints. Preferred for third-party webhooks (Stripe, GitHub) or mobile app APIs.
- **GraphQL Mutations:** Good for multi-platform ecosystems, but requires heavy schema tooling and client libraries.

---

## 13. Trade-offs

| Strategy | Advantages | Drawbacks |
| :--- | :--- | :--- |
| **Server Actions** | Zero client boilerplate; full progressive enhancement | Coupled directly to Next.js; hard to consume from native mobile apps |
| **Route Handlers (REST)**| Universal (consumable by iOS/Android apps) | Requires manual client fetch, state, and serialization boilerplate |
| **GraphQL** | Client-defined field payloads | High tooling complexity and maintenance overhead |

---

## 14. Real-World Usage
- **Stripe Checkout Session Initiation:** Clicking "Upgrade to Pro" triggers a Server Action that securely calls Stripe SDK with the server secret key and redirects the browser to the Stripe hosted checkout URL.
- **E-Commerce Shopping Cart:** Adding an item to the cart uses `useOptimistic` to show the item in the cart drawer instantly, while a Server Action writes to PostgreSQL and revalidates the cart layout in the background.

---

## 15. Placement Interview Questions

### Basic
**Q: What is a Server Action in Next.js?**  
*Answer:* A Server Action is an asynchronous server-side function marked with `'use server'` that can be called directly from Client or Server Components. It executes on the server, handles mutations, and automatically integrates with Next.js caching and progressive enhancement.

### Conceptual
**Q: How do Server Actions achieve progressive enhancement?**  
*Answer:* Because Server Actions can be passed directly to the `action` attribute of an HTML `<form>`, the browser can submit the form using standard HTTP `POST` even if JavaScript has not loaded or is disabled. Next.js handles the POST on the server and returns the updated page.

### Implementation
**Q: Implement an optimistic "Like Button" using `useOptimistic` and a Server Action.**  
*Answer:*
```typescript
'use client';
import { useOptimistic, useTransition } from 'react';

export function LikeButton({ likes, postId, likeAction }: { likes: number; postId: string; likeAction: (id: string) => Promise<void> }) {
  const [isPending, startTransition] = useTransition();
  const [optimisticLikes, setOptimisticLikes] = useOptimistic(
    likes,
    (current, update: number) => current + update
  );

  return (
    <button
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          setOptimisticLikes(1);
          await likeAction(postId);
        });
      }}
      className="px-3 py-1.5 bg-rose-50 text-rose-600 rounded-full font-bold border border-rose-200"
    >
      ❤️ {optimisticLikes}
    </button>
  );
}
```

### Debugging
**Q: A developer puts `const { pending } = useFormStatus()` inside the component that renders `<form action={...}>`, but `pending` is never true. Why?**  
*Answer:* The `useFormStatus` hook uses React Context internally and must be called from a component that is a **child** of the `<form>`, not within the component that renders the `<form>` itself.

### Scenario
**Q: How should you handle file uploads with Server Actions?**  
*Answer:* Use standard HTML `<input type="file" name="attachment" />`. The Server Action receives a `FormData` object containing the `File` blob:
```typescript
'use server';
export async function uploadFile(formData: FormData) {
  const file = formData.get('attachment') as File;
  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);
  // Upload buffer to S3 / Cloud Storage...
}
```

### Advanced
**Q: How does Next.js protect Server Actions against CSRF attacks?**  
*Answer:* Next.js checks incoming Server Action requests by comparing the `Host` or `X-Forwarded-Host` header with the request's `Origin` header. If the origins do not match, Next.js rejects the action request with a 403 Forbidden status.

---

## 16. Coding Questions

### Problem: Build a Comment Submission Action with Zod Validation and Error Feedback
```typescript
// app/actions/comments.ts
'use server';

import { z } from 'zod';
import { revalidateTag } from 'next/cache';

const CommentSchema = z.object({
  postId: z.string().uuid(),
  author: z.string().min(2, 'Name must be at least 2 characters'),
  content: z.string().min(5, 'Comment must be at least 5 characters').max(500),
});

export async function addCommentAction(prevState: any, formData: FormData) {
  const rawData = {
    postId: formData.get('postId'),
    author: formData.get('author'),
    content: formData.get('content'),
  };

  const parsed = CommentSchema.safeParse(rawData);

  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.flatten().fieldErrors,
    };
  }

  // Database insertion simulation
  console.log('Inserting comment:', parsed.data);

  revalidateTag(`comments-${parsed.data.postId}`);
  return { success: true, errors: {} };
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "Server actions are only for form submissions."  
  *Truth:* False! Server Actions can be called programmatically from anywhere, including `onClick` handlers, `useEffect` triggers, or custom button handlers.
- **Trap 2:** "Server Actions replace all REST APIs in every project."  
  *Truth:* False. Server Actions are designed for application mutations within Next.js. Third-party integrations (webhooks, external mobile apps) still require standard Route Handlers (`route.ts`).

---

## 18. Revision Summary
- Server Actions (`'use server'`) execute on the server and eliminate the need for manual API endpoint creation.
- They support progressive enhancement via HTML `<form action={serverAction}>`.
- Use `useActionState` to track state and error messages, and `useFormStatus` (in a child component) to track pending status.
- Use `useOptimistic` for instant UI updates before the server response returns.
- Always validate incoming inputs using Zod on the server.

---

## 19. Quick Reference

```
+------------------------------------+-------------------------------------------+
| Hook / Feature                     | Usage / Purpose                           |
+------------------------------------+-------------------------------------------+
| 'use server'                       | Marks action file or function boundary    |
| useActionState(fn, init)           | Returns [state, formAction, isPending]    |
| useFormStatus()                    | Returns { pending, data, method, action } |
| useOptimistic(state, updateFn)     | Renders optimistic state during mutation  |
| revalidatePath('/path')            | Revalidates route cache after mutation    |
| revalidateTag('tag')               | Revalidates tagged cache entries          |
+------------------------------------+-------------------------------------------+
```
