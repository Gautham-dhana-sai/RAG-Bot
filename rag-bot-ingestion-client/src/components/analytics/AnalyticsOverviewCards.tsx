import React from 'react';
import { PortalAnalyticsOverview } from '../../types';

interface AnalyticsOverviewCardsProps {
  overview: PortalAnalyticsOverview | null;
  isLoading: boolean;
}

export const AnalyticsOverviewCards: React.FC<AnalyticsOverviewCardsProps> = ({
  overview,
  isLoading,
}) => {
  if (isLoading || !overview) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            style={{
              height: 90,
              backgroundColor: 'var(--card-bg, #ffffff)',
              borderRadius: 10,
              border: '1px solid var(--border, #e2e8f0)',
              opacity: 0.5,
              animation: 'pulse 1.5s infinite',
            }}
          />
        ))}
      </div>
    );
  }

  const summary = {
    totalSources: overview?.totalSources ?? overview?.summary?.totalSources ?? 0,
    readySources: overview?.successfulSources ?? overview?.summary?.readySources ?? overview?.summary?.successfulSources ?? 0,
    failedSources: overview?.failedSources ?? overview?.summary?.failedSources ?? 0,
    processingSources: overview?.processingSources ?? overview?.summary?.processingSources ?? 0,
    totalChatQuestions: overview?.totalChatQuestions ?? overview?.summary?.totalChatQuestions ?? 0,
    totalTokens: overview?.totalTokensConsumed ?? overview?.summary?.totalTokens ?? 0,
    externalIntegrationTokens: overview?.externalIntegrationTokens ?? overview?.summary?.externalIntegrationTokens ?? 0,
    avgProcessingTimeMs: overview?.averageProcessingTimeMs ?? overview?.summary?.avgProcessingTimeMs ?? 0,
  };

  const successRate = summary.totalSources > 0
    ? Math.round((summary.readySources / summary.totalSources) * 100)
    : 100;

  const formatDuration = (ms: number) => {
    if (ms <= 0) return '0s';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const cards = [
    {
      title: 'Total Sources',
      value: summary.totalSources.toLocaleString(),
      subtext: `${summary.readySources} active & indexed`,
      icon: '📚',
      highlightColor: '#3b82f6',
    },
    {
      title: 'Ingestion Success Rate',
      value: `${successRate}%`,
      subtext: `${summary.failedSources} failures recorded`,
      icon: successRate >= 90 ? '✅' : '⚠️',
      highlightColor: successRate >= 90 ? '#10b981' : '#f59e0b',
    },
    {
      title: 'In Processing',
      value: summary.processingSources.toLocaleString(),
      subtext: 'Crawling, chunking or embedding',
      icon: '⏳',
      highlightColor: '#6366f1',
    },
    {
      title: 'Avg Processing Time',
      value: formatDuration(summary.avgProcessingTimeMs),
      subtext: 'End-to-end ingestion time',
      icon: '⚡',
      highlightColor: '#8b5cf6',
    },
    {
      title: 'Chatbot Inquiries',
      value: summary.totalChatQuestions.toLocaleString(),
      subtext: 'Questions answered across channels',
      icon: '💬',
      highlightColor: '#06b6d4',
    },
    {
      title: 'Total AI Tokens',
      value: summary.totalTokens.toLocaleString(),
      subtext: 'Chat and ingestion embeddings',
      icon: '🤖',
      highlightColor: '#ec4899',
    },
    {
      title: 'External Integration Tokens',
      value: summary.externalIntegrationTokens.toLocaleString(),
      subtext: summary.totalTokens > 0
        ? `${Math.round((summary.externalIntegrationTokens / summary.totalTokens) * 100)}% of total portal consumption`
        : 'Outside portal UI',
      icon: '🌐',
      highlightColor: '#f97316',
    },
    {
      title: 'Failed Sources',
      value: summary.failedSources.toLocaleString(),
      subtext: summary.failedSources === 0 ? 'Zero failures' : 'Action required',
      icon: summary.failedSources === 0 ? '🛡️' : '❌',
      highlightColor: summary.failedSources === 0 ? '#10b981' : '#ef4444',
    },
  ];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 16,
        marginBottom: 28,
      }}
    >
      {cards.map((c) => (
        <div
          key={c.title}
          style={{
            backgroundColor: 'var(--card-bg, #ffffff)',
            border: '1px solid var(--border, #e2e8f0)',
            borderRadius: 12,
            padding: '16px 18px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: 4,
              height: '100%',
              backgroundColor: c.highlightColor,
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {c.title}
            </span>
            <span style={{ fontSize: 18 }}>{c.icon}</span>
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text, #0f172a)', lineHeight: 1.2 }}>
              {c.value}
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
              {c.subtext}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
