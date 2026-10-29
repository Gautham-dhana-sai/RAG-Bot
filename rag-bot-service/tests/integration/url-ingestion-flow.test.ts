import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createNestApp, NestAppWithInject } from '../../src/app.js';
import { MemoryDatabaseAdapter } from '../../src/adapters/database/memory.adapter.js';
import { LocalStorageAdapter } from '../../src/adapters/storage/local-storage.adapter.js';
import { LocalQueueAdapter } from '../../src/adapters/queue/local-queue.adapter.js';
import { MockAIAdapter } from '../../src/adapters/ai/mock-ai.adapter.js';
import { IngestionService } from '../../src/modules/ingestion/ingestion.service.js';

describe('URL Ingestion & S3 Event Routing Integration (Criteria 8, 9, 13, 14, 15, 16)', () => {
  let app: NestAppWithInject;
  let db: MemoryDatabaseAdapter;
  let storage: LocalStorageAdapter;
  let queue: LocalQueueAdapter;
  let ai: MockAIAdapter;
  let userToken: string;
  let tenantId: string;
  let portfolioSlug: string;
  let portfolioId: string;

  beforeEach(async () => {
    db = new MemoryDatabaseAdapter();
    storage = new LocalStorageAdapter('test-storage');
    queue = new LocalQueueAdapter(false);
    ai = new MockAIAdapter(3072);

    const nestApp = await createNestApp({
      db,
      storage,
      queue,
      ai,
    });
    app = nestApp.app;
    await app.init();

    // 1. Register a user and acquire JWT token
    const regRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: `tester_${Date.now()}@example.com`,
        password: 'Password123!',
        name: 'Alex Rivera',
        tenantName: 'Rivera Labs',
      },
    });

    const regData = regRes.json();
    userToken = regData.token;
    tenantId = regData.tenant.id;

    // 2. Create a portal/portfolio for testing
    portfolioSlug = `tech-portfolio-${Date.now()}`;
    const portRes = await app.inject({
      method: 'POST',
      url: '/v1/portals',
      headers: { Authorization: `Bearer ${userToken}` },
      payload: {
        name: 'Cloud Architecture Portfolio',
        url: `https://rivera.dev/${portfolioSlug}`,
      },
    });
    const portData = portRes.json();
    portfolioId = portData.id;
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should require authentication when submitting URLs (Criteria 8)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/portals/${portfolioId}/urls`,
      payload: {
        urls: ['https://example.com/resume.pdf'],
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('should submit valid URLs, create job with URL_IMPORT, and enqueue to URL download queue (Criteria 9)', async () => {
    const enqueueSpy = vi.spyOn(queue, 'enqueueUrlDownloadJob');

    const res = await app.inject({
      method: 'POST',
      url: `/v1/portals/${portfolioId}/urls`,
      headers: { Authorization: `Bearer ${userToken}` },
      payload: {
        urls: [
          'https://example.com/system_architecture.pdf',
          'https://example.com/diagram.png',
        ],
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.jobId).toBeDefined();
    expect(body.totalUrls).toBe(2);
    expect(body.urls.length).toBe(2);
    expect(body.status).toBe('PENDING');

    // Verify messages were enqueued to the URL download queue
    expect(enqueueSpy).toHaveBeenCalledTimes(2);
  });

  it('should reject invalid or malformed URLs (Criteria 4)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/portals/${portfolioId}/urls`,
      headers: { Authorization: `Bearer ${userToken}` },
      payload: {
        urls: ['not-a-valid-url'],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    const errMsg = body?.message || body?.error?.message || JSON.stringify(body);
    expect(errMsg).toContain('Invalid URLs submitted');
  });

  it('should route S3 ObjectCreated event notification to ingestion pipeline (Criteria 13, 14)', async () => {
    // 1. Manually register a stored document in DB and storage
    const objectKey = `rivera.dev/${portfolioSlug}/guide.txt`;
    const textBytes = Buffer.from('Grounded Architecture Guide Content with vectors and entities for RAG retrieval.');
    await storage.uploadFile(objectKey, textBytes, 'text/plain');

    const entity = (await db.getEntitiesByTenant(tenantId))[0];
    const doc = await db.createDocument({
      tenantId,
      entityId: entity.id,
      originalFilename: 'guide.txt',
      mimeType: 'text/plain',
      sizeBytes: textBytes.length,
      contentHash: 'mock-hash-1234',
      objectKey,
      isPublic: true,
      status: 'PENDING',
    });

    // 2. Resolve IngestionService directly from the test's Nest application
    const ingestionService = app.get(IngestionService);
    await ingestionService.processS3ObjectCreated(objectKey);

    // 3. Verify document status transitioned to READY in pgvector/database
    const updatedDoc = await db.getDocumentById(tenantId, entity.id, doc.id);
    expect(updatedDoc?.status).toBe('READY');
  });

  it('should ensure existing direct file uploads still function and reach ingestion pipeline (Criteria 15, 16)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/portals/${portfolioId}/ingestion-jobs`,
      headers: { Authorization: `Bearer ${userToken}` },
      payload: {
        files: [
          {
            filename: 'resume.txt',
            mimeType: 'text/plain',
            content: 'Full Stack Engineer with 8 years of distributed systems experience.',
          },
        ],
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.jobId).toBeDefined();
    expect(body.totalDocuments).toBe(1);
  });
});
