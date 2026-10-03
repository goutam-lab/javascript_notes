# DNS & Domain Name Resolution System

## 1. What is it?
The **Domain Name System (DNS)** is a globally distributed, hierarchical database that translates human-memorable domain names (like `api.stripe.com`) into machine-routable numerical IP addresses (such as `54.187.205.235` or `2600:1f18:...`). It functions as the decentralized phonebook of the global Internet, resolving billions of queries every second with sub-50ms latency through an aggressive multi-tiered caching hierarchy.

---

## 2. Why does it exist?
Computers and routers route network packets strictly using numerical IP addresses encoded in binary packet headers.
- **The Problem**: Humans cannot memorize 32-bit IPv4 numbers (like `142.250.190.46`), let alone 128-bit IPv6 hexadecimal strings (like `2a00:1450:4001:830::200e`), for every service they use. Furthermore, IP addresses change when servers migrate, fail over across cloud availability zones, or scale horizontally behind load balancers.
- **The Solution**: DNS decouples the human-facing identifier (`google.com`) from the physical infrastructure IP. An organization can change server IP addresses instantly without users ever knowing.

---

## 3. Mental Model
💡 **Think of it like this:**
Imagine you want to visit the CEO of a company in a massive skyscraper:
1. You ask your personal assistant (**Recursive Resolver / ISP**): *"Where does Satya Nadella sit?"*
2. Your assistant doesn't know, so they walk to the building lobby directory (**Root Nameserver**). The lobby guard says: *"I don't know his exact desk, but all Executives are on the 50th floor (TLD Nameserver). Go ask the 50th-floor receptionist."*
3. The assistant rides the elevator to the 50th floor (**TLD Nameserver for `.com`**). That receptionist says: *"Satya works for Microsoft. Go talk to the Microsoft Suite security desk in room 5002 (**Authoritative Nameserver**)."*
4. The Microsoft security guard (**Authoritative Nameserver**) checks their internal employee roster and says: *"Satya is sitting at Desk 54.187.205.235!"*
5. Your assistant writes this down in their pocket notebook (**Local DNS Cache with TTL**), runs back to you, and gives you the exact room number. Next time you ask within 5 minutes, they don't walk back to the building—they read it directly from their notebook!

### The Hierarchical DNS Resolution Flow
```
[ User Browser: https://api.example.com ]
                │
                ▼ (1. Check Browser Cache, OS hosts file, OS Cache)
[ Local Recursive Resolver (ISP / 8.8.8.8 / 1.1.1.1) ]
  │
  ├──► (2. Query: Where is .com?) ──► [ Root DNS Server ('.') ]
  │◄── (3. Refer to TLD Server) ──────┘ (13 logical root cluster IPs)
  │
  ├──► (4. Query: Where is example.com?) ──► [ TLD DNS Server ('.com') ]
  │◄── (5. Refer to Authoritative NS) ──────┘ (Managed by Verisign)
  │
  ├──► (6. Query: What is IP for api.example.com?) ──► [ Authoritative Nameserver ]
  │◄── (7. Answer: 93.184.216.34, TTL=300s) ─────────┘ (AWS Route53 / Cloudflare)
  │
  ▼ (8. Cache answer locally and return IP to client)
[ Browser receives 93.184.216.34 and begins TCP 3-Way Handshake ]
```

---

## 4. Basic Example: Inspecting DNS Records via `dig` and `nslookup`
To trace how a domain resolves and view its exact resource records:

```bash
# On Linux/macOS (or WSL):
dig api.github.com A +trace
```

**Terminal Output (Annotated):**
```
;; Step 1: Querying Root Nameservers
.                       518400  IN      NS      a.root-servers.net.
;; Received response from Root, pointing to .com TLD servers...

;; Step 2: Querying .com TLD Nameservers
com.                    172800  IN      NS      a.gtld-servers.net.
;; Received response pointing to GitHub's Authoritative Nameservers...

;; Step 3: Querying GitHub's Authoritative Nameserver (ns-421.awsdns-52.com)
api.github.com.         60      IN      A       140.82.112.5
;; Query time: 18 msec
;; SERVER: 8.8.8.8#53 (UDP)
;; MSG SIZE  rcvd: 84
```

