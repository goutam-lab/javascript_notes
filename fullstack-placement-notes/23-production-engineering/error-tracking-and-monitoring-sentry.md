# Error Tracking & Real-Time Crash Monitoring with Sentry

## 1. What is it?
**Error Tracking & Crash Monitoring** (exemplified by **Sentry**, **Bugsnag**, and **Datadog APM**) is a real-time observability practice that automatically intercepts, captures, aggregates, and alerts on unhandled runtime exceptions, rejections, and performance anomalies across full-stack applications.

Unlike log aggregation engines (where developers must actively search for errors amidst millions of lines of text), error tracking platforms:
1. **Deduplicate & Group Crashes**: Group thousands of individual error occurrences into a single actionable **Issue** using intelligent stack trace fingerprinting.
2. **Reconstruct Minified Stack Traces**: Leverage uploaded **Source Maps** to translate minified, compiled JavaScript (`bundle.min.js:1:3402`) back to the exact line, column, and variable names in the original TypeScript source code (`src/services/billing.ts:42`).
3. **Capture Forensic Breadcrumbs**: Record a chronological timeline of user actions (button clicks, URL navigations, HTTP network calls, console logs) leading up to the exact millisecond of the crash.
4. **Link Errors to Code Releases**: Identify the exact Git commit SHA that introduced the bug and alert the engineer who authored the commit.

```
                    SENTRY ERROR INTERCEPTION & UNMINIFICATION
                    
 [ User Browser / Node API ] ──► Unhandled Exception Occurs!
                                          │
                                          ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Sentry SDK Interceptor Layer                                │
 │ • Attaches Breadcrumbs (last 20 clicks, DB queries, HTTPs)  │
 │ • Attaches Environment (`production`) & Release (`sha-7f9a`)│
 │ • `beforeSend` Hook: Scrubs Passwords, Credit Cards, PII    │
 └──────────────────────────────┬──────────────────────────────┘
                                │ HTTPS POST (JSON Event)
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Sentry Ingestion Pipeline                                   │
 │ • Matches error to Release `sha-7f9a`                       │
 │ • Looks up private Source Maps in Sentry Artifact Storage   │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Source Map Unminification Engine                            │
 │ `app.min.js:1:1428` ──► `src/controllers/order.ts:Line 84`  │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Alert Trigger & Notification Hub                            │
 │ • Slack: "#alerts-prod: TypeError in order.ts (12 users)"   │
 │ • PagerDuty: Page On-Call Engineer                          │
 └─────────────────────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Without an automated error tracking platform, software engineering teams suffer from severe operational blindness:

1. **The Silent Failure Dilemma**: 95% of users who encounter a broken checkout button or a white screen of death do not submit support tickets; they simply leave your website and purchase from a competitor.
2. **The "Uncaught Error at a.b (bundle.min.js:1)" Nightmare**: Modern production frontends deploy minified, tree-shaken, mangled JavaScript bundles to optimize bandwidth. A raw browser error in production is completely unreadable without source map translation.
3. **Reproducibility Dead-Ends**: A customer reports: *"The app crashed when I clicked checkout."* Without a recorded timeline of preceding HTTP requests, state changes, and network response status codes, developers waste hours attempting to guess the reproduction steps.
4. **Log Search Exhaustion**: Sifting through 50GB of Elasticsearch log streams to locate an intermittent NullPointerException during an active production outage wastes critical minutes of incident response time.

---

## 3. Mental Model
Think of Sentry like a smart crash investigator at a modern automobile proving ground:
- A simple log is like discovering tire tracks on the road after a car has already crashed: you know something happened, but you don't know why.
- **Sentry** is the active high-speed camera, onboard telemetry recorder, and crash sensor:
  - It records the driver's steering input, pedal pressure, and speed for the 30 seconds before the crash (Breadcrumbs).
  - It deploys an instant alert to emergency dispatch (Slack/PagerDuty).
  - It inspects the car's vehicle identification number (Release Commit SHA) to determine which manufacturing batch had the defective brake line.

---

## 4. Basic Example: Sentry Initialization

```typescript
// basic-sentry.ts
import * as Sentry from '@sentry/node';

