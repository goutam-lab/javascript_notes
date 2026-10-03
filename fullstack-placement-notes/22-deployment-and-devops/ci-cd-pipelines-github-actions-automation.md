# CI/CD Pipelines & GitHub Actions Automation

## 1. What is it?
**CI/CD (Continuous Integration and Continuous Delivery / Deployment)** is a modern software engineering methodology and automated pipeline practice that enables development teams to deliver code changes frequently, reliably, and safely.
- **Continuous Integration (CI)**: Automatically builds, lints, type-checks, and runs test suites on every code commit or pull request. The goal is to detect and isolate bugs at the moment of code creation before merging into main branches.
- **Continuous Delivery (CD)**: Automatically packages the validated code into immutable release artifacts (such as Docker images) and deploys them to staging environments, ready for production rollout upon manual authorization.
- **Continuous Deployment**: Completely automates the deployment to production without human intervention as soon as all automated pipeline gates pass.

**GitHub Actions** is GitHub’s native workflow automation platform. Workflows are defined as declarative YAML files in `.github/workflows/`, orchestrated across events (pushes, pull requests, scheduled crons), divided into isolated **Jobs**, executed on managed virtual machines or container **Runners**, and composed of sequential **Steps**.

```
                   MODERN GITHUB ACTIONS CI/CD PIPELINE
                   
 [ Developer creates Pull Request ] ──► Event: `pull_request`
                                               │
                                               ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ JOB 1: Code Quality & Static Analysis (Parallel)                            │
 │ • Checkout Code (`actions/checkout@v4`)                                     │
 │ • Restore NPM Cache (`actions/setup-node@v4`)                               │
 │ • Run Linter (`eslint .`) & Type Checker (`tsc --noEmit`)                   │
 └─────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼ (depends on Job 1)
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ JOB 2: Automated Testing Suite                                              │
 │ • Unit Tests (`vitest run --coverage`)                                      │
 │ • Integration Tests with Service Containers (Postgres + Redis in Runner)    │
 └─────────────────────────────────────┬───────────────────────────────────────┘
                                       │
 [ PR Approved & Merged to `main` ] ───┘
               │
               ▼
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ JOB 3: Security Scan & Docker Build                                         │
 │ • Authenticate to Cloud via GitHub OIDC (Keyless Identity)                  │
 │ • Build Multi-Stage Docker Image (`docker/build-push-action`)               │
 │ • Vulnerability Scanning (`aquasec/trivy-action`)                           │
 │ • Push Image to GitHub Container Registry (`ghcr.io/org/repo:sha-12345`)    │
 └─────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼ (deploy to Staging)
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ JOB 4: Staging Deployment & Automated E2E Verification                      │
 │ • Deploy image to AWS ECS Staging Cluster                                   │
 │ • Execute Database Migrations (`prisma migrate deploy`)                     │
 │ • Run Playwright E2E smoke tests against staging endpoint                   │
 └─────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼ (Manual Approval / Protected Environment)
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ JOB 5: Production Canary / Rolling Release                                  │
 │ • Deploy to Production Kubernetes / AWS Fleet                               │
 │ • Health check verification (`/health/live`)                                │
 │ • Send deployment success notification to Slack                             │
 └─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Manual deployments and unstructured release processes introduce critical risks into engineering organizations:

1. **Integration Hell**: Developers work on isolated branches for weeks. When merging to `main`, hundreds of conflicting changes trigger broken builds that take days to resolve.
2. **"Forgot to Run Tests" Disasters**: Relying on developers to manually execute `npm test` before pushing guarantees that broken code will eventually reach production.
3. **Leaked Production Credentials**: Manual deployments require developers to hold SSH keys or AWS IAM root credentials on their laptops. If a laptop is compromised, the production cloud is compromised.
4. **Human Deployment Errors**: Manually logging into a server over SSH, pulling git code, editing `.env`, and restarting PM2 is susceptible to typos, skipped migrations, and inconsistent server state.

---

## 3. Mental Model
Think of CI/CD like an automated automotive assembly line quality control system:
- When a new engine part arrives (a Git commit), the assembly line stops (CI triggers).
- Laser scanners measure dimensions against design specs (linting and TypeScript checks).
- The engine is test-fired in a sealed chamber (automated unit and integration tests).
- If any test fails, the robot halts the conveyor belt and flags the defect back to the engineer (PR build check fails; merge blocked).
- Only when all automated diagnostic tests pass does the conveyor belt install the engine into the vehicle and drive it onto the delivery truck (Continuous Delivery to Production).

---

## 4. Basic Example: Minimal GitHub Actions CI Workflow

```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm' # Automatically caches ~/.npm directory

      - name: Install Dependencies
        run: npm ci

      - name: Run Tests
        run: npm test
