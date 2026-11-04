import { IDatabaseAdapter } from '../../adapters/database/database.interface.js';
import { IStorageAdapter } from '../../adapters/storage/storage.interface.js';
import { IQueueAdapter, UrlDownloadMessagePayload } from '../../adapters/queue/queue.interface.js';
import { IngestionService } from '../ingestion/ingestion.service.js';
import { SecureDownloader, DownloadError } from './secure-downloader.js';
import { StaticWebsiteExtractor, WebsiteExtractionError } from './static-website-extractor.js';
import { WebsiteCrawlCoordinator } from '../crawler/website-crawl-coordinator.js';
import { buildS3ObjectKey } from '../documents/documents.service.js';
import { computeSha256, generateUuid } from '../../shared/utils.js';
import { redactUrlForLogging } from '../../shared/ssrf-validator.js';
import { normalizeUrl, isAllowedOrigin, isExcludedUrl } from '../crawler/url-normalizer.js';
import { logger } from '../../shared/logger.js';
import { env } from '../../config/env.js';

export class DownloadWorker {
  private downloader: SecureDownloader;
  private websiteExtractor: StaticWebsiteExtractor;

  constructor(
    private db: IDatabaseAdapter,
    private storage: IStorageAdapter,
    private queue: IQueueAdapter,
    private ingestionService?: IngestionService
  ) {
    this.downloader = new SecureDownloader();
    this.websiteExtractor = new StaticWebsiteExtractor();
  }

