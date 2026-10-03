# REST Principles, Resource Design, and Richardson Maturity Model

## 1. What is it?
REST (Representational State Transfer) is an architectural style for distributed hypermedia systems, formulated by Roy Fielding in his 2000 doctoral dissertation. It defines six core architectural constraints (Client-Server, Statelessness, Cacheability, Uniform Interface, Layered System, and Code on Demand). The **Richardson Maturity Model (RMM)** breaks down the journey to true RESTful architecture into four progressive levels:
- **Level 0 (The Swamp of POX - Plain Old XML/JSON):** Single URI, single HTTP method (typically POST) used as a remote procedure call (RPC) tunnel (e.g. `/api/endpoint` with `{ "action": "getUser" }`).
- **Level 1 (Resources):** Distinct URIs for individual entities (e.g. `/users/123`, `/orders/456`), but still relying on a single HTTP verb.
- **Level 2 (HTTP Verbs & Status Codes):** Semantic use of standard HTTP methods (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`) and standard HTTP status codes (`200 OK`, `201 Created`, `404 Not Found`).
- **Level 3 (Hypermedia Controls / HATEOAS):** "Hypermedia As The Engine Of Application State" – responses include dynamic links guiding clients on what subsequent actions are legally permissible.

```
+-------------------------------------------------------------------------------+
|                       RICHARDSON MATURITY MODEL (RMM)                         |
+-------------------+-----------------------------------------------------------+
| Level 3: HATEOAS  | Responses include hypermedia link controls (_links)       |
+-------------------+-----------------------------------------------------------+
| Level 2: Verbs    | Semantic HTTP methods (GET/POST/PUT/DELETE) + Status Codes|
+-------------------+-----------------------------------------------------------+
| Level 1: Resources| Multiple URIs (/users/1, /orders/42) instead of RPC tunnel|
+-------------------+-----------------------------------------------------------+
| Level 0: The Swamp| Single endpoint (POST /api/service), RPC method in payload|
+-------------------+-----------------------------------------------------------+
```

---

## 2. Why does it exist?
Before REST and the Richardson Maturity Model became widespread:
- Developers built web APIs using SOAP, XML-RPC, or arbitrary POST endpoints where every company invented their own non-standard request/response envelopes.
- CDNs and intermediate web proxies could not cache data because every request was an opaque `POST /service` with a custom body.
- Clients were tightly coupled to server implementation details, breaking whenever backend procedures changed names.

Adopting REST principles standardizes the Web: caching proxies work automatically, HTTP verbs convey intent universally, and resource URIs make distributed systems predictable.

---

## 3. Mental Model
Think of REST Levels as **Progressive Stages of a Modern Restaurant Experience**:
- **Level 0 (The Generic Front Desk):** You walk up to one window and hand a letter saying "Please bring me coffee." The clerk responds with another letter saying "Here is coffee." Everything uses one window.
- **Level 1 (Specialized Counters):** The restaurant creates distinct counters: a Salad Counter (`/salads`), a Beverage Bar (`/drinks`), and a Grill (`/steaks`). You visit the specific counter for the resource you want.
- **Level 2 (Standardized Hand Signals / Verbs):** At the Beverage Bar, you don't talk; you show standard hand signals: Point to inspect (`GET`), Thumbs up to order new (`POST`), Hand swap to replace (`PUT`), Finger swipe to cancel (`DELETE`). The bartender returns standard color-coded receipts (200 Green, 404 Yellow, 500 Red).
- **Level 3 (The Interactive Digital Menu - HATEOAS):** The receipt arrives with interactive digital QR codes: "Click here to pay bill", "Click here to cancel within 5 mins", "Click here to leave a tip". The client doesn't need to memorize where to go next; the response tells them!

---

## 4. Basic Example

### Level 0 RPC vs. Level 2 RESTful Resource Design
```typescript
// ❌ LEVEL 0 RPC (The Swamp): Single URI, arbitrary actions in body
// POST /api/v1/customerService
// Body: { "action": "deleteUser", "userId": "usr_99" }
// Response: { "status": "success", "code": 0 }

// ✅ LEVEL 2 REST (Resource-Oriented URI + HTTP Verb + Semantic Status):
// DELETE /api/v1/users/usr_99
// Response: HTTP 204 No Content (Empty body)
```

---

## 5. Real Example

### Level 3 RESTful API with HATEOAS Hypermedia Links (HAL Specification)
```typescript
// Express / Node.js Route Handler emitting HAL-compliant HATEOAS response
import { Request, Response } from 'express';

interface Order {
  id: string;
  status: 'PENDING_PAYMENT' | 'PAID' | 'SHIPPED' | 'CANCELLED';
  totalCents: number;
  customerId: string;
}

export async function getOrderHandler(req: Request, res: Response) {
  const orderId = req.params.id;

  // Mock order retrieval
  const order: Order = {
    id: orderId,
    status: 'PENDING_PAYMENT',
    totalCents: 4999,
    customerId: 'cust_842',
  };

  // Construct Hypermedia Controls (HATEOAS)
  const baseUrl = `${req.protocol}://${req.get('host')}/api/v1`;

  const hateoasLinks: Record<string, { href: string; method: string }> = {
    self: { href: `${baseUrl}/orders/${order.id}`, method: 'GET' },
    customer: { href: `${baseUrl}/customers/${order.customerId}`, method: 'GET' },
  };

  // State-Dependent Hypermedia Transitions:
  if (order.status === 'PENDING_PAYMENT') {
    hateoasLinks.pay = { href: `${baseUrl}/orders/${order.id}/payments`, method: 'POST' };
    hateoasLinks.cancel = { href: `${baseUrl}/orders/${order.id}`, method: 'DELETE' };
  } else if (order.status === 'PAID') {
    hateoasLinks.refund = { href: `${baseUrl}/orders/${order.id}/refunds`, method: 'POST' };
    hateoasLinks.track = { href: `${baseUrl}/orders/${order.id}/tracking`, method: 'GET' };
  }

  return res.status(200).json({
    data: {
      id: order.id,
      status: order.status,
      totalAmountFormatted: `$${(order.totalCents / 100).toFixed(2)}`,
    },
    _links: hateoasLinks,
  });
}
```

---

## 6. Under the Hood

### 1. Roy Fielding's 6 Constraints
1. **Client-Server:** Separation of user interface concerns from data storage concerns.
2. **Stateless:** Each request from client to server must contain all the contextual information necessary to understand and complete the request. The server stores no client session context between requests.
3. **Cacheable:** Responses must explicitly label themselves as cacheable or non-cacheable (`Cache-Control: max-age=...`) to prevent stale data while maximizing CDN reuse.
4. **Uniform Interface:** The cornerstone of REST:
   - Resource identification in requests (URIs).
   - Manipulation of resources through representations (JSON/XML).
   - Self-descriptive messages (MIME types, headers).
   - Hypermedia as the engine of application state (HATEOAS).
5. **Layered System:** The client cannot ordinarily tell whether it is connected directly to the end server or to an intermediary (load balancer, cache, reverse proxy).
6. **Code on Demand (Optional):** Servers can temporarily extend client functionality by transferring executable code (e.g. JavaScript scripts).

---

## 7. Important Rules
1. **Use Plural Nouns for Resources:** Always use plural nouns for collections (`/users`, `/orders`, `/products`), not verbs (`/getUsers`, `/createOrder`).
2. **Nest Resources to Express Relationships:** Represent hierarchies cleanly:
   - `/departments/42/employees` (All employees in department 42).
   - `/posts/10/comments/3` (Comment 3 under post 10).
   - Avoid nesting deeper than 2 levels (e.g. avoid `/a/1/b/2/c/3/d/4`); flatten deep resources to `/comments/3`.
3. **HTTP Verbs Must Obey Semantics:** Never perform mutations in `GET` requests (e.g. `/users/delete?id=5` is a severe REST violation).
4. **Use Query Parameters for Filtering and Sorting:** Never put filtering criteria in path segments (`/users/active` is bad; `/users?status=active` is RESTful).

---

## 8. Common Mistakes

### Mistake 1: Embedding Actions/Verbs in URI Paths
```
❌ BAD:
POST /api/createUser
POST /api/updateUser/123
POST /api/deleteUser/123

✅ RESTFUL:
POST   /api/users        (Create)
PATCH  /api/users/123    (Partial Update)
DELETE /api/users/123    (Remove)
```

### Mistake 2: Returning HTTP 200 for Errors
```json
// ❌ THE "200 OK WITH ERROR" ANTI-PATTERN:
HTTP/1.1 200 OK
{
  "success": false,
  "errorCode": 404,
  "message": "User record not found"
}
```
**Fix:** Always return the correct HTTP status code (`HTTP/1.1 404 Not Found`).

---

## 9. Best Practices
1. **Consistent Plural Resource Naming:** Use `/api/v1/articles` rather than `/api/v1/article`.
2. **Use Sub-Resources for State Transitions:** For non-CRUD business actions, model the action as a sub-resource or state transition:
   - Instead of `POST /users/123/activate`, use:
     `PATCH /users/123` with `{ "status": "ACTIVE" }` or `POST /users/123/activations`.
3. **Provide Links for Pagination (`_links.next`, `_links.prev`):** Include full navigational URLs in paginated responses to guide client scrapers and UIs.

---

## 10. Performance Considerations
- **CDN Edge Caching:** Level 2 REST APIs leveraging `GET` allow Cloudflare, Fastly, and NGINX to cache responses automatically based on URI keys. RPC endpoints (`POST /api`) bypass CDN caches entirely, forcing every request to hit origin database servers.
- **Fine-Grained Invalidation:** Caching by URI allows targeted cache purging (`DELETE /products/10` immediately purges CDN cache for `/products/10`).

---

## 11. Security Considerations
- **Broken Object Level Authorization (BOLA / IDOR):** In REST APIs with predictable resource IDs (`/documents/1001`), attackers iterate through sequential integers (`1002`, `1003`) to access other tenants' private records. Always verify that the authenticated caller owns the requested resource before returning data, or use non-sequential UUIDs / NanoIDs.
- **HTTP Method Override (X-HTTP-Method-Override):** When dealing with legacy firewall proxies that block `PATCH` or `DELETE`, use `X-HTTP-Method-Override: PATCH` headers over POST securely.

---

## 12. Alternatives
- **GraphQL:** Solves over-fetching and under-fetching by allowing clients to query specific fields via a single `POST /graphql` endpoint; trades off CDN caching and REST simplicity.
- **gRPC / Protocol Buffers:** Binary RPC protocol running over HTTP/2; ideal for high-throughput internal microservice communication, but less accessible for public browser clients.

---

## 13. Trade-offs

| Criterion | Level 2 REST | Level 3 REST (HATEOAS) | GraphQL | gRPC |
| :--- | :--- | :--- | :--- | :--- |
| **Industry Adoption** | **Universal Standard**| Niche / Rare | High (Mobile/Web) | High (Microservices)|
| **CDN Caching** | Native & Easy | Native & Easy | Difficult (POST) | None |
| **Client Decoupling** | Medium | Highest (Dynamic Links)| High | Low (Schema lock) |
| **Payload Size** | Standard JSON | Slightly larger (_links)| Minimal (Requested fields)| Tiny (Binary Protobuf)|

---

## 14. Real-World Usage
- **GitHub REST API v3:** Widely considered the gold standard of Level 2/3 REST APIs. Uses resource-oriented URIs, comprehensive HTTP status codes, and hypermedia links (`url`, `html_url`, `commits_url`).
- **PayPal / Stripe APIs:** Extensive use of hypermedia links (`links.href`, `links.rel`) in payment intents to instruct merchant frontends where to redirect customers for 3D-Secure authentication.

---

## 15. Placement Interview Questions

### Basic
**Q: What are the four levels of the Richardson Maturity Model?**  
*Answer:*
- Level 0: The Swamp of POX (Single endpoint, single HTTP verb, RPC style).
- Level 1: Resources (Multiple individual URIs, e.g. `/users/1`, `/orders/2`).
- Level 2: HTTP Verbs & Status Codes (Semantic use of `GET`, `POST`, `PUT`, `DELETE` and proper status codes `200`, `201`, `404`).
- Level 3: Hypermedia Controls / HATEOAS (Responses provide dynamic hypermedia links guiding clients to valid subsequent actions).

### Conceptual
**Q: What does HATEOAS stand for, and what problem does it solve?**  
*Answer:* HATEOAS stands for "Hypermedia As The Engine Of Application State". It solves client-server coupling by ensuring the server returns links to legal next actions alongside resource data. The client does not need to hardcode business logic URLs; it simply follows links provided in the response payload.

### Implementation
**Q: How do you design a RESTful endpoint to handle a user cancelling an existing flight reservation?**  
*Answer:* Either use `DELETE /api/v1/reservations/{reservationId}` (if the record is soft-deleted or removed), or use `PATCH /api/v1/reservations/{reservationId}` with payload `{ "status": "CANCELLED" }`, or model it as a sub-resource: `POST /api/v1/reservations/{reservationId}/cancellations`. Return `200 OK` or `204 No Content`.

### Debugging
**Q: A backend developer implemented an API where deleting an item is requested via `GET /api/items/delete?id=5`. What critical bugs and vulnerabilities does this cause?**  
*Answer:*
1. **Violates HTTP Semantics:** `GET` must be safe and idempotent (read-only).
2. **Web Crawler Destruction:** Web search crawlers (Googlebot) or browser pre-fetch engines that follow all `<a>` links will trigger mass deletions unintentionally!
3. **CDN Cache Poisoning:** A CDN proxy could cache the `GET` response, serving "Item Deleted" to all subsequent users without ever hitting the origin server again.

### Scenario
**Q: How would you design RESTful URIs for an e-commerce platform that allows users to view, add, and remove items from their shopping cart?**  
*Answer:*
- `GET /api/v1/cart`: View current authenticated user's cart.
- `POST /api/v1/cart/items`: Add an item to the cart (Body: `{ "productId": "p_1", "quantity": 2 }`).
- `PATCH /api/v1/cart/items/{itemId}`: Update quantity of an existing cart item.
- `DELETE /api/v1/cart/items/{itemId}`: Remove an item from the cart.
- `DELETE /api/v1/cart/items`: Empty the entire cart.

### Advanced
**Q: Why do most real-world enterprise REST APIs stop at Level 2 of the Richardson Maturity Model rather than implementing Level 3 (HATEOAS)?**  
*Answer:* While HATEOAS provides theoretical decoupling, it introduces practical complexity: client applications (React, iOS) still need custom UI logic, conditional rendering, and specific components to render those dynamic action buttons. In practice, OpenAPI/Swagger specifications and client SDK generators provide better developer tooling and compile-time type safety than runtime hypermedia link inspection.

---

## 16. Coding Questions

### Problem: Build an Express Controller Complying with Level 2 REST Standards and Status Codes
```typescript
// controllers/articleController.ts
import { Request, Response } from 'express';

interface Article {
  id: string;
  title: string;
  body: string;
}

const articlesDb = new Map<string, Article>();

// POST /api/v1/articles -> 201 Created with Location Header
export function createArticle(req: Request, res: Response) {
  const { title, body } = req.body;

  if (!title || !body) {
    return res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'Fields title and body are required' },
    });
  }

  const id = `art_${Date.now()}`;
  const newArticle: Article = { id, title, body };
  articlesDb.set(id, newArticle);

  res.setHeader('Location', `/api/v1/articles/${id}`);
  return res.status(201).json({ data: newArticle });
}

