import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getKeywordOverview } from '../api/semrush';
import { addKeyword } from '../api/client';
import type { KeywordOverviewData } from '../api/types';
import { KpiCard } from '../components/KpiCard';
import { LineChart } from '../components/LineChart';
import { BarList } from '../components/BarList';
import { DataTable } from '../components/DataTable';
import { CollectModal } from '../components/CollectModal';
import { IconRocket, IconPin, IconCheck } from '../components/Icons';
import { formatNumber, pluralize, formatDecimal } from '../utils/formatters';
import './KeywordOverview.css';

export const KeywordOverview: React.FC = () => {
  const { termo } = useParams<{ termo?: string }>();
  const [data, setData] = useState<KeywordOverviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtros de Contexto
  const [country, setCountry] = useState('BR');
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [infoOnly, setInfoOnly] = useState(false);

  // Estado de monitoramento
  const [monitored, setMonitored] = useState(false);
  const [monitorMsg, setMonitorMsg] = useState<string | null>(null);
  const [monitorLoading, setMonitorLoading] = useState(false);

  // Modal de coleta na Meta
  const [showCollectModal, setShowCollectModal] = useState(false);

  useEffect(() => {
    if (!termo) return;
    let mounted = true;
    setLoading(true);
    setMonitorMsg(null);

    getKeywordOverview(termo, period, country, infoOnly ? '1' : '0')
      .then((res) => {
        if (mounted) {
          setData(res);
          setMonitored(Boolean(res.monitored));
          setError(null);
        }
      })
      .catch((err) => {
        if (mounted) setError(err.message || 'Erro ao carregar visão da palavra');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [termo, period, country, infoOnly]);

  const handleMonitor = async () => {
    if (!termo || monitorLoading || monitored) return;
    setMonitorLoading(true);
    setMonitorMsg(null);

    try {
      await addKeyword(termo, country);
      setMonitored(true);
      setMonitorMsg('Palavra monitorada com sucesso!');
    } catch (err: any) {
      if (err.code === 'keyword_exists' || err.status === 409) {
        setMonitored(true);
        setMonitorMsg('Já monitorada');
      } else {
        setMonitorMsg('Erro ao adicionar aos monitorados');
      }
    } finally {
      setMonitorLoading(false);
    }
  };

  if (!termo) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-2)' }}>
        <h2>Visão da Palavra-chave</h2>
        <p>Utilize a barra de pesquisa acima para analisar uma palavra-chave no mercado.</p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-2)' }}>
        Carregando métricas da palavra "{termo}"...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{ padding: '30px', background: 'var(--surface)', borderRadius: 8, color: 'var(--bad)' }}>
        {error}
      </div>
    );
  }

  const hasFewOffers = data ? data.topOffers.length < 5 : false;

  return (
    <div className="keyword-overview-page" id="keyword-overview-page">
      <header className="keyword-overview-header">
        <div className="keyword-title-row">
          <div className="keyword-title-wrap">
            <h1 className="keyword-title">{termo}</h1>
            <span className="keyword-badge">Palavra-chave</span>
          </div>

          <div className="keyword-actions">
            <Link
              to={`/explorar?q=${encodeURIComponent(termo)}`}
              id="btn-explore-all-offers"
              className="keyword-btn"
            >
              Explorar todas as ofertas
            </Link>

            <button
              type="button"
              id="btn-monitor-keyword"
              className={`keyword-btn ${monitored ? '' : 'primary'}`}
              onClick={handleMonitor}
              disabled={monitorLoading || monitored}
              title={monitored ? 'Esta palavra já está em acompanhamento' : 'Adicionar ao monitoramento'}
            >
              {monitored ? <IconCheck size={16} /> : <IconPin size={16} />}
              <span>{monitored ? 'Já monitorada' : monitorLoading ? 'Salvando...' : 'Monitorar esta palavra'}</span>
            </button>
          </div>
        </div>

        {monitorMsg && (
          <div style={{ fontSize: 13, color: monitored ? 'var(--ok)' : 'var(--warn)' }}>
            {monitorMsg}
          </div>
        )}

        {/* Linha de Filtros de Contexto */}
        <div className="context-filters-bar" id="context-filters-bar">
          <div className="context-filter-group">
            <span>País:</span>
            <select
              id="select-context-country"
              className="context-filter-select"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              <option value="BR">Brasil (BR)</option>
              <option value="PT">Portugal (PT)</option>
              <option value="US">Estados Unidos (US)</option>
              <option value="ES">Espanha (ES)</option>
            </select>
          </div>

          <div className="context-filter-group">
            <span>Período:</span>
            <div className="context-periods-wrap">
              {(['7d', '30d', '90d', 'all'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`context-period-btn ${period === p ? 'active' : ''}`}
                  onClick={() => setPeriod(p)}
                >
                  {p === '7d' ? '7 d' : p === '30d' ? '30 d' : p === '90d' ? '90 d' : 'Tudo'}
                </button>
              ))}
            </div>
          </div>

          <label className="context-checkbox-label">
            <input
              id="check-context-info-only"
              type="checkbox"
              checked={infoOnly}
              onChange={(e) => setInfoOnly(e.target.checked)}
            />
            <span>Só infoprodutos</span>
          </label>
        </div>

        {/* Chamada para Buscar na Meta se houver poucos dados */}
        {hasFewOffers && (
          <div className="keyword-meta-callout" id="callout-few-offers">
            <div className="keyword-meta-callout-text">
              Poucos dados coletados para <strong>"{termo}"</strong> nesta base local ({data?.topOffers.length} {pluralize(data?.topOffers.length, 'oferta', 'ofertas')}).
              Deseja disparar uma varredura em tempo real na Biblioteca de Anúncios da Meta?
            </div>
            <button
              type="button"
              id="btn-collect-now-meta"
              className="keyword-btn primary"
              onClick={() => setShowCollectModal(true)}
            >
              <IconRocket size={16} />
              <span>Buscar na Meta agora</span>
            </button>
          </div>
        )}
      </header>

      {/* Cartões KPI */}
      {data && (
        <section className="keyword-kpis-grid" id="keyword-kpis">
          <KpiCard
            label="Anúncios Ativos"
            value={formatNumber(data.kpis.activeAds)}
            tooltip="Anúncios ativos coletados que contêm este termo."
          />
          <KpiCard
            label="Ofertas Mapeadas"
            value={formatNumber(data.kpis.offers)}
            tooltip="Domínios únicos promovidos em anúncios com este termo."
          />
          <KpiCard
            label="Ofertas Escaladas"
            value={formatNumber(data.kpis.scaledOffers)}
            tooltip="Ofertas com nota de escala ≥ 60 e pelo menos 3 anúncios simultâneos."
          />
          <KpiCard
            label="Concorrência"
            value={`${formatNumber(data.kpis.advertisers)} ${pluralize(data.kpis.advertisers, 'anunciante', 'anunciantes')}`}
            tooltip="Número de anunciantes distintos promovendo anúncios com este termo."
          />
          <KpiCard
            label="Média no Ar"
            value={`${formatDecimal(data.kpis.avgDaysRunning, 1)} ${pluralize(Math.round(data.kpis.avgDaysRunning), 'dia', 'dias')}`}
            tooltip="Média de dias em que os criativos permanecem veiculando ativamente."
          />
        </section>
      )}

      {/* Gráfico de Linha da Curva de Anúncios Ativos */}
      {data && (
        <section id="keyword-trend-section">
          <LineChart
            series={[
              {
                label: `Anúncios ativos para "${termo}"`,
                data: data.trend,
                color: '#7C5CFF',
              },
            ]}
            height={260}
          />
        </section>
      )}

      {/* Distribuição em Barras (Países, Formatos, Checkouts) */}
      {data && (
        <section className="keyword-distributions-grid" id="keyword-distributions">
          <BarList title="Países de Veiculação" items={data.countries} />
          <BarList title="Formatos de Criativo" items={data.formats} />
          <BarList title="Plataformas de Checkout" items={data.checkouts} />
        </section>
      )}

      {/* Top 10 Ofertas da Palavra */}
      {data && (
        <section id="keyword-top-offers">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>
              Top 10 ofertas mais escaladas
            </h2>
            <Link
              to={`/explorar?q=${encodeURIComponent(termo)}`}
              style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}
            >
              Ver todas na tabela completa →
            </Link>
          </div>
          <DataTable items={data.topOffers} />
        </section>
      )}

      {/* Modal de coleta na Meta */}
      <CollectModal
        term={termo}
        country={country}
        isOpen={showCollectModal}
        onClose={() => setShowCollectModal(false)}
        onSuccess={() => {
          setShowCollectModal(false);
          // Recarrega dados
          getKeywordOverview(termo, period, country, infoOnly ? '1' : '0').then(setData);
        }}
      />
    </div>
  );
};
