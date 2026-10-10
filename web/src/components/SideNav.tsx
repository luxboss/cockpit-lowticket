import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  IconBolt,
  IconHome,
  IconSearch,
  IconGlobe,
  IconChart,
  IconCompare,
  IconPin,
  IconLogout,
  IconMenu,
  IconLayers,
  IconTarget,
} from './Icons';
import { removeToken } from '../api/auth';
import './SideNav.css';

interface SideNavProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export const SideNav: React.FC<SideNavProps> = ({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
}) => {
  const navigate = useNavigate();

  const handleLogout = () => {
    removeToken();
    navigate('/login');
  };

  const handleLinkClick = () => {
    if (mobileOpen) onCloseMobile();
  };

  return (
    <>
      {mobileOpen && (
        <div
          className="sidenav-backdrop"
          onClick={onCloseMobile}
          aria-hidden="true"
        />
      )}

      <aside
        className={`sidenav-container ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
        id="sidebar"
      >
        <div className="sidenav-header">
          {!collapsed && (
            <NavLink to="/" className="sidenav-logo" onClick={handleLinkClick}>
              <div className="sidenav-logo-icon">
                <IconBolt size={20} />
              </div>
              <span>GUIA LOW TICKET</span>
            </NavLink>
          )}

          <button
            type="button"
            id="btn-toggle-sidebar"
            className="sidenav-toggle-btn"
            onClick={onToggleCollapse}
            title={collapsed ? 'Expandir menu' : 'Recolher menu'}
            aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}
          >
            <IconMenu size={18} />
          </button>
        </div>

        <nav className="sidenav-nav">
          {/* Início */}
          <div className="sidenav-group">
            <NavLink
              to="/"
              id="nav-link-home"
              className={({ isActive }) => `sidenav-link ${isActive ? 'active' : ''}`}
              onClick={handleLinkClick}
              title="Início"
              end
            >
              <IconHome size={18} className="sidenav-link-icon" />
              {!collapsed && <span>Início</span>}
            </NavLink>
          </div>

          {/* Pesquisa */}
          <div className="sidenav-group">
            {!collapsed && <div className="sidenav-group-title">Pesquisa</div>}
            <NavLink
              to="/palavra"
              id="nav-link-keyword"
              className={({ isActive }) => `sidenav-link ${isActive ? 'active' : ''}`}
              onClick={handleLinkClick}
              title="Visão da Palavra"
            >
              <IconTarget size={18} className="sidenav-link-icon" />
              {!collapsed && <span>Visão da Palavra</span>}
            </NavLink>
            <NavLink
              to="/explorar"
              id="nav-link-explore"
              className={({ isActive }) => `sidenav-link ${isActive ? 'active' : ''}`}
              onClick={handleLinkClick}
              title="Explorar Ofertas"
            >
              <IconLayers size={18} className="sidenav-link-icon" />
              {!collapsed && <span>Explorar Ofertas</span>}
            </NavLink>
            <NavLink
              to="/anuncios"
              id="nav-link-search"
              className={({ isActive }) => `sidenav-link ${isActive ? 'active' : ''}`}
              onClick={handleLinkClick}
              title="Anúncios"
            >
              <IconSearch size={18} className="sidenav-link-icon" />
              {!collapsed && <span>Anúncios</span>}
            </NavLink>
          </div>

          {/* Concorrência */}
          <div className="sidenav-group">
            {!collapsed && <div className="sidenav-group-title">Concorrência</div>}
            <NavLink
              to="/oferta"
              id="nav-link-offer"
              className={({ isActive }) => `sidenav-link ${isActive ? 'active' : ''}`}
              onClick={handleLinkClick}
              title="Visão da Oferta"
            >
              <IconGlobe size={18} className="sidenav-link-icon" />
              {!collapsed && <span>Visão da Oferta</span>}
            </NavLink>
            <NavLink
              to="/anunciante"
              id="nav-link-advertiser"
              className={({ isActive }) => `sidenav-link ${isActive ? 'active' : ''}`}
              onClick={handleLinkClick}
              title="Visão do Anunciante"
            >
              <IconChart size={18} className="sidenav-link-icon" />
              {!collapsed && <span>Visão do Anunciante</span>}
            </NavLink>
            <NavLink
              to="/comparar"
              id="nav-link-compare"
              className={({ isActive }) => `sidenav-link ${isActive ? 'active' : ''}`}
              onClick={handleLinkClick}
              title="Comparar Ofertas"
            >
              <IconCompare size={18} className="sidenav-link-icon" />
              {!collapsed && <span>Comparar Ofertas</span>}
            </NavLink>
          </div>

          {/* Acompanhamento */}
          <div className="sidenav-group">
            {!collapsed && <div className="sidenav-group-title">Acompanhamento</div>}
            <NavLink
              to="/monitor"
              id="nav-link-monitor"
              className={({ isActive }) => `sidenav-link ${isActive ? 'active' : ''}`}
              onClick={handleLinkClick}
              title="Monitoramento"
            >
              <IconPin size={18} className="sidenav-link-icon" />
              {!collapsed && <span>Monitoramento</span>}
            </NavLink>
          </div>
        </nav>

        <div className="sidenav-footer">
          <button
            type="button"
            id="btn-logout"
            className="sidenav-logout-btn"
            onClick={handleLogout}
            title="Sair"
          >
            <IconLogout size={18} className="sidenav-link-icon" />
            {!collapsed && <span>Sair</span>}
          </button>
        </div>
      </aside>
    </>
  );
};
