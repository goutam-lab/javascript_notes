# Dependency Injection and Inversion of Control in Node.js

---

## 1. What is it?

**Inversion of Control (IoC)** is a software engineering design principle in which the custom-written portions of a computer program receive the flow of control from a generic, reusable framework or runtime, rather than calling the framework directly. 

**Dependency Injection (DI)** is the primary design pattern used to achieve Inversion of Control for object dependencies. Instead of an object constructing its own dependencies internally using the `new` operator (e.g., `this.db = new PostgresDatabase()`), the dependencies are supplied ("injected") from the outside by an external caller or composition root.

This pattern directly implements the **Dependency Inversion Principle (DIP)**—the "D" in the SOLID principles:
> *High-level modules should not depend on low-level modules. Both should depend on abstractions. Abstractions should not depend on details; details should depend on abstractions.*

```
+-------------------------------------------------------------------------------+
|                       TIGHT COUPLING vs DEPENDENCY INJECTION                  |
+-------------------------------------------------------------------------------+
| TIGHTLY COUPLED (Without DI):                                                 |
|   [ OrderService ] ----------------- new() -----------------> [ MySQLDatabase]|
|   * OrderService is permanently glued to MySQL. Cannot test without live DB. |
+-------------------------------------------------------------------------------+
| INVERSION OF CONTROL (With Dependency Injection):                             |
|   [ OrderService ] ----> Depends on: [ IDatabase (Interface) ]                |
|                                                     ^                         |
|                                                     | Implements              |
|   [ Composition Root ] -- Injects --> [ PostgresDB ] or [ MockDatabase ]      |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?

Consider a service that sends SMS notifications to users:

```typescript
// ❌ TIGHTLY COUPLED DISASTER
import { TwilioClient } from "twilio";

export class NotificationService {
  private twilio: TwilioClient;

  constructor() {
    // Instantiates its own concrete dependency internally!
    this.twilio = new TwilioClient(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
  }

  async notify(phone: string, msg: string) {
    await this.twilio.messages.create({ to: phone, body: msg });
  }
}
```

This code has critical architectural flaws:
1. **Unusable in Unit Tests**: Running a unit test for `notify()` triggers real HTTP requests to Twilio, charging your company's credit card and failing in offline CI/CD pipelines.
2. **Brittle Mocking**: The only way to test this class is via runtime module monkey-patching (`jest.mock('twilio')`), which is fragile, alters global Node module caches, and masks type errors.
3. **Rigid Vendor Lock-in**: If Twilio experiences an outage or your business decides to switch to AWS SNS or SendGrid, you must modify the internal source code of `NotificationService`.

With Dependency Injection, `NotificationService` simply requires an `ISmsProvider` interface via its constructor. The application can supply Twilio in production, AWS SNS as a fallback, and an in-memory console logger during automated testing.

---

## 3. Mental Model

Visualize a **Smartphone and a Charging Port**:

- **Without DI (Hardwired Battery)**: Imagine buying a smartphone where the charging cable is soldered directly into the motherboard and permanently plugged into your bedroom wall outlet. You cannot charge the phone in your car, you cannot plug it into a laptop, and if the wire frays, the entire phone must be thrown into the garbage.
- **With DI (USB-C Port)**: The smartphone defines an abstraction (**USB-C Port**). It doesn't care whether the source of electricity is a wall socket, a portable power bank, a solar panel, or a car charger. Whatever provider you plug in from the outside (**Injected Dependency**) supplies the power.

---

## 4. Basic Example

### 4.1 Pure Constructor Injection (No Third-Party Libraries)
```typescript
// 1. Abstraction (Contract)
export interface IEmailService {
  sendEmail(to: string, subject: string, body: string): Promise<boolean>;
}

// 2. Concrete Production Implementation
export class SendGridEmailService implements IEmailService {
  async sendEmail(to: string, subject: string, body: string): Promise<boolean> {
    console.log(`[SendGrid API] Sending email to ${to}...`);
    return true;
  }
}

// 3. High-Level Consumer with Constructor Injection
export class UserService {
  // Dependency is injected via constructor!
  constructor(private emailService: IEmailService) {}

  async registerUser(email: string): Promise<void> {
    console.log(`Registering user ${email}...`);
    // Business logic...
    await this.emailService.sendEmail(email, "Welcome!", "Thanks for signing up!");
  }
}

// 4. Testing Implementation (Mock)
export class MockEmailService implements IEmailService {
  public sentEmails: { to: string; subject: string }[] = [];

