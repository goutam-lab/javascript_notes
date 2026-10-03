# Request and Response Contracts: Standardized Envelopes, RFC 7807, and API Design

## 1. What is it?
Request and Response Contracts represent the formal, predictable, and language-agnostic data structures governing communication between client applications (web, mobile, third-party consumers) and backend API services. Rather than returning raw unformatted arrays or arbitrary JSON literals, mature engineering organizations enforce **Standardized JSON Envelopes**. The three industry standards are:
1. **JSend Specification:** Simple envelope organizing responses into three states (`success`, `fail`, `error`).
2. **RFC 7807 (Problem Details for HTTP APIs):** The IETF official standard for machine-readable HTTP error representation (`type`, `title`, `status`, `detail`, `instance`).
3. **Enterprise Google Cloud API Style:** Enclosing entities in a `{ data: T, meta: { ... } }` wrapper accompanied by pagination and telemetry metadata.

```
+-------------------------------------------------------------------------------+
|                       STANDARDIZED API ENVELOPE TOPOLOGY                      |
+-------------------------------------------------------------------------------+
| SUCCESS ENVELOPE:                                                             |
| {                                                                             |
|   "success": true,                                                            |
|   "data": { ... },                                                            |
|   "meta": { "page": 1, "total": 150, "requestId": "req_8819", "timestamp": ..|
| }                                                                             |
|                                                                               |
| ERROR ENVELOPE (RFC 7807 Style):                                              |
| {                                                                             |
|   "success": false,                                                           |
|   "error": {                                                                  |
|     "code": "VALIDATION_FAILED",                                              |
|     "message": "Invalid customer input parameters",                           |
|     "details": { "email": ["Invalid format"] },                               |
|     "requestId": "req_8819"                                                   |
|   }                                                                           |
| }                                                                             |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?
Without standardized response envelopes:
- **Client Parsing Chaos:** Endpoint A returns `[ { id: 1 } ]`, Endpoint B returns `{ users: [ ... ] }`, and Endpoint C returns `{ data: [ ... ], count: 50 }`. Frontend engineers have to write unique, fragile parsing adapters for every single endpoint.
- **Inconsistent Error Interceptors:** Axios or fetch global error interceptors cannot reliably extract error messages because one controller returns `{ error: "msg" }` while another returns `{ message: "msg" }` and a third returns `{ err: { desc: "msg" } }`.
- **Missing Telemetry Tracing:** When an API call fails in production, the user cannot report a unique `requestId` to customer support, making log correlation in Datadog or CloudWatch nearly impossible.

Standardized contracts create a uniform, automated parsing interface across the entire full-stack ecosystem.

---

## 3. Mental Model
Think of an API Contract as a **Standardized Shipping Container**:
- A cargo ship doesn't care whether you are shipping computers, shoes, or grain.
- The cargo ship only accepts **standard 40-foot steel shipping containers** with standardized corner castings, a manifest barcode on the door (`meta`), and an inspection seal (`requestId`).
- The crane operator (Client API client) can lift, stack, and move every container with the exact same machine without opening the door.

---

## 4. Basic Example

### Standardized Success and Error Envelopes in TypeScript
```typescript
// types/apiContract.ts

// 1. Unified Success Envelope
export interface ApiResponse<T> {
  success: true;
  data: T;
  meta?: {
    page?: number;
    limit?: number;
    totalCount?: number;
    hasMore?: boolean;
    requestId: string;
    timestamp: string;
  };
}

// 2. Unified Error Envelope
export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;               // Machine-readable uppercase identifier: 'ORDER_EXPIRED'
    message: string;            // Human-readable summary
    details?: Record<string, string[]>; // Field-level validation issues
    requestId: string;          // Correlation ID for log lookup
  };
}

// 3. Combined Result Type
export type ApiResult<T> = ApiResponse<T> | ApiErrorResponse;
```

---

## 5. Real Example

### Express Generic Response Builder with Global Interceptors
```typescript
// utils/responseBuilder.ts
import { Response } from 'express';
import { ApiResponse, ApiErrorResponse } from '@/types/apiContract';

export class ResponseBuilder {
  static success<T>(
    res: Response,
    data: T,
    statusCode: number = 200,
    metaOptions?: { page?: number; limit?: number; totalCount?: number }
  ) {
    const requestId = (res.req.headers['x-request-id'] as string) || `req_${Date.now()}`;

    const payload: ApiResponse<T> = {
      success: true,
      data,
      meta: {
        ...metaOptions,
        requestId,
        timestamp: new Date().toISOString(),
      },
    };

    return res.status(statusCode).json(payload);
  }

  static error(
    res: Response,
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, string[]>
  ) {
    const requestId = (res.req.headers['x-request-id'] as string) || `req_${Date.now()}`;

    const payload: ApiErrorResponse = {
      success: false,
      error: {
        code,
        message,
        details,
        requestId,
      },
    };

    return res.status(statusCode).json(payload);
  }
}
```

```typescript
// controllers/productController.ts (Using the ResponseBuilder)
import { Request, Response } from 'express';
import { ResponseBuilder } from '@/utils/responseBuilder';

export async function listProducts(req: Request, res: Response) {
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = 20;

  const [products, totalCount] = await Promise.all([
    db.product.findMany({ skip: (page - 1) * limit, take: limit }),
    db.product.count(),
  ]);

  return ResponseBuilder.success(res, products, 200, {
    page,
    limit,
    totalCount,
    hasMore: page * limit < totalCount,
  });
}
```

---

## 6. Under the Hood

### 1. Correlation IDs (`X-Request-ID`)
When an HTTP request enters an enterprise cloud infrastructure:
1. The API Gateway or Load Balancer (NGINX / Cloudflare) injects a unique UUID: `X-Request-ID: c849a9f2-761e-45a8`.
2. The Node.js application receives this header and binds it to AsyncLocalStorage.
3. Every log statement generated during that request includes `requestId`.
4. The final JSON response envelope includes this exact `requestId`.
5. If the request fails, the user sees: *"Error: PAYMENT_TIMEOUT (Ref: c849a9f2-761e-45a8)"*. An engineer searches this ID in Datadog and sees the exact SQL query and stack trace in 2 seconds.

### 2. RFC 7807 Problem Details
The IETF Problem Details standard defines a structured format for HTTP errors using the `application/problem+json` media type:
```json
{
  "type": "https://api.mycloud.com/errors/insufficient-credit",
  "title": "Insufficient Credit Balance",
  "status": 403,
  "detail": "Your balance of $12.50 is insufficient for this $50.00 purchase.",
  "instance": "/orders/10293/transactions/99"
}
```

---

## 7. Important Rules
1. **Never Return Raw Arrays at Root:** Never return `res.json([user1, user2])`. Returning a raw array at root prevents you from adding pagination metadata (`total`, `page`, `nextCursor`) in the future without breaking existing API clients! Always wrap arrays in an object: `{ data: [ ... ] }`.
2. **`code` Must Be a Stable Machine Enum:** Never rely solely on human-readable `message` for client logic. Use stable uppercase enum codes (e.g. `ACCOUNT_SUSPENDED`, `RATE_LIMIT_EXCEEDED`) so frontend clients can switch on error states cleanly: `if (err.code === 'ACCOUNT_SUSPENDED') showModal()`.
3. **Timestamp Formats Must Be ISO 8601:** Always serialize dates in metadata as UTC ISO strings: `new Date().toISOString()` (`2026-03-15T12:00:00.000Z`). Never send localized date strings.
4. **Consistency Across ALL Endpoints:** Every team member and every microservice in the organization must adhere to the identical response envelope contract.

---

## 8. Common Mistakes

### Mistake 1: Returning Raw Arrays as Root JSON
```typescript
// ❌ WRONG:
res.json(users); // Output: [{ id: 1 }, { id: 2 }]
// Problem: Later when you need to add pagination totalCount, adding it breaks all clients!

// ✅ FIXED:
res.json({ data: users, meta: { total: 100 } });
```

### Mistake 2: Missing Machine-Readable Error Codes
```json
// ❌ BAD: Frontend has to parse string text to determine what went wrong!
{ "error": "Your session has expired, please log in again" }

