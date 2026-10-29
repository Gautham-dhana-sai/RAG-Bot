import React, { memo, useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

interface AuthViewProps {
  initialMode?: 'login' | 'signup';
}

export const AuthView: React.FC<AuthViewProps> = memo(({ initialMode = 'login' }) => {
  const navigate = useNavigate();
  const { login, register, authError, isAuthLoading, setAuthError } = useAuth();
  const [authMode, setAuthMode] = useState<'login' | 'signup'>(initialMode);
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => {
    setAuthMode(initialMode);
  }, [initialMode]);

  const handleModeChange = useCallback((mode: 'login' | 'signup') => {
    setAuthMode(mode);
    setAuthError(null);
    navigate(mode === 'login' ? '/login' : '/register');
  }, [setAuthError, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      if (authMode === 'signup') {
        await register(email.trim(), password, username.trim() || undefined);
      } else {
        await login(identifier.trim(), password);
      }
      navigate('/portals');
    } catch {
      // error handled in context
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="brand-logo-icon">🤖</div>
          <h1>RAG-BOT</h1>
          <p className="auth-subtitle">Enterprise Multi-Tenant Knowledge Ingestion & Retrieval</p>
        </div>

        <div className="auth-tabs">
          <button
            type="button"
            className={`auth-tab ${authMode === 'login' ? 'active' : ''}`}
            onClick={() => handleModeChange('login')}
          >
            Sign In
          </button>
          <button
            type="button"
            className={`auth-tab ${authMode === 'signup' ? 'active' : ''}`}
            onClick={() => handleModeChange('signup')}
          >
            Create Workspace
          </button>
        </div>

        {authError && (
          <div className="alert-box alert-error">
            {authError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form">
          {authMode === 'signup' ? (
            <>
              <div className="form-group">
                <label htmlFor="auth-email">Work Email</label>
                <input
                  id="auth-email"
                  type="email"
                  placeholder="alex@acme.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label htmlFor="auth-username">User / Display Name (Optional)</label>
                <input
                  id="auth-username"
                  type="text"
                  placeholder="Alex Rivera"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label htmlFor="auth-password">Password</label>
                <input
                  id="auth-password"
                  type="password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </div>
            </>
          ) : (
            <>
              <div className="form-group">
                <label htmlFor="auth-identifier">Email or Username</label>
                <input
                  id="auth-identifier"
                  type="text"
                  placeholder="alex@acme.com or alexchen"
                  value={identifier}
                  onChange={e => setIdentifier(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div className="form-group">
                <label htmlFor="auth-login-password">Password</label>
                <input
                  id="auth-login-password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                />
              </div>
            </>
          )}

          <button
            type="submit"
            className="btn-primary btn-block auth-submit-btn"
            disabled={isAuthLoading}
          >
            {isAuthLoading ? 'Authenticating...' : authMode === 'signup' ? 'Create New Workspace' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
});

AuthView.displayName = 'AuthView';

