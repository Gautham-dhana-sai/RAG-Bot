import { Injectable, Inject, Optional } from '@nestjs/common';
import { Request } from 'express';
import { IDatabaseAdapter } from '../../adapters/database/database.interface.js';
import {
  AuthContext,
  AnalyticsEvent,
  AnalyticsEventType,
  AITokenLog,
  AIOperationType,
  RequestOrigin,
  SourceCategory,
  FailureCategory,
  AnalyticsFilterParams,
  PortalAnalyticsOverview,
  SourceAnalyticsData,
  ProcessingPerformanceData,
  AITokenConsumptionData,
  ChatUsageData,
  SourceActivityData,
  FailureAnalyticsData,
} from '../../types/index.js';
import { AuthService } from '../auth/auth.service.js';
import { logger } from '../../shared/logger.js';
import { normalizePortfolioUrl } from '../../shared/password.js';
import { ForbiddenError, NotFoundError, UnauthorizedError } from '../../shared/errors.js';

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject('IDatabaseAdapter') private readonly db: IDatabaseAdapter,
    @Optional() @Inject(AuthService) private readonly authService?: AuthService
  ) {}

  /**
   * Determine trusted request origin server-side.
   * Client-supplied origin is never trusted without session authorization.
   */
  resolveRequestOrigin(req?: Request, authContext?: AuthContext): RequestOrigin {
    if (!authContext || authContext.isPublicVisitor || !authContext.userId) {
      return 'EXTERNAL_INTEGRATION';
    }

    // Check if request carries explicit external header from external integration SDK
    const explicitOrigin = (req?.headers['x-persona-origin'] || req?.headers['x-request-origin']) as string | undefined;
    if (explicitOrigin === 'external_integration') {
      return 'EXTERNAL_INTEGRATION';
    }

    // Verified interactive user session
    return 'PORTAL_UI';
  }

  /**
   * Safe non-blocking event recorder.
   * Any errors are captured and logged without disrupting user requests.
   */
  async recordEvent(params: {
    tenantId: string;
    entityId: string;
    eventType: AnalyticsEventType;
    requestOrigin?: RequestOrigin;
    sourceId?: string;
    documentId?: string;
    documentVersionId?: string;
    ingestionJobId?: string;
    crawlJobId?: string;
    conversationId?: string;
    sessionId?: string;
    requestId?: string;
    status?: string;
    durationMs?: number;
    sourceCategory?: SourceCategory;
    fileType?: string;
    stage?: string;
    failureCategory?: FailureCategory;
    metadata?: Record<string, any>;
  }): Promise<AnalyticsEvent | null> {
    try {
      if (!params.tenantId || !params.entityId) return null;
      return await this.db.recordAnalyticsEvent({
        tenantId: params.tenantId,
        entityId: params.entityId,
        eventType: params.eventType,
        requestOrigin: params.requestOrigin || 'PORTAL_UI',
        sourceId: params.sourceId,
        documentId: params.documentId,
        documentVersionId: params.documentVersionId,
        ingestionJobId: params.ingestionJobId,
        crawlJobId: params.crawlJobId,
        conversationId: params.conversationId,
        sessionId: params.sessionId,
        requestId: params.requestId,
        status: params.status || 'SUCCESS',
        durationMs: params.durationMs,
        sourceCategory: params.sourceCategory,
        fileType: params.fileType,
        stage: params.stage,
        failureCategory: params.failureCategory,
        metadata: params.metadata || {},
      });
    } catch (err: any) {
      logger.warn(`[AnalyticsService] Failed to record event ${params.eventType}: ${err.message}`);
      return null;
    }
  }

  /**
   * Safe non-blocking token logger.
   * Records provider-reported token usage accurately without disrupting responses.
   */
  async recordTokenLog(params: {
    tenantId: string;
    entityId: string;
    requestOrigin: RequestOrigin;
    operationType: AIOperationType;
    provider: string;
    modelName: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    isEstimated?: boolean;
    conversationId?: string;
    sessionId?: string;
    requestId?: string;
    durationMs?: number;
    status?: string;
    metadata?: Record<string, any>;
  }): Promise<AITokenLog | null> {
    try {
      if (!params.tenantId || !params.entityId) return null;
      return await this.db.recordAITokenLog({
        tenantId: params.tenantId,
        entityId: params.entityId,
        requestOrigin: params.requestOrigin,
        operationType: params.operationType,
        provider: params.provider,
        modelName: params.modelName,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        totalTokens: params.totalTokens,
        isEstimated: Boolean(params.isEstimated),
        conversationId: params.conversationId,
        sessionId: params.sessionId,
        requestId: params.requestId,
        durationMs: params.durationMs || 0,
        status: params.status || 'SUCCESS',
        metadata: params.metadata,
      });
    } catch (err: any) {
      logger.warn(`[AnalyticsService] Failed to record token log: ${err.message}`);
      return null;
    }
  }

  /**
   * Classify file/source into business-friendly category and file type
   */
  classifySource(params: {
    filename?: string;
    url?: string;
    mimeType?: string;
    sourceType?: string;
  }): { sourceCategory: SourceCategory; fileType: string } {
    const { filename = '', url = '', mimeType = '', sourceType = '' } = params;

    if (sourceType === 'WEBSITE_IMPORT' || sourceType === 'WEBSITE_CRAWL' || (mimeType === 'text/markdown' && Boolean(url))) {
      return { sourceCategory: 'WEBSITE', fileType: 'website' };
    }

    if (sourceType === 'URL_IMPORT' || Boolean(url)) {
      return { sourceCategory: 'LINK', fileType: this.detectFileType(filename || url, mimeType) };
    }

    return { sourceCategory: 'FILE', fileType: this.detectFileType(filename, mimeType) };
  }

  private detectFileType(filename: string, mimeType: string): string {
    const lowerMime = (mimeType || '').toLowerCase();
    if (lowerMime.includes('pdf')) return 'pdf';
    if (lowerMime.includes('word') || lowerMime.includes('docx')) return 'docx';
    if (lowerMime.includes('doc')) return 'doc';
    if (lowerMime.includes('plain')) return 'txt';
    if (lowerMime.includes('markdown')) return 'markdown';
    if (lowerMime.includes('png')) return 'png';
    if (lowerMime.includes('jpeg') || lowerMime.includes('jpg')) return 'jpeg';
    if (lowerMime.includes('webp')) return 'webp';

    const clean = filename.split('?')[0];
    const parts = clean.split('.');
    if (parts.length > 1) {
      const ext = parts.pop()!.toLowerCase();
      if (['pdf', 'docx', 'doc', 'txt', 'md', 'markdown', 'png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
        return ext === 'md' ? 'markdown' : ext;
      }
    }
    return 'other';
  }

  /**
   * Classify raw error messages into high-level business categories
   */
  classifyFailure(error: any, stage?: string): FailureCategory {
    const msg = (error?.message || String(error || '')).toLowerCase();
    const stg = (stage || '').toLowerCase();

    if (msg.includes('unsupported') || msg.includes('file type') || msg.includes('mime type')) {
      return 'unsupported_file_type';
    }
    if (msg.includes('size limit') || msg.includes('too large') || msg.includes('exceeded')) {
      return 'file_size_limit_exceeded';
    }
    if (msg.includes('download') || msg.includes('enotfound') || msg.includes('network') || msg.includes('econnrefused') || stg.includes('download')) {
      return 'download_failure';
    }
    if (msg.includes('static') || msg.includes('empty text') || msg.includes('insufficient') || msg.includes('no content')) {
      return 'insufficient_static_content';
    }
    if (msg.includes('extract') || msg.includes('crawl') || stg.includes('extract')) {
      return 'website_extraction_failure';
    }
    if (msg.includes('parse') || msg.includes('parsing') || msg.includes('corrupt') || msg.includes('invalid format')) {
      return 'parsing_failure';
    }
    if (msg.includes('embed') || msg.includes('vector') || stg.includes('embed')) {
      return 'embedding_failure';
    }
    if (msg.includes('database') || msg.includes('postgres') || msg.includes('sql') || msg.includes('foreign key') || stg.includes('storage')) {
      return 'database_storage_failure';
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return 'processing_timeout';
    }
    if (msg.includes('auth') || msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('permission')) {
      return 'authorization_failure';
    }
    if (msg.includes('invalid file') || msg.includes('empty file') || msg.includes('zero bytes')) {
      return 'invalid_file';
    }

    return 'other_failures';
  }

  /**
   * Resolve and authorize portal reference for analytics queries
   */
  async resolveAndAuthorizePortal(auth: AuthContext, portalReference: string): Promise<{ tenantId: string; entityId: string }> {
    if (!auth || (auth.isPublicVisitor && !auth.isSuperadmin)) {
      throw new UnauthorizedError('Authentication required to access portal analytics');
    }

    let tenantId = auth.tenantId;
    if (!tenantId && auth.userId) {
      const membership = await this.db.getUserTenantMembership(auth.userId);
      if (membership) tenantId = membership.tenantId;
    }

    if (!tenantId) {
      throw new ForbiddenError('No workspace associated with your user account');
    }

    const decoded = decodeURIComponent(portalReference);

    // 1. Try finding in user's tenant
    const entity = await this.db.getEntityByReference(tenantId, decoded);
    if (entity) {
      if (this.authService) {
        await this.authService.authorizeEntityAccess(auth, tenantId, entity.id, false);
      }
      return { tenantId, entityId: entity.id };
    }

    // 2. Try URL lookup
    try {
      const norm = normalizePortfolioUrl(decoded);
      const other = await this.db.getEntityByPortfolioUrl(norm);
      if (other && other.tenantId === tenantId) {
        if (this.authService) {
          await this.authService.authorizeEntityAccess(auth, tenantId, other.id, false);
        }
        return { tenantId, entityId: other.id };
      }
    } catch {
      // not a url
    }

    throw new NotFoundError('Portal', portalReference);
  }

  // --- Endpoints Service Implementations ---

  async getOverview(auth: AuthContext, portalRef: string, params: AnalyticsFilterParams): Promise<PortalAnalyticsOverview> {
    const { tenantId, entityId } = await this.resolveAndAuthorizePortal(auth, portalRef);
    return this.db.getAnalyticsOverview(tenantId, entityId, params);
  }

  async getSourceAnalytics(auth: AuthContext, portalRef: string, params: AnalyticsFilterParams): Promise<SourceAnalyticsData> {
    const { tenantId, entityId } = await this.resolveAndAuthorizePortal(auth, portalRef);
    return this.db.getSourceAnalytics(tenantId, entityId, params);
  }

  async getProcessingPerformance(auth: AuthContext, portalRef: string, params: AnalyticsFilterParams): Promise<ProcessingPerformanceData> {
    const { tenantId, entityId } = await this.resolveAndAuthorizePortal(auth, portalRef);
    return this.db.getProcessingPerformance(tenantId, entityId, params);
  }

  async getAITokenConsumption(auth: AuthContext, portalRef: string, params: AnalyticsFilterParams): Promise<AITokenConsumptionData> {
    const { tenantId, entityId } = await this.resolveAndAuthorizePortal(auth, portalRef);
    return this.db.getAITokenConsumption(tenantId, entityId, params);
  }

  async getChatUsage(auth: AuthContext, portalRef: string, params: AnalyticsFilterParams): Promise<ChatUsageData> {
    const { tenantId, entityId } = await this.resolveAndAuthorizePortal(auth, portalRef);
    return this.db.getChatUsage(tenantId, entityId, params);
  }

  async getSourceActivity(auth: AuthContext, portalRef: string, params: AnalyticsFilterParams): Promise<SourceActivityData> {
    const { tenantId, entityId } = await this.resolveAndAuthorizePortal(auth, portalRef);
    return this.db.getSourceActivity(tenantId, entityId, params);
  }

  async getFailureAnalytics(auth: AuthContext, portalRef: string, params: AnalyticsFilterParams): Promise<FailureAnalyticsData> {
    const { tenantId, entityId } = await this.resolveAndAuthorizePortal(auth, portalRef);
    return this.db.getFailureAnalytics(tenantId, entityId, params);
  }
}