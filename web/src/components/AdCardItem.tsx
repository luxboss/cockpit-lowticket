import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { AdCard } from '../api/types';
import { IconVideo, IconLayers, IconClock, IconCart } from './Icons';
import './AdCardItem.css';

interface AdCardItemProps {
  ad: AdCard;
}

export const AdCardItem: React.FC<AdCardItemProps> = ({ ad }) => {
  const navigate = useNavigate();

  const handleCardClick = () => {
    navigate(`/ad/${ad.id}`);
  };

  const formattedPrice = ad.checkout?.priceMin
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(ad.checkout.priceMin)
    : null;

  return (
    <article
      className="ad-card"
      id={`ad-card-${ad.id}`}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleCardClick();
        }
      }}
    >
      {/* Topo do Card: Anunciante com largura total & Status Ativo */}
      <div className="ad-card-header">
        <div className="advertiser-info">
          {ad.advertiser.avatarUrl ? (
            <img
              src={ad.advertiser.avatarUrl}
              alt={ad.advertiser.name}
              className="advertiser-avatar"
              loading="lazy"
            />
          ) : (
            <div className="advertiser-avatar-placeholder">
              {ad.advertiser.name.slice(0, 1)}
            </div>
          )}
          <span className="advertiser-name" title={ad.advertiser.name}>
            {ad.advertiser.name}
          </span>
        </div>
        <span className={`badge ${ad.isActive ? 'badge-active' : 'badge-inactive'}`}>
          {ad.isActive ? 'Ativo' : 'Inativo'}
        </span>
      </div>

      {/* Mídia do Card com selos sobre fundo escuro legível */}
      <div className="ad-card-media">
        <img
          src={ad.thumbUrl}
          alt={ad.title || 'Criativo do anúncio'}
          className="ad-thumb"
          loading="lazy"
        />
        <div className="media-overlay-top">
          {ad.format === 'VIDEO' && (
            <span className="badge badge-video">
              <IconVideo size={13} /> Vídeo
            </span>
          )}
          {ad.format === 'CAROUSEL' && (
            <span className="badge badge-carousel">
              <IconLayers size={13} /> Carrossel
            </span>
          )}
          <span className="badge badge-score-thumb" title="Nota de escala">
            Nota {Math.round(ad.score)}
          </span>
        </div>
        <div className="media-overlay-bottom">
          <span className="badge badge-days">
            <IconClock size={13} /> {ad.daysRunning} {ad.daysRunning === 1 ? 'dia' : 'dias'}
          </span>
        </div>
      </div>

      {/* Conteúdo & Metadados */}
      <div className="ad-card-body">
        {ad.title && <h4 className="ad-title" title={ad.title}>{ad.title}</h4>}
        <p className="ad-text-snippet">{ad.body}</p>

        <div className="ad-meta-row">
          <span className="ad-domain" title={ad.domain}>
            {ad.domain}
          </span>
          {ad.cta && <span className="ad-cta">{ad.cta}</span>}
          {ad.duplicates > 1 && (
            <span className="ad-dup" title={`${ad.duplicates} anúncios idênticos veiculados`}>
              {ad.duplicates} dup
            </span>
          )}
        </div>

        {/* Rodapé do Card: Checkout & Preço */}
        {ad.checkout && (
          <div className="ad-checkout-row">
            <span className="badge badge-checkout">
              <IconCart size={13} /> {ad.checkout.platform}
            </span>
            {formattedPrice && (
              <span className="badge badge-price">
                {formattedPrice}
              </span>
            )}
          </div>
        )}
      </div>
    </article>
  );
};
