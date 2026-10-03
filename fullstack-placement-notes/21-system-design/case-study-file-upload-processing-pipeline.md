# System Design Case Study: Scalable File Upload & Media Processing Pipeline

## 1. What is it?
A **Scalable File Upload & Media Processing Pipeline** (exemplified by YouTube, Instagram, Netflix, and Google Drive) is an asynchronous, event-driven distributed system designed to accept, validate, transcode, optimize, and distribute large binary files (images, audio, and multi-gigabyte videos) across the globe.

In this architecture, clients do not stream heavy binary files through primary application backend servers. Instead, servers act as coordinators that issue **cryptographically signed pre-signed URLs**, allowing clients to upload binary blobs directly to **Object Storage (Amazon S3 / Google Cloud Storage)** via multi-part uploads. Storage events then trigger asynchronous worker fleets that transcode videos into Adaptive Bitrate Streaming formats (HLS/DASH) and optimize images into modern formats (WebP/AVIF) before distributing them through a global **Content Delivery Network (CDN)**.

```
              DIRECT-TO-S3 UPLOAD & PROCESSING LIFECYCLE
              
    [ Client / Mobile ] ──1. Request Upload URL──► [ API Gateway / Auth ]
            │                                             │
            │                                             ▼
            │ ◄───2. Return S3 Presigned URL + File ID────┘
            │
            │ 3. Direct Multipart Upload (PUT)
            ▼
    ┌───────────────────────────┐
    │ Amazon S3 (Raw Bucket)    │
    └─────────────┬─────────────┘
                  │ 4. S3 Event Notification (ObjectCreated)
                  ▼
    ┌───────────────────────────┐
    │ Message Queue (AWS SQS)   │
    └─────────────┬─────────────┘
                  │ 5. Pull Job
                  ▼
    ┌───────────────────────────┐
    │ Transcoding Worker Pool   │
    │ (FFmpeg / Sharp Cluster)  │
    └─────────────┬─────────────┘
                  │ 6. Upload Transcoded HLS (.m3u8 + .ts)
                  ▼
    ┌───────────────────────────┐
    │ Amazon S3 (Output Bucket) │
    └─────────────┬─────────────┘
                  │ 7. Global Edge Caching
                  ▼
    ┌───────────────────────────┐
    │ Global CDN (CloudFront)   │ ◄──8. Stream Video── [ Viewing Users ]
    └───────────────────────────┘
```

---

## 2. Why does it exist?
Streaming binary files through standard application web servers (such as Node.js, Express, or Django) creates severe distributed systems failures:

1. **Application Server Thread & Socket Exhaustion**: A 2GB video upload over a mobile 4G connection takes 5 minutes. If 1,000 users upload simultaneously, 1,000 application worker threads or TCP connections remain locked, starving normal REST API traffic (such as login or checkout).
2. **Cascading Failure on Network Drops**: If a single monolithic HTTP POST request drops at 99% progress due to Wi-Fi jitter, the user must restart the entire 2GB upload from byte 0.
3. **Severe Compute & Memory Contention**: Media transcoding (e.g., executing `ffmpeg -i input.mp4 -vf scale=1280:720` or generating AVIF images) is CPU- and memory-intensive. Running FFmpeg inside the same container as the web API exhausts CPU cores, causing API health check timeouts and process crashes.
4. **Bandwidth Costs & High Latency**: Serving multi-gigabyte video files directly from an origin database or file server incurs prohibitive egress bandwidth costs and introduces unplayable latency for international users.

---

## 3. Step 1: Requirements Clarification

### Functional Requirements
1. **Resumable Direct Uploads**: Allow users to upload videos up to 5GB and images up to 50MB directly to cloud storage without routing traffic through application servers.
2. **Chunked / Multipart Processing**: Support pausing and resuming uploads across intermittent network failures.
3. **Adaptive Bitrate Transcoding (ABR)**: Convert uploaded videos into multiple resolutions (1080p, 720p, 480p, 360p) and package them as **HLS (HTTP Live Streaming)** playlists (`.m3u8` and `.ts` segments).
4. **Image Optimization**: Automatically generate responsive thumbnails, compress images, and convert formats to WebP and AVIF.
5. **Global CDN Distribution**: Fast, buffer-free playback worldwide with low initial startup latency ($< 1$ second).

