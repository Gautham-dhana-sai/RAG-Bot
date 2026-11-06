import { IDatabaseAdapter } from '../../adapters/database/database.interface.js';
import { IStorageAdapter } from '../../adapters/storage/storage.interface.js';
import { AuthContext, Document, Entity, IngestionJob } from '../../types/index.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../shared/errors.js';
import { normalizePortfolioUrl } from '../../shared/password.js';
import { verifyLiveEndpoint } from '../../shared/endpoint-validator.js';
import { slugify } from '../../shared/utils.js';
import { logger } from '../../shared/logger.js';
import { DocumentsService, getPortfolioFolderPrefix } from '../documents/documents.service.js';
import { IngestionService } from '../ingestion/ingestion.service.js';
import { UploadedFileItem } from '../ingestion/ingestion.types.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { GenerationService } from '../generation/generation.service.js';

export interface PortfolioSummary {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description?: string;
  portalUrl?: string;
  portfolioUrl?: string;
  isPublic: boolean;
  documentCount: number;
  createdAt: Date;
  updatedAt: Date;
}
export type PortalSummary = PortfolioSummary;

export class PortfoliosService {
  constructor(
    private db: IDatabaseAdapter,
    private documentsService: DocumentsService,
    private ingestionService: IngestionService,
    private storage?: IStorageAdapter,
    private retrievalService?: RetrievalService,
    private generationService?: GenerationService
  ) {}

  /**
   * Helper to resolve tenant ID for the current user
   */
  private async getAuthenticatedTenantId(auth: AuthContext): Promise<string> {
    if (auth.isPublicVisitor || !auth.userId) {
      throw new UnauthorizedError('Authentication required to access portfolios');
    }

    if (auth.tenantId) {
      return auth.tenantId;
    }

    const membership = await this.db.getUserTenantMembership(auth.userId);
    if (membership) {
      return membership.tenantId;
    }

    throw new ForbiddenError('No workspace associated with your user account');
  }

  /**
   * Resolve an entity/portfolio by id, slug, or normalized portfolio URL
   */
  async resolvePortfolio(auth: AuthContext, portfolioReference: string): Promise<{ tenantId: string; entity: Entity }> {
    const tenantId = await this.getAuthenticatedTenantId(auth);

    // 1. Try finding in user's tenant
    const decodedRef = decodeURIComponent(portfolioReference);
    const entity = await this.db.getEntityByReference(tenantId, decodedRef);
    if (entity) {
      return { tenantId, entity };
    }

    // 2. Check if reference is a URL that belongs to another tenant
    try {
      const normalized = normalizePortfolioUrl(decodedRef);
      const otherEntity = await this.db.getEntityByPortfolioUrl(normalized);
      if (otherEntity && otherEntity.tenantId !== tenantId) {
        throw new ForbiddenError('You do not have permission to access this portfolio');
      }
    } catch (err: any) {
      if (err instanceof ForbiddenError) throw err;
      // Not a valid URL, ignore
    }

    throw new NotFoundError('Portfolio', portfolioReference);
  }

  /**
   * List all portfolios owned by the authenticated user's workspace
   */
  async listPortfolios(auth: AuthContext): Promise<PortfolioSummary[]> {
    const tenantId = await this.getAuthenticatedTenantId(auth);
    const entities = await this.db.getEntitiesByTenant(tenantId);

    const portfolios: PortfolioSummary[] = [];
    for (const e of entities) {
      const count = await this.db.getDocumentCountByEntity(tenantId, e.id);
      const url = e.portalUrl || e.portfolioUrl;
      portfolios.push({
        id: e.id,
        tenantId: e.tenantId,
        name: e.name,
        slug: e.slug,
        description: e.description,
        portalUrl: url,
        portfolioUrl: url,
        isPublic: e.isPublic,
        documentCount: count,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt,
      });
    }

    return portfolios;
  }

