# Mocking, Spies, Stubs & MSW: Network Interception & Test Double Architecture

## 1. What is it?
**Test Doubles** are generic stand-ins used in automated testing to replace real production components (such as third-party APIs, database connections, email servers, or hardware sensors) that are too slow, non-deterministic, expensive, or destructive to run during unit or integration tests. Gerard Meszaros codified the taxonomy of test doubles into five distinct categories: **Dummies**, **Stubs**, **Spies**, **Mocks**, and **Fakes**.

**Mock Service Worker (MSW)** is the modern standard for network-level mocking in JavaScript and TypeScript. Unlike traditional library monkey-patching (which overwrites `global.fetch` or `axios`), MSW intercepts requests at the **network protocol level** using the Service Worker API in the browser and Node.js request interceptors (`node:http`) in Node/Vitest.

```
┌─────────────────────────────────────────────────────────────┐
│ Application Code (Executes real `fetch` / `axios` normally) │
└──────────────────────────────┬──────────────────────────────┘
                               │ Real HTTP Request Initiated
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ MSW Network Interceptor Boundary                            │
│ - In Node.js / Vitest: Intercepts `http`, `https`, `fetch`  │
│ - In Browser: Intercepts via Service Worker Cache API       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                ┌──────────────┴──────────────┐
                ▼                             ▼
       [ Matched Route ]              [ Unhandled Route ]
   Returns Mocked Response            Forward to Real Network
   (HttpResponse.json({...}))         (or throw Error)
```

---

## 2. Why does it exist?
Without robust test doubles and network mocking, software verification breaks down in production pipelines:

1. **Flaky Network Latency & Rate Limits**: Relying on live external APIs (Stripe, Twilio, OpenAI, GitHub) causes CI builds to fail intermittently due to internet hiccups, rate limits (`HTTP 429`), or third-party outages.
2. **Financial Cost & Destructive Side Effects**: Running automated test suites against a live payment gateway or SMS provider incurs monetary costs and risks triggering real credit card charges or sending test SMS messages to real phone numbers.
3. **Impossibility of Simulating Edge-Case Failures**: It is nearly impossible to force a live external service to return a `504 Gateway Timeout`, a malformed JSON payload, or an expired SSL certificate on demand. Test doubles simulate these scenarios deterministically.
4. **The Flaw of Monkey-Patching `fetch`**: Manually replacing `global.fetch = vi.fn()` tightly couples tests to implementation details and fails to validate request headers, serialization, and cookie handling.

---

## 3. Mental Model: The 5 Types of Test Doubles

```
┌────────────┬─────────────────────────────────────────────────────────────┐
│ Type       │ Definition & Purpose                                        │
├────────────┼─────────────────────────────────────────────────────────────┤
│ 1. Dummy   │ Passed around but never actually used (e.g. filler params)   │
│ 2. Stub    │ Returns hardcoded canned answers to method calls            │
│ 3. Spy     │ Wraps real logic, records calls, arguments & invocation count│
│ 4. Mock    │ Pre-programmed with expectations that must be verified      │
│ 5. Fake    │ Working implementation with a shortcut (e.g. In-memory DB)   │
└────────────┴─────────────────────────────────────────────────────────────┘
```

- **Stub**: A vending machine dummy that dispenses a cold soda every time you press any button, regardless of payment.
- **Spy**: An investigator standing behind the real cashier, noting down how many customers visited and what bills they handed over.
- **Mock**: A strict security guard expecting you to present a badge exactly twice; if you present it once or three times, an alarm sounds.
- **Fake**: A working toy safe (in-memory SQLite) instead of a 2-ton titanium bank vault (real multi-node PostgreSQL).

---

## 4. Basic Example: Spies and Stubs in Vitest (`vi.fn()` & `vi.spyOn()`)

