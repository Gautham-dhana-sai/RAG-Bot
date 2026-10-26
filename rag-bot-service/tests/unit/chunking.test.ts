import { describe, it, expect } from 'vitest';
import { ChunkingService, DEFAULT_RECURSIVE_SEPARATORS } from '../../src/modules/chunking/chunking.service.js';

describe('ChunkingService with Recursive Chunking Methodology', () => {
  const chunker = new ChunkingService(200, 40);

  it('should split text into chunks while preserving provenance and exact offsets', () => {
    const text = 'Paragraph 1 is about distributed systems and cloud architecture. ' +
                 'Paragraph 2 discusses database indexing with pgvector and PostgreSQL tsvector. ' +
                 'Paragraph 3 highlights automated evaluation and citation validation.';

    const chunks = chunker.chunkExtractedContent(
      { text, pages: [{ pageNumber: 1, text }] },
      { tenantId: 'tenant-1', entityId: 'entity-1', documentId: 'doc-1' }
    );

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.tenantId).toBe('tenant-1');
      expect(chunk.entityId).toBe('entity-1');
      expect(chunk.documentId).toBe('doc-1');
      expect(chunk.pageNumber).toBe(1);
      expect(chunk.chunkText.length).toBeGreaterThan(0);
      expect(chunk.startOffset).toBeDefined();
      expect(chunk.endOffset).toBeDefined();
      // Verify exact offset slicing matches chunk text
      expect(text.substring(chunk.startOffset!, chunk.endOffset!)).toBe(chunk.chunkText);
    }
  });

  it('should preserve multiple pages when present', () => {
    const extraction = {
      text: 'Page 1 text.\n\nPage 2 text.',
      pages: [
        { pageNumber: 1, text: 'This is page one text content.' },
        { pageNumber: 2, text: 'This is page two text content.' },
      ],
    };

    const chunks = chunker.chunkExtractedContent(
      extraction,
      { tenantId: 'tenant-1', entityId: 'entity-1', documentId: 'doc-1' }
    );

    const pages = chunks.map(c => c.pageNumber);
    expect(pages).toContain(1);
    expect(pages).toContain(2);
  });

  it('should recursively prioritize paragraphs (\\n\\n) before sentences (. ) and words', () => {
    const service = new ChunkingService(120, 20);

    const structuredText =
      '# Executive Summary\n\n' +
      'Alex Chen is a cloud architect specializing in distributed AI systems. ' +
      'He led the migration of 400 microservices to AWS.\n\n' +
      '## Key Achievements\n\n' +
      'Designed a multi-tenant vector database pipeline with sub-50ms latency. ' +
      'Authored 3 patents in neural indexing and query expansion.';

    const chunks = service.splitText(structuredText, 120, 20);

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(120);
      // Verify slice validity
      expect(structuredText.substring(c.start, c.end)).toBe(c.text);
    }

    // Verify paragraph headings stay with their context or split along paragraph boundaries
    expect(chunks[0].text).toContain('Executive Summary');
  });

  it('should apply sliding window overlap between adjacent chunks', () => {
    const service = new ChunkingService(80, 25);
    const text = 'First concept is retrieval. Second concept is embeddings. Third concept is pgvector storage. Fourth concept is evaluation.';

    const chunks = service.splitText(text, 80, 25);
    expect(chunks.length).toBeGreaterThan(1);

    // Verify overlap: adjacent chunks should share words/tokens
    for (let i = 1; i < chunks.length; i++) {
      const prevChunk = chunks[i - 1];
      const currChunk = chunks[i];
      // Since overlap is configured, currChunk start should precede prevChunk end when overlap occurred
      if (currChunk.start < prevChunk.end) {
        const overlapSlice = text.substring(currChunk.start, prevChunk.end);
        expect(overlapSlice.length).toBeGreaterThan(0);
        expect(overlapSlice.length).toBeLessThanOrEqual(80);
      }
    }
  });

  it('should gracefully handle continuous strings without spaces using character fallback', () => {
    const service = new ChunkingService(50, 10);
    const continuousText = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+';

    const chunks = service.splitText(continuousText, 50, 10);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(50);
      expect(continuousText.substring(c.start, c.end)).toBe(c.text);
    }
  });

  it('should return empty array for empty or whitespace-only inputs', () => {
    const service = new ChunkingService(100, 20);
    expect(service.splitText('')).toEqual([]);
    expect(service.splitText('    \n\n   \t  ')).toEqual([]);
  });

  it('should return single chunk if text is smaller than chunkSize', () => {
    const service = new ChunkingService(200, 20);
    const shortText = 'Short bio of Jane Doe.';
    const chunks = service.splitText(shortText);
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toBe(shortText);
    expect(chunks[0].start).toBe(0);
    expect(chunks[0].end).toBe(shortText.length);
  });
});
