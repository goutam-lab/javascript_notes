# 📚 Full-Stack Placement Mastery — Complete Syllabus

This syllabus outlines the complete learning pathway from Web Foundations to Advanced System Design and Placement Defense.

---

## 🟢 Module 00: Progress & Tracking
- **`progress.md`**: Master status table covering all 30 modules and files.
- **`roadmap.md`**: Phase-by-phase learning sequence with milestones and exit gates.
- **`revision-tracker.md`**: Spaced repetition schedule (Day 1, Day 3, Day 7, Day 21).
- **`interview-tracker.md`**: Placement application, OA, and interview round scorecard.

---

## 🌐 Module 01: Web Foundations
- **`internet-and-networking.md`**: Physical infrastructure, packets, routers, ISPs, BGP routing.
- **`dns-and-domain-resolution.md`**: Recursive vs Iterative resolvers, Root servers, TLDs, A/AAAA/CNAME/MX records, DNS TTL and propagation.
- **`tcp-udp-and-ip.md`**: 3-Way Handshake (SYN, SYN-ACK, ACK), Flow Control (Sliding Window), Congestion Control, TCP vs UDP in WebSockets and WebRTC.
- **`http-evolution-1.1-2-3.md`**: HTTP/1.0 head-of-line blocking, HTTP/1.1 keep-alive and chunked transfer, HTTP/2 multiplexing and HPACK, HTTP/3 QUIC over UDP.
- **`https-tls-handshake.md`**: Asymmetric vs Symmetric encryption, TLS 1.2 vs 1.3 handshake, Certificate Authorities, public key pinning, session resumption.
- **`client-server-model.md`**: Request/Response lifecycle, statelessness, horizontal scalability, reverse proxies vs load balancers.
- **`browser-rendering-pipeline.md`**: HTML parser, DOM tree, CSSOM, Render tree, Layout (reflow), Paint (repaint), Composite, V8 parse/compile.
- **`cookies-sessions-tokens.md`**: Stateful vs stateless auth, Set-Cookie attributes (HttpOnly, Secure, SameSite=Strict/Lax/None), memory vs disk cookies.
- **`cors-same-origin-policy.md`**: Same-Origin Definition (protocol + domain + port), Simple vs Preflight (OPTIONS) requests, Access-Control-Allow-* headers.
- **`web-caching-mechanisms.md`**: Cache-Control (no-store, no-cache, max-age, must-revalidate, immutable), ETag vs Last-Modified, 304 Not Modified, heuristic caching.

---

## ⚛️ Module 02: React Foundations
- **`why-react-and-declarative-ui.md`**: Imperative vs Declarative UI, manual DOM manipulation cost, component-based composition.
- **`mental-model-and-component-tree.md`**: Pure functions of state, UI = f(state), unidirectional data flow, component hierarchies.
- **`jsx-under-the-hood.md`**: JSX transformation to `React.createElement` / `_jsx` runtime, JSX AST, why React must be in scope or automatic runtime.
- **`props-immutability-unidirectional-flow.md`**: Read-only props, shallow object freeze semantics, passing functions, children as props.
- **`state-foundations-and-reactivity.md`**: What is state, why local variables fail, trigger-render-commit lifecycle, scheduled state updates.
- **`synthetic-events-and-pooling.md`**: Cross-browser normalization, event delegation on root container (`#root`), event bubbling, synthetic vs native events.
- **`conditional-rendering-patterns.md`**: Ternary operators, short-circuit `&&` traps (the `0` bug), early returns, switch/lookup maps.
- **`lists-and-reconciliation-keys.md`**: Why keys are mandatory, stable IDs vs array index anti-pattern, element identity preservation.
- **`controlled-vs-uncontrolled-components.md`**: Single source of truth vs DOM-managed inputs, `value` + `onChange` vs `defaultValue` + `ref`, file inputs.
- **`lifting-state-and-composition.md`**: Sharing state between siblings, avoiding prop drilling with component composition (inversion of control).

---

## 🔬 Module 03: React Deep Dive & Internals
- **`usestate-batching-and-closures.md`**: Internal fiber hook linked list, updater function pattern `setCount(c => c + 1)`, React 18 automatic batching.
- **`useeffect-lifecycle-cleanup-traps.md`**: Synchronizing with external systems, dependency array comparison (`Object.is`), cleanup function execution timing, StrictMode double invocation.
- **`useref-dom-and-mutable-values.md`**: Persistent mutable container across renders without triggering re-render, DOM references, storing timer IDs, previous state pattern.
- **`usememo-and-usecallback-internals.md`**: Referential equality, expensive computation caching, when memoization hurts performance, profiling before memoizing.
- **`usecontext-and-re-render-cost.md`**: Context mental model, provider-consumer propagation, the global re-render problem, splitting contexts (state vs dispatch).
- **`usereducer-complex-state.md`**: Predictable state transitions, action-reducer pattern, comparing `useState` vs `useReducer`, state machines.
- **`custom-hooks-architecture.md`**: Reusable headless logic extraction, composition of built-in hooks, naming conventions, custom hook testing patterns.
- **`virtual-dom-reconciliation-diffing.md`**: O(N) heuristic diffing algorithm, element type changes vs attribute updates, keys in diffing.
- **`react-fiber-architecture-and-phases.md`**: Stack reconciler limitations, Fiber node structure (child, sibling, return), Render phase (interruptible) vs Commit phase (synchronous).
- **`concurrent-react-transitions-suspense.md`**: Prioritizing urgent vs non-urgent updates, `useTransition`, `useDeferredValue`, Suspense boundaries, streaming SSR.
- **`error-boundaries-and-resilience.md`**: Catching render-phase errors, `componentDidCatch` and `getDerivedStateFromError`, fallback UI, limitations (async & event handlers).
- **`react-anti-patterns-and-stale-closures.md`**: Mutating state directly, effects without cleanups, stale closures in timers and callbacks, deriving state vs calculating on render.

