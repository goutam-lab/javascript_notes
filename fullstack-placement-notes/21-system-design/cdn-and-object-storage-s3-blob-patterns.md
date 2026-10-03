# CDN & Object Storage Architecture: AWS S3, CloudFront & Presigned Upload Pipelines

## 1. What is it?
**Object Storage** (exemplified by **Amazon S3**, Google Cloud Storage, and Azure Blob Storage) is a flat, highly distributed storage architecture designed to store and retrieve virtually unlimited volumes of unstructured binary data ("blobs"—such as images, video files, audio tracks, PDFs, database backups, and disk snapshots). Unlike traditional block storage (EBS) or hierarchical file systems (NFS), object storage manages data as discrete "objects" consisting of data bytes, unique key identifiers, and extensible metadata tags accessible via standard HTTP REST APIs.

**Content Delivery Network (CDN) Integration** pairs object storage with a global edge network (such as **AWS CloudFront** or Cloudflare). Instead of serving binary downloads directly from the centralized S3 storage bucket (which incurs high latency and egress bandwidth costs), objects are cached across hundreds of edge Points of Presence (PoPs) physically close to users.

```
       DIRECT S3 UPLOAD ANTI-PATTERN (Exhausts App Server RAM & Bandwidth)
┌────────┐     100MB File Upload     ┌──────────────┐     Stream to S3     ┌────────┐
│ Client │ ────────────────────────► │ Node.js App  │ ───────────────────► │ AWS S3 │
└────────┘   (Ties up worker thread) └──────────────┘ (Dual Bandwidth Cost)└────────┘

       PRESIGNED URL PATTERN (Production Standard - Zero App Server Load)
┌────────┐  1. Request Upload Ticket  ┌──────────────┐
│        │ ─────────────────────────► │ Node.js App  │
│        │ ◄───────────────────────── │ (Validates)  │
│ Client │  2. Returns S3 Presigned   └──────────────┘
│        │     URL (Valid for 5 mins)
│        │
│        │  3. Direct Binary PUT (HTTPS)                    ┌────────────────┐
│        │ ───────────────────────────────────────────────► │ AWS S3 Bucket  │
│        │                                                  └───────┬────────┘
│        │                                                          │
│        │  4. Fast Global Download via Edge CDN (GET)              │ Read Origin
│        │ ◄────────────────────────────────────────────────────────┘
└────────┘                    ┌────────────────────────────┐
                              │ CloudFront CDN Edge Cache  │
                              └────────────────────────────┘
```

---

## 2. Why does it exist?
Streaming large binary files directly through application web servers is one of the most common reasons backend clusters crash under load:

1. **Application Server Starvation**: If a user uploads a 500MB video directly through your Express/Node.js server, the connection occupies a Node.js socket, consumes memory buffers, and saturates network bandwidth for minutes. If 20 users upload simultaneously, the server exhausts memory and crashes with an OOM error.
2. **Double Bandwidth Costs**: Uploading through the application server means paying twice for network transit: Client $\rightarrow$ App Server (Ingress) and App Server $\rightarrow$ S3 (Egress).
3. **Infinite Elastic Scalability**: Traditional file systems (ext4, NTFS) suffer performance degradation once a single directory contains more than a few hundred thousand files. Object storage uses distributed hash tables that scale seamlessly to billions of objects with **99.999999999% (11 9's) of data durability**.
4. **Global Download Acceleration**: Serving media directly from an S3 bucket in `us-east-1` to a mobile user in Mumbai or Tokyo results in a 400ms TTFB. CloudFront CDN edge caching delivers the same image in 15ms.

---

## 3. Mental Model: The VIP Vault & Courier Pass
Think of S3 and Presigned URLs as a **High-Security Bank Vault**:
- **The Application Server**: The bank teller.
- **The S3 Bucket**: The massive reinforced vault underground.
- **The Anti-Pattern**: The customer hands a 200-pound bag of gold coins to the teller. The teller carries it down the stairs to the vault by hand. The customer line backs up into the street.
- **The Presigned URL Pattern**: The customer asks the teller: *"I have a 200-pound bag of gold."* The teller checks the customer's ID, prints a cryptographic, single-use VIP badge valid for 5 minutes (the Presigned URL), and says: *"Walk directly to Vault Door #4 and drop it in."* The teller immediately attends to the next customer.

---

## 4. Basic Example: Generating an S3 Presigned Upload URL in TypeScript

```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function generateUploadUrl(
  userId: string,
  fileName: string,
  contentType: string
): Promise<{ uploadUrl: string; fileKey: string }> {
  // Enforce secure, unique object keys
  const extension = fileName.split('.').pop();
  const fileKey = `uploads/${userId}/${crypto.randomUUID()}.${extension}`;

  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET_NAME!,
    Key: fileKey,
    ContentType: contentType, // Strictly bind Content-Type
    Metadata: { uploadedBy: userId },
  });

  // Generate cryptographically signed URL valid for 300 seconds (5 minutes)
  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 300 });

  return { uploadUrl, fileKey };
}
```

### Client-Side Execution (Browser / Frontend React)
```typescript
// Frontend: Direct upload to S3 without touching backend servers
async function uploadFileDirectly(file: File) {
  // 1. Get Presigned URL from our API
  const res = await fetch('/api/media/presigned-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, contentType: file.type }),
  });
  const { uploadUrl, fileKey } = await res.json();

  // 2. Direct binary HTTP PUT to S3
  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file, // Binary stream directly from browser memory
  });

  if (!uploadRes.ok) throw new Error('Upload to S3 failed');
  console.log('Upload complete! S3 Key:', fileKey);
}
```

---

## 5. Real-World Production Example: S3 Multipart Upload for Large Files (>100MB)

Standard single-part uploads fail if a network connection drops at 99% of a 2GB file. **S3 Multipart Upload** splits large files into parallel 5MB–100MB parts, uploading parts concurrently and re-trying only failed parts.

```typescript
import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: 'us-east-1' });

export class MultipartUploadManager {
  /**
   * Step 1: Initiate Multipart Upload session
   */
  public static async startUpload(bucket: string, key: string, contentType: string) {
    const cmd = new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType });
    const res = await s3.send(cmd);
    return { uploadId: res.UploadId!, fileKey: key };
  }

  /**
   * Step 2: Generate presigned URLs for each individual chunk/part
   */
  public static async getPartUrls(bucket: string, key: string, uploadId: string, partCount: number) {
    const urls: Array<{ partNumber: number; url: string }> = [];

    for (let partNumber = 1; partNumber <= partCount; partNumber++) {
      const cmd = new UploadPartCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        PartNumber: partNumber,
      });

      const url = await getSignedUrl(s3, cmd, { expiresIn: 3600 });
      urls.push({ partNumber, url });
    }

    return urls;
  }

  /**
   * Step 3: Complete upload after all chunks are uploaded
   */
  public static async completeUpload(
    bucket: string,
    key: string,
    uploadId: string,
    parts: Array<{ PartNumber: number; ETag: string }>
  ) {
    const cmd = new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: {
        // Parts must be strictly sorted by PartNumber!
        Parts: parts.sort((a, b) => a.PartNumber - b.PartNumber),
      },
    });

    return s3.send(cmd);
  }
}
```

---

## 6. Under the Hood: CloudFront Origin Access Control (OAC) Architecture

In production, your S3 bucket must **never be public**. Direct public access allows attackers to bypass your CDN, hotlink your images, and trigger expensive S3 egress charges.

```
┌────────────────────────────────────────────────────────┐
│ Global Client (Browser / Mobile)                       │
└───────────────────────────┬────────────────────────────┘
                            │ HTTPS GET /images/hero.webp
                            ▼
┌────────────────────────────────────────────────────────┐
│ AWS CloudFront Edge CDN (Global PoPs)                  │
│ - TLS Termination, Edge Caching, WAF Bot Defense       │
│ - Signs request using AWS Signature Version 4 (SigV4)  │
└───────────────────────────┬────────────────────────────┘
                            │ Secure Origin Access Control (OAC)
                            ▼
┌────────────────────────────────────────────────────────┐
│ AWS S3 Private Storage Bucket                          │
│ - Bucket Policy: "Block All Public Access" = ON        │
│ - Principal: "cloudfront.amazonaws.com" ONLY           │
│ - Denies all direct traffic not signed by CloudFront!  │
└────────────────────────────────────────────────────────┘
```

---

## 7. Important Rules

1. **Block All Public S3 Access**: Always enable S3 **"Block Public Access"** at the bucket and account level. Deliver all public assets through CloudFront using **Origin Access Control (OAC)** or Origin Access Identity (OAI).
2. **Never Stream Large Uploads Through Backend Compute**: Always use S3 Presigned URLs or direct S3 SDK integrations. Compute nodes should only generate signed tickets; the actual binary stream should travel directly between Client $\longleftrightarrow$ S3.
3. **Use Multipart Upload for Files $> 100\text{MB}$**: S3 requires multipart uploads for files $> 5\text{GB}$ and recommends it for any file $> 100\text{MB}$ to enable parallel uploads and retry resilience.
4. **Configure CORS on the S3 Bucket**: Because browsers upload directly to S3 from your web domain (`https://myapp.com`), you must configure an S3 CORS policy allowing `PUT` from your domain; otherwise, browser `fetch` calls will fail.
5. **Implement S3 Lifecycle Policies for Cost Optimization**:
   - Move objects older than 30 days to **S3 Standard-Infrequent Access (S3-IA)** (saves 50%).
   - Move objects older than 90 days to **S3 Glacier Flexible Deep Archive** (saves 95%).
   - Expire incomplete multipart uploads after 7 days (`AbortIncompleteMultipartUpload`) to avoid paying for abandoned orphaned file parts!

---

## 8. Common Mistakes & Anti-Patterns

### 1. The Abandoned Multipart Upload Bill
When clients start a multipart upload but fail or cancel halfway through, S3 retains the uploaded parts on disk indefinitely. If 1,000 users abandon a 2GB upload, you pay for 2TB of hidden storage. Always configure an S3 Lifecycle rule to abort incomplete multipart uploads after 3 days.

### 2. S3 Bucket Name Guessing & Public Takeover
Giving S3 buckets predictable names (e.g., `company-production-backups`) with public read/write permissions. Attackers scan public S3 buckets to extract PII or inject malicious payloads.

### 3. Missing File Type Validation in Presigned URLs
Generating a presigned URL without specifying `ContentType`. An attacker can request a ticket for an "image" and upload a 5GB `.exe` executable file or malicious HTML script.

---

## 9. Best Practices

- **CloudFront Signed URLs & Signed Cookies for Private Media**:
  For paid video courses (Netflix, Udemy) or private documents, generate **CloudFront Signed URLs**. The edge CDN verifies cryptographic signatures and serves private media from edge cache without letting unauthorized users download it.
- **Asynchronous Media Processing Pipeline**:
  When an image or video is uploaded to S3:
  1. S3 emits an `s3:ObjectCreated:*` event to **Amazon SQS** or **EventBridge**.
  2. A worker pool picks up the message, generates thumbnails, compresses videos using FFmpeg, and writes optimized assets back to S3.

---

## 10. Performance Considerations

- **S3 Prefix Partitioning (High-Throughput IOPS)**:
  S3 automatically scales to support **3,500 PUTs/sec and 5,500 GETs/sec per prefix**. If you write 50,000 files/sec, do not put all files in a single flat directory (`/uploads/`). Distribute files across partitioned prefixes (`/uploads/2026/03/a1/`, `/uploads/2026/03/b2/`).
- **Range Requests (Byte Serving)**: Video streaming players (HLS, MP4) require HTTP `Range: bytes=0-1048575` headers to buffer video segments. S3 and CloudFront natively support byte-range requests.

---

## 11. Security Considerations

- **Server-Side Encryption (SSE-S3 / SSE-KMS)**: Enforce default AES-256 encryption at rest on all buckets:
  ```json
  "ServerSideEncryptionConfiguration": {
    "Rules": [{ "ApplyServerSideEncryptionByDefault": { "SSEAlgorithm": "AES256" } }]
  }
  ```
- **Hotlink Protection**: Configure CloudFront edge rules to inspect the `Referer` header and reject requests where the referring site is not your domain, preventing competitors from stealing your bandwidth.

---

## 12. Storage Class Comparison Matrix

| Storage Class | Availability | Retrieval Latency | Storage Cost / GB | Retrieval Cost | Best Used For |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **S3 Standard** | 99.99% | Milliseconds | $0.023 / mo | Free | Active, frequently accessed media |
| **S3 Standard-IA** | 99.9% | Milliseconds | $0.0125 / mo | $0.01 / GB | Long-term files accessed < once/mo |
| **S3 One Zone-IA** | 99.5% | Milliseconds | $0.010 / mo | $0.01 / GB | Non-critical, reproducible thumbnails|
| **S3 Glacier Instant**| 99.9% | Milliseconds | $0.004 / mo | $0.03 / GB | Rare access, immediate retrieval |
| **S3 Deep Archive** | 99.99% | 12 - 48 Hours | $0.00099 / mo | High | Regulatory compliance, legal archives|

---

## 13. Trade-offs

- **Direct Upload (Presigned URL) vs. Server-Proxied Upload**: Direct uploads save server CPU and bandwidth, but make it harder to validate file contents (e.g., scanning for viruses) before the file hits S3. Mitigate by running asynchronous virus scanning via S3 event triggers.
- **CloudFront Cache vs. S3 Cost**: CloudFront adds edge caching costs, but significantly reduces S3 direct egress bandwidth fees ($0.085/GB vs $0.09/GB + free tier savings), resulting in a net cost reduction.

---

## 14. Real-World Usage Case Studies

1. **Netflix**: Stores petabytes of raw video masters and transcode chunks in Amazon S3, distributing compressed video streams globally via Open Connect and CloudFront CDNs.
2. **Airbnb**: Implemented S3 presigned URLs for all user listing photo uploads, processing millions of images asynchronously through an SQS and serverless Lambda resizing pipeline.

---

## 15. Placement Interview Questions & Architectural Scenarios

### Tier 1: Basic
**Q: What is a Presigned URL in Amazon S3 and why is it used?**
> **Answer**: A Presigned URL is an S3 REST API URL generated by an application server using AWS IAM credentials that grants temporary, time-limited permission (e.g., 5 minutes) to perform a specific action (like `PUT` an upload or `GET` a download) on an S3 object. It is used to allow client browsers or mobile apps to upload or download files directly to/from S3 without exposing AWS secret keys and without streaming large files through application backend servers.

### Tier 2: Conceptual
**Q: Why should an S3 bucket used for website assets be placed behind a CDN like CloudFront instead of accessed directly?**
> **Answer**:
> 1. **Latency**: S3 buckets reside in a single geographic region. CloudFront distributes content across 400+ global edge PoPs, cutting download latency from ~200ms to <20ms worldwide.
> 2. **Security**: Allows you to block all public internet access to the S3 bucket using Origin Access Control (OAC), preventing bucket scraping.
> 3. **Cost**: Direct S3 egress bandwidth is more expensive than CloudFront CDN data transfer rates.
> 4. **DDoS & WAF**: CloudFront provides AWS Shield DDoS protection and AWS WAF integration at the edge.

### Tier 3: Implementation
**Q: How do you configure a bucket policy so that ONLY CloudFront can access the S3 bucket via Origin Access Control (OAC)?**
> **Answer**:
> ```json
> {
>   "Version": "2012-10-17",
>   "Statement": {
>     "Effect": "Allow",
>     "Principal": { "Service": "cloudfront.amazonaws.com" },
>     "Action": "s3:GetObject",
>     "Resource": "arn:aws:s3:::my-bucket-name/*",
>     "Condition": {
>       "StringEquals": { "AWS:SourceArn": "arn:aws:cloudfront::123456789012:distribution/EDFDVBD6EXAMPLE" }
>     }
>   }
> }
> ```

### Tier 4: Debugging
**Q: A frontend React application attempts to upload a file to S3 using a Presigned URL, but the browser blocks the request with: `Access to fetch has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present`. What is missing?**
> **Answer**: S3 requires a **Cross-Origin Resource Sharing (CORS)** configuration on the bucket itself because the browser's origin (`https://myfrontend.com`) differs from the S3 endpoint origin (`https://my-bucket.s3.amazonaws.com`).
> **Fix**: Add a CORS rule to the S3 bucket allowing `PUT` and `POST` methods from the frontend domain:
> ```json
> [
>   {
>     "AllowedHeaders": ["*"],
>     "AllowedMethods": ["PUT", "POST", "HEAD"],
>     "AllowedOrigins": ["https://myfrontend.com"],
>     "ExposeHeaders": ["ETag"]
>   }
> ]
> ```

### Tier 5: Scenario
**Q: Design the image upload and processing architecture for an Instagram-like service where users upload photos that must be available in 3 sizes (thumbnail, mobile feed, high-res desktop).**
> **Answer**:
> 1. Client requests a Presigned URL from the API server.
> 2. Client uploads the raw full-resolution image directly to an S3 `raw-uploads/` bucket.
> 3. S3 emits an `ObjectCreated` event to an **Amazon SQS** queue.
> 4. A cluster of worker nodes (or AWS Lambda functions) consumes the event, downloads the raw image, and generates 3 resized WebP variants (150x150, 600x600, 1080x1080) using `sharp`.
> 5. The resized images are saved to a separate `public-cdn-media/` S3 bucket.
> 6. The worker writes the image metadata and URLs to the PostgreSQL database and notifies the client via WebSockets.
> 7. Images are served to global users via **CloudFront CDN**.

### Tier 6: Advanced
**Q: How does S3 achieve 99.999999999% (11 9's) of data durability under the hood without traditional RAID arrays?**
> **Answer**:
> S3 uses **Erasure Coding** across multiple geographically separated Availability Zones (AZs) within a region:
> 1. When an object is uploaded, S3 splits the data into multiple data fragments and generates additional redundant parity fragments (e.g., Reed-Solomon coding: 8 data chunks + 4 parity chunks).
> 2. These 12 chunks are physically written across separate independent storage racks, facilities, and data centers in different AZs.
> 3. The object can be fully reconstructed even if multiple entire data centers or storage racks experience simultaneous power loss, hardware failure, or destruction.
> 4. Background integrity scrubbers continuously verify MD5/SHA256 checksums across all stored fragments, automatically re-generating corrupted chunks in real time.

---

## 16. Coding Question: Verify S3 Upload Completion & Validate File Integrity

### Problem
Write an Express route that client applications call after completing a direct Presigned URL upload to S3. The endpoint must:
1. Call S3 `HeadObject` to verify that the file actually exists in S3.
2. Verify that the uploaded file size does not exceed the allowed maximum (10MB).
3. Record the file record in the PostgreSQL database.

### Solution

```typescript
import { Request, Response } from 'express';
import { S3Client, HeadObjectCommand, NotFound } from '@aws-sdk/client-s3';
import { Pool } from 'pg';

const s3 = new S3Client({ region: 'us-east-1' });
const db = new Pool();
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB limit

export async function handleConfirmUpload(req: Request, res: Response): Promise<void> {
  const { fileKey, userId } = req.body;

  if (!fileKey || !userId) {
    res.status(400).json({ error: 'Missing fileKey or userId' });
    return;
  }

  try {
    // 1. Verify object metadata directly from S3
    const headCommand = new HeadObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: fileKey,
    });

    const s3Metadata = await s3.send(headCommand);

    // 2. Validate file size constraint
    const fileSize = s3Metadata.ContentLength || 0;
    if (fileSize === 0) {
      res.status(400).json({ error: 'Uploaded file is empty' });
      return;
    }

    if (fileSize > MAX_FILE_SIZE_BYTES) {
      res.status(413).json({ error: 'File exceeds maximum allowed size of 10MB' });
      return;
    }

    // 3. Persist file metadata into PostgreSQL database
    const insertResult = await db.query(
      `INSERT INTO user_files (user_id, file_key, size_bytes, content_type, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, file_key, created_at;`,
      [userId, fileKey, fileSize, s3Metadata.ContentType]
    );

    res.status(201).json({
      success: true,
      file: insertResult.rows[0],
    });
  } catch (error: any) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      res.status(404).json({ error: 'File was not found in S3 bucket. Upload may have failed.' });
      return;
    }
    console.error('[S3 Confirm Error]:', error);
    res.status(500).json({ error: 'Internal Server Error validating S3 upload' });
  }
}
```

---

## 17. Common Interview Traps

- **Trap 1**: Believing S3 is a standard POSIX filesystem.
  *Gotcha*: S3 is **Object Storage**, not a file system. You cannot perform partial append writes, in-place file edits, or atomic file renames. Renaming a "folder" in S3 actually copies every object to a new key and deletes the old objects!
- **Trap 2**: Giving S3 presigned URLs infinite expiration.
  *Gotcha*: Presigned upload URLs should be valid for only 2–5 minutes. A long-lived presigned URL allows anyone with the link to overwrite the object hours later.
- **Trap 3**: Thinking CloudFront caches everything by default.
  *Gotcha*: CloudFront only caches responses based on HTTP response headers (`Cache-Control`) or custom cache policies. If your origin returns `Cache-Control: no-cache` or `Set-Cookie`, CloudFront will bypass its edge cache and forward every request to S3.

---

## 18. Revision Summary

- **Object Storage**: Flat, distributed, REST-accessible storage for binary files (11 9's durability).
- **Presigned URLs**: Eliminates server bottlenecks by letting clients upload directly to S3.
- **Multipart Upload**: Splits files $> 100\text{MB}$ into parallel chunks with retry capability.
- **CloudFront OAC**: Blocks public S3 access; forces traffic through edge CDN with cryptographic signatures.
- **Cost Optimization**: Use S3 Lifecycle rules to transition cold data to Infrequent Access and Glacier.

---

## 19. Quick Reference

| Feature | Technology / API | Purpose |
| :--- | :--- | :--- |
| **Object Store** | Amazon S3 / GCS | Unstructured binary file storage |
| **Edge CDN** | AWS CloudFront / Cloudflare | Global edge caching & download acceleration |
| **Presigned URL** | `getSignedUrl(s3, command)` | Direct, secure browser-to-S3 uploads |
| **Multipart Upload** | `CreateMultipartUploadCommand` | High-reliability parallel uploads for large files |
| **Edge Security** | Origin Access Control (OAC) | Blocks direct public internet access to S3 |
| **CORS** | S3 Bucket Configuration | Permits browser `fetch` PUT requests across domains |
