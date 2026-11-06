import path from 'path';
import { IDatabaseAdapter } from '../../adapters/database/database.interface.js';
import { IStorageAdapter } from '../../adapters/storage/storage.interface.js';
import { IQueueAdapter, IngestionMessagePayload } from '../../adapters/queue/queue.interface.js';
import { DocumentsService, buildS3ObjectKey } from '../documents/documents.service.js';
import { ExtractionService } from '../extraction/extraction.service.js';
import { ChunkingService } from '../chunking/chunking.service.js';
import { EmbeddingsService } from '../embeddings/embeddings.service.js';
import { UploadedFileItem, IngestionJobResponse } from './ingestion.types.js';
import { IngestionJob, IngestionJobDocument, UrlIngestionJobResponse, UrlDownloadJobItem, CrawlConfig } from '../../types/index.js';
import { normalizeUrl } from '../crawler/url-normalizer.js';
import { WebsiteCrawlCoordinator } from '../crawler/website-crawl-coordinator.js';
import { NotFoundError } from '../../shared/errors.js';
import { generateUuid, computeSha256 } from '../../shared/utils.js';
import { validateFileOrPhotoUrl } from '../../shared/endpoint-validator.js';
import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';

export class IngestionService {
  constructor(
    private db: IDatabaseAdapter,
    private storage: IStorageAdapter,
    private queue: IQueueAdapter,
    private documentsService: DocumentsService,
    private extractionService: ExtractionService,
    private chunkingService: ChunkingService,
    private embeddingsService: EmbeddingsService
  ) {}

  /**
   * Submit multiple files for ingestion under a specific entity.
   */
  async submitIngestionJob(params: {
    tenantId: string;
    entityId: string;
    files: UploadedFileItem[];
  }): Promise<IngestionJobResponse> {
    const { tenantId, entityId, files } = params;

    if (files.length === 0) {
      throw new Error('At least one file must be provided for ingestion.');
    }

    // 1. Create Ingestion Job record
    const job = await this.db.createIngestionJob({
      tenantId,
      entityId,
      totalDocuments: files.length,
    });

    // 2. Store originals and register document records
    const entity = await this.db.getEntityById(tenantId, entityId);
    const documentIds: string[] = [];
    for (const file of files) {
      const { document } = await this.documentsService.registerAndStoreFile({
        tenantId,
        entityId,
        filename: file.filename,
        mimeType: file.mimeType,
        buffer: file.buffer,
        isPublic: file.isPublic,
        portfolioUrl: entity?.portfolioUrl,
      });

      await this.db.createJobDocument(tenantId, job.id, document.id);
      documentIds.push(document.id);
    }

    // 3. Enqueue job for asynchronous processing
    await this.queue.enqueueIngestionJob({
      tenantId,
      entityId,
      jobId: job.id,
      attempt: 1,
    });

    const statusUrl = `/v1/tenants/${tenantId}/entities/${entityId}/ingestion-jobs/${job.id}`;

    return {
      jobId: job.id,
      entityId,
      tenantId,
      status: job.status,
      totalDocuments: files.length,
      statusUrl,
      createdAt: job.createdAt.toISOString(),
    };
  }

