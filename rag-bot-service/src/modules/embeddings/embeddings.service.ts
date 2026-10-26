import { IAIAdapter } from '../../adapters/ai/ai.interface.js';
import { DocumentChunk } from '../../types/index.js';
import { logger } from '../../shared/logger.js';

export class EmbeddingsService {
  constructor(private ai: IAIAdapter) {}

  getDimensions(): number {
    return this.ai.getEmbeddingDimensions();
  }

  async generateEmbedding(text: string): Promise<number[]> {
    return this.ai.generateEmbedding(text);
  }

  async attachEmbeddings(
    chunks: Array<Omit<DocumentChunk, 'id' | 'createdAt'>>,
    batchSize = 25
  ): Promise<Array<Omit<DocumentChunk, 'id' | 'createdAt'>>> {
    if (chunks.length === 0) return [];

    logger.info(`Generating embeddings for ${chunks.length} chunks...`);

    const result = [...chunks];
    for (let i = 0; i < result.length; i += batchSize) {
      const slice = result.slice(i, i + batchSize);
      const texts = slice.map(c => c.chunkText);
      const vectors = await this.ai.generateEmbeddings(texts);

      for (let j = 0; j < slice.length; j++) {
        slice[j].embedding = vectors[j];
      }
    }

    return result;
  }
}

