import { IDatabaseAdapter } from '../../adapters/database/database.interface.js';
import { Conversation, Message } from '../../types/index.js';
import { NotFoundError } from '../../shared/errors.js';

export class ConversationsService {
  constructor(private db: IDatabaseAdapter) {}

  async createConversation(data: {
    tenantId: string;
    entityId: string;
    userId?: string;
    sessionToken?: string;
    title?: string;
    isPublic?: boolean;
  }): Promise<Conversation> {
    return this.db.createConversation(data);
  }

  async getConversation(tenantId: string, entityId: string, conversationId: string): Promise<Conversation> {
    const conv = await this.db.getConversationById(tenantId, entityId, conversationId);
    if (!conv) {
      throw new NotFoundError('Conversation', conversationId);
    }
    return conv;
  }

  async listConversations(tenantId: string, entityId: string): Promise<Conversation[]> {
    if (this.db.getConversationsByEntity) {
      return this.db.getConversationsByEntity(tenantId, entityId);
    }
    return [];
  }

  async getRecentMessages(tenantId: string, conversationId: string, limit = 10): Promise<Message[]> {
    return this.db.getRecentMessages(tenantId, conversationId, limit);
  }

  async saveMessage(data: {
    tenantId: string;
    entityId: string;
    conversationId: string;
    senderRole: 'user' | 'assistant' | 'system';
    content: string;
    rewrittenQuery?: string;
    insufficientEvidence?: boolean;
    confidenceScore?: number;
    metadata?: Record<string, any>;
  }): Promise<Message> {
    return this.db.createMessage(data);
  }
}