  async sendEmail(to: string, subject: string, body: string): Promise<boolean> {
    this.sentEmails.push({ to, subject });
    return true; // Instant, zero network latency, zero cost!
  }
}
```

---

## 5. Real Example

### Production Composition Root with Lifecycle Scoping (Pure TypeScript DI Container)
In production applications, managing dependencies manually across 50 classes can lead to complex instantiation graphs. Here is a lightweight, type-safe DI Container with **Singleton** and **Transient** lifecycles:

```typescript
// di-container.ts

export type Factory<T> = (container: DIContainer) => T;
export type Lifetime = "SINGLETON" | "TRANSIENT";

interface ServiceDescriptor<T> {
  factory: Factory<T>;
  lifetime: Lifetime;
  instance?: T;
}

export class DIContainer {
  private registry = new Map<string, ServiceDescriptor<any>>();

  public register<T>(token: string, factory: Factory<T>, lifetime: Lifetime = "SINGLETON"): this {
    this.registry.set(token, { factory, lifetime });
    return this;
  }

  public resolve<T>(token: string): T {
    const descriptor = this.registry.get(token);
    if (!descriptor) {
      throw new Error(`Service token not registered: ${token}`);
    }

    if (descriptor.lifetime === "SINGLETON") {
      if (!descriptor.instance) {
        descriptor.instance = descriptor.factory(this);
      }
      return descriptor.instance;
    }

    // TRANSIENT: Create fresh instance every time
    return descriptor.factory(this);
  }
}

// -----------------------------------------------------------------------------
// Real Application Wiring in composition-root.ts
// -----------------------------------------------------------------------------
export interface IDatabase {
  query(sql: string): Promise<any[]>;
}

export class PostgresDatabase implements IDatabase {
  constructor(private connectionString: string) {}
  async query(sql: string) {
    return [{ id: 1, name: "Database Row" }];
  }
}

export class AccountRepository {
  constructor(private db: IDatabase) {}
  async getBalance(accountId: string) {
    return this.db.query(`SELECT balance FROM accounts WHERE id = '${accountId}'`);
  }
}

export class AccountService {
  constructor(private repo: AccountRepository) {}
  async checkSolvency(accountId: string) {
    const records = await this.repo.getBalance(accountId);
    return records.length > 0;
  }
}

// Bootstrapping the Container
export function buildContainer(): DIContainer {
  const container = new DIContainer();

  container.register<IDatabase>(
    "Database",
    () => new PostgresDatabase(process.env.DATABASE_URL || "postgres://localhost:5432"),
    "SINGLETON"
  );

  container.register<AccountRepository>(
    "AccountRepository",
    (c) => new AccountRepository(c.resolve<IDatabase>("Database")),
    "SINGLETON"
  );

  container.register<AccountService>(
    "AccountService",
    (c) => new AccountService(c.resolve<AccountRepository>("AccountRepository")),
    "TRANSIENT"
  );

  return container;
}

// Usage in server.ts
const container = buildContainer();
const accountService = container.resolve<AccountService>("AccountService");
accountService.checkSolvency("acc_42").then(console.log);
```

---

## 6. Under the Hood

### 6.1 The 3 Types of Dependency Injection
1. **Constructor Injection (Standard & Recommended)**: Dependencies are provided as parameters to the class constructor.
   - *Advantage*: Guarantees the object is always created in a fully valid, usable state. Fields can be marked `readonly` or `private`.
2. **Property / Field Injection**: Dependencies are assigned directly to class properties after instantiation (often via reflection or decorators like `@Inject()`).
   - *Disadvantage*: Objects can exist in a half-initialized, broken state if a dependency is omitted.
3. **Method Injection**: Dependencies are passed as parameters directly to a specific method.
   - *Use Case*: When a single method needs a transient utility (e.g., passing a database transaction handle `tx` to `repo.save(entity, tx)`).

### 6.2 Service Lifecycles
Understanding how long an injected instance lives is critical for memory management and thread safety:

```
+-------------------------------------------------------------------------------+
|                       DEPENDENCY LIFECYCLE SCOPES                             |
+-------------------------------------------------------------------------------+
| Scope      | Lifetime Behavior                     | Typical Example          |
+------------+---------------------------------------+--------------------------+
| Singleton  | One instance created per process;     | Database Connection Pool,|
|            | shared across all requests.           | Redis Client, Logger     |
+------------+---------------------------------------+--------------------------+
| Scoped     | One instance created per HTTP request;| Request-specific User,   |
|            | destroyed when response completes.    | DB Transaction handle    |
+------------+---------------------------------------+--------------------------+
| Transient  | Fresh instance created every time it  | Lightweight DTO parser,  |
|            | is resolved / requested.              | ephemeral calculations   |
+------------+---------------------------------------+--------------------------+
```

### 6.3 Pure DI vs Automated DI Containers (InversifyJS, NestJS, Awilix)
- **Pure DI (Manual DI)**: Wiring dependencies manually using standard `new` expressions in a single `main.ts` or `bootstrap.ts` file.
  - *Pros*: Zero external dependencies, 100% type-safe, simple call stacks, fast startup.
  - *Cons*: Boilerplate grows as the number of classes reaches hundreds.
- **DI Containers**: Libraries that use reflection (`reflect-metadata`) or proxy strings to automatically resolve the dependency graph.
  - *Pros*: Automatic wiring of deeply nested dependency trees.
  - *Cons*: Runtime reflection overhead, decorators pollute domain classes, errors happen at runtime instead of compile time.

---

## 7. Important Rules

1. **Always Favor Constructor Injection**: Never rely on property injection or setter methods unless working around circular dependencies.
2. **Keep the Composition Root at the Entry Point**: All `new` instantiations should happen in one place: the **Composition Root** (usually `server.ts` or `bootstrap.ts`). Domain classes, services, and controllers should never call `new` on other business classes.
3. **Depend on Abstractions, Not Concretions**: Declare constructor parameter types using TypeScript interfaces (`IPaymentProvider`), not concrete classes (`StripePaymentProvider`).
4. **Beware of State in Singletons**: A service registered as a Singleton is shared across all incoming concurrent HTTP requests. If you store request-specific data (e.g., `this.currentUserId = userId`) on a Singleton service, users will bleed state into each other's requests!

---

## 8. Common Mistakes

### Mistake 1: Storing Request State in Singleton Services
```typescript
// ❌ CRITICAL BUG: Race condition! User A overwrites User B's ID!
export class UserService {
  private currentUserId: string; // Singleton instance shared across all users!

  setUser(id: string) { this.currentUserId = id; }
  async getProfile() { return db.find(this.currentUserId); }
}

//  CORRECT: Pass userId as an explicit method argument
export class UserService {
  async getProfile(userId: string) { return db.find(userId); }
}
```

### Mistake 2: Service Locator Anti-Pattern
```typescript
// ❌ WRONG: Passing the entire container into the class hides dependencies!
export class OrderService {
  constructor(private container: DIContainer) {}

  async checkout() {
    // Hidden dependency! Cannot tell from constructor what OrderService needs!
    const db = this.container.resolve<IDatabase>("Database");
  }
}

//  CORRECT: Explicitly declare dependencies in the constructor
export class OrderService {
  constructor(private db: IDatabase) {}
}
```

---

## 9. Best Practices

1. **Use Interface Segregation**: Instead of a massive `IUserRepo` with 40 methods, split interfaces by consumer needs (`IUserReader` with `findById`, `IUserWriter` with `create`).
2. **Mock Interfaces in Unit Tests**: Never import a live database driver into a unit test. Create lightweight fake implementations adhering to the interface.
3. **Group Modules into Sub-Factories**: In large monolithic codebases, create sub-factories (`createAuthModule()`, `createBillingModule()`) to prevent the composition root from becoming a 2,000-line file.

---

## 10. Performance Considerations

```
+-------------------------------------------------------------------------------+
|                       DI RESOLUTION BENCHMARKS (100,000 Ops)                  |
+-------------------------------------------------------------------------------+
| Mechanism                             | Ops/Sec        | Overhead             |
+---------------------------------------+----------------+----------------------+
| Pure DI (`new Service(repo)`)         | 45,000,000/s   | Zero (Pure JIT)      |
| Custom Map-based DI Container         | 12,000,000/s   | Map lookup (< 80 ns) |
| Reflection / Metadata Container (IoC) | 1,800,000/s    | Reflection overhead  |
+---------------------------------------+----------------+----------------------+
```

- In pure Node.js, constructor instantiation is nearly instantaneous. Even with reflection-based DI containers, resolution typically occurs only once at server boot time (for Singletons), so runtime API latency impact is effectively zero.

---

## 11. Security Considerations

1. **Dependency Substitution Attacks**: If a DI container allows dynamic string-based service resolution driven by untrusted client inputs (`container.resolve(req.query.service)`), an attacker can trigger instantiation of internal administrative classes. Never resolve services from unvalidated user strings.
2. **Secret Leakage via Logging**: Be cautious when logging injected configuration objects. Ensure API secrets and database passwords are redacted when printing the dependency tree at boot time.

---

## 12. Alternatives

| Technique | Description | Best For |
| :--- | :--- | :--- |
| **Pure / Manual DI** | Plain TypeScript constructors and interfaces. | Microservices, libraries, clean codebases. |
| **Awilix** | Proxy-based DI container for JavaScript/Node. | Medium-to-large Express apps without decorators. |
| **InversifyJS** | Heavyweight, TypeScript decorator-based container. | Enterprise apps mirroring Java Spring/C# .NET. |
| **NestJS Built-in IoC** | Opinionated framework-level DI system. | Full-stack teams wanting an all-in-one ecosystem. |

---

## 13. Trade-offs

- **Manual DI vs Automated DI Framework (NestJS / Inversify)**:
  - *Manual DI*: 100% transparent, no runtime magic, zero third-party dependencies. However, you must write the wiring code manually.
  - *Automated DI Framework*: Decorator syntax reduces boilerplate. However, it locks you into the framework's decorators, requires `experimentalDecorators` and `emitDecoratorMetadata` in `tsconfig.json`, and inflates bundle size.

---

## 14. Real-World Usage

- **AWS SDK V3**: Uses middleware and injected HTTP handlers to allow developers to swap native Node `http` with custom HTTP/2 or mock transport clients during testing.
- **Stripe & PayPal SDKs**: Allow injecting custom logger and telemetry instances into the client constructor.

---

## 15. Placement Interview Questions

### 15.1 Basic Questions
1. *What is the difference between Inversion of Control (IoC) and Dependency Injection (DI)?*
   - Answer: Inversion of Control is a broad architectural design principle where the control of program execution and object creation is transferred from custom code to an external entity. Dependency Injection is a specific concrete design pattern used to implement IoC, where an object's dependencies are passed into it from the outside rather than created internally.
2. *What is Constructor Injection and why is it preferred over Property Injection?*
   - Answer: Constructor injection supplies all required dependencies as arguments to a class constructor during instantiation. It is preferred because it ensures the object is never created in an invalid, partially initialized state, and allows dependency properties to be made immutable (`readonly`).

### 15.2 Conceptual Questions
3. *How does Dependency Injection relate to the Dependency Inversion Principle (DIP)?*
   - Answer: The Dependency Inversion Principle states that high-level modules should depend on abstractions (interfaces) rather than concrete implementations. Dependency Injection is the mechanism that supplies the concrete implementation satisfying that interface at runtime, fulfilling the principle.
4. *What are the three common lifecycle scopes in DI containers and how do they differ?*
   - Answer:
     - **Singleton**: Exactly one instance is created and shared across the entire application lifetime.
     - **Scoped**: A new instance is created once per request (e.g. per HTTP request) and shared within that request context.
     - **Transient**: A brand-new instance is created every single time the dependency is requested.

### 15.3 Implementation Questions
5. *Demonstrate how to test a service without using `jest.mock()` by leveraging constructor injection.*
   - Answer:
     ```typescript
     const mockRepo: IUserRepository = {
       findById: async (id) => ({ id, name: "Test User" }),
       save: async () => {},
     };
     const service = new UserService(mockRepo);
     const result = await service.getUser("1");
     expect(result.name).toBe("Test User");
     ```

### 15.4 Debugging Questions
6. *A developer complains that two different route handlers are receiving different counters from an injected `MetricsService` that was intended to be a Singleton. What is the most likely cause?*
   - Answer: The developer registered the `MetricsService` with a `Transient` lifetime scope instead of `Singleton` in the DI container, or instantiated `new MetricsService()` independently in both route files instead of resolving the shared instance from the composition root.

### 15.5 Scenario Questions
7. *You need to support multiple payment gateways (Stripe, PayPal, Adyen) based on the user's country. How do you design this using Dependency Injection and the Strategy Pattern?*
   - Answer: Define a common interface `IPaymentGateway` with a `charge(amount, currency)` method. Implement concrete classes: `StripeGateway`, `PayPalGateway`, `AdyenGateway`. Create a `PaymentGatewayFactory` that is injected into `CheckoutService`. The factory inspects the user's country code and returns the appropriate `IPaymentGateway` implementation.

### 15.6 Advanced Questions
8. *What is the "Service Locator" anti-pattern and why is it considered dangerous compared to Dependency Injection?*
   - Answer: Service Locator passes a central registry/container into a class, and the class queries the locator for dependencies internally (e.g., `locator.get('db')`). It is an anti-pattern because it hides the class's real dependencies from callers, defeats compile-time safety, makes unit testing difficult (you must mock the locator itself), and tightly couples the class to the container framework.

---

## 16. Coding Questions

### Problem 1: Implement a Type-Safe Strategy Pattern via Dependency Injection
**Question**: Write a complete TypeScript implementation where an `OrderProcessor` dynamically receives a discount strategy (`IDiscountStrategy`) and a tax calculation strategy (`ITaxStrategy`) via constructor injection to compute the final order total.

```typescript
// strategy-di.ts

// 1. Interfaces
export interface IDiscountStrategy {
  applyDiscount(subtotal: number): number;
}

export interface ITaxStrategy {
  calculateTax(amount: number): number;
}

// 2. Concrete Implementations
export class PercentageDiscount implements IDiscountStrategy {
  constructor(private percent: number) {}
  applyDiscount(subtotal: number): number {
    return subtotal - subtotal * (this.percent / 100);
  }
}

export class FixedDiscount implements IDiscountStrategy {
  constructor(private amount: number) {}
  applyDiscount(subtotal: number): number {
    return Math.max(0, subtotal - this.amount);
  }
}

export class StandardVATTax implements ITaxStrategy {
  calculateTax(amount: number): number {
    return amount * 0.20; // 20% VAT
  }
}

// 3. High-Level Consumer with Injected Strategies
export class OrderProcessor {
  constructor(
    private discountStrategy: IDiscountStrategy,
    private taxStrategy: ITaxStrategy
  ) {}

