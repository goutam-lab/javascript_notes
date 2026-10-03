# Metadata & SEO: Static, Dynamic, OpenGraph, and Sitemaps

## 1. What is it?
Next.js provides a comprehensive, declarative **Metadata API** that replaces legacy head management solutions (`react-helmet`, `next/head`). It defines search engine optimization (SEO) tags, social media OpenGraph cards, Twitter preview cards, and web manifest directives. Metadata can be defined in two ways:
1. **Static Metadata:** Exporting a typed `metadata` object from a `layout.tsx` or `page.tsx`.
2. **Dynamic Metadata:** Exporting an asynchronous `generateMetadata()` function that reads route parameters and database records to construct tailored SEO tags dynamically.
3. **File-Based Metadata:** Special conventional files automatically served with appropriate MIME types (`robots.ts`, `sitemap.ts`, `favicon.ico`, `opengraph-image.tsx`).

```
+-------------------------------------------------------------------------------+
|                            NEXT.JS METADATA HIERARCHY                         |
+-------------------------------------------------------------------------------+
| app/layout.tsx (Root Metadata: title template, default description, siteName) |
|    └── app/blog/layout.tsx (Overwrites category-level metadata)               |
|          └── app/blog/[slug]/page.tsx (generateMetadata: Post Title & Image)  |
|                + Dynamic opengraph-image.tsx (Generates 1200x630 social card) |
+-------------------------------------------------------------------------------+
```

---

## 2. Why does it exist?
In traditional Client-Side Rendered (CSR) applications:
- Social media scrapers (Twitter, LinkedIn, Facebook, Slack) do NOT execute client-side JavaScript. When a user shared a link, scrapers received empty tags (`<title>React App</title>`), rendering broken or blank link preview cards.
- Managing duplicate `<title>` or `<meta>` tags across deeply nested component hierarchies often created duplicate conflicting HTML tags.
- Building XML sitemaps and dynamic OpenGraph preview images required complex external build scripts and headless browser screenshot servers (Puppeteer).

Next.js unifies metadata generation directly inside the server rendering pipeline, ensuring that every page emits complete, valid HTML `<head>` tags before the response is streamed to crawlers.

---

## 3. Mental Model
Think of Metadata as a **Book's Cover, Spine, and Library Index Card**:
- When a human opens the book, they read the content (the page).
- When a search crawler (Googlebot) or book scout (Twitter crawler) inspects the shelf, they look only at the spine and title card (HTML `<head>` metadata).
- If your book arrives with a blank spine, the library rejects it or categorizes it as "Untitled".
- Next.js acts as the publisher: it stamps the official ISBN, author, description, and high-resolution book jacket art onto the exterior before sending it to bookstores.

---

## 4. Basic Example

### Static Metadata with Title Template
```typescript
// app/layout.tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  metadataBase: new URL('https://myenterprise.com'),
  title: {
    default: 'Enterprise Cloud Intelligence',
    template: '%s | Enterprise Cloud', // Sub-pages replace %s
  },
  description: 'Mission-critical distributed telemetry and observability platform.',
  openGraph: {
    title: 'Enterprise Cloud Intelligence',
    description: 'Real-time telemetry and cloud observability',
    url: 'https://myenterprise.com',
    siteName: 'Enterprise Cloud',
    locale: 'en_US',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

```typescript
// app/about/page.tsx
import type { Metadata } from 'next';

// Uses template from root layout: Becomes "About Us | Enterprise Cloud"
export const metadata: Metadata = {
  title: 'About Us',
  description: 'Learn about our distributed engineering principles and team.',
};

export default function AboutPage() {
  return <h1>About Our Platform</h1>;
}
```

---

## 5. Real Example

### Dynamic Metadata with `generateMetadata` and `sitemap.ts`
```typescript
// app/blog/[slug]/page.tsx
import type { Metadata, ResolvingMetadata } from 'next';
import { notFound } from 'next/navigation';
import db from '@/lib/db';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata(
  { params }: PageProps,
  parent: ResolvingMetadata
): Promise<Metadata> {
  const { slug } = await params;
  const post = await db.post.findUnique({ where: { slug } });

  if (!post) {
    return { title: 'Article Not Found' };
  }

  // Optionally read metadata from parent layout
  const previousImages = (await parent).openGraph?.images || [];

  return {
    title: post.title,
    description: post.summary,
    authors: [{ name: post.authorName }],
    openGraph: {
      title: post.title,
      description: post.summary,
      type: 'article',
      publishedTime: post.publishedAt.toISOString(),
      images: [post.coverImageUrl, ...previousImages],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.summary,
      creator: '@fullstack_dev',
    },
  };
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = await db.post.findUnique({ where: { slug } });
  if (!post) notFound();

  return <article><h1>{post.title}</h1><p>{post.content}</p></article>;
}
```

### Dynamic File-Based Sitemap
```typescript
// app/sitemap.ts
import { MetadataRoute } from 'next';
import db from '@/lib/db';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const posts = await db.post.findMany({ select: { slug: true, updatedAt: true } });

  const blogEntries: MetadataRoute.Sitemap = posts.map((post) => ({
    url: `https://myenterprise.com/blog/${post.slug}`,
    lastModified: post.updatedAt,
    changeFrequency: 'weekly',
    priority: 0.8,
  }));

  return [
    {
      url: 'https://myenterprise.com',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: 'https://myenterprise.com/about',
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    ...blogEntries,
  ];
}
```

---

## 6. Under the Hood

### 1. Metadata Cascading and Deduplication
Next.js evaluates metadata from the root layout downwards:
1. `app/layout.tsx` (Evaluates base defaults)
2. `app/blog/layout.tsx` (Merges or overrides)
3. `app/blog/[slug]/page.tsx` (Leaf override)
- When properties conflict (e.g. `description`), the leaf segment wins.
- Array properties (like `openGraph.images`) replace parent values unless explicitly resolved and merged using `ResolvingMetadata`.

### 2. Request Deduplication Between `generateMetadata` and `page.tsx`
If both `generateMetadata` and `page.tsx` call `fetch('https://api.cms.com/post/' + slug)`:
- Next.js **automatically deduplicates** the request via Request Memoization!
- Only ONE network request is made to the CMS API, eliminating redundant database or network hits.

---

## 7. Important Rules
1. **Server Components Only:** Metadata objects and `generateMetadata` can **only** be exported from Server Components (`layout.tsx` or `page.tsx`). They cannot be used in Client Components.
2. **`metadataBase` is Required for Relative URLs:** Always define `metadataBase: new URL('https://...')` in your root layout. Without it, social cards with relative paths (e.g. `/og.png`) fail or emit build warnings.
3. **Cannot Export Both:** You cannot export both a static `metadata` object and a `generateMetadata()` function from the same file. Use one or the other.
4. **File-Based Metadata Takes Precedence:** If you create `app/favicon.ico` or `app/opengraph-image.tsx`, Next.js automatically injects the tags, superseding manual favicon or OG image declarations in the `metadata` object.

---

## 8. Common Mistakes

### Mistake 1: Trying to Export Metadata from a Client Component
```typescript
'use client'; // ❌ ERROR: Cannot export metadata from a Client Component
export const metadata = { title: 'Settings' };
```
**Fix:** Keep the `page.tsx` as a Server Component that exports metadata, and import interactive client widgets into it.

### Mistake 2: Missing `metadataBase`
```typescript
// Social media platforms require absolute URLs (https://site.com/image.png)
export const metadata = {
  openGraph: { images: ['/card.png'] } // ❌ Might generate invalid previews without metadataBase!
};
```

---

## 9. Best Practices
1. **Adopt OpenGraph Image Generation (`ImageResponse`):** Use `app/blog/[slug]/opengraph-image.tsx` with `@vercel/og` to dynamically render custom branded 1200x630 banners with post titles and author avatars on the fly at the Edge!
2. **Implement `robots.ts`:**
   ```typescript
   // app/robots.ts
   import { MetadataRoute } from 'next';
   export default function robots(): MetadataRoute.Robots {
     return {
       rules: { userAgent: '*', allow: '/', disallow: ['/admin/', '/api/'] },
       sitemap: 'https://myenterprise.com/sitemap.xml',
     };
   }
   ```
3. **Use Title Templates:** Always configure `title: { default: 'Brand', template: '%s | Brand' }` in the root layout to maintain consistent brand styling across all pages.

---

## 10. Performance Considerations
- **Streamlined Head Insertion:** Next.js generates and streams metadata in the very first HTML byte chunk, enabling search engines and browser pre-parsers to discover fonts, CSS, and canonical links instantly.
- **Zero Client Bundle Size:** The entire metadata evaluation engine runs on the server and is stripped from the client JavaScript bundle.

---

## 11. Security Considerations
- **OpenGraph SSRF (Server-Side Request Forgery):** If dynamic OG image generators fetch user-supplied image URLs from query params, validate and whitelist domains to prevent internal network scanning.
- **Sanitizing User Strings in Meta Tags:** Next.js automatically escapes quotes and entities in meta attribute values, protecting against attribute injection XSS.

---

## 12. Alternatives
- **`next/head` (Legacy Pages Router):** Required manual component placement inside pages; prone to duplicate tag bugs.
- **`react-helmet-async`:** Traditional client-side library; useless for social media crawlers that don't execute JS.

---

## 13. Trade-offs

| Strategy | Advantages | Drawbacks |
| :--- | :--- | :--- |
| **Static `metadata`** | Simple; zero execution overhead | Cannot adapt to database entities or route params |
| **`generateMetadata()`**| 100% dynamic; tailored per blog/product | Adds a query step before head tags are emitted |
| **`ImageResponse` (OG)** | Automatic dynamic graphic generation | CPU intensive at high traffic (cache with Edge) |
| **`sitemap.ts`** | Auto-updates with CMS changes | Slow on sites with >50,000 URLs (requires index pagination) |

---

## 14. Real-World Usage
- **GitHub Repository Previews:** When sharing a GitHub repo link, the rich preview card displays live stars, forks, and language bars dynamically rendered using dynamic OG image generation.
- **Modern E-Commerce (Shopify):** Every product page dynamically outputs Schema.org JSON-LD structured data and OpenGraph availability/price metadata for Google Shopping integration.

---

## 15. Placement Interview Questions

### Basic
**Q: How do you define dynamic metadata for a route like `app/products/[id]/page.tsx`?**  
*Answer:* Export an `async function generateMetadata({ params })` from the page file that fetches the product by ID and returns a `Metadata` object containing title, description, and social tags.

### Conceptual
**Q: How does Next.js handle duplicate fetch requests if both `generateMetadata` and the `Page` component fetch the same API endpoint?**  
*Answer:* Next.js uses **Request Memoization** to automatically deduplicate identical `fetch()` requests (matching URL and options) across the entire render pass. The network request is made only once.

### Implementation
**Q: How do you configure a dynamic `robots.txt` file in the Next.js App Router?**  
*Answer:* Create `app/robots.ts` exporting a default function returning `MetadataRoute.Robots`:
```typescript
import { MetadataRoute } from 'next';
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/private/' },
    sitemap: 'https://example.com/sitemap.xml',
  };
}
```

### Debugging
**Q: Social media preview cards (LinkedIn / Twitter) display relative image paths like `/og.jpg` as broken links. How do you fix this?**  
*Answer:* Define `metadataBase: new URL('https://yourdomain.com')` in the root `app/layout.tsx`. Next.js will automatically prefix all relative image paths with the base URL to create absolute URLs required by external scrapers.

### Scenario
**Q: Your company has 100,000 product pages and needs an XML sitemap. Next.js limits individual sitemaps to 50,000 URLs. How do you architect this?**  
*Answer:* Use the `generateSitemaps()` API to split the sitemap into multiple indexed files (e.g. `app/sitemap/[id]/route.ts`). Next.js will generate a sitemap index pointing to `/sitemap/0.xml`, `/sitemap/1.xml`, etc., each within the 50,000 URL limit.

### Advanced
**Q: How do you generate dynamic OpenGraph banner images on the fly using Next.js?**  
*Answer:* Create an `opengraph-image.tsx` file inside the route folder. Import `ImageResponse` from `next/og`, write JSX styles using Flexbox and Tailwind-like properties, and return the image response rendered by the Edge Runtime via Satori:
```typescript
import { ImageResponse } from 'next/og';
export const runtime = 'edge';
export default async function Image({ params }: { params: { slug: string } }) {
  return new ImageResponse(
    <div style={{ display: 'flex', fontSize: 60, background: '#0f172a', color: 'white', width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' }}>
      {params.slug}
    </div>,
    { width: 1200, height: 630 }
  );
}
```

---

## 16. Coding Questions

### Problem: Implement Dynamic Structured Data (JSON-LD) for an SEO-Optimized Article
```typescript
// app/articles/[slug]/page.tsx
import { notFound } from 'next/navigation';

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  // Mock article
  const article = {
    title: 'Distributed Consensus with Raft in TypeScript',
    summary: 'A deep dive into distributed state machine replication.',
    datePublished: '2026-03-15T00:00:00.000Z',
    authorName: 'Alex Mercer',
    url: `https://myenterprise.com/articles/${slug}`,
  };

  // Structured Data (JSON-LD) for Google Rich Snippets
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: article.title,
    description: article.summary,
    datePublished: article.datePublished,
    author: {
      '@type': 'Person',
      name: article.authorName,
    },
    mainEntityOfPage: article.url,
  };

  return (
    <article className="max-w-2xl mx-auto py-12">
      {/* Inject JSON-LD Schema directly in the component body */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <h1 className="text-3xl font-bold">{article.title}</h1>
      <p className="mt-4 text-gray-700">{article.summary}</p>
    </article>
  );
}
```

---

## 17. Common Interview Traps
- **Trap 1:** "You can use both `metadata` and `generateMetadata` in the same page."  
  *Truth:* False. Exporting both causes a build error.
- **Trap 2:** "Search engine bots and social scrapers always run client JavaScript to read tags."  
  *Truth:* False. Most scrapers (Slack, Twitter, LinkedIn, WhatsApp) fetch only raw static HTML and discard all JavaScript.

---

## 18. Revision Summary
- Metadata API supports static exports (`export const metadata`) and dynamic async functions (`export async function generateMetadata`).
- Define `metadataBase` in root layout for reliable absolute URLs in social cards.
- Next.js automatically deduplicates requests made in both `generateMetadata` and `page.tsx`.
- Conventional files (`robots.ts`, `sitemap.ts`, `opengraph-image.tsx`) automatically serve search assets.

---

## 19. Quick Reference

```
+------------------------------------+-------------------------------------------+
| Metadata Feature                   | Implementation Pattern                    |
+------------------------------------+-------------------------------------------+
| Static Metadata                    | export const metadata: Metadata = { ... } |
| Dynamic Metadata                   | export async function generateMetadata()  |
| Base Domain Definition             | metadataBase: new URL('https://...')      |
| Title Template                     | title: { default: 'Home', template: '%s' }|
| Dynamic XML Sitemap                | app/sitemap.ts returning array of URLs    |
| Dynamic Robots TXT                 | app/robots.ts returning crawler rules     |
| On-Demand OG Image                 | app/.../opengraph-image.tsx (ImageResponse|
+------------------------------------+-------------------------------------------+
```
