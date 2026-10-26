import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp, NestAppWithInject } from '../../src/app.js';
import { MemoryDatabaseAdapter } from '../../src/adapters/database/memory.adapter.js';

describe('Auth & Onboarding Registration Flow', () => {
  let app: NestAppWithInject;

  beforeAll(async () => {
    const res = await buildApp({ db: new MemoryDatabaseAdapter() });
    app = res.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('fetches pre-seeded demo profiles with auto-generated session tokens', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/demo-profiles',
    });

    expect(res.statusCode).toBe(200);
    const profiles = JSON.parse(res.body);
    expect(Array.isArray(profiles)).toBe(true);
    expect(profiles.length).toBeGreaterThanOrEqual(2);

    const alex = profiles.find((p: any) => p.name === 'Alex Chen');
    expect(alex).toBeDefined();
    expect(alex.token).toContain('ragbot_sess_');
    expect(alex.tenantId).toBeDefined();
    expect(alex.entityId).toBeDefined();
  });

  it('registers a new user, workspace (tenant), and portfolio (entity) automatically', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        name: 'Elena Rostova',
        email: 'elena.rostova@quantumai.io',
        workspaceName: 'Quantum AI Systems',
        portfolioName: 'Quantum Robotics Portfolio',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);

    expect(body.token).toContain('ragbot_sess_');
    expect(body.user.name).toBe('Elena Rostova');
    expect(body.user.email).toBe('elena.rostova@quantumai.io');
    expect(body.tenant.name).toBe('Quantum AI Systems');
    expect(body.tenant.id).toBeDefined();
    expect(body.activeEntity.name).toBe('Quantum Robotics Portfolio');
    expect(body.activeEntity.id).toBeDefined();

    // Verify token can immediately be used to query the active entity without entering raw IDs
    const meRes = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: {
        authorization: `Bearer ${body.token}`,
      },
    });

    expect(meRes.statusCode).toBe(200);
    const meBody = JSON.parse(meRes.body);
    expect(meBody.user.id).toBe(body.user.id);
    expect(meBody.tenant.id).toBe(body.tenant.id);
    expect(meBody.entities.length).toBe(1);
    expect(meBody.entities[0].name).toBe('Quantum Robotics Portfolio');
  });
});

