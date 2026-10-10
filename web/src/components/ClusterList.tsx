import React from 'react';
import type { OfferCluster } from '../api/types';
import './ClusterList.css';

interface ClusterListProps {
  clusters: OfferCluster[];
  selectedTerm?: string;
  onSelectTerm: (term: string) => void;
  onClearTerm: () => void;
  className?: string;
}

export const ClusterList: React.FC<ClusterListProps> = ({
  clusters,
  selectedTerm,
  onSelectTerm,
  onClearTerm,
  className = '',
}) => {
  if (!clusters || clusters.length === 0) {
    return null;
  }

  return (
    <aside className={`clusterlist-container ${className}`} id="cluster-list">
      <div className="clusterlist-header">
        <span className="clusterlist-title">Grupos de termos</span>
        {selectedTerm && (
          <button
            type="button"
            className="clusterlist-clear-btn"
            onClick={onClearTerm}
          >
            Limpar
          </button>
        )}
      </div>

      <div className="clusterlist-items">
        {clusters.map((c) => {
          const isActive = selectedTerm === c.term;
          return (
            <button
              key={c.term}
              type="button"
              className={`clusterlist-item-btn ${isActive ? 'active' : ''}`}
              onClick={() => onSelectTerm(c.term)}
              title={`Filtrar por ${c.term} (${c.count} ofertas)`}
            >
              <span>{c.term}</span>
              <span className="clusterlist-badge">{c.count}</span>
            </button>
          );
        })}
      </div>
    </aside>
  );
};
