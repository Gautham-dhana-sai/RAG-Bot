import React from 'react';
import { AnalyticsFilterParams } from '../../types';

interface AnalyticsFiltersProps {
  filters: AnalyticsFilterParams;
  onChange: (filters: AnalyticsFilterParams) => void;
  isLoading: boolean;
  onRefresh: () => void;
}

export const AnalyticsFilters: React.FC<AnalyticsFiltersProps> = ({
  filters,
  onChange,
  isLoading,
  onRefresh,
}) => {
  const currentPeriod = filters.period || '30d';
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const handlePeriodChange = (period: 'today' | '7d' | '30d' | '90d' | 'custom') => {
    if (period === 'custom') {
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      onChange({
        ...filters,
        period: 'custom',
        startDate: thirtyDaysAgo.toISOString().split('T')[0],
        endDate: now.toISOString().split('T')[0],
      });
    } else {
      onChange({
        period,
        startDate: undefined,
        endDate: undefined,
      });
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        padding: '16px 20px',
        backgroundColor: 'var(--card-bg, #ffffff)',
        border: '1px solid var(--border, #e2e8f0)',
        borderRadius: 12,
        marginBottom: 24,
      }}
    >
      {/* Preset range pills */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#64748b', marginRight: 4 }}>
          Range:
        </span>
        {[
          { id: 'today', label: 'Today' },
          { id: '7d', label: 'Last 7 Days' },
          { id: '30d', label: 'Last 30 Days' },
          { id: '90d', label: 'Last 90 Days' },
          { id: 'custom', label: 'Custom' },
        ].map((item) => {
          const isActive = currentPeriod === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handlePeriodChange(item.id as any)}
              style={{
                padding: '6px 14px',
                borderRadius: 20,
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                border: 'none',
                backgroundColor: isActive ? 'var(--primary, #3b82f6)' : 'var(--filter-bg, #f1f5f9)',
                color: isActive ? '#ffffff' : 'var(--text, #475569)',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {/* Custom Date Pickers if 'custom' is active */}
      {currentPeriod === 'custom' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: '#64748b' }}>From:</label>
          <input
            type="date"
            value={filters.startDate || ''}
            onChange={(e) => onChange({ ...filters, startDate: e.target.value })}
            style={{
              padding: '4px 8px',
              fontSize: 13,
              borderRadius: 6,
              border: '1px solid var(--border, #cbd5e1)',
              backgroundColor: 'var(--card-bg, #ffffff)',
              color: 'var(--text, #1e293b)',
            }}
          />
          <label style={{ fontSize: 12, color: '#64748b' }}>To:</label>
          <input
            type="date"
            value={filters.endDate || ''}
            onChange={(e) => onChange({ ...filters, endDate: e.target.value })}
            style={{
              padding: '4px 8px',
              fontSize: 13,
              borderRadius: 6,
              border: '1px solid var(--border, #cbd5e1)',
              backgroundColor: 'var(--card-bg, #ffffff)',
              color: 'var(--text, #1e293b)',
            }}
          />
        </div>
      )}

      {/* Timezone pill & Refresh Button */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span
          title={`All metrics aggregated relative to ${timezone}`}
          style={{
            fontSize: 11,
            color: '#64748b',
            backgroundColor: 'var(--filter-bg, #f8fafc)',
            border: '1px solid var(--border, #e2e8f0)',
            padding: '4px 10px',
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: '#10b981' }} />
          {timezone}
        </span>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          style={{
            padding: '6px 14px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 500,
            border: '1px solid var(--border, #cbd5e1)',
            backgroundColor: 'var(--card-bg, #ffffff)',
            color: 'var(--text, #334155)',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.6 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <span style={{ display: 'inline-block', transform: isLoading ? 'rotate(180deg)' : 'none', transition: 'transform 0.5s' }}>
            🔄
          </span>
          {isLoading ? 'Updating...' : 'Refresh'}
        </button>
      </div>
    </div>
  );
};

