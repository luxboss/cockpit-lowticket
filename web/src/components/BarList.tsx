import React from 'react';
import { formatNumber, formatBarListLabel } from '../utils/formatters';
import './BarList.css';

export interface BarListItem {
  id: string;
  count: number;
}

interface BarListProps {
  title?: string;
  items: BarListItem[];
  emptyText?: string;
  className?: string;
}

export const BarList: React.FC<BarListProps> = ({
  title,
  items,
  emptyText = 'Nenhum dado disponível',
  className = '',
}) => {
  const max = Math.max(...items.map((i) => i.count), 1);
  const total = items.reduce((s, i) => s + i.count, 0) || 1;

  return (
    <div className={`barlist-card ${className}`}>
      {title && <div className="barlist-header">{title}</div>}
      {items.length === 0 ? (
        <div className="barlist-empty">{emptyText}</div>
      ) : (
        <div className="barlist-list">
          {items.map((item) => {
            const pct = Math.round((item.count / max) * 100);
            const totalPct = Math.round((item.count / total) * 100);
            const { label, title: itemTitle } = formatBarListLabel(item.id);
            return (
              <div key={item.id} className="barlist-item">
                <div className="barlist-item-row">
                  <span className="barlist-label" title={itemTitle}>
                    {label}
                  </span>
                  <span className="barlist-value">
                    {formatNumber(item.count)} ({totalPct}%)
                  </span>
                </div>
                <div className="barlist-track">
                  <div
                    className="barlist-fill"
                    style={{ width: `${Math.max(4, pct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
