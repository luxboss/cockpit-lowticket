import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { OfferRow } from '../api/types';
import { Sparkline } from './Sparkline';
import { formatScore, formatNumber, formatCurrency, pluralize, formatGrowth } from '../utils/formatters';
import './DataTable.css';

export interface DataTableProps {
  items: OfferRow[];
  sort?: string;
  order?: 'asc' | 'desc';
  onSortChange?: (sort: string) => void;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  className?: string;
}

export const DataTable: React.FC<DataTableProps> = ({
  items,
  sort = 'score',
  order = 'desc',
  onSortChange,
  page,
  pageSize = 50,
  total,
  onPageChange,
  className = '',
}) => {
  const navigate = useNavigate();

  const handleRowClick = (domain: string) => {
    navigate(`/oferta/${encodeURIComponent(domain)}`);
  };

  const handleHeaderClick = (colKey: string) => {
    if (onSortChange) onSortChange(colKey);
  };

  const renderSortArrow = (colKey: string) => {
    if (sort !== colKey) return null;
    return <span className="datatable-sort-icon">{order === 'asc' ? '▲' : '▼'}</span>;
  };

  const totalPages = total && pageSize ? Math.ceil(total / pageSize) : 1;

  return (
    <div className={`datatable-wrap ${className}`} id="data-table">
      {/* Tabela Desktop / Tablet (> 768px) */}
      <div className="datatable-table-scroll">
        <table className="datatable-table">
          <thead>
            <tr>
              <th className="datatable-th" style={{ width: '280px' }}>
                Oferta
              </th>
              <th
                className="datatable-th sortable"
                onClick={() => handleHeaderClick('score')}
                title="Ordenar por nota"
              >
                <div className="datatable-th-inner">
                  <span>Nota</span>
                  {renderSortArrow('score')}
                </div>
              </th>
              <th
                className="datatable-th sortable"
                onClick={() => handleHeaderClick('active')}
                title="Ordenar por anúncios ativos"
              >
                <div className="datatable-th-inner">
                  <span>Ativos</span>
                  {renderSortArrow('active')}
                </div>
              </th>
              <th
                className="datatable-th sortable"
                onClick={() => handleHeaderClick('growth')}
                title="Ordenar por crescimento em 7 dias"
              >
                <div className="datatable-th-inner">
                  <span>Crescimento (7d)</span>
                  {renderSortArrow('growth')}
                </div>
              </th>
              <th
                className="datatable-th sortable"
                onClick={() => handleHeaderClick('duplicates')}
                title="Ordenar por máximo de duplicados"
              >
                <div className="datatable-th-inner">
                  <span>Duplicados</span>
                  {renderSortArrow('duplicates')}
                </div>
              </th>
              <th
                className="datatable-th sortable"
                onClick={() => handleHeaderClick('days')}
                title="Ordenar por dias no ar"
              >
                <div className="datatable-th-inner">
                  <span>Dias</span>
                  {renderSortArrow('days')}
                </div>
              </th>
              <th
                className="datatable-th sortable"
                onClick={() => handleHeaderClick('price')}
                title="Ordenar por preço"
              >
                <div className="datatable-th-inner">
                  <span>Checkout</span>
                  {renderSortArrow('price')}
                </div>
              </th>
              <th className="datatable-th">Anunciantes</th>
            </tr>
          </thead>
          <tbody>
            {items.map((offer) => (
              <tr
                key={offer.domain}
                className="datatable-tr"
                onClick={() => handleRowClick(offer.domain)}
                title={`Ver detalhes de ${offer.domain}`}
              >
                <td className="datatable-td">
                  <div className="datatable-domain-cell">
                    {offer.thumbUrl ? (
                      <img
                        src={offer.thumbUrl}
                        alt=""
                        className="datatable-thumb"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div className="datatable-thumb-placeholder">
                        {offer.domain.slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="datatable-domain-info">
                      <span className="datatable-domain-name">{offer.domain}</span>
                      {offer.scaled && (
                        <span className="datatable-scaled-badge">Escalada</span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="datatable-td">
                  <span className="datatable-score-badge">
                    {formatScore(offer.score)}
                  </span>
                </td>
                <td className="datatable-td">
                  <strong>{formatNumber(offer.activeAds)}</strong>
                  <span style={{ color: 'var(--text-2)', fontSize: 11, marginLeft: 4 }}>
                    / {formatNumber(offer.totalAds)}
                  </span>
                </td>
                <td className="datatable-td">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        fontWeight: 600,
                        color: formatGrowth(offer.growth7d).color,
                      }}
                    >
                      {formatGrowth(offer.growth7d).text}
                    </span>
                    <Sparkline data={offer.spark} width={64} height={20} />
                  </div>
                </td>
                <td className="datatable-td">{offer.dupMax}x</td>
                <td className="datatable-td">{offer.daysMax} d</td>
                <td className="datatable-td">
                  {offer.checkout ? (
                    <div>
                      <span>{offer.checkout.platform}</span>
                      <div style={{ color: 'var(--text-2)', fontSize: 11 }}>
                        {formatCurrency(offer.checkout.priceMin)}
                      </div>
                    </div>
                  ) : (
                    <span style={{ color: 'var(--text-2)' }}>Sem checkout</span>
                  )}
                </td>
                <td className="datatable-td" style={{ color: 'var(--text-2)', fontSize: 12 }}>
                  {offer.advertisers && offer.advertisers.length > 0
                    ? offer.advertisers.map((a) => a.name).join(', ')
                    : `${offer.advertisersCount} ${pluralize(offer.advertisersCount, 'anunciante', 'anunciantes')}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modo Cartões Mobile (<= 768px) */}
      <div className="datatable-cards-wrap">
        {items.map((offer) => (
          <div
            key={offer.domain}
            className="datatable-card"
            onClick={() => handleRowClick(offer.domain)}
          >
            <div className="datatable-card-header">
              <div className="datatable-domain-cell">
                {offer.thumbUrl ? (
                  <img src={offer.thumbUrl} alt="" className="datatable-thumb" loading="lazy" />
                ) : (
                  <div className="datatable-thumb-placeholder">
                    {offer.domain.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="datatable-domain-info">
                  <span className="datatable-domain-name">{offer.domain}</span>
                  {offer.scaled && <span className="datatable-scaled-badge">Escalada</span>}
                </div>
              </div>
              <span className="datatable-score-badge">
                Nota {formatScore(offer.score)}
              </span>
            </div>

            <div className="datatable-card-grid">
              <div className="datatable-card-item">
                <span className="datatable-card-item-label">Ativos</span>
                <span className="datatable-card-item-val">
                  {formatNumber(offer.activeAds)} {pluralize(offer.activeAds, 'anúncio', 'anúncios')}
                </span>
              </div>
              <div className="datatable-card-item">
                <span className="datatable-card-item-label">Crescimento 7d</span>
                <span
                  className="datatable-card-item-val"
                  style={{
                    color: formatGrowth(offer.growth7d).color,
                    fontWeight: 600,
                  }}
                >
                  {formatGrowth(offer.growth7d).text}
                </span>
              </div>
              <div className="datatable-card-item">
                <span className="datatable-card-item-label">Duplicados</span>
                <span className="datatable-card-item-val">{offer.dupMax}x</span>
              </div>
              <div className="datatable-card-item">
                <span className="datatable-card-item-label">Checkout</span>
                <span className="datatable-card-item-val">
                  {offer.checkout ? `${offer.checkout.platform} (${formatCurrency(offer.checkout.priceMin)})` : 'Sem checkout'}
                </span>
              </div>
            </div>

            <div style={{ marginTop: 4 }}>
              <Sparkline data={offer.spark} width={120} height={24} />
            </div>
          </div>
        ))}
      </div>

      {/* Paginação */}
      {page && onPageChange && totalPages > 1 && (
        <div className="datatable-pagination">
          <span>
            Página {page} de {totalPages} ({total} {pluralize(total, 'oferta', 'ofertas')})
          </span>
          <div className="datatable-page-btns">
            <button
              type="button"
              className="datatable-page-btn"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              Anterior
            </button>
            <button
              type="button"
              className="datatable-page-btn"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