```typescript
import { describe, it, expect, vi } from 'vitest';

// Target Service
export class NotificationService {
  public static sendEmail(to: string, subject: string): boolean {
    // Real external SMTP logic would live here
    console.log(`Sending live email to ${to}`);
    return true;
  }
}

export class OrderProcessor {
  public process(orderId: string, email: string): string {
    const success = NotificationService.sendEmail(email, 'Order Placed');
    return success ? `ORDER_${orderId}_CONFIRMED` : 'FAILED';
  }
}

describe('Spies and Stubs with Vitest', () => {
  it('spies on NotificationService without modifying behavior', () => {
    // 1. Create a Spy on a real method
    const emailSpy = vi.spyOn(NotificationService, 'sendEmail');

    const processor = new OrderProcessor();
    processor.process('1001', 'user@test.com');

    // 2. Assert spy invocations
    expect(emailSpy).toHaveBeenCalledTimes(1);
    expect(emailSpy).toHaveBeenCalledWith('user@test.com', 'Order Placed');

    // 3. Restore original method
    emailSpy.mockRestore();
  });

  it('stubs NotificationService to simulate failure', () => {
    // Mock implementation replaces real execution
    const emailSpy = vi.spyOn(NotificationService, 'sendEmail').mockReturnValue(false);

    const processor = new OrderProcessor();
    const status = processor.process('1002', 'user@test.com');

    expect(status).toBe('FAILED');
    expect(emailSpy).toHaveBeenCalledWith('user@test.com', 'Order Placed');

    emailSpy.mockRestore();
  });
});
```

---

## 5. Real-World Production Example: Network Mocking with Mock Service Worker (MSW v2)

In modern fullstack applications, **MSW v2** is used to intercept all outbound HTTP requests across both frontend (React) and backend (Node.js/Express) tests.

```typescript
// src/services/PaymentClient.ts
export interface ChargeResponse {
  transactionId: string;
  amount: number;
  status: 'succeeded' | 'declined';
}

export class PaymentClient {
  constructor(private baseUrl: string = 'https://api.payments.com') {}

  async createCharge(token: string, amountCents: number): Promise<ChargeResponse> {
    const res = await fetch(`${this.baseUrl}/v1/charges`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ amount: amountCents }),
    });

    if (res.status === 402) {
      throw new Error('Card Declined');
    }

    if (!res.ok) {
      throw new Error(`Payment gateway error: ${res.status}`);
    }

    return (await res.json()) as ChargeResponse;
  }
}

// ==========================================
// Test Suite: PaymentClient.test.ts (MSW v2)
// ==========================================
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { PaymentClient } from './PaymentClient';

// 1. Declare default MSW Handlers
const handlers = [
  http.post('https://api.payments.com/v1/charges', async ({ request }) => {
    const authHeader = request.headers.get('Authorization');
    if (authHeader !== 'Bearer valid_tok') {
      return new HttpResponse(null, { status: 401 });
    }

    const body = (await request.json()) as { amount: number };

    // Simulate Card Declined for amounts over $1,000
    if (body.amount > 100000) {
      return HttpResponse.json({ error: 'Card Declined' }, { status: 402 });
    }

    return HttpResponse.json({
      transactionId: 'tx_live_777',
      amount: body.amount,
      status: 'succeeded',
    });
  }),
];

// 2. Setup Node.js Network Interceptor Server
const server = setupServer(...handlers);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers()); // Cleans runtime overrides

describe('PaymentClient with MSW v2', () => {
  const client = new PaymentClient();

  it('successfully executes charge with 200 response', async () => {
    const response = await client.createCharge('valid_tok', 5000);

    expect(response).toEqual({
      transactionId: 'tx_live_777',
      amount: 5000,
      status: 'succeeded',
    });
  });

  it('handles Card Declined (402) error gracefully', async () => {
    await expect(client.createCharge('valid_tok', 150000)).rejects.toThrow('Card Declined');
  });

  it('handles 500 Internal Server Error using runtime override', async () => {
    // Temporarily override handler for a single test
    server.use(
      http.post('https://api.payments.com/v1/charges', () => {
        return new HttpResponse(null, { status: 500 });
      })
    );

    await expect(client.createCharge('valid_tok', 5000)).rejects.toThrow(
      'Payment gateway error: 500'
    );
  });
});
```

---

## 6. Under the Hood: MSW vs `vi.fn()` vs Nock vs Fetch-Mock

```
┌─────────────────┬────────────────────┬────────────────────┬─────────────────────┐
│ Feature         │ MSW (v2)           │ vi.fn() on fetch   │ Nock                │
├─────────────────┼────────────────────┼────────────────────┼─────────────────────┤
│ Interception Pt │ Real Network Level │ In-Memory JS Object│ Node http.ClientReq │
│ Browser Support │ Yes (ServiceWorker)│ Yes (JSDOM only)   │ No (Node.js only)   │
│ Client Agnostic │ Yes (fetch, axios) │ No (bound to fetch)│ Partial             │
│ Refactoring Safe│ ⭐⭐⭐⭐⭐ (Highest) │ ⭐⭐ (Fragile)     │ ⭐⭐⭐⭐            │
│ Request Payload │ Real serialization │ Raw passed args    │ Serialized stream   │
└─────────────────┴────────────────────┴────────────────────┴─────────────────────┘
```

