import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionApiClient } from '../src/api';
import { validateFileOrPhotoUrlClient } from '../src/utils/validators';

describe('IngestionApiClient', () => {
  let client: IngestionApiClient;

  beforeEach(() => {
    client = new IngestionApiClient('http://localhost:3000');
  });

  it('should register a new account with email and password', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'ragbot_sess_test123',
        user: { id: 'u-1', email: 'test@example.com', name: 'test' },
        tenant: { id: 't-1', name: 'test Workspace' },
      }),
    });

    const res = await client.register({ email: 'test@example.com', password: 'Password123!' });
    expect(res.token).toBe('ragbot_sess_test123');
    expect(client.getAuthToken()).toBe('ragbot_sess_test123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/v1/auth/register',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ email: 'test@example.com', password: 'Password123!' }),
      })
    );
  });

  it('should login with email and password', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: 'ragbot_sess_login999',
        user: { id: 'u-1', email: 'test@example.com' },
        tenant: { id: 't-1', name: 'test Workspace' },
      }),
    });

    const res = await client.login({ email: 'test@example.com', password: 'Password123!' });
    expect(res.token).toBe('ragbot_sess_login999');
    expect(client.getAuthToken()).toBe('ragbot_sess_login999');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/v1/auth/login',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
  });

  it('should list user portals', async () => {
    client.setAuthToken('ragbot_sess_login999');
    const mockPortals = [
      {
        id: 'port-1',
        name: 'Alex AI Portfolio',
        portalUrl: 'https://alex.dev/portfolio',
        documentCount: 3,
      },
    ];

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockPortals,
    });

    const list = await client.listPortfolios();
    expect(list.length).toBe(1);
    expect(list[0].name).toBe('Alex AI Portfolio');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/v1/portals',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: 'Bearer ragbot_sess_login999' }),
      })
    );
  });

  it('should create a portal with a portal URL', async () => {
    client.setAuthToken('ragbot_sess_login999');
    const mockCreated = {
      id: 'port-new',
      name: 'sarah.engineer',
      portalUrl: 'https://sarah.engineer',
      documentCount: 0,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockCreated,
    });

    const created = await client.createPortfolio('https://sarah.engineer');
    expect(created.id).toBe('port-new');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/v1/portals',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer ragbot_sess_login999',
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ url: 'https://sarah.engineer', name: undefined }),
      })
    );
  });

  it('should submit files to a portfolio and track job status', async () => {
    client.setAuthToken('ragbot_sess_login999');
    const mockJob = {
      jobId: 'job-999',
      id: 'job-999',
      totalDocuments: 1,
      status: 'PROCESSING',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockJob,
    });

    const file = new File(['Content'], 'file.txt', { type: 'text/plain' });
    const res = await client.submitPortfolioFiles('port-new', [file]);
    expect(res.jobId).toBe('job-999');

    // Poll status
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'job-999',
        status: 'READY',
        totalDocuments: 1,
        processedDocuments: 1,
        failedDocuments: 0,
        documents: [],
      }),
    });

    const status = await client.getPortfolioJobStatus('port-new', 'job-999');
    expect(status.status).toBe('READY');
    expect(status.processedDocuments).toBe(1);
  });

  it('should submit files with proper FormData and headers (Legacy Tenant/Entity check)', async () => {
    client.setAuthToken('ragbot_sess_login999');
    const mockResponse = {
      jobId: 'job-123',
      entityId: 'entity-abc',
      tenantId: 'tenant-xyz',
      status: 'PROCESSING',
      totalDocuments: 2,
      statusUrl: '/v1/tenants/tenant-xyz/entities/entity-abc/ingestion-jobs/job-123',
      createdAt: new Date().toISOString(),
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const fakeFile1 = new File(['Alex Rivera resume'], 'resume.txt', { type: 'text/plain' });
    const fakeFile2 = new File(['Cloud AI project'], 'project.md', { type: 'text/markdown' });

    const result = await client.submitFiles('tenant-xyz', 'entity-abc', [fakeFile1, fakeFile2]);

    expect(result.jobId).toBe('job-123');
    expect(result.status).toBe('PROCESSING');
    expect(result.totalDocuments).toBe(2);
  });

  it('should clean doc citations without corrupting markdown bold or bullets', async () => {
    const { cleanDocCitationTags } = await import('../src/utils/formatters');
    const input = 'Here is the experience [DOC-12345]:\n### **Inncircles Technologies**\n- **Role**: Developer (CHUNK-678)';
    const cleaned = cleanDocCitationTags(input);
    expect(cleaned).toContain('### **Inncircles Technologies**');
    expect(cleaned).toContain('- **Role**: Developer');
    expect(cleaned).not.toContain('DOC-12345');
    expect(cleaned).not.toContain('CHUNK-678');
  });

  it('should submit website URL via submitPortalWebsites and submitWebsite', async () => {
    client.setAuthToken('ragbot_sess_login999');
    const mockResponse = {
      jobId: 'web-job-1',
      entityId: 'port-1',
      tenantId: 't-1',
      status: 'PENDING',
      totalDocuments: 1,
      statusUrl: '/v1/portals/port-1/ingestion-jobs/web-job-1',
      createdAt: new Date().toISOString(),
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockResponse,
    });

    const res1 = await client.submitPortalWebsites('port-1', 'https://example.com/about');
    expect(res1.jobId).toBe('web-job-1');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/v1/portals/port-1/websites',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ url: 'https://example.com/about' }),
      })
    );

    const res2 = await client.submitWebsite('port-1', 'https://example.com/pricing');
    expect(res2.jobId).toBe('web-job-1');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/api/ingestion/websites',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ portfolioId: 'port-1', url: 'https://example.com/pricing' }),
      })
    );
  });

  describe('validateFileOrPhotoUrlClient', () => {
    it('should reject webpage and social media links and guide user to Websites tab', () => {
      const fbUrl = 'https://www.facebook.com/groups/756561709660282/posts/1300105771972537/';
      const res = validateFileOrPhotoUrlClient(fbUrl);
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('URL does not point to a supported file or photo');
      expect(res.reason).toContain('Websites tab');
      expect(res.reason).not.toContain('Webpage crawling is not supported');
    });

    it('should reject HTML files and guide user to Websites tab', () => {
      const htmlUrl = 'https://example.com/about.html';
      const res = validateFileOrPhotoUrlClient(htmlUrl);
      expect(res.isValid).toBe(false);
      expect(res.reason).toContain('HTML webpages (.html) cannot be imported here');
      expect(res.reason).toContain('Websites tab');
    });

    it('should accept valid file and photo links', () => {
      expect(validateFileOrPhotoUrlClient('https://example.com/document.pdf').isValid).toBe(true);
      expect(validateFileOrPhotoUrlClient('https://example.com/photo.png').isValid).toBe(true);
      expect(validateFileOrPhotoUrlClient('https://example.com/data.txt').isValid).toBe(true);
    });
  });

  describe('Portal Knowledge Bar and Authoritative Crawl Job Representation (Scenarios E & F)', () => {
    it('should submit multi-page crawl via client.startPortalCrawl', async () => {
      client.setAuthToken('ragbot_sess_login999');
      const mockCrawl = {
        crawlJobId: 'crawl-123',
        jobId: 'crawl-123',
        rootUrl: 'https://example.com',
        status: 'queued',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockCrawl,
      });

      const res = await client.startPortalCrawl('port-1', {
        url: 'https://example.com',
        maxPages: 30,
        maxDepth: 3,
      });

      expect(res.crawlJobId).toBe('crawl-123');
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3000/v1/portals/port-1/crawls',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ url: 'https://example.com', maxPages: 30, maxDepth: 3 }),
        })
      );
    });

    it('should list portal crawls via client.listPortalCrawls', async () => {
      client.setAuthToken('ragbot_sess_login999');
      const mockCrawls = [
        {
          id: 'crawl-123',
          rootUrl: 'https://example.com',
          status: 'completed',
          discoveredCount: 4,
          completedCount: 4,
        },
      ];

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockCrawls,
      });

      const res = await client.listPortalCrawls('port-1');
      expect(res.length).toBe(1);
      expect(res[0].rootUrl).toBe('https://example.com');
      expect(res[0].completedCount).toBe(4);
    });
  });
});
