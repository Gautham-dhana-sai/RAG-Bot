import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp, NestAppWithInject } from '../../src/app.js';
import { MemoryDatabaseAdapter } from '../../src/adapters/database/memory.adapter.js';

describe('Conversations & RAG Retrieval Flow', () => {
  let app: NestAppWithInject;
  let tenantId: string;
  let entityId: string;
  let conversationId: string;
  const authHeaders = { authorization: 'Bearer dev-persona-rag-secret-token-change-in-prod' };

  beforeAll(async () => {
    const res = await buildApp({ db: new MemoryDatabaseAdapter() });
    app = res.app;
    await app.ready();

    // 1. Create Tenant & Entity
    const tRes = await app.inject({
      method: 'POST',
      url: '/v1/tenants',
      payload: { name: 'Acme Systems', slug: 'acme-sys' },
      headers: authHeaders,
    });
    tenantId = JSON.parse(tRes.body).id;

    const eRes = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/entities`,
      payload: { name: 'Alex Rivera Portfolio', slug: 'alex-portfolio', isPublic: true },
      headers: authHeaders,
    });
    entityId = JSON.parse(eRes.body).id;

    // 2. Ingest Document
    await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/entities/${entityId}/ingestion-jobs`,
      headers: authHeaders,
      payload: {
        files: [
          {
            filename: 'alex-resume.txt',
            mimeType: 'text/plain',
            content: 'Alex Rivera served as Principal Cloud Architect at CloudScale AI Systems from 2021 to present. ' +
                     'He architected a multi-tenant RAG service with 10M vector queries daily using pgvector and Reciprocal Rank Fusion. ' +
                     'He holds US Patent #10,482,912 on multi-tenant vector partitioning.',
          },
        ],
      },
    });

    await new Promise(r => setTimeout(r, 200));

    // 3. Create Conversation
    const convRes = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/entities/${entityId}/conversations`,
      payload: { title: 'Alex Career Inquiry' },
    });
    conversationId = JSON.parse(convRes.body).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should retrieve evidence and generate citations for supported questions (Criteria 7 & 9)', async () => {
    const msgRes = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/entities/${entityId}/conversations/${conversationId}/messages`,
      payload: {
        content: 'What patent does Alex Rivera hold on vector partitioning?',
      },
    });

    expect(msgRes.statusCode).toBe(200);
    const body = JSON.parse(msgRes.body);

    expect(body.answer).toBeDefined();
    expect(body.insufficientEvidence).toBe(false);
    expect(body.citations.length).toBeGreaterThan(0);

    // Citations must point to real source chunk
    for (const c of body.citations) {
      expect(c.chunkId).toBeDefined();
      expect(c.documentId).toBeDefined();
      expect(c.snippet).toContain('Patent');
    }
  });

  it('should resolve follow-up questions using conversation history (Criteria 8)', async () => {
    const followUpRes = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/entities/${entityId}/conversations/${conversationId}/messages`,
      payload: {
        content: 'How many daily vector queries did that system handle?',
      },
    });

    expect(followUpRes.statusCode).toBe(200);
    const body = JSON.parse(followUpRes.body);
    expect(body.answer).toBeDefined();
    expect(body.insufficientEvidence).toBe(false);
    expect(body.citations.length).toBeGreaterThan(0);
  });

  it('should receive a safe abstention for unsupported out-of-domain questions (Criteria 10)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/entities/${entityId}/conversations/${conversationId}/messages`,
      payload: {
        content: 'What is the secret recipe for authentic Neapolitan pizza sauce?',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.insufficientEvidence).toBe(true);
    expect(body.confidence).toBe(0.0);
    expect(body.answer.toLowerCase()).toContain('insufficient evidence');
    expect(body.citations.length).toBe(0);
  });
});

