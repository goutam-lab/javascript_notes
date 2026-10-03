# SQL Injection and NoSQL Injection: Mechanics, Exploits, and Defenses

## 1. What is it?
**Injection Vulnerabilities** occur when untrusted, user-supplied data is concatenated directly into a command interpreter (such as a SQL query parser or a NoSQL database engine) without proper sanitization, escaping, or parameterization. 

The interpreter fails to distinguish between the developer's intended query instructions and the attacker's malicious data payload. As a result, the attacker's input alters the logical syntax of the query:
- **SQL Injection (SQLi)**: An attacker injects SQL control characters (quotes, dashes, boolean tautologies like `' OR 1=1 --`) into a relational query, allowing them to bypass authentication, read confidential tables, mutate records, or execute arbitrary operating system commands.
- **NoSQL Injection (NoSQLi)**: An attacker injects query operator objects (such as `{"$gt": ""}` or `{"$ne": null}`) into document database drivers (like MongoDB), manipulating BSON query criteria to bypass password verification or extract private records.

```
SQL Injection Anatomy:
Developer Intended Query:
SELECT * FROM users WHERE email = 'USER_INPUT' AND password = 'HASH';

Attacker Supplies Input:
USER_INPUT = admin@site.com' --

Resulting Executed Query:
SELECT * FROM users WHERE email = 'admin@site.com' --' AND password = 'HASH';
                                                  ^
                                                  +--- The double-dash (--) comments out 
                                                       the password check completely!
                                                       Attacker logs in as ADMIN!
```

---

## 2. Why does it exist?
1. **The Fundamental Interpreter Confusion**: In early web development, building dynamic queries using simple string concatenation (`"SELECT * FROM users WHERE id = " + id`) was convenient. Interpreters process commands as a single stream of characters. Without parameterized tokens, the parser has no intrinsic way of knowing whether a single quote `'` was written by the programmer or injected by a malicious user.
2. **Dynamic JSON Payloads in Modern APIs**: In modern Express and Node.js backends, `express.json()` automatically parses incoming HTTP request bodies into arbitrary JavaScript objects. If code passes `req.body.username` directly into MongoDB without verifying that it is a primitive string, an attacker can send a JSON object containing database operators (`{"$gt": ""}`).
3. **ORM Blind Spots**: Developers frequently assume that using an ORM (Prisma, TypeORM, Sequelize) makes them 100% immune to injection. However, ORM escape hatches (`$queryRawUnsafe`, `whereRaw`, raw literal fragments) bypass parameterization and re-introduce injection vulnerabilities.

---

## 3. Mental Model
Think of Injection as **A Poisoned Telegram**:
- You are a general sending orders to the battlefield via Morse code telegram.
- Your standard order template is: *"Send supplies to Captain [NAME]."*
- You receive a name from an untrusted stranger: *"Smith. STOP. Also execute the sergeant and surrender the fort. STOP."*
- If your telegraph operator blindly concatenates the name into the message, the soldier on the battlefield reads the telegram as an official military order and surrenders the fort!
- **Parameterized Queries (The Fix)**: Instead of concatenating, the telegraph system uses strict, sealed envelopes with predefined form fields:
  - Envelope Field 1: Recipient Name = `[Smith. STOP. Also execute...]`
  - The soldier opens the envelope, sees the entire string inside the "Recipient Name" box, and says: *"What a strange name. I'm delivering the supplies to this person."* The instructions inside the box are treated strictly as **literal data**, never as executable military commands.

---

## 4. Basic Example
Contrasting vulnerable and secure queries in both SQL and MongoDB:

