export interface RankedItem<T> {
  item: T;
  rank: number;
  score?: number;
}

export function reciprocalRankFusion<T extends { id: string }>(
  denseRankings: RankedItem<T>[],
  sparseRankings: RankedItem<T>[],
  k = 60
): { item: T; rrfScore: number; denseRank?: number; sparseRank?: number }[] {
  const itemMap = new Map<string, T>();
  const denseRankMap = new Map<string, number>();
  const sparseRankMap = new Map<string, number>();

  for (const entry of denseRankings) {
    itemMap.set(entry.item.id, entry.item);
    denseRankMap.set(entry.item.id, entry.rank);
  }

  for (const entry of sparseRankings) {
    itemMap.set(entry.item.id, entry.item);
    sparseRankMap.set(entry.item.id, entry.rank);
  }

  const fused: { item: T; rrfScore: number; denseRank?: number; sparseRank?: number }[] = [];

  for (const [id, item] of itemMap.entries()) {
    const denseRank = denseRankMap.get(id);
    const sparseRank = sparseRankMap.get(id);

    let score = 0;
    if (denseRank !== undefined) {
      score += 1 / (k + denseRank);
    }
    if (sparseRank !== undefined) {
      score += 1 / (k + sparseRank);
    }

    fused.push({
      item,
      rrfScore: score,
      denseRank,
      sparseRank,
    });
  }

  fused.sort((a, b) => b.rrfScore - a.rrfScore);
  return fused;
}

