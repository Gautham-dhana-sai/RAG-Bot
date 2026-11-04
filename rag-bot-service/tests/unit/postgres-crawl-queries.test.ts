import { describe, it, expect, vi } from 'vitest';
import { PostgresDatabaseAdapter } from '../../src/adapters/database/postgres.adapter.js';

describe('PostgresDatabaseAdapter Crawl Query Building', () => {
  const tenantId = '00000000-0000-0000-0000-000000000001';
  const crawlJobId = '00000000-0000-0000-0000-000000000002';
  const pageId = '00000000-0000-0000-0000-000000000003';

  it('should correctly parameterize updateCrawlJob with $ placeholders matching values length', async () => {
    let capturedSql = '';
    let capturedValues: any[] = [];

    const mockPool = {
      query: vi.fn().mockImplementation((sql: string, values: any[]) => {
        capturedSql = sql;
        capturedValues = values;
        return { rows: [] };
      }),
    };

    const adapter = new PostgresDatabaseAdapter('postgres://user:pass@localhost:5432/testdb');
    (adapter as any).pool = mockPool;

    await adapter.updateCrawlJob(tenantId, crawlJobId, {
      status: 'discovering',
      discoveredCount: 10,
      queuedCount: 5,
      processingCount: 2,
      completedCount: 3,
      failedCount: 0,
      skippedCount: 1,
      errorSummary: 'None',
    });

    expect(mockPool.query).toHaveBeenCalledTimes(1);

    // Verify all placeholders are properly formatted as $1, $2, $3...
    const placeholders = capturedSql.match(/\$\d+/g) || [];
    expect(placeholders.length).toBe(capturedValues.length);

    // Verify no bare numbers like "status = 3" without the leading dollar sign
    expect(capturedSql).not.toMatch(/status\s*=\s*\d+/);
    expect(capturedSql).not.toMatch(/discovered_count\s*=\s*\d+/);

    // Verify specific parameters are present
    expect(capturedValues[0]).toBe(tenantId);
    expect(capturedValues[1]).toBe(crawlJobId);
    expect(capturedValues).toContain('discovering');
    expect(capturedValues).toContain(10);
    expect(capturedValues).toContain(5);
  });

  it('should correctly parameterize updateCrawlPage with $ placeholders matching values length', async () => {
    let capturedSql = '';
    let capturedValues: any[] = [];

    const mockPool = {
      query: vi.fn().mockImplementation((sql: string, values: any[]) => {
        capturedSql = sql;
        capturedValues = values;
        return { rows: [] };
      }),
    };

    const adapter = new PostgresDatabaseAdapter('postgres://user:pass@localhost:5432/testdb');
    (adapter as any).pool = mockPool;

    await adapter.updateCrawlPage(tenantId, crawlJobId, pageId, {
      status: 'completed',
      stage: 'INGESTING',
      documentId: '00000000-0000-0000-0000-000000000004',
      title: 'Test Webpage Title',
      canonicalUrl: 'https://example.com/test',
      sizeBytes: 1024,
    });

    expect(mockPool.query).toHaveBeenCalledTimes(1);

    // Verify all placeholders are properly formatted as $1, $2, $3...
    const placeholders = capturedSql.match(/\$\d+/g) || [];
    expect(placeholders.length).toBe(capturedValues.length);

    // Verify no bare numbers like "status = 4" without the leading dollar sign
    expect(capturedSql).not.toMatch(/status\s*=\s*\d+/);
    expect(capturedSql).not.toMatch(/stage\s*=\s*\d+/);
    expect(capturedSql).not.toMatch(/document_id\s*=\s*\d+/);

    expect(capturedValues[0]).toBe(tenantId);
    expect(capturedValues[1]).toBe(crawlJobId);
    expect(capturedValues[2]).toBe(pageId);
    expect(capturedValues).toContain('completed');
    expect(capturedValues).toContain('INGESTING');
    expect(capturedValues).toContain('Test Webpage Title');
  });
});
