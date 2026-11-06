import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createNestApp, NestAppWithInject } from '../../src/app.js';
import { MemoryDatabaseAdapter } from '../../src/adapters/database/memory.adapter.js';
import { LocalStorageAdapter } from '../../src/adapters/storage/local-storage.adapter.js';
import { LocalQueueAdapter } from '../../src/adapters/queue/local-queue.adapter.js';
import { MockAIAdapter } from '../../src/adapters/ai/mock-ai.adapter.js';
import path from 'path';
import fs from 'fs';

describe('Knowledge Base Management, Viewer, Citations & Source Control (Phases 1 - 6)', () => {
  let app: NestAppWithInject;
  let db: MemoryDatabaseAdapter;
  let storage: LocalStorageAdapter;
  let queue: LocalQueueAdapter;
  let ai: MockAIAdapter;
  const storageDir = path.join(process.cwd(), 'test-storage-docview');

  let authToken: string;
  let tenantId: string;
  let entityId: string;

  beforeEach(async () => {
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
    fs.mkdirSync(storageDir, { recursive: true });

    db = new MemoryDatabaseAdapter();
    await db.init();
    storage = new LocalStorageAdapter(storageDir);
    queue = new LocalQueueAdapter(true);
    ai = new MockAIAdapter(1536);

    const nestApp = await createNestApp({
      db,
      storage,
      queue,
      ai,
      config: {
        MAX_UPLOAD_SIZE_BYTES: 10 * 1024 * 1024,
      },
    });
    app = nestApp.app;
    await app.init();

    const regRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: `docview_${Date.now()}@example.com`,
        password: 'Password123!',
        portalName: 'DocView Portfolio',
      },
    });

    expect(regRes.statusCode).toBe(201);
    const regData = regRes.json();
    authToken = regData.token;
    tenantId = regData.tenant.id;

    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/portals',
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const portals = listRes.json();
    expect(portals.length).toBeGreaterThan(0);
    entityId = portals[0].id;
  });

  afterEach(async () => {
    await app.close();
    if (fs.existsSync(storageDir)) {
      fs.rmSync(storageDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('Phase 4 & 6: should stream uploaded document content securely via GET /documents/:docId/content and delete via DELETE', async () => {
    // 1. Upload a sample document
    const fileContent = 'Hello PersonaRAG knowledge base! This is a test markdown document.';
    const uploadRes = await app.inject({
      method: 'POST',
      url: `/v1/portals/${entityId}/ingestion-jobs`,
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
      payload: {
        files: [
          {
            filename: 'sample-guide.md',
            mimeType: 'text/markdown',
            content: fileContent,
          },
        ],
      },
    });

    expect(uploadRes.statusCode).toBe(202);

    // Get documents list
    const docsRes = await app.inject({
      method: 'GET',
      url: `/v1/portals/${entityId}/documents`,
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(docsRes.statusCode).toBe(200);
    const docs = docsRes.json();
    expect(docs.length).toBe(1);
    const docId = docs[0].id;

    // 2. View document content stream
    const viewRes = await app.inject({
      method: 'GET',
      url: `/v1/portals/${entityId}/documents/${docId}/content`,
      headers: { Authorization: `Bearer ${authToken}` },
    });

    expect(viewRes.statusCode).toBe(200);
    expect(viewRes.headers['content-type']).toContain('text/markdown');
    expect(viewRes.headers['content-disposition']).toContain('inline; filename="sample-guide.md"');
    expect(viewRes.body).toBe(fileContent);

    // 3. Delete document
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/v1/portals/${entityId}/documents/${docId}`,
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(delRes.statusCode).toBe(200);

    // 4. Verify document is deleted
    const docsAfterRes = await app.inject({
      method: 'GET',
      url: `/v1/portals/${entityId}/documents`,
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(docsAfterRes.json().length).toBe(0);
  });

  it('Phase 2: should detect duplicate files and duplicate websites', async () => {
    // Check non-existent file
    const check1 = await app.inject({
      method: 'POST',
      url: `/v1/portals/${entityId}/check-duplicate`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: { filename: 'existing-policy.pdf' },
    });
    expect(check1.statusCode).toBe(200);
    expect(check1.json().isDuplicate).toBe(false);

    // Upload file
    await app.inject({
      method: 'POST',
      url: `/v1/portals/${entityId}/ingestion-jobs`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        files: [{ filename: 'existing-policy.pdf', mimeType: 'application/pdf', content: 'Sample PDF bytes' }],
      },
    });

    // Check again -> should be duplicate
    const check2 = await app.inject({
      method: 'POST',
      url: `/v1/portals/${entityId}/check-duplicate`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: { filename: 'existing-policy.pdf' },
    });
    expect(check2.statusCode).toBe(200);
    expect(check2.json().isDuplicate).toBe(true);
    expect(check2.json().type).toBe('file');

    // Create a website crawl job
    await app.inject({
      method: 'POST',
      url: `/v1/portals/${entityId}/crawls`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: { url: 'https://docs.example.com/' },
    });

    // Check duplicate website
    const check3 = await app.inject({
      method: 'POST',
      url: `/v1/portals/${entityId}/check-duplicate`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: { url: 'https://docs.example.com' },
    });
    expect(check3.statusCode).toBe(200);
    expect(check3.json().isDuplicate).toBe(true);
    expect(check3.json().type).toBe('website');
  });

  it('Phase 3 & 6: should discover routes, start crawl with selected routes, and delete entire crawl', async () => {
    // 1. Discover routes
    const discRes = await app.inject({
      method: 'POST',
      url: `/v1/portals/${entityId}/crawls/discover`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: { url: 'https://example.com' },
    });
    expect(discRes.statusCode).toBe(200);
    const discData = discRes.json();
    expect(discData.rootUrl).toContain('https://example.com');
    expect(discData.pages.length).toBeGreaterThan(0);

    // 2. Start crawl with selected routes
    const crawlRes = await app.inject({
      method: 'POST',
      url: `/v1/portals/${entityId}/crawls`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        url: 'https://example.com',
        selectedUrls: ['https://example.com'],
      },
    });
    expect(crawlRes.statusCode).toBe(202);
    const crawlJobId = crawlRes.json().crawlJobId;

    // 3. Delete crawl job
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/v1/portals/${entityId}/crawls/${crawlJobId}`,
      headers: { Authorization: `Bearer ${authToken}` },
    });
    expect(delRes.statusCode).toBe(200);
    expect(delRes.json().success).toBe(true);
  });

  it('Phase 5: should return rich citation metadata for chat answers', async () => {
    // Ingest a document with chunks
    const docId = 'doc-citation-test';
    await db.createDocument({
      id: docId,
      tenantId,
      entityId,
      originalFilename: 'citation-handbook.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      contentHash: 'hash123',
      objectKey: 'tenant/citation-handbook.pdf',
      status: 'READY',
      sourceType: 'UPLOAD',
    });

    await db.insertChunks([
      {
        tenantId,
        entityId,
        documentId: docId,
        chunkIndex: 0,
        chunkText: 'Antigravity enables seamless retrieval-augmented generation with verified citations.',
        embedding: ai.dummyEmbedding,
        metadata: { pageNumber: 3 },
      },
    ]);

    // Perform QA ask question
    const qaRes = await app.inject({
      method: 'POST',
      url: `/v1/portals/${entityId}/qa`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        question: 'What does Antigravity enable?',
      },
    });

    expect(qaRes.statusCode).toBe(200);
    const qaData = qaRes.json();
    expect(qaData.answer).toBeDefined();
    expect(qaData.citations).toBeDefined();
    if (qaData.citations.length > 0) {
      const citation = qaData.citations[0];
      expect(citation.documentId).toBe(docId);
      expect(citation.sourceTitle).toBe('citation-handbook.pdf');
    }
  });
});
