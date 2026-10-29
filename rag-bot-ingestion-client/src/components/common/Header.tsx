import React, { memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export const Header: React.FC = memo(() => {
  const navigate = useNavigate();
  const { workspaceName, logout } = useAuth();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="portal-navbar">
      <div className="nav-brand">
        <span className="brand-logo">🤖</span>
        <span className="brand-title">RAG-BOT Portals</span>
        {workspaceName && (
          <span className="workspace-pill">🏢 {workspaceName}</span>
        )}
      </div>

      <div className="nav-user">
        <button
          type="button"
          className="btn-secondary btn-sm btn-logout"
          onClick={handleLogout}
          title="Sign out of your account"
        >
          Sign Out
        </button>
      </div>
    </header>
  );
});

Header.displayName = 'Header';

