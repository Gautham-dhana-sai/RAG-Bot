import { IAIAdapter, ChatMessage, GenerationResult } from './ai.interface.js';
import { CohereAIAdapter } from './cohere-ai.adapter.js';
import { logger } from '../../shared/logger.js';
import { AppError } from '../../shared/errors.js';
import { env } from '../../config/env.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class OpenAIAIAdapter implements IAIAdapter {
  private apiKey: string;
  private baseUrl: string;
  private chatModel: string;
  private embeddingModel: string;
  private dimensions: number;

  constructor(options: {
    apiKey: string;
    baseUrl?: string;
    chatModel?: string;
    embeddingModel?: string;
    dimensions?: number;
  }) {
    this.baseUrl = (options.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    let key = options.apiKey;

    // Detect if Google Gemini endpoint is used with an OpenAI sk- key, and auto-correct to Gemini API key
    if (this.baseUrl.includes('googleapis.com') && (!key || key.startsWith('sk-'))) {
      logger.warn('[OpenAIAIAdapter] Detected Google Gemini endpoint with an OpenAI sk- key or missing key. Switching to GEMINI_API_KEY.');
      key = env.GEMINI_API_KEY || '';
    }

    if (!key) {
      key = env.GEMINI_API_KEY || env.OPENAI_API_KEY || '';
    }

    this.apiKey = key;
    let model = options.chatModel || (this.baseUrl.includes('googleapis.com') ? 'gemini-3.8-flash' : 'gpt-4o-mini');
    if (model === 'gemini-2.5-flash') {
      logger.info('[OpenAIAIAdapter] gemini-2.5-flash is no longer available to new users in Google API. Automatically using gemini-3.6-flash.');
      model = 'gemini-3.6-flash';
    }
    this.chatModel = model;
    this.embeddingModel = options.embeddingModel || (this.baseUrl.includes('googleapis.com') ? 'gemini-embedding-001' : 'text-embedding-3-small');
    this.dimensions = options.dimensions || (this.baseUrl.includes('googleapis.com') ? 3072 : 1536);
  }

  getEmbeddingDimensions(): number {
    return this.dimensions;
  }

  /**
   * Models for Google Gemini round-robin evaluation:
   * flash 2.5, 3.6, and 3.8 in that exact order as specified.
   */
  private readonly flashRoundRobinModels = [
    { name: 'gemini-2.5-flash', alias: 'gemini-3.6-flash' },
    { name: 'gemini-3.6-flash', alias: 'gemini-3.6-flash' },
    { name: 'gemini-3.8-flash', alias: 'gemini-3.8-flash' },
  ];

  async generateEmbedding(text: string): Promise<number[]> {
    const res = await this.generateEmbeddings([text]);
    return res[0];
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const fallbackKey = env.COHERE_API_KEY || '';
    const maxRetries = 5;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model: this.embeddingModel,
            input: texts,
          }),
        });

        if (response.ok) {
          const json = (await response.json()) as { data: { embedding: number[] }[] };
          return json.data.map(d => d.embedding);
        }

        const errorText = await response.text();

        // Check if retryable (503 high demand, 429 rate limit, 500, 502, 504)
        const isRetryable =
          response.status === 503 ||
          response.status === 429 ||
          response.status === 500 ||
          response.status === 502 ||
          response.status === 504 ||
          errorText.includes('high demand') ||
          errorText.includes('UNAVAILABLE') ||
          errorText.includes('temporary');

        if (isRetryable && attempt < maxRetries) {
          const delayMs = attempt * 800;
          logger.warn(`[OpenAIAIAdapter] Embedding API high demand / temporary error (${response.status}). Retrying attempt ${attempt}/${maxRetries} in ${delayMs}ms...`);
          await sleep(delayMs);
          continue;
        }

        // Quota exhausted or all retries completed -> fallback to Cohere
        if (fallbackKey) {
          logger.warn(`[AI Fallback] Primary embedding error (${response.status}: ${errorText.slice(0, 100)}). Falling back to verified Cohere free embeddings.`);
          const cohere = new CohereAIAdapter({ apiKey: fallbackKey });
          return await cohere.generateEmbeddings(texts);
        }

        throw new AppError(`OpenAI Embedding error (${response.status}): ${errorText}`, 502);
      } catch (err: any) {
        if (err instanceof AppError) throw err;
        logger.warn(`[OpenAIAIAdapter] Network error during embedding attempt ${attempt}/${maxRetries}: ${err.message}`);
        if (attempt < maxRetries) {
          await sleep(attempt * 800);
          continue;
        }
        if (fallbackKey) {
          logger.warn('[AI Fallback] Network failed on primary embeddings. Falling back to Cohere embeddings.');
          const cohere = new CohereAIAdapter({ apiKey: fallbackKey });
          return await cohere.generateEmbeddings(texts);
        }
        throw err;
      }
    }

    throw new AppError('Embedding generation failed after all retries.', 502);
  }

  async rewriteQuery(question: string, history: ChatMessage[]): Promise<string> {
    if (history.length === 0) return question;

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are an expert retrieval assistant. Given a conversation history and a follow-up question, rewrite the question into a clear, standalone search query that preserves all critical context, entities, and intent. If the question is already standalone, return it unchanged. Output ONLY the rewritten search query with no conversational preamble.`,
      },
      ...history.slice(-4),
      {
        role: 'user',
        content: `Follow-up question to rewrite: "${question}"`,
      },
    ];

    const isGoogle = this.baseUrl.includes('googleapis.com');
    const modelsToTry = isGoogle
      ? ['gemini-3.6-flash', 'gemini-3.8-flash', 'gemini-flash-latest']
      : [this.chatModel, 'gpt-4o-mini', 'gpt-3.5-turbo'];

    for (const model of modelsToTry) {
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.0,
            max_tokens: 150,
          }),
        });

        if (response.ok) {
          const data = (await response.json()) as any;
          const rewritten = data.choices?.[0]?.message?.content?.trim();
          return rewritten || question;
        }
      } catch {
        // try next model in order
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
    const fullSystemPrompt = `${params.systemPrompt}\n\nEVIDENCE CONTEXT:\n${params.evidenceContext}`;

    const apiMessages: ChatMessage[] = [
      { role: 'system', content: fullSystemPrompt },
      ...params.messages,
    ];

    const fallbackKey = env.COHERE_API_KEY || '';
    const isGoogle = this.baseUrl.includes('googleapis.com');

    // Round-robin model sequence: flash 2.5, 3.6, and 3.8 in order for 5 retry rounds
    const roundRobinModels = isGoogle
      ? [
          { name: 'gemini-2.5-flash', alt: 'gemini-3.6-flash' },
          { name: 'gemini-3.6-flash', alt: 'gemini-3.8-flash' },
          { name: 'gemini-3.8-flash', alt: 'gemini-3.6-flash' },
        ]
      : [
          { name: this.chatModel, alt: 'gpt-4o-mini' },
          { name: 'gpt-4o-mini', alt: 'gpt-3.5-turbo' },
          { name: 'gpt-3.5-turbo', alt: 'gpt-4o-mini' },
        ];

    const maxRounds = 5;
    let lastError: Error | null = null;

    for (let round = 1; round <= maxRounds; round++) {
      for (let i = 0; i < roundRobinModels.length; i++) {
        const { name: model, alt: altModel } = roundRobinModels[i];

        try {
          logger.info(`[OpenAIAIAdapter] [Round-Robin ${round}/${maxRounds}] Evaluating model: "${model}"...`);
          let response = await fetch(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify({
              model,
              messages: apiMessages,
              temperature: params.temperature ?? 0.1,
              max_tokens: 2048,
            }),
          });

          // Check if model 404 or deprecated/unavailable
          let errorText = '';
          if (!response.ok) {
            errorText = await response.text();
          }

          const isUnavailable =
            response.status === 404 ||
            (errorText && (errorText.includes('no longer available') || errorText.includes('not found') || errorText.includes('unsupported')));

          if (isUnavailable && altModel && altModel !== model) {
            logger.info(`[OpenAIAIAdapter] Model "${model}" unavailable (${errorText.slice(0, 90)}), automatically trying active alternate "${altModel}"...`);
            response = await fetch(`${this.baseUrl}/chat/completions`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.apiKey}`,
              },
              body: JSON.stringify({
                model: altModel,
                messages: apiMessages,
                temperature: params.temperature ?? 0.1,
                max_tokens: 2048,
              }),
            });
            if (!response.ok) {
              errorText = await response.text();
            }
          }

          if (response.ok) {
            const data = (await response.json()) as any;
            const text = data.choices?.[0]?.message?.content || '';
            const finishReason = data.choices?.[0]?.finish_reason || 'stop';
            logger.info(`[OpenAIAIAdapter] [Round-Robin ${round}/${maxRounds}] Successfully received grounded answer from "${model}"`);
            return { text, finishReason };
          }

          if (!errorText && !response.ok) {
            errorText = await response.text();
          }
          logger.warn(`[OpenAIAIAdapter] [Round-Robin ${round}/${maxRounds}] Model "${model}" returned HTTP ${response.status}: ${errorText.slice(0, 140)}. Proceeding in round-robin order...`);

          // If quota exhausted or credit empty, immediately invoke Cohere fallback
          if (
            (response.status === 402 || errorText.includes('insufficient_quota') || errorText.includes('credit_balance_exhausted')) &&
            fallbackKey
          ) {
            logger.warn(`[AI Fallback] Quota exhausted on primary provider. Falling back to Cohere command-r-plus.`);
            const cohere = new CohereAIAdapter({ apiKey: fallbackKey });
            return await cohere.generateAnswer(params);
          }

          lastError = new AppError(`Chat completion error (${response.status}): ${errorText}`, 502);

          // Brief delay before querying the next model in the round-robin sequence
          await sleep(350);
        } catch (fetchErr: any) {
          logger.warn(`[OpenAIAIAdapter] Network error querying model "${model}": ${fetchErr.message}. Rotating...`);
          lastError = fetchErr;
          await sleep(350);
        }
      }

      // If round finished without response, backoff briefly before starting next cycle
      if (round < maxRounds) {
        const cycleDelay = round * 600;
        logger.info(`[OpenAIAIAdapter] Completed round-robin cycle ${round}/${maxRounds}. Pausing ${cycleDelay}ms before next cycle...`);
        await sleep(cycleDelay);
      }
    }

    // If all 5 round-robin retry cycles across flash 2.5, 3.6, and 3.8 are exhausted, fallback to Cohere
    if (fallbackKey) {
      logger.warn('[AI Fallback] All 5 round-robin retry cycles across flash 2.5, 3.6, and 3.8 exhausted. Falling back to verified Cohere command-r-plus.');
      try {
        const cohere = new CohereAIAdapter({ apiKey: fallbackKey });
        return await cohere.generateAnswer(params);
      } catch (cohereErr: any) {
        logger.error('[AI Fallback] Cohere fallback also failed:', cohereErr);
      }
    }

    throw lastError || new AppError('Unable to generate answer after 5 round-robin retries across flash 2.5, 3.6, and 3.8.', 502);
  }
}

