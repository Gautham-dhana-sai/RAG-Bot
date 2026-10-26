import { IDatabaseAdapter } from './database.interface.js';
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
import { cosineSimilarity, generateUuid } from '../../shared/utils.js';

export class MemoryDatabaseAdapter implements IDatabaseAdapter {
  private tenants: Map<string, Tenant> = new Map();
  private users: Map<string, User> = new Map();
  private tenantMemberships: Map<string, TenantMembership> = new Map();
  private entities: Map<string, Entity> = new Map();
  private entityMemberships: Map<string, EntityMembership> = new Map();
  private documents: Map<string, Document> = new Map();
  private documentVersions: Map<string, DocumentVersion> = new Map();
  private chunks: Map<string, DocumentChunk> = new Map();
  private ingestionJobs: Map<string, IngestionJob> = new Map();
  private jobDocuments: Map<string, IngestionJobDocument> = new Map();
  private conversations: Map<string, Conversation> = new Map();
  private messages: Map<string, Message> = new Map();
  private citations: Map<string, AnswerCitation> = new Map();

  async init(): Promise<void> {}
  async close(): Promise<void> {}

  // Tenants
  async getTenantById(id: string): Promise<Tenant | null> {
    return this.tenants.get(id) || null;
  }

  async createTenant(data: { id?: string; name: string; slug: string }): Promise<Tenant> {
    const tenant: Tenant = {
      id: data.id || generateUuid(),
      name: data.name,
      slug: data.slug,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.tenants.set(tenant.id, tenant);
    return tenant;
  }

  // Users & Memberships
  async getUserById(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) return user;
    }
    return null;
  }

  async createUser(data: { id?: string; email: string; name: string; passwordHash?: string; salt?: string; isSuperadmin?: boolean }): Promise<User> {
    const user: User = {
      id: data.id || generateUuid(),
      email: data.email,
      name: data.name,
      passwordHash: data.passwordHash,
      salt: data.salt,
      isSuperadmin: !!data.isSuperadmin,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(user.id, user);
    return user;
  }

  async getTenantMembership(tenantId: string, userId: string): Promise<TenantMembership | null> {
    for (const mem of this.tenantMemberships.values()) {
      if (mem.tenantId === tenantId && mem.userId === userId) return mem;
    }
    return null;
  }

  async getUserTenantMembership(userId: string): Promise<TenantMembership | null> {
    for (const mem of this.tenantMemberships.values()) {
      if (mem.userId === userId) return mem;
    }
    return null;
  }

  async createTenantMembership(tenantId: string, userId: string, role: 'owner' | 'admin' | 'member' | 'viewer'): Promise<TenantMembership> {
    const mem: TenantMembership = {
      id: generateUuid(),
      tenantId,
      userId,
      role,
      createdAt: new Date(),
    };
    this.tenantMemberships.set(mem.id, mem);
    return mem;
  }

  // Entities
  async getEntityById(tenantId: string, entityId: string): Promise<Entity | null> {
    const entity = this.entities.get(entityId);
    if (!entity || entity.tenantId !== tenantId) return null;
    return entity;
  }

  async getEntityByPortfolioUrl(portfolioUrl: string): Promise<Entity | null> {
    for (const entity of this.entities.values()) {
      if (entity.portfolioUrl && entity.portfolioUrl.toLowerCase() === portfolioUrl.toLowerCase()) {
        return entity;
      }
    }
    return null;
  }

  async getEntityByReference(tenantId: string, reference: string): Promise<Entity | null> {
    const refLower = reference.toLowerCase();
    for (const entity of this.entities.values()) {
      if (entity.tenantId === tenantId) {
        if (
          entity.id === reference ||
          entity.slug.toLowerCase() === refLower ||
          (entity.portfolioUrl && entity.portfolioUrl.toLowerCase() === refLower)
        ) {
          return entity;
        }
      }
    }
    return null;
  }

  async getEntitiesByTenant(tenantId: string): Promise<Entity[]> {
    return Array.from(this.entities.values()).filter(e => e.tenantId === tenantId);
  }

  async createEntity(data: { id?: string; tenantId: string; name: string; slug: string; description?: string; portfolioUrl?: string; isPublic?: boolean }): Promise<Entity> {
    const entity: Entity = {
      id: data.id || generateUuid(),
      tenantId: data.tenantId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      portfolioUrl: data.portfolioUrl,
      isPublic: data.isPublic ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.entities.set(entity.id, entity);
    return entity;
  }

  async deleteEntity(tenantId: string, entityId: string): Promise<boolean> {
    const entity = this.entities.get(entityId);
    if (!entity || entity.tenantId !== tenantId) return false;

    this.entities.delete(entityId);

    // Cascade delete documents & chunks
    for (const [docId, doc] of this.documents.entries()) {
      if (doc.tenantId === tenantId && doc.entityId === entityId) {
        this.documents.delete(docId);
        await this.deleteChunksByDocument(tenantId, docId);
      }
    }

    // Cascade delete ingestion jobs
    for (const [jobId, job] of this.ingestionJobs.entries()) {
      if (job.tenantId === tenantId && job.entityId === entityId) {
        this.ingestionJobs.delete(jobId);
        for (const [jdocId, jdoc] of this.jobDocuments.entries()) {
          if (jdoc.jobId === jobId) {
            this.jobDocuments.delete(jdocId);
          }
        }
      }
    }

    // Cascade delete conversations
    for (const [convId, conv] of this.conversations.entries()) {
      if (conv.tenantId === tenantId && conv.entityId === entityId) {
        this.conversations.delete(convId);
        for (const [msgId, msg] of this.messages.entries()) {
          if (msg.conversationId === convId) {
            this.messages.delete(msgId);
          }
        }
      }
    }

    // Cascade delete entity memberships
    for (const [memId, mem] of this.entityMemberships.entries()) {
      if (mem.tenantId === tenantId && mem.entityId === entityId) {
        this.entityMemberships.delete(memId);
      }
    }

    return true;
  }

  async getEntityMembership(tenantId: string, entityId: string, userId: string): Promise<EntityMembership | null> {
    for (const mem of this.entityMemberships.values()) {
      if (mem.tenantId === tenantId && mem.entityId === entityId && mem.userId === userId) {
        return mem;
      }
    }
    return null;
  }

  // Documents
  async getDocumentById(tenantId: string, entityId: string, documentId: string): Promise<Document | null> {
    const doc = this.documents.get(documentId);
    if (!doc || doc.tenantId !== tenantId || doc.entityId !== entityId) return null;
    return doc;
  }

  async getDocumentByHash(entityId: string, contentHash: string): Promise<Document | null> {
    for (const doc of this.documents.values()) {
      if (doc.entityId === entityId && doc.contentHash === contentHash) {
        return doc;
      }
    }
    return null;
  }

  async getDocumentsByEntity(tenantId: string, entityId: string): Promise<Document[]> {
    return Array.from(this.documents.values()).filter(
      doc => doc.tenantId === tenantId && doc.entityId === entityId
    );
  }

  async getDocumentCountByEntity(tenantId: string, entityId: string): Promise<number> {
    let count = 0;
    for (const doc of this.documents.values()) {
      if (doc.tenantId === tenantId && doc.entityId === entityId) {
        count++;
      }
    }
    return count;
  }

  async createDocument(data: {
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
  }): Promise<Document> {
    const doc: Document = {
      id: data.id || generateUuid(),
      tenantId: data.tenantId,
      entityId: data.entityId,
      originalFilename: data.originalFilename,
      mimeType: data.mimeType,
      sizeBytes: data.sizeBytes,
      contentHash: data.contentHash,
      objectKey: data.objectKey,
      isPublic: data.isPublic ?? false,
      status: data.status || 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.documents.set(doc.id, doc);
    return doc;
  }

  async updateDocumentStatus(tenantId: string, documentId: string, status: Document['status'], errorMessage?: string): Promise<void> {
    const doc = this.documents.get(documentId);
    if (doc && doc.tenantId === tenantId) {
      doc.status = status;
      doc.errorMessage = errorMessage;
      doc.updatedAt = new Date();
    }
  }

  async deleteDocument(tenantId: string, entityId: string, documentId: string): Promise<boolean> {
    const doc = this.documents.get(documentId);
    if (!doc || doc.tenantId !== tenantId || doc.entityId !== entityId) return false;
    this.documents.delete(documentId);
    await this.deleteChunksByDocument(tenantId, documentId);
    return true;
  }

  // Document Versions
  async createDocumentVersion(data: {
    tenantId: string;
    entityId: string;
    documentId: string;
    versionNumber: number;
    contentHash: string;
    objectKey: string;
    sizeBytes: number;
    processingVersion?: string;
  }): Promise<DocumentVersion> {
    const version: DocumentVersion = {
      id: generateUuid(),
      tenantId: data.tenantId,
      entityId: data.entityId,
      documentId: data.documentId,
      versionNumber: data.versionNumber,
      contentHash: data.contentHash,
      objectKey: data.objectKey,
      sizeBytes: data.sizeBytes,
      processingVersion: data.processingVersion || 'v1',
      createdAt: new Date(),
    };
    this.documentVersions.set(version.id, version);
    return version;
  }

  // Ingestion Jobs
  async getJobById(tenantId: string, entityId: string, jobId: string): Promise<IngestionJob | null> {
    const job = this.ingestionJobs.get(jobId);
    if (!job || job.tenantId !== tenantId || job.entityId !== entityId) return null;
    return job;
  }

  async createIngestionJob(data: { id?: string; tenantId: string; entityId: string; totalDocuments: number }): Promise<IngestionJob> {
    const job: IngestionJob = {
      id: data.id || generateUuid(),
      tenantId: data.tenantId,
      entityId: data.entityId,
      status: 'PENDING',
      totalDocuments: data.totalDocuments,
      processedDocuments: 0,
      failedDocuments: 0,
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.ingestionJobs.set(job.id, job);
    return job;
  }

  async updateJobStatus(tenantId: string, jobId: string, status: IngestionJob['status'], details?: { processed?: number; failed?: number; errorSummary?: string }): Promise<void> {
    const job = this.ingestionJobs.get(jobId);
    if (job && job.tenantId === tenantId) {
      job.status = status;
      if (details?.processed !== undefined) job.processedDocuments = details.processed;
      if (details?.failed !== undefined) job.failedDocuments = details.failed;
      if (details?.errorSummary !== undefined) job.errorSummary = details.errorSummary;
      job.updatedAt = new Date();
    }
  }

  async createJobDocument(tenantId: string, jobId: string, documentId: string): Promise<IngestionJobDocument> {
    const jobDoc: IngestionJobDocument = {
      id: generateUuid(),
      tenantId,
      jobId,
      documentId,
      status: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.jobDocuments.set(jobDoc.id, jobDoc);
    return jobDoc;
  }

  async updateJobDocumentStatus(tenantId: string, jobId: string, documentId: string, status: Document['status'], errorMessage?: string): Promise<void> {
    for (const jd of this.jobDocuments.values()) {
      if (jd.tenantId === tenantId && jd.jobId === jobId && jd.documentId === documentId) {
        jd.status = status;
        jd.errorMessage = errorMessage;
        jd.updatedAt = new Date();
      }
    }
  }

  async getJobDocuments(tenantId: string, jobId: string): Promise<(IngestionJobDocument & { document?: Document })[]> {
    const results: (IngestionJobDocument & { document?: Document })[] = [];
    for (const jd of this.jobDocuments.values()) {
      if (jd.tenantId === tenantId && jd.jobId === jobId) {
        const doc = this.documents.get(jd.documentId);
        results.push({ ...jd, document: doc });
      }
    }
    return results;
  }

  // Chunks & Hybrid Search
  async insertChunks(chunks: Array<Omit<DocumentChunk, 'id' | 'createdAt'>>): Promise<DocumentChunk[]> {
    const inserted: DocumentChunk[] = [];
    for (const item of chunks) {
      const chunk: DocumentChunk = {
        ...item,
        id: generateUuid(),
        createdAt: new Date(),
      };
      this.chunks.set(chunk.id, chunk);
      inserted.push(chunk);
    }
    return inserted;
  }

  async deleteChunksByDocument(tenantId: string, documentId: string): Promise<void> {
    for (const [id, chunk] of this.chunks.entries()) {
      if (chunk.tenantId === tenantId && chunk.documentId === documentId) {
        this.chunks.delete(id);
      }
    }
  }

  async hasPlaceholderChunks(tenantId: string, documentId: string): Promise<boolean> {
    for (const chunk of this.chunks.values()) {
      if (
        chunk.tenantId === tenantId &&
        chunk.documentId === documentId &&
        (chunk.chunkText.includes('[Image document OCR text extracted') ||
          chunk.chunkText.includes('[Scanned Image Document:'))
      ) {
        return true;
      }
    }
    return false;
  }

  async getChunksByIds(tenantId: string, chunkIds: string[]): Promise<DocumentChunk[]> {
    const res: DocumentChunk[] = [];
    for (const id of chunkIds) {
      const c = this.chunks.get(id);
      if (c && c.tenantId === tenantId) {
        res.push(c);
      }
    }
    return res;
  }

  async searchChunks(params: {
    tenantId: string;
    entityId: string;
    query: string;
    queryEmbedding?: number[];
    topK?: number;
    minScore?: number;
    rrfK?: number;
    isPublicOnly?: boolean;
    mode?: 'hybrid' | 'dense' | 'sparse';
  }): Promise<ScoredChunk[]> {
    const { tenantId, entityId, query, queryEmbedding, topK = 10, minScore = 0.005, rrfK = 60, isPublicOnly = false, mode = 'hybrid' } = params;

    // Filter candidate chunks strictly by tenant and entity
    const candidates: DocumentChunk[] = [];
    for (const chunk of this.chunks.values()) {
      if (chunk.tenantId !== tenantId || chunk.entityId !== entityId) continue;
      const doc = this.documents.get(chunk.documentId);
      if (!doc) continue;
      if (isPublicOnly && !doc.isPublic) continue;
      candidates.push(chunk);
    }

    if (candidates.length === 0) return [];

    // Dense scoring (cosine similarity)
    const denseScores: { chunk: DocumentChunk; score: number }[] = [];
    if (queryEmbedding && queryEmbedding.length > 0) {
      for (const chunk of candidates) {
        const score = chunk.embedding ? cosineSimilarity(queryEmbedding, chunk.embedding) : 0;
        denseScores.push({ chunk, score });
      }
      denseScores.sort((a, b) => b.score - a.score);
    }

    // Sparse scoring (keyword overlap / lexical)
    const queryTokens = query.toLowerCase().split(/\W+/).filter(t => t.length > 2);
    const sparseScores: { chunk: DocumentChunk; score: number }[] = [];
    for (const chunk of candidates) {
      const text = chunk.chunkText.toLowerCase();
      let matchCount = 0;
      for (const token of queryTokens) {
        if (text.includes(token)) matchCount++;
      }
      const score = queryTokens.length > 0 ? matchCount / queryTokens.length : 0;
      sparseScores.push({ chunk, score });
    }
    sparseScores.sort((a, b) => b.score - a.score);

    // Map ranks for RRF
    const denseRankMap = new Map<string, number>();
    denseScores.forEach((item, index) => {
      denseRankMap.set(item.chunk.id, index + 1);
    });

    const sparseRankMap = new Map<string, number>();
    sparseScores.forEach((item, index) => {
      sparseRankMap.set(item.chunk.id, index + 1);
    });

    // Compute score based on selected retrieval mode
    const finalScored: ScoredChunk[] = [];
    for (const chunk of candidates) {
      const denseRank = denseRankMap.get(chunk.id);
      const sparseRank = sparseRankMap.get(chunk.id);

      let finalScore = 0;
      if (mode === 'dense') {
        if (denseRank !== undefined) {
          finalScore = 1 / (rrfK + denseRank);
        }
      } else if (mode === 'sparse') {
        if (sparseRank !== undefined) {
          finalScore = 1 / (rrfK + sparseRank);
        }
      } else {
        // hybrid RRF
        if (denseRank !== undefined) {
          finalScore += 1 / (rrfK + denseRank);
        }
        if (sparseRank !== undefined) {
          finalScore += 1 / (rrfK + sparseRank);
        }
      }

      if (finalScore >= minScore) {
        const doc = this.documents.get(chunk.documentId)!;
        finalScored.push({
          chunk,
          document: doc,
          score: finalScore,
          denseRank,
          sparseRank,
        });
      }
    }

    finalScored.sort((a, b) => b.score - a.score);
    return finalScored.slice(0, topK);
  }

  async getConversationsByEntity(tenantId: string, entityId: string): Promise<Conversation[]> {
    return Array.from(this.conversations.values()).filter(
      c => c.tenantId === tenantId && c.entityId === entityId
    );
  }

  // Conversations & Messages
  async getConversationById(tenantId: string, entityId: string, conversationId: string): Promise<Conversation | null> {
    const conv = this.conversations.get(conversationId);
    if (!conv || conv.tenantId !== tenantId || conv.entityId !== entityId) return null;
    return conv;
  }

  async createConversation(data: {
    id?: string;
    tenantId: string;
    entityId: string;
    userId?: string;
    sessionToken?: string;
    title?: string;
    isPublic?: boolean;
  }): Promise<Conversation> {
    const conv: Conversation = {
      id: data.id || generateUuid(),
      tenantId: data.tenantId,
      entityId: data.entityId,
      userId: data.userId,
      sessionToken: data.sessionToken,
      title: data.title || 'New Conversation',
      isPublic: data.isPublic ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.conversations.set(conv.id, conv);
    return conv;
  }

  async getRecentMessages(tenantId: string, conversationId: string, limit = 10): Promise<Message[]> {
    const list: Message[] = [];
    for (const msg of this.messages.values()) {
      if (msg.tenantId === tenantId && msg.conversationId === conversationId) {
        list.push(msg);
      }
    }
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    return list.slice(-limit);
  }

  async createMessage(data: {
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
  }): Promise<Message> {
    const msg: Message = {
      id: data.id || generateUuid(),
      tenantId: data.tenantId,
      entityId: data.entityId,
      conversationId: data.conversationId,
      senderRole: data.senderRole,
      content: data.content,
      rewrittenQuery: data.rewrittenQuery,
      insufficientEvidence: data.insufficientEvidence ?? false,
      confidenceScore: data.confidenceScore,
      metadata: data.metadata || {},
      createdAt: new Date(),
    };
    this.messages.set(msg.id, msg);
    return msg;
  }

  // Citations
  async createCitations(citations: Array<Omit<AnswerCitation, 'id' | 'createdAt'>>): Promise<AnswerCitation[]> {
    const res: AnswerCitation[] = [];
    for (const c of citations) {
      const item: AnswerCitation = {
        ...c,
        id: generateUuid(),
        createdAt: new Date(),
      };
      this.citations.set(item.id, item);
      res.push(item);
    }
    return res;
  }

  async getCitationsByMessage(messageId: string): Promise<AnswerCitation[]> {
    const list: AnswerCitation[] = [];
    for (const c of this.citations.values()) {
      if (c.messageId === messageId) {
        list.push(c);
      }
    }
    return list;
  }
}
