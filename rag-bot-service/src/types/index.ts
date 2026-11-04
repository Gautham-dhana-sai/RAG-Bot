// Core domain interfaces and types for PersonaRAG

export type IngestionJobStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
export type DocumentProcessingStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
export type JobSourceType = 'DIRECT_UPLOAD' | 'URL_IMPORT' | 'WEBSITE_IMPORT' | 'WEBSITE_CRAWL';
export type JobDocumentStage =
  | 'QUEUED_FOR_DOWNLOAD'
  | 'FETCHING_PAGE'
  | 'EXTRACTING_CONTENT'
  | 'DOWNLOADING'
  | 'DOWNLOAD_FAILED'
  | 'NO_CONTENT_FOUND'
  | 'UPLOADED_TO_S3'
  | 'QUEUED_FOR_INGESTION'
  | 'PROCESSING'
  | 'READY'
  | 'FAILED'
  | 'SKIPPED';

export type CrawlStatus =
  | 'queued'
  | 'discovering'
  | 'processing_pages'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled';

export type CrawlPageStatus =
  | 'discovered'
  | 'queued'
  | 'fetching'
  | 'extracting'
  | 'uploaded'
  | 'ingesting'
  | 'completed'
  | 'skipped'
  | 'failed';

export interface CrawlConfig {
  maxPages?: number;
  maxDepth?: number;
  allowedOrigins?: string[];
  includePatterns?: string[];
  excludePatterns?: string[];
  respectRobotsTxt?: boolean;
}

export interface CrawlJob {
  id: string;
  tenantId: string;
  entityId: string;
  rootUrl: string;
  status: CrawlStatus;
  config: CrawlConfig;
  discoveredCount: number;
  queuedCount: number;
  processingCount: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  errorSummary?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

export interface CrawlPage {
  id: string;
  tenantId: string;
  entityId: string;
  crawlJobId: string;
  documentId?: string;
  originalUrl: string;
  normalizedUrl: string;
  canonicalUrl?: string;
  title?: string;
  contentHash?: string;
  objectKey?: string;
  status: CrawlPageStatus;
  stage?: string;
  depth: number;
  retryCount: number;
  sizeBytes?: number;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}
export type MessageSenderRole = 'user' | 'assistant' | 'system';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  email: string;
  name: string;
  username?: string;
  passwordHash?: string;
  salt?: string;
  isSuperadmin: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantMembership {
  id: string;
  tenantId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  createdAt: Date;
}

export interface Entity {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description?: string;
  portalUrl?: string;
  portfolioUrl?: string;
  isPublic: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntityMembership {
  id: string;
  tenantId: string;
  entityId: string;
  userId: string;
  role: 'editor' | 'viewer';
  createdAt: Date;
}

export interface Document {
  id: string;
  tenantId: string;
  entityId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  objectKey: string;
  isPublic: boolean;
  status: DocumentProcessingStatus;
  errorMessage?: string;
  sourceUrl?: string;
  stage?: string;
  sourceType?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentVersion {
  id: string;
  tenantId: string;
  entityId: string;
  documentId: string;
  versionNumber: number;
  contentHash: string;
  objectKey: string;
  sizeBytes: number;
  processingVersion: string;
  createdAt: Date;
}

export interface DocumentChunk {
  id: string;
  tenantId: string;
  entityId: string;
  documentId: string;
  versionId?: string;
  chunkIndex: number;
  chunkText: string;
  pageNumber?: number;
  startOffset?: number;
  endOffset?: number;
  embedding?: number[];
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface IngestionJob {
  id: string;
  tenantId: string;
  entityId: string;
  status: IngestionJobStatus;
  sourceType?: JobSourceType;
  totalDocuments: number;
  processedDocuments: number;
  failedDocuments: number;
  retryCount: number;
  errorSummary?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface IngestionJobDocument {
  id: string;
  tenantId: string;
  jobId: string;
  documentId: string;
  status: DocumentProcessingStatus;
  sourceUrl?: string;
  stage?: JobDocumentStage;
  sourceType?: string;
  errorMessage?: string;
  downloadMetadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface UrlDownloadJobItem {
  jobId: string;
  documentId?: string;
  url: string;
  status: string;
  stage?: JobDocumentStage;
  errorMessage?: string;
}

export interface UrlIngestionJobResponse {
  jobId: string;
  entityId: string;
  tenantId: string;
  status: IngestionJobStatus;
  totalUrls: number;
  urls: UrlDownloadJobItem[];
  statusUrl: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  tenantId: string;
  entityId: string;
  userId?: string;
  sessionToken?: string;
  title: string;
  isPublic: boolean;
  contextSummary?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  tenantId: string;
  entityId: string;
  conversationId: string;
  senderRole: MessageSenderRole;
  content: string;
  rewrittenQuery?: string;
  insufficientEvidence: boolean;
  confidenceScore?: number;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface AnswerCitation {
  id: string;
  tenantId: string;
  entityId: string;
  messageId: string;
  chunkId: string;
  documentId: string;
  snippet: string;
  pageNumber?: number;
  score?: number;
  documentTitle?: string;
  createdAt: Date;
}

export interface ScoredChunk {
  chunk: DocumentChunk;
  document: Document;
  score: number;
  denseRank?: number;
  sparseRank?: number;
}

export interface RAGAnswerResponse {
  answer: string;
  citations: AnswerCitation[];
  insufficientEvidence: boolean;
  confidence: number;
  conversationId: string;
  messageId: string;
}

export interface AuthContext {
  userId?: string;
  tenantId?: string;
  roles: string[];
  isSuperadmin: boolean;
  isPublicVisitor: boolean;
}

