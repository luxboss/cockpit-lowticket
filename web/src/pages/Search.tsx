import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AdCard, FilterMeta, SearchParams } from '../api/types';
import { searchAds, getFilters } from '../api/client';
import { SearchBar } from '../components/SearchBar';
import { FilterSidebar } from '../components/FilterSidebar';
import { FilterChips } from '../components/FilterChips';
import { SortSelect } from '../components/SortSelect';
import { AdCardItem } from '../components/AdCardItem';
import { SkeletonCard } from '../components/SkeletonCard';
import { EmptyState } from '../components/EmptyState';
import { CollectModal } from '../components/CollectModal';
import './Search.css';

export const Search: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<AdCard[]>([]);
  const [total, setTotal] = useState(0);
  const [meta, setMeta] = useState<FilterMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [isCollectModalOpen, setIsCollectModalOpen] = useState(false);

  // Extrai filtros das searchParams da URL
  const filters: SearchParams = useMemo(() => {
    return {
      q: searchParams.get('q') || '',
      field: (searchParams.get('field') as any) || 'all',
      country: searchParams.get('country') || '',
      language: (searchParams.get('language') as any) || '',
      format: (searchParams.get('format') as any) || '',
      cta: searchParams.get('cta') || '',
      checkout: searchParams.get('checkout') || '',
      infoOnly: (searchParams.get('infoOnly') as any) || '0',
      minDays: searchParams.get('minDays') ? parseInt(searchParams.get('minDays')!, 10) : undefined,
      maxDays: searchParams.get('maxDays') ? parseInt(searchParams.get('maxDays')!, 10) : undefined,
      createdFrom: searchParams.get('createdFrom') || '',
      createdTo: searchParams.get('createdTo') || '',
      seenWithin: (searchParams.get('seenWithin') as any) || '',
      minDup: searchParams.get('minDup') ? parseInt(searchParams.get('minDup')!, 10) : undefined,
      status: (searchParams.get('status') as any) || 'active',
      sort: (searchParams.get('sort') as any) || 'score',
    };
  }, [searchParams]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.field && filters.field !== 'all') count++;
    if (filters.country) count++;
    if (filters.language) count++;
    if (filters.format) count++;
    if (filters.cta) count++;
    if (filters.checkout) count++;
    if (filters.infoOnly === '1') count++;
    if (filters.status && filters.status !== 'active') count++;
    if (filters.minDays) count++;
    if (filters.maxDays) count++;
    if (filters.minDup) count++;
    if (filters.seenWithin) count++;
    if (filters.createdFrom || filters.createdTo) count++;
    return count;
  }, [filters]);

  // Carrega opções de metadados
  useEffect(() => {
    getFilters()
      .then(setMeta)
      .catch((e) => console.error('Erro ao buscar metadados de filtros:', e));
  }, []);

  // Executa busca inicial / quando URL muda
  const fetchAds = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setPage(1);
    try {
      const res = await searchAds({ ...filters, page: 1, pageSize: 24 });
      setItems(res.items);
      setTotal(res.total);
    } catch (err: any) {
      setError(err.message || 'Falha ao buscar anúncios.');
      setItems([]);
      setTotal(0);
    } finally {
      setIsLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchAds();
  }, [fetchAds]);

  // Atualiza parâmetros na URL
  const updateParams = useCallback(
    (newParams: Partial<SearchParams>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(newParams).forEach(([k, v]) => {
          if (
            v === undefined ||
            v === '' ||
            v === null ||
            (k === 'infoOnly' && v === '0') ||
            (k === 'field' && v === 'all') ||
            (k === 'status' && v === 'active') ||
            (k === 'sort' && v === 'score')
          ) {
            next.delete(k);
          } else {
            next.set(k, String(v));
          }
        });
        return next;
      });
    },
    [setSearchParams]
  );

  const handleSearchSubmit = (q: string, field: string) => {
    updateParams({ q, field: field as any });
  };

  const handleClearFilters = () => {
    const next = new URLSearchParams();
    if (filters.q) next.set('q', filters.q);
    setSearchParams(next);
  };

  const handleRemoveChip = (key: keyof SearchParams) => {
    updateParams({ [key]: undefined });
  };

  // Carregar mais (paginação contínua sem duplicados)
  const handleLoadMore = async () => {
    if (isLoadingMore) return;
    const nextPage = page + 1;
    setIsLoadingMore(true);
    try {
      const res = await searchAds({ ...filters, page: nextPage, pageSize: 24 });
      setItems((prev) => {
        const existingIds = new Set(prev.map((i) => i.id));
        const newOnes = res.items.filter((i) => !existingIds.has(i.id));
        return [...prev, ...newOnes];
      });
      setPage(nextPage);
    } catch (err: any) {
      console.error('Erro ao carregar mais itens:', err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  return (
    <div className="search-page-container">
      <SearchBar
        initialQuery={filters.q}
        initialField={filters.field}
        onSearch={handleSearchSubmit}
        onToggleFilters={() => setIsFiltersOpen((prev) => !prev)}
        activeFilterCount={activeFilterCount}
      />

      <div className={`search-layout ${isFiltersOpen ? 'filters-open' : 'filters-closed'}`}>
        <FilterSidebar
          filters={filters}
          meta={meta}
          onChange={updateParams}
          onClear={handleClearFilters}
          isOpen={isFiltersOpen}
          onClose={() => setIsFiltersOpen(false)}
        />

        <main className="search-main">
          <FilterChips
            filters={filters}
            onRemove={handleRemoveChip}
            onClearAll={handleClearFilters}
          />

          <div className="search-toolbar">
            <span className="results-count" id="results-count">
              {isLoading ? 'Buscando...' : `${total} ${total === 1 ? 'anúncio encontrado' : 'anúncios encontrados'}`}
            </span>

            <SortSelect
              value={filters.sort}
              onChange={(s) => updateParams({ sort: s })}
            />
          </div>

          {error && (
            <div className="search-error-box" id="search-error-box">
              <p>{error}</p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={fetchAds}>
                Tentar novamente
              </button>
            </div>
          )}

          {isLoading ? (
            <div className="ad-grid" id="ad-grid-loading">
              {Array.from({ length: 6 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : (
            <>
              {items.length === 0 ? (
                <EmptyState
                  query={filters.q}
                  totalResults={0}
                  onTriggerCollectNow={() => setIsCollectModalOpen(true)}
                />
              ) : (
                <>
                  <div className="ad-grid" id="ad-grid">
                    {items.map((ad) => (
                      <AdCardItem key={ad.id} ad={ad} />
                    ))}
                  </div>

                  {/* Mostra o EmptyState informativo de poucos resultados quando < 5 com q */}
                  {items.length < 5 && filters.q && (
                    <EmptyState
                      query={filters.q}
                      totalResults={items.length}
                      onTriggerCollectNow={() => setIsCollectModalOpen(true)}
                      onKeywordMonitored={fetchAds}
                    />
                  )}

                  {items.length < total && (
                    <div className="load-more-wrap">
                      <button
                        type="button"
                        className="btn btn-secondary load-more-btn"
                        onClick={handleLoadMore}
                        disabled={isLoadingMore}
                        id="btn-load-more"
                      >
                        {isLoadingMore ? 'Carregando mais anúncios...' : 'Carregar mais anúncios'}
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </main>
      </div>

      <CollectModal
        term={filters.q || ''}
        country={filters.country || 'BR'}
        isOpen={isCollectModalOpen}
        onClose={() => setIsCollectModalOpen(false)}
        onSuccess={fetchAds}
      />
    </div>
  );
};
