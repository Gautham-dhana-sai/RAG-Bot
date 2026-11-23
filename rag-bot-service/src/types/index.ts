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
  selectedUrls?: string[];
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
  lastRefetchedAt?: Date;
  refetchStatus?: 'idle' | 'refetching' | 'completed' | 'failed';
  unchangedCount?: number;
  changedCount?: number;
  newlyDiscoveredCount?: number;
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
  isUnchanged?: boolean;
  versionId?: string;
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
  activeVersionId?: string;
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

// -------------------------------------------------------------
// Analytics & AI Attribution Types
// -------------------------------------------------------------

export type RequestOrigin = 'PORTAL_UI' | 'EXTERNAL_INTEGRATION';

export type AIOperationType = 'CHAT_COMPLETION' | 'EMBEDDING' | 'QUERY_REWRITE';

export type SourceCategory = 'FILE' | 'LINK' | 'WEBSITE';

export type FailureCategory =
  | 'unsupported_file_type'
  | 'invalid_file'
  | 'download_failure'
  | 'website_extraction_failure'
  | 'insufficient_static_content'
  | 'parsing_failure'
  | 'file_size_limit_exceeded'
  | 'embedding_failure'
  | 'database_storage_failure'
  | 'processing_timeout'
  | 'authorization_failure'
  | 'other_failures';

export type AnalyticsEventType =
  | 'SOURCE_SUBMISSION'
  | 'UPLOAD_COMPLETION'
  | 'DUPLICATE_DETECTION'
  | 'CONFIRMED_REPLACEMENT'
  | 'SOURCE_UPDATE'
  | 'WEBSITE_REFETCH'
  | 'UNCHANGED_WEBSITE_REFETCH'
  | 'SOURCE_DELETION'
  | 'EXTRACTION_START'
  | 'EXTRACTION_COMPLETION'
  | 'INGESTION_START'
  | 'INGESTION_COMPLETION'
  | 'INGESTION_FAILURE'
  | 'INGESTION_RETRY'
  | 'CHAT_REQUEST_RECEIVED'
  | 'CHAT_RESPONSE_COMPLETED'
  | 'CHAT_RESPONSE_FAILED'
  | 'AI_MODEL_REQUEST'
  | 'EMBEDDING_REQUEST'
  | 'RETRIEVAL_COMPLETED'
  | 'RETRIEVAL_FAILED';

export interface AnalyticsEvent {
  id: string;
  tenantId: string;
  entityId: string;
  eventType: AnalyticsEventType;
  requestOrigin: RequestOrigin;
  sourceId?: string;
  documentId?: string;
  documentVersionId?: string;
  ingestionJobId?: string;
  crawlJobId?: string;
  conversationId?: string;
  sessionId?: string;
  requestId?: string;
  status: string;
  durationMs?: number;
  sourceCategory?: SourceCategory;
  fileType?: string;
  stage?: string;
  failureCategory?: FailureCategory;
  metadata: Record<string, any>;
  createdAt: Date;
}

