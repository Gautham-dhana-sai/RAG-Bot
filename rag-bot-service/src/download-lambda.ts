import path from 'path';
import { PostgresDatabaseAdapter } from './adapters/database/postgres.adapter.js';
import { MemoryDatabaseAdapter } from './adapters/database/memory.adapter.js';
import { S3StorageAdapter } from './adapters/storage/s3-storage.adapter.js';
import { LocalStorageAdapter } from './adapters/storage/local-storage.adapter.js';
import { SqsQueueAdapter } from './adapters/queue/sqs-queue.adapter.js';
import { LocalQueueAdapter } from './adapters/queue/local-queue.adapter.js';
import { DownloadWorker } from './modules/downloader/download-worker.js';
import { IngestionService } from './modules/ingestion/ingestion.service.js';
import { DocumentsService } from './modules/documents/documents.service.js';
import { ExtractionService } from './modules/extraction/extraction.service.js';
import { ChunkingService } from './modules/chunking/chunking.service.js';
import { EmbeddingsService } from './modules/embeddings/embeddings.service.js';
import { OpenAIAIAdapter } from './adapters/ai/openai-ai.adapter.js';
import { MockAIAdapter } from './adapters/ai/mock-ai.adapter.js';
import { CohereAIAdapter } from './adapters/ai/cohere-ai.adapter.js';
import { UrlDownloadMessagePayload } from './adapters/queue/queue.interface.js';
import { logger } from './shared/logger.js';
import { env } from './config/env.js';

let downloadWorkerInstance: DownloadWorker | null = null;

