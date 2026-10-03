# Route Handlers: Custom API Endpoints and Webhooks

## 1. What is it?
Route Handlers are custom request handlers defined inside `route.ts` (or `route.js`) files within the Next.js `app/` directory. They replace the legacy `pages/api` routes by leveraging the native Web Request and Response APIs (`NextRequest`, `NextResponse`). Route Handlers support standard HTTP methods:
- `GET`: Retrieve data (can be cached statically or evaluated dynamically).
- `POST`: Create resources or receive webhooks.
- `PUT` / `PATCH`: Update resources.
- `DELETE`: Remove resources.
- `HEAD` & `OPTIONS`: Handle CORS preflight and metadata queries.

```
+-------------------------------------------------------------------------------+
|                       ROUTE HANDLER ARCHITECTURE                              |
+-------------------------------------------------------------------------------+
| Client / External System (Stripe, Mobile App, Webhook Sender)                |
|    |                                                                          |
|    | HTTP Request (GET / POST / PUT / DELETE)                                 |
|    v                                                                          |
| app/api/v1/webhooks/stripe/route.ts                                           |
|    ├── export async function POST(req: NextRequest): Promise<NextResponse>   |
|    │     ├── 1. Read raw body buffer (for cryptographic signatures)          |
|    │     ├── 2. Validate Stripe / GitHub signature headers                   |
|    │     ├── 3. Execute business logic                                       |
|    │     └── 4. return NextResponse.json({ received: true }, { status: 200 })|
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?
While Server Actions handle mutations within a Next.js application, modern web systems frequently require standard HTTP endpoints for external communication:
- **Third-Party Webhooks:** Payment gateways (Stripe, PayPal, Razorpay) and CI/CD tools (GitHub, Slack) require public URLs to push asynchronous events.
- **Cross-Platform APIs:** Mobile applications (React Native, iOS, Android) and external microservices require standardized RESTful JSON endpoints.
- **Direct File Downloads & Streaming:** Exporting generated CSV/PDF files or streaming Large Language Model (LLM) tokens via `ReadableStream`.

Route Handlers satisfy these requirements using the Web Standards Request/Response paradigm, eliminating Node.js-specific `(req, res)` callback patterns.

---

## 3. Mental Model
Think of Route Handlers as **Dedicated Service Windows on the Exterior of a Fortress**:
- Server Components and Server Actions are the internal operations conducted behind the fortress walls for castle citizens.
- Route Handlers are the external service hatches facing the outside world (couriers, foreign ambassadors, delivery trucks).
- Anyone with the right token or authorization can walk up to an external service window and exchange structured data over standard HTTP.

---

## 4. Basic Example

### CRUD Route Handler with `NextRequest` and `NextResponse`
```typescript
// app/api/todos/route.ts
import { NextRequest, NextResponse } from 'next/server';

interface Todo {
  id: string;
  title: string;
}

let todos: Todo[] = [
  { id: '1', title: 'Review System Design architecture' },
];

// GET: Returns list of todos
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get('q');

  const filtered = query
    ? todos.filter((t) => t.title.toLowerCase().includes(query.toLowerCase()))
    : todos;

  return NextResponse.json(filtered, { status: 200 });
}

