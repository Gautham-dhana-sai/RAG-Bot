import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp, NestAppWithInject } from '../../src/app.js';
import { MemoryDatabaseAdapter } from '../../src/adapters/database/memory.adapter.js';

describe('Health Integration Test', () => {
  let app: NestAppWithInject;

  beforeAll(async () => {
    const res = await buildApp({ db: new MemoryDatabaseAdapter() });
    app = res.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should respond with UP status on /health', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.status).toBe('UP');
    expect(body.version).toBe('1.0.0');
    expect(body.database).toBeDefined();
    expect(body.ai).toBeDefined();
  });
});

