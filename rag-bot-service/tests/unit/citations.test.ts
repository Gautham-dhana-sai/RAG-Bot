import { describe, it, expect } from 'vitest';
import { CitationsService } from '../../src/modules/citations/citations.service.js';
import { MemoryDatabaseAdapter } from '../../src/adapters/database/memory.adapter.js';
import { ScoredChunk } from '../../src/types/index.js';

describe('CitationsService', () => {
  const db = new MemoryDatabaseAdapter();
  const service = new CitationsService(db);

  it('should accept authorized citations and reject hallucinated/unauthorized chunk IDs', async () => {
    const authorizedChunk: ScoredChunk = {
      chunk: {
        id: 'chunk-valid-123',
        tenantId: 'tenant-1',
        entityId: 'entity-1',
        documentId: 'doc-1',
        chunkIndex: 0,
        chunkText: 'Alex Rivera built the distributed RAG system in 2023.',
        pageNumber: 1,
        metadata: {},
        createdAt: new Date(),
      },
      document: {
        id: 'doc-1',
        tenantId: 'tenant-1',
        entityId: 'entity-1',
        originalFilename: 'resume.txt',
        mimeType: 'text/plain',
        sizeBytes: 100,
        contentHash: 'hash',
        objectKey: 'key',
        isPublic: true,
        status: 'READY',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      score: 0.95,
    };

    const answerWithCitations =
      'Alex Rivera built the distributed RAG system [DOC-chunk-valid-123]. ' +
      'He also invented quantum teleportation [DOC-fake-hallucinated-999].';

    const result = await service.processAndPersistCitations({
      tenantId: 'tenant-1',
      entityId: 'entity-1',
      messageId: 'msg-1',
      answerText: answerWithCitations,
      authorizedChunks: [authorizedChunk],
    });

    // Valid citation must be preserved and persisted
    expect(result.verifiedCitations.length).toBe(1);
    expect(result.verifiedCitations[0].chunkId).toBe('chunk-valid-123');
    expect(result.verifiedCitations[0].documentId).toBe('doc-1');

    // Hallucinated citation tag should be stripped from output answer
    expect(result.sanitizedAnswer).toContain('[DOC-chunk-valid-123]');
    expect(result.sanitizedAnswer).not.toContain('[DOC-fake-hallucinated-999]');
  });
});

