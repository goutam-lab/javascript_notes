# Test-Driven Development (TDD): Red-Green-Refactor Workflow & Machine Coding Strategy

## 1. What is it?
**Test-Driven Development (TDD)** is an iterative software development methodology where automated tests are written **before** writing the corresponding production code. Popularized by Kent Beck as part of Extreme Programming (XP), TDD flips traditional development ("code first, test later") on its head.

The process is strictly governed by the canonical **Red-Green-Refactor Cycle**:
1. **Red**: Write a minimal automated test that describes a required behavior or specification. Run the test and watch it fail (proving the test works and the feature does not yet exist).
2. **Green**: Write the simplest, most direct production code required to make the test pass (even hardcoding values if necessary).
3. **Refactor**: Clean up the code, remove duplication, improve naming, apply architectural patterns, and optimize performance—while keeping all tests continuously green.

```
       ┌────────────────────────────────────────────────────────┐
       │                                                        │
       ▼                                                        │
┌──────────────┐          ┌────────────────┐          ┌─────────┴────┐
│   1. RED     │ ───────> │    2. GREEN    │ ───────> │  3. REFACTOR │
│  Write test  │          │ Write minimal  │          │ Clean code,  │
│  that FAILS  │          │ code to PASS   │          │ remove dupes │
└──────────────┘          └────────────────┘          └──────────────┘
```

---

## 2. Why does it exist?
Traditional "code-then-test" development routinely fails in enterprise teams for predictable human and technical reasons:

1. **"I'll write tests later" Lie**: Under sprint deadlines, developers skip writing tests once features appear to work manually, resulting in legacy codebases with 0% automated coverage.
2. **Untestable Architectures**: When code is written without testing in mind, developers tightly couple business logic to global state, database connections, and third-party SDKs. Writing tests retroactively requires painful, risky refactoring.
3. **Over-Engineering & Speculative Generality**: Writing tests first forces developers to focus strictly on actual requirements (YAGNI - "You Aren't Gonna Need It"), preventing them from building complex abstractions that are never used.
4. **Fear of Refactoring**: Without an exhaustive safety net of automated unit tests, developers are terrified of touching legacy code. TDD produces a living specification that enables aggressive, fearless refactoring.
5. **Machine Coding & Interview Superpower**: In 60-to-90-minute tech screening rounds (Uber, Atlassian, Swiggy), candidates who write tests first immediately demonstrate seniority, clear requirements comprehension, and bug-free execution to interviewers.

---

## 3. Mental Model: The TDD Triangulation
Think of TDD as **Navigating by Triangulation**:
- If you have zero points of reference, you are lost in open terrain.
- When you establish the first test ($T_1$), you have a single point of reference. You write minimal code to satisfy it (often returning a hardcoded constant).
- When you add a second test ($T_2$) with different parameters, the hardcoded value no longer suffices. You are forced to generalize the implementation to handle both cases.
- Through repeated triangulation, your production logic naturally converges on the correct, robust general algorithm without speculative bloat.

---

## 4. Basic Example: The Three Laws of TDD (Uncle Bob)

Robert C. Martin ("Uncle Bob") formulated the Three Laws of TDD:
1. You may not write any production code until you have written a failing unit test.
2. You may not write more of a unit test than is sufficient to fail (compilation failures are failures).
3. You may not write more production code than is sufficient to pass the currently failing test.

### Step-by-Step TDD Example: String Calculator

#### Cycle 1: Empty string returns 0
```typescript
// 1. RED (test/calculator.test.ts)
import { describe, it, expect } from 'vitest';
import { add } from '../src/calculator';

describe('String Calculator', () => {
  it('returns 0 for empty string', () => {
    expect(add('')).toBe(0);
  });
});
// Fails: add is not defined!
```

```typescript
// 2. GREEN (src/calculator.ts) - Minimal code to pass
export function add(numbers: string): number {
  return 0; // Hardcoded, but passes!
}
```

#### Cycle 2: Single number returns the number
```typescript
// 1. RED
it('returns number itself for single number', () => {
  expect(add('1')).toBe(1);
});
// Fails: expected 0 to be 1
```

```typescript
// 2. GREEN
export function add(numbers: string): number {
  if (!numbers) return 0;
  return parseInt(numbers, 10);
}
```

#### Cycle 3: Two comma-separated numbers return sum
```typescript
// 1. RED
it('returns sum of two comma-separated numbers', () => {
  expect(add('1,2')).toBe(3);
});
// Fails: expected 1 to be 3 (parseInt stops at comma)
```

