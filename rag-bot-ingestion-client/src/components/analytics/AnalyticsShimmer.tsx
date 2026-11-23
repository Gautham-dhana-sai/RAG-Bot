import React from 'react';

interface ShimmerBoxProps {
  height?: number | string;
  width?: number | string;
  borderRadius?: number;
  style?: React.CSSProperties;
}

export const ShimmerBox: React.FC<ShimmerBoxProps> = ({
  height = 20,
  width = '100%',
  borderRadius = 8,
  style,
}) => (
  <div
    style={{
      height,
      width,
      borderRadius,
      backgroundColor: 'var(--border, #e2e8f0)',
      opacity: 0.6,
      animation: 'analytics-shimmer-pulse 1.4s ease-in-out infinite',
      ...style,
    }}
  />
);

export const ShimmerMetricGrid: React.FC<{ count?: number }> = ({ count = 5 }) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
      gap: 16,
      marginBottom: 24,
    }}
  >
    {[...Array(count)].map((_, i) => (
      <div
        key={i}
        style={{
          backgroundColor: 'var(--card-bg, #ffffff)',
          border: '1px solid var(--border, #e2e8f0)',
          borderRadius: 12,
          padding: '16px 18px',
          height: 94,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <ShimmerBox height={12} width="50%" borderRadius={4} />
          <ShimmerBox height={18} width={18} borderRadius={9} />
        </div>
        <div>
          <ShimmerBox height={22} width="40%" borderRadius={4} style={{ marginBottom: 6 }} />
          <ShimmerBox height={10} width="65%" borderRadius={4} />
        </div>
      </div>
    ))}
  </div>
);

export const ShimmerCard: React.FC<{ height?: number; children?: React.ReactNode }> = ({
  height = 300,
  children,
}) => (
  <div
    style={{
      backgroundColor: 'var(--card-bg, #ffffff)',
      border: '1px solid var(--border, #e2e8f0)',
      borderRadius: 12,
      padding: '20px 24px',
      minHeight: height,
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
    }}
  >
    {children || (
      <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ShimmerBox height={18} width="35%" borderRadius={4} />
          <ShimmerBox height={12} width="55%" borderRadius={4} />
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ShimmerBox height="70%" width="85%" borderRadius={8} />
        </div>
      </>
    )}
  </div>
);

export const ShimmerTable: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div
    style={{
      backgroundColor: 'var(--card-bg, #ffffff)',
      border: '1px solid var(--border, #e2e8f0)',
      borderRadius: 12,
      padding: '20px 24px',
      minHeight: 380,
    }}
  >
    <div style={{ marginBottom: 20 }}>
      <ShimmerBox height={18} width="30%" borderRadius={4} style={{ marginBottom: 6 }} />
      <ShimmerBox height={12} width="45%" borderRadius={4} />
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {[...Array(rows)].map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            padding: '12px 0',
            borderBottom: '1px solid var(--border, #f1f5f9)',
          }}
        >
          <ShimmerBox height={16} width="20%" borderRadius={4} />
          <ShimmerBox height={16} width="35%" borderRadius={4} />
          <ShimmerBox height={16} width="15%" borderRadius={4} />
          <ShimmerBox height={16} width="15%" borderRadius={4} />
          <ShimmerBox height={16} width="15%" borderRadius={4} />
        </div>
      ))}
    </div>
  </div>
);
