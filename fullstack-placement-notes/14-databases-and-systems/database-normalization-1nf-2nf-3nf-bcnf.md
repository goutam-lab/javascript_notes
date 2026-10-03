# Database Normalization: 1NF, 2NF, 3NF, and BCNF

## 1. What is it?
**Database Normalization** is a systematic, mathematical database design technique pioneered by Edgar F. Codd that organizes relational schemas to eliminate data redundancy (duplicate information across rows) and undesirable operational anomalies (**Insertion**, **Update**, and **Deletion Anomalies**). 

The normalization process decomposes larger, unwieldy tables into smaller, well-structured, logically isolated tables linked by foreign key relationships. The progressive stages are known as **Normal Forms (NF)**:
1. **1NF (First Normal Form)**: Atomic values, unique column names, and no repeating groups.
2. **2NF (Second Normal Form)**: Must be in 1NF + no **partial functional dependencies** (every non-key attribute depends on the *entire* candidate key).
3. **3NF (Third Normal Form)**: Must be in 2NF + no **transitive functional dependencies** (non-key attributes depend *only* on candidate keys, never on other non-key attributes).
4. **BCNF (Boyce-Codd Normal Form)**: A stricter version of 3NF where for every functional dependency $X \to Y$, $X$ must be a **superkey**.

```
Progression of Database Normal Forms:
+-------------------------------------------------------------------+
| Unnormalized Data (Repeating groups, multi-valued fields)        |
+-------------------------------------------------------------------+
                                  |
                                  v
+-------------------------------------------------------------------+
| 1NF: Atomic attributes, primary key defined                       |
+-------------------------------------------------------------------+
                                  | (Remove Partial Dependencies)
                                  v
+-------------------------------------------------------------------+
| 2NF: No non-key attribute depends on a subset of composite key    |
+-------------------------------------------------------------------+
                                  | (Remove Transitive Dependencies)
                                  v
+-------------------------------------------------------------------+
| 3NF: No non-key attribute depends on another non-key attribute    |
+-------------------------------------------------------------------+
                                  | (Every determinant is a Superkey)
                                  v
+-------------------------------------------------------------------+
| BCNF: All functional dependencies have candidate keys on the LHS  |
+-------------------------------------------------------------------+
```

---

## 2. Why does it exist?
Unnormalized schemas suffer from three catastrophic operational anomalies:
1. **Update Anomaly**: If an employee's department manager is stored directly in every single employee row, updating the department manager requires updating 10,000 individual employee records. If the server crashes mid-update or an async job skips rows, the database enters an inconsistent state where two different managers are recorded for the same department.
2. **Insertion Anomaly**: If a table requires an `employee_id` to exist in the primary key, you cannot insert a brand-new department into the system until the first employee is hired into that department.
3. **Deletion Anomaly**: If the last employee in the "Research" department leaves the company and their employee row is deleted, the entire record of the "Research" department's existence (budget, department code, location) is accidentally erased from the database.

---

## 3. Mental Model
Think of Normalization as **Modularizing Monolithic Spaghetti Code**:
- **Unnormalized Table**: A single 5,000-line JavaScript file where user profile logic, payment handling, inventory counts, and shipping tracking are crammed into one global object. Changing a shipping tax rate might accidentally mutate a user's password.
- **1NF**: Splitting comma-separated strings (`"shoes, socks, shirt"`) into individual atomic variables.
- **2NF & 3NF**: Refactoring that giant monolithic object into dedicated, isolated single-responsibility classes (`User`, `Department`, `Order`, `Product`). 
- **The Bill Kent Motto for 3NF**: *"Each non-key attribute must provide a fact about the key, the whole key, and nothing but the key, so help me Codd."*

---

## 4. Basic Example
Transitioning through the stages from unnormalized data to 3NF in SQL:

```sql
-- UNNORMALIZED TABLE (Anti-Pattern: Comma-separated courses, duplicate student info)
-- StudentCourses: (student_id, student_name, student_email, enrolled_courses)

-- STEP 1: 1NF (Enforce atomicity and unique row identification)
CREATE TABLE student_courses_1nf (
  student_id INT NOT NULL,
  course_code VARCHAR(16) NOT NULL,
  student_name VARCHAR(128) NOT NULL,
  student_email VARCHAR(128) NOT NULL,
  course_name VARCHAR(128) NOT NULL,
  instructor_name VARCHAR(128) NOT NULL,
  PRIMARY KEY (student_id, course_code)
);
-- Flaw in 1NF: Partial Dependency! student_name depends ONLY on student_id, not course_code.

-- STEP 2: 2NF (Separate tables to eliminate Partial Dependencies)
CREATE TABLE students_2nf (
  student_id INT PRIMARY KEY,
  student_name VARCHAR(128) NOT NULL,
  student_email VARCHAR(128) NOT NULL
);

CREATE TABLE courses_2nf (
  course_code VARCHAR(16) PRIMARY KEY,
  course_name VARCHAR(128) NOT NULL,
  instructor_id INT NOT NULL,
  instructor_name VARCHAR(128) NOT NULL,
  instructor_office VARCHAR(64) NOT NULL
);

CREATE TABLE enrollments_2nf (
  student_id INT REFERENCES students_2nf(student_id),
  course_code VARCHAR(16) REFERENCES courses_2nf(course_code),
  enrolled_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (student_id, course_code)
);
-- Flaw in 2NF: Transitive Dependency! instructor_office depends on instructor_name/id, not course_code.

-- STEP 3: 3NF (Eliminate Transitive Dependencies by separating Instructors)
CREATE TABLE instructors_3nf (
  instructor_id SERIAL PRIMARY KEY,
  instructor_name VARCHAR(128) NOT NULL,
  instructor_office VARCHAR(64) NOT NULL
);

CREATE TABLE courses_3nf (
  course_code VARCHAR(16) PRIMARY KEY,
  course_name VARCHAR(128) NOT NULL,
  instructor_id INT REFERENCES instructors_3nf(instructor_id)
);
-- Now in 3NF: Every non-key column depends solely on its table's primary key!
```

---

## 5. Real Example: E-Commerce Schema Decomposition (Unnormalized to BCNF)
A production TypeScript / PostgreSQL data model demonstrating decomposition to eliminate all functional anomalies:

```typescript
/**
 * SCENARIO: An Order Invoicing Service.
 * Initial poorly designed table:
 * orders_raw(order_id, customer_id, customer_name, customer_city, zip_code, 
 *            product_id, product_name, product_price, quantity, store_id, store_manager)
 */

export const productionNormalizedSchemaSql = `
  -- 1. Customers Table (3NF/BCNF)
  CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name VARCHAR(128) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- 2. Geographical Zip Code Mapping (Eliminating Transitive Dependency: zip -> city)
  CREATE TABLE zip_codes (
    zip_code VARCHAR(16) PRIMARY KEY,
    city VARCHAR(64) NOT NULL,
    state VARCHAR(64) NOT NULL,
    country VARCHAR(64) NOT NULL
  );

  -- 3. Customer Addresses
  CREATE TABLE customer_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    street_line VARCHAR(255) NOT NULL,
    zip_code VARCHAR(16) NOT NULL REFERENCES zip_codes(zip_code)
  );

  -- 4. Products Master (3NF/BCNF)
  CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sku VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    current_price NUMERIC(12, 2) NOT NULL CHECK (current_price >= 0),
    is_active BOOLEAN DEFAULT TRUE
  );

  -- 5. Orders Master
  CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customers(id),
    shipping_address_id UUID NOT NULL REFERENCES customer_addresses(id),
    order_status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- 6. Order Line Items (Composite Key: order_id + product_id)
  -- Historical price is captured to preserve historical invoicing accuracy!
  CREATE TABLE order_items (
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    unit_price_at_purchase NUMERIC(12, 2) NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    PRIMARY KEY (order_id, product_id)
  );
`;
```

---

## 6. Under the Hood

### Formal Mathematical Foundations of Normalization

#### 1. Functional Dependency ($X \to Y$)
A functional dependency exists between two sets of attributes $X$ and $Y$ in relation $R$ if and only if each distinct value of $X$ determines exactly one value of $Y$.
- Example: In an employee database, `ssn -> (full_name, birth_date)`. If two tuples have identical `ssn`, they must have identical `full_name`.

#### 2. First Normal Form (1NF)
- **Mathematical Rule**: The domain of each attribute contains only atomic (indivisible) values, and no attribute contains relation-valued attributes or repeating groups.
- **Violation**: Storing arrays or comma-delimited strings like `"tag1,tag2,tag3"` in a single column without normalization (unless deliberately using JSONB for document storage).