Sentry.init({
  dsn: 'https://examplePublicKey@o0.ingest.sentry.io/0',
  environment: process.env.NODE_ENV || 'production',
  release: 'my-app@' + process.env.GIT_COMMIT_SHA,
  tracesSampleRate: 1.0, // Capture 100% of transactions for performance tracing
});

try {
  riskyBusinessLogic();
} catch (error) {
  // Explicit exception capture with custom forensic tags
  Sentry.captureException(error, {
    tags: { section: 'checkout_engine' },
    extra: { orderId: 'ord_98432' },
  });
}
```

---

## 5. Real Example: Full-Stack Sentry Setup (Backend Express + Frontend React)

### A. Backend Express Setup with PII Scrubbing & Distributed Tracing
```typescript
// server.ts
import express from 'express';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

const app = express();

// 1. Initialize Sentry BEFORE any other middlewares or routes
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV || 'development',
  release: process.env.COMMIT_SHA,
  integrations: [
    // Automatically instruments Express routes and HTTP client requests
    new Sentry.Integrations.Http({ tracing: true }),
    new Sentry.Integrations.Express({ app }),
    nodeProfilingIntegration(),
  ],
  // Performance Monitoring: Sample 20% of production traffic to manage quotas
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
  profilesSampleRate: 0.1, // Profile 10% of sampled transactions

  // 2. DEFENSIVE PRIVACY HOOK: Scrub Passwords, Tokens and PII before transmission
  beforeSend(event) {
    // Drop health check errors to prevent alert noise
    if (event.request?.url?.includes('/health/')) {
      return null;
    }

    // Scrub sensitive headers
    if (event.request?.headers) {
      delete event.request.headers['authorization'];
      delete event.request.headers['cookie'];
      delete event.request.headers['x-api-key'];
    }

    // Scrub sensitive body fields
    if (event.request?.data && typeof event.request.data === 'object') {
      const sensitiveKeys = ['password', 'token', 'creditCard', 'cvv'];
      for (const key of sensitiveKeys) {
        if (key in event.request.data) {
          event.request.data[key] = '[REDACTED]';
        }
      }
    }

    return event;
  },
});

// The request handler must be the first middleware on the app
app.use(Sentry.Handlers.requestHandler());
// TracingHandler creates a trace for every incoming request
app.use(Sentry.Handlers.tracingHandler());

app.use(express.json());

// Set user context securely (id only, never raw email or billing info!)
app.use((req, res, next) => {
  if (req.user) {
    Sentry.setUser({
      id: req.user.id,
      ip_address: undefined, // Never capture raw user IP addresses!
    });
  }
  next();
});

// Primary Business Route
app.post('/api/v1/orders', async (req, res) => {
  // Breadcrumbs: Manually record important domain checkpoints
  Sentry.addBreadcrumb({
    category: 'order',
    message: `Reserving inventory for order ${req.body.orderId}`,
    level: 'info',
  });

  throw new Error('Database deadlock encountered during inventory lock!');
});

// The error handler must be before any other error middleware and after all controllers
app.use(Sentry.Handlers.errorHandler());

// Optional fallthrough error handler
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  res.status(500).json({ error: 'Internal Server Error', errorId: res.sentry });
});
```

### B. Frontend React Error Boundary with Sentry Fallback
```tsx
// ErrorBoundary.tsx
import React from 'react';
import * as Sentry from '@sentry/react';

interface Props {
  children: React.ReactNode;
}

export const GlobalErrorBoundary: React.FC<Props> = ({ children }) => {
  return (
    <Sentry.ErrorBoundary
      fallback={({ error, resetError, eventId }) => (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <h2>Oops! Something went wrong.</h2>
          <p>Our engineering team has been notified automatically.</p>
          <p style={{ color: '#888', fontSize: '0.8rem' }}>Error Reference ID: {eventId}</p>
          <button
            onClick={() => {
              // Sentry User Feedback Dialog allowing users to submit crash context
              Sentry.showReportDialog({ eventId });
            }}
          >
            Report Problem
          </button>
          <button onClick={() => resetError()}>Try Again</button>
        </div>
      )}
      beforeCapture={(scope) => {
        scope.setTag('boundary', 'root_application');
      }}
    >
      {children}
    </Sentry.ErrorBoundary>
  );
};
```

---

## 6. Under the Hood: Source Maps & Fingerprint Grouping

### A. How Source Map Unminification Works (V3 Format)
Modern build tools compile TypeScript into single-line minified files:
```javascript
// Compiled bundle.min.js:
function e(t,n){return t.charge(n)}e(stripe,500);
```
When an exception occurs, the browser stack trace points to `bundle.min.js:1:38`.
1. The build pipeline generates a **Source Map (`bundle.min.js.map`)** containing a VLQ (Variable-Length Quantity) encoded mapping matrix:
   `"mappings": "AAAA,SAASA,EAAEC,EAAGC,GAAK..."`
2. During CI/CD, the `@sentry/cli` uploads these map files directly to Sentry’s private storage and associates them with the release (e.g., `v1.4.2`).
3. When Sentry receives an error, it looks up the file and maps the exact line and column back to:
   `src/services/billing.ts: Line 42: const charge = await stripe.charges.create(...)`.

### B. Sentry Fingerprinting & Issue Grouping
If 10,000 users encounter the same database timeout, you do not want 10,000 separate alerts. Sentry computes an **Issue Fingerprint**:
```
Fingerprint = Hash(Error Class + Normalized Stack Trace Function Names)
```
- Line numbers and memory addresses are stripped because they change across builds.
- Dynamic error message variables (e.g., `"User 42 failed"` vs `"User 99 failed"`) are normalized using regex patterns so that both crash instances map to the exact same Issue in the dashboard.

---

## 7. Important Rules

1. **NEVER Upload Source Maps to Public Production CDNs**:
   Publicly serving `.map` files (e.g., `https://cdn.mycompany.com/bundle.js.map`) exposes your entire uncompiled source code, internal comments, architectural design, and secret file paths to any curious user or attacker. Always configure build tools to output source maps locally, upload them privately to Sentry via CI/CD, and delete them before pushing the public web assets to your CDN.
2. **Never Send Un-Redacted PII (`sendDefaultPii: false`)**:
   By default, keep `sendDefaultPii` disabled. Explicitly scrub user IP addresses, email addresses, and passwords in the `beforeSend` hook to maintain strict GDPR, HIPAA, and CCPA regulatory compliance.
3. **Configure Transaction Sampling Rates in Production**:
   Setting `tracesSampleRate: 1.0` in high-traffic applications handling 10,000 requests/sec will send 10,000 performance transaction payloads to Sentry every second, exhausting your monthly Sentry bill in a few hours. Set sampling to 5% to 20% in production (`tracesSampleRate: 0.1`).

---

## 8. Common Mistakes & Anti-Patterns

### 1. Initializing Sentry After Route Handlers
```typescript
// ❌ FATAL ANTI-PATTERN:
const app = express();
app.use('/api', routes); // Defined BEFORE Sentry!
Sentry.init({ ... });
```
**Why it fails**: Sentry works by monkey-patching Node.js HTTP modules, Express router prototypes, and global exception handlers. If initialized after route definitions, Sentry cannot intercept incoming requests, capture route execution durations, or trace errors. Always initialize Sentry on line 1 of your application.

### 2. Swallowing Errors in Silent `catch` Blocks
```typescript
// ❌ SILENT FAILURE:
try {
  await processPayment();
} catch (err) {
  // Developer caught the error but forgot to report it or rethrow!
  console.log('Payment failed'); 
}
```
**Impact**: Sentry never hears about the error; developers remain completely unaware that customers are unable to complete payments.
**Fix**: Call `Sentry.captureException(err)` inside the catch block if not re-throwing.

---

## 9. Best Practices

- **Automate Release Association in CI/CD**:
  Tag every build with the current Git commit SHA (`git rev-parse HEAD`). This allows Sentry to automatically link crashes to the exact commit, identify regression bugs ("This issue was marked resolved in v1.2, but regressed in v1.4!"), and notify the specific author of the commit via GitHub integration.
- **Enrich Errors with Context Tags**:
  Add high-value categorical tags: `scope.setTag('tenant_plan', 'enterprise')`, `scope.setTag('region', 'eu-west-1')`. This enables SREs to filter: *"Is this error only affecting European enterprise customers?"*

---

## 10. Performance Considerations

- **Non-Blocking Asynchronous Transport**: Sentry's client SDKs buffer events in memory and transmit them asynchronously over persistent HTTP/2 connections using background worker pools. Exception capture does not block the primary Node.js event loop or client UI thread.
- **Local Event Rate Limiting**: If a recurring bug in a tight loop throws 5,000 exceptions per second, Sentry's SDK automatically throttles transmission to prevent network bandwidth saturation on the client.

---

## 11. Security Considerations

- **Keep DSN Keys Restricted**: Sentry Data Source Names (DSNs) are safe to expose in frontend code, but configure domain whitelisting (Allowed Domains) in the Sentry dashboard to prevent malicious actors from spamming your DSN from unauthorized external domains.
- **Data Scrubbing Rules in Sentry Dashboard**: In addition to client-side `beforeSend` scrubbing, configure server-side data scrubbing rules in the Sentry organization settings as a defense-in-depth safeguard against accidental PII ingestion.

---

## 12. Alternatives

| Error Tracking Tool | Best Suited For | Key Differentiator |
|---|---|---|
| **Sentry** | Full-Stack Web (React, Next.js, Node) | Open-source core; unrivaled source map unminification & breadcrumbs. |
| **Bugsnag** | Mobile & Desktop Applications | Native iOS/Android crash symbolication and stability scores. |
| **Datadog Error Tracking**| Enterprise Datadog Shops | Unified within Datadog APM, metrics, and log pipelines. |
| **Rollbar** | Legacy Web Applications | Real-time grouping and automated rollbacks. |

---

## 13. Trade-offs

- **Client-Side Sentry Bundle Size vs. Observability**:
  Including `@sentry/browser` or `@sentry/react` adds $\approx 25\text{KB}$ (gzipped) to your frontend JavaScript bundle. For extreme micro-bundle applications, this is a non-trivial footprint, but the trade-off of gaining real-time production crash visibility with breadcrumbs overwhelmingly justifies the weight.
- **High-Frequency Performance Tracing vs. Cost**:
  Tracing every database query, Redis get, and HTTP fetch provides deep APM insights, but consumes substantial event quotas. Sampling rates must be actively managed based on traffic volume.

---

## 14. Real-World Usage & Implementation Example: Automated CI/CD Source Maps Upload

Here is a complete **GitHub Actions Workflow** demonstrating how to compile a Next.js / TypeScript application, upload private source maps to Sentry, and purge maps before deploying to production:

