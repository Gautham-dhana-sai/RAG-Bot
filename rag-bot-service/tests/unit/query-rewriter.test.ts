import { describe, it, expect } from 'vitest';
import { QueryRewriter } from '../../src/modules/conversations/query-rewriter.js';
import { MockAIAdapter } from '../../src/adapters/ai/mock-ai.adapter.js';
import { Message } from '../../src/types/index.js';

describe('QueryRewriter', () => {
  const ai = new MockAIAdapter(384);
  const rewriter = new QueryRewriter(ai);

  it('should preserve standalone questions without history', async () => {
    const question = 'What are Sarah Chen achievements in clinical NLP?';
    const rewritten = await rewriter.rewrite(question, []);
    expect(rewritten).toBe(question);
  });

  it('should rewrite follow-up questions referencing past context', async () => {
    const history: Message[] = [
      {
        id: '1',
        tenantId: 't1',
        entityId: 'e1',
        conversationId: 'c1',
        senderRole: 'user',
        content: 'Tell me about the MedAssist clinical retrieval system',
        insufficientEvidence: false,
        metadata: {},
        createdAt: new Date(),
      },
      {
        id: '2',
        tenantId: 't1',
        entityId: 'e1',
        conversationId: 'c1',
        senderRole: 'assistant',
        content: 'MedAssist was designed by Sarah Chen to index 50,000 medical journals.',
        insufficientEvidence: false,
        metadata: {},
        createdAt: new Date(),
      },
    ];

    const followUp = 'What were the major challenges on that project?';
    const rewritten = await rewriter.rewrite(followUp, history);

    expect(rewritten).not.toBe(followUp);
    expect(rewritten.toLowerCase()).toContain('challenges');
  });
});

