# API Versioning, Breaking Changes, and Deprecation Strategies

## 1. What is it?
API Versioning is the engineering practice of managing changes to public or internal API interfaces over time, ensuring that updates, bug fixes, and feature additions do not break existing client applications (mobile apps, web frontends, third-party integrations). Four primary versioning paradigms exist in production:
1. **URI Path Versioning:** Embedding the major version directly in the URL path (e.g. `https://api.example.com/v1/users`).
2. **Query Parameter Versioning:** Appending the version in query strings (e.g. `https://api.example.com/users?version=1`).
3. **Custom Request Header Versioning:** Transmitting the version via a dedicated header (e.g. `X-API-Version: 2026-03-15`).
4. **Content Negotiation / Accept Header Versioning:** Utilizing the `Accept` MIME header with vendor-specific media types (e.g. `Accept: application/vnd.company.v2+json`).

```
+-------------------------------------------------------------------------------+
|                       API VERSIONING STRATEGY COMPARISON                      |
+-------------------+---------------------------+---------------+---------------+
| Strategy          | Example Syntax            | Discoverability| CDN Cacheable |
+-------------------+---------------------------+---------------+---------------+
| 1. URI Path       | `/api/v1/orders`          | Highest       | Native (Easy) |
| 2. Custom Header  | `X-API-Version: 2`        | Medium        | Needs Vary    |
| 3. Accept Header  | `Accept: application/vnd..`| Lowest        | Needs Vary    |
| 4. Query Param    | `/orders?version=1`       | High          | Native        |
+-------------------+---------------------------+---------------+---------------+
```

---

## 2. Why does it exist?
Unlike web applications where the server can force-refresh all client browsers to the newest HTML/JS bundle, native mobile applications (iOS / Android) and external B2B clients cannot be forced to update immediately:
- A user may run an outdated version of your iOS app for 2 years without opening the App Store.
- If the backend renames a JSON response field from `userName` to `username` or removes an endpoint, older mobile apps crash immediately on boot.
- B2B API integrations cannot endure unexpected breaking changes without violating Service Level Agreements (SLAs).

Versioning establishes clear contracts that allow backends to evolve rapidly while guaranteeing zero downtime and backward compatibility for legacy clients.

---

## 3. Mental Model
Think of API Versioning as **Electrical Power Outlets and Plugs**:
- In the United States, electrical outlets use the Type A/B plug standard (API v1).
- When engineers develop a higher-voltage industrial socket (API v2), they do NOT go into every home in the country and rip the old sockets out of the walls overnight. Doing so would destroy every refrigerator and television set.
- Instead, they keep the Type A/B sockets active and install the new industrial sockets in new buildings, or provide universal dual-socket wall plates (Multi-version routing).
- They publish an official retirement notice 3 years in advance (`Sunset` header) before decommissioning the old voltage line.

---

## 4. Basic Example

### Breaking vs. Non-Breaking Changes

#### Non-Breaking Changes (Do NOT Require a New Major Version):
- Adding a **new endpoint** (`POST /api/v1/refunds`).
- Adding an **optional query parameter** (`?sort=asc`).
- Adding a **new field to a response body** (`{ id: 1, name: "Alice", isVerified: true }`). *Note: Clients should always be resilient to new unexpected fields.*

#### Breaking Changes (STRICTLY Require a New Major Version):
- Removing an endpoint (`DELETE /api/v1/legacy-auth`).
- Renaming or removing an existing response field (Renaming `full_name` to `name`).
- Changing a field's data type (Changing `id: number` to `id: string`).
- Adding a **mandatory required field** to a request body (Making `phoneNumber` required on user registration).
- Changing HTTP status codes (Changing `201 Created` to `200 OK`).

---

## 5. Real Example