---

## 🟦 Module 04: TypeScript
- **`type-system-mental-model.md`**: Static typing vs dynamic runtime, compile-time type erasure, structural subtyping (duck typing) vs nominal typing.
- **`primitives-literal-types-unions.md`**: `string`, `number`, `boolean`, `symbol`, `bigint`, string literal types, union types `A | B`, discriminating unions.
- **`interfaces-vs-type-aliases.md`**: Declaration merging, `extends` vs `&` intersection, performance differences in compiler cache, guidelines on when to use which.
- **`object-typing-excess-property-checks.md`**: Object shapes, optional properties `?`, `readonly` properties, excess property checks on literals vs variables.
- **`array-tuple-readonly-types.md`**: Typed arrays `T[]` vs `Array<T>`, fixed-length tuples `[string, number]`, variadic tuples, `readonly [T, ...U]`.
- **`functions-overloads-signatures.md`**: Parameter typing, return type inference, void vs never vs undefined, function overloads and implementation signatures.
- **`type-narrowing-and-type-guards.md`**: `typeof`, `instanceof`, `in` operator, custom user-defined type predicates (`val is Type`), assertion functions.
- **`generics-constraints-defaults.md`**: Generic functions and classes `<T>`, `extends` constraints, default generic parameters, multiple type arguments.
- **`utility-types-deep-dive.md`**: `Partial<T>`, `Required<T>`, `Readonly<T>`, `Record<K, V>`, `Pick<T, K>`, `Omit<T, K>`, `Exclude<T, U>`, `Extract<T, U>`, `NonNullable<T>`, `ReturnType<T>`, `Parameters<T>`.
- **`advanced-types-indexed-mapped-keyof.md`**: `keyof` operator, indexed access `T[K]`, mapped types `[P in K]: T[P]`, template literal types.
- **`conditional-types-and-infer.md`**: `T extends U ? X : Y`, distributive conditional types, unpacking types with `infer` keyword.
- **`react-typing-props-events-hooks.md`**: `React.FC` critique, `PropsWithChildren`, `React.MouseEvent`, `React.ChangeEvent`, typing `useState`, `useRef`, `useReducer`, `forwardRef`.
- **`backend-and-api-typing.md`**: Express Request/Response generic typing, shared DTOs between client and server, validating untrusted data with Zod and inferring TS types.
- **`tsconfig-compiler-options-pitfalls.md`**: `strict: true`, `noImplicitAny`, `strictNullChecks`, `target`, `moduleResolution`, `paths` alias setup, common build errors.

---

## 🎨 Module 05: Frontend Engineering
- **`modular-css-modules-vanilla-architecture.md`**: Global CSS collisions, BEM convention, CSS Modules scoping, Vanilla CSS Custom Properties (CSS variables).
- **`component-design-patterns-compound-renderprops.md`**: Compound Components pattern (Tabs, Accordion, Select), Render Props, Slot pattern, polymorphic components (`as` prop).
- **`design-systems-tokens-theming.md`**: Design tokens (color, spacing, elevation, typography), CSS custom property switching for dark mode, fluid typography.
- **`accessibility-a11y-wcag-patterns.md`**: Semantic HTML5, ARIA roles, states, and properties, focus trapping in modals, keyboard navigation, screen reader testing.
- **`client-side-routing-mechanics.md`**: History API (`pushState`, `replaceState`, `popstate`), matching route patterns, handling 404s in SPAs, scroll restoration.
- **`code-splitting-lazy-loading-chunks.md`**: Dynamic `import()`, `React.lazy`, route-based splitting, component-based splitting, chunk naming in bundlers.
- **`asset-optimization-images-fonts-scripts.md`**: WebP/AVIF formats, responsive images (`srcset`, `sizes`), font display swap, critical CSS, `async` vs `defer` scripts.
- **`error-handling-toast-modals-ux.md`**: Toast systems, inline form validation states, optimistic UI feedback, network offline state detection.
- **`frontend-security-xss-csrf-clickjacking.md`**: Stored/Reflected/DOM XSS, sanitizing input with DOMPurify, Content Security Policy (CSP), framebusting (`X-Frame-Options`).

---

