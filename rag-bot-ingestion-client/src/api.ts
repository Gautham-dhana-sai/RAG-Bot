import {
  IngestionSubmitResponse,
  IngestionJob,
  IngestionJobDocument,
  Portal,
  DocumentInfo,
  CrawlJob,
  StartCrawlResponse,
} from './types';

export class IngestionApiClient {
  private baseUrl: string;
  private authToken: string;

  constructor(baseUrl: string, authToken = '') {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.authToken = authToken;
  }

  setAuthToken(token: string) {
    this.authToken = token;
  }

  getAuthToken(): string {
    return this.authToken;
  }

  /**
   * Centralized HTTP request helper that detects HTTP 401 (expired/invalid session)
   * and fires a global event to immediately log out the user and clean up storage.
   */
  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      ...(init.headers as Record<string, string> || {}),
    };
    if (this.authToken && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const response = await fetch(url, {
      ...init,
      headers,
    });

    if (response.status === 401) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('ragbot:session_expired'));
      }
    }

    return response;
  }

  // --- Auth & Session ---

  async register(data: {
    username?: string;
    email?: string;
    identifier?: string;
    password?: string;
    name?: string;
    workspaceName?: string;
    portalName?: string;
    portfolioName?: string;
  }): Promise<any> {
    const response = await this.request(`${this.baseUrl}/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || 'Registration failed');
    }
    const res = await response.json();
    if (res.token) {
      this.authToken = res.token;
    }
    return res;
  }

  async login(data: { identifier?: string; username?: string; email?: string; password?: string }): Promise<any> {
    const response = await this.request(`${this.baseUrl}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || 'Invalid username or password');
    }
    const res = await response.json();
    if (res.token) {
      this.authToken = res.token;
    }
    return res;
  }

  async logout(): Promise<void> {
    try {
      await this.request(`${this.baseUrl}/v1/auth/logout`, {
        method: 'POST',
      });
    } catch {
      // Ignore network errors on logout
    }
    this.authToken = '';
  }

  async getMe(): Promise<any> {
    const response = await this.request(`${this.baseUrl}/v1/auth/me`, {
      method: 'GET',
    });
    if (!response.ok) {
      throw new Error('Failed to retrieve user session');
    }
    return response.json();
  }

  async getDemoProfiles(): Promise<any[]> {
    const response = await this.request(`${this.baseUrl}/v1/auth/demo-profiles`);
    if (!response.ok) return [];
    return response.json();
  }

  // --- Portals API ---

  async listPortals(): Promise<Portal[]> {
    let response = await this.request(`${this.baseUrl}/v1/portals`, {
      method: 'GET',
    });
    if (!response.ok && response.status === 404) {
      response = await this.request(`${this.baseUrl}/v1/portfolios`, { method: 'GET' });
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || 'Failed to list portals');
    }
    return response.json();
  }
  listPortfolios = () => this.listPortals();

  async createPortal(url: string, name?: string): Promise<Portal> {
    let response = await this.request(`${this.baseUrl}/v1/portals`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, name }),
    });
    if (!response.ok && response.status === 404) {
      response = await this.request(`${this.baseUrl}/v1/portfolios`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, name }),
      });
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || 'Failed to register portal URL');
    }
    return response.json();
  }
  createPortfolio = (url: string, name?: string) => this.createPortal(url, name);

  async getPortal(portalReference: string): Promise<Portal> {
    let response = await this.request(
      `${this.baseUrl}/v1/portals/${encodeURIComponent(portalReference)}`,
      { method: 'GET' }
    );
    if (!response.ok && response.status === 404) {
      response = await this.request(`${this.baseUrl}/v1/portfolios/${encodeURIComponent(portalReference)}`, { method: 'GET' });
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || 'Failed to fetch portal');
    }
    return response.json();
  }
  getPortfolio = (ref: string) => this.getPortal(ref);

  async deletePortal(portalReference: string): Promise<{ success: boolean; message: string }> {
    let response = await this.request(
      `${this.baseUrl}/v1/portals/${encodeURIComponent(portalReference)}`,
      { method: 'DELETE' }
    );
    if (!response.ok && response.status === 404) {
      response = await this.request(`${this.baseUrl}/v1/portfolios/${encodeURIComponent(portalReference)}`, { method: 'DELETE' });
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || 'Failed to delete portal');
    }
    return response.json();
  }
  deletePortfolio = (ref: string) => this.deletePortal(ref);

  async getPortalDocuments(portalReference: string): Promise<DocumentInfo[]> {
    let response = await this.request(
      `${this.baseUrl}/v1/portals/${encodeURIComponent(portalReference)}/documents`,
      { method: 'GET' }
    );
    if (!response.ok && response.status === 404) {
      response = await this.request(`${this.baseUrl}/v1/portfolios/${encodeURIComponent(portalReference)}/documents`, { method: 'GET' });
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || 'Failed to fetch documents');
    }
    return response.json();
  }
  getPortfolioDocuments = (ref: string) => this.getPortalDocuments(ref);

  getDocumentViewUrl(portalReference: string, documentId: string): string {
    return `${this.baseUrl}/v1/portals/${encodeURIComponent(portalReference)}/documents/${encodeURIComponent(documentId)}/content`;
  }

  async fetchDocumentContentBlob(
    portalReference: string,
    documentId: string
  ): Promise<{ blob: Blob; url: string; text?: string; mimeType: string }> {
    const url = this.getDocumentViewUrl(portalReference, documentId);
    let response = await this.request(url, { method: 'GET' });
    if (!response.ok && response.status === 404) {
      response = await this.request(
        `${this.baseUrl}/v1/portfolios/${encodeURIComponent(portalReference)}/documents/${encodeURIComponent(documentId)}/content`,
        { method: 'GET' }
      );
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `Failed to fetch document content (HTTP ${response.status})`);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    let text: string | undefined;
    if (
      contentType.includes('text') ||
      contentType.includes('markdown') ||
      contentType.includes('json') ||
      contentType.includes('csv')
    ) {
      text = await blob.text();
    }
    return { blob, url: objectUrl, text, mimeType: contentType };
  }

  async deletePortalDocument(
    portalReference: string,
    documentId: string
  ): Promise<{ success: boolean; message: string }> {
    let response = await this.request(
      `${this.baseUrl}/v1/portals/${encodeURIComponent(portalReference)}/documents/${encodeURIComponent(documentId)}`,
      { method: 'DELETE' }
    );
    if (!response.ok && response.status === 404) {
      response = await this.request(
        `${this.baseUrl}/v1/portfolios/${encodeURIComponent(portalReference)}/documents/${encodeURIComponent(documentId)}`,
        { method: 'DELETE' }
      );
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `Failed to delete document`);
    }

    return response.json();
  }
  deletePortfolioDocument = (ref: string, docId: string) => this.deletePortalDocument(ref, docId);

  async submitPortalFiles(
    portalReference: string,
    files: File[]
  ): Promise<IngestionSubmitResponse> {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file, file.name);
    }

    let response = await this.request(
      `${this.baseUrl}/v1/portals/${encodeURIComponent(portalReference)}/ingestion-jobs`,
      {
        method: 'POST',
        body: formData,
      }
    );
    if (!response.ok && response.status === 404) {
      response = await this.request(
        `${this.baseUrl}/v1/portfolios/${encodeURIComponent(portalReference)}/ingestion-jobs`,
        { method: 'POST', body: formData }
      );
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `Upload failed with HTTP ${response.status}`);
    }

    return response.json();
  }
  submitPortfolioFiles = (ref: string, files: File[]) => this.submitPortalFiles(ref, files);

  async submitPortalUrls(
    portalReference: string,
    urls: string[]
  ): Promise<IngestionSubmitResponse> {
    let response = await this.request(
      `${this.baseUrl}/v1/portals/${encodeURIComponent(portalReference)}/urls`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      }
    );
    if (!response.ok && response.status === 404) {
      response = await this.request(
        `${this.baseUrl}/v1/portfolios/${encodeURIComponent(portalReference)}/urls`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls }),
        }
      );
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `URL submission failed with HTTP ${response.status}`);
    }

    return response.json();
  }
  submitPortfolioUrls = (ref: string, urls: string[]) => this.submitPortalUrls(ref, urls);

  async submitPortalWebsites(
    portalReference: string,
    url: string
  ): Promise<IngestionSubmitResponse> {
    let response = await this.request(
      `${this.baseUrl}/v1/portals/${encodeURIComponent(portalReference)}/websites`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      }
    );
    if (!response.ok && response.status === 404) {
      response = await this.request(
        `${this.baseUrl}/api/ingestion/websites`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ portfolioId: portalReference, url }),
        }
      );
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `Website submission failed with HTTP ${response.status}`);
    }

    return response.json();
  }
  submitPortfolioWebsites = (ref: string, url: string) => this.submitPortalWebsites(ref, url);

  async submitWebsite(
    portfolioId: string,
    url: string
  ): Promise<IngestionSubmitResponse> {
    const response = await this.request(`${this.baseUrl}/api/ingestion/websites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ portfolioId, url }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `Website ingestion failed with HTTP ${response.status}`);
    }
    return response.json();
  }

  /**
   * Start a multi-page website crawl for a portal
   */
  async startPortalCrawl(
    portalReference: string,
    data: { url: string; maxPages?: number; maxDepth?: number; selectedUrls?: string[] }
  ): Promise<StartCrawlResponse> {
    let response = await this.request(
      `${this.baseUrl}/v1/portals/${encodeURIComponent(portalReference)}/crawls`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }
    );
    if (!response.ok && response.status === 404) {
      response = await this.request(
        `${this.baseUrl}/v1/portfolios/${encodeURIComponent(portalReference)}/crawls`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }
      );
    }
    if (!response.ok && response.status === 404) {
      response = await this.request(
        `${this.baseUrl}/api/ingestion/websites/crawls`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ portfolioId: portalReference, ...data }),
        }
      );
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `Crawl request failed with HTTP ${response.status}`);
    }

    return response.json();
  }
  startPortfolioCrawl = (ref: string, data: any) => this.startPortalCrawl(ref, data);

  /**
   * Get crawl job details with discovered pages breakdown
   */
  async getPortalCrawl(portalReference: string, crawlJobId: string): Promise<CrawlJob> {
    let response = await this.request(
      `${this.baseUrl}/v1/portals/${encodeURIComponent(portalReference)}/crawls/${encodeURIComponent(crawlJobId)}`,
      { method: 'GET' }
    );
    if (!response.ok && response.status === 404) {
      response = await this.request(
        `${this.baseUrl}/v1/portfolios/${encodeURIComponent(portalReference)}/crawls/${encodeURIComponent(crawlJobId)}`,
        { method: 'GET' }
      );
    }
    if (!response.ok && response.status === 404) {
      response = await this.request(
        `${this.baseUrl}/api/ingestion/websites/crawls/${encodeURIComponent(crawlJobId)}?portfolioId=${encodeURIComponent(portalReference)}`,
        { method: 'GET' }
      );
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `Failed to fetch crawl job`);
    }

    return response.json();
  }
  getPortfolioCrawl = (ref: string, id: string) => this.getPortalCrawl(ref, id);

  /**
   * List website crawl jobs for a portal
   */
  async listPortalCrawls(portalReference: string): Promise<CrawlJob[]> {
    let response = await this.request(
      `${this.baseUrl}/v1/portals/${encodeURIComponent(portalReference)}/crawls`,
      { method: 'GET' }
    );
    if (!response.ok && response.status === 404) {
      response = await this.request(
        `${this.baseUrl}/v1/portfolios/${encodeURIComponent(portalReference)}/crawls`,
        { method: 'GET' }
      );
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `Failed to list crawls`);
    }

    return response.json();
  }
  listPortfolioCrawls = (ref: string) => this.listPortalCrawls(ref);

  /**
   * Retry failed or skipped pages within a crawl job
   */
  async retryPortalCrawl(
    portalReference: string,
    crawlJobId: string,
    pageUrl?: string
  ): Promise<{ message: string; retriedCount: number }> {
    let response = await this.request(
      `${this.baseUrl}/v1/portals/${encodeURIComponent(portalReference)}/crawls/${encodeURIComponent(crawlJobId)}/retry`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageUrl }),
      }
    );
    if (!response.ok && response.status === 404) {
      response = await this.request(
        `${this.baseUrl}/v1/portfolios/${encodeURIComponent(portalReference)}/crawls/${encodeURIComponent(crawlJobId)}/retry`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pageUrl }),
        }
      );
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `Crawl retry failed`);
    }

    return response.json();
  }
  retryPortfolioCrawl = (ref: string, id: string, pageUrl?: string) => this.retryPortalCrawl(ref, id, pageUrl);

  /**
   * Refetch an existing website crawl to reconcile updated routes and content
   */
  async refetchPortalCrawl(
    portalReference: string,
    crawlJobId: string
  ): Promise<StartCrawlResponse> {
    let response = await this.request(
      `${this.baseUrl}/v1/portals/${encodeURIComponent(portalReference)}/crawls/${encodeURIComponent(crawlJobId)}/refetch`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }
    );
    if (!response.ok && response.status === 404) {
      response = await this.request(
        `${this.baseUrl}/v1/portfolios/${encodeURIComponent(portalReference)}/crawls/${encodeURIComponent(crawlJobId)}/refetch`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `Crawl refetch failed`);
    }

    return response.json();
  }
  refetchPortfolioCrawl = (ref: string, id: string) => this.refetchPortalCrawl(ref, id);

  /**
   * Delete an entire website crawl and all associated child pages, documents and storage (Phase 6)
   */
  async deletePortalCrawl(
    portalReference: string,
    crawlJobId: string
  ): Promise<{ success: boolean; message: string }> {
    let response = await this.request(
      `${this.baseUrl}/v1/portals/${encodeURIComponent(portalReference)}/crawls/${encodeURIComponent(crawlJobId)}`,
      { method: 'DELETE' }
    );
    if (!response.ok && response.status === 404) {
      response = await this.request(
        `${this.baseUrl}/v1/portfolios/${encodeURIComponent(portalReference)}/crawls/${encodeURIComponent(crawlJobId)}`,
        { method: 'DELETE' }
      );
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to delete website crawl');
    }
    return response.json();
  }
  deletePortfolioCrawl = (ref: string, id: string) => this.deletePortalCrawl(ref, id);

  /**
   * Check for duplicate sources before ingestion (Phase 2)
   */
  async checkDuplicateSource(
    portalReference: string,
    params: { url?: string; filename?: string }
  ): Promise<{ isDuplicate: boolean; type?: 'website' | 'file'; match?: any }> {
    let response = await this.request(
      `${this.baseUrl}/v1/portals/${encodeURIComponent(portalReference)}/check-duplicate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }
    );
    if (!response.ok && response.status === 404) {
      response = await this.request(
        `${this.baseUrl}/v1/portfolios/${encodeURIComponent(portalReference)}/check-duplicate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        }
      );
    }
    if (!response.ok) {
      return { isDuplicate: false };
    }
    return response.json();
  }

  /**
   * Discover available website routes without creating extraction jobs (Phase 3)
   */
  async discoverPortalWebsiteRoutes(
    portalReference: string,
    params: { url: string; maxPages?: number; maxDepth?: number }
  ): Promise<{ rootUrl: string; discoveredCount: number; pages: Array<{ url: string; path: string; depth: number; source: string }> }> {
    let response = await this.request(
      `${this.baseUrl}/v1/portals/${encodeURIComponent(portalReference)}/crawls/discover`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      }
    );
    if (!response.ok && response.status === 404) {
      response = await this.request(
        `${this.baseUrl}/v1/portfolios/${encodeURIComponent(portalReference)}/crawls/discover`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params),
        }
      );
    }
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to discover website routes');
    }
    return response.json();
  }

  async getPortalJobStatus(
    portalReference: string,
    jobId: string
  ): Promise<IngestionJob & { documents?: IngestionJobDocument[] }> {
    let response = await this.request(
      `${this.baseUrl}/v1/portals/${encodeURIComponent(portalReference)}/ingestion-jobs/${encodeURIComponent(jobId)}`,
      { method: 'GET' }
    );
    if (!response.ok && response.status === 404) {
      response = await this.request(
        `${this.baseUrl}/v1/portfolios/${encodeURIComponent(portalReference)}/ingestion-jobs/${encodeURIComponent(jobId)}`,
        { method: 'GET' }
      );
    }

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `Failed to fetch job status (HTTP ${response.status})`);
    }

    return response.json();
  }
  getPortfolioJobStatus = (ref: string, jobId: string) => this.getPortalJobStatus(ref, jobId);

  // --- Backward Compatible Tenant/Entity Helpers ---

  async listEntities(tenantId: string): Promise<any[]> {
    const response = await this.request(`${this.baseUrl}/v1/tenants/${tenantId}/entities`, {
      method: 'GET',
    });
    if (!response.ok) return [];
    return response.json();
  }

  async createEntity(tenantId: string, name: string): Promise<any> {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const response = await this.request(`${this.baseUrl}/v1/tenants/${tenantId}/entities`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, slug, isPublic: true }),
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to create portfolio');
    }
    return response.json();
  }

  async submitFiles(
    tenantId: string,
    entityId: string,
    files: File[]
  ): Promise<IngestionSubmitResponse> {
    const formData = new FormData();
    for (const file of files) {
      formData.append('files', file, file.name);
    }

    const response = await this.request(
      `${this.baseUrl}/v1/tenants/${tenantId}/entities/${entityId}/ingestion-jobs`,
      {
        method: 'POST',
        body: formData,
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Ingestion submission failed with HTTP ${response.status}`);
    }

    return response.json();
  }

  async getJobStatus(tenantId: string, entityId: string, jobId: string): Promise<IngestionJob> {
    const response = await this.request(
      `${this.baseUrl}/v1/tenants/${tenantId}/entities/${entityId}/ingestion-jobs/${jobId}`,
      {
        method: 'GET',
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Failed to fetch job status (HTTP ${response.status})`);
    }

    return response.json();
  }

  async getJobDocuments(
    tenantId: string,
    entityId: string,
    jobId: string
  ): Promise<IngestionJobDocument[]> {
    const response = await this.request(
      `${this.baseUrl}/v1/tenants/${tenantId}/entities/${entityId}/ingestion-jobs/${jobId}/documents`,
      {
        method: 'GET',
      }
    );

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || `Failed to fetch documents (HTTP ${response.status})`);
    }

    return response.json();
  }

  async askQuestion(
    portfolioReferenceOrTenantId: string,
    entityId: string,
    question: string
  ): Promise<{ answer: string; citations: any[]; insufficientEvidence: boolean; confidence?: number }> {
    // 1. Try dedicated portal verification endpoint first
    const portalRef = entityId || portfolioReferenceOrTenantId;
    try {
      let askRes = await this.request(
        `${this.baseUrl}/v1/portals/${encodeURIComponent(portalRef)}/ask`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question }),
        }
      );
      if (!askRes.ok && askRes.status === 404) {
        askRes = await this.request(
          `${this.baseUrl}/v1/portfolios/${encodeURIComponent(portalRef)}/ask`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question }),
          }
        );
      }
      if (askRes.ok) {
        return await askRes.json();
      }
      // If endpoint exists but returned an error (e.g. 502/400), throw its actual message
      if (askRes.status !== 404) {
        const err = await askRes.json().catch(() => ({}));
        throw new Error(err.error?.message || err.message || `Portal query failed (HTTP ${askRes.status})`);
      }
    } catch (err: any) {
      if (err.message && !err.message.includes('404')) {
        throw err;
      }
      // Fallback to conversation route below only on 404 (endpoint not supported)
    }

    // 2. Fallback to conversation route (legacy backends)
    const tenantId = (portfolioReferenceOrTenantId && portfolioReferenceOrTenantId !== 'default')
      ? portfolioReferenceOrTenantId
      : '';

    const cRes = await this.request(
      `${this.baseUrl}/v1/tenants/${tenantId}/entities/${entityId}/conversations`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: 'Ingestion Client Verification Session' }),
      }
    );
    if (!cRes.ok) {
      const err = await cRes.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `Failed to create verification session (HTTP ${cRes.status})`);
    }
    const conv = await cRes.json();

    const qRes = await this.request(
      `${this.baseUrl}/v1/tenants/${tenantId}/entities/${entityId}/conversations/${conv.id}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: question }),
      }
    );
    if (!qRes.ok) {
      const err = await qRes.json().catch(() => ({}));
      throw new Error(err.error?.message || err.message || `Query failed (HTTP ${qRes.status})`);
    }

    return qRes.json();
  }
}