#### 3. Second Normal Form (2NF)
- **Mathematical Rule**: Relation $R$ is in 1NF, and no non-prime attribute (an attribute not part of any candidate key) is functionally dependent on a **proper subset** of any candidate key.
- **Applies to**: Tables with **composite primary keys**. If candidate key is $(A, B)$, and functional dependency $A \to C$ exists, 2NF is violated because $C$ depends only on $A$, not the entire key $(A, B)$.
- **Resolution**: Move $(A, C)$ to a separate table where $A$ is the primary key.

#### 4. Third Normal Form (3NF)
- **Mathematical Rule**: Relation $R$ is in 2NF, and for every non-trivial functional dependency $X \to Y$, either:
  1. $X$ is a **superkey**, OR
  2. $Y$ is a **prime attribute** (member of a candidate key).
- **In English**: Eliminates transitive dependencies ($A \to B$ and $B \to C$, therefore $A \to C$). If `order_id -> zip_code` and `zip_code -> city`, `city` depends transitively on `order_id`. `city` must be decoupled into a geographical reference table.

#### 5. Boyce-Codd Normal Form (BCNF)
- **Mathematical Rule**: A relation is in BCNF if and only if for every non-trivial functional dependency $X \to Y$, $X$ is a **superkey**.
- **Difference from 3NF**: 3NF permits $X$ to not be a superkey *if* $Y$ is a prime attribute. BCNF removes this exception entirely.
- **Classic BCNF Violation**:
  - Relation: `ClassroomSchedule(student_id, course, instructor)`
  - Constraint 1: For each course, each student has one instructor: `(student_id, course) -> instructor`. Candidate key is `(student_id, course)`.
  - Constraint 2: Each instructor teaches only ONE course: `instructor -> course`.
  - In 3NF: This is valid because `course` is a prime attribute (part of the candidate key).
  - In BCNF: This is INVALID because `instructor` is the determinant on the LHS of `instructor -> course`, but `instructor` by itself is NOT a superkey.
  - Fix: Split into `CourseInstructor(instructor, course)` and `StudentInstructor(student_id, instructor)`.

---

## 7. Important Rules
1. **Normalization Eliminates Redundancy, Not Relationships**: Do not avoid normalization out of fear of JOINs; modern relational engines perform hash-joins and merge-joins on indexed integer/UUID foreign keys in sub-millisecond times.
2. **Never Normalize Historical Transaction Data (The "Invoice Trap")**: Invoices must preserve the exact price of an item *at the moment of sale*. If you normalize `unit_price` away to the `products` table, updating a product price from $10 to $15 tomorrow alters historical financial records from three years ago! Always store snapshot data in line-item tables.
3. **Primary Keys Must Be Immutable**: Surrogate keys (auto-incrementing integers or UUIDv7) provide stable anchors for normalized relational schemas, decoupling foreign keys from volatile business attributes like email or phone numbers.

---

## 8. Common Mistakes

### 1. Comma-Separated Values Anti-Pattern
```sql
-- TERRIBLE (Violates 1NF):
CREATE TABLE users (
  id INT PRIMARY KEY,
  name VARCHAR(100),
  favorite_genres VARCHAR(255) -- "Action,Comedy,Sci-Fi"
);
-- Querying requires slow table scans with LIKE '%Comedy%', 
-- and you cannot index individual genres or enforce referential integrity.
```

### 2. Over-Normalizing Low-Cardinality Lookups
Creating separate tables for trivial static states: a table for `genders`, a table for `order_status_types`, a table for `boolean_flags`. This creates unnecessary join complexity. Use native `ENUM` types or check constraints instead:
```sql
CREATE TYPE order_status AS ENUM ('PENDING', 'PROCESSING', 'SHIPPED', 'CANCELLED');
```

---

## 9. Best Practices
- **Target 3NF for OLTP**: For transactional backend applications (OLTP), 3NF is the gold standard. It guarantees maximum write consistency, zero duplication, and clean entity relationships.
- **Enforce Referential Integrity**: Always accompany normalized tables with explicit foreign key constraints:
  ```sql
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) 
    REFERENCES customers(id) ON DELETE RESTRICT
  ```
- **Use Indexing on Foreign Keys**: Relational databases do not automatically index foreign key columns (unlike primary keys). Always create explicit indexes on every foreign key column to prevent sequential scans during `JOIN` queries.

---

## 10. Performance Considerations
- **The JOIN Overhead**: Highly normalized schemas (5NF/6NF) require 8 to 12 joins to construct a single UI view. For high-throughput read-heavy APIs, excessive joins increase query planner compilation time and memory buffer usage.
- **Write Performance Benefit**: Normalization maximizes write performance because rows are compact and updates touch only a single record without propagating to hundreds of duplicate rows.

