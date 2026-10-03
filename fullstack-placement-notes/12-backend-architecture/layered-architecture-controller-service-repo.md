# Layered Architecture: Controller, Service, and Repository Pattern

---

## 1. What is it?

**Layered Architecture** (often termed N-Tier Architecture) is an established enterprise software design pattern that organizes a backend application into horizontal, segregated layers of responsibility. In modern full-stack Node.js/TypeScript engineering, the standard implementation is the **Controller-Service-Repository Pattern**:

1. **Controller Layer (Presentation / HTTP Transport)**: Translates incoming HTTP requests into domain inputs. It handles routing, extracts parameters (`req.body`, `req.params`), validates schemas, invokes the appropriate business service, and maps domain responses to HTTP status codes (`200`, `201`, `404`). It contains **zero business logic** and **zero database queries**.
2. **Service Layer (Domain / Business Logic)**: Contains the pure, framework-agnostic business rules of the application. It enforces invariants, coordinates workflows across multiple repositories, manages transactions, calculates balances, and triggers notifications. It has **no awareness of HTTP, Express, `req`, or `res`**.
3. **Repository Layer (Data Access / Persistence)**: Directly encapsulates database queries, ORM operations (Prisma, TypeORM, Drizzle), or third-party storage interfaces. It exposes clean domain entity methods (`findById`, `create`, `updateBalance`) to the service layer, abstracting the physical SQL/NoSQL implementation.

```
+-------------------------------------------------------------------------------+
|                       THE 3-TIER LAYERED ARCHITECTURE                         |
+-------------------------------------------------------------------------------+
| Client (Browser / Mobile App)                                                 |
|        |                                                                      |
|        v HTTP Request (JSON)                                                  |
| +---------------------------------------------------------------------------+ |
| | CONTROLLER LAYER                                                          | |
| | - Extracts req.body, req.params                                           | |
| | - Validates input via Zod                                                 | |
| | - Calls Service methods                                                   | |
| | - Returns res.status(200).json(dto)                                       | |
| +---------------------------------------------------------------------------+ |
|        |                                                                      |
|        v DTO / Domain Primitive (Pure TypeScript)                             |
| +---------------------------------------------------------------------------+ |
| | SERVICE LAYER (Pure Business Logic)                                       | |
| | - Validates domain invariants (e.g., account not frozen, sufficient funds)| |
| | - Coordinates multiple repositories                                       | |
| | - Manages business transactions                                           | |
| | - Dispatches domain events / emails                                       | |
| +---------------------------------------------------------------------------+ |
|        |                                                                      |
|        v Entity / Query Criteria                                              |
| +---------------------------------------------------------------------------+ |
| | REPOSITORY LAYER (Data Access)                                            | |
| | - SQL Queries / Prisma / TypeORM operations                               | |
| | - Hydrates raw database rows into typed domain entities                   | |
| +---------------------------------------------------------------------------+ |
|        |                                                                      |
|        v Network / Sockets                                                    |
| PostgreSQL / MySQL / MongoDB Database Engine                                  |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

In early-stage prototypes, developers often write "Fat Controllers"—dumping database queries, validation, authorization, business calculations, and response serialization into a single 300-line Express callback:

```typescript
// ❌ ANTI-PATTERN: Fat Controller with high coupling and zero testability
app.post("/transfer", async (req, res) => {
  // 1. Direct DB call
  const fromUser = await db.query("SELECT * FROM users WHERE id = $1", [req.body.from]);
  if (fromUser.rows[0].balance < req.body.amount) {
    return res.status(400).send("Insufficient funds");
  }
  // 2. Business logic mixed with raw SQL
  await db.query("UPDATE users SET balance = balance - $1 WHERE id = $2", [req.body.amount, req.body.from]);
  await db.query("UPDATE users SET balance = balance + $1 WHERE id = $2", [req.body.amount, req.body.to]);
  // 3. Email sending directly in HTTP handler
  await mailer.send("Transfer successful");
  res.send("OK");
});
```

This anti-pattern leads to:
1. **Impossible Unit Testing**: Testing the transfer logic requires running a live PostgreSQL database and a mock email server. You cannot test business calculations in isolation.
2. **Framework Lock-in**: If the company decides to migrate from Express to Fastify, NestJS, AWS Lambda, or a CLI command, the business logic must be rewritten from scratch because it is tightly bound to `req` and `res`.
3. **Massive Code Duplication**: If both an HTTP route and an asynchronous BullMQ background worker need to transfer funds, the SQL and validation logic must be duplicated.

The Controller-Service-Repository pattern decouples business rules from transport protocols and storage mechanisms.

---

## 3. Mental Model

Visualize a **Fine Dining Restaurant**:

- **The Controller (The Waiter / Captain)**:
  - Takes the customer's order ticket (`req`), verifies the customer spoke a recognized language and ordered valid menu items (validation).
  - Hands the ticket to the kitchen.
  - When the food is ready, places it on a clean plate and serves it to the table with a smile (`res.status(200).json()`).
  - *The waiter never cooks the food or digs vegetables out of the farm.*
- **The Service (The Executive Chef)**:
  - Receives the order. Combines ingredients according to secret recipes and business rules (e.g., "Medium rare steak must be seared at 450°F for 4 minutes").
  - Decides when a dish is complete.
  - *The chef does not interact with the restaurant customer directly and does not slaughter cattle.*
- **The Repository (The Food Supplier / Pantry Master)**:
  - When the chef asks for "3 aged prime ribeyes" (`repo.getAvailableSteaks()`), the pantry master fetches them from the cold locker (PostgreSQL) and hands them over.
  - *The supplier doesn't care whether the meat is for a wedding banquet or a hamburger; they just know how to retrieve and store cuts reliably.*

---

## 4. Basic Example

### 4.1 Concrete 3-Tier Implementation in TypeScript
```typescript
// 1. REPOSITORY LAYER: Interacts directly with database/storage
export interface User {
  id: string;
  email: string;
  points: number;
}

