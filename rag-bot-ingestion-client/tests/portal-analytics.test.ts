import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionApiClient } from '../src/api';

describe('Portal Analytics Client API & Ingestion Outcomes Verification', () => {
  let client: IngestionApiClient;

  beforeEach(() => {
    client = new IngestionApiClient('http://localhost:3000', 'mock_token_123');
  });

  it('should fetch portal analytics overview with filter query params', async () => {
    const mockOverview = {
      summary: {
        totalSources: 12,
        readySources: 10,
        failedSources: 2,
        processingSources: 0,
        totalChatQuestions: 45,
        totalTokens: 15400,
        externalIntegrationTokens: 7200,
        avgProcessingTimeMs: 1420,
      },
      timeRange: {
        period: '30d',
        startDate: '2026-10-07T00:00:00.000Z',
        endDate: '2026-11-06T00:00:00.000Z',
        timezone: 'UTC',
      },
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockOverview,
    });

    const res = await client.getPortalAnalyticsOverview('portal-alpha', { period: '30d' });

    expect(res).toEqual(mockOverview);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://localhost:3000/v1/portals/portal-alpha/analytics/overview?period=30d',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mock_token_123',
        }),
      })
    );
  });

  it('should fetch source analytics with mutually exclusive ingestion outcome metrics for pie/donut charts', async () => {
    const mockSourceAnalytics = {
      activity: {
        totalSources: 15,
        newUploads: 12,
        successfulUploads: 11,
        failedUploads: 2,
        processingSources: 2,
        duplicateAttempts: 3,
        confirmedReuploads: 2,
        replacements: 2,
        refetchOperations: 1,
        unchangedRefetches: 1,
        deletedSources: 1,
      },
      ingestionOutcomes: {
        successful: 11,
        failed: 2,
        processing: 1,
        pending: 1,
        totalOperations: 15,
        successRatePercent: 73,
        failureRatePercent: 13,
      },
      categoryDistribution: {
        files: 10,
        links: 3,
        websites: 2,
        total: 15,
      },
      fileTypeDistribution: [
        { fileType: 'pdf', count: 8, percentage: 53 },
        { fileType: 'docx', count: 2, percentage: 13 },
      ],
      volumeOverTime: [],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSourceAnalytics,
    });

    const res = await client.getPortalSourceAnalytics('portal-alpha', { period: '7d' });

    expect(res.ingestionOutcomes.successful).toBe(11);
    expect(res.ingestionOutcomes.failed).toBe(2);
    expect(res.ingestionOutcomes.processing).toBe(1);
    expect(res.ingestionOutcomes.pending).toBe(1);
    // Mutually exclusive outcome sum check
    const sum = res.ingestionOutcomes.successful +
      res.ingestionOutcomes.failed +
      res.ingestionOutcomes.processing +
      res.ingestionOutcomes.pending;
    expect(sum).toBe(res.ingestionOutcomes.totalOperations);
  });

  it('should fetch AI token consumption with Portal UI vs External Integration attribution', async () => {
    const mockTokens = {
      summary: {
        totalTokens: 25000,
        promptTokens: 18000,
        completionTokens: 5000,
        embeddingTokens: 2000,
        totalChatQuestions: 80,
      },
      byOrigin: {
        portalUiTokens: 10000,
        externalIntegrationTokens: 15000,
        portalUiPercentage: 40,
        externalPercentage: 60,
      },
      byOperation: {
        chatTokens: 23000,
        embeddingTokens: 2000,
      },
      byModel: [
        { model: 'gpt-4o', provider: 'openai', totalTokens: 23000, count: 80 },
        { model: 'text-embedding-3-small', provider: 'openai', totalTokens: 2000, count: 10 },
      ],
      consumptionOverTime: [],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockTokens,
    });

    const res = await client.getPortalTokenConsumption('portal-alpha');

    expect(res.byOrigin.portalUiTokens + res.byOrigin.externalIntegrationTokens).toBe(res.summary.totalTokens);
    expect(res.byOrigin.portalUiPercentage + res.byOrigin.externalPercentage).toBe(100);
    expect(res.byOperation.chatTokens + res.byOperation.embeddingTokens).toBe(res.summary.totalTokens);
  });

  it('should fetch processing performance, chat usage, activity history, and failure analytics', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ total: 0 }),
    });

    await client.getPortalProcessingPerformance('portal-alpha');
    await client.getPortalChatUsage('portal-alpha');
    await client.getPortalSourceActivity('portal-alpha', { page: 1, limit: 10 });
    await client.getPortalFailureAnalytics('portal-alpha', { page: 1, limit: 10 });

    expect(global.fetch).toHaveBeenCalledTimes(4);
  });
});