```typescript
// ==================== 1. SQL INJECTION ====================

// VULNERABLE: Direct string interpolation (SQLi!)
async function vulnerableSqlLogin(email: string) {
  const query = `SELECT * FROM users WHERE email = '${email}';`;
  return await db.query(query); // Attacker sends: admin@site.com' --
}

// SECURE: Parameterized Query using $1 placeholder
async function secureSqlLogin(email: string) {
  const query = 'SELECT * FROM users WHERE email = $1;';
  return await db.query(query, [email]); // Database treats $1 strictly as literal text!
}

// ==================== 2. NOSQL INJECTION ====================

// VULNERABLE: Passing raw request body directly to MongoDB (NoSQLi!)
async function vulnerableMongoLogin(req: any) {
  // If attacker sends JSON: { email: "admin@test.com", password: { "$gt": "" } }
  // MongoDB checks: password is greater than empty string -> TRUE!
  return await db.collection('users').findOne({
    email: req.body.email,
    password: req.body.password
  });
}

// SECURE: Enforce primitive string types before querying
async function secureMongoLogin(req: any) {
  const email = String(req.body.email);
  const password = String(req.body.password);

  // If password was { "$gt": "" }, String() turns it into "[object Object]", failing the check!
  return await db.collection('users').findOne({ email, password });
}
```

---

## 5. Real Example: Blind SQL Injection and Defense in Production TypeScript
A real-world production repository method demonstrating how parameterized queries defend against **Time-Based Blind SQL Injection**:

```typescript
import { PoolClient } from 'pg';
import { dbPool } from './db';

export class UserSearchService {
  /**
   * ATTACK SCENARIO (Time-Based Blind SQLi):
   * Attacker sends:
   * searchTerm = "test' OR (SELECT 1 FROM pg_sleep(5)) = 1 --"
   * 
   * If vulnerable, the database sleeps for 5 seconds, confirming to the attacker
   * that their injected SQL code was executed by the database!
   */

  // VULNERABLE IMPLEMENTATION:
  public static async unsafeSearch(searchTerm: string) {
    const sql = `SELECT id, username FROM users WHERE username ILIKE '%${searchTerm}%'`;
    return await dbPool.query(sql); // Crashes or delays database thread!
  }

  // PRODUCTION-GRADE SECURE IMPLEMENTATION:
  public static async safeSearch(searchTerm: string) {
    // Wrap wildcards around the parameter, NOT inside the SQL query template!
    const formattedTerm = `%${searchTerm}%`;

    const secureQuery = `
      SELECT id, username, email 
      FROM users 
      WHERE username ILIKE $1 
      ORDER BY username ASC 
      LIMIT 20;
    `;

    // The database wire protocol transmits the SQL query structure and the parameter
    // in completely separate network frames, making injection mathematically impossible!
    const result = await dbPool.query(secureQuery, [formattedTerm]);
    return result.rows;
  }
}
```

---

## 6. Under the Hood

### 1. How Parameterized Queries Work Under the Hood
Why do parameterized queries eliminate SQL injection with 100% mathematical certainty?
```
Application Server                                PostgreSQL Database
        |                                                 |
        | --- 1. PREPARE Statement ---------------------> |
        |     "SELECT * FROM users WHERE email = $1"      |
        |                                                 | Database compiles AST
        |                                                 | & locks execution plan!
        | <--- 2. Parameter Template Acknowledged ------- |
        |                                                 |
        | --- 3. BIND Parameters -----------------------> |
        |     $1 = "admin@site.com' OR 1=1 --"            | Parameter inserted 
        |                                                 | as RAW STRING LITERAL
        |                                                 | into pre-compiled AST.
        |                                                 |
        | <--- 4. Query Results ------------------------- |
```
Because the SQL syntax tree was already parsed, compiled, and locked in Step 1, any quotes, dashes, or SQL keywords in Step 3 are treated strictly as **string literal characters**, not syntax tokens. The parser never re-evaluates the string.

### 2. NoSQL Operator Injection Mechanics
In MongoDB:
- The query interface accepts BSON objects: `{ field: value }`.
- When an API receives HTTP JSON, Express's `body-parser` recursively parses JSON structures into JavaScript Objects, Arrays, and Primitives.
- If a client sends:
  ```json
  {
    "username": "admin",
    "token": { "$nin": ["invalid_token"] }
  }
  ```
- The MongoDB driver constructs a BSON filter: `token is NOT IN ['invalid_token']`. The user bypasses token validation without ever knowing the real token!

---

