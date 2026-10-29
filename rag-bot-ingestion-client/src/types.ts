export interface IngestionJob {
  id: string;
  tenantId: string;
  entityId: string;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  totalDocuments: number;
  processedDocuments: number;
  failedDocuments: number;
  errorSummary?: string;
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