```

---

## 5. Real Example: Production-Grade Multi-Stage CI/CD Pipeline

Here is an enterprise-grade `.github/workflows/pipeline.yml` featuring dependency caching, database service containers, Docker BuildKit with GitHub Container Registry (GHCR), security scanning, and multi-environment deployment.

```yaml
name: Enterprise Full-Stack Pipeline

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

# Cancel in-progress runs for the same branch to save runner minutes!
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  # ============================================================================
  # 1. CODE QUALITY & LINTING
  # ============================================================================
  lint:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js Environment
        uses: actions/setup-node@v4
        with:
          node-version: 20.x
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Check Code Formatting
        run: npx prettier --check .

      - name: Run Linter
        run: npm run lint

      - name: Type Check TypeScript
        run: npx tsc --noEmit

  # ============================================================================
  # 2. AUTOMATED TESTING WITH REAL BACKING SERVICES
  # ============================================================================
  test:
    needs: [lint]
    runs-on: ubuntu-latest

    # Ephemeral service containers spun up directly in the GitHub runner!
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: testuser
          POSTGRES_PASSWORD: testpassword
          POSTGRES_DB: test_db
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    env:
      DATABASE_URL: postgres://testuser:testpassword@localhost:5432/test_db
      REDIS_URL: redis://localhost:6379
      NODE_ENV: test

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20.x
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Run Schema Migrations against Test DB
        run: npx prisma migrate deploy

      - name: Execute Vitest Test Suite with Coverage
        run: npx vitest run --coverage

  # ============================================================================
  # 3. CONTAINER BUILD & SECURITY VULNERABILITY SCAN
  # ============================================================================
  build-and-scan:
    needs: [test]
    runs-on: ubuntu-latest
    # Only build and push container images on merge to main!
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    permissions:
      contents: read
      packages: write

    steps:
      - name: Checkout Repository
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Log in to GitHub Container Registry (GHCR)
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract Docker Metadata & Tags
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=sha,format=long,prefix=sha-
            type=raw,value=latest

      - name: Build and Push Docker Image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Scan Docker Image for Vulnerabilities with Trivy
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:sha-${{ github.sha }}
          format: 'table'
          exit-code: '1' # Fails the pipeline if CRITICAL CVEs are detected!
          ignore-unfixed: true
          severity: 'CRITICAL'

  # ============================================================================
  # 4. DEPLOY TO PRODUCTION (Protected Environment Gate)
  # ============================================================================
  deploy-production:
    needs: [build-and-scan]
    runs-on: ubuntu-latest
    environment:
      name: production
      url: https://api.mycompany.com
    steps:
      - name: Deploy to Cloud Fleet (AWS ECS / Kubernetes)
        run: |
          echo "Deploying image ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:sha-${{ github.sha }} to Production..."
          # Real cloud deployment command (e.g. kubectl set image or aws ecs update-service)