export class UserRepository {
  private users = new Map<string, User>(); // In-memory simulation

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async updatePoints(id: string, newPoints: number): Promise<User> {
    const user = this.users.get(id);
    if (!user) throw new Error("User not found");
    user.points = newPoints;
    this.users.set(id, user);
    return user;
  }
}

// 2. SERVICE LAYER: Pure business rules, agnostic of HTTP
export class LoyaltyService {
  constructor(private userRepo: UserRepository) {}

  async awardBonus(userId: string, bonusAmount: number): Promise<User> {
    if (bonusAmount <= 0) {
      throw new Error("Bonus points must be strictly positive");
    }

    const user = await this.userRepo.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    // Business rule: Max points capped at 10,000
    const updatedTotal = Math.min(10000, user.points + bonusAmount);
    return this.userRepo.updatePoints(userId, updatedTotal);
  }
}

// 3. CONTROLLER LAYER: HTTP mapping and status codes
import { Request, Response, NextFunction } from "express";

export class LoyaltyController {
  constructor(private loyaltyService: LoyaltyService) {}

  awardBonusHandler = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { userId } = req.params;
      const { points } = req.body;

      const updatedUser = await this.loyaltyService.awardBonus(userId, Number(points));
      res.status(200).json({ status: "success", data: updatedUser });
    } catch (err: any) {
      next(err); // Central error handler maps domain error to HTTP status
    }
  };
}
```

---

## 5. Real Example

### Enterprise E-Commerce Checkout Pipeline with Strict Domain Separation & Transaction Support
```typescript
// -----------------------------------------------------------------------------
// 1. DOMAIN ENTITIES & INTERFACES (Core Types)
// -----------------------------------------------------------------------------
export interface Order {
  id: string;
  userId: string;
  amount: number;
  status: "PENDING" | "PAID" | "FAILED";
  createdAt: Date;
}