## ▲ Module 06: Next.js (App Router Deep Dive)
- **`nextjs-mental-model-ssr-ssg-isr-rsc.md`**: Traditional SSR vs SSG vs ISR vs React Server Components, hydration mental model.
- **`app-router-architecture-conventions.md`**: Folder structure conventions: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, route colocation.
- **`server-components-vs-client-components.md`**: RSC benefits (zero bundle size, direct backend access), `'use client'` directive boundary, passing props across boundary, serialization rules.
- **`routing-nested-dynamic-catchall-groups.md`**: Dynamic segments `[id]`, catch-all `[...slug]`, optional catch-all `[[...slug]]`, route groups `(marketing)` / `(auth)`, parallel and intercepting routes.
- **`layouts-templates-navigation.md`**: Root layout vs nested layouts, layout persistence vs template re-mounting, `Link` prefetching, `useRouter`.
- **`data-fetching-fetch-cache-revalidate.md`**: Extended `fetch()` API, request memoization, Data Cache, Full Route Cache, Router Cache, on-demand revalidation (`revalidateTag`, `revalidatePath`).
- **`server-actions-mutations-forms.md`**: `'use server'` functions, progressive enhancement with HTML forms, optimistic updates with `useOptimistic`, pending state with `useActionState`.
- **`route-handlers-custom-api-endpoints.md`**: `route.ts` architecture, GET/POST/PUT/DELETE handlers, reading headers and cookies, returning `NextResponse.json`.
- **`middleware-request-interception-auth.md`**: Edge runtime constraints, route matching, protecting private routes, redirecting unauthenticated users, setting response cookies/headers.
- **`metadata-seo-opengraph-sitemaps.md`**: Static vs dynamic metadata (`generateMetadata`), OpenGraph images (`ImageResponse`), `sitemap.ts`, `robots.ts`.
- **`nextjs-image-font-script-optimizations.md`**: `next/image` layout and automatic format conversion, `next/font` zero-layout-shift local loading, `next/script` strategies (`beforeInteractive`, `afterInteractive`, `lazyOnload`).
- **`nextjs-production-architecture-caching.md`**: 4-layer caching architecture (Request Memoization, Data Cache, Full Route Cache, Router Cache), debugging cache misses, self-hosting vs Vercel.

---

## 🗃️ Module 07: State Management
- **`state-classification-server-client-url.md`**: Categorizing state: Local, Global UI, URL/Router, Server/Remote Cache; picking the right home for data.
- **`url-state-searchparams-history.md`**: Why URL is the best state manager for filters, search, pagination, and tabs; `useSearchParams`, shallow routing.
- **`zustand-lightweight-store-architecture.md`**: Zustand mental model, creating stores, slices pattern, selectors and preventing re-renders, middleware (persist, devtools).
- **`redux-toolkit-mental-model-slices.md`**: Redux flow (Action $\rightarrow$ Dispatch $\rightarrow$ Reducer $\rightarrow$ Store), RTK `createSlice`, Immer immutability under the hood, Redux thunks.
- **`tanstack-query-server-state-caching.md`**: Declarative data fetching, cache keys, query invalidation, background refetching, mutations, optimistic updates, pagination.
- **`state-management-tradeoffs-matrix.md`**: In-depth comparison matrix: Context vs Zustand vs Redux Toolkit vs TanStack Query vs URL state.

---

## 📝 Module 08: Forms & Validation
- **`form-mechanics-browser-vs-react.md`**: Native HTML5 form validation attributes, `FormData` API, submit event handling, preventDefault.
- **`react-hook-form-internals-perf.md`**: Uncontrolled input subscription model, isolating re-renders to input nodes, `register`, `handleSubmit`, `watch`, `control`.
- **`schema-validation-with-zod.md`**: Defining schemas, parsing vs safeParsing, custom validators with `.refine()`, transforming data, nested schemas.
- **`multi-step-wizards-and-state.md`**: Multi-step wizard architectures, persisting partial state across steps, validating step-by-step with Zod.
- **`fullstack-type-safe-form-lifecycle.md`**: End-to-end schema sharing: Single Zod schema powering React Hook Form, Next.js Server Action, and Express API.

---

## 🔌 Module 09: API Development
- **`rest-principles-and-maturity-model.md`**: Richardson Maturity Model (Level 0 to 3), HATEOAS, resource-oriented URI design conventions.
- **`http-methods-semantics-idempotency.md`**: Safe vs Idempotent methods (GET, POST, PUT, PATCH, DELETE), implementing idempotency keys in financial APIs.
- **`http-status-codes-in-production.md`**: Exact semantic usage: 200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504.
- **`request-and-response-contracts.md`**: Standardized JSON envelopes, error response structure, metadata blocks, type safety contracts.
- **`pagination-offset-cursor-keyset.md`**: Offset-based (`LIMIT/OFFSET`) performance degradation, Cursor-based pagination (`created_at` / `id`), Keyset pagination.
- **`filtering-sorting-searching-strategies.md`**: Query string parsing, sanitizing filter inputs, multi-column sorting, full-text search indexing.
- **`api-versioning-and-breaking-changes.md`**: URI path (`/v1/`), Query parameter (`?v=1`), Header versioning (`Accept`), deprecation headers.
- **`rate-limiting-and-throttling-algorithms.md`**: Fixed Window, Sliding Window Log, Token Bucket, Leaky Bucket algorithms; Redis implementation.
- **`file-uploads-multipart-presigned-urls.md`**: Multipart form data vs S3/GCS Presigned Direct Upload URLs (avoiding backend bottleneck).
- **`webhooks-design-and-verification.md`**: Outgoing webhook architecture, HMAC SHA256 signature verification, retry policies with exponential backoff.