---

## 7. Important Rules

1. **Always Reset Handlers in `afterEach`**: With MSW, always call `server.resetHandlers()` in `afterEach`. If test A overrides a route to return a 500 error, failing to reset it causes tests B, C, and D to fail unexpectedly.
2. **Configure `onUnhandledRequest: 'error'`**: Always configure `server.listen({ onUnhandledRequest: 'error' })`. If your application code makes an un-mocked HTTP request during a test, MSW will throw an immediate error instead of silently making a live network call.
3. **Prefer Spies over Wholesale Mocks**: When testing a module that imports a utility class, use `vi.spyOn(obj, 'method')` rather than `vi.mock('module')`. Spies allow un-mocked methods to execute real code, keeping tests realistic.
4. **Clean Up Vitest Mocks**: Understand the difference:
   - `mockClear()`: Clears recorded calls and instances.
   - `mockReset()`: Clears recorded calls AND removes custom implementations.
   - `mockRestore()`: Completely restores the original un-mocked implementation.
5. **Never Mock What You Do Not Own**: Avoid writing complex mock implementations for external vendor SDKs (like AWS S3 or Stripe). Instead, wrap the vendor SDK in an internal adapter/gateway interface, and mock your own interface.

---

## 8. Common Mistakes & Anti-Patterns

### 1. The Empty Mock Trap (`vi.mock` without implementation)
```typescript
// ❌ WRONG: Breaks default and named exports for other files importing this module
vi.mock('../utils/logger'); 
// All exports become undefined or empty vi.fn(), leading to runtime crashes!

// ✅ CORRECT: Provide explicit mock factory
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));
```

### 2. Leaking Mock Implementations Across Tests
```typescript
it('test 1', () => {
  myService.getData = vi.fn().mockReturnValue('mocked');
});
it('test 2', () => {
  // ❌ Fails because test 1 mutated myService directly!
  expect(myService.getData()).toBe('real_data');
});
```

### 3. Testing That the Mock Was Called Instead of the Outcome
Checking only `expect(mockSave).toHaveBeenCalled()` without verifying the return value or state change. The system could pass the assertion while producing corrupt data.

---

## 9. Best Practices

- **Centralize Default Handlers in `handlers.ts`**: Maintain a shared array of default MSW handlers representing standard API contracts. Individual tests can then use `server.use()` to test edge cases (errors, slow responses).
- **Simulate Network Latency with `delay()`**:
  ```typescript
  import { http, HttpResponse, delay } from 'msw';

  http.get('/api/slow-resource', async () => {
    await delay(200); // Deterministic delay
    return HttpResponse.json({ data: 'ok' });
  });
  ```
- **Use Module Mocking with `importActual`**: When you only want to mock one export of a module while preserving the rest:
  ```typescript
  vi.mock('../utils/helpers', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../utils/helpers')>();
    return {
      ...actual,
      generateToken: vi.fn().mockReturnValue('fixed_test_token'),
    };
  });
  ```

---

## 10. Performance Considerations

- **Memory Retention in Spies**: A spy records every argument passed to every invocation. In long-running test suites with thousands of calls, spies can retain large objects in memory. Call `vi.clearAllMocks()` in `afterEach` to allow garbage collection.
- **Service Worker Overhead in Browser**: When running MSW in real browser E2E tests, ensure the service worker file (`mockServiceWorker.js`) is served from the public root and cached by the browser to avoid re-fetching on every page load.

---

## 11. Security Considerations

- **Prevent Accidental Production Mocking**: Never import `msw/node` in production bundles. Guard mock initialization behind explicit environment checks:
  ```typescript
  if (process.env.NODE_ENV === 'test') {
    // initialize MSW
  }
  ```
- **Validate Request Payloads in MSW Handlers**: Write assertions inside MSW handlers to ensure your application code sends properly formatted `Authorization` headers, CSRF tokens, and sanitized JSON payloads.

---

## 12. Comparison Matrix: Test Double Tools

| Feature | MSW | `vi.fn()` / `vi.spyOn()` | In-Memory Fake |
| :--- | :--- | :--- | :--- |
| **Primary Scope** | Network Layer (HTTP/GraphQL) | Functions & Methods | Full Subsystem (DB, Storage) |
| **Setup Cost** | Moderate | Very Low | Moderate to High |
| **Fidelity** | Very High | Low to Moderate | High |
| **Use Case** | REST/GraphQL API testing | Unit function isolation | In-Memory Repositories |