// POST: Creates a new todo item
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.title) {
      return NextResponse.json(
        { error: 'Field "title" is required' },
        { status: 400 }
      );
    }

    const newTodo: Todo = {
      id: Date.now().toString(),
      title: body.title,
    };
    todos.push(newTodo);

    return NextResponse.json(newTodo, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: 'Malformed JSON payload' }, { status: 400 });
  }
}
```

---

## 5. Real Example

### Secure Stripe Webhook Handler with Raw Body Signature Verification
```typescript
// app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2023-10-16',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(req: NextRequest) {
  try {
    // 1. Webhook signatures require the RAW unmodified text/buffer body
    const rawBody = await req.text();
    const signature = req.headers.get('stripe-signature');

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing stripe-signature header' },
        { status: 400 }
      );
    }

    // 2. Cryptographic signature verification
    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err: any) {
      console.error(`Webhook signature verification failed: ${err.message}`);
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // 3. Process the event idempotently
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log(`Payment confirmed for customer: ${session.customer}`);
        // Fulfill order in database...
        break;
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        console.log(`Subscription cancelled: ${subscription.id}`);
        // Revoke user access...
        break;
      }
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error('Webhook execution failure:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
```

---

## 6. Under the Hood

### 1. Static vs. Dynamic Evaluation of Route Handlers
Route Handlers evaluate statically or dynamically depending on the HTTP method and configuration:
- `GET` handlers that do **not** use the `Request` object (or dynamic functions) are evaluated **statically at build time** and cached as static JSON!
- A `GET` handler becomes **dynamic** if:
  1. It reads from the `request` argument (e.g. `request.nextUrl.searchParams`).
  2. It accesses `cookies()` or `headers()` from `next/headers`.
  3. It uses dynamic segment options (`export const dynamic = 'force-dynamic'`).
- `POST`, `PUT`, `PATCH`, and `DELETE` handlers are **always dynamic**.

### 2. Edge vs. Node.js Runtime
Route Handlers can run on either the standard Node.js server runtime or the ultra-low latency Edge runtime:
```typescript
export const runtime = 'edge'; // Runs on Vercel/Cloudflare Edge network worldwide
```

---

## 7. Important Rules
1. **No Co-location with `page.tsx`:** A folder cannot contain both a `route.ts` and a `page.tsx`. Route handlers take over the entire endpoint.
2. **Always Return a `Response` or `NextResponse`:** If a handler function completes without returning a valid Response object, Next.js logs an error and returns HTTP 500.
3. **Cookies and Headers in Handlers:** Use `req.cookies` and `req.headers` on incoming requests, or use `NextResponse.json(data, { headers: { ... } })` to send headers back.
4. **Webhooks Require Raw Strings:** When verifying HMAC signatures for Stripe or GitHub, never use `req.json()` before verifying. Parse the raw string via `req.text()` first, because JSON serialization alters whitespace, breaking the hash match.

---

## 8. Common Mistakes

### Mistake 1: Unexpected Caching of GET Handlers
```typescript
// app/api/time/route.ts
// ❌ GOTCHA: Next.js evaluates this at build time! Every caller gets the exact same timestamp!
export async function GET() {
  return NextResponse.json({ timestamp: new Date().toISOString() });
}

// Fix: Force dynamic evaluation
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ timestamp: new Date().toISOString() });
}
```

### Mistake 2: Parsing `req.json()` on Webhook Signature Verifications
```typescript
// ❌ WRONG: Breaks cryptographic HMAC signatures!
const body = await req.json();
stripe.webhooks.constructEvent(JSON.stringify(body), sig, secret); // FAILS!
```
**Fix:** Always use `const rawBody = await req.text();`.

---

## 9. Best Practices
1. **Structure APIs with Versioning:** Keep your endpoints clean by using versioned folders: `app/api/v1/users/route.ts`.
2. **Enforce Strict Schema Validation with Zod:** Always validate request payloads before processing:
   ```typescript
   const result = UserSchema.safeParse(await req.json());
   if (!result.success) return NextResponse.json(result.error, { status: 422 });
   ```
3. **Implement Standardized Error Envelopes:**
   ```typescript
   return NextResponse.json({ success: false, error: { code: 'NOT_FOUND', message: 'Item missing' } }, { status: 404 });
   ```

---

## 10. Performance Considerations
- **Streaming Responses:** You can return a `ReadableStream` from a Route Handler to stream data incrementally (e.g. AI token completions or large CSV exports) without buffering the entire response in memory.
- **Edge Deployment:** Setting `export const runtime = 'edge'` places your route handler within milliseconds of global users.

---

## 11. Security Considerations
- **CORS Configuration:** Next.js route handlers follow Same-Origin Policy by default. To allow external mobile apps or cross-origin web apps to call your API, configure CORS headers in `OPTIONS` and response headers.
- **Rate Limiting:** Protect public Route Handlers against DDoS attacks using Redis-backed rate limiters (e.g., Upstash Ratelimit).

---

## 12. Alternatives
- **Server Actions:** Ideal for internal app form mutations; zero API boilerplate.
- **Standalone Express / NestJS Server:** Ideal for large dedicated backend microservices with complex middleware chains.

---

## 13. Trade-offs

| Strategy | Advantages | Drawbacks |
| :--- | :--- | :--- |
| **Route Handlers** | Standard HTTP REST API; accessible by mobile & webhooks | Requires manual validation and routing boilerplate |
| **Server Actions** | Zero boilerplate; integrated with React forms | Cannot be invoked easily by external third-party webhooks |
| **Edge Handlers** | Sub-10ms global TTFB | Limited Node.js native API access (no `fs`, limited crypto) |

---

## 14. Real-World Usage
- **AI Streaming Endpoint (ChatGPT clone):** A `POST /api/chat` Route Handler calls the OpenAI API and streams the generated text tokens directly to the client browser via `OpenAIStream`.
- **Payment Gateway Webhook:** A `POST /api/webhooks/razorpay` handler verifies HMAC-SHA256 signatures, credits customer accounts, and logs events.

---

## 15. Placement Interview Questions

### Basic
**Q: What is a Route Handler in Next.js App Router?**  
*Answer:* A Route Handler is a server-side endpoint defined in a `route.ts` file that uses standard Web Request and Response APIs (`NextRequest`, `NextResponse`) to handle specific HTTP methods (`GET`, `POST`, `PUT`, `DELETE`). It is the App Router's replacement for `pages/api` routes.

### Conceptual
**Q: Under what conditions does a `GET` Route Handler become cached as a static route?**  
*Answer:* A `GET` Route Handler is cached statically at build time if it does not read from the incoming `request` object (e.g. query parameters), does not use dynamic headers/cookies (`cookies()`, `headers()`), and does not explicitly set `dynamic = 'force-dynamic'`.

### Implementation
**Q: How do you handle CORS preflight requests in a Route Handler?**  
*Answer:* Export an `OPTIONS` function returning the appropriate Access-Control headers:
```typescript
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
```

### Debugging
**Q: A developer cannot read cookies in a Route Handler using `document.cookie`. How should cookies be accessed and modified?**  
*Answer:* Route Handlers run on the server where `document` does not exist. Read cookies from `req.cookies.get('token')` or import `cookies` from `next/headers`. Set cookies by returning a `NextResponse` and calling `response.cookies.set('name', 'val')`.

### Scenario
**Q: Why does Stripe webhook verification fail when using `const body = await req.json()` in Next.js?**  
*Answer:* Cryptographic signature verification requires the exact byte-for-byte raw body string that Stripe signed with their private key. Calling `req.json()` parses and transforms the payload, altering whitespace and formatting. The verification must use `const rawBody = await req.text()`.

### Advanced
**Q: How do you implement a streaming response in a Next.js Route Handler?**  
*Answer:* Return a `Response` initialized with a `ReadableStream`:
```typescript
export async function GET() {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (let i = 1; i <= 5; i++) {
        controller.enqueue(encoder.encode(`data: Chunk ${i}\n\n`));
        await new Promise((r) => setTimeout(r, 500));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' },
  });
}
```

---

## 16. Coding Questions

### Problem: Build an Authenticated API Endpoint with Rate Limiting and Token Validation
```typescript
// app/api/v1/profile/route.ts
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Unauthorized: Missing or malformed Bearer token' },
      { status: 401 }
    );
  }

  const token = authHeader.split(' ')[1];

  // Token validation simulation
  if (token !== 'secret-test-token-123') {
    return NextResponse.json(
      { error: 'Forbidden: Invalid authorization token' },
      { status: 403 }
    );
  }

  return NextResponse.json({
    user: {
      id: 'usr_8923',
      name: 'Senior Fullstack Engineer',
      tier: 'Enterprise',
      permissions: ['read:metrics', 'write:deployments'],
    },
  });
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "Route handlers and `page.tsx` can live in the same directory."  
  *Truth:* False. Next.js enforces route exclusivity: a folder can have either a `page.tsx` or a `route.ts`, never both.
