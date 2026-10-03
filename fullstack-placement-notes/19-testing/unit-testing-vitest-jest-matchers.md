# Unit Testing: Vitest & Jest Test Runners, Matchers & Lifecycle Architecture

## 1. What is it?
**Unit Testing** is the automated verification of the smallest testable units of software—typically pure functions, methods, algorithmic classes, or state machines—in complete isolation from external dependencies (such as physical disks, databases, network sockets, or OS processes).

A **Test Runner** (such as **Vitest** or **Jest**) is the execution harness that discovers test files, establishes an isolated runtime sandbox (Node.js worker threads or VMs), executes test suites (`describe` blocks), evaluates assertions (`expect` matchers), records execution metrics (wall-clock latency, memory usage), and reports failure diagnostics.

```
                  Test File Discovery (*.test.ts / *.spec.ts)
                                      │
                                      ▼
             ┌──────────────────────────────────────────────────┐
             │ Test Runner Execution Engine (Vitest / Jest)     │
             │ - Worker Thread Pool (Piscina / Worker_Threads)  │
             │ - Source Transformation (esbuild / Vite HMR)     │
             │ - Isolation Sandbox & Global Mock Environment    │
             └────────────────────────┬─────────────────────────┘
                                      │
                ┌─────────────────────┴─────────────────────┐
                ▼                                           ▼
      ┌──────────────────┐                        ┌──────────────────┐
      │  Test Suite A    │                        │   Test Suite B   │
      │  describe('...') │                        │   describe('...')│
      │  ┌────────────┐  │                        │  ┌────────────┐  │
      │  │ beforeEach │  │                        │  │ beforeEach │  │
      │  │ it('...')  │  │                        │  │ it('...')  │  │
      │  │ afterEach  │  │                        │  │ afterEach  │  │
      │  └────────────┘  │                        │  └────────────┘  │
      └──────────────────┘                        └──────────────────┘
                │                                           │
                └─────────────────────┬─────────────────────┘
                                      ▼
                      Assertion Matchers Evaluation
                 expect(actual).toEqual(expectedValue)
                                      │
                                      ▼
                 Diagnostic Reporter (Console / JUnit / HTML)
```

---

## 2. Why does it exist?
Modern JavaScript/TypeScript applications require automated unit testing to avoid critical failure points:

1. **V8 Compilation & Silent Runtime Errors**: Unlike statically compiled languages (Rust, Go, C++) that catch syntax, type, and boundary bugs at compile time, JavaScript errors (`NaN`, `undefined is not a function`, silent type coercion) surface only when code executes. Unit testing executes every branch before deployment.
2. **Regression Prevention**: As codebases scale to hundreds of thousands of lines across dozens of engineers, changes in shared utility functions (date formatters, currency math, authentication token decoders) often break distant modules unnoticed.
3. **Execution Speed**: Unit tests execute in pure RAM within microseconds (often < 2 milliseconds per test). A suite of 5,000 unit tests can run in 3 seconds, enabling instant feedback during local development.
4. **Vitest over Jest (The Next-Gen Migration)**: Jest was designed around Babel and Webpack, requiring complex compilation steps (`ts-jest`), slow startup times, and high memory consumption. Vitest shares Vite's unified configuration, executes via lightning-fast `esbuild`, natively supports ESM, and provides instant Hot Module Replacement (HMR) watch mode.

---

## 3. Mental Model
Think of a Unit Test as a **Laboratory Precision Balance Scale**:
- **Setup (Arrange)**: You calibrate the scale to zero and place a clean container on it.
- **Action (Act)**: You pour an exact chemical compound (the input data) into the flask and apply a reagent (call the function).
- **Measurement (Assert)**: You compare the weight shown on the digital balance against the theoretical target:
  - If expected is `50.00g` and actual is `50.00g`, the test passes.
  - If it shows `49.80g`, the scale sounds an immediate alarm, displaying the exact delta.

---

## 4. Basic Example: Test Suites, Matchers & Async Testing

