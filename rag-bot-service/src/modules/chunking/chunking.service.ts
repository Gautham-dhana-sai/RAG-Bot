import { ExtractionResult } from '../extraction/text.extractor.js';
import { DocumentChunk } from '../../types/index.js';

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
  separators?: string[];
}

export interface TextSpan {
  text: string;
  start: number;
  end: number;
}

/**
 * Standard hierarchical separators for recursive chunking:
 * 1. Double newlines (paragraphs, markdown blocks)
 * 2. Single newlines (lines, list items)
 * 3. Sentence boundaries (. ? !)
 * 4. Clause boundaries (; ,)
 * 5. Word boundaries (spaces)
 * 6. Character-level fallback
 */
export const DEFAULT_RECURSIVE_SEPARATORS: string[] = [
  '\n\n',
  '\n',
  '. ',
  '? ',
  '! ',
  '; ',
  ', ',
  ' ',
  '',
];

export class ChunkingService {
  private defaultChunkSize: number;
  private defaultChunkOverlap: number;
  private defaultSeparators: string[];

  constructor(
    chunkSize = 1000,
    chunkOverlap = 200,
    separators: string[] = DEFAULT_RECURSIVE_SEPARATORS
  ) {
    this.defaultChunkSize = chunkSize;
    this.defaultChunkOverlap = chunkOverlap;
    this.defaultSeparators = separators;
  }

  /**
   * Main entrypoint: chunks extracted content (page-by-page or full document),
   * preserving exact page number and character offset provenance.
   */
  chunkExtractedContent(
    extraction: ExtractionResult,
    docInfo: { tenantId: string; entityId: string; documentId: string; versionId?: string },
    options?: ChunkOptions
  ): Array<Omit<DocumentChunk, 'id' | 'createdAt'>> {
    const chunkSize = options?.chunkSize || this.defaultChunkSize;
    const chunkOverlap = options?.chunkOverlap || this.defaultChunkOverlap;
    const separators = options?.separators || this.defaultSeparators;

    const chunks: Array<Omit<DocumentChunk, 'id' | 'createdAt'>> = [];
    let globalIndex = 0;

    // If per-page text is available, chunk page by page to preserve exact page provenance
    if (extraction.pages && extraction.pages.length > 0) {
      for (const page of extraction.pages) {
        const pageChunks = this.splitText(page.text, chunkSize, chunkOverlap, separators);
        for (const c of pageChunks) {
          chunks.push({
            tenantId: docInfo.tenantId,
            entityId: docInfo.entityId,
            documentId: docInfo.documentId,
            versionId: docInfo.versionId,
            chunkIndex: globalIndex++,
            chunkText: c.text,
            pageNumber: page.pageNumber,
            startOffset: c.start,
            endOffset: c.end,
            metadata: {
              ...(extraction.metadata || {}),
              pageNumber: page.pageNumber,
            },
          });
        }
      }
    } else {
      const allChunks = this.splitText(extraction.text, chunkSize, chunkOverlap, separators);
      for (const c of allChunks) {
        chunks.push({
          tenantId: docInfo.tenantId,
          entityId: docInfo.entityId,
          documentId: docInfo.documentId,
          versionId: docInfo.versionId,
          chunkIndex: globalIndex++,
          chunkText: c.text,
          pageNumber: 1,
          startOffset: c.start,
          endOffset: c.end,
          metadata: extraction.metadata || {},
        });
      }
    }

    return chunks;
  }

  /**
   * Recursive chunking methodology:
   * 1. Recursively splits text into atomic semantic pieces using hierarchical separators
   *    (paragraphs -> lines -> sentences -> clauses -> words -> characters).
   * 2. Merges adjacent pieces into chunks of up to chunkSize with chunkOverlap.
   */
  splitText(
    text: string,
    chunkSize: number = this.defaultChunkSize,
    chunkOverlap: number = this.defaultChunkOverlap,
    separators: string[] = this.defaultSeparators
  ): { text: string; start: number; end: number }[] {
    const cleanText = text || '';
    if (cleanText.trim().length === 0) {
      return [];
    }

    // Fast path: if entire text fits in a single chunk
    if (cleanText.length <= chunkSize) {
      const raw = cleanText;
      const leadingSpaces = raw.length - raw.trimStart().length;
      const trailingSpaces = raw.length - raw.trimEnd().length;
      return [
        {
          text: raw.trim(),
          start: leadingSpaces,
          end: raw.length - trailingSpaces,
        },
      ];
    }

    // Step 1: Recursively split into atomic leaf pieces <= chunkSize
    const rootSpan: TextSpan = {
      text: cleanText,
      start: 0,
      end: cleanText.length,
    };

    const leafSpans = this.recursiveSplit(cleanText, rootSpan, separators, chunkSize);

    // Discard spans containing only whitespace
    const validSpans = leafSpans.filter(
      s => cleanText.substring(s.start, s.end).trim().length > 0
    );

    if (validSpans.length === 0) {
      return [];
    }

    // Step 2: Merge leaf pieces up to chunkSize with chunkOverlap
    return this.mergeSpans(cleanText, validSpans, chunkSize, chunkOverlap);
  }

  /**
   * Recursively split a TextSpan using the highest-priority separator that matches.
   * If any piece exceeds chunkSize, it is recursively broken down with subsequent separators.
   */
  private recursiveSplit(
    fullText: string,
    span: TextSpan,
    separators: string[],
    chunkSize: number
  ): TextSpan[] {
    const spanLen = span.end - span.start;
    if (spanLen <= chunkSize) {
      return [span];
    }

    // Find the first separator present in this span
    let selectedSepIndex = -1;
    for (let i = 0; i < separators.length; i++) {
      const sep = separators[i];
      if (sep === '') {
        selectedSepIndex = i;
        break;
      }
      const idx = fullText.indexOf(sep, span.start);
      if (idx !== -1 && idx + sep.length <= span.end) {
        selectedSepIndex = i;
        break;
      }
    }

    // Fallback: character-level slicing
    if (selectedSepIndex === -1 || separators[selectedSepIndex] === '') {
      const charChunks: TextSpan[] = [];
      for (let cursor = span.start; cursor < span.end; cursor += chunkSize) {
        const end = Math.min(cursor + chunkSize, span.end);
        charChunks.push({
          text: fullText.substring(cursor, end),
          start: cursor,
          end,
        });
      }
      return charChunks;
    }

    const sep = separators[selectedSepIndex];
    const nextSeparators = separators.slice(selectedSepIndex + 1);

    // Split span on occurrences of sep
    const subSpans: TextSpan[] = [];
    let cursor = span.start;

    while (cursor < span.end) {
      const nextIdx = fullText.indexOf(sep, cursor);
      if (nextIdx === -1 || nextIdx >= span.end) {
        subSpans.push({
          text: fullText.substring(cursor, span.end),
          start: cursor,
          end: span.end,
        });
        break;
      }

      const splitEnd = nextIdx + sep.length;
      if (splitEnd > cursor) {
        subSpans.push({
          text: fullText.substring(cursor, splitEnd),
          start: cursor,
          end: splitEnd,
        });
        cursor = splitEnd;
      } else {
        cursor++;
      }
    }

    // Recursively decompose pieces that are still larger than chunkSize
    const result: TextSpan[] = [];
    for (const sub of subSpans) {
      if (sub.end - sub.start > chunkSize) {
        const finer = this.recursiveSplit(fullText, sub, nextSeparators, chunkSize);
        result.push(...finer);
      } else {
        result.push(sub);
      }
    }

    return result;
  }

  /**
   * Merge leaf spans into chunks up to chunkSize, applying chunkOverlap between adjacent chunks.
   */
  private mergeSpans(
    fullText: string,
    spans: TextSpan[],
    chunkSize: number,
    chunkOverlap: number
  ): { text: string; start: number; end: number }[] {
    const chunks: { text: string; start: number; end: number }[] = [];
    let currentGroup: TextSpan[] = [];

    const emitGroup = (group: TextSpan[]) => {
      if (group.length === 0) return;
      const rawStart = group[0].start;
      const rawEnd = group[group.length - 1].end;
      const rawText = fullText.substring(rawStart, rawEnd);

      const leadingSpaces = rawText.length - rawText.trimStart().length;
      const trailingSpaces = rawText.length - rawText.trimEnd().length;

      const trimmedText = rawText.trim();
      if (trimmedText.length > 0) {
        chunks.push({
          text: trimmedText,
          start: rawStart + leadingSpaces,
          end: rawEnd - trailingSpaces,
        });
      }
    };

    for (const span of spans) {
      if (currentGroup.length === 0) {
        currentGroup.push(span);
        continue;
      }

      const combinedLength = span.end - currentGroup[0].start;

      if (combinedLength <= chunkSize) {
        currentGroup.push(span);
      } else {
        emitGroup(currentGroup);

        // Compute overlapping spans from the tail of currentGroup
        // Ensure forward progress by excluding currentGroup[0]
        const retained: TextSpan[] = [];
        let overlapLen = 0;

        for (let i = currentGroup.length - 1; i >= 1; i--) {
          const candidate = currentGroup[i];
          const candidateLen = candidate.end - candidate.start;
          const newOverlap = overlapLen + candidateLen;

          if (newOverlap <= chunkOverlap && span.end - candidate.start <= chunkSize) {
            retained.unshift(candidate);
            overlapLen = newOverlap;
          } else {
            break;
          }
        }

        currentGroup = [...retained, span];
      }
    }

    if (currentGroup.length > 0) {
      emitGroup(currentGroup);
    }

    return chunks;
  }
}
