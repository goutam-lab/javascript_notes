# 📊 Full-Stack Placement Progress Tracker

Keep track of your complete full-stack mastery and interview readiness. Every checkbox indicates tested, hands-on, revision-ready knowledge.

---

## 🌐 Phase 1: Web Foundations & Architecture
- [x] **Internet & Networking**: Packets, routers, IP routing, BGP, physical infrastructure
- [x] **DNS Resolution**: Recursive vs iterative queries, root, TLD, A/AAAA/CNAME/MX, TTL
- [x] **TCP/UDP & IP**: 3-way handshake, sliding window flow control, congestion control, TCP vs UDP
- [x] **HTTP Evolution**: HTTP/1.0 head-of-line blocking, HTTP/1.1 keep-alive, HTTP/2 multiplexing, HTTP/3 QUIC
- [x] **HTTPS & TLS**: Asymmetric vs symmetric encryption, TLS 1.3 handshake, CA verification
- [x] **Client-Server Model**: Request/response cycle, statelessness, reverse proxy vs load balancer
- [x] **Browser Rendering Pipeline**: DOM, CSSOM, Render tree, Layout (reflow), Paint, Composite, V8 engine
- [x] **Cookies, Sessions & Tokens**: Stateful vs stateless auth, HttpOnly, Secure, SameSite attributes
- [x] **CORS & SOP**: Same-origin rule, simple requests, preflight OPTIONS, CORS headers
- [x] **Web Caching**: Cache-Control directives, ETag vs Last-Modified, 304 Not Modified, heuristic caching

---

## ⚛️ Phase 2: React Foundations & Core Mechanics
- [x] **Why React**: Imperative vs Declarative UI, virtual DOM concept, component composition
- [x] **Mental Model**: UI = f(state), unidirectional data flow, pure components
- [x] **JSX Internals**: Babel/SWC transform to `React.createElement` / `_jsx`, JSX AST
- [x] **Props & Immutability**: Read-only props, shallow freezing, passing callbacks, children prop
- [x] **State & Reactivity**: Trigger-Render-Commit lifecycle, state vs local variables
- [x] **Synthetic Events**: Event pooling, delegation on root container, event bubbling
- [x] **Conditional Rendering**: Ternary operators, short-circuit `&&` traps, early returns
- [x] **Lists & Reconciliation Keys**: Why keys matter, stable identity, array index anti-pattern
- [x] **Controlled vs Uncontrolled**: Single source of truth vs DOM-managed inputs, `defaultValue`, `ref`
- [x] **Lifting State & Composition**: Avoiding prop drilling with compound components & composition

---

## 🔬 Phase 3: React Deep Dive & Internals
- [x] **useState Internals**: Hook linked lists on fiber node, batching in React 18, updater functions
- [x] **useEffect Lifecycle**: Synchronization vs lifecycle, dependency array (`Object.is`), cleanups, StrictMode
- [x] **useRef Deep Dive**: Mutable containers without re-renders, DOM refs, previous state pattern
- [x] **useMemo & useCallback**: Referential equality, cache invalidation, when memoization harms perf
- [x] **useContext Performance**: Context propagation, avoiding global re-renders, splitting context
- [x] **useReducer**: Predictable state machines, action-reducer pattern, useState vs useReducer
- [x] **Custom Hooks**: Headless logic extraction, hook composition, testing patterns
- [x] **Reconciliation & Diffing**: O(N) heuristic diffing algorithm, element type matching
- [x] **React Fiber Architecture**: Stack reconciler vs Fiber, work-in-progress tree, render vs commit phases
- [x] **Concurrent React**: `useTransition`, `useDeferredValue`, Suspense, streaming SSR
- [x] **Error Boundaries**: Catching render errors, `getDerivedStateFromError`, `componentDidCatch`
- [x] **Anti-Patterns & Stale Closures**: State mutations, stale closures in timers, deriving state

---

