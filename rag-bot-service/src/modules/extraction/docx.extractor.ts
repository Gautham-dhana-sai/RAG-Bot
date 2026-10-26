import mammoth from 'mammoth';
import { ExtractionResult } from './text.extractor.js';
import { logger } from '../../shared/logger.js';

export class DocxExtractor {
  async extract(buffer: Buffer): Promise<ExtractionResult> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      const text = (result.value || '').trim();

      return {
        text,
        pages: [{ pageNumber: 1, text }],
        metadata: {
          warnings: result.messages,
        },
      };
    } catch (err: any) {
      logger.error('Failed to parse DOCX document:', err);
      throw new Error(`DOCX extraction failed: ${err.message}`);
    }
  }
}

