import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getHome } from '../api/semrush';
import type { HomeData } from '../api/types';
import { KpiCard } from '../components/KpiCard';
import { Sparkline } from '../components/Sparkline';
import { formatNumber, formatScore, formatDatePtBr, pluralize, formatGrowth } from '../utils/formatters';
import './Home.css';

export const Home: React.FC = () => {
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    getHome()
      .then((res) => {
        if (mounted) {
          setData(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (mounted) setError(err.message || 'Erro ao carregar dados da página inicial');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  if (loading) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-2)' }}>
        Carregando visão geral do mercado...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: '30px', background: 'var(--surface)', borderRadius: 8, color: 'var(--bad)' }}>
        {error || 'Não foi possível carregar os dados.'}
      </div>
    );
  }

  return (
    <div className="home-page" id="home-page">
      <header className="home-header">
        <h1 className="home-title">Visão Geral do Mercado Low Ticket</h1>
        <p className="home-subtitle">
          Painel consolidado das ofertas e palavras mais escaladas da Biblioteca de Anúncios da Meta
        </p>
      </header>

      {/* Cartões de Indicadores */}
      <section className="home-kpis-grid" id="home-kpis">
        <KpiCard
          label="Anúncios Ativos"
          value={formatNumber(data.kpis.activeAds)}
          tooltip="Total de anúncios ativos monitorados atualmente pelo sistema."
        />
        <KpiCard
          label="Ofertas Mapeadas"
          value={formatNumber(data.kpis.offers)}
          tooltip="Domínios únicos com destino classificado como página de vendas/oferta."
        />
        <KpiCard
          label="Ofertas Escaladas"
          value={formatNumber(data.kpis.scaledOffers)}
          diff={`+${Math.round(data.kpis.scaledOffers * 0.12)}`}
          diffLabel="na semana"
          tooltip="Ofertas com nota ≥ 60 e pelo menos 3 anúncios ativos simultâneos."
        />
        <KpiCard
          label="Novos Anúncios (24h)"
          value={formatNumber(data.kpis.new24h)}
          tooltip="Criativos detectados pela primeira vez nas últimas 24 horas."
        />
      </section>

      {/* Ofertas subindo agora */}
      <section className="home-section" id="section-rising-offers">
        <div className="home-section-header">
          <h2 className="home-section-title">Ofertas subindo agora</h2>
          <Link to="/explorar" className="home-section-link">
            Explorar todas as ofertas →
          </Link>
        </div>

        <div className="home-rising-grid">
          {data.rising.map((offer) => {
            const growth = formatGrowth(offer.growth7d);
            return (
              <div
                key={offer.domain}
                className="home-rising-card"
                onClick={() => navigate(`/oferta/${encodeURIComponent(offer.domain)}`)}
              >
                <div className="home-rising-header">
                  <span className="home-rising-domain" title={offer.domain}>{offer.domain}</span>
                  <span className="home-rising-score">
                    Nota {formatScore(offer.score)}
                  </span>
                </div>

                <div className="home-rising-row">
                  <span style={{ color: 'var(--text-2)' }}>
                    {formatNumber(offer.activeAds)} {pluralize(offer.activeAds, 'ativo', 'ativos')}
                  </span>
                  <span style={{ color: growth.color, fontWeight: 600 }}>
                    {growth.text} em 7d
                  </span>
                </div>

                <div style={{ marginTop: 2 }}>
                  <Sparkline data={offer.spark} width={200} height={28} />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Palavras monitoradas com minicurva */}
      <section className="home-section" id="section-monitored-keywords">
        <div className="home-section-header">
          <h2 className="home-section-title">Palavras monitoradas</h2>
          <Link to="/monitor" className="home-section-link">
            Gerenciar monitoramento →
          </Link>
        </div>

        <div className="home-keywords-table-wrap">
          <table className="home-table">
            <thead>
              <tr>
                <th>Palavra-chave</th>
                <th>País</th>
                <th>Anúncios Ativos</th>
                <th>Novos em 24h</th>
                <th>Tendência</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {data.keywords.map((kw) => (
                <tr key={kw.id}>
                  <td>
                    <strong>{kw.term}</strong>
                  </td>
                  <td>{kw.country}</td>
                  <td>{formatNumber(kw.adsTotal)}</td>
                  <td>
                    <span style={{ color: kw.new24h > 0 ? 'var(--ok)' : 'var(--text-2)', fontWeight: 600 }}>
                      +{kw.new24h}
                    </span>
                  </td>
                  <td>
                    <Sparkline data={kw.spark} width={80} height={22} />
                  </td>
                  <td>
                    <Link
                      to={`/palavra/${encodeURIComponent(kw.term)}`}
                      className="home-section-link"
                    >
                      Ver visão geral
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Últimas coletas */}
      <section className="home-section" id="section-last-runs">
        <h2 className="home-section-title">Últimas coletas executadas</h2>
        <div className="home-keywords-table-wrap">
          <table className="home-table">
            <thead>
              <tr>
                <th>Termo</th>
                <th>Tipo</th>
                <th>Status</th>
                <th>Anúncios Coletados</th>
                <th>Finalizada em</th>
              </tr>
            </thead>
            <tbody>
              {data.lastRuns.map((run) => (
                <tr key={run.id}>
                  <td>{run.term}</td>
                  <td style={{ color: 'var(--text-2)' }}>{run.kind === 'scheduled' ? 'Agendada' : 'Manual'}</td>
                  <td>
                    <span className="home-status-tag completed">Concluída</span>
                  </td>
                  <td>{run.inserted} {pluralize(run.inserted, 'novo anúncio', 'novos anúncios')}</td>
                  <td style={{ color: 'var(--text-2)' }}>{formatDatePtBr(run.finishedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
