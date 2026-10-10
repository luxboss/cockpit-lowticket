import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { IconSearch } from './Icons';
import './AnalyzeBar.css';

interface AnalyzeBarProps {
  initialQuery?: string;
  initialType?: 'auto' | 'keyword' | 'offer' | 'advertiser';
  initialCountry?: string;
  className?: string;
}

export const AnalyzeBar: React.FC<AnalyzeBarProps> = ({
  initialQuery = '',
  initialType = 'auto',
  initialCountry = 'BR',
  className = '',
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [type, setType] = useState<'auto' | 'keyword' | 'offer' | 'advertiser'>(initialType);
  const [country, setCountry] = useState(initialCountry);
  const navigate = useNavigate();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = query.trim();
    if (!clean) return;

    let targetType = type;
    if (targetType === 'auto') {
      if (/^[^\s]+\.[^\s]+$/i.test(clean)) {
        targetType = 'offer';
      } else if (/^\d{6,}$/.test(clean)) {
        targetType = 'advertiser';
      } else {
        targetType = 'keyword';
      }
    }

    const cParam = country && country !== 'BR' ? `?country=${country}` : '';

    if (targetType === 'offer') {
      navigate(`/oferta/${encodeURIComponent(clean)}${cParam}`);
    } else if (targetType === 'advertiser') {
      navigate(`/anunciante/${encodeURIComponent(clean)}${cParam}`);
    } else {
      navigate(`/palavra/${encodeURIComponent(clean)}${cParam}`);
    }
  };

  return (
    <div className={`analyzebar-container ${className}`} id="analyze-bar">
      <form onSubmit={handleSubmit} className="analyzebar-form">
        <div className="analyzebar-input-wrap">
          <IconSearch size={16} className="analyzebar-input-icon" />
          <input
            id="input-analyze-query"
            type="text"
            className="analyzebar-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Analisar palavra-chave, domínio ou anunciante..."
            autoComplete="off"
          />
        </div>

        <div className="analyzebar-divider" />

        <select
          id="select-analyze-type"
          className="analyzebar-select"
          value={type}
          onChange={(e) => setType(e.target.value as any)}
          aria-label="Tipo de análise"
        >
          <option value="auto">Automático</option>
          <option value="keyword">Palavra</option>
          <option value="offer">Oferta</option>
          <option value="advertiser">Anunciante</option>
        </select>

        <div className="analyzebar-divider" />

        <select
          id="select-analyze-country"
          className="analyzebar-select"
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          aria-label="País de análise"
        >
          <option value="BR">BR (Brasil)</option>
          <option value="PT">PT (Portugal)</option>
          <option value="US">US (Estados Unidos)</option>
          <option value="ES">ES (Espanha)</option>
        </select>

        <button
          type="submit"
          id="btn-analyze-submit"
          className="analyzebar-submit"
          title="Executar análise"
        >
          <span>Analisar</span>
        </button>
      </form>
    </div>
  );
};
