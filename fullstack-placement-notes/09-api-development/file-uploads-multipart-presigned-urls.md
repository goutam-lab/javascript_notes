# File Uploads: Multipart Form Data vs. S3/GCS Presigned Direct Upload URLs

## 1. What is it?
File uploading in full-stack web applications can be architected using two primary paradigms:
1. **Server-Proxied Multipart Upload (`multipart/form-data`):** The client transmits the binary file stream directly to your application backend (Node.js/Express server via `multer` or `busboy`). The application server buffers or streams the bytes to disk or forwards them to an object storage bucket (AWS S3 / Google Cloud Storage).
2. **Direct-to-Cloud Presigned URL Upload:** The client requests a short-lived, cryptographically signed upload URL (`AWS S3 Presigned URL`) from the backend. The backend validates user authorization and parameters, then returns the signed URL. The client transmits the heavy binary file **directly from the browser to AWS S3 / Cloud Storage**, bypassing the application server entirely.

```
+-------------------------------------------------------------------------------+
|                       FILE UPLOAD ARCHITECTURAL PATTERNS                      |
+-------------------------------------------------------------------------------+
| PATTERN A: SERVER-PROXIED (Bottleneck)                                        |
| Client ===(Heavy 100MB File)===> [ Node.js Backend Server ] ===> [ AWS S3 ]   |
|                                    * Eats CPU, RAM & Network Bandwidth!       |
|                                                                               |
| PATTERN B: PRESIGNED DIRECT UPLOAD (Production Gold Standard)                 |
| 1. Client ---> Request Presigned URL ---> [ Node.js Backend ] (Tiny JSON)    |
| 2. Client <--- Returns Signed PUT URL <--- [ Node.js Backend ] (5ms)          |
| 3. Client ==================(Direct 100MB Stream)==================> [ S3 ]   |
| 4. Client ---> "Upload Complete" Notification ---> [ Node.js Backend ]        |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?
Streaming large files (videos, high-res photos, large PDFs) directly through a Node.js application server introduces severe architectural bottlenecks:
- **Event Loop & Memory Starvation:** Buffering multiple 50MB files in Node.js heap memory easily exhausts V8 RAM, triggering Out-Of-Memory (OOM) pod crashes.
- **Worker Thread Exhaustion:** Handling long-running HTTP upload streams ties up server sockets for 30-60 seconds, preventing the server from handling lightweight JSON API requests.
- **Double Bandwidth Costs:** The company pays for incoming bandwidth from the user to the server, and pays a second time to upload from the server to S3!

Presigned direct uploads offload 100% of the heavy binary transport to highly available cloud infrastructure (AWS S3), keeping your Node.js application lean, responsive, and inexpensive.

---

## 3. Mental Model
Think of File Uploading as **Delivering a 2-Ton Industrial Steel Safe to a Bank**:
- **Server-Proxied Upload (The Fragile Mailman):** You tell the bicycle courier (your Node.js server) to strap the 2-ton steel safe onto his bicycle, pedal it to the post office, and then deliver it to the bank vault. The bicycle breaks, traffic halts, and all normal mail delivery is blocked.
- **Presigned Direct Upload (The Authorized Delivery Pass):** You visit the bank manager (your Node.js backend). The manager inspects your ID and gives you a **one-time stamped access pass valid for 15 minutes** (Presigned URL). You hire a heavy crane truck (AWS S3) to take the safe directly to the loading dock. The bicycle courier was never burdened!

---

## 4. Basic Example

### Server-Proxied Upload with Multer (Small Files Only)
```typescript
// server/routes/upload.ts
import express from 'express';
import multer from 'multer';

const upload = multer({
  limits: { fileSize: 5 * 1024 * 1024 }, // Max 5MB
  dest: '/tmp/uploads/',
});

const router = express.Router();

