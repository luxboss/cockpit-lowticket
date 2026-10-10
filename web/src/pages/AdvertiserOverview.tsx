import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getAdvertiserDetail } from '../api/semrush';
import type { AdvertiserDetailData } from '../api/types';
import { KpiCard } from '../components/KpiCard';
import { LineChart } from '../components/LineChart';
import { DataTable } from '../components/DataTable';
import { AdCardItem } from '../components/AdCardItem';
import { formatNumber, formatDatePtBr, pluralize } from '../utils/formatters';
import './AdvertiserOverview.css';

export const AdvertiserOverview: React.FC = () => {
  const { pageId } = useParams<{ pageId?: string }>();
  const [data, setData] = useState<AdvertiserDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtros de Contexto
  const [country, setCountry] = useState('BR');
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [infoOnly, setInfoOnly] = useState(false);

  useEffect(() => {
    if (!pageId) return;
    let mounted = true;
    setLoading(true);

    getAdvertiserDetail(pageId, period, country, infoOnly ? '1' : '0')
      .then((res) => {
        if (mounted) {
          setData(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (mounted) {
          if (err.status === 404 || err.code === 'not_found') {
            setError('Anunciante não encontrado nos registros da base.');
          } else {
            setError(err.message || 'Erro ao carregar detalhes do anunciante');
          }
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [pageId, period, country, infoOnly]);

  if (!pageId) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-2)' }}>
        <h2>Visão do Anunciante</h2>
        <p>Informe o ID da página da Meta na barra superior para analisar o anunciante.</p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-2)' }}>
        Carregando dados do anunciante {pageId}...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{ padding: '30px', background: 'var(--surface)', borderRadius: 8, color: 'var(--bad)' }} id="adv-error">
        <h3>{error}</h3>
        <p style={{ color: 'var(--text-2)', fontSize: 13, marginTop: 8 }}>
          Verifique o ID digitado ou{' '}
          <Link to="/explorar" style={{ color: 'var(--accent)' }}>
            explore as ofertas mapeadas
          </Link>.
        </p>
      </div>
    );
  }

  const adv = data?.advertiser;
  if (!adv) return null;

  return (
    <div className="adv-overview-page" id="adv-overview-page">
      <header className="adv-header">
        <div className="adv-title-row">
          <div className="adv-info-left">
            <img
              src={adv.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&q=80'}
              alt=""
              className="adv-avatar-large"
            />
            <div className="adv-title-group">
              <h1 className="adv-name-title">{adv.name}</h1>
              <span className="adv-id-badge">ID da Página da Meta: {adv.pageId}</span>
            </div>
          </div>
        </div>

        {/* Linha de Filtros de Contexto */}
        <div className="context-filters-bar">
          <div className="context-filter-group">
            <span>País:</span>
            <select
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
              type="checkbox"
              checked={infoOnly}
              onChange={(e) => setInfoOnly(e.target.checked)}
            />
            <span>Só infoprodutos</span>
          </label>
        </div>
      </header>

      {/* Cartões KPI do Anunciante */}
      <section className="adv-kpis-grid" id="adv-kpis">
        <KpiCard
          label="Anúncios Ativos"
          value={formatNumber(adv.kpis.activeAds)}
          tooltip="Quantidade de anúncios que este anunciante mantém veiculando no momento."
        />
        <KpiCard
          label="Ofertas Promovidas"
          value={formatNumber(adv.kpis.offers)}
          tooltip="Número de páginas de venda distintas vinculadas a este anunciante."
        />
        <KpiCard
          label="Histórico de Anúncios"
          value={formatNumber(adv.kpis.totalAds)}
          tooltip="Total acumulado de criativos deste anunciante arquivados na base."
        />
        <KpiCard
          label="Primeira Veiculação"
          value={formatDatePtBr(adv.firstSeenAt)}
          tooltip="Data em que o primeiro criativo deste anunciante foi detectado."
        />
      </section>

      {/* Gráfico de Tendência */}
      <section id="adv-trend-section">
        <LineChart
          series={[
            {
              label: `Anúncios ativos de ${adv.name}`,
              data: adv.trend,
              color: '#7C5CFF',
            },
          ]}
          height={260}
        />
      </section>

      {/* Ofertas promovidas pelo anunciante */}
      {adv.offers && adv.offers.length > 0 && (
        <section id="adv-offers-section">
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
            Ofertas promovidas ({adv.offers.length} {pluralize(adv.offers.length, 'oferta', 'ofertas')})
          </h2>
          <DataTable items={adv.offers} />
        </section>
      )}

      {/* Criativos Principais do Anunciante */}
      {adv.topAds && adv.topAds.length > 0 && (
        <section id="adv-creatives-section">
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
            Criativos principais veiculados ({adv.topAds.length} {pluralize(adv.topAds.length, 'anúncio', 'anúncios')})
          </h2>
          <div className="adv-creatives-grid">
            {adv.topAds.map((ad) => (
              <AdCardItem key={ad.id} ad={ad} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