```typescript
// math-utils.ts
export function parseCurrency(amountStr: string): number {
  const cleaned = amountStr.replace(/[^0-9.-]+/g, '');
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) throw new Error('Invalid currency format');
  return Math.round(parsed * 100) / 100;
}

export async function fetchExchangeRate(currency: string): Promise<number> {
  if (currency === 'EUR') return 0.92;
  if (currency === 'INR') return 83.50;
  throw new Error(`Unsupported currency: ${currency}`);
}

// math-utils.test.ts
import { describe, it, expect } from 'vitest';
import { parseCurrency, fetchExchangeRate } from './math-utils';

describe('math-utils', () => {
  describe('parseCurrency()', () => {
    it('correctly parses dollar format string to float', () => {
      const result = parseCurrency('$1,249.99');
      // Primitive equality matcher
      expect(result).toBe(1249.99);
    });

    it('throws descriptive error on invalid string', () => {
      // Exception assertion matcher (must be wrapped in a function closure)
      expect(() => parseCurrency('invalid_abc')).toThrow('Invalid currency format');
    });
  });

  describe('fetchExchangeRate()', () => {
    it('resolves with exchange rate for supported currency', async () => {
      // Async Promise resolution matcher
      await expect(fetchExchangeRate('INR')).resolves.toBe(83.50);
    });

    it('rejects with error for unsupported currency', async () => {
      // Async Promise rejection matcher
      await expect(fetchExchangeRate('XYZ')).rejects.toThrow('Unsupported currency: XYZ');
    });
  });
});
```

---

## 5. Real-World Production Example: Complex Lifecycle, Deep Equality, Partial Matching & Custom Matchers

In production engineering, you test complex domain models with timestamps, nested arrays, and volatile identifiers.

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

interface AuditLog {
  id: string;
  userId: string;
  action: 'LOGIN' | 'LOGOUT' | 'PASSWORD_RESET';
  metadata: {
    ip: string;
    userAgent: string;
    sessionId?: string;
  };
  createdAt: Date;
}

class AuditService {
  private logs: AuditLog[] = [];

  public logEvent(userId: string, action: AuditLog['action'], ip: string, userAgent: string): AuditLog {
    const entry: AuditLog = {
      id: crypto.randomUUID(),
      userId,
      action,
      metadata: { ip, userAgent },
      createdAt: new Date(),
    };
    this.logs.push(entry);
    return entry;
  }

  public getLogsForUser(userId: string): AuditLog[] {
    return this.logs.filter((l) => l.userId === userId);
  }

  public clear(): void {
    this.logs = [];
  }
}

describe('AuditService Production Unit Tests', () => {
  let auditService: AuditService;

  // Lifecycle Hook: Runs before every single test
  beforeEach(() => {
    auditService = new AuditService();
    // Freeze time to a deterministic point
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
  });

  // Lifecycle Hook: Runs after every test
  afterEach(() => {
    vi.useRealTimers();
    auditService.clear();
  });

  it('records audit log with accurate metadata and frozen timestamp', () => {
    const log = auditService.logEvent('user_123', 'LOGIN', '192.168.1.1', 'Mozilla/5.0');

    // 1. Asymmetric / Partial Matching (Ignores random UUID, checks structure)
    expect(log).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        userId: 'user_123',
        action: 'LOGIN',
        metadata: {
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0',
        },
        createdAt: new Date('2026-01-01T12:00:00Z'),
      })
    );

    // 2. Array inspection matchers
    const userLogs = auditService.getLogsForUser('user_123');
    expect(userLogs).toHaveLength(1);
    expect(userLogs).toContainEqual(log);
  });

  it('filters logs strictly by requested userId', () => {
    auditService.logEvent('user_123', 'LOGIN', '10.0.0.1', 'Safari');
    auditService.logEvent('user_456', 'LOGOUT', '10.0.0.2', 'Chrome');

    const logs123 = auditService.getLogsForUser('user_123');
    const logs456 = auditService.getLogsForUser('user_456');

    expect(logs123).toHaveLength(1);
    expect(logs456).toHaveLength(1);
    expect(logs123[0].userId).toBe('user_123');
    expect(logs456[0].userId).toBe('user_456');
  });
});
```

---

## 6. Under the Hood: Equality Matchers Deep Dive (`toBe` vs `toEqual` vs `toStrictEqual`)

Understanding V8 object references and prototype chains is crucial when asserting in unit tests:

```
┌────────────────────────────────────────────────────────────────────────┐
│ toBe(expected)           -> Object.is(actual, expected)                │
│                             Compares PRIMITIVES or EXACT memory refs.  │
│                             expect({ a: 1 }).toBe({ a: 1 }) -> FAILS!  │
├────────────────────────────────────────────────────────────────────────┤
│ toEqual(expected)        -> Deep Value Equality Check                  │
│                             Recurses down object keys & array items.   │
│                             Ignores undefined fields & prototypes.     │
│                             { a: 1, b: undefined } == { a: 1 } -> PASS │
├────────────────────────────────────────────────────────────────────────┤
│ toStrictEqual(expected)  -> Strict Deep Equality Check                 │
│                             Checks prototype, class type, and checks   │
│                             explicit undefined keys.                   │
│                             { a: 1, b: undefined } != { a: 1 } -> FAIL│
└────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Important Rules