### Standardized Sunset and Deprecation Headers in Express
```typescript
// middleware/deprecationMiddleware.ts
import { Request, Response, NextFunction } from 'express';

interface DeprecationConfig {
  deprecatedOn: string;    // Date string: "2026-01-01"
  sunsetDate: string;      // RFC 1123 Date: "Wed, 11 Nov 2026 00:00:00 GMT"
  migrationDocUrl: string; // URL pointing to migration guide
}

export function deprecateVersion(config: DeprecationConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    // 1. Deprecation Header (RFC draft: boolean or date)
    res.setHeader('Deprecation', `@${Math.floor(new Date(config.deprecatedOn).getTime() / 1000)}`);

    // 2. Sunset Header (RFC 8594: Mandatory date when endpoint will be permanently terminated)
    res.setHeader('Sunset', config.sunsetDate);

    // 3. Link Header referencing migration documentation
    res.setHeader('Link', `<${config.migrationDocUrl}>; rel="deprecation"; type="text/html"`);

    next();
  };
}
```

```typescript
// routes/v1/userRoutes.ts
import { Router } from 'express';
import { deprecateVersion } from '@/middleware/deprecationMiddleware';

const v1Router = Router();

// Mark entire v1 users endpoint as deprecated
v1Router.use(
  deprecateVersion({
    deprecatedOn: '2026-01-15',
    sunsetDate: 'Thu, 01 Oct 2026 00:00:00 GMT',
    migrationDocUrl: 'https://docs.myapi.com/migrations/v1-to-v2',
  })
);

v1Router.get('/users/:id', (req, res) => {
  // Legacy v1 response format
  res.json({
    data: {
      userId: req.params.id,
      user_full_name: 'Alex Mercer', // Legacy snake_case format
    },
  });
});

export default v1Router;
```

---

## 6. Under the Hood

### 1. Stripe's Date-Based Versioning Model
Stripe employs what is considered the most sophisticated API versioning architecture in the software industry:
- **No `/v1` or `/v2` in the URL!** All requests hit `/v1/charges`.
- The user account has a pinned version in the database (e.g. `2020-08-27`).
- API requests can override this via a header: `Stripe-Version: 2024-04-10`.
- **Under the Hood:** Stripe's backend code always executes against the **latest, bleeding-edge master data model**.
- When returning a response, it passes the data through an automated chain of **backward-compatibility transformers** (version gates) that translate the modern model back to the exact shape expected by the client's pinned date version!

### 2. CDN Caching with Header Versioning
When using Header or Accept versioning (`X-API-Version: 2`):
- CDNs (Cloudflare, CloudFront) cache responses by default using **only the URL**.
- If Client A requests `/orders` with `X-API-Version: 1` and the CDN caches it, Client B requesting `/orders` with `X-API-Version: 2` receives the cached v1 response!
- **Fix:** You **must** configure the server to emit:
  ```http
  Vary: X-API-Version, Accept
  ```
  This instructs all intermediate CDNs to partition their cache keys by the version header.

---

## 7. Important Rules
1. **URI Path Versioning is the Production Standard:** Unless you have dedicated infrastructure like Stripe, stick to URI Path versioning (`/api/v1/`, `/api/v2/`). It is unambiguous, easily routed by load balancers, and natively cacheable by all CDNs.
2. **Never Version for Minor Additions:** Adding an optional field or new endpoint is non-breaking. Never bump from `v1` to `v2` simply because you added a feature.
3. **Always Set the `Sunset` Header on Deprecated Endpoints:** RFC 8594 formalizes the `Sunset` HTTP header. It informs automated consumer scrapers of the exact moment the endpoint will return `410 Gone`.
4. **Client Defensive Parsing:** All frontend and mobile apps must be built with tolerant JSON parsers (ignoring unknown properties) to ensure that backend additive changes do not trigger client crashes.

---

## 8. Common Mistakes

### Mistake 1: Point-Release Versioning in URLs (`/v1.2/`)
```
❌ BAD:  /api/v1.2/users
✅ GOOD: /api/v1/users
```
**Why:** Only breaking changes warrant a version change. Point releases (bug fixes) should happen transparently under `v1`. Use semantic versioning internally, but expose only the major version in public URLs.

### Mistake 2: Forgetting `Vary` Headers on Header-Versioned APIs
```http
# Missing "Vary: X-API-Version" causes CDN cache poisoning between v1 and v2 clients!
```

---

## 9. Best Practices
1. **Support at Most Two Major Versions Concurrently:** Maintain `v(current)` and `v(previous)`. Never allow legacy tech debt to accumulate by supporting 5 active versions simultaneously.
2. **Provide Migration Documentation:** Every deprecated endpoint must include a `Link` header pointing directly to an upgrade guide.
3. **Automate Deprecation Alerts:** Monitor server logs for incoming requests to deprecated endpoints and send automated warning emails to registered API keys 90, 60, and 30 days before the `Sunset` deadline.

