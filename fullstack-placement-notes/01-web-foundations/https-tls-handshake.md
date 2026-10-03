# HTTPS, TLS 1.3, and Cryptographic Handshakes

## 1. What is it?
**HTTPS (Hypertext Transfer Protocol Secure)** is the secure version of HTTP. It runs standard HTTP application messages over a cryptographic protocol called **TLS (Transport Layer Security)**. TLS provides the three foundational pillars of information security (the **CIA Triad**):
1. **Confidentiality (Encryption)**: Eavesdroppers on the network path cannot read transmitted plaintext (passwords, credit card numbers, personal data).
2. **Integrity (Tamper-Proofing)**: Attackers cannot alter or inject malicious scripts into the payload in transit without detection (via cryptographic MAC / AEAD).
3. **Authenticity (Identity Verification)**: The client can mathematically verify that the server is legitimately owned by the domain owner and not an imposter (via X.509 Digital Certificates signed by trusted Certificate Authorities).

---

## 2. Why does it exist?
In plaintext HTTP, all communication passes across open, untrusted networks (coffee shop Wi-Fi, ISP routers, subsea fiber cables) in clear readable ASCII:
- **Packet Sniffing**: Anyone with software like Wireshark on the same local network can capture passwords, session cookies, and private messages.
- **Content Injection (ISP Ad-Injection / MITM)**: Rogue ISPs and network operators can inject third-party advertisements or tracking cookies directly into web pages as they stream past.
- **Impersonation**: An attacker using DNS spoofing can redirect you to a fake bank website; without digital certificates, your browser has zero ability to verify if the server is genuine.

---

## 3. Mental Model
💡 **Think of it like this:**
- **Symmetric Encryption** is a heavy steel safe with one single physical key. Both you and your bank have identical copies of this key. It is extremely fast to lock and unlock, but **how do you get the key to the bank in the first place** without a courier stealing it?
- **Asymmetric Encryption** solves the key delivery problem. Your bank puts out a pile of open padlocks (**Public Keys**) that anyone can take. You write down the secret code to your safe (**Symmetric Session Key**), put it in a box, snap the bank's padlock shut, and mail it to them. Nobody on Earth can open that padlock except the bank, which holds the unique master key (**Private Key**).
- **The TLS Hybrid Strategy**:
  1. Use slow **Asymmetric Cryptography** (ECDHE) for just 1 second during the initial handshake to safely agree on a temporary shared secret key.
  2. Switch immediately to lightning-fast **Symmetric Cryptography** (AES-256-GCM / ChaCha20) using that shared key to encrypt all subsequent web data!

### TLS 1.2 vs. TLS 1.3 Handshake Architecture
```
TLS 1.2 Handshake (2 Full Round Trips - ~200ms)
CLIENT                                                  SERVER
  │                                                       │
  │ ── 1. ClientHello (Supported Ciphers, Random) ─────► │
  │                                                       │
  │ ◄─ 2. ServerHello (Selected Cipher) ───────────────── │
  │ ◄─ 3. Certificate Chain (X.509) ───────────────────── │
  │ ◄─ 4. ServerKeyExchange (ECDHE Params) ────────────── │
  │ ◄─ 5. ServerHelloDone ─────────────────────────────── │
  │                                                       │
  │ ── 6. ClientKeyExchange (ECDHE Public Value) ────────► │
  │ ── 7. ChangeCipherSpec & Finished (Encrypted) ───────► │
  │                                                       │
  │ ◄─ 8. ChangeCipherSpec & Finished (Encrypted) ──────── │
  │                                                       │
  ▼ [ ===== Handshake Finished: Can Now Send Encrypted HTTP Data ===== ]

───────────────────────────────────────────────────────────────────────

TLS 1.3 Handshake (1 Single Round Trip - 50% Faster!)
CLIENT                                                  SERVER
  │                                                       │
  │ ── 1. ClientHello + Key Share (Diffie-Hellman) ─────► │ (Speculatively sends DH public keys!)
  │                                                       │
  │ ◄─ 2. ServerHello + Key Share ─────────────────────── │ (Server computes shared secret immediately!)
  │ ◄─ 3. EncryptedExtensions ─────────────────────────── │ (Certificates are ENCRYPTED in flight!)
  │ ◄─ 4. Certificate + CertificateVerify ─────────────── │
  │ ◄─ 5. Finished ────────────────────────────────────── │
  │                                                       │
  ▼ [ ===== Handshake Finished: Client Sends Encrypted HTTP Immediately! ===== ]
```