```typescript
// 2. GREEN & 3. REFACTOR
export function add(numbers: string): number {
  if (!numbers) return 0;
  const parts = numbers.split(',');
  return parts.reduce((sum, n) => sum + parseInt(n, 10), 0);
}
```

---

## 5. Real-World Production Example: TDD in Machine Coding (In-Memory LRU Cache with TTL)

In top-tier placement machine coding rounds, you are often asked to implement a data structure like an **LRU (Least Recently Used) Cache with TTL support** within 60 minutes. Applying TDD is the fastest way to achieve clean, bug-free code.

### Step 1: Write Failing Contract Tests
```typescript
// lru-cache.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LRUCache } from './lru-cache';

describe('LRUCache with TTL', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('stores and retrieves a value', () => {
    const cache = new LRUCache<string, number>(2);
    cache.put('a', 100);
    expect(cache.get('a')).toBe(100);
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('evicts least recently used item when capacity is exceeded', () => {
    const cache = new LRUCache<string, number>(2);
    cache.put('a', 1);
    cache.put('b', 2);
    
    // Access 'a' so 'b' becomes least recently used
    cache.get('a');
    
    // Insert 'c', which should evict 'b'
    cache.put('c', 3);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined(); // Evicted!
    expect(cache.get('c')).toBe(3);
  });

  it('expires and removes item after TTL elapsed', () => {
    const cache = new LRUCache<string, string>(2);
    cache.put('session', 'xyz_token', 1000); // 1000ms TTL

    expect(cache.get('session')).toBe('xyz_token');

    // Fast-forward time by 1001ms
    vi.advanceTimersByTime(1001);

    expect(cache.get('session')).toBeUndefined(); // Expired!
  });
});
```

### Step 2: Implement Production Code to Satisfy All Tests
```typescript
// lru-cache.ts
interface CacheEntry<V> {
  value: V;
  expiry?: number;
}

export class LRUCache<K, V> {
  private capacity: number;
  private map: Map<K, CacheEntry<V>>;

  constructor(capacity: number) {
    if (capacity <= 0) throw new Error('Capacity must be greater than 0');
    this.capacity = capacity;
    this.map = new Map();
  }

  public get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;

    // Check TTL expiration
    if (entry.expiry !== undefined && Date.now() > entry.expiry) {
      this.map.delete(key);
      return undefined;
    }

    // Refresh LRU ordering: delete and re-insert at end of Map keys
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  public put(key: K, value: V, ttlMs?: number): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // Evict oldest item (first key in JavaScript Map iterator)
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      }
    }

    const expiry = ttlMs !== undefined ? Date.now() + ttlMs : undefined;
    this.map.set(key, { value, expiry });
  }

  public size(): number {
    return this.map.size;
  }
}
```

---

## 6. Under the Hood: Why TDD Drives Better Software Design

```
Traditional Development:
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ Write Big    │ ───> │ Try to test  │ ───> │ Realize code │ ───> Despair & Mocks
│ Code Base    │      │ retroactively│      │ is coupled   │
└──────────────┘      └──────────────┘      └──────────────┘

TDD Workflow:
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ Write Small  │ ───> │ Code MUST be │ ───> │ Natural DI & │ ───> Modular, Clean,
│ Test First   │      │ callable now │      │ Single Resp. │      Decoupled Code
└──────────────┘      └──────────────┘      └──────────────┘
```

Because you are forced to instantiate and invoke your function/class before writing it, you naturally adopt:
1. **Dependency Injection**: It is impossible to test code tightly bound to `new PostgresConnection()` or `axios.get()`, so you naturally pass dependencies as constructor arguments.
2. **Single Responsibility Principle (SRP)**: Functions that do too much are painful to write unit tests for. You naturally decompose massive procedures into small, pure functions.
3. **Clear API Ergonomics**: You experience your code as a client/consumer before you experience it as an author.

---

## 7. Important Rules

1. **Never Skip the RED Phase**: You must see the test fail first. If you write a test and it passes immediately without any code changes, your test is either asserting nothing, testing the wrong file, or the feature already exists.
2. **Keep the Cycle Short (1 to 5 Minutes)**: TDD is not "write 50 tests for 3 hours, then write code for 3 hours." A cycle should take minutes: write 1 assertion, make it pass, refactor, repeat.
3. **Do Not Test Trivial Code**: Do not write tests for standard getters, setters, or one-line pass-through wrappers. Test domain logic, edge cases, invariants, and state transitions.
4. **Refactoring is Mandatory, Not Optional**: The "Green" phase is about getting to working code as fast as possible (even with messy or naive code). The "Refactor" phase is where you pay down design debt. Never leave a cycle without evaluating whether the code can be made clearer.
5. **Separate Interface from Implementation**: Test what the component *does*, not *how* it does it. If you refactor from an array to a hash map internally, your public tests should not change.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Testing Implementation Details Instead of Contracts
```typescript
// ❌ BAD: Tightly coupled to internal implementation
it('calls internal _calculateTaxRate method', () => {
  const spy = vi.spyOn(service as any, '_calculateTaxRate');
  service.processOrder();
  expect(spy).toHaveBeenCalled(); // Fails if private method is refactored!
});

// ✅ GOOD: Test observable input/output contract
it('calculates final invoice total with 10% tax applied', () => {
  const result = service.processOrder({ subtotal: 100 });
  expect(result.total).toBe(110);
});
```

