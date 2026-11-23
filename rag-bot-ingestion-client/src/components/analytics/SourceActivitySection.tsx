import React from 'react';
import { SourceActivityData } from '../../types';
import { ShimmerTable } from './AnalyticsShimmer';

interface SourceActivitySectionProps {
  data: SourceActivityData | null;
  isLoading: boolean;
  onPageChange: (newPage: number) => void;
}

export const SourceActivitySection: React.FC<SourceActivitySectionProps> = ({
  data,
  isLoading,
  onPageChange,
}) => {
  if (isLoading || !data) {
    return (
      <div style={{ minHeight: 460 }}>
        <ShimmerTable rows={8} />
      </div>
    );
  }

  if (!data) return null;

  const events = data.records || data.events || [];
  const totalPages = Math.max(1, Math.ceil(data.total / (data.limit || 20)));

  const formatAction = (eventType: string) => {
    switch (eventType) {
      case 'SOURCE_SUBMISSION': return { label: 'Upload Submitted', color: '#3b82f6', icon: '📤' };
      case 'UPLOAD_COMPLETION': return { label: 'Upload Completed', color: '#10b981', icon: '✅' };
      case 'DUPLICATE_DETECTION': return { label: 'Duplicate Detected', color: '#f59e0b', icon: '⚠️' };
      case 'CONFIRMED_REPLACEMENT': return { label: 'Replaced Version', color: '#8b5cf6', icon: '🔄' };
      case 'WEBSITE_REFETCH': return { label: 'Website Refetch', color: '#06b6d4', icon: '🌐' };
      case 'UNCHANGED_WEBSITE_REFETCH': return { label: 'Unchanged Refetch', color: '#64748b', icon: '💤' };
      case 'SOURCE_DELETION': return { label: 'Source Deleted', color: '#ef4444', icon: '🗑️' };
      case 'INGESTION_COMPLETION': return { label: 'Ingestion Completed', color: '#10b981', icon: '✨' };
      case 'INGESTION_FAILURE': return { label: 'Ingestion Failed', color: '#ef4444', icon: '❌' };
      default: return { label: eventType.replace(/_/g, ' '), color: '#64748b', icon: '📝' };
    }
  };

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
            Source Activity History & Audit Trail
          </h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 0 0' }}>
            Comprehensive log of source submissions, version replacements, refetches, and deletions
          </p>
        </div>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {data.total} total events
        </span>
      </div>

      {events.length === 0 ? (
        <div style={{ padding: '36px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
          No source activity recorded in this period
        </div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border, #e2e8f0)', textAlign: 'left', color: '#64748b' }}>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Action</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Source Name / Route</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Category</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Status</th>
                <th style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' }}>Time</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => {
                const act = formatAction(ev.activityType || ev.eventType || 'UNKNOWN');
                const statusStr = ev.outcome || ev.status || 'PROCESSED';
                const timeStr = ev.timestamp || ev.createdAt || '';
                return (
                  <tr key={ev.id} style={{ borderBottom: '1px solid var(--border, #f1f5f9)' }}>
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '3px 8px',
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          backgroundColor: `${act.color}15`,
                          color: act.color,
                        }}
                      >
                        <span>{act.icon}</span>
                        {act.label}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 500, color: 'var(--text, #1e293b)' }}>
                        {ev.sourceName || ev.sourceId || 'Unknown source'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', color: '#64748b' }}>
                      <span style={{ textTransform: 'capitalize' }}>
                        {ev.sourceCategory?.toLowerCase() || 'file'}
                      </span>
                      {ev.fileType && (
                        <code style={{ marginLeft: 6, fontSize: 11 }}>.{ev.fileType}</code>
                      )}
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: statusStr === 'READY' || statusStr === 'SUCCESS' ? '#10b981' : statusStr === 'FAILED' ? '#ef4444' : '#f59e0b',
                        }}
                      >
                        {statusStr}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'right', color: '#64748b', fontSize: 12 }}>
                      {formatTime(timeStr)}
                    </td>
                  </tr>
                );
              })}
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
  );
};