---

## 11. Security Considerations
- **Granular Access Control**: Normalized schemas allow fine-grained column and row-level security. You can grant an accounting role access to `payroll_salaries` while granting general managers access to `employees` without exposing sensitive salary data in the same row.

---

## 12. Alternatives
1. **Denormalization**: Intentionally introducing controlled redundancy in read-heavy OLTP or OLAP databases to eliminate expensive joins.
2. **Star / Snowflake Schema**: Used in Data Warehouses (OLAP, Snowflake, BigQuery) where tables are organized into centralized **Fact Tables** surrounded by denormalized **Dimension Tables**.
3. **Document NoSQL (MongoDB)**: Storing related data embedded as a single nested JSON document, prioritizing fast single-seek retrieval over strict normalization.

---

## 13. Trade-offs

| Dimension | Normalized (3NF/BCNF) | Denormalized / Unnormalized |
| :--- | :--- | :--- |
| **Write Performance** | Fast & Efficient (Writes 1 row) | Slower (Must update duplicate rows) |
| **Data Integrity** | Absolute (Zero anomalies) | Vulnerable to drift and inconsistency |
| **Read Complexity** | Requires SQL `JOIN` operations | Simple, single-table flat queries |
| **Storage Usage** | Minimal (Zero duplicated text) | High (Redundant columns across millions of rows) |
| **Ideal For** | OLTP (Banking, E-Commerce, ERP) | OLAP (Analytics, Reporting, High-Read Caches) |

---

## 14. Real-World Usage
- **ERP Systems (SAP / Salesforce)**: Maintain thousands of deeply normalized 3NF tables to ensure financial data, tax calculations, and personnel hierarchies remain rigorously synchronized without human error or update anomalies.
- **Healthcare Systems (Epic / Cerner)**: Medical patient records require strict 3NF/BCNF compliance to ensure patient allergies, blood types, and prescription dosages cannot exist in conflicting duplicate states.

---

## 15. Placement Interview Questions

### Basic
**Q: State the core difference between 1NF, 2NF, and 3NF.**  
*Answer*: 
- **1NF**: Ensures all column values are atomic and eliminates repeating groups/arrays.
- **2NF**: Achieves 1NF and eliminates **partial dependencies** (no non-key attribute depends on a partial composite primary key).
- **3NF**: Achieves 2NF and eliminates **transitive dependencies** (no non-key attribute depends on another non-key attribute; non-key attributes depend only on candidate keys).

### Conceptual
**Q: Why does a table with a single-column primary key automatically satisfy 2NF if it is already in 1NF?**  
*Answer*: 2NF specifically prohibits **partial functional dependencies**, where a non-key attribute depends on a proper subset of a candidate key. A proper subset of a key can only exist if the candidate key is **composite** (composed of two or more columns). If the primary key consists of only a single column, no subset exists; therefore, partial dependencies are mathematically impossible, and the table automatically satisfies 2NF.