### 2. The Premature Generalization Trap
Writing massive abstract class hierarchies during the first Green cycle before a second test case even justifies the abstraction. Follow the rule of three: generalize only when you have three concrete instances requiring identical behavior.

### 3. Writing Tests in Bulk Before Running
Writing 20 test cases all at once. When you run the test runner, 18 tests fail with syntax errors or compilation crashes, leaving you overwhelmed with stack traces. Write **one** test, pass it, then move to the next.

---

## 9. Best Practices

- **Use Descriptive Test Names**: Follow the `Given - When - Then` or `Should - When` naming convention:
  ```typescript
  it('should return 401 Unauthorized when Authorization header is missing', async () => { ... });
  it('should deduct balance and create audit log when withdrawal succeeds', async () => { ... });
  ```
- **Use Test Parameterization (`test.each`)**:
  ```typescript
  test.each([
    { input: 'racecar', expected: true },
    { input: 'hello', expected: false },
    { input: 'A man a plan a canal Panama', expected: true },
  ])('isPalindrome("$input") -> $expected', ({ input, expected }) => {
    expect(isPalindrome(input)).toBe(expected);
  });
  ```
- **Mock Time for Deterministic Tests**: When testing timeouts, intervals, or TTL expirations, use `vi.useFakeTimers()` and `vi.advanceTimersByTime(ms)`. Never use `await new Promise(r => setTimeout(r, 2000))` in unit tests!

---

## 10. Performance Considerations

- **Vitest Watch Mode (`vitest --watch`)**: Leverages Vite's hot-module-replacement (HMR) dependency graph. When you save a file, Vitest only re-runs the specific test files that directly or indirectly import that modified file, executing in <50ms.
- **Fast Feedback Loop**: If your TDD unit suite takes more than 5 seconds to run, developers will stop running it on every save. Keep unit tests in pure memory with zero network or filesystem I/O.

---

## 11. Security Considerations

- **Negative Testing for Security Boundaries**: In TDD, writing negative security tests is just as important as happy paths:
  - Test SQL injection characters in search inputs (`' OR 1=1 --`).
  - Test integer overflow and negative numbers in financial calculations (`transferAmount: -500`).
  - Test excessively long payloads to verify buffer protection.

---

## 12. Comparison: TDD vs. Test-After vs. BDD

| Dimension | Test-Driven Development (TDD) | Traditional Test-After | Behavior-Driven Development (BDD) |
| :--- | :--- | :--- | :--- |
| **When Tests are Written** | Before production code | After production code | Before production code |
| **Focus** | Developer unit design & logic | Post-hoc code verification | Business requirements & user stories |
| **Language/Grammar** | Code-first (`describe`, `it`, `expect`) | Code-first | Plain English (`Given`, `When`, `Then`) |
| **Design Impact** | High (drives modular code) | Low (adapts to existing code) | High (aligns product with tech) |
| **Common Tools** | Vitest, Jest | Jest, Mocha | Cucumber, Playwright BDD |

---

## 13. Trade-offs

- **Short-Term Speed vs. Long-Term Velocity**: TDD feels 20–30% slower on Day 1 because you are writing twice as much code before seeing a UI. By Month 3, TDD is 200% faster because you spend zero time in painful manual regression testing or debugging mysterious side-effects.
- **Prototyping / Spikes**: When exploring an unknown API or library where the design is completely uncertain, pure TDD can be frustrating. Solution: Use a **Spike Solution** (write exploratory throwaway code without tests), throw it away, and then implement the clean version with TDD.

---

## 14. Real-World Usage Case Studies

1. **Fintech / Payment Systems (Stripe, Adyen)**: Core ledger and currency transaction engines are built strictly with TDD. Financial math errors or state machine concurrency bugs have direct legal and monetary penalties.
2. **Machine Coding Rounds (Google, Uber, Swiggy, Cred)**: Top candidates in machine coding assessments begin by clarifying requirements, writing 5–6 test cases covering edge cases (empty inputs, concurrency, capacity limits), and systematically writing the class until all tests turn green.

