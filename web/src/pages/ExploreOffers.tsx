import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getOffers, downloadOffersCsv, type GetOffersParams } from '../api/semrush';
import type { OffersResponse } from '../api/types';
import { ClusterList } from '../components/ClusterList';
import { DataTable } from '../components/DataTable';
import { IconDownload } from '../components/Icons';
import { formatNumber, formatScore } from '../utils/formatters';
import './ExploreOffers.css';

export const ExploreOffers: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<OffersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Parâmetros lidos da URL
  const q = searchParams.get('q') || '';
  const term = searchParams.get('term') || '';
  const checkout = searchParams.get('checkout') || '';
  const minActive = searchParams.get('minActive') || '';
  const minDup = searchParams.get('minDup') || '';
  const minDays = searchParams.get('minDays') || '';
  const maxDays = searchParams.get('maxDays') || '';
  const scaled = searchParams.get('scaled') || '';
  const infoOnly = searchParams.get('infoOnly') || '';
  const include = searchParams.get('include') || '';
  const exclude = searchParams.get('exclude') || '';
  const sort = (searchParams.get('sort') || 'score') as GetOffersParams['sort'];
  const order = (searchParams.get('order') || 'desc') as 'asc' | 'desc';
  const page = parseInt(searchParams.get('page') || '1', 10);

  // Atualizar parâmetros na URL
  const updateParam = (key: string, val: string | null) => {
    const sp = new URLSearchParams(searchParams);
    if (!val || val === '0' || val === '') {
      sp.delete(key);
    } else {
      sp.set(key, val);
    }
    if (key !== 'page') sp.delete('page'); // Volta para a página 1 ao alterar filtros
    setSearchParams(sp);
  };

  const handleSortChange = (colKey: string) => {
    const sp = new URLSearchParams(searchParams);
    if (sort === colKey) {
      sp.set('order', order === 'desc' ? 'asc' : 'desc');
    } else {
      sp.set('sort', colKey);
      sp.set('order', 'desc');
    }
    sp.delete('page');
    setSearchParams(sp);
  };

  const handlePageChange = (newPage: number) => {
    const sp = new URLSearchParams(searchParams);
    sp.set('page', String(newPage));
    setSearchParams(sp);
  };

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    const params: GetOffersParams = {
      q: q || undefined,
      term: term || undefined,
      checkout: checkout || undefined,
      minActive: minActive ? parseInt(minActive, 10) : undefined,
      minDup: minDup ? parseInt(minDup, 10) : undefined,
      minDays: minDays ? parseInt(minDays, 10) : undefined,
      maxDays: maxDays ? parseInt(maxDays, 10) : undefined,
      scaled: scaled === '1' ? '1' : undefined,
      infoOnly: infoOnly === '1' ? '1' : undefined,
      include: include || undefined,
      exclude: exclude || undefined,
      sort,
      order,
      page,
      pageSize: 50,
    };

    getOffers(params)
      .then((res) => {
        if (mounted) {
          setData(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (mounted) setError(err.message || 'Erro ao carregar ofertas');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [searchParams]);

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const params: GetOffersParams = {
        q: q || undefined,
        term: term || undefined,
        checkout: checkout || undefined,
        minActive: minActive ? parseInt(minActive, 10) : undefined,
        minDup: minDup ? parseInt(minDup, 10) : undefined,
        minDays: minDays ? parseInt(minDays, 10) : undefined,
        maxDays: maxDays ? parseInt(maxDays, 10) : undefined,
        scaled: scaled === '1' ? '1' : undefined,
        infoOnly: infoOnly === '1' ? '1' : undefined,
        include: include || undefined,
        exclude: exclude || undefined,
        sort,
        order,
      };

      const blob = await downloadOffersCsv(params);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ofertas-${q ? encodeURIComponent(q) : 'todas'}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Falha ao exportar CSV: ${err.message || 'Erro desconhecido'}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="explore-page" id="explore-page">
      <header className="explore-header">
        <div className="explore-title-row">
          <h1 className="explore-title">
            Explorar Ofertas {q ? `para "${q}"` : ''}
          </h1>

          <button
            type="button"
            id="btn-export-csv"
            className="explore-export-btn"
            onClick={handleExportCsv}
            disabled={exporting || loading || !data || data.items.length === 0}
            title="Exportar dados filtrados em formato CSV"
          >
            <IconDownload size={16} />
            <span>{exporting ? 'Exportando...' : 'Exportar CSV'}</span>
          </button>
        </div>

        {/* Resumo Consolidado no Topo */}
        {data && (
          <div className="explore-summary-cards" id="explore-summary">
            <div className="explore-summary-card">
              <span className="explore-summary-label">Ofertas Encontradas</span>
              <span className="explore-summary-val">{formatNumber(data.summary.offers)}</span>
            </div>
            <div className="explore-summary-card">
              <span className="explore-summary-label">Anúncios Ativos</span>
              <span className="explore-summary-val">{formatNumber(data.summary.activeAds)}</span>
            </div>
            <div className="explore-summary-card">
              <span className="explore-summary-label">Ofertas Escaladas</span>
              <span className="explore-summary-val">{formatNumber(data.summary.scaledOffers)}</span>
            </div>
            <div className="explore-summary-card">
              <span className="explore-summary-label">Nota Média</span>
              <span className="explore-summary-val">{formatScore(data.summary.avgScore)}</span>
            </div>
          </div>
        )}

        {/* Linha de Filtros */}
        <div className="explore-filters-bar" id="explore-filters">
          <div className="explore-filters-row">
            <input
              type="text"
              id="input-explore-q"
              className="explore-filter-input"
              placeholder="Pesquisar termo ou domínio..."
              defaultValue={q}
              onKeyDown={(e) => {
                if (e.key === 'Enter') updateParam('q', (e.target as HTMLInputElement).value);
              }}
              onBlur={(e) => updateParam('q', e.target.value)}
              style={{ width: '220px' }}
            />

            <select
              id="select-explore-checkout"
              className="explore-filter-select"
              value={checkout}
              onChange={(e) => updateParam('checkout', e.target.value)}
            >
              <option value="">Todos os Checkouts</option>
              <option value="hotmart">Hotmart</option>
              <option value="kiwify">Kiwify</option>
              <option value="eduzz">Eduzz</option>
              <option value="monetizze">Monetizze</option>
              <option value="braip">Braip</option>
              <option value="cakto">Cakto</option>
            </select>

            <input
              type="number"
              id="input-explore-min-active"
              className="explore-filter-input"
              placeholder="Ativos mín."
              defaultValue={minActive}
              onBlur={(e) => updateParam('minActive', e.target.value)}
              style={{ width: '105px' }}
            />

            <input
              type="number"
              id="input-explore-min-dup"
              className="explore-filter-input"
              placeholder="Dup. mín."
              defaultValue={minDup}
              onBlur={(e) => updateParam('minDup', e.target.value)}
              style={{ width: '105px' }}
            />

            <input
              type="number"
              id="input-explore-min-days"
              className="explore-filter-input"
              placeholder="Dias mín."
              defaultValue={minDays}
              onBlur={(e) => updateParam('minDays', e.target.value)}
              style={{ width: '95px' }}
            />

            <input
              type="text"
              id="input-explore-include"
              className="explore-filter-input"
              placeholder="Incluir palavra..."
              defaultValue={include}
              onKeyDown={(e) => {
                if (e.key === 'Enter') updateParam('include', (e.target as HTMLInputElement).value);
              }}
              onBlur={(e) => updateParam('include', e.target.value)}
              style={{ width: '130px' }}
            />

            <input
              type="text"
              id="input-explore-exclude"
              className="explore-filter-input"
              placeholder="Excluir palavra..."
              defaultValue={exclude}
              onKeyDown={(e) => {
                if (e.key === 'Enter') updateParam('exclude', (e.target as HTMLInputElement).value);
              }}
              onBlur={(e) => updateParam('exclude', e.target.value)}
              style={{ width: '130px' }}
            />

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                id="check-explore-scaled"
                checked={scaled === '1'}
                onChange={(e) => updateParam('scaled', e.target.checked ? '1' : null)}
              />
              <span>Só escaladas</span>
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                id="check-explore-info-only"
                checked={infoOnly === '1'}
                onChange={(e) => updateParam('infoOnly', e.target.checked ? '1' : null)}
              />
              <span>Só infoprodutos</span>
            </label>
          </div>

          {/* Chips ativos (ex: termo de cluster selecionado) */}
          {(term || q || checkout || scaled === '1' || infoOnly === '1') && (
            <div className="explore-chips-row">
              <span style={{ fontSize: 12, color: 'var(--text-2)' }}>Filtros ativos:</span>
              {term && (
                <span className="explore-chip" id="chip-cluster-term">
                  <span>Grupo: {term}</span>
                  <button
                    type="button"
                    className="explore-chip-remove"
                    onClick={() => updateParam('term', null)}
                    title="Remover filtro de grupo"
                  >
                    ×
                  </button>
                </span>
              )}
              {q && (
                <span className="explore-chip">
                  <span>Busca: {q}</span>
                  <button type="button" className="explore-chip-remove" onClick={() => updateParam('q', null)}>
                    ×
                  </button>
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Layout com ClusterList e Tabela */}
      <div className="explore-layout">
        {data && data.clusters && data.clusters.length > 0 && (
          <ClusterList
            clusters={data.clusters}
            selectedTerm={term}
            onSelectTerm={(t) => updateParam('term', t)}
            onClearTerm={() => updateParam('term', null)}
          />
        )}

        <div className="explore-table-area">
          {loading && !data ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-2)' }}>
              Carregando tabela de ofertas...
            </div>
          ) : error ? (
            <div style={{ padding: '24px', background: 'var(--surface)', color: 'var(--bad)', borderRadius: 8 }}>
              {error}
            </div>
          ) : data && data.items.length === 0 ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-2)', background: 'var(--surface)', borderRadius: 8 }}>
              Nenhuma oferta encontrada com os filtros selecionados.
            </div>
          ) : (
            data && (
              <DataTable
                items={data.items}
                sort={sort}
                order={order}
                onSortChange={handleSortChange}
                page={page}
                pageSize={data.pageSize}
                total={data.total}
                onPageChange={handlePageChange}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
};
