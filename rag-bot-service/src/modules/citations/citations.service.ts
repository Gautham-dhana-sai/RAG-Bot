import { IDatabaseAdapter } from '../../adapters/database/database.interface.js';
import { AnswerCitation, ScoredChunk } from '../../types/index.js';
import { logger } from '../../shared/logger.js';

export class CitationsService {
  constructor(private db: IDatabaseAdapter) {}

  /**
   * Extract citations from answer text, strictly validate against authorized retrieved chunks,
   * and persist verified citations.
   */
  async processAndPersistCitations(params: {
    tenantId: string;
    entityId: string;
    messageId: string;
    answerText: string;
    authorizedChunks: ScoredChunk[];
  }): Promise<{ sanitizedAnswer: string; verifiedCitations: AnswerCitation[] }> {
    const { tenantId, entityId, messageId, answerText, authorizedChunks } = params;

    // Map authorized chunks by ID
    const authorizedMap = new Map<string, ScoredChunk>();
    for (const sc of authorizedChunks) {
      authorizedMap.set(sc.chunk.id, sc);
    }

    // Match citations like [DOC-uuid], [DOC-1, DOC-2], or DOC-uuid
    const citationRegex = /\bDOC-([a-zA-Z0-9_-]+)\b/gi;
    const foundChunkIds = new Set<string>();
    let match;

    while ((match = citationRegex.exec(answerText)) !== null) {
      foundChunkIds.add(match[1]);
    }

    const verifiedToSave: Array<Omit<AnswerCitation, 'id' | 'createdAt'>> = [];
    const invalidChunkIds = new Set<string>();

    for (const chunkId of foundChunkIds) {
      const authorized = authorizedMap.get(chunkId);
      if (authorized) {
        // Snippet from chunk text
        const snippet =
          authorized.chunk.chunkText.length > 500
            ? authorized.chunk.chunkText.substring(0, 500) + '...'
            : authorized.chunk.chunkText;

        verifiedToSave.push({
          tenantId,
          entityId,
          messageId,
          chunkId: authorized.chunk.id,
          documentId: authorized.document.id,
          snippet,
          pageNumber: authorized.chunk.pageNumber,
          score: authorized.score,
          documentTitle: authorized.document.originalFilename,
        });
      } else {
        logger.warn(`Rejected unauthorized/hallucinated citation ID: ${chunkId}`);
        invalidChunkIds.add(chunkId);
      }
    }

    // Sanitize answer by removing invalid citation tags
    let sanitizedAnswer = answerText;
    for (const invalidId of invalidChunkIds) {
      const reg = new RegExp(`\\[DOC-${invalidId}\\]`, 'g');
      sanitizedAnswer = sanitizedAnswer.replace(reg, '');
    }

    let savedCitations: AnswerCitation[] = [];
    if (verifiedToSave.length > 0) {
      savedCitations = await this.db.createCitations(verifiedToSave);
    }

    return {
      sanitizedAnswer: sanitizedAnswer.trim(),
      verifiedCitations: savedCitations,
    };
  }

  async getCitationsForMessage(messageId: string): Promise<AnswerCitation[]> {
    return this.db.getCitationsByMessage(messageId);
  }
}
