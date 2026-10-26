import { describe, it, expect, vi, afterEach } from 'vitest';
import { RAGApiClient } from '../../src/services/api-client';
import { defaultConfig } from '../../src/services/storage';

describe('RAGApiClient', () => {
  const originalFetch = (globalThis as any).fetch;

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('performs health check successfully', async () => {
    const mockResponse = { status: 'UP', timestamp: '2026-10-22T00:00:00Z', version: '1.0.0' };
    (globalThis as any).fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = new RAGApiClient(defaultConfig);
    const health = await client.checkHealth();

    expect(health.status).toBe('UP');
    expect((globalThis as any).fetch).toHaveBeenCalledWith(
      'http://localhost:3000/health',
      expect.objectContaining({
        method: 'GET',
      })
    );
  });

  it('creates conversation with entity path', async () => {
    const mockConv = {
      id: 'conv-123',
      tenantId: 'tenant-demo',
      entityId: 'entity-alex',
      title: 'Testing Session',
      createdAt: '2026-10-22T00:00:00Z',
      updatedAt: '2026-10-22T00:00:00Z',
    };

    (globalThis as any).fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockConv), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = new RAGApiClient({
      ...defaultConfig,
      tenantId: 'tenant-demo',
      entityId: 'entity-alex',
    });

    const res = await client.createConversation('tenant-demo', 'entity-alex', 'Testing Session');
    expect(res.id).toBe('conv-123');
    expect((globalThis as any).fetch).toHaveBeenCalledWith(
      'http://localhost:3000/v1/tenants/tenant-demo/entities/entity-alex/conversations',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ title: 'Testing Session' }),
      })
    );
  });

  it('sends message with retrieval parameters', async () => {
    const mockMsgResponse = {
      messageId: 'msg-456',
      conversationId: 'conv-123',
      answer: 'Alex has 10+ years of distributed systems experience.',
      citations: [
        {
          chunkId: 'chunk-1',
          documentId: 'doc-resume-01',
          documentTitle: 'Alex_Chen_Resume.pdf',
          snippet: 'Senior Staff Engineer with 10+ years...',
          score: 0.94,
        },
      ],
      insufficientEvidence: false,
      confidence: 0.94,
      diagnostics: {
        rewrittenQuery: 'What is Alex’s background?',
        retrievalMode: 'hybrid',
        topK: 5,
        retrievedCount: 8,
        totalDurationMs: 42,
      },
    };

    (globalThis as any).fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockMsgResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = new RAGApiClient(defaultConfig);
    const res = await client.sendMessage('tenant-demo', 'entity-alex', 'conv-123', {
      content: 'What is Alex’s background?',
      topK: 5,
      retrievalMode: 'hybrid',
      includeDiagnostics: true,
    });

    expect(res.answer).toContain('10+ years');
    expect(res.citations).toHaveLength(1);
    expect(res.diagnostics?.retrievalMode).toBe('hybrid');
  });

  it('attaches dev_headers when configured', async () => {
    let capturedHeaders: any = {};
    (globalThis as any).fetch = vi.fn().mockImplementation((_url, init) => {
      capturedHeaders = init?.headers || {};
      return Promise.resolve(
        new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    const client = new RAGApiClient({
      ...defaultConfig,
      authMode: 'dev_headers',
      userId: 'user-developer-99',
      tenantId: 'tenant-demo',
    });

    await client.listConversations('tenant-demo', 'entity-alex');
    expect(capturedHeaders['X-User-Id']).toBe('user-developer-99');
    expect(capturedHeaders['X-Tenant-Id']).toBe('tenant-demo');
  });

  it('handles backend error responses gracefully', async () => {
    (globalThis as any).fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: 'FORBIDDEN',
            message: 'You are not authorized to access this entity',
          },
        }),
        {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const client = new RAGApiClient(defaultConfig);
    await expect(client.getEntity('tenant-1', 'entity-secret')).rejects.toThrow(
      'You are not authorized to access this entity'
    );
  });

  it('invokes retrieval diagnostics API', async () => {
    const mockDiag = {
      query: 'Kafka distributed architecture',
      retrievalMode: 'hybrid',
      retrievedCount: 1,
      durationMs: 25,
      appliedFilters: {
        tenantId: 'tenant-demo',
        entityId: 'entity-alex',
        isPublicOnly: false,
        minScore: 0.005,
      },
      candidates: [
        {
          chunkId: 'chunk-1',
          documentId: 'doc-1',
          documentTitle: 'Resume.pdf',
          snippet: 'Event-driven streaming with Apache Kafka',
          score: 0.032,
          pageNumber: 2,
        },
      ],
    };

    (globalThis as any).fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockDiag), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    const client = new RAGApiClient(defaultConfig);
    const diag = await client.getRetrievalDiagnostics('tenant-demo', 'entity-alex', {
      query: 'Kafka distributed architecture',
      topK: 3,
      mode: 'hybrid',
    });

    expect(diag.candidates).toHaveLength(1);
    expect(diag.candidates[0].score).toBe(0.032);
  });
});