### Non-Functional Requirements
1. **High Availability**: 99.99% availability for upload URL generation and media streaming.
2. **Scalability**: Capable of processing 50,000 video uploads and 5 million image uploads per day.
3. **Reliability & Data Durability**: Zero data loss (99.999999999% durability backed by AWS S3).
4. **Security**: Uploaded files must be scanned for malicious payloads; streaming URLs must support tokenized expiration to prevent unauthorized hotlinking.

---

## 4. Step 2: Capacity Estimation & Back-of-the-Envelope Math

### A. Upload Ingestion & Traffic
- **Daily Uploads**:
  - Videos: 50,000 uploads/day ($\approx 100\text{ MB}$ average).
  - Images: 5,000,000 uploads/day ($\approx 2\text{ MB}$ average).
- **Daily Storage Ingress**:
  $$\text{Video Ingress} = 50,000 \times 100\text{ MB} = \mathbf{5 \text{ Terabytes / day}}$$
  $$\text{Image Ingress} = 5,000,000 \times 2\text{ MB} = \mathbf{10 \text{ Terabytes / day}}$$
  $$\text{Total Daily Raw Storage} = \mathbf{15 \text{ TB / day}}$$
- **Average Ingestion Bandwidth**:
  $$\frac{15 \text{ TB}}{86,400 \text{ sec}} \approx \frac{15,000,000 \text{ MB}}{86,400} \approx \mathbf{173.6 \text{ MB/sec}} \approx \mathbf{1.4 \text{ Gbps Ingress}}$$

### B. Transcoding Storage Expansion
- Each video is transcoded into 4 bitrates (1080p, 720p, 480p, 360p) + HLS manifest. This creates an estimated **1.8x storage multiplier**:
  $$\text{Processed Video Daily} = 5\text{ TB} \times 1.8 = \mathbf{9 \text{ TB / day}}$$
- Compressed images (WebP/AVIF thumbnails at 3 sizes: small, medium, large) reduce original file size to $\approx 40\%$:
  $$\text{Processed Image Daily} = 10\text{ TB} \times 0.4 = \mathbf{4 \text{ TB / day}}$$
- **Total Processed Storage Added**: **13 TB / day**.
- **Annual Storage Footprint**:
  $$13 \text{ TB/day} \times 365 \text{ days} \approx \mathbf{4.7 \text{ Petabytes / year}}$$

### C. Compute Estimation for Transcoding
- Average video duration: 3 minutes.
- Transcoding 3 minutes of 1080p video using FFmpeg on a modern 8-core CPU takes roughly **60 seconds** of compute time.
- Total daily video compute seconds:
  $$50,000 \times 60 \text{ seconds} = 3,000,000 \text{ CPU seconds / day}$$
- Required concurrent worker instances:
  $$\frac{3,000,000 \text{ CPU seconds}}{86,400 \text{ sec}} \approx \mathbf{35 \text{ dedicated 8-core worker nodes}}$$
- Accounting for a 3x peak load multiplier: **$\approx 105$ auto-scaling worker nodes** required at peak hours.

---

## 5. Step 3: High-Level Architecture & End-to-End Flow

