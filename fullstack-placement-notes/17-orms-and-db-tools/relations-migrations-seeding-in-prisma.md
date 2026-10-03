# Prisma Relations, Migrations, and Seeding Workflows

## 1. What is it?
In full-stack application development with Prisma, managing database evolution requires mastering three interconnected foundational workflows:
1. **Relational Modeling**: Expressing relational cardinality (**1-to-1**, **1-to-Many**, and **Many-to-Many**) using Prisma's declarative `@relation` syntax, composite primary keys, and referential actions (`onDelete`, `onUpdate`).
2. **Prisma Migrate (`prisma migrate dev` / `prisma migrate deploy`)**: A declarative migration engine that analyzes `schema.prisma`, compares it against a temporary **Shadow Database**, and generates versioned, pure SQL migration files stored in version control.
3. **Database Seeding (`prisma/seed.ts`)**: A repeatable, programmatic mechanism for populating development, testing, and staging databases with baseline structural data (admin accounts, configuration constants, sample products) using Prisma Client.

```
Prisma Migration & Seeding Lifecycle:
[ Edit schema.prisma ]
         |
         v  npx prisma migrate dev --name add_teams
[ Shadow Database ]  <=== Generates diff & verifies replayability
         |
         v
[ Creates ./prisma/migrations/20260301_add_teams/migration.sql ]
         |
         v
[ Applies to Local Development Database ]
         |
         v
[ Auto-triggers npx prisma db seed (Executes prisma/seed.ts) ]
         |
         v
[ Production CI/CD: npx prisma migrate deploy ]
```

---

## 2. Why does it exist?
1. **Bridging Declarative Schema with Relational SQL Foreign Keys**: In `schema.prisma`, relationships feel like simple object properties (`user.posts`). However, underneath, relational databases require foreign key constraints, unique indexes, and cascade delete rules. Prisma automatically generates the exact ANSI SQL `FOREIGN KEY` constraints needed on disk.
2. **Deterministic, Replay-Safe Migrations**: Without a tool like Prisma Migrate, developers make manual changes to local databases that are never recorded, resulting in schema drift and broken deployments. Prisma Migrate produces human-editable SQL files that can be reviewed in pull requests.
3. **Automated Shadow Database Validation**: Prisma prevents faulty migrations from reaching production by executing migrations against a temporary, ephemeral **Shadow Database** during development, catching syntax errors and constraint conflicts before touching your real development database.
4. **Reproducible Test Environments**: Seeding ensures that any engineer cloning the repository can run `npm run dev` and immediately have a working application populated with realistic mock data.

---

## 3. Mental Model
Think of Prisma Relations, Migrations, and Seeding as **Civil Engineering and City Planning**:
- **Relations (`@relation`)**: The architectural blueprint defining how bridges link islands (**Foreign Keys** between tables).
- **`prisma migrate dev`**: The construction team pouring concrete in sequential phases. Before pouring real concrete in the city, they test the formula on a scale test model (**The Shadow Database**) to ensure the bridge won't collapse. Once verified, they record the construction permit (**`migration.sql`**) in the city archive.
- **Seeding (`seed.ts`)**: Staging the newly constructed model home with display furniture, lamps, and books so potential buyers can experience the property before real tenants move in.

---

