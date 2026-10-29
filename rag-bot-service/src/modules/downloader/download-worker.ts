import { IDatabaseAdapter } from '../../adapters/database/database.interface.js';
import { IStorageAdapter } from '../../adapters/storage/storage.interface.js';
import { IQueueAdapter, UrlDownloadMessagePayload } from '../../adapters/queue/queue.interface.js';
import { SecureDownloader, DownloadError } from './secure-downloader.js';
import { buildS3ObjectKey } from '../documents/documents.service.js';
import { computeSha256 } from '../../shared/utils.js';
import { redactUrlForLogging } from '../../shared/ssrf-validator.js';
import { logger } from '../../shared/logger.js';
import { env } from '../../config/env.js';

export class DownloadWorker {
  private downloader: SecureDownloader;

  constructor(
    private db: IDatabaseAdapter,
    private storage: IStorageAdapter,
    private queue: IQueueAdapter
  ) {
    this.downloader = new SecureDownloader();
  }

  /**
   * Process a single URL download task received from the URL Download Queue.
   */
  async processDownloadJob(payload: UrlDownloadMessagePayload): Promise<void> {
    const { tenantId, entityId, jobId, documentId, url, portfolioUrl } = payload;
    const safeUrl = redactUrlForLogging(url);
    logger.info(`[DownloadWorker] Received download job for document ${documentId} (job: ${jobId}, URL: ${safeUrl})`);

    // 1. Verify Job and JobDocument eligibility from trusted database records
    const job = await this.db.getJobById(tenantId, entityId, jobId);
    if (!job) {
      logger.warn(`[DownloadWorker] Ingestion job ${jobId} not found in database. Skipping message.`);
      return;
    }

    const jobDoc = await this.db.getJobDocumentByDocumentId(documentId);
    if (jobDoc && (jobDoc.stage === 'UPLOADED_TO_S3' || jobDoc.status === 'READY')) {
      logger.info(`[DownloadWorker] Document ${documentId} has already been downloaded/processed (stage: ${jobDoc.stage}, status: ${jobDoc.status}). Skipping (idempotent).`);
      return;
    }

    // 2. Mark stage as DOWNLOADING
    await this.db.updateJobDocumentStage(tenantId, jobId, documentId, 'DOWNLOADING');

    try {
      // 3. Securely download and validate file
      logger.info(`[DownloadWorker] Starting secure download: ${safeUrl}...`);
      const downloadResult = await this.downloader.download(url);
      logger.info(
        `[DownloadWorker] Download successful: ${downloadResult.filename} (${downloadResult.sizeBytes} bytes, ${downloadResult.mimeType})`
      );

      // 4. Compute content hash and server-controlled object key
      const contentHash = computeSha256(downloadResult.buffer);
      let folderPrefix = portfolioUrl;
      if (!folderPrefix) {
        const entity = await this.db.getEntityById(tenantId, entityId);
        folderPrefix = entity?.portfolioUrl || entity?.slug || `${tenantId}/${entityId}`;
      }
      const objectKey = buildS3ObjectKey(folderPrefix, downloadResult.filename);

      // 5. Check if document already exists with this content hash in this entity (deduplication)
      const existingDoc = await this.db.getDocumentByHash(entityId, contentHash);
      let finalDocId = documentId;

      if (existingDoc && existingDoc.id !== documentId) {
        logger.info(`[DownloadWorker] Document with hash ${contentHash} already exists (ID: ${existingDoc.id}). Linking existing document.`);
        finalDocId = existingDoc.id;
        // Update job document reference to point to the existing processed document
        await this.db.updateJobDocumentStage(tenantId, jobId, documentId, 'UPLOADED_TO_S3', undefined, {
          finalUrl: downloadResult.finalUrl,
          sizeBytes: downloadResult.sizeBytes,
          mimeType: downloadResult.mimeType,
          isDuplicate: true,
        });
        // Remove redundant placeholder document so it doesn't leave an empty 0-byte orphan row in portal
        try {
          await this.db.deleteDocument(tenantId, entityId, documentId);
        } catch {
          // ignore
        }
      } else {
        // 6. Upload original file to S3
        logger.info(`[DownloadWorker] Uploading downloaded file to storage (key: "${objectKey}")...`);
        await this.storage.uploadFile(objectKey, downloadResult.buffer, downloadResult.mimeType);

        // 7. Persist or update document in database
        const existingDocById = await this.db.getDocumentById(tenantId, entityId, documentId);
        if (existingDocById) {
          if (this.db.updateDocumentMetadata) {
            await this.db.updateDocumentMetadata(tenantId, documentId, {
              originalFilename: downloadResult.filename,
              mimeType: downloadResult.mimeType,
              sizeBytes: downloadResult.sizeBytes,
              contentHash,
              objectKey,
              status: 'PENDING',
            });
          } else {
            await this.db.updateDocumentStatus(tenantId, documentId, 'PENDING');
          }
        } else {
          await this.db.createDocument({
            id: documentId,
            tenantId,
            entityId,
            originalFilename: downloadResult.filename,
            mimeType: downloadResult.mimeType,
            sizeBytes: downloadResult.sizeBytes,
            contentHash,
            objectKey,
            isPublic: true,
            status: 'PENDING',
          });
        }

        try {
          await this.db.createDocumentVersion({
            tenantId,
            entityId,
            documentId,
            versionNumber: 1,
            contentHash,
            objectKey,
            sizeBytes: downloadResult.sizeBytes,
          });
        } catch {
          // Version 1 may already exist if retried
        }

        // 8. Mark stage as UPLOADED_TO_S3 without completing the entire ingestion job
        await this.db.updateJobDocumentStage(tenantId, jobId, documentId, 'UPLOADED_TO_S3', undefined, {
          finalUrl: downloadResult.finalUrl,
          sizeBytes: downloadResult.sizeBytes,
          mimeType: downloadResult.mimeType,
          objectKey,
        });
      }

      // 9. When running in local mode (where S3 bucket event notifications don't exist),
      // bridge directly into the ingestion queue so the local pipeline completes end-to-end.
      if (env.STORAGE_ADAPTER === 'local' || env.QUEUE_ADAPTER === 'local') {
        logger.info(`[DownloadWorker] Local mode detected: Forwarding job ${jobId} to Ingestion Queue.`);
        await this.queue.enqueueIngestionJob({
          tenantId,
          entityId,
          jobId,
          documentId: finalDocId,
          attempt: 1,
        });
      } else {
        logger.info(`[DownloadWorker] S3 upload complete for key "${objectKey}". S3 ObjectCreated notification will route to Ingestion Queue.`);
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Download failed';
      logger.error(`[DownloadWorker] Failed to download URL for doc ${documentId}: ${errMsg}`);

      await this.db.updateJobDocumentStage(tenantId, jobId, documentId, 'DOWNLOAD_FAILED', errMsg);
      await this.db.updateDocumentStatus(tenantId, documentId, 'FAILED', errMsg);

      // Check if all documents in the job failed
      const allJobDocs = await this.db.getJobDocuments(tenantId, jobId);
      const allFailed = allJobDocs.length > 0 && allJobDocs.every(d => d.stage === 'DOWNLOAD_FAILED' || d.status === 'FAILED');
      if (allFailed) {
        await this.db.updateJobStatus(tenantId, jobId, 'FAILED', {
          failed: allJobDocs.length,
          errorSummary: errMsg,
        });
      }
      throw err;
    }
  }
}

