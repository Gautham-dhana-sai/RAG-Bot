import { IAIAdapter, ChatMessage } from '../../adapters/ai/ai.interface.js';
import { Message } from '../../types/index.js';

export class QueryRewriter {
  constructor(private ai: IAIAdapter) {}

  async rewrite(question: string, history: Message[]): Promise<string> {
    if (history.length === 0) return question;

    const chatHistory: ChatMessage[] = history.map(m => ({
      role: m.senderRole === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

    return this.ai.rewriteQuery(question, chatHistory);
  }
}

