import React, { memo } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PortalProvider } from './context/PortalContext';
import { Header } from './components/common/Header';
import { AuthView } from './components/auth/AuthView';
import { PortalsDashboardView } from './components/portal/PortalsDashboardView';
import { PortalWorkspaceLayout } from './components/portal/PortalWorkspaceLayout';
import './App.css';

// Re-export formatters and validators for backwards compatibility
export * from './utils/formatters';
export * from './utils/validators';

const ProtectedLayout: React.FC = memo(() => {
  const { authToken } = useAuth();

  if (!authToken) {
    return <Navigate to="/login" replace />;
  }

  return (
    <PortalProvider>
      <div className="portal-layout">
        <Header />
        <main className="portal-main">
          <Outlet />
        </main>
      </div>
    </PortalProvider>
  );
});

ProtectedLayout.displayName = 'ProtectedLayout';

const AppRoutes: React.FC = memo(() => {
  const { authToken } = useAuth();

  return (
    <Routes>
      {/* Public Auth Routes */}
      <Route path="/login" element={<AuthView initialMode="login" />} />
      <Route path="/register" element={<AuthView initialMode="signup" />} />

      {/* Protected Routes */}
      <Route element={<ProtectedLayout />}>
        {/* Portals Dashboard Overview */}
        <Route path="/portals" element={<PortalsDashboardView />} />

        {/* Inside Portal Workspace (Single page) */}
        <Route path="/portals/:portalId" element={<PortalWorkspaceLayout />} />
      </Route>

      {/* Landing & Fallback */}
      <Route path="/" element={<Navigate to={authToken ? "/portals" : "/login"} replace />} />
      <Route path="*" element={<Navigate to={authToken ? "/portals" : "/login"} replace />} />
    </Routes>
  );
});

AppRoutes.displayName = 'AppRoutes';

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
