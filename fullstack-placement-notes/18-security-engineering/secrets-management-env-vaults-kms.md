# Secrets Management: Environment Variables, HashiCorp Vault, and Cloud KMS

## 1. What is it?
**Secrets Management** is the disciplined engineering practice of storing, transmitting, rotating, accessing, and auditing digital authentication credentials—such as database passwords, API tokens (Stripe, OpenAI), encryption keys, TLS private keys, and OAuth client secrets—throughout the software development and deployment lifecycle.

In modern cloud-native architectures, secrets are strictly decoupled from source code. 

Secrets management spans a spectrum of maturity:
- **Level 1 (Baseline)**: Ephemeral Environment Variables (`.env`, Docker secrets) adhering to the Twelve-Factor App methodology.
- **Level 2 (Dedicated Secret Stores)**: Centralized, audited secret vaults (such as **HashiCorp Vault**, **AWS Secrets Manager**, or **GCP Secret Manager**) with dynamic credential leasing and automatic rotation.
- **Level 3 (Envelope Encryption & Hardware Security Modules)**: Cryptographic key management services (**AWS KMS**, **Azure Key Vault**) where master keys never leave physical Hardware Security Modules (HSMs).

```
Secrets Management Architecture:
+---------------------------------------------------------------------------------+
|                       Central Secret Vault / Cloud KMS                          |
|                       (Hardware Security Module - FIPS 140-2)                   |
+---------------------------------------------------------------------------------+
           |                                                    |
           v (Automated Dynamic Lease)                          v (Envelope Encryption)
+-------------------------------+                     +---------------------------+
| Short-Lived Database Password |                     | Data Encryption Key (DEK) |
| Expires in 1 Hour             |                     | Encrypted with Master Key |
+-------------------------------+                     +---------------------------+
           |                                                    |
           v                                                    v
[ Production Container Pod (In-Memory Env) ]         [ Encrypted PII in PostgreSQL]
```

---

## 2. Why does it exist?
1. **The Public GitHub Exposure Disaster**: Automated botnets scan GitHub public commit events within milliseconds of a push. A developer who accidentally commits a `.env` file containing an AWS Secret Key or OpenAI API token will find their AWS account compromised within 90 seconds, spinning up 50 GPU instances for cryptocurrency mining and generating tens of thousands of dollars in unauthorized bills.
2. **Preventing Secret Sprawl**: In large microservice architectures, when a database password is hardcoded across 20 different configuration files, rotating that password requires coordinated deployments across all 20 repositories. A centralized vault allows rotating the password in one place with zero application downtime.
3. **Audit Trails & Regulatory Compliance**: Regulations like SOC2, ISO 27001, and PCI-DSS mandate strict audit trails proving *who* accessed which secret, *when*, and for *what* purpose. Hardcoded environment files provide zero access logging.

---

## 3. Mental Model
Think of Secrets Management as **A High-Security Embassy Key Control Room**:
- **Hardcoding Secrets in Code**: Leaving the master key to the embassy taped to the front door with a sticky note. Anyone walking down the street can copy it.
- **Static `.env` Files**: Giving a physical brass master key to every junior employee. If an employee leaves the company or drops their key in a coffee shop, you must physically change every single lock on every door in the building.
- **Central Vault (HashiCorp Vault / AWS Secrets Manager)**: A biometric key locker inside the guard shack. When an employee needs to open Room 4, they present their ID badge (IAM Role). The locker dispenses an **electronic keycard that only works for 30 minutes** (**Dynamic Secrets / Leases**). After 30 minutes, the keycard turns into a useless piece of plastic. The security log records the exact second the keycard was issued.

---

## 4. Basic Example
Configuring runtime environment variable management safely in TypeScript using `dotenv` and **`envalid`**:

```typescript
// src/config/env.ts
import dotenv from 'dotenv';
import { cleanEnv, str, port, url, num } from 'envalid';

// Load .env file into process.env during local development
dotenv.config();

// Enforce strict schema validation on boot: FAILS FAST if secrets are missing!
export const env = cleanEnv(process.env, {
  NODE_ENV: str({ choices: ['development', 'test', 'production'], default: 'development' }),
  PORT: port({ default: 3000 }),
  DATABASE_URL: url({ desc: 'PostgreSQL connection string' }),
  JWT_SECRET: str({ minLength: 32, desc: 'HMAC secret for signing tokens' }),
  STRIPE_SECRET_KEY: str({ desc: 'Stripe API key' }),
  REDIS_PORT: port({ default: 6379 })
});
```