```
                     MEDIA PIPELINE END-TO-END ARCHITECTURE

 [ Client / Mobile App ]
      │
      ├── 1. POST /api/v1/media/upload-url (fileName, fileSize, mimeType)
      ▼
 ┌────────────────────────┐
 │ Ingestion API Gateway  │ ── 2. Authenticates JWT, inserts DB record: status='INITIALIZING'
 └──────────┬─────────────┘
            │
            ├── 3. Returns S3 Presigned Multipart URLs (Part 1, 2, ..., N)
            ▼
 [ Client / Mobile App ]
      │
      ├── 4. Uploads Parts (5MB chunks) directly to S3 via HTTP PUT
      ├── 5. POST /api/v1/media/complete-upload (ETags list)
      ▼
 ┌────────────────────────┐
 │ Ingestion API Gateway  │ ── 6. Invokes S3:CompleteMultipartUpload
 └──────────┬─────────────┘
            │
            ▼
 ┌────────────────────────────────────────────────────────┐
 │ Amazon S3 Raw Storage Bucket (`s3://raw-media-bucket`) │
 └──────────────────────────┬─────────────────────────────┘
                            │
                            ├── 7. S3 Event Notification: `s3:ObjectCreated:*`
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │ Amazon SQS Transcode Queue (`media-transcode-jobs`)    │
 └──────────────────────────┬─────────────────────────────┘
                            │
                            ├── 8. Long-polling Consumer Fleet
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │ Auto-Scaling Worker Cluster (EC2 / ECS Fargate Spot)   │
 │ • Downloads raw master file from S3                    │
 │ • FFmpeg: Scales to 1080p, 720p, 480p                  │
 │ • Generates HLS playlists (`master.m3u8`, `.ts` chunks)│
 │ • Sharp: Generates WebP & AVIF thumbnails              │
 └──────────────────────────┬─────────────────────────────┘
                            │
                            ├── 9. Uploads transcoded packages
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │ Amazon S3 Processed Bucket (`s3://cdn-media-output`)   │
 └──────────────────────────┬─────────────────────────────┘
                            │
                            ├── 10. Origin Shield & Edge Caching
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │ Global CDN (CloudFront / Cloudflare Stream)            │
 └──────────────────────────┬─────────────────────────────┘
                            │
                            ├── 11. HLS Video Stream (<1s latency)
                            ▼
               [ End-User Video Players ]
```

---

## 6. Step 4: Deep Dive & Technical Bottlenecks

### Deep Dive 1: Direct-to-S3 Multipart Upload with Presigned URLs
To prevent large uploads from terminating on dropped connections, the system employs **S3 Multipart Upload**:

1. **Initiation**:
   The client calls the API: `POST /api/v1/media/upload/initiate` with `fileSize` (e.g., 500MB) and `fileName`.
   The API requests a `UploadId` from AWS S3 (`s3.createMultipartUpload`).
2. **URL Generation**:
   The API divides the file into 5MB chunks (100 parts total).
   The API generates 100 individual S3 Presigned PUT URLs (each valid for 1 hour) using AWS SDK:
   `s3.getSignedUrl('uploadPart', { PartNumber: i, UploadId })`.
3. **Parallel Client Upload**:
   The client uploads up to 4 chunks concurrently via HTTP PUT directly to S3.
   Each completed part returns an `ETag` header (MD5 checksum of that chunk).
4. **Completion**:
   Once all parts are uploaded, the client sends the list of `{ PartNumber, ETag }` to the API.
   The API calls `s3.completeMultipartUpload`. S3 stitches the parts into a single object atomically.

```typescript
// S3 Multipart Presigned URL Generation
import { S3Client, CreateMultipartUploadCommand, UploadPartCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: 'us-east-1' });

export async function generateMultipartUploadUrls(bucket: string, key: string, totalParts: number) {
  const multipart = await s3.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key }));
  const uploadId = multipart.UploadId!;

  const presignedUrls: { partNumber: number; url: string }[] = [];
  for (let i = 1; i <= totalParts; i++) {
    const command = new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: i,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
    presignedUrls.push({ partNumber: i, url });
  }

  return { uploadId, presignedUrls };
}
```

---

### Deep Dive 2: Adaptive Bitrate Streaming (HLS vs. DASH)
Serving a raw 1080p MP4 file directly to users causes continuous buffering on mobile networks. **Adaptive Bitrate Streaming (ABR)** dynamically adjusts video resolution to match the viewer's current network bandwidth in real time.

```
Master Playlist (`master.m3u8`):
├── #EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080 -> 1080p.m3u8
├── #EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720  -> 720p.m3u8
└── #EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360    -> 360p.m3u8

