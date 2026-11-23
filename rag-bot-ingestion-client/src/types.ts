export interface IngestionJob {
  id: string;
  tenantId: string;
  entityId: string;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  totalDocuments: number;
  processedDocuments: number;
  failedDocuments: number;
  errorSummary?: string;
  sourceType?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IngestionJobDocument {
  id: string;
  tenantId: string;
  jobId: string;
  documentId: string;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  sourceUrl?: string;
  stage?: string;
  sourceType?: string;
  errorMessage?: string;
  downloadMetadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  document?: {
    id: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    isPublic: boolean;
  };
}

export interface UrlIngestionSubmitResponse {
  jobId: string;
  id?: string;
  entityId: string;
  tenantId: string;
  status: string;
  totalUrls: number;
  urls: Array<{
    jobId: string;
    documentId?: string;
    url: string;
    status: string;
    stage?: string;
    errorMessage?: string;
  }>;
  statusUrl: string;
  createdAt: string;
}

export interface IngestionSubmitResponse {
  jobId: string;
  id?: string;
  entityId: string;
  tenantId: string;
  status: string;
  totalDocuments: number;
  statusUrl: string;
  createdAt: string;
}

export interface FileItem {
  file: File;
  name: string;
  size: number;
  type: string;
}

export interface Portal {
  id: string;
  tenantId?: string;
  name: string;
  slug: string;
  description?: string;
  portalUrl?: string;
  portfolioUrl?: string;
  isPublic: boolean;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export type Portfolio = Portal;

export interface DocumentInfo {
  id: string;
  tenantId: string;
  entityId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  errorMessage?: string;
  sourceUrl?: string;
  stage?: string;
  sourceType?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface UserSessionData {
  user: {
    id: string;
    email: string;
    name: string;
    username?: string;
  };
  tenant: {
    id: string;
    name: string;
    slug?: string;
  };
  token: string;
}

export interface QAHistoryItem {
  id: string;
  portalId: string;
  portfolioId?: string; // backwards compatibility
  question: string;
  answer: string;
  citations: any[];
  timestamp: string;
  isError?: boolean;
}

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
  respectRobots?: boolean;
  rateLimitMs?: number;
  allowedOrigins?: string[];
  customExclusions?: string[];
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
  retryCount?: number;
  sizeBytes?: number;
  isUnchanged?: boolean;
  versionId?: string;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CrawlJob {
  id: string;
  tenantId: string;
  entityId: string;
  rootUrl: string;
  status: CrawlStatus;
  config?: CrawlConfig;
  discoveredCount: number;
  queuedCount: number;
  processingCount: number;
  completedCount: number;
  failedCount: number;
  skippedCount: number;
  errorSummary?: string;
  lastRefetchedAt?: string;
  refetchStatus?: 'idle' | 'refetching' | 'completed' | 'failed';
  unchangedCount?: number;
  changedCount?: number;
  newlyDiscoveredCount?: number;
  pages?: CrawlPage[];
  createdAt: string;
  updatedAt: string;
}

export interface StartCrawlResponse {
  crawlJobId: string;
  jobId: string;
  entityId: string;
  tenantId: string;
  status: CrawlStatus;
  rootUrl: string;
  statusUrl: string;
  createdAt: string;
}

// ==========================================
// PORTAL-LEVEL ANALYTICS INTERFACES
// ==========================================

export type RequestOrigin = 'PORTAL_UI' | 'EXTERNAL_INTEGRATION';

export interface AnalyticsFilterParams {
  period?: 'today' | '7d' | '30d' | '90d' | 'custom';
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}

export interface PortalAnalyticsOverview {
  totalSources?: number;
  successfulSources?: number;
  failedSources?: number;
  processingSources?: number;
  successRatePercentage?: number;
  averageProcessingTimeMs?: number;
  totalChatQuestions?: number;
  totalTokensConsumed?: number;
  externalIntegrationTokens?: number;
  portalUiTokens?: number;
  period?: string;
  timezone?: string;
  summary?: {
    totalSources: number;
    readySources?: number;
    successfulSources?: number;
    failedSources: number;
    processingSources: number;
    totalChatQuestions: number;
    totalTokens: number;
    externalIntegrationTokens: number;
    avgProcessingTimeMs: number;
  };
  timeRange?: {
    period: string;
    startDate: string;
    endDate: string;
    timezone: string;
  };
}

export interface IngestionOutcomes {
  successful: number;
  failed: number;
  processing: number;
  pending: number;
  totalOperations: number;
  successRatePercent?: number;
  failureRatePercent?: number;
}

export interface SourceAnalyticsData {
  uniqueSources?: number;
  totalSubmissions?: number;
  newUploads?: number;
  successfulUploads?: number;
  failedUploads?: number;
  sourcesCurrentlyProcessing?: number;
  confirmedReuploads?: number;
  duplicateAttempts?: number;
  existingReplacements?: number;
  updatedSourceVersions?: number;
  websiteRefetches?: number;
  unchangedWebsiteRefetches?: number;
  changedWebsitePages?: number;
  discoveredRoutes?: number;
  removedRoutes?: number;
  deletedSources?: number;
  activity?: {
    totalSources: number;
    newUploads: number;
    successfulUploads: number;
    failedUploads: number;
    processingSources: number;
    duplicateAttempts: number;
    confirmedReuploads: number;
    replacements: number;
    refetchOperations: number;
    unchangedRefetches: number;
    deletedSources: number;
  };
  ingestionOutcomes: IngestionOutcomes;
  categoryDistribution: {
    files: number;
    links: number;
    websites: number;
    total: number;
  };
  fileTypeDistribution: Array<{
    fileType: string;
    count: number;
    percentage: number;
  }>;
  volumeOverTime: Array<{
    date: string;
    files: number;
    links: number;
    websites: number;
    total: number;
  }>;
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
      avgProcessingTimeMs?: number;
      avgTimeMs?: number;
      processedCount: number;
      medianProcessingTimeMs?: number;
      successRate?: number;
      failureCount?: number;
    };
    links: {
      avgTotalProcessingTimeMs?: number;
      avgTimeMs?: number;
      totalProcessed?: number;
      processedCount?: number;
      successful?: number;
      failed?: number;
    };
    websites: {
      avgTotalIngestionMs?: number;
      avgTimeMs?: number;
      avgRoutesProcessed?: number;
      processedCount?: number;
      singlePageAvgExtractionMs?: number;
      multiPageAvgExtractionMs?: number;
    };
  };
  byFileType: Array<{
    fileType: string;
    avgDurationMs?: number;
    avgTimeMs?: number;
    processedCount?: number;
    count?: number;
  }>;
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
    inputTokens?: number;
    promptTokens?: number;
    outputTokens?: number;
    completionTokens?: number;
    embeddingTokens: number;
    totalChatQuestions: number;
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
    queryRewriteTokens?: number;
  };
  byModel: Array<{
    model?: string;
    modelName?: string;
    provider: string;
    totalTokens: number;
    count?: number;
    requestCount?: number;
    inputTokens?: number;
    outputTokens?: number;
    isEstimated?: boolean;
  }>;
  consumptionOverTime?: Array<{
    date: string;
    portalUiTokens: number;
    externalIntegrationTokens: number;
    totalTokens: number;
  }>;
  tokensOverTime?: Array<{
    date: string;
    portalUiTokens: number;
    externalTokens?: number;
    externalIntegrationTokens?: number;
    embeddingTokens?: number;
    totalTokens: number;
  }>;
}