## 4. Basic Example
Modeling 1-to-1, 1-to-Many, and Many-to-Many relationships in `schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
  shadowDatabaseUrl = env("SHADOW_DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

// 1. ONE-TO-ONE (User <-> Profile)
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  profile   Profile? // Optional 1:1 relation
  posts     Post[]   // 1:Many relation
  teams     TeamMember[] // Explicit Many-to-Many via Join Model
}

model Profile {
  id      String @id @default(uuid())
  bio     String
  userId  String @unique // Unique foreign key enforces 1:1 constraint!
  user    User   @relation(fields: [userId], references: [id], onDelete: Cascade)
}

// 2. ONE-TO-MANY (User <-> Post)
model Post {
  id        String     @id @default(uuid())
  title     String
  authorId  String
  author    User       @relation(fields: [authorId], references: [id], onDelete: Cascade)
  categories Category[] // Implicit Many-to-Many
}

// 3. IMPLICIT MANY-TO-MANY (Post <-> Category)
// Prisma automatically creates and manages a hidden join table '_CategoryToPost'!
model Category {
  id    String @id @default(uuid())
  name  String @unique
  posts Post[]
}

// 4. EXPLICIT MANY-TO-MANY WITH METADATA (User <-> Team via TeamMember)
model Team {
  id      String       @id @default(uuid())
  name    String
  members TeamMember[]
}

model TeamMember {
  userId    String
  teamId    String
  role      String     @default("MEMBER")
  joinedAt  DateTime   @default(now())
  
  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  team      Team       @relation(fields: [teamId], references: [id], onDelete: Cascade)

  @@id([userId, teamId]) // Composite Primary Key!
}
```

---

## 5. Real Example: Production `seed.ts` Script in TypeScript
A production-grade seeding pipeline populating baseline admin accounts, permissions, and sample e-commerce data with upserts to guarantee idempotency:

```typescript
// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seed pipeline...');

  // 1. Seed Roles and Admin Account Idempotently using UPSERT
  const adminPasswordHash = await bcrypt.hash('AdminSecret2026!', 10);
  
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@platform.com' },
    update: {}, // If exists, do nothing
    create: {
      email: 'admin@platform.com',
      profile: {
        create: {
          bio: 'Platform System Administrator'
        }
      }
    }
  });

  console.log(`Verified admin account: ${adminUser.email}`);

  // 2. Seed Master Categories
  const categories = ['Electronics', 'Home & Kitchen', 'Books', 'Fitness'];
  for (const name of categories) {
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name }
    });
  }

  // 3. Seed Sample Team and Memberships
  const engineeringTeam = await prisma.team.create({
    data: {
      name: 'Core Platform Engineering',
      members: {
        create: [
          {
            userId: adminUser.id,
            role: 'LEAD'
          }
        ]
      }
    }
  });

  console.log(`Created team: ${engineeringTeam.name}`);
  console.log('✅ Seeding completed successfully.');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed with error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
```

---

## 6. Under the Hood

### 1. How Prisma Migrate Uses the Shadow Database
When you execute `npx prisma migrate dev --name my_change`:
```
Step 1: Prisma spins up / connects to the Shadow Database (a temporary clean DB).
Step 2: Replays ALL existing migrations in ./prisma/migrations sequentially from scratch.
Step 3: Compares the resulting schema of the shadow DB against your schema.prisma file.
Step 4: Computes the precise SQL diff.
Step 5: Generates a new timestamped migration.sql file.
Step 6: Applies the new migration.sql to your real development database.
Step 7: Records the migration checksum and timestamp in the _prisma_migrations table.
Step 8: Auto-executes npx prisma generate to update TypeScript types.
```
- **Why It Matters**: The Shadow Database detects **schema drift** immediately. If someone manually altered a column directly in PostgreSQL without creating a migration file, Prisma Migrate warns you before generating invalid SQL!

### 2. Implicit vs. Explicit Many-to-Many Relations
- **Implicit Many-to-Many**: You simply declare `posts Post[]` on Category, and `categories Category[]` on Post. Prisma automatically creates and manages a hidden table named `_CategoryToPost (A, B)`. You cannot add extra columns to this relationship.
- **Explicit Many-to-Many**: You explicitly create a model (e.g., `TeamMember` or `Enrollment`) containing foreign keys to both parent models and a composite primary key `@@id([userId, teamId])`. This is required when the relationship itself possesses attributes (e.g., `role`, `joinedAt`, `salary`).