---

## 13. Trade-offs

- **MSW vs. Direct Function Mocking**: MSW requires defining HTTP routes and JSON responses, which requires slightly more setup than a one-line `vi.fn().mockResolvedValue()`. However, MSW tests the actual HTTP client, request headers, serialization, and error response parsing, catching bugs that function mocks miss.
- **Fakes vs. Mocks**: A Fake (e.g., `InMemoryUserRepository` using a JavaScript `Map`) requires maintaining a separate class, but allows tests to run without any mocking libraries while closely mirroring real behavior.

---

## 14. Real-World Usage Case Studies

1. **GitHub CLI & Desktop**: Employs MSW to mock GitHub REST and GraphQL APIs across thousands of integration tests, simulating rate limits, two-factor auth challenges, and repository permission errors.
2. **Next.js & Remix Applications**: Standardize on MSW to test Server-Side Rendering (SSR) data loaders and Client-Side React Query hooks against identical API contracts.

---

## 15. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: What is the difference between a Stub and a Mock?**
> **Answer**: A **Stub** provides canned answers to calls made during the test, usually not responding to anything outside what is programmed for the test. A **Mock** is pre-programmed with expectations (such as expecting a specific method to be called with exact arguments a specific number of times) and will fail the test if those expectations are not met.

### Tier 2: Conceptual
**Q: Why is mocking network calls with MSW preferred over monkey-patching `global.fetch`?**
> **Answer**: Monkey-patching `global.fetch` replaces the native JavaScript function with a mock object, meaning you are no longer testing your actual network client code (URL construction, query parameter serialization, headers, status code parsing). If you refactor from `fetch` to `axios`, all monkey-patched tests break. MSW intercepts traffic at the network protocol layer, allowing your application code to run completely unmodified.

### Tier 3: Implementation
**Q: How do you mock a module in Vitest while preserving all of its original exports except one?**
> **Answer**: Use `vi.mock` with `importOriginal`:
> ```typescript
> vi.mock('./cryptoUtils', async (importOriginal) => {
>   const actual = await importOriginal<typeof import('./cryptoUtils')>();
>   return {
>     ...actual,
>     generateUUID: vi.fn().mockReturnValue('00000000-0000-0000-0000-000000000000'),
>   };
> });
> ```

### Tier 4: Debugging
**Q: A test overriding an MSW handler using `server.use(...)` causes three other unrelated test files to fail with 500 errors. What went wrong?**
> **Answer**: The test registered a runtime handler override with `server.use()` but failed to reset it. Because MSW servers in Node.js are singletons shared across the process, the override persisted into subsequent tests.
> **Fix**: Add `afterEach(() => server.resetHandlers())` in the test setup file.

### Tier 5: Scenario
**Q: You are testing a payment checkout workflow that calls Stripe. How do you test that your application properly retries with exponential backoff when Stripe returns HTTP 503?**
> **Answer**:
> 1. Use MSW to intercept `POST https://api.stripe.com/v1/charges`.
> 2. Program the handler using a counter: return `503 Service Unavailable` on attempts 1 and 2, and `200 OK` on attempt 3.
> 3. Use fake timers (`vi.useFakeTimers()`) to advance time past the exponential backoff intervals without waiting in real time.
> 4. Assert that the checkout function eventually resolves with success and that the endpoint was called exactly 3 times.

### Tier 6: Advanced
**Q: How does MSW intercept HTTP requests in Node.js environments without a real browser Service Worker?**
> **Answer**:
> In Node.js, MSW uses `@mswjs/interceptors`. It hooks into Node's internal `http` and `https` modules by monkey-patching `http.get`, `http.request`, and `ClientRequest` at the engine boundary. When any HTTP library (native `fetch`, `undici`, `axios`, `got`) initiates a connection, the interceptor captures the raw stream, constructs a standard WHATWG `Request` object, matches it against declared MSW handlers, and synthesizes a WHATWG `Response` object without opening a real OS network socket.

---

## 16. Coding Question: Implement an In-Memory Fake Repository

### Problem
Demonstrate the **Fake** test double pattern by creating an `InMemoryUserRepository` that implements a production `UserRepository` interface for testing without database dependencies.

### Solution

