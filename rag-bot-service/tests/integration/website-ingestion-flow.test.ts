import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createNestApp, NestAppWithInject } from '../../src/app.js';
import { MemoryDatabaseAdapter } from '../../src/adapters/database/memory.adapter.js';
import { LocalStorageAdapter } from '../../src/adapters/storage/local-storage.adapter.js';
import { LocalQueueAdapter } from '../../src/adapters/queue/local-queue.adapter.js';
import { MockAIAdapter } from '../../src/adapters/ai/mock-ai.adapter.js';
import { DownloadWorker } from '../../src/modules/downloader/download-worker.js';
import path from 'path';
import fs from 'fs';

describe('Website Ingestion Flow Integration', () => {
  let app: NestAppWithInject;
  let db: MemoryDatabaseAdapter;
  let storage: LocalStorageAdapter;
  let queue: LocalQueueAdapter;
  let ai: MockAIAdapter;
  let downloadWorker: DownloadWorker;
  const storageDir = path.join(process.cwd(), 'test-storage-websites');

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

    // Mock fetch for website downloading in DownloadWorker
    const sampleWebHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Stripe Developer Documentation</title>
        <link rel="canonical" href="https://example.com/payments" />
      </head>
      <body>
        <main>
          <h1>Accepting Online Payments with Stripe</h1>
          <p>Stripe provides APIs to accept credit cards, digital wallets, and bank transfers.</p>
          <h2>Key Features</h2>
          <ul>
            <li>Payment Intents API with automated 3D Secure authentication</li>
            <li>Customizable Payment Element UI components</li>
            <li>Support for 135+ currencies and local payment methods</li>
          </ul>
        </main>
      </body>
      </html>
    `;

    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('empty-spa')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => '<html><body><div id="app"></div></body></html>',
          body: null,
        };
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => sampleWebHtml,
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
        email: `developer_${Date.now()}@stripe-integration.io`,
        password: 'Password123!',
        name: 'Stripe Dev',
        tenantName: 'Payments Engineering',
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
        url: 'https://example.com/docs',
        name: 'Stripe Payments Documentation',
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

  it('should accept website submission via POST /v1/portals/:portalReference/websites and process via DownloadWorker', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/portals/${entityId}/websites`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        url: 'https://example.com/payments',
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.jobId).toBeDefined();
    expect(body.totalUrls).toBe(1);
    expect(body.urls[0].url).toBe('https://example.com/payments');

    const jobId = body.jobId;
    const documentId = body.urls[0].documentId;

    // Simulate URL download queue worker execution
    await downloadWorker.processDownloadJob({
      tenantId,
      entityId,
      jobId,
      documentId,
      url: 'https://example.com/payments',
      portfolioUrl: 'example.com/docs',
      sourceType: 'website',
    });

    // Wait for async queue execution
    await new Promise(r => setTimeout(r, 200));

    // Verify document was updated in database
    const doc = await db.getDocumentById(tenantId, entityId, documentId);
    expect(doc).toBeDefined();
    expect(doc?.mimeType).toBe('text/markdown');
    expect(doc?.originalFilename).toContain('Stripe Developer Documentation');

    // Verify S3 object stored as Markdown
    const storedFile = await storage.downloadFile(doc!.objectKey);
    const storedMarkdown = storedFile.toString('utf-8');
    expect(storedMarkdown).toContain('# Stripe Developer Documentation');
    expect(storedMarkdown).toContain('Accepting Online Payments with Stripe');
    expect(storedMarkdown).toContain('- Payment Intents API with automated 3D Secure authentication');

    // Verify job document stage transitioned to UPLOADED_TO_S3 or READY
    const jobDoc = await db.getJobDocumentByDocumentId(documentId);
    expect(['UPLOADED_TO_S3', 'READY']).toContain(jobDoc?.stage);
    expect(jobDoc?.downloadMetadata?.sourceType).toBe('webpage');
    expect(jobDoc?.downloadMetadata?.canonicalUrl).toBe('https://example.com/payments');
  });

  it('should accept website submission via contract POST /api/ingestion/websites', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingestion/websites',
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        portfolioId: entityId,
        url: 'https://example.com/payments',
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.jobId).toBeDefined();
    expect(body.totalUrls).toBe(1);
    expect(body.urls[0].url).toBe('https://example.com/payments');
  });

  it('should detect JavaScript-only SPA websites and report NO_CONTENT_FOUND safely', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/portals/${entityId}/websites`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        url: 'https://example.com/empty-spa',
      },
    });

    expect(res.statusCode).toBe(202);
    const body = res.json();
    const jobId = body.jobId;
    const documentId = body.urls[0].documentId;

    await downloadWorker.processDownloadJob({
      tenantId,
      entityId,
      jobId,
      documentId,
      url: 'https://example.com/empty-spa',
      sourceType: 'website',
    });

    const jobDoc = await db.getJobDocumentByDocumentId(documentId);
    expect(jobDoc?.stage).toBe('NO_CONTENT_FOUND');
    expect(jobDoc?.errorMessage).toContain('No meaningful static content was found');
  });

  it('should retrieve grounded citations citing the source webpage URL when queried via askQuestion', async () => {
    // 1. Submit website
    const subRes = await app.inject({
      method: 'POST',
      url: `/v1/portals/${entityId}/websites`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: { url: 'https://example.com/payments' },
    });
    expect(subRes.statusCode).toBe(202);
    const subBody = subRes.json();
    const jobId = subBody.jobId;
    const documentId = subBody.urls[0].documentId;

    // 2. Download & extract
    await downloadWorker.processDownloadJob({
      tenantId,
      entityId,
      jobId,
      documentId,
      url: 'https://example.com/payments',
      portfolioUrl: 'example.com/docs',
      sourceType: 'website',
    });

    // 3. Allow local queue adapter to complete ingestion & chunking
    await new Promise(r => setTimeout(r, 300));

    // 4. Ask question against the portfolio
    const askRes = await app.inject({
      method: 'POST',
      url: `/v1/portals/${entityId}/ask`,
      headers: { Authorization: `Bearer ${authToken}` },
      payload: {
        question: 'What features does Stripe provide for online payments?',
      },
    });

    expect(askRes.statusCode).toBe(200);
    const askBody = askRes.json();
    expect(askBody.citations).toBeDefined();
    expect(askBody.citations.length).toBeGreaterThan(0);
    expect(askBody.citations[0].sourceUrl).toBe('https://example.com/payments');
  });
});