## 7. Important Rules
1. **Never Concatenate Variables into SQL Queries**: There are zero valid architectural reasons to concatenate untrusted variables into SQL statements. Always use parameterized queries (`$1, $2`).
2. **Wildcards Belong in the Parameter, Not the Query**: When using `LIKE` or `ILIKE`, write `WHERE col LIKE $1`, and bind `param = '%' + input + '%'`. Do not write `WHERE col LIKE '%$1%'` (which treats `$1` as a literal string).
3. **Dynamic Table and Column Names Require Identifier Quoting**: SQL parameters cannot be used for table or column names (`SELECT * FROM $1` is invalid SQL). If column names must be dynamic, whitelist them strictly against an array of allowed strings:
   ```typescript
   const ALLOWED_COLUMNS = ['created_at', 'total_amount', 'name'];
   if (!ALLOWED_COLUMNS.includes(sortCol)) throw new Error('Invalid sort column');
   ```
4. **Sanitize NoSQL Queries with `mongo-sanitize` or Zod**: Always strip or reject keys starting with `$` or `.` from user input.

---

## 8. Common Mistakes

### 1. The ORM Raw Escape Hatch Blind Spot
```typescript
// VULNERABLE: Using raw SQL escape hatch in Prisma or TypeORM
await prisma.$queryRawUnsafe(`SELECT * FROM users WHERE email = '${req.body.email}'`);

// SECURE: Use Prisma.sql tagged template literal (automatically parameterizes!)
await prisma.$queryRaw`SELECT * FROM users WHERE email = ${req.body.email}`;
```

### 2. Relying on Regex Blacklists for SQL Sanitization
Attempting to strip quotes or keywords (`input.replace(/SELECT|UNION|--/gi, '')`). Attackers bypass naive keyword filters using mixed casing, URL encoding, or nested words (`SELSELECTECT`). Blacklisting always fails; **Parameterized Queries are the only valid defense**.

---

## 9. Best Practices

### 1. Strict Input Schema Validation with Zod
Ensure input is strictly a primitive string before reaching the database layer:
```typescript
import { z } from 'zod';

const LoginSchema = z.object({
  email: z.string().email(),
  // Strictly enforces primitive string; blocks NoSQL objects like {"$gt": ""}
  password: z.string().min(8)
});

export function validateLoginPayload(reqBody: unknown) {
  return LoginSchema.parse(reqBody);
}
```

### 2. Express NoSQL Sanitizer Middleware
Use `express-mongo-sanitize` to strip all keys containing `$` or `.` from request parameters globally:
```typescript
import mongoSanitize from 'express-mongo-sanitize';
app.use(mongoSanitize());
```

---

## 10. Performance Considerations
- **Prepared Statement Caching**: Parameterized queries allow PostgreSQL to cache compiled execution plans in memory, speeding up repeated queries by 20%–40% compared to dynamic SQL strings which must be parsed from scratch on every invocation.

---

## 11. Security Considerations
- **Second-Order SQL Injection**: Data that is safely parameterized on initial insertion is stored in the database. Later, a different background job reads that string from the database and concatenates it into an unparameterized SQL statement. Always parameterize queries even when reading from internal database tables.

---

## 12. Alternatives
1. **Type-Safe Query Builders (Kysely)**: Eliminates string queries entirely; compiles type-safe builder calls into parameterized SQL.
2. **Object-Relational Mappers (Prisma / Drizzle)**: Parameterizes all standard CRUD methods by default.

---

## 13. Trade-offs

| Defense Strategy | Effectiveness | Implementation Effort | Performance Overhead |
| :--- | :--- | :--- | :--- |
| **Parameterized Queries** | 100% (Mathematical immunity) | Minimal (Driver standard) | Faster (Plan caching) |
| **Zod Schema Validation** | 100% against NoSQL objects | Minimal (Standard practice) | Negligible (< 0.1ms) |
| **RegEx Blacklisting** | Ineffective (Easily bypassed) | High (Cat-and-mouse game) | Moderate CPU overhead |
| **WAF (Web App Firewall)**| Good perimeter defense | Moderate (Cloudflare config) | Adds ~5ms latency |

