import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { IngestionApiClient } from '../api';

interface AuthContextType {
  authToken: string;
  userEmail: string;
  userName: string;
  workspaceName: string;
  apiUrl: string;
  authError: string | null;
  isAuthLoading: boolean;
  setApiUrl: (url: string) => void;
  setAuthError: (err: string | null) => void;
  login: (identifier: string, password: string) => Promise<any>;
  register: (email: string, password: string, username?: string) => Promise<any>;
  logout: () => Promise<void>;
  getClient: () => IngestionApiClient;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [apiUrl, setApiUrlState] = useState<string>(() => {
    return localStorage.getItem('ragbot_api_url') || import.meta.env.VITE_API_URL || 'http://localhost:3000';
  });

  const [authToken, setAuthToken] = useState<string>(() => {
    return localStorage.getItem('ragbot_token') || '';
  });

  const [userEmail, setUserEmail] = useState<string>(() => {
    return localStorage.getItem('ragbot_email') || '';
  });

  const [userName, setUserName] = useState<string>(() => {
    return localStorage.getItem('ragbot_username') || '';
  });

  const [workspaceName, setWorkspaceName] = useState<string>(() => {
    return localStorage.getItem('ragbot_workspace') || 'My Workspace';
  });

  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  const setApiUrl = useCallback((url: string) => {
    setApiUrlState(url);
    localStorage.setItem('ragbot_api_url', url);
  }, []);

  const getClient = useCallback(() => {
    return new IngestionApiClient(apiUrl, authToken);
  }, [apiUrl, authToken]);

  const logout = useCallback(async () => {
    try {
      const client = getClient();
      await client.logout();
    } catch {
      // ignore
    }
    setAuthToken('');
    setUserEmail('');
    setUserName('');
    setWorkspaceName('');
    localStorage.removeItem('ragbot_token');
    localStorage.removeItem('ragbot_email');
    localStorage.removeItem('ragbot_username');
    localStorage.removeItem('ragbot_workspace');
    try {
      sessionStorage.removeItem('ragbot_qa_session_history');
      localStorage.removeItem('ragbot_qa_history');
    } catch {
      // ignore
    }
  }, [getClient]);

  // Session expired listener
  useEffect(() => {
    const onSessionExpired = () => {
      logout();
      setAuthError('Your session has expired. Please log in again.');
    };
    window.addEventListener('ragbot:session_expired', onSessionExpired);
    return () => window.removeEventListener('ragbot:session_expired', onSessionExpired);
  }, [logout]);

  // Restore user session details from backend on mount or reload
  useEffect(() => {
    if (authToken) {
      const client = getClient();
      client
        .getMe()
        .then(res => {
          if (res?.user?.username) {
            setUserName(res.user.username);
            localStorage.setItem('ragbot_username', res.user.username);
          }
          if (res?.user?.email) {
            setUserEmail(res.user.email);
            localStorage.setItem('ragbot_email', res.user.email);
          }
          if (res?.tenant?.name) {
            setWorkspaceName(res.tenant.name);
            localStorage.setItem('ragbot_workspace', res.tenant.name);
          }
        })
        .catch(() => {
          // Token is invalid or expired
          logout();
        });
    }
  }, [authToken, getClient, logout]);

  const login = useCallback(async (identifier: string, password: string) => {
    setIsAuthLoading(true);
    setAuthError(null);
    try {
      const client = new IngestionApiClient(apiUrl);
      const res = await client.login({ identifier, password });
      setAuthToken(res.token);
      localStorage.setItem('ragbot_token', res.token);

      const email = res.user?.email || identifier;
      setUserEmail(email);
      localStorage.setItem('ragbot_email', email);

      if (res.user?.username) {
        setUserName(res.user.username);
        localStorage.setItem('ragbot_username', res.user.username);
      }

      const ws = res.tenant?.name || 'My Workspace';
      setWorkspaceName(ws);
      localStorage.setItem('ragbot_workspace', ws);

      try {
        sessionStorage.removeItem('ragbot_qa_session_history');
        localStorage.removeItem('ragbot_qa_history');
      } catch {
        // ignore
      }
      return res;
    } catch (err: any) {
      setAuthError(err.message || 'Login failed. Please verify credentials.');
      throw err;
    } finally {
      setIsAuthLoading(false);
    }
  }, [apiUrl]);

  const register = useCallback(async (email: string, password: string, username?: string) => {
    setIsAuthLoading(true);
    setAuthError(null);
    try {
      const client = new IngestionApiClient(apiUrl);
      const res = await client.register({ email, password, username });
      setAuthToken(res.token);
      localStorage.setItem('ragbot_token', res.token);

      setUserEmail(res.user?.email || email);
      localStorage.setItem('ragbot_email', res.user?.email || email);

      if (res.user?.username || username) {
        setUserName(res.user?.username || username || '');
        localStorage.setItem('ragbot_username', res.user?.username || username || '');
      }

      const ws = res.tenant?.name || 'My Workspace';
      setWorkspaceName(ws);
      localStorage.setItem('ragbot_workspace', ws);

      try {
        sessionStorage.removeItem('ragbot_qa_session_history');
        localStorage.removeItem('ragbot_qa_history');
      } catch {
        // ignore
      }
      return res;
    } catch (err: any) {
      setAuthError(err.message || 'Registration failed.');
      throw err;
    } finally {
      setIsAuthLoading(false);
    }
  }, [apiUrl]);

  const value = useMemo(() => ({
    authToken,
    userEmail,
    userName,
    workspaceName,
    apiUrl,
    authError,
    isAuthLoading,
    setApiUrl,
    setAuthError,
    login,
    register,
    logout,
    getClient,
  }), [
    authToken,
    userEmail,
    userName,
    workspaceName,
    apiUrl,
    authError,
    isAuthLoading,
    setApiUrl,
    login,
    register,
    logout,
    getClient,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