export interface IOrderRepository {
  create(order: Omit<Order, "id" | "createdAt">): Promise<Order>;
  updateStatus(id: string, status: Order["status"]): Promise<void>;
  findById(id: string): Promise<Order | null>;
}

export interface IPaymentGateway {
  charge(amount: number, token: string): Promise<{ transactionId: string; success: boolean }>;
}

// -----------------------------------------------------------------------------
// 2. REPOSITORY IMPLEMENTATION (Prisma / SQL Data Access)
// -----------------------------------------------------------------------------
export class PrismaOrderRepository implements IOrderRepository {
  // Simulating Prisma Client
  private db: Map<string, Order> = new Map();

  async create(data: Omit<Order, "id" | "createdAt">): Promise<Order> {
    const order: Order = {
      id: `ord_${Date.now()}`,
      ...data,
      createdAt: new Date(),
    };
    this.db.set(order.id, order);
    return order;
  }

  async updateStatus(id: string, status: Order["status"]): Promise<void> {
    const order = this.db.get(id);
    if (order) {
      order.status = status;
      this.db.set(id, order);
    }
  }

  async findById(id: string): Promise<Order | null> {
    return this.db.get(id) || null;
  }
}

// -----------------------------------------------------------------------------
// 3. SERVICE LAYER (Business Rules & Workflow Orchestration)
// -----------------------------------------------------------------------------
export class OrderService {
  constructor(
    private orderRepo: IOrderRepository,
    private paymentGateway: IPaymentGateway
  ) {}

  async checkout(userId: string, amount: number, paymentToken: string): Promise<Order> {
    // Domain rule: Minimum order is $5.00
    if (amount < 5) {
      throw new Error("Minimum checkout amount is $5.00");
    }

    // 1. Create order in PENDING status
    const order = await this.orderRepo.create({
      userId,
      amount,
      status: "PENDING",
    });

    // 2. Process external payment gateway
    const paymentResult = await this.paymentGateway.charge(amount, paymentToken);

    if (!paymentResult.success) {
      await this.orderRepo.updateStatus(order.id, "FAILED");
      throw new Error("Payment authorization failed");
    }

    // 3. Update order to PAID
    await this.orderRepo.updateStatus(order.id, "PAID");
    order.status = "PAID";

    return order;
  }
}

// -----------------------------------------------------------------------------
// 4. CONTROLLER LAYER (Express HTTP Adapter)
// -----------------------------------------------------------------------------
import { Request, Response, NextFunction } from "express";

export class OrderController {
  constructor(private orderService: OrderService) {}

  createOrder = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { amount, paymentToken } = req.body;
      const userId = req.headers["x-user-id"] as string;

      const order = await this.orderService.checkout(userId, amount, paymentToken);

      res.status(201).json({
        success: true,
        data: {
          orderId: order.id,
          amount: order.amount,
          status: order.status,
        },
      });
    } catch (error) {
      next(error);
    }
  };
}
```

---

## 6. Under the Hood

### 6.1 The Direction of Dependencies (The Inversion Rule)
In a properly layered architecture, dependencies flow strictly in **one direction**:

$$\text{Controller} \longrightarrow \text{Service} \longrightarrow \text{Repository}$$

- The **Controller** depends on the **Service**.
- The **Service** depends on the **Repository interface** (Abstraction).
- The **Repository** depends on the **Database client**.
- **Crucial Rule**: Downstream layers NEVER depend on upstream layers. A Repository must never know what a Service does. A Service must never import Express `Request` or `Response`.

### 6.2 Data Transfer Objects (DTOs) vs Domain Entities
- **DTO (Data Transfer Object)**: A plain JavaScript object that models data traversing network boundaries (e.g., `CreateUserDTO` containing `{ email, password }` from the HTTP request).
- **Domain Entity**: A rich object representing core business concepts with validation methods (e.g., `User` entity with `hashPassword()`, `canWithdraw()`).
- **Database Model**: The raw schema shape defined by your ORM (e.g., Prisma schema or SQL table columns with `created_at`, `password_hash`, `is_deleted`).

```
HTTP Body (JSON) ---> DTO ---> Domain Entity (Service) ---> DB Row (Repository)
```

---

## 7. Important Rules

1. **Never Pass `req` or `res` into the Service Layer**: Passing `(req, res)` into a service function couples your business logic permanently to the Express HTTP runtime. Pass explicit parameters: `service.createUser(req.body.email, req.body.password)`.
2. **Never Write SQL or Database Calls in Controllers**: Controllers must delegate all persistence needs to services or repositories.
3. **Services Return Values, Never Send HTTP Responses**: Services return entities, DTOs, or throw domain errors. They do not know what `res.status(200)` means.
4. **Controllers Catch and Delegate to `next(err)`**: Controllers wrap service invocations in `try/catch` and forward errors to Express's central error handler.

---

## 8. Common Mistakes

### Mistake 1: Passing the Entire `req` Object to the Service
```typescript
// ❌ WRONG: Service is coupled to Express! Cannot run in CLI, WebSocket, or worker!
class OrderService {
  async process(req: Request) {
    const user = req.user;
    const body = req.body;
  }
}

