# Backend API Integration Testing: Supertest, Express Route Verification & HTTP Contract Auditing

## 1. What is it?
**Backend API Integration Testing** verifies the complete execution pipeline of a web service—routing, middleware authentication, request validation, business services, database queries, and response serialization—without spinning up a real, external network port.

**Supertest** is a high-level HTTP testing abstraction library built on top of `SuperAgent`. It allows engineers to test Node.js HTTP servers (such as Express, Fastify, Koa, or native `http.Server`) by passing the application instance directly to the test harness. Supertest binds the server to an ephemeral, in-memory local socket, dispatches real HTTP requests, and asserts on HTTP status codes, headers, cookies, and JSON response bodies.

```
       Vitest / Jest Test File (request(app))
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│ Supertest In-Memory Dispatcher                         │
│ - Binds Express `app` to ephemeral localhost port      │
│ - Serializes HTTP Request (Headers, Cookies, Payload)  │
└─────────────────────────┬──────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│ Express Server Middleware Pipeline                     │
│ 1. CORS & Security Headers (Helmet)                    │
│ 2. Body Parser (express.json())                        │
│ 3. Auth Middleware (JWT / Session Verification)        │
│ 4. Route Schema Validator (Zod)                        │
└─────────────────────────┬──────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│ Controller & Business Service Layer                    │
│ - Database Transactions (PostgreSQL / Prisma)          │
│ - Cache Queries (Redis)                                │
└─────────────────────────┬──────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────┐
│ HTTP Response Assertion Evaluation                     │
│ - res.status === 201                                   │
│ - res.headers['content-type'] =~ /json/                │
│ - res.body.data.id === expect.any(String)              │
└────────────────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Unit tests alone cannot guarantee that an API actually works:

1. **The Middleware Blind Spot**: A controller function may be 100% covered by unit tests, but if the Express routing table has a typo (`/api/v1/user` instead of `/api/v1/users`), or the authentication middleware fails to read `req.headers.authorization`, the API returns a 404 or 401 in production.
2. **Serialization & Status Code Mismatches**: Unit tests test internal return values (`{ status: 'ok' }`), whereas clients consume HTTP status codes (200, 201, 204, 400, 422), MIME types (`application/json`), and header metadata (`Set-Cookie`, `ETag`, `X-RateLimit-Remaining`).
3. **No External Server Startup Delay**: Running manual tests with Postman or curl requires running `npm run dev`, keeping a terminal alive, seeding data, and manually clicking buttons. Supertest tests execute in headless Node.js within 50ms per route.
4. **Regression Protection for API Breaking Changes**: Integration tests serve as an automated, executable contract that guarantees clients (mobile apps, React frontends) will not break when backend schemas evolve.

---

## 3. Mental Model: The In-Memory Mail Carrier
Think of Supertest as an **In-House Postal Inspector**:
- Instead of mailing a package through the public post office (opening real internet network ports and paying WAN latency), the inspector walks directly into the mail sorting facility (the Express `app` object in Node memory).
- The inspector drops an envelope marked `POST /api/v1/orders` directly into the intake bin, watches it travel through the sorting conveyor belts (middleware, authentication, validators), and picks up the output envelope coming out of the delivery chute.
- The inspector immediately checks the postmark (status code), security seal (headers), and contents (JSON payload).

---

## 4. Basic Example: Testing an Express Route with Supertest

```typescript
// app.ts (Separated from server.ts - Do NOT call app.listen here!)
import express, { Request, Response } from 'express';

export const app = express();
app.use(express.json());

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'healthy', uptime: process.uptime() });
});

app.post('/api/greet', (req: Request, res: Response) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Name is required' });
  }
  res.status(200).json({ message: `Hello, ${name}!` });
});

// ==========================================
// Test Suite: app.integration.test.ts
// ==========================================
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './app';

