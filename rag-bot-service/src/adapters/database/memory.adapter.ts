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

  async getEntitiesByTenant(tenantId: string): Promise<Entity[]> {
    return Array.from(this.entities.values()).filter(e => e.tenantId === tenantId);
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