Child Playlist (`720p.m3u8`):
├── #EXTINF:6.0,
├── segment_001.ts (6-second video slice)
├── #EXTINF:6.0,
├── segment_002.ts
```

**Worker Transcoding Pipeline**:
1. The worker pulls a job from AWS SQS.
2. The worker downloads the raw file to local NVMe scratch disk (`/tmp/video.mp4`).
3. Executes FFmpeg command generating segmented HLS files:
   ```bash
   ffmpeg -i /tmp/video.mp4 \
     -filter_complex \
     "[0:v]split=3[v1][v2][v3]; \
      [v1]scale=w=1920:h=1080[v1out]; \
      [v2]scale=w=1280:h=720[v2out]; \
      [v3]scale=w=640:h=360[v3out]" \
     -map "[v1out]" -c:v:0 libx264 -b:v:0 5000k \
     -map "[v2out]" -c:v:1 libx264 -b:v:1 2500k \
     -map "[v3out]" -c:v:2 libx264 -b:v:2 800k \
     -f hls -hls_time 6 -hls_playlist_type vod \
     -master_pl_name master.m3u8 /tmp/output_%v.m3u8
   ```
4. The worker uploads the generated `.m3u8` playlists and `.ts` chunk files to the output S3 bucket.
5. Updates database state: `status = 'READY'`, `playbackUrl = 'https://cdn.domain.com/videos/123/master.m3u8'`.

---

### Deep Dive 3: Worker Auto-Scaling & Spot Fleet Economics
Transcoding is compute-heavy. Running always-on on-demand servers is economically prohibitive.

1. **Queue-Depth Metric Scaling**:
   Scale the ECS/Kubernetes worker cluster based on SQS `ApproximateNumberOfMessagesVisible`.
   $$\text{Desired Workers} = \left\lceil \frac{\text{SQS Queue Depth}}{\text{Target Jobs per Worker}} \right\rceil$$
2. **AWS Spot Instances (70-90% Cost Savings)**:
   Transcoding tasks are stateless and interruptible. Workers utilize AWS Spot instances. If an instance receives a 2-minute termination notice:
   - The worker stops taking new jobs.
   - SQS visibility timeout expires for in-progress jobs; the message returns to the queue automatically for another worker to process.
3. **Dead Letter Queue (DLQ)**:
   Corrupted video files (e.g., malformed codec headers) cause FFmpeg to exit with error code 1. If a job fails 3 consecutive times, SQS moves it to a DLQ, and the DB marks the video as `status = 'FAILED_CORRUPT_MEDIA'`.

---

### Deep Dive 4: CDN Edge Caching & Byte-Range Requests
Video streaming traffic places immense load on origin storage.

1. **Cache Hierarchy for HLS**:
   - `.ts` Video Segments (6-second binary slices): Static and immutable. Cached at CDN edge for **365 days** (`Cache-Control: public, max-age=31536000, immutable`).
   - `.m3u8` Playlists: Small text files. For VOD, cached for 24 hours. For live streaming, cached for only 2 seconds (`max-age=2`).
2. **HTTP Byte-Range Requests (`Range: bytes=0-1048576`)**:
   Allows video players to request specific byte ranges (e.g., the first 1MB of metadata or seeking to minute 45) without downloading the preceding 400MB of data. The CDN must support and cache `206 Partial Content` responses.
3. **Origin Shield**:
   A centralized caching tier between regional CDN edge nodes and the S3 bucket. If 1,000 edge nodes globally request the same viral video segment simultaneously, they hit the Origin Shield, reducing S3 GET requests by 99%.

---

## 7. Important Rules

1. **Never Buffer Files in Web Server Memory (`Buffer.from(file)`)**: Buffering a 1GB file in Node.js RAM triggers V8 garbage collection freezes and crashes the process. Always stream directly to disk or bypass the server using S3 Presigned URLs.
2. **Enforce MIME Type & Magic Byte Validation**: Never trust the client-provided file extension or `Content-Type` header (an attacker can name a shell script `virus.jpg`). Inspect the initial 512 bytes (file signatures / magic numbers: e.g., `FF D8 FF` for JPEG, `89 50 4E 47` for PNG).
3. **Set S3 Bucket Lifecycle Rules**: Configure automated S3 Lifecycle policies:
   - Raw uploaded videos: Delete or transition to Glacier Instant Retrieval after 7 days (since transcoded HLS versions are what users actually view).
   - Incomplete multipart uploads: Automatically abort after 24 hours to avoid paying for abandoned orphaned chunks.
4. **Use Content-MD5 / SHA-256 for Chunk Integrity**: Pass the chunk MD5 hash in the presigned upload request header. S3 rejects any chunk where the stored hash does not match the received bytes, preventing corruption over unstable networks.

---

## 8. Common Mistakes & Anti-Patterns

### 1. Uploading Files Monolithically Over REST APIs
Routing raw media payloads through `POST /api/upload` via `multer` in Node.js ties up HTTP workers, blows through API Gateway payload size limits (e.g., AWS API Gateway has a hard 10MB payload ceiling), and causes random timeouts. Always use S3 Presigned Direct Uploads.

### 2. Synchronous Transcoding Inside the Request Handler
Attempting to run FFmpeg inside the HTTP request handler causes the HTTP connection to time out after 30 seconds. All media processing must be completely asynchronous and decoupled via message queues (SQS/RabbitMQ).

### 3. Missing S3 CORS Configuration
Failing to configure `AllowedOrigins`, `AllowedMethods` (`PUT`, `POST`), and `ExposeHeaders` (`ETag`) on the S3 bucket blocks browsers from uploading directly or reading chunk ETags due to browser CORS security policies.

---

## 9. Best Practices

- **Client-Side Video Compression**: Modern mobile apps compress videos using device-native hardware encoders (H.264 / HEVC) prior to initiating uploads, cutting upload bandwidth and time by up to 70%.
- **UUID / Hash-Based S3 Key Partitioning**: Prefix S3 keys with a hash or UUID (e.g., `s3://bucket/raw/7a/8b/video-123.mp4`). This prevents S3 partition throttling under extreme write volume (S3 supports 3,500 PUTs/sec per partitioned prefix).
- **Graceful Webhooks for Client Updates**: Notify clients of processing progress (e.g., "Transcoding: 45%") using WebSockets or Server-Sent Events (SSE) driven by worker status updates.