  public calculateTotal(subtotal: number): { subtotal: number; discounted: number; tax: number; total: number } {
    const discounted = this.discountStrategy.applyDiscount(subtotal);
    const tax = this.taxStrategy.calculateTax(discounted);
    const total = discounted + tax;

    return { subtotal, discounted, tax, total };
  }
}

// 4. Verification Test
const order1 = new OrderProcessor(new PercentageDiscount(10), new StandardVATTax());
console.log("Order 1 (10% off + 20% VAT on 100):", order1.calculateTotal(100));
// 100 -> discounted 90 -> tax 18 -> total 108

const order2 = new OrderProcessor(new FixedDiscount(25), new StandardVATTax());
console.log("Order 2 ($25 off + 20% VAT on 100):", order2.calculateTotal(100));
// 100 -> discounted 75 -> tax 15 -> total 90
```

---

## 17. Common Interview Traps

- **Trap 1**: "Is Dependency Injection only possible with TypeScript decorators or libraries like NestJS/Inversify?"
  - *Reality*: Absolutely not! Pure Constructor Injection using plain TypeScript/JavaScript without any libraries or decorators is the simplest, fastest, and most robust form of Dependency Injection.
- **Trap 2**: "Does Dependency Injection increase runtime memory usage?"
  - *Reality*: In fact, it often **reduces** memory usage. By injecting singletons (like database connection pools or API clients) into multiple consumers, you avoid instantiating duplicate client instances across hundreds of routes.
- **Trap 3**: "Can interfaces be resolved at runtime in TypeScript DI containers?"
  - *Reality*: No! TypeScript interfaces are completely erased at compile time and do not exist in JavaScript runtime code. To resolve dependencies at runtime, containers must use string tokens (`"IUserService"`), symbols (`Symbol.for('IUserService')`), or abstract classes.

---

## 18. Revision Summary

- **Inversion of Control**: Framework calls custom code; dependencies are passed from outside.
- **Dependency Injection**: Design pattern where dependencies are supplied via constructor arguments.
- **Dependency Inversion Principle**: High-level and low-level modules both depend on abstractions (interfaces).
- **Core Benefits**: Painless unit testing without monkey-patching, loose coupling, swappable implementations.
- **Lifecycles**: Singleton (one per app), Scoped (one per request), Transient (one per resolution).

---

## 19. Quick Reference

```typescript
// 1. Define Contract
interface ICache {
  get(key: string): Promise<string | null>;
  set(key: string, val: string): Promise<void>;
}

// 2. Inject via Constructor
class ProductService {
  constructor(private cache: ICache) {}
}

// 3. Composition Root Wiring
const redisCache = new RedisCacheClient();
const productService = new ProductService(redisCache);
```
