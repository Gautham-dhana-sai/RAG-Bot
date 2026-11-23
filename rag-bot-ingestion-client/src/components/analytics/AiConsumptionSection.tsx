import React from 'react';
import { AITokenConsumptionData } from '../../types';
import { SvgDonutChart, DonutSegment } from './charts/SvgDonutChart';
import { SvgLineChart, LineSeries } from './charts/SvgLineChart';
import { ShimmerMetricGrid, ShimmerCard } from './AnalyticsShimmer';

interface AiConsumptionSectionProps {
  data: AITokenConsumptionData | null;
  isLoading: boolean;
}

export const AiConsumptionSection: React.FC<AiConsumptionSectionProps> = ({
  data,
  isLoading,
}) => {
  if (isLoading || !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minHeight: 650 }}>
        <ShimmerMetricGrid count={5} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
          <ShimmerCard height={280} />
          <ShimmerCard height={280} />
        </div>
        <ShimmerCard height={240} />
        <ShimmerCard height={240} />
      </div>
    );
  }

  if (!data) return null;

  const summary = data.summary || {
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    embeddingTokens: 0,
    totalChatQuestions: 0,
  };
  const byOrigin = data.byOrigin || {
    portalUiTokens: 0,
    externalIntegrationTokens: 0,
    portalUiPercentage: 0,
    externalPercentage: 0,
  };
  const byOperation = data.byOperation || {
    chatTokens: 0,
    embeddingTokens: 0,
  };

  const inputTokens = summary.inputTokens ?? summary.promptTokens ?? 0;
  const outputTokens = summary.outputTokens ?? summary.completionTokens ?? 0;

  // Donut chart: Origin Breakdown (Portal UI vs External Integration)
  const originSegments: DonutSegment[] = [
    { label: 'Portal UI Chat', value: byOrigin.portalUiTokens, color: '#3b82f6' },
    { label: 'External Integration', value: byOrigin.externalIntegrationTokens, color: '#f97316' },
  ];

  // Donut chart: Operation Breakdown (Chat vs Ingestion Embedding)
  const operationSegments: DonutSegment[] = [
    { label: 'Chat Generation', value: byOperation.chatTokens, color: '#8b5cf6' },
    { label: 'Ingestion Embeddings', value: byOperation.embeddingTokens, color: '#10b981' },
  ];

  // Multi-series line chart for token consumption over time
  const timeData: any[] = (data as any).consumptionOverTime || (data as any).tokensOverTime || [];
  const dates = timeData.map((c) => c.date);
  const consumptionSeries: LineSeries[] = [
    {
      id: 'portalUi',
      label: 'Portal UI Tokens',
      color: '#3b82f6',
      data: timeData.map((c) => Number(c.portalUiTokens || 0)),
    },
    {
      id: 'external',
      label: 'External Integration Tokens',
      color: '#f97316',
      data: timeData.map((c) => Number(c.externalIntegrationTokens ?? c.externalTokens ?? 0)),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 1. High-level Token Metric Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
        }}
      >
        {[
          { label: 'Total Attributed Tokens', value: (summary.totalTokens || 0).toLocaleString(), sub: 'Exact provider billed tokens', color: '#ec4899', icon: '🤖' },
          { label: 'Prompt / Input Tokens', value: inputTokens.toLocaleString(), sub: 'Knowledge context & user queries', color: '#3b82f6', icon: '📥' },
          { label: 'Completion / Output Tokens', value: outputTokens.toLocaleString(), sub: 'Generated AI assistant answers', color: '#10b981', icon: '📤' },
          { label: 'Embedding Tokens', value: (summary.embeddingTokens || 0).toLocaleString(), sub: 'Source document vector indexing', color: '#8b5cf6', icon: '🧠' },
          { label: 'External Inquiries', value: (byOrigin.externalPercentage || 0) + '%', sub: `${(byOrigin.externalIntegrationTokens || 0).toLocaleString()} tokens via API/widget`, color: '#f97316', icon: '🌐' },
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

      {/* 2. Donut Charts: Channel Origin vs Operation Type */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        {/* Origin Breakdown */}
        <div
          style={{
            backgroundColor: 'var(--card-bg, #ffffff)',
            border: '1px solid var(--border, #e2e8f0)',
            borderRadius: 12,
            padding: '20px 24px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text, #1e293b)', margin: 0 }}>
              Channel Attribution Breakdown
            </h3>
            <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0 0' }}>
              Portal UI dashboard inquiries vs external integrated site/app requests
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, padding: '12px 0' }}>
            <SvgDonutChart
              data={originSegments}
              size={180}
              thickness={28}
              centerLabel="Total Tokens"
              centerValue={summary.totalTokens}
              emptyMessage="No tokens logged"
            />
          </div>
        </div>

        {/* Operation Breakdown */}
        <div
          style={{
            backgroundColor: 'var(--card-bg, #ffffff)',
            border: '1px solid var(--border, #e2e8f0)',
            borderRadius: 12,
            padding: '20px 24px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text, #1e293b)', margin: 0 }}>
              Workload Operation Breakdown
            </h3>
            <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0 0' }}>
              Chat generation responses vs vector knowledge embeddings
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, padding: '12px 0' }}>
            <SvgDonutChart
              data={operationSegments}
              size={180}
              thickness={28}
              centerLabel="Total Tokens"
              centerValue={summary.totalTokens}
              emptyMessage="No tokens logged"
            />
          </div>
        </div>
      </div>

      {/* 3. AI Models and Providers Table */}
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
          AI Provider & Model Utilization
        </h3>
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px 0' }}>
          Exact token consumption broken down by foundational model and inference provider
        </p>

        {(!data.byModel || data.byModel.length === 0) ? (
          <div style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            No model consumption records in this period
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border, #e2e8f0)', textAlign: 'left', color: '#64748b' }}>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Model</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Provider</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Invocations</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Total Tokens</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Share</th>
                </tr>
              </thead>
              <tbody>
                {data.byModel.map((m: any, idx: number) => {
                  const modelName = m.model || m.modelName || 'Unknown Model';
                  const count = m.count ?? m.requestCount ?? 0;
                  const totalTokens = m.totalTokens ?? 0;
                  const share = summary.totalTokens > 0
                    ? Math.round((totalTokens / summary.totalTokens) * 100)
                    : 0;
                  return (
                    <tr key={`${m.provider || 'ai'}-${modelName}-${idx}`} style={{ borderBottom: '1px solid var(--border, #f1f5f9)' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text, #1e293b)' }}>
                        <code>{modelName}</code>
                      </td>
                      <td style={{ padding: '10px 12px', color: '#64748b', textTransform: 'capitalize' }}>
                        {m.provider || 'AI'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--text, #334155)' }}>
                        {count.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: 'var(--text, #0f172a)' }}>
                        {totalTokens.toLocaleString()}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#64748b' }}>
                        {share}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. Token Consumption Over Time Line Chart */}
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
          Token Consumption Over Time
        </h3>
        <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px 0' }}>
          Daily token attribution across Portal UI vs External Integration channels
        </p>

        <SvgLineChart
          dates={dates}
          series={consumptionSeries}
          height={200}
          unit="tokens"
          emptyMessage="No token usage recorded in this time range"
        />
      </div>
    </div>
  );
};