// Uploading small avatars (<5MB)
router.post('/avatar', upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file provided' });

  console.log(`Saved temporary avatar file: ${req.file.path}`);
  return res.status(200).json({ success: true, fileName: req.file.filename });
});
```

---

## 5. Real Example

### Production Presigned S3 Upload Pipeline (AWS SDK v3 + Client Fetch)
```typescript
// 1. BACKEND: api/uploads/presignedUrl/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export async function POST(req: NextRequest) {
  try {
    const { filename, contentType, fileSize } = await req.json();

    // 1. Strict Validation
    const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
    if (!ALLOWED_MIME_TYPES.includes(contentType)) {
      return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
    }

    if (fileSize > 50 * 1024 * 1024) {
      // 50MB Cap
      return NextResponse.json({ error: 'File exceeds 50MB limit' }, { status: 400 });
    }

    // 2. Generate Collision-Resistant Storage Key
    const fileExtension = filename.split('.').pop();
    const uniqueKey = `uploads/${Date.now()}-${crypto.randomUUID()}.${fileExtension}`;

    // 3. Construct S3 Command with Exact Content-Type
    const command = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET_NAME!,
      Key: uniqueKey,
      ContentType: contentType,
    });

    // 4. Generate Presigned URL expiring in 15 minutes (900s)
    const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 900 });

    return NextResponse.json({
      uploadUrl: presignedUrl,
      fileKey: uniqueKey,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 });
  }
}
```

```typescript
// 2. FRONTEND CLIENT: components/DirectUploader.tsx
'use client';

import { useState } from 'react';

