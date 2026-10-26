import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import express, { Express } from 'express';
import request from 'supertest';

import { AppModule, type AppDependencies } from './app.module.js';
import { AllExceptionsFilter } from './middleware/all-exceptions.filter.js';
import { env } from './config/env.js';
import { logger } from './shared/logger.js';
import { IDatabaseAdapter } from './adapters/database/database.interface.js';
import { IStorageAdapter } from './adapters/storage/storage.interface.js';
import { IQueueAdapter } from './adapters/queue/queue.interface.js';
import { IAIAdapter } from './adapters/ai/ai.interface.js';
import { IngestionService } from './modules/ingestion/ingestion.service.js';

export interface NestAppWithInject extends INestApplication {
  ready(): Promise<void>;
  inject(opts: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    payload?: any;
    body?: any;
  }): Promise<{
    statusCode: number;
    headers: Record<string, any>;
    body: string;
    json(): any;
  }>;
}

export async function createNestApp(deps?: AppDependencies): Promise<{
  app: NestAppWithInject;
  db: IDatabaseAdapter;
  storage: IStorageAdapter;
  queue: IQueueAdapter;
  ai: IAIAdapter;
  ingestionService: IngestionService;
}> {
  logger.info('[APP_BOOTSTRAP] Registering dynamic AppModule and providers...');
  const dynamicModule = AppModule.register(deps);

  // Initialize database adapter if not already initialized
  const dbProvider = dynamicModule.providers?.find((p: any) => p.provide === 'DATABASE_ADAPTER') as any;
  const db: IDatabaseAdapter = dbProvider?.useValue;
  if (db && typeof db.init === 'function') {
    logger.info('[APP_BOOTSTRAP] Initializing database adapter...');
    await db.init();
    logger.info('[APP_BOOTSTRAP] Database adapter initialized successfully.');
  }

  const storage: IStorageAdapter = (dynamicModule.providers?.find((p: any) => p.provide === 'STORAGE_ADAPTER') as any)?.useValue;
  const queue: IQueueAdapter = (dynamicModule.providers?.find((p: any) => p.provide === 'QUEUE_ADAPTER') as any)?.useValue;
  const ai: IAIAdapter = (dynamicModule.providers?.find((p: any) => p.provide === 'AI_ADAPTER') as any)?.useValue;
  const ingestionService: IngestionService = (dynamicModule.providers?.find((p: any) => p.provide === IngestionService) as any)?.useValue;

  logger.info('[APP_BOOTSTRAP] Calling NestFactory.create...');
  const app = await NestFactory.create(dynamicModule, {
    logger: false,
    bodyParser: true,
  });
  logger.info('[APP_BOOTSTRAP] NestFactory application created.');

  // Body parsing limits
  app.use(express.json({ limit: env.MAX_FILE_SIZE_BYTES }));
  app.use(express.urlencoded({ extended: true, limit: env.MAX_FILE_SIZE_BYTES }));

  // CORS
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || origin === env.CORS_ORIGIN || origin.startsWith('http://localhost:')) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
  });

  // Global Exception Filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Swagger Documentation
  if (process.env.NODE_ENV !== 'test') {
    try {
      const config = new DocumentBuilder()
        .setTitle('PersonaRAG API')
        .setDescription('Multi-Tenant Retrieval-Augmented Generation Service API')
        .setVersion('1.0.0')
        .addBearerAuth()
        .build();
      const document = SwaggerModule.createDocument(app, config);
      SwaggerModule.setup('documentation', app, document);
    } catch {
      // Gracefully continue if decorator metadata is absent in test/bundle environments
    }
  }

  // Testing helper: inject & ready via Proxy
  const appProxy = new Proxy(app as any, {
    get(target, prop, receiver) {
      if (prop === 'ready') {
        return async () => {
          await target.init();
        };
      }
      if (prop === 'inject') {
        return async (opts: {
          method: string;
          url: string;
          headers?: Record<string, string>;
          payload?: any;
          body?: any;
        }) => {
          await target.init();
          const expressApp = target.getHttpAdapter().getInstance() as Express;
          const reqMethod = opts.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete' | 'patch';

          const req = (request(expressApp) as any)[reqMethod](opts.url);

          if (opts.headers) {
            for (const [k, v] of Object.entries(opts.headers)) {
              req.set(k, v);
            }
          }

          const payloadToSend = opts.payload !== undefined ? opts.payload : opts.body;
          if (payloadToSend !== undefined) {
            req.send(payloadToSend);
          }

          const res = await req;
          const resBody =
            typeof res.body === 'object' && Object.keys(res.body).length > 0
              ? JSON.stringify(res.body)
              : res.text || '';

          return {
            statusCode: res.status,
            headers: res.headers,
            body: resBody,
            json: () => {
              try {
                return typeof res.body === 'object' && Object.keys(res.body).length > 0
                  ? res.body
                  : JSON.parse(resBody);
              } catch {
                return resBody;
              }
            },
          };
        };
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    },
  }) as NestAppWithInject;

  return {
    app: appProxy,
    db,
    storage,
    queue,
    ai,
    ingestionService,
  };
}

// Backward-compatible alias for existing imports
export const buildApp = createNestApp;
export { AppDependencies };
