import { RequestConfig } from '../types/config.types';
import {
  HealthResponse,
  Tenant,
  Entity,
  Conversation,
  Message,
  MessageRequest,
  MessageResponse,
  DiagnosticsResponse,
  DocumentItem,
  IngestionJob,
  IngestionJobDocument,
} from '../types/api.types';
import { InspectorLog } from '../types/playground.types';

export class RAGApiClient {
  private static lastSessionExpiredTime = 0;
  private config: RequestConfig;
  private onLog?: (log: InspectorLog) => void;

  constructor(config: RequestConfig, onLog?: (log: InspectorLog) => void) {
    this.config = config;
    this.onLog = onLog;
  }

  updateConfig(config: RequestConfig) {
    this.config = config;
  }

  private redactHeaders(headers: Record<string, string>): Record<string, string> {
    const redacted: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === 'authorization') {
        redacted[k] = 'Bearer [REDACTED_SECRET_TOKEN]';
      } else {
        redacted[k] = v;
      }
    }
    return redacted;
  }

  private generateCurl(method: string, url: string, headers: Record<string, string>, body?: any): string {
    const parts = [`curl -X ${method} "${url}"`];
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === 'authorization') {
        parts.push(`  -H "Authorization: Bearer $RAG_API_TOKEN"`);
      } else {
        parts.push(`  -H "${k}: ${v}"`);
      }
    }
    if (body !== undefined) {
      parts.push(`  -d '${JSON.stringify(body, null, 2)}'`);
    }
    return parts.join(' \\\n');
  }

  private async request<T>(
    method: string,
    path: string,
    body?: any,
    customHeaders?: Record<string, string>
  ): Promise<T> {
    const baseUrl = this.config.baseUrl.replace(/\/+$/, '');
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...customHeaders,
    };

    if (body !== undefined && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    // Attach authentication according to active mode
    if (this.config.authMode === 'bearer' && this.config.token) {
      headers['Authorization'] = `Bearer ${this.config.token}`;
    } else if (this.config.authMode === 'dev_headers') {
      if (this.config.userId) headers['X-User-Id'] = this.config.userId;
      if (this.config.tenantId) headers['X-Tenant-Id'] = this.config.tenantId;
    }
    // public_anonymous sends no auth headers

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const startTime = performance.now();

    let status = 0;
    let responseHeaders: Record<string, string> = {};
    let responseBody: any = null;
    let isError = false;

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      status = response.status;
      response.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });

      const text = await response.text();
      try {
        responseBody = text ? JSON.parse(text) : null;
      } catch {
        responseBody = text;
      }

      if (!response.ok) {
        isError = true;
        if (response.status === 401 && this.config.token && typeof window !== 'undefined') {
          const now = Date.now();
          if (now - RAGApiClient.lastSessionExpiredTime > 3000) {
            RAGApiClient.lastSessionExpiredTime = now;
            window.dispatchEvent(new CustomEvent('ragbot:session_expired'));
          }
        }
        const errMessage = responseBody?.error?.message || responseBody?.message || `HTTP ${status}`;
        throw new Error(errMessage);
      }

      return responseBody as T;
    } catch (err: any) {
      isError = true;
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out after ${this.config.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
      const durationMs = Math.round(performance.now() - startTime);

      const log: InspectorLog = {
        timestamp: new Date().toISOString(),
        method,
        url,
        status,
        durationMs,
        requestHeaders: this.redactHeaders(headers),
        requestBody: body,
        responseHeaders,
        responseBody,
        curlCommand: this.generateCurl(method, url, headers, body),
        isError,
      };

      if (this.onLog) {
        this.onLog(log);
      }
    }
  }

  // API Methods
  async checkHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('GET', '/health');
  }

  async getDemoProfiles(): Promise<any[]> {
    return this.request<any[]>('GET', '/v1/auth/demo-profiles');
  }

  async register(data: { name: string; email: string; workspaceName?: string; portfolioName?: string }): Promise<any> {
    return this.request<any>('POST', '/v1/auth/register', data);
  }

  async login(email: string): Promise<any> {
    return this.request<any>('POST', '/v1/auth/login', { email });
  }

  async getMe(): Promise<any> {
    return this.request<any>('GET', '/v1/auth/me');
  }

  async createEntity(
    tenantId = this.config.tenantId,
    data: { name: string; slug?: string; description?: string; isPublic?: boolean }
  ): Promise<Entity> {
    const slug = data.slug || data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return this.request<Entity>('POST', `/v1/tenants/${tenantId}/entities`, {
      name: data.name,
      slug,
      description: data.description,
      isPublic: data.isPublic !== undefined ? data.isPublic : true,
    });
  }

  async getTenant(tenantId = this.config.tenantId): Promise<Tenant> {
    return this.request<Tenant>('GET', `/v1/tenants/${tenantId}`);
  }

  async listEntities(tenantId = this.config.tenantId): Promise<Entity[]> {
    return this.request<Entity[]>('GET', `/v1/tenants/${tenantId}/entities`);
  }

  async getEntity(tenantId = this.config.tenantId, entityId = this.config.entityId): Promise<Entity> {
    return this.request<Entity>('GET', `/v1/tenants/${tenantId}/entities/${entityId}`);
  }

  async listConversations(tenantId = this.config.tenantId, entityId = this.config.entityId): Promise<Conversation[]> {
    return this.request<Conversation[]>('GET', `/v1/tenants/${tenantId}/entities/${entityId}/conversations`);
  }

  async createConversation(
    tenantId = this.config.tenantId,
    entityId = this.config.entityId,
    title = 'Playground Session'
  ): Promise<Conversation> {
    return this.request<Conversation>('POST', `/v1/tenants/${tenantId}/entities/${entityId}/conversations`, { title });
  }

  async sendMessage(
    tenantId: string,
    entityId: string,
    conversationId: string,
    req: MessageRequest
  ): Promise<MessageResponse> {
    return this.request<MessageResponse>(
      'POST',
      `/v1/tenants/${tenantId}/entities/${entityId}/conversations/${conversationId}/messages`,
      req
    );
  }

  async getMessages(
    tenantId = this.config.tenantId,
    entityId = this.config.entityId,
    conversationId = this.config.conversationId
  ): Promise<Message[]> {
    return this.request<Message[]>(
      'GET',
      `/v1/tenants/${tenantId}/entities/${entityId}/conversations/${conversationId}/messages`
    );
  }

  async getRetrievalDiagnostics(
    tenantId = this.config.tenantId,
    entityId = this.config.entityId,
    params: { query: string; topK?: number; mode?: 'hybrid' | 'dense' | 'sparse'; minScore?: number }
  ): Promise<DiagnosticsResponse> {
    return this.request<DiagnosticsResponse>(
      'POST',
      `/v1/tenants/${tenantId}/entities/${entityId}/retrieval/diagnostics`,
      params
    );
  }

  async listDocuments(tenantId = this.config.tenantId, entityId = this.config.entityId): Promise<DocumentItem[]> {
    return this.request<DocumentItem[]>('GET', `/v1/tenants/${tenantId}/entities/${entityId}/documents`);
  }

  async getJobStatus(
    tenantId = this.config.tenantId,
    entityId = this.config.entityId,
    jobId: string
  ): Promise<IngestionJob> {
    return this.request<IngestionJob>(
      'GET',
      `/v1/tenants/${tenantId}/entities/${entityId}/ingestion-jobs/${jobId}`
    );
  }

  async getJobDocuments(
    tenantId = this.config.tenantId,
    entityId = this.config.entityId,
    jobId: string
  ): Promise<IngestionJobDocument[]> {
    return this.request<IngestionJobDocument[]>(
      'GET',
      `/v1/tenants/${tenantId}/entities/${entityId}/ingestion-jobs/${jobId}/documents`
    );
  }
}