---

## 10. Performance Considerations

- **S3 Transfer Acceleration**: Uses AWS globally distributed edge locations to route uploads over the optimized AWS private backbone network instead of the public internet, accelerating international uploads by up to 300%.
- **Parallel Chunk Uploads**: Uploading 4-8 chunks concurrently over multiple HTTP/2 or HTTP/1.1 TCP streams saturates the client's uplink bandwidth far more effectively than sequential single-part uploads.
- **Hardware-Accelerated Encoding**: Utilize GPU instances (e.g., NVIDIA NVENC / AWS EC2 G4dn instances) for video transcoding. GPU encoding is 5x to 10x faster than pure CPU-based x264 software encoding.

---

## 11. Security Considerations

- **Time-Limited Presigned URLs**: Issue Presigned URLs with tight expiration windows (e.g., 15 minutes for URL usage).
- **Asynchronous Antivirus Scanning**: Scan every uploaded file before transcoding using ClamAV or AWS GuardDuty Malware Protection for S3. If infected, the file is immediately quarantined and deleted.
- **Signed CloudFront URLs / Cookies**: For premium or paid content (e.g., Netflix), serve HLS playlists via signed CDN cookies to prevent unauthorized hotlinking and URL sharing.

---

## 12. Alternatives

| Component | Selected Approach | Alternative | Trade-off Analysis |
|---|---|---|---|
| **Storage** | AWS S3 | Self-hosted MinIO / Ceph | S3 provides 11 9s durability and zero maintenance; MinIO requires extensive hardware ops. |
| **Transcoder** | FFmpeg on Spot Workers | AWS Elemental MediaConvert | Custom FFmpeg workers are 75% cheaper at high scale, but require container orchestration and maintenance. |
| **Streaming** | HLS (HTTP Live Streaming) | Progressive MP4 Download | Progressive download cannot adapt to changing bandwidth; HLS adapts resolution dynamically every 6 seconds. |
| **Queue** | AWS SQS | Apache Kafka | SQS requires zero cluster management and provides native S3 event triggering; Kafka is superior only if strict stream ordering is required. |