1. **Use `toBe` for Primitives, `toEqual` for Objects/Arrays**: Never use `toBe` to compare arrays, object literals, or class instances unless you are explicitly testing reference identity (`pointer1 === pointer2`).
2. **Wrap Throw Assertions in a Function Closure**:
   ```typescript
   // ❌ CRASHES TEST RUNNER: Code executes immediately before expect() can catch it!
   expect(myRiskyFunction()).toThrow();

   // ✅ CORRECT: Passed as a callback closure
   expect(() => myRiskyFunction()).toThrow();
   ```
3. **Always Clean Up Mocks & Timers in `afterEach`**: Failing to call `vi.clearAllMocks()`, `vi.restoreAllMocks()`, or `vi.useRealTimers()` in `afterEach` causes mock state or time warping to leak into subsequent tests, triggering mysterious cascading test failures.
4. **Order of Lifecycle Hooks**: Vitest/Jest executes lifecycle hooks in strict hierarchical order:
   - Global `beforeAll` $\rightarrow$ Suite `beforeAll` $\rightarrow$ Suite `beforeEach` $\rightarrow$ Test `it()` $\rightarrow$ Suite `afterEach` $\rightarrow$ Suite `afterAll` $\rightarrow$ Global `afterAll`.
5. **Never Leave Assertions Implicit**: Every test must have at least one explicit `expect` assertion. If testing that an async function does not throw, assert `await expect(promise).resolves.not.toThrow()`.

---

## 8. Common Mistakes & Anti-Patterns

### 1. The Missing `await` on Async Assertions
```typescript
// ❌ SILENT FALSE POSITIVE: Test finishes before promise rejects!
it('rejects on unauthorized', () => {
  expect(authService.login('bad_pw')).rejects.toThrow(); 
  // Missing 'await'! This test will PASS even if login succeeds or hangs!
});

// ✅ CORRECT:
it('rejects on unauthorized', async () => {
  await expect(authService.login('bad_pw')).rejects.toThrow();
});
```

### 2. Overwriting Global Stubs without Restoration
```typescript
// ❌ POLLUTES ENVIRONMENT FOR OTHER TEST SUITES
it('checks local storage', () => {
  (global as any).localStorage = { getItem: () => 'val' };
});

// ✅ CORRECT: Use vi.stubGlobal and vi.unstubAllGlobals()
it('checks local storage', () => {
  vi.stubGlobal('localStorage', { getItem: vi.fn().mockReturnValue('val') });
});
```

### 3. Multiple Unrelated Assertions in One Test
Putting 40 assertions testing 8 different business behaviors inside a single `it('tests everything')` block. When line 4 fails, lines 5–40 never run, masking other bugs and making root-cause analysis tedious.

---

## 9. Best Practices

- **Comprehensive Vitest Configuration (`vitest.config.ts`)**:
  ```typescript
  import { defineConfig } from 'vitest/config';

  export default defineConfig({
    test: {
      globals: true, // Auto-import describe, it, expect
      environment: 'node', // Or 'jsdom' for frontend
      clearMocks: true,
      restoreMocks: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        thresholds: {
          lines: 80,
          functions: 80,
          branches: 75,
          statements: 80,
        },
      },
    },
  });
  ```
- **Asymmetric Matchers for Dynamic Data**: Instead of hardcoding generated timestamps or IDs:
  ```typescript
  expect(userResponse).toEqual({
    id: expect.stringMatching(/^usr_[a-z0-9]+$/),
    email: 'test@example.com',
    createdAt: expect.any(Date),
  });
  ```

---

## 10. Performance Considerations

- **Vitest Thread Pool vs. Forks**: By default, Vitest runs tests in `tinypool` (worker threads) which share memory efficiently. If testing C++ native Node addons (like `bcrypt` or `sharp`) that are not thread-safe, switch to `pool: 'forks'`.
- **In-Source Testing**: Vitest supports writing unit tests directly inside the implementation file (like Rust):
  ```typescript
  export function sum(a: number, b: number) { return a + b; }

  if (import.meta.vitest) {
    const { it, expect } = import.meta.vitest;
    it('sum adds two numbers', () => {
      expect(sum(2, 3)).toBe(5);
    });
  }
  ```
  During production builds, Vite tree-shakes the `if (import.meta.vitest)` block completely, leaving zero runtime overhead.

---

## 11. Security Considerations