// ✅ FIXED:
{
  "error": {
    "code": "SESSION_EXPIRED",
    "message": "Your session has expired, please log in again"
  }
}
```

---

## 9. Best Practices
1. **Frontend Global Axios / Fetch Interceptors:** Write a single client-side interceptor that automatically unwraps `{ data }` on success and throws typed `ApiErrorResponse` on failure:
   ```typescript
   apiClient.interceptors.response.use(
     (res) => res.data.data, // Automatically unwrap data envelope
     (err) => Promise.reject(err.response?.data?.error || err)
   );
   ```
2. **Include Field-Level Errors in Validation Failures:** In form rejections, map errors to field names:
   ```json
   {
     "code": "VALIDATION_ERROR",
     "details": {
       "email": ["Invalid email address"],
       "password": ["Must be at least 8 characters"]
     }
   }
   ```
3. **Always Expose `X-Request-ID` in CORS:** If running across origins, add `Access-Control-Expose-Headers: X-Request-ID` so browser clients can read the correlation ID.

---

## 10. Performance Considerations
- **Envelope Overhead:** An envelope adds ~50-100 bytes of JSON metadata. When gzip or Brotli compression is enabled on the web server, this overhead compresses down to <20 bytes, which is completely negligible.
- **Payload Truncation:** For endpoints returning thousands of records, ensure pagination limits prevent unbounded JSON responses that could consume all V8 heap memory.

---

## 11. Security Considerations
- **Hiding Internal Database Stack Traces:** Never include SQL error dumps or file paths inside the `details` field of an error response in production.
- **Sensitive Data Scrubbing:** Ensure metadata blocks never log authorization tokens or passwords in the `meta` block.

---

## 12. Alternatives
- **GraphQL Contract (Specification):** GraphQL natively enforces envelopes: `{ data: { ... }, errors: [ ... ] }`.
- **gRPC Status Protobufs:** gRPC provides rich status messages (`google.rpc.Status`) with typed details using Protocol Buffers.

---

## 13. Trade-offs

| Contract Style | Advantages | Disadvantages |
| :--- | :--- | :--- |
| **Standardized Envelope (`{ data, meta }`)**| Consistent parsing; extensible metadata | Slightly verbose; unwrapping step on client |
| **Raw JSON Root (`{ ... }`)**| Minimal payload; no unwrapping needed | Cannot add pagination metadata cleanly; inconsistent |
| **RFC 7807 (Problem Details)** | Formal internet standard for errors | Less commonly used for standard success payloads |

---

## 14. Real-World Usage
- **Stripe API:** Returns clean objects for single entities and `{ object: 'list', data: [...], has_more: true }` for collections, accompanied by consistent error blocks.
- **GitHub API:** Returns standard JSON entities with `X-GitHub-Request-Id` and detailed error lists: `{ message: "...", errors: [{ resource: "...", code: "..." }] }`.

---

## 15. Placement Interview Questions

### Basic
**Q: Why should you avoid returning a raw JSON array (e.g. `[ { id: 1 } ]`) as the root response from an API endpoint?**  
*Answer:* Returning a raw array at root makes the API un-extensible. If you later need to include pagination metadata (such as `totalCount`, `page`, `hasMore`), rate-limit info, or a request correlation ID, you cannot do so without changing the root data type from an array to an object, which introduces a breaking change for all client applications. Always wrap collections in an object: `{ data: [ ... ], meta: { ... } }`.

### Conceptual
**Q: What is RFC 7807 (Problem Details for HTTP APIs)?**  
*Answer:* RFC 7807 is an IETF specification defining a standardized machine-readable JSON format for HTTP error responses. It standardizes common error properties including `type` (a URI reference identifying the error type), `title` (short summary), `status` (HTTP status code), `detail` (human-readable explanation), and `instance` (URI reference of the specific occurrence).

### Implementation
**Q: Write a client-side TypeScript helper function that safely unwraps an `ApiResponse<T>` or throws a formatted error from an `ApiErrorResponse`.**  
*Answer:*
```typescript
import { ApiResult } from '@/types/apiContract';

