import React from 'react';
import { ChatUsageData } from '../../types';
import { SvgLineChart, LineSeries } from './charts/SvgLineChart';
import { ShimmerMetricGrid, ShimmerCard } from './AnalyticsShimmer';

interface ChatUsageSectionProps {
  data: ChatUsageData | null;
  isLoading: boolean;
}

export const ChatUsageSection: React.FC<ChatUsageSectionProps> = ({
  data,
  isLoading,
}) => {
  if (isLoading || !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minHeight: 460 }}>
        <ShimmerMetricGrid count={6} />
        <ShimmerCard height={260} />
      </div>
    );
  }

  if (!data) return null;

  const summary = data.summary || {
    totalQuestions: 0,
    portalUiQuestions: 0,
    externalIntegrationQuestions: 0,
    totalConversations: 0,
    totalSessions: 0,
    abstentionCount: 0,
  };
  const perf = data.responsePerformance || data.performance || {
    avgResponseTimeMs: 0,
    medianResponseTimeMs: 0,
    p95ResponseTimeMs: 0,
  };

  const formatDuration = (ms: number) => {
    if (ms <= 0) return '0s';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const rawUsage = data.usageOverTime || data.questionsOverTime || [];
  const dates = rawUsage.map((q: any) => q.date);
  const chatSeries: LineSeries[] = [
    {
      id: 'portalUi',
      label: 'Portal UI Questions',
      color: '#3b82f6',
      data: rawUsage.map((q: any) => q.portalUi ?? q.portalUiQuestions ?? 0),
    },
    {
      id: 'external',
      label: 'External Integration Questions',
      color: '#f97316',
      data: rawUsage.map((q: any) => q.external ?? q.externalIntegrationQuestions ?? 0),
    },
  ];

  const sessions = summary.uniqueSessions ?? summary.totalSessions ?? 0;
  const abstained = summary.abstainedCount ?? summary.abstentionCount ?? 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 1. Metric Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
        }}
      >
        {[
          { label: 'Total Questions', value: (summary.totalQuestions || 0).toLocaleString(), sub: `${summary.portalUiQuestions || 0} portal UI / ${summary.externalIntegrationQuestions || 0} external`, icon: '💬', color: '#3b82f6' },
          { label: 'Conversations & Sessions', value: (summary.totalConversations || 0).toLocaleString(), sub: `${sessions} unique browser sessions`, icon: '👥', color: '#8b5cf6' },
          { label: 'Avg Response Time', value: formatDuration(perf.avgResponseTimeMs), sub: 'End-to-end RAG completion', icon: '⚡', color: '#10b981' },
          { label: 'Median (P50) Time', value: formatDuration(perf.medianResponseTimeMs), sub: 'Typical user experience', icon: '⏱️', color: '#06b6d4' },
          { label: 'P95 Response Time', value: formatDuration(perf.p95ResponseTimeMs), sub: '95% answered faster than this', icon: '🎯', color: '#f59e0b' },
          { label: 'Out of Scope Abstentions', value: abstained.toLocaleString(), sub: (summary.totalQuestions || 0) > 0 ? `${Math.round((abstained / summary.totalQuestions) * 100)}% abstention rate` : 'None', icon: '🛡️', color: '#ef4444' },
        ].map((item) => (
          <div
            key={item.label}
            style={{
              backgroundColor: 'var(--card-bg, #ffffff)',
              border: '1px solid var(--border, #e2e8f0)',
              borderRadius: 12,
              padding: '16px 18px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' }}>
                {item.label}
              </span>
              <span style={{ fontSize: 16 }}>{item.icon}</span>
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text, #0f172a)' }}>
              {item.value}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
              {item.sub}
            </div>
          </div>
        ))}
      </div>

      {/* 2. Questions Over Time Line Chart */}
      <div
        style={{
          backgroundColor: 'var(--card-bg, #ffffff)',
          border: '1px solid var(--border, #e2e8f0)',
          borderRadius: 12,
          padding: '20px 24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text, #1e293b)', margin: 0, marginBottom: 4 }}>
          Chat Inquiries Over Time
        </h3>
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px 0' }}>
          Daily volume comparing questions asked through the portal interface vs external website widgets
        </p>

        <SvgLineChart
          dates={dates}
          series={chatSeries}
          height={200}
          unit="questions"
          emptyMessage="No questions recorded in this time range"
        />
      </div>
    </div>
  );
};

