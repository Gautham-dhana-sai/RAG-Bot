import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp, NestAppWithInject } from '../../src/app.js';
import { MemoryDatabaseAdapter } from '../../src/adapters/database/memory.adapter.js';

describe('Tenant and Entity Isolation Security Tests', () => {
  let app: NestAppWithInject;
  let tenantAId: string;
  let tenantBId: string;
  let entityA1Id: string;
  let entityA2PrivateId: string;
  let entityBId: string;
  let convAId: string;
  const authHeaders = { authorization: 'Bearer dev-persona-rag-secret-token-change-in-prod' };

  beforeAll(async () => {
    const res = await buildApp({ db: new MemoryDatabaseAdapter() });
    app = res.app;
    await app.ready();

    // Create Tenant A
    const tA = await app.inject({
      method: 'POST',
      url: '/v1/tenants',
      payload: { name: 'Tenant Alpha Corp', slug: 'tenant-alpha' },
      headers: authHeaders,
    });
    tenantAId = JSON.parse(tA.body).id;

    // Create Tenant B
    const tB = await app.inject({
      method: 'POST',
      url: '/v1/tenants',
      payload: { name: 'Tenant Beta Corp', slug: 'tenant-beta' },
      headers: authHeaders,
    });
    tenantBId = JSON.parse(tB.body).id;

    // Create Entities for Tenant A
    const eA1 = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantAId}/entities`,
      payload: { name: 'Alpha Public Portfolio', slug: 'alpha-pub', isPublic: true },
      headers: authHeaders,
    });
    entityA1Id = JSON.parse(eA1.body).id;

    const eA2 = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantAId}/entities`,
      payload: { name: 'Alpha Secret Vault', slug: 'alpha-sec', isPublic: false },
      headers: authHeaders,
    });
    entityA2PrivateId = JSON.parse(eA2.body).id;

    // Create Entity for Tenant B
    const eB = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantBId}/entities`,
      payload: { name: 'Beta Public Portfolio', slug: 'beta-pub', isPublic: true },
      headers: authHeaders,
    });
    entityBId = JSON.parse(eB.body).id;

    // Ingest confidential document into Tenant A's private entity
    await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantAId}/entities/${entityA2PrivateId}/ingestion-jobs`,
      headers: authHeaders,
      payload: {
        files: [
          {
            filename: 'alpha-secret.txt',
            mimeType: 'text/plain',
            content: 'SECRET ACQUISITION TARGET: Alpha Corp will acquire StealthAI for $45M.',
          },
        ],
      },
    });

    // Ingest into Tenant B's public entity
    await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantBId}/entities/${entityBId}/ingestion-jobs`,
      headers: authHeaders,
      payload: {
        files: [
          {
            filename: 'beta-info.txt',
            mimeType: 'text/plain',
            content: 'Beta Corp specializes in medical imaging and radiology.',
          },
        ],
      },
    });

    await new Promise(r => setTimeout(r, 200));

    // Create conversation in Tenant A
    const cRes = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantAId}/entities/${entityA1Id}/conversations`,
      payload: { title: 'Alpha Private Conversation' },
    });
    convAId = JSON.parse(cRes.body).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should prevent Tenant B from retrieving Tenant A private chunks (Criteria 11)', async () => {
    // Create conversation in Tenant B
    const convBRes = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantBId}/entities/${entityBId}/conversations`,
    });
    const convBId = JSON.parse(convBRes.body).id;

    // Query Tenant B asking about Tenant A's secret
    const queryRes = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantBId}/entities/${entityBId}/conversations/${convBId}/messages`,
      payload: {
        content: 'What is the secret acquisition target of Alpha Corp?',
      },
    });

    const body = JSON.parse(queryRes.body);
    // Must abstain safely; must not leak Tenant A's $45M StealthAI secret
    expect(body.insufficientEvidence).toBe(true);
    expect(body.answer.toLowerCase()).toContain('insufficient evidence');
    expect(body.answer).not.toContain('StealthAI');
    expect(body.answer).not.toContain('$45M');
  });

  it('should prevent one entity from accessing another entity chunks even in same tenant (Criteria 12)', async () => {
    // Query Alpha's Public Portfolio asking for information in Alpha's Private Vault
    const qRes = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantAId}/entities/${entityA1Id}/conversations/${convAId}/messages`,
      payload: {
        content: 'Tell me about the StealthAI acquisition',
      },
    });

    const body = JSON.parse(qRes.body);
    expect(body.insufficientEvidence).toBe(true);
    expect(body.answer).not.toContain('$45M');
  });

  it('should reject requests with mismatched tenant and entity IDs (Cross-tenant tampering)', async () => {
    // Try to access Tenant A's entity using Tenant B's tenantId URL path
    const res = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantBId}/entities/${entityA1Id}`,
    });

    expect(res.statusCode).toBe(404);
  });
});