describe('Express Health & Greeting Routes', () => {
  it('GET /health returns 200 and healthy status', async () => {
    const response = await request(app)
      .get('/health')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(response.body).toEqual({
      status: 'healthy',
      uptime: expect.any(Number),
    });
  });

  it('POST /api/greet returns 400 if name is omitted', async () => {
    const response = await request(app)
      .post('/api/greet')
      .send({})
      .expect(400);

    expect(response.body).toEqual({ error: 'Name is required' });
  });

  it('POST /api/greet returns 200 with personalized greeting', async () => {
    const response = await request(app)
      .post('/api/greet')
      .send({ name: 'Goutam' })
      .expect(200);

    expect(response.body.message).toBe('Hello, Goutam!');
  });
});
```

---

## 5. Real-World Production Example: Authenticated CRUD Route with DB & Cookies

In production microservices, tests must verify authentication headers, CSRF cookies, validation errors, and real database side-effects.

```typescript
// src/app.ts
import express from 'express';
import cookieParser from 'cookie-parser';
import { z } from 'zod';
import { prisma } from './prisma';
import { verifyJwt } from './auth';

export const app = express();
app.use(express.json());
app.use(cookieParser());

// Authenticated Route
app.post('/api/v1/projects', async (req, res) => {
  const token = req.cookies['auth_token'] || req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }

  const user = verifyJwt(token);
  if (!user) {
    return res.status(403).json({ error: 'Forbidden: Invalid token' });
  }

  const Schema = z.object({
    name: z.string().min(3).max(50),
    description: z.string().optional(),
  });

  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ error: 'Validation Failed', issues: parsed.error.issues });
  }

  const project = await prisma.project.create({
    data: {
      name: parsed.data.name,
      description: parsed.data.description,
      ownerId: user.id,
    },
  });

  res.setHeader('X-Resource-ID', project.id);
  return res.status(201).json(project);
});

// ==========================================
// Test Suite: projects.integration.test.ts
// ==========================================
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/app';
import { prisma } from '../src/prisma';
import * as auth from '../src/auth';