export async function handleApiResponse<T>(responsePromise: Promise<Response>): Promise<T> {
  const res = await responsePromise;
  const json: ApiResult<T> = await res.json();

  if (!res.ok || !json.success) {
    const errorObj = 'error' in json ? json.error : { code: 'HTTP_ERROR', message: res.statusText, requestId: 'unknown' };
    throw new Error(`[${errorObj.code}] ${errorObj.message} (Ref: ${errorObj.requestId})`);
  }

  return json.data;
}
```

### Debugging
**Q: A frontend developer complains that the Axios error interceptor cannot access `error.response.data.error.code` when the server returns a 502 Bad Gateway. Why?**  
*Answer:* An HTTP 502 Bad Gateway is emitted by the reverse proxy (NGINX / Cloudflare), NOT by the Node.js application server. The reverse proxy typically returns default raw HTML or a non-standard JSON payload that does not adhere to your application's custom JSON error contract. Global interceptors must defensively check if the response is JSON and fallback to a default error structure if parsing fails.

### Scenario
**Q: How do you design an API contract that supports internationalization (i18n) for error messages?**  
*Answer:* The backend should NOT send hardcoded translated strings. Instead, the backend returns a stable, machine-readable `error.code` (e.g. `INSUFFICIENT_FUNDS`) along with interpolation parameters in `details` (e.g. `{ currentBalance: 20, requiredAmount: 50 }`). The frontend client matches the `code` to its local translation dictionary (`en.json`, `es.json`) and renders the message in the user's preferred language.

### Advanced
**Q: Explain how Correlation IDs (`X-Request-ID`) travel across an entire distributed microservices architecture.**  
*Answer:* When an incoming HTTP request reaches the Edge Gateway, the gateway generates a UUID and sets `X-Request-ID`. As the request is forwarded to downstream internal services via HTTP, gRPC, or message queues (RabbitMQ/Kafka), each service propagates the `X-Request-ID` header in outgoing calls and attaches it to structured log lines. When the final response is returned to the client, the same ID is included in the response header and body, enabling distributed tracing across all system logs.

---

## 16. Coding Questions

### Problem: Build a Typed Fetch Client Wrapper Enforcing Standardized Envelopes
```typescript
// lib/apiClient.ts
import { ApiResponse, ApiErrorResponse } from '@/types/apiContract';

export class ApiClientError extends Error {
  public code: string;
  public details?: Record<string, string[]>;
  public requestId: string;

  constructor(error: ApiErrorResponse['error']) {
    super(error.message);
    this.name = 'ApiClientError';
    this.code = error.code;
    this.details = error.details;
    this.requestId = error.requestId;
  }
}

export async function typedFetch<T>(
  url: string,
  options?: RequestInit
): Promise<{ data: T; meta?: ApiResponse<T>['meta'] }> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  const json = await response.json();

  if (!response.ok || !json.success) {
    const errorPayload = json.error || {
      code: 'HTTP_STATUS_' + response.status,
      message: response.statusText || 'An unexpected error occurred',
      requestId: response.headers.get('x-request-id') || 'unknown',
    };
    throw new ApiClientError(errorPayload);
  }

  return {
    data: json.data as T,
    meta: json.meta,
  };
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "Error messages should be crafted on the server in the user's localized language."  
  *Truth:* False. Servers should return standardized machine-readable error codes (`code: "CARD_EXPIRED"`). The client is responsible for translating the code into localized UI text.
- **Trap 2:** "HTTP status codes don't matter if your JSON envelope has `success: false`."  
  *Truth:* False! Automated network infrastructure, CDNs, and monitoring agents rely on HTTP status codes (4xx, 5xx) to detect failures.

---

## 18. Revision Summary
- Standardize responses using JSON envelopes: `{ success: true, data, meta }` and `{ success: false, error: { code, message, requestId } }`.
- Never return raw arrays at root; always wrap them in an object to preserve future metadata extensibility.
- Use `requestId` / `X-Request-ID` correlation IDs for log tracing across microservices.
- Provide machine-readable uppercase error codes (`INSUFFICIENT_FUNDS`) rather than relying on human message strings.

---

## 19. Quick Reference

```
+------------------------------------+-------------------------------------------+
| Contract Element                   | Example / Specification                   |
+------------------------------------+-------------------------------------------+
| Success Root Property              | { "success": true, "data": ... }          |
| Error Root Property                | { "success": false, "error": ... }        |
| Machine Error Code                 | code: "INVALID_CREDENTIALS"               |
| Distributed Log Identifier         | requestId: "req_88192a" (X-Request-ID)    |
| Collection Envelope                | { "data": [...], "meta": { "total": 100 }}|
| Pagination Metadata Keys           | page, limit, totalCount, hasMore          |
| RFC 7807 Error Standard            | type, title, status, detail, instance     |
+------------------------------------+-------------------------------------------+
```
