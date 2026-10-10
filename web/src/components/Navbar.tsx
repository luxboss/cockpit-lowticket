import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { removeToken } from '../api/auth';
import { IconBolt, IconLogout } from './Icons';
import './Navbar.css';

export const Navbar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const handleLogout = () => {
    removeToken();
    navigate('/login');
  };

  const isSearch = location.pathname === '/' || location.pathname.startsWith('/ad/');
  const isMonitor = location.pathname.startsWith('/monitor');

  return (
    <header className="navbar" id="app-navbar">
      <div className="navbar-container">
        <div className="navbar-brand">
          <Link to="/" className="brand-link" title="Guia Low Ticket - Minerador v2">
            <span className="brand-icon">
              <IconBolt size={20} />
            </span>
            <div className="brand-text">
              <span className="brand-title brand-desktop">GUIA LOW TICKET</span>
              <span className="brand-title brand-mobile">Guia LT</span>
              <span className="brand-badge">MINERADOR v2</span>
            </div>
          </Link>
        </div>

        <nav className="navbar-nav">
          <Link
            to="/"
            className={`nav-link ${isSearch ? 'active' : ''}`}
            id="nav-link-search"
          >
            <span>Busca</span>
          </Link>
          <Link
            to="/monitor"
            className={`nav-link ${isMonitor ? 'active' : ''}`}
            id="nav-link-monitor"
          >
            <span className="nav-desktop">Monitoramento</span>
            <span className="nav-mobile">Monitor</span>
          </Link>
        </nav>

        <div className="navbar-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm btn-logout"
            onClick={handleLogout}
            id="btn-logout"
            title="Sair do aplicativo"
            aria-label="Sair do aplicativo"
          >
            <IconLogout size={16} />
            <span className="logout-text">Sair</span>
          </button>
        </div>
      </div>
    </header>
  );
};
