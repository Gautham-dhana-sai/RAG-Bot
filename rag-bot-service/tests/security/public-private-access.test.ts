import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp, NestAppWithInject } from '../../src/app.js';
import { MemoryDatabaseAdapter } from '../../src/adapters/database/memory.adapter.js';

describe('Public vs Private Access Security', () => {
  let app: NestAppWithInject;
  let tenantId: string;
  let publicEntityId: string;
  let privateEntityId: string;

  beforeAll(async () => {
    const res = await buildApp({ db: new MemoryDatabaseAdapter() });
    app = res.app;
    await app.ready();

    // Create Tenant
    const tRes = await app.inject({
      method: 'POST',
      url: '/v1/tenants',
      payload: { name: 'Acme Security Corp', slug: 'acme-sec' },
    });
    tenantId = JSON.parse(tRes.body).id;

    // Create Public Entity
    const pubRes = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/entities`,
      payload: { name: 'Public Portfolio', slug: 'pub-port', isPublic: true },
    });
    publicEntityId = JSON.parse(pubRes.body).id;

    // Create Private Entity
    const privRes = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/entities`,
      payload: { name: 'Private Records', slug: 'priv-rec', isPublic: false },
    });
    privateEntityId = JSON.parse(privRes.body).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('should allow public visitor to access public entity without token (Criteria 14)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantId}/entities/${publicEntityId}`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe(publicEntityId);
    expect(body.isPublic).toBe(true);
  });

  it('should block unauthenticated public visitor from accessing private entity (Criteria 14)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${tenantId}/entities/${privateEntityId}`,
    });

    expect(res.statusCode).toBe(401);
  });

  it('should block unauthenticated upload attempts to private entities', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${tenantId}/entities/${privateEntityId}/ingestion-jobs`,
      payload: {
        files: [{ filename: 'test.txt', content: 'test content' }],
      },
    });

    expect(res.statusCode).toBe(401);
  });
});