- **Trap 2:** "`GET` route handlers are always dynamically executed."  
  *Truth:* False. By default, `GET` route handlers without request access are statically evaluated at build time.

---

## 18. Revision Summary
- Route Handlers (`route.ts`) provide standard HTTP REST endpoints (`GET`, `POST`, `PUT`, `DELETE`).
- They use the Web Standard `NextRequest` and `NextResponse`.
- Dynamic functions or reading query parameters switch `GET` handlers from static to dynamic.
- Webhooks must parse raw text using `req.text()` to verify cryptographic signatures.
- Streaming responses can be achieved via `ReadableStream`.

---

## 19. Quick Reference

```
+------------------------------------+-------------------------------------------+
| Method / Signature                 | Description                               |
+------------------------------------+-------------------------------------------+
| export async function GET(req)     | Handles HTTP GET requests                 |
| export async function POST(req)    | Handles HTTP POST requests / webhooks     |
| req.nextUrl.searchParams.get('q')  | Parses URL query parameters               |
| req.cookies.get('session')         | Reads incoming cookie values              |
| await req.text()                   | Reads raw string body for signature checks|
| await req.json()                   | Parses incoming JSON body                 |
| NextResponse.json(body, { status })| Sends standardized JSON response          |
| export const runtime = 'edge'      | Deploys handler to global edge network    |
+------------------------------------+-------------------------------------------+
```