### 3. Referential Actions (`onDelete` and `onUpdate`)
Prisma translates `@relation(..., onDelete: ...)` directly into ANSI SQL:
- **`Cascade`**: Deleting the parent automatically deletes all related child rows (`ON DELETE CASCADE`).
- **`Restrict`**: Prevents parent deletion if matching child rows exist, throwing a database constraint error (`ON DELETE RESTRICT`).
- **`SetNull`**: Sets the child foreign key column to `NULL` when the parent is deleted (`ON DELETE SET NULL`).
- **`NoAction`**: Standard database default; defers checks to transaction end.

---

## 7. Important Rules
1. **Never Run `prisma migrate dev` in Production or CI/CD**: `prisma migrate dev` is strictly an interactive development command that requires a shadow database and may prompt for database resets. In production, CI/CD, or staging environments, **always run `npx prisma migrate deploy`**.
2. **Configure `package.json` for Automated Seeding**: Prisma automatically looks for the `prisma.seed` configuration key in `package.json`:
   ```json
   "prisma": {
     "seed": "tsx prisma/seed.ts"
   }
   ```
3. **Use Idempotent Upserts in `seed.ts`**: Never write raw `create()` statements in seed scripts without unique checks. Re-running `npx prisma db seed` on an existing database should succeed without crashing on duplicate key violations.
4. **Cloud Database Shadow DB Configuration**: When developing against cloud databases (Supabase, Neon, AWS RDS), Prisma cannot automatically create arbitrary shadow databases because standard database users lack `CREATE DATABASE` privileges. You must supply a dedicated `shadowDatabaseUrl` in `schema.prisma`.

---

## 8. Common Mistakes

### 1. The Production `migrate dev` Disaster
Running `prisma migrate dev` on a production database during deployment. If Prisma detects even a slight schema drift, it prompts: `Do you want to reset the database? All data will be lost`. In a non-interactive shell, it can wipe the entire production database! Always use `prisma migrate deploy`.

### 2. Forgetting Foreign Key Indexes in 1-to-Many Relations
Defining `@relation(fields: [authorId], references: [id])` without adding `@@index([authorId])`. Relational databases do not automatically index foreign key columns! Without an explicit index, querying `prisma.post.findMany({ where: { authorId } })` causes full sequential table scans.

---

## 9. Best Practices

### 1. Composite Unique Constraints for Multi-Tenant Data
Ensure uniqueness per tenant rather than globally:
```prisma
model Document {
  id        String   @id @default(uuid())
  tenantId  String
  slug      String
  title     String

  // Slug must be unique ONLY within its specific tenant organization:
  @@unique([tenantId, slug])
  @@index([tenantId])
}
```

### 2. Baseline Migration for Existing Legacy Databases
If adopting Prisma on an existing, populated database:
```bash
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/0_init/migration.sql
npx prisma migrate resolve --applied 0_init
```
This records the existing structure without trying to re-execute table creation.

---

## 10. Performance Considerations
- **Cascade Deletes**: In PostgreSQL, `onDelete: Cascade` is executed natively inside the database engine at C speed. If you configure `relationMode = "prisma"` (used on PlanetScale or distributed engines), Prisma simulates cascade deletes by fetching all child IDs and running multiple `DELETE` statements over the network from Node.js, which is significantly slower.
- **Shadow Database Speed**: When running `migrate dev` locally, using a local Docker PostgreSQL instance for the shadow database is 20x faster than pointing to a remote cloud shadow database over the internet.

---

## 11. Security Considerations
- **Sensitive Data in Seed Scripts**: Never check real user credentials or production API keys into `prisma/seed.ts`. Use deterministic, fake test data generated with libraries like `@faker-js/faker`.

---

## 12. Alternatives
1. **Drizzle Migrations (`drizzle-kit`)**: Generates pure SQL migration folders using TypeScript schema diffing without requiring an external shadow database.
2. **Flyway / Liquibase**: Enterprise Java-based database versioning tools used across polyglot microservice architectures.
3. **TypeORM Migrations**: Generates migration classes containing imperative `queryRunner.createTable()` methods.

---

## 13. Trade-offs