---

## 🟢 Module 10: Node.js Runtime Internals
- **`nodejs-runtime-architecture-v8-libuv.md`**: V8 engine vs Libuv C++ library, single-threaded execution vs multi-threaded I/O, Node.js bindings.
- **`event-loop-phases-timers-poll-check.md`**: Libuv 6 event loop phases: Timers, Pending I/O, Idle/Prepare, Poll, Check (`setImmediate`), Close callbacks; `process.nextTick` VIP queue.
- **`thread-pool-worker-threads-cluster.md`**: Libuv thread pool (`UV_THREADPOOL_SIZE`), CPU-bound tasks vs I/O-bound tasks, Worker Threads API, Node Cluster module.
- **`buffer-and-binary-data.md`**: Raw memory outside V8 heap, ArrayBuffer, Uint8Array, Buffer allocation (`alloc` vs `allocUnsafe`), encoding (utf-8, hex, base64).
- **`streams-readable-writable-duplex-pipe.md`**: Why streams prevent out-of-memory crashes, 4 stream types, backpressure mechanics, pipeline API.
- **`event-emitter-and-event-driven-arch.md`**: EventEmitter pattern, memory leak warnings (`MaxListenersExceededWarning`), building custom reactive emitters.
- **`memory-leaks-garbage-collection-profiling.md`**: V8 Scavenge (New space) vs Mark-Sweep-Compact (Old space), diagnosing memory leaks with heap snapshots.

---

## ⚡ Module 11: Express.js
- **`express-internals-router-stack.md`**: How Express works under the hood: Layer stack, Route stack, matching paths, dispatching.
- **`middleware-chain-and-execution-order.md`**: The `next()` function, middleware chaining order, mutating `req` and `res`, early exit patterns.
- **`request-lifecycle-in-express.md`**: Step-by-step tracing from raw incoming socket connection to response finish event.
- **`central-error-handling-and-async-errors.md`**: 4-argument error middleware `(err, req, res, next)`, custom `AppError` class, async errors in Express 4 vs Express 5.
- **`request-validation-middleware.md`**: Building a reusable Zod validation middleware for `body`, `query`, and `params`.
- **`production-middleware-helmet-cors-morgan.md`**: Configuring Helmet for security headers, CORS origin whitelisting, Morgan HTTP request logging, Compression.

---

## 🏛️ Module 12: Backend Architecture
- **`layered-architecture-controller-service-repo.md`**: Separation of concerns: Controller (HTTP) $\rightarrow$ Service (Business Domain) $\rightarrow$ Repository (Data Access).
- **`dependency-injection-and-inversion-of-control.md`**: Decoupling components, passing dependencies via constructors, mockability in testing.
- **`clean-architecture-and-domain-isolation.md`**: Domain entities, use cases, interface adapters, dependency rule pointing inward.
- **`configuration-and-env-management.md`**: Validating environment variables at server startup using Zod, managing multi-environment configs (`.env.production`).
- **`structured-logging-correlation-ids-winston.md`**: JSON logs, log levels (info, warn, error), tracing requests across microservices via `X-Correlation-ID`.
- **`background-jobs-message-queues-bullmq.md`**: Offloading asynchronous work (emails, video processing), BullMQ with Redis, workers, concurrency, retry strategies.

---

## 🔐 Module 13: Authentication & Authorization
- **`auth-mental-model-identity-vs-permission.md`**: Authentication (Who are you?) vs Authorization (What can you do?).
- **`password-security-salting-bcrypt-argon2.md`**: Why MD5/SHA256 fail, cryptographic salts, work factors, Bcrypt vs Argon2id memory-hard hashing.
- **`session-based-authentication-cookies.md`**: Stateful sessions, session store in Redis, cookie flags (HttpOnly, Secure, SameSite), session invalidation.
- **`jwt-architecture-signing-claims-verifying.md`**: Header.Payload.Signature, base64url encoding, HMAC SHA256 vs RSA public/private key signing, JWT revocation problem.
- **`dual-token-rotation-access-and-refresh.md`**: Short-lived access token (15 mins) + long-lived refresh token (7 days), refresh token rotation, detecting token theft.
- **`oauth2-and-oidc-flow-step-by-step.md`**: Authorization Code flow with PKCE, Client ID, Client Secret, scopes, tokens, Google/GitHub login integration.
- **`rbac-role-based-access-control.md`**: Roles, permissions, role hierarchy, middleware authorization guards (`authorize(['ADMIN', 'MANAGER'])`).
- **`abac-attribute-based-access-control.md`**: Fine-grained contextual permissions (e.g. "User can edit document if user == author AND document.status == DRAFT").
- **`common-auth-vulnerabilities-and-fixes.md`**: Broken object-level authorization (BOLA/IDOR), session fixation, missing rate limiting on login, timing attacks.

---

