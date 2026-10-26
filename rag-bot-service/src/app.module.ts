import path from 'path';
import { DynamicModule, Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { TenantsModule } from './modules/tenants/tenants.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { IngestionModule } from './modules/ingestion/ingestion.module.js';
import { ConversationsModule } from './modules/conversations/conversations.module.js';
import { PortfoliosModule } from './modules/portfolios/portfolios.module.js';

import { env, EnvConfig } from './config/env.js';
import { IDatabaseAdapter } from './adapters/database/database.interface.js';
import { PostgresDatabaseAdapter } from './adapters/database/postgres.adapter.js';
import { MemoryDatabaseAdapter } from './adapters/database/memory.adapter.js';
import { IStorageAdapter } from './adapters/storage/storage.interface.js';
import { LocalStorageAdapter } from './adapters/storage/local-storage.adapter.js';
import { S3StorageAdapter } from './adapters/storage/s3-storage.adapter.js';
import { IQueueAdapter } from './adapters/queue/queue.interface.js';
import { LocalQueueAdapter } from './adapters/queue/local-queue.adapter.js';
import { SqsQueueAdapter } from './adapters/queue/sqs-queue.adapter.js';
import { IAIAdapter } from './adapters/ai/ai.interface.js';
import { MockAIAdapter } from './adapters/ai/mock-ai.adapter.js';
import { OpenAIAIAdapter } from './adapters/ai/openai-ai.adapter.js';
import { CohereAIAdapter } from './adapters/ai/cohere-ai.adapter.js';

import { AuthService } from './modules/auth/auth.service.js';
import { TenantsService } from './modules/tenants/tenants.service.js';
import { EntitiesService } from './modules/entities/entities.service.js';
import { DocumentsService } from './modules/documents/documents.service.js';
import { ExtractionService } from './modules/extraction/extraction.service.js';
import { ChunkingService } from './modules/chunking/chunking.service.js';
import { EmbeddingsService } from './modules/embeddings/embeddings.service.js';
import { RetrievalService } from './modules/retrieval/retrieval.service.js';
import { QueryRewriter } from './modules/conversations/query-rewriter.js';
import { ConversationsService } from './modules/conversations/conversations.service.js';
import { GenerationService } from './modules/generation/generation.service.js';
import { CitationsService } from './modules/citations/citations.service.js';
import { IngestionService } from './modules/ingestion/ingestion.service.js';
import { PortfoliosService } from './modules/portfolios/portfolios.service.js';

import { TenantContextMiddleware } from './middleware/tenant-context.middleware.js';
import { RateLimiterMiddleware } from './middleware/rate-limiter.middleware.js';

export interface AppDependencies {
  db?: IDatabaseAdapter;
  storage?: IStorageAdapter;
  queue?: IQueueAdapter;
  ai?: IAIAdapter;
  config?: Partial<EnvConfig>;
}

@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RateLimiterMiddleware, TenantContextMiddleware)
      .forRoutes('*');
  }

  static register(deps?: AppDependencies): DynamicModule {
    const isTestEnv = process.env.NODE_ENV === 'test' || env.NODE_ENV === 'test';

    const db =
      deps?.db ||
      (env.DATABASE_URL && !isTestEnv
        ? new PostgresDatabaseAdapter(env.DATABASE_URL, env.DB_POOL_MAX, env.DB_USE_SSL)
        : new MemoryDatabaseAdapter());

    const s3Credentials =
      env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
        ? {
            accessKeyId: env.AWS_ACCESS_KEY_ID,
            secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
            sessionToken: env.AWS_SESSION_TOKEN || undefined,
          }
        : undefined;

    const isLambda = Boolean(process.env.LAMBDA_TASK_ROOT || process.env.AWS_LAMBDA_FUNCTION_NAME);

    const storage =
      deps?.storage ||
      ((env.STORAGE_ADAPTER === 's3' || (isLambda && env.STORAGE_ADAPTER !== 'local')) && !isTestEnv
        ? new S3StorageAdapter(env.S3_BUCKET_NAME, env.AWS_REGION, s3Credentials)
        : new LocalStorageAdapter(
            isLambda ? path.join('/tmp', 'data', 'storage') : env.LOCAL_STORAGE_DIR
          ));

    const queue =
      deps?.queue ||
      (env.QUEUE_ADAPTER === 'sqs' && env.SQS_QUEUE_URL && !isTestEnv
        ? new SqsQueueAdapter(env.SQS_QUEUE_URL, env.AWS_REGION)
        : new LocalQueueAdapter(true));

    const isGoogleEndpoint =
      env.AI_PROVIDER === 'gemini' ||
      (env.OPENAI_BASE_URL && env.OPENAI_BASE_URL.includes('googleapis.com'));

    const geminiKey =
      env.GEMINI_API_KEY ||
      (!env.OPENAI_API_KEY?.startsWith('sk-') ? env.OPENAI_API_KEY : '') ||
      '';

    const ai =
      deps?.ai ||
      (isTestEnv
        ? new MockAIAdapter(env.EMBEDDING_DIMENSIONS)
        : isGoogleEndpoint
          ? new OpenAIAIAdapter({
              apiKey: geminiKey,
              baseUrl: env.OPENAI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta/openai',
              chatModel: env.CHAT_MODEL || 'gemini-3.8-flash',
              embeddingModel: env.EMBEDDING_MODEL || 'gemini-embedding-001',
              dimensions: 3072,
            })
          : env.AI_PROVIDER === 'cohere'
            ? new CohereAIAdapter({
                apiKey: env.COHERE_API_KEY || '',
                chatModel: env.COHERE_CHAT_MODEL,
                embeddingModel: env.COHERE_EMBEDDING_MODEL,
                dimensions: 1024,
              })
            : env.AI_PROVIDER === 'openai'
              ? new OpenAIAIAdapter({
                  apiKey: env.OPENAI_API_KEY,
                  baseUrl: env.OPENAI_BASE_URL,
                  chatModel: env.CHAT_MODEL,
                  embeddingModel: env.EMBEDDING_MODEL,
                  dimensions: env.EMBEDDING_DIMENSIONS,
                })
              : new MockAIAdapter(env.EMBEDDING_DIMENSIONS));

    const authService = new AuthService(db, env.AUTH_SECRET);
    const tenantsService = new TenantsService(db);
    const entitiesService = new EntitiesService(db);
    const docsService = new DocumentsService(db, storage);
    const extractionService = new ExtractionService();
    const chunkingService = new ChunkingService(env.CHUNK_SIZE, env.CHUNK_OVERLAP);
    const embeddingsService = new EmbeddingsService(ai);
    const retrievalService = new RetrievalService(
      db,
      embeddingsService,
      env.RETRIEVAL_TOP_K,
      env.RETRIEVAL_RRF_K,
      env.RETRIEVAL_MIN_SCORE
    );
    const queryRewriter = new QueryRewriter(ai);
    const conversationsService = new ConversationsService(db);
    const generationService = new GenerationService(ai);
    const citationsService = new CitationsService(db);

    const ingestionService = new IngestionService(
      db,
      storage,
      queue,
      docsService,
      extractionService,
      chunkingService,
      embeddingsService
    );

    const portfoliosService = new PortfoliosService(
      db,
      docsService,
      ingestionService,
      storage,
      retrievalService,
      generationService
    );

    // Hook local queue up to worker processor if local queue
    if ('onMessage' in queue && typeof (queue as any).onMessage === 'function') {
      (queue as any).onMessage(async (payload: any) => {
        await ingestionService.processJob(payload);
      });
    }

    const providers = [
      { provide: 'DATABASE_ADAPTER', useValue: db },
      { provide: 'STORAGE_ADAPTER', useValue: storage },
      { provide: 'QUEUE_ADAPTER', useValue: queue },
      { provide: 'AI_ADAPTER', useValue: ai },
      { provide: AuthService, useValue: authService },
      { provide: TenantsService, useValue: tenantsService },
      { provide: EntitiesService, useValue: entitiesService },
      { provide: DocumentsService, useValue: docsService },
      { provide: ExtractionService, useValue: extractionService },
      { provide: ChunkingService, useValue: chunkingService },
      { provide: EmbeddingsService, useValue: embeddingsService },
      { provide: RetrievalService, useValue: retrievalService },
      { provide: QueryRewriter, useValue: queryRewriter },
      { provide: ConversationsService, useValue: conversationsService },
      { provide: GenerationService, useValue: generationService },
      { provide: CitationsService, useValue: citationsService },
      { provide: IngestionService, useValue: ingestionService },
      { provide: PortfoliosService, useValue: portfoliosService },
    ];

    return {
      module: AppModule,
      imports: [
        HealthModule,
        AuthModule,
        TenantsModule,
        DocumentsModule,
        IngestionModule,
        ConversationsModule,
        PortfoliosModule,
      ],
      providers,
      exports: providers,
      global: true,
    };
  }
}

