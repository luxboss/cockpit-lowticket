import React from 'react';
import type { AdTimeline } from '../api/types';
import { IconClock } from './Icons';
import './TimelineView.css';

interface TimelineViewProps {
  timeline: AdTimeline;
  daysRunning: number;
}

export const TimelineView: React.FC<TimelineViewProps> = ({ timeline, daysRunning }) => {
  const formatDate = (isoString?: string | null) => {
    if (!isoString) return 'Presente';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('pt-BR');
    } catch {
      return isoString;
    }
  };

  return (
    <div className="timeline-view-card" id="ad-timeline-card">
      <div className="timeline-header">
        <h4 className="timeline-title">
          <IconClock size={16} /> Linha do Tempo da Veiculação
        </h4>
        <span className="badge badge-active">{daysRunning} dias ativo</span>
      </div>

      <div className="timeline-stats-row">
        <div className="timeline-stat">
          <span className="stat-label">Primeira Veiculação</span>
          <span className="stat-value">{formatDate(timeline.startDate || timeline.firstSeenAt)}</span>
        </div>
        <div className="timeline-stat">
          <span className="stat-label">Visto por Último</span>
          <span className="stat-value">{formatDate(timeline.lastSeenAt)}</span>
        </div>
        <div className="timeline-stat">
          <span className="stat-label">Status Histórico</span>
          <span className="stat-value">{timeline.endDate ? 'Encerrado' : 'Em Veiculação'}</span>
        </div>
      </div>

      {timeline.days && timeline.days.length > 0 && (
        <div className="timeline-strip-wrap">
          <span className="strip-label">Registro Diário de Atividade:</span>
          <div className="timeline-strip">
            {timeline.days.map((item, idx) => (
              <div
                key={idx}
                className={`timeline-day-block ${item.isActive ? 'active' : 'inactive'}`}
                title={`${item.day}: ${item.isActive ? 'Ativo' : 'Inativo'}`}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