## 💾 Module 14: Databases & Systems
- **`database-categorization-relational-vs-nosql.md`**: Relational (Postgres, MySQL) vs Document (MongoDB) vs Key-Value (Redis) vs Wide-Column (Cassandra) vs Graph (Neo4j).
- **`database-drivers-vs-orms-vs-query-builders.md`**: Low-level drivers (`pg`), query builders (Knex, Kysely), full ORMs (Prisma, TypeORM) — abstraction cost vs developer velocity.
- **`connection-pooling-mechanics-and-sizing.md`**: Why opening TCP connections per query kills DB performance, pool size formula: `connections = ((core_count * 2) + effective_spindle_count)`.
- **`acid-properties-deep-dive.md`**: Atomicity (all-or-nothing), Consistency (rules/constraints), Isolation (concurrency control), Durability (WAL on disk).
- **`transaction-isolation-levels-anomalies.md`**: Read Uncommitted, Read Committed, Repeatable Read, Serializable; Anomalies: Dirty Read, Non-repeatable Read, Phantom Read, Serialization Anomaly.
- **`indexing-strategies-b-trees-hash-gin.md`**: B-Tree structure, leaf nodes, index traversal cost, clustered vs non-clustered, composite index leftmost prefix rule, GIN/GiST indexes.
- **`database-normalization-1nf-2nf-3nf-bcnf.md`**: 1NF (atomic values), 2NF (no partial dependency), 3NF (no transitive dependency), Boyce-Codd Normal Form.
- **`denormalization-tradeoffs-in-high-read.md`**: When to break normalization rules, read throughput vs write penalty, maintaining sync with events/triggers.
- **`n-plus-one-problem-detection-and-prevention.md`**: What is N+1, detecting it in logs, fixing via SQL JOINs, DataLoader pattern, batching queries.

---

## 🐘 Module 15: SQL in Application Development (PostgreSQL)
- **`postgresql-setup-and-psql-fundamentals.md`**: PostgreSQL architecture, psql CLI mastery, data types (UUID, JSONB, TIMESTAMP WITH TIME ZONE).
- **`ddl-and-dml-crud-foundations.md`**: `CREATE TABLE`, constraints (`PRIMARY KEY`, `FOREIGN KEY`, `UNIQUE`, `CHECK`), `INSERT ... ON CONFLICT DO UPDATE` (UPSERT).
- **`filtering-grouping-aggregations.md`**: `WHERE` vs `HAVING`, `GROUP BY`, `COUNT`, `SUM`, `AVG`, `MIN`, `MAX`, `COALESCE`.
- **`joins-inner-left-right-full-cross.md`**: Join execution engines (Nested Loop, Hash Join, Merge Join), multi-table joins, self joins.
- **`subqueries-and-correlated-subqueries.md`**: Scalar subqueries, `IN`, `EXISTS`, `ANY`, correlated subquery performance hazards.
- **`common-table-expressions-cte-recursive.md`**: Readable query design with `WITH`, recursive CTEs for hierarchical organizational trees and threaded comments.
- **`window-functions-row-number-rank-lead-lag.md`**: `OVER (PARTITION BY ... ORDER BY ...)`, `ROW_NUMBER()`, `RANK()`, `DENSE_RANK()`, `LEAD()`, `LAG()`, running totals.
- **`transactions-savepoints-rollback-locks.md`**: Explicit transactions (`BEGIN`, `COMMIT`, `ROLLBACK`), Savepoints, Pessimistic Locking (`SELECT FOR UPDATE`), Optimistic Locking (`version` column).
- **`schema-migrations-versioning-patterns.md`**: Up/Down migration scripts, safe online migrations (adding non-null columns without locking tables).
- **`explain-analyze-query-profiling.md`**: Reading `EXPLAIN (ANALYZE, BUFFERS)` output: Sequential Scan vs Index Scan vs Bitmap Heap Scan, Execution Time vs Planning Time.

---

## 🍃 Module 16: NoSQL & MongoDB
- **`mongodb-document-model-bson-internals.md`**: JSON vs BSON (Binary JSON), 16MB document size limit, ObjectId timestamp structure.
- **`schema-design-embedding-vs-referencing.md`**: 1:1, 1:N (few), 1:N (many), N:M relationships; embedding for read speed vs referencing for unbound growth.
- **`crud-operations-operators-projection.md`**: `$set`, `$unset`, `$push`, `$pull`, `$inc`, `$addToSet`, array filters, projections.
- **`indexing-single-compound-multikey-ttl.md`**: ESR rule (Equality, Sort, Range) for compound indexes, Multikey indexes on arrays, TTL indexes for session expiry.
- **`aggregation-pipeline-stages-and-optimization.md`**: Aggregation stages: `$match`, `$group`, `$project`, `$unwind`, `$lookup` (JOIN), `$sort`, `$limit`, aggregation pipeline optimization.
- **`transactions-in-mongodb-replica-sets.md`**: Multi-document ACID transactions in replica sets, two-phase commit, performance costs.
- **`mongodb-with-node-mongoose-patterns.md`**: Mongoose schemas, models, pre/post middleware hooks, virtuals, lean queries for performance.
- **`sql-vs-nosql-decision-framework.md`**: Comprehensive architectural decision framework: ACID guarantees vs flexible schema vs horizontal partitioning.

---