### Implementation
**Q: What are the three database anomalies caused by poor normalization? Give an example of each.**  
*Answer*:
1. **Insertion Anomaly**: Inability to record an entity without adding an unrelated entity (e.g., cannot add a new course until a student enrolls in it).
2. **Update Anomaly**: Redundant data requires updating multiple rows for a single real-world change; if incomplete, data becomes inconsistent (e.g., updating a professor's email in only 4 out of 10 student enrollment records).
3. **Deletion Anomaly**: Deleting one record inadvertently erases completely unrelated critical information (e.g., deleting the last student enrolled in a class accidentally deletes the course description and credit hours).

### Debugging
**Q: A developer normalizes an `order_items` table by removing `unit_price`, arguing that `unit_price` can be retrieved by joining with `products.price`. Why is this a catastrophic bug?**  
*Answer*: This violates the principle of **historical point-in-time accuracy**. A product's price changes over time (inflation, sales, discounts). If `order_items` does not store the historical price at the moment the customer placed the order, joining to `products` means past customer invoices will dynamically change whenever the merchant updates product prices, invalidating accounting ledgers and tax records.

### Scenario
**Q: You are presented with a table: `DoctorShift(doctor_id, clinic_id, clinic_address)`. The composite primary key is `(doctor_id, clinic_id)`. Which normal form does this violate, and how do you normalize it?**  
*Answer*: It violates **2NF**. The candidate key is composite: `(doctor_id, clinic_id)`. However, `clinic_address` depends solely on `clinic_id` (a proper subset of the primary key), representing a **partial dependency**. To normalize to 2NF/3NF:
1. Create `Clinics(clinic_id PRIMARY KEY, clinic_address)`.
2. Create `DoctorShifts(doctor_id, clinic_id REFERENCES Clinics(clinic_id), PRIMARY KEY (doctor_id, clinic_id))`.

### Advanced
**Q: When is 3NF NOT in BCNF? Provide the exact formal condition and an illustrative example.**  
*Answer*: A table is in 3NF but violates BCNF when there is a non-trivial functional dependency $X \to Y$ where $X$ is NOT a superkey, but $Y$ is allowed because $Y$ is a prime attribute (part of a candidate key).  
*Example*: A relation `StudentAdvising(student_id, major, advisor_id)`.
- Constraints: 
  - Each student can have multiple majors, but only one advisor per major: `(student_id, major) -> advisor_id`. Candidate key: `(student_id, major)`.
  - Each advisor advises only ONE major: `advisor_id -> major`.
- In 3NF: Valid, because `major` is a prime attribute (part of the candidate key).
- In BCNF: Invalid, because `advisor_id` determines `major`, but `advisor_id` by itself is NOT a superkey. BCNF requires decomposition into `AdvisorMajor(advisor_id, major)` and `StudentAdvisor(student_id, advisor_id)`.

---

## 16. Coding Questions

### Problem 1: Normalizing a Denormalized Relational Spreadsheet
Given an unnormalized spreadsheet table `raw_student_scores`:

```sql
-- Unnormalized Input Table:
-- (student_name, student_roll, teacher_name, teacher_email, subject, score)

-- Convert to clean 3NF relational schema with proper primary keys and foreign keys:

CREATE TABLE teachers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL
);

CREATE TABLE subjects (
  code VARCHAR(16) PRIMARY KEY,
  title VARCHAR(128) NOT NULL,
  teacher_id INT NOT NULL REFERENCES teachers(id)
);

CREATE TABLE students (
  roll_number INT PRIMARY KEY,
  name VARCHAR(128) NOT NULL
);

CREATE TABLE exam_scores (
  student_roll INT NOT NULL REFERENCES students(roll_number),
  subject_code VARCHAR(16) NOT NULL REFERENCES subjects(code),
  score NUMERIC(5, 2) NOT NULL CHECK (score >= 0 AND score <= 100),
  PRIMARY KEY (student_roll, subject_code)
);
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking 3NF is always the absolute highest normal form. 4NF (eliminates multi-valued dependencies) and 5NF / PJNF (eliminates join dependencies) exist, but 3NF/BCNF is the standard stopping point for 99% of production OLTP systems.
- **Trap 2**: Confusing Candidate Keys with Primary Keys. A candidate key is any minimal superkey that uniquely identifies a row. The primary key is simply the specific candidate key selected by the database architect.
- **Trap 3**: Believing normalization should be pursued unconditionally. Over-normalizing high-read dashboards leads to 15-table joins that can destroy read latency; knowing when to denormalize is the hallmark of a senior engineer.

---

## 18. Revision Summary
- Normalization prevents insertion, update, and deletion anomalies while minimizing storage and duplicate data.
- **1NF**: Atomic attributes, no repeating groups.
- **2NF**: 1NF + no partial dependencies on composite keys.
- **3NF**: 2NF + no transitive dependencies (non-key columns depend strictly on candidate keys).
- **BCNF**: Every determinant in every functional dependency must be a superkey.
- **Mnemonic**: *"The key (1NF), the whole key (2NF), and nothing but the key (3NF), so help me Codd."*
- Always preserve point-in-time historical data (e.g., sale prices) in line item records.

---

## 19. Quick Reference

| Normal Form | Core Requirement | What It Eliminates |
| :--- | :--- | :--- |
| **1NF** | Atomic scalar values; unique column names | Multi-valued attributes, comma-separated lists |
| **2NF** | In 1NF; non-keys depend on entire candidate key | Partial dependencies on composite keys |
| **3NF** | In 2NF; non-keys depend only on candidate keys | Transitive dependencies ($A \to B \to C$) |
| **BCNF** | For every $X \to Y$, $X$ must be a superkey | Anomalies when candidate keys overlap |
| **Decomposition Rule** | Lossless-Join & Dependency-Preserving | Guarantees tables can be joined back with 0 data loss |