---

## 15. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: What are the three phases of the TDD cycle, and what happens in each?**
> **Answer**:
> 1. **Red**: Write an automated test that fails because the feature or bug fix does not yet exist.
> 2. **Green**: Write the minimal code necessary to make the test pass as quickly as possible.
> 3. **Refactor**: Clean up the code, eliminate duplication, improve variable names, and optimize design while ensuring all tests stay green.

### Tier 2: Conceptual
**Q: Why is hardcoding a return value acceptable during the "Green" phase of TDD?**
> **Answer**: Hardcoding values (e.g., returning `0` or `true`) proves that your test runner is correctly connected to your production function and that the test assertion is valid. It prevents speculative over-engineering. You are then forced to write a second, more specific test that breaks the hardcoded value, compelling you to introduce the true general logic through triangulation.

### Tier 3: Implementation
**Q: How do you handle external dependencies like databases or third-party APIs when practicing TDD on business logic?**
> **Answer**: Use **Dependency Inversion** and **Test Doubles**:
> Define interfaces for the external dependency (e.g., `PaymentGateway`, `UserRepository`). In production, inject the real implementation. In your unit tests, inject an in-memory stub or mock (`vi.fn()`). This keeps unit tests running in memory in under 2ms without external network latency.

### Tier 4: Debugging
**Q: You wrote a unit test for a function, but the test passes during the "Red" phase before you wrote any implementation code. What does this mean?**
> **Answer**:
> 1. The test assertion is flawed (e.g., asserting `expect(true).toBe(true)` or missing an `await` on an async function).
> 2. The test is importing an existing module or mock instead of the new code under development.
> 3. The feature or edge case is already covered by existing codebase logic.
> You must investigate and ensure the test genuinely tests new functionality and fails for the right reason before proceeding.

### Tier 5: Scenario
**Q: In a 60-minute machine coding round, you are asked to implement a "Rate Limiter". How do you structure your time using TDD?**
> **Answer**:
> 1. **Minutes 0–10 (Requirements & Interface)**: Clarify rules (e.g., Sliding Window, 100 req/min per IP). Define the TypeScript interface (`IRateLimiter.allowRequest(ip): boolean`).
> 2. **Minutes 10–20 (Write Failing Test Suite)**: Write test cases in Vitest: single request allowed, multiple requests within limit allowed, request exceeding limit rejected, window expiration replenishing quota (using fake timers).
> 3. **Minutes 20–45 (Green Phase)**: Implement the algorithm (e.g., Map of timestamps). Run tests continuously until all turn green.
> 4. **Minutes 45–55 (Refactor)**: Clean up memory leak risks (pruning old timestamps), extract helper methods.
> 5. **Minutes 55–60 (Showcase to Interviewer)**: Run `npm test` demonstrating 100% green passing tests and walk the interviewer through edge-case coverage.

### Tier 6: Advanced
**Q: How do you apply TDD to asynchronous event-driven code involving message queues or WebSockets without creating race conditions in tests?**
> **Answer**:
> 1. Decompose the architecture: Test the event handler logic as a pure unit function independently of the transport layer.
> 2. For the integration layer, avoid arbitrary `sleep` timeouts. Use deterministic polling primitives:
> ```typescript
> await vi.waitFor(() => {
>   expect(receivedMessages).toContainEqual(expectedPayload);
> }, { timeout: 1000, interval: 50 });
> ```
> 3. Use in-memory event emitters (`EventEmitter`) or test harnesses that record dispatched events in a synchronous array.

---

## 16. Coding Question: TDD Implementation of a Banking Ledger with Transfer Invariants

### Problem
Using TDD, implement a `BankAccount` class and a `TransferService` with strict business invariants:
1. Cannot deposit negative or zero amounts.
2. Cannot withdraw more than current balance (no overdraft).
3. Transfer between two accounts must be atomic (if account A has insufficient funds, account B must not receive money).

### Solution