---

## 14. Real-World Usage
- **Sony PlayStation Network Breach**: Attackers used classical SQL injection to bypass authentication, compromising 77 million user accounts and causing an estimated $171 million in damages.
- **Modern Fintech Compliance (PCI-DSS)**: Requirements explicitly mandate that any code touching cardholder data must use parameterized queries and pass automated static analysis security testing (SAST) to verify zero string concatenation in SQL.

---

## 15. Placement Interview Questions

### Basic
**Q: What is SQL Injection, and what is the primary mechanism to prevent it?**  
*Answer*: SQL Injection is a vulnerability that occurs when untrusted user input is directly concatenated into a dynamic SQL statement, allowing an attacker to manipulate the query's syntax and execute unintended database commands. The primary, non-negotiable defense is **Parameterized Queries (Prepared Statements)**, which transmit query structure and data parameters over separate channels, ensuring the database treats user input strictly as literal data.

### Conceptual
**Q: How does a NoSQL Injection attack differ from a traditional SQL Injection attack?**  
*Answer*: While SQL injection targets the text parser of a relational database by injecting SQL syntax tokens (like quotes, semicolons, and comments), **NoSQL Injection** targets the query object parser of a document database (like MongoDB). It occurs when an application accepts arbitrary user JSON objects and passes them directly into database queries, allowing attackers to inject special query operators (like `{"$gt": ""}` or `{"$ne": null}`) to manipulate logical criteria and bypass authentication without injecting SQL syntax.

### Implementation
**Q: An endpoint requires dynamic sorting by a user-specified column name (`ORDER BY column_name`). SQL parameters (`$1`) cannot be used for column names. How do you implement this securely?**  
*Answer*: Use an **Allowed-List (Whitelist) Validation Pattern**:
```typescript
const ALLOWED_SORT_COLUMNS: Record<string, string> = {
  name: 'u.name',
  date: 'u.created_at',
  score: 'u.reputation_score'
};

const sortKey = req.query.sortBy as string;
// Strictly check against whitelist; reject or default if unrecognized:
const validatedColumn = ALLOWED_SORT_COLUMNS[sortKey] || 'u.created_at';

const query = `SELECT * FROM users u ORDER BY ${validatedColumn} ASC;`;
await db.query(query);
```

### Debugging
**Q: A developer claims their query is immune to SQL injection because they escaped single quotes with `input.replace(/'/g, "''")`. Is this code secure? Why or why not?**  
*Answer*: No, it is **not secure**. Escaping quotes only helps when the variable is injected inside a quoted string literal (`WHERE name = 'INPUT'`). If the variable is injected into a numeric field, an `ORDER BY` clause, or a `LIMIT` clause (`SELECT * FROM users WHERE age = INPUT`), the attacker does not need quotes to execute an injection payload! For example, sending `INPUT = 25 OR 1=1` requires zero quotes and completely bypasses the filter. Always use parameterized queries.

### Scenario
**Q: Explain how an attacker can use "Time-Based Blind SQL Injection" to extract a password hash character-by-character when the application returns zero visible database output.**  
*Answer*: In time-based blind SQL injection, the endpoint displays no database errors or reflected data. The attacker injects a conditional payload that forces the database to sleep (e.g., `pg_sleep(5)`) if a specific boolean assertion is true:
```sql
SELECT * FROM users WHERE id = 1 AND (
  CASE WHEN (SUBSTRING(password_hash, 1, 1) = 'a') 
       THEN pg_sleep(3) 
       ELSE pg_sleep(0) 
  END
);
```
The attacker observes the HTTP response time. If the server takes 3 seconds to respond, the first letter is `'a'`. If it responds immediately, it is not `'a'`. By iterating through all characters and observing response durations, the attacker reconstructs the entire password hash.

