import React, { useState } from 'react';

export interface LineSeries {
  id: string;
  label: string;
  color: string;
  data: number[]; // parallel to categories/dates
}

interface SvgLineChartProps {
  dates: string[];
  series: LineSeries[];
  height?: number;
  unit?: string;
  emptyMessage?: string;
}

export const SvgLineChart: React.FC<SvgLineChartProps> = ({
  dates,
  series,
  height = 180,
  unit = '',
  emptyMessage = 'No time-series data available for this range',
}) => {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (!dates || dates.length === 0 || series.length === 0 || series.every(s => s.data.every(v => v === 0))) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
        {emptyMessage}
      </div>
    );
  }

  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const width = 600; // viewBox width

  // Compute maximum value
  let maxVal = 0;
  for (const s of series) {
    for (const val of s.data) {
      if (val > maxVal) maxVal = val;
    }
  }
  if (maxVal === 0) maxVal = 10;
  // Round maxVal up to a nice number
  const roundMax = Math.ceil(maxVal * 1.15);

  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  const getX = (idx: number) => {
    if (dates.length <= 1) return padding.left + innerWidth / 2;
    return padding.left + (idx / (dates.length - 1)) * innerWidth;
  };

  const getY = (val: number) => {
    return padding.top + innerHeight - (val / roundMax) * innerHeight;
  };

  return (
    <div style={{ width: '100%', position: 'relative' }}>
      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {series.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: s.color }} />
            <span style={{ color: 'var(--text, #475569)', fontWeight: 500 }}>{s.label}</span>
          </div>
        ))}
      </div>

      <div style={{ position: 'relative', width: '100%', overflowX: 'auto' }}>
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: '100%', height: 'auto', display: 'block', minWidth: 380 }}
          onMouseLeave={() => setHoveredIdx(null)}
        >
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
            const y = padding.top + innerHeight * (1 - pct);
            const val = Math.round(roundMax * pct);
            return (
              <g key={pct}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  stroke="var(--border, #e2e8f0)"
                  strokeDasharray="4 4"
                  strokeWidth={0.8}
                />
                <text
                  x={padding.left - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize={10}
                  fill="#94a3b8"
                >
                  {val >= 1000 ? `${(val / 1000).toFixed(1)}k` : val}
                </text>
              </g>
            );
          })}

          {/* Series lines & areas */}
          {series.map((s) => {
            const points = s.data.map((val, idx) => `${getX(idx)},${getY(val)}`).join(' ');
            const firstX = getX(0);
            const lastX = getX(s.data.length - 1);
            const bottomY = padding.top + innerHeight;
            const areaPoints = `${firstX},${bottomY} ${points} ${lastX},${bottomY}`;

            return (
              <g key={s.id}>
                {/* Subtle area gradient fill */}
                <polygon points={areaPoints} fill={s.color} fillOpacity={0.08} />
                {/* Line path */}
                <polyline
                  points={points}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {/* Data points */}
                {s.data.map((val, idx) => (
                  <circle
                    key={idx}
                    cx={getX(idx)}
                    cy={getY(val)}
                    r={hoveredIdx === idx ? 5 : 3}
                    fill={hoveredIdx === idx ? '#fff' : s.color}
                    stroke={s.color}
                    strokeWidth={2}
                    style={{ transition: 'r 0.15s ease' }}
                  />
                ))}
              </g>
            );
          })}

          {/* Vertical hover guide and invisible hover triggers */}
          {dates.map((_d, idx) => {
            const x = getX(idx);
            const colWidth = dates.length > 1 ? innerWidth / (dates.length - 1) : innerWidth;

            return (
              <g key={idx}>
                {hoveredIdx === idx && (
                  <line
                    x1={x}
                    y1={padding.top}
                    x2={x}
                    y2={padding.top + innerHeight}
                    stroke="#94a3b8"
                    strokeWidth={1}
                    strokeDasharray="2 2"
                  />
                )}
                {/* Invisible hover capture rect */}
                <rect
                  x={x - colWidth / 2}
                  y={padding.top}
                  width={colWidth}
                  height={innerHeight}
                  fill="transparent"
                  style={{ cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredIdx(idx)}
                />
              </g>
            );
          })}

          {/* X-axis date labels */}
          {dates.map((d, idx) => {
            // Show first, last, and every few points to avoid crowding
            const step = Math.ceil(dates.length / 6);
            if (idx % step !== 0 && idx !== dates.length - 1) return null;
            const x = getX(idx);
            const displayDate = d.length > 5 ? d.substring(5) : d; // MM-DD
            return (
              <text
                key={idx}
                x={x}
                y={height - 10}
                textAnchor="middle"
                fontSize={10}
                fill="#64748b"
              >
                {displayDate}
              </text>
            );
          })}
        </svg>

        {/* Hover Tooltip Overlay */}
        {hoveredIdx !== null && (
          <div
            style={{
              position: 'absolute',
              top: 10,
              left: `${Math.min(80, Math.max(10, (hoveredIdx / (dates.length - 1 || 1)) * 100))}%`,
              transform: 'translateX(-50%)',
              backgroundColor: 'var(--card-bg, #1e293b)',
              color: '#fff',
              padding: '6px 10px',
              borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              fontSize: 11,
              pointerEvents: 'none',
              zIndex: 10,
              whiteSpace: 'nowrap',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 4, color: '#94a3b8' }}>
              {dates[hoveredIdx]}
            </div>
            {series.map((s) => (
              <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: s.color, fontWeight: 500 }}>{s.label}:</span>
                <span style={{ fontWeight: 700 }}>
                  {s.data[hoveredIdx]?.toLocaleString()} {unit}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};