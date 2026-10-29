import path from 'path';
import { PostgresDatabaseAdapter } from './adapters/database/postgres.adapter.js';
import { MemoryDatabaseAdapter } from './adapters/database/memory.adapter.js';
import { S3StorageAdapter } from './adapters/storage/s3-storage.adapter.js';
import { LocalStorageAdapter } from './adapters/storage/local-storage.adapter.js';
import { SqsQueueAdapter } from './adapters/queue/sqs-queue.adapter.js';
import { LocalQueueAdapter } from './adapters/queue/local-queue.adapter.js';
import { IngestionService } from './modules/ingestion/ingestion.service.js';
import { DocumentsService } from './modules/documents/documents.service.js';
import { ExtractionService } from './modules/extraction/extraction.service.js';
import { ChunkingService } from './modules/chunking/chunking.service.js';
import { EmbeddingsService } from './modules/embeddings/embeddings.service.js';
import { OpenAIAIAdapter } from './adapters/ai/openai-ai.adapter.js';
import { MockAIAdapter } from './adapters/ai/mock-ai.adapter.js';
import { CohereAIAdapter } from './adapters/ai/cohere-ai.adapter.js';
import { IngestionMessagePayload } from './adapters/queue/queue.interface.js';
import { logger } from './shared/logger.js';
import { env } from './config/env.js';

let ingestionServiceInstance: IngestionService | null = null;

function isValidUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

async function bootstrapIngestionWorker(): Promise<IngestionService> {
  if (ingestionServiceInstance) {
    return ingestionServiceInstance;
  }

  logger.info('[Ingestion Lambda] Bootstrapping dedicated ingestion worker...');

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

  // 4. Initialize AI Provider for Vector Embeddings
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

  // 5. Initialize Ingestion Subsystems
  const docsService = new DocumentsService(db, storage);
  const extractionService = new ExtractionService();
  const chunkingService = new ChunkingService(env.CHUNK_SIZE, env.CHUNK_OVERLAP);
  const embeddingsService = new EmbeddingsService(ai);

  ingestionServiceInstance = new IngestionService(
    db,
    storage,
    queue,
    docsService,
    extractionService,
    chunkingService,
    embeddingsService
  );

  logger.info('[Ingestion Lambda] Bootstrapped successfully.');
  return ingestionServiceInstance;
}

/**
 * Dedicated Standalone Lambda Handler for Document Ingestion & S3 ObjectCreated Notifications.
 * Consumes ingestion queue messages or S3 notification envelopes, runs OCR/extraction, chunking, and pgvector embeddings.
 */
export const handler = async (event: any, context?: any) => {
  if (context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  const remainingMs = context?.getRemainingTimeInMillis ? context.getRemainingTimeInMillis() : 'N/A';
  const records = event?.Records || [];
  logger.info(`[Ingestion Lambda] Invocation started with ${records.length} record(s). Remaining time: ${remainingMs}ms.`);

  let ingestionService: IngestionService;
  try {
    ingestionService = await bootstrapIngestionWorker();
  } catch (bootErr: any) {
    logger.error('[Ingestion Lambda] Cannot process records because bootstrap failed:', bootErr);
    return {
      statusCode: 500,
      error: bootErr?.message || 'Bootstrap failure',
      message: 'Failed to initialize database or dependencies. Check CloudWatch logs for connection diagnostics.',
    };
  }

  for (let idx = 0; idx < records.length; idx++) {
    const record = records[idx];
    const receiveCount = record?.attributes?.ApproximateReceiveCount || '1';
    logger.info(`[Ingestion Lambda] Processing record [${idx + 1}/${records.length}] (MessageId: ${record.messageId}, ReceiveCount: ${receiveCount})`);

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

      // Handle S3 Test Events (e.g. from AWS Console)
      if (rawPayload?.Event === 's3:TestEvent' || rawPayload?.Service === 'Amazon S3') {
        logger.info('[Ingestion Lambda] Received S3 test event ping. Skipping safely.');
        continue;
      }

      // Handle S3 Event Notifications (s3:ObjectCreated)
      if (rawPayload?.Records?.[0]?.eventSource === 'aws:s3' || rawPayload?.Records?.[0]?.s3) {
        for (const s3Record of rawPayload.Records) {
          if (s3Record.s3 && s3Record.s3.object) {
            const rawKey = s3Record.s3.object.key || '';
            const objectKey = decodeURIComponent(rawKey).replace(/\+/g, ' ');
            logger.info(`[Ingestion Lambda] Received S3 ObjectCreated notification for key: "${objectKey}". Invoking ingestion pipeline...`);
            await ingestionService.processS3ObjectCreated(objectKey);
          }
        }
        continue;
      }

      // Handle non-object or empty payload
      if (typeof rawPayload !== 'object' || rawPayload === null) {
        logger.warn(`[Ingestion Lambda] Received non-object SQS message body: "${rawPayload}". Skipping safely to prevent retry loop.`);
        continue;
      }

      // Validate that message is a valid application ingestion job payload
      const payload: IngestionMessagePayload = rawPayload;
      if (!payload.jobId || !isValidUuid(payload.jobId)) {
        logger.warn(`[Ingestion Lambda] SQS message lacks valid UUID jobId (${payload?.jobId}), skipping safely: ${JSON.stringify(rawPayload)}`);
        continue;
      }

      logger.info(`[Ingestion Lambda] Beginning processing for job ${payload.jobId} (entity: ${payload.entityId}, tenant: ${payload.tenantId})...`);
      await ingestionService.processJob(payload);
      logger.info(`[Ingestion Lambda] Successfully finished processing for job ${payload.jobId}`);
    } catch (err: any) {
      logger.error(`[Ingestion Lambda] Failed to process SQS ingestion record:`, err);
      if (err?.stack) {
        logger.error(`[Ingestion Lambda] Error stack trace: ${err.stack}`);
      }
    }
  }

  logger.info(`[Ingestion Lambda] Finished batch of ${records.length} record(s).`);
  return { statusCode: 200, message: 'Ingestion records processed successfully' };
};

// Aliases for flexible Lambda handler configuration in AWS Console
export const sqsIngestionHandler = handler;
export const ingestionHandler = handler;

