import { IDatabaseAdapter } from '../../adapters/database/database.interface.js';
import { EmbeddingsService } from '../embeddings/embeddings.service.js';
import { ScoredChunk } from '../../types/index.js';
import { logger } from '../../shared/logger.js';

export class RetrievalService {
  constructor(
    private db: IDatabaseAdapter,
    private embeddingsService: EmbeddingsService,
    private topK = 10,
    private rrfK = 60,
    private minScore = 0.005
  ) {}

  async retrieveRelevantChunks(params: {
    tenantId: string;
    entityId: string;
    query: string;
    isPublicOnly?: boolean;
    topK?: number;
    mode?: 'hybrid' | 'dense' | 'sparse';
    minScore?: number;
  }): Promise<ScoredChunk[]> {
    const {
      tenantId,
      entityId,
      query,
      isPublicOnly = false,
      topK = this.topK,
      mode = 'hybrid',
      minScore = this.minScore,
    } = params;

    logger.debug(`Retrieving chunks (mode=${mode}, topK=${topK}) for query "${query}" in tenant=${tenantId}, entity=${entityId}`);

    // Generate query embedding if needed (for hybrid or dense)
    let queryEmbedding: number[] | undefined;
    if (mode !== 'sparse') {
      try {
        queryEmbedding = await this.embeddingsService.generateEmbedding(query);
      } catch (err) {
        logger.warn('Failed to generate query embedding, proceeding with sparse only:', err);
      }
    }

    // Execute search strictly filtered by tenant and entity
    const scoredChunks = await this.db.searchChunks({
      tenantId,
      entityId,
      query,
      queryEmbedding,
      topK,
      rrfK: this.rrfK,
      minScore,
      isPublicOnly,
      mode,
    });

    return scoredChunks;
  }
}