## 🟦 Phase 4: TypeScript Mastery
- [x] **Type System Mental Model**: Static types, compile-time erasure, structural duck typing
- [x] **Primitives & Literal Types**: Primitives, string literals, union types, discriminated unions
- [x] **Interfaces vs Types**: Declaration merging, `extends` vs `&`, compiler caching
- [x] **Object Typing**: Optional properties, readonly fields, excess property checking
- [x] **Arrays & Tuples**: `T[]`, fixed-length tuples, variadic tuples, readonly tuples
- [x] **Functions Typing**: Parameter typing, return inference, void vs never vs undefined, overloads
- [x] **Type Narrowing**: `typeof`, `instanceof`, `in`, user-defined type guards (`val is Type`)
- [x] **Generics**: Generic constraints, default parameters, multi-type parameters
- [x] **Utility Types**: Partial, Required, Readonly, Record, Pick, Omit, ReturnType, Parameters
- [x] **Advanced Types**: `keyof`, indexed access `T[K]`, mapped types, template literal types
- [x] **Conditional Types & infer**: `T extends U ? X : Y`, distributive conditionals, `infer` unpacking
- [x] **React Typing**: Typing props, events, hooks, polymorphic components
- [x] **Backend Typing**: Express Request/Response typing, shared DTOs, Zod schema inference
- [x] **TSConfig & Compiler**: `strict: true`, `noImplicitAny`, `paths` alias, build optimization

---

## 🎨 Phase 5: Modern Frontend Engineering
- [x] **CSS Architecture**: CSS Modules, BEM, CSS Custom Properties (variables)
- [x] **Design Patterns**: Compound components, Render props, Polymorphic components
- [x] **Design Systems & Tokens**: Color/spacing tokens, dark mode switching, fluid typography
- [x] **Accessibility (A11y)**: Semantic HTML5, ARIA roles, focus traps in modals, WCAG 2.2
- [x] **Client-Side Routing**: History API (`pushState`, `popstate`), route matching, 404 handling
- [x] **Code Splitting**: Dynamic `import()`, `React.lazy`, route-based and component-based splitting
- [x] **Asset Optimization**: WebP/AVIF, responsive `srcset`, font display swap, `async`/`defer`
- [x] **Error & UX Patterns**: Toast notifications, inline validation states, optimistic UI
- [x] **Frontend Security**: XSS sanitization (DOMPurify), CSP headers, clickjacking prevention

---

