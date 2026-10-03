# HTTP Status Codes in Production: Semantics, Categories, and Edge Cases

## 1. What is it?
HTTP Status Codes are standardized 3-digit numerical responses issued by a server to indicate the outcome of a client's HTTP request. Governed by RFC 9110, they are organized into five fundamental classes:
- **1xx (Informational):** Request received, continuing process (e.g. `101 Switching Protocols` for WebSockets).
- **2xx (Success):** The action was successfully received, understood, and accepted.
- **3xx (Redirection):** Further action must be taken by the client to complete the request.
- **4xx (Client Error):** The request contains bad syntax or cannot be fulfilled due to client fault.
- **5xx (Server Error):** The server failed to fulfill an apparently valid request due to internal error or downstream dependency failure.

```
+-------------------------------------------------------------------------------+
|                       HTTP STATUS CODE TAXONOMY MATRIX                        |
+-------+-------------------+---------------------------------------------------+
| Class | Category          | Production Significance                           |
+-------+-------------------+---------------------------------------------------+
| 1xx   | Informational     | Protocol transitions (HTTP/1.1 -> WebSocket)      |
| 2xx   | Success           | Data retrieved (200), created (201), empty (204)  |
| 3xx   | Redirection       | URL movements (301/308), Caching validation (304) |
| 4xx   | Client Fault      | Bad data (400/422), Auth (401/403), Limits (429)  |
| 5xx   | Server Fault      | Crash (500), Proxy failure (502), Timeout (504)   |
+-------+-------------------+---------------------------------------------------+
```

---

## 2. Why does it exist?
Without standardized HTTP status codes:
- **The "200 OK with Error" Disaster:** Every API invents its own custom payload schema (e.g. `{ "status": "FAIL", "code": 992 }`). Automated HTTP infrastructure—including load balancers (AWS ALB), CDNs (Cloudflare), API Gateways (Kong), and monitoring agents (Datadog)—cannot detect failures and mistakenly records broken requests as 100% healthy!
- **Broken Browser Caching:** Proxies rely on `304 Not Modified` to prevent downloading unchanged megabyte payloads.
- **Lost SEO Juice:** Search engines require `301 Moved Permanently` to transfer page authority during migrations.

Status codes provide an unambiguous, universally understood communication standard across the entire global internet infrastructure.

---

## 3. Mental Model
Think of HTTP Status Codes as **Airport Flight Terminal Announcements**:
- **2xx is the Green Gate Light:** Your boarding pass is scanned, and you walk straight onto the plane.
- **3xx is the Gate Change Board:** "Flight 102 has moved to Terminal 2; please proceed there" (`301` / `308`).
- **4xx is the Passenger Mistake:** You arrived with an expired passport (`401`), you tried to enter the VIP First-Class lounge with an Economy ticket (`403`), you went to a gate that doesn't exist (`404`), or your carry-on bag exceeds the weight limit (`422`).
- **5xx is the Airline Breakdown:** The aircraft has an engine failure (`500`), the air traffic control tower lost power (`502`), or the flight crew is on strike (`503`). It is not the passenger's fault!

---

## 4. Basic Example

### Crucial 2xx Success Codes
```typescript
// 1. HTTP 200 OK: Standard successful GET, or mutation returning modified payload
res.status(200).json({ user: { id: 1, name: 'Alice' } });

// 2. HTTP 201 Created: Returned on POST when a brand-new entity is stored
// IMPORTANT: Always attach the "Location" header pointing to the new entity URI!
res.setHeader('Location', '/api/v1/invoices/inv_998');
res.status(201).json({ id: 'inv_998', total: 450 });

// 3. HTTP 204 No Content: Returned on successful DELETE or PUT when NO body is returned
// Note: Never send a JSON body with 204! The HTTP specification forbids it.
res.status(204).send();
```

---

## 5. Real Example

### The Decisive 4xx Client Error Breakdown
```typescript
// 400 Bad Request vs. 422 Unprocessable Entity
// Scenario: POST /api/v1/users
// Body A: { "age": "not-a-number" } ---> Malformed JSON / Syntax fault -> 400 Bad Request
// Body B: { "age": -5 }              ---> Valid JSON, but fails business domain rule -> 422 Unprocessable Entity

// 401 Unauthorized vs. 403 Forbidden
// Scenario: GET /api/v1/admin/audit-logs
export function authorizeAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization;

  // 401 Unauthorized: Authentication is MISSING or INVALID.
  // "I don't know who you are. Please log in."
  if (!token) {
    res.setHeader('WWW-Authenticate', 'Bearer realm="api"');
    return res.status(401).json({ error: 'Missing or expired Bearer token' });
  }

  const user = verifyJwt(token);

  // 403 Forbidden: Authenticated successfully, but LACKS PERMISSION.
  // "I know exactly who you are, but you are not allowed in this room."
  if (user.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Forbidden: Requires SUPER_ADMIN privileges' });
  }

  next();
}
```

