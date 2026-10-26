import { IDatabaseAdapter } from '../../adapters/database/database.interface.js';
import { IStorageAdapter } from '../../adapters/storage/storage.interface.js';
import { IQueueAdapter, IngestionMessagePayload } from '../../adapters/queue/queue.interface.js';
import { DocumentsService } from '../documents/documents.service.js';
import { ExtractionService } from '../extraction/extraction.service.js';
import { ChunkingService } from '../chunking/chunking.service.js';
import { EmbeddingsService } from '../embeddings/embeddings.service.js';
import { UploadedFileItem, IngestionJobResponse } from './ingestion.types.js';
import { IngestionJob, IngestionJobDocument } from '../../types/index.js';
import { NotFoundError } from '../../shared/errors.js';
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

    for (let i = 0; i < jobDocs.length; i++) {
      const jd = jobDocs[i];
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
      }
    }

    const finalStatus = failedCount === jobDocs.length && jobDocs.length > 0 ? 'FAILED' : 'READY';
    await this.db.updateJobStatus(tenantId, jobId, finalStatus, {
      processed: processedCount,
      failed: failedCount,
      errorSummary: errors.length > 0 ? errors.join('; ') : undefined,
    });

    logger.info(`[IngestionWorker] Completed job ${jobId}. Final Status: ${finalStatus}. Processed: ${processedCount}, Failed: ${failedCount}`);
  }

  /**
   * Process a single document through extraction, chunking, embeddings, and indexing.
   */
  async processSingleDocument(tenantId: string, entityId: string, jobId: string, documentId: string): Promise<void> {
    logger.info(`[DocPipeline] Fetching document metadata for ${documentId}...`);
    const document = await this.documentsService.getDocument(tenantId, entityId, documentId);

    // If document is already READY (idempotent duplicate submission), check if it contains legacy placeholder stub chunks
    if (document.status === 'READY') {
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
    const unindexedChunks = this.chunkingService.chunkExtractedContent(extraction, {
      tenantId,
      entityId,
      documentId,
    });

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
    await this.db.deleteChunksByDocument(tenantId, documentId);
    await this.db.insertChunks(embeddedChunks);
    logger.info(`[DocPipeline] Step 5/6: Inserted ${embeddedChunks.length} chunks into database.`);

    // 6. Mark document as READY
    logger.info(`[DocPipeline] Step 6/6: Marking document ${documentId} as READY.`);
    await this.db.updateDocumentStatus(tenantId, documentId, 'READY');
    await this.db.updateJobDocumentStatus(tenantId, jobId, documentId, 'READY');
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
}

