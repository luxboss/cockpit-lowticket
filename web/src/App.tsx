import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { hasToken } from './api/auth';
import { AppLayout } from './components/AppLayout';
import { Home } from './pages/Home';
import { KeywordOverview } from './pages/KeywordOverview';
import { ExploreOffers } from './pages/ExploreOffers';
import { Search } from './pages/Search';
import { OfferOverview } from './pages/OfferOverview';
import { AdvertiserOverview } from './pages/AdvertiserOverview';
import { CompareOffers } from './pages/CompareOffers';
import { Keywords } from './pages/Keywords';
import { AdDetail } from './pages/AdDetail';
import { Login } from './pages/Login';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/global.css';

interface ProtectedLayoutProps {
  children: React.ReactNode;
}

const ProtectedLayout: React.FC<ProtectedLayoutProps> = ({ children }) => {
  const location = useLocation();

  if (!hasToken()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <AppLayout>{children}</AppLayout>;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <ErrorBoundary fallbackTitle="Ocorreu um erro no aplicativo">
        <Routes>
        <Route path="/login" element={<Login />} />

        {/* Início */}
        <Route
          path="/"
          element={
            <ProtectedLayout>
              <Home />
            </ProtectedLayout>
          }
        />

        {/* Pesquisa */}
        <Route
          path="/palavra"
          element={
            <ProtectedLayout>
              <KeywordOverview />
            </ProtectedLayout>
          }
        />
        <Route
          path="/palavra/:termo"
          element={
            <ProtectedLayout>
              <KeywordOverview />
            </ProtectedLayout>
          }
        />
        <Route
          path="/explorar"
          element={
            <ProtectedLayout>
              <ExploreOffers />
            </ProtectedLayout>
          }
        />
        <Route
          path="/anuncios"
          element={
            <ProtectedLayout>
              <Search />
            </ProtectedLayout>
          }
        />

        {/* Concorrência */}
        <Route
          path="/oferta"
          element={
            <ProtectedLayout>
              <OfferOverview />
            </ProtectedLayout>
          }
        />
        <Route
          path="/oferta/:domain"
          element={
            <ProtectedLayout>
              <OfferOverview />
            </ProtectedLayout>
          }
        />
        <Route
          path="/anunciante"
          element={
            <ProtectedLayout>
              <AdvertiserOverview />
            </ProtectedLayout>
          }
        />
        <Route
          path="/anunciante/:pageId"
          element={
            <ProtectedLayout>
              <AdvertiserOverview />
            </ProtectedLayout>
          }
        />
        <Route
          path="/comparar"
          element={
            <ProtectedLayout>
              <CompareOffers />
            </ProtectedLayout>
          }
        />

        {/* Acompanhamento */}
        <Route
          path="/monitor"
          element={
            <ProtectedLayout>
              <Keywords />
            </ProtectedLayout>
          }
        />

        {/* Detalhe do Anúncio */}
        <Route
          path="/ad/:id"
          element={
            <ProtectedLayout>
              <AdDetail />
            </ProtectedLayout>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  </BrowserRouter>
);
};