## 🛠️ Module 17: ORMs & Database Tools
- **`what-is-an-orm-pros-cons-abstractions.md`**: Object-Relational Impedance Mismatch, productivity vs query control, leakiness of ORM abstractions.
- **`prisma-schema-modelling-client-engine.md`**: Prisma Schema language, Query Engine (Rust binary), Prisma Client API generation, type safety guarantees.
- **`relations-migrations-seeding-in-prisma.md`**: 1-1, 1-N, N-M relations, `prisma migrate dev`, shadow database, database seeding scripts.
- **`drizzle-orm-sql-like-type-safety.md`**: Drizzle philosophy ("If you know SQL, you know Drizzle"), zero-binary lightweight footprint, schema definition, prepared statements.
- **`raw-sql-vs-query-builders-vs-orms.md`**: Performance benchmark and trade-off comparison: Native Driver (`pg`) vs Kysely vs Drizzle vs Prisma.

---

## 🛡️ Module 18: Security Engineering
- **`owasp-top-10-web-vulnerabilities.md`**: Broken Access Control, Cryptographic Failures, Injection, Insecure Design, Security Misconfiguration.
- **`sql-injection-and-nosql-injection.md`**: Parameterized queries vs string concatenation, ORM blind spots, MongoDB operator injection (`$gt: ""`).
- **`xss-stored-reflected-dom-sanitization.md`**: XSS attack payloads, `dangerouslySetInnerHTML` dangers, HTTP-only cookies as secondary defense.
- **`csrf-token-validation-samesite-cookies.md`**: How CSRF attacks steal user actions, Anti-CSRF Synchronizer Token pattern, Double Submit Cookie pattern, `SameSite=Lax/Strict`.
- **`security-headers-csp-hsts-x-frame.md`**: Content-Security-Policy (CSP), Strict-Transport-Security (HSTS), X-Content-Type-Options, Referrer-Policy.
- **`secrets-management-env-vaults-kms.md`**: Why `.env` should never touch git, git-secrets detection, AWS Secrets Manager, HashiCorp Vault.
- **`rate-limiting-ddos-mitigation.md`**: IP-based rate limiting, user-based rate limiting, Cloudflare WAF, Nginx burst rate limits.
- **`input-sanitization-zod-joi-validator.md`**: Whitelist validation vs blacklisting, sanitizing HTML, validating schemas across full stack.

---

## 🧪 Module 19: Testing
- **`testing-pyramid-unit-integration-e2e.md`**: Unit tests (fast, cheap) vs Integration tests (confidence) vs E2E tests (slow, costly); code coverage vs test quality.
- **`test-driven-development-tdd-workflow.md`**: Red-Green-Refactor cycle, writing tests before implementation, TDD in machine coding rounds.
- **`unit-testing-vitest-jest-matchers.md`**: Test suites, test runners, assertions, lifecycle hooks (`beforeEach`, `afterEach`), testing pure functions.
- **`component-testing-react-testing-library.md`**: Testing user behavior, not implementation details; queries (`getByRole`, `findByText`), user-event library.
- **`mocking-spies-stubs-msw-network-mocks.md`**: Mocking functions (`vi.fn`), spies (`vi.spyOn`), Mock Service Worker (MSW) for API interception.
- **`backend-api-integration-testing-supertest.md`**: Testing Express routes end-to-end, testing headers, status codes, JSON payloads with Supertest.
- **`database-testing-testcontainers-in-memory.md`**: Ephemeral test databases with Docker Testcontainers, database cleaning strategies between test runs.
- **`e2e-testing-playwright-automation.md`**: Cross-browser automated browser testing with Playwright, page object model (POM), recording test traces.

---

## ⚡ Module 20: Performance Engineering
- **`web-vitals-lcp-cls-inp-measurement.md`**: Core Web Vitals: Largest Contentful Paint (LCP), Cumulative Layout Shift (CLS), Interaction to Next Paint (INP).
- **`react-profiling-flamecharts-re-renders.md`**: React DevTools Profiler, reading flame charts, identifying "why did this render?", wasted renders.
- **`bundle-analysis-treeshaking-dynamic-imports.md`**: Webpack Bundle Analyzer / Source-map-explorer, tree-shaking dead code, analyzing lodash/moment import bloat.
- **`backend-latency-profiling-event-loop-lag.md`**: Measuring p50, p95, p99 latency, Event Loop lag measurement (`blocked-at`), profiling CPU with Clinic.js.
- **`database-query-optimization-index-scans.md`**: Eliminating sequential table scans, covering indexes, partial indexes, optimizing sorting queries.
- **`redis-caching-patterns-cache-aside-write-thru.md`**: Cache-Aside (Lazy loading), Write-Through, Write-Behind, Cache Invalidation strategies, Cache Stampede (Dogpiling) mitigation.
- **`cdn-edge-caching-stale-while-revalidate.md`**: Edge CDN nodes, HTTP `s-maxage`, `stale-while-revalidate`, edge compute routing.
- **`memory-leaks-heap-snapshots-diagnostics.md`**: Taking and comparing V8 heap snapshots in Chrome DevTools / Node inspector to locate uncollected retained objects.

---

## 📐 Module 21: System Design (Placement SDE-1 Focus)
- **`system-design-interview-framework.md`**: 4-step interview template: Requirements (Functional/Non-Functional) $\rightarrow$ Capacity Estimation $\rightarrow$ High-Level Design $\rightarrow$ Deep Dive.
- **`client-server-load-balancing-reverse-proxy.md`**: Layer 4 vs Layer 7 Load Balancing, Round Robin, Weighted, Least Connections, IP Hash; Nginx, HAProxy, AWS ALB.
- **`horizontal-vs-vertical-scaling-stateless.md`**: Scaling up vs scaling out, stateful vs stateless servers, shared-nothing architecture.
- **`caching-strategies-redis-eviction-policies.md`**: Cache hit ratio, eviction policies (LRU, LFU, FIFO), handling cache breakdown, cache avalanche, cache penetration.
- **`database-scaling-read-replicas-sharding.md`**: Master-Slave replication (read replicas, replication lag), horizontal sharding (range-based, hash-based), shard keys.
- **`message-queues-rabbitmq-kafka-decoupling.md`**: Synchronous vs Asynchronous communication, message brokers, push vs pull, message durability, at-least-once delivery.
- **`cdn-and-object-storage-s3-blob-patterns.md`**: Distributing static assets via Cloudflare/CloudFront, storing binary files in AWS S3 with CDN distribution.
- **`cap-theorem-and-pacelc-tradeoffs.md`**: Consistency vs Availability vs Partition Tolerance; PACELC theorem (Partitioning vs Else latency).
- **`microservices-vs-modular-monolith.md`**: Fallacy of premature microservices, network latency cost, distributed transactions (Saga pattern) vs Modular Monolith.
- **`case-study-url-shortener.md`**: TinyURL design: 100M URLs/day, base62 encoding vs MD5 hash, read-heavy caching, counter service.
- **`case-study-authentication-service.md`**: Centralized Auth Service: session store scaling, token issuance, multi-region replication.
- **`case-study-real-time-chat-application.md`**: WhatsApp/Slack design: WebSockets, presence service, Redis Pub/Sub, message persistence in Cassandra/Postgres.
- **`case-study-notification-service.md`**: Scalable multi-channel notification engine (Email, SMS, Push), priority queues, idempotency, rate limiting users.
- **`case-study-file-upload-processing-pipeline.md`**: Video/Image pipeline: S3 Presigned URLs, SQS queue trigger, worker cluster transcoding, CDN distribution.
- **`case-study-ecommerce-checkout-and-inventory.md`**: Flash sale inventory management: race conditions, distributed locking (Redis), handling payment webhooks reliably.

---

## 🚢 Module 22: Deployment & DevOps
- **`environments-dev-staging-production.md`**: Parity between dev and prod, Twelve-Factor App methodology.
- **`docker-containers-images-dockerfile-builds.md`**: VM vs Container, Docker layers, multi-stage builds for small production images, non-root users.
- **`docker-compose-multi-service-local-stack.md`**: Orchestrating frontend, backend, PostgreSQL, and Redis locally in Docker Compose with bridge networks.
- **`ci-cd-pipelines-github-actions-automation.md`**: Automated lint, test, build, and deploy pipelines using GitHub Actions workflows and secrets.
- **`deploying-frontend-vercel-cloudflare-pages.md`**: Static site deployment, edge networks, continuous deployment hooks, environment variable management.
- **`deploying-backend-vps-aws-railway-render.md`**: Deploying Node/Express applications to cloud platforms (Railway, Render, AWS EC2/ECS).
- **`process-managers-pm2-systemd-logs.md`**: Keeping Node.js alive: PM2 cluster mode, automatic restarts on crash, systemd service units.
- **`reverse-proxy-nginx-ssl-certbot.md`**: Configuring Nginx as reverse proxy, gzip compression, proxy headers, free SSL certificates with Let's Encrypt / Certbot.

---

## 🏭 Module 23: Production Engineering & Observability
- **`health-checks-liveness-readiness-probes.md`**: `/health/live` vs `/health/ready`, checking database connection pool and Redis status before accepting traffic.
- **`centralized-logging-log-aggregation-elk.md`**: Why `console.log` fails in production, JSON log formats, log aggregation with Winston, Elasticsearch/Loki.
- **`application-metrics-prometheus-grafana.md`**: Golden signals (Latency, Traffic, Errors, Saturation), exporting metrics with `prom-client`, Grafana dashboards.
- **`error-tracking-and-monitoring-sentry.md`**: Real-time stack traces, capturing user context without leaking PII, source maps upload.
- **`graceful-shutdown-handling-terminations.md`**: Listening to `SIGTERM` and `SIGINT`, stopping incoming connections, draining active DB queries before exit.
- **`zero-downtime-deployments-blue-green-canary.md`**: Blue-Green deployments vs Rolling updates vs Canary releases.
- **`disaster-recovery-backups-rollback-plans.md`**: Automated database backups (pg_dump, WAL archiving), testing recovery, quick rollback strategies.

---

## 🏆 Module 24: Capstone Fullstack Projects
- **`project-1-modern-kanban-board.md`**: Trello clone: Drag-and-drop, optimistic UI, state synchronization, normalized state, relational DB schema.
- **`project-2-enterprise-rbac-auth-platform.md`**: Enterprise IAM platform: OAuth2/OIDC, dual token rotation, Redis session blacklist, role/permission engine, audit logging.
- **`project-3-e-commerce-store-and-payment-engine.md`**: E-Commerce: Product catalog with full-text search, shopping cart, Stripe webhook idempotency, ACID inventory reservation.
- **`project-4-realtime-collaborative-workspace.md`**: Notion/Figma mini clone: WebSockets, presence detection, live document editing, cursor tracking, Redis pub/sub.
- **`project-5-saas-api-monitoring-analytics.md`**: Datadog/PostHog mini clone: SDK event ingestion, high-throughput batching, time-series data storage, interactive dashboard.

