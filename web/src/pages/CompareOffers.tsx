import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { getCompare } from '../api/semrush';
import type { CompareData } from '../api/types';
import { LineChart, type ChartSeries } from '../components/LineChart';
import { formatScore, formatNumber, formatCurrency, formatGrowth, pluralize, formatCheckoutPlatform } from '../utils/formatters';
import './CompareOffers.css';

const CHART_COLORS = ['#7C5CFF', '#06B6D4', '#10B981', '#F59E0B', '#EC4899'];

export const CompareOffers: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<CompareData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newDomainInput, setNewDomainInput] = useState('');

  // Filtros de Contexto
  const [country, setCountry] = useState('BR');
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('30d');
  const [infoOnly, setInfoOnly] = useState(false);

  const rawDomains = searchParams.get('domains') || searchParams.get('d') || '';
  const domainList = rawDomains
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  // Inicializa com 2 ofertas se estiver vazio
  useEffect(() => {
    if (domainList.length === 0) {
      const sp = new URLSearchParams(searchParams);
      sp.set('domains', 'metodo-marcenaria.com.br,protocolo-seco.com.br');
      setSearchParams(sp, { replace: true });
    }
  }, [domainList.length]);

  useEffect(() => {
    if (domainList.length < 2) return;
    let mounted = true;
    setLoading(true);

    getCompare(domainList, period, country, infoOnly ? '1' : '0')
      .then((res) => {
        if (mounted) {
          setData(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (mounted) setError(err.message || 'Erro ao comparar ofertas');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [rawDomains, period, country, infoOnly]);

  const handleAddDomain = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newDomainInput.trim().toLowerCase();
    if (!clean) return;

    if (domainList.includes(clean)) {
      alert('Esta oferta já foi adicionada na comparação.');
      return;
    }
    if (domainList.length >= 5) {
      alert('Limite máximo de 5 ofertas atingido para comparação simultânea.');
      return;
    }

    const updated = [...domainList, clean];
    const sp = new URLSearchParams(searchParams);
    sp.set('domains', updated.join(','));
    setSearchParams(sp);
    setNewDomainInput('');
  };

  const handleRemoveDomain = (dom: string) => {
    const updated = domainList.filter((d) => d !== dom);
    if (updated.length < 2) {
      alert('A comparação necessita de pelo menos 2 ofertas.');
      return;
    }
    const sp = new URLSearchParams(searchParams);
    sp.set('domains', updated.join(','));
    setSearchParams(sp);
  };

  const series: ChartSeries[] = data
    ? data.items.map((item, idx) => ({
        id: item.domain,
        label: item.domain,
        data: item.trend,
        color: CHART_COLORS[idx % CHART_COLORS.length],
      }))
    : [];

  return (
    <div className="compare-page" id="compare-page">
      <header className="compare-header">
        <h1 className="compare-title">Comparar Ofertas</h1>

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

        {/* Barra para adicionar oferta */}
        <form onSubmit={handleAddDomain} className="compare-add-bar">
          <input
            type="text"
            id="input-compare-domain"
            className="compare-input"
            placeholder="Adicionar domínio para comparar..."
            value={newDomainInput}
            onChange={(e) => setNewDomainInput(e.target.value)}
          />
          <button
            type="submit"
            id="btn-add-compare-domain"
            className="compare-add-btn"
            disabled={domainList.length >= 5}
            title={domainList.length >= 5 ? 'Máximo de 5 ofertas' : 'Adicionar oferta à comparação'}
          >
            + Adicionar Oferta ({domainList.length}/5)
          </button>
        </form>

        {data && data.missing && data.missing.length > 0 && (
          <div className="compare-missing-alert" id="compare-missing-alert">
            Atenção: Os seguintes domínios não foram localizados na base de dados: {data.missing.join(', ')}
          </div>
        )}
      </header>

      {loading && !data ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-2)' }}>
          Carregando comparação das ofertas...
        </div>
      ) : error ? (
        <div style={{ padding: '24px', background: 'var(--surface)', color: 'var(--bad)', borderRadius: 8 }}>
          {error}
        </div>
      ) : (
        <>
          {/* Gráfico sobreposto com múltiplas séries e cores distintas */}
          <section id="compare-chart-section">
            <LineChart series={series} height={300} />
          </section>

          {/* Cartões Comparativos Lado a Lado */}
          {data && (
            <section className="compare-cards-grid" id="compare-cards">
              {data.items.map((item, idx) => {
                const color = CHART_COLORS[idx % CHART_COLORS.length];
                return (
                  <div key={item.domain} className="compare-card">
                    <div className="compare-card-header">
                      <span className="compare-card-color-dot" style={{ backgroundColor: color }} />
                      <Link
                        to={`/oferta/${encodeURIComponent(item.domain)}`}
                        className="compare-card-title"
                        title={item.domain}
                      >
                        {item.domain}
                      </Link>
                      {domainList.length > 2 && (
                        <button
                          type="button"
                          className="compare-card-remove-btn"
                          onClick={() => handleRemoveDomain(item.domain)}
                          title="Remover oferta da comparação"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="compare-card-stat-row">
                      <span className="compare-card-stat-label">Nota de Escala</span>
                      <span className="compare-card-stat-val" style={{ color: 'var(--accent)' }}>
                        Nota {formatScore(item.score)}
                      </span>
                    </div>

                    <div className="compare-card-stat-row">
                      <span className="compare-card-stat-label">Anúncios Ativos</span>
                      <span className="compare-card-stat-val">{formatNumber(item.activeAds)}</span>
                    </div>

                    <div className="compare-card-stat-row">
                      <span className="compare-card-stat-label">Total de Anúncios</span>
                      <span className="compare-card-stat-val">{formatNumber(item.totalAds)}</span>
                    </div>

                    <div className="compare-card-stat-row">
                      <span className="compare-card-stat-label">Crescimento 7d</span>
                      <span
                        className="compare-card-stat-val"
                        style={{ color: formatGrowth(item.growth7d).color }}
                      >
                        {formatGrowth(item.growth7d).text}
                      </span>
                    </div>

                    <div className="compare-card-stat-row">
                      <span className="compare-card-stat-label">Máx Duplicados</span>
                      <span className="compare-card-stat-val">{item.dupMax}x</span>
                    </div>

                    <div className="compare-card-stat-row">
                      <span className="compare-card-stat-label">Dias no Ar</span>
                      <span className="compare-card-stat-val">
                        {item.daysMax} {pluralize(item.daysMax, 'dia', 'dias')}
                      </span>
                    </div>

                    <div className="compare-card-stat-row">
                      <span className="compare-card-stat-label">Checkout</span>
                      <span className="compare-card-stat-val">
                        {item.checkout ? `${formatCheckoutPlatform(item.checkout.platform)} (${formatCurrency(item.checkout.priceMin)})` : 'Sem checkout'}
                      </span>
                    </div>

                    <div className="compare-card-stat-row">
                      <span className="compare-card-stat-label">Anunciantes</span>
                      <span className="compare-card-stat-val">
                        {item.advertisersCount} {pluralize(item.advertisersCount, 'anunciante', 'anunciantes')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}
    </div>
  );
};
