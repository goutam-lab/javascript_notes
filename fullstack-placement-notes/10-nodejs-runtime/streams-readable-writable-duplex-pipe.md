# Node.js Streams: Readable, Writable, Duplex, Transform, and Backpressure

---

## 1. What is it?

A **Stream** in Node.js is an abstract interface for working with streaming data sequentially in chunks over time, rather than loading the entire payload into RAM at once. Built upon the `EventEmitter` architecture, streams allow developers to process datasets of arbitrary or infinite size (such as video feeds, multi-gigabyte logs, or real-time network traffic) with a tiny, constant memory footprint (often under 30MB).

Node.js defines four fundamental stream types:

1. **Readable Streams**: Sources of data from which bytes can be read (e.g., `fs.createReadStream`, `http.IncomingMessage`, `process.stdin`).
2. **Writable Streams**: Destinations to which bytes can be written (e.g., `fs.createWriteStream`, `http.ServerResponse`, `process.stdout`).
3. **Duplex Streams**: Streams that implement both Readable and Writable interfaces independently (e.g., a two-way network TCP socket via `net.Socket`).
4. **Transform Streams**: A specialized subclass of Duplex streams where the output is computed dynamically from the input (e.g., `zlib.createGzip` compression, `crypto.createCipheriv` encryption).

```
+-------------------------------------------------------------------------------+
|                           THE 4 STREAM CATEGORIES                             |
+-------------------------------------------------------------------------------+
| Stream Type | Read? | Write? | Typical Examples                               |
+-------------+-------+--------+------------------------------------------------+
| Readable    |  Yes  |   No   | `fs.createReadStream`, `req` in HTTP server    |
| Writable    |  No   |  Yes   | `fs.createWriteStream`, `res` in HTTP server   |
| Duplex      |  Yes  |  Yes   | `net.Socket`, WebSockets                       |
| Transform   |  Yes  |  Yes   | `zlib.createGzip()`, `crypto.createCipher()`   |
+-------------+-------+--------+------------------------------------------------+
```

---

## 2. Why does it exist?

Consider a web application that allows users to download a 5GB database backup file:

### Without Streams (Buffering Approach):
The server executes `fs.readFile('/backup.iso')`. Node.js attempts to allocate a continuous 5GB buffer in memory. If 10 users click download simultaneously, the server requires $10 \times 5\text{GB} = 50\text{GB}$ of RAM. Node.js hits its V8/buffer memory limits and crashes immediately with `JavaScript heap out of memory` or `ERR_BUFFER_TOO_LARGE`.

### With Streams (Chunked Streaming Approach):
The server executes `fs.createReadStream('/backup.iso').pipe(res)`. Node.js reads the file in small 64KB chunks and sends each chunk over the network card before reading the next chunk. Whether 1 user or 1,000 users download the file, memory consumption per connection stays bounded at ~64KB.

Furthermore, streaming provides **Time-to-First-Byte (TTFB)** benefits: processing starts immediately on the first chunk without waiting for the complete file to be read from disk.

---

## 3. Mental Model

Visualize an automated factory conveyor belt system connecting two workstations:

- **Readable Stream (Water Reservoir / Source)**: Pours water into a bucket in 64KB droplets.
- **Writable Stream (Water Tank / Sink)**: Receives the water. If the drain at the bottom is slow (a slow network client on a 3G mobile phone), the bucket starts filling up.
- **Backpressure (The Float Valve)**: When the receiving bucket reaches its capacity limit (`highWaterMark`), the receiver raises a red flag (`write()` returns `false`). The source immediately pauses pouring until the sink drains enough water to lower the flag (`'drain'` event), preventing overflow.
- **Pipeline (The Pipe Network)**: A sealed tube connecting the reservoir through filters (Transform streams: e.g., carbon filtration = gzip compression) into the destination tank, complete with automatic shut-off valves if any pipe bursts.

```
[ Disk File: 10GB ]
       | (64KB Chunks)
       v
+--------------+     Chunks      +----------------+     Gzipped     +-------------------+
| Readable     | --------------> | Transform      | --------------> | Writable          |
| fs.create    |                 | zlib.create    |                 | http.Server       |
| ReadStream   |                 | Gzip()         |                 | Response (res)    |
+--------------+                 +----------------+                 +-------------------+
       ^                                                                    |
       | <----------------- BACKPRESSURE (drain event) <--------------------+
```

---

## 4. Basic Example