```typescript
// BankAccount.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { BankAccount, TransferService, InsufficientFundsError, InvalidAmountError } from './BankAccount';

describe('BankAccount & TransferService (TDD)', () => {
  let accountA: BankAccount;
  let accountB: BankAccount;
  let transferService: TransferService;

  beforeEach(() => {
    accountA = new BankAccount('acc_1', 1000); // $10.00
    accountB = new BankAccount('acc_2', 500);  // $5.00
    transferService = new TransferService();
  });

  it('initializes account with correct balance', () => {
    expect(accountA.getBalance()).toBe(1000);
  });

  it('deposits valid amount', () => {
    accountA.deposit(500);
    expect(accountA.getBalance()).toBe(1500);
  });

  it('throws InvalidAmountError on negative or zero deposit', () => {
    expect(() => accountA.deposit(-100)).toThrow(InvalidAmountError);
    expect(() => accountA.deposit(0)).toThrow(InvalidAmountError);
  });

  it('withdraws valid amount within balance', () => {
    accountA.withdraw(400);
    expect(accountA.getBalance()).toBe(600);
  });

  it('throws InsufficientFundsError when withdrawal exceeds balance', () => {
    expect(() => accountA.withdraw(1500)).toThrow(InsufficientFundsError);
    expect(accountA.getBalance()).toBe(1000); // Balance unchanged
  });

  it('transfers funds atomically between two accounts', () => {
    transferService.transfer(accountA, accountB, 300);
    expect(accountA.getBalance()).toBe(700);
    expect(accountB.getBalance()).toBe(800);
  });

  it('fails transfer and maintains original balances if source has insufficient funds', () => {
    expect(() => transferService.transfer(accountA, accountB, 5000)).toThrow(InsufficientFundsError);
    expect(accountA.getBalance()).toBe(1000);
    expect(accountB.getBalance()).toBe(500);
  });
});

// ==========================================
// Production Implementation (BankAccount.ts)
// ==========================================

export class InvalidAmountError extends Error {
  constructor(message = 'Amount must be greater than zero') {
    super(message);
    this.name = 'InvalidAmountError';
  }
}

export class InsufficientFundsError extends Error {
  constructor(message = 'Insufficient funds for transaction') {
    super(message);
    this.name = 'InsufficientFundsError';
  }
}

export class BankAccount {
  constructor(
    public readonly id: string,
    private balanceCents: number
  ) {
    if (balanceCents < 0) throw new InvalidAmountError('Initial balance cannot be negative');
  }

  public getBalance(): number {
    return this.balanceCents;
  }

  public deposit(amountCents: number): void {
    if (amountCents <= 0) {
      throw new InvalidAmountError();
    }
    this.balanceCents += amountCents;
  }

  public withdraw(amountCents: number): void {
    if (amountCents <= 0) {
      throw new InvalidAmountError();
    }
    if (amountCents > this.balanceCents) {
      throw new InsufficientFundsError();
    }
    this.balanceCents -= amountCents;
  }
}

export class TransferService {
  public transfer(source: BankAccount, destination: BankAccount, amountCents: number): void {
    // Check invariants first before modifying state
    source.withdraw(amountCents); // Throws InsufficientFundsError if balance insufficient
    destination.deposit(amountCents);
  }
}
```

---

## 17. Common Interview Traps

- **Trap 1**: Skipping the "Refactor" step in interviews.
  *Gotcha*: Once tests turn green, candidates often say "I'm done!". Interviewers want to see how you optimize, extract constants, handle variable naming, and remove code smells.
- **Trap 2**: Modifying both production code and test code at the same time.
  *Gotcha*: If you change both simultaneously, you lose the safety baseline. When tests fail, you won't know whether the bug is in the test or the production code.
- **Trap 3**: Writing tests that depend on the order of execution.
  *Gotcha*: Every test must be completely isolated. Never allow test 2 to assume test 1 created an object in a global variable.

---

## 18. Revision Summary

- **TDD Core Cycle**: **Red** (failing test) $\rightarrow$ **Green** (minimal code to pass) $\rightarrow$ **Refactor** (clean design while green).
- **Three Laws of TDD**: Write tests before code, write only enough test to fail, write only enough code to pass.
- **Benefits**: Eliminates fear of refactoring, prevents speculative over-engineering, creates living documentation, and naturally enforces modular, decoupled software architectures.
- **Machine Coding Edge**: Demonstrates seniority, clarity of thought, and bug-free precision under high-pressure interview constraints.

---

## 19. Quick Reference

| Phase | Goal | Allowed Actions |
| :--- | :--- | :--- |
| **RED** | Define requirement & contract | Write one minimal test; watch it fail. |
| **GREEN** | Make the test pass fast | Write simplest production code; hardcoding allowed. |
| **REFACTOR**| Clean up design & eliminate tech debt | Rename, extract functions, deduplicate; tests MUST stay green. |
| **Triangulation**| Generalize algorithms | Add second/third test case to eliminate hardcoded values. |
| **Fake Timers**| Deterministic time testing | `vi.useFakeTimers()` + `vi.advanceTimersByTime(ms)`. |
