import {
  IngestionSubmitResponse,
  IngestionJob,
  IngestionJobDocument,
  Portal,
  DocumentInfo,
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