```yaml
# .github/workflows/deploy-sentry.yml
name: Build and Upload Sentry Source Maps

on:
  push:
    branches: [ main ]

jobs:
  build-and-release:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4
        with:
          fetch-depth: 0 # Full Git history for commit tracking

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Build Application with Source Maps Enabled
        run: npm run build
        env:
          NODE_ENV: production
          COMMIT_SHA: ${{ github.sha }}

      - name: Create Sentry Release & Upload Source Maps
        uses: getsentry/action-release@v1
        env:
          SENTRY_AUTH_TOKEN: ${{ secrets.SENTRY_AUTH_TOKEN }}
          SENTRY_ORG: 'my-company-org'
          SENTRY_PROJECT: 'core-frontend'
        with:
          environment: 'production'
          version: ${{ github.sha }}
          sourcemaps: './.next/static'
          ignore_missing: true

      - name: DELETE Source Maps from Public Distribution Folder!
        # Critical Security Step: Ensure raw source maps never touch public CDN!
        run: |
          echo "Purging .map files from public output directory..."
          find ./.next/static -name "*.map" -type f -delete
          echo "Source maps successfully purged from public deployment artifact."

      - name: Deploy to Cloudflare Pages / Vercel / S3
        run: |
          echo "Deploying clean, un-mappable assets to production CDN..."
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: What is a Source Map, and why is it mandatory for frontend production error monitoring?
**Answer**:
A Source Map is a JSON file that provides a cryptographic mapping between compiled, minified, and obfuscated production JavaScript code and the original author-written TypeScript/ES6 source files. 
In production, code is minified into single-line files with mangled variable names (`function a(b,c){...}`) to reduce network download size. When an error occurs in the browser, the browser's stack trace points to unreadable positions like `bundle.min.js:1:4921`. Sentry uses the uploaded source map to translate this location back to the exact file, line number, and function in your source code (`src/components/Checkout.tsx: Line 45`), making debugging possible.

### 2. Conceptual: Explain how Sentry captures "Breadcrumbs", and why they are invaluable for debugging.
**Answer**:
Breadcrumbs are a chronological circular buffer of preceding application events leading up to a crash. Sentry automatically hooks into browser and Node.js APIs to record:
1. **DOM Events**: Button clicks, form submissions, and input focus changes.
2. **Network Calls**: Outgoing `fetch` and `XMLHttpRequest` endpoints, status codes, and latencies.
3. **Navigation**: URL route changes and browser history state pushes.
4. **Console Logs**: `console.log`, `warn`, and `info` messages.
When an exception occurs, Sentry attaches the last 50–100 breadcrumbs to the crash payload. Developers can see the exact sequence of steps the user took immediately prior to the crash, making intermittent bugs trivial to reproduce.

### 3. Implementation: How do you prevent sensitive user information (PII) from being transmitted to Sentry?
**Answer**:
1. **Client-Side `beforeSend` Callback**: Implement the `beforeSend(event)` lifecycle hook in `Sentry.init()`. Inspect the event payload and sanitize headers (strip `Authorization`, `Cookie`), delete sensitive request body fields (`password`, `creditCard`), and nullify user IP addresses (`event.user.ip_address = undefined`).
2. **Class-Level Data Masking**: Use Sentry’s `@sentry/react` DOM masking features: add the CSS class `sentry-mask` or attribute `data-sentry-mask` to sensitive UI elements (e.g., bank account numbers) so text is replaced with `***` before breadcrumbs are captured.
3. **Server-Side Scrubbing Rules**: Enable Sentry's automated server-side PII scrubbing in the dashboard to strip credit card numbers (Luhn algorithm matches) and common password patterns as a secondary safeguard.

### 4. Debugging: After a production deployment, Sentry displays errors with raw minified stack traces (`bundle.min.js:1:3402`). How do you fix this?
**Answer**:
This indicates that **Sentry cannot match the incoming error event to an uploaded source map**:
1. **Release Mismatch**: Verify that the `release` string configured in `Sentry.init({ release: 'sha-xxx' })` **exactly matches** the release version specified during the CI/CD `@sentry/cli releases files upload` command. If the app reports release `v1.2` but source maps were uploaded under `v1.2.0`, Sentry cannot correlate them.
2. **URL Prefix Mismatch**: Ensure the uploaded artifact path matches the URL the browser requests. If the browser loads `https://cdn.com/assets/app.js`, Sentry needs source maps uploaded with `--url-prefix '~/assets'`.
3. **Verify Upload Artifacts**: Go to Sentry Dashboard $\rightarrow$ Project Settings $\rightarrow$ Source Maps to verify that the `.map` files are present and match the release SHA.

### 5. Scenario: What is Error Fingerprinting in Sentry, and when would you customize it?
**Answer**:
Fingerprinting is the algorithm Sentry uses to group individual error occurrences into a single consolidated Issue. By default, Sentry hashes the error type and stack trace function names.
**When to customize**:
- **Generic Database Errors**: If multiple different database queries fail with `DatabaseQueryError: Connection Timeout`, Sentry might group them into one issue even though they originate from completely different queries.
- **Custom Fingerprint Rule**:
  ```typescript
  scope.setFingerprint(['database-timeout', queryType, tableName]);
  ```
  This forces Sentry to create distinct issues for checkout query timeouts vs analytics query timeouts, allowing teams to route tickets to the correct backend owners.

