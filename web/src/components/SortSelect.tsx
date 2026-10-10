import React from 'react';
import type { SearchParams } from '../api/types';
import './SortSelect.css';

interface SortSelectProps {
  value?: SearchParams['sort'];
  onChange: (sort: SearchParams['sort']) => void;
}

export const SORT_OPTIONS: { value: SearchParams['sort']; label: string }[] = [
  { value: 'score', label: 'Nota de escala' },
  { value: 'longest', label: 'Mais tempo no ar' },
  { value: 'last_seen', label: 'Visto por último' },
  { value: 'newest', label: 'Mais recentes' },
  { value: 'duplicates', label: 'Mais duplicados' },
];

export const SortSelect: React.FC<SortSelectProps> = ({ value = 'score', onChange }) => {
  return (
    <div className="sort-select-wrap">
      <label htmlFor="sort-select" className="sort-label">
        Ordenar por:
      </label>
      <select
        id="sort-select"
        className="sort-select"
        value={value}
        onChange={(e) => onChange(e.target.value as SearchParams['sort'])}
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
};
