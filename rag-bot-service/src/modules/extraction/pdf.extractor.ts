import { createRequire } from 'module';
import { ExtractionResult, ExtractedPage } from './text.extractor.js';
import { logger } from '../../shared/logger.js';

let pdfParser: any = null;
function getPdfParser() {
  if (!pdfParser) {
    try {
      if (typeof require !== 'undefined') {
        pdfParser = require('pdf-parse');
      } else {
        const req = createRequire(import.meta?.url || 'file://' + process.cwd() + '/index.js');
        pdfParser = req('pdf-parse');
      }
    } catch {
      const req = createRequire('file://' + process.cwd() + '/index.js');
      pdfParser = req('pdf-parse');
    }
  }
  return pdfParser;
}

export class PdfExtractor {
  async extract(buffer: Buffer): Promise<ExtractionResult> {
    try {
      const pdf = getPdfParser();
      const data = await pdf(buffer);
      const fullText = (data.text || '').trim();

      // Estimate per-page boundaries if available or treat as single document
      const pages: ExtractedPage[] = [];
      const numPages = data.numpages || 1;

      // Split roughly by page markers or form feeds
      const parts = fullText.split(/\f|\n{4,}/);
      if (parts.length > 1) {
        parts.forEach((p: string, idx: number) => {
          if (p.trim().length > 0) {
            pages.push({ pageNumber: idx + 1, text: p.trim() });
          }
        });
      } else {
        pages.push({ pageNumber: 1, text: fullText });
      }

      return {
        text: fullText,
        pages: pages.length > 0 ? pages : [{ pageNumber: 1, text: fullText }],
        metadata: {
          totalPages: numPages,
          info: data.info,
        },
      };
    } catch (err: any) {
      logger.error('Failed to parse PDF document:', err);
      throw new Error(`PDF extraction failed: ${err.message}`);
    }
  }
}