---

## 5. Real Example: Fetching Dynamic Secrets from AWS Secrets Manager in TypeScript
A production TypeScript service fetching and caching secrets dynamically from **AWS Secrets Manager** at application startup with cache TTL:

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export class SecretVaultService {
  private static client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
  private static cachedSecrets: Record<string, string> | null = null;
  private static lastFetchedAt: number = 0;
  private static readonly CACHE_TTL_MS = 1000 * 60 * 15; // 15-minute secret cache

  /**
   * DYNAMIC SECRET RETRIEVAL
   * Fetches credentials at runtime using the EC2 / ECS IAM Role.
   * Eliminates the need for any static secrets inside Docker images or .env files!
   */
  public static async getDatabaseCredentials(): Promise<{ user: string; pass: string; host: string }> {
    const now = Date.now();

    // Return cached secrets if TTL is valid
    if (this.cachedSecrets && (now - this.lastFetchedAt < this.CACHE_TTL_MS)) {
      return this.cachedSecrets as any;
    }

    try {
      const command = new GetSecretValueCommand({
        SecretId: 'production/ecommerce/database'
      });

      const response = await this.client.send(command);

      if (!response.SecretString) {
        throw new Error('SecretString is empty or binary');
      }

      this.cachedSecrets = JSON.parse(response.SecretString);
      this.lastFetchedAt = now;
      console.log('[Secrets] Successfully fetched and cached secrets from AWS Secrets Manager');

      return this.cachedSecrets as any;
    } catch (error) {
      console.error('[Secrets] Critical failure fetching secrets from AWS', error);
      throw error;
    }
  }
}
```

---

## 6. Under the Hood

### 1. Envelope Encryption Mechanics (AWS KMS)
When encrypting massive databases or sensitive PII columns, encrypting data directly with an asymmetric master key over the network is too slow. Modern systems use **Envelope Encryption**:

```
Envelope Encryption Workflow:
1. Application requests Data Encryption Key (DEK) from AWS KMS.
2. KMS generates:
   - Plaintext DEK (held in application RAM temporarily)
   - Encrypted DEK (encrypted with KMS Customer Master Key - CMK)
3. Application encrypts PII record using the Plaintext DEK via fast local AES-256-GCM.
4. Application IMMEDIATELY destroys the Plaintext DEK from RAM!
5. Application stores the Encrypted Record AND the Encrypted DEK together in the database!