//  CORRECT: Pass pure primitive arguments or typed DTO
class OrderService {
  async process(userId: string, items: OrderItemDTO[]) {
    // Pure business logic
  }
}
```

### Mistake 2: The "Anemic Pass-Through" Service
```typescript
// ❌ WRONG: Service does nothing except forward to repository; pointless boilerplate!
class UserService {
  async getUser(id: string) {
    return this.userRepo.findById(id); // Zero business value added!
  }
}

//  CORRECT: Controllers can call repositories directly for simple CQRS reads, OR
// the service enforces domain rules (e.g. verify requester permissions, mask sensitive PII).
```

### Mistake 3: Business Logic Leaking into Repositories
Repositories should only execute data queries. Placing calculations (e.g., calculating tax percentages or discounting sales prices) inside SQL queries makes testing and auditing business logic extremely difficult.

---

## 9. Best Practices

1. **Depend on Interfaces, Not Concrete Classes**: The Service layer should accept an interface (`IUserRepository`), not the concrete `PrismaUserRepository`. This allows instant swapping with mock repositories during testing.
2. **Use Factory Functions or Dependency Injection Containers**: Wire dependencies together at application startup (in `server.ts` or `container.ts`).
3. **Isolate Database Transactions**: Pass transaction clients (`tx`) to repositories via unit-of-work patterns or Prisma transaction closures.

---

## 10. Performance Considerations

```
+-------------------------------------------------------------------------------+
|                       LAYERED ARCHITECTURE OVERHEAD                           |
+-------------------------------------------------------------------------------+
| Metric                      | Fat Controller        | 3-Tier Layered Stack    |
+-----------------------------+-----------------------+-------------------------+
| Function Call Overhead      | 1 function call       | 3 function calls        |
| Latency Difference          | Baseline (0.00 ms)    | +0.001 ms (Negligible!) |
| Unit Test Speed             | 1,200 ms (Needs DB)   | 4 ms (In-Memory Mock)   |
| Codebase Maintenance Cost   | Extremely High        | Low & Predictable       |
+-----------------------------+-----------------------+-------------------------+
```

- The CPU cost of invoking a JavaScript method on a service class is less than **5 nanoseconds**. The architectural benefits of testability and maintainability vastly outweigh any theoretical function-call overhead.

---

## 11. Security Considerations

1. **Separation of Authentication Context**: The Controller extracts the authenticated `userId` from the verified session or JWT (`req.user.id`). It passes this verified `userId` to the service. The service never trusts user IDs passed in the request body, eliminating Broken Object Level Authorization (BOLA/IDOR).
2. **Input Sanitization Boundary**: The Controller performs syntax validation (Zod schema checking). The Service performs semantic authorization (verifying if this user is allowed to access this resource).

---

## 12. Alternatives

| Architecture Pattern | Description | Best For |
| :--- | :--- | :--- |
| **Layered (Controller-Service-Repo)** | Horizontal layering by technical concern. | 85% of standard REST APIs and enterprise SaaS. |
| **Clean / Hexagonal (Ports & Adapters)** | Core domain at center; technical drivers on outside. | Complex domain logic, multi-input systems (HTTP + Kafka + CLI). |
| **Vertical Slice Architecture** | Organize code by feature (Feature folder: Handler + DB query). | High-velocity microservices with distinct independent features. |
| **CQRS (Command Query Responsibility Segregation)** | Separate read pipelines from write pipelines. | High read/write asymmetry (e.g., massive event-driven apps). |

---

## 13. Trade-offs

- **Layered vs Vertical Slice Architecture**:
  - *Layered*: High structure, consistent organization across large teams. However, adding a single feature requires editing 3 different folders (`controllers/`, `services/`, `repositories/`).
  - *Vertical Slice*: Everything needed for a feature lives in one file/folder. However, without strong discipline, common business logic can be duplicated across slices.

---

## 14. Real-World Usage

- **NestJS Framework**: Enforces Controller-Service-Repository architecture natively via TypeScript decorators (`@Controller()`, `@Injectable()`).
- **Banking & Fintech Services**: Strictly separates accounting ledgers (Repository) from transfer authorization rules (Service) and REST API endpoints (Controller).

---

## 15. Placement Interview Questions

### 15.1 Basic Questions
1. *What are the three core layers in the Controller-Service-Repository pattern and what are their duties?*
   - Answer: The Controller handles HTTP transport, parses inputs, and returns responses. The Service contains pure business logic, calculations, and orchestration. The Repository encapsulates data access and database queries.
2. *Why should the Service layer never import Express `Request` or `Response` objects?*
   - Answer: Because doing so couples the core business logic to the HTTP transport protocol and the Express framework. The service should be reusable across other entry points (WebSockets, background workers, CLI scripts) and testable without mocking HTTP objects.

### 15.2 Conceptual Questions
3. *What is the difference between a Domain Entity and a Data Transfer Object (DTO)?*
   - Answer: A DTO is a passive data structure used solely to carry data across boundaries (such as from a client HTTP request to a controller). A Domain Entity is a model within the business domain that possesses identity, business validation rules, and lifecycle methods.
4. *How does the Repository pattern facilitate Unit Testing?*
   - Answer: By abstracting database queries behind an interface (`IUserRepository`), unit tests can instantiate the Service with a mock in-memory repository. This allows developers to test complex business logic instantly without setting up or seeding a live database.

### 15.3 Implementation Questions
5. *Show how to construct and wire a Controller, Service, and Repository using manual constructor injection.*
   - Answer:
     ```typescript
     const userRepo = new PrismaUserRepository(prismaClient);
     const userService = new UserService(userRepo);
     const userController = new UserController(userService);

     app.post("/users", userController.createUser);
     ```

### 15.4 Debugging Questions
6. *A unit test for a service is failing with `TypeError: Cannot read properties of undefined (reading 'status')`. What architectural flaw does this indicate?*
   - Answer: It indicates that the service is attempting to call `res.status()`. The developer passed Express's `res` object into the service instead of returning a pure value and letting the controller handle the response.

### 15.5 Scenario Questions
7. *Your team needs to support both a REST API and a Kafka event consumer that execute the exact same user onboarding logic. How does layered architecture solve this without code duplication?*
   - Answer: Both the Express Controller and the Kafka Message Consumer invoke the same `UserOnboardingService`. The Express Controller extracts data from `req.body`, while the Kafka Consumer extracts data from the Kafka message payload. Both pass the pure DTO to `onboardingService.onboardUser()`. Zero business logic is duplicated.

### 15.6 Advanced Questions
8. *How do you handle multi-table ACID database transactions across multiple repositories within the Service layer?*
   - Answer: Use the **Unit of Work** pattern or pass a transaction context object. For example, with Prisma, the service initiates `prisma.$transaction(async (tx) => { await repoA.update(tx, ...); await repoB.insert(tx, ...); })`. The repositories accept an optional transaction client parameter to execute their queries within the caller's transaction scope.

---

## 16. Coding Questions

### Problem 1: Unit Test a Business Service by Mocking its Repository
**Question**: Write a Jest-compatible unit test for a `BillingService` that awards a discount only if the user has been active for more than 365 days. Test this business rule without connecting to a real database.

```typescript
// billing-test.ts