  /**
   * Submit multiple URLs for downloading and subsequent ingestion.
   */
  async submitUrlIngestionJob(params: {
    tenantId: string;
    entityId: string;
    urls: string[];
    portfolioUrl?: string;
  }): Promise<UrlIngestionJobResponse> {
    const { tenantId, entityId, urls, portfolioUrl } = params;

    if (!urls || urls.length === 0) {
      throw new Error('At least one URL must be provided for ingestion.');
    }

    if (urls.length > env.MAX_URLS_PER_BATCH) {
      throw new Error(`Maximum of ${env.MAX_URLS_PER_BATCH} URLs can be submitted per batch.`);
    }

    // Validate that each submitted URL points to a file or photo, rejecting HTML webpages or endpoints
    const sanitizedUrls: string[] = [];
    for (const raw of urls) {
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      if (!trimmed) continue;
      const fileValidation = validateFileOrPhotoUrl(trimmed);
      if (!fileValidation.isValid) {
        throw new Error(`Rejected URL "${trimmed}": ${fileValidation.reason}`);
      }
      sanitizedUrls.push(trimmed);
    }

    if (sanitizedUrls.length === 0) {
      throw new Error('No valid URLs provided.');
    }

    // 1. Create Ingestion Job record with source_type = 'URL_IMPORT'
    const job = await this.db.createIngestionJob({
      tenantId,
      entityId,
      totalDocuments: sanitizedUrls.length,
      sourceType: 'URL_IMPORT',
      metadata: { originalUrls: sanitizedUrls },
    });

    const urlJobItems: UrlDownloadJobItem[] = [];

    // 2. Create job documents and enqueue URL download messages
    for (const url of sanitizedUrls) {
      const documentId = generateUuid();

      let filename = 'downloaded-file';
      try {
        const u = new URL(url);
        filename = path.basename(u.pathname) || 'downloaded-file';
      } catch {
        // fallback
      }

      let folderPrefix = portfolioUrl;
      if (!folderPrefix) {
        const entity = await this.db.getEntityById(tenantId, entityId);
        folderPrefix = entity?.portfolioUrl || entity?.slug || `${tenantId}/${entityId}`;
      }
      const initialObjectKey = buildS3ObjectKey(folderPrefix, filename);
      const initialContentHash = computeSha256(`url:${entityId}:${url}`);

      // Create document record first to satisfy fk_job_doc_document foreign key constraint
      const doc = await this.db.createDocument({
        id: documentId,
        tenantId,
        entityId,
        originalFilename: filename,
        mimeType: 'application/octet-stream',
        sizeBytes: 0,
        contentHash: initialContentHash,
        objectKey: initialObjectKey,
        isPublic: true,
        status: 'PENDING',
        sourceType: 'URL_IMPORT',
      });
      const resolvedDocId = doc.id;

      await this.db.createJobDocument(tenantId, job.id, resolvedDocId, {
        sourceUrl: url,
        stage: 'QUEUED_FOR_DOWNLOAD',
      });

      await this.queue.enqueueUrlDownloadJob({
        tenantId,
        entityId,
        jobId: job.id,
        documentId: resolvedDocId,
        url,
        portfolioUrl,
        attempt: 1,
      });

      urlJobItems.push({
        jobId: job.id,
        documentId: resolvedDocId,
        url,
        status: 'PENDING',
        stage: 'QUEUED_FOR_DOWNLOAD',
      });
    }

    const statusUrl = `/v1/tenants/${tenantId}/entities/${entityId}/ingestion-jobs/${job.id}`;

    return {
      jobId: job.id,
      entityId,
      tenantId,
      status: job.status,
      totalUrls: sanitizedUrls.length,
      urls: urlJobItems,
      statusUrl,
      createdAt: job.createdAt.toISOString(),
    };
  }

  /**
   * Submit website URLs for static HTML extraction and vector ingestion.
   */
  async submitWebsiteIngestionJob(params: {
    tenantId: string;
    entityId: string;
    urls: string[];
    portfolioUrl?: string;
  }): Promise<UrlIngestionJobResponse> {
    const { tenantId, entityId, urls, portfolioUrl } = params;

    if (!urls || urls.length === 0) {
      throw new Error('At least one website URL must be provided for ingestion.');
    }

    if (urls.length > env.MAX_URLS_PER_BATCH) {
      throw new Error(`Maximum of ${env.MAX_URLS_PER_BATCH} website URLs can be submitted per batch.`);
    }

    const sanitizedUrls: string[] = [];
    for (const raw of urls) {
      const trimmed = typeof raw === 'string' ? raw.trim() : '';
      if (!trimmed) continue;
      try {
        const u = new URL(trimmed);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          throw new Error('Only HTTP and HTTPS URLs are allowed.');
        }
        if (u.username || u.password) {
          throw new Error('URLs with embedded credentials are not permitted.');
        }
        sanitizedUrls.push(trimmed);
      } catch (err: any) {
        throw new Error(`Invalid website URL "${trimmed}": ${err.message}`);
      }
    }

    if (sanitizedUrls.length === 0) {
      throw new Error('No valid website URLs provided.');
    }

    // 1. Create Ingestion Job record with source_type = 'WEBSITE_IMPORT'
    const job = await this.db.createIngestionJob({
      tenantId,
      entityId,
      totalDocuments: sanitizedUrls.length,
      sourceType: 'WEBSITE_IMPORT',
      metadata: { originalUrls: sanitizedUrls, sourceType: 'website' },
    });

    const urlJobItems: UrlDownloadJobItem[] = [];

    // 2. Create job documents and enqueue URL download messages with sourceType: 'website'
    for (const url of sanitizedUrls) {
      const documentId = generateUuid();

      let filename = 'webpage.md';
      try {
        const u = new URL(url);
        const hostSlug = u.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
        const pathSlug = u.pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-zA-Z0-9.-]/g, '_') || 'home';
        filename = `${hostSlug}_${pathSlug}.md`;
      } catch {
        // fallback
      }

      let folderPrefix = portfolioUrl;
      if (!folderPrefix) {
        const entity = await this.db.getEntityById(tenantId, entityId);
        folderPrefix = entity?.portfolioUrl || entity?.slug || `${tenantId}/${entityId}`;
      }
      const initialObjectKey = buildS3ObjectKey(folderPrefix, filename);
      const initialContentHash = computeSha256(`website:${entityId}:${url}`);

      const doc = await this.db.createDocument({
        id: documentId,
        tenantId,
        entityId,
        originalFilename: filename,
        mimeType: 'text/markdown',
        sizeBytes: 0,
        contentHash: initialContentHash,
        objectKey: initialObjectKey,
        isPublic: true,
        status: 'PENDING',
        sourceType: 'WEBSITE_IMPORT',
      });
      const resolvedDocId = doc.id;

      await this.db.createJobDocument(tenantId, job.id, resolvedDocId, {
        sourceUrl: url,
        stage: 'QUEUED_FOR_DOWNLOAD',
        downloadMetadata: { sourceType: 'webpage' },
      });

      await this.queue.enqueueUrlDownloadJob({
        tenantId,
        entityId,
        jobId: job.id,
        documentId: resolvedDocId,
        url,
        portfolioUrl,
        sourceType: 'website',
        attempt: 1,
      });

      urlJobItems.push({
        jobId: job.id,
        documentId: resolvedDocId,
        url,
        status: 'PENDING',
        stage: 'QUEUED_FOR_DOWNLOAD',
      });
    }

    const statusUrl = `/v1/tenants/${tenantId}/entities/${entityId}/ingestion-jobs/${job.id}`;

    return {
      jobId: job.id,
      entityId,
      tenantId,
      status: job.status,
      totalUrls: sanitizedUrls.length,
      urls: urlJobItems,
      statusUrl,
      createdAt: job.createdAt.toISOString(),
    };
  }

  /**
   * Process an S3 ObjectCreated event notification routed from Ingestion SQS queue.
   */
  async processS3ObjectCreated(objectKey: string): Promise<void> {
    logger.info(`[IngestionWorker] Processing S3 ObjectCreated event for key: "${objectKey}"`);

    // Look up document in database by objectKey
    const document = await this.db.getDocumentByObjectKey(objectKey);
    if (!document) {
      logger.info(`[IngestionWorker] No document found for S3 key "${objectKey}". Skipping safely.`);
      return;
    }

    const { tenantId, entityId, id: documentId } = document;

    // Check if already processed (idempotency)
    if (document.status === 'READY') {
      logger.info(`[IngestionWorker] Document ${documentId} (${objectKey}) is already READY. Skipping duplicate S3 event.`);
      return;
    }

    // Find the associated ingestion job document
    const jobDoc = await this.db.getJobDocumentByDocumentId(documentId);
    const jobId = jobDoc?.jobId || 's3-event-job';

    if (jobDoc) {
      await this.db.updateJobDocumentStage(tenantId, jobId, documentId, 'PROCESSING');
    }

    // Process document through RAG pipeline
    try {
      await this.processSingleDocument(tenantId, entityId, jobId, documentId);
    } catch (err: any) {
      const errMsg = err?.message || 'Processing failed';
      logger.error(`[IngestionWorker] Error processing S3 document ${documentId}: ${errMsg}`);
      await this.db.updateDocumentStatus(tenantId, documentId, 'FAILED', errMsg);
      if (jobDoc && jobDoc.jobId) {
        await this.db.updateJobDocumentStatus(tenantId, jobDoc.jobId, documentId, 'FAILED', errMsg);
      }
      if (this.db.getCrawlPageByDocumentId) {
        const crawlPage = await this.db.getCrawlPageByDocumentId(tenantId, documentId);
        if (crawlPage) {
          await this.db.updateCrawlPage(tenantId, crawlPage.crawlJobId, crawlPage.id, {
            status: 'failed',
            stage: 'FAILED',
            errorMessage: errMsg,
          });
          if (this.db.syncCrawlJobAggregates) {
            await this.db.syncCrawlJobAggregates(tenantId, crawlPage.crawlJobId);
          }
        }
      }
      throw err;
    }

    // If part of an ingestion job, verify if the overall job status can be updated to READY
    if (jobDoc && jobDoc.jobId) {
      const allDocs = await this.db.getJobDocuments(tenantId, jobDoc.jobId);
      const readyDocs = allDocs.filter(d => d.status === 'READY');
      const failedDocs = allDocs.filter(d => d.status === 'FAILED');

      if (readyDocs.length + failedDocs.length === allDocs.length && allDocs.length > 0) {
        const finalStatus = failedDocs.length === allDocs.length ? 'FAILED' : 'READY';
        await this.db.updateJobStatus(tenantId, jobDoc.jobId, finalStatus, {
          processed: readyDocs.length,
          failed: failedDocs.length,
        });
        logger.info(`[IngestionWorker] Ingestion job ${jobDoc.jobId} updated to ${finalStatus}`);
      }
    }
  }

  /**
   * Worker processor: process all documents in an ingestion job
   */
  async processJob(payload: IngestionMessagePayload): Promise<void> {
    if (!payload || !payload.jobId) {
      logger.warn(`[IngestionWorker] Skipping message without valid jobId: ${JSON.stringify(payload)}`);
      return;
    }

    const { tenantId, entityId, jobId } = payload;
    logger.info(`[IngestionWorker] Starting ingestion job processing: ${jobId} (entity: ${entityId}, tenant: ${tenantId})`);

    const job = await this.db.getJobById(tenantId, entityId, jobId);
    if (!job) {
      logger.error(`[IngestionWorker] Job ${jobId} not found in database for entity ${entityId}. Skipping safely.`);
      return;
    }

    logger.info(`[IngestionWorker] Job ${jobId} current status is "${job.status}". Updating to "PROCESSING"...`);
    await this.db.updateJobStatus(tenantId, jobId, 'PROCESSING');

    const jobDocs = await this.db.getJobDocuments(tenantId, jobId);
    logger.info(`[IngestionWorker] Job ${jobId} contains ${jobDocs.length} document(s) to process.`);
    let processedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    const targetDocId = typeof payload === 'object' ? payload?.documentId : undefined;

    for (let i = 0; i < jobDocs.length; i++) {
      const jd = jobDocs[i];
      if (targetDocId && jd.documentId !== targetDocId) {
        continue;
      }
      // If this is a URL/webpage source document that hasn't finished downloading to S3 yet, wait for download
      if (jd.sourceUrl && jd.stage !== 'UPLOADED_TO_S3' && jd.status !== 'READY') {
        continue;
      }

      logger.info(`[IngestionWorker] [${i + 1}/${jobDocs.length}] Processing document ID: ${jd.documentId}`);
      try {
        await this.processSingleDocument(tenantId, entityId, jobId, jd.documentId);
        processedCount++;
        logger.info(`[IngestionWorker] [${i + 1}/${jobDocs.length}] Successfully processed document ID: ${jd.documentId}`);
      } catch (err: any) {
        failedCount++;
        const errMsg = err?.message || 'Processing failed';
        errors.push(`Document ${jd.documentId}: ${errMsg}`);
        logger.error(`[IngestionWorker] [${i + 1}/${jobDocs.length}] Failed to process document ${jd.documentId}:`, err);
        await this.db.updateJobDocumentStatus(tenantId, jobId, jd.documentId, 'FAILED', errMsg);
        await this.db.updateDocumentStatus(tenantId, jd.documentId, 'FAILED', errMsg);
        if (this.db.getCrawlPageByDocumentId) {
          const crawlPage = await this.db.getCrawlPageByDocumentId(tenantId, jd.documentId);
          if (crawlPage) {
            await this.db.updateCrawlPage(tenantId, crawlPage.crawlJobId, crawlPage.id, {
              status: 'failed',
              stage: 'FAILED',
              errorMessage: errMsg,
            });
            if (this.db.syncCrawlJobAggregates) {
              await this.db.syncCrawlJobAggregates(tenantId, crawlPage.crawlJobId);
            }
          }
        }
      }
    }

    const updatedJobDocs = await this.db.getJobDocuments(tenantId, jobId);
    const hasPendingDownloads = updatedJobDocs.some(d => 
      Boolean(d.sourceUrl) && (
        d.stage === 'QUEUED_FOR_DOWNLOAD' || 
        d.stage === 'DOWNLOADING' || 
        d.stage === 'FETCHING_PAGE' || 
        d.stage === 'EXTRACTING_CONTENT'
      )
    );

    const readyDocs = updatedJobDocs.filter(d => d.status === 'READY');
    const failedDocs = updatedJobDocs.filter(d => d.status === 'FAILED');
    const isAllTerminal =
      updatedJobDocs.length > 0 &&
      readyDocs.length + failedDocs.length === updatedJobDocs.length;

    const hasPendingDocs =
      hasPendingDownloads ||
      updatedJobDocs.some(
        d =>
          d.status === 'PENDING' ||
          d.status === 'PROCESSING' ||
          d.stage === 'UPLOADED_TO_S3' ||
          d.stage === 'QUEUED_FOR_DOWNLOAD' ||
          d.stage === 'DOWNLOADING' ||
          d.stage === 'FETCHING_PAGE' ||
          d.stage === 'EXTRACTING_CONTENT'
      );

    if (isAllTerminal && !hasPendingDocs) {
      const finalStatus = failedDocs.length === updatedJobDocs.length && updatedJobDocs.length > 0 ? 'FAILED' : 'READY';
      await this.db.updateJobStatus(tenantId, jobId, finalStatus, {
        processed: readyDocs.length,
        failed: failedDocs.length,
        errorSummary: errors.length > 0 ? errors.join('; ') : undefined,
      });
      logger.info(`[IngestionWorker] Completed job ${jobId}. Final Status: ${finalStatus}. Processed: ${readyDocs.length}, Failed: ${failedDocs.length}`);
    } else {
      await this.db.updateJobStatus(tenantId, jobId, 'PROCESSING', {
        processed: readyDocs.length,
        failed: failedDocs.length,
      });
    }
  }

  /**
   * Process a single document through extraction, chunking, embeddings, and indexing.
   */
  async processSingleDocument(tenantId: string, entityId: string, jobId: string, documentId: string, options?: { versionId?: string }): Promise<void> {
    logger.info(`[DocPipeline] Fetching document metadata for ${documentId}...`);
    const document = await this.documentsService.getDocument(tenantId, entityId, documentId);

    // If document is already READY (idempotent duplicate submission), check if it contains legacy placeholder stub chunks
    if (document.status === 'READY' && !options?.versionId) {
      let isStubbedImage = false;
      if (document.mimeType && document.mimeType.startsWith('image/')) {
        try {
          if (typeof (this.db as any).hasPlaceholderChunks === 'function') {
            isStubbedImage = await (this.db as any).hasPlaceholderChunks(tenantId, documentId);
          }
        } catch (err: any) {
          logger.warn(`[DocPipeline] Error checking placeholder chunks: ${err?.message}`);
        }
      }

      if (!isStubbedImage) {
        logger.info(`[DocPipeline] Document ${documentId} is already READY. Skipping extraction.`);
        await this.db.updateJobDocumentStatus(tenantId, jobId, documentId, 'READY');
        return;
      }
      logger.info(`[DocPipeline] Document ${documentId} contains legacy placeholder OCR stub. Triggering live image re-extraction...`);
    }

    await this.db.updateDocumentStatus(tenantId, documentId, 'PROCESSING');
    await this.db.updateJobDocumentStatus(tenantId, jobId, documentId, 'PROCESSING');

    // 1. Download original file
    logger.info(`[DocPipeline] Step 1/6: Downloading file from storage (key: "${document.objectKey}")...`);
    const fileBuffer = await this.storage.downloadFile(document.objectKey);
    logger.info(`[DocPipeline] Step 1/6: File downloaded successfully (${fileBuffer.length} bytes).`);

    // Ensure accurate sizeBytes in database if it was 0 or unrecorded
    if ((!document.sizeBytes || Number(document.sizeBytes) === 0) && fileBuffer.length > 0) {
      if (this.db.updateDocumentMetadata) {
        await this.db.updateDocumentMetadata(tenantId, documentId, {
          sizeBytes: fileBuffer.length,
        });
      }
    }

    // 2. Extract text & structure
    logger.info(`[DocPipeline] Step 2/6: Extracting text from "${document.originalFilename}" (${document.mimeType})...`);
    const extraction = await this.extractionService.extractText(
      fileBuffer,
      document.mimeType,
      document.originalFilename
    );

    if (!extraction.text || extraction.text.trim().length === 0) {
      throw new Error('Extracted text is empty');
    }
    logger.info(`[DocPipeline] Step 2/6: Extracted ${extraction.text.length} characters of text.`);

    // 3. Chunk extracted content
    logger.info(`[DocPipeline] Step 3/6: Chunking extracted text...`);
    const jobDoc = await this.db.getJobDocumentByDocumentId(documentId);
    const isWebpage =
      jobDoc?.downloadMetadata?.sourceType === 'webpage' ||
      document.sourceType === 'WEBSITE_IMPORT' ||
      document.sourceType === 'WEBSITE_CRAWL' ||
      (document.mimeType === 'text/markdown' && Boolean(jobDoc?.sourceUrl));

    const chunkMetadata: Record<string, any> = {
      ...(extraction.metadata || {}),
      ...(isWebpage
        ? {
            sourceType: 'webpage',
            sourceUrl: jobDoc?.sourceUrl || jobDoc?.downloadMetadata?.canonicalUrl,
            canonicalUrl: jobDoc?.downloadMetadata?.canonicalUrl || jobDoc?.sourceUrl,
            title: jobDoc?.downloadMetadata?.title || document.originalFilename,
          }
        : {
            sourceType: jobDoc?.sourceUrl ? 'url_file' : 'file',
            sourceUrl: jobDoc?.sourceUrl,
          }),
    };

    const targetVersionId = options?.versionId;
    const unindexedChunks = this.chunkingService.chunkExtractedContent(
      {
        ...extraction,
        metadata: chunkMetadata,
      },
      {
        tenantId,
        entityId,
        documentId,
        versionId: targetVersionId,
      }
    );

    if (unindexedChunks.length === 0) {
      throw new Error('No chunks generated from extracted text');
    }
    logger.info(`[DocPipeline] Step 3/6: Generated ${unindexedChunks.length} chunks.`);

    // 4. Generate embeddings in batches
    logger.info(`[DocPipeline] Step 4/6: Generating vector embeddings for ${unindexedChunks.length} chunks...`);
    const embeddedChunks = await this.embeddingsService.attachEmbeddings(unindexedChunks);
    logger.info(`[DocPipeline] Step 4/6: Embeddings generated successfully.`);

    // 5. Index chunks in database
    logger.info(`[DocPipeline] Step 5/6: Storing chunks in PostgreSQL database...`);
    if (!targetVersionId) {
      await this.db.deleteChunksByDocument(tenantId, documentId);
    }
    await this.db.insertChunks(embeddedChunks);
    logger.info(`[DocPipeline] Step 5/6: Inserted ${embeddedChunks.length} chunks into database.`);

    // 6. Mark document as READY & activate version atomically
    logger.info(`[DocPipeline] Step 6/6: Marking document ${documentId} as READY.`);
    if (targetVersionId) {
      await this.db.activateDocumentVersion(tenantId, documentId, targetVersionId, {
        contentHash: document.contentHash,
        objectKey: document.objectKey,
        sizeBytes: Number(document.sizeBytes) || fileBuffer.length,
      });
    } else {
      await this.db.updateDocumentStatus(tenantId, documentId, 'READY');
    }
    await this.db.updateJobDocumentStatus(tenantId, jobId, documentId, 'READY');

    // Sync crawl page status and crawl job aggregates if document belongs to a website crawl
    if (this.db.getCrawlPageByDocumentId) {
      const crawlPage = await this.db.getCrawlPageByDocumentId(tenantId, documentId);
      if (crawlPage) {
        await this.db.updateCrawlPage(tenantId, crawlPage.crawlJobId, crawlPage.id, {
          status: 'completed',
          stage: 'READY',
        });
        if (this.db.syncCrawlJobAggregates) {
          await this.db.syncCrawlJobAggregates(tenantId, crawlPage.crawlJobId);
        }
      }
    }

    // Reconcile overall ingestion job status if all documents in the job have reached terminal state
    try {
      const updatedJobDocs = await this.db.getJobDocuments(tenantId, jobId);
      const readyDocs = updatedJobDocs.filter(d => d.status === 'READY');
      const failedDocs = updatedJobDocs.filter(d => d.status === 'FAILED');
      const isAllTerminal =
        updatedJobDocs.length > 0 &&
        readyDocs.length + failedDocs.length === updatedJobDocs.length;

      if (isAllTerminal) {
        const finalStatus = failedDocs.length === updatedJobDocs.length ? 'FAILED' : 'READY';
        await this.db.updateJobStatus(tenantId, jobId, finalStatus, {
          processed: readyDocs.length,
          failed: failedDocs.length,
        });
        logger.info(`[DocPipeline] Ingestion job ${jobId} updated to final status: ${finalStatus} (${readyDocs.length} ready, ${failedDocs.length} failed)`);
      }
    } catch (jobErr: any) {
      logger.warn(`[DocPipeline] Could not reconcile job ${jobId} status: ${jobErr?.message}`);
    }
  }

  async getJob(tenantId: string, entityId: string, jobId: string): Promise<IngestionJob> {
    const job = await this.db.getJobById(tenantId, entityId, jobId);
    if (!job) throw new NotFoundError('IngestionJob', jobId);
    return job;
  }

  async getJobDocuments(tenantId: string, entityId: string, jobId: string): Promise<IngestionJobDocument[]> {
    await this.getJob(tenantId, entityId, jobId); // verify exists and access
    return this.db.getJobDocuments(tenantId, jobId);
  }
  /**
   * Start a multi-page website crawl for a root website URL.
   */
  async startWebsiteCrawl(params: {
    tenantId: string;
    entityId: string;
    url: string;
    portfolioUrl?: string;
    config?: CrawlConfig;
  }): Promise<{
    crawlJobId: string;
    jobId: string;
    entityId: string;
    tenantId: string;
    status: string;
    rootUrl: string;
    statusUrl: string;
    createdAt: string;
  }> {
    const { tenantId, entityId, url, portfolioUrl, config } = params;
    const normalizedRoot = normalizeUrl(url);
    if (!normalizedRoot) {
      throw new Error(`Invalid website root URL: "${url}". Please enter a valid HTTP or HTTPS URL.`);
    }

    const crawlJobId = generateUuid();

    // 1. Create Ingestion Job record with source_type = 'WEBSITE_CRAWL'
    await this.db.createIngestionJob({
      id: crawlJobId,
      tenantId,
      entityId,
      totalDocuments: 1,
      sourceType: 'WEBSITE_CRAWL',
      metadata: { rootUrl: normalizedRoot, config: config || {}, sourceType: 'website_crawl' },
    });

    // 2. Create Crawl Job record
    const crawlJob = await this.db.createCrawlJob({
      id: crawlJobId,
      tenantId,
      entityId,
      rootUrl: normalizedRoot,
      config: config || {},
    });

    // 3. Enqueue crawl coordinator message to download queue
    await this.queue.enqueueUrlDownloadJob({
      tenantId,
      entityId,
      jobId: crawlJobId,
      url: normalizedRoot,
      portfolioUrl,
      sourceType: 'website_crawl',
      action: 'WEBSITE_CRAWL',
      attempt: 1,
    });

    // 4. In local mode, invoke coordinator discovery
    const isLocal =
      env.STORAGE_ADAPTER === 'local' ||
      env.QUEUE_ADAPTER === 'local' ||
      this.storage.constructor.name === 'LocalStorageAdapter' ||
      this.queue.constructor.name === 'LocalQueueAdapter';

    if (isLocal && (this.queue as any).isAutoProcess !== false) {
      setImmediate(async () => {
        try {
          const coordinator = new WebsiteCrawlCoordinator(this.db, this.queue);
          await coordinator.executeDiscovery({
            tenantId,
            entityId,
            crawlJobId,
            rootUrl: normalizedRoot,
            portfolioUrl,
            config,
          });
        } catch (err: any) {
          logger.error(`[IngestionService:Crawl] Local coordinator discovery error:`, err);
        }
      });
    }

    return {
      crawlJobId: crawlJob.id,
      jobId: crawlJob.id,
      entityId,
      tenantId,
      status: 'queued',
      rootUrl: normalizedRoot,
      statusUrl: `/v1/portals/${entityId}/crawls/${crawlJob.id}`,
      createdAt: crawlJob.createdAt.toISOString(),
    };
  }

  /**
   * Refetch a previously submitted website crawl source and reconcile updated routes.
   */
  async refetchWebsiteCrawl(params: {
    tenantId: string;
    entityId: string;
    crawlJobId: string;
    portfolioUrl?: string;
  }): Promise<{
    crawlJobId: string;
    jobId: string;
    entityId: string;
    tenantId: string;
    status: string;
    rootUrl: string;
    statusUrl: string;
  }> {
    const { tenantId, entityId, crawlJobId, portfolioUrl } = params;
    const crawlJob = await this.db.getCrawlJob(tenantId, entityId, crawlJobId);
    if (!crawlJob) {
      throw new NotFoundError('Crawl Job', crawlJobId);
    }

    // 1. Mark crawl job as discovering / refetching
    await this.db.updateCrawlJob(tenantId, crawlJobId, {
      status: 'discovering',
      refetchStatus: 'refetching',
      lastRefetchedAt: new Date(),
      unchangedCount: 0,
      changedCount: 0,
      newlyDiscoveredCount: 0,
    });

    // 2. Mark paired ingestion job as PROCESSING
    await this.db.updateJobStatus(tenantId, crawlJobId, 'PROCESSING');

    // 3. Enqueue crawl coordinator message to download queue
    await this.queue.enqueueUrlDownloadJob({
      tenantId,
      entityId,
      jobId: crawlJobId,
      url: crawlJob.rootUrl,
      portfolioUrl,
      sourceType: 'website_crawl',
      action: 'WEBSITE_CRAWL',
      attempt: 1,
    });

    // 4. In local mode, invoke coordinator discovery
    const isLocal =
      env.STORAGE_ADAPTER === 'local' ||
      env.QUEUE_ADAPTER === 'local' ||
      this.storage.constructor.name === 'LocalStorageAdapter' ||
      this.queue.constructor.name === 'LocalQueueAdapter';

    if (isLocal && (this.queue as any).isAutoProcess !== false) {
      setImmediate(async () => {
        try {
          const coordinator = new WebsiteCrawlCoordinator(this.db, this.queue);
          await coordinator.executeDiscovery({
            tenantId,
            entityId,
            crawlJobId,
            rootUrl: crawlJob.rootUrl,
            portfolioUrl,
            config: crawlJob.config,
          });
        } catch (err: any) {
          logger.error(`[IngestionService:Refetch] Local coordinator discovery error:`, err);
        }
      });
    }

    return {
      crawlJobId: crawlJob.id,
      jobId: crawlJob.id,
      entityId,
      tenantId,
      status: 'discovering',
      rootUrl: crawlJob.rootUrl,
      statusUrl: `/v1/portals/${entityId}/crawls/${crawlJob.id}`,
    };
  }

  /**
   * Retry failed or skipped pages within an existing crawl job.
   */
  async retryCrawlJob(params: {
    tenantId: string;
    entityId: string;
    crawlJobId: string;
    pageUrl?: string;
    portfolioUrl?: string;
  }): Promise<{ message: string; retriedCount: number }> {
    const { tenantId, entityId, crawlJobId, pageUrl, portfolioUrl } = params;
    const crawlJob = await this.db.getCrawlJob(tenantId, entityId, crawlJobId);
    if (!crawlJob) {
      throw new NotFoundError('Crawl Job', crawlJobId);
    }

    const pages = await this.db.getCrawlPages(tenantId, crawlJobId);
    const pagesToRetry = pages.filter(p => {
      if (pageUrl && p.originalUrl !== pageUrl && p.normalizedUrl !== pageUrl) return false;
      return p.status === 'failed' || p.status === 'skipped';
    });

    if (pagesToRetry.length === 0) {
      return { message: 'No eligible failed or skipped pages to retry.', retriedCount: 0 };
    }

    for (const page of pagesToRetry) {
      await this.db.updateCrawlPage(tenantId, crawlJobId, page.id, {
        status: 'queued',
        stage: 'QUEUED_FOR_DOWNLOAD',
        errorMessage: undefined,
        retryCount: (page.retryCount || 0) + 1,
      });

      await this.queue.enqueueUrlDownloadJob({
        tenantId,
        entityId,
        jobId: crawlJobId,
        documentId: page.documentId,
        url: page.normalizedUrl,
        portfolioUrl,
        sourceType: 'website',
        crawlJobId,
        depth: page.depth,
        action: 'WEBSITE_PAGE',
        attempt: (page.retryCount || 0) + 1,
      });
    }

    await this.db.updateCrawlJob(tenantId, crawlJobId, {
      status: 'processing_pages',
      failedCount: Math.max(0, crawlJob.failedCount - pagesToRetry.length),
    });

    if (this.db.syncCrawlJobAggregates) {
      await this.db.syncCrawlJobAggregates(tenantId, crawlJobId);
    }

    return {
      message: `Successfully re-queued ${pagesToRetry.length} page(s) for crawling.`,
      retriedCount: pagesToRetry.length,
    };
  }
}