export interface AITokenLog {
  id: string;
  tenantId: string;
  entityId: string;
  requestOrigin: RequestOrigin;
  operationType: AIOperationType;
  provider: string;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  isEstimated: boolean;
  conversationId?: string;
  sessionId?: string;
  requestId?: string;
  durationMs: number;
  status: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface AnalyticsFilterParams {
  period?: 'today' | '7d' | '30d' | '90d' | 'custom';
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
  origin?: RequestOrigin;
  sourceCategory?: SourceCategory;
}

export interface PortalAnalyticsOverview {
  totalSources: number;
  successfulSources: number;
  failedSources: number;
  processingSources: number;
  successRatePercentage: number;
  averageProcessingTimeMs: number;
  totalChatQuestions: number;
  totalTokensConsumed: number;
  externalIntegrationTokens: number;
  portalUiTokens: number;
  period: string;
  timezone: string;
}

export interface IngestionOutcomeDistribution {
  successful: number;
  failed: number;
  processing: number;
  pending: number;
  totalOperations: number;
}

export interface SourceCategoryDistribution {
  files: number;
  links: number;
  websites: number;
  total: number;
}

export interface FileTypeDistributionItem {
  fileType: string;
  count: number;
  percentage: number;
}

export interface SourceAnalyticsData {
  uniqueSources: number;
  totalSubmissions: number;
  newUploads: number;
  successfulUploads: number;
  failedUploads: number;
  sourcesCurrentlyProcessing: number;
  confirmedReuploads: number;
  duplicateAttempts: number;
  existingReplacements: number;
  updatedSourceVersions: number;
  websiteRefetches: number;
  unchangedWebsiteRefetches: number;
  changedWebsitePages: number;
  discoveredRoutes: number;
  removedRoutes: number;
  deletedSources: number;
  ingestionOutcomes: IngestionOutcomeDistribution;
  categoryDistribution: SourceCategoryDistribution;
  fileTypeDistribution: FileTypeDistributionItem[];
  volumeOverTime: Array<{
    date: string;
    files: number;
    links: number;
    websites: number;
    total: number;
  }>;
}

export interface FileTypePerformanceItem {
  fileType: string;
  processedCount: number;
  avgDurationMs: number;
  medianDurationMs: number;
  successRate: number;
  failureCount: number;
}

export interface ProcessingPerformanceData {
  overall: {
    avgProcessingTimeMs: number;
    medianProcessingTimeMs: number;
    fastestProcessingTimeMs: number;
    slowestProcessingTimeMs: number;
    sourcesProcessed: number;
  };
  byCategory: {
    files: {
      avgProcessingTimeMs: number;
      medianProcessingTimeMs: number;
      processedCount: number;
      successRate: number;
      failureCount: number;
    };
    links: {
      totalProcessed: number;
      successful: number;
      failed: number;
      avgDownloadTimeMs: number;
      avgExtractionTimeMs: number;
      avgTotalProcessingTimeMs: number;
    };
    websites: {
      processedCount?: number;
      singlePageAvgExtractionMs: number;
      multiPageAvgExtractionMs: number;
      avgTotalIngestionMs: number;
      avgRouteProcessingMs: number;
      avgRoutesSelected: number;
      avgRoutesProcessed: number;
      failedRouteCount: number;
      unchangedRefetchCount: number;
    };
  };
  byFileType: FileTypePerformanceItem[];
  stageDurations: {
    downloadMs: number;
    extractionMs: number;
    chunkingMs: number;
    embeddingMs: number;
    databaseStorageMs: number;
  };
}

export interface AITokenConsumptionData {
  summary: {
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    embeddingTokens: number;
    totalChatQuestions: number;
    totalAIRequests: number;
    avgTokensPerQuestion: number;
    avgInputTokensPerQuestion: number;
    avgOutputTokensPerQuestion: number;
  };
  byOrigin: {
    portalUiTokens: number;
    externalIntegrationTokens: number;
    portalUiPercentage: number;
    externalPercentage: number;
  };
  byOperation: {
    chatTokens: number;
    embeddingTokens: number;
    queryRewriteTokens: number;
  };
  byModel: Array<{
    provider: string;
    model?: string;
    modelName: string;
    count?: number;
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    isEstimated: boolean;
  }>;
  tokensOverTime: Array<{
    date: string;
    portalUiTokens: number;
    externalTokens: number;
    embeddingTokens: number;
    totalTokens: number;
  }>;
  consumptionOverTime?: Array<{
    date: string;
    portalUiTokens: number;
    externalIntegrationTokens: number;
    totalTokens: number;
  }>;
}

export interface ChatUsageData {
  summary: {
    totalQuestions: number;
    totalConversations: number;
    uniqueSessions: number;
    avgQuestionsPerSession: number;
    portalUiQuestions: number;
    externalIntegrationQuestions: number;
    successfulResponses: number;
    failedResponses: number;
    noRelevantContextCount: number;
    abstainedCount: number;
  };
  responsePerformance: {
    avgResponseTimeMs: number;
    medianResponseTimeMs: number;
    p95ResponseTimeMs: number;
  };
  usageOverTime: Array<{
    date: string;
    portalUi: number;
    external: number;
    total: number;
    avgResponseMs: number;
  }>;
}

export interface SourceActivityRecord {
  id: string;
  sourceName: string;
  sourceCategory: SourceCategory;
  fileType?: string;
  activityType: string;
  timestamp: string;
  outcome: string;
  details?: Record<string, any>;
}

export interface SourceActivityData {
  records: SourceActivityRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface FailureDetailRecord {
  id: string;
  sourceName: string;
  sourceCategory: SourceCategory;
  fileType?: string;
  failedStage: string;
  failureCategory: FailureCategory;
  timestamp: string;
  retryCount: number;
  finalStatus: string;
  errorMessage?: string;
}

export interface FailureAnalyticsData {
  summaryByCategory: Array<{
    category: FailureCategory;
    label: string;
    count: number;
    percentage: number;
  }>;
  records: FailureDetailRecord[];
  total: number;
  page: number;
  limit: number;
}

