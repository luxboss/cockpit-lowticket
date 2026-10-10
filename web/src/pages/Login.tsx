import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { setToken } from '../api/auth';
import { getSystemStatus } from '../api/client';
import { IconBolt } from '../components/Icons';
import './Login.css';

export const Login: React.FC = () => {
  const [tokenInput, setTokenInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('msg') === 'sessao_expirada') {
      setError('Sua sessão expirou ou o token é inválido. Digite seu token de acesso novamente.');
    }
  }, [location]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanToken = tokenInput.trim();
    if (!cleanToken) {
      setError('Por favor, informe o token de acesso.');
      return;
    }

    setIsLoading(true);
    setError(null);

    setToken(cleanToken);

    try {
      await getSystemStatus();
      navigate('/');
    } catch (err: any) {
      if (err.status === 401 || err.code === 'unauthorized') {
        setError('Token inválido ou não autorizado.');
      } else if (err.status === 503 || err.code === 'app_token_required') {
        setError('Servidor requer configuração do token de acesso (APP_TOKEN).');
      } else {
        setError(err.message || 'Erro ao validar token de acesso.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page-container">
      <div className="login-card" id="login-card">
        <div className="login-header">
          <span className="login-logo-icon">
            <IconBolt size={32} />
          </span>
          <h1 className="login-title">GUIA LOW TICKET</h1>
          <p className="login-subtitle">Acesso ao Minerador v2 (AdSpy & AdHeart)</p>
        </div>

        {error && (
          <div className="login-error-alert" id="login-error-alert">
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="form-group">
            <label htmlFor="input-token" className="form-label">
              Token de Acesso (Bearer Token)
            </label>
            <input
              type="password"
              id="input-token"
              className="form-input"
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="Digite seu token de acesso..."
              autoFocus
              autoComplete="off"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary login-btn"
            disabled={isLoading}
            id="btn-login-submit"
          >
            {isLoading ? 'Verificando...' : 'Entrar no Sistema'}
          </button>
        </form>

        <div className="login-footer">
          <small>Uso exclusivo autorizado. Todas as requisições utilizam criptografia segura.</small>
        </div>
      </div>
    </div>
  );
};
