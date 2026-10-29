import { useState, useEffect, useRef, useCallback } from 'react';
import { FileItem, IngestionJob, IngestionJobDocument, Portal, DocumentInfo } from './types';
import { IngestionApiClient } from './api';
import { FileDropZone } from './components/FileDropZone';
import { JobStatusCard } from './components/JobStatusCard';
import { DocumentList } from './components/DocumentList';
import './App.css';

export interface QAHistoryItem {
  id: string;
  portalId: string;
  portfolioId?: string; // backwards compatibility
  question: string;
  answer: string;
  citations: any[];
  timestamp: string;
  isError?: boolean;
}

/**
 * Strips raw internal document chunk tags like [DOC-uuid], comma-separated [DOC-a, DOC-b],
 * or truncated dangling tags like [DOC-uuid from the answer prose so users only read clean, natural text.
 */
export function cleanDocCitationTags(text: string): string {
  if (!text) return '';
  return text
    // 1. Remove bracketed or parenthesized groups containing DOC- or CHUNK
    .replace(/\[[^\]]*\bDOC-[^\]]*\]/gi, '')
    .replace(/\([^)]*\bDOC-[^)]*\)/gi, '')
    .replace(/\[[^\]]*\bCHUNK\b[^\]]*\]/gi, '')
    // 2. Remove unclosed / truncated citations at the end of text (e.g. '[DOC-123, DOC-456' cut off by token limit)
    .replace(/\[\s*DOC-[^\]]*$/gi, '')
    .replace(/\(\s*DOC-[^)]*$/gi, '')
    .replace(/\[\s*CHUNK[^\]]*$/gi, '')
    // 3. Remove any lingering bare DOC-uuid or CHUNK-uuid tags
    .replace(/\bDOC-[a-zA-Z0-9_-]+/gi, '')
    .replace(/\bCHUNK-[a-zA-Z0-9_-]+/gi, '')
    // 4. Remove empty or trailing brackets
    .replace(/\[\s*\]/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*$/g, '')
    .replace(/\(\s*$/g, '')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export function capitalizeName(str: string): string {
  if (!str) return 'User';
  return str
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Cleanly truncate long filenames and query parameters, preserving extension.
 */
export function formatDisplayName(filename: string, maxLen = 28): string {
  if (!filename) return 'Document';
  // Strip URL query parameters or hashes
  let clean = filename.split('?')[0].split('#')[0];
  // Strip path segments
  clean = clean.split('/').pop()?.split('\\').pop() || clean;
  if (clean.length <= maxLen) return clean;

  const extIndex = clean.lastIndexOf('.');
  if (extIndex > 0 && extIndex > clean.length - 8) {
    const ext = clean.substring(extIndex);
    const base = clean.substring(0, extIndex);
    const keepStart = maxLen - ext.length - 4;
    return `${base.substring(0, Math.max(keepStart, 6))}...${base.substring(base.length - 4)}${ext}`;
  }
  return `${clean.substring(0, maxLen - 3)}...`;
}

/**
 * Format file size with support for pending/processing download states.
 */
export function formatFileSize(bytes?: number | null, status?: string): string {
  const num = Number(bytes);
  if (!bytes || isNaN(num) || num <= 0) {
    if (status === 'DOWNLOADING' || status === 'PENDING' || status === 'PROCESSING') {
      return 'Processing...';
    }
    return '0 KB';
  }
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

export function App() {
  // Configuration
  const [apiUrl, setApiUrl] = useState(() => import.meta.env.VITE_API_URL || 'http://localhost:3000');
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('ragbot_token') || '');
  const [userEmail, setUserEmail] = useState(() => localStorage.getItem('ragbot_email') || '');
  const [userName, setUserName] = useState(() => localStorage.getItem('ragbot_username') || '');
  const [workspaceName, setWorkspaceName] = useState(() => localStorage.getItem('ragbot_workspace') || '');

  // Auth UI state
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authIdentifier, setAuthIdentifier] = useState('');
  const [authUsername, setAuthUsername] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Portal Dashboard state
  const [portals, setPortals] = useState<Portal[]>([]);
  const [isLoadingPortals, setIsLoadingPortals] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [selectedPortal, setSelectedPortal] = useState<Portal | null>(null);

  // Add Portal Form state
  const [newPortalUrl, setNewPortalUrl] = useState('');
  const [newPortalName, setNewPortalName] = useState('');
  const [isAddingPortal, setIsAddingPortal] = useState(false);
  const [addPortalError, setAddPortalError] = useState<string | null>(null);

  // Portal Ingestion & Documents state
  const [ingestionMode, setIngestionMode] = useState<'files' | 'urls'>('files');
  const [urlInputs, setUrlInputs] = useState<string[]>(['']);
  const [isSubmittingUrls, setIsSubmittingUrls] = useState(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
  const [isSubmittingFiles, setIsSubmittingFiles] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [currentJob, setCurrentJob] = useState<IngestionJob | null>(null);
  const [jobDocuments, setJobDocuments] = useState<IngestionJobDocument[]>([]);
  const [isPollingJob, setIsPollingJob] = useState(false);
  const [portalDocuments, setPortalDocuments] = useState<DocumentInfo[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);

  // Quick verification Q&A state (isolated per login session)
  const [queryText, setQueryText] = useState('What is this portal about and what are its key benefits?');
  const [isQuerying, setIsQuerying] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const [qaHistory, setQaHistory] = useState<QAHistoryItem[]>(() => {
    try {
      // Clean up any legacy cross-session localStorage history
      localStorage.removeItem('ragbot_qa_history');
      const saved = sessionStorage.getItem('ragbot_qa_session_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  // Persist Q&A verification history in sessionStorage (isolated per tab/session)
  useEffect(() => {
    try {
      sessionStorage.setItem('ragbot_qa_session_history', JSON.stringify(qaHistory));
    } catch {
      // ignore
    }
  }, [qaHistory]);

  // Delete Portal state
  const [portalToDelete, setPortalToDelete] = useState<Portal | null>(null);
  const [isDeletingPortal, setIsDeletingPortal] = useState(false);
  const [deleteSuccessMessage, setDeleteSuccessMessage] = useState<string | null>(null);

  // Advanced settings toggle
  const [showSettings, setShowSettings] = useState(false);

  const pollingTimerRef = useRef<any>(null);
  const prevJobSnapshotRef = useRef<string>('');

  const getClient = useCallback(() => {
    return new IngestionApiClient(apiUrl, authToken);
  }, [apiUrl, authToken]);

  // Save config changes
  useEffect(() => {
    localStorage.setItem('ragbot_api_url', apiUrl);
  }, [apiUrl]);

  useEffect(() => {
    if (authToken) {
      localStorage.setItem('ragbot_token', authToken);
    } else {
      localStorage.removeItem('ragbot_token');
    }
  }, [authToken]);

  useEffect(() => {
    if (userEmail) {
      localStorage.setItem('ragbot_email', userEmail);
    } else {
      localStorage.removeItem('ragbot_email');
    }
  }, [userEmail]);

  useEffect(() => {
    if (userName) {
      localStorage.setItem('ragbot_username', userName);
    } else {
      localStorage.removeItem('ragbot_username');
    }
  }, [userName]);

  useEffect(() => {
    if (workspaceName) {
      localStorage.setItem('ragbot_workspace', workspaceName);
    } else {
      localStorage.removeItem('ragbot_workspace');
    }
  }, [workspaceName]);

  // Centralized logout handler that clears state and local storage immediately
  const handleLogout = useCallback(async () => {
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
    setPortals([]);
    setSelectedPortal(null);
    setCurrentJob(null);
    setSelectedFiles([]);
    setQaHistory([]);
    try {
      sessionStorage.removeItem('ragbot_qa_session_history');
      localStorage.removeItem('ragbot_qa_history');
    } catch {
      // ignore
    }
    localStorage.removeItem('ragbot_token');
    localStorage.removeItem('ragbot_email');
    localStorage.removeItem('ragbot_username');
    localStorage.removeItem('ragbot_workspace');
  }, [getClient]);

  // Immediately log out when any API call returns 401 Session Expired
  useEffect(() => {
    const onSessionExpired = () => {
      handleLogout();
      setAuthError('Your session has expired. Please log in again.');
    };
    window.addEventListener('ragbot:session_expired', onSessionExpired);
    return () => window.removeEventListener('ragbot:session_expired', onSessionExpired);
  }, [handleLogout]);

  // Load portals when authenticated
  const loadPortals = useCallback(async () => {
    if (!authToken) return;
    setIsLoadingPortals(true);
    setPortalError(null);
    try {
      const client = getClient();
      const list = await client.listPortals();
      setPortals(list);
    } catch (err: any) {
      // If unauthorized, session may have expired
      if (err.message?.toLowerCase().includes('unauthorized') || err.message?.toLowerCase().includes('expired')) {
        handleLogout();
        setAuthError('Your session has expired. Please sign in again.');
      } else {
        setPortalError(err.message || 'Failed to fetch portals');
      }
    } finally {
      setIsLoadingPortals(false);
    }
  }, [authToken, getClient, handleLogout]);

  // Restore session on mount
  useEffect(() => {
    if (authToken) {
      const client = getClient();
      client
        .getMe()
        .then(res => {
          if (res.user?.username) {
            setUserName(res.user.username);
          }
          if (res.user?.email) {
            setUserEmail(res.user.email);
          }
          if (res.tenant?.name) {
            setWorkspaceName(res.tenant.name);
          }
          loadPortals();
        })
        .catch(() => {
          handleLogout();
          setAuthError('Session expired. Please log in again.');
        });
    }
  }, []);

  // Refresh document list when portal is selected
  const loadPortalDocuments = useCallback(
    async (portalRef: string) => {
      setIsLoadingDocuments(true);
      try {
        const client = getClient();
        const docs = await client.getPortalDocuments(portalRef);
        setPortalDocuments(docs);
      } catch {
        // Ignore fallback
      } finally {
        setIsLoadingDocuments(false);
      }
    },
    [getClient]
  );

  useEffect(() => {
    if (selectedPortal?.id) {
      loadPortalDocuments(selectedPortal.id);
    }
  }, [selectedPortal?.id, loadPortalDocuments]);

  // Handle Auth submission (login or signup)
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsAuthLoading(true);

    try {
      const client = getClient();
      let res;
      if (authMode === 'signup') {
        res = await client.register({
          username: authUsername.trim() || undefined,
          email: authEmail.trim(),
          password: authPassword,
        });
      } else {
        res = await client.login({
          identifier: authIdentifier.trim(),
          password: authPassword,
        });
      }

      setAuthToken(res.token);
      if (res.user?.username) {
        setUserName(res.user.username);
      }
      setUserEmail(res.user?.email || authEmail || authIdentifier);
      setWorkspaceName(res.tenant?.name || 'My Workspace');
      setAuthPassword('');
      setAuthError(null);

      // On every login, start with clean Q&A history isolated to this session
      setQaHistory([]);
      try {
        sessionStorage.removeItem('ragbot_qa_session_history');
        localStorage.removeItem('ragbot_qa_history');
      } catch {
        // ignore
      }

      // Load initial portals
      if (Array.isArray(res.entities)) {
        setPortals(
          res.entities.map((e: any) => ({
            id: e.id,
            name: e.name,
            slug: e.slug,
            portalUrl: e.portalUrl || e.portfolioUrl,
            portfolioUrl: e.portfolioUrl || e.portalUrl,
            isPublic: e.isPublic,
            documentCount: 0,
            createdAt: e.createdAt,
            updatedAt: e.updatedAt,
          }))
        );
      } else {
        setTimeout(loadPortals, 300);
      }
    } catch (err: any) {
      setAuthError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setIsAuthLoading(false);
    }
  };

  // Add Portal by URL
  const handleAddPortal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPortalUrl.trim()) return;

    setIsAddingPortal(true);
    setAddPortalError(null);

    try {
      const client = getClient();
      const created = await client.createPortal(newPortalUrl.trim(), newPortalName.trim() || undefined);
      setNewPortalUrl('');
      setNewPortalName('');

      // Update list or select created
      await loadPortals();
      setSelectedPortal(created);
    } catch (err: any) {
      setAddPortalError(err.message || 'Failed to create portal. Please check the URL.');
    } finally {
      setIsAddingPortal(false);
    }
  };

  // Delete Portal handler
  const handleConfirmDeletePortal = async () => {
    if (!portalToDelete) return;
    setIsDeletingPortal(true);
    setPortalError(null);
    try {
      const client = getClient();
      const res = await client.deletePortal(portalToDelete.id);
      setDeleteSuccessMessage(
        res.message || `Portal "${portalToDelete.name}" and associated documents were deleted.`
      );

      if (selectedPortal?.id === portalToDelete.id) {
        setSelectedPortal(null);
        setCurrentJob(null);
        setJobDocuments([]);
        setSelectedFiles([]);
      }

      setPortalToDelete(null);
      await loadPortals();
      setTimeout(() => setDeleteSuccessMessage(null), 5000);
    } catch (err: any) {
      setPortalError(err.message || 'Failed to delete portal and documents.');
    } finally {
      setIsDeletingPortal(false);
    }
  };

  // Ingestion job polling
  const startJobPolling = useCallback(
    (portalRef: string, jobId: string) => {
      setIsPollingJob(true);
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
      prevJobSnapshotRef.current = '';

      const poll = async () => {
        try {
          const client = getClient();
          const job = await client.getPortalJobStatus(portalRef, jobId);
          setCurrentJob(job);

          if (job.documents) {
            setJobDocuments(job.documents);
          }

          // Build a fingerprint of overall status and document stages
          const docFingerprint = (job.documents || []).map(d => `${d.id}:${d.stage || ''}:${d.status}`).join(';');
          const currentSnapshot = `${job.status}|${job.processedDocuments}|${job.failedDocuments}|${docFingerprint}`;

          // Only fetch portal documents if there is a real status or stage change
          if (prevJobSnapshotRef.current && prevJobSnapshotRef.current !== currentSnapshot) {
            loadPortalDocuments(portalRef);
          }
          prevJobSnapshotRef.current = currentSnapshot;

          if (job.status === 'READY' || job.status === 'FAILED') {
            setIsPollingJob(false);
            if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
            // Refresh documents and portal counts upon completion
            loadPortalDocuments(portalRef);
            loadPortals();
          }
        } catch {
          setIsPollingJob(false);
          if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
        }
      };

      poll();
      pollingTimerRef.current = setInterval(poll, 2000);
    },
    [getClient, loadPortalDocuments, loadPortals]
  );

  useEffect(() => {
    return () => {
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    };
  }, []);

  // Submit files to selected portal
  const handleSubmitFiles = async () => {
    if (!selectedPortal || selectedFiles.length === 0) return;

    setIsSubmittingFiles(true);
    setUploadError(null);

    try {
      const client = getClient();
      const rawFiles = selectedFiles.map(f => f.file);
      const res = await client.submitPortalFiles(selectedPortal.id, rawFiles);

      const jobId = res.jobId || res.id;
      if (jobId) {
        startJobPolling(selectedPortal.id, jobId);
      }
      setSelectedFiles([]);
      loadPortalDocuments(selectedPortal.id);
    } catch (err: any) {
      setUploadError(err.message || 'File upload failed. Please try again.');
    } finally {
      setIsSubmittingFiles(false);
    }
  };

  const handleAddUrlRow = () => {
    setUrlInputs(prev => [...prev, '']);
  };

  const handleRemoveUrlRow = (idx: number) => {
    setUrlInputs(prev => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : ['']));
  };

  const handleUrlChange = (idx: number, val: string) => {
    setUrlInputs(prev => {
      const copy = [...prev];
      copy[idx] = val;
      return copy;
    });
  };

  const handleSubmitUrls = async () => {
    if (!selectedPortal) return;
    const cleanUrls = urlInputs.map(u => u.trim()).filter(Boolean);
    if (cleanUrls.length === 0) {
      setUrlError('Please enter at least one valid HTTP or HTTPS document/photo URL.');
      return;
    }

    setIsSubmittingUrls(true);
    setUrlError(null);

    try {
      const client = getClient();
      const res = await client.submitPortalUrls(selectedPortal.id, cleanUrls);
      const jobId = res.jobId || res.id;
      if (jobId) {
        startJobPolling(selectedPortal.id, jobId);
      }
      setUrlInputs(['']);
      loadPortalDocuments(selectedPortal.id);
    } catch (err: any) {
      setUrlError(err.message || 'Failed to submit URLs. Please try again.');
    } finally {
      setIsSubmittingUrls(false);
    }
  };

  const handleRetryUrl = async (failedUrl: string) => {
    if (!selectedPortal) return;
    try {
      const client = getClient();
      const res = await client.submitPortalUrls(selectedPortal.id, [failedUrl]);
      const jobId = res.jobId || res.id;
      if (jobId) {
        startJobPolling(selectedPortal.id, jobId);
      }
    } catch (err: any) {
      setUrlError(`Retry failed: ${err.message}`);
    }
  };

  // Quick Verification Question
  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    const questionToAsk = queryText.trim();
    if (!selectedPortal || !questionToAsk || isQuerying) return;

    setIsQuerying(true);
    setPendingQuestion(questionToAsk);
    setQueryText('');

    const itemTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const itemId = `qa-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    try {
      const client = getClient();
      const res = await client.askQuestion(
        selectedPortal.tenantId || '',
        selectedPortal.id,
        questionToAsk
      );

      const newItem: QAHistoryItem = {
        id: itemId,
        portalId: selectedPortal.id,
        portfolioId: selectedPortal.id,
        question: questionToAsk,
        answer: cleanDocCitationTags(res.answer),
        citations: res.citations || [],
        timestamp: itemTimestamp,
        isError: false,
      };

      // Add to front so order is descending (newest on top)
      setQaHistory(prev => [newItem, ...prev]);
    } catch (err: any) {
      const errorItem: QAHistoryItem = {
        id: itemId,
        portalId: selectedPortal.id,
        portfolioId: selectedPortal.id,
        question: questionToAsk,
        answer: `Query error: ${err.message || 'Failed to generate answer'}`,
        citations: [],
        timestamp: itemTimestamp,
        isError: true,
      };
      // Add to front so order is descending (newest on top)
      setQaHistory(prev => [errorItem, ...prev]);
    } finally {
      setIsQuerying(false);
      setPendingQuestion(null);
    }
  };

  const handleClearHistory = () => {
    if (!selectedPortal) return;
    setQaHistory(prev => prev.filter(item => item.portalId !== selectedPortal.id && item.portfolioId !== selectedPortal.id));
  };

  const handlePickPrompt = (prompt: string) => {
    setQueryText(prompt);
  };

  // -------------------------------------------------------------
  // RENDER: Unauthenticated State (Sign In / Sign Up)
  // -------------------------------------------------------------
  if (!authToken) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <span className="brand-badge">PersonaRAG</span>
            <h2>RAG Portal Studio</h2>
            <p className="auth-subtitle">
              Connect any portal, product documentation, website, or knowledge base — index documents to empower high-accuracy grounded conversational AI.
            </p>
          </div>

          <div className="auth-tabs">
            <button
              type="button"
              className={`auth-tab ${authMode === 'login' ? 'active' : ''}`}
              onClick={() => {
                setAuthMode('login');
                setAuthError(null);
              }}
            >
              Sign In
            </button>
            <button
              type="button"
              className={`auth-tab ${authMode === 'signup' ? 'active' : ''}`}
              onClick={() => {
                setAuthMode('signup');
                setAuthError(null);
              }}
            >
              Create Account
            </button>
          </div>

          {authError && (
            <div className="alert alert-error" role="alert">
              ✕ {authError}
            </div>
          )}

          <form onSubmit={handleAuthSubmit} className="auth-form">
            {authMode === 'login' ? (
              <div className="form-group">
                <label htmlFor="auth-identifier">Username or Email</label>
                <input
                  id="auth-identifier"
                  type="text"
                  required
                  placeholder="username or you@example.com"
                  value={authIdentifier}
                  onChange={e => setAuthIdentifier(e.target.value)}
                  disabled={isAuthLoading}
                  autoFocus
                />
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label htmlFor="auth-username">Username</label>
                  <input
                    id="auth-username"
                    type="text"
                    required
                    placeholder="e.g. johndoe"
                    value={authUsername}
                    onChange={e => setAuthUsername(e.target.value)}
                    disabled={isAuthLoading}
                    minLength={2}
                    autoFocus
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="auth-email">Email Address</label>
                  <input
                    id="auth-email"
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={authEmail}
                    onChange={e => setAuthEmail(e.target.value)}
                    disabled={isAuthLoading}
                  />
                </div>
              </>
            )}

            <div className="form-group">
              <label htmlFor="auth-password">Password</label>
              <div className="password-input-wrapper">
                <input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  placeholder={authMode === 'signup' ? 'At least 6 characters' : 'Enter your password'}
                  value={authPassword}
                  onChange={e => setAuthPassword(e.target.value)}
                  disabled={isAuthLoading}
                  minLength={6}
                />
                <button
                  type="button"
                  className="btn-toggle-password"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <button type="submit" className="btn-primary btn-block" disabled={isAuthLoading}>
              {isAuthLoading
                ? authMode === 'signup'
                  ? 'Creating Account...'
                  : 'Signing In...'
                : authMode === 'signup'
                ? 'Create Account & Continue'
                : 'Sign In'}
            </button>
          </form>

          <div className="auth-footer">
            <button
              type="button"
              className="btn-link"
              onClick={() => setShowSettings(!showSettings)}
            >
              ⚙ {showSettings ? 'Hide' : 'API Connection Settings'}
            </button>

            {showSettings && (
              <div className="api-settings-box">
                <label>Backend API Base URL</label>
                <input
                  type="text"
                  value={apiUrl}
                  onChange={e => setApiUrl(e.target.value)}
                  placeholder="http://localhost:3000"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // RENDER: Authenticated State
  // -------------------------------------------------------------
  return (
    <div className="portal-layout">
      {/* Top Navigation */}
      <header className="portal-navbar">
        <div className="nav-brand">
          <span className="brand-logo">🤖</span>
          <span className="brand-title">PersonaRAG Portals</span>
        </div>

        <div className="nav-user">
          <button type="button" className="btn-secondary btn-sm" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      <main className="portal-main">
        {/* ======================================================== */}
        {/* VIEW A: Portals Dashboard (when no portal is active)     */}
        {/* ======================================================== */}
        {!selectedPortal ? (
          <div className="dashboard-container">
            <div className="dashboard-header">
              <div>
                <h2>Welcome, {capitalizeName(userName || userEmail.split('@')[0])}</h2>
                <p className="subtitle">
                  Manage your portals & knowledge bases, or register a new portal or website by URL.
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={loadPortals}
                disabled={isLoadingPortals}
              >
                ↻ Refresh Portals
              </button>
            </div>

            {deleteSuccessMessage && (
              <div className="alert alert-success">
                ✓ {deleteSuccessMessage}
              </div>
            )}

            {portalError && (
              <div className="alert alert-error">
                ✕ {portalError}
              </div>
            )}

            {/* Register New Portal by URL */}
            <div className="card add-portal-card add-portfolio-card">
              <h3>+ Register New Portal / Website</h3>
              <p className="form-hint">
                Enter any website, documentation hub, product portal, or web link (e.g., <code>https://docs.mycompany.com</code> or <code>https://myportal.io</code>).
              </p>

              {addPortalError && (
                <div className="alert alert-error">
                  ✕ {addPortalError}
                </div>
              )}

              <form onSubmit={handleAddPortal} className="add-portal-form add-portfolio-form">
                <div className="form-row">
                  <div className="form-group flex-2">
                    <label>Portal URL / Website *</label>
                    <input
                      type="text"
                      required
                      placeholder="https://docs.mycompany.com"
                      value={newPortalUrl}
                      onChange={e => setNewPortalUrl(e.target.value)}
                      disabled={isAddingPortal}
                    />
                  </div>
                  <div className="form-group flex-1">
                    <label>Portal Name (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g., Acme Cloud Platform Docs"
                      value={newPortalName}
                      onChange={e => setNewPortalName(e.target.value)}
                      disabled={isAddingPortal}
                    />
                  </div>
                  <div className="form-group btn-align">
                    <button type="submit" className="btn-primary" disabled={isAddingPortal || !newPortalUrl.trim()}>
                      {isAddingPortal ? 'Registering...' : 'Register Portal'}
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {/* Portals Grid */}
            <div className="portals-section portfolios-section">
              <h3>Registered Portals ({portals.length})</h3>

              {isLoadingPortals ? (
                <div className="loading-state">Loading your portals...</div>
              ) : portals.length === 0 ? (
                <div className="empty-state">
                  <p>No portals found. Register a portal URL above to get started.</p>
                </div>
              ) : (
                <div className="portals-grid portfolios-grid">
                  {portals.map(p => {
                    const displayUrl = p.portalUrl || p.portfolioUrl;
                    return (
                      <div key={p.id} className="portal-card portfolio-card">
                        <div className="portal-card-header portfolio-card-header">
                          <h4>{p.name}</h4>
                          <span className="doc-count-badge">
                            📄 {p.documentCount} {p.documentCount === 1 ? 'doc' : 'docs'}
                          </span>
                        </div>

                        {displayUrl ? (
                          <div className="portal-url-link portfolio-url-link">
                            <a href={displayUrl} target="_blank" rel="noopener noreferrer">
                              🔗 {displayUrl}
                            </a>
                          </div>
                        ) : (
                          <div className="portal-url-empty portfolio-url-empty">Default Portal</div>
                        )}

                        <div className="portal-card-footer portfolio-card-footer">
                          <span className="portal-date portfolio-date">
                            Created {new Date(p.createdAt).toLocaleDateString()}
                          </span>
                          <div className="portal-card-actions portfolio-card-actions">
                            <button
                              type="button"
                              className="btn-card-delete-icon"
                              title="Delete portal"
                              aria-label="Delete portal"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPortalToDelete(p);
                              }}
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                width="18"
                                height="18"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                <line x1="10" y1="11" x2="10" y2="17" />
                                <line x1="14" y1="11" x2="14" y2="17" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="btn-primary btn-sm"
                              onClick={() => {
                                setSelectedPortal(p);
                                loadPortalDocuments(p.id);
                              }}
                            >
                              Open Workspace →
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ======================================================== */
          /* VIEW B: Portal Ingestion Workspace (when selected)      */
          /* ======================================================== */
          <div className="workspace-container">
            <div className="workspace-header">
              <div className="workspace-header-left">
                <button
                  type="button"
                  className="btn-link btn-back"
                  onClick={() => {
                    setSelectedPortal(null);
                    setCurrentJob(null);
                    setJobDocuments([]);
                    setSelectedFiles([]);
                    loadPortals();
                  }}
                >
                  ← Back to Portals
                </button>
              </div>

              <div className="workspace-header-center">
                <div className="portal-title-group portfolio-title-group">
                  <h2>{selectedPortal.name}</h2>
                  {(selectedPortal.portalUrl || selectedPortal.portfolioUrl) && (
                    <a
                      href={selectedPortal.portalUrl || selectedPortal.portfolioUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="portal-external-link portfolio-external-link"
                    >
                      🔗 {selectedPortal.portalUrl || selectedPortal.portfolioUrl} ↗
                    </a>
                  )}
                </div>
              </div>

              <div className="workspace-header-actions">
                <button
                  type="button"
                  className="btn-danger-outline btn-sm"
                  title="Delete this portal and all associated documents"
                  onClick={() => setPortalToDelete(selectedPortal)}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    width="14"
                    height="14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{ marginRight: '0.4rem', verticalAlign: 'text-bottom' }}
                  >
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    <line x1="10" y1="11" x2="10" y2="17" />
                    <line x1="14" y1="11" x2="14" y2="17" />
                  </svg>
                  Delete Portal
                </button>
              </div>
            </div>

            <div className="workspace-columns">
              {/* Left Column: Upload & Live Ingestion */}
              <div className="workspace-col-main">
                <div className="card">
                  <div className="ingestion-tabs-header">
                    <button
                      type="button"
                      className={`tab-btn ${ingestionMode === 'files' ? 'active' : ''}`}
                      onClick={() => setIngestionMode('files')}
                    >
                      📁 Direct File Upload
                    </button>
                    <button
                      type="button"
                      className={`tab-btn ${ingestionMode === 'urls' ? 'active' : ''}`}
                      onClick={() => setIngestionMode('urls')}
                    >
                      🔗 Import from URLs & Photos
                    </button>
                  </div>

                  {ingestionMode === 'files' ? (
                    <>
                      <p className="form-hint">
                        Upload technical specifications, documentation, whitepapers, manuals, or project files. Extracted text will be automatically indexed into pgvector for high-accuracy grounded retrieval.
                      </p>

                      <FileDropZone
                        files={selectedFiles}
                        onFilesSelected={setSelectedFiles}
                        disabled={isSubmittingFiles}
                      />

                      {uploadError && (
                        <div className="alert alert-error">
                          ✕ {uploadError}
                        </div>
                      )}

                      <div className="submit-action-bar">
                        <button
                          type="button"
                          className="btn-primary btn-lg"
                          onClick={handleSubmitFiles}
                          disabled={selectedFiles.length === 0 || isSubmittingFiles}
                        >
                          {isSubmittingFiles ? 'Submitting Files...' : `Ingest ${selectedFiles.length} Document(s)`}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="url-import-container">
                      <p className="form-hint">
                        Enter public URLs to PDF documents, Word documents, or photos (PNG, JPEG, WebP). URLs are securely validated against SSRF and queued for download via a dedicated worker before converging into the RAG pipeline.
                      </p>

                      <div className="url-inputs-list">
                        {urlInputs.map((url, idx) => (
                          <div key={idx} className="url-input-row">
                            <input
                              type="url"
                              className="qa-input"
                              placeholder="https://example.com/document.pdf or photo.png"
                              value={url}
                              onChange={e => handleUrlChange(idx, e.target.value)}
                              disabled={isSubmittingUrls}
                            />
                            {urlInputs.length > 1 && (
                              <button
                                type="button"
                                className="btn-card-delete-icon"
                                title="Remove URL"
                                onClick={() => handleRemoveUrlRow(idx)}
                                disabled={isSubmittingUrls}
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="url-actions-row">
                        <button
                          type="button"
                          className="btn-secondary btn-sm"
                          onClick={handleAddUrlRow}
                          disabled={isSubmittingUrls || urlInputs.length >= 20}
                        >
                          + Add Another URL
                        </button>
                      </div>

                      {urlError && (
                        <div className="alert alert-error" style={{ marginTop: '1rem' }}>
                          ✕ {urlError}
                        </div>
                      )}

                      <div className="submit-action-bar">
                        <button
                          type="button"
                          className="btn-primary btn-lg"
                          onClick={handleSubmitUrls}
                          disabled={isSubmittingUrls || urlInputs.every(u => !u.trim())}
                        >
                          {isSubmittingUrls ? 'Submitting URLs...' : `Import & Ingest ${urlInputs.filter(u => u.trim()).length || ''} URL(s)`}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Job Tracking Card */}
                {currentJob && (
                  <JobStatusCard
                    job={currentJob}
                    statusUrl={`/v1/portals/${selectedPortal.id}/ingestion-jobs/${currentJob.id}`}
                    isPolling={isPollingJob}
                    onRefresh={() => startJobPolling(selectedPortal.id, currentJob.id)}
                  />
                )}

                {/* Ingestion Job Document Breakdown */}
                {jobDocuments.length > 0 && (
                  <DocumentList
                    documents={jobDocuments}
                    onRetryUrl={handleRetryUrl}
                  />
                )}

                {/* Quick Verification Q&A widget */}
                <div className="card qa-verification-card">
                  <div className="qa-card-header">
                    <div>
                      <h3>Verify Portal Retrieval</h3>
                      <p className="form-hint">
                        Ask questions against indexed documents to verify semantic retrieval and grounded answer synthesis.
                      </p>
                    </div>
                    {qaHistory.filter(item => (item.portalId || item.portfolioId) === selectedPortal.id).length > 0 && (
                      <button
                        type="button"
                        className="btn-text btn-clear-history"
                        onClick={handleClearHistory}
                        title="Clear conversation history for this portal"
                      >
                        🗑️ Clear History ({qaHistory.filter(item => (item.portalId || item.portfolioId) === selectedPortal.id).length})
                      </button>
                    )}
                  </div>

                  <form onSubmit={handleAskQuestion} className="qa-form">
                    <input
                      type="text"
                      className="qa-input"
                      value={queryText}
                      onChange={e => setQueryText(e.target.value)}
                      placeholder="Ask a question about this portal (e.g. what is it about, key benefits, how to get started)..."
                      disabled={isQuerying}
                    />
                    <button
                      type="submit"
                      className="btn-primary qa-submit-btn"
                      disabled={isQuerying || !queryText.trim()}
                    >
                      {isQuerying ? 'Searching...' : 'Ask RAG Bot'}
                    </button>
                  </form>

                  {/* Quick suggestion prompt chips if no history yet */}
                  {qaHistory.filter(item => (item.portalId || item.portfolioId) === selectedPortal.id).length === 0 && !isQuerying && (
                    <div className="qa-prompt-suggestions">
                      <span className="suggestions-label">Try asking:</span>
                      <button
                        type="button"
                        className="prompt-chip"
                        onClick={() => handlePickPrompt('What is this portal or website about and what is its main purpose?')}
                      >
                        💡 What is this portal about?
                      </button>
                      <button
                        type="button"
                        className="prompt-chip"
                        onClick={() => handlePickPrompt('What are the main benefits, advantages, and key value provided by this portal?')}
                      >
                        ⭐ Key benefits & value
                      </button>
                      <button
                        type="button"
                        className="prompt-chip"
                        onClick={() => handlePickPrompt('What main services, products, or core topics are covered in this portal?')}
                      >
                        📌 Main services & topics
                      </button>
                      <button
                        type="button"
                        className="prompt-chip"
                        onClick={() => handlePickPrompt('How can users get started with this portal and what are the next steps?')}
                      >
                        🚀 How to get started
                      </button>
                    </div>
                  )}

                  {/* Conversational Q&A History Thread (Descending order: newest on top) */}
                  <div className="qa-history-feed">
                    {/* Pending Query State at Top */}
                    {isQuerying && pendingQuestion && (
                      <div className="qa-history-thread-item qa-thread-pending">
                        <div className="qa-bubble qa-question-bubble">
                          <div className="qa-bubble-header">
                            <span className="qa-bubble-role">
                              <span className="qa-role-icon">👤</span> Pending Question #{qaHistory.filter(item => (item.portalId || item.portfolioId) === selectedPortal.id).length + 1}
                            </span>
                            <span className="qa-timestamp">Evaluating...</span>
                          </div>
                          <div className="qa-bubble-body">
                            <p className="qa-question-text">{pendingQuestion}</p>
                          </div>
                        </div>
                        <div className="qa-bubble qa-solution-bubble qa-loading-bubble">
                          <div className="qa-bubble-header">
                            <span className="qa-bubble-role">
                              <span className="qa-role-icon">🤖</span> Generating Grounded Solution...
                            </span>
                          </div>
                          <div className="qa-bubble-body">
                            <div className="qa-loading-indicator">
                              <span className="qa-spinner-pulse"></span>
                              <span>Searching vector chunks with Gemini round-robin & synthesizing answer...</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {(() => {
                      const portalHistory = qaHistory.filter(item => (item.portalId || item.portfolioId) === selectedPortal.id);
                      const visibleHistory = showAllQuestions ? portalHistory : portalHistory.slice(0, 2);
                      const hiddenCount = portalHistory.length - 2;

                      return (
                        <>
                          {visibleHistory.map((item) => {
                            const absoluteIndex = portalHistory.findIndex(h => h.id === item.id);
                            const questionNum = portalHistory.length - (absoluteIndex >= 0 ? absoluteIndex : 0);
                            const isLatest = absoluteIndex === 0;

                            return (
                              <div key={item.id} className={`qa-history-thread-item ${item.isError ? 'qa-item-error' : ''}`}>
                                {/* Question */}
                                <div className="qa-bubble qa-question-bubble">
                                   <div className="qa-bubble-header">
                                    <span className="qa-bubble-role">
                                      <span className="qa-role-icon">👤</span> Question #{questionNum} {isLatest ? '(Latest)' : ''}
                                    </span>
                                    <span className="qa-timestamp">{item.timestamp}</span>
                                  </div>
                                  <div className="qa-bubble-body">
                                    <p className="qa-question-text">{item.question}</p>
                                  </div>
                                </div>

                                {/* Solution / Grounded Answer */}
                                <div className={`qa-bubble qa-solution-bubble ${item.isError ? 'qa-solution-error' : ''}`}>
                                  <div className="qa-bubble-header">
                                    <span className="qa-bubble-role">
                                      <span className="qa-role-icon">{item.isError ? '⚠️' : '🤖'}</span>
                                      {item.isError ? 'Retrieval Notice' : 'Solution / Grounded Answer'}
                                    </span>
                                  </div>
                                  <div className="qa-bubble-body qa-solution-body">
                                    {cleanDocCitationTags(item.answer).split('\n\n').map((paragraph, pIdx) => (
                                      <p key={pIdx}>{paragraph}</p>
                                    ))}

                                    {/* Grounded Citations */}
                                    {item.citations && item.citations.length > 0 && (
                                      <div className="qa-citations-box">
                                        <div className="qa-citations-title">
                                          📚 Grounded Sources ({item.citations.length}):
                                        </div>
                                        <div className="qa-citations-list">
                                          {item.citations.map((c, cIdx) => (
                                            <div key={cIdx} className="qa-citation-item">
                                              <span className="qa-citation-badge">Ref [{cIdx + 1}]</span>
                                              <div className="qa-citation-details">
                                                {c.quote && <div className="qa-citation-quote">"{c.quote}"</div>}
                                                {c.chunkId && (
                                                  <div className="qa-citation-meta">
                                                    <span>Chunk: <code>{c.chunkId.substring(0, 8)}...</code></span>
                                                    {c.documentTitle && <span> • Doc: {c.documentTitle}</span>}
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}

                          {/* Toggle to view/hide older questions beyond the latest 2 */}
                          {hiddenCount > 0 && (
                            <div className="qa-history-toggle-container">
                              <button
                                type="button"
                                className="btn-toggle-history"
                                onClick={() => setShowAllQuestions(prev => !prev)}
                              >
                                {showAllQuestions
                                  ? '▲ Hide earlier questions (show latest 2)'
                                  : `▼ View ${hiddenCount} older question${hiddenCount > 1 ? 's' : ''}`}
                              </button>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>

              {/* Right Column: Existing Documents */}
              <div className="workspace-col-side">
                <div className="card side-docs-card">
                  <div className="side-docs-header">
                    <h3>Portal Knowledge Base</h3>
                    <button
                      type="button"
                      className="btn-secondary btn-xs"
                      onClick={() => loadPortalDocuments(selectedPortal.id)}
                      disabled={isLoadingDocuments}
                    >
                      ↻
                    </button>
                  </div>
                  <p className="form-hint">
                    {portalDocuments.length} document(s) indexed for this portal.
                  </p>

                  {isLoadingDocuments ? (
                    <div className="loading-state">Loading indexed files...</div>
                  ) : portalDocuments.length === 0 ? (
                    <div className="empty-state-small">
                      No documents indexed yet. Upload files to start.
                    </div>
                  ) : (
                    <ul className="side-doc-list">
                      {portalDocuments.map(doc => (
                        <li key={doc.id} className="side-doc-item">
                          <div className="side-doc-info">
                            <span className="side-doc-name" title={doc.originalFilename}>
                              {formatDisplayName(doc.originalFilename, 26)}
                            </span>
                            <span className="side-doc-meta">
                              {formatFileSize(doc.sizeBytes, doc.status)} • {new Date(doc.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                          <span className={`status-pill status-${doc.status.toLowerCase()}`}>
                            {doc.status}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Delete Portal Confirmation Modal */}
        {portalToDelete && (
          <div className="modal-backdrop" onClick={() => !isDeletingPortal && setPortalToDelete(null)}>
            <div className="modal-dialog" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>⚠️ Delete Portal</h3>
                <button
                  type="button"
                  className="btn-close"
                  disabled={isDeletingPortal}
                  onClick={() => setPortalToDelete(null)}
                >
                  ✕
                </button>
              </div>
              <div className="modal-body">
                <p>
                  Are you sure you want to permanently delete <strong>{portalToDelete.name}</strong>?
                </p>
                {(portalToDelete.portalUrl || portalToDelete.portfolioUrl) && (
                  <p className="modal-hint">
                    Portal URL: <code>{portalToDelete.portalUrl || portalToDelete.portfolioUrl}</code>
                  </p>
                )}
                <div className="modal-alert-box">
                  <strong>This action is irreversible and will delete:</strong>
                  <ul>
                    <li>Portal profile and registered configuration</li>
                    <li>All indexed document chunks and vector embeddings</li>
                    <li>All uploaded files and associated documents</li>
                  </ul>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isDeletingPortal}
                  onClick={() => setPortalToDelete(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={isDeletingPortal}
                  onClick={handleConfirmDeletePortal}
                >
                  {isDeletingPortal ? 'Deleting Portal...' : 'Yes, Delete Portal'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