---

## 13. Trade-offs

- **Direct-to-S3 vs. Backend Proxying**:
  Direct S3 upload eliminates server load and allows massive scale, but shifts complexity to the client (managing multipart state, retries, and stitching completion requests).
- **Granular Chunks (2s) vs. Standard Chunks (6s) in HLS**:
  2-second video chunks provide faster startup time and rapid bitrate adaptation, but generate 3x more files on S3 and increase HTTP request overhead. 6-second segments represent the industry sweet spot between latency and overhead.

---

## 14. Real-World Usage & Implementation Example

Here is a production-grade TypeScript implementation of an **S3 Upload Coordinator** and an **SQS Transcode Worker Consumer**:

```typescript
// media-pipeline.ts
import { S3Client, CompleteMultipartUploadCommand, CreateMultipartUploadCommand, UploadPartCommand } from '@aws-sdk/client-s3';
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: 'us-east-1' });
const sqs = new SQSClient({ region: 'us-east-1' });

// 1. Upload Coordinator: Initiates Direct S3 Multipart Upload
export class UploadCoordinator {
  private bucket = process.env.RAW_MEDIA_BUCKET || 'media-raw-uploads';

  async initiateUpload(fileName: string, mimeType: string, totalParts: number) {
    const s3Key = `raw/${Date.now()}-${fileName}`;

    // Create multipart upload in S3
    const multipart = await s3.send(new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: s3Key,
      ContentType: mimeType,
    }));

    const uploadId = multipart.UploadId!;

    // Generate Presigned PUT URLs for each chunk (5MB - 20MB per part)
    const partUrls = await Promise.all(
      Array.from({ length: totalParts }, async (_, i) => {
        const partNumber = i + 1;
        const command = new UploadPartCommand({
          Bucket: this.bucket,
          Key: s3Key,
          UploadId: uploadId,
          PartNumber: partNumber,
        });

        const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
        return { partNumber, url };
      })
    );

    return { uploadId, s3Key, partUrls };
  }

  async finalizeUpload(s3Key: string, uploadId: string, parts: { PartNumber: number; ETag: string }[]) {
    // Sort parts strictly in ascending numerical order
    const sortedParts = parts.sort((a, b) => a.PartNumber - b.PartNumber);

    const result = await s3.send(new CompleteMultipartUploadCommand({
      Bucket: this.bucket,
      Key: s3Key,
      UploadId: uploadId,
      MultipartUpload: { Parts: sortedParts },
    }));

    return { success: true, location: result.Location, key: s3Key };
  }
}

// 2. Transcode Worker: Pulls Jobs from SQS and Simulates FFmpeg Pipeline
export class TranscodeWorker {
  private queueUrl = process.env.TRANSCODE_QUEUE_URL || 'https://sqs.us-east-1.amazonaws.com/123/transcode-jobs';

  async startProcessing() {
    console.log('[WORKER]: Listening for media transcode tasks...');

    while (true) {
      try {
        const response = await sqs.send(new ReceiveMessageCommand({
          QueueUrl: this.queueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 20, // Long-polling to eliminate empty SQS charges
        }));

        if (!response.Messages || response.Messages.length === 0) continue;

        const message = response.Messages[0];
        const body = JSON.parse(message.Body!);

        console.log(`[JOB RECEIVED]: Processing media key: ${body.s3Key}`);
        await this.executeFFmpegTranscode(body.s3Key);

        // Delete job from queue upon successful transcode
        await sqs.send(new DeleteMessageCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: message.ReceiptHandle!,
        }));

        console.log(`[JOB COMPLETE]: Successfully transcoded ${body.s3Key}`);
      } catch (err: any) {
        console.error(`[WORKER ERROR]: Failed processing job: ${err.message}`);
        // Message will become visible again in SQS after visibility timeout expires
      }
    }
  }

  private async executeFFmpegTranscode(s3Key: string): Promise<void> {
    // In production, execute FFmpeg child_process streaming HLS chunks to S3 output bucket
    return new Promise((resolve) => setTimeout(resolve, 2000));
  }
}
```

