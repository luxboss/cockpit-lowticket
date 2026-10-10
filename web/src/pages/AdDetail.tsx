import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { AdDetail as AdDetailType } from '../api/types';
import { getAdDetail } from '../api/client';
import { MediaViewer } from '../components/MediaViewer';
import { TimelineView } from '../components/TimelineView';
import { LandingCard } from '../components/LandingCard';
import { AdCardItem } from '../components/AdCardItem';
import { IconClipboard, IconCheck, IconExternal, IconSearch, IconInfo } from '../components/Icons';
import './AdDetail.css';

export const AdDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [ad, setAd] = useState<AdDetailType | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [is404, setIs404] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;
    setIsLoading(true);
    setIs404(false);
    setError(null);

    getAdDetail(id)
      .then((data) => {
        setAd(data);
      })
      .catch((err: any) => {
        if (err.status === 404 || err.code === 'not_found') {
          setIs404(true);
        } else {
          setError(err.message || 'Erro ao carregar detalhes do anúncio.');
        }
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [id]);

  const handleCopyText = () => {
    if (!ad?.body) return;
    navigator.clipboard.writeText(ad.body).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleBack = () => {
    navigate(-1);
  };

  if (isLoading) {
    return (
      <div className="ad-detail-loading" id="ad-detail-loading">
        <div className="spinner" />
        <p>Carregando informações completas do anúncio...</p>
      </div>
    );
  }

  if (is404 || !ad) {
    return (
      <div className="ad-detail-not-found" id="ad-detail-not-found">
        <span className="not-found-icon">
          <IconSearch size={36} />
        </span>
        <h2>Anúncio não encontrado</h2>
        <p>O anúncio com identificador "{id}" não existe na base ou foi excluído.</p>
        <button type="button" className="btn btn-primary" onClick={handleBack} id="btn-back-search">
          Voltar à Busca
        </button>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ad-detail-error" id="ad-detail-error">
        <p>{error}</p>
        <button type="button" className="btn btn-secondary" onClick={() => window.location.reload()}>
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div className="ad-detail-page" id="ad-detail-page">
      {/* Barra de Ações Superior */}
      <div className="ad-detail-top-nav">
        <button
          type="button"
          className="btn btn-secondary btn-sm btn-back"
          onClick={handleBack}
          id="btn-back-to-search"
        >
          Voltar aos Resultados
        </button>

        <a
          href={ad.libraryUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-secondary btn-sm btn-meta-library"
          id="btn-open-meta-library"
        >
          <span>Abrir na Biblioteca da Meta</span>
          <IconExternal size={14} className="ext-icon" />
        </a>
      </div>

      {/* Grid Principal do Detalhe */}
      <div className="ad-detail-grid">
        {/* Coluna Esquerda: Criativo Grande */}
        <div className="ad-detail-media-col">
          <MediaViewer
            adId={ad.id}
            media={ad.media}
            thumbUrl={ad.thumbUrl}
          />

          <TimelineView
            timeline={ad.timeline}
            daysRunning={ad.daysRunning}
          />
        </div>

        {/* Coluna Direita: Informações, Texto, Landing */}
        <div className="ad-detail-info-col">
          <div className="detail-card advertiser-banner">
            <div className="adv-profile">
              {ad.advertiser.avatarUrl ? (
                <img
                  src={ad.advertiser.avatarUrl}
                  alt={ad.advertiser.name}
                  className="adv-avatar-large"
                />
              ) : (
                <div className="adv-avatar-large-placeholder">
                  {ad.advertiser.name.slice(0, 1)}
                </div>
              )}
              <div className="adv-titles">
                <h3 className="adv-heading">{ad.advertiser.name}</h3>
                <span className="adv-page-id">ID da Página: {ad.advertiser.pageId}</span>
              </div>
            </div>

            <div className="adv-badges">
              <span className={`badge ${ad.isActive ? 'badge-active' : 'badge-inactive'}`}>
                {ad.isActive ? 'Ativo' : 'Inativo'}
              </span>
              <span className="badge badge-score score-high">
                Nota {Math.round(ad.score)}
              </span>
            </div>
          </div>

          {/* Texto Completo do Anúncio */}
          <div className="detail-card ad-body-card">
            <div className="card-header-flex">
              <h4 className="card-subtitle">Texto Completo do Anúncio</h4>
              <button
                type="button"
                className="btn btn-secondary btn-sm btn-copy-text"
                onClick={handleCopyText}
                id="btn-copy-body-text"
              >
                {copied ? (
                  <>
                    <IconCheck size={14} /> Copiado!
                  </>
                ) : (
                  <>
                    <IconClipboard size={14} /> Copiar texto
                  </>
                )}
              </button>
            </div>
            {ad.title && <h5 className="ad-headline">{ad.title}</h5>}
            <p className="ad-full-body">{ad.body}</p>
            {ad.caption && (
              <div className="ad-caption-box">
                <span className="caption-label">Legenda:</span>
                <p className="caption-text">{ad.caption}</p>
              </div>
            )}
          </div>

          {/* Landing Page */}
          <LandingCard landing={ad.landing} />

          {/* Dados Adicionais */}
          <div className="detail-card metadata-card">
            <h4 className="card-subtitle">
              <IconInfo size={16} /> Metadados de Veiculação
            </h4>
            <div className="metadata-grid">
              <div className="meta-item">
                <span className="meta-label">Países:</span>
                <span className="meta-val">{ad.countries?.join(', ') || 'BR'}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Idioma:</span>
                <span className="meta-val">{ad.language?.toUpperCase() || 'PT'}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Duplicados:</span>
                <span className="meta-val">{ad.duplicates} anúncios</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">CTA:</span>
                <span className="meta-val">{ad.cta || 'Nenhuma'}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Plataformas:</span>
                <span className="meta-val">{ad.platforms?.join(', ') || 'Facebook, Instagram'}</span>
              </div>
              <div className="meta-item">
                <span className="meta-label">Domínio:</span>
                <span className="meta-val">{ad.domain}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Outros Anúncios Desta Oferta (Siblings) */}
      {ad.siblings && ad.siblings.length > 0 && (
        <section className="ad-siblings-section" id="ad-siblings-section">
          <div className="siblings-header">
            <h3>Outros Anúncios Desta Oferta ({ad.domain})</h3>
            <span className="siblings-sub">Mesmo domínio de destino ordenados por nota de escala</span>
          </div>

          <div className="ad-grid siblings-grid">
            {ad.siblings.map((sibling) => (
              <AdCardItem key={sibling.id} ad={sibling} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
