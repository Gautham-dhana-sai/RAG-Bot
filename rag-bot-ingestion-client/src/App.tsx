import { useState, useEffect, useRef, useCallback } from 'react';
import { FileItem, IngestionJob, IngestionJobDocument, Portfolio, DocumentInfo } from './types';
import { IngestionApiClient } from './api';
import { FileDropZone } from './components/FileDropZone';
import { JobStatusCard } from './components/JobStatusCard';
import { DocumentList } from './components/DocumentList';
import './App.css';

export interface QAHistoryItem {
  id: string;
  portfolioId: string;
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

export function App() {
  // Configuration
  const [apiUrl, setApiUrl] = useState(() => localStorage.getItem('ragbot_api_url') || 'http://localhost:3000');
  const [authToken, setAuthToken] = useState(() => localStorage.getItem('ragbot_token') || '');
  const [userEmail, setUserEmail] = useState(() => localStorage.getItem('ragbot_email') || '');
  const [workspaceName, setWorkspaceName] = useState(() => localStorage.getItem('ragbot_workspace') || '');

  // Auth UI state
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Portfolio Dashboard state
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [isLoadingPortfolios, setIsLoadingPortfolios] = useState(false);
  const [portfolioError, setPortfolioError] = useState<string | null>(null);
  const [selectedPortfolio, setSelectedPortfolio] = useState<Portfolio | null>(null);

  // Add Portfolio Form state
  const [newPortfolioUrl, setNewPortfolioUrl] = useState('');
  const [newPortfolioName, setNewPortfolioName] = useState('');
  const [isAddingPortfolio, setIsAddingPortfolio] = useState(false);
  const [addPortfolioError, setAddPortfolioError] = useState<string | null>(null);

  // Portfolio Ingestion & Documents state
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
  const [isSubmittingFiles, setIsSubmittingFiles] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [currentJob, setCurrentJob] = useState<IngestionJob | null>(null);
  const [jobDocuments, setJobDocuments] = useState<IngestionJobDocument[]>([]);
  const [isPollingJob, setIsPollingJob] = useState(false);
  const [portfolioDocuments, setPortfolioDocuments] = useState<DocumentInfo[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);

  // Quick verification Q&A state (isolated per login session)
  const [queryText, setQueryText] = useState('What are the key technical skills and achievements mentioned in this portfolio?');
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

  // Delete Portfolio state
  const [portfolioToDelete, setPortfolioToDelete] = useState<Portfolio | null>(null);
  const [isDeletingPortfolio, setIsDeletingPortfolio] = useState(false);
  const [deleteSuccessMessage, setDeleteSuccessMessage] = useState<string | null>(null);

  // Advanced settings toggle
  const [showSettings, setShowSettings] = useState(false);

  const pollingTimerRef = useRef<any>(null);

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
    setWorkspaceName('');
    setPortfolios([]);
    setSelectedPortfolio(null);
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

  // Load portfolios when authenticated
  const loadPortfolios = useCallback(async () => {
    if (!authToken) return;
    setIsLoadingPortfolios(true);
    setPortfolioError(null);
    try {
      const client = getClient();
      const list = await client.listPortfolios();
      setPortfolios(list);
    } catch (err: any) {
      // If unauthorized, session may have expired
      if (err.message?.toLowerCase().includes('unauthorized') || err.message?.toLowerCase().includes('expired')) {
        handleLogout();
        setAuthError('Your session has expired. Please sign in again.');
      } else {
        setPortfolioError(err.message || 'Failed to fetch portfolios');
      }
    } finally {
      setIsLoadingPortfolios(false);
    }
  }, [authToken, getClient, handleLogout]);

  // Restore session on mount
  useEffect(() => {
    if (authToken) {
      const client = getClient();
      client
        .getMe()
        .then(res => {
          if (res.user?.email) {
            setUserEmail(res.user.email);
          }
          if (res.tenant?.name) {
            setWorkspaceName(res.tenant.name);
          }
          loadPortfolios();
        })
        .catch(() => {
          handleLogout();
          setAuthError('Session expired. Please log in again.');
        });
    }
  }, []);

  // Refresh document list when portfolio is selected
  const loadPortfolioDocuments = useCallback(
    async (portfolioRef: string) => {
      setIsLoadingDocuments(true);
      try {
        const client = getClient();
        const docs = await client.getPortfolioDocuments(portfolioRef);
        setPortfolioDocuments(docs);
      } catch {
        // Ignore fallback
      } finally {
        setIsLoadingDocuments(false);
      }
    },
    [getClient]
  );

  useEffect(() => {
    if (selectedPortfolio) {
      loadPortfolioDocuments(selectedPortfolio.id);
    }
  }, [selectedPortfolio, loadPortfolioDocuments]);

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
          email: authEmail,
          password: authPassword,
        });
      } else {
        res = await client.login({
          email: authEmail,
          password: authPassword,
        });
      }

      setAuthToken(res.token);
      setUserEmail(res.user?.email || authEmail);
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

      // Load initial portfolios
      if (Array.isArray(res.entities)) {
        setPortfolios(
          res.entities.map((e: any) => ({
            id: e.id,
            name: e.name,
            slug: e.slug,
            portfolioUrl: e.portfolioUrl,
            isPublic: e.isPublic,
            documentCount: 0,
            createdAt: e.createdAt,
            updatedAt: e.updatedAt,
          }))
        );
      } else {
        setTimeout(loadPortfolios, 300);
      }
    } catch (err: any) {
      setAuthError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setIsAuthLoading(false);
    }
  };

  // Add Portfolio by URL
  const handleAddPortfolio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPortfolioUrl.trim()) return;

    setIsAddingPortfolio(true);
    setAddPortfolioError(null);

    try {
      const client = getClient();
      const created = await client.createPortfolio(newPortfolioUrl.trim(), newPortfolioName.trim() || undefined);
      setNewPortfolioUrl('');
      setNewPortfolioName('');

      // Update list or select created
      await loadPortfolios();
      setSelectedPortfolio(created);
    } catch (err: any) {
      setAddPortfolioError(err.message || 'Failed to create portfolio. Please check the URL.');
    } finally {
      setIsAddingPortfolio(false);
    }
  };

  // Delete Portfolio & S3 Files handler
  const handleConfirmDeletePortfolio = async () => {
    if (!portfolioToDelete) return;
    setIsDeletingPortfolio(true);
    setPortfolioError(null);
    try {
      const client = getClient();
      const res = await client.deletePortfolio(portfolioToDelete.id);
      setDeleteSuccessMessage(
        res.message || `Portfolio "${portfolioToDelete.name}" and associated S3 files were deleted.`
      );

      if (selectedPortfolio?.id === portfolioToDelete.id) {
        setSelectedPortfolio(null);
        setCurrentJob(null);
        setJobDocuments([]);
        setSelectedFiles([]);
      }

      setPortfolioToDelete(null);
      await loadPortfolios();
      setTimeout(() => setDeleteSuccessMessage(null), 5000);
    } catch (err: any) {
      setPortfolioError(err.message || 'Failed to delete portfolio and storage files.');
    } finally {
      setIsDeletingPortfolio(false);
    }
  };

  // Ingestion job polling
  const startJobPolling = useCallback(
    (portfolioRef: string, jobId: string) => {
      setIsPollingJob(true);
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);

      const poll = async () => {
        try {
          const client = getClient();
          const job = await client.getPortfolioJobStatus(portfolioRef, jobId);
          setCurrentJob(job);

          if (job.documents) {
            setJobDocuments(job.documents);
          }

          if (job.status === 'READY' || job.status === 'FAILED') {
            setIsPollingJob(false);
            if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
            // Refresh documents and portfolio counts
            loadPortfolioDocuments(portfolioRef);
            loadPortfolios();
          }
        } catch {
          setIsPollingJob(false);
          if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
        }
      };

      poll();
      pollingTimerRef.current = setInterval(poll, 1500);
    },
    [getClient, loadPortfolioDocuments, loadPortfolios]
  );

  useEffect(() => {
    return () => {
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    };
  }, []);

  // Submit files to selected portfolio
  const handleSubmitFiles = async () => {
    if (!selectedPortfolio || selectedFiles.length === 0) return;

    setIsSubmittingFiles(true);
    setUploadError(null);

    try {
      const client = getClient();
      const rawFiles = selectedFiles.map(f => f.file);
      const res = await client.submitPortfolioFiles(selectedPortfolio.id, rawFiles);

      const jobId = res.jobId || res.id;
      if (jobId) {
        startJobPolling(selectedPortfolio.id, jobId);
      }
      setSelectedFiles([]);
    } catch (err: any) {
      setUploadError(err.message || 'File upload failed. Please try again.');
    } finally {
      setIsSubmittingFiles(false);
    }
  };

  // Quick Verification Question
  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    const questionToAsk = queryText.trim();
    if (!selectedPortfolio || !questionToAsk || isQuerying) return;

    setIsQuerying(true);
    setPendingQuestion(questionToAsk);
    setQueryText('');

    const itemTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const itemId = `qa-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    try {
      const client = getClient();
      const res = await client.askQuestion(
        selectedPortfolio.tenantId || '',
        selectedPortfolio.id,
        questionToAsk
      );

      const newItem: QAHistoryItem = {
        id: itemId,
        portfolioId: selectedPortfolio.id,
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
        portfolioId: selectedPortfolio.id,
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
    if (!selectedPortfolio) return;
    setQaHistory(prev => prev.filter(item => item.portfolioId !== selectedPortfolio.id));
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
            <h2>Portfolio Ingestion Portal</h2>
            <p className="auth-subtitle">
              Upload and index your career documents for conversational retrieval.
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
                autoFocus
              />
            </div>

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
          <span className="brand-logo">📁</span>
          <span className="brand-title">PersonaRAG Ingestion</span>
          {workspaceName && <span className="workspace-pill">{workspaceName}</span>}
        </div>

        <div className="nav-user">
          <span className="user-email">{userEmail}</span>
          <button type="button" className="btn-secondary btn-sm" onClick={handleLogout}>
            Sign Out
          </button>
        </div>
      </header>

      <main className="portal-main">
        {/* ======================================================== */}
        {/* VIEW A: Portfolios Dashboard (when no portfolio is active) */}
        {/* ======================================================== */}
        {!selectedPortfolio ? (
          <div className="dashboard-container">
            <div className="dashboard-header">
              <div>
                <h2>Your Career Portfolios</h2>
                <p className="subtitle">
                  Select a portfolio to manage documents and ingest career knowledge, or register a new one by URL.
                </p>
              </div>
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={loadPortfolios}
                disabled={isLoadingPortfolios}
              >
                ↻ Refresh List
              </button>
            </div>

            {deleteSuccessMessage && (
              <div className="alert alert-success">
                ✓ {deleteSuccessMessage}
              </div>
            )}

            {portfolioError && (
              <div className="alert alert-error">
                ✕ {portfolioError}
              </div>
            )}

            {/* Register New Portfolio by URL */}
            <div className="card add-portfolio-card">
              <h3>+ Register New Portfolio by URL</h3>
              <p className="form-hint">
                Enter your public portfolio website or profile link (e.g., <code>https://portfolio.dev/alex</code>).
              </p>

              {addPortfolioError && (
                <div className="alert alert-error">
                  ✕ {addPortfolioError}
                </div>
              )}

              <form onSubmit={handleAddPortfolio} className="add-portfolio-form">
                <div className="form-row">
                  <div className="form-group flex-2">
                    <label>Portfolio URL *</label>
                    <input
                      type="text"
                      required
                      placeholder="https://myportfolio.io/alex"
                      value={newPortfolioUrl}
                      onChange={e => setNewPortfolioUrl(e.target.value)}
                      disabled={isAddingPortfolio}
                    />
                  </div>
                  <div className="form-group flex-1">
                    <label>Display Name (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g., Alex Chen - Principal Architect"
                      value={newPortfolioName}
                      onChange={e => setNewPortfolioName(e.target.value)}
                      disabled={isAddingPortfolio}
                    />
                  </div>
                  <div className="form-group btn-align">
                    <button type="submit" className="btn-primary" disabled={isAddingPortfolio || !newPortfolioUrl.trim()}>
                      {isAddingPortfolio ? 'Registering...' : 'Register Portfolio'}
                    </button>
                  </div>
                </div>
              </form>
            </div>

            {/* Portfolios Grid */}
            <div className="portfolios-section">
              <h3>Registered Portfolios ({portfolios.length})</h3>

              {isLoadingPortfolios ? (
                <div className="loading-state">Loading your portfolios...</div>
              ) : portfolios.length === 0 ? (
                <div className="empty-state">
                  <p>No portfolios found. Add your portfolio URL above to get started.</p>
                </div>
              ) : (
                <div className="portfolios-grid">
                  {portfolios.map(p => (
                    <div key={p.id} className="portfolio-card">
                      <div className="portfolio-card-header">
                        <h4>{p.name}</h4>
                        <span className="doc-count-badge">
                          📄 {p.documentCount} {p.documentCount === 1 ? 'doc' : 'docs'}
                        </span>
                      </div>

                      {p.portfolioUrl ? (
                        <div className="portfolio-url-link">
                          <a href={p.portfolioUrl} target="_blank" rel="noopener noreferrer">
                            🔗 {p.portfolioUrl}
                          </a>
                        </div>
                      ) : (
                        <div className="portfolio-url-empty">Default Portfolio</div>
                      )}

                      <div className="portfolio-card-footer">
                        <span className="portfolio-date">
                          Created {new Date(p.createdAt).toLocaleDateString()}
                        </span>
                        <div className="portfolio-card-actions">
                          <button
                            type="button"
                            className="btn-danger-outline btn-sm"
                            title="Delete portfolio, documents, and S3 folder"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPortfolioToDelete(p);
                            }}
                          >
                            🗑 Delete
                          </button>
                          <button
                            type="button"
                            className="btn-primary btn-sm"
                            onClick={() => setSelectedPortfolio(p)}
                          >
                            Open Workspace →
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          /* ======================================================== */
          /* VIEW B: Portfolio Ingestion Workspace (when selected)   */
          /* ======================================================== */
          <div className="workspace-container">
            <div className="workspace-header">
              <button
                type="button"
                className="btn-link btn-back"
                onClick={() => {
                  setSelectedPortfolio(null);
                  setCurrentJob(null);
                  setJobDocuments([]);
                  setSelectedFiles([]);
                  loadPortfolios();
                }}
              >
                ← Back to Portfolios
              </button>

              <div className="portfolio-title-group">
                <h2>{selectedPortfolio.name}</h2>
                {selectedPortfolio.portfolioUrl && (
                  <a
                    href={selectedPortfolio.portfolioUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="portfolio-external-link"
                  >
                    🔗 {selectedPortfolio.portfolioUrl} ↗
                  </a>
                )}
              </div>

              <div className="workspace-header-actions">
                <button
                  type="button"
                  className="btn-danger-outline btn-sm"
                  title="Delete this portfolio, indexed knowledge, and S3 folder"
                  onClick={() => setPortfolioToDelete(selectedPortfolio)}
                >
                  🗑 Delete Portfolio & S3
                </button>
              </div>
            </div>

            <div className="workspace-columns">
              {/* Left Column: Upload & Live Ingestion */}
              <div className="workspace-col-main">
                <div className="card">
                  <h3>Submit Documents for Ingestion</h3>
                  <p className="form-hint">
                    Upload resumes, whitepapers, project summaries, or technical documentation. Extracted text will be automatically indexed into pgvector for conversational retrieval.
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
                </div>

                {/* Job Tracking Card */}
                {currentJob && (
                  <JobStatusCard
                    job={currentJob}
                    statusUrl={`/v1/portfolios/${selectedPortfolio.id}/ingestion-jobs/${currentJob.id}`}
                    isPolling={isPollingJob}
                    onRefresh={() => startJobPolling(selectedPortfolio.id, currentJob.id)}
                  />
                )}

                {/* Ingestion Job Document Breakdown */}
                {jobDocuments.length > 0 && <DocumentList documents={jobDocuments} />}

                {/* Quick Verification Q&A widget */}
                <div className="card qa-verification-card">
                  <div className="qa-card-header">
                    <div>
                      <h3>Verify Portfolio Retrieval</h3>
                      <p className="form-hint">
                        Ask questions against indexed documents to verify semantic retrieval and grounded answer synthesis.
                      </p>
                    </div>
                    {qaHistory.filter(item => item.portfolioId === selectedPortfolio.id).length > 0 && (
                      <button
                        type="button"
                        className="btn-text btn-clear-history"
                        onClick={handleClearHistory}
                        title="Clear conversation history for this portfolio"
                      >
                        🗑️ Clear History ({qaHistory.filter(item => item.portfolioId === selectedPortfolio.id).length})
                      </button>
                    )}
                  </div>

                  <form onSubmit={handleAskQuestion} className="qa-form">
                    <input
                      type="text"
                      className="qa-input"
                      value={queryText}
                      onChange={e => setQueryText(e.target.value)}
                      placeholder="Ask a question about this portfolio (e.g. skills, experience, project achievements)..."
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
                  {qaHistory.filter(item => item.portfolioId === selectedPortfolio.id).length === 0 && !isQuerying && (
                    <div className="qa-prompt-suggestions">
                      <span className="suggestions-label">Try asking:</span>
                      <button
                        type="button"
                        className="prompt-chip"
                        onClick={() => handlePickPrompt('What are the primary technical skills and tools highlighted in this portfolio?')}
                      >
                        💡 Technical skills & tools
                      </button>
                      <button
                        type="button"
                        className="prompt-chip"
                        onClick={() => handlePickPrompt('Summarize the most significant project achievements and architectural decisions.')}
                      >
                        🏆 Key project achievements
                      </button>
                      <button
                        type="button"
                        className="prompt-chip"
                        onClick={() => handlePickPrompt('What is the candidate\'s leadership experience and team impact?')}
                      >
                        👥 Leadership & impact
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
                              <span className="qa-role-icon">👤</span> Pending Question #{qaHistory.filter(item => item.portfolioId === selectedPortfolio.id).length + 1}
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
                      const portfolioHistory = qaHistory.filter(item => item.portfolioId === selectedPortfolio.id);
                      const visibleHistory = showAllQuestions ? portfolioHistory : portfolioHistory.slice(0, 2);
                      const hiddenCount = portfolioHistory.length - 2;

                      return (
                        <>
                          {visibleHistory.map((item) => {
                            const absoluteIndex = portfolioHistory.findIndex(h => h.id === item.id);
                            const questionNum = portfolioHistory.length - (absoluteIndex >= 0 ? absoluteIndex : 0);
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
                    <h3>Portfolio Knowledge Base</h3>
                    <button
                      type="button"
                      className="btn-secondary btn-xs"
                      onClick={() => loadPortfolioDocuments(selectedPortfolio.id)}
                      disabled={isLoadingDocuments}
                    >
                      ↻
                    </button>
                  </div>
                  <p className="form-hint">
                    {portfolioDocuments.length} document(s) indexed for this portfolio.
                  </p>

                  {isLoadingDocuments ? (
                    <div className="loading-state">Loading indexed files...</div>
                  ) : portfolioDocuments.length === 0 ? (
                    <div className="empty-state-small">
                      No documents indexed yet. Upload files to start.
                    </div>
                  ) : (
                    <ul className="side-doc-list">
                      {portfolioDocuments.map(doc => (
                        <li key={doc.id} className="side-doc-item">
                          <div className="side-doc-info">
                            <span className="side-doc-name">{doc.originalFilename}</span>
                            <span className="side-doc-meta">
                              {(doc.sizeBytes / 1024).toFixed(1)} KB • {new Date(doc.createdAt).toLocaleDateString()}
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

        {/* Delete Portfolio & S3 Storage Confirmation Modal */}
        {portfolioToDelete && (
          <div className="modal-backdrop" onClick={() => !isDeletingPortfolio && setPortfolioToDelete(null)}>
            <div className="modal-dialog" onClick={e => e.stopPropagation()}>
              <div className="modal-header">
                <h3>⚠️ Delete Portfolio & S3 Storage</h3>
                <button
                  type="button"
                  className="btn-close"
                  disabled={isDeletingPortfolio}
                  onClick={() => setPortfolioToDelete(null)}
                >
                  ✕
                </button>
              </div>
              <div className="modal-body">
                <p>
                  Are you sure you want to permanently delete <strong>{portfolioToDelete.name}</strong>?
                </p>
                {portfolioToDelete.portfolioUrl && (
                  <p className="modal-hint">
                    Portfolio URL: <code>{portfolioToDelete.portfolioUrl}</code>
                  </p>
                )}
                <div className="modal-alert-box">
                  <strong>This action is irreversible and will delete:</strong>
                  <ul>
                    <li>Portfolio registration & metadata in your account</li>
                    <li>All PostgreSQL vector embeddings and indexed chunk text</li>
                    <li>
                      <strong>All files and the folder in the S3 bucket</strong>
                      {portfolioToDelete.portfolioUrl && (
                        <> (folder prefix: <code>{portfolioToDelete.portfolioUrl.replace(/^https?:\/\//, '').split('?')[0].split('/')[0]}/*</code>)</>
                      )}
                    </li>
                  </ul>
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isDeletingPortfolio}
                  onClick={() => setPortfolioToDelete(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={isDeletingPortfolio}
                  onClick={handleConfirmDeletePortfolio}
                >
                  {isDeletingPortfolio ? 'Deleting S3 & Portfolio...' : 'Yes, Delete Portfolio & S3 Files'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
