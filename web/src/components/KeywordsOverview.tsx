import React from 'react';
import type { SystemStatus } from '../api/types';

interface KeywordsOverviewProps {
  status: SystemStatus;
}

export const KeywordsOverview: React.FC<KeywordsOverviewProps> = ({ status }) => {
  return (
    <section className="status-overview-grid" id="status-overview-grid">
      <div className="status-stat-card">
        <span className="status-card-label">Cota Diária Apify (Monitoramento)</span>
        <div className="status-card-value">
          <span>{status.apify.todayAds}</span>
          <small>/ {status.apify.dailyLimit} anúncios</small>
        </div>
        <div className="status-progress-bar">
          <div
            className="status-progress-fill"
            style={{
              width: `${Math.min(100, (status.apify.todayAds / status.apify.dailyLimit) * 100)}%`,
            }}
          />
        </div>
      </div>

      <div className="status-stat-card">
        <span className="status-card-label">Cota Diária (Buscar Agora)</span>
        <div className="status-card-value">
          <span>{status.apify.nowTodayAds}</span>
          <small>/ {status.apify.nowDailyLimit} anúncios</small>
        </div>
        <div className="status-progress-bar">
          <div
            className="status-progress-fill"
            style={{
              width: `${Math.min(100, (status.apify.nowTodayAds / status.apify.nowDailyLimit) * 100)}%`,
            }}
          />
        </div>
      </div>

      <div className="status-stat-card">
        <span className="status-card-label">Saúde do Worker & Banco</span>
        <div className="status-card-value">
          <span className={`worker-pill ${status.worker.alive ? 'worker-alive' : 'worker-dead'}`}>
            <span className="worker-dot" />
            <span className="worker-text">{status.worker.alive ? 'Worker ativo' : 'Worker offline'}</span>
          </span>
        </div>
        <small className="status-stat-sub">
          Banco: {status.db} | Busca FTS: {status.search.fts ? 'Sim' : 'Não'}
        </small>
      </div>

      <div className="status-stat-card">
        <span className="status-card-label">Base Indexada</span>
        <div className="status-card-value">
          <span>{status.totals.activeAds}</span>
          <small>ativos ({status.totals.ads} tot)</small>
        </div>
        <small className="status-stat-sub">
          {status.totals.advertisers} anunciantes | {status.totals.domains} domínios
        </small>
      </div>
    </section>
  );
};
