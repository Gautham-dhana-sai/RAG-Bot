import React from 'react';
import { FailureAnalyticsData } from '../../types';
import { SvgBarChart } from './charts/SvgBarChart';
import { ShimmerCard, ShimmerTable } from './AnalyticsShimmer';

interface FailureAnalyticsSectionProps {
  data: FailureAnalyticsData | null;
  isLoading: boolean;
  onPageChange: (newPage: number) => void;
}

export const FailureAnalyticsSection: React.FC<FailureAnalyticsSectionProps> = ({
  data,
  isLoading,
  onPageChange,
}) => {
  if (isLoading || !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, minHeight: 520 }}>
        <ShimmerCard height={200} />
        <ShimmerTable rows={6} />
      </div>
    );
  }

  if (!data) return null;

  const failures = data.records || data.failures || [];
  const rawCategories = data.summaryByCategory || data.categories || [];
  const totalPages = Math.max(1, Math.ceil(data.total / (data.limit || 20)));

  const categoryBars = rawCategories.map((c) => ({
    label: ((c as any).label || c.category || 'Issue').replace(/_/g, ' '),
    value: c.count,
    secondaryLabel: `${c.percentage}%`,
    color: '#ef4444',
  }));

  const formatTime = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 1. Failure Categories Chart */}
      <div
        style={{
          backgroundColor: 'var(--card-bg, #ffffff)',
          border: '1px solid var(--border, #e2e8f0)',
          borderRadius: 12,
          padding: '20px 24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text, #1e293b)', margin: 0 }}>
              Grouped Failure Categories
            </h3>
            <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0 0' }}>
              Root cause classification for troubleshooting source ingestion issues
            </p>
          </div>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: data.total === 0 ? '#10b981' : '#ef4444',
              backgroundColor: data.total === 0 ? '#ecfdf5' : '#fee2e2',
              padding: '4px 10px',
              borderRadius: 20,
            }}
          >
            {data.total} Total Issues
          </span>
        </div>

        <SvgBarChart
          data={categoryBars}
          unit="failures"
          emptyMessage="No failures recorded in this period — all sources ingested cleanly!"
        />
      </div>

      {/* 2. Detailed Failure Table */}
      <div
        style={{
          backgroundColor: 'var(--card-bg, #ffffff)',
          border: '1px solid var(--border, #e2e8f0)',
          borderRadius: 12,
          padding: '20px 24px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div>
            <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text, #1e293b)', margin: 0 }}>
              Recent Ingestion Failures
            </h3>
            <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0 0' }}>
              Specific source failures with stage and root cause explanation
            </p>
          </div>
        </div>

        {failures.length === 0 ? (
          <div style={{ padding: '36px 0', textAlign: 'center', color: '#10b981', fontSize: 13, fontWeight: 500 }}>
            🎉 No ingestion failures found in the selected date range.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border, #e2e8f0)', textAlign: 'left', color: '#64748b' }}>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Source Name</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Category</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Failed Stage</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600 }}>Failure Reason</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'center' }}>Retries</th>
                  <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {failures.map((f) => (
                  <tr key={f.id} style={{ borderBottom: '1px solid var(--border, #f1f5f9)' }}>
                    <td style={{ padding: '10px 12px', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 600, color: 'var(--text, #1e293b)' }}>
                        {f.sourceName || f.sourceId || 'Unknown'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#64748b' }}>
                      <span style={{ textTransform: 'capitalize' }}>
                        {f.sourceCategory?.toLowerCase() || 'file'}
                      </span>
                      {f.fileType && (
                        <code style={{ marginLeft: 6, fontSize: 11 }}>.{f.fileType}</code>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: 4,
                          backgroundColor: '#f1f5f9',
                          color: '#475569',
                        }}
                      >
                        {(f.failedStage || f.stage || 'Processing').replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', maxWidth: 300 }}>
                      <div style={{ fontWeight: 600, color: '#ef4444', fontSize: 12 }}>
                        {f.failureCategory ? f.failureCategory.replace(/_/g, ' ') : 'Processing Error'}
                      </div>
                      {f.errorMessage && (
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {f.errorMessage}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center', color: '#64748b' }}>
                      {f.retryCount}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#64748b', fontSize: 12 }}>
                      {formatTime(f.timestamp || f.createdAt || '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 16 }}>
            <button
              type="button"
              disabled={data.page <= 1}
              onClick={() => onPageChange(data.page - 1)}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                borderRadius: 6,
                border: '1px solid var(--border, #cbd5e1)',
                backgroundColor: 'var(--card-bg, #ffffff)',
                color: 'var(--text, #334155)',
                cursor: data.page <= 1 ? 'not-allowed' : 'pointer',
                opacity: data.page <= 1 ? 0.5 : 1,
              }}
            >
              Previous
            </button>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              Page {data.page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={data.page >= totalPages}
              onClick={() => onPageChange(data.page + 1)}
              style={{
                padding: '4px 10px',
                fontSize: 12,
                borderRadius: 6,
                border: '1px solid var(--border, #cbd5e1)',
                backgroundColor: 'var(--card-bg, #ffffff)',
                color: 'var(--text, #334155)',
                cursor: data.page >= totalPages ? 'not-allowed' : 'pointer',
                opacity: data.page >= totalPages ? 0.5 : 1,
              }}
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

