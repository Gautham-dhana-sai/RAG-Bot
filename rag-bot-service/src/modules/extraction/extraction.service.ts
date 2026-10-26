import { TextExtractor, ExtractionResult } from './text.extractor.js';
import { PdfExtractor } from './pdf.extractor.js';
import { DocxExtractor } from './docx.extractor.js';
import { OcrExtractor } from './ocr.extractor.js';
import { BadRequestError } from '../../shared/errors.js';

export class ExtractionService {
  private textExtractor = new TextExtractor();
  private pdfExtractor = new PdfExtractor();
  private docxExtractor = new DocxExtractor();
  private ocrExtractor = new OcrExtractor();

  async extractText(buffer: Buffer, mimeType: string, filename: string): Promise<ExtractionResult> {
    const ext = filename.split('.').pop()?.toLowerCase() || '';

    if (
      mimeType === 'text/plain' ||
      mimeType === 'text/markdown' ||
      mimeType === 'application/json' ||
      ['txt', 'md', 'markdown', 'json', 'csv'].includes(ext)
    ) {
      return this.textExtractor.extract(buffer);
    }

    if (mimeType === 'application/pdf' || ext === 'pdf') {
      return this.pdfExtractor.extract(buffer);
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      ext === 'docx'
    ) {
      return this.docxExtractor.extract(buffer);
    }

    if (
      mimeType.startsWith('image/') ||
      ['png', 'jpg', 'jpeg', 'webp', 'tiff'].includes(ext)
    ) {
      return this.ocrExtractor.extract(buffer, mimeType);
    }

    // Attempt text decode for unknown text-like files, otherwise error
    try {
      return await this.textExtractor.extract(buffer);
    } catch {
      throw new BadRequestError(`Unsupported document format: ${mimeType || ext}`);
    }
  }
}