```

---

## 6. Under the Hood: Runners, Caching & Keyless Identity (OIDC)

### A. The GitHub Runner Execution Environment
When a workflow job starts:
1. GitHub dynamically provisions an isolated **Ephemeral Virtual Machine** (e.g., Ubuntu Linux with 2 vCPUs and 7GB RAM).
2. The GitHub Actions runner daemon checks out code and executes each step in an isolated bash subshell.
3. Once all steps complete or fail, the entire VM is terminated and wiped. No state persists across jobs unless explicitly saved to caches or artifacts.

### B. Dependency Caching Mechanics (`type=gha`)
Re-downloading 500MB of NPM dependencies or Docker base layers on every build wastes bandwidth and time:
- **`actions/setup-node` Cache**: Computes an MD5 hash of `package-lock.json`. If the hash matches a previously cached archive, GitHub restores the `~/.npm` folder in 3 seconds, skipping external network downloads.
- **Docker BuildKit GitHub Cache (`cache-to: type=gha`)**: Exports intermediate Docker layer cache directly into the GitHub Actions cache backend, enabling subsequent container builds to skip unchanged layers.

### C. OpenID Connect (OIDC) vs. Hardcoded Cloud Secrets
```
┌───────────────────────────────────────┬───────────────────────────────────────┐
│ Traditional Static IAM Keys (Dangerous)│ Modern GitHub OIDC (Zero Long-Lived)  │
├───────────────────────────────────────┼───────────────────────────────────────┤
│ Store `AWS_SECRET_ACCESS_KEY` in repo │ Runner requests short-lived JSON Web  │
│ secrets. If an attacker breaches the  │ Token (JWT) directly from GitHub.     │
│ GitHub organization, the credentials  │ AWS verifies GitHub signature and     │
│ grant permanent cloud account access. │ issues a temporary 15-minute IAM role.│
└───────────────────────────────────────┴───────────────────────────────────────┘
```

---

## 7. Important Rules

1. **Enforce Branch Protection on `main`**:
   Never allow developers to push directly to `main`. Require:
   - Mandatory Pull Request with at least 1 peer approval.
   - All CI status checks (`lint`, `test`) must pass before the "Merge" button is enabled.
2. **Never Print Secrets to Console Logs**:
   Avoid commands like `echo $DATABASE_URL` or `printenv` in pipeline steps. While GitHub Actions masks known repository secrets, string-transformed or split secrets can leak into public build logs.
3. **Pin Third-Party Actions to Commit SHAs**:
   Supply chain attacks occur when third-party Action repositories are compromised. Pinning to full commit hashes prevents malicious upstream updates:
   - ❌ `uses: some-author/some-action@v1` (Mutable tag; author can push malicious code)
   - ✅ `uses: some-author/some-action@b4ffde5c8...` (Immutable Git commit SHA)
4. **Use Concurrency Control (`cancel-in-progress`)**:
   If a developer pushes 3 commits in rapid succession to a pull request, running 3 full pipelines simultaneously wastes runner minutes and money. Concurrency groups cancel obsolete in-flight builds immediately.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Merging All Steps into a Single Massive Job
Putting linting, testing, Docker builds, and deployment into one 45-minute monolithic job. If a lint error occurs at minute 44, the entire job must be rerun from scratch.
**Fix**: Split tasks into modular, parallel jobs (`lint`, `test`, `build`). Parallel jobs run concurrently across multiple runner VMs.

### 2. Mocking Everything in CI Tests
Running integration tests against an in-memory SQLite mock database while production runs PostgreSQL. When a PostgreSQL-specific SQL function is deployed, CI greenlights the PR, but production immediately crashes.
**Fix**: Spin up actual `services: postgres` containers inside the GitHub Actions runner.

---

## 9. Best Practices

- **Semantic Versioning & Automated Changelogs**: Use tools like **Release Please** or **Semantic Release** in GitHub Actions. Merging conventional commits (`feat:`, `fix:`) automatically increments versions, tags Git releases, and generates release notes.
- **Environment Protection Rules**: Configure GitHub **Environments** (`staging`, `production`) with required reviewers. Deployments to production pause until a lead engineer or DevOps specialist clicks "Approve and Deploy".
- **Ephemeral Pull Request Preview Deployments**: Automatically deploy each pull request to an isolated preview URL (e.g., via Vercel or Kubernetes namespaces). This allows product managers and designers to test features on live URLs before merging.

---

## 10. Performance Considerations

- **Self-Hosted Runners for Massive Workloads**: For large enterprises with 50+ engineers, GitHub-hosted runner costs can become substantial. Deploying autoscaled **Self-Hosted Kubernetes Runners (Actions Runner Controller - ARC)** on spot AWS EC2 instances provides faster 32-core builds at an 80% discount.
- **Path-Filtered Workflows**: If you maintain a monorepo, use `paths:` filters so that modifying documentation (`docs/**`) does not trigger a 15-minute backend container build.

---

## 11. Security Considerations

- **Restrict Default `GITHUB_TOKEN` Permissions**:
  Set repository-level default permissions to read-only. Explicitly declare required permissions in workflow YAML files:
  ```yaml
  permissions:
    contents: read
    packages: write
  ```
- **Automated Dependency Auditing (Dependabot / Snyk)**: Enable Dependabot to open automated pull requests whenever a CVE is discovered in an NPM dependency, accompanied by automated CI verification.

---

## 12. Alternatives

| CI/CD Platform | Best Suited For | Pros | Cons |
|---|---|---|---|
| **GitHub Actions** | Native GitHub projects | Deep GitHub integration, massive marketplace of actions. | Free tier runner concurrency limits. |
| **GitLab CI/CD** | GitLab-hosted repos | Industry-leading built-in AutoDevOps and container registry. | Requires GitLab ecosystem. |
| **ArgoCD / Flux** | Kubernetes GitOps | Continuous reconciliation; zero cluster credentials in CI. | Specifically tailored for Kubernetes. |
| **Jenkins** | Legacy On-Premises | Infinite customization, open-source. | High operational maintenance; security vulnerabilities. |

---

## 13. Trade-offs

- **Speed vs. Isolation in Runners**:
  Using GitHub-hosted ephemeral VMs guarantees complete clean-slate isolation for every build, but requires 30–60 seconds to provision the VM and pull base tools. Reusable self-hosted runners are faster, but require rigorous cleanup scripts to prevent cross-build artifact pollution.
- **Continuous Deployment vs. Continuous Delivery**:
  Continuous Deployment (auto-deploying directly to production on merge) eliminates human bottlenecks, but requires near-100% automated test coverage and robust automated rollback systems (Canary releases). Continuous Delivery (manual one-click approval gate) provides a final human sanity check for critical financial systems.

---

## 14. Real-World Usage & Implementation Example

Here is a practical script showing how an automated deployment step verifies a newly rolled out production release using a **Health Check Polling Loop**:

```bash
#!/usr/bin/env bash
# verify-deployment.sh
set -euo pipefail

PROD_URL="https://api.mycompany.com/health/ready"
EXPECTED_SHA="$1"
MAX_ATTEMPTS=30
SLEEP_SECONDS=5

echo "==> Verifying Production Deployment for commit SHA: ${EXPECTED_SHA}..."

for ((i=1; i<=MAX_ATTEMPTS; i++)); do
  echo "Attempt $i of $MAX_ATTEMPTS: Pinging $PROD_URL..."
  
  # Fetch JSON response from health endpoint
  HTTP_RESPONSE=$(curl -s -w "\n%{http_code}" "$PROD_URL" || true)
  HTTP_BODY=$(echo "$HTTP_RESPONSE" | head -n -1)
  HTTP_STATUS=$(echo "$HTTP_RESPONSE" | tail -n 1)

  if [ "$HTTP_STATUS" -eq 200 ]; then
    # Verify the running release matches the deployed commit SHA
    DEPLOYED_SHA=$(echo "$HTTP_BODY" | jq -r '.commitSha // empty')
    
    if [ "$DEPLOYED_SHA" == "$EXPECTED_SHA" ]; then
      echo "✅ SUCCESS: Production is healthy and running commit ${EXPECTED_SHA}!"
      exit 0
    else
      echo "⏳ Stale release detected (${DEPLOYED_SHA}). Rolling update in progress..."
    fi
  else
    echo "⚠️ Warning: Endpoint returned HTTP $HTTP_STATUS"
  fi

  sleep "$SLEEP_SECONDS"
done

echo "❌ ERROR: Deployment verification timed out after $((MAX_ATTEMPTS * SLEEP_SECONDS)) seconds!"
echo "Initiating automated rollback..."
exit 1
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: What is the fundamental difference between Continuous Delivery and Continuous Deployment?
**Answer**:
- **Continuous Delivery**: Code passes through automated building, linting, testing, and staging deployments. Release artifacts (e.g., Docker images) are continuously produced and tested, but promoting the build to the production environment requires an explicit **manual approval** (e.g., a manager clicking "Approve").
- **Continuous Deployment**: Completely eliminates the manual gate. Every single commit that passes all automated CI/CD pipeline stages is immediately and automatically deployed to live production users.

### 2. Conceptual: How does GitHub Actions handle secret masking, and how can secrets still accidentally leak?
**Answer**:
GitHub Actions scans console output streams (`stdout` and `stderr`) and replaces exact string values of repository secrets with `***`. 
However, secrets can still leak if:
1. The secret is transformed (e.g., Base64-encoded, URL-encoded, or split into substrings), which bypasses GitHub's literal pattern matcher.
2. The secret is written directly to an uploaded artifact file or committed to a Git branch.
3. An untrusted Pull Request from a fork executes arbitrary code that reads environment variables and sends them to an external HTTP webhook. (GitHub mitigates this by disabling secrets on PRs from third-party forks by default).

### 3. Implementation: How do you run integration tests in GitHub Actions that require both PostgreSQL and Redis?
**Answer**:
By utilizing GitHub Actions **Service Containers** (`services:` block in the job definition):
1. In the workflow YAML, declare `services: postgres` and `services: redis` with image tags, ports, and environment variables.
2. GitHub automatically pulls the container images and runs them alongside the job runner VM, exposing ports on `localhost:5432` and `localhost:6379`.
3. Provide database health checks (`pg_isready`) so the runner waits for the database to accept connections before running `npm test`.

### 4. Debugging: A CI workflow is failing because `npm ci` throws an error: `package-lock.json is out of sync with package.json`. What happened?
**Answer**:
A developer manually modified `package.json` (e.g., upgraded a version from `^1.0.0` to `^2.0.0`) or merged a Git conflict without running `npm install` locally to update `package-lock.json`. 
`npm ci` (unlike `npm install`) enforces absolute reproducibility: if `package.json` and `package-lock.json` are in conflict, it immediately throws an error and aborts. 
**Fix**: The developer must run `npm install` locally, commit the regenerated `package-lock.json`, and push the fix.

### 5. Scenario: How do you prevent sensitive production deployment workflows from running when an external contributor opens a PR on an open-source project?
**Answer**:
1. By default, GitHub Actions does not make repository secrets available to workflows triggered by `pull_request` events originating from forks.
2. Separate the workflow into two events: run the test suite on `pull_request`, and run the deployment workflow only on `push` to the protected `main` branch.
3. Use GitHub Environments with required review approvals for any job that requires production secrets.

### 6. Advanced: What is OpenID Connect (OIDC) in CI/CD, and why is it superior to AWS Access Keys?
**Answer**:
OIDC replaces long-lived, static cloud credentials with short-lived cryptographic tokens:
1. When a job runs, the GitHub Actions runner requests a cryptographically signed OIDC JSON Web Token (JWT) from GitHub's identity provider.
2. The runner presents this token to AWS Security Token Service (STS) using `aws-actions/configure-aws-credentials`.
3. AWS verifies GitHub's signature, validates claims (asserting the token originated from `repo:my-org/my-repo` and `branch:main`), and issues temporary AWS credentials valid for only 15 minutes.
4. **Benefit**: Zero long-lived secret keys stored in GitHub; credentials cannot be leaked, stolen, or forgotten.

---

## 16. Coding Questions & Practical Challenges

1. **GitHub Actions Matrix Strategy**: Write a workflow job configuration using `strategy: matrix` that tests a Node.js library concurrently across Node versions 18, 20, and 22 on both `ubuntu-latest` and `windows-latest`.
2. **Slack Deployment Notifier**: Write a composite GitHub Action that sends an interactive Slack message containing the Git commit author, branch, commit message, and deployment status using incoming webhooks.
3. **Automated Rollback CLI Script**: Write a Node.js script that invokes the AWS ECS SDK to revert an ECS service back to its previous task definition if the latest deployment fails health checks.

---

## 17. Common Interview Traps

- **Trap 1: Believing `GITHUB_TOKEN` has full administrator privileges by default**: GitHub restricts `GITHUB_TOKEN` default permissions to read-only in modern repositories. If your workflow needs to push a tag or publish a package, you must explicitly declare `permissions: { contents: write, packages: write }`.
- **Trap 2: Forgetting to set a timeout on workflow jobs**: If a test suite hangs indefinitely due to an unhandled promise or deadlocked database connection, GitHub Actions will run for up to **6 hours** by default, exhausting your monthly billing quota. Always configure `timeout-minutes: 15` on all jobs.
- **Trap 3: Running deployment steps on `pull_request` events**: A pull request represents unmerged, unreviewed proposal code. Deployments to production must only trigger on `push` to the production release branch after PR merge.

---

## 18. Revision Summary

- **Pipeline Stages**: Quality (lint/typecheck) $\rightarrow$ Verification (unit/integration tests with service containers) $\rightarrow$ Packaging (Docker build & Trivy security scan) $\rightarrow$ Staging $\rightarrow$ Production.
- **Core Optimizations**:
  - `concurrency: cancel-in-progress` to prevent wasted runner minutes.
  - Layer & dependency caching (`actions/setup-node` & BuildKit `type=gha`).
- **Security Posture**: Keyless OIDC authentication for AWS/GCP, pinned action commit hashes, least-privilege token permissions, and branch protection rules.

---

## 19. Quick Reference Cheatsheet

```yaml
# Essential Workflow Snippets
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

# Ephemeral Postgres Service Container
services:
  postgres:
    image: postgres:16-alpine
    env: { POSTGRES_PASSWORD: test }
    ports: [ "5432:5432" ]
    options: --health-cmd pg_isready

# Least Privilege Permissions
permissions:
  contents: read
  packages: write
  id-token: write # Required for AWS OIDC authentication
```