Decryption Workflow:
1. Application reads Encrypted Record + Encrypted DEK from database.
2. Application sends Encrypted DEK to KMS: "Please decrypt this key."
3. KMS decrypts DEK using its internal Hardware Security Module and returns Plaintext DEK.
4. Application decrypts the PII record locally in RAM and wipes the DEK.
```

### 2. HashiCorp Vault Dynamic Secrets
- Unlike static secret stores that simply act as password managers, **HashiCorp Vault generates dynamic, on-demand credentials**.
- When an application requests a database connection, Vault communicates with PostgreSQL, dynamically executes `CREATE USER 'v_token_123' WITH PASSWORD 'temp_pass' VALID UNTIL NOW() + INTERVAL '1 hour'`, and returns those temporary credentials to the app.
- When the 1-hour lease expires, Vault automatically drops the user from PostgreSQL, guaranteeing that even if a secret is leaked, its operational lifespan is strictly limited.

---

## 7. Important Rules
1. **Never Commit `.env` Files to Version Control**: `.env` and `.env.local` must be listed in `.gitignore` on line 1 of every repository. Always provide a sanitized `.env.example` file documenting required variable names without values.
2. **Never Bake Secrets into Docker Images**: Setting `ENV STRIPE_KEY=xyz` in a `Dockerfile` bakes the secret permanently into the container layer history (`docker history my_image` will reveal the secret in plain text!). Inject secrets at runtime via container orchestrators (Kubernetes Secrets, ECS task definitions, Docker Compose env files).
3. **Enforce Pre-Commit Git Secret Scanners**: Install tools like **`git-secrets`**, **`gitleaks`**, or **TruffleHog** in local pre-commit hooks to automatically reject commits containing API keys, AWS secret tokens, or private RSA keys.
4. **Secrets Must Fail Fast on Boot**: An application should validate all required configuration variables immediately when the Node.js process starts; failing fast at startup is vastly superior to crashing 3 hours later when a customer triggers an unconfigured Stripe endpoint.

---

## 8. Common Mistakes

### 1. Committing Secrets and Attempting to "Delete" Them in Later Commits
A developer commits `.env` to Git, realizes the mistake, deletes the file, and commits again. **The secret is still permanently recorded in Git history!** Any user can view the past commit diff. The secret must be treated as **compromised immediately** and revoked/rotated at the provider level.

### 2. Logging `process.env` in Error Handlers
Writing `console.log(process.env)` or including full environment objects in APM crash reporting tools (Sentry). This transmits all production database passwords, JWT signing keys, and third-party API credentials to external logging servers.

---

## 9. Best Practices

### 1. Automated Secret Rotation
Configure automated rotation schedules (e.g., in AWS Secrets Manager using Lambda rotation functions). Credentials are automatically rotated every 30 or 90 days without human intervention.

### 2. Role-Based Cloud Identity (No Static Keys)
Never create static AWS IAM Access Keys (`AKIA...`) for server applications. Use **IAM Roles for EC2 / ECS** or **AWS IAM Roles for Service Accounts (IRSA)** in Kubernetes. The server instance automatically retrieves temporary, rotating credentials directly from the cloud environment metadata service without storing a single static secret.

---

## 10. Performance Considerations
- **Cold-Start Latency in Serverless**: Calling AWS Secrets Manager synchronously on every Lambda invocation adds 100ms–250ms of network latency. Always cache secrets in a global memory variable outside the handler function so warm invocations reuse the cached credentials.
- **Local KMS Decryption**: In envelope encryption, decrypting the Data Encryption Key (DEK) via KMS incurs a network hop (~20ms). Cache the decrypted DEK in memory with a short TTL (e.g., 5 minutes) when processing high-volume batch records.

---

## 11. Security Considerations
- **Memory Dumping Attacks**: If a server experiences a core dump or an attacker gains remote code execution (RCE), they can inspect process memory (`/proc/$PID/environ`). Use dynamic, short-lived leases so that exfiltrated memory contains expired tokens.

---

## 12. Alternatives
1. **Kubernetes Secrets / External Secrets Operator**: Syncs secrets from HashiCorp Vault or AWS Secrets Manager directly into native Kubernetes Secret objects mounted as in-memory files.
2. **Doppler / Infisical**: Modern developer-centric secret management SaaS platforms that synchronize environment configurations seamlessly across local development, staging, and production environments.

---

## 13. Trade-offs

| Mechanism | Security Level | Operational Complexity | Cost |
| :--- | :--- | :--- | :--- |
| **`.env` Files** | Low (Vulnerable to leaks) | Lowest | Free |
| **Cloud Secret Stores (AWS Secrets Manager)**| High (Audited, rotated) | Low to Moderate | ~$0.40/secret/month |
| **HashiCorp Vault** | Highest (Dynamic leases, HSM) | High (Requires dedicated cluster)| Free (OSS) / Paid Enterprise |
| **Envelope Encryption (KMS)**| Highest (Master key never exposed)| Moderate (Requires crypto code) | Pay per API call |

---

## 14. Real-World Usage
- **Fintech Card Processing**: Companies like Stripe and Adyen manage encryption keys exclusively within FIPS 140-2 Level 3 Hardware Security Modules (HSMs). No human engineer or software developer ever has access to plain text card encryption keys.
- **Netflix**: Built **A脂 (Aegis)** and uses HashiCorp Vault to dynamically issue short-lived credentials to thousands of microservices, ensuring zero static passwords exist across their infrastructure.

---

## 15. Placement Interview Questions

### Basic
**Q: Why should secrets (like database passwords and API tokens) never be committed to a Git repository, even in a private repo?**  
*Answer*: Private repositories are easily made public by accident, shared with third-party contractor accounts, cloned onto unencrypted developer laptops, and backed up across insecure third-party CI/CD tools. Furthermore, once committed, secrets remain permanently etched in Git's historical commit tree (`git log`). Automated scraping bots continuously scan repositories to compromise leaked credentials within minutes.

### Conceptual
**Q: Explain the concept of "Envelope Encryption" and why it is used instead of encrypting data directly with a master key.**  
*Answer*: Envelope Encryption is a cryptographic pattern where sensitive data is encrypted locally using a fast, symmetric **Data Encryption Key (DEK)**, and the DEK itself is then encrypted using a secure **Key Encryption Key (KEK / Master Key)** managed by an external KMS/HSM:
- **Why it is used**: Encrypting large datasets directly through a remote KMS requires transmitting all the data over the network to the KMS, which creates high network latency and bandwidth bottlenecks. Envelope encryption allows the application to encrypt gigabytes of data locally in RAM at native AES-GCM speeds, while requiring only a tiny 32-byte key to be transmitted to the KMS for encryption and decryption.

### Implementation
**Q: How do you prevent an application from booting up if required environment variables are missing in production?**  
*Answer*: Use a runtime environment validation library like **`envalid`** or **`zod`** that runs synchronously at the very entry point of the application (`index.ts`):
```typescript
import { z } from 'zod';

