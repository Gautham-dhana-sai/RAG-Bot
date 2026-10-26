import { describe, it, expect, vi } from 'vitest';
import { RAGApiClient } from '../../src/services/api-client';
import { defaultConfig } from '../../src/services/storage';
import { InspectorLog } from '../../src/types/playground.types';

describe('Playground Workflow Integration', () => {
  it('detaches conversation when entity changes', () => {
    let currentEntity = 'entity-alex';
    let currentConversationId: string | null = 'conv-alex-01';

    // Simulate entity change handler like in RequestConfigPanel
    const handleEntityChange = (newEntityId: string) => {
      if (newEntityId !== currentEntity) {
        currentEntity = newEntityId;
        currentConversationId = null; // Enforce detachment
      }
    };

    handleEntityChange('entity-sarah');
    expect(currentEntity).toBe('entity-sarah');
    expect(currentConversationId).toBeNull();
  });

  it('captures full lifecycle inspector log on message query', async () => {
    const logs: InspectorLog[] = [];
    const client = new RAGApiClient(
      {
        ...defaultConfig,
        token: 'auth-secret-1234',
        tenantId: 'tenant-demo',
        entityId: 'entity-alex',
      },
      log => logs.push(log)
    );

    const mockResponse = {
      messageId: 'msg-01',
      conversationId: 'conv-01',
      answer: 'Response with citations [1]',
      citations: [
        {
          chunkId: 'chunk-1',
          documentId: 'doc-01',
          documentTitle: 'Resume.pdf',
          snippet: 'Alex was VP of Eng...',
          score: 0.95,
        },
      ],
      insufficientEvidence: false,
      confidence: 0.95,
      diagnostics: {
        rewrittenQuery: 'Explain leadership experience',
        retrievalMode: 'hybrid',
        topK: 5,
        retrievedCount: 10,
        totalDurationMs: 38,
      },
    };

    (globalThis as any).fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-test-99' },
      })
    );

    const res = await client.sendMessage('tenant-demo', 'entity-alex', 'conv-01', {
      content: 'Explain leadership experience',
      topK: 5,
      retrievalMode: 'hybrid',
    });

    expect(res.answer).toContain('citations [1]');
    expect(logs.length).toBe(1);

    const log = logs[0];
    expect(log.method).toBe('POST');
    expect(log.url).toContain('/v1/tenants/tenant-demo/entities/entity-alex/conversations/conv-01/messages');
    expect(log.status).toBe(200);
    expect(log.durationMs).toBeGreaterThanOrEqual(0);
    expect(log.requestHeaders['Authorization']).toBe('Bearer [REDACTED_SECRET_TOKEN]');
    expect(log.curlCommand).toContain('Bearer $RAG_API_TOKEN');
    expect(log.responseHeaders['x-request-id'] || log.responseHeaders['X-Request-Id']).toBeDefined();
    expect(log.responseBody.citations).toHaveLength(1);
    expect(log.isError).toBe(false);
  });
});