async function bootstrapDownloadWorker(): Promise<DownloadWorker> {
  if (downloadWorkerInstance) {
    return downloadWorkerInstance;
  }

  logger.info('[Download Lambda] Bootstrapping dedicated URL download worker...');

  const isTestEnv = process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test';

  // 1. Initialize Database Adapter
  const db =
    env.DATABASE_URL && !isTestEnv
      ? new PostgresDatabaseAdapter(env.DATABASE_URL, env.DB_POOL_MAX, env.DB_USE_SSL)
      : new MemoryDatabaseAdapter();

  if (typeof (db as any).init === 'function') {
    await (db as any).init();
  }

  // 2. Initialize S3 Storage Adapter
  const isLambda = Boolean(process.env.LAMBDA_TASK_ROOT || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const s3Credentials =
    env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
      ? {
          accessKeyId: env.AWS_ACCESS_KEY_ID,
          secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
          sessionToken: env.AWS_SESSION_TOKEN || undefined,
        }
      : undefined;

  const storage =
    (env.STORAGE_ADAPTER === 's3' || (isLambda && env.STORAGE_ADAPTER !== 'local')) && !isTestEnv
      ? new S3StorageAdapter(env.S3_BUCKET_NAME, env.AWS_REGION, s3Credentials)
      : new LocalStorageAdapter(
          isLambda ? path.join('/tmp', 'data', 'storage') : env.LOCAL_STORAGE_DIR
        );

  // 3. Initialize SQS Queue Adapter
  const queue =
    env.QUEUE_ADAPTER === 'sqs' && env.SQS_QUEUE_URL && !isTestEnv
      ? new SqsQueueAdapter(env.SQS_QUEUE_URL, env.AWS_REGION, env.URL_DOWNLOAD_QUEUE_URL)
      : new LocalQueueAdapter(true);

  // 4. Initialize AI Provider & Ingestion Services for immediate inline RAG ingestion
  const isGoogleEndpoint =
    env.AI_PROVIDER === 'gemini' ||
    (env.OPENAI_BASE_URL && env.OPENAI_BASE_URL.includes('googleapis.com'));

  const geminiKey =
    env.GEMINI_API_KEY ||
    (!env.OPENAI_API_KEY?.startsWith('sk-') ? env.OPENAI_API_KEY : '') ||
    '';

  const ai = isTestEnv
    ? new MockAIAdapter(env.EMBEDDING_DIMENSIONS)
    : isGoogleEndpoint
      ? new OpenAIAIAdapter({
          apiKey: geminiKey,
          baseUrl: env.OPENAI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
          chatModel: env.CHAT_MODEL,
          embeddingModel: env.EMBEDDING_MODEL,
        })
      : env.AI_PROVIDER === 'cohere' && env.COHERE_API_KEY
        ? new CohereAIAdapter({
            apiKey: env.COHERE_API_KEY,
            chatModel: env.COHERE_CHAT_MODEL,
            embeddingModel: env.COHERE_EMBEDDING_MODEL,
          })
        : env.AI_PROVIDER === 'openai' && env.OPENAI_API_KEY
          ? new OpenAIAIAdapter({
              apiKey: env.OPENAI_API_KEY,
              chatModel: env.CHAT_MODEL,
              embeddingModel: env.EMBEDDING_MODEL,
            })
          : new MockAIAdapter(env.EMBEDDING_DIMENSIONS);

  const docsService = new DocumentsService(db, storage);
  const extractionService = new ExtractionService();
  const chunkingService = new ChunkingService(env.CHUNK_SIZE, env.CHUNK_OVERLAP);
  const embeddingsService = new EmbeddingsService(ai);

  const ingestionService = new IngestionService(
    db,
    storage,
    queue,
    docsService,
    extractionService,
    chunkingService,
    embeddingsService
  );

  downloadWorkerInstance = new DownloadWorker(db, storage, queue, ingestionService);
  logger.info('[Download Lambda] Bootstrapped successfully with inline RAG ingestion enabled.');
  return downloadWorkerInstance;
}

/**
 * Dedicated Standalone Lambda Handler for URL Download Queue.
 * Downloads remote files/photos securely, validates content & format, and uploads to S3.
 */
export const handler = async (event: any, context?: any) => {
  if (context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  const remainingMs = context?.getRemainingTimeInMillis ? context.getRemainingTimeInMillis() : 'N/A';
  const records = event?.Records || [];
  logger.info(`[Download Lambda] Invocation started with ${records.length} record(s). Remaining time: ${remainingMs}ms.`);

  let downloadWorker: DownloadWorker;
  try {
    downloadWorker = await bootstrapDownloadWorker();
  } catch (bootErr: any) {
    logger.error('[Download Lambda] Cannot process records because bootstrap failed:', bootErr);
    return {
      statusCode: 500,
      error: bootErr?.message || 'Bootstrap failure',
      message: 'Failed to initialize database or storage adapter. Check CloudWatch logs for diagnostics.',
    };
  }

  for (let idx = 0; idx < records.length; idx++) {
    const record = records[idx];
    const receiveCount = record?.attributes?.ApproximateReceiveCount || '1';
    logger.info(`[Download Lambda] Processing record [${idx + 1}/${records.length}] (MessageId: ${record.messageId}, ReceiveCount: ${receiveCount})`);

    let rawPayload: any;
    try {
      rawPayload = typeof record.body === 'string' ? JSON.parse(record.body) : record.body;

      // Handle SNS-wrapped SQS message bodies
      if (rawPayload && typeof rawPayload.Message === 'string') {
        try {
          rawPayload = JSON.parse(rawPayload.Message);
        } catch {
          // ignore
        }
      }

      const payload: UrlDownloadMessagePayload = rawPayload;
      if (!payload.jobId || !payload.url) {
        logger.warn(`[Download Lambda] Skipping invalid download message body: ${JSON.stringify(rawPayload)}`);
        continue;
      }

      logger.info(`[Download Lambda] Downloading URL for document ${payload.documentId} (job: ${payload.jobId})...`);
      await downloadWorker.processDownloadJob(payload);
      logger.info(`[Download Lambda] Finished processing download for document ${payload.documentId}`);
    } catch (err: any) {
      logger.error(`[Download Lambda] Failed to process URL download record (docId: ${rawPayload?.documentId}):`, err);
      if (err?.stack) {
        logger.error(`[Download Lambda] Error stack trace: ${err.stack}`);
      }
      if (rawPayload && typeof rawPayload === 'object' && rawPayload.documentId) {
        try {
          const errMsg = err?.message || 'Download processing crashed';
          await downloadWorker.handleFatalDownloadError(rawPayload, errMsg);
        } catch (fatalErr: any) {
          logger.error(`[Download Lambda] Failed to handle fatal download error:`, fatalErr);
        }
      }
    }
  }

  logger.info(`[Download Lambda] Finished batch of ${records.length} record(s).`);
  return { statusCode: 200, message: 'URL download records processed successfully' };
};

// Aliases for flexible Lambda handler configuration in AWS Console
export const downloadWorkerHandler = handler;
export const sqsDownloadHandler = handler;
export const urlDownloadHandler = handler;
