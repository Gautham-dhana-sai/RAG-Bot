import React from 'react';

export interface BarItem {
  label: string;
  value: number;
  secondaryLabel?: string;
  color?: string;
}

interface SvgBarChartProps {
  data: BarItem[];
  maxValue?: number;
  height?: number;
  barColor?: string;
  unit?: string;
  emptyMessage?: string;
}

export const SvgBarChart: React.FC<SvgBarChartProps> = ({
  data,
  maxValue,
  barColor = 'var(--primary, #3b82f6)',
  unit = '',
  emptyMessage = 'No data recorded',
}) => {
  if (!data || data.length === 0 || data.every(d => d.value === 0)) {
    return (
      <div style={{ padding: '24px 0', textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
        {emptyMessage}
      </div>
    );
  }

  const computedMax = maxValue !== undefined ? maxValue : Math.max(...data.map(d => d.value), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
      {data.map((item) => {
        const percentage = Math.min(100, Math.round((item.value / computedMax) * 100));
        const color = item.color || barColor;

        return (
          <div key={item.label} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
              <span style={{ fontWeight: 500, color: 'var(--text, #334155)' }}>
                {item.label}
              </span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {item.secondaryLabel && (
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    {item.secondaryLabel}
                  </span>
                )}
                <span style={{ fontWeight: 600, color: 'var(--text, #0f172a)' }}>
                  {item.value.toLocaleString()}{unit ? ` ${unit}` : ''}
                </span>
              </div>
            </div>
            {/* Bar Track */}
            <div
              style={{
                width: '100%',
                height: 8,
                backgroundColor: 'var(--border, #e2e8f0)',
                borderRadius: 4,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${percentage}%`,
                  height: '100%',
                  backgroundColor: color,
                  borderRadius: 4,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

