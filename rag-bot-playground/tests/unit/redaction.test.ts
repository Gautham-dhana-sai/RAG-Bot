import { describe, it, expect } from 'vitest';
import { RAGApiClient } from '../../src/services/api-client';
import { defaultConfig } from '../../src/services/storage';

describe('Header & Token Redaction', () => {
  it('should redact authorization headers and sensitive tokens in inspector logs', async () => {
    let capturedLog: any = null;
    const client = new RAGApiClient(
      {
        ...defaultConfig,
        token: 'super-secret-production-token-12345',
      },
      log => {
        capturedLog = log;
      }
    );

    // Mock global fetch
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify({ status: 'UP' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    await client.checkHealth();

    expect(capturedLog).toBeDefined();
    expect(capturedLog.requestHeaders['Authorization']).toBe('Bearer [REDACTED_SECRET_TOKEN]');
    expect(capturedLog.requestHeaders['Authorization']).not.toContain('super-secret-production-token-12345');
    expect(capturedLog.curlCommand).toContain('Bearer $RAG_API_TOKEN');
    expect(capturedLog.curlCommand).not.toContain('super-secret-production-token-12345');
  });
});
