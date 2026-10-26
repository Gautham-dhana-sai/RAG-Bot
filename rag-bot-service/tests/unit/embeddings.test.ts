import { describe, it, expect } from 'vitest';
import { MockAIAdapter } from '../../src/adapters/ai/mock-ai.adapter.js';
import { cosineSimilarity } from '../../src/shared/utils.js';

describe('Embeddings and MockAIAdapter', () => {
  const adapter = new MockAIAdapter(384);

  it('should generate unit-normalized embeddings of configured dimension', async () => {
    const text = 'Distributed database systems and pgvector retrieval';
    const vec = await adapter.generateEmbedding(text);

    expect(vec.length).toBe(384);

    let norm = 0;
    for (const v of vec) norm += v * v;
    expect(Math.abs(Math.sqrt(norm) - 1.0)).toBeLessThan(0.01);
  });

  it('should produce higher cosine similarity for semantically related texts', async () => {
    const v1 = await adapter.generateEmbedding('distributed database with pgvector indexing');
    const v2 = await adapter.generateEmbedding('database systems pgvector indexing performance');
    const v3 = await adapter.generateEmbedding('gardening organic tomatoes strawberry plants');

    const simRelated = cosineSimilarity(v1, v2);
    const simUnrelated = cosineSimilarity(v1, v3);

    expect(simRelated).toBeGreaterThan(simUnrelated);
  });
});