---

## 15. Placement Interview Questions & Deep Answers

### 1. Basic: Why do modern systems avoid streaming file uploads directly through Node.js web servers?
**Answer**:
Streaming large binary uploads through application servers locks up worker threads, consumes process memory buffers, exhausts network sockets, and makes web servers vulnerable to Denial of Service (DoS) attacks. Furthermore, web frameworks cannot efficiently pause, resume, or distribute multi-gigabyte files. Bypassing servers using S3 Presigned URLs shifts network ingestion to cloud object stores optimized for high concurrency.

### 2. Conceptual: How does HLS Adaptive Bitrate Streaming work, and why is it preferred over raw MP4 streaming?
**Answer**:
Progressive MP4 download forces the client to download a single fixed-resolution file. If network speed degrades, playback freezes to buffer. 
**HLS (HTTP Live Streaming)** solves this by:
1. Transcoding the video into multiple resolutions (1080p, 720p, 480p, 360p) and slicing each into small, independent 6-second `.ts` segments.
2. Providing a `master.m3u8` playlist indexing the resolutions.
3. The video player continuously monitors network throughput; if bandwidth drops, the player seamlessly switches to requesting lower-bitrate segments on the next 6-second boundary without interrupting playback.

### 3. Implementation: How do you handle a scenario where a user's connection drops during a 3GB upload?
**Answer**:
By utilizing **S3 Multipart Upload**:
1. The 3GB file is split into 600 individual 5MB chunks on the client side.
2. The client records which chunk numbers have succeeded (`PartNumber` and `ETag`) in local storage (`IndexedDB`).
3. When the network reconnects, the client checks the list of completed parts against the server (`s3.listParts`), skips already-uploaded chunks, and resumes uploading only the missing chunks.

### 4. Debugging: Transcoding workers are running out of disk space on `/tmp` and crashing during peak hours. How do you resolve this?
**Answer**:
1. **Root Cause**: Downloading complete raw 4K videos to the local ephemeral disk before invoking FFmpeg exhausts container disk limits when multiple transcode threads run simultaneously.
2. **Immediate Remediation**:
   - Stream data directly into FFmpeg via pipes/stdin using S3 read streams without saving the complete raw file to disk.
   - Attach auto-expanding Amazon EBS volumes or mount Amazon EFS for shared temporary scratch space.
3. **Architectural Fix**: Add a pre-transcode step that validates and caps incoming video durations, and ensure cleanup handlers reliably delete temporary directories in `finally` blocks even when FFmpeg encounters fatal errors.

