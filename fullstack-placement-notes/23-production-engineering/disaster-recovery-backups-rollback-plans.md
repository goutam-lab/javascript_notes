# Disaster Recovery, Automated Backups & Rollback Engineering

## 1. What is it?
**Disaster Recovery (DR)** is the strategic collection of automated policies, technical tooling, and operational runbooks designed to restore critical data, infrastructure, and application availability following catastrophic events—such as regional cloud datacenter outages, physical hardware failures, ransomware infections, or catastrophic human error (e.g., an engineer running `DROP TABLE users` in production).

Disaster Recovery is quantified by two non-negotiable metrics:
- **Recovery Point Objective (RPO)**: The maximum acceptable data loss measured in time. *"How much data can the business afford to lose?"* (e.g., an RPO of 5 minutes means no more than 5 minutes of transaction data can be permanently lost).
- **Recovery Time Objective (RTO)**: The maximum acceptable duration of system downtime. *"How long can the business afford to be offline before operations recover?"* (e.g., an RTO of 15 minutes means systems must be back online within 15 minutes of an outage).

The cornerstone of modern database DR is **Point-In-Time Recovery (PITR)**, which pairs periodic full disk snapshots with continuous **Write-Ahead Log (WAL) archiving** to allow restoring a database to any exact millisecond in history.

```
                    CONTINUOUS BACKUP & PITR LIFECYCLE
                    
 Sunday 00:00 UTC               Continuous WAL Stream (Every 16MB or 60s)
 ┌──────────────────────┐       ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐
 │ Weekly Full Base     │ ────► │ WAL │ │ WAL │ │ WAL │ │ WAL │ ...
 │ Backup (pgBackRest)  │       │ #01 │ │ #02 │ │ #03 │ │ #04 │
 └──────────┬───────────┘       └─────┴─┴─────┴─┴─────┴─┴─────┘
            │                                  │
            ▼                                  ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Offsite Encrypted Object Store (Amazon S3 Multi-Region)     │
 │ • S3 Object Lock enabled (WORM: Immutable Anti-Ransomware)  │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                    🚨 DISASTER: Wednesday 14:32:15 UTC
                    (Accidental `DROP TABLE orders;` executed)
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ POINT-IN-TIME RECOVERY (PITR) RESTORATION                   │
 │ 1. Restore Sunday's Base Backup Image                       │
 │ 2. Replay archived WAL segments sequentially                │
 │ 3. STOP REPLAY at 14:32:14 UTC (Exact millisecond before drop!)│
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Target Database Fully Restored with ZERO Data Loss!         │
 └─────────────────────────────────────────────────────────────┘
```

---

## 2. Why does it exist?
Untested backups and missing disaster recovery plans lead to irreversible corporate catastrophes:

1. **"Schrödinger’s Backup" Syndrome**: The condition of any backup is unknown until you attempt to restore it. 40% of companies that experience catastrophic data loss discover that their automated backup scripts had been silently failing or creating empty 0-byte corrupt files for months.
2. **Ransomware & Malicious Insider Deletion**: An attacker gaining AWS administrative credentials can delete the primary database, read replicas, and local backup snapshots simultaneously. Without immutable, offsite, cross-account backups, recovery is impossible.
3. **Regional Cloud Outages**: Major cloud providers experience total regional outages (e.g., AWS US-East-1 fiber cut or cooling failure taking an entire region offline for 12 hours). Without a multi-region failover plan, your business remains dark until the cloud provider resolves the physical outage.
4. **Catastrophic Accidental Data Mutation**: A developer running an un-scoped database migration (`UPDATE accounts SET balance = 0;` missing a `WHERE` clause) instantly corrupts millions of records. Read replicas immediately replicate the corrupt command within milliseconds. Only **Point-In-Time Recovery (PITR)** can roll back to the second before the command ran.

---