export function DirectUploader() {
  const [progress, setProgress] = useState<number>(0);
  const [isUploading, setIsUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setProgress(5);

    try {
      // Step A: Request Presigned URL from our API
      const res = await fetch('/api/uploads/presignedUrl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
          fileSize: file.size,
        }),
      });

      if (!res.ok) throw new Error('Authorization rejected');
      const { uploadUrl, fileKey } = await res.json();
      setProgress(25);

      // Step B: Upload file DIRECTLY to AWS S3 using XMLHttpRequest for progress
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('Content-Type', file.type); // MUST match presigned ContentType exactly!

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percent = 25 + Math.round((event.loaded / event.total) * 70);
            setProgress(percent);
          }
        };

        xhr.onload = () => (xhr.status === 200 ? resolve() : reject(new Error('S3 direct upload rejected')));
        xhr.onerror = () => reject(new Error('Network failure uploading to S3'));
        xhr.send(file);
      });

      setProgress(100);
      alert(`Upload complete! Stored at S3 key: ${fileKey}`);
    } catch (err: any) {
      alert(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="p-6 border rounded-lg max-w-md bg-white">
      <h3 className="font-bold text-lg mb-2">Direct Cloud File Upload</h3>
      <input type="file" onChange={handleFileChange} disabled={isUploading} className="mb-4" />
      {isUploading && (
        <div className="w-full bg-gray-200 h-2.5 rounded-full overflow-hidden">
          <div className="bg-blue-600 h-2.5 transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  );
}
```

---

## 6. Under the Hood

### 1. Cryptographic HMAC Signature Mechanics
An S3 Presigned URL embeds AWS Signature Version 4 (SigV4) parameters in query strings:
```http
https://my-bucket.s3.amazonaws.com/uploads/safe.png?
X-Amz-Algorithm=AWS4-HMAC-SHA256&
X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20260315%2Fus-east-1%2Fs3%2Faws4_request&
X-Amz-Date=20260315T120000Z&
X-Amz-Expires=900&
X-Amz-SignedHeaders=content-type%3Bhost&
X-Amz-Signature=a9f73b64c8d1...
```
- AWS S3 validates the cryptographic signature using your account's secret access key without contacting your backend server.
- If an attacker tampers with the expiration timestamp, bucket name, key path, or `Content-Type`, the signature check fails with `403 Forbidden`.

### 2. S3 CORS Configuration
Because the browser makes a direct cross-origin `PUT` request to `https://my-bucket.s3.amazonaws.com`:
- S3 **must** be configured with a CORS rule allowing your web domain:
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT", "POST"],
    "AllowedOrigins": ["https://myenterprise.com"],
    "ExposeHeaders": ["ETag"]
  }
]
```

---

## 7. Important Rules
1. **Content-Type Header Must Match Exactly:** When using Presigned URLs, the `Content-Type` header transmitted by the client in the `PUT` request **must exactly match** the `ContentType` declared when generating the presigned command on the server. If they differ by even a character, S3 rejects the request with `SignatureDoesNotMatch`.
2. **Never Expose S3 Credentials to the Client:** The client never receives AWS Access Keys or Secret Keys. The client receives only the short-lived presigned URL string.
3. **Use Collision-Resistant Keys:** Never use raw user filenames (e.g. `uploads/resume.pdf`). Use unique prefixes: `uploads/${userId}/${UUID}-${Date.now()}.pdf` to prevent users from accidentally overwriting other users' documents.
4. **Enforce Presigned Expiration Windows:** Set `expiresIn` to 15 minutes (900s) or less.

---

## 8. Common Mistakes

### Mistake 1: Missing S3 Bucket CORS Configuration
```
Browser Console Error: Access to XMLHttpRequest at 'https://bucket.s3.amazonaws.com'
from origin 'https://mywebsite.com' has been blocked by CORS policy.
```
**Fix:** Add a CORS policy on the S3 bucket via the AWS Console or Terraform.

### Mistake 2: Mismatched `Content-Type` on Direct Upload
```typescript
// Backend generated presigned URL with: ContentType: 'image/jpeg'
// Client uploaded with: xhr.setRequestHeader('Content-Type', 'image/png');
// Result: S3 responds with 403 Forbidden: SignatureDoesNotMatch!
```

---

## 9. Best Practices
1. **Magic Number (File Signature) Verification:** File extensions (`.jpg`) and MIME types (`image/jpeg`) can be easily spoofed by renaming a malicious executable `malware.exe` to `photo.jpg`. In post-processing (via AWS Lambda / S3 Event), inspect the first few bytes (the Magic Number, e.g. `FF D8 FF` for JPEG) to verify true binary type.
2. **Virus Scanning Pipeline:** Trigger an automated AWS Lambda function on `s3:ObjectCreated:*` to scan the newly uploaded file with ClamAV before marking it as "Active" in the database.
3. **Multipart S3 Uploads for Files >100MB:** For massive files (>100MB), use S3 Multipart Presigned Uploads, splitting the file into 5MB chunks and uploading in parallel.

---

## 10. Performance Considerations
- **Zero Server CPU/RAM Load:** Your application server processes only a tiny 200-byte JSON request to generate the presigned URL, allowing a tiny $5/mo Node.js server to handle thousands of concurrent file uploads.
- **Global AWS Edge Accelerations:** You can enable S3 Transfer Acceleration to route uploads through AWS CloudFront's global edge locations, increasing upload speeds by up to 300% for international users.

---

## 11. Security Considerations
- **Public Bucket Disallowance:** S3 buckets should **always** have "Block Public Access" enabled. Serve uploaded files through CloudFront signed cookies/URLs or private presigned download URLs.
- **Quota Abuse Prevention:** Ensure users cannot generate millions of presigned URLs without uploading files. Rate limit the presigned URL generation endpoint.

---

## 12. Alternatives
- **Third-Party Media Pipelines (Uploadcare / Cloudinary / Transloadit):** Managed SDKs handling uploading, transformations, and CDNs out-of-the-box.
- **Tus Resumable Upload Protocol:** Open-source protocol for reliable resumable uploads over poor connections.

---

## 13. Trade-offs

| Upload Pattern | Pros | Cons |
| :--- | :--- | :--- |
| **Server-Proxied (Multer)** | Simple; all logic in one server | Severe CPU/RAM bottleneck; double bandwidth |
| **Presigned URL (S3/GCS)** | Zero server load; massive scale; direct | Requires S3 CORS config; signature precision |
| **Managed (Cloudinary)** | Auto-crop; CDN included; zero maintenance | Expensive at enterprise scale |

---

## 14. Real-World Usage
- **YouTube / Loom Video Uploads:** Multi-gigabyte video files stream directly from the user's browser to Google Cloud Storage / S3 via chunked presigned uploads.
- **Slack / Discord Attachment Uploads:** Images and zip files are uploaded directly to Amazon S3 buckets via presigned authorization.

---

## 15. Placement Interview Questions

### Basic
**Q: Why is uploading large files directly through an application server (e.g. Node.js with Multer) considered an anti-pattern at production scale?**  
*Answer:* Streaming large files through the application server ties up Node.js worker threads and network sockets for extended periods, consumes heavy V8 heap memory buffering binary chunks, increases double bandwidth costs, and can easily crash the server with Out-Of-Memory (OOM) errors during concurrent uploads.

### Conceptual
**Q: How does a Presigned S3 Upload work step-by-step?**  
*Answer:*
1. The client sends a lightweight JSON request to the backend with filename, file size, and MIME type.
2. The backend validates user authorization and generates a short-lived AWS S3 Presigned URL using the AWS SDK.
3. The client receives the URL and executes an HTTP `PUT` request directly to the S3 bucket, uploading the binary file.
4. S3 verifies the cryptographic HMAC signature embedded in the URL and stores the object.
5. The client notifies the backend that the upload is complete, or an S3 Event Notification triggers an automated post-processing worker.

### Implementation
**Q: What AWS SDK v3 packages are required to generate an S3 presigned URL in Node.js?**  
*Answer:* `@aws-sdk/client-s3` (for `S3Client` and `PutObjectCommand`) and `@aws-sdk/s3-request-presigner` (for `getSignedUrl`).

### Debugging
**Q: A frontend upload to an S3 presigned URL fails with `403 Forbidden: SignatureDoesNotMatch`. What is the most common reason?**  
*Answer:* The `Content-Type` header sent by the client's `PUT` request did not match the `ContentType` specified when generating the presigned URL on the server. If the server declared `ContentType: 'image/jpeg'`, the client's HTTP request header must be strictly `Content-Type: image/jpeg`.

### Scenario
**Q: How do you prevent users from uploading malicious executable files disguised with fake `.png` extensions?**  
*Answer:* Never rely on file extensions or client-provided MIME types. After upload, inspect the **file's magic numbers** (the first 4-8 bytes of the binary header). For example, valid PNG files must begin with the byte sequence `89 50 4E 47 0D 0A 1A 0A`. If the magic number does not match a valid image specification, immediately delete the object from S3.

### Advanced
**Q: What is S3 Multipart Upload and when is it necessary for Presigned URLs?**  
*Answer:* AWS S3 single `PUT` uploads have a maximum size limit of 5GB and are vulnerable to network connection drops (a failure at 99% forces re-uploading from 0%). For files larger than 100MB, use **S3 Multipart Upload**: the client requests multiple presigned URLs (one per 5MB-10MB chunk), uploads chunks in parallel, and finally issues a `CompleteMultipartUpload` command to assemble the chunks into a single object on S3.

---

## 16. Coding Questions

### Problem: Implement a Magic Number Binary File Header Validator in TypeScript
```typescript
// utils/magicNumberValidator.ts

export async function validateImageMagicBytes(fileBuffer: Buffer): Promise<'jpeg' | 'png' | 'unknown'> {
  if (fileBuffer.length < 8) return 'unknown';

  // PNG Magic Number: 89 50 4E 47 0D 0A 1A 0A
  const isPng =
    fileBuffer[0] === 0x89 &&
    fileBuffer[1] === 0x50 &&
    fileBuffer[2] === 0x4e &&
    fileBuffer[3] === 0x47 &&
    fileBuffer[4] === 0x0d &&
    fileBuffer[5] === 0x0a &&
    fileBuffer[6] === 0x1a &&
    fileBuffer[7] === 0x0a;

  if (isPng) return 'png';

  // JPEG Magic Number: FF D8 FF
  const isJpeg =
    fileBuffer[0] === 0xff &&
    fileBuffer[1] === 0xd8 &&
    fileBuffer[2] === 0xff;

  if (isJpeg) return 'jpeg';

  return 'unknown';
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "Presigned URLs require public S3 bucket access."  
  *Truth:* False! S3 buckets should be strictly private. The presigned URL delegates temporary authorization via its embedded cryptographic HMAC signature.
- **Trap 2:** "Checking `file.name.endsWith('.png')` guarantees the file is an image."  
  *Truth:* False. Anyone can rename an `.exe` file to `.png`. Always verify magic bytes in binary headers.

---

## 18. Revision Summary
- Server-proxied uploads exhaust Node.js memory and worker threads.
- S3 Presigned URLs allow clients to upload heavy files directly to object storage with 0 server CPU overhead.
- Ensure S3 bucket has a valid CORS policy allowing `PUT` from your domain.
- `Content-Type` in the client request must match the presigned URL configuration exactly.
- Verify file authenticity using binary magic numbers rather than file extensions.

---

## 19. Quick Reference

```
+------------------------------------+-------------------------------------------+
| Direct Upload Component            | Purpose / Configuration                   |
+------------------------------------+-------------------------------------------+
| getSignedUrl(s3, command, {exp})   | Generates short-lived signed URL (e.g. 15m|
| PutObjectCommand                   | AWS SDK command declaring Bucket, Key, CT |
| S3 CORS Configuration              | Allows client domain to make direct PUT   |
| Content-Type Header Match          | Client header MUST match signed CT exactly|
| Magic Number Validation            | Binary header inspection (FF D8 FF / JPEG)|
| Collision-Free Key Design          | uploads/${userId}/${UUID}-${filename}     |
+------------------------------------+-------------------------------------------+
```
