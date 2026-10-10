import React from 'react';
import type { LandingInfo } from '../api/types';
import { IconTarget, IconCart, IconExternal } from './Icons';
import './LandingCard.css';

interface LandingCardProps {
  landing: LandingInfo | null;
}

export const LandingCard: React.FC<LandingCardProps> = ({ landing }) => {
  const formattedPrice = landing?.priceMin
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(landing.priceMin)
    : null;

  if (!landing) {
    return (
      <div className="landing-card unanalyzed" id="ad-landing-card">
        <div className="landing-card-header">
          <h4 className="landing-title">
            <IconTarget size={18} /> Página de Destino (Landing Page)
          </h4>
          <span className="badge badge-inactive">Ainda não analisada</span>
        </div>
        <p className="landing-desc-empty">
          O robô de enriquecimento ainda não coletou os dados desta landing page ou o site estava offline durante a tentativa.
        </p>
      </div>
    );
  }

  return (
    <div className="landing-card" id="ad-landing-card">
      <div className="landing-card-header">
        <h4 className="landing-title">
          <IconTarget size={18} /> Página de Destino (Landing Page)
        </h4>
        <div className="landing-badges">
          {landing.checkoutPlatform && (
            <span className="badge badge-checkout">
              <IconCart size={13} /> {landing.checkoutPlatform}
            </span>
          )}
          {formattedPrice && (
            <span className="badge badge-price">{formattedPrice}</span>
          )}
        </div>
      </div>

      <div className="landing-meta">
        <span className="landing-page-title">{landing.title}</span>
        <a
          href={landing.finalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="landing-url-link"
          title="Abrir landing page externa"
        >
          <span>{landing.finalUrl}</span>
          <IconExternal size={14} className="ext-icon" />
        </a>
      </div>

      {landing.excerpt && (
        <div className="landing-excerpt-box">
          <span className="excerpt-label">Trecho do conteúdo extraído:</span>
          <p className="landing-excerpt-text">{landing.excerpt}</p>
        </div>
      )}
    </div>
  );
};
