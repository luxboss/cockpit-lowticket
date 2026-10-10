import React, { useState } from 'react';
import { SideNav } from './SideNav';
import { AnalyzeBar } from './AnalyzeBar';
import { IconMenu } from './Icons';
import './AppLayout.css';

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="app-shell" id="app-shell">
      <SideNav
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="app-main-pane">
        <header className="app-topbar" id="app-topbar">
          <div className="app-topbar-left">
            <button
              type="button"
              id="btn-mobile-menu"
              className="app-mobile-menu-btn"
              onClick={() => setMobileOpen(true)}
              aria-label="Abrir menu de navegação"
            >
              <IconMenu size={20} />
            </button>
            <span className="app-mobile-logo">Guia LT</span>
          </div>

          <AnalyzeBar />
        </header>

        <main className="app-content-body" id="main-content">
          {children}
        </main>
      </div>
    </div>
  );
};
