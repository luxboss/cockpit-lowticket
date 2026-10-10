import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getOfferDetail } from '../api/semrush';
import type { OfferDetailData } from '../api/types';
import { KpiCard } from '../components/KpiCard';
import { LineChart } from '../components/LineChart';
import { BarList } from '../components/BarList';
import { AdCardItem } from '../components/AdCardItem';
import { IconCompare, IconExternal } from '../components/Icons';
import { formatNumber, formatScore, formatCurrency, pluralize, formatCheckoutPlatform } from '../utils/formatters';
import './OfferOverview.css';

export const OfferOverview: React.FC = () => {
  const { domain } = useParams<{ domain?: string }>();
  const [data, setData] = useState<OfferDetailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtros de Contexto
  const [country, setCountry] = useState('BR');
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [infoOnly, setInfoOnly] = useState(false);

  useEffect(() => {
    if (!domain) return;
    let mounted = true;
    setLoading(true);
    setData(null);
    setError(null);

    getOfferDetail(domain, period, country, infoOnly ? '1' : '0')
      .then((res) => {
        if (mounted) {
          setData(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (mounted) {
          if (err.status === 404 || err.code === 'not_found') {
            setError('Oferta não encontrada nos registros da base.');
          } else {
            setError(err.message || 'Erro ao carregar detalhes da oferta');
          }
        }
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [domain, period, country, infoOnly]);

  if (!domain) {
    return (
      <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text-2)' }}>
        <h2>Visão da Oferta</h2>
        <p>Informe o domínio de uma página de vendas na barra superior para analisar a oferta.</p>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-2)' }}>
        Carregando visão geral da oferta {domain}...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '30px', background: 'var(--surface)', borderRadius: 8, color: 'var(--bad)' }} id="offer-error">
        <h3>{error}</h3>
        <p style={{ color: 'var(--text-2)', fontSize: 13, marginTop: 8 }}>
          Verifique se o domínio digitado está correto ou{' '}
          <Link to="/explorar" style={{ color: 'var(--accent)' }}>
            explore as ofertas mapeadas
          </Link>.
        </p>
      </div>
    );
  }

  const offer = data?.offer;
  if (!offer) return null;

  return (
    <div className="offer-overview-page" id="offer-overview-page">
      <header className="offer-header">
        <div className="offer-title-row">
          <div className="offer-domain-title-wrap">
            <h1 className="offer-domain-title">{offer.domain}</h1>
            {offer.scaled && (
              <span
                style={{
                  background: 'var(--accent-soft)',
                  color: 'var(--accent)',
                  fontWeight: 600,
                  fontSize: 12,
                  padding: '3px 8px',
                  borderRadius: 6,
                }}
              >
                Escalada
              </span>
            )}
          </div>

          <div className="offer-actions">
            <Link
              to={`/comparar?domains=${encodeURIComponent(offer.domain)}`}
              id="btn-compare-offer"
              className="offer-btn"
            >
              <IconCompare size={16} />
              <span>Comparar</span>
            </Link>

            {offer.landing && offer.landing.finalUrl && (
              <a
                href={offer.landing.finalUrl}
                target="_blank"
                rel="noopener noreferrer"
                id="btn-open-sales-page"
                className="offer-btn primary"
              >
                <IconExternal size={16} />
                <span>Abrir página de vendas</span>
              </a>
            )}
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

      {/* Cartões KPI da Oferta */}
      <section className="offer-kpis-grid" id="offer-kpis">
        <KpiCard
          label="Nota de Escala"
          value={formatScore(offer.score)}
          tooltip="Índice de 0 a 100 baseado em anúncios ativos, duplicados e dias no ar."
        />
        <KpiCard
          label="Anúncios Ativos"
          value={formatNumber(offer.activeAds)}
          diff={offer.growth7d}
          diffLabel="em 7d"
          tooltip="Quantidade de anúncios veiculando ativamente nesta oferta."
        />
        <KpiCard
          label="Máximo de Duplicados"
          value={`${offer.dupMax}x`}
          tooltip="Maior quantidade de criativos idênticos rodando simultaneamente."
        />
        <KpiCard
          label="Dias no Ar (Máx)"
          value={`${offer.daysMax} d`}
          tooltip="Tempo do anúncio ativo mais antigo apontando para esta oferta."
        />
      </section>

      {/* Gráfico de Linha da Curva de Anúncios Ativos */}
      <section id="offer-trend-section">
        <LineChart
          series={[
            {
              label: `Anúncios ativos para ${offer.domain}`,
              data: offer.trend,
              color: '#7C5CFF',
            },
          ]}
          height={260}
        />
      </section>

      {/* Página de Vendas (Landing) */}
      {offer.landing && (
        <section className="offer-landing-box" id="offer-landing-info">
          <div className="offer-landing-title">{offer.landing.title || 'Página de Vendas da Oferta'}</div>
          {offer.landing.excerpt && (
            <div className="offer-landing-excerpt">{offer.landing.excerpt}</div>
          )}
          <a
            href={offer.landing.finalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="offer-landing-url"
          >
            {offer.landing.finalUrl}
          </a>
          {offer.checkout && (
            <div style={{ fontSize: 13, color: 'var(--text-2)', marginTop: 4 }}>
              Checkout identificado: <strong>{formatCheckoutPlatform(offer.checkout.platform)}</strong> ({formatCurrency(offer.checkout.priceMin)})
            </div>
          )}
        </section>
      )}

      {/* Anunciantes que promovem a oferta */}
      {offer.advertisers && offer.advertisers.length > 0 && (
        <section id="offer-advertisers-section">
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
            Anunciantes promovendo esta oferta ({offer.advertisers.length} {pluralize(offer.advertisers.length, 'anunciante', 'anunciantes')})
          </h2>
          <div className="offer-advertisers-list">
            {offer.advertisers.map((adv) => (
              <Link
                key={adv.pageId}
                to={`/anunciante/${encodeURIComponent(adv.pageId)}`}
                className="offer-adv-card"
              >
                <div className="offer-adv-left">
                  <img
                    src={adv.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&q=80'}
                    alt=""
                    className="offer-adv-avatar"
                  />
                  <div>
                    <strong style={{ fontSize: 14 }}>{adv.name}</strong>
                    <div style={{ fontSize: 12, color: 'var(--text-2)' }}>ID: {adv.pageId}</div>
                  </div>
                </div>
                <span style={{ fontSize: 13, color: 'var(--accent)' }}>
                  {adv.activeAds !== undefined ? `${adv.activeAds} ${pluralize(adv.activeAds, 'anúncio ativo', 'anúncios ativos')} →` : 'Ver anunciante →'}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Países e Formatos */}
      <section className="keyword-distributions-grid" id="offer-distributions">
        <BarList title="Países de Veiculação" items={offer.countries} />
        <BarList title="Formatos de Criativo" items={offer.formats} />
      </section>

      {/* Criativos Principais (AdCards) */}
      {offer.topAds && offer.topAds.length > 0 && (
        <section id="offer-creatives-section">
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>
            Criativos principais veiculados ({offer.topAds.length} {pluralize(offer.topAds.length, 'anúncio', 'anúncios')})
          </h2>
          <div className="offer-creatives-grid">
            {offer.topAds.map((ad) => (
              <AdCardItem key={ad.id} ad={ad} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
