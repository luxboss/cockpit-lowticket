import React, { useState } from 'react';
import type { AdMedia } from '../api/types';
import { downloadMedia } from '../api/client';
import './MediaViewer.css';

interface MediaViewerProps {
  adId: string;
  media: AdMedia[];
  thumbUrl: string;
}

export const MediaViewer: React.FC<MediaViewerProps> = ({ adId, media, thumbUrl }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const currentMedia = media && media.length > 0 ? media[currentIndex] : null;

  const handlePrev = () => {
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : media.length - 1));
  };

  const handleNext = () => {
    setCurrentIndex((prev) => (prev < media.length - 1 ? prev + 1 : 0));
  };

  const handleDownload = async () => {
    if (!currentMedia) return;
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const blob = await downloadMedia(adId, currentMedia.kind, currentMedia.index);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `criativo-${adId}-${currentMedia.index}.${currentMedia.kind === 'video' ? 'mp4' : 'jpg'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      if (err.status === 410 || err.code === 'media_expired') {
        setDownloadError('Mídia expirada nos servidores da Meta.');
      } else {
        setDownloadError(err.message || 'Erro ao realizar download do criativo.');
      }
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="media-viewer-container" id="media-viewer-container">
      <div className="media-display-area">
        {currentMedia?.kind === 'video' ? (
          <video
            controls
            className="media-video"
            poster={currentMedia.previewUrl || thumbUrl}
            src={currentMedia.url}
          >
            Seu navegador não suporta a reprodução deste vídeo.
          </video>
        ) : (
          <img
            src={currentMedia?.previewUrl || currentMedia?.url || thumbUrl}
            alt="Criativo em alta resolução"
            className="media-image"
          />
        )}

        {media && media.length > 1 && (
          <div className="carousel-nav">
            <button
              type="button"
              className="carousel-btn prev"
              onClick={handlePrev}
              aria-label="Slide anterior"
            >
              ‹
            </button>
            <span className="carousel-indicator">
              {currentIndex + 1} / {media.length}
            </span>
            <button
              type="button"
              className="carousel-btn next"
              onClick={handleNext}
              aria-label="Próximo slide"
            >
              ›
            </button>
          </div>
        )}
      </div>

      <div className="media-actions-bar">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={handleDownload}
          disabled={isDownloading || !currentMedia}
          id="btn-download-media"
        >
          {isDownloading ? 'Baixando...' : 'Baixar Criativo'}
        </button>

        {downloadError && (
          <span className="media-download-error" id="media-download-error">
            {downloadError}
          </span>
        )}
      </div>
    </div>
  );
};