  /**
   * Create a new portal by URL, or return existing if already owned by user
   */
  async createPortfolio(auth: AuthContext, data: { url: string; name?: string }): Promise<PortfolioSummary> {
    const tenantId = await this.getAuthenticatedTenantId(auth);

    let normalizedUrl: string;
    try {
      normalizedUrl = normalizePortfolioUrl(data.url);
    } catch {
      throw new BadRequestError('Please provide a valid portal or website URL');
    }

    // Verify endpoint availability on live internet (including backend health checks)
    const verification = await verifyLiveEndpoint(normalizedUrl);
    if (!verification.isLive) {
      throw new BadRequestError(
        `Unable to register portal: ${verification.reason || 'Endpoint is not reachable on the live internet.'}`
      );
    }

    // Check if portal URL already exists anywhere
    const existing = await this.db.getEntityByPortfolioUrl(normalizedUrl);
    if (existing) {
      if (existing.tenantId === tenantId) {
        const docCount = await this.db.getDocumentCountByEntity(tenantId, existing.id);
        const url = existing.portalUrl || existing.portfolioUrl;
        return {
          id: existing.id,
          tenantId: existing.tenantId,
          name: existing.name,
          slug: existing.slug,
          description: existing.description,
          portalUrl: url,
          portfolioUrl: url,
          isPublic: existing.isPublic,
          documentCount: docCount,
          createdAt: existing.createdAt,
          updatedAt: existing.updatedAt,
        };
      } else {
        // Belongs to another user/tenant
        throw new ConflictError('This portal URL is already registered to another account.');
      }
    }

    // Determine readable name
    let displayName = data.name?.trim();
    if (!displayName) {
      try {
        const parsed = new URL(normalizedUrl);
        const hostParts = parsed.hostname.split('.');
        displayName = hostParts.length > 2 ? hostParts[0] : hostParts.join('.');
        if (parsed.pathname && parsed.pathname !== '/') {
          displayName += parsed.pathname.replace(/\/+$/, '');
        }
      } catch {
        displayName = normalizedUrl;
      }
    }

    const slug = slugify(displayName);
    const entity = await this.db.createEntity({
      tenantId,
      name: displayName,
      slug,
      portalUrl: normalizedUrl,
      portfolioUrl: normalizedUrl,
      isPublic: true,
    });

    const finalUrl = entity.portalUrl || entity.portfolioUrl;
    return {
      id: entity.id,
      tenantId: entity.tenantId,
      name: entity.name,
      slug: entity.slug,
      description: entity.description,
      portalUrl: finalUrl,
      portfolioUrl: finalUrl,
      isPublic: entity.isPublic,
      documentCount: 0,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /**
   * Get summary details of a single portal by reference
   */
  async getPortfolio(auth: AuthContext, portfolioReference: string): Promise<PortfolioSummary> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);
    const docCount = await this.db.getDocumentCountByEntity(tenantId, entity.id);
    const url = entity.portalUrl || entity.portfolioUrl;

    return {
      id: entity.id,
      tenantId: entity.tenantId,
      name: entity.name,
      slug: entity.slug,
      description: entity.description,
      portalUrl: url,
      portfolioUrl: url,
      isPublic: entity.isPublic,
      documentCount: docCount,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  /**
   * Ask a question directly against a portfolio's indexed knowledge base
   */
  async askQuestion(
    auth: AuthContext,
    portfolioReference: string,
    question: string
  ): Promise<{
    answer: string;
    citations: any[];
    insufficientEvidence: boolean;
    confidence?: number;
    portfolioId: string;
    tenantId: string;
  }> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);

    const isPublicOnly = Boolean(auth.isPublicVisitor && !auth.isSuperadmin);

    let retrievedChunks: any[] = [];
    if (this.retrievalService) {
      retrievedChunks = await this.retrievalService.retrieveRelevantChunks({
        tenantId,
        entityId: entity.id,
        query: question,
        isPublicOnly,
        topK: 6,
        mode: 'hybrid',
        minScore: 0.005,
      });
    }

    if (this.generationService) {
      const result = await this.generationService.generateGroundedAnswer({
        question,
        conversationHistory: [],
        retrievedChunks,
      });

            // 1. Extract verified citations from any DOC-<chunkId> or CHUNK tags in the answer
      const citationRegex = /(?:DOC|CHUNK)[:\s-]*([a-zA-Z0-9_-]+)/gi;
      const citedIds = new Set<string>();
      let match;
      while ((match = citationRegex.exec(result.answer)) !== null) {
        citedIds.add(match[1].toLowerCase());
      }

      let citations: any[] = [];
      if (citedIds.size > 0) {
        for (const sc of retrievedChunks) {
          const chunkId = sc.chunk.id.toLowerCase();
          const docId = sc.document.id.toLowerCase();
          const docTitle = (sc.document.originalFilename || '').toLowerCase();
          const chunkIdx = sc.chunk.chunkIndex.toString();
          const chunkNum = (sc.chunk.chunkIndex + 1).toString();

          const isCited = Array.from(citedIds).some(id => 
            chunkId.includes(id) || 
            docId.includes(id) || 
            id.includes(chunkId) || 
            id.includes(docId) ||
            id === chunkIdx ||
            id === chunkNum ||
            docTitle.includes(id)
          );

          if (isCited) {
            citations.push({
              chunkId: sc.chunk.id,
              documentId: sc.document.id,
              documentTitle: sc.document.originalFilename,
              sourceTitle: sc.document.originalFilename,
              sourceType: sc.document.sourceType,
              mimeType: sc.document.mimeType,
              versionId: sc.chunk.versionId,
              sourceUrl: sc.chunk.metadata?.sourceUrl || sc.chunk.metadata?.canonicalUrl || (sc.document as any)?.sourceUrl,
              pageNumber: sc.chunk.pageNumber || 1,
              snippet: sc.chunk.chunkText.length > 300 ? sc.chunk.chunkText.substring(0, 300) + '...' : sc.chunk.chunkText,
              quote: sc.chunk.chunkText.length > 180 ? sc.chunk.chunkText.substring(0, 180) + '...' : sc.chunk.chunkText,
              score: sc.score,
            });
          }
        }
      }

      // If strict tag matching yielded no citations (e.g. LLM used ordinal numbers or general summary),
      // fall back to the top retrieved grounding chunks so reasoning sources are ALWAYS returned!
      if (citations.length === 0 && retrievedChunks.length > 0 && !result.insufficientEvidence) {
        citations = retrievedChunks.slice(0, 4).map(sc => ({
          chunkId: sc.chunk.id,
          documentId: sc.document.id,
          documentTitle: sc.document.originalFilename,
          sourceTitle: sc.document.originalFilename,
          sourceType: sc.document.sourceType,
          mimeType: sc.document.mimeType,
          versionId: sc.chunk.versionId,
          sourceUrl: sc.chunk.metadata?.sourceUrl || sc.chunk.metadata?.canonicalUrl || (sc.document as any)?.sourceUrl,
          pageNumber: sc.chunk.pageNumber || 1,
          snippet: sc.chunk.chunkText.length > 300 ? sc.chunk.chunkText.substring(0, 300) + '...' : sc.chunk.chunkText,
          quote: sc.chunk.chunkText.length > 180 ? sc.chunk.chunkText.substring(0, 180) + '...' : sc.chunk.chunkText,
          score: sc.score,
        }));
      }

      // 2. Strip internal raw tags like [DOC-uuid], [DOC-a, DOC-b], or truncated [DOC-uuid from the answer prose
      const cleanAnswer = result.answer
        .replace(/\[[^\]]*\bDOC-[^\]]*\]/gi, '')
        .replace(/\([^)]*\bDOC-[^)]*\)/gi, '')
        .replace(/\[[^\]]*\bCHUNK\b[^\]]*\]/gi, '')
        .replace(/\[\s*DOC-[^\]]*$/gi, '')
        .replace(/\(\s*DOC-[^)]*$/gi, '')
        .replace(/\[\s*CHUNK[^\]]*$/gi, '')
        .replace(/\bDOC-[a-zA-Z0-9_-]+/gi, '')
        .replace(/\bCHUNK-[a-zA-Z0-9_-]+/gi, '')
        .replace(/\[\s*\]/g, '')
        .replace(/\(\s*\)/g, '')
        .replace(/\[\s*$/g, '')
        .replace(/\(\s*$/g, '')
        .replace(/[ \t]+([.,!?;:])/g, '$1')
        .replace(/[^\S\r\n]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      return {
        answer: cleanAnswer,
        citations: citations.slice(0, 4),
        insufficientEvidence: result.insufficientEvidence,
        confidence: result.confidence,
        portfolioId: entity.id,
        tenantId,
      };
    }

    return {
      answer: 'Portfolio retrieval verification service is ready, but generation service is unconfigured.',
      citations: [],
      insufficientEvidence: true,
      portfolioId: entity.id,
      tenantId,
    };
  }

  /**
   * List documents for a portfolio
   */
  async listDocuments(auth: AuthContext, portfolioReference: string): Promise<Document[]> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);
    return this.documentsService.listDocuments(tenantId, entity.id);
  }

  /**
   * Get document content buffer for secure viewing
   */
  async getDocumentContent(
    auth: AuthContext,
    portfolioReference: string,
    documentId: string
  ): Promise<{ document: Document; buffer: Buffer }> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);
    const document = await this.documentsService.getDocument(tenantId, entity.id, documentId);
    if (!document) {
      throw new (await import('../../shared/errors.js')).NotFoundError('Document', documentId);
    }
    if (!this.storage) {
      throw new (await import('../../shared/errors.js')).AppError('Storage adapter is not configured');
    }
    const buffer = await this.storage.downloadFile(document.objectKey);
    return { document, buffer };
  }

  /**
   * Delete a single document from a portfolio
   */
  async deleteDocument(
    auth: AuthContext,
    portfolioReference: string,
    documentId: string
  ): Promise<{ success: boolean; message: string }> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);
    await this.documentsService.deleteDocument(tenantId, entity.id, documentId);
    return {
      success: true,
      message: 'Document deleted successfully',
    };
  }

  /**
   * Submit files for ingestion into a portfolio
   */
  async submitIngestionJob(
    auth: AuthContext,
    portfolioReference: string,
    files: UploadedFileItem[]
  ): Promise<any> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);
    const res = await this.ingestionService.submitIngestionJob({
      tenantId,
      entityId: entity.id,
      files,
    });
    return {
      id: res.jobId,
      ...res,
    };
  }


  /**
   * Submit document and image URLs for asynchronous download and ingestion.
   */
  async submitUrlIngestionJob(
    auth: AuthContext,
    portfolioReference: string,
    urls: string[]
  ): Promise<any> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);
    const res = await this.ingestionService.submitUrlIngestionJob({
      tenantId,
      entityId: entity.id,
      urls,
      portfolioUrl: entity.portfolioUrl || entity.slug,
    });
    return {
      id: res.jobId,
      ...res,
    };
  }

  /**
   * Submit website URLs for static HTML extraction and vector ingestion.
   */
  async submitWebsiteIngestionJob(
    auth: AuthContext,
    portfolioReference: string,
    urls: string[]
  ): Promise<any> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);
    const res = await this.ingestionService.submitWebsiteIngestionJob({
      tenantId,
      entityId: entity.id,
      urls,
      portfolioUrl: entity.portfolioUrl || entity.slug,
    });
    return {
      id: res.jobId,
      ...res,
    };
  }


  /**
   * Get ingestion job status for a portfolio
   */
  async getJobStatus(
    auth: AuthContext,
    portfolioReference: string,
    jobId: string
  ): Promise<any> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);
    const job = await this.ingestionService.getJob(tenantId, entity.id, jobId);

    // If website crawl, dynamically synchronize state with crawl job progress
    if (job.sourceType === 'WEBSITE_CRAWL' && this.db.syncCrawlJobAggregates) {
      try {
        const crawl = await this.db.syncCrawlJobAggregates(tenantId, jobId);
        if (crawl) {
          job.totalDocuments = Math.max(job.totalDocuments, crawl.discoveredCount || 0);
          job.processedDocuments = crawl.completedCount || 0;
          job.failedDocuments = crawl.failedCount || 0;
          if (crawl.status === 'completed') {
            job.status = 'READY';
          } else if (crawl.status === 'failed') {
            job.status = 'FAILED';
          } else if (crawl.status === 'discovering' || crawl.status === 'processing_pages') {
            job.status = 'PROCESSING';
          }
        }
      } catch (err: any) {
        logger.warn(`Could not sync crawl aggregates for job ${jobId}: ${err.message}`);
      }
    }

    const documents = await this.ingestionService.getJobDocuments(tenantId, entity.id, jobId);
    return {
      id: job.id,
      jobId: job.id,
      tenantId: job.tenantId,
      entityId: job.entityId,
      status: job.status,
      sourceType: job.sourceType,
      totalDocuments: job.totalDocuments,
      processedDocuments: job.processedDocuments,
      failedDocuments: job.failedDocuments,
      errorSummary: job.errorSummary,
      documents,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  /**
   * Delete a registered portfolio along with its database records and all storage files/folders (in S3 or local storage)
   */
  async deletePortfolio(auth: AuthContext, portfolioReference: string): Promise<{ success: boolean; message: string }> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);

    // 1. Delete all individual document files tracked in DB
    try {
      const documents = await this.db.getDocumentsByEntity(tenantId, entity.id);
      for (const doc of documents) {
        if (doc.objectKey) {
          try {
            await this.storage?.deleteFile(doc.objectKey);
          } catch (err: any) {
            logger.warn(`Could not delete file ${doc.objectKey}: ${err.message}`);
          }
        }
      }
    } catch (err: any) {
      logger.warn(`Error fetching documents for deletion of entity ${entity.id}: ${err.message}`);
    }

    // 2. Delete the entire folder prefix in S3 / local storage
    const folderPrefix = getPortfolioFolderPrefix(entity.portfolioUrl || entity.slug || `${tenantId}/${entity.id}`);
    if (folderPrefix && this.storage?.deleteFolder) {
      try {
        await this.storage.deleteFolder(folderPrefix);
      } catch (err: any) {
        logger.warn(`Failed to delete storage folder prefix "${folderPrefix}": ${err.message}`);
      }
    }

    // 3. Delete the entity from the database (cascades to all jobs, docs, versions, chunks, convs)
    await this.db.deleteEntity(tenantId, entity.id);

    logger.info(`Portal "${entity.name}" (ID: ${entity.id}, URL: ${entity.portfolioUrl}) and storage deleted.`);
    return {
      success: true,
      message: `Portal "${entity.name}" and all associated documents were deleted successfully.`,
    };
  }

  /**
   * Start a multi-page website crawl for a portfolio
   */
  async startWebsiteCrawl(
    auth: AuthContext,
    portfolioReference: string,
    data: { url: string; maxPages?: number; maxDepth?: number; selectedUrls?: string[] }
  ): Promise<any> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);
    return this.ingestionService.startWebsiteCrawl({
      tenantId,
      entityId: entity.id,
      url: data.url,
      portfolioUrl: entity.portfolioUrl || entity.slug,
      config: {
        maxPages: data.maxPages,
        maxDepth: data.maxDepth,
        selectedUrls: data.selectedUrls,
      },
    });
  }

  /**
   * Get a crawl job by ID with all discovered crawl pages
   */
  async getCrawlJob(
    auth: AuthContext,
    portfolioReference: string,
    crawlJobId: string
  ): Promise<any> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);
    const crawlJob = await this.db.getCrawlJob(tenantId, entity.id, crawlJobId);
    if (!crawlJob) {
      throw new NotFoundError('Crawl Job', crawlJobId);
    }
    const pages = await this.db.getCrawlPages(tenantId, crawlJobId);
    return {
      ...crawlJob,
      pages,
    };
  }

  /**
   * List all crawl jobs for a portfolio
   */
  async listCrawlJobs(
    auth: AuthContext,
    portfolioReference: string
  ): Promise<any> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);
    return this.db.listCrawlJobs(tenantId, entity.id);
  }

  /**
   * Retry failed or skipped pages within a crawl job
   */
  async retryCrawlJob(
    auth: AuthContext,
    portfolioReference: string,
    crawlJobId: string,
    pageUrl?: string
  ): Promise<any> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);
    return this.ingestionService.retryCrawlJob({
      tenantId,
      entityId: entity.id,
      crawlJobId,
      pageUrl,
      portfolioUrl: entity.portfolioUrl || entity.slug,
    });
  }

  /**
   * Refetch a website crawl to reconcile updated routes and content
   */
  async refetchCrawl(
    auth: AuthContext,
    portfolioReference: string,
    crawlJobId: string
  ): Promise<any> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);
    return this.ingestionService.refetchWebsiteCrawl({
      tenantId,
      entityId: entity.id,
      crawlJobId,
      portfolioUrl: entity.portfolioUrl || entity.slug,
    });
  }

  /**
   * Check for duplicate sources before ingestion
   */
  async checkDuplicateSource(
    auth: AuthContext,
    portfolioReference: string,
    params: { url?: string; filename?: string }
  ): Promise<{ isDuplicate: boolean; type?: 'website' | 'file'; match?: any }> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);

    if (params.url) {
      const crawls = await this.db.listCrawlJobs(tenantId, entity.id);
      const matchedCrawl = crawls.find(c => {
        try {
          const u1 = new URL(c.rootUrl);
          const u2 = new URL(params.url!);
          return u1.hostname.toLowerCase() === u2.hostname.toLowerCase() && u1.pathname.replace(/\/+$/, '') === u2.pathname.replace(/\/+$/, '');
        } catch {
          return c.rootUrl.toLowerCase() === params.url!.toLowerCase();
        }
      });
      if (matchedCrawl) {
        return {
          isDuplicate: true,
          type: 'website',
          match: {
            id: matchedCrawl.id,
            rootUrl: matchedCrawl.rootUrl,
            status: matchedCrawl.status,
            createdAt: matchedCrawl.createdAt,
          },
        };
      }
    }

    if (params.filename) {
      const docs = await this.documentsService.listDocuments(tenantId, entity.id);
      const matchedDoc = docs.find(d => d.originalFilename.toLowerCase() === params.filename!.toLowerCase());
      if (matchedDoc) {
        return {
          isDuplicate: true,
          type: 'file',
          match: {
            id: matchedDoc.id,
            filename: matchedDoc.originalFilename,
            sizeBytes: matchedDoc.sizeBytes,
            createdAt: matchedDoc.createdAt,
          },
        };
      }
    }

    return { isDuplicate: false };
  }

  /**
   * Discover available routes for a website root URL without starting full page extraction
   */
  async discoverWebsiteRoutes(
    auth: AuthContext,
    portfolioReference: string,
    params: { url: string; maxPages?: number; maxDepth?: number }
  ): Promise<any> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);
    const coordinator = new (await import('../crawler/website-crawl-coordinator.js')).WebsiteCrawlCoordinator(this.db, (this as any).queue || { enqueueUrlDownloadJob: async () => {} } as any);
    return coordinator.discoverRoutesOnly({
      rootUrl: params.url,
      config: {
        maxPages: params.maxPages || 30,
        maxDepth: params.maxDepth || 3,
      },
    });
  }

  /**
   * Delete an entire website crawl job and all associated child pages, documents and storage
   */
  async deleteCrawlJob(
    auth: AuthContext,
    portfolioReference: string,
    crawlJobId: string
  ): Promise<{ success: boolean; message: string }> {
    const { tenantId, entity } = await this.resolvePortfolio(auth, portfolioReference);
    const crawl = await this.db.getCrawlJob(tenantId, entity.id, crawlJobId);
    if (!crawl) {
      throw new (await import('../../shared/errors.js')).NotFoundError('CrawlJob', crawlJobId);
    }

    const pages = await this.db.getCrawlPages(tenantId, crawlJobId);
    for (const page of pages) {
      if (page.documentId) {
        try {
          await this.documentsService.deleteDocument(tenantId, entity.id, page.documentId);
        } catch {
          // ignore
        }
      }
    }

    if ((this.db as any).deleteCrawlJob) {
      await (this.db as any).deleteCrawlJob(tenantId, entity.id, crawlJobId);
    } else {
      await this.db.updateCrawlJob(tenantId, crawlJobId, { status: 'cancelled' });
    }

    return {
      success: true,
      message: `Website extraction for ${crawl.rootUrl} was deleted successfully.`,
    };
  }
}

export const PortalsService = PortfoliosService;
export type PortalsService = PortfoliosService;