### 6. Advanced: How does Sentry achieve distributed tracing between a React frontend and an Express backend?
**Answer**:
Sentry uses the **W3C Trace Context standard**:
1. When the React frontend makes a `fetch()` or `axios` call to the backend API, the Sentry browser SDK intercepts the request and injects two HTTP headers:
   - `sentry-trace`: Contains `trace_id-span_id-sampled` (e.g., `4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-1`).
   - `baggage`: Carries metadata like release, environment, and transaction name.
2. The Express backend’s `Sentry.Handlers.tracingHandler()` extracts these headers from the incoming request.
3. The backend spans are bound as children of the frontend root trace.
4. If an unhandled exception occurs on the backend, Sentry links the backend crash report directly to the user’s frontend session trace in a unified timeline.

---

## 16. Coding Questions & Practical Challenges

1. **Custom Sentry Scrubbing Function**: Write a TypeScript utility function for Sentry's `beforeSend` hook that recursively traverses an object and replaces any value whose key matches a regex of sensitive terms (`/pass|token|secret|cvv|card/i`) with `[REDACTED]`.
2. **React Error Boundary with Recovery**: Write a custom React Error Boundary using `@sentry/react` that catches render crashes, increments a local retry counter, and attempts an automatic component reload once before displaying the fallback crash UI.
3. **Sentry CLI Automated Release Script**: Write a Bash script utilizing `@sentry/cli` that creates a new release, associates Git commits using `--auto`, uploads source maps from `dist/`, and marks the release as finalized.

---

## 17. Common Interview Traps

- **Trap 1: Believing Sentry is only for client-side JavaScript**: Sentry provides first-class SDKs across all backend languages (Node.js, Python, Go, Java, Rust) and mobile platforms. Utilizing Sentry full-stack enables distributed tracing across frontend and backend tiers.
- **Trap 2: Leaving `debug: true` enabled in production Sentry initialization**: Setting `debug: true` causes Sentry to print verbose internal diagnostic logs to the browser console or Node.js stdout on every breadcrumb and event transmission, degrading performance and leaking internal details.
- **Trap 3: Uploading source maps without deleting them from production CDN buckets**: Uploading source maps to Sentry is correct, but failing to remove them from public build outputs leaves your original TypeScript source code accessible to anyone who requests `app.js.map` over the public web.

---

## 18. Revision Summary

- **Core Functionality**: Proactive error interception $\rightarrow$ Source map unminification $\rightarrow$ Breadcrumb forensic capture $\rightarrow$ Issue grouping via fingerprinting $\rightarrow$ Real-time alerting.
- **Privacy First**: Always scrub passwords, authorization headers, and user IPs in the `beforeSend` hook.
- **Source Map Security**: Generate source maps during CI/CD build, upload privately to Sentry using `@sentry/cli`, and purge `.map` files from public web distributions.
- **Distributed Tracing**: Propagate `sentry-trace` and `baggage` headers from frontend fetch requests to backend Express handlers for unified end-to-end trace correlation.

---

## 19. Quick Reference Cheatsheet

```bash
# Sentry CLI Source Map Upload Workflow
# 1. Create a new release linked to Git commit
sentry-cli releases new "$COMMIT_SHA"

# 2. Associate Git commits to the release
sentry-cli releases set-commits "$COMMIT_SHA" --auto

# 3. Upload source maps and specify URL prefix
sentry-cli releases files "$COMMIT_SHA" upload-sourcemaps ./dist --url-prefix '~/dist'

# 4. Finalize the release
sentry-cli releases finalize "$COMMIT_SHA"

# 5. Clean up local source maps before deploying public assets!
rm -f ./dist/*.map
```
