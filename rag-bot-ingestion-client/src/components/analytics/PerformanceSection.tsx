import React from 'react';
import { ProcessingPerformanceData } from '../../types';
import { SvgBarChart, BarItem } from './charts/SvgBarChart';
import { ShimmerMetricGrid, ShimmerCard } from './AnalyticsShimmer';

interface PerformanceSectionProps {
  data: ProcessingPerformanceData | null;
  isLoading: boolean;
}

export const PerformanceSection: React.FC<PerformanceSectionProps> = ({
  data,
  isLoading,
}) => {
  if (isLoading || !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minHeight: 520 }}>
        <ShimmerMetricGrid count={5} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
          <ShimmerCard height={320} />
          <ShimmerCard height={320} />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const formatDuration = (ms: number) => {
    if (ms <= 0) return '0s';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const overall = data.overall || {
    avgProcessingTimeMs: 0,
    medianProcessingTimeMs: 0,
    fastestProcessingTimeMs: 0,
    slowestProcessingTimeMs: 0,
    sourcesProcessed: 0,
  };
  const stages = data.stageDurations || {
    downloadMs: 0,
    extractionMs: 0,
    chunkingMs: 0,
    embeddingMs: 0,
    databaseStorageMs: 0,
  };
  const categories = data.byCategory || ({} as any);

  const fileAvg = categories.files?.avgProcessingTimeMs ?? (categories.files as any)?.avgTimeMs ?? 0;
  const linkAvg = categories.links?.avgTotalProcessingTimeMs ?? (categories.links as any)?.avgTimeMs ?? 0;
  const webAvg = categories.websites?.avgTotalIngestionMs ?? (categories.websites as any)?.avgTimeMs ?? 0;

  const fileCount = categories.files?.processedCount ?? 0;
  const linkCount = categories.links?.totalProcessed ?? (categories.links as any)?.processedCount ?? 0;
  const routeCount = categories.websites?.avgRoutesProcessed ?? 0;
  const webCount = categories.websites?.processedCount ?? (categories.websites as any)?.totalWebsites ?? (routeCount > 0 ? 1 : 0);

  // Stages bar items
  const stageBars: BarItem[] = [
    { label: 'Download / Network Retrieval', value: stages.downloadMs, secondaryLabel: formatDuration(stages.downloadMs), color: '#3b82f6' },
    { label: 'Content Extraction & Parsing', value: stages.extractionMs, secondaryLabel: formatDuration(stages.extractionMs), color: '#8b5cf6' },
    { label: 'Text Chunking & Segmentation', value: stages.chunkingMs, secondaryLabel: formatDuration(stages.chunkingMs), color: '#06b6d4' },
    { label: 'Vector Embedding Generation', value: stages.embeddingMs, secondaryLabel: formatDuration(stages.embeddingMs), color: '#ec4899' },
    { label: 'Database Storage & Indexing', value: stages.databaseStorageMs, secondaryLabel: formatDuration(stages.databaseStorageMs), color: '#10b981' },
  ];

  // Category comparison bar items
  const categoryBars: BarItem[] = [
    {
      label: 'Direct Files',
      value: fileAvg,
      secondaryLabel: `${fileCount} processed (${formatDuration(fileAvg)})`,
      color: '#3b82f6',
    },
    {
      label: 'File Links',
      value: linkAvg,
      secondaryLabel: `${linkCount} processed (${formatDuration(linkAvg)})`,
      color: '#8b5cf6',
    },
    {
      label: 'Websites / Crawls',
      value: webAvg,
      secondaryLabel: routeCount > 1
        ? `${webCount} website (${routeCount} routes) · ${formatDuration(webAvg)}`
        : `${webCount} processed (${formatDuration(webAvg)})`,
      color: '#06b6d4',
    },
  ];

  // File type performance
  const fileTypeBars: BarItem[] = (data.byFileType || []).map((ft) => {
    const avg = ft.avgDurationMs ?? (ft as any).avgTimeMs ?? 0;
    const count = ft.processedCount ?? (ft as any).count ?? 0;
    return {
      label: ft.fileType.toUpperCase(),
      value: avg,
      secondaryLabel: `${count} ${count === 1 ? 'source' : 'sources'} (${formatDuration(avg)})`,
      color: '#3b82f6',
    };
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 1. Overall Processing Metrics */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 16,
        }}
      >
        {[
          { label: 'Avg Processing Time', value: formatDuration(overall.avgProcessingTimeMs), sub: 'Across all successful sources', icon: '⏱️' },
          { label: 'Median Processing Time', value: formatDuration(overall.medianProcessingTimeMs), sub: '50th percentile (typical)', icon: '📊' },
          { label: 'Fastest Ingestion', value: formatDuration(overall.fastestProcessingTimeMs), sub: 'Best completed speed', icon: '⚡' },
          { label: 'Slowest Ingestion', value: formatDuration(overall.slowestProcessingTimeMs), sub: 'Worst completed speed', icon: '🐢' },
          { label: 'Sources Processed', value: overall.sourcesProcessed.toLocaleString(), sub: 'In selected date range', icon: '📁' },
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

      {/* 2. Processing Stages Breakdown & Source Category Speeds */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
        {/* Stages Breakdown */}
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
            Ingestion Pipeline Stage Durations
          </h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px 0' }}>
            Average time spent in each processing stage of the document lifecycle
          </p>

          <SvgBarChart
            data={stageBars}
            unit="ms"
            emptyMessage="No stage performance data recorded"
          />
        </div>

        {/* Category Comparison */}
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
            Speed by Source Category
          </h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px 0' }}>
            Average end-to-end processing duration across source types
          </p>

          <SvgBarChart
            data={categoryBars}
            unit="ms"
            emptyMessage="No category speed data available"
          />

          {fileTypeBars.length > 0 && (
            <div style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border, #e2e8f0)' }}>
              <h4 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text, #1e293b)', margin: '0 0 12px 0' }}>
                Speed by File Format
              </h4>
              <SvgBarChart
                data={fileTypeBars}
                unit="ms"
                emptyMessage="No file type performance data"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

