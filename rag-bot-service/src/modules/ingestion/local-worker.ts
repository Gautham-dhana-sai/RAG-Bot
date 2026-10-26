import { env } from '../../config/env.js';
import { logger } from '../../shared/logger.js';
import { MemoryDatabaseAdapter } from '../../adapters/database/memory.adapter.js';
import { PostgresDatabaseAdapter } from '../../adapters/database/postgres.adapter.js';
import { LocalStorageAdapter } from '../../adapters/storage/local-storage.adapter.js';
import { S3StorageAdapter } from '../../adapters/storage/s3-storage.adapter.js';
import { LocalQueueAdapter } from '../../adapters/queue/local-queue.adapter.js';
import { SqsQueueAdapter } from '../../adapters/queue/sqs-queue.adapter.js';
import { MockAIAdapter } from '../../adapters/ai/mock-ai.adapter.js';
import { OpenAIAIAdapter } from '../../adapters/ai/openai-ai.adapter.js';
import { DocumentsService } from '../documents/documents.service.js';
import { ExtractionService } from '../extraction/extraction.service.js';
import { ChunkingService } from '../chunking/chunking.service.js';
import { EmbeddingsService } from '../embeddings/embeddings.service.js';
import { IngestionService } from './ingestion.service.js';

export async function startWorker(): Promise<void> {
  logger.info('Starting PersonaRAG Ingestion Worker...');

  const db = env.DATABASE_URL
    ? new PostgresDatabaseAdapter(env.DATABASE_URL, env.DB_POOL_MAX, env.DB_USE_SSL)
    : new MemoryDatabaseAdapter();
  await db.init();

  const storage =
    env.STORAGE_ADAPTER === 's3'
      ? new S3StorageAdapter(env.S3_BUCKET_NAME, env.AWS_REGION)
      : new LocalStorageAdapter(env.LOCAL_STORAGE_DIR);

  const queue =
    env.QUEUE_ADAPTER === 'sqs' && env.SQS_QUEUE_URL
      ? new SqsQueueAdapter(env.SQS_QUEUE_URL, env.AWS_REGION)
      : new LocalQueueAdapter(false); // manual polling mode

  const ai =
    env.AI_PROVIDER === 'openai'
      ? new OpenAIAIAdapter({
          apiKey: env.OPENAI_API_KEY,
          baseUrl: env.OPENAI_BASE_URL,
          chatModel: env.CHAT_MODEL,
          embeddingModel: env.EMBEDDING_MODEL,
          dimensions: env.EMBEDDING_DIMENSIONS,
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

  let running = true;
  process.on('SIGINT', () => {
    logger.info('Stopping worker...');
    running = false;
  });

  logger.info('Worker listening for ingestion jobs...');
  while (running) {
    try {
      if (queue.pollMessages) {
        const messages = await queue.pollMessages(5);
        for (const msg of messages) {
          try {
            await ingestionService.processJob(msg.payload);
            if (queue.deleteMessage) {
              await queue.deleteMessage(msg.receiptHandle);
            }
          } catch (jobErr) {
            logger.error(`Error processing job from queue:`, jobErr);
          }
        }
      }
    } catch (pollErr) {
      logger.error('Worker polling error:', pollErr);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  await db.close();
}

if (typeof import.meta !== 'undefined' && import.meta?.url && import.meta.url === `file://${process.argv[1]}`) {
  startWorker().catch(err => {
    logger.error('Worker fatal error:', err);
    process.exit(1);
  });
}