| Criterion | Prisma Migrate | Drizzle Kit | Flyway / Manual SQL |
| :--- | :--- | :--- | :--- |
| **Workflow** | Schema-first declarative | TypeScript-first declarative | SQL-first imperative |
| **Shadow Database** | Required for dev diffing | Not required | Not required |
| **SQL Customization** | Edit generated `migration.sql` | Edit generated `migration.sql` | 100% manually written SQL |
| **Automated Seeding** | Built-in CLI command | Custom script | Custom script |

---

## 14. Real-World Usage
- **Modern Full-Stack Startups**: Development teams run `prisma migrate dev` locally to rapidly evolve schema definitions and automatically trigger `seed.ts` to hydrate Docker containers with mock users, subscriptions, and payment statuses.
- **CI/CD Deployment Pipelines**: GitHub Actions runs `npx prisma migrate deploy` prior to spinning up new container pods, guaranteeing database schemas are updated before application traffic arrives.

---

## 15. Placement Interview Questions

### Basic
**Q: What is the difference between `npx prisma migrate dev` and `npx prisma migrate deploy`?**  
*Answer*: 
- **`prisma migrate dev`** is an interactive command used strictly in local development. It compares `schema.prisma` against a Shadow Database, generates a new versioned `migration.sql` file, applies it to the local database, updates generated TypeScript types (`prisma generate`), and triggers the seed script.
- **`prisma migrate deploy`** is a non-interactive command used in production and CI/CD pipelines. It only applies unapplied migration files from the `prisma/migrations` folder to the target database without checking for schema diffs, generating new files, or prompting for database resets.

### Conceptual
**Q: What is the Shadow Database in Prisma Migrate, and why is it needed?**  
*Answer*: The Shadow Database is an ephemeral, temporary secondary database created and managed automatically by Prisma Migrate during development. It is used to detect **schema drift** and verify that all historical migration files remain replay-safe and consistent. Prisma replays all existing migrations on the shadow database, compares the resulting structure against your local `schema.prisma` file, and computes the exact SQL diff needed for the next migration file without risking corruption of your actual development database.

### Implementation
**Q: How do you model an Explicit Many-to-Many relationship with additional metadata (e.g., `joinedAt` and `role`) in Prisma?**  
*Answer*: Create a dedicated join model (e.g., `Enrollment` or `Membership`) that contains foreign keys referencing both parent models and define a composite primary key using `@@id`:
```prisma
model Student {
  id          String       @id @default(uuid())
  enrollments Enrollment[]
}

model Course {
  id          String       @id @default(uuid())
  enrollments Enrollment[]
}

model Enrollment {
  studentId String
  courseId  String
  enrolledAt DateTime @default(now())
  grade     String?

  student   Student  @relation(fields: [studentId], references: [id], onDelete: Cascade)
  course    Course   @relation(fields: [courseId], references: [id], onDelete: Cascade)

  @@id([studentId, courseId]) // Composite Primary Key
}
```

### Debugging
**Q: Running `prisma migrate dev` in a team environment displays `Drift detected: Your database schema is not in sync with your migration history`. What causes this, and how should it be fixed?**  
*Answer*: This occurs when someone manually altered the database structure (e.g., running manual `ALTER TABLE` or `CREATE TABLE` commands in `psql` or pgAdmin) without generating a corresponding Prisma migration file, causing the physical database to drift from the committed Git migration history.  
**Resolution**:
1. If the drift was accidental in development, run `npx prisma migrate reset` to drop the database and cleanly replay migrations from scratch.
2. If the drift represents real production changes that must be preserved, use `npx prisma migrate diff` to generate a reconciling migration file and resolve it with `npx prisma migrate resolve`.

### Scenario
**Q: Why should seeding scripts (`prisma/seed.ts`) always use `upsert` instead of `create`?**  
*Answer*: Seed scripts are executed repeatedly (after migration resets, during CI/CD runs, or when new developers onboard). If a seed script uses `create`, re-running the script will fail with unique constraint violations (e.g., `admin@platform.com already exists`). Using `upsert` ensures idempotency: if the record exists, it updates or leaves it untouched; if it is missing, it creates it, guaranteeing that the script can be run safely any number of times.

