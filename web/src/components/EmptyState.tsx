import React, { useState } from 'react';
import { addKeyword } from '../api/client';
import { IconBolt, IconSearch, IconRocket, IconPin } from './Icons';
import './EmptyState.css';

interface EmptyStateProps {
  query?: string;
  totalResults: number;
  onTriggerCollectNow: () => void;
  onKeywordMonitored?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  query,
  totalResults,
  onTriggerCollectNow,
  onKeywordMonitored,
}) => {
  const [monitorStatus, setMonitorStatus] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleMonitorKeyword = async () => {
    if (!query) return;
    setIsSubmitting(true);
    setMonitorStatus(null);
    try {
      await addKeyword(query, 'BR');
      setMonitorStatus('Palavra adicionada ao monitoramento com sucesso!');
      if (onKeywordMonitored) onKeywordMonitored();
    } catch (err: any) {
      if (err.code === 'keyword_exists' || err.status === 409) {
        setMonitorStatus('Esta palavra já está monitorada.');
      } else if (err.code === 'keyword_limit') {
        setMonitorStatus('Limite máximo de 50 palavras atingido.');
      } else {
        setMonitorStatus('Erro ao adicionar palavra ao monitoramento.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const hasFewResults = totalResults > 0 && totalResults < 5;

  return (
    <div className="empty-state-card" id="empty-state-card">
      <div className="empty-state-icon">
        {hasFewResults ? <IconBolt size={40} /> : <IconSearch size={40} />}
      </div>

      <h3 className="empty-state-title">
        {hasFewResults
          ? `Poucos anúncios encontrados (${totalResults})`
          : query
          ? `Nenhum anúncio encontrado para "${query}"`
          : 'Nenhum anúncio encontrado com os filtros selecionados'}
      </h3>

      <p className="empty-state-desc">
        {query
          ? 'Você pode buscar na Biblioteca da Meta em tempo real ou colocar essa palavra para monitorar diariamente no piloto automático.'
          : 'Tente alterar os termos da busca ou relaxar alguns dos filtros na lateral.'}
      </p>

      {query && (
        <div className="empty-state-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={onTriggerCollectNow}
            id="btn-collect-now"
          >
            <IconRocket size={16} /> Buscar na Meta agora
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleMonitorKeyword}
            disabled={isSubmitting}
            id="btn-monitor-keyword"
          >
            <IconPin size={16} /> Monitorar esta palavra
          </button>
        </div>
      )}

      {monitorStatus && (
        <div className="monitor-status-msg" id="monitor-status-msg">
          {monitorStatus}
        </div>
      )}
    </div>
  );
};
