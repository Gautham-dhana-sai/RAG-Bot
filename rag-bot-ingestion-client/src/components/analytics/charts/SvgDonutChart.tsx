import React, { useState } from 'react';

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
  secondaryText?: string;
}

interface SvgDonutChartProps {
  data: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string | number;
  emptyMessage?: string;
}

export const SvgDonutChart: React.FC<SvgDonutChartProps> = ({
  data,
  size = 200,
  thickness = 32,
  centerLabel = 'Total',
  centerValue,
  emptyMessage = 'No data recorded',
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const total = data.reduce((acc, seg) => acc + (seg.value > 0 ? seg.value : 0), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let cumulativeOffset = 0;

  const displayTotal = centerValue !== undefined ? centerValue : total;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        flexWrap: 'wrap',
        width: '100%',
        boxSizing: 'border-box',
      }}
    >
      {/* Donut Graphic Container with strictly defined dimensions to prevent overflow */}
      <div
        style={{
          position: 'relative',
          width: size,
          height: size,
          minWidth: size,
          minHeight: size,
          flexShrink: 0,
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ transform: 'rotate(-90deg)', display: 'block' }}
        >
          {/* Base track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--border, #e2e8f0)"
            strokeWidth={thickness}
            opacity={total === 0 ? 0.35 : 0.2}
          />
          {total > 0 &&
            data.map((seg, idx) => {
              if (seg.value <= 0) return null;
              const fraction = seg.value / total;
              const strokeDasharray = `${fraction * circumference} ${circumference}`;
              const strokeDashoffset = -cumulativeOffset;
              cumulativeOffset += fraction * circumference;
              const isHovered = hoveredIdx === idx;

              return (
                <circle
                  key={seg.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth={isHovered ? thickness + 4 : thickness}
                  strokeDasharray={strokeDasharray}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="butt"
                  style={{
                    transition: 'all 0.25s ease',
                    cursor: 'pointer',
                    opacity: hoveredIdx !== null && !isHovered ? 0.6 : 1,
                  }}
                  onMouseEnter={() => setHoveredIdx(idx)}
                  onMouseLeave={() => setHoveredIdx(null)}
                />
              );
            })}
        </svg>

        {/* Center label (absolutely positioned over circle, prevents any layout overflow) */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: size,
            height: size,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
            textAlign: 'center',
            padding: 8,
            boxSizing: 'border-box',
          }}
        >
          {total === 0 ? (
            <>
              <span
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: '#64748b',
                  lineHeight: 1.2,
                }}
              >
                {centerLabel}
              </span>
              <span
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: 'var(--text, #1e293b)',
                  margin: '2px 0',
                }}
              >
                {typeof displayTotal === 'number' ? displayTotal.toLocaleString() : displayTotal}
              </span>
              <span style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.2 }}>
                {emptyMessage}
              </span>
            </>
          ) : hoveredIdx !== null ? (
            <>
              <span
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: '#64748b',
                  lineHeight: 1.2,
                }}
              >
                {data[hoveredIdx].label}
              </span>
              <span
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: 'var(--text, #1e293b)',
                  margin: '2px 0',
                }}
              >
                {data[hoveredIdx].value.toLocaleString()}
              </span>
              <span style={{ fontSize: 11, fontWeight: 600, color: data[hoveredIdx].color }}>
                {Math.round((data[hoveredIdx].value / total) * 100)}%
              </span>
            </>
          ) : (
            <>
              <span
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  color: '#64748b',
                  lineHeight: 1.2,
                }}
              >
                {centerLabel}
              </span>
              <span
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: 'var(--text, #1e293b)',
                  margin: '2px 0',
                }}
              >
                {typeof displayTotal === 'number' ? displayTotal.toLocaleString() : displayTotal}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Legend */}
      {data.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 160 }}>
          {data.map((seg, idx) => {
            const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
            const isHovered = hoveredIdx === idx;
            return (
              <div
                key={seg.label}
                onMouseEnter={() => total > 0 && setHoveredIdx(idx)}
                onMouseLeave={() => total > 0 && setHoveredIdx(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  cursor: total > 0 ? 'pointer' : 'default',
                  padding: '4px 8px',
                  borderRadius: 6,
                  backgroundColor: isHovered ? 'var(--hover-bg, #f1f5f9)' : 'transparent',
                  transition: 'background 0.2s',
                  opacity: total === 0 ? 0.75 : 1,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      backgroundColor: seg.color,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text, #334155)' }}>
                    {seg.label}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text, #0f172a)' }}>
                    {seg.value.toLocaleString()}
                  </span>
                  <span style={{ fontSize: 12, color: '#64748b', minWidth: 32, textAlign: 'right' }}>
                    {pct}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

