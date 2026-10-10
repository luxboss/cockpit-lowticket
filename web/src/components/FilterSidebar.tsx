import React, { useEffect } from 'react';
import type { SearchParams, FilterMeta } from '../api/types';
import { IconGear, IconClose } from './Icons';
import {
  getCountryName,
  formatAdFormat,
  formatLanguage,
  formatCheckoutPlatform,
} from '../utils/formatters';
import './FilterSidebar.css';

interface FilterSidebarProps {
  filters: SearchParams;
  meta: FilterMeta | null;
  onChange: (updated: Partial<SearchParams>) => void;
  onClear: () => void;
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_CHECKOUTS = [
  { id: 'hotmart', count: 0 },
  { id: 'kiwify', count: 0 },
  { id: 'eduzz', count: 0 },
  { id: 'cakto', count: 0 },
  { id: 'monetizze', count: 0 },
  { id: 'braip', count: 0 },
];

export const FilterSidebar: React.FC<FilterSidebarProps> = ({
  filters,
  meta,
  onChange,
  onClear,
  isOpen,
  onClose,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const selectedCheckouts = (filters.checkout ? filters.checkout.split(',') : []).map((c) => c.trim().toLowerCase());

  const handleCheckoutToggle = (plat: string) => {
    const key = plat.toLowerCase();
    let updated: string[];
    if (selectedCheckouts.includes(key)) {
      updated = selectedCheckouts.filter((c) => c !== key);
    } else {
      updated = [...selectedCheckouts, key];
    }
    onChange({ checkout: updated.join(',') });
  };

  return (
    <>
      {isOpen && <div className="filter-drawer-backdrop" onClick={onClose} />}
      <aside className={`filter-sidebar ${isOpen ? 'drawer-open' : 'sidebar-closed'}`} id="filter-sidebar">
        <div className="filter-header">
          <div className="filter-header-title">
            <span className="filter-icon">
              <IconGear size={18} />
            </span>
            <h3>Filtros</h3>
          </div>
          <div className="filter-header-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onClear}
              id="btn-clear-filters"
              title="Limpar todos os filtros"
            >
              Limpar
            </button>
            <button
              type="button"
              className="drawer-close-btn"
              onClick={onClose}
              aria-label="Fechar filtros"
            >
              <IconClose size={18} />
            </button>
          </div>
        </div>

        <div className="filter-body">
          {/* Somente Infoprodutos */}
          <div className="filter-group filter-toggle-group">
            <label className="filter-toggle-label" htmlFor="filter-info-only">
              <span className="toggle-text">
                <strong>Somente infoprodutos</strong>
                <small>Filtra apenas ofertas com checkout</small>
              </span>
              <input
                type="checkbox"
                id="filter-info-only"
                checked={filters.infoOnly === '1'}
                onChange={(e) => onChange({ infoOnly: e.target.checked ? '1' : '0' })}
              />
            </label>
          </div>

          {/* Status do anúncio */}
          <div className="filter-group">
            <label className="filter-label" htmlFor="filter-status">Status do Anúncio</label>
            <select
              id="filter-status"
              className="filter-select"
              value={filters.status || 'active'}
              onChange={(e) => onChange({ status: e.target.value as 'active' | 'all' })}
            >
              <option value="active">Somente Ativos</option>
              <option value="all">Todos (Ativos e Inativos)</option>
            </select>
          </div>

          {/* País */}
          <div className="filter-group">
            <label className="filter-label" htmlFor="filter-country">País de Veiculação</label>
            <select
              id="filter-country"
              className="filter-select"
              value={filters.country || ''}
              onChange={(e) => onChange({ country: e.target.value })}
            >
              <option value="">Todos os países</option>
              {(meta?.countries || [
                { id: 'BR', count: 0 },
                { id: 'PT', count: 0 },
                { id: 'US', count: 0 },
              ]).map((c) => {
                const id = typeof c === 'object' && c !== null ? c.id : String(c);
                const count = typeof c === 'object' && c !== null ? c.count : 0;
                const name = getCountryName(id);
                return (
                  <option key={id} value={id}>
                    {name && name !== id ? `${name} (${id})` : id} {count ? `(${count})` : ''}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Formato */}
          <div className="filter-group">
            <label className="filter-label" htmlFor="filter-format">Formato da Mídia</label>
            <select
              id="filter-format"
              className="filter-select"
              value={filters.format || ''}
              onChange={(e) => onChange({ format: e.target.value as any })}
            >
              <option value="">Todos os formatos</option>
              {(meta?.formats && meta.formats.length > 0 ? meta.formats : [
                { id: 'IMAGE', count: 0 },
                { id: 'VIDEO', count: 0 },
                { id: 'CAROUSEL', count: 0 },
                { id: 'DCO', count: 0 },
                { id: 'OTHER', count: 0 },
              ]).map((f) => {
                const id = typeof f === 'object' && f !== null ? f.id : String(f);
                const count = typeof f === 'object' && f !== null ? f.count : 0;
                return (
                  <option key={id} value={id}>
                    {formatAdFormat(id)} {count ? `(${count})` : ''}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Idioma */}
          <div className="filter-group">
            <label className="filter-label" htmlFor="filter-language">Idioma</label>
            <select
              id="filter-language"
              className="filter-select"
              value={filters.language || ''}
              onChange={(e) => onChange({ language: e.target.value as any })}
            >
              <option value="">Todos os idiomas</option>
              {(meta?.languages && meta.languages.length > 0 ? meta.languages : [
                { id: 'pt', count: 0 },
                { id: 'es', count: 0 },
                { id: 'en', count: 0 },
              ]).map((l) => {
                const id = typeof l === 'object' && l !== null ? l.id : String(l);
                const count = typeof l === 'object' && l !== null ? l.count : 0;
                return (
                  <option key={id} value={id}>
                    {formatLanguage(id)} {count ? `(${count})` : ''}
                  </option>
                );
              })}
            </select>
          </div>

          {/* CTA */}
          <div className="filter-group">
            <label className="filter-label" htmlFor="filter-cta">Chamada para Ação (CTA)</label>
            <select
              id="filter-cta"
              className="filter-select"
              value={filters.cta || ''}
              onChange={(e) => onChange({ cta: e.target.value })}
            >
              <option value="">Todas as CTAs</option>
              {(meta?.ctas && meta.ctas.length > 0 ? meta.ctas : [
                { id: 'Saiba mais', count: 0 },
                { id: 'Compre agora', count: 0 },
                { id: 'Obter oferta', count: 0 },
                { id: 'Cadastre-se', count: 0 },
              ]).map((cta) => {
                const id = typeof cta === 'object' && cta !== null ? cta.id : String(cta);
                const count = typeof cta === 'object' && cta !== null ? cta.count : 0;
                return (
                  <option key={id} value={id}>
                    {id} {count ? `(${count})` : ''}
                  </option>
                );
              })}
            </select>
          </div>

          {/* Checkout */}
          <div className="filter-group">
            <span className="filter-label">Plataforma de Checkout</span>
            <div className="filter-checkbox-grid">
              {(meta?.checkouts && meta.checkouts.length > 0 ? meta.checkouts : DEFAULT_CHECKOUTS).map((plat) => {
                const platId = typeof plat === 'object' && plat !== null ? plat.id : String(plat);
                const count = typeof plat === 'object' && plat !== null ? plat.count : 0;
                const isChecked = selectedCheckouts.includes(platId.toLowerCase());
                return (
                  <label key={platId} className="filter-checkbox-item">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => handleCheckoutToggle(platId)}
                    />
                    <span>
                      {formatCheckoutPlatform(platId)} {count ? `(${count})` : ''}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Visto nas últimas */}
          <div className="filter-group">
            <label className="filter-label" htmlFor="filter-seen-within">Visto nas Últimas</label>
            <select
              id="filter-seen-within"
              className="filter-select"
              value={filters.seenWithin || ''}
              onChange={(e) => onChange({ seenWithin: e.target.value as any })}
            >
              <option value="">Qualquer momento</option>
              <option value="24h">Últimas 24 horas</option>
              <option value="3d">Últimos 3 dias</option>
              <option value="7d">Últimos 7 dias</option>
              <option value="30d">Últimos 30 dias</option>
            </select>
          </div>

          {/* Dias no Ar */}
          <div className="filter-group">
            <span className="filter-label">Tempo no Ar (Dias)</span>
            <div className="filter-input-row">
              <input
                type="number"
                min="0"
                placeholder="Mín"
                className="filter-input"
                id="filter-min-days"
                value={filters.minDays || ''}
                onChange={(e) => onChange({ minDays: e.target.value ? parseInt(e.target.value, 10) : undefined })}
              />
              <span className="filter-sep">a</span>
              <input
                type="number"
                min="0"
                placeholder="Máx"
                className="filter-input"
                id="filter-max-days"
                value={filters.maxDays || ''}
                onChange={(e) => onChange({ maxDays: e.target.value ? parseInt(e.target.value, 10) : undefined })}
              />
            </div>
          </div>

          {/* Duplicados mínimo */}
          <div className="filter-group">
            <label className="filter-label" htmlFor="filter-min-dup">Duplicados Mínimo</label>
            <input
              type="number"
              min="0"
              placeholder="Ex: 5"
              className="filter-input"
              id="filter-min-dup"
              value={filters.minDup || ''}
              onChange={(e) => onChange({ minDup: e.target.value ? parseInt(e.target.value, 10) : undefined })}
            />
          </div>

          {/* Data de Criação */}
          <div className="filter-group">
            <span className="filter-label">Criado Entre</span>
            <div className="filter-input-col">
              <input
                type="date"
                className="filter-input"
                id="filter-created-from"
                value={filters.createdFrom || ''}
                onChange={(e) => onChange({ createdFrom: e.target.value || undefined })}
              />
              <input
                type="date"
                className="filter-input"
                id="filter-created-to"
                value={filters.createdTo || ''}
                onChange={(e) => onChange({ createdTo: e.target.value || undefined })}
              />
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};