---

## 5. Real Example: Node.js DNS Resolution Trap (`dns.lookup` vs. `dns.resolve`)
A critical production trap in Node.js backend engineering is how domain names are resolved. Node.js provides two completely different DNS APIs in its native `'node:dns'` module:

```typescript
// dns-mechanics.ts
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';

async function demonstrateDNS() {
  console.log('--- 1. dns.lookup (Synchronous C-Library call via Libuv Threadpool) ---');
  // dns.lookup calls getaddrinfo(3) in the operating system.
  // CRITICAL: It blocks one of the 4 Libuv worker threads!
  // It obeys the OS hosts file (/etc/hosts or C:\Windows\System32\drivers\etc\hosts).
  dns.lookup('google.com', (err, address, family) => {
    if (err) console.error(err);
    console.log(`[dns.lookup] Address: ${address} (IPv${family})`);
  });

  console.log('\n--- 2. dns.resolve (Asynchronous Network Call via c-ares) ---');
  // dns.resolve always performs a real network query directly to configured DNS servers.
  // NON-BLOCKING: Does NOT consume a Libuv threadpool thread!
  // Ignores local /etc/hosts file.
  try {
    const addresses = await dnsPromises.resolve4('google.com');
    console.log('[dns.resolve4] Addresses:', addresses);

    const mxRecords = await dnsPromises.resolveMx('google.com');
    console.log('[dns.resolveMx] Mail Servers:', mxRecords.slice(0, 2));
  } catch (error) {
    console.error('Resolution failed:', error);
  }
}

demonstrateDNS();
```

---

## 6. Under the Hood: DNS Records & Protocol Mechanics

### Core DNS Record Types
| Record Type | Purpose | Production Example |
|---|---|---|
| **A** | Maps a domain name directly to an **IPv4** address (32-bit). | `api.stripe.com. IN A 54.187.205.235` |
| **AAAA** | Maps a domain name directly to an **IPv6** address (128-bit). | `google.com. IN AAAA 2607:f8b0:4005:805::200e` |
| **CNAME** | Canonical Name. Maps an alias domain to another canonical domain. | `www.mybrand.com. IN CNAME mybrand.vercel.app.` |
| **ALIAS / ANAME** | Pseudo-record created by DNS providers to allow CNAME-like flattening on the root zone apex (`@`). | `mybrand.com. IN ALIAS frontend.loadbalancer.aws.com.` |
| **MX** | Mail Exchange. Specifies mail servers responsible for receiving emails for the domain with priority weights. | `10 mail.google.com.` (Lower number = higher priority) |
| **TXT** | Arbitrary text data. Used for domain ownership verification, **SPF** (email spoofing prevention), and **DKIM**. | `v=spf1 include:_spf.google.com ~all` |
| **NS** | Nameserver. Identifies the authoritative nameservers responsible for a given DNS zone. | `ns1.cloudflare.com.` |
| **PTR** | Pointer. Reverse DNS (maps IP back to domain name). | `235.205.187.54.in-addr.arpa. IN PTR api.stripe.com.` |

### Transport Protocol: UDP vs. TCP Port 53
- **UDP Port 53**: Standard DNS queries use UDP because UDP is connectionless and incurs **zero handshake latency**. A DNS query fits within a single UDP datagram (<512 bytes).
- **TCP Port 53**: Used when:
  1. The response payload exceeds 512 bytes (the UDP truncation flag `TC=1` is set, forcing the client to retry over TCP).
  2. **Zone Transfers (AXFR)**: Replicating complete DNS databases between primary and secondary nameservers.
  3. **DNSSEC**: Cryptographic signatures enlarge packet sizes beyond standard UDP limits.

---

## 7. Important Rules of DNS
1. **The CNAME Zone Apex Restriction (RFC 1912)**: You **cannot** put a CNAME record at the root apex of a domain (`example.com`). Why? Because a CNAME record overrides all other records for that name, which would delete mandatory `NS` and `SOA` records at the root. Solution: Modern DNS providers (Cloudflare, Route53) use **CNAME Flattening** or **ALIAS** records.
2. **TTL (Time To Live) Invariant**: TTL specifies the number of seconds a resolver is permitted to cache a record. Low TTL (e.g. 60s) allows fast zero-downtime rollouts but increases DNS query load on nameservers; High TTL (e.g. 86400s / 24h) saves query cost and improves speed, but makes sudden disaster recovery slow.
3. **FQDN (Fully Qualified Domain Name)**: A true DNS address ends with a trailing dot representing the root: `www.google.com.` The dot is usually omitted by browsers.

---

## 8. Common Mistakes & Pitfalls

### ❌ Mistake 1: Forgetting to Lower TTL Before a Major Migration
- **Scenario**: You are migrating your backend API server from AWS (`IP A`) to Google Cloud (`IP B`). Your DNS record has `TTL = 86400` (24 hours). You update the DNS record at 10:00 AM.
- **Consequence**: Thousands of users worldwide continue sending HTTP traffic to the old decommissioned AWS IP for up to 24 hours because their local ISP recursive resolvers refuse to re-query the authoritative nameserver until their local cache expires.
- **✅ Senior Best Practice**: 7 days before the migration, drop the TTL to `60` seconds. Perform the migration, verify stability, and then raise the TTL back to `3600` or `86400`.

### ❌ Mistake 2: Node.js Threadpool Starvation via `http.request`
- **Gotcha**: Node.js's native `http.get('http://api.internal:3000')` uses `dns.lookup` under the hood.
- **Problem**: `dns.lookup` executes synchronously inside the C-based Libuv threadpool (default 4 threads). If your microservice makes 200 outbound HTTP calls per second, all 4 Libuv threads become saturated waiting for slow OS DNS lookups, completely freezing file system I/O (`fs.readFile`) and cryptographic operations (`crypto.pbkdf2`)!
- **Fix**: Either enlarge the thread pool via `UV_THREADPOOL_SIZE=64`, or implement DNS caching using an in-memory DNS caching agent (like `cacheable-lookup`).

---

## 9. Best Practices for Production
1. **Use Anycast Authoritative DNS Providers**: Host your DNS zones on Tier-1 distributed providers (Cloudflare, AWS Route 53, Google Cloud DNS) that have hundreds of Anycast PoPs worldwide to eliminate single points of failure.
2. **Implement Geo-DNS / Latency-Based Routing**: Route users to the nearest AWS datacenter (e.g., European users to `eu-central-1`, Asian users to `ap-south-1`) at the DNS resolution level.
3. **Protect Domains with DNSSEC**: Enable DNS Security Extensions to cryptographically sign DNS records, preventing cache poisoning attacks.

---

## 10. Performance Considerations: DNS Prefetching
Browser DNS lookups introduce a 20ms to 150ms delay before the first byte of an HTTP connection can begin. You can eliminate this latency on the frontend using HTML **Resource Hints**:

```html
<!-- In your index.html / Next.js <head> -->
<!-- Resolves the IP address in the background before the user clicks a link -->
<link rel="dns-prefetch" href="https://api.stripe.com" />
<link rel="dns-prefetch" href="https://images.unsplash.com" />

<!-- Preconnect goes one step further: performs DNS + TCP 3-way handshake + TLS handshake -->
<link rel="preconnect" href="https://fonts.googleapis.com" crossorigin />
```

---

## 11. Security Considerations: Attacks on DNS
1. **DNS Cache Poisoning (Kaminsky Attack)**: An attacker floods a recursive resolver with forged UDP responses before the real authoritative nameserver can respond. If successful, the resolver caches the attacker's IP, redirecting millions of legitimate users to a phishing clone.
   - *Mitigation*: **DNSSEC** (cryptographic digital signatures) and source port randomization on resolvers.
2. **DDoS on Authoritative Nameservers (Mirai Botnet on Dyn DNS)**: Flooding nameservers with billions of queries to knock entire websites offline.
   - *Mitigation*: Multi-DNS strategy (running two independent DNS providers simultaneously, e.g., Route 53 + Cloudflare).
3. **DNS Tunneling**: Exfiltrating stolen database records past corporate firewalls by encoding data into DNS subdomains (e.g. `exfiltrate.<credit-card-number>.attacker.com`).

---

## 12. Alternatives: DoH (DNS over HTTPS) vs. Traditional Plaintext DNS
| Feature | Traditional DNS | DoH (DNS over HTTPS) / DoT |
|---|---|---|
| **Port** | UDP/TCP 53 | TCP 443 (HTTPS) / TCP 853 |
| **Encryption** | Plaintext (No encryption) | TLS 1.3 encrypted |
| **Privacy** | Local Wi-Fi router, ISP, and state actors can inspect every domain you visit. | Queries are indistinguishable from regular encrypted HTTPS web traffic. |
| **Performance** | Slightly faster (UDP 0-RTT) | Minor TLS handshake overhead (mitigated by HTTP/2 multiplexing) |

---

## 13. Trade-offs: Low TTL vs. High TTL
| Metric | Low TTL (e.g., 30s - 60s) | High TTL (e.g., 86400s / 24 hours) |
|---|---|---|
| **Agility / Failover Speed** | 🚀 Near-instant. Rapid failover during disaster recovery. | ⚠️ Very slow. Changes take up to 24 hours to propagate globally. |
| **Authoritative Query Load** | High. Nameservers receive millions of recurring queries. | Minimal. 99% of queries are resolved from local ISP caches. |
| **Cost** | Higher DNS provider billing (per million queries). | Very low DNS query billing. |
| **Client Latency** | Potential slight latency increase on cache misses. | Sub-millisecond instant cache hits on user devices. |

---

## 14. Real-World Usage: Netflix Global Traffic Management
Netflix runs microservices across multiple AWS regions (`us-east-1`, `us-west-2`, `eu-west-1`). They use latency-based DNS routing:
1. When a user opens the Netflix app, their recursive resolver queries Netflix's Route53 nameservers.
2. Route53 determines the geographic origin of the user's recursive resolver and returns the IP of the closest healthy AWS region.
3. If an entire AWS region suffers an outage, Netflix's control plane updates the DNS health check records within 30 seconds, steering 100% of global traffic away from the failing region automatically.

---

## 15. Placement Interview Questions

### Basic (Intern)
1. **What is the difference between an Authoritative Nameserver and a Recursive Resolver?**
   - *Spoken Answer*: "A Recursive Resolver (like your ISP's DNS or Google's `8.8.8.8`) is the intermediary that takes a user's query and traverses the entire internet hierarchy (Root $\rightarrow$ TLD $\rightarrow$ Authoritative) on their behalf to find the answer. An Authoritative Nameserver holds the actual source-of-truth DNS database records for a specific domain (like `github.com`) configured by the domain owner."

### Conceptual (Junior SDE)
2. **What happens if you configure a CNAME record for `example.com` (root apex)?**
   - *Spoken Answer*: "It violates RFC 1912. A CNAME record cannot coexist with any other record for the same host label. Since the root domain apex (`@`) must contain an `SOA` (Start of Authority) and `NS` (Nameserver) record, adding a CNAME at the apex creates an invalid zone configuration. To point root domains to CDNs or load balancers, DNS providers support virtual **ALIAS** or **CNAME Flattening** records that dynamically return an `A` record instead."

### Implementation (SDE-1)
3. **How does an Anycast DNS setup achieve sub-20ms resolution worldwide?**
   - *Spoken Answer*: "With Anycast, multiple geographically distributed nameservers in dozens of countries announce the identical IP address via BGP. When a client sends a UDP packet to that IP, internet routing algorithms (shortest AS-path) automatically route the packet to the nearest physical datacenter. This localizes DNS traffic, drastically reduces round-trip physical fiber latency, and distributes DDoS attacks across all global nodes."

### Debugging
4. **You updated an A record 2 hours ago, but some users still see the old server. Why?**
   - *Analysis*:
     1. The old record had a high TTL (e.g., 4 or 24 hours), and downstream ISP resolvers honor the TTL until it reaches zero.
     2. Some poorly behaving ISP recursive resolvers ignore RFC standards and hardcode a minimum cache time.
     3. The client's operating system or web browser has its own internal DNS cache that has not been flushed.

### Scenario-Based
5. **How does Route53 handle DNS Failover when your primary server crashes?**
   - *Spoken Answer*: "Route53 runs continuous health checks (sending periodic HTTP GET requests to `/health`). When a server fails $N$ consecutive checks, Route53 marks it unhealthy and stops returning its IP in response to DNS queries, returning the backup standby server's IP instead. Because of this, health-checked records are always configured with very short TTLs (like 10-60 seconds) so client caches expire quickly."

