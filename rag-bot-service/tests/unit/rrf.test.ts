import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion } from '../../src/modules/retrieval/rrf.js';

describe('Reciprocal Rank Fusion (RRF)', () => {
  it('should fuse dense and sparse ranks correctly', () => {
    const denseRankings = [
      { item: { id: 'chunk-1' }, rank: 1 },
      { item: { id: 'chunk-2' }, rank: 2 },
      { item: { id: 'chunk-3' }, rank: 3 },
    ];

    const sparseRankings = [
      { item: { id: 'chunk-2' }, rank: 1 },
      { item: { id: 'chunk-1' }, rank: 2 },
      { item: { id: 'chunk-4' }, rank: 3 },
    ];

    const fused = reciprocalRankFusion(denseRankings, sparseRankings, 60);

    // chunk-1: 1/(60+1) + 1/(60+2) = 1/61 + 1/62 = 0.01639 + 0.01612 = 0.03251
    // chunk-2: 1/(60+2) + 1/(60+1) = 0.03251
    // Both chunks appear in both dense and sparse, so they should rank highest
    expect(fused[0].rrfScore).toBeGreaterThan(fused[2].rrfScore);
    expect(['chunk-1', 'chunk-2']).toContain(fused[0].item.id);
  });
});