## ▲ Phase 6: Next.js (App Router Deep Dive)
- [x] **Next.js Mental Model**: SSR vs SSG vs ISR vs React Server Components (RSC)
- [x] **App Router Conventions**: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`
- [x] **Server vs Client Components**: RSC zero bundle size, `'use client'` boundary, serialization
- [x] **Routing Mastery**: Dynamic `[id]`, catch-all `[...slug]`, route groups `(auth)`, parallel routes
- [x] **Layouts & Templates**: Nested layouts, layout state persistence vs template remounting
- [x] **Data Fetching & Caching**: Extended `fetch()`, Request Memoization, Data Cache, Revalidation
- [x] **Server Actions**: `'use server'` mutations, `useActionState`, progressive enhancement
- [x] **Route Handlers**: `route.ts`, HTTP methods, reading cookies/headers, JSON responses
- [x] **Middleware**: Edge runtime constraints, route protection, auth token verification
- [x] **Metadata & SEO**: `generateMetadata`, OpenGraph images, `sitemap.ts`, `robots.ts`
- [x] **Optimization APIs**: `next/image`, `next/font`, `next/script` loading strategies
- [x] **Production Architecture**: 4-layer caching architecture, cache debugging, self-hosting

---

## 🗃️ Phase 7: State Management & Forms
- [x] **State Classification**: Local vs Global UI vs URL vs Server Cache
- [x] **URL State**: `useSearchParams`, syncing filters/pagination with URL history
- [x] **Zustand Architecture**: Store creation, slices pattern, selectors to prevent re-renders
- [x] **Redux Toolkit**: Slices, Immer under the hood, dispatch, async thunks
- [x] **TanStack Query**: Query keys, cache invalidation, background refetching, mutations
- [x] **State Trade-offs**: Context vs Zustand vs RTK vs TanStack Query matrix
- [x] **Form Mechanics**: Native HTML5 validation, FormData API, submit handling
- [x] **React Hook Form**: Uncontrolled subscription model, isolating re-renders, `register`
- [x] **Zod Schema Validation**: Schemas, `safeParse`, custom refinements, inferred types
- [x] **Multi-Step Wizards**: Step-by-step state persistence and validation
- [x] **Full-Stack Type Safety**: End-to-end Zod schemas shared across React, Next.js & Express

---

## 🔌 Phase 8: REST APIs & Node.js Runtime
- [x] **REST Maturity Model**: Richardson Maturity levels, HATEOAS, resource URI design
- [x] **HTTP Methods & Idempotency**: Safe vs Idempotent methods, idempotency keys
- [x] **Status Codes**: 200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500, 503
- [x] **API Contracts**: Standardized JSON envelopes, error schemas, pagination metadata
- [x] **Pagination Strategies**: Offset vs Cursor vs Keyset pagination performance
- [x] **Filtering & Sorting**: Query parameter sanitization, multi-column sort
- [x] **API Versioning**: URI vs Header vs Query param versioning
- [x] **Rate Limiting**: Sliding window counter, token bucket algorithm, Redis stores
- [x] **File Uploads**: Multipart streams vs S3 presigned direct upload URLs
- [x] **Webhooks**: Webhook delivery architecture, HMAC SHA256 signature verification
- [x] **Node.js Architecture**: V8 vs Libuv, single-threaded execution, non-blocking I/O
- [x] **Event Loop Phases**: Timers, Pending, Poll, Check (`setImmediate`), `process.nextTick`
- [x] **Threads & Clusters**: Libuv thread pool (`UV_THREADPOOL_SIZE`), Worker Threads, Cluster module
- [x] **Buffers & Streams**: ArrayBuffer, Uint8Array, backpressure in streams, pipeline API
- [x] **EventEmitter**: Event-driven architecture, avoiding memory leak warnings

---

## ⚡ Phase 9: Express & Backend Architecture
- [x] **Express Router Internals**: Router stack, layer matching, dispatch mechanism
- [x] **Middleware Pipeline**: Chaining order, mutating `req`/`res`, next() error forwarding
- [x] **Request Lifecycle**: Socket connection to response finish event tracing
- [x] **Centralized Error Handling**: 4-argument error middleware, custom `AppError` class
- [x] **Validation Middleware**: Generic Zod validation for body, query, and params
- [x] **Production Middleware**: Helmet security headers, CORS whitelist, Morgan logging
- [x] **Layered Architecture**: Controller $\rightarrow$ Service $\rightarrow$ Repository pattern
- [x] **Dependency Injection**: Decoupling services, constructor injection, unit mockability
- [x] **Clean Architecture**: Domain isolation, dependency rule pointing inward
- [x] **Config & Environment**: Validating environment variables at startup with Zod
- [x] **Structured Logging**: JSON logging, log levels, correlation IDs (`X-Request-Id`)
- [x] **Background Jobs**: BullMQ with Redis, workers, concurrency, exponential backoff retries

---

## 🔐 Phase 10: Authentication, Authorization & Security
- [x] **Auth Mental Model**: Identity verification vs permission validation
- [x] **Password Security**: Cryptographic salting, Bcrypt vs Argon2id memory-hard hashing
- [x] **Session Authentication**: Stateful sessions in Redis, HttpOnly/Secure/SameSite cookies
- [x] **JWT Architecture**: Header.Payload.Signature, base64url, HMAC SHA256 vs RSA, revocation
- [x] **Dual Token Rotation**: Short-lived access token + rotating refresh tokens, theft detection
- [x] **OAuth2 & OIDC**: Authorization Code flow with PKCE, Google/GitHub login
- [x] **RBAC & ABAC**: Role-based access control vs Attribute-based contextual policies
- [x] **OWASP Top 10**: Vulnerabilities, exploitation vectors, and standard mitigations
- [x] **SQLi & NoSQLi**: Parameterized queries, ORM safety, MongoDB operator injection
- [x] **XSS & CSRF Defense**: DOMPurify, anti-CSRF synchronizer tokens, SameSite cookies
- [x] **Security Headers**: Content-Security-Policy (CSP), Strict-Transport-Security (HSTS)
- [x] **Secrets Management**: Git-secrets detection, vault services, runtime environment injection

---

## 💾 Phase 11: Databases, SQL & NoSQL
- [x] **Database Paradigms**: Relational vs Document vs Key-Value vs Graph
- [x] **Connection Pooling**: TCP overhead, connection pool sizing heuristics
- [x] **ACID Deep Dive**: Atomicity, Consistency, Isolation, Durability (WAL logs)
- [x] **Transaction Isolation**: Read Committed, Repeatable Read, Serializable; 4 anomalies
- [x] **B-Tree Indexing**: Tree structure, traversal cost, clustered vs non-clustered, leftmost prefix
- [x] **Normalization**: 1NF, 2NF, 3NF, BCNF principles and functional dependencies
- [x] **Denormalization**: High-read throughput optimization, data sync trade-offs
- [x] **N+1 Problem**: Detecting query multiplication in logs, SQL JOINs, DataLoader pattern
- [x] **PostgreSQL Mastery**: psql CLI, data types (UUID, JSONB, TIMESTAMP TZ)
- [x] **Advanced SQL**: Joins (Inner, Left, Right, Full), Subqueries, Recursive CTEs
- [x] **Window Functions**: `ROW_NUMBER()`, `RANK()`, `DENSE_RANK()`, `LEAD()`, `LAG()`, running totals
- [x] **Database Locking**: Pessimistic (`SELECT FOR UPDATE`) vs Optimistic (`version` column)
- [x] **Query Profiling**: Reading `EXPLAIN (ANALYZE, BUFFERS)` execution plans
- [x] **MongoDB BSON**: Binary JSON structure, 16MB document size limit, ObjectId
- [x] **MongoDB Modeling**: Embedding vs Referencing decision matrix
- [x] **Aggregation Pipeline**: Stages: `$match`, `$group`, `$project`, `$unwind`, `$lookup`, `$sort`
- [x] **Prisma & Drizzle**: Schema modeling, migrations, query engine, type-safe queries

---

## 🧪 Phase 12: Testing, Performance & System Design
- [x] **Testing Pyramid**: Unit vs Integration vs E2E cost/confidence trade-offs
- [x] **TDD Workflow**: Red-Green-Refactor cycle applied to machine coding
- [x] **Vitest & RTL**: Unit testing pure logic, testing components via user interactions
- [x] **Supertest & MSW**: API integration testing, network request mocking
- [x] **Playwright E2E**: Cross-browser automated user journeys, page object models
- [x] **Web Vitals Profiling**: LCP, CLS, INP diagnostics and fixes
- [x] **React DevTools Profiler**: Flame charts, identifying wasted renders, memoization
- [x] **Redis Caching Patterns**: Cache-Aside, Write-Through, Write-Behind, Cache Stampede fixes
- [x] **System Design Template**: Requirements $\rightarrow$ Capacity $\rightarrow$ High-Level $\rightarrow$ Deep Dive
- [x] **Scaling Mechanics**: Horizontal vs vertical scaling, stateless servers, load balancers
- [x] **Database Scaling**: Read replicas, replication lag, horizontal sharding, shard keys
- [x] **Message Queues**: RabbitMQ/Kafka, decoupling, pub/sub vs worker queues
- [x] **CAP & PACELC**: Consistency vs Availability vs Partition tolerance trade-offs
- [x] **Microservices vs Monolith**: Network boundaries, distributed transactions (Saga), modular monolith

---

## 🚢 Phase 13: DevOps, Observability & Production
- [x] **Docker & Containers**: Multi-stage Dockerfiles, image layer caching, non-root security
- [x] **Docker Compose**: Orchestrating full-stack app + PostgreSQL + Redis locally
- [x] **CI/CD Automation**: GitHub Actions workflows for lint, test, build, and deploy
- [x] **Nginx Reverse Proxy**: Reverse proxying, SSL termination, gzip compression, HTTP/2
- [x] **Process Management**: PM2 cluster mode, automatic zero-downtime restarts
- [x] **Observability**: Centralized Winston logging, correlation IDs, Prometheus metrics, Sentry
- [x] **Graceful Shutdown**: Draining HTTP connections and DB pools on `SIGTERM` / `SIGINT`

---

## 🏆 Phase 14: Capstone Projects & Placement Mastery
- [x] **Project 1: Modern Kanban Board**: Drag-and-drop, optimistic UI, normalized state
- [x] **Project 2: Enterprise RBAC Auth Platform**: OAuth2, token rotation, Redis blacklist, audit logs
- [x] **Project 3: E-Commerce & Payment Engine**: Product catalog, Stripe webhooks, ACID inventory lock
- [x] **Project 4: Realtime Collaborative Workspace**: WebSockets, presence detection, Redis pub/sub
- [x] **Project 5: SaaS API Monitoring Platform**: Event ingestion, time-series data, dashboard
- [x] **Placement Coding Challenges**: Custom hooks, polyfills, rate limiters, top 25 SQL problems
- [x] **Project Defense Mastery**: 15 architectural defense questions prepared per project
- [x] **Cheatsheets & Emergency Revision**: One-day revision sheet and 11 domain comparison tables