---

## 4. Basic Example: Creating an HTTPS Server in Node.js
Using the native `node:https` module to run an encrypted TLS server:

```typescript
// https-server.ts
import https from 'node:https';
import fs from 'node:fs';

// Options containing SSL/TLS private key and public certificate
const options = {
  key: fs.readFileSync('server.key'),   // Secret Private Key (NEVER SHARE!)
  cert: fs.readFileSync('server.crt'),  // Public X.509 Certificate
  minVersion: 'TLSv1.3' as const        // Enforce modern TLS 1.3!
};

const server = https.createServer(options, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    secure: true,
    protocol: req.socket.alpnProtocol || 'http/1.1',
    tlsVersion: (req.socket as any).getProtocol()
  }));
});

server.listen(443, () => {
  console.log('[HTTPS] Server running securely on https://localhost:443');
});
```

---

## 5. Real Example: Enforcing Perfect Forward Secrecy & Strict Ciphers
In modern enterprise applications, servers must reject obsolete, broken ciphers (like RC4, 3DES, MD5, SHA-1, and plain RSA key exchange):

```typescript
// tls-security-config.ts
import tls from 'node:tls';

// Recommended Mozilla Modern TLS Configuration:
export const modernTLSConfig: tls.TlsOptions = {
  minVersion: 'TLSv1.2',
  maxVersion: 'TLSv1.3',
  // Strict AEAD Ciphers only (Authenticated Encryption with Associated Data)
  ciphers: [
    'TLS_AES_128_GCM_SHA256',
    'TLS_AES_256_GCM_SHA384',
    'TLS_CHACHA20_POLY1305_SHA256',
    'ECDHE-ECDSA-AES128-GCM-SHA256',
    'ECDHE-RSA-AES128-GCM-SHA256'
  ].join(':'),
  honorCipherOrder: true
};
```

---

## 6. Under the Hood: The Certificate Authority (CA) Chain of Trust

How does Chrome know that `https://google.com` is really Google, and not a hacker in your apartment building?

```
┌────────────────────────────────────────────────────────┐
│               ROOT CERTIFICATE AUTHORITY               │
│ (e.g. DigiCert Global Root G2 / Let's Encrypt ISRG X1) │
│ • Embedded inside OS / Browser Trust Store at factory  │
│ • Completely offline in physical high-security bunker  │
└───────────────────────────┬────────────────────────────┘
                            │ Signs with Root Private Key
                            ▼
┌────────────────────────────────────────────────────────┐
│             INTERMEDIATE CERTIFICATE AUTHORITY         │
│ (e.g. Let's Encrypt R3 / DigiCert TLS RSA SHA256)      │
│ • Daily signing operations; protects the Root CA       │
└───────────────────────────┬────────────────────────────┘
                            │ Signs with Intermediate Private Key
                            ▼
┌────────────────────────────────────────────────────────┐
│               LEAF / END-ENTITY CERTIFICATE            │
│ (e.g. *.google.com or yourdomain.com)                  │
│ • Contains domain name, public key, expiration date    │
└────────────────────────────────────────────────────────┘
```

### The Mathematical Verification Process:
1. When your browser connects, the server sends its **Leaf Certificate** and the **Intermediate Certificate**.
2. The browser checks the digital signature on the Leaf Certificate using the Intermediate CA's public key.
3. The browser checks the digital signature on the Intermediate Certificate using the **Root CA's public key**.
4. The browser finds that the Root CA's public key is already hardcoded inside its local operating system / browser trust store (`/etc/ssl/certs` or Windows Certificate Manager).
5. If the mathematical signature hashes match, the padlock turns green. If any link is broken, expired, or self-signed, the browser halts with `NET::ERR_CERT_AUTHORITY_INVALID`.

