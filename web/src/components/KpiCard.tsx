import React, { useState } from 'react';
import { InfoIcon } from './Icons';
import './KpiCard.css';

interface KpiCardProps {
  label: string;
  value: string | number;
  diff?: number | string;
  diffLabel?: string;
  tooltip?: string;
  className?: string;
}

export const KpiCard: React.FC<KpiCardProps> = ({
  label,
  value,
  diff,
  diffLabel,
  tooltip = 'Os números refletem o universo de anúncios e ofertas coletados pelo sistema, e não o mercado irrestrito.',
  className = '',
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  let diffType: 'positive' | 'negative' | 'neutral' = 'neutral';
  let diffDisplay = '';

  if (typeof diff === 'number') {
    if (diff > 0) {
      diffType = 'positive';
      diffDisplay = `+${diff}`;
    } else if (diff < 0) {
      diffType = 'negative';
      diffDisplay = `${diff}`;
    } else {
      diffType = 'neutral';
      diffDisplay = '0';
    }
  } else if (typeof diff === 'string') {
    diffDisplay = diff;
    if (diff.startsWith('+')) diffType = 'positive';
    else if (diff.startsWith('-')) diffType = 'negative';
  }

  return (
    <div className={`kpi-card ${className}`}>
      <div className="kpi-header">
        <div className="kpi-label-wrap">
          <span className="kpi-label">{label}</span>
          {tooltip && (
            <button
              type="button"
              className="kpi-info-btn"
              onClick={() => setShowTooltip(!showTooltip)}
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              aria-label={`Informações sobre ${label}`}
              title="Clique para ver explicação"
            >
              <InfoIcon size={14} />
            </button>
          )}
        </div>
      </div>

      {showTooltip && (
        <div className="kpi-tooltip" role="tooltip">
          {tooltip}
        </div>
      )}

      <div className="kpi-body">
        <span className="kpi-value">{value}</span>
        {diff !== undefined && (
          <span className={`kpi-diff-badge ${diffType}`} title={diffLabel}>
            {diffDisplay}
            {diffLabel && <span style={{ fontWeight: 400, marginLeft: 2 }}>{diffLabel}</span>}
          </span>
        )}
      </div>
    </div>
  );
};