describe('POST /api/v1/projects Integration Test', () => {
  const validToken = 'mock_jwt_token_123';
  const testUser = { id: 'usr_abc', email: 'owner@test.com' };

  beforeEach(async () => {
    await prisma.project.deleteMany();
    vi.spyOn(auth, 'verifyJwt').mockImplementation((tok) => {
      return tok === validToken ? testUser : null;
    });
  });

  it('rejects unauthenticated requests with 401 Unauthorized', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .send({ name: 'New Project' });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing token/);
  });

  it('rejects invalid payloads with 422 Unprocessable Entity', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${validToken}`)
      .send({ name: 'ab' }); // Name too short (<3 chars)

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('Validation Failed');
  });

  it('creates project in database, sets custom headers, and returns 201', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set('Cookie', [`auth_token=${validToken}`]) // Test cookie auth
      .send({
        name: 'Fullstack Platform',
        description: 'Comprehensive educational platform',
      });

    expect(res.status).toBe(201);
    expect(res.headers['x-resource-id']).toBeDefined();
    expect(res.body).toMatchObject({
      id: expect.any(String),
      name: 'Fullstack Platform',
      ownerId: 'usr_abc',
    });

    // Directly verify that database persisted the record
    const record = await prisma.project.findUnique({
      where: { id: res.body.id },
    });
    expect(record).not.toBeNull();
    expect(record?.name).toBe('Fullstack Platform');
  });
});
```

---

## 6. Under the Hood: Separation of `app.ts` vs `server.ts`

One of the most critical architectural requirements when testing Node.js applications with Supertest is separating the Express configuration from the network listener:

```
┌────────────────────────────────────────────────────────┐
│ app.ts (Exported Express App Object)                   │
│ - Configures middleware, routes, error handlers        │
│ - NEVER calls app.listen()                             │
└──────────────────────────┬─────────────────────────────┘
                           │
             ┌─────────────┴─────────────┐
             ▼                           ▼
┌─────────────────────────┐  ┌─────────────────────────┐
│ server.ts (Production)  │  │ *.test.ts (Supertest)   │
│ - Imports `app`         │  │ - Imports `app`         │
│ - Reads process.env.PORT│  │ - Passes `app` directly │
│ - Calls app.listen(3000)│  │   to request(app)       │
│ - Handles SIGTERM       │  │ - Closes sockets cleanly│
└─────────────────────────┘  └─────────────────────────┘
```

If you call `app.listen(3000)` inside `app.ts`, running 10 test files concurrently in Vitest will crash with `EADDRINUSE: Address already in use :::3000`.

---

## 7. Important Rules

1. **Always Separate `app` from `listen`**: As detailed above, `app.ts` exports the Express app instance; `server.ts` imports `app` and calls `app.listen()`. Tests import `app` directly.
2. **Chain Supertest Expectations with `.expect()`**: Supertest provides built-in HTTP assertion chaining (`.expect(200)`, `.expect('Content-Type', /json/)`), which outputs clean, actionable HTTP error messages if an assertion fails.
3. **Always Clean Up Database State**: Use a database cleanup strategy in `beforeEach` or `afterEach` (such as truncating tables or running inside an uncommitted transaction) to prevent test data leakage.
4. **Test Both Cookie and Bearer Token Auth**: If your API supports dual authentication (cookies for web SPA, Bearer tokens for mobile clients), write tests verifying that both headers work identically.
5. **Never Use Hardcoded Ports in Tests**: Let Supertest dynamically bind to port `0` (the operating system assigns an available ephemeral port automatically).

---

## 8. Common Mistakes & Anti-Patterns

### 1. `EADDRINUSE` Port Collision
```typescript
// ❌ WRONG: Calling listen inside the file imported by tests
// app.ts
const app = express();
app.listen(3000); // CRASHES when multiple test workers run in parallel!
export default app;
```

### 2. Forgetting to Handle Async Exceptions in Express Routes
If an Express route does not catch an unhandled rejection, Supertest may hang until the test runner timeout (5000ms) expires, producing obscure timeout errors instead of an immediate test failure. Always have a centralized error middleware.

### 3. Testing Against Production or Shared Staging Databases
Connecting Supertest suites to a shared staging PostgreSQL database. When multiple developers push PRs simultaneously, their CI runs delete each other's test records, causing random build failures.

---

## 9. Best Practices

- **Use `agent` to Maintain Session State Across Multiple Requests**:
  ```typescript
  import request from 'supertest';
  import { app } from '../src/app';

  it('logs in and maintains cookie session for subsequent profile request', async () => {
    // Persistent agent retains Set-Cookie headers automatically
    const agent = request.agent(app);

    // 1. Log in
    const loginRes = await agent
      .post('/api/auth/login')
      .send({ email: 'user@test.com', password: 'password123' })
      .expect(200);

    // 2. Subsequent call automatically sends session cookies
    const profileRes = await agent
      .get('/api/auth/me')
      .expect(200);

    expect(profileRes.body.email).toBe('user@test.com');
  });
  ```
- **Test File Uploads with `.attach()`**:
  ```typescript
  it('uploads avatar image', async () => {
    await request(app)
      .post('/api/users/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', 'test/fixtures/avatar.png')
      .expect(200);
  });
  ```

---

## 10. Performance Considerations

- **Parallel Integration Test Databases**: When running tests in parallel with Vitest, assign a distinct database schema or container per worker thread:
  ```typescript
  const workerId = process.env.VITEST_POOL_ID || '1';
  process.env.DATABASE_URL = `postgresql://postgres:pass@localhost:5432/test_db_${workerId}`;
  ```
- **Connection Pool Sizing**: In integration tests, keep database connection pools small (`max: 5`) to prevent exhausting database file descriptors across parallel test workers.

---

## 11. Security Considerations

- **Audit Security Headers in Integration Tests**: Write an explicit test verifying Helmet security headers:
  ```typescript
  it('includes mandatory security headers', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
  ```
- **Verify Rate Limiting Behavior**: Write a test loop to ensure that sending $N+1$ requests triggers an HTTP 429 response.

---

## 12. Supertest vs. Native Fetch Comparison Matrix

| Feature | Supertest (`request(app)`) | Native `fetch('http://localhost:3000')` |
| :--- | :--- | :--- |
| **Server Startup** | In-memory ephemeral socket | Requires manual `server.listen()` |
| **Port Management** | Fully automatic (port 0) | Manual port collision management |
| **Assertion Chaining**| Built-in (`.expect(200)`) | Manual `expect(res.status).toBe(200)` |
| **Cookie Persistence**| `request.agent(app)` | Requires external cookie jar |
| **File Upload Support**| Native `.attach('field', path)` | Requires `FormData` & Blob construction |

---

## 13. Trade-offs

- **Supertest (In-Memory) vs. Live E2E (External Network)**: Supertest tests bypass reverse proxies (Nginx, Cloudflare) and TLS termination. While this makes tests 10x faster and simpler to run locally, it does not test Nginx proxy pass headers or real SSL certificate negotiation.
- **Mocked DB vs. Real DB in Supertest**: Mocking Prisma/Mongoose inside Supertest makes tests run in 5ms, but sacrifices the primary benefit of integration testing—verifying that SQL queries, foreign key constraints, and migrations work correctly.

---

## 14. Real-World Usage Case Studies

1. **GitHub REST API Engine**: Extensively uses in-memory integration test suites to verify HTTP status codes, pagination headers (`Link: <...>; rel="next"`), and rate limit headers on every pull request.
2. **Stripe API Services**: Employs comprehensive HTTP contract test suites ensuring that all 400 Bad Request errors return RFC-compliant structured JSON error payloads with `type`, `code`, and `param` fields.

---

## 15. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: Why should you avoid calling `app.listen()` inside your main `app.ts` file when using Supertest?**
> **Answer**: Calling `app.listen(port)` binds the server to a fixed network port (e.g., 3000). When running integration tests in parallel across multiple worker threads, multiple test files will attempt to bind to the same port simultaneously, triggering an `EADDRINUSE` crash. Supertest handles binding to ephemeral, non-conflicting ports automatically when passed the un-listened `app` instance.

### Tier 2: Conceptual
**Q: How does `request.agent(app)` differ from `request(app)` in Supertest?**
> **Answer**: `request(app)` treats every HTTP request as a completely independent, stateless invocation. `request.agent(app)` creates a stateful session client that automatically captures `Set-Cookie` headers returned by the server and re-attaches them as `Cookie` headers in subsequent requests, allowing you to test authenticated multi-step user workflows (e.g., Login $\rightarrow$ Update Profile $\rightarrow$ Logout).

### Tier 3: Implementation
**Q: How do you test file upload endpoints using Supertest?**
> **Answer**: Use the `.attach()` method:
> ```typescript
> const res = await request(app)
>   .post('/api/documents/upload')
>   .set('Authorization', `Bearer ${token}`)
>   .attach('document', 'test/fixtures/sample.pdf')
>   .expect(201);
> expect(res.body.filename).toBe('sample.pdf');
> ```

### Tier 4: Debugging
**Q: A Supertest test suite passes locally on macOS, but hangs indefinitely and times out on Linux GitHub Actions CI. What is the most likely cause?**
> **Answer**: An asynchronous resource (such as a database connection pool, Redis client, or RabbitMQ connection) was opened during the tests and never closed. On macOS, Node might exit if worker threads terminate, but on Linux CI environments, open sockets and active event loop handles keep the process alive indefinitely.
> **Fix**: Ensure all database and Redis pools are explicitly disconnected in an `afterAll(async () => { await db.disconnect(); })` hook.

### Tier 5: Scenario
**Q: You are tasked with writing an integration test suite for an e-commerce checkout route (`POST /api/checkout`) that charges a credit card and decreases inventory in PostgreSQL. How do you design this test?**
> **Answer**:
> 1. Use MSW to mock the external Stripe payment gateway to return success.
> 2. Seed a test product in the PostgreSQL database with `stock: 5`.
> 3. Send a Supertest request with valid user authentication and payment token.
> 4. Assert HTTP status `200 OK` and inspect the returned order ID.
> 5. Query the database directly to verify that product stock was decremented to `4` and an order record was created with `status: 'CONFIRMED'`.

### Tier 6: Advanced
**Q: How does Supertest communicate with the Express application under the hood without a specified port number?**
> **Answer**:
> When `request(app)` is called, Supertest checks if the passed object is an already-running HTTP server. If it is an Express application function, Supertest internally invokes Node's native `http.createServer(app)`. It calls `.listen(0)` on this server. Port `0` instructs the operating system kernel to allocate an available, non-conflicting dynamic ephemeral port (e.g., 54321). Supertest executes the HTTP request against `127.0.0.1:54321`, captures the response, and automatically calls `server.close()` when the request cycle completes.

---

## 16. Coding Question: Test an Idempotent Payment Webhook Endpoint

### Problem
Write an Express route and Supertest integration test suite for a Stripe webhook handler (`POST /api/webhooks/stripe`):
1. Must verify `Stripe-Signature` header; if missing, return 400.
2. If event has already been processed (idempotency check in DB), return `200 { status: 'already_processed' }`.
3. If new event, record event ID in database, process order, and return `200 { status: 'success' }`.

### Solution

```typescript
// webhook.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import express, { Request, Response } from 'express';
import request from 'supertest';

// In-memory fake database for demonstration
const processedEvents = new Set<string>();

const app = express();
app.use(express.json());

app.post('/api/webhooks/stripe', (req: Request, res: Response) => {
  const signature = req.headers['stripe-signature'];
  if (!signature) {
    return res.status(400).json({ error: 'Missing stripe signature' });
  }

  const { id: eventId, type } = req.body;
  if (!eventId) {
    return res.status(400).json({ error: 'Missing event ID' });
  }

  // Idempotency Gate
  if (processedEvents.has(eventId)) {
    return res.status(200).json({ status: 'already_processed', eventId });
  }

  // Record event and process
  processedEvents.add(eventId);
  return res.status(200).json({ status: 'success', eventId, processed: true });
});

describe('Stripe Webhook Integration Suite', () => {
  beforeEach(() => {
    processedEvents.clear();
  });

  it('returns 400 when Stripe-Signature header is missing', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .send({ id: 'evt_1', type: 'payment_intent.succeeded' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Missing stripe signature');
  });

  it('processes a new webhook event successfully on first invocation', async () => {
    const res = await request(app)
      .post('/api/webhooks/stripe')
      .set('Stripe-Signature', 't=123,v1=valid_hash')
      .send({ id: 'evt_100', type: 'payment_intent.succeeded' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'success',
      eventId: 'evt_100',
      processed: true,
    });
    expect(processedEvents.has('evt_100')).toBe(true);
  });

  it('handles duplicate webhook deliveries idempotently without re-processing', async () => {
    // 1. First Delivery
    await request(app)
      .post('/api/webhooks/stripe')
      .set('Stripe-Signature', 't=123,v1=valid_hash')
      .send({ id: 'evt_200', type: 'payment_intent.succeeded' })
      .expect(200);

    // 2. Duplicate Delivery (Simulating network retry from Stripe)
    const duplicateRes = await request(app)
      .post('/api/webhooks/stripe')
      .set('Stripe-Signature', 't=123,v1=valid_hash')
      .send({ id: 'evt_200', type: 'payment_intent.succeeded' });

    expect(duplicateRes.status).toBe(200);
    expect(duplicateRes.body).toEqual({
      status: 'already_processed',
      eventId: 'evt_200',
    });
  });
});
```

---

## 17. Common Interview Traps

- **Trap 1**: Importing `server.ts` instead of `app.ts` into Supertest.
  *Gotcha*: If `server.ts` starts listening on port 3000, your test suite will crash with `EADDRINUSE` when tests run in parallel.
- **Trap 2**: Failing to test error response payloads.
  *Gotcha*: Only testing that an error returns `res.status(400)` without asserting the JSON body structure (`expect(res.body.error).toBe(...)`). A bug could cause your API to return an empty 400 or HTML error page instead of structured JSON.
- **Trap 3**: Asserting on `res.text` when `res.body` is available.
  *Gotcha*: `res.text` is a raw unparsed string. `res.body` is automatically parsed JSON, enabling deep object equality assertions with `toEqual()`.

---

## 18. Revision Summary

- **Supertest Role**: In-memory HTTP integration testing harness for Express/Node.js servers.
- **Architecture**: Always decouple Express app configuration (`app.ts`) from server network binding (`server.ts`).
- **Capabilities**:
  - Validates full HTTP contracts (status codes, headers, cookies, JSON bodies).
  - Maintains stateful multi-step sessions using `request.agent(app)`.
  - Supports file attachments (`.attach()`) and custom headers (`.set()`).
- **Database Best Practice**: Run integration tests against real Dockerized test databases (not mocks) to verify SQL constraints and migrations.

---

## 19. Quick Reference

| Method | Supertest Syntax | Purpose |
| :--- | :--- | :--- |
| **Send GET** | `request(app).get('/api/users')` | Issues GET request |
| **Send POST** | `request(app).post('/api/users').send(payload)` | Issues POST with JSON body |
| **Set Header** | `.set('Authorization', 'Bearer tok')` | Appends request header |
| **Set Cookie** | `.set('Cookie', ['sessionId=123'])` | Appends cookie header |
| **Check Status**| `.expect(200)` | Built-in status assertion |
| **Check Header**| `.expect('Content-Type', /json/)` | Built-in header regex assertion |
| **Session Agent**| `const agent = request.agent(app)` | Retains cookies across requests |
| **File Upload** | `.attach('file', 'test/test.png')` | Multi-part form file upload |
