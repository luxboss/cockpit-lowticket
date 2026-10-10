import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { hasToken } from './api/auth';
import { Navbar } from './components/Navbar';
import { Search } from './pages/Search';
import { AdDetail } from './pages/AdDetail';
import { Keywords } from './pages/Keywords';
import { Login } from './pages/Login';
import './styles/global.css';

interface ProtectedLayoutProps {
  children: React.ReactNode;
}

const ProtectedLayout: React.FC<ProtectedLayoutProps> = ({ children }) => {
  const location = useLocation();

  if (!hasToken()) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <div className="app-container">
      <Navbar />
      <div className="main-content">{children}</div>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedLayout>
              <Search />
            </ProtectedLayout>
          }
        />
        <Route
          path="/ad/:id"
          element={
            <ProtectedLayout>
              <AdDetail />
            </ProtectedLayout>
          }
        />
        <Route
          path="/monitor"
          element={
            <ProtectedLayout>
              <Keywords />
            </ProtectedLayout>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