---

## 7. Important Rules & Cryptographic Principles
1. **Never Share the Private Key**: The public certificate (`.crt`) is sent to every visitor on Earth. The private key (`.key`) must stay locked on the server with strict permissions (`chmod 600`). If your private key leaks, attackers can impersonate your server.
2. **Perfect Forward Secrecy (PFS) is Mandatory**: Modern TLS requires Ephemeral Diffie-Hellman key exchange (`ECDHE`). Even if an attacker records all your encrypted network traffic today and steals your server's private key 5 years from now, they **still cannot decrypt past sessions** because session keys are ephemeral and discarded immediately from RAM.
3. **SNI (Server Name Indication)**: An extension to TLS where the client specifies which hostname it wants to connect to in the `ClientHello` before encryption begins. This allows a single server/IP to host multiple secure domains (virtual hosting).

---

## 8. Common Mistakes & Pitfalls

### ❌ Mistake 1: Ignoring Mixed Content Errors
- **The Bug**: Loading an HTTPS web application, but loading an image, font, or API script over plaintext HTTP:
  ```html
  <script src="http://api.cdn.com/library.js"></script>
  ```
- **Consequence**: The browser blocks the script immediately (`Blocked loading mixed active content`). If an attacker alters that plaintext script, they could take over the entire secure page.

### ❌ Mistake 2: Storing SSL Private Keys in Public Git Repositories
- **Disaster**: Committing `server.key` or `.env` files containing private SSL certificates to GitHub.
- **Impact**: Automated bot scanners scrape GitHub commits within 3 seconds. The domain's identity is completely compromised, requiring immediate certificate revocation via CRL/OCSP.

---

## 9. Best Practices in Modern Production
1. **Automate Certificate Issuance with ACME / Let's Encrypt**: Never manually purchase or install SSL certificates. Use `certbot` or cloud infrastructure (Cloudflare, AWS ACM) with automated 90-day renewal cycles.
2. **Enforce HSTS (HTTP Strict Transport Security)**: Tell browsers to permanently block all plaintext HTTP connections for your domain for the next 1-2 years:
   ```http
   Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
   ```
3. **Submit to HSTS Preload List**: Add your domain to Chrome's hardcoded preloaded HSTS list (`hstspreload.org`) so users never make even a single unencrypted initial request.

---

## 10. Performance Considerations: TLS 1.3 0-RTT and Replay Attacks
TLS 1.3 introduced **0-RTT (Early Data)** session resumption:
- If a client previously connected to a server, it can send encrypted HTTP GET requests in the very first network packet without waiting for a handshake.
- **The Security Hazard**: 0-RTT data is susceptible to **Replay Attacks**. If an attacker captures the 0-RTT packet, they can replay it to the server 100 times.
- **Rule**: Never allow state-changing methods (POST, PUT, DELETE, payments) over 0-RTT Early Data! Restrict 0-RTT strictly to safe, idempotent GET requests.

---

## 11. Security Considerations: Historical TLS Attacks
- **Heartbleed (CVE-2014-0160)**: A buffer over-read bug in OpenSSL's heartbeat extension that allowed attackers to read 64KB of server memory repeatedly, leaking private keys and user passwords.
- **POODLE / BEAST**: Exploited vulnerabilities in older SSL 3.0 and TLS 1.0 CBC block ciphers, leading to the complete deprecation of SSL and TLS 1.0/1.1.
- **Man-In-The-Middle Proxies**: Corporate inspection appliances and malicious Wi-Fi routers install custom Root CA certificates on employees' devices to decrypt and inspect all outgoing HTTPS traffic.

---