## 3. Mental Model
Think of Disaster Recovery like commercial maritime safety:
- Daily base backups are lifeboats inspected every morning.
- Continuous WAL archiving is the ship’s real-time satellite GPS beacon recording every second of navigation.
- If the ship strikes an iceberg (datacenter failure), the crew does not start designing lifeboats on the spot. They execute the **Drill Runbook**: passengers board the designated lifeboats in order, the beacon transmits coordinates to the secondary rescue vessel (secondary cloud region), and operations resume with zero casualties.

---

## 4. Basic Example: Logical vs. Physical PostgreSQL Backups

### Logical Backup via `pg_dump`
Exports database schema and data as plain SQL text commands or compressed custom archives. Best for smaller databases (<50GB) and version upgrades.

```bash
# 1. Take a compressed logical backup
pg_dump -h localhost -U dbuser -d master_db -F c -b -v -f /backups/master_db_$(date +%Y%m%d).dump

# 2. Restore logical backup into a clean target database
pg_restore -h localhost -U dbuser -d target_db -v -c /backups/master_db_20261003.dump
```

---

## 5. Real Example: Enterprise Point-In-Time Recovery (PITR) with WAL-G / S3

For databases larger than 100GB, `pg_dump` takes hours and locks tables. Production enterprises use **Physical Block-Level Streaming Backup** with **WAL-G / pgBackRest** streaming directly to an immutable Amazon S3 bucket.

### A. PostgreSQL Configuration (`postgresql.conf`)
```ini
# Enable continuous Write-Ahead Log (WAL) archiving
wal_level = replica
archive_mode = on

# Archive command: pushes 16MB WAL files to Amazon S3 immediately upon rotation
archive_command = 'wal-g wal-push %p'
archive_timeout = 60 # Force WAL rotation at least once every 60 seconds (Enforces RPO < 60s!)
```

### B. Automated Disaster Recovery Testing Script (`dr-restore-test.sh`)
This script runs automatically every Sunday inside an ephemeral CI/CD container to **prove** that backups can be restored without errors:

```bash
#!/usr/bin/env bash
# dr-restore-test.sh - Automated Weekly DR Restoration Test
set -euo pipefail

RESTORE_TIMESTAMP="2026-10-03 14:00:00"
TEST_CONTAINER="dr-postgres-validator"
S3_BUCKET="s3://mycompany-encrypted-db-backups-cold"

echo "==> 1. Initializing clean PostgreSQL test container..."
docker run -d --name "${TEST_CONTAINER}" \
  -e POSTGRES_PASSWORD=testsecret \
  -e AWS_ACCESS_KEY_ID="${DR_AWS_KEY}" \
  -e AWS_SECRET_ACCESS_KEY="${DR_AWS_SECRET}" \
  -e WALG_S3_PREFIX="${S3_BUCKET}" \
  postgres:16-alpine

echo "==> 2. Fetching latest base backup image from offsite S3..."
docker exec "${TEST_CONTAINER}" wal-g backup-fetch /var/lib/postgresql/data LATEST

echo "==> 3. Configuring recovery target time (PITR to ${RESTORE_TIMESTAMP})..."
cat <<EOF | docker exec -i "${TEST_CONTAINER}" tee /var/lib/postgresql/data/recovery.signal
# Signals Postgres to start in Recovery Mode
EOF

cat <<EOF | docker exec -i "${TEST_CONTAINER}" tee -a /var/lib/postgresql/data/postgresql.conf
restore_command = 'wal-g wal-fetch "%f" "%p"'
recovery_target_time = '${RESTORE_TIMESTAMP}'
recovery_target_action = 'promote'
EOF

echo "==> 4. Starting PostgreSQL to replay WAL segments..."
docker restart "${TEST_CONTAINER}"

# Wait for database recovery and promotion
sleep 30

echo "==> 5. Executing automated data integrity assertions..."
USER_COUNT=$(docker exec "${TEST_CONTAINER}" psql -U postgres -d master_db -t -c "SELECT count(*) FROM users;")
ORDER_COUNT=$(docker exec "${TEST_CONTAINER}" psql -U postgres -d master_db -t -c "SELECT count(*) FROM orders;")

if [ "$USER_COUNT" -gt 0 ] && [ "$ORDER_COUNT" -gt 0 ]; then
  echo "✅ DISASTER RECOVERY DRILL SUCCESSFUL!"
  echo "Verified ${USER_COUNT} users and ${ORDER_COUNT} orders restored to exact time."
  # Notify Slack/Datadog of DR drill pass
else
  echo "❌ CRITICAL: DR RESTORATION FAILED! Restored tables are empty."
  exit 1
fi

echo "==> 6. Cleaning up ephemeral test container..."
docker rm -f "${TEST_CONTAINER}"
```