const EnvSchema = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.string().transform(Number),
  JWT_SECRET: z.string().min(32)
});

// Throws an immediate error and terminates the process if variables are missing/malformed:
export const env = EnvSchema.parse(process.env);
```

### Debugging
**Q: A developer accidentally pushed a commit containing an AWS Secret Key to GitHub. They immediately ran `git rm .env`, committed, and pushed again. What critical mistake was made, and what are the mandatory incident response steps?**  
*Answer*: The developer made the fatal mistake of assuming deleting the file removes it from Git. The secret remains fully accessible in the previous commit in the Git repository history.  
**Mandatory Incident Response**:
1. **Immediate Revocation**: Assume the key is already compromised. Immediately log into the AWS Console, deactivate the compromised IAM key, and delete it.
2. **Issue New Credentials**: Generate a brand-new IAM key pair and inject it into the secret vault.
3. **Audit CloudTrail Logs**: Inspect AWS CloudTrail for unauthorized API calls (e.g., unauthorized EC2 instances, S3 bucket downloads, IAM role creation) originating from foreign IPs during the exposure window.
4. **Clean Git History**: Use tools like `git-filter-repo` or BFG Repo-Cleaner to rewrite history, or purge the repository if feasible.

### Scenario
**Q: What are "Dynamic Secrets" in HashiCorp Vault, and how do they improve security over static credentials?**  
*Answer*: Dynamic secrets are credentials generated on-demand by Vault that do not exist until they are requested. For example, when an app needs to query PostgreSQL, Vault connects to PostgreSQL, creates a brand-new temporary database user with unique credentials, assigns a short-lived **lease** (e.g., 30 minutes), and provides those credentials to the app. When the lease expires, Vault automatically destroys the user from PostgreSQL.  
**Benefit**: There is no static password to steal. Even if an attacker compromises a server's memory or logs, the stolen password becomes invalid within minutes.

### Advanced
**Q: Why is setting `ENV SECRET_KEY=xyz` in a Dockerfile a severe security vulnerability, and how should secrets be injected into Docker containers?**  
*Answer*: `ENV` variables declared inside a `Dockerfile` are permanently recorded in the image's read-only layer metadata. Anyone with access to the Docker image (or anyone who pulls the image from a registry) can run `docker history --no-trunc <image>` or `docker inspect <image>` to extract the secret in plain text.  
**Correct Approach**:
- Pass secrets at **container runtime**, not build time.
- Mount secrets as in-memory volumes (e.g., Kubernetes Secrets mounted at `/etc/secrets/token`).
- Inject secrets dynamically from external secret vaults (AWS Secrets Manager / Vault) upon process boot.
- Use Docker BuildKit's secret mount feature (`RUN --mount=type=secret...`) if credentials are required solely during the build step.

---

## 16. Coding Questions

### Problem 1: Implementing Cryptographic Envelope Encryption in TypeScript
Implement a TypeScript service that encrypts and decrypts a sensitive string (like a user's Social Security Number) using AES-256-GCM and a simulated Master Key.

```typescript
import crypto from 'crypto';

