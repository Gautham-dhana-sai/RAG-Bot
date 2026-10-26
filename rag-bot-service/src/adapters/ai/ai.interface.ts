export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerationResult {
  text: string;
  finishReason?: string;
}

export interface IAIAdapter {
  getEmbeddingDimensions(): number;
  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
  rewriteQuery(question: string, history: ChatMessage[]): Promise<string>;
  generateAnswer(params: {
    systemPrompt: string;
    messages: ChatMessage[];
    evidenceContext: string;
    temperature?: number;
  }): Promise<GenerationResult>;
}

