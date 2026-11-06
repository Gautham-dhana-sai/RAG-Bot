import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MemoryDatabaseAdapter } from '../../src/adapters/database/memory.adapter.js';
import { LocalStorageAdapter } from '../../src/adapters/storage/local-storage.adapter.js';
import { LocalQueueAdapter } from '../../src/adapters/queue/local-queue.adapter.js';
import { IngestionService } from '../../src/modules/ingestion/ingestion.service.js';
import { DocumentsService } from '../../src/modules/documents/documents.service.js';
import { ExtractionService } from '../../src/modules/extraction/extraction.service.js';
import { ChunkingService } from '../../src/modules/chunking/chunking.service.js';
import { EmbeddingsService } from '../../src/modules/embeddings/embeddings.service.js';
import { MockAIAdapter } from '../../src/adapters/ai/mock-ai.adapter.js';
import { DownloadWorker } from '../../src/modules/downloader/download-worker.js';
import path from 'path';
import fs from 'fs';

const RICH_V1_HTML = `
<html>
<head><title>PersonaRAG Documentation</title></head>
<body>
  <main>
    <h1>PersonaRAG Documentation</h1>
    <p>This is comprehensive documentation explaining how multi-tenant retrieval works in PersonaRAG.</p>
    <p>We provide vector embeddings with 1536 dimensions and reciprocal rank fusion hybrid search.</p>
    <p>Knowledge sources can be refetched, updated, cited, and safely managed without breaking active search.</p>
  </main>
</body>
</html>
`;

const RICH_V2_HTML = `
<html>
<head><title>PersonaRAG Documentation V2</title></head>
<body>
  <main>
    <h1>PersonaRAG Documentation V2</h1>
    <p>This is modified and updated documentation with newly revised content in PersonaRAG.</p>
    <p>Vector search now supports explicit versioning where only the currently active version is retrievable.</p>
    <p>Updated content has been re-indexed with a new SHA-256 content hash and document version increment.</p>
  </main>
</body>
</html>
`;

