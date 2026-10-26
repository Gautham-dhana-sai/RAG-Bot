import {
  Tenant,
  User,
  TenantMembership,
  Entity,
  EntityMembership,
  Document,
  DocumentVersion,
  DocumentChunk,
  IngestionJob,
  IngestionJobDocument,
  Conversation,
  Message,
  AnswerCitation,
  ScoredChunk,
} from '../../types/index.js';

export interface IDatabaseAdapter {
  init(): Promise<void>;
  close(): Promise<void>;

  // Tenants
  getTenantById(id: string): Promise<Tenant | null>;
  createTenant(data: { id?: string; name: string; slug: string }): Promise<Tenant>;

  // Users & Memberships
  getUserById(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  createUser(data: { id?: string; email: string; name: string; passwordHash?: string; salt?: string; isSuperadmin?: boolean }): Promise<User>;
  getTenantMembership(tenantId: string, userId: string): Promise<TenantMembership | null>;
  getUserTenantMembership(userId: string): Promise<TenantMembership | null>;
  createTenantMembership(tenantId: string, userId: string, role: 'owner' | 'admin' | 'member' | 'viewer'): Promise<TenantMembership>;

  // Entities
  getEntityById(tenantId: string, entityId: string): Promise<Entity | null>;
  getEntityByPortfolioUrl(portfolioUrl: string): Promise<Entity | null>;
  getEntityByReference(tenantId: string, reference: string): Promise<Entity | null>;
  getEntitiesByTenant(tenantId: string): Promise<Entity[]>;
  createEntity(data: { id?: string; tenantId: string; name: string; slug: string; description?: string; portfolioUrl?: string; isPublic?: boolean }): Promise<Entity>;
  deleteEntity(tenantId: string, entityId: string): Promise<boolean>;
  getEntityMembership(tenantId: string, entityId: string, userId: string): Promise<EntityMembership | null>;

  // Documents
  getDocumentById(tenantId: string, entityId: string, documentId: string): Promise<Document | null>;
  getDocumentByHash(entityId: string, contentHash: string): Promise<Document | null>;
  getDocumentsByEntity(tenantId: string, entityId: string): Promise<Document[]>;
  getDocumentCountByEntity(tenantId: string, entityId: string): Promise<number>;
  createDocument(data: {
    id?: string;
    tenantId: string;
    entityId: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    contentHash: string;
    objectKey: string;
    isPublic?: boolean;
    status?: Document['status'];
  }): Promise<Document>;
  updateDocumentStatus(tenantId: string, documentId: string, status: Document['status'], errorMessage?: string): Promise<void>;
  deleteDocument(tenantId: string, entityId: string, documentId: string): Promise<boolean>;

  // Document Versions
  createDocumentVersion(data: {
    tenantId: string;
    entityId: string;
    documentId: string;
    versionNumber: number;
    contentHash: string;
    objectKey: string;
    sizeBytes: number;
    processingVersion?: string;
  }): Promise<DocumentVersion>;

  // Ingestion Jobs
  getJobById(tenantId: string, entityId: string, jobId: string): Promise<IngestionJob | null>;
  createIngestionJob(data: { id?: string; tenantId: string; entityId: string; totalDocuments: number }): Promise<IngestionJob>;
  updateJobStatus(tenantId: string, jobId: string, status: IngestionJob['status'], details?: { processed?: number; failed?: number; errorSummary?: string }): Promise<void>;
  createJobDocument(tenantId: string, jobId: string, documentId: string): Promise<IngestionJobDocument>;
  updateJobDocumentStatus(tenantId: string, jobId: string, documentId: string, status: Document['status'], errorMessage?: string): Promise<void>;
  getJobDocuments(tenantId: string, jobId: string): Promise<(IngestionJobDocument & { document?: Document })[]>;

  // Chunks & Hybrid Search
  hasPlaceholderChunks?(tenantId: string, documentId: string): Promise<boolean>;
  insertChunks(chunks: Array<Omit<DocumentChunk, 'id' | 'createdAt'>>): Promise<DocumentChunk[]>;
  deleteChunksByDocument(tenantId: string, documentId: string): Promise<void>;
  searchChunks(params: {
    tenantId: string;
    entityId: string;
    query: string;
    queryEmbedding?: number[];
    topK?: number;
    minScore?: number;
    rrfK?: number;
    isPublicOnly?: boolean;
    mode?: 'hybrid' | 'dense' | 'sparse';
  }): Promise<ScoredChunk[]>;
  getChunksByIds(tenantId: string, chunkIds: string[]): Promise<DocumentChunk[]>;

  // Conversations & Messages
  getConversationById(tenantId: string, entityId: string, conversationId: string): Promise<Conversation | null>;
  getConversationsByEntity?(tenantId: string, entityId: string): Promise<Conversation[]>;
  createConversation(data: {
    id?: string;
    tenantId: string;
    entityId: string;
    userId?: string;
    sessionToken?: string;
    title?: string;
    isPublic?: boolean;
  }): Promise<Conversation>;
  getRecentMessages(tenantId: string, conversationId: string, limit?: number): Promise<Message[]>;
  createMessage(data: {
    id?: string;
    tenantId: string;
    entityId: string;
    conversationId: string;
    senderRole: 'user' | 'assistant' | 'system';
    content: string;
    rewrittenQuery?: string;
    insufficientEvidence?: boolean;
    confidenceScore?: number;
    metadata?: Record<string, any>;
  }): Promise<Message>;

  // Citations
  createCitations(citations: Array<Omit<AnswerCitation, 'id' | 'createdAt'>>): Promise<AnswerCitation[]>;
  getCitationsByMessage(messageId: string): Promise<AnswerCitation[]>;
}

