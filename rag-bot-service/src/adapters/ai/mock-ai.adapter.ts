import { IAIAdapter, ChatMessage, GenerationResult } from './ai.interface.js';

export class MockAIAdapter implements IAIAdapter {
  private dimensions: number;

  constructor(dimensions = 1536) {
    this.dimensions = dimensions;
  }

  getEmbeddingDimensions(): number {
    return this.dimensions;
  }

  /**
   * Deterministic pseudo-embedding based on bag-of-words hashing.
   * Words are mapped into the vector dimension and normalized.
   * This yields genuine semantic similarity between documents sharing vocabulary.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const vector = new Array(this.dimensions).fill(0);
    const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 0);

    if (words.length === 0) {
      vector[0] = 1;
      return vector;
    }

    for (const word of words) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = (hash * 31 + word.charCodeAt(i)) >>> 0;
      }
      const index = hash % this.dimensions;
      vector[index] += 1;
    }

    // Normalize to unit length
    let norm = 0;
    for (let i = 0; i < this.dimensions; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dimensions; i++) {
        vector[i] = vector[i] / norm;
      }
    }

    return vector;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.generateEmbedding(t)));
  }

  async rewriteQuery(question: string, history: ChatMessage[]): Promise<string> {
    const lower = question.toLowerCase();
    const hasPronoun = /\b(that|this|it|his|her|their|challenges|accomplishments|experience)\b/.test(lower);

    if (hasPronoun && history.length > 0) {
      // Find the last user or assistant message to extract topic context
      for (let i = history.length - 1; i >= 0; i--) {
        const h = history[i];
        if (h.content && h.content.length > 5) {
          const keywords = h.content
            .split(/\W+/)
            .filter(w => w.length > 4 && !['about', 'which', 'there', 'their', 'could'].includes(w.toLowerCase()))
            .slice(0, 3)
            .join(' ');
          if (keywords) {
            return `${question} (context: ${keywords})`;
          }
        }
      }
    }
    return question;
  }

  async generateAnswer(params: {
    systemPrompt: string;
    messages: ChatMessage[];
    evidenceContext: string;
    temperature?: number;
  }): Promise<GenerationResult> {
    const { messages, evidenceContext } = params;
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || '';

    // If no evidence retrieved, return explicit insufficient evidence message
    if (!evidenceContext || evidenceContext.trim().length === 0) {
      return {
        text: 'Insufficient evidence: I do not have sufficient evidence in the uploaded documents to answer this question.',
        finishReason: 'stop',
      };
    }

    // Parse evidence chunks from the prompt context format:
    // [CHUNK chunkId (Document: docTitle)]
    // chunk text
    const chunkRegex = /\[CHUNK\s+([a-zA-Z0-9_-]+)\s*(?:\(Document:\s*([^)]+)\))?\]\s*\n([\s\S]*?)(?=\n\[CHUNK|\n*$)/g;
    const chunks: { id: string; docName?: string; text: string }[] = [];
    let match;

    while ((match = chunkRegex.exec(evidenceContext)) !== null) {
      chunks.push({
        id: match[1],
        docName: match[2]?.trim(),
        text: match[3]?.trim() || '',
      });
    }

    if (chunks.length === 0) {
      return {
        text: 'Insufficient evidence: I do not have sufficient evidence in the uploaded documents to answer this question.',
        finishReason: 'stop',
      };
    }

    // Check query terms against chunks, ignoring common stop words
    const stopWords = new Set(['what', 'which', 'there', 'their', 'could', 'about', 'from', 'with', 'that', 'this', 'corp', 'company', 'tell', 'show', 'give', 'does', 'have']);
    const queryTokens = lastUserMessage.toLowerCase().split(/\W+/).filter(t => t.length > 3 && !stopWords.has(t));
    const relevantChunks = chunks.filter(c => {
      const text = c.text.toLowerCase();
      return queryTokens.some(token => text.includes(token));
    });

    if (relevantChunks.length === 0 && queryTokens.length > 0) {
      return {
        text: 'Insufficient evidence: I do not have sufficient evidence in the uploaded documents to answer this question.',
        finishReason: 'stop',
      };
    }

    // Compose an evidence-grounded answer with citations
    const selected = relevantChunks.length > 0 ? relevantChunks.slice(0, 3) : chunks.slice(0, 2);
    const sentences = selected.map(c => {
      const firstLine = c.text.split('\n').filter(l => l.trim().length > 0)[0] || c.text.slice(0, 100);
      return `According to the records: "${firstLine.trim()}" [DOC-${c.id}]`;
    });

    const responseText = `Based on the provided portfolio documents:\n\n${sentences.join('\n\n')}`;

    return {
      text: responseText,
      finishReason: 'stop',
    };
  }
}