---

## 10. Performance Considerations
- **Load Balancer Layer 7 Path Routing:** URI path versioning allows NGINX, AWS ALB, or Envoy to route `/api/v1` to an older container cluster and `/api/v2` to a modern service cluster without touching application code.
- **Header Parsing Overhead:** Header versioning requires deep packet inspection on every request at the proxy layer, adding minor latency compared to simple URI path matching.

---

## 11. Security Considerations
- **Vulnerabilities in Abandoned Versions:** Attackers specifically target legacy `/v1` endpoints because developers often forget to backport security patches (e.g. rate-limiting, auth fixes) to older routes. Ensure security middleware wraps all versions equally.
- **Sunset Enforcement:** When the sunset date arrives, transition the endpoint to return `410 Gone` rather than `404 Not Found` to signal intentional permanent removal.

---

## 12. Alternatives
- **GraphQL Schema Evolution:** GraphQL advocates for continuous evolution without versioning. Fields are marked `@deprecated(reason: "Use newField")`, and clients query only the fields they support.
- **gRPC Field Number Deprecation:** In Protocol Buffers, fields are never removed; they are marked `reserved` to maintain binary backward compatibility.

---

## 13. Trade-offs

| Versioning Strategy | Pros | Cons |
| :--- | :--- | :--- |
| **URI Path (`/v1/`)** | Highest discoverability; simple CDN caching; easy proxy routing | Pollutes URI; duplicates code if not refactored |
| **Header (`X-Version`)**| Clean URLs; aligns with pure REST | Difficult to test in browser; requires `Vary` CDN setup |
| **Accept Header** | Purest REST implementation | Complex client headers; poor discoverability |
| **Query Param (`?v=1`)** | Easy to test in browser | Clutters search/filter query parameters |

---

## 14. Real-World Usage
- **Twilio & Salesforce REST APIs:** Use URI path versioning (`/2010-04-01/Accounts` or `/services/data/v58.0/`).
- **GitHub REST API:** Historically used Accept header (`Accept: application/vnd.github.v3+json`), transitioned to date-based headers (`X-GitHub-Api-Version: 2022-11-28`).

---

## 15. Placement Interview Questions

### Basic
**Q: What is the difference between a breaking change and a non-breaking change in an API?**  
*Answer:*
- A **Non-breaking change** can be deployed without affecting existing clients (e.g. adding a new endpoint, adding an optional query param, or adding a new field to an existing response).
- A **Breaking change** breaks existing client applications unless they rewrite their code (e.g. removing an endpoint, renaming a field, changing a data type from number to string, or adding a required request body field).

### Conceptual
**Q: Explain how the `Sunset` and `Deprecation` HTTP headers work.**  
*Answer:*
- `Deprecation`: Informs the client that the endpoint or API version is officially deprecated and discouraged from further use.
- `Sunset` (RFC 8594): Specifies an exact future date and time (in HTTP-date format, e.g. `Sunset: Wed, 11 Nov 2026 00:00:00 GMT`) after which the server will permanently terminate and decommission the endpoint (usually returning `410 Gone`).

### Implementation
**Q: How do you configure NGINX to route `/v1` and `/v2` requests to two completely independent upstream backend service clusters?**  
*Answer:*
```nginx
upstream backend_v1 { server 10.0.0.1:4001; }
upstream backend_v2 { server 10.0.0.2:4002; }

server {
    listen 80;
    server_name api.enterprise.com;

    location /v1/ {
        proxy_pass http://backend_v1/;
        proxy_set_header Host $host;
    }

    location /v2/ {
        proxy_pass http://backend_v2/;
        proxy_set_header Host $host;
    }
}
```

### Debugging
**Q: A team switches from URI path versioning (`/v1`) to Header versioning (`X-API-Version: 2`). Suddenly, users report that random clients receive v1 responses while requesting v2. What CDN configuration was missed?**  
*Answer:* The origin server failed to set the `Vary: X-API-Version` response header. By default, CDNs cache responses based solely on the URL path (`/api/orders`). If a v1 request was cached, all subsequent v2 requests to that URL hit the CDN cache and received the v1 payload. Setting `Vary: X-API-Version` tells the CDN to maintain separate cache entries for each unique header value.