---

## 6. Under the Hood: Write-Ahead Logs (WAL) & Log Sequence Numbers (LSN)

How does a database restore to the exact second an incident occurred?

```
                     WAL REPLAY MECHANICS
                     
 [ Disk Page on Storage ]              [ Continuous WAL Log Stream ]
 ┌──────────────────────┐              ┌───────────────────────────────┐
 │ Users Table          │              │ LSN 0/1600000: INSERT user_1  │
 │ Baseline: Sunday     │ ───────────► │ LSN 0/1600050: UPDATE order_2 │
 │ 00:00 UTC            │  Replay WAL  │ LSN 0/1600100: DELETE user_3  │
 └──────────────────────┘   Forward    │ LSN 0/1600200: DROP TABLE ... │ ◄── TARGET STOP!
                                       └───────────────────────────────┘
```
1. Every state mutation in PostgreSQL (insert, update, delete, index change) is written sequentially to the **Write-Ahead Log (WAL)** *before* it is applied to disk pages.
2. Every byte written is assigned a monotonically increasing 64-bit integer called a **Log Sequence Number (LSN)** (e.g., `16/B374D848`).
3. During recovery:
   - PostgreSQL restores the raw data files from the Sunday base backup.
   - It streams and replays WAL records forward in chronological sequence, reconstructing table states.
   - When the replayer encounters `recovery_target_time = '14:32:14'`, it halts immediately before executing the destructive `DROP TABLE` command at `14:32:15`.

---

## 7. Important Rules

1. **The 3-2-1 Backup Rule**:
   - Maintain at least **3 copies of your data** (Production master, standby replica, backup archive).
   - Store backups on **2 different storage media types** (Local disk / NVMe and Object Storage).
   - Keep at least **1 copy completely offsite in a geographically separate cloud region or different cloud provider**.
2. **Enforce WORM (Write Once, Read Many) / Object Lock**:
   Configure Amazon S3 Object Lock in **Compliance Mode** on your backup buckets with a 30-day retention lock. In this mode, no user (not even the AWS root account) can delete or overwrite backup files until the retention period expires, providing 100% immunity against ransomware deletion.
3. **Automate Continuous Restoration Testing**:
   A backup that has never been restored is not a backup—it is a hypothesis. Schedule automated weekly restoration jobs in your CI/CD pipeline that spin up an isolated database from the latest backup and run automated schema and row-count assertions.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Storing Backups in the Same Cloud Region as Production
Configuring database backups to write to an S3 bucket in `us-east-1` when the primary database is also in `us-east-1`. If an earthquake, power failure, or AWS regional outage takes `us-east-1` offline, both your live database and your backups are inaccessible simultaneously. Always use **S3 Cross-Region Replication (CRR)** to mirror backups to `us-west-2` or `eu-west-1`.

### 2. Relying on Read Replicas as Your Only Backup Strategy
Believing that having a PostgreSQL Read Replica protects against data loss.
**Why it fails**: Read replicas mirror the master database in real time. If a developer accidentally executes `DELETE FROM customers;`, that command replicates to the read replica in **5 milliseconds**, deleting all customer records on both servers simultaneously. Replicas provide high availability for hardware failures, **not disaster recovery for data corruption**.

---

## 9. Best Practices