### 5. Scenario: How do you prevent unauthorized hotlinking of your private video streams on external websites?
**Answer**:
1. Keep the S3 bucket completely private (block all public read access).
2. Configure **CloudFront Signed URLs or Signed Cookies**.
3. When an authenticated user requests to watch a video, the backend verifies their subscription and issues a short-lived cryptographically signed CloudFront cookie (valid for the duration of the media session).
4. CloudFront validates the cryptographic signature at the edge before serving `.m3u8` playlists and `.ts` video chunks. External websites lacking the cookie receive HTTP 403 Forbidden.

### 6. Advanced: How would you design video deduplication to avoid storing identical viral videos uploaded by 10,000 different users?
**Answer**:
1. **Client-Side Hashing**: The client computes a cryptographic hash (e.g., SHA-256) of the raw binary file before initiating the upload.
2. **Hash Lookup**: The client sends the file hash to `POST /api/v1/media/verify-hash`.
3. If the hash exists in the database, the system immediately returns a reference to the existing processed media URL, completing the "upload" in **0 seconds** with zero storage duplication.
4. If not found, the upload proceeds normally.

---

## 16. Coding Questions & Practical Challenges

1. **Client-Side Chunk Slicer**: Write a JavaScript/TypeScript function using the browser `Blob.slice()` API to split a `File` object into 5MB chunks and upload them concurrently with a limit of 3 in-flight requests.
2. **MIME Type Magic Byte Checker**: Implement a Node.js stream function that reads the first 12 bytes of a stream to identify whether the file is a true PNG, JPEG, or MP4 file, rejecting the stream if mismatched.
3. **Exponential Backoff Chunk Uploader**: Write an upload wrapper in TypeScript that retries a failed chunk upload up to 4 times using exponential backoff before marking the part as failed.

---

## 17. Common Interview Traps

- **Trap 1: Forgetting that S3 has a 5MB minimum chunk size for multipart uploads**: S3 enforces that every part in a multipart upload must be at least 5MB (except the final terminating part). If you divide a 20MB file into 1MB chunks, `CompleteMultipartUpload` will fail with an `EntityTooSmall` error.
- **Trap 2: Generating presigned URLs that expire too quickly**: If you set a presigned URL expiration of 60 seconds on a 2GB file, a user with a slow 3G connection will see the upload fail midway through because the URL signature expired before the chunk transfer finished.
- **Trap 3: Believing video files must be completely downloaded before playback starts**: Modern streaming uses chunked HLS/DASH. Never propose downloading a full MP4 file to mobile device storage prior to playing.

---

## 18. Revision Summary

- **Direct Upload Flow**: Client $\rightarrow$ API Gateway (Auth & Presigned URL generation) $\rightarrow$ Direct S3 Multipart PUT $\rightarrow$ S3 Event Notification $\rightarrow$ SQS Queue $\rightarrow$ Transcoder Fleet.
- **Transcoding & Streaming**: FFmpeg generates HLS multi-bitrate playlists (`.m3u8`) and 6-second `.ts` segments, enabling adaptive bitrate streaming across mobile networks.
- **Scaling Economics**: Use AWS Spot instances auto-scaled based on SQS queue depth; use S3 lifecycle rules to transition or delete raw masters after transcoding.
- **Delivery**: Global CDN (CloudFront) caching static `.ts` chunks for 1 year with Origin Shield and signed cookies for DRM security.

---

## 19. Quick Reference Cheatsheet

```bash
# Common HLS FFmpeg Transcode Command
ffmpeg -i input.mp4 \
  -c:v libx264 -crf 20 -preset veryfast \
  -hls_time 6 -hls_playlist_type vod \
  -hls_segment_filename "segment_%03d.ts" master.m3u8

# S3 Presigned URL Sizing Heuristics
Single Part Upload: Max 5 GB
Multipart Upload:   Min Part Size: 5 MB | Max Part Size: 5 GB | Max Parts: 10,000 (Up to 5 TB total)

# Recommended CDN Cache-Control Headers
.ts video chunks:   Cache-Control: public, max-age=31536000, immutable
.m3u8 playlist:     Cache-Control: public, max-age=86400 (VOD) | max-age=2 (Live)
```