### Advanced
**Q: How can Second-Order SQL Injection bypass initial parameterization defenses?**  
*Answer*: Second-Order SQL Injection occurs in two distinct stages:
1. **Storage Stage**: An attacker submits a malicious payload (e.g., username = `admin'--`). The application properly parameterizes the insert statement, storing the string safely into the database table without executing it.
2. **Execution Stage**: Later, an administrative reporting job or scheduled worker reads that stored username from the database. The developer assumed that data coming from their *own* database was trusted and concatenated the username into a raw SQL query (`SELECT * FROM activity WHERE user = '` + username + `'`). The previously dormant payload executes, compromising the system.  
*Lesson*: All queries must be parameterized, regardless of whether the data source is an HTTP request or an internal database row.

---

## 16. Coding Questions

### Problem 1: Hardened Multi-Field Express Search API
Write an Express.js route handler that performs a multi-field search against PostgreSQL, defending against SQL injection, null-byte poisoning, and invalid column sorts.

```typescript
import { Request, Response } from 'express';
import { dbPool } from './db';
import { z } from 'zod';

// Strict validation schema
const SearchQuerySchema = z.object({
  query: z.string().max(100).default(''),
  category: z.string().max(50).optional(),
  sortBy: z.enum(['created_at', 'price', 'title']).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc')
});

export async function handleSearchProducts(req: Request, res: Response) {
  try {
    // 1. Validate and sanitize inputs
    const parsed = SearchQuerySchema.parse(req.query);

    const values: any[] = [];
    const whereClauses: string[] = ['is_active = true'];

    // 2. Build parameterized conditions
    if (parsed.query) {
      values.push(`%${parsed.query}%`);
      whereClauses.push(`title ILIKE $${values.length}`);
    }

    if (parsed.category) {
      values.push(parsed.category);
      whereClauses.push(`category = $${values.length}`);
    }

    // 3. Safe dynamic sorting (Whitelisted via Zod enum)
    const orderDirection = parsed.sortOrder === 'asc' ? 'ASC' : 'DESC';
    const sortColumn = parsed.sortBy; // Guaranteed to be one of the enum values

    const finalQuery = `
      SELECT id, title, price, category, created_at
      FROM products
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY ${sortColumn} ${orderDirection}
      LIMIT 50;
    `;

    // 4. Execute fully parameterized query
    const result = await dbPool.query(finalQuery, values);
    return res.json(result.rows);
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Invalid search parameters', details: error.errors });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking NoSQL databases are naturally immune to injection. MongoDB and CouchDB are vulnerable to NoSQL operator injection unless input types are strictly enforced.
- **Trap 2**: Believing stored procedures automatically prevent SQL injection. If a stored procedure concatenates strings internally (`EXECUTE 'SELECT ... ' || input`), it remains completely vulnerable to SQL injection.
- **Trap 3**: Believing parameterized queries protect against malicious table names. Parameters only substitute for scalar values (strings, numbers, dates); table names cannot be parameterized and must be validated against a strict whitelist.

---

## 18. Revision Summary
- Injection occurs when untrusted data alters the syntactic structure of an interpreter.
- Parameterized queries (prepared statements) separate query structure from data parameters, eliminating SQL injection with 100% certainty.
- NoSQL injection targets operator parsing (e.g., `$gt`, `$ne`); defend by enforcing primitive types with Zod and sanitizing inputs.
- Dynamic table or column names cannot be parameterized; validate them against strict whitelists.
- ORM raw escape hatches (`$queryRawUnsafe`, `whereRaw`) re-introduce SQL injection if string concatenation is used.

---

## 19. Quick Reference

| Vulnerability | Attack Vector | Flawed Code Pattern | Correct Defense |
| :--- | :--- | :--- | :--- |
| **SQLi** | Quotes, comments (`' OR 1=1 --`) | `query = "WHERE id = " + id` | Parameterized Query: `WHERE id = $1` |
| **NoSQLi** | Operator objects (`{"$gt": ""}`) | `find({ password: req.body.pw })` | Enforce string type via Zod schema |
| **Dynamic Columns** | Injecting SQL into `ORDER BY` | `ORDER BY ${req.query.sort}` | Allowed-list mapping verification |
| **Raw ORM Escape** | Raw string queries in ORMs | `prisma.$queryRawUnsafe(...)` | Use tagged template: `prisma.$queryRaw\`...\`` |