---

## 6. Under the Hood

### 1. 301/302 vs. 307/308 (The Verb Preserving Redirects)
Historically, browsers had a bug: when receiving a `301 Moved Permanently` or `302 Found` in response to a `POST` request, they unexpectedly changed the subsequent request method to `GET`!
- To fix this, HTTP/1.1 introduced **307 Temporary Redirect** and **308 Permanent Redirect**:
  - `301` & `302`: May arbitrarily change `POST` to `GET`.
  - `307` & `308`: **Strictly guarantee** that the client must reuse the original HTTP method (`POST` remains `POST`, preserving the body).

### 2. 502 Bad Gateway vs. 504 Gateway Timeout
In modern cloud architectures (e.g. AWS NGINX -> Node.js upstream):
```
Client ---> [ Reverse Proxy / NGINX / Cloudflare ] ===> [ Node.js Backend Container ]
```
- **`502 Bad Gateway`:** The reverse proxy reached the Node.js server, but the Node.js process crashed immediately or returned a corrupted TCP packet.
- **`504 Gateway Timeout`:** The reverse proxy waited for Node.js to respond, but Node.js was stuck in a long-running CPU deadlock or slow SQL query and exceeded the proxy's `proxy_read_timeout` (e.g. 60 seconds).

---

## 7. Important Rules
1. **Never Return 200 OK for Errors:** Returning HTTP 200 with `{ error: true }` breaks CDN caching, prevents APM monitoring alerts, and violates HTTP protocol compliance.
2. **204 No Content Must Have Zero Bytes Body:** Sending a body with a 204 status code violates HTTP specifications. Use `res.status(204).end()` or `send()`.
3. **Include `WWW-Authenticate` Header on 401:** RFC 9110 specifies that a `401 Unauthorized` response **must** include a `WWW-Authenticate` header indicating the required authentication scheme (e.g. `Bearer`).
4. **Include `Retry-After` Header on 429 and 503:** When rate-limiting (`429`) or undergoing maintenance (`503`), provide a `Retry-After: 30` header informing clients how many seconds to back off.

---

## 8. Common Mistakes

### Mistake 1: Confusing 401 Unauthorized and 403 Forbidden
```
Scenario: A normal user attempts to delete a database table.
❌ WRONG: Return 401 Unauthorized (Tells the user their password was wrong!).
✅ CORRECT: Return 403 Forbidden (User is authenticated, but lacks admin privileges).
```

### Mistake 2: Returning 500 for User Input Mistakes
```typescript
// ❌ WRONG: Crashing with 500 when user sends invalid email
if (!isValidEmail(email)) {
  throw new Error('Email invalid'); // Triggers 500 Internal Server Error!
}
// APM alerts trigger in the middle of the night for normal user typos!

// ✅ FIXED:
if (!isValidEmail(email)) {
  return res.status(422).json({ error: 'Validation failed: Invalid email' });
}
```

---

## 9. Best Practices
1. **Use `409 Conflict` for Unique Constraint Collisions:** When a user registers with an email that is already taken in the database, return `409 Conflict`.
2. **Use `304 Not Modified` with ETags:**
   ```typescript
   const etag = generateHash(data);
   if (req.headers['if-none-match'] === etag) {
     return res.status(304).end(); // Tells client to use local browser cache
   }
   res.setHeader('ETag', etag);
   res.status(200).json(data);
   ```
3. **Adopt Standardized Error Envelopes (RFC 7807 - Problem Details):**
   ```json
   {
     "type": "https://api.example.com/errors/insufficient-funds",
     "title": "Insufficient Funds",
     "status": 403,
     "detail": "Your balance is $20.00, but the transfer requires $50.00."
   }
   ```

---

