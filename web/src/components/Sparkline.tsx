import React from 'react';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showTrendColor?: boolean;
  className?: string;
}

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  width = 80,
  height = 24,
  color,
  showTrendColor = true,
  className = '',
}) => {
  if (!data || data.length < 2) {
    return <div style={{ width, height }} className={className} />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = 2;
  const effectiveHeight = height - padding * 2;
  const step = (width - padding * 2) / (data.length - 1);

  const points = data.map((val, i) => {
    const x = padding + i * step;
    const y = height - padding - ((val - min) / range) * effectiveHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polylineStr = points.join(' ');

  let strokeColor = color || '#7C5CFF';
  if (showTrendColor && !color) {
    const first = data[0];
    const last = data[data.length - 1];
    if (last > first) strokeColor = '#22C55E';
    else if (last < first) strokeColor = '#EF4444';
    else strokeColor = '#7C5CFF';
  }

  // Preenchimento de área
  const firstPt = points[0].split(',');
  const lastPt = points[points.length - 1].split(',');
  const areaPath = `M ${firstPt[0]} ${firstPt[1]} L ${points.map(p => p.replace(',', ' ')).join(' L ')} L ${lastPt[0]} ${height} L ${firstPt[0]} ${height} Z`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      className={className}
      style={{ overflow: 'visible', display: 'inline-block', verticalAlign: 'middle' }}
    >
      <path
        d={areaPath}
        fill={strokeColor}
        fillOpacity="0.12"
      />
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={polylineStr}
      />
    </svg>
  );
};