describe('Website Refetch and Content Replacement Tests (Phase 1)', () => {
  let db: MemoryDatabaseAdapter;
  let storage: LocalStorageAdapter;
  let queue: LocalQueueAdapter;
  let ingestionService: IngestionService;
  let downloadWorker: DownloadWorker;
  const storageDir = path.join(process.cwd(), 'test-storage-refetch');

  const tenantId = '00000000-0000-0000-0000-000000000001';
  const entityId = '00000000-0000-0000-0000-000000000002';
  const crawlJobId = '00000000-0000-0000-0000-000000000003';

  async function drainQueue(): Promise<void> {
    let msgs = await queue.pollUrlDownloadMessages(10);
    while (msgs.length > 0) {
      for (const m of msgs) {
        await downloadWorker.processDownloadJob(m.payload);
      }
      msgs = await queue.pollUrlDownloadMessages(10);
    }
  }

  beforeEach(async () => {
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
    fs.mkdirSync(storageDir, { recursive: true });

    db = new MemoryDatabaseAdapter();
    await db.init();
    storage = new LocalStorageAdapter(storageDir);
    queue = new LocalQueueAdapter(false); // manual drain in tests

    const ai = new MockAIAdapter(1536);
    const docsService = new DocumentsService(db, storage);
    const extractionService = new ExtractionService();
    const chunkingService = new ChunkingService();
    const embeddingsService = new EmbeddingsService(ai);

    ingestionService = new IngestionService(
      db,
      storage,
      queue,
      docsService,
      extractionService,
      chunkingService,
      embeddingsService
    );

    downloadWorker = new DownloadWorker(db, storage, queue, ingestionService);

    await db.createTenant({ id: tenantId, name: 'Acme Corp', slug: 'acme' });
    await db.createEntity({ id: entityId, tenantId, name: 'Acme Docs', slug: 'acme-docs' });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should detect unchanged content on refetch, skip re-embedding, and track unchanged_count', async () => {
    let currentHtml = RICH_V1_HTML;

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: async () => 'User-agent: *\nAllow: /',
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => currentHtml,
      };
    }));

    // 1. Initial crawl
    await ingestionService.startWebsiteCrawl({
      tenantId,
      entityId,
      url: 'https://example.com/',
      config: { maxPages: 1, maxDepth: 0 },
    });

    // Drain initial crawl and page extraction
    await drainQueue();

    // Check parent website crawl status
    const initialCrawls = await db.listCrawlJobs(tenantId, entityId);
    expect(initialCrawls.length).toBe(1);
    const initialCrawl = initialCrawls[0];
    expect(initialCrawl.status).toBe('completed');

    const pagesBefore = await db.getCrawlPages(tenantId, initialCrawl.id);
    expect(pagesBefore.length).toBe(1);
    expect(pagesBefore[0].status).toBe('completed');
    expect(pagesBefore[0].stage).toBe('READY');

    const docBefore = await db.getDocumentById(tenantId, entityId, pagesBefore[0].documentId!);
    expect(docBefore?.status).toBe('READY');
    expect(docBefore?.activeVersionId).toBeDefined();

    // Search query confirms chunks are searchable
    const initialSearch = await db.searchChunks({
      tenantId,
      entityId,
      query: 'comprehensive documentation',
    });
    expect(initialSearch.length).toBeGreaterThan(0);

    // 2. Initiate Refetch with identical HTML
    const refetchRes = await ingestionService.refetchWebsiteCrawl({
      tenantId,
      entityId,
      crawlJobId: initialCrawl.id,
    });
    expect(refetchRes.status).toBe('discovering');

    const crawlDuring = await db.getCrawlJob(tenantId, entityId, initialCrawl.id);
    expect(crawlDuring?.refetchStatus).toBe('refetching');

    // Drain queue for refetch
    await drainQueue();

    // Check refetch results
    const crawlAfter = await db.getCrawlJob(tenantId, entityId, initialCrawl.id);
    expect(crawlAfter?.status).toBe('completed');
    expect(crawlAfter?.refetchStatus).toBe('completed');
    expect(crawlAfter?.unchangedCount).toBe(1);
    expect(crawlAfter?.changedCount).toBe(0);

    const pagesAfter = await db.getCrawlPages(tenantId, initialCrawl.id);
    expect(pagesAfter[0].isUnchanged).toBe(true);
    expect(pagesAfter[0].status).toBe('completed');

    // Versions count should still be 1 (no redundant version created)
    const versions = await db.getDocumentVersions(tenantId, pagesBefore[0].documentId!);
    expect(versions.length).toBe(1);
  });

  it('should detect changed content on refetch, create version 2, and switch active_version_id atomically', async () => {
    let currentHtml = RICH_V1_HTML;

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: async () => 'User-agent: *\nAllow: /',
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => currentHtml,
      };
    }));

    // 1. Initial crawl
    await ingestionService.startWebsiteCrawl({
      tenantId,
      entityId,
      url: 'https://example.com/',
      config: { maxPages: 1, maxDepth: 0 },
    });
    await drainQueue();

    const [initialCrawl] = await db.listCrawlJobs(tenantId, entityId);
    const [page1] = await db.getCrawlPages(tenantId, initialCrawl.id);
    const doc1 = await db.getDocumentById(tenantId, entityId, page1.documentId!);
    const v1Id = doc1?.activeVersionId;
    expect(v1Id).toBeDefined();

    // Verify V1 is indexed and searchable
    const searchV1 = await db.searchChunks({
      tenantId,
      entityId,
      query: 'comprehensive documentation',
    });
    expect(searchV1.length).toBeGreaterThan(0);

    // 2. Modify website content and refetch
    currentHtml = RICH_V2_HTML;

    await ingestionService.refetchWebsiteCrawl({
      tenantId,
      entityId,
      crawlJobId: initialCrawl.id,
    });
    await drainQueue();

    // Verify crawl metrics
    const crawlJob = await db.getCrawlJob(tenantId, entityId, initialCrawl.id);
    expect(crawlJob?.changedCount).toBe(1);
    expect(crawlJob?.unchangedCount).toBe(0);
    expect(crawlJob?.refetchStatus).toBe('completed');

    // Document must have a new active_version_id
    const doc2 = await db.getDocumentById(tenantId, entityId, page1.documentId!);
    const v2Id = doc2?.activeVersionId;
    expect(v2Id).toBeDefined();
    expect(v2Id).not.toBe(v1Id);

    // Document versions table should contain both versions
    const versions = await db.getDocumentVersions(tenantId, doc2!.id);
    expect(versions.length).toBe(2);
    expect(versions[0].versionNumber).toBe(2);
    expect(versions[1].versionNumber).toBe(1);

    // Search query now returns Version 2 content
    const searchV2 = await db.searchChunks({
      tenantId,
      entityId,
      query: 'modified and updated documentation',
    });
    expect(searchV2.length).toBeGreaterThan(0);
    expect(searchV2[0].chunk.versionId).toBe(v2Id);

    // Search must NOT return Version 1 chunks (excluded from active retrieval)
    const searchOld = await db.searchChunks({
      tenantId,
      entityId,
      query: 'comprehensive documentation',
    });
    const containsV1Chunk = searchOld.some(s => s.chunk.versionId === v1Id);
    expect(containsV1Chunk).toBe(false);
  });

  it('should preserve active READY document if a refetch extraction fails', async () => {
    let shouldFail = false;

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url.endsWith('/robots.txt')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/plain' }),
          text: async () => 'User-agent: *\nAllow: /',
        };
      }
      if (shouldFail) {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => '500 Server Error',
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => RICH_V1_HTML,
      };
    }));

    // 1. Initial successful crawl
    await ingestionService.startWebsiteCrawl({
      tenantId,
      entityId,
      url: 'https://example.com/',
      config: { maxPages: 1, maxDepth: 0 },
    });
    await drainQueue();

    const [initialCrawl] = await db.listCrawlJobs(tenantId, entityId);
    const [page] = await db.getCrawlPages(tenantId, initialCrawl.id);
    const docBefore = await db.getDocumentById(tenantId, entityId, page.documentId!);
    expect(docBefore?.status).toBe('READY');
    const initialVersionId = docBefore?.activeVersionId;
    expect(initialVersionId).toBeDefined();

    // 2. Refetch fails on the target server (e.g. HTTP 500)
    shouldFail = true;
    await ingestionService.refetchWebsiteCrawl({
      tenantId,
      entityId,
      crawlJobId: initialCrawl.id,
    });
    await drainQueue();

    // Existing READY document must remain available and active
    const docAfter = await db.getDocumentById(tenantId, entityId, page.documentId!);
    expect(docAfter?.activeVersionId).toBe(initialVersionId);

    // Active version remains retrievable
    const searchAfterFail = await db.searchChunks({
      tenantId,
      entityId,
      query: 'comprehensive documentation',
    });
    expect(searchAfterFail.length).toBeGreaterThan(0);
    expect(searchAfterFail[0].chunk.versionId).toBe(initialVersionId);
  });
});