### 4.1 Traditional Pipe vs Modern `pipeline`
```typescript
import fs from "node:fs";
import zlib from "node:zlib";
import { pipeline } from "node:stream/promises";

// ❌ ANTI-PATTERN: stream.pipe() leaks file descriptors if an error occurs mid-stream!
// fs.createReadStream('input.txt').pipe(zlib.createGzip()).pipe(fs.createWriteStream('input.txt.gz'));

//  PRODUCTION STANDARD: stream/promises pipeline
async function compressFile(sourcePath: string, destPath: string): Promise<void> {
  try {
    await pipeline(
      fs.createReadStream(sourcePath),
      zlib.createGzip(),
      fs.createWriteStream(destPath)
    );
    console.log("Compression completed cleanly without resource leaks.");
  } catch (error) {
    console.error("Pipeline failed and automatically cleaned up file handles:", error);
  }
}
```

### 4.2 Consuming Readable Streams with `for await...of`
Since Node.js v10+, every Readable Stream is an **Async Iterable**:
```typescript
import fs from "node:fs";

async function processLogLines(filePath: string): Promise<number> {
  const readStream = fs.createReadStream(filePath, { encoding: "utf8" });
  let errorCount = 0;

  // Seamlessly handles stream chunks, pauses, and backpressure under the hood!
  for await (const chunk of readStream) {
    const matches = chunk.match(/ERROR/g);
    if (matches) errorCount += matches.length;
  }

  return errorCount;
}
```

---

## 5. Real Example

### Production Custom Transform Stream: Real-Time CSV to JSON Line Transformer with Backpressure Handling
```typescript
// csv-to-jsonl-transform.ts
import { Transform, TransformCallback } from "node:stream";
import { pipeline } from "node:stream/promises";
import fs from "node:fs";

export class CsvToJsonLinesTransform extends Transform {
  private headers: string[] | null = null;
  private leftoverChunk: string = "";

  constructor() {
    super({ objectMode: false, highWaterMark: 64 * 1024 });
  }

  public _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
    try {
      // Prepend leftover data from previous chunk boundary
      const fullText = this.leftoverChunk + chunk.toString("utf8");
      const lines = fullText.split(/\r?\n/);

      // The last element is either empty or a partial line
      this.leftoverChunk = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;

        if (!this.headers) {
          // First non-empty row defines CSV headers
          this.headers = line.split(",").map((h) => h.trim());
        } else {
          const values = line.split(",").map((v) => v.trim());
          const record: Record<string, string> = {};
          
          this.headers.forEach((header, index) => {
            record[header] = values[index] ?? "";
          });

          // Push serialized JSON line + newline
          this.push(JSON.stringify(record) + "\n");
        }
      }

      callback(); // Signal ready for next chunk
    } catch (err) {
      callback(err instanceof Error ? err : new Error(String(err)));
    }
  }

  public _flush(callback: TransformCallback): void {
    // Process final partial line when stream ends
    if (this.leftoverChunk.trim() && this.headers) {
      const values = this.leftoverChunk.split(",").map((v) => v.trim());
      const record: Record<string, string> = {};
      this.headers.forEach((header, index) => {
        record[header] = values[index] ?? "";
      });
      this.push(JSON.stringify(record) + "\n");
    }
    callback();
  }
}

// Execution Script
async function runConverter(): Promise<void> {
  await pipeline(
    fs.createReadStream("large-dataset.csv"),
    new CsvToJsonLinesTransform(),
    fs.createWriteStream("output.jsonl")
  );
  console.log("Successfully transformed CSV to JSONL via streaming.");
}
```

---

## 6. Under the Hood

### 6.1 Flowing Mode vs Paused Mode (Readable Streams)
A Readable stream operates in one of two reading modes:

```
+-------------------------------------------------------------------------------+
|                       READABLE STREAM OPERATIONAL MODES                       |
+-------------------------------------------------------------------------------+
| Mode        | Triggered By                         | Data Flow Mechanism      |
+-------------+--------------------------------------+--------------------------+
| Flowing     | `stream.on('data')`, `stream.resume` | Data pushed as fast as   |
|             | or `stream.pipe()`                   | possible via events      |
+-------------+--------------------------------------+--------------------------+
| Paused      | Default state, `stream.pause()`,     | Must explicitly call     |
|             | or `stream.on('readable')`           | `stream.read([size])`    |
+-------------+--------------------------------------+--------------------------+
```

### 6.2 The Mechanics of Backpressure
How does Node.js prevent memory leaks when a fast producer writes to a slow consumer?

1. Every stream has an internal buffer governed by `highWaterMark` (Default: **64KB** for standard byte streams; **16 items** for `objectMode` streams).
2. When you call `writable.write(chunk)`:
   - If internal buffer size `< highWaterMark`, it returns `true`.
   - If internal buffer size `>= highWaterMark`, it returns `false`.
