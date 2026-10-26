import { describe, it, expect } from 'vitest';
import { ExtractionService } from '../../src/modules/extraction/extraction.service.js';

describe('ExtractionService', () => {
  const extractor = new ExtractionService();

  it('should extract plain text from text/plain buffers', async () => {
    const content = 'Hello PersonaRAG! Senior Software Engineer resume.';
    const buffer = Buffer.from(content, 'utf-8');

    const result = await extractor.extractText(buffer, 'text/plain', 'resume.txt');
    expect(result.text).toBe(content);
    expect(result.pages?.length).toBe(1);
  });

  it('should extract markdown content', async () => {
    const md = '# Sarah Chen\n\n- Role: Applied AI Lead\n- Skills: RAG, PostgreSQL';
    const buffer = Buffer.from(md, 'utf-8');

    const result = await extractor.extractText(buffer, 'text/markdown', 'portfolio.md');
    expect(result.text).toContain('Applied AI Lead');
  });

  it('should handle images gracefully with OCR adapter', async () => {
    const fakeImage = Buffer.from('fake image binary bytes');
    const result = await extractor.extractText(fakeImage, 'image/png', 'scan.png');
    expect(result.text).toBeDefined();
    expect(result.metadata?.ocrEngine).toBe('default-stub');
  });
});

