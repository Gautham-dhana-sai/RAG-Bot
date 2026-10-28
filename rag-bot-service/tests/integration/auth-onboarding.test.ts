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

  it('supports registering with a username and signing in via username or email', async () => {
    // 1. Register with username
    const regRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'devportal_lead',
        email: 'lead@developerportal.tech',
        password: 'securePassword123',
        portalName: 'Developer Docs Portal',
      },
    });

    expect(regRes.statusCode).toBe(201);
    const regBody = JSON.parse(regRes.body);
    expect(regBody.user.username).toBe('devportal_lead');

    // 2. Sign in using username (identifier)
    const loginUsernameRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        identifier: 'devportal_lead',
        password: 'securePassword123',
      },
    });

    expect(loginUsernameRes.statusCode).toBe(200);
    const loginUserBody = JSON.parse(loginUsernameRes.body);
    expect(loginUserBody.token).toBeDefined();
    expect(loginUserBody.user.username).toBe('devportal_lead');

    // 3. Verify /v1/portals endpoint works with this session
    const portalsRes = await app.inject({
      method: 'GET',
      url: '/v1/portals',
      headers: {
        authorization: `Bearer ${loginUserBody.token}`,
      },
    });

    expect(portalsRes.statusCode).toBe(200);
    const portals = JSON.parse(portalsRes.body);
    expect(Array.isArray(portals)).toBe(true);
    expect(portals.length).toBeGreaterThanOrEqual(1);
    expect(portals[0].name).toBe('Developer Docs Portal');

    // 4. Verify duplicate registration fails with a 400 error and does NOT overwrite
    const dupRegRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        username: 'devportal_lead',
        email: 'another_email@domain.com',
        password: 'anotherPassword456',
      },
    });

    expect(dupRegRes.statusCode).toBe(400);
    const dupBody = JSON.parse(dupRegRes.body);
    expect(dupBody.error.message).toMatch(/already exists/i);
  });
});

