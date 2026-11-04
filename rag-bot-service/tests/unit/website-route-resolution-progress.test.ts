import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MemoryDatabaseAdapter } from '../../src/adapters/database/memory.adapter.js';
import { LocalStorageAdapter } from '../../src/adapters/storage/local-storage.adapter.js';
import { LocalQueueAdapter } from '../../src/adapters/queue/local-queue.adapter.js';
import { DownloadWorker } from '../../src/modules/downloader/download-worker.js';
import { WebsiteCrawlCoordinator } from '../../src/modules/crawler/website-crawl-coordinator.js';
import { StaticWebsiteExtractor } from '../../src/modules/downloader/static-website-extractor.js';
import path from 'path';
import fs from 'fs';

describe('Website Route Resolution, Queue Orchestration & Dynamic Progress Tests', () => {
  let db: MemoryDatabaseAdapter;
  let storage: LocalStorageAdapter;
  let queue: LocalQueueAdapter;
  let downloadWorker: DownloadWorker;
  const storageDir = path.join(process.cwd(), 'test-storage-progress');

  const tenantId = '00000000-0000-0000-0000-000000000001';
  const entityId = '00000000-0000-0000-0000-000000000002';
  const crawlJobId = '00000000-0000-0000-0000-000000000003';

  beforeEach(async () => {
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
    fs.mkdirSync(storageDir, { recursive: true });

    db = new MemoryDatabaseAdapter();
    await db.init();
    storage = new LocalStorageAdapter(storageDir);
    queue = new LocalQueueAdapter(true);
    downloadWorker = new DownloadWorker(db, storage, queue);

    await db.createTenant({ id: tenantId, name: 'Acme Corp', slug: 'acme' });
    await db.createEntity({ id: entityId, tenantId, name: 'Acme Docs', slug: 'acme-docs' });
  });

  describe('Route resolution & Nested path handling (Parent 404 vs Child 200)', () => {
    it('should successfully extract /about/release (200) even when intermediate path /about returns 404', async () => {
      // Mock fetch: /about returns 404, /about/release returns 200 with rich static HTML
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith('/robots.txt')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/plain' }),
            text: async () => 'User-agent: *\nAllow: /',
            body: null,
          };
        }

        if (url.endsWith('/about')) {
          return {
            ok: false,
            status: 404,
            statusText: 'Not Found',
            headers: new Headers({ 'content-type': 'text/html' }),
            text: async () => '<html><body>404 Not Found</body></html>',
            body: null,
          };
        }

        if (url.endsWith('/about/release')) {
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/html' }),
            text: async () => `<!DOCTYPE html><html><head><title>Release Notes v2.0</title></head>
              <body>
                <h1>Release Notes v2.0</h1>
                <p>PersonaRAG Multi-Page static crawler now supports independent route resolution.</p>
                <p>Nested routes are extracted even when intermediate parent directories return HTTP 404.</p>
              </body></html>`,
            body: null,
          };
        }

        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => `<!DOCTYPE html><html><head><title>Home</title></head><body>
            <a href="/about">About Directory</a>
            <a href="/about/release">Direct Release Link</a>
          </body></html>`,
          body: null,
        };
      }));

      // Create Parent Ingestion Job and Crawl Job
      await db.createIngestionJob({
        id: crawlJobId,
        tenantId,
        entityId,
        totalDocuments: 2,
        sourceType: 'WEBSITE_CRAWL',
      });

      await db.createCrawlJob({
        id: crawlJobId,
        tenantId,
        entityId,
        rootUrl: 'https://example.com/',
        config: { maxPages: 10, maxDepth: 2 },
      });

      // 1. Coordinator discovery finds both /about and /about/release
      const coordinator = new WebsiteCrawlCoordinator(db, queue);
      await coordinator.executeDiscovery({
        tenantId,
        entityId,
        crawlJobId,
        rootUrl: 'https://example.com/',
      });

      const pages = await db.getCrawlPages(tenantId, crawlJobId);
      expect(pages.length).toBeGreaterThanOrEqual(2);

      const aboutPage = pages.find(p => p.normalizedUrl.endsWith('/about'));
      const releasePage = pages.find(p => p.normalizedUrl.endsWith('/about/release'));

      expect(aboutPage).toBeDefined();
      expect(releasePage).toBeDefined();

      // 2. Process /about -> Returns 404
      await downloadWorker.processDownloadJob({
        tenantId,
        entityId,
        jobId: crawlJobId,
        documentId: aboutPage!.documentId,
        url: aboutPage!.normalizedUrl,
        sourceType: 'website',
        crawlJobId,
        action: 'WEBSITE_PAGE',
      });

      // Verify /about is marked failed with 404, but did NOT fail the other pages
      const updatedAbout = await db.getCrawlPageByUrl(tenantId, crawlJobId, aboutPage!.normalizedUrl);
      expect(updatedAbout?.status).toBe('failed');
      expect(updatedAbout?.errorMessage).toContain('404');

      // 3. Process /about/release -> Returns 200
      await downloadWorker.processDownloadJob({
        tenantId,
        entityId,
        jobId: crawlJobId,
        documentId: releasePage!.documentId,
        url: releasePage!.normalizedUrl,
        sourceType: 'website',
        crawlJobId,
        action: 'WEBSITE_PAGE',
      });

      // Verify /about/release uploaded successfully despite intermediate /about 404
      const updatedRelease = await db.getCrawlPageByUrl(tenantId, crawlJobId, releasePage!.normalizedUrl);
      expect(updatedRelease?.status).toBe('uploaded');
      expect(updatedRelease?.title).toBe('Release Notes v2.0');

      // Sync and verify overall crawl job state reflects partial completion
      const syncedJob = await db.syncCrawlJobAggregates(tenantId, crawlJobId);
      expect(syncedJob?.failedCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Queue Orchestration & Parent-Child Handling', () => {
    it('child WEBSITE_PAGE jobs must NOT trigger recursive crawl discovery', async () => {
      const coordinatorSpy = vi.spyOn(WebsiteCrawlCoordinator.prototype, 'executeDiscovery');

      await db.createIngestionJob({
        id: crawlJobId,
        tenantId,
        entityId,
        totalDocuments: 1,
        sourceType: 'WEBSITE_CRAWL',
      });

      await db.createCrawlJob({
        id: crawlJobId,
        tenantId,
        entityId,
        rootUrl: 'https://example.com/',
      });

      const doc = await db.createDocument({
        tenantId,
        entityId,
        originalFilename: 'child.md',
        mimeType: 'text/markdown',
        sizeBytes: 100,
        contentHash: 'hash-child-1',
        objectKey: 'child.md',
      });

      await db.createCrawlPages([{
        tenantId,
        entityId,
        crawlJobId,
        documentId: doc.id,
        originalUrl: 'https://example.com/products',
        normalizedUrl: 'https://example.com/products',
      }]);

      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<html><body><h1>Products</h1><p>Our Products catalog</p></body></html>',
        body: null,
      })));

      // Process as child page
      await downloadWorker.processDownloadJob({
        tenantId,
        entityId,
        jobId: crawlJobId,
        documentId: doc.id,
        url: 'https://example.com/products',
        sourceType: 'website',
        crawlJobId,
        action: 'WEBSITE_PAGE',
      });

      // Crucial: coordinator discovery was NOT invoked by the child page job
      expect(coordinatorSpy).not.toHaveBeenCalled();
    });

    it('new internal links discovered while extracting child page must register under the SAME parent crawl', async () => {
      await db.createIngestionJob({
        id: crawlJobId,
        tenantId,
        entityId,
        totalDocuments: 1,
        sourceType: 'WEBSITE_CRAWL',
      });

      await db.createCrawlJob({
        id: crawlJobId,
        tenantId,
        entityId,
        rootUrl: 'https://example.com/',
        config: { maxPages: 10, maxDepth: 2 },
      });

      const doc = await db.createDocument({
        tenantId,
        entityId,
        originalFilename: 'parent.md',
        mimeType: 'text/markdown',
        sizeBytes: 100,
        contentHash: 'hash-p-1',
        objectKey: 'parent.md',
      });

      await db.createCrawlPages([{
        tenantId,
        entityId,
        crawlJobId,
        documentId: doc.id,
        originalUrl: 'https://example.com/features',
        normalizedUrl: 'https://example.com/features',
        depth: 1,
      }]);

      // When extracting /features, it contains meaningful text and a new internal link to /features/analytics
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => `<!DOCTYPE html><html><body>
          <h1>Enterprise AI Features</h1>
          <p>Explore our deep integration with advanced retrieval augmented generation algorithms and vector database search capabilities.</p>
          <a href="/features/analytics">Detailed Analytics</a>
        </body></html>`,
        body: null,
      })));

      await downloadWorker.processDownloadJob({
        tenantId,
        entityId,
        jobId: crawlJobId,
        documentId: doc.id,
        url: 'https://example.com/features',
        sourceType: 'website',
        crawlJobId,
        depth: 1,
        action: 'WEBSITE_PAGE',
      });

      // Verify that /features/analytics was registered under the same parent crawlJobId
      const pages = await db.getCrawlPages(tenantId, crawlJobId);
      const analyticsPage = pages.find(p => p.normalizedUrl.endsWith('/features/analytics'));
      expect(analyticsPage).toBeDefined();
      expect(analyticsPage?.crawlJobId).toBe(crawlJobId);
      expect(analyticsPage?.depth).toBe(2);
    });
  });

  describe('Progress Calculation & Aggregation Scenarios', () => {
    it('1. 10 discovered, 0 completed, 0 failed, 10 queued -> 0% progress', async () => {
      await db.createCrawlJob({
        id: crawlJobId,
        tenantId,
        entityId,
        rootUrl: 'https://example.com/',
      });

      const pages = [];
      for (let i = 0; i < 10; i++) {
        pages.push({
          tenantId,
          entityId,
          crawlJobId,
          originalUrl: `https://example.com/page-${i}`,
          normalizedUrl: `https://example.com/page-${i}`,
        });
      }
      await db.createCrawlPages(pages);

      const job = await db.syncCrawlJobAggregates(tenantId, crawlJobId);
      expect(job?.discoveredCount).toBe(10);
      expect(job?.queuedCount).toBe(10);
      expect(job?.completedCount).toBe(0);

      const finished = (job?.completedCount || 0) + (job?.failedCount || 0) + (job?.skippedCount || 0);
      const percent = Math.round((finished / (job?.discoveredCount || 1)) * 100);
      expect(percent).toBe(0);
      expect(job?.status).toBe('processing_pages');
    });

    it('2. 10 discovered, 3 completed, 2 failed, 1 skipped, 4 processing -> 60% progress', async () => {
      await db.createCrawlJob({
        id: crawlJobId,
        tenantId,
        entityId,
        rootUrl: 'https://example.com/',
      });

      const pages = [];
      for (let i = 0; i < 10; i++) {
        pages.push({
          tenantId,
          entityId,
          crawlJobId,
          originalUrl: `https://example.com/page-${i}`,
          normalizedUrl: `https://example.com/page-${i}`,
        });
      }
      const created = await db.createCrawlPages(pages);

      // Set 3 completed
      for (let i = 0; i < 3; i++) {
        await db.updateCrawlPage(tenantId, crawlJobId, created[i].id, { status: 'completed' });
      }
      // Set 2 failed
      for (let i = 3; i < 5; i++) {
        await db.updateCrawlPage(tenantId, crawlJobId, created[i].id, { status: 'failed' });
      }
      // Set 1 skipped
      await db.updateCrawlPage(tenantId, crawlJobId, created[5].id, { status: 'skipped' });
      // Set 4 processing
      for (let i = 6; i < 10; i++) {
        await db.updateCrawlPage(tenantId, crawlJobId, created[i].id, { status: 'extracting' });
      }

      const job = await db.syncCrawlJobAggregates(tenantId, crawlJobId);
      expect(job?.discoveredCount).toBe(10);
      expect(job?.completedCount).toBe(3);
      expect(job?.failedCount).toBe(2);
      expect(job?.skippedCount).toBe(1);
      expect(job?.processingCount).toBe(4);

      const finished = (job?.completedCount || 0) + (job?.failedCount || 0) + (job?.skippedCount || 0);
      const percent = Math.round((finished / (job?.discoveredCount || 1)) * 100);
      expect(percent).toBe(60);
      expect(job?.status).toBe('processing_pages');
    });

    it('3. 10 discovered, 10 completed -> 100% progress and terminal status "completed"', async () => {
      await db.createCrawlJob({
        id: crawlJobId,
        tenantId,
        entityId,
        rootUrl: 'https://example.com/',
      });

      const pages = [];
      for (let i = 0; i < 10; i++) {
        pages.push({
          tenantId,
          entityId,
          crawlJobId,
          originalUrl: `https://example.com/page-${i}`,
          normalizedUrl: `https://example.com/page-${i}`,
        });
      }
      const created = await db.createCrawlPages(pages);
      for (const p of created) {
        await db.updateCrawlPage(tenantId, crawlJobId, p.id, { status: 'completed' });
      }

      const job = await db.syncCrawlJobAggregates(tenantId, crawlJobId);
      expect(job?.completedCount).toBe(10);
      expect(job?.processingCount).toBe(0);
      expect(job?.queuedCount).toBe(0);

      const finished = (job?.completedCount || 0) + (job?.failedCount || 0) + (job?.skippedCount || 0);
      const percent = Math.round((finished / (job?.discoveredCount || 1)) * 100);
      expect(percent).toBe(100);
      expect(job?.status).toBe('completed');
      expect(job?.completedAt).toBeDefined();
    });

    it('4. Some pages failed and some succeeded -> terminal status "completed" (never stuck on partial)', async () => {
      await db.createCrawlJob({
        id: crawlJobId,
        tenantId,
        entityId,
        rootUrl: 'https://example.com/',
      });

      const pages = [];
      for (let i = 0; i < 4; i++) {
        pages.push({
          tenantId,
          entityId,
          crawlJobId,
          originalUrl: `https://example.com/page-${i}`,
          normalizedUrl: `https://example.com/page-${i}`,
        });
      }
      const created = await db.createCrawlPages(pages);
      await db.updateCrawlPage(tenantId, crawlJobId, created[0].id, { status: 'completed' });
      await db.updateCrawlPage(tenantId, crawlJobId, created[1].id, { status: 'completed' });
      await db.updateCrawlPage(tenantId, crawlJobId, created[2].id, { status: 'failed' });
      await db.updateCrawlPage(tenantId, crawlJobId, created[3].id, { status: 'skipped' });

      const job = await db.syncCrawlJobAggregates(tenantId, crawlJobId);
      expect(job?.status).toBe('completed');
      expect(job?.completedCount).toBe(2);
      expect(job?.failedCount).toBe(1);
      expect(job?.skippedCount).toBe(1);
    });

    it('5. Idempotent SQS retry: duplicate status updates do not corrupt or drift counts', async () => {
      await db.createCrawlJob({
        id: crawlJobId,
        tenantId,
        entityId,
        rootUrl: 'https://example.com/',
      });

      const created = await db.createCrawlPages([{
        tenantId,
        entityId,
        crawlJobId,
        originalUrl: 'https://example.com/idempotent-test',
        normalizedUrl: 'https://example.com/idempotent-test',
      }]);

      // Delivery 1 marks completed
      await db.updateCrawlPage(tenantId, crawlJobId, created[0].id, { status: 'completed' });
      let job = await db.syncCrawlJobAggregates(tenantId, crawlJobId);
      expect(job?.completedCount).toBe(1);

      // Duplicate delivery 2 re-sets completed
      await db.updateCrawlPage(tenantId, crawlJobId, created[0].id, { status: 'completed' });
      job = await db.syncCrawlJobAggregates(tenantId, crawlJobId);
      expect(job?.completedCount).toBe(1); // Still exactly 1, no drift!
    });
  });

  describe('Authoritative Document Ingestion Reconciliation (Scenarios C & D)', () => {
    it('document reaching READY must reconcile crawl page to completed and update parent progress', async () => {
      await db.createCrawlJob({
        id: crawlJobId,
        tenantId,
        entityId,
        rootUrl: 'https://example.com/',
      });

      // Create document in PENDING state
      const doc = await db.createDocument({
        tenantId,
        entityId,
        originalFilename: 'homepage.md',
        mimeType: 'text/markdown',
        sizeBytes: 1500,
        contentHash: 'hash-doc-ready-1',
        objectKey: 'acme-docs/homepage.md',
        status: 'PENDING',
        sourceType: 'WEBSITE_CRAWL',
      });

      // Create crawl page in 'uploaded' stage (waiting for ingestion)
      const [page] = await db.createCrawlPages([{
        tenantId,
        entityId,
        crawlJobId,
        documentId: doc.id,
        originalUrl: 'https://example.com/',
        normalizedUrl: 'https://example.com/',
      }]);

      await db.updateCrawlPage(tenantId, crawlJobId, page.id, {
        status: 'uploaded',
        stage: 'UPLOADED_TO_S3',
      });

      // Prior to document completion, job is processing
      let job = await db.syncCrawlJobAggregates(tenantId, crawlJobId);
      expect(job?.processingCount).toBe(1);
      expect(job?.completedCount).toBe(0);
      expect(job?.status).toBe('processing_pages');

      // Now downstream ingestion finishes and marks document READY
      await db.updateDocumentStatus(tenantId, doc.id, 'READY');

      // Calling syncCrawlJobAggregates or getCrawlJob must immediately reconcile crawl_page and parent crawl_job
      job = await db.getCrawlJob(tenantId, entityId, crawlJobId);
      expect(job?.completedCount).toBe(1);
      expect(job?.processingCount).toBe(0);
      expect(job?.status).toBe('completed');

      // Verify the crawl page itself is now marked completed with READY stage
      const pages = await db.getCrawlPages(tenantId, crawlJobId);
      expect(pages[0].status).toBe('completed');
      expect(pages[0].stage).toBe('READY');
    });

    it('document reaching FAILED must reconcile crawl page to failed and update parent progress', async () => {
      await db.createCrawlJob({
        id: crawlJobId,
        tenantId,
        entityId,
        rootUrl: 'https://example.com/',
      });

      const doc = await db.createDocument({
        tenantId,
        entityId,
        originalFilename: 'page2.md',
        mimeType: 'text/markdown',
        sizeBytes: 500,
        contentHash: 'hash-doc-fail-1',
        objectKey: 'acme-docs/page2.md',
        status: 'PENDING',
        sourceType: 'WEBSITE_CRAWL',
      });

      const [page] = await db.createCrawlPages([{
        tenantId,
        entityId,
        crawlJobId,
        documentId: doc.id,
        originalUrl: 'https://example.com/broken',
        normalizedUrl: 'https://example.com/broken',
      }]);

      await db.updateCrawlPage(tenantId, crawlJobId, page.id, {
        status: 'uploaded',
        stage: 'UPLOADED_TO_S3',
      });

      // Ingestion fails with OCR / formatting error
      await db.updateDocumentStatus(tenantId, doc.id, 'FAILED', 'Embedding API timeout');

      const job = await db.getCrawlJob(tenantId, entityId, crawlJobId);
      expect(job?.failedCount).toBe(1);
      expect(job?.completedCount).toBe(0);
      expect(job?.status).toBe('failed');

      const pages = await db.getCrawlPages(tenantId, crawlJobId);
      expect(pages[0].status).toBe('failed');
      expect(pages[0].stage).toBe('FAILED');
      expect(pages[0].errorMessage).toContain('Embedding API timeout');
    });
  });
});