### Advanced
**Q: What is the difference between `relationMode = "foreignKeys"` and `relationMode = "prisma"` in `schema.prisma`?**  
*Answer*: 
- **`relationMode = "foreignKeys"` (Default)**: Relies on the underlying relational database engine (PostgreSQL, MySQL) to enforce referential integrity, foreign key constraints, and cascade deletions natively via ANSI SQL constraints.
- **`relationMode = "prisma"`**: Emulates referential integrity entirely at the application layer within Prisma Client. It avoids creating physical foreign key constraints in the database. This mode is mandatory for distributed databases (like **PlanetScale / Vitess**) that do not support physical foreign key constraints due to horizontal sharding limitations.

---

## 16. Coding Questions

### Problem 1: Idempotent Seed Script with Relational Data
Write a clean, idempotent `prisma/seed.ts` script that sets up an initial organization, an administrator user, and assigns them a membership in one atomic transaction.

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedInitialOrganization() {
  const orgSlug = 'acme-corp';
  const adminEmail = 'admin@acme.com';

  console.log('Seeding organization and admin...');

  // Use interactive transaction to guarantee atomic execution
  await prisma.$transaction(async (tx) => {
    // 1. Upsert Organization
    const org = await tx.organization.upsert({
      where: { slug: orgSlug },
      update: {},
      create: {
        slug: orgSlug,
        name: 'Acme Corporation'
      }
    });

    // 2. Upsert User
    const admin = await tx.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        name: 'Acme Administrator'
      }
    });

    // 3. Upsert Membership Join Record
    await tx.membership.upsert({
      where: {
        userId_orgId: {
          userId: admin.id,
          orgId: org.id
        }
      },
      update: { role: 'OWNER' },
      create: {
        userId: admin.id,
        orgId: org.id,
        role: 'OWNER'
      }
    });
  });

  console.log('Seeding completed successfully.');
}
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking `prisma db push` and `prisma migrate dev` are interchangeable. `prisma db push` syncs your schema directly without generating SQL migration files; it is useful only for rapid prototyping. For production applications, always use `prisma migrate dev` to generate versioned Git migration files.
- **Trap 2**: Believing `@relation` automatically creates database indexes. `@relation` creates foreign key constraints, but you must manually declare `@@index([foreignKeyField])` to index the foreign key for query performance.
- **Trap 3**: Assuming `prisma migrate deploy` seeds the database. `migrate deploy` **only** applies migrations; seeding must be triggered explicitly via `npx prisma db seed` in your deployment script.

---

## 18. Revision Summary
- Model relationships using `@relation`; 1:1 requires a unique foreign key; 1:Many uses foreign key + array; Many-to-Many can be implicit or explicit.
- `prisma migrate dev` is for development (uses a Shadow Database to detect drift and generate SQL); `prisma migrate deploy` is for production CI/CD.
- Seeding scripts (`prisma/seed.ts`) must be idempotent, leveraging `upsert` to avoid constraint crashes on subsequent runs.
- Always add explicit `@@index` on foreign key columns.
- `relationMode = "prisma"` emulates foreign keys in software for databases that lack physical foreign keys (PlanetScale).

---

## 19. Quick Reference

| Command / Flag | Purpose | Target Environment |
| :--- | :--- | :--- |
| **`prisma migrate dev`** | Creates migration file & applies it | Development only |
| **`prisma migrate deploy`** | Applies existing migrations safely | Production / CI/CD |
| **`prisma migrate reset`** | Drops DB and replays all migrations | Development cleanup |
| **`prisma db seed`** | Executes `prisma.seed` command | Dev / Staging seeding |
| **`prisma db push`** | Syncs schema without migration history | Prototyping / Hackathons |
| **`onDelete: Cascade`** | Deletes child rows when parent is deleted| Relational constraint |