```typescript
// interfaces/UserRepository.ts
export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
}

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  save(user: Omit<User, 'id' | 'createdAt'>): Promise<User>;
  delete(id: string): Promise<boolean>;
}

// ==========================================
// Test Double: InMemoryUserRepository (Fake)
// ==========================================
export class InMemoryUserRepository implements UserRepository {
  private users: Map<string, User> = new Map();

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async findByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email.toLowerCase() === email.toLowerCase()) {
        return user;
      }
    }
    return null;
  }

  async save(userData: Omit<User, 'id' | 'createdAt'>): Promise<User> {
    // Enforce unique email constraint like a real database
    const existing = await this.findByEmail(userData.email);
    if (existing) {
      throw new Error(`Unique constraint violation: Email ${userData.email} already exists`);
    }

    const newUser: User = {
      ...userData,
      id: `usr_${crypto.randomUUID()}`,
      createdAt: new Date(),
    };

    this.users.set(newUser.id, newUser);
    return newUser;
  }

  async delete(id: string): Promise<boolean> {
    return this.users.delete(id);
  }

  // Helper method for tests
  public clear(): void {
    this.users.clear();
  }
}

// ==========================================
// Test Usage
// ==========================================
import { describe, it, expect, beforeEach } from 'vitest';

describe('UserService using InMemory Fake', () => {
  let fakeRepo: InMemoryUserRepository;

  beforeEach(() => {
    fakeRepo = new InMemoryUserRepository();
  });

  it('saves and retrieves user without database overhead', async () => {
    const created = await fakeRepo.save({ email: 'alex@test.com', name: 'Alex' });
    expect(created.id).toBeDefined();

    const retrieved = await fakeRepo.findById(created.id);
    expect(retrieved?.email).toBe('alex@test.com');
  });

  it('enforces uniqueness invariant like a real SQL DB', async () => {
    await fakeRepo.save({ email: 'dupe@test.com', name: 'User 1' });
    await expect(fakeRepo.save({ email: 'dupe@test.com', name: 'User 2' })).rejects.toThrow(
      'Unique constraint violation'
    );
  });
});
```

---

## 17. Common Interview Traps

- **Trap 1**: Calling `vi.mock()` inside an `it()` or `beforeEach()` block.
  *Gotcha*: In Vitest and Jest, `vi.mock` calls are **hoisted** to the very top of the file before imports execute. Calling `vi.mock` inside a test block either does nothing or causes confusing scoping bugs.
- **Trap 2**: Forgetting to call `server.resetHandlers()` in MSW.
  *Gotcha*: A single runtime handler override in one test file bleeds into all subsequent tests, causing cascading failures.
- **Trap 3**: Asserting that a spy was called with `expect(spy).toHaveBeenCalledWith(obj)` when the object has dynamic timestamps.
  *Gotcha*: Use `expect.objectContaining({ ... })` and `expect.any(Date)` for dynamic properties.

---

## 18. Revision Summary

- **Test Double Taxonomy**:
  - *Dummy*: Unused placeholder.
  - *Stub*: Returns pre-programmed canned values.
  - *Spy*: Records invocations without changing implementation.
  - *Mock*: Pre-programmed with strict expectations.
  - *Fake*: Working lightweight implementation (e.g., in-memory map).
- **MSW (Mock Service Worker)**: Intercepts at the network layer in both Node and browsers, eliminating brittle monkey-patching of `fetch`.
- **Vitest Mocking API**:
  - `vi.fn()`: Creates a standalone mock function.
  - `vi.spyOn()`: Observes or wraps existing object methods.
  - `vi.mock()`: Hoisted module-level mock.

---

## 19. Quick Reference

| Utility | Syntax | Purpose |
| :--- | :--- | :--- |
| **Create Mock Function** | `const fn = vi.fn().mockReturnValue(val)` | Standalone callable stub |
| **Spy on Object Method** | `const s = vi.spyOn(obj, 'method')` | Records calls to existing method |
| **Restore Spy** | `s.mockRestore()` | Restores original un-spied function |
| **Setup MSW Server** | `const s = setupServer(...handlers)` | Creates Node.js network interceptor |
| **MSW Route Handler** | `http.get('/api/users', () => HttpResponse.json([]))` | Mock HTTP response |
| **Runtime MSW Override** | `server.use(http.get('/api/users', () => ...))` | Overrides route for a single test |
| **Reset MSW Handlers** | `server.resetHandlers()` | Restores default handlers in `afterEach` |