3. If `false` is returned, **the producer MUST stop writing immediately**.
4. The writable stream drains its buffer to the underlying kernel socket or disk. Once the buffer drops below the watermark, the writable stream emits the `'drain'` event.
5. The producer listens for `'drain'` and resumes writing.

```
[ Fast Producer ] ---> write(chunk) === false ---> [ Pauses Producer ]
                             |                              ^
                             v                              |
                     [ Internal Buffer ]                    |
                      (hits 64KB limit)                     |
                             |                              |
                             v                              |
                     [ Slow Consumer ]                      |
                     (drains 32KB to network)               |
                             |                              |
                             +-----> emits 'drain' ---------+
```

### 6.3 Why `stream.pipe()` is Flawed
`readable.pipe(writable)` automatically handles backpressure by listening to `'drain'`, `'pause'`, and `'resume'`. However:
- If `readable` throws an error, `writable` is **not closed**.
- If `writable` throws an error, `readable` keeps running, causing a **file descriptor leak**.
- Destructuring multiple pipes (`a.pipe(b).pipe(c)`) does not forward errors down the chain.
- **`stream.pipeline()`** solves this: it listens to `'error'`, `'close'`, and `'finish'` across all streams in the chain and properly cleans up every single descriptor.

---

## 7. Important Rules

1. **Always Use `stream.pipeline` or `stream/promises`**: Never rely on raw `.pipe()` in production code. Unhandled errors in `.pipe()` leave TCP sockets or file handles permanently open.
2. **Respect `writable.write()` Return Value**: If `write()` returns `false`, never call `write()` again until the `'drain'` event fires. Ignoring this causes unbounded memory growth on the Node.js heap.
3. **`highWaterMark` is a Threshold, Not a Hard Ceiling**: A stream does not reject writes when it crosses `highWaterMark`. It simply warns the caller by returning `false`. If you ignore the return value, the buffer will continue expanding until V8 crashes.
4. **Streams Cannot Be Reused**: Once a stream emits `'end'` or `'close'`, it cannot be read from or written to again. You must create a new stream instance.

---

## 8. Common Mistakes

### Mistake 1: Memory Leak via Ignoring Backpressure
```typescript
// ❌ WRONG: Writing 1GB in a while loop ignores backpressure!
function dumpData(writable: fs.WriteStream) {
  for (let i = 0; i < 10000000; i++) {
    writable.write(Buffer.from(`Row number ${i}\n`)); // Buffers everything in RAM!
  }
}

//  CORRECT: Await the drain event when write() returns false
async function dumpDataSafe(writable: fs.WriteStream) {
  for (let i = 0; i < 10000000; i++) {
    const canContinue = writable.write(Buffer.from(`Row number ${i}\n`));
    if (!canContinue) {
      await new Promise((resolve) => writable.once("drain", resolve));
    }
  }
}
```

### Mistake 2: Mixing `on('data')` with `stream.read()`
Attaching a `'data'` event listener puts the stream into flowing mode immediately. If your code also calls `stream.read()`, data chunks will be missed or duplicated inconsistently.

### Mistake 3: Unhandled Errors in Streaming HTTP Responses
If an error occurs halfway through streaming a file to `res` (HTTP response), you cannot send a `500 Internal Server Error` header because HTTP headers (`200 OK`) have already been flushed! You must abruptly destroy the socket:
```typescript
stream.on("error", (err) => {
  if (!res.headersSent) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("Internal Server Error");
  } else {
    res.destroy(err); // Abort TCP connection immediately
  }
});
```

---

## 9. Best Practices

1. **Use `objectMode: true` for Streaming JavaScript Objects**: By default, streams accept only `Buffer` or `string`. Set `objectMode: true` when building streaming data pipelines of plain JavaScript objects (e.g., streaming MongoDB documents).
2. **Leverage `stream/consumers`**: Node.js provides built-in utilities (`text(stream)`, `json(stream)`, `buffer(stream)`) for conveniently consuming streams into standard data structures when buffering is desired.
3. **Utilize `AbortSignal` with Pipeline**: Pass an `AbortController` signal to `pipeline` to cancel long-running transfers when clients disconnect.
   ```typescript
   await pipeline(readStream, writeStream, { signal: req.signal });
   ```

---

## 10. Performance Considerations