export interface ChatUsageData {
  summary: {
    totalQuestions: number;
    portalUiQuestions: number;
    externalIntegrationQuestions: number;
    totalConversations: number;
    uniqueSessions?: number;
    totalSessions?: number;
    abstainedCount?: number;
    abstentionCount?: number;
    noRelevantContextCount?: number;
    noContextCount?: number;
  };
  responsePerformance?: {
    avgResponseTimeMs: number;
    medianResponseTimeMs: number;
    p95ResponseTimeMs: number;
  };
  performance?: {
    avgResponseTimeMs: number;
    medianResponseTimeMs: number;
    p95ResponseTimeMs: number;
  };
  usageOverTime?: Array<{
    date: string;
    portalUi: number;
    external: number;
    total: number;
  }>;
  questionsOverTime?: Array<{
    date: string;
    portalUiQuestions: number;
    externalIntegrationQuestions: number;
    totalQuestions: number;
  }>;
}

export interface SourceActivityEvent {
  id: string;
  sourceId?: string;
  sourceName?: string;
  sourceCategory?: string;
  fileType?: string;
  activityType?: string;
  eventType?: string;
  outcome?: string;
  status?: string;
  durationMs?: number;
  timestamp?: string;
  createdAt?: string;
  metadata?: Record<string, any>;
  details?: Record<string, any>;
}

export interface SourceActivityData {
  events?: SourceActivityEvent[];
  records?: SourceActivityEvent[];
  total: number;
  page: number;
  limit: number;
}

export interface FailureRecord {
  id: string;
  sourceId?: string;
  sourceName?: string;
  sourceCategory?: string;
  fileType?: string;
  failedStage?: string;
  stage?: string;
  failureCategory: string;
  status?: string;
  finalStatus?: string;
  retryCount: number;
  errorMessage?: string;
  timestamp?: string;
  createdAt?: string;
}

export interface FailureAnalyticsData {
  categories?: Array<{
    category: string;
    count: number;
    percentage: number;
  }>;
  summaryByCategory?: Array<{
    category: string;
    label?: string;
    count: number;
    percentage: number;
  }>;
  failures?: FailureRecord[];
  records?: FailureRecord[];
  total: number;
  page: number;
  limit: number;
}


