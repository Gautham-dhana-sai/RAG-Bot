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

