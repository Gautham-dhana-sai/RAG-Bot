import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createNestApp, NestAppWithInject } from '../../src/app.js';
import { MemoryDatabaseAdapter } from '../../src/adapters/database/memory.adapter.js';
import { LocalStorageAdapter } from '../../src/adapters/storage/local-storage.adapter.js';
import { LocalQueueAdapter } from '../../src/adapters/queue/local-queue.adapter.js';
import { MockAIAdapter } from '../../src/adapters/ai/mock-ai.adapter.js';
import { DownloadWorker } from '../../src/modules/downloader/download-worker.js';
import path from 'path';
import fs from 'fs';

describe('Multi-Page Website Crawl Integration Flow', () => {
  let app: NestAppWithInject;
  let db: MemoryDatabaseAdapter;
  let storage: LocalStorageAdapter;
  let queue: LocalQueueAdapter;
  let ai: MockAIAdapter;
  let downloadWorker: DownloadWorker;
  const storageDir = path.join(process.cwd(), 'test-storage-crawl');

  let authToken: string;
  let tenantId: string;
  let entityId: string;
  let portfolioSlug: string;

  beforeEach(async () => {
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
    fs.mkdirSync(storageDir, { recursive: true });

    db = new MemoryDatabaseAdapter();
    await db.init();
    storage = new LocalStorageAdapter(storageDir);
    queue = new LocalQueueAdapter(true);
    ai = new MockAIAdapter(3072);
    downloadWorker = new DownloadWorker(db, storage, queue);

    // Mock fetch for multi-page crawling
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: async () => 'User-agent: *\nDisallow: /admin/\nSitemap: https://example.com/sitemap.xml',
          body: null,
        };
      }

      if (url.endsWith('/sitemap.xml')) {
        const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
          <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
            <url><loc>https://example.com/docs</loc></url>
            <url><loc>https://example.com/pricing</loc></url>
          </urlset>`;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/xml' }),
          text: async () => sitemapXml,
          body: null,
        };
      }

      if (url.includes('empty-spa')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => '<!DOCTYPE html><html><head><title>SPA App</title></head><body><div id="root"></div></body></html>',
          body: null,
        };
      }

      if (url.endsWith('/docs')) {
        const docsHtml = `<!DOCTYPE html><html><head><title>PersonaRAG API Documentation</title></head><body>
          <main>
            <h1>PersonaRAG API Reference</h1>
            <p>The PersonaRAG engine provides multi-tenant hybrid retrieval and pgvector embeddings.</p>
            <h2>Authentication</h2>
            <p>Use Bearer JWT tokens to authenticate all administrative endpoints.</p>
          </main>
        </body></html>`;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => docsHtml,
          body: null,
        };
      }

      if (url.endsWith('/pricing')) {
        const pricingHtml = `<!DOCTYPE html><html><head><title>PersonaRAG Enterprise Pricing</title></head><body>
          <main>
            <h1>Subscription Tiers</h1>
            <p>Our Enterprise plan provides unlimited vector indexing and dedicated S3 storage buckets.</p>
          </main>
        </body></html>`;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => pricingHtml,
          body: null,
        };
      }

      if (url.endsWith('/features')) {
        const featuresHtml = `<!DOCTYPE html><html><head><title>PersonaRAG Platform Features</title></head><body>
          <main>
            <h1>Platform Capabilities</h1>
            <p>Native support for static HTML crawling with Cheerio extraction and automated SQS queuing.</p>
          </main>
        </body></html>`;
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => featuresHtml,
          body: null,
        };
      }

      // Root URL fallback
      const rootHtml = `<!DOCTYPE html><html><head><title>PersonaRAG Official Website</title></head><body>
        <main>
          <h1>Welcome to PersonaRAG</h1>
          <p>The next generation document ingestion and knowledge retrieval platform.</p>
          <a href="/features">Explore Platform Features</a>
          <a href="/empty-spa">Interactive Demo App</a>
          <a href="/admin/secret">Admin Dashboard</a>
        </main>
      </body></html>`;

      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => rootHtml,
        body: null,
      };
    }));

    const nestApp = await createNestApp({ db, storage, queue, ai });
    app = nestApp.app;
    await app.init();

    // Register test account
    const regRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: `crawler_admin_${Date.now()}@personarag.io`,
        password: 'Password123!',
        name: 'Crawler Admin',
        tenantName: 'PersonaRAG Engineering',
      },
    });
    expect(regRes.statusCode).toBe(201);
    const regBody = regRes.json();
    authToken = regBody.token;
    tenantId = regBody.tenant.id;

    // Create a portal
    const portalRes = await app.inject({
      method: 'POST',
      url: '/v1/portals',
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        url: 'https://example.com/',
        name: 'PersonaRAG Docs Portal',
      },
    });
    expect(portalRes.statusCode).toBe(201);
    const portalBody = portalRes.json();
    entityId = portalBody.id;
    portfolioSlug = portalBody.slug;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (app) {
      await app.close();
    }
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
  });

  it('should initiate multi-page crawl via POST /v1/portals/:id/crawls and discover pages via coordinator', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/portals/${entityId}/crawls`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        url: 'https://example.com/',
        maxPages: 10,
        maxDepth: 2,
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.crawlJobId).toBeDefined();
    expect(body.status).toBe('queued');
    const crawlJobId = body.crawlJobId;

    // Wait for coordinator discovery (setImmediate in local mode)
    await new Promise(r => setTimeout(r, 300));

    // Check crawl job status and discovered pages
    const crawlStatusRes = await app.inject({
      method: 'GET',
      url: `/v1/portals/${entityId}/crawls/${crawlJobId}`,
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(crawlStatusRes.statusCode).toBe(200);
    const crawlData = crawlStatusRes.json();
    expect(crawlData.id).toBe(crawlJobId);
    expect(crawlData.discoveredCount).toBeGreaterThanOrEqual(3);
    expect(crawlData.pages).toBeDefined();

    // Verify /admin/ was excluded by robots.txt
    const pageUrls = crawlData.pages.map((p: any) => p.normalizedUrl);
    expect(pageUrls.some((u: string) => u.includes('/admin/'))).toBe(false);

    // Verify discovered pages include root, sitemap URLs, and HTML links
    expect(pageUrls).toContain('https://example.com/');
    expect(pageUrls).toContain('https://example.com/docs');
    expect(pageUrls).toContain('https://example.com/features');
    expect(pageUrls).toContain('https://example.com/pricing');

    // Now process all discovered page jobs through downloadWorker
    for (const page of crawlData.pages) {
      await downloadWorker.processDownloadJob({
        tenantId,
        entityId,
        jobId: crawlJobId,
        documentId: page.documentId,
        url: page.normalizedUrl,
        portfolioUrl: 'example.com',
        sourceType: 'website',
        crawlJobId,
        depth: page.depth,
        action: 'process_page',
      });
    }

    // Wait for local queue ingestion processing
    await new Promise(r => setTimeout(r, 400));

    // Verify updated crawl status
    const finalCrawlRes = await app.inject({
      method: 'GET',
      url: `/v1/portals/${entityId}/crawls/${crawlJobId}`,
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const finalCrawl = finalCrawlRes.json();
    expect(finalCrawl.completedCount).toBeGreaterThanOrEqual(3);

    // Verify the empty SPA page was marked as skipped
    const spaPage = finalCrawl.pages.find((p: any) => p.normalizedUrl.includes('empty-spa'));
    if (spaPage) {
      expect(spaPage.status).toBe('skipped');
      expect(spaPage.errorMessage).toContain('No meaningful static content was found');
    }

    // Verify chat retrieval works with citation pointing to specific crawled page URL
    const askRes = await app.inject({
      method: 'POST',
      url: `/v1/portals/${entityId}/ask`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        question: 'What authentication does the PersonaRAG API use?',
      },
    });

    expect(askRes.statusCode).toBe(200);
    const askBody = askRes.json();
    expect(askBody.answer).toBeDefined();
    expect(askBody.citations).toBeDefined();
    expect(askBody.citations.length).toBeGreaterThan(0);
    // Citation points to the specific page sourceUrl
    const docsCitation = askBody.citations.find((c: any) => c.sourceUrl?.includes('/docs'));
    expect(docsCitation).toBeDefined();
    expect(docsCitation.sourceUrl).toBe('https://example.com/docs');
  });

  it('should support retry for failed or skipped pages in a crawl job', async () => {
    // 1. Start crawl
    const res = await app.inject({
      method: 'POST',
      url: `/v1/portals/${entityId}/crawls`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        url: 'https://example.com/',
        maxPages: 5,
        maxDepth: 1,
      },
    });

    const crawlJobId = res.json().crawlJobId;
    await new Promise(r => setTimeout(r, 300));

    // 2. Trigger retry endpoint
    const retryRes = await app.inject({
      method: 'POST',
      url: `/v1/portals/${entityId}/crawls/${crawlJobId}/retry`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {},
    });

    expect(retryRes.statusCode).toBe(200);
    const retryBody = retryRes.json();
    expect(retryBody.retriedCount).toBeDefined();
  });
});
