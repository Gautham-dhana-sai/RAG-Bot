import React from 'react';
import { SourceAnalyticsData } from '../../types';
import { SvgDonutChart, DonutSegment } from './charts/SvgDonutChart';
import { SvgBarChart } from './charts/SvgBarChart';
import { SvgLineChart, LineSeries } from './charts/SvgLineChart';
import { ShimmerCard } from './AnalyticsShimmer';

interface SourceAnalyticsSectionProps {
  data: SourceAnalyticsData | null;
  isLoading: boolean;
}

export const SourceAnalyticsSection: React.FC<SourceAnalyticsSectionProps> = ({
  data,
  isLoading,
}) => {
  if (isLoading || !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minHeight: 650 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
          <ShimmerCard height={280} />
          <ShimmerCard height={280} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
          <ShimmerCard height={220} />
          <ShimmerCard height={220} />
        </div>
        <ShimmerCard height={220} />
      </div>
    );
  }

  if (!data) return null;

  // Lifecycle activity counts (support both flat and nested activity object)
  const activity = data.activity || {
    totalSources: data.uniqueSources ?? 0,
    newUploads: data.newUploads ?? 0,
    successfulUploads: data.successfulUploads ?? 0,
    failedUploads: data.failedUploads ?? 0,
    processingSources: data.sourcesCurrentlyProcessing ?? 0,
    duplicateAttempts: data.duplicateAttempts ?? 0,
    confirmedReuploads: data.confirmedReuploads ?? 0,
    replacements: data.existingReplacements ?? 0,
    refetchOperations: data.websiteRefetches ?? 0,
    unchangedRefetches: data.unchangedWebsiteRefetches ?? 0,
    deletedSources: data.deletedSources ?? 0,
  };

  // Ingestion Outcomes Donut Data (Mutually exclusive: Successful, Failed, Processing, Pending)
  const outcomes = data.ingestionOutcomes || {
    successful: 0,
    failed: 0,
    processing: 0,
    pending: 0,
    totalOperations: 0,
  };
  const totalOperations = outcomes.totalOperations || (outcomes.successful + outcomes.failed + outcomes.processing + outcomes.pending);
  const successRate = outcomes.successRatePercent !== undefined
    ? outcomes.successRatePercent
    : (totalOperations > 0 ? Math.round((outcomes.successful / totalOperations) * 100) : 100);

  const outcomeSegments: DonutSegment[] = [
    { label: 'Successful', value: outcomes.successful, color: '#10b981' },
    { label: 'Failed', value: outcomes.failed, color: '#ef4444' },
    { label: 'Processing', value: outcomes.processing, color: '#f59e0b' },
    { label: 'Pending', value: outcomes.pending, color: '#6366f1' },
  ];

  // Category Distribution Donut Data
  const categories = data.categoryDistribution || { files: 0, links: 0, websites: 0, total: 0 };
  const categorySegments: DonutSegment[] = [
    { label: 'Direct Files', value: categories.files, color: '#3b82f6' },
    { label: 'File Links', value: categories.links, color: '#8b5cf6' },
    { label: 'Websites / Crawls', value: categories.websites, color: '#06b6d4' },
  ];

  // File Types Bar Data
  const fileTypeBars = (data.fileTypeDistribution || []).map((ft) => ({
    label: ft.fileType.toUpperCase(),
    value: ft.count,
    secondaryLabel: `${ft.percentage}%`,
    color: '#3b82f6',
  }));

  // Volume Over Time Line Chart
  const dates = (data.volumeOverTime || []).map((v) => v.date);
  const volumeSeries: LineSeries[] = [
    {
      id: 'files',
      label: 'Files',
      color: '#3b82f6',
      data: (data.volumeOverTime || []).map((v) => v.files),
    },
    {
      id: 'links',
      label: 'Links',
      color: '#8b5cf6',
      data: (data.volumeOverTime || []).map((v) => v.links),
    },
    {
      id: 'websites',
      label: 'Websites',
      color: '#06b6d4',
      data: (data.volumeOverTime || []).map((v) => v.websites),
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 1. Ingestion Outcomes & Categories Donut Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
        {/* Donut Chart: Ingestion Outcomes */}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text, #1e293b)', margin: 0 }}>
                Ingestion Outcomes
              </h3>
              <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0 0' }}>
                Authoritative outcome for all {totalOperations} processing operations in period
              </p>
            </div>
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: successRate >= 90 ? '#10b981' : '#f59e0b',
                backgroundColor: successRate >= 90 ? '#ecfdf5' : '#fef3c7',
                padding: '4px 10px',
                borderRadius: 20,
              }}
            >
              {successRate}% Success
            </span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, padding: '12px 0' }}>
            <SvgDonutChart
              data={outcomeSegments}
              size={180}
              thickness={28}
              centerLabel="Operations"
              centerValue={totalOperations}
              emptyMessage="No ingestion operations"
            />
          </div>
        </div>

        {/* Donut Chart: Source Category Distribution */}
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
              Source Category Distribution
            </h3>
            <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0 0' }}>
              Breakdown across uploaded documents, direct file URLs, and crawled sites
            </p>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1, padding: '12px 0' }}>
            <SvgDonutChart
              data={categorySegments}
              size={180}
              thickness={28}
              centerLabel="Sources"
              centerValue={categories.total}
              emptyMessage="No sources configured"
            />
          </div>
        </div>
      </div>

      {/* 2. File Type Distribution & Operational Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
        {/* File Type Breakdown */}
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
            File Format Breakdown
          </h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px 0' }}>
            Detected MIME types and file extensions
          </p>

          <SvgBarChart
            data={fileTypeBars}
            unit="files"
            emptyMessage="No files uploaded"
          />
        </div>

        {/* Source Lifecycle & Operations Grid */}
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
            Source Lifecycle Activity
          </h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 16px 0' }}>
            Aggregated lifecycle and maintenance actions
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {[
              { label: 'New Uploads', value: activity.newUploads, icon: '📤' },
              { label: 'Duplicate Attempts', value: activity.duplicateAttempts, icon: '⚠️' },
              { label: 'Confirmed Replaces', value: activity.confirmedReuploads, icon: '🔄' },
              { label: 'Website Refetches', value: activity.refetchOperations, icon: '🌐' },
              { label: 'Unchanged Refetches', value: activity.unchangedRefetches, icon: '💤' },
              { label: 'Deleted Sources', value: activity.deletedSources, icon: '🗑️' },
            ].map((stat) => (
              <div
                key={stat.label}
                style={{
                  backgroundColor: 'var(--filter-bg, #f8fafc)',
                  borderRadius: 8,
                  padding: '10px 14px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  border: '1px solid var(--border, #e2e8f0)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 16 }}>{stat.icon}</span>
                  <span style={{ fontSize: 12, color: 'var(--text, #475569)', fontWeight: 500 }}>
                    {stat.label}
                  </span>
                </div>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text, #0f172a)' }}>
                  {stat.value.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. Ingestion Volume Over Time */}
      <div
        style={{
          backgroundColor: 'var(--card-bg, #ffffff)',
          border: '1px solid var(--border, #e2e8f0)',
          borderRadius: 12,
          padding: '20px 24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text, #1e293b)', margin: 0 }}>
              Ingestion Volume Over Time
            </h3>
            <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0 0' }}>
              Daily ingested sources categorized by channel
            </p>
          </div>
        </div>

        <SvgLineChart
          dates={dates}
          series={volumeSeries}
          height={190}
          unit="sources"
          emptyMessage="No ingestion volume recorded in this time range"
        />
      </div>
    </div>
  );
};
