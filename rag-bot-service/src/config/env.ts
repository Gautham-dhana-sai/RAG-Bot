import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env if present
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  AUTH_SECRET: z.string().default('dev-persona-rag-secret-token-change-in-prod'),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),

  DATABASE_URL: z.string().optional().default(''),
  DB_POOL_MAX: z.coerce.number().default(10),
  DB_USE_SSL: z.string().transform(v => v === 'true').default('false'),

  STORAGE_ADAPTER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default(path.join(process.cwd(), 'data', 'storage')),
  S3_BUCKET_NAME: z.string().default('personarag-documents'),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().optional().default(''),
  AWS_SECRET_ACCESS_KEY: z.string().optional().default(''),
  AWS_SESSION_TOKEN: z.string().optional().default(''),

  QUEUE_ADAPTER: z.enum(['local', 'sqs']).default('local'),
  SQS_QUEUE_URL: z.string().optional().default(''),

  AI_PROVIDER: z.enum(['mock', 'openai', 'cohere', 'gemini']).default('gemini'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_BASE_URL: z.string().default('https://generativelanguage.googleapis.com/v1beta/openai'),
  CHAT_MODEL: z.string().default('gemini-3.8-flash'),
  EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),
  EMBEDDING_DIMENSIONS: z.coerce.number().default(3072),

  GEMINI_API_KEY: z.string().optional().default(''),

  COHERE_API_KEY: z.string().optional().default(''),
  COHERE_CHAT_MODEL: z.string().default('command-r-plus-08-2024'),
  COHERE_EMBEDDING_MODEL: z.string().default('embed-english-v3.0'),

  MAX_FILE_SIZE_BYTES: z.coerce.number().default(25 * 1024 * 1024), // 25MB
  CHUNK_SIZE: z.coerce.number().default(1000),
  CHUNK_OVERLAP: z.coerce.number().default(200),
  INGESTION_MAX_RETRIES: z.coerce.number().default(3),

  RETRIEVAL_TOP_K: z.coerce.number().default(10),
  RETRIEVAL_RRF_K: z.coerce.number().default(60),
  RETRIEVAL_MIN_SCORE: z.coerce.number().default(0.005),
  MAX_HISTORY_MESSAGES: z.coerce.number().default(10),
});

export type EnvConfig = z.infer<typeof envSchema>;

function loadConfig(): EnvConfig {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:', result.error.format());
    throw new Error('Environment configuration validation failed');
  }

  // Fail fast if OpenAI provider requested without API key
  if (result.data.AI_PROVIDER === 'openai' && !result.data.OPENAI_API_KEY) {
    throw new Error('AI_PROVIDER is set to "openai" but OPENAI_API_KEY is not configured. Configure OPENAI_API_KEY or set AI_PROVIDER="mock".');
  }

  return result.data;
}

export const env = loadConfig();