  /**
   * Process a single URL download or website extraction task.
   */
  async processDownloadJob(payload: UrlDownloadMessagePayload): Promise<void> {
    const { tenantId, entityId, jobId, url, portfolioUrl } = payload;
    const safeUrl = redactUrlForLogging(url);

    // 1. Verify Job and JobDocument eligibility from trusted database records
    const job = await this.db.getJobById(tenantId, entityId, jobId);
    if (!job) {
      logger.warn(`[DownloadWorker] Ingestion job ${jobId} not found in database. Skipping message.`);
      return;
    }

    // Check if this is a parent crawl coordinator message:
    // Only the explicit WEBSITE_CRAWL / crawl_coordinator operation executes discovery!
    const isCrawlCoordinatorAction =
      payload.action === 'WEBSITE_CRAWL' ||
      payload.action === 'crawl_coordinator' ||
      (!payload.action && !payload.documentId && (payload.sourceType === 'website_crawl' || job.sourceType === 'WEBSITE_CRAWL'));

    if (isCrawlCoordinatorAction) {
      logger.info(`[DownloadWorker] Executing parent crawl coordinator for root URL ${safeUrl} (crawlJob: ${jobId})`);
      const coordinator = new WebsiteCrawlCoordinator(this.db, this.queue);
      await coordinator.executeDiscovery({
        tenantId,
        entityId,
        crawlJobId: jobId,
        rootUrl: url,
        portfolioUrl,
        config: job.metadata?.config,
      });
      return;
    }

    if (!payload.documentId) {
      logger.warn(`[DownloadWorker] Missing documentId for download job ${jobId}. Skipping.`);
      return;
    }
    const documentId: string = payload.documentId;
    logger.info(`[DownloadWorker] Received download job for document ${documentId} (job: ${jobId}, URL: ${safeUrl})`);

    const jobDoc = await this.db.getJobDocumentByDocumentId(documentId);
    if (jobDoc && (jobDoc.stage === 'UPLOADED_TO_S3' || jobDoc.status === 'READY')) {
      logger.info(`[DownloadWorker] Document ${documentId} has already been downloaded/processed (stage: ${jobDoc.stage}, status: ${jobDoc.status}). Skipping (idempotent).`);
      return;
    }

    // Branch: Website URL vs Direct File URL
    const isWebsite = payload.sourceType === 'website' || job.sourceType === 'WEBSITE_IMPORT' || job.sourceType === 'WEBSITE_CRAWL';
    if (isWebsite) {
      return this.processWebsiteJob(payload, job);
    }

    // 2. Mark stage as DOWNLOADING
    await this.db.updateJobDocumentStage(tenantId, jobId, documentId, 'DOWNLOADING');

    try {
      // 3. Securely download and validate file
      logger.info(`[DownloadWorker] Starting secure file download: ${safeUrl}...`);
      const downloadResult = await this.downloader.download(url);
      logger.info(
        `[DownloadWorker] File download successful: ${downloadResult.filename} (${downloadResult.sizeBytes} bytes, ${downloadResult.mimeType})`
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
        await this.db.updateJobDocumentStage(tenantId, jobId, documentId, 'UPLOADED_TO_S3', undefined, {
          finalUrl: downloadResult.finalUrl,
          sizeBytes: downloadResult.sizeBytes,
          mimeType: downloadResult.mimeType,
          isDuplicate: true,
        });
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
            sourceType: 'URL_IMPORT',
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

        // 8. Mark stage as UPLOADED_TO_S3
        await this.db.updateJobDocumentStage(tenantId, jobId, documentId, 'UPLOADED_TO_S3', undefined, {
          finalUrl: downloadResult.finalUrl,
          sizeBytes: downloadResult.sizeBytes,
          mimeType: downloadResult.mimeType,
          objectKey,
        });
      }

      // 9. Process downstream ingestion: inline if available, or forward to Ingestion Queue
      if (this.ingestionService) {
        try {
          logger.info(`[DownloadWorker:File] Executing inline ingestion for doc ${finalDocId}...`);
          await this.ingestionService.processSingleDocument(tenantId, entityId, jobId, finalDocId);
          logger.info(`[DownloadWorker:File] Inline ingestion completed for doc ${finalDocId}`);
        } catch (ingestErr: any) {
          logger.error(`[DownloadWorker:File] Inline ingestion failed for doc ${finalDocId}:`, ingestErr);
          try {
            await this.queue.enqueueIngestionJob({
              tenantId,
              entityId,
              jobId,
              documentId: finalDocId,
              attempt: 1,
            });
          } catch (qErr: any) {
            logger.warn(`[DownloadWorker:File] Failed to enqueue to Ingestion Queue: ${qErr.message}`);
          }
        }
      } else {
        logger.info(`[DownloadWorker] Forwarding document ${finalDocId} (job ${jobId}) to Ingestion Queue...`);
        try {
          await this.queue.enqueueIngestionJob({
            tenantId,
            entityId,
            jobId,
            documentId: finalDocId,
            attempt: 1,
          });
        } catch (qErr: any) {
          logger.warn(`[DownloadWorker] Failed to enqueue to Ingestion Queue: ${qErr.message}. S3 ObjectCreated event may still handle.`);
        }
      }
    } catch (err: any) {
      const errMsg = err?.message || 'Download failed';
      logger.error(`[DownloadWorker] Failed to download URL for doc ${documentId}: ${errMsg}`);

      await this.db.updateJobDocumentStage(tenantId, jobId, documentId, 'DOWNLOAD_FAILED', errMsg);
      await this.db.updateDocumentStatus(tenantId, documentId, 'FAILED', errMsg);

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

  /**
   * Process a static webpage URL: fetch HTML, extract Markdown, store in S3, and queue ingestion.
   */
  private async processWebsiteJob(payload: UrlDownloadMessagePayload, job: any): Promise<void> {
    const { tenantId, entityId, jobId, url, portfolioUrl } = payload;
    if (!payload.documentId) {
      logger.warn(`[DownloadWorker:Website] Missing documentId for website job ${jobId}. Skipping.`);
      return;
    }
    const documentId: string = payload.documentId;
    const safeUrl = redactUrlForLogging(url);
    logger.info(`[DownloadWorker:Website] Processing webpage: ${safeUrl} for document ${documentId}`);

    const crawlJobId = payload.crawlJobId || (job.sourceType === 'WEBSITE_CRAWL' ? jobId : undefined);

    // 1. Stage: FETCHING_PAGE
    await this.db.updateJobDocumentStage(tenantId, jobId, documentId, 'FETCHING_PAGE' as any);
    if (crawlJobId) {
      await this.db.updateCrawlPage(tenantId, crawlJobId, url, { status: 'fetching', stage: 'FETCHING_PAGE' });
    }

    try {
      // 2. Stage: EXTRACTING_CONTENT
      await this.db.updateJobDocumentStage(tenantId, jobId, documentId, 'EXTRACTING_CONTENT' as any);
      if (crawlJobId) {
        await this.db.updateCrawlPage(tenantId, crawlJobId, url, { status: 'extracting', stage: 'EXTRACTING_CONTENT' });
      }
      const extractionResult = await this.websiteExtractor.extractFromUrl(url);

      // 3. Child Link Discovery: register newly found internal links with existing parent crawl
      if (crawlJobId && extractionResult.links && extractionResult.links.length > 0) {
        try {
          const crawlJob = await this.db.getCrawlJob(tenantId, entityId, crawlJobId);
          const currentDepth = payload.depth ?? 1;
          const maxDepth = crawlJob?.config?.maxDepth ?? 3;
          const maxPages = crawlJob?.config?.maxPages ?? 25;

          if (currentDepth < maxDepth) {
            const existingPages = await this.db.getCrawlPages(tenantId, crawlJobId);
            const knownUrls = new Set<string>();
            for (const p of existingPages) {
              knownUrls.add(p.normalizedUrl);
              knownUrls.add(p.originalUrl);
              knownUrls.add(p.normalizedUrl.replace(/\/+$/, ''));
            }

            const newDiscovered: Array<{ url: string; depth: number }> = [];
            for (const rawLink of extractionResult.links) {
              if (existingPages.length + newDiscovered.length >= maxPages) break;
              const norm = normalizeUrl(rawLink, extractionResult.canonicalUrl || url);
              if (!norm) continue;
              if (knownUrls.has(norm) || knownUrls.has(norm.replace(/\/+$/, ''))) continue;
              if (crawlJob?.rootUrl && !isAllowedOrigin(norm, crawlJob.rootUrl, crawlJob.config?.allowedOrigins)) continue;
              if (isExcludedUrl(norm).isExcluded) continue;

              knownUrls.add(norm);
              newDiscovered.push({ url: norm, depth: currentDepth + 1 });
            }

            let folderPrefixChild = portfolioUrl;
            if (!folderPrefixChild) {
              const entity = await this.db.getEntityById(tenantId, entityId);
              folderPrefixChild = entity?.portfolioUrl || entity?.slug || `${tenantId}/${entityId}`;
            }

            for (const item of newDiscovered) {
              const newDocId = generateUuid();
              const initialContentHash = computeSha256(`webpage:${entityId}:${item.url}`);
              const createdDoc = await this.db.createDocument({
                id: newDocId,
                tenantId,
                entityId,
                originalFilename: 'webpage.md',
                mimeType: 'text/markdown',
                sizeBytes: 0,
                contentHash: initialContentHash,
                objectKey: buildS3ObjectKey(folderPrefixChild, `page-${Date.now()}.md`),
                isPublic: true,
                status: 'PENDING',
                sourceType: 'WEBSITE_CRAWL',
              });
              const resolvedDocId = createdDoc.id;

              await this.db.createJobDocument(tenantId, crawlJobId, resolvedDocId, {
                sourceUrl: item.url,
                stage: 'QUEUED_FOR_DOWNLOAD',
                downloadMetadata: { sourceType: 'webpage', crawlJobId, depth: item.depth, source: 'child_link' },
              });

              await this.db.createCrawlPages([{
                tenantId,
                entityId,
                crawlJobId,
                documentId: resolvedDocId,
                originalUrl: item.url,
                normalizedUrl: item.url,
                depth: item.depth,
              }]);

              await this.queue.enqueueUrlDownloadJob({
                tenantId,
                entityId,
                jobId: crawlJobId,
                documentId: resolvedDocId,
                url: item.url,
                portfolioUrl,
                sourceType: 'website',
                crawlJobId,
                depth: item.depth,
                action: 'WEBSITE_PAGE',
                attempt: 1,
              });
            }

            if (newDiscovered.length > 0 && this.db.syncCrawlJobAggregates) {
              await this.db.syncCrawlJobAggregates(tenantId, crawlJobId);
            }
          }
        } catch (childErr: any) {
          logger.warn(`[DownloadWorker:Website] Error registering child links for crawl ${crawlJobId}: ${childErr.message}`);
        }
      }

      const markdownBuffer = Buffer.from(extractionResult.content, 'utf-8');
      const contentHash = extractionResult.contentHash;

      let folderPrefix = portfolioUrl;
      if (!folderPrefix) {
        const entity = await this.db.getEntityById(tenantId, entityId);
        folderPrefix = entity?.portfolioUrl || entity?.slug || `${tenantId}/${entityId}`;
      }

      // Safe filename convention for extracted markdown object
      const safeSlug = extractionResult.title
        ? extractionResult.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
        : 'webpage';
      const filename = `${safeSlug || 'page'}-${Date.now()}.md`;
      const objectKey = buildS3ObjectKey(folderPrefix, filename);

      // Check deduplication
      const existingDoc = await this.db.getDocumentByHash(entityId, contentHash);
      let finalDocId = documentId;

      if (existingDoc && existingDoc.id !== documentId) {
        logger.info(`[DownloadWorker:Website] Webpage with hash ${contentHash} already exists (ID: ${existingDoc.id}). Linking existing document.`);
        finalDocId = existingDoc.id;
        await this.db.updateJobDocumentStage(tenantId, jobId, documentId, 'UPLOADED_TO_S3', undefined, {
          finalUrl: extractionResult.canonicalUrl,
          canonicalUrl: extractionResult.canonicalUrl,
          sourceType: 'webpage',
          title: extractionResult.title,
          sizeBytes: markdownBuffer.length,
          mimeType: 'text/markdown',
          isDuplicate: true,
        });
        try {
          await this.db.deleteDocument(tenantId, entityId, documentId);
        } catch {
          // ignore
        }
      } else {
        // Upload normalized Markdown to S3
        logger.info(`[DownloadWorker:Website] Uploading extracted markdown to storage (key: "${objectKey}")...`);
        await this.storage.uploadFile(objectKey, markdownBuffer, 'text/markdown');

        const existingDocById = await this.db.getDocumentById(tenantId, entityId, documentId);
        const displayName = extractionResult.title || 'Webpage';
        if (existingDocById) {
          if (this.db.updateDocumentMetadata) {
            await this.db.updateDocumentMetadata(tenantId, documentId, {
              originalFilename: displayName,
              mimeType: 'text/markdown',
              sizeBytes: markdownBuffer.length,
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
            originalFilename: displayName,
            mimeType: 'text/markdown',
            sizeBytes: markdownBuffer.length,
            contentHash,
            objectKey,
            isPublic: true,
            status: 'PENDING',
            sourceType: crawlJobId ? 'WEBSITE_CRAWL' : 'WEBSITE_IMPORT',
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
            sizeBytes: markdownBuffer.length,
          });
        } catch {
          // ignore
        }

        await this.db.updateJobDocumentStage(tenantId, jobId, documentId, 'UPLOADED_TO_S3', undefined, {
          finalUrl: extractionResult.canonicalUrl,
          canonicalUrl: extractionResult.canonicalUrl,
          sourceType: 'webpage',
          title: extractionResult.title,
          sizeBytes: markdownBuffer.length,
          mimeType: 'text/markdown',
          objectKey,
        });
      }

      if (crawlJobId) {
        await this.db.updateCrawlPage(tenantId, crawlJobId, url, {
          status: 'uploaded',
          stage: 'UPLOADED_TO_S3',
          documentId: finalDocId,
          title: extractionResult.title,
          canonicalUrl: extractionResult.canonicalUrl,
          contentHash,
          objectKey,
          sizeBytes: markdownBuffer.length,
        });
        if (this.db.syncCrawlJobAggregates) {
          await this.db.syncCrawlJobAggregates(tenantId, crawlJobId);
        } else {
          await this.checkCrawlCompletion(tenantId, crawlJobId);
        }
      }

      // Downstream ingestion: inline if available, or forward to Ingestion Queue
      if (this.ingestionService) {
        try {
          logger.info(`[DownloadWorker:Website] Executing inline ingestion for doc ${finalDocId}...`);
          await this.ingestionService.processSingleDocument(tenantId, entityId, jobId, finalDocId);
          logger.info(`[DownloadWorker:Website] Inline ingestion completed for doc ${finalDocId}`);
        } catch (ingestErr: any) {
          logger.error(`[DownloadWorker:Website] Inline ingestion failed for doc ${finalDocId}:`, ingestErr);
          try {
            await this.queue.enqueueIngestionJob({
              tenantId,
              entityId,
              jobId,
              documentId: finalDocId,
              attempt: 1,
            });
          } catch (qErr: any) {
            logger.warn(`[DownloadWorker:Website] Failed to enqueue to Ingestion Queue: ${qErr.message}`);
          }
        }
        if (crawlJobId) {
          if (this.db.syncCrawlJobAggregates) {
            await this.db.syncCrawlJobAggregates(tenantId, crawlJobId);
          } else {
            await this.checkCrawlCompletion(tenantId, crawlJobId);
          }
        }
      } else {
        logger.info(`[DownloadWorker:Website] Forwarding document ${finalDocId} (job ${jobId}) to Ingestion Queue...`);
        try {
          await this.queue.enqueueIngestionJob({
            tenantId,
            entityId,
            jobId,
            documentId: finalDocId,
            attempt: 1,
          });
        } catch (qErr: any) {
          logger.warn(`[DownloadWorker:Website] Failed to enqueue to Ingestion Queue: ${qErr.message}. S3 ObjectCreated event may still handle.`);
        }
      }
    } catch (err: any) {
      const isNotFound =
        err?.statusCode === 404 ||
        err?.status === 404 ||
        (err?.message && (err.message.includes('404') || err.message.toLowerCase().includes('not found')));
      const isForbidden =
        err?.statusCode === 403 ||
        err?.status === 403 ||
        (err?.message && (err.message.includes('403') || err.message.toLowerCase().includes('forbidden')));
      const isNoContent = err?.isNoContent || false;

      const stage = isNoContent
        ? 'NO_CONTENT_FOUND'
        : isNotFound
        ? 'NOT_FOUND'
        : isForbidden
        ? 'ACCESS_DENIED'
        : 'DOWNLOAD_FAILED';

      const errMsg = isNotFound
        ? 'Page not found (HTTP 404)'
        : isForbidden
        ? 'Access denied (HTTP 403)'
        : err?.message || 'Website extraction failed';

      logger.warn(`[DownloadWorker:Website] Extraction halted for doc ${documentId} (${safeUrl}): ${errMsg}`);

      await this.db.updateJobDocumentStage(tenantId, jobId, documentId, stage as any, errMsg);
      await this.db.updateDocumentStatus(tenantId, documentId, 'FAILED', errMsg);

      if (crawlJobId) {
        const pageStatus = isNoContent ? 'skipped' : 'failed';
        await this.db.updateCrawlPage(tenantId, crawlJobId, url, {
          status: pageStatus,
          stage,
          errorMessage: errMsg,
        });
        if (this.db.syncCrawlJobAggregates) {
          await this.db.syncCrawlJobAggregates(tenantId, crawlJobId);
        } else {
          await this.checkCrawlCompletion(tenantId, crawlJobId);
        }
      }

      // Safe non-terminal evaluation: Only mark the entire job as failed if discovery has completed AND all documents are terminal failures
      const allJobDocs = await this.db.getJobDocuments(tenantId, jobId);
      const anyStillActive = allJobDocs.some(
        d =>
          d.stage === 'QUEUED_FOR_DOWNLOAD' ||
          d.stage === 'FETCHING_PAGE' ||
          d.stage === 'EXTRACTING_CONTENT' ||
          d.stage === 'DOWNLOADING' ||
          d.status === 'PENDING' ||
          d.status === 'PROCESSING'
      );

      if (!anyStillActive) {
        const allFailed =
          allJobDocs.length > 0 &&
          allJobDocs.every(
            d =>
              d.stage === 'DOWNLOAD_FAILED' ||
              d.stage === 'NO_CONTENT_FOUND' ||
              d.stage === 'FAILED' ||
              d.status === 'FAILED'
          );
        if (allFailed) {
          await this.db.updateJobStatus(tenantId, jobId, 'FAILED', {
            failed: allJobDocs.length,
            errorSummary: errMsg,
          });
        }
      }
    }
  }
  /**
   * Evaluates crawl page statuses and updates crawl job terminal status.
   */
  private async checkCrawlCompletion(tenantId: string, crawlJobId: string): Promise<void> {
    if (this.db.syncCrawlJobAggregates) {
      await this.db.syncCrawlJobAggregates(tenantId, crawlJobId);
      return;
    }
    const pages = await this.db.getCrawlPages(tenantId, crawlJobId);
    if (!pages || pages.length === 0) return;

    const completedPages = pages.filter(p => p.status === 'completed' || p.status === 'uploaded');
    const skippedPages = pages.filter(p => p.status === 'skipped');
    const failedPages = pages.filter(p => p.status === 'failed');
    const pendingPages = pages.filter(p => p.status === 'discovered' || p.status === 'queued' || p.status === 'fetching' || p.status === 'extracting');

    if (pendingPages.length === 0) {
      const anyFailed = failedPages.length > 0;
      const allFailed = failedPages.length === pages.length;
      const finalStatus = allFailed ? 'failed' : 'completed';
      await this.db.updateCrawlJob(tenantId, crawlJobId, {
        status: finalStatus,
        completedAt: new Date(),
        completedCount: completedPages.length,
        skippedCount: skippedPages.length,
        failedCount: failedPages.length,
        processingCount: 0,
      });
      logger.info(`[DownloadWorker:Crawl] Crawl job ${crawlJobId} finished with status "${finalStatus}" (${completedPages.length} completed, ${skippedPages.length} skipped, ${failedPages.length} failed).`);
    } else {
      await this.db.updateCrawlJob(tenantId, crawlJobId, {
        completedCount: completedPages.length,
        skippedCount: skippedPages.length,
        failedCount: failedPages.length,
        processingCount: pendingPages.length,
      });
    }
  }

  /**
   * Persists fatal unhandled errors so records never stay stuck in processing
   */
  async handleFatalDownloadError(payload: any, errMsg: string): Promise<void> {
    const { tenantId, jobId, documentId, crawlJobId, url } = payload || {};
    if (!tenantId || !documentId) return;

    try {
      await this.db.updateJobDocumentStage(tenantId, jobId, documentId, 'DOWNLOAD_FAILED', errMsg);
      await this.db.updateDocumentStatus(tenantId, documentId, 'FAILED', errMsg);

      if (crawlJobId && url) {
        await this.db.updateCrawlPage(tenantId, crawlJobId, url, {
          status: 'failed',
          stage: 'DOWNLOAD_FAILED',
          errorMessage: errMsg,
        });
        if (this.db.syncCrawlJobAggregates) {
          await this.db.syncCrawlJobAggregates(tenantId, crawlJobId);
        }
      }
    } catch (err: any) {
      logger.error(`[DownloadWorker] Could not persist fatal download error for doc ${documentId}: ${err.message}`);
    }
  }
}
