import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp, NestAppWithInject } from '../../src/app.js';
import { MemoryDatabaseAdapter } from '../../src/adapters/database/memory.adapter.js';

describe('Ingestion Flow Integration', () => {
  let app: NestAppWithInject;
  let tenantId: string;
  let entityId: string;
  const authHeaders = { authorization: 'Bearer dev-persona-rag-secret-token-change-in-prod' };

  beforeAll(async () => {
    const res = await buildApp({ db: new MemoryDatabaseAdapter() });
    app = res.app;
    await app.ready();

    // Create test tenant
    const tRes = await app.inject({
      method: 'POST',
      url: '/v1/tenants',
      payload: { name: 'Acme Test Corp', slug: 'acme-test' },
      headers: authHeaders,
    });
    tenantId = JSON.parse(tRes.body).id;

    // Create test entity
    const eRes = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/entities`,
      payload: { name: 'Engineering Portfolio', slug: 'eng-portfolio', isPublic: true },
      headers: authHeaders,
    });
    entityId = JSON.parse(eRes.body).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should accept multiple files in one ingestion job (Criteria 3 & 4)', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/entities/${entityId}/ingestion-jobs`,
      headers: authHeaders,
      payload: {
        files: [
          {
            filename: 'resume.txt',
            mimeType: 'text/plain',
            content: 'Alex Rivera is a Staff Distributed Systems Architect with 12 years of experience.',
          },
          {
            filename: 'projects.md',
            mimeType: 'text/markdown',
            content: '# Cloud AI Projects\n\nBuilt high-throughput RAG pipeline with pgvector.',
          },
        ],
      },
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.body);
    expect(body.jobId).toBeDefined();
    expect(body.statusUrl).toBeDefined();
    expect(body.totalDocuments).toBe(2);
    expect(body.entityId).toBe(entityId);
    expect(body.tenantId).toBe(tenantId);

    // Wait briefly for in-memory worker to process
    await new Promise(r => setTimeout(r, 200));

    // Poll status endpoint
    const statusRes = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantId}/entities/${entityId}/ingestion-jobs/${body.jobId}`,
      headers: authHeaders,
    });

    expect(statusRes.statusCode).toBe(200);
    const statusBody = JSON.parse(statusRes.body);
    expect(['PROCESSING', 'READY']).toContain(statusBody.status);

    // Verify documents are associated with the intended entity
    const docsRes = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantId}/entities/${entityId}/documents`,
      headers: authHeaders,
    });
    const docs = JSON.parse(docsRes.body);
    expect(docs.length).toBe(2);
    for (const d of docs) {
      expect(d.entityId).toBe(entityId);
      expect(d.tenantId).toBe(tenantId);
    }
  });

  it('should be idempotent for duplicate file contents (Criteria 5)', async () => {
    const duplicateContent = 'Exact duplicate content for idempotency testing.';

    // First upload
    await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/entities/${entityId}/ingestion-jobs`,
      headers: authHeaders,
      payload: {
        files: [{ filename: 'doc1.txt', mimeType: 'text/plain', content: duplicateContent }],
      },
    });

    await new Promise(r => setTimeout(r, 100));

    // Second upload with same content
    const res2 = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/entities/${entityId}/ingestion-jobs`,
      headers: authHeaders,
      payload: {
        files: [{ filename: 'doc1_renamed.txt', mimeType: 'text/plain', content: duplicateContent }],
      },
    });

    expect(res2.statusCode).toBe(202);

    // Documents in entity should not duplicate the content hash
    const docsRes = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantId}/entities/${entityId}/documents`,
      headers: authHeaders,
    });
    const docs = JSON.parse(docsRes.body);
    const matchingDocs = docs.filter((d: any) => d.originalFilename.startsWith('doc1'));
    expect(matchingDocs.length).toBe(1);
  });

  it('should report processing failure safely when a document is corrupted or empty (Criteria 6)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/entities/${entityId}/ingestion-jobs`,
      headers: authHeaders,
      payload: {
        files: [{ filename: 'empty.txt', mimeType: 'text/plain', content: '   ' }],
      },
    });

    const body = JSON.parse(res.body);
    await new Promise(r => setTimeout(r, 200));

    const statusRes = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantId}/entities/${entityId}/ingestion-jobs/${body.jobId}`,
      headers: authHeaders,
    });

    const job = JSON.parse(statusRes.body);
    expect(job.failedDocuments).toBeGreaterThanOrEqual(1);
    expect(job.status).toBe('FAILED');
    expect(job.errorSummary).toBeDefined();
  });
});