## 10. Performance Considerations
- **Bandwidth Elimination with 304:** Returning `304 Not Modified` transmits 0 payload bytes over the wire, drastically reducing cellular data consumption and speeding up mobile client loading.
- **Monitoring Accuracy:** Datadog, Prometheus, and AWS CloudWatch track the **5xx Error Rate** to trigger automated rollbacks. If your code throws 500 for normal user validation errors, you will trigger false-positive production alerts.

---

## 11. Security Considerations
- **Timing Attacks & 404 vs 403:** In multi-tenant systems, returning `403 Forbidden` on `/tenants/secret-company/documents` confirms to an attacker that `secret-company` exists! Returning `404 Not Found` masks the existence of the private resource completely.
- **Leaking Server Stack Traces on 500:** Never serialize raw internal database exception messages or stack traces into production 500 responses. Return a generic `{ error: "Internal Server Error", referenceId: "err_xyz" }` and inspect details in private server logs.

---

## 12. Alternatives
- **GraphQL Errors Array:** GraphQL always returns HTTP 200 OK and bundles errors in an `errors: [...]` array. This trades off HTTP protocol caching and edge routing simplicity for client query flexibility.
- **gRPC Status Codes:** Uses standard gRPC status codes (`OK`, `CANCELLED`, `DEADLINE_EXCEEDED`, `NOT_FOUND`, `ALREADY_EXISTS`).

---

## 13. Trade-offs

| Status Code | Correct Semantic Context | Common Misuse |
| :--- | :--- | :--- |
| **`400`** | Syntactic bad request (malformed JSON) | Used for valid JSON with domain rule errors |
| **`422`** | Semantic validation error (schema validation) | Forgotten in favor of generic 400 |
| **`401`** | Unauthenticated (missing/bad credentials) | Used when user lacks admin role |
| **`403`** | Unauthorized (authenticated, but forbidden) | Used when auth token is missing |
| **`409`** | State conflict (duplicate key, version clash)| Used for generic business rule errors |

---

## 14. Real-World Usage
- **GitHub API:** Returns `404 Not Found` instead of `403 Forbidden` when attempting to access private repositories without access, preventing username enumeration.
- **Cloudflare & AWS CloudFront:** Automated edge responses emitting `502 Bad Gateway` when origin Docker containers run out of memory (OOM).

---

## 15. Placement Interview Questions

### Basic
**Q: What is the exact difference between HTTP 401 Unauthorized and HTTP 403 Forbidden?**  
*Answer:*
- `401 Unauthorized` means the client has **not authenticated** or provided invalid credentials. The user must log in or provide a valid token.
- `403 Forbidden` means the server knows the client's identity (the user is successfully authenticated), but the client **lacks the required permissions or roles** to access the resource. Logging in again will not grant access.

### Conceptual
**Q: Why was HTTP 307 Temporary Redirect introduced when HTTP 302 Found already existed?**  
*Answer:* HTTP 302 was originally intended to be a temporary redirect, but historical browsers implemented it incorrectly by converting `POST` requests into `GET` requests upon receiving the 302. HTTP 307 was introduced to explicitly mandate that the client **must preserve the original HTTP method and body** when following the redirect.

### Implementation
**Q: How do you implement rate limiting headers on a 429 Too Many Requests response?**  
*Answer:*
```typescript
res.setHeader('Retry-After', '60'); // Number of seconds to wait
res.setHeader('X-RateLimit-Limit', '100');
res.setHeader('X-RateLimit-Remaining', '0');
res.setHeader('X-RateLimit-Reset', (Math.floor(Date.now() / 1000) + 60).toString());
res.status(429).json({ error: 'Rate limit exceeded. Please wait 60 seconds.' });
```

### Debugging
**Q: A frontend application makes a `DELETE` request, and the server returns `HTTP 204 No Content` with `{ "success": true }` in the body. The client's `fetch()` call crashes when calling `response.json()`. Why?**  
*Answer:* By HTTP specification (RFC 9110), an HTTP 204 response has **no content body**. When the browser or client library reads a 204 response, the response stream is empty. Calling `response.json()` attempts to parse an empty string as JSON, throwing `SyntaxError: Unexpected end of JSON input`. For 204 responses, check `response.ok` or call `response.text()` without parsing JSON.

