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
  CrawlJob,
  CrawlPage,
  CrawlConfig,
  AnalyticsEvent,
  AITokenLog,
  AnalyticsFilterParams,
  PortalAnalyticsOverview,
  SourceAnalyticsData,
  ProcessingPerformanceData,
  AITokenConsumptionData,
  ChatUsageData,
  SourceActivityData,
  FailureAnalyticsData,
  FailureCategory,
  SourceCategory,
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
  private crawlJobs: Map<string, CrawlJob> = new Map();
  private crawlPages: Map<string, CrawlPage> = new Map();
  private analyticsEvents: Map<string, AnalyticsEvent> = new Map();
  private aiTokenLogs: Map<string, AITokenLog> = new Map();

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
    const clean = email.trim().toLowerCase();
    for (const user of this.users.values()) {
      if (user.email.toLowerCase() === clean || (user.username && user.username.toLowerCase() === clean)) {
        return user;
      }
    }
    return null;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    const clean = username.trim().toLowerCase();
    for (const user of this.users.values()) {
      if (user.username && user.username.toLowerCase() === clean) return user;
    }
    return null;
  }

  async getUserByIdentifier(identifier: string): Promise<User | null> {
    const clean = identifier.trim().toLowerCase();
    for (const user of this.users.values()) {
      if (user.email.toLowerCase() === clean || (user.username && user.username.toLowerCase() === clean)) {
        return user;
      }
    }
    return null;
  }

  async createUser(data: { id?: string; email: string; name: string; username?: string; passwordHash?: string; salt?: string; isSuperadmin?: boolean }): Promise<User> {
    const user: User = {
      id: data.id || generateUuid(),
      email: data.email,
      name: data.name,
      username: data.username?.trim().toLowerCase(),
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
    const target = portfolioUrl.toLowerCase();
    for (const entity of this.entities.values()) {
      if (
        (entity.portfolioUrl && entity.portfolioUrl.toLowerCase() === target) ||
        (entity.portalUrl && entity.portalUrl.toLowerCase() === target)
      ) {
        return entity;
      }
    }
    return null;
  }

  async getEntityByPortalUrl(portalUrl: string): Promise<Entity | null> {
    return this.getEntityByPortfolioUrl(portalUrl);
  }

  async getEntityByReference(tenantId: string, reference: string): Promise<Entity | null> {
    const refLower = reference.toLowerCase();
    for (const entity of this.entities.values()) {
      if (entity.tenantId === tenantId) {
        if (
          entity.id === reference ||
          entity.slug.toLowerCase() === refLower ||
          (entity.portfolioUrl && entity.portfolioUrl.toLowerCase() === refLower) ||
          (entity.portalUrl && entity.portalUrl.toLowerCase() === refLower)
        ) {
          return entity;
        }
      }
    }
    return null;
  }

  async getPublicEntityByReference(reference: string): Promise<Entity | null> {
    const refLower = reference.toLowerCase();
    for (const entity of this.entities.values()) {
      if (entity.isPublic) {
        if (
          entity.id === reference ||
          entity.slug.toLowerCase() === refLower ||
          (entity.portfolioUrl && entity.portfolioUrl.toLowerCase() === refLower) ||
          (entity.portalUrl && entity.portalUrl.toLowerCase() === refLower)
        ) {
          return entity;
        }
      }
    }
    return null;
  }

  async getEntitiesByTenant(tenantId: string): Promise<Entity[]> {
    return Array.from(this.entities.values())
      .filter(e => e.tenantId === tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async createEntity(data: { id?: string; tenantId: string; name: string; slug: string; description?: string; portalUrl?: string; portfolioUrl?: string; isPublic?: boolean }): Promise<Entity> {
    const url = data.portalUrl || data.portfolioUrl;
    const entity: Entity = {
      id: data.id || generateUuid(),
      tenantId: data.tenantId,
      name: data.name,
      slug: data.slug,
      description: data.description,
      portalUrl: url,
      portfolioUrl: url,
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

  async getDocumentByObjectKey(objectKey: string): Promise<Document | null> {
    for (const doc of this.documents.values()) {
      if (doc.objectKey === objectKey) {
        return doc;
      }
    }
    return null;
  }

  async getDocumentsByEntity(tenantId: string, entityId: string): Promise<Document[]> {
    const docs = Array.from(this.documents.values()).filter(
      doc => doc.tenantId === tenantId && doc.entityId === entityId
    );
    return docs.map(d => {
      const jd = Array.from(this.jobDocuments.values())
        .filter(j => j.documentId === d.id && j.tenantId === tenantId)
        .pop();
      const job = jd ? this.ingestionJobs.get(jd.jobId) : undefined;
      return {
        ...d,
        sourceUrl: jd?.sourceUrl || d.sourceUrl,
        stage: jd?.stage || d.stage,
        sourceType: d.sourceType || job?.sourceType || (jd?.sourceUrl ? 'URL_IMPORT' : 'DIRECT_UPLOAD'),
      };
    });
  }

  async getDocumentCountByEntity(tenantId: string, entityId: string): Promise<number> {
    let directCount = 0;
    let hasCrawlDoc = false;
    for (const doc of this.documents.values()) {
      if (doc.tenantId === tenantId && doc.entityId === entityId) {
        if (doc.sourceType !== 'WEBSITE_CRAWL') {
          directCount++;
        } else {
          hasCrawlDoc = true;
        }
      }
    }
    let crawlCount = 0;
    for (const crawl of this.crawlJobs.values()) {
      if (crawl.tenantId === tenantId && crawl.entityId === entityId) {
        crawlCount++;
      }
    }
    const effectiveCrawlCount = Math.max(crawlCount, hasCrawlDoc ? 1 : 0);
    return directCount + effectiveCrawlCount;
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
    sourceType?: string;
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
      sourceType: data.sourceType || 'DIRECT_UPLOAD',
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

  async updateDocumentMetadata(
    tenantId: string,
    documentId: string,
    data: {
      originalFilename?: string;
      mimeType?: string;
      sizeBytes?: number;
      contentHash?: string;
      objectKey?: string;
      status?: Document['status'];
      errorMessage?: string;
    }
  ): Promise<void> {
    const doc = this.documents.get(documentId);
    if (doc && doc.tenantId === tenantId) {
      if (data.originalFilename !== undefined) doc.originalFilename = data.originalFilename;
      if (data.mimeType !== undefined) doc.mimeType = data.mimeType;
      if (data.sizeBytes !== undefined) doc.sizeBytes = data.sizeBytes;
      if (data.contentHash !== undefined) doc.contentHash = data.contentHash;
      if (data.objectKey !== undefined) doc.objectKey = data.objectKey;
      if (data.status !== undefined) doc.status = data.status;
      if (data.errorMessage !== undefined) doc.errorMessage = data.errorMessage;
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

  async getDocumentVersions(tenantId: string, documentId: string): Promise<DocumentVersion[]> {
    const list: DocumentVersion[] = [];
    for (const v of this.documentVersions.values()) {
      if (v.tenantId === tenantId && v.documentId === documentId) {
        list.push(v);
      }
    }
    return list.sort((a, b) => b.versionNumber - a.versionNumber);
  }

  async getLatestDocumentVersion(tenantId: string, documentId: string): Promise<DocumentVersion | null> {
    const list = await this.getDocumentVersions(tenantId, documentId);
    return list[0] || null;
  }

  async activateDocumentVersion(
    tenantId: string,
    documentId: string,
    versionId: string,
    updates?: { contentHash?: string; objectKey?: string; sizeBytes?: number }
  ): Promise<void> {
    const doc = this.documents.get(documentId);
    if (!doc || doc.tenantId !== tenantId) return;
    doc.activeVersionId = versionId;
    doc.status = 'READY';
    if (updates?.contentHash) doc.contentHash = updates.contentHash;
    if (updates?.objectKey) doc.objectKey = updates.objectKey;
    if (updates?.sizeBytes !== undefined) doc.sizeBytes = updates.sizeBytes;
    doc.updatedAt = new Date();
  }

  // Ingestion Jobs
  async getJobById(tenantId: string, entityId: string, jobId: string): Promise<IngestionJob | null> {
    const job = this.ingestionJobs.get(jobId);
    if (!job || job.tenantId !== tenantId || job.entityId !== entityId) return null;
    return job;
  }

  async createIngestionJob(data: { id?: string; tenantId: string; entityId: string; totalDocuments: number; sourceType?: string; metadata?: Record<string, any> }): Promise<IngestionJob> {
    const job: IngestionJob = {
      id: data.id || generateUuid(),
      tenantId: data.tenantId,
      entityId: data.entityId,
      status: 'PENDING',
      sourceType: (data.sourceType as any) || 'DIRECT_UPLOAD',
      totalDocuments: data.totalDocuments,
      processedDocuments: 0,
      failedDocuments: 0,
      retryCount: 0,
      metadata: data.metadata || {},
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

  async createJobDocument(tenantId: string, jobId: string, documentId: string, extra?: { sourceUrl?: string; stage?: string; downloadMetadata?: Record<string, any> }): Promise<IngestionJobDocument> {
    const jobDoc: IngestionJobDocument = {
      id: generateUuid(),
      tenantId,
      jobId,
      documentId,
      status: 'PENDING',
      sourceUrl: extra?.sourceUrl,
      stage: (extra?.stage as any) || 'PENDING',
      downloadMetadata: extra?.downloadMetadata || {},
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

  async updateJobDocumentStage(tenantId: string, jobId: string, documentId: string, stage: string, errorMessage?: string, downloadMetadata?: Record<string, any>): Promise<void> {
    for (const jd of this.jobDocuments.values()) {
      if (jd.tenantId === tenantId && jd.jobId === jobId && jd.documentId === documentId) {
        jd.stage = stage as any;
        if (errorMessage !== undefined) jd.errorMessage = errorMessage;
        if (downloadMetadata) jd.downloadMetadata = { ...jd.downloadMetadata, ...downloadMetadata };
        jd.updatedAt = new Date();
      }
    }
  }

  async getJobDocumentByDocumentId(documentId: string): Promise<IngestionJobDocument | null> {
    for (const jd of this.jobDocuments.values()) {
      if (jd.documentId === documentId) {
        return jd;
      }
    }
    return null;
  }


  // Crawl Jobs & Pages
  async createCrawlJob(data: {
    id?: string;
    tenantId: string;
    entityId: string;
    rootUrl: string;
    config?: CrawlConfig;
  }): Promise<CrawlJob> {
    const job: CrawlJob = {
      id: data.id || generateUuid(),
      tenantId: data.tenantId,
      entityId: data.entityId,
      rootUrl: data.rootUrl,
      status: 'queued',
      config: data.config || {},
      lastRefetchedAt: undefined,
      refetchStatus: 'idle',
      unchangedCount: 0,
      changedCount: 0,
      newlyDiscoveredCount: 0,
      discoveredCount: 0,
      queuedCount: 0,
      processingCount: 0,
      completedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.crawlJobs.set(job.id, job);
    return job;
  }

  async getCrawlJob(tenantId: string, entityId: string, crawlJobId: string): Promise<CrawlJob | null> {
    await this.syncCrawlJobAggregates(tenantId, crawlJobId);
    const job = this.crawlJobs.get(crawlJobId);
    if (!job || job.tenantId !== tenantId || job.entityId !== entityId) return null;
    return job;
  }

  async listCrawlJobs(tenantId: string, entityId: string): Promise<CrawlJob[]> {
    const jobs = Array.from(this.crawlJobs.values())
      .filter(j => j.tenantId === tenantId && j.entityId === entityId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    for (const job of jobs) {
      if (job.status === 'processing_pages' || job.status === 'queued') {
        await this.syncCrawlJobAggregates(tenantId, job.id);
      }
    }
    return jobs;
  }

  async updateCrawlJob(tenantId: string, crawlJobId: string, updates: Partial<CrawlJob>): Promise<void> {
    const job = this.crawlJobs.get(crawlJobId);
    if (!job || job.tenantId !== tenantId) return;
    Object.assign(job, updates, { updatedAt: new Date() });
  }

  async createCrawlPages(pages: Array<{
    tenantId: string;
    entityId: string;
    crawlJobId: string;
    documentId?: string;
    originalUrl: string;
    normalizedUrl: string;
    depth?: number;
  }>): Promise<CrawlPage[]> {
    const created: CrawlPage[] = [];
    for (const p of pages) {
      const existing = Array.from(this.crawlPages.values()).find(
        cp => cp.crawlJobId === p.crawlJobId && cp.normalizedUrl === p.normalizedUrl
      );
      if (existing) {
        created.push(existing);
        continue;
      }
      const page: CrawlPage = {
        id: generateUuid(),
        tenantId: p.tenantId,
        entityId: p.entityId,
        crawlJobId: p.crawlJobId,
        documentId: p.documentId,
        originalUrl: p.originalUrl,
        normalizedUrl: p.normalizedUrl,
        status: 'discovered',
        stage: 'DISCOVERED',
        depth: p.depth || 0,
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.crawlPages.set(page.id, page);
      created.push(page);
    }
    return created;
  }

  async getCrawlPages(tenantId: string, crawlJobId: string): Promise<CrawlPage[]> {
    await this.syncCrawlJobAggregates(tenantId, crawlJobId);
    return Array.from(this.crawlPages.values())
      .filter(p => p.tenantId === tenantId && p.crawlJobId === crawlJobId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async getCrawlPageByUrl(tenantId: string, crawlJobId: string, normalizedUrl: string): Promise<CrawlPage | null> {
    for (const page of this.crawlPages.values()) {
      if (page.tenantId === tenantId && page.crawlJobId === crawlJobId && page.normalizedUrl === normalizedUrl) {
        return page;
      }
    }
    return null;
  }

  async updateCrawlPage(tenantId: string, crawlJobId: string, pageIdOrUrl: string, updates: Partial<CrawlPage>): Promise<void> {
    const cleanUrl = pageIdOrUrl.replace(/\/+$/, '');
    for (const page of this.crawlPages.values()) {
      if (
        page.tenantId === tenantId &&
        page.crawlJobId === crawlJobId &&
        (page.id === pageIdOrUrl ||
          page.documentId === pageIdOrUrl ||
          page.normalizedUrl === pageIdOrUrl ||
          page.originalUrl === pageIdOrUrl ||
          page.normalizedUrl.replace(/\/+$/, '') === cleanUrl ||
          page.originalUrl.replace(/\/+$/, '') === cleanUrl)
      ) {
        Object.assign(page, updates, { updatedAt: new Date() });
        return;
      }
    }
  }

  async getCrawlPageByDocumentId(tenantId: string, documentId: string): Promise<CrawlPage | null> {
    for (const page of this.crawlPages.values()) {
      if (page.tenantId === tenantId && page.documentId === documentId) {
        return page;
      }
    }
    return null;
  }

  async syncCrawlJobAggregates(tenantId: string, crawlJobId: string): Promise<CrawlJob | null> {
    const job = this.crawlJobs.get(crawlJobId);
    if (!job || job.tenantId !== tenantId) return null;

    const pages = Array.from(this.crawlPages.values()).filter(
      p => p.tenantId === tenantId && p.crawlJobId === crawlJobId
    );

    // Reconcile status with authoritative documents table
    for (const p of pages) {
      if (p.documentId) {
        const doc = this.documents.get(p.documentId);
        if (doc) {
          if (doc.status === 'READY' && p.status !== 'completed') {
            p.status = 'completed';
            p.stage = 'READY';
            p.completedAt = p.completedAt || new Date();
            p.updatedAt = new Date();
          } else if (doc.status === 'FAILED' && p.status !== 'failed' && p.status !== 'skipped') {
            p.status = 'failed';
            p.stage = 'FAILED';
            p.errorMessage = p.errorMessage || doc.errorMessage || 'Document ingestion failed';
            p.completedAt = p.completedAt || new Date();
            p.updatedAt = new Date();
          }
        }
      }

      // Auto-heal stale in-progress pages
      const ageMs = Date.now() - (p.updatedAt?.getTime() || p.createdAt?.getTime() || 0);
      if (ageMs > 5 * 60 * 1000) {
        if (p.status === 'fetching' || p.status === 'extracting') {
          p.status = 'failed';
          p.stage = 'FAILED';
          p.errorMessage = 'Page processing timed out';
          p.completedAt = p.completedAt || new Date();
          p.updatedAt = new Date();
        } else if (p.status === 'uploaded' && p.objectKey) {
          p.status = 'completed';
          p.stage = 'READY';
          p.completedAt = p.completedAt || new Date();
          p.updatedAt = new Date();
        }
      }
    }

    const queued = pages.filter(p => p.status === 'queued' || p.status === 'discovered').length;
    const processing = pages.filter(
      p => p.status === 'fetching' || p.status === 'extracting' || p.status === 'uploaded' || p.status === 'ingesting'
    ).length;
    const completed = pages.filter(p => p.status === 'completed').length;
    const failed = pages.filter(p => p.status === 'failed').length;
    const skipped = pages.filter(p => p.status === 'skipped').length;
    const total = pages.length;

    job.discoveredCount = total;
    job.queuedCount = queued;
    job.processingCount = processing;
    job.completedCount = completed;
    job.failedCount = failed;
    job.skippedCount = skipped;
    const unchanged = pages.filter(p => p.isUnchanged === true).length;
    const changed = pages.filter(p => p.status === 'completed' && !p.isUnchanged).length;
    job.unchangedCount = unchanged;
    job.changedCount = changed;
    if (job.status !== 'discovering' && job.refetchStatus === 'refetching' && queued === 0 && processing === 0 && total > 0) {
      job.refetchStatus = failed === total ? 'failed' : 'completed';
    }
    job.updatedAt = new Date();

    const isTerminal =
      job.status === 'completed' ||
      job.status === 'completed_with_errors' ||
      job.status === 'failed' ||
      job.status === 'cancelled';

    if (!isTerminal && job.status !== 'discovering') {
      if (queued > 0 || processing > 0) {
        job.status = 'processing_pages';
      } else if (total > 0 && queued === 0 && processing === 0) {
        if (failed === total) {
          job.status = 'failed';
        } else {
          job.status = 'completed';
        }
        job.completedAt = new Date();
      }
    }

    // Synchronize paired ingestion job and root job document
    const ingestionJob = this.ingestionJobs.get(crawlJobId);
    if (ingestionJob && ingestionJob.tenantId === tenantId) {
      ingestionJob.totalDocuments = Math.max(ingestionJob.totalDocuments, total);
      ingestionJob.processedDocuments = completed;
      ingestionJob.failedDocuments = failed;
      if (job.status === 'completed') {
        ingestionJob.status = 'READY';
      } else if (job.status === 'failed') {
        ingestionJob.status = 'FAILED';
      } else if (job.status === 'processing_pages' || job.status === 'discovering') {
        ingestionJob.status = 'PROCESSING';
      }
      ingestionJob.updatedAt = new Date();
    }

    for (const jd of this.jobDocuments.values()) {
      if (jd.tenantId === tenantId && jd.jobId === crawlJobId) {
        const meta = jd.downloadMetadata as any;
        if (meta?.depth === 0 || meta?.source === 'root') {
          if (job.status === 'completed') {
            jd.status = 'READY';
            jd.stage = 'READY';
          } else if (job.status === 'failed') {
            jd.status = 'FAILED';
            jd.stage = 'FAILED';
          } else {
            jd.status = 'PROCESSING';
            jd.stage = job.status === 'discovering' ? 'FETCHING_PAGE' : 'PROCESSING';
          }
          jd.updatedAt = new Date();
        }
      }
    }

    return job;
  }

  async incrementCrawlCounters(tenantId: string, crawlJobId: string, increments: {
    discovered?: number;
    queued?: number;
    processing?: number;
    completed?: number;
    failed?: number;
    skipped?: number;
  }): Promise<void> {
    const job = this.crawlJobs.get(crawlJobId);
    if (!job || job.tenantId !== tenantId) return;
    if (increments.discovered) job.discoveredCount += increments.discovered;
    if (increments.queued) job.queuedCount += increments.queued;
    if (increments.processing) job.processingCount += increments.processing;
    if (increments.completed) job.completedCount += increments.completed;
    if (increments.failed) job.failedCount += increments.failed;
    if (increments.skipped) job.skippedCount += increments.skipped;
    job.updatedAt = new Date();
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
      if (doc.activeVersionId && chunk.versionId && chunk.versionId !== doc.activeVersionId) continue;
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

  // -------------------------------------------------------------
  // Analytics & AI Attribution Implementation
  // -------------------------------------------------------------

  async recordAnalyticsEvent(data: Omit<AnalyticsEvent, 'id' | 'createdAt'>): Promise<AnalyticsEvent> {
    const event: AnalyticsEvent = {
      ...data,
      id: generateUuid(),
      createdAt: new Date(),
    };
    this.analyticsEvents.set(event.id, event);
    return event;
  }

  async recordAITokenLog(data: Omit<AITokenLog, 'id' | 'createdAt'>): Promise<AITokenLog> {
    const log: AITokenLog = {
      ...data,
      id: generateUuid(),
      createdAt: new Date(),
    };
    this.aiTokenLogs.set(log.id, log);
    return log;
  }

  private filterByDateRange<T extends { createdAt: Date; entityId: string; tenantId: string }>(
    items: IterableIterator<T>,
    tenantId: string,
    entityId: string,
    startDate: Date,
    endDate: Date
  ): T[] {
    const result: T[] = [];
    for (const item of items) {
      if (item.tenantId === tenantId && item.entityId === entityId) {
        const t = new Date(item.createdAt).getTime();
        if (t >= startDate.getTime() && t <= endDate.getTime()) {
          result.push(item);
        }
      }
    }
    return result;
  }

  private parseDateFilter(params: AnalyticsFilterParams): { startDate: Date; endDate: Date; periodLabel: string } {
    const now = new Date();
    let startDate: Date;
    let endDate = new Date(now);
    let periodLabel = params.period || '30d';

    if (params.startDate) {
      startDate = new Date(params.startDate);
      if (params.endDate) {
        endDate = new Date(params.endDate);
        if (params.endDate.length <= 10) {
          endDate.setHours(23, 59, 59, 999);
        }
      }
      periodLabel = params.period || 'custom';
    } else if (params.period === 'today') {
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
      endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
      periodLabel = 'today';
    } else if (params.period === '7d') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      periodLabel = '7d';
    } else if (params.period === '90d') {
      startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      periodLabel = '90d';
    } else {
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      periodLabel = '30d';
    }

    return { startDate, endDate, periodLabel };
  }

  async getAnalyticsOverview(
    tenantId: string,
    entityId: string,
    params: AnalyticsFilterParams
  ): Promise<PortalAnalyticsOverview> {
    const { startDate, endDate, periodLabel } = this.parseDateFilter(params);
    const events = this.filterByDateRange(this.analyticsEvents.values(), tenantId, entityId, startDate, endDate);
    const tokenLogs = this.filterByDateRange(this.aiTokenLogs.values(), tenantId, entityId, startDate, endDate);

    // Filter documents for this entity in period (excluding internal website crawl child routes)
    const directDocs: Document[] = [];
    let hasCrawlDoc = false;
    for (const doc of this.documents.values()) {
      if (doc.tenantId === tenantId && doc.entityId === entityId && doc.createdAt >= startDate && doc.createdAt <= endDate) {
        if (doc.sourceType !== 'WEBSITE_CRAWL') {
          directDocs.push(doc);
        } else {
          hasCrawlDoc = true;
        }
      }
    }

    // Collect parent website crawl jobs in period
    const crawlJobsList: CrawlJob[] = [];
    for (const crawl of this.crawlJobs.values()) {
      if (crawl.tenantId === tenantId && crawl.entityId === entityId && crawl.status !== 'cancelled' && crawl.createdAt >= startDate && crawl.createdAt <= endDate) {
        crawlJobsList.push(crawl);
      }
    }
    const effectiveCrawlCount = Math.max(crawlJobsList.length, hasCrawlDoc ? 1 : 0);

    // Ingestion completions for duration
    const completedEvents = events.filter(e => e.eventType === 'INGESTION_COMPLETION' && typeof e.durationMs === 'number');
    let avgDuration = completedEvents.length > 0
      ? Math.round(completedEvents.reduce((acc, e) => acc + (e.durationMs || 0), 0) / completedEvents.length)
      : 0;

    if (!avgDuration && directDocs.length > 0) {
      const readyDocs = directDocs.filter(d => d.status === 'READY');
      if (readyDocs.length > 0) {
        const durations = readyDocs.map(d => Math.max(800, (d.updatedAt.getTime() - d.createdAt.getTime())));
        avgDuration = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
      }
    }

    let successful = directDocs.filter(d => d.status === 'READY').length;
    let failed = directDocs.filter(d => d.status === 'FAILED').length;
    let processing = directDocs.filter(d => d.status === 'PROCESSING' || d.status === 'PENDING').length;

    if (crawlJobsList.length > 0) {
      for (const cj of crawlJobsList) {
        if (cj.status === 'completed' || cj.status === 'completed_with_errors') successful++;
        else if (cj.status === 'failed') failed++;
        else processing++;
      }
    } else if (hasCrawlDoc) {
      successful++;
    }

    const totalSources = directDocs.length + effectiveCrawlCount;
    const successRate = totalSources > 0 ? Math.round((successful / totalSources) * 100) : 100;

    // Chat questions
    const chatQuestions = events.filter(e => e.eventType === 'CHAT_REQUEST_RECEIVED').length;

    // Token totals
    let totalTokens = 0;
    let portalUiTokens = 0;
    let externalTokens = 0;
    for (const log of tokenLogs) {
      totalTokens += log.totalTokens;
      if (log.requestOrigin === 'EXTERNAL_INTEGRATION') {
        externalTokens += log.totalTokens;
      } else {
        portalUiTokens += log.totalTokens;
      }
    }

    if (totalTokens === 0) {
      for (const doc of directDocs) {
        if (doc.status === 'READY') {
          const docChunks = Array.from(this.chunks.values()).filter(c => c.documentId === doc.id);
          const chunkTokens = docChunks.reduce((acc, c) => acc + Math.ceil(c.chunkText.length / 4), 0);
          totalTokens += chunkTokens;
          portalUiTokens += chunkTokens;
        }
      }
    }

    return {
      totalSources,
      successfulSources: successful,
      failedSources: failed,
      processingSources: processing,
      successRatePercentage: successRate,
      averageProcessingTimeMs: avgDuration,
      totalChatQuestions: chatQuestions,
      totalTokensConsumed: totalTokens,
      externalIntegrationTokens: externalTokens,
      portalUiTokens,
      period: periodLabel,
      timezone: 'UTC',
    };
  }

  async getSourceAnalytics(
    tenantId: string,
    entityId: string,
    params: AnalyticsFilterParams
  ): Promise<SourceAnalyticsData> {
    const { startDate, endDate } = this.parseDateFilter(params);
    const events = this.filterByDateRange(this.analyticsEvents.values(), tenantId, entityId, startDate, endDate);

    // Collect direct portal documents in period (excluding internal website crawl child routes)
    const directDocs: Document[] = [];
    let hasCrawlDoc = false;
    for (const doc of this.documents.values()) {
      if (doc.tenantId === tenantId && doc.entityId === entityId && doc.createdAt >= startDate && doc.createdAt <= endDate) {
        if (doc.sourceType !== 'WEBSITE_CRAWL') {
          directDocs.push(doc);
        } else {
          hasCrawlDoc = true;
        }
      }
    }

    // Collect parent website crawl jobs in period
    const crawlJobsList: CrawlJob[] = [];
    for (const crawl of this.crawlJobs.values()) {
      if (crawl.tenantId === tenantId && crawl.entityId === entityId && crawl.status !== 'cancelled' && crawl.createdAt >= startDate && crawl.createdAt <= endDate) {
        crawlJobsList.push(crawl);
      }
    }
    const effectiveCrawlCount = Math.max(crawlJobsList.length, hasCrawlDoc ? 1 : 0);

    // Collect crawl pages in period (discovered routes)
    const crawlPagesList: CrawlPage[] = [];
    for (const p of this.crawlPages.values()) {
      if (p.tenantId === tenantId && p.entityId === entityId && p.createdAt >= startDate && p.createdAt <= endDate) {
        crawlPagesList.push(p);
      }
    }

    // Discovered and changed routes
    let discoveredRoutes = crawlPagesList.length;
    if (discoveredRoutes === 0 && hasCrawlDoc) {
      for (const doc of this.documents.values()) {
        if (doc.tenantId === tenantId && doc.entityId === entityId && doc.sourceType === 'WEBSITE_CRAWL' && doc.createdAt >= startDate && doc.createdAt <= endDate) {
          discoveredRoutes++;
        }
      }
    }
    const changedPages = crawlPagesList.filter(p => !p.isUnchanged).length;

    // Categorization
    let fileCount = 0;
    let linkCount = 0;
    let singlePageWebsiteCount = 0;
    const fileTypeMap = new Map<string, number>();

    for (const doc of directDocs) {
      const srcType = doc.sourceType || 'DIRECT_UPLOAD';
      const mime = doc.mimeType || 'application/octet-stream';

      if (srcType === 'WEBSITE_IMPORT') {
        singlePageWebsiteCount++;
      } else if (srcType === 'URL_IMPORT') {
        linkCount++;
      } else {
        fileCount++;
      }

      let ext = 'other';
      if (mime.includes('pdf')) ext = 'pdf';
      else if (mime.includes('word') || mime.includes('docx')) ext = 'docx';
      else if (mime.includes('doc')) ext = 'doc';
      else if (mime.includes('plain')) ext = 'txt';
      else if (mime.includes('markdown')) ext = 'markdown';
      else if (mime.includes('png')) ext = 'png';
      else if (mime.includes('jpeg') || mime.includes('jpg')) ext = 'jpeg';
      else if (mime.includes('webp')) ext = 'webp';
      else {
        const parts = doc.originalFilename.split('.');
        if (parts.length > 1) ext = parts.pop()!.toLowerCase();
      }

      fileTypeMap.set(ext, (fileTypeMap.get(ext) || 0) + 1);
    }

    const websiteCount = singlePageWebsiteCount + effectiveCrawlCount;
    const totalDocCount = fileCount + linkCount + websiteCount;

    let successfulUploads = directDocs.filter(d => d.status === 'READY').length;
    let failedUploads = directDocs.filter(d => d.status === 'FAILED').length;
    let processingUploads = directDocs.filter(d => d.status === 'PROCESSING' || d.status === 'PENDING').length;

    if (crawlJobsList.length > 0) {
      for (const cj of crawlJobsList) {
        if (cj.status === 'completed' || cj.status === 'completed_with_errors') successfulUploads++;
        else if (cj.status === 'failed') failedUploads++;
        else processingUploads++;
      }
    } else if (hasCrawlDoc) {
      successfulUploads++;
    }

    // Counts from events and records
    const newUploads = events.filter(e => e.eventType === 'SOURCE_SUBMISSION' && e.metadata?.isNewUpload !== false).length || totalDocCount;
    const duplicateAttempts = events.filter(e => e.eventType === 'DUPLICATE_DETECTION').length;
    const confirmedReuploads = events.filter(e => e.eventType === 'CONFIRMED_REPLACEMENT').length;
    const refetchOperations = events.filter(e => e.eventType === 'WEBSITE_REFETCH').length;
    const unchangedRefetches = events.filter(e => e.eventType === 'UNCHANGED_WEBSITE_REFETCH').length;
    const deletedSources = events.filter(e => e.eventType === 'SOURCE_DELETION').length;

    const fileTypeDistribution: Array<{ fileType: string; count: number; percentage: number }> = [];
    const directFilesAndLinks = fileCount + linkCount;
    for (const [ft, count] of fileTypeMap.entries()) {
      fileTypeDistribution.push({
        fileType: ft,
        count,
        percentage: directFilesAndLinks > 0 ? Math.round((count / directFilesAndLinks) * 100) : 0,
      });
    }

    // Ingestion outcomes
    const totalOps = successfulUploads + failedUploads + processingUploads;
    const ingestionOutcomes = {
      successful: successfulUploads,
      failed: failedUploads,
      processing: processingUploads,
      pending: 0,
      totalOperations: totalOps > 0 ? totalOps : totalDocCount,
    };

    // Volume over time (last 7 intervals)
    const volumeOverTime: SourceAnalyticsData['volumeOverTime'] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().split('T')[0];
      volumeOverTime.push({
        date: dateStr,
        files: Math.round(fileCount / 7),
        links: Math.round(linkCount / 7),
        websites: Math.round(websiteCount / 7),
        total: Math.round(totalDocCount / 7),
      });
    }

    return {
      uniqueSources: totalDocCount,
      totalSubmissions: newUploads + duplicateAttempts,
      newUploads,
      successfulUploads,
      failedUploads,
      sourcesCurrentlyProcessing: processingUploads,
      confirmedReuploads,
      duplicateAttempts,
      existingReplacements: confirmedReuploads,
      updatedSourceVersions: confirmedReuploads + (refetchOperations - unchangedRefetches),
      websiteRefetches: refetchOperations,
      unchangedWebsiteRefetches: unchangedRefetches,
      changedWebsitePages: changedPages,
      discoveredRoutes,
      removedRoutes: 0,
      deletedSources,
      ingestionOutcomes,
      categoryDistribution: {
        files: fileCount,
        links: linkCount,
        websites: websiteCount,
        total: totalDocCount,
      },
      fileTypeDistribution,
      volumeOverTime,
    };
  }

  async getProcessingPerformance(
    tenantId: string,
    entityId: string,
    params: AnalyticsFilterParams
  ): Promise<ProcessingPerformanceData> {
    const { startDate, endDate } = this.parseDateFilter(params);

    // 1. Direct documents (files and file links, excluding child website crawl routes)
    const directDocs: Array<{ durationMs: number; fileType: string; sourceCategory: 'FILE' | 'LINK' }> = [];
    for (const doc of this.documents.values()) {
      if (
        doc.tenantId === tenantId &&
        doc.entityId === entityId &&
        doc.status === 'READY' &&
        doc.sourceType !== 'WEBSITE_CRAWL' &&
        doc.createdAt >= startDate &&
        doc.createdAt <= endDate
      ) {
        const dur = Math.max(800, doc.updatedAt.getTime() - doc.createdAt.getTime());
        const cat = doc.sourceType === 'URL_IMPORT' ? 'LINK' : 'FILE';
        const ext = doc.originalFilename.split('.').pop()?.toLowerCase() || 'other';
        directDocs.push({
          durationMs: dur,
          fileType: ext,
          sourceCategory: cat,
        });
      }
    }

    // 2. Parent website crawl jobs
    const crawlList: Array<{ id: string; completedCount: number; durationMs: number }> = [];
    for (const job of this.crawlJobs.values()) {
      if (
        job.tenantId === tenantId &&
        job.entityId === entityId &&
        (job.status === 'completed' || job.status === 'completed_with_errors') &&
        job.createdAt >= startDate &&
        job.createdAt <= endDate
      ) {
        const dur = Math.max(800, (job.completedAt || job.updatedAt).getTime() - job.createdAt.getTime());
        crawlList.push({
          id: job.id,
          completedCount: job.discoveredCount || 1,
          durationMs: dur,
        });
      }
    }

    // Fallback if crawl jobs not recorded but child crawl documents exist
    if (crawlList.length === 0) {
      let crawlDocCount = 0;
      let minCreated = Number.MAX_SAFE_INTEGER;
      let maxUpdated = 0;
      for (const doc of this.documents.values()) {
        if (
          doc.tenantId === tenantId &&
          doc.entityId === entityId &&
          doc.status === 'READY' &&
          doc.sourceType === 'WEBSITE_CRAWL' &&
          doc.createdAt >= startDate &&
          doc.createdAt <= endDate
        ) {
          crawlDocCount++;
          if (doc.createdAt.getTime() < minCreated) minCreated = doc.createdAt.getTime();
          if (doc.updatedAt.getTime() > maxUpdated) maxUpdated = doc.updatedAt.getTime();
        }
      }
      if (crawlDocCount > 0) {
        crawlList.push({
          id: 'crawl-fallback',
          completedCount: crawlDocCount,
          durationMs: Math.max(800, maxUpdated - minCreated),
        });
      }
    }

    const filesDurations = directDocs.filter(d => d.sourceCategory === 'FILE').map(d => d.durationMs);
    const linksDurations = directDocs.filter(d => d.sourceCategory === 'LINK').map(d => d.durationMs);
    const crawlDurations = crawlList.map(c => c.durationMs);
    const totalCrawlRoutes = crawlList.reduce((acc, c) => acc + c.completedCount, 0);
    const websiteProcessedCount = crawlDurations.length;

    const allDurations = [...filesDurations, ...linksDurations, ...crawlDurations].sort((a, b) => a - b);
    const totalSourcesProcessed = filesDurations.length + linksDurations.length + websiteProcessedCount;

    const median = (arr: number[]) => {
      if (arr.length === 0) return 0;
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 !== 0 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
    };

    const avgOf = (arr: number[]) => arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
    const avg = avgOf(allDurations);
    const fastest = allDurations.length > 0 ? allDurations[0] : 0;
    const slowest = allDurations.length > 0 ? allDurations[allDurations.length - 1] : 0;

    // By file type
    const fileTypeMap = new Map<string, number[]>();
    for (const doc of directDocs) {
      const ft = doc.fileType || 'pdf';
      if (!fileTypeMap.has(ft)) fileTypeMap.set(ft, []);
      fileTypeMap.get(ft)!.push(doc.durationMs);
    }

    const byFileType: ProcessingPerformanceData['byFileType'] = [];
    for (const [ft, times] of fileTypeMap.entries()) {
      const sorted = [...times].sort((a, b) => a - b);
      byFileType.push({
        fileType: ft,
        processedCount: times.length,
        avgDurationMs: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
        medianDurationMs: median(sorted),
        successRate: 100,
        failureCount: 0,
      });
    }

    if (websiteProcessedCount > 0) {
      byFileType.push({
        fileType: 'website',
        processedCount: websiteProcessedCount,
        avgDurationMs: avgOf(crawlDurations),
        medianDurationMs: median(crawlDurations),
        successRate: 100,
        failureCount: 0,
      });
    }

    byFileType.sort((a, b) => b.processedCount - a.processedCount);

    return {
      overall: {
        avgProcessingTimeMs: avg,
        medianProcessingTimeMs: median(allDurations),
        fastestProcessingTimeMs: fastest,
        slowestProcessingTimeMs: slowest,
        sourcesProcessed: totalSourcesProcessed > 0 ? totalSourcesProcessed : allDurations.length,
      },
      byCategory: {
        files: {
          avgProcessingTimeMs: avgOf(filesDurations),
          medianProcessingTimeMs: median(filesDurations),
          processedCount: filesDurations.length,
          successRate: 100,
          failureCount: 0,
        },
        links: {
          totalProcessed: linksDurations.length,
          successful: linksDurations.length,
          failed: 0,
          avgDownloadTimeMs: Math.round(avgOf(linksDurations) * 0.3),
          avgExtractionTimeMs: Math.round(avgOf(linksDurations) * 0.4),
          avgTotalProcessingTimeMs: avgOf(linksDurations),
        },
        websites: {
          processedCount: websiteProcessedCount,
          singlePageAvgExtractionMs: totalCrawlRoutes > 0 ? Math.round(avgOf(crawlDurations) / totalCrawlRoutes) : Math.round(avgOf(crawlDurations) * 0.4),
          multiPageAvgExtractionMs: avgOf(crawlDurations),
          avgTotalIngestionMs: avgOf(crawlDurations),
          avgRouteProcessingMs: totalCrawlRoutes > 0 ? Math.round(avgOf(crawlDurations) / totalCrawlRoutes) : avgOf(crawlDurations),
          avgRoutesSelected: totalCrawlRoutes,
          avgRoutesProcessed: totalCrawlRoutes,
          failedRouteCount: 0,
          unchangedRefetchCount: 0,
        },
      },
      byFileType,
      stageDurations: {
        downloadMs: Math.round(avg * 0.15),
        extractionMs: Math.round(avg * 0.35),
        chunkingMs: Math.round(avg * 0.1),
        embeddingMs: Math.round(avg * 0.3),
        databaseStorageMs: Math.round(avg * 0.1),
      },
    };
  }

  async getAITokenConsumption(
    tenantId: string,
    entityId: string,
    params: AnalyticsFilterParams
  ): Promise<AITokenConsumptionData> {
    const { startDate, endDate } = this.parseDateFilter(params);
    const tokenLogs = this.filterByDateRange(this.aiTokenLogs.values(), tenantId, entityId, startDate, endDate);

    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let embeddingTokens = 0;
    let chatTokens = 0;
    let queryRewriteTokens = 0;
    let portalUiTokens = 0;
    let externalTokens = 0;

    const modelMap = new Map<string, {
      provider: string;
      modelName: string;
      requestCount: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      isEstimated: boolean;
    }>();

    for (const log of tokenLogs) {
      totalTokens += log.totalTokens;
      inputTokens += log.inputTokens;
      outputTokens += log.outputTokens;

      if (log.operationType === 'EMBEDDING') {
        embeddingTokens += log.totalTokens;
      } else if (log.operationType === 'CHAT_COMPLETION') {
        chatTokens += log.totalTokens;
      } else if (log.operationType === 'QUERY_REWRITE') {
        queryRewriteTokens += log.totalTokens;
      }

      if (log.requestOrigin === 'EXTERNAL_INTEGRATION') {
        externalTokens += log.totalTokens;
      } else {
        portalUiTokens += log.totalTokens;
      }

      const key = `${log.provider}:${log.modelName}`;
      if (!modelMap.has(key)) {
        modelMap.set(key, {
          provider: log.provider,
          modelName: log.modelName,
          requestCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          isEstimated: log.isEstimated,
        });
      }
      const m = modelMap.get(key)!;
      m.requestCount++;
      m.inputTokens += log.inputTokens;
      m.outputTokens += log.outputTokens;
      m.totalTokens += log.totalTokens;
    }

    if (totalTokens === 0) {
      let docCount = 0;
      for (const doc of this.documents.values()) {
        if (doc.tenantId === tenantId && doc.entityId === entityId && doc.status === 'READY' && doc.createdAt >= startDate && doc.createdAt <= endDate) {
          const docChunks = Array.from(this.chunks.values()).filter(c => c.documentId === doc.id);
          const chunkTokens = docChunks.reduce((acc, c) => acc + Math.ceil(c.chunkText.length / 4), 0);
          if (chunkTokens > 0) {
            docCount++;
            totalTokens += chunkTokens;
            inputTokens += chunkTokens;
            embeddingTokens += chunkTokens;
            portalUiTokens += chunkTokens;
          }
        }
      }
      if (totalTokens > 0) {
        modelMap.set('gemini:gemini-embedding-001', {
          provider: 'gemini',
          modelName: 'gemini-embedding-001',
          requestCount: docCount,
          inputTokens: totalTokens,
          outputTokens: 0,
          totalTokens,
          isEstimated: true,
        });
      }
    }

    const chatQuestions = tokenLogs.filter(l => l.operationType === 'CHAT_COMPLETION').length;
    const avgTokens = chatQuestions > 0 ? Math.round(totalTokens / chatQuestions) : 0;
    const avgInput = chatQuestions > 0 ? Math.round(inputTokens / chatQuestions) : 0;
    const avgOutput = chatQuestions > 0 ? Math.round(outputTokens / chatQuestions) : 0;

    const uiPct = totalTokens > 0 ? Math.round((portalUiTokens / totalTokens) * 100) : 100;
    const extPct = totalTokens > 0 ? Math.round((externalTokens / totalTokens) * 100) : 0;

    // Tokens over time (last 7 days)
    const tokensOverTime: AITokenConsumptionData['tokensOverTime'] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().split('T')[0];
      tokensOverTime.push({
        date: dateStr,
        portalUiTokens: Math.round(portalUiTokens / 7),
        externalTokens: Math.round(externalTokens / 7),
        embeddingTokens: Math.round(embeddingTokens / 7),
        totalTokens: Math.round(totalTokens / 7),
      });
    }

    return {
      summary: {
        totalTokens,
        inputTokens,
        outputTokens,
        embeddingTokens,
        totalChatQuestions: chatQuestions,
        totalAIRequests: tokenLogs.length > 0 ? tokenLogs.length : Array.from(modelMap.values()).reduce((a, b) => a + b.requestCount, 0),
        avgTokensPerQuestion: avgTokens,
        avgInputTokensPerQuestion: avgInput,
        avgOutputTokensPerQuestion: avgOutput,
      },
      byOrigin: {
        portalUiTokens,
        externalIntegrationTokens: externalTokens,
        portalUiPercentage: uiPct,
        externalPercentage: extPct,
      },
      byOperation: {
        chatTokens,
        embeddingTokens,
        queryRewriteTokens,
      },
      byModel: Array.from(modelMap.values()).map(m => ({
        ...m,
        model: m.modelName,
        count: m.requestCount,
      })),
      tokensOverTime,
      consumptionOverTime: tokensOverTime.map(t => ({
        date: t.date,
        portalUiTokens: t.portalUiTokens,
        externalIntegrationTokens: t.externalTokens,
        totalTokens: t.totalTokens,
      })),
    };
  }

  async getChatUsage(
    tenantId: string,
    entityId: string,
    params: AnalyticsFilterParams
  ): Promise<ChatUsageData> {
    const { startDate, endDate } = this.parseDateFilter(params);
    const events = this.filterByDateRange(this.analyticsEvents.values(), tenantId, entityId, startDate, endDate);

    const chatRequests = events.filter(e => e.eventType === 'CHAT_REQUEST_RECEIVED');
    const chatCompletions = events.filter(e => e.eventType === 'CHAT_RESPONSE_COMPLETED');
    const chatFailures = events.filter(e => e.eventType === 'CHAT_RESPONSE_FAILED');

    let portalUiCount = 0;
    let externalCount = 0;
    for (const r of chatRequests) {
      if (r.requestOrigin === 'EXTERNAL_INTEGRATION') externalCount++;
      else portalUiCount++;
    }

    const conversations = new Set<string>();
    const sessions = new Set<string>();
    for (const r of chatRequests) {
      if (r.conversationId) conversations.add(r.conversationId);
      if (r.sessionId) sessions.add(r.sessionId);
    }

    const durations = chatCompletions
      .map(e => e.durationMs)
      .filter((d): d is number => typeof d === 'number')
      .sort((a, b) => a - b);

    const median = (arr: number[]) => {
      if (arr.length === 0) return 0;
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 !== 0 ? arr[mid] : Math.round((arr[mid - 1] + arr[mid]) / 2);
    };

    const p95 = (arr: number[]) => {
      if (arr.length === 0) return 0;
      const idx = Math.floor(arr.length * 0.95);
      return arr[Math.min(idx, arr.length - 1)];
    };

    const avgResponse = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;

    const abstained = chatCompletions.filter(e => e.metadata?.insufficientEvidence === true).length;
    const noContext = chatCompletions.filter(e => e.metadata?.retrievedCount === 0).length;

    // Usage over time
    const usageOverTime: ChatUsageData['usageOverTime'] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().split('T')[0];
      usageOverTime.push({
        date: dateStr,
        portalUi: Math.round(portalUiCount / 7),
        external: Math.round(externalCount / 7),
        total: Math.round((portalUiCount + externalCount) / 7),
        avgResponseMs: avgResponse,
      });
    }

    return {
      summary: {
        totalQuestions: chatRequests.length,
        totalConversations: conversations.size || (chatRequests.length > 0 ? 1 : 0),
        uniqueSessions: sessions.size || (chatRequests.length > 0 ? 1 : 0),
        avgQuestionsPerSession: sessions.size > 0 ? Math.round(chatRequests.length / sessions.size) : chatRequests.length,
        portalUiQuestions: portalUiCount,
        externalIntegrationQuestions: externalCount,
        successfulResponses: chatCompletions.length,
        failedResponses: chatFailures.length,
        noRelevantContextCount: noContext,
        abstainedCount: abstained,
      },
      responsePerformance: {
        avgResponseTimeMs: avgResponse,
        medianResponseTimeMs: median(durations),
        p95ResponseTimeMs: p95(durations),
      },
      usageOverTime,
    };
  }

  async getSourceActivity(
    tenantId: string,
    entityId: string,
    params: AnalyticsFilterParams
  ): Promise<SourceActivityData> {
    const { startDate, endDate } = this.parseDateFilter(params);
    const events = this.filterByDateRange(this.analyticsEvents.values(), tenantId, entityId, startDate, endDate);

    // Relevant source activities
    const activityTypes = new Set([
      'SOURCE_SUBMISSION',
      'UPLOAD_COMPLETION',
      'DUPLICATE_DETECTION',
      'CONFIRMED_REPLACEMENT',
      'SOURCE_UPDATE',
      'WEBSITE_REFETCH',
      'UNCHANGED_WEBSITE_REFETCH',
      'SOURCE_DELETION',
      'INGESTION_FAILURE',
    ]);

    const matching = events
      .filter(e => activityTypes.has(e.eventType))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const page = params.page || 1;
    const limit = params.limit || 20;
    const startIdx = (page - 1) * limit;
    const paginated = matching.slice(startIdx, startIdx + limit);

    return {
      records: paginated.map(e => ({
        id: e.id,
        sourceName: e.metadata?.sourceName || e.metadata?.filename || e.metadata?.url || 'Knowledge Source',
        sourceCategory: e.sourceCategory || 'FILE',
        fileType: e.fileType,
        activityType: e.eventType,
        timestamp: e.createdAt.toISOString(),
        outcome: e.status,
        details: e.metadata,
      })),
      total: matching.length,
      page,
      limit,
    };
  }

  async getFailureAnalytics(
    tenantId: string,
    entityId: string,
    params: AnalyticsFilterParams
  ): Promise<FailureAnalyticsData> {
    const { startDate, endDate } = this.parseDateFilter(params);
    const events = this.filterByDateRange(this.analyticsEvents.values(), tenantId, entityId, startDate, endDate);

    const failures = events.filter(e => e.status === 'FAILED' || e.eventType === 'INGESTION_FAILURE');
    const categoryCounts = new Map<FailureCategory, number>();

    for (const f of failures) {
      const cat = f.failureCategory || 'other_failures';
      categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);
    }

    const totalFailures = failures.length;
    const categoryLabels: Record<FailureCategory, string> = {
      unsupported_file_type: 'Unsupported File Type',
      invalid_file: 'Invalid File',
      download_failure: 'Download Failure',
      website_extraction_failure: 'Website Extraction Failure',
      insufficient_static_content: 'Insufficient Static Content',
      parsing_failure: 'Parsing Failure',
      file_size_limit_exceeded: 'File Size Limit Exceeded',
      embedding_failure: 'Embedding Failure',
      database_storage_failure: 'Database Storage Failure',
      processing_timeout: 'Processing Timeout',
      authorization_failure: 'Authorization Failure',
      other_failures: 'Other Failures',
    };

    const summaryByCategory: FailureAnalyticsData['summaryByCategory'] = [];
    for (const [cat, count] of categoryCounts.entries()) {
      summaryByCategory.push({
        category: cat,
        label: categoryLabels[cat] || cat,
        count,
        percentage: totalFailures > 0 ? Math.round((count / totalFailures) * 100) : 0,
      });
    }

    const page = params.page || 1;
    const limit = params.limit || 20;
    const startIdx = (page - 1) * limit;
    const paginated = failures.slice(startIdx, startIdx + limit);

    return {
      summaryByCategory,
      records: paginated.map(f => ({
        id: f.id,
        sourceName: f.metadata?.sourceName || f.metadata?.filename || f.metadata?.url || 'Knowledge Source',
        sourceCategory: f.sourceCategory || 'FILE',
        fileType: f.fileType,
        failedStage: f.stage || 'PROCESSING',
        failureCategory: f.failureCategory || 'other_failures',
        timestamp: f.createdAt.toISOString(),
        retryCount: f.metadata?.retryCount || 0,
        finalStatus: 'FAILED',
        errorMessage: f.metadata?.errorMessage || f.metadata?.error || 'Operation failed',
      })),
      total: totalFailures,
      page,
      limit,
    };
  }
}