### Scenario
**Q: You need to rename a database column from `phone_number` to `mobile_e164` across a platform serving 500,000 mobile app users. You cannot force all users to update their app. What is the migration strategy?**  
*Answer:*
1. Keep the `/v1/users` endpoint active.
2. In the database, perform an additive migration or use an ORM mapping that aliases `mobile_e164` as `phone_number` in the v1 response serializer.
3. Deploy `/v2/users`, returning the new `mobile_e164` field.
4. Add `Deprecation` and `Sunset` headers to `/v1/users` with an 18-month grace period.
5. Release a new mobile app build consuming `/v2`.
6. Decommission `/v1` only after mobile telemetry shows <0.1% traffic on v1.

### Advanced
**Q: Describe Stripe's event-driven backward compatibility translation layer architecture.**  
*Answer:* Stripe maintains a single modern data model in production. Each API version change is codified as an explicit two-way transformer class: a `RequestTransformer` (which translates an older client payload into the modern schema) and a `ResponseTransformer` (which takes the modern response and morphs it back into the historical shape). When an older client with a pinned version date calls the API, the gateway chains all transformers from the client's pinned date up to the present date, processes the request, and reverses the chain on the output.

---

## 16. Coding Questions

### Problem: Implement a Versioned Router Dispatcher in Express
```typescript
// server.ts
import express from 'express';
import v1Routes from './routes/v1';
import v2Routes from './routes/v2';

const app = express();
app.use(express.json());

// 1. URI Path Versioning Mounts
app.use('/api/v1', v1Routes);
app.use('/api/v2', v2Routes);

// 2. Custom Header Fallback Dispatcher for Root Route
app.use('/api/checkout', (req, res, next) => {
  const version = req.headers['x-api-version'];

  res.setHeader('Vary', 'X-API-Version');

  if (version === '2' || version === '2026-03-15') {
    return v2Routes(req, res, next);
  }

  // Default to v1
  return v1Routes(req, res, next);
});

app.listen(3000, () => console.log('Versioned API listening on port 3000'));
```

---

## 17. Common Interview Traps
- **Trap 1:** "Any change to an API requires a new major version."  
  *Truth:* False! Additive changes (new endpoints, new optional fields) are non-breaking and should be deployed under the existing version. Only backward-incompatible modifications require a version bump.
- **Trap 2:** "When deprecating an endpoint, return `404 Not Found` immediately."  
  *Truth:* False. Endpoints must emit `Deprecation` and `Sunset` headers for months in advance, and upon formal retirement return `410 Gone` to signal intentional permanent removal.

---

## 18. Revision Summary
- Four versioning styles: URI Path (`/v1/`), Query Param (`?v=1`), Header (`X-Version`), and Accept Header (`vnd.api.v1+json`).
- Breaking changes (field deletion, renaming, type changes) require a new major version.
- Non-breaking changes (new endpoints, additive optional fields) should remain in the current version.
- Use `Deprecation` and `Sunset` headers (RFC 8594) to communicate endpoint lifecycles.
- Always attach `Vary: <HeaderName>` when using non-URI versioning to prevent CDN cache poisoning.

---

## 19. Quick Reference

```
+--------------------+---------------------------+-----------------------------------------------+
| Versioning Concept | Standard Header / Value   | Operational Meaning                           |
+--------------------+---------------------------+-----------------------------------------------+
| Recommended Style  | /api/v1/resource          | URI Path versioning (easiest to route & cache)|
| Deprecation Notice | Deprecation: @<timestamp> | Marks endpoint as deprecated                  |
| Sunset Expiration  | Sunset: <RFC1123 Date>    | Exact timestamp when endpoint will be killed  |
| Migration Link     | Link: <url>; rel="deprec" | URL pointing to developer migration guide     |
| Retired Status     | 410 Gone                  | Permanently decommissioned endpoint           |
| CDN Multi-Cache    | Vary: X-API-Version       | Prevents version cross-contamination in cache |
+--------------------+---------------------------+-----------------------------------------------+
```
