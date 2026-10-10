import React from 'react';
import type { SearchParams } from '../api/types';
import { IconClose } from './Icons';
import { formatAdFormat, formatCheckoutPlatform } from '../utils/formatters';
import './FilterChips.css';

interface FilterChipsProps {
  filters: SearchParams;
  onRemove: (key: keyof SearchParams) => void;
  onClearAll: () => void;
}

export const FilterChips: React.FC<FilterChipsProps> = ({ filters, onRemove, onClearAll }) => {
  const chips: { key: keyof SearchParams; label: string }[] = [];

  if (filters.field && filters.field !== 'all') {
    chips.push({ key: 'field', label: `Campo: ${filters.field}` });
  }
  if (filters.country) {
    chips.push({ key: 'country', label: `País: ${filters.country}` });
  }
  if (filters.language) {
    chips.push({ key: 'language', label: `Idioma: ${filters.language}` });
  }
  if (filters.format) {
    chips.push({ key: 'format', label: `Formato: ${formatAdFormat(filters.format)}` });
  }
  if (filters.cta) {
    chips.push({ key: 'cta', label: `CTA: ${filters.cta}` });
  }
  if (filters.checkout) {
    chips.push({ key: 'checkout', label: `Checkout: ${formatCheckoutPlatform(filters.checkout)}` });
  }
  if (filters.infoOnly === '1') {
    chips.push({ key: 'infoOnly', label: 'Somente infoprodutos' });
  }
  if (filters.status && filters.status !== 'active') {
    chips.push({ key: 'status', label: 'Todos os status' });
  }
  if (filters.minDays) {
    chips.push({ key: 'minDays', label: `Mín ${filters.minDays} dias` });
  }
  if (filters.maxDays) {
    chips.push({ key: 'maxDays', label: `Máx ${filters.maxDays} dias` });
  }
  if (filters.minDup) {
    chips.push({ key: 'minDup', label: `Mín ${filters.minDup} duplicados` });
  }
  if (filters.seenWithin) {
    chips.push({ key: 'seenWithin', label: `Visto em ${filters.seenWithin}` });
  }
  if (filters.createdFrom || filters.createdTo) {
    chips.push({
      key: 'createdFrom',
      label: `Criação: ${filters.createdFrom || '...'} até ${filters.createdTo || '...'}`,
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="filter-chips-container" id="filter-chips-container">
      <div className="filter-chips-list">
        {chips.map((c) => (
          <span key={String(c.key)} className="filter-chip" id={`chip-${c.key}`}>
            <span className="chip-label">{c.label}</span>
            <button
              type="button"
              className="chip-remove-btn"
              onClick={() => onRemove(c.key)}
              aria-label={`Remover filtro ${c.label}`}
              title="Remover filtro"
            >
              <IconClose size={12} />
            </button>
          </span>
        ))}
      </div>
      <button
        type="button"
        className="btn-clear-chips"
        onClick={onClearAll}
        id="btn-clear-all-chips"
      >
        Limpar filtros
      </button>
    </div>
  );
};