### Scenario
**Q: You notice that an e-commerce platform's monitoring dashboard shows an 8% spike in HTTP 500 errors whenever customers submit checkout forms. What is the likely architectural problem?**  
*Answer:* The checkout service is throwing unhandled exceptions for user-correctable validation errors (e.g. invalid credit card numbers, expired cards, or empty shipping addresses), which fall through to the root Express error handler as HTTP 500s. These should be caught and returned as `422 Unprocessable Entity` or `400 Bad Request`. HTTP 500 should be strictly reserved for unexpected system crashes or database outages.

### Advanced
**Q: What is the purpose of HTTP 304 Not Modified, and how does conditional GET with ETags work?**  
*Answer:* `304 Not Modified` is used for conditional caching. When a client requests a resource, the server provides an `ETag: "hash123"` header. On subsequent requests, the client transmits `If-None-Match: "hash123"`. The server compares the current hash of the data with the client's ETag. If they match, the server returns `304 Not Modified` with an empty body, instructing the client to read the resource from its local browser cache, saving 100% of the payload bandwidth.

---

## 16. Coding Questions

### Problem: Build a Centralized Global Error Handler Mapping Errors to Semantic HTTP Status Codes
```typescript
// middleware/errorHandler.ts
import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  public statusCode: number;
  public errorCode: string;

  constructor(message: string, statusCode: number, errorCode: string) {
    super(message);
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function globalErrorHandler(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // 1. Handled Operational Errors
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: {
        code: err.errorCode,
        message: err.message,
      },
    });
  }

  // 2. Syntax Malformed JSON Error (from express.json())
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: { code: 'INVALID_JSON', message: 'Malformed JSON payload' },
    });
  }

  // 3. Database Unique Constraint Error (e.g. Prisma code P2002)
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: { code: 'RESOURCE_CONFLICT', message: 'Record already exists' },
    });
  }

  // 4. Unhandled Internal Server Errors
  console.error('Unhandled Panic:', err);
  return res.status(500).json({
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected internal failure occurred.',
    },
  });
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "`204 No Content` should return `{ success: true }` so the frontend knows it worked."  
  *Truth:* False! RFC 9110 strictly forbids response bodies on 204. Returning a body violates HTTP standards and causes client parsing crashes.
- **Trap 2:** "`401` means forbidden and `403` means unauthorized."  
  *Truth:* False! The names are historically confusing: `401 Unauthorized` actually means "Unauthenticated", and `403 Forbidden` means "Unauthorized".

---

## 18. Revision Summary
- 2xx: `200` (OK), `201` (Created with Location header), `204` (No Content, empty body).
- 3xx: `301/308` (Permanent), `302/307` (Temporary, 307 preserves method), `304` (Not Modified with ETag).
- 4xx: `400` (Malformed JSON/Syntax), `401` (Unauthenticated), `403` (Forbidden/Role), `404` (Not Found), `409` (Conflict), `422` (Semantic validation error), `429` (Rate limit).
- 5xx: `500` (Internal crash), `502` (Bad Gateway upstream crash), `503` (Service unavailable / maintenance), `504` (Gateway timeout).

---

## 19. Quick Reference

```
+--------------------+---------------------------+-----------------------------------------------+
| Status Code        | Semantic Name             | Meaning                                       |
+--------------------+---------------------------+-----------------------------------------------+
| 200 OK             | Standard Success          | Successful GET or state retrieval             |
| 201 Created        | Resource Created          | Successful POST with Location header          |
| 204 No Content     | Successful Empty Return   | Successful DELETE or empty mutation           |
| 304 Not Modified   | Cache Valid               | ETag matches; read from local browser cache   |
| 400 Bad Request    | Malformed Syntax          | Broken JSON syntax, unparseable payload       |
| 401 Unauthorized   | Unauthenticated           | Missing or invalid JWT / session cookie       |
| 403 Forbidden      | Insufficient Permissions  | Authenticated, but lacks role/access          |
| 404 Not Found      | Missing Resource          | URI endpoint does not exist                   |
| 409 Conflict       | State Collision           | Duplicate unique key or version race condition|
| 422 Unprocessable  | Domain Validation Failure | Valid JSON, but fails schema/business rules   |
| 429 Too Many Req   | Rate Limited              | Exceeded rate limit; inspect Retry-After      |
| 500 Internal Error | Unhandled Server Crash    | Uncaught exception, server bug                |
| 502 Bad Gateway    | Downstream Server Failure | Upstream Node process died or connection reset|
| 504 Gateway Timeout| Upstream Deadlock         | Reverse proxy timed out waiting for backend   |
+--------------------+---------------------------+-----------------------------------------------+
```