- **Explicit Disaster Recovery Runbooks**: Maintain clear, step-by-step markdown runbooks in version control detailing exact CLI commands, DNS failover steps, and on-call escalation phone numbers for DR incidents. Under high stress at 3 AM, engineers should follow a checklist, not improvise.
- **Failover Fencing (STONITH - Shoot The Other Node In The Head)**: During an automated database failover where a standby replica is promoted to master, strictly isolate or power down the old master to prevent **Split-Brain scenarios** (where two servers both believe they are the primary master, accepting conflicting writes).
- **Separate Cloud Account for Backups**: Store offsite backups in a completely isolated AWS account with distinct IAM credentials. If the primary production AWS account is compromised, the backup account remains untouched.

---

## 10. Performance Considerations

- **Parallelized Logical Dumps (`pg_dump -j 4`)**:
  When using `pg_dump` on multi-core servers, pass the `-j` (jobs) flag to dump multiple tables in parallel using separate database connections, cutting backup duration by up to 70%.
- **Zero-Impact Physical Snapshots via Cloud Storage**:
  On AWS RDS or Aurora, taking automated snapshots does not incur I/O performance penalties on the master database because the underlying distributed storage volume handles snapshot copy-on-write branching independently of the compute instance.

---

## 11. Security Considerations

- **Envelope Encryption for Backups**:
  Encrypt all database backups at rest using customer-managed AWS KMS keys (SSE-KMS) with automated key rotation. Even if physical backup files are intercepted, the ciphertext is unreadable without KMS access.
- **Restricted IAM Permissions on Backup Deletion**:
  Explicitly apply an SCP (Service Control Policy) in AWS Organizations that blocks `s3:DeleteObject` and `s3:DeleteBucket` across all backup bucket ARNs for all IAM roles.

---

## 12. Alternatives: DR Architecture Strategies

| Strategy | RTO (Downtime) | RPO (Data Loss) | Cost | Operational Complexity |
|---|---|---|---|---|
| **Backup & Restore (Cold)** | Hours to Days | 1 – 24 Hours | Lowest ($) | Low |
| **Pilot Light (Warm Standby)** | 10 – 30 Minutes | < 1 Minute | Low to Medium ($$) | Medium |
| **Warm Standby (Scaled Down)**| 2 – 5 Minutes | Near Zero | Medium ($$$) | Medium to High |
| **Multi-Region Active-Active** | **Zero (< 1s)** | **Zero** | **Highest ($$$$)** | **Extreme** |

---

## 13. Trade-offs

- **RPO / RTO Aggressiveness vs. Infrastructure Cost**:
  Achieving zero RPO and zero RTO requires multi-region active-active clusters (e.g., CockroachDB or AWS Aurora Global Database across 3 continents), which multiplies hosting and cross-region network transfer bills by 300%. For most standard web applications, a **Pilot Light** strategy (RTO: 15 mins, RPO: 1 min) offers the optimal balance between cost and resilience.
- **Logical Dump Portability vs. Physical Snapshot Speed**:
  Logical backups (`pg_dump`) allow importing data across different major PostgreSQL versions and operating systems, but take hours on large datasets. Physical block backups (WAL archiving) restore terabytes in minutes, but require the target server to run the exact same major database version and architecture.

---

## 14. Real-World Usage & Implementation Example: The Step-by-Step DR Runbook

Here is an extract from an enterprise **Production Disaster Recovery Runbook**:

```markdown
# 🚨 INCIDENT RUNBOOK: PRIMARY DATABASE RECOVERY & FAILOVER

## Activation Criteria
- Primary AWS Region (us-east-1) is unreachable for > 10 minutes.
- OR primary PostgreSQL master suffers irrecoverable disk corruption.
- Incident Commander officially declares **SEV-1 DISASTER**.

---

### Step 1: Confirm Primary Master Isolation (Prevent Split-Brain)
1. Revoke database security group access in us-east-1:
   ```bash
   aws ec2 revoke-security-group-ingress --group-id sg-01234567 --protocol tcp --port 5432 --cidr 0.0.0.0/0
   ```

### Step 2: Promote Secondary Region Read Replica (us-west-2)
1. Promote the warm standby read replica in Oregon to become the new primary master:
   ```bash
   aws rds promote-read-replica --db-instance-identifier rds-postgres-us-west-2-standby
   ```
2. Wait for status to transition to `available`:
   ```bash
   aws rds wait db-instance-available --db-instance-identifier rds-postgres-us-west-2-standby
   ```

### Step 3: Update Global Route 53 DNS Endpoint
1. Update internal database CNAME record (`db.internal.mycompany.com`) to point to the newly promoted Oregon endpoint:
   ```bash
   aws route53 change-resource-record-sets --hosted-zone-id Z12345 --change-batch file://dns-failover.json
   ```

### Step 4: Scale Secondary Application Fleet
1. Scale up ECS application task count in us-west-2 from pilot light (2 tasks) to full production capacity (20 tasks):
   ```bash
   aws ecs update-service --cluster prod-west-cluster --service core-api --desired-count 20
   ```

### Step 5: Verification & Traffic Routing
1. Run smoke test curl against Oregon regional endpoint:
   ```bash
   curl -f https://west-api.mycompany.com/health/ready
   ```
2. Switch Cloudflare / Route 53 public traffic to Oregon.
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: What is the difference between RTO and RPO?
**Answer**:
- **RTO (Recovery Time Objective)**: The targeted duration of time within which a business process or system must be restored after a disaster. It answers: *"How long can we afford to be down?"* (e.g., RTO = 30 minutes).
- **RPO (Recovery Point Objective)**: The maximum acceptable amount of data loss measured in time backward from the moment of failure. It answers: *"How much data can we afford to lose?"* (e.g., RPO = 1 minute means transaction data older than 1 minute must be safely committed to offsite backups).

### 2. Conceptual: Explain how Point-In-Time Recovery (PITR) works in relational databases.
**Answer**:
PITR combines two distinct backup mechanisms:
1. **Periodic Base Backups**: A complete physical disk snapshot of all database files taken at regular intervals (e.g., weekly or daily).
2. **Continuous Write-Ahead Log (WAL) Archiving**: As transactions execute, database mutations are written to 16MB WAL segment files, which are immediately shipped to durable offsite object storage (S3).
When a disaster occurs (e.g., an accidental `DROP TABLE` at 14:32:15), the restoration engine restores the last base backup and replays the archived WAL files sequentially up to the specified target timestamp (`14:32:14`), halting immediately before the destructive query, achieving near-zero data loss.

### 3. Implementation: Why is a Read Replica not considered a replacement for a backup system?
**Answer**:
A Read Replica is designed for **High Availability (HA) and read scalability**, not Disaster Recovery. 
Replicas mirror master mutations in real time with millisecond replication lag. If a user, application bug, or malicious actor executes a destructive command (e.g., `DELETE FROM orders` or `DROP TABLE accounts`), the command is replicated and executed on the replica almost instantly. Both the master and the replica are corrupted simultaneously. Replicas protect against physical server hardware failure, but cannot recover from human error, logical data corruption, or ransomware without historical point-in-time backups.

### 4. Debugging: A team attempts to restore a PostgreSQL database using PITR, but the recovery process stops prematurely with an error: `WAL segment not found`. What happened?
**Answer**:
1. **Broken WAL Archive Chain**: There is a gap in the continuous sequence of archived WAL files stored in S3 (e.g., a network timeout caused the database's `archive_command` to fail, or an S3 lifecycle policy prematurely deleted older WAL segments).
2. **Missing Archive Timeout**: If `archive_timeout` was not configured, the last active WAL segment remained buffered on the crashed server's local disk and was never shipped to S3.
3. **Remediation**: If the old server’s disk is still accessible, manually copy the un-archived `/pg_wal/` files from the dead instance to the restore directory. Ensure future configurations use robust archiving tools (like `wal-g` or `pgBackRest`) that retry failed uploads automatically.

### 5. Scenario: What is a "Split-Brain" scenario during an automated database failover, and how do you prevent it?
**Answer**:
A Split-Brain scenario occurs when the primary master database loses network connectivity with its standby replica, but is still running. 
- The cluster orchestrator assumes the master is dead and promotes the standby replica to become the new master.
- If clients in different network zones continue writing to the old master while others write to the new master, the two databases diverge with conflicting records. Re-merging them later without data corruption is virtually impossible.
- **Prevention**: Enforce **Node Fencing / STONITH (Shoot The Other Node In The Head)**: before a replica is promoted, the orchestrator must programmatically cut off the old master's power or revoke its network security group access, guaranteeing that only one master can accept writes.

### 6. Advanced: How does AWS S3 Object Lock prevent ransomware from destroying database backups?
**Answer**:
S3 Object Lock enforces a **WORM (Write Once, Read Many)** storage model using cryptographic compliance retention:
1. When backup files (`.dump` or WAL chunks) are uploaded to S3, a retention period is assigned (e.g., 30 days) in **Compliance Mode**.
2. During this period, the AWS S3 API strictly blocks `DeleteObject`, `DeleteObjectVersion`, and `PutBucketPolicy` operations on those objects.
3. Even if an attacker steals the AWS Root Account credentials or administrator IAM keys, **AWS physically rejects any API attempt to delete, overwrite, or encrypt the locked backup files** until the retention timer naturally expires.

---

## 16. Coding Questions & Practical Challenges

1. **Automated S3 Backup Pruner**: Write a Node.js script using the AWS SDK that inspects an S3 backup bucket, identifies backups older than 30 days, verifies that at least 3 recent backups remain, and deletes only the expired backups.
2. **PostgreSQL WAL Archiver Script**: Write a resilient Bash `archive_command` script that encrypts a 16MB WAL file using GPG, uploads it to an S3 bucket with MD5 integrity validation, and retries up to 3 times before returning an error code.
3. **Automated Health Check Failover Daemon**: Write a TypeScript daemon that pings a primary database every 5 seconds, maintains a failure counter, and triggers an automated AWS CLI failover command if 6 consecutive timeouts occur.

---

## 17. Common Interview Traps

- **Trap 1: Assuming cloud-managed databases (RDS / Cloud SQL) do not require backup testing**: While AWS RDS automates snapshots and WAL management, permission changes, database corruption, or unintended schema migrations can still corrupt data. You must periodically test restoring snapshots into isolated test instances.
- **Trap 2: Forgetting to document dependencies in DR plans**: A database may restore in 10 minutes, but if your application requires Redis, RabbitMQ, and third-party API webhook secrets that were not documented in the DR runbook, the application remains non-functional for hours.
- **Trap 3: Over-promising Zero RPO without budget awareness**: Promising an executive that your system has zero RPO and zero RTO across global catastrophic disasters requires multi-region active-active synchronized databases (synchronous two-phase commits across continents), which introduces severe network latency on every database write and massive infrastructure expenses.

---

## 18. Revision Summary

- **Core Metrics**: RPO (maximum acceptable data loss window) and RTO (maximum acceptable downtime window).
- **Gold Standard**: Point-In-Time Recovery (PITR) combining periodic base backups with continuous Write-Ahead Log (WAL) archiving.
- **Defense-in-Depth**: 3-2-1 backup rule, offsite cross-region replication, and S3 Object Lock (WORM) for ransomware immunity.
- **Failover Safety**: Implement STONITH fencing during database failover to prevent catastrophic split-brain state divergence.
- **Verification Rule**: Backups must be tested continuously via automated restore scripts; an untested backup is not a backup.

---

## 19. Quick Reference Cheatsheet

```bash
# PostgreSQL Logical Backup Commands
pg_dump -U postgres -F c -b -v -f backup.dump master_db  # Create compressed dump
pg_restore -U postgres -d target_db -v -c backup.dump     # Restore compressed dump

# PostgreSQL WAL Configuration (postgresql.conf)
wal_level = replica
archive_mode = on
archive_command = 'wal-g wal-push %p'
archive_timeout = 60 # Enforces RPO < 60 seconds

# Essential DR Formula
RPO = How much data you can afford to lose (Time)
RTO = How long you can afford to be offline (Time)
```