- **Testing Cryptographic Boundaries**: When unit-testing token generation or password hashing:
  - Verify that generated salts are cryptographically random (length, entropy).
  - Verify that sensitive credentials (passwords, JWT secrets) are stripped from returned user DTO objects (`expect(result).not.toHaveProperty('passwordHash')`).

---

## 12. Vitest vs. Jest Comparison Matrix

| Feature | Vitest | Jest |
| :--- | :--- | :--- |
| **Engine / Architecture** | Vite + esbuild (V8 native) | Babel / ts-jest / Webpack |
| **TypeScript Support** | Native out of the box (Instant) | Requires `ts-jest` or `@babel/preset-typescript` |
| **ESM Support** | First-class native ESM | Complex configuration (`experimental-vm-modules`) |
| **Watch Mode Speed** | Sub-millisecond via Vite HMR | Slower file-system polling |
| **API Compatibility** | 99% drop-in Jest API replacement | Original industry standard |
| **Monorepo / Multi-project** | Native workspace support | `projects` array configuration |

---

## 13. Trade-offs

- **Strict Mocks vs. Flexible Tests**: Setting `mockReset: true` and verifying exact call counts (`toHaveBeenCalledTimes(1)`) prevents unintended side-effects, but makes tests brittle when code is refactored to execute auxiliary operations (like non-blocking logging).
- **In-Memory JSDOM vs. Real Browser**: JSDOM allows unit testing React components in Node.js at blazing speed, but JSDOM does not calculate real CSS layouts, bounding client rects, or actual browser layout rendering.

---

## 14. Real-World Usage Case Studies

1. **Vite Ecosystem Migration**: Modern frameworks (SvelteKit, Nuxt 3, Remix, Astro) have migrated their entire test suites from Jest to Vitest, achieving a 4x–10x reduction in total CI test execution time.
2. **Stripe Node.js SDK**: Maintains thousands of isolated unit tests verifying API request serialization, error parsing, and idempotency header injection using Jest/Vitest matchers.

---

## 15. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: What is the difference between `toBe()` and `toEqual()` in Vitest/Jest?**
> **Answer**: `toBe()` uses `Object.is()` to test primitive values (numbers, strings, booleans) or strict memory reference identity for objects. `toEqual()` performs a deep value comparison across all enumerable properties of an object or array, ensuring that two separate objects in memory with identical key-value pairs are evaluated as equal.

### Tier 2: Conceptual
**Q: What is the purpose of `beforeEach` and `afterEach` lifecycle hooks?**
> **Answer**: They provide test isolation and state reset mechanisms. `beforeEach` runs before each individual test, ensuring fresh, uncontaminated state (e.g., instantiating new service instances, mocking timers). `afterEach` runs after each test, allowing developers to clean up resources, restore mocked globals, and clear recorded spy calls to prevent state leakage between tests.

### Tier 3: Implementation
**Q: How do you assert that an asynchronous function throws a specific custom error?**
> **Answer**: Use `await expect(asyncFunctionPromise).rejects.toThrow(ExpectedErrorClass)`:
> ```typescript
> await expect(authService.login('bad@test.com', 'wrong_pw'))
>   .rejects
>   .toThrow(InvalidCredentialsError);
> ```

### Tier 4: Debugging
**Q: A test file passes when run in isolation, but fails with `Error: Cannot spy on a primitive value` when running the entire test suite. What is the cause?**
> **Answer**: Another test file in the suite mocked or monkey-patched a global object (such as `Date.now`, `fetch`, or an imported module) and failed to restore it in `afterEach` using `vi.restoreAllMocks()` or `vi.unstubAllGlobals()`. The mutated object leaked into subsequent test files.

### Tier 5: Scenario
**Q: You need to unit test a function that sends a reminder email if an account is expiring within 3 days. How do you test this deterministically without waiting or risking date-related CI failures?**
> **Answer**:
> 1. Use fake timers: `vi.useFakeTimers()`.
> 2. Set the system time to a fixed reference date: `vi.setSystemTime(new Date('2026-06-01T00:00:00Z'))`.
> 3. Create test accounts with expiration dates at 2 days, 3 days, and 4 days relative to the fixed date.
> 4. Execute the reminder function.
> 5. Assert that accounts at 2 and 3 days trigger email sending, while the 4-day account is ignored.
> 6. Restore real timers in `afterEach`: `vi.useRealTimers()`.