### Advanced (Tier-1 Product Company)
6. **Explain the Kaminsky DNS Cache Poisoning attack and how modern DNS defends against it.**
   - *Spoken Answer*: "Traditional DNS uses 16-bit Transaction IDs (TXIDs) over UDP port 53. Dan Kaminsky demonstrated that an attacker could query a resolver for non-existent subdomains (`1.target.com`, `2.target.com`) and simultaneously flood the resolver with forged responses claiming that the authoritative nameserver for `target.com` is the attacker's IP. With only $2^{16} = 65,536$ TXIDs, an attacker could guess the correct ID in seconds. Modern defense combines **Source Port Randomization** (adding another 16 bits of entropy, requiring $2^{32}$ guesses) and **DNSSEC** cryptographic signatures."

---

## 16. Placement Coding Challenge: In-Memory DNS Cache with TTL Eviction
Implement a production-grade in-memory DNS resolver cache in TypeScript that caches IP resolutions and automatically evicts expired records:

```typescript
// dns-cache.ts
interface CacheEntry {
  ip: string;
  expiresAt: number;
}

export class DNSCache {
  private store = new Map<string, CacheEntry>();

  /**
   * Set a domain resolution with Time-to-Live in seconds
   */
  set(domain: string, ip: string, ttlSeconds: number): void {
    const expiresAt = Date.now() + ttlSeconds * 1000;
    this.store.set(domain.toLowerCase(), { ip, expiresAt });
  }

  /**
   * Retrieve cached IP if still valid; returns null if expired or missing
   */
  get(domain: string): string | null {
    const entry = this.store.get(domain.toLowerCase());
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(domain.toLowerCase()); // Lazy eviction
      return null;
    }

    return entry.ip;
  }

  /**
   * Purges all expired entries to prevent memory leaks
   */
  cleanup(): void {
    const now = Date.now();
    for (const [domain, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(domain);
      }
    }
  }
}
```

---

## 17. Common Interview Traps
- **Trap**: "Does DNS always use UDP?"
  - *Trap Response*: No. DNS uses UDP port 53 for standard lightweight lookups, but **falls back to TCP port 53** when the response is larger than 512 bytes (truncated response), or during complete database zone transfers (AXFR) between nameservers.
- **Trap**: "Does typing a domain in your browser immediately generate a network packet to the root nameservers?"
  - *Trap Response*: Almost never. First, the browser checks its internal cache, then the OS DNS cache, then the OS `hosts` file. Even if it leaves the machine, it hits the ISP/recursive resolver, which almost certainly has the `.com` TLD and popular domains cached already. Direct queries to root servers only occur on complete cache misses across the entire internet hierarchy.

---

## 18. Revision Summary
- DNS translates domain names to IP addresses hierarchically: **Root (`.`) $\rightarrow$ TLD (`.com`) $\rightarrow$ Authoritative (`example.com`)**.
- Recursive Resolvers do the heavy lifting of traversing the hierarchy on behalf of the client.
- Key records: `A` (IPv4), `AAAA` (IPv6), `CNAME` (Alias), `MX` (Mail), `TXT` (SPF/DKIM/Verification).
- `CNAME` cannot be placed at the domain apex (`@`) without ALIAS / CNAME Flattening.
- In Node.js, `dns.lookup` blocks a Libuv worker thread, whereas `dns.resolve` is pure asynchronous non-blocking network I/O.
- Lower your TTL *before* migrating infrastructure to prevent traffic black holes.

---

## 19. Quick Reference Cheat Sheet
```bash
# DNS CLI Swiss Army Knife:
dig example.com A                  # Query IPv4 address
dig example.com MX                 # Query mail servers
dig example.com TXT                # Query SPF/domain verification records
dig example.com +trace             # Trace entire root-to-authoritative hierarchy
dig @1.1.1.1 example.com           # Force query through Cloudflare resolver
nslookup example.com               # Cross-platform DNS check

# Node.js:
import dns from 'node:dns/promises';
const ips = await dns.resolve4('example.com'); // Non-blocking!
```
