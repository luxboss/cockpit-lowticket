import React, { useState, useRef, useEffect } from 'react';
import type { TrendPoint } from '../api/types';
import { formatShortDate } from '../utils/formatters';
import './LineChart.css';

export interface ChartSeries {
  id?: string;
  label: string;
  data: TrendPoint[];
  color?: string;
}

interface LineChartProps {
  series: ChartSeries[];
  height?: number;
  className?: string;
}

const DEFAULT_COLORS = ['#7C5CFF', '#06B6D4', '#10B981', '#F59E0B', '#EC4899'];

export const LineChart: React.FC<LineChartProps> = ({
  series,
  height = 240,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect.width > 0) {
          setWidth(entry.contentRect.width);
        }
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const validSeries = series.filter((s) => s.data && s.data.length > 0);
  if (validSeries.length === 0) {
    return (
      <div className={`linechart-container ${className}`} ref={containerRef}>
        <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-2)' }}>
          Sem dados suficientes para exibir o gráfico.
        </div>
      </div>
    );
  }

  // Obter dias únicos a partir de todas as séries
  const allDays = Array.from(new Set(validSeries.flatMap((s) => s.data.map((d) => d.day)))).sort();
  if (allDays.length === 0) {
    return null;
  }

  // Encontrar valor máximo para o eixo Y
  let maxY = 0;
  for (const s of validSeries) {
    for (const d of s.data) {
      if (d.activeAds > maxY) maxY = d.activeAds;
    }
  }
  maxY = Math.max(maxY, 5);
  // Arredonda para cima para uma linha de grade bonita
  const yTicksCount = 4;
  const yMaxRounded = Math.ceil(maxY * 1.15);

  const paddingLeft = 40;
  const paddingRight = 16;
  const paddingTop = 20;
  const paddingBottom = 30;

  const chartWidth = Math.max(width - paddingLeft - paddingRight, 100);
  const chartHeight = Math.max(height - paddingTop - paddingBottom, 60);

  const getX = (index: number) => {
    if (allDays.length <= 1) return paddingLeft + chartWidth / 2;
    return paddingLeft + (index / (allDays.length - 1)) * chartWidth;
  };

  const getY = (val: number) => {
    return paddingTop + chartHeight - (val / yMaxRounded) * chartHeight;
  };

  // Linhas de grade horizontais
  const yTicks = [];
  for (let i = 0; i <= yTicksCount; i++) {
    const val = Math.round((yMaxRounded / yTicksCount) * i);
    const yPos = getY(val);
    yTicks.push({ val, yPos });
  }

  // Rótulos do eixo X (selecionar até 6 datas para não amontoar)
  const xLabelsCount = Math.min(6, allDays.length);
  const xStep = Math.max(1, Math.floor(allDays.length / (xLabelsCount - 1 || 1)));
  const xIndices = [];
  for (let i = 0; i < allDays.length; i += xStep) {
    xIndices.push(i);
  }
  if (!xIndices.includes(allDays.length - 1)) {
    xIndices.push(allDays.length - 1);
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left - paddingLeft;
    if (mouseX < 0 || mouseX > chartWidth || allDays.length <= 1) {
      setHoverIndex(null);
      return;
    }
    const ratio = Math.max(0, Math.min(1, mouseX / chartWidth));
    const closestIdx = Math.round(ratio * (allDays.length - 1));
    setHoverIndex(closestIdx);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  return (
    <div className={`linechart-container ${className}`} ref={containerRef}>
      {validSeries.length > 1 && (
        <div className="linechart-legend">
          {validSeries.map((s, idx) => {
            const color = s.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
            return (
              <div key={s.id || s.label} className="linechart-legend-item">
                <span className="linechart-legend-color" style={{ backgroundColor: color }} />
                <span>{s.label}</span>
              </div>
            );
          })}
        </div>
      )}

      <div className="linechart-svg-wrap">
        <svg
          className="linechart-svg"
          width={width}
          height={height}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* Linhas de Grade e Eixo Y */}
          {yTicks.map((t, idx) => (
            <g key={idx}>
              <line
                x1={paddingLeft}
                y1={t.yPos}
                x2={paddingLeft + chartWidth}
                y2={t.yPos}
                stroke="#26262F"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <text
                x={paddingLeft - 8}
                y={t.yPos + 4}
                textAnchor="end"
                fontSize="11"
                fill="#8B8B99"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {t.val}
              </text>
            </g>
          ))}

          {/* Rótulos do Eixo X */}
          {xIndices.map((idx) => {
            const xPos = getX(idx);
            const dateStr = allDays[idx];
            return (
              <text
                key={idx}
                x={xPos}
                y={height - 8}
                textAnchor="middle"
                fontSize="11"
                fill="#8B8B99"
              >
                {formatShortDate(dateStr)}
              </text>
            );
          })}

          {/* Curvas de cada série */}
          {validSeries.map((s, sIdx) => {
            const color = s.color || DEFAULT_COLORS[sIdx % DEFAULT_COLORS.length];
            const dataMap = new Map(s.data.map((d) => [d.day, d.activeAds]));
            const pts = allDays.map((day, dIdx) => {
              const val = dataMap.get(day) || 0;
              return `${getX(dIdx).toFixed(1)},${getY(val).toFixed(1)}`;
            });

            return (
              <g key={s.id || s.label}>
                <polyline
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={pts.join(' ')}
                />
              </g>
            );
          })}

          {/* Linha guia no hover */}
          {hoverIndex !== null && (
            <line
              x1={getX(hoverIndex)}
              y1={paddingTop}
              x2={getX(hoverIndex)}
              y2={paddingTop + chartHeight}
              stroke="#7C5CFF"
              strokeWidth="1.5"
              strokeDasharray="2 2"
            />
          )}

          {/* Pontos no hover */}
          {hoverIndex !== null &&
            validSeries.map((s, sIdx) => {
              const color = s.color || DEFAULT_COLORS[sIdx % DEFAULT_COLORS.length];
              const day = allDays[hoverIndex];
              const item = s.data.find((d) => d.day === day);
              const val = item ? item.activeAds : 0;
              return (
                <circle
                  key={sIdx}
                  cx={getX(hoverIndex)}
                  cy={getY(val)}
                  r="4.5"
                  fill={color}
                  stroke="#15151B"
                  strokeWidth="2"
                />
              );
            })}
        </svg>

        {/* Tooltip flutuante no hover */}
        {hoverIndex !== null && (
          <div
            className="linechart-tooltip"
            style={{
              left: `${getX(hoverIndex)}px`,
              top: `${paddingTop + 10}px`,
            }}
          >
            <div className="linechart-tooltip-date">{formatShortDate(allDays[hoverIndex])}</div>
            {validSeries.map((s, sIdx) => {
              const color = s.color || DEFAULT_COLORS[sIdx % DEFAULT_COLORS.length];
              const day = allDays[hoverIndex];
              const item = s.data.find((d) => d.day === day);
              const val = item ? item.activeAds : 0;
              return (
                <div key={sIdx} className="linechart-tooltip-row">
                  <span className="linechart-legend-color" style={{ backgroundColor: color }} />
                  <span>{validSeries.length > 1 ? `${s.label}: ` : ''}</span>
                  <strong>{val} ativos</strong>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
