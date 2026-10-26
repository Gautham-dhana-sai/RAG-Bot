import { IAIAdapter, ChatMessage, GenerationResult } from './ai.interface.js';
import { logger } from '../../shared/logger.js';
import { AppError } from '../../shared/errors.js';

export class CohereAIAdapter implements IAIAdapter {
  private apiKey: string;
  private chatModel: string;
  private embeddingModel: string;
  private dimensions: number;

  constructor(options: {
    apiKey: string;
    chatModel?: string;
    embeddingModel?: string;
    dimensions?: number;
  }) {
    if (!options.apiKey) {
      throw new Error('CohereAIAdapter requires a valid apiKey.');
    }
    this.apiKey = options.apiKey;
    this.chatModel = options.chatModel || 'command-r-plus-08-2024';
    this.embeddingModel = options.embeddingModel || 'embed-english-v3.0';
    this.dimensions = options.dimensions || 1024;
  }

  getEmbeddingDimensions(): number {
    return this.dimensions;
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const res = await this.generateEmbeddings([text]);
    return res[0];
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    try {
      logger.info(`[Cohere] Requesting embeddings for ${texts.length} text chunk(s) (model: ${this.embeddingModel})...`);
      const response = await fetch('https://api.cohere.com/v2/embed', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.embeddingModel,
          texts,
          input_type: 'search_document',
          embedding_types: ['float'],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new AppError(`Cohere Embedding error (${response.status}): ${errorText}`, 502);
      }

      const json = (await response.json()) as { embeddings: { float: number[][] } };
      logger.info(`[Cohere] Successfully generated embeddings for ${json.embeddings.float.length} chunk(s).`);
      return json.embeddings.float;
    } catch (err: any) {
      logger.error('Cohere generateEmbeddings failed:', err);
      throw err;
    }
  }

  async rewriteQuery(question: string, history: ChatMessage[]): Promise<string> {
    if (history.length === 0) return question;

    const messages = [
      {
        role: 'system',
        content: `You are an expert retrieval assistant. Given a conversation history and a follow-up question, rewrite the question into a clear, standalone search query that preserves all critical context, entities, and intent. If the question is already standalone, return it unchanged. Output ONLY the rewritten search query with no conversational preamble.`,
      },
      ...history.slice(-4).map(m => ({
        role: m.role,
        content: m.content,
      })),
      {
        role: 'user',
        content: `Follow-up question to rewrite: "${question}"`,
      },
    ];

    try {
      const response = await fetch('https://api.cohere.com/v2/chat', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.chatModel,
          messages,
          temperature: 0.0,
        }),
      });

      if (!response.ok) {
        logger.warn('Failed to rewrite query with Cohere, falling back to original question');
        return question;
      }

      const json = (await response.json()) as any;
      const rewritten = json?.message?.content?.[0]?.text?.trim() || question;
      return rewritten.replace(/^"|"$/g, '');
    } catch (err) {
      logger.warn('Cohere rewriteQuery failed, using original question:', err);
      return question;
    }
  }

  async generateAnswer(params: {
    systemPrompt: string;
    messages: ChatMessage[];
    evidenceContext: string;
    temperature?: number;
  }): Promise<GenerationResult> {
    const { systemPrompt, messages, evidenceContext, temperature = 0.2 } = params;

    const augmentedSystemPrompt = `${systemPrompt}

Evidence context:
${evidenceContext}

Instructions: Answer strictly based on the evidence provided above. If the evidence is insufficient, say so clearly.`;

    const cohereMessages = [
      { role: 'system', content: augmentedSystemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content })),
    ];

    try {
      const response = await fetch('https://api.cohere.com/v2/chat', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.chatModel,
          messages: cohereMessages,
          temperature,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new AppError(`Cohere Generation error (${response.status}): ${errorText}`, 502);
      }

      const json = (await response.json()) as any;
      const text = json?.message?.content?.[0]?.text || '';
      return {
        text,
        finishReason: json?.finish_reason || 'complete',
      };
    } catch (err: any) {
      logger.error('Cohere generateAnswer failed:', err);
      throw err;
    }
  }
}