// 1. Interfaces & Types
export interface Customer {
  id: string;
  name: string;
  registeredAt: Date;
}

export interface ICustomerRepository {
  findById(id: string): Promise<Customer | null>;
}

// 2. Service to Test
export class BillingService {
  constructor(private customerRepo: ICustomerRepository) {}

  async calculateDiscount(customerId: string, orderTotal: number): Promise<number> {
    const customer = await this.customerRepo.findById(customerId);
    if (!customer) throw new Error("Customer not found");

    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    // Business rule: 15% discount for customers registered over 1 year
    const isLoyalCustomer = customer.registeredAt < oneYearAgo;
    return isLoyalCustomer ? orderTotal * 0.15 : 0;
  }
}

// 3. The Unit Test using Mock Repository
async function runUnitTest() {
  // Mock Repository returning a customer registered 2 years ago
  const mockRepo: ICustomerRepository = {
    findById: async (id: string) => ({
      id,
      name: "Veteran User",
      registeredAt: new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000), // 2 years ago
    }),
  };

  const service = new BillingService(mockRepo);
  const discount = await service.calculateDiscount("cust_123", 200);

  // Assertion: 15% of 200 = 30
  if (discount === 30) {
    console.log(" Unit Test Passed: Loyal customer received 15% ($30) discount!");
  } else {
    console.error(`❌ Unit Test Failed: Expected 30, got ${discount}`);
  }
}

