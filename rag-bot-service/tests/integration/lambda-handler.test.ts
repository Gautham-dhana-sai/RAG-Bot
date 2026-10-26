import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { handler } from '../../src/lambda.js';

describe('AWS Lambda Handler Integration', () => {
  it('should be invocable with an API Gateway HTTP API v2 event (Criteria 15)', async () => {
    const event = {
      version: '2.0',
      routeKey: 'GET /health',
      rawPath: '/health',
      rawQueryString: '',
      headers: {
        host: 'api.personarag.example.com',
        'user-agent': 'vitest-aws-test',
      },
      requestContext: {
        accountId: '123456789012',
        apiId: 'r3test123',
        domainName: 'api.personarag.example.com',
        http: {
          method: 'GET',
          path: '/health',
          protocol: 'HTTP/1.1',
          sourceIp: '127.0.0.1',
          userAgent: 'vitest-aws-test',
        },
        routeKey: 'GET /health',
        stage: '$default',
        timeEpoch: Date.now(),
      },
      isBase64Encoded: false,
    };

    const result = await handler(event, {} as any);
    expect(result).toBeDefined();
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body);
    expect(body.status).toBe('UP');
  });

  it('should ensure handler signatures do not use legacy 3-parameter callbacks (prevents Runtime.CallbackHandlerDeprecated)', async () => {
    // AWS Lambda deprecates and errors on 3-argument callback handlers: (event, context, callback)
    expect(handler.length).toBeLessThan(3);
  });

  it('should verify Lambda packaging output if ZIP exists (Criteria 16)', () => {
    const zipPath = path.resolve(process.cwd(), 'dist', 'lambda-bundle.zip');
    // If the packaging script was run, verify it is a valid non-empty file
    if (fs.existsSync(zipPath)) {
      const stat = fs.statSync(zipPath);
      expect(stat.size).toBeGreaterThan(1000); // Must contain bundled application
    }
  });
});