```
+-------------------------------------------------------------------------------+
|                       BUFFERING vs STREAMING THROUGHPUT                       |
+-------------------------------------------------------------------------------+
| Metric                 | fs.readFile (Buffered) | fs.createReadStream (Stream)|
+------------------------+------------------------+-----------------------------+
| Peak Memory (1GB File) | 1,024 MB               | ~64 KB                      |
| Time to First Byte     | 1,200 ms (After read)  | 2 ms (Immediate chunk)      |
| GC Pressure            | High (Huge allocations)| Virtually Zero              |
+------------------------+------------------------+-----------------------------+
```

- **Tuning `highWaterMark`**:
  - For high-speed local NVMe SSDs or 10Gbps network cards, increasing `highWaterMark` from 64KB to 256KB or 512KB reduces the number of system calls and Event Loop ticks, increasing maximum throughput by 20-35%.
  - For millions of simultaneous low-bandwidth IoT connections, decreasing `highWaterMark` to 8KB or 16KB prevents aggregate server RAM exhaustion.

---

## 11. Security Considerations

1. **Slowloris / Resource Starvation**: A malicious client that slowly accepts 1 byte every 10 seconds can tie up a server socket and internal stream buffers indefinitely. Always enforce streaming read/write timeouts (`req.setTimeout()`).
2. **Zip Bombs in Decompression Streams**: If a user uploads an uncompressed 100GB zip bomb compressed into a 5MB gzip file, passing it through `zlib.createGunzip()` will flood the disk or memory. Implement a custom Transform stream counter that tracks total uncompressed bytes and destroys the pipeline if it exceeds a maximum threshold (e.g., 50MB).

---

## 12. Alternatives

| Mechanism | Description | Best For |
| :--- | :--- | :--- |
| **Node.js Streams** | Native `node:stream` API. | Traditional Node.js backend servers, Express, Fastify. |
| **Web Streams API** | W3C Standard (`ReadableStream`, `WritableStream`). | Modern Edge runtimes, Cloudflare Workers, Next.js, Fetch API. |
| **Async Iterators / Generators** | `async function* generator()`. | Clean, declarative asynchronous data generation. |
| **RxJS Observables** | Reactive push-based stream primitives. | Complex client-side event composition and GUI state. |

---

## 13. Trade-offs

- **Complexity vs Resource Efficiency**: Streaming requires event handling, error propagation architectures, and backpressure management, whereas `fs.readFile` is a simple single-line promise. Use streams when handling data whose size cannot be guaranteed to fit comfortably in RAM.
- **Node Streams vs Web Streams**: Node.js now supports both native `node:stream` and standard Web Streams (`ReadableStream`). While Web Streams offer cross-platform interoperability, native Node streams remain slightly faster with deeper libuv integration.

---

## 14. Real-World Usage

- **File Upload Gateways (Multer, Busboy)**: Parse multi-part form data on-the-fly, streaming incoming binary file chunks directly to Amazon S3 via `s3.upload({ Body: stream })` without writing temporary files to local disk.
- **Log Aggregators (Fluentd, Pino)**: Stream gigabytes of JSON log entries through compression transforms to remote Elasticsearch or Datadog endpoints.
- **Server-Sent Events (SSE) & Video Streaming**: HTTP range requests (`206 Partial Content`) slice video files into streaming chunk responses for browser video players.

---

## 15. Placement Interview Questions

### 15.1 Basic Questions
1. *What are the four core types of streams in Node.js?*
   - Answer: Readable, Writable, Duplex, and Transform streams.
2. *What is Backpressure in Node.js streams?*
   - Answer: Backpressure is the feedback mechanism that occurs when data is read/produced faster than the downstream consumer can process/write it. The consumer signals the producer to pause until its internal buffer drains, preventing memory saturation.

### 15.2 Conceptual Questions
3. *Why should developers avoid `stream.pipe()` in production applications?*
   - Answer: `pipe()` does not forward errors properly across multi-stream chains, and if a downstream stream fails or closes unexpectedly, the upstream stream remains unclosed, leaking file descriptors and memory. `stream.pipeline()` automatically monitors all streams and destroys all open handles upon any failure.
4. *How does `highWaterMark` influence stream behavior?*
   - Answer: `highWaterMark` sets the byte limit of the stream's internal buffer (default 64KB). When data in the buffer reaches this threshold, `writable.write()` returns `false`, signaling the producer to pause until the `'drain'` event is fired.

### 15.3 Implementation Questions
5. *How do you convert a Node.js Readable stream into a UTF-8 string without using third-party packages?*
   - Answer:
     ```typescript
     import { text } from "node:stream/consumers";
     const content: string = await text(readStream);
     ```

### 15.4 Debugging Questions
6. *A developer writes a custom Transform stream, but the pipeline hangs indefinitely after processing the first chunk. What is the bug?*
   - Answer: The developer forgot to invoke the `callback()` inside `_transform(chunk, encoding, callback)`. Without calling `callback()`, the stream assumes the current chunk is still being processed and will never pull the next chunk from the upstream source.