### Tier 6: Advanced
**Q: How do Vitest and Jest implement isolated execution environments across worker threads, and what is the cost of module sandboxing?**
> **Answer**:
> Test runners use worker thread pools (`worker_threads`). For each test file, the runner spins up a fresh V8 context or resets module registries (`require.cache` or ESM module loaders). When a test file imports a module, the runner re-evaluates the module AST, giving each test file isolated global variables and fresh module-level state.
> The cost is **Evaluation Overhead**: re-evaluating heavy third-party libraries (such as large ORMs or React DOM) in every worker thread consumes substantial CPU and memory. Modern runners mitigate this via esbuild caching and selective module sharing.

---

## 16. Coding Question: Implement a Custom Matcher for Vitest/Jest

### Problem
In financial applications, currency amounts often suffer from floating point discrepancies (e.g., `0.1 + 0.2 = 0.30000000000000004`). Extend Vitest with a custom matcher `toBeCloseToCurrency(expected, precisionCents)` that verifies two monetary amounts are equal within a fractional penny threshold ($0.01).

### Solution

```typescript
// matchers/currency-matcher.ts
import { expect } from 'vitest';

interface CustomMatchers<R = unknown> {
  toBeCloseToCurrency(expected: number, maxDifferenceCents?: number): R;
}

declare module 'vitest' {
  interface Assertion<T = any> extends CustomMatchers<T> {}
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}

expect.extend({
  toBeCloseToCurrency(received: number, expected: number, maxDifferenceCents: number = 0.01) {
    const diff = Math.abs(received - expected);
    const pass = diff <= maxDifferenceCents;

    return {
      pass,
      message: () =>
        pass
          ? `Expected ${received} not to be within ${maxDifferenceCents} of ${expected}`
          : `Expected ${received} to be within ${maxDifferenceCents} of ${expected}, but difference was ${diff}`,
      actual: received,
      expected: expected,
    };
  },
});

// ==========================================
// Test Usage (calculator.test.ts)
// ==========================================
describe('Financial Calculations with Custom Matcher', () => {
  it('handles floating point currency math accurately', () => {
    const item1 = 19.99;
    const item2 = 0.10;
    const discount = 0.05;
    const total = (item1 + item2) - discount; // 20.04

    // Using our custom matcher
    expect(total).toBeCloseToCurrency(20.04);
    expect(total).not.toBeCloseToCurrency(25.00);
  });
});
```

---

## 17. Common Interview Traps

- **Trap 1**: Asserting `expect(NaN).toBe(NaN)`.
  *Gotcha*: In JavaScript, `NaN === NaN` is `false`! However, `Object.is(NaN, NaN)` is `true`. Vitest's `toBe(NaN)` uses `Object.is` and passes, but `toBeNaN()` is clearer and explicitly communicates intent.
- **Trap 2**: Modifying an object after asserting `toEqual`.
  *Gotcha*: In asynchronous tests, if you pass an object reference to an un-awaited background task and assert `toEqual`, mutation race conditions can alter the object while other tests are reading it.
- **Trap 3**: Believing `beforeAll` runs in a separate thread from tests.
  *Gotcha*: All tests within a single test file share the exact same worker process and memory space. Variables declared in the outer scope of a test file persist across all `it()` blocks unless explicitly reset in `beforeEach`.

---

## 18. Revision Summary

- **Test Runners**: Vitest is the modern standard for fast ESM and TypeScript testing; Jest remains widespread in legacy codebases.
- **Matchers**:
  - `toBe()`: Primitive values and reference equality.
  - `toEqual()`: Deep property and array value equality.
  - `toStrictEqual()`: Strict equality including prototypes and undefined keys.
  - `toThrow()`: Exception testing (must wrap target call in a function closure).
- **Lifecycle Discipline**: Always isolate test state with `beforeEach` and clean up mocks/timers in `afterEach`.
- **Async Handling**: Always `await` promises and `.resolves` / `.rejects` matchers.

---

## 19. Quick Reference

| Matcher / Utility | Purpose | Example |
| :--- | :--- | :--- |
| `toBe(val)` | Primitive / reference equality | `expect(2 + 2).toBe(4)` |
| `toEqual(obj)` | Deep object value equality | `expect(res).toEqual({ a: 1 })` |
| `toStrictEqual(obj)`| Checks prototype & undefined keys | `expect(u).toStrictEqual(new User())` |
| `toThrow(err)` | Verifies function throws error | `expect(() => fn()).toThrow(Error)` |
| `resolves / rejects`| Unwraps Promise for assertion | `await expect(p).resolves.toBe(1)` |
| `vi.useFakeTimers()`| Freezes system clock for determinism| `vi.advanceTimersByTime(1000)` |
| `expect.objectContaining()`| Partial shape matching | `expect(res).toEqual(expect.objectContaining({ id: 1 }))` |