// GET /api/v1/articles/:id -> 200 OK or 404 Not Found
export function getArticle(req: Request, res: Response) {
  const article = articlesDb.get(req.params.id);

  if (!article) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: `Article with ID ${req.params.id} does not exist` },
    });
  }

  return res.status(200).json({ data: article });
}

// DELETE /api/v1/articles/:id -> 204 No Content
export function deleteArticle(req: Request, res: Response) {
  if (!articlesDb.has(req.params.id)) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Article not found' },
    });
  }

  articlesDb.delete(req.params.id);
  return res.status(204).send(); // 204 No Content has NO response body
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "HATEOAS is mandatory for an API to be called RESTful."  
  *Truth:* While Fielding's pure definition requires hypermedia, the vast majority of production web APIs are Level 2 RESTful APIs (Resources + Verbs + Status Codes), and the industry universally recognizes them as REST APIs.
- **Trap 2:** "PUT and PATCH are interchangeable."  
  *Truth:* False! `PUT` replaces the **entire** resource representation (missing fields become null/default). `PATCH` applies a **partial** delta update (only specified fields are modified).

---

## 18. Revision Summary
- Richardson Maturity Model: Level 0 (RPC endpoint), Level 1 (Resources), Level 2 (HTTP Verbs & Status Codes), Level 3 (HATEOAS hypermedia controls).
- REST URIs must use plural nouns (`/users`, `/orders`), never action verbs (`/getUsers`).
- Never perform mutations in `GET` requests; `GET` must be safe and idempotent.
- Level 2 REST enables automatic CDN caching, load balancing, and standardized status code handling.

---

## 19. Quick Reference

```
+--------------------+---------------------------+-----------------------------------------------+
| RMM Level          | Key Characteristic        | Example                                       |
+--------------------+---------------------------+-----------------------------------------------+
| Level 0            | Single URI, RPC POST      | POST /api (body: { action: "getUser" })       |
| Level 1            | Multiple Resource URIs    | POST /users/123 (body: { action: "update" })  |
| Level 2            | Semantic Verbs & Codes    | GET /users/123 -> 200, DELETE /users/1 -> 204 |
| Level 3            | HATEOAS Link Navigation   | Response includes _links: { pay, cancel }     |
| Resource Naming    | Plural Nouns              | /api/v1/products, /api/v1/invoices            |
| Nested Relationship| 2-level maximum hierarchy | /teams/42/members                             |
+--------------------+---------------------------+-----------------------------------------------+
```
