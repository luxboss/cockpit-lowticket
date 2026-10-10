import React, { useEffect } from 'react';
import type { SearchParams, FilterMeta } from '../api/types';
import { IconGear, IconClose } from './Icons';
import './FilterSidebar.css';

interface FilterSidebarProps {
  filters: SearchParams;
  meta: FilterMeta | null;
  onChange: (updated: Partial<SearchParams>) => void;
  onClear: () => void;
  isOpen: boolean;
  onClose: () => void;
}

const CHECKOUT_PLATFORMS = ['Hotmart', 'Kiwify', 'Eduzz', 'Cakto', 'Monetizze', 'Braip'];

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
              {(meta?.countries || [{ id: 'BR', count: 0 }, { id: 'PT', count: 0 }, { id: 'US', count: 0 }]).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.id} {c.count ? `(${c.count})` : ''}
                </option>
              ))}
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
              <option value="IMAGE">Imagem</option>
              <option value="VIDEO">Vídeo</option>
              <option value="CAROUSEL">Carrossel</option>
              <option value="DCO">Dinâmico</option>
              <option value="OTHER">Outro</option>
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
              <option value="pt">Português</option>
              <option value="es">Espanhol</option>
              <option value="en">Inglês</option>
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
              {(meta?.ctas || ['Saiba mais', 'Compre agora', 'Obter oferta', 'Cadastre-se']).map((cta) => (
                <option key={cta} value={cta}>{cta}</option>
              ))}
            </select>
          </div>

          {/* Checkout */}
          <div className="filter-group">
            <span className="filter-label">Plataforma de Checkout</span>
            <div className="filter-checkbox-grid">
              {CHECKOUT_PLATFORMS.map((plat) => (
                <label key={plat} className="filter-checkbox-item">
                  <input
                    type="checkbox"
                    checked={selectedCheckouts.includes(plat.toLowerCase())}
                    onChange={() => handleCheckoutToggle(plat)}
                  />
                  <span>{plat}</span>
                </label>
              ))}
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
