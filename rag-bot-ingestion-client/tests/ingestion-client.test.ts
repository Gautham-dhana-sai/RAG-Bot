import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionApiClient } from '../src/api';

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
});
