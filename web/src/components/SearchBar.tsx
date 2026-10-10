import React, { useState, useEffect } from 'react';
import { IconSearch, IconGear, IconClose } from './Icons';
import './SearchBar.css';

interface SearchBarProps {
  initialQuery?: string;
  initialField?: string;
  onSearch: (q: string, field: string) => void;
  onToggleFilters: () => void;
  activeFilterCount: number;
}

export const FIELD_OPTIONS = [
  { value: 'all', label: 'Tudo' },
  { value: 'text', label: 'Texto do anúncio' },
  { value: 'advertiser', label: 'Anunciante' },
  { value: 'domain', label: 'Domínio' },
  { value: 'url', label: 'URL' },
  { value: 'landing', label: 'Texto da landing' },
];

export const SearchBar: React.FC<SearchBarProps> = ({
  initialQuery = '',
  initialField = 'all',
  onSearch,
  onToggleFilters,
  activeFilterCount,
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [field, setField] = useState(initialField);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    setField(initialField);
  }, [initialField]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch(query.trim(), field);
  };

  const handleClear = () => {
    setQuery('');
    onSearch('', field);
  };

  return (
    <div className="search-bar-wrap">
      <form className="search-bar-form" onSubmit={handleSubmit}>
        {/* No 360px / mobile, este seletor fica em linha própria no topo */}
        <div className="search-field-select-wrap">
          <select
            className="search-field-select"
            value={field}
            onChange={(e) => {
              const newField = e.target.value;
              setField(newField);
              onSearch(query.trim(), newField);
            }}
            id="search-field-select"
            aria-label="Selecionar campo de busca"
          >
            {FIELD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* Linha dos inputs e botões */}
        <div className="search-inputs-row">
          <div className="search-input-wrap">
            <input
              type="text"
              className="search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Pesquisar por palavras, nichos..."
              id="search-query-input"
              autoComplete="off"
            />
            {query && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={handleClear}
                title="Limpar texto"
                aria-label="Limpar texto"
              >
                <IconClose size={14} />
              </button>
            )}
          </div>

          <button type="submit" className="btn btn-primary search-submit-btn" id="btn-search-submit">
            <IconSearch size={16} />
            <span className="search-btn-label">Buscar</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary filters-trigger-btn"
            onClick={onToggleFilters}
            id="btn-mobile-filters-trigger"
            aria-label="Alternar filtros"
            title="Mostrar ou ocultar filtros laterais"
          >
            <IconGear size={16} />
            <span className="filter-btn-label">Filtros</span>
            {activeFilterCount > 0 && (
              <span className="filter-badge-count">{activeFilterCount}</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};
