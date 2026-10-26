export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractionResult {
  text: string;
  pages?: ExtractedPage[];
  metadata?: Record<string, any>;
}

export class TextExtractor {
  async extract(buffer: Buffer): Promise<ExtractionResult> {
    const text = buffer.toString('utf-8').trim();
    return {
      text,
      pages: [{ pageNumber: 1, text }],
    };
  }
}