### 15.5 Scenario Questions
7. *How would you implement an HTTP endpoint in Express that exports 10 million rows from a PostgreSQL database to a CSV download without running out of memory?*
   - Answer: Use a database cursor stream (`pg-query-stream`). Pipe the query stream into a custom `Transform` stream that formats database row objects into CSV text rows, and pipe that directly into Express's `res` object using `stream.pipeline()`. Memory usage will remain flat at ~64KB regardless of row count.

### 15.6 Advanced Questions
8. *Explain how Node.js bridges Async Iterators with Readable streams under the hood.*
   - Answer: Readable streams implement the `Symbol.asyncIterator` method. Calling `for await (const chunk of stream)` internally attaches `'data'`, `'error'`, and `'end'` listeners, pauses and resumes the stream in alignment with the consumer's iteration speed, and yields chunks as resolved promises. If the loop breaks early (`break` or `return`), it automatically invokes `stream.destroy()`.

---

## 16. Coding Questions

### Problem 1: Implement a Rate-Limiting Transform Stream (Throttler)
**Question**: Write a custom Transform stream that throttles data passing through it to a maximum speed of $N$ bytes per second, demonstrating backpressure propagation.

```typescript
// throttle-stream.ts
import { Transform, TransformCallback } from "node:stream";

export class ThrottleStream extends Transform {
  private bytesPerSecond: number;

  constructor(bytesPerSecond: number) {
    super();
    this.bytesPerSecond = bytesPerSecond;
  }

  public _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
    // Calculate required delay to transmit this chunk at target byte rate
    const delayMs = (chunk.length / this.bytesPerSecond) * 1000;

    setTimeout(() => {
      this.push(chunk);
      callback(); // Backpressure: only request next chunk after delay elapsed
    }, delayMs);
  }
}

// Verification Test
import fs from "node:fs";
import { pipeline } from "node:stream/promises";

async function testThrottling() {
  console.log("Streaming file at 100 KB/sec limit...");
  const start = Date.now();

  await pipeline(
    fs.createReadStream("sample-large-file.bin"),
    new ThrottleStream(100 * 1024), // 100 KB/s
    fs.createWriteStream("throttled-copy.bin")
  );

  console.log(`Stream finished in ${(Date.now() - start) / 1000}s`);
}
```

---

## 17. Common Interview Traps

- **Trap 1**: "Does `pipe()` automatically close the destination stream when the source ends?"
  - *Reality*: Yes, by default `{ end: true }` is enabled for normal completion. However, if the source emits an **`error`**, `pipe()` does **NOT** close the destination stream!
- **Trap 2**: "Does `fs.createReadStream` read the entire file into the libuv thread pool at once?"
  - *Reality*: No. It reads one chunk (default 64KB) at a time using libuv's thread pool, waiting for the event loop to signal readiness for the next chunk.
- **Trap 3**: "Can you call `stream.pipe()` on an `objectMode: true` stream to write into a standard file write stream?"
  - *Reality*: No! A standard file write stream expects `Buffer` or `string`. Passing arbitrary JS objects causes a runtime `TypeError: Invalid non-string/buffer chunk`. You must place a `Transform` stream in between to serialize objects to JSON or strings.

---

## 18. Revision Summary

- **Stream Types**: Readable (source), Writable (destination), Duplex (bidirectional), Transform (compute on-the-fly).
- **Core Benefit**: Constant $O(1)$ memory usage regardless of dataset size; instant Time-to-First-Byte.
- **Backpressure**: Prevents fast producers from overwhelming slow consumers via `highWaterMark` and the `'drain'` event.
- **Pipeline vs Pipe**: Always use `stream.pipeline` or `stream/promises` for robust error handling and resource cleanup.
- **Async Iteration**: Modern streams support `for await (const chunk of stream)`.

---

## 19. Quick Reference

```typescript
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import fs from "node:fs";

// 1. Production Pipeline
await pipeline(
  fs.createReadStream("input.dat"),
  new Transform({
    transform(chunk, enc, cb) {
      cb(null, chunk); // Forward chunk unmodified
    }
  }),
  fs.createWriteStream("output.dat")
);

// 2. Reading stream via Async Iterable
for await (const chunk of readStream) {
  console.log(`Received ${chunk.length} bytes`);
}

// 3. Handling backpressure manually
const canWrite = dest.write(chunk);
if (!canWrite) {
  await new Promise((r) => dest.once("drain", r));
}
```