---

## 🎯 Module 25: Placement Interview QA
- **`frontend-react-interview-questions.md`**: 50+ categorized React questions with precise spoken answers.
- **`typescript-interview-questions.md`**: 30+ core TypeScript questions on types, generics, and compiler mechanics.
- **`nextjs-fullstack-interview-questions.md`**: 30+ Next.js App Router and fullstack questions.
- **`node-express-backend-interview-questions.md`**: 40+ Node.js runtime and Express architecture questions.
- **`database-sql-nosql-interview-questions.md`**: 40+ database, indexing, ACID, and query optimization questions.
- **`auth-and-security-interview-questions.md`**: 30+ practical web security and authentication questions.
- **`system-design-interview-questions.md`**: 25+ foundational SDE-1 system design questions.
- **`scenario-debugging-interview-questions.md`**: 25+ real-world production incident debugging scenarios.

---

## ⚡ Module 26: Cheatsheets & Emergency Revision
- **`fullstack-one-day-revision-guide.md`**: The night-before placement summary sheet!
- **`react-hooks-and-lifecycle-cheatsheet.md`**: Hook signatures, dependencies, cleanup rules.
- **`typescript-types-and-generics-cheatsheet.md`**: Utility types and generic signatures.
- **`nextjs-app-router-cheatsheet.md`**: File conventions and cache functions.
- **`http-status-codes-and-headers-cheatsheet.md`**: Headers, status codes, methods.
- **`node-and-express-patterns-cheatsheet.md`**: Middleware, streams, buffer helpers.
- **`postgresql-queries-and-indexing-cheatsheet.md`**: Joins, window functions, indexes.
- **`mongodb-aggregations-cheatsheet.md`**: Aggregation pipeline stages and operators.
- **`authentication-and-security-cheatsheet.md`**: Cookie flags, JWT structure, OWASP mitigations.
- **`system-design-numbers-and-patterns-cheatsheet.md`**: Latency numbers every programmer should know, capacity estimation heuristics.
- **`docker-and-deployment-cheatsheet.md`**: Dockerfile commands, Compose keys, Nginx blocks.

---

## ⚠️ Module 27: Common Mistakes & Anti-Patterns
- **`react-state-mutation-and-re-render-mistakes.md`**: Direct state mutation, missing key bugs, infinite render loops.
- **`useeffect-dependency-and-closure-mistakes.md`**: Missing dependencies, stale closures, using useEffect for derived state.
- **`typescript-any-casting-and-loose-types.md`**: Overuse of `any`, unsafe type assertions (`as unknown as T`).
- **`nextjs-client-server-leakage-mistakes.md`**: Importing server secrets in client components, waterfall data fetching.
- **`unhandled-async-express-promise-rejections.md`**: Unhandled promise rejections crashing Node process, forgotten `next(err)`.
- **`database-n-plus-one-and-unindexed-queries.md`**: Querying inside loops, unindexed foreign keys causing table scans.
- **`insecure-token-storage-and-broken-auth.md`**: Storing tokens in localStorage, missing permission checks on IDs.
- **`memory-leaks-in-node-and-react.md`**: Uncleared intervals, global event listener accumulation.

---

## 💻 Module 28: Placement Coding & Machine Coding
- **`custom-react-hooks-challenges.md`**: Implementing `useDebounce`, `useLocalStorage`, `usePrevious`, `useOnClickOutside`.
- **`polyfill-custom-promise-all-and-combinators.md`**: Custom implementations of `Promise.all`, `Promise.allSettled`, `Promise.race`, `Promise.any`.
- **`deep-clone-and-object-manipulation.md`**: Hand-written deep clone handling cycles, deep equality comparison, object flattener.
- **`debounce-and-throttle-react-implementations.md`**: Hook-based debounce and throttle with immediate invoke options.
- **`rate-limiter-sliding-window-implementation.md`**: Sliding window counter algorithm implemented in JS/TS.
- **`sql-query-solving-top-25-placement-problems.md`**: 25 high-frequency SQL placement problems (2nd highest salary, duplicate emails, customer orders).
- **`api-middleware-and-pipeline-challenges.md`**: Building custom middleware runners and pipeline executors.

---

## 🎤 Module 29: Project Interview Defense
- **`project-1-kanban-deep-dive-defense.md`**: 15 architectural questions on Kanban project.
- **`project-2-rbac-auth-deep-dive-defense.md`**: 15 architectural questions on RBAC auth platform.
- **`project-3-ecommerce-deep-dive-defense.md`**: 15 architectural questions on E-commerce store.
- **`project-4-realtime-collab-deep-dive-defense.md`**: 15 architectural questions on Realtime workspace.
- **`project-5-saas-monitoring-deep-dive-defense.md`**: 15 architectural questions on SaaS API monitoring.
- **`master-framework-how-to-defend-any-project.md`**: Framework for answering: "What was your hardest technical challenge?", "What happens if traffic scales 100x?", "What would you change?".