runUnitTest();
```

---

## 17. Common Interview Traps

- **Trap 1**: "Is a Repository required for every single database table?"
  - *Reality*: No. Repositories should be designed around **Aggregate Roots** (Domain-Driven Design), not raw database tables. For example, an `Order` aggregate repository can manage both `orders` and `order_items` tables together.
- **Trap 2**: "Should Controllers contain validation logic?"
  - *Reality*: Controllers (or validation middleware preceding them) handle **syntactic** validation (e.g. is `email` a valid email format, is `age` a number). **Semantic** business validation (e.g. does an account have enough funds, is this order already fulfilled) belongs exclusively in the **Service** layer.
- **Trap 3**: "Can Services call other Services?"
  - *Reality*: Yes! A higher-level orchestration service (e.g., `CheckoutService`) frequently coordinates lower-level domain services (e.g., `InventoryService`, `PaymentService`, `NotificationService`).

---

## 18. Revision Summary

- **Controller**: Translates HTTP $\leftrightarrow$ DTOs; zero business logic; zero direct SQL queries.
- **Service**: Houses pure business logic and transaction boundaries; transport-agnostic (never touches `req`/`res`).
- **Repository**: Encapsulates persistence (SQL/NoSQL/ORM); returns domain entities.
- **Dependency Flow**: Controller $\rightarrow$ Service $\rightarrow$ Repository Interface.
- **Primary Benefit**: High testability via repository mocking, protocol flexibility, and elimination of duplicated domain rules.

---

## 19. Quick Reference

```typescript
// Controller
class UserController {
  constructor(private userService: UserService) {}
  create = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const user = await this.userService.register(req.body);
      res.status(201).json(user);
    } catch (err) { next(err); }
  };
}

// Service
class UserService {
  constructor(private userRepo: IUserRepository) {}
  async register(dto: RegisterDTO) {
    if (await this.userRepo.findByEmail(dto.email)) throw new Error("Exists");
    return this.userRepo.create(dto);
  }
}

// Repository
class UserRepository implements IUserRepository {
  async create(data: any) { return prisma.user.create({ data }); }
}
```