interface EncryptedEnvelope {
  encryptedData: string;   // Hex
  encryptedKey: string;    // Hex (DEK encrypted by KEK)
  iv: string;              // Hex (Initialization Vector)
  authTag: string;         // Hex (GCM Authentication Tag)
}

export class EnvelopeEncryptionService {
  private static readonly ALGORITHM = 'aes-256-gcm';

  /**
   * Encrypts plaintext using a generated DEK and simulates KEK protection
   */
  public static encrypt(plainText: string, masterKek: Buffer): EncryptedEnvelope {
    // 1. Generate local, random Data Encryption Key (DEK) - 256 bits
    const dek = crypto.randomBytes(32);
    const iv = crypto.randomBytes(12); // Standard 96-bit IV for GCM

    // 2. Encrypt plaintext using the DEK
    const cipher = crypto.createCipheriv(this.ALGORITHM, dek, iv);
    let encryptedData = cipher.update(plainText, 'utf8', 'hex');
    encryptedData += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    // 3. Encrypt the DEK using the Master KEK (Simulating KMS operation)
    const keyCipher = crypto.createCipheriv('aes-256-ecb', masterKek, null);
    let encryptedKey = keyCipher.update(dek.toString('hex'), 'utf8', 'hex');
    encryptedKey += keyCipher.final('hex');

    return {
      encryptedData,
      encryptedKey,
      iv: iv.toString('hex'),
      authTag
    };
  }

  /**
   * Decrypts ciphertext by first unwrapping the DEK
   */
  public static decrypt(envelope: EncryptedEnvelope, masterKek: Buffer): string {
    // 1. Decrypt the DEK using the Master KEK
    const keyDecipher = crypto.createDecipheriv('aes-256-ecb', masterKek, null);
    let decryptedDekHex = keyDecipher.update(envelope.encryptedKey, 'hex', 'utf8');
    decryptedDekHex += keyDecipher.final('utf8');
    const dek = Buffer.from(decryptedDekHex, 'hex');

    // 2. Decrypt the actual data using the decrypted DEK
    const decipher = crypto.createDecipheriv(
      this.ALGORITHM,
      dek,
      Buffer.from(envelope.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'hex'));

    let decrypted = decipher.update(envelope.encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }
}
```

---

## 17. Common Interview Traps
- **Trap 1**: Thinking `.env` files are used in production cloud deployments. `.env` files are designed strictly for local development ergonomics; in production, secrets are injected via container environment variables or fetched dynamically from secret managers.
- **Trap 2**: Believing base64 encoding is encryption. Base64 is an open, reversible data representation format (`Buffer.from(str).toString('base64')`), **not encryption**.
- **Trap 3**: Assuming rotating a master key invalidates all previously encrypted records. In envelope encryption, rotating the master key simply requires re-encrypting the small encrypted DEKs, not re-encrypting terabytes of underlying data!

---

## 18. Revision Summary
- Decouple all secrets from application source code; enforce `.gitignore` for `.env`.
- Use runtime validation libraries (`envalid`, `zod`) to fail fast if required secrets are absent.
- Never bake secrets into Docker image layers.
- In production, fetch secrets dynamically from centralized stores (AWS Secrets Manager, HashiCorp Vault).
- Use **Envelope Encryption** for sensitive data at rest: local data is encrypted with a Data Encryption Key (DEK), and the DEK is encrypted with a master Key Encryption Key (KEK) via KMS.
- Implement pre-commit secret scanners (TruffleHog, Gitleaks) to prevent accidental Git pushes.

---

## 19. Quick Reference

| Tool / Pattern | Purpose | When to Use |
| :--- | :--- | :--- |
| **`envalid` / `zod`** | Enforces presence and format of `process.env` | Application startup (Fail Fast) |
| **AWS Secrets Manager** | Dynamic retrieval, automatic rotation | Cloud microservices, database auth |
| **HashiCorp Vault** | Dynamic leased credentials, multi-cloud | Enterprise infrastructure, zero-trust |
| **AWS KMS** | Envelope encryption, HSM key management | Encrypting PII at rest |
| **`gitleaks`** | Static secret scanning in Git pre-commit | All local developer machines |
| **`docker --mount=secret`** | Secure build-time secret injection | Building Docker containers safely |