## 12. Complete Comparison: TLS 1.2 vs. TLS 1.3
| Feature | TLS 1.2 | TLS 1.3 |
|---|---|---|
| **Handshake Latency** | 2 RTTs (~200ms) | **1 RTT (~50ms) / 0-RTT Resumption** |
| **Insecure Ciphers** | Allowed (RSA key exchange, 3DES, RC4, CBC mode) | **Completely Removed** (Only 5 modern AEAD ciphers) |
| **Certificate Privacy** | Certificates transmitted in clear plaintext | **Certificates are ENCRYPTED in flight** |
| **Forward Secrecy** | Optional (only if ECDHE chosen) | **Mandatory** (Static RSA key exchange prohibited) |
| **Handshake Complexity**| Bloated (many cipher negotiations) | Streamlined and fast |

---

## 13. Trade-offs: mTLS (Mutual TLS) vs. Standard TLS
- **Standard TLS**: Only the server authenticates itself to the client (standard for public websites).
- **mTLS (Mutual TLS)**: Both the server **and** the client hold digital certificates and authenticate each other.
  - *Pro*: Near-impenetrable security. Ideal for zero-trust microservice-to-microservice communication (e.g. Kubernetes service mesh via Istio).
  - *Con*: High operational overhead; difficult to manage and rotate client certificates on millions of user browsers.

---

## 14. Real-World Usage: Cloudflare Universal SSL & Edge Termination
When you visit a website protected by Cloudflare:
1. Your browser establishes an encrypted TLS 1.3 connection to the nearest Cloudflare Edge PoP (terminating SSL at the edge in 15ms).
2. Cloudflare inspects traffic for WAF attacks and bot activity.
3. Cloudflare opens a persistent, multiplexed backend TLS connection to the origin server, drastically reducing latency for the user.

---

## 15. Placement Interview Questions

### Basic (Intern)
1. **What is the difference between Symmetric and Asymmetric encryption?**
   - *Spoken Answer*: "Symmetric encryption uses a single shared secret key to both encrypt and decrypt data; it is extremely fast and used for large payloads (e.g. AES-256). Asymmetric encryption uses a mathematically linked pair of keys—a public key for encryption and a private key for decryption; it is computationally slower and primarily used during the initial TLS handshake to securely negotiate the symmetric session key."

### Conceptual (Junior SDE)
2. **What is Perfect Forward Secrecy (PFS), and why does it matter?**
   - *Spoken Answer*: "PFS ensures that even if an attacker records all encrypted network traffic today and compromises the server's long-term private key years later, they cannot decrypt past communications. This is achieved by generating temporary, ephemeral Diffie-Hellman keys (`ECDHE`) for every individual session and deleting them from memory immediately after the handshake completes."

### Implementation (SDE-1)
3. **What is SNI (Server Name Indication) and why was it invented?**
   - *Spoken Answer*: "In traditional TLS, the server sends its certificate before knowing which website the client is visiting because the HTTP `Host` header is encrypted inside the TLS tunnel. This prevented a single IP address from hosting multiple HTTPS websites with different certificates. SNI solved this by having the client include the requested hostname in plaintext in the initial `ClientHello` message, allowing the server to select and return the correct certificate."

### Debugging
4. **A client makes an HTTPS call to your API and receives `UNABLE_TO_VERIFY_LEAF_SIGNATURE`. What is the cause?**
   - *Analysis*: The web server is configured with only the leaf certificate, but failed to provide the **Intermediate Certificate** bundle (`fullchain.pem`). The client's operating system does not have the intermediate CA in its local store, breaking the chain of trust to the Root CA.
   - *Fix*: Configure the server to serve `fullchain.pem` (leaf + intermediate certificates concatenated).

### Scenario-Based
5. **How does HSTS prevent SSL Stripping attacks?**
   - *Spoken Answer*: "In an SSL Stripping attack, a malicious Wi-Fi router intercepts the user's initial unencrypted HTTP request (`http://bank.com`) and communicates with the real bank over HTTPS while downgrading the user's connection to plain HTTP. HSTS (HTTP Strict Transport Security) instructs the browser to cache a rule that the domain must **never be contacted over HTTP**. Even if the user types `http://` or clicks an insecure link, the browser internally rewrites the request to `https://` before sending a single network packet."

