export interface HealthResponse {
  status: string;
  timestamp: string;
  version: string;
  environment: string;
  database: {
    adapter: string;
    status: string;
  };
  storage: {
    adapter: string;
  };
  queue: {
    adapter: string;
  };
  ai: {
    provider: string;
    embeddingModel: string;
    chatModel: string;
    dimensions: number;
  };
}

export interface DemoProfile {
  id: string;
  name: string;
  role: string;
  workspaceName: string;
  portfolioName: string;
  tenantId: string;
  entityId: string;
  token: string;
  isPublic: boolean;
  isGuest?: boolean;
}

export interface RegisterRequest {
  name: string;
  email: string;
  workspaceName?: string;
  portfolioName?: string;
}

export interface AuthResponse {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
  tenant: Tenant;
  activeEntity: Entity;
  entities: Entity[];
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface Entity {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  description?: string;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
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
  createdAt: string;
  updatedAt: string;
}

export interface AnswerCitation {
  id?: string;
  tenantId?: string;
  entityId?: string;
  messageId?: string;
  chunkId: string;
  documentId: string;
  documentTitle?: string;
  snippet: string;
  pageNumber?: number;
  score?: number;
}

export interface Message {
  id: string;
  tenantId: string;
  entityId: string;
  conversationId: string;
  senderRole: 'user' | 'assistant' | 'system';
  content: string;
  rewrittenQuery?: string;
  insufficientEvidence?: boolean;
  confidenceScore?: number;
  citations?: AnswerCitation[];
  createdAt: string;
}

export interface MessageRequest {
  content: string;
  topK?: number;
  retrievalMode?: 'hybrid' | 'dense' | 'sparse';
  minScore?: number;
  includeDiagnostics?: boolean;
}

export interface MessageResponse {
  answer: string;
  citations: AnswerCitation[];
  insufficientEvidence: boolean;
  confidence: number;
  conversationId: string;
  messageId: string;
  diagnostics?: {
    rewrittenQuery: string;
    retrievalMode: string;
    topK: number;
    retrievedCount: number;
    totalDurationMs: number;
  };
}

export interface DiagnosticCandidate {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  pageNumber: number;
  score: number;
  denseRank?: number;
  sparseRank?: number;
  snippet: string;
}

export interface DiagnosticsResponse {
  query: string;
  retrievalMode: string;
  retrievedCount: number;
  durationMs: number;
  appliedFilters: {
    tenantId: string;
    entityId: string;
    isPublicOnly: boolean;
    minScore: number;
  };
  candidates: DiagnosticCandidate[];
}

export interface DocumentItem {
  id: string;
  tenantId: string;
  entityId: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string;
  isPublic: boolean;
  status: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED';
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

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
  errorMessage?: string;
  document?: DocumentItem;
}