### Advanced (Tier-1 Product Company)
6. **Explain the 0-RTT Replay Attack in TLS 1.3 and how backend engineering prevents it.**
   - *Spoken Answer*: "In TLS 1.3, returning clients can send 'Early Data' in the very first round trip using a pre-shared key (PSK). However, an eavesdropping attacker can intercept that exact initial packet and replay it to the server multiple times. If the request was a financial transaction (`POST /transfer-money`), the server could execute the payment twice! Mitigation requires:
     1. Disallowing non-idempotent HTTP methods (POST, PATCH) in 0-RTT Early Data.
     2. Server-side single-use tickets and timestamp verification windows with anti-replay caches in Redis."

---

## 16. Placement Coding Challenge: Verify HTTPS Certificate Expiration
Write a TypeScript utility function using native `node:tls` to check if a remote server's SSL certificate will expire within the next 30 days (useful for infrastructure monitoring):

```typescript
// cert-monitor.ts
import tls from 'node:tls';

export interface CertCheckResult {
  host: string;
  daysRemaining: number;
  isExpiringSoon: boolean;
  validTo: string;
}

export function checkCertificateExpiry(host: string, port = 443): Promise<CertCheckResult> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(port, host, { servername: host }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();

      if (!cert || !cert.valid_to) {
        return reject(new Error('No certificate found on host'));
      }

      const expiryDate = new Date(cert.valid_to);
      const now = new Date();
      const diffMs = expiryDate.getTime() - now.getTime();
      const daysRemaining = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      resolve({
        host,
        daysRemaining,
        isExpiringSoon: daysRemaining <= 30,
        validTo: cert.valid_to
      });
    });

    socket.on('error', (err) => reject(err));
    socket.setTimeout(5000, () => {
      socket.destroy();
      reject(new Error('TLS Connection Timeout'));
    });
  });
}
```

---

## 17. Common Interview Traps
- **Trap**: "Does HTTPS encrypt the IP address and Port of the destination?"
  - *Trap Explanation*: **No!** IP addresses operate at Layer 3 (Network Layer) and Ports operate at Layer 4 (Transport Layer). TLS operates at Layer 5/6 inside the TCP payload. Routers and ISPs must read the destination IP and port to deliver packets. Furthermore, the domain name in the `SNI` header is visible in plaintext during the initial TLS handshake (unless modern Encrypted Client Hello - ECH is supported).
- **Trap**: "Is SSL 3.0 safe to use if we have high-bit encryption?"
  - *Trap Explanation*: **Never.** The term "SSL" is technically obsolete. SSL 1.0, 2.0, and 3.0 are completely broken and cryptographically insecure due to attacks like POODLE. We use **TLS (Transport Layer Security)**, specifically TLS 1.2 and TLS 1.3.

---

## 18. Revision Summary
- HTTPS = HTTP over TLS (Transport Layer Security).
- Protects the **CIA Triad**: Confidentiality (Encryption), Integrity (MAC/AEAD), Authenticity (X.509 Certificates).
- Uses a **Hybrid Cryptosystem**: Asymmetric ECDHE key exchange during the handshake $\rightarrow$ Fast symmetric AES-GCM / ChaCha20 for data streaming.
- **TLS 1.2 takes 2 RTTs**; **TLS 1.3 cuts handshake time to 1 RTT** and encrypts certificates in flight.
- Enforce **HSTS** to permanently block SSL-stripping downgrades.
- Never use 0-RTT Early Data for non-idempotent state-changing requests (POST/PUT).

---

## 19. Quick Reference Cheat Sheet
```bash
# Inspect Remote Certificate Chain & TLS Version via OpenSSL:
openssl s_client -connect api.stripe.com:443 -servername api.stripe.com -tls1_3

# View Certificate Expiry Date:
echo | openssl s_client -connect google.com:443 2>/dev/null | openssl x509 -noout -dates

# Security Header:
Strict-Transport-Security: max-age=31536000; includeSubDomains
```
