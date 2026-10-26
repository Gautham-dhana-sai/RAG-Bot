import React, { useState, useEffect, useCallback } from 'react';
import { RequestConfig, ConnectionState, AuthMode } from '../../types/config.types';
import { Entity, DemoProfile } from '../../types/api.types';
import { RAGApiClient } from '../../services/api-client';
import { ConnectionStatusBadge } from './ConnectionStatusBadge';

interface RequestConfigPanelProps {
  config: RequestConfig;
  apiClient: RAGApiClient;
  onChange: (updated: Partial<RequestConfig>) => void;
  onReset: () => void;
  onClearToken: () => void;
  onCreateConversation: () => void;
  isCreatingConv: boolean;
  connection: ConnectionState;
  onTestConnection: () => void;
  isTestingConnection: boolean;
  onActiveNamesChange?: (names: { workspaceName: string; portfolioName: string }) => void;
}

export const RequestConfigPanel: React.FC<RequestConfigPanelProps> = ({
  config,
  apiClient,
  onChange,
  onReset,
  onClearToken,
  onCreateConversation,
  isCreatingConv,
  connection,
  onTestConnection,
  isTestingConnection,
  onActiveNamesChange,
}) => {
  const [demoProfiles, setDemoProfiles] = useState<DemoProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('alex-acme');
  const [entities, setEntities] = useState<Entity[]>([]);
  const [workspaceName, setWorkspaceName] = useState<string>('Acme Cloud Systems');

  // Register Modal state
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regWorkspace, setRegWorkspace] = useState('');
  const [regPortfolio, setRegPortfolio] = useState('');
  const [isRegistering, setIsRegistering] = useState(false);
  const [regError, setRegError] = useState<string | null>(null);

  // New Portfolio prompt
  const [showNewPortfolio, setShowNewPortfolio] = useState(false);
  const [newPortfolioName, setNewPortfolioName] = useState('');
  const [isCreatingPortfolio, setIsCreatingPortfolio] = useState(false);

  // Advanced section
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showTokenInput, setShowTokenInput] = useState(false);

  // Fetch demo profiles on mount or when connected
  const loadDemoProfiles = useCallback(async () => {
    try {
      const profiles = await apiClient.getDemoProfiles();
      if (Array.isArray(profiles) && profiles.length > 0) {
        setDemoProfiles(profiles);

        // Match current tenant
        const matching = profiles.find(p => p.tenantId === config.tenantId);
        if (matching) {
          setSelectedProfileId(matching.id);
          setWorkspaceName(matching.workspaceName);
          if (onActiveNamesChange) {
            onActiveNamesChange({
              workspaceName: matching.workspaceName,
              portfolioName: matching.portfolioName,
            });
          }
        }
      }
    } catch {
      // Offline or mock
    }
  }, [apiClient, config.tenantId, onActiveNamesChange]);

  // Fetch entities whenever tenant changes
  const loadEntities = useCallback(async () => {
    if (!config.tenantId) return;
    try {
      const list = await apiClient.listEntities(config.tenantId);
      if (Array.isArray(list)) {
        setEntities(list);
        const active = list.find(e => e.id === config.entityId) || list[0];
        if (active && onActiveNamesChange) {
          onActiveNamesChange({
            workspaceName,
            portfolioName: active.name,
          });
        }
      }
    } catch {
      // fallback
    }
  }, [apiClient, config.tenantId, config.entityId, workspaceName, onActiveNamesChange]);

  useEffect(() => {
    loadDemoProfiles();
  }, [loadDemoProfiles]);

  useEffect(() => {
    loadEntities();
  }, [config.tenantId, loadEntities]);

  // Handle 1-click Profile Selection
  const handleSelectProfile = (profileId: string) => {
    setSelectedProfileId(profileId);
    const profile = demoProfiles.find(p => p.id === profileId);
    if (!profile) return;

    setWorkspaceName(profile.workspaceName);

    if (profile.isGuest) {
      onChange({
        authMode: 'public_anonymous',
        token: '',
        tenantId: profile.tenantId,
        entityId: profile.entityId,
        conversationId: '',
      });
    } else {
      onChange({
        authMode: 'bearer',
        token: profile.token,
        tenantId: profile.tenantId,
        entityId: profile.entityId,
        conversationId: '',
      });
    }

    if (onActiveNamesChange) {
      onActiveNamesChange({
        workspaceName: profile.workspaceName,
        portfolioName: profile.portfolioName,
      });
    }
  };

  // Handle Registration of new Tenant + User + Entity
  const handleRegisterWorkspace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regName.trim() || !regEmail.trim()) {
      setRegError('Name and email are required');
      return;
    }
    setIsRegistering(true);
    setRegError(null);

    try {
      const res = await apiClient.register({
        name: regName.trim(),
        email: regEmail.trim(),
        workspaceName: regWorkspace.trim() || `${regName.trim()}'s Workspace`,
        portfolioName: regPortfolio.trim() || `${regName.trim()}'s Portfolio`,
      });

      const activeEnt = res.activeEntity || res.entities?.[0] || null;
      setWorkspaceName(res.tenant.name);
      setEntities(res.entities || (activeEnt ? [activeEnt] : []));
      setSelectedProfileId('custom-reg');

      onChange({
        authMode: 'bearer',
        token: res.token,
        tenantId: res.tenant.id,
        entityId: activeEnt?.id || '',
        conversationId: '',
        persistToken: true,
      });

      if (onActiveNamesChange) {
        onActiveNamesChange({
          workspaceName: res.tenant.name,
          portfolioName: activeEnt?.name || 'No Active Portfolio',
        });
      }

      setShowRegisterModal(false);
      setRegName('');
      setRegEmail('');
      setRegWorkspace('');
      setRegPortfolio('');
    } catch (err: any) {
      setRegError(err.message || 'Registration failed');
    } finally {
      setIsRegistering(false);
    }
  };

  // Handle Creating a new Entity (Portfolio) under active Tenant
  const handleCreatePortfolio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPortfolioName.trim() || !config.tenantId) return;

    setIsCreatingPortfolio(true);
    try {
      const newEntity = await apiClient.createEntity(config.tenantId, {
        name: newPortfolioName.trim(),
        isPublic: true,
      });

      setEntities(prev => [...prev, newEntity]);
      onChange({
        entityId: newEntity.id,
        conversationId: '', // Detach active session
      });

      if (onActiveNamesChange) {
        onActiveNamesChange({
          workspaceName,
          portfolioName: newEntity.name,
        });
      }

      setNewPortfolioName('');
      setShowNewPortfolio(false);
    } catch (err: any) {
      alert(`Failed to create portfolio: ${err.message}`);
    } finally {
      setIsCreatingPortfolio(false);
    }
  };

  const handleEntitySelect = (entityId: string) => {
    onChange({
      entityId,
      conversationId: '', // Always detach session when switching entity
    });

    const found = entities.find(e => e.id === entityId);
    if (found && onActiveNamesChange) {
      onActiveNamesChange({
        workspaceName,
        portfolioName: found.name,
      });
    }
  };

  return (
    <div className="panel config-panel">
      <div className="panel-title-row">
        <h3>Workspace & Identity</h3>
        <button type="button" className="btn-reset" onClick={onReset} title="Reset to default Alex Chen profile">
          Reset
        </button>
      </div>

      <ConnectionStatusBadge
        connection={connection}
        onTest={onTestConnection}
        isLoading={isTestingConnection}
      />

      {/* Current Active Workspace Summary Card */}
      <div className="active-workspace-card">
        <div className="active-ws-row">
          <span className="ws-icon">🏢</span>
          <div className="ws-meta">
            <span className="ws-label">Active Workspace</span>
            <span className="ws-name">{workspaceName}</span>
          </div>
        </div>
        <div className="active-auth-status">
          {config.authMode === 'public_anonymous' ? (
            <span className="auth-pill guest">👤 Guest Visitor (Read-only)</span>
          ) : (
            <span className="auth-pill active">🔑 Authenticated (Auto-Managed)</span>
          )}
        </div>
      </div>

      {/* 1-Click Profile Switcher */}
      <div className="form-section">
        <div className="field-header-row">
          <label className="field-label">Switch Workspace / Profile</label>
        </div>
        <div className="profile-quick-picker">
          {demoProfiles.map(p => (
            <button
              key={p.id}
              type="button"
              className={`btn-profile-card ${selectedProfileId === p.id ? 'active' : ''}`}
              onClick={() => handleSelectProfile(p.id)}
            >
              <div className="p-header">
                <span className="p-name">{p.name}</span>
                <span className="p-ws">{p.workspaceName.split(' ')[0]}</span>
              </div>
              <div className="p-role">{p.role}</div>
            </button>
          ))}
        </div>

        <button
          type="button"
          className="btn-open-register"
          onClick={() => setShowRegisterModal(true)}
        >
          ✨ + Register New Workspace
        </button>
      </div>

      {/* Entity / Portfolio Selector (Human Friendly Dropdown) */}
      <div className="form-section">
        <div className="field-header-row">
          <label className="field-label">Active Portfolio</label>
          <button
            type="button"
            className="btn-add-portfolio"
            onClick={() => setShowNewPortfolio(!showNewPortfolio)}
          >
            {showNewPortfolio ? 'Cancel' : '+ New Portfolio'}
          </button>
        </div>

        {showNewPortfolio ? (
          <form onSubmit={handleCreatePortfolio} className="new-portfolio-form">
            <input
              type="text"
              className="text-input"
              value={newPortfolioName}
              onChange={e => setNewPortfolioName(e.target.value)}
              placeholder="e.g. Consulting & Advisory..."
              autoFocus
            />
            <button
              type="submit"
              className="btn-submit-portfolio"
              disabled={isCreatingPortfolio || !newPortfolioName.trim()}
            >
              {isCreatingPortfolio ? 'Creating...' : 'Save Portfolio'}
            </button>
          </form>
        ) : (
          <select
            className="select-input"
            value={config.entityId}
            onChange={e => handleEntitySelect(e.target.value)}
          >
            {entities.length > 0 ? (
              entities.map(e => (
                <option key={e.id} value={e.id}>
                  {e.name} {e.isPublic ? '(Public)' : '(Private)'}
                </option>
              ))
            ) : (
              <option value={config.entityId}>Default Portfolio</option>
            )}
          </select>
        )}
        <div className="entity-switch-hint">
          ℹ️ Changing portfolio automatically detaches session to maintain evidence isolation.
        </div>
      </div>

      {/* Conversation Session Row */}
      <div className="form-section conversation-field-section">
        <div className="conv-header-row">
          <label className="field-label">Conversation Session</label>
          <button
            type="button"
            className="btn-new-conv"
            onClick={onCreateConversation}
            disabled={isCreatingConv || !config.tenantId || !config.entityId}
          >
            {isCreatingConv ? '+ Creating...' : '+ New Session'}
          </button>
        </div>
        <input
          type="text"
          className="text-input"
          value={config.conversationId ? `Session: ${config.conversationId.substring(0, 18)}...` : ''}
          placeholder="New session will be created automatically"
          readOnly
        />
      </div>

      {/* Advanced / Developer Accordion */}
      <div className="advanced-accordion">
        <button
          type="button"
          className="btn-toggle-advanced"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? '▼ Hide Developer Overrides' : '▶ Advanced / Developer Overrides'}
        </button>

        {showAdvanced && (
          <div className="advanced-fields">
            <div className="form-section">
              <label className="field-label">API Base URL</label>
              <input
                type="text"
                className="text-input"
                value={config.baseUrl}
                onChange={e => onChange({ baseUrl: e.target.value })}
                placeholder="http://localhost:3000"
              />
            </div>

            <div className="form-section">
              <label className="field-label">Auth Mode</label>
              <select
                className="select-input"
                value={config.authMode}
                onChange={e => onChange({ authMode: e.target.value as AuthMode })}
              >
                <option value="bearer">Bearer Token</option>
                <option value="dev_headers">Dev Headers (X-User-Id / X-Tenant-Id)</option>
                <option value="public_anonymous">Public Anonymous</option>
              </select>
            </div>

            {config.authMode === 'bearer' && (
              <div className="form-section token-section">
                <div className="token-label-row">
                  <label className="field-label">Token Value</label>
                  <button
                    type="button"
                    className="btn-toggle-mask"
                    onClick={() => setShowTokenInput(!showTokenInput)}
                  >
                    {showTokenInput ? 'Mask' : 'Edit Token'}
                  </button>
                </div>
                {showTokenInput ? (
                  <input
                    type="password"
                    className="text-input"
                    value={config.token}
                    onChange={e => onChange({ token: e.target.value })}
                    placeholder="ragbot_sess_..."
                    autoComplete="off"
                  />
                ) : (
                  <div className="masked-token-display">
                    <code>{config.token ? '••••••••••••••••••••••••' : '(Empty Token)'}</code>
                  </div>
                )}
                <div className="token-retention-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={config.persistToken}
                      onChange={e => onChange({ persistToken: e.target.checked })}
                    />
                    <span>Retain token in localStorage</span>
                  </label>
                  {config.token && (
                    <button type="button" className="btn-clear-token" onClick={onClearToken}>
                      Clear
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="form-section">
              <label className="field-label">Raw Tenant UUID</label>
              <input
                type="text"
                className="text-input code-font"
                value={config.tenantId}
                onChange={e => onChange({ tenantId: e.target.value, conversationId: '' })}
              />
            </div>

            <div className="form-section">
              <label className="field-label">Raw Entity UUID</label>
              <input
                type="text"
                className="text-input code-font"
                value={config.entityId}
                onChange={e => onChange({ entityId: e.target.value, conversationId: '' })}
              />
            </div>

            <div className="form-section">
              <label className="field-label">Request Timeout (ms)</label>
              <input
                type="number"
                className="text-input"
                value={config.timeoutMs}
                onChange={e => onChange({ timeoutMs: Math.max(1000, parseInt(e.target.value) || 15000) })}
                min={1000}
                step={1000}
              />
            </div>
          </div>
        )}
      </div>

      {/* Registration Modal */}
      {showRegisterModal && (
        <div className="modal-overlay">
          <div className="modal-dialog">
            <div className="modal-header">
              <h4>🚀 Register New Workspace</h4>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setShowRegisterModal(false)}
              >
                ✕
              </button>
            </div>
            <p className="modal-description">
              No UUIDs or manual API tokens needed. Fill in your name and company to provision an isolated tenant, owner membership, and portfolio instantly.
            </p>

            {regError && <div className="modal-error">{regError}</div>}

            <form onSubmit={handleRegisterWorkspace}>
              <div className="modal-field">
                <label>Your Full Name *</label>
                <input
                  type="text"
                  required
                  className="text-input"
                  value={regName}
                  onChange={e => setRegName(e.target.value)}
                  placeholder="e.g. Maya Patel"
                />
              </div>

              <div className="modal-field">
                <label>Work Email Address *</label>
                <input
                  type="email"
                  required
                  className="text-input"
                  value={regEmail}
                  onChange={e => setRegEmail(e.target.value)}
                  placeholder="e.g. maya@nexusai.io"
                />
              </div>

              <div className="modal-field">
                <label>Workspace / Organization Name (Tenant)</label>
                <input
                  type="text"
                  className="text-input"
                  value={regWorkspace}
                  onChange={e => setRegWorkspace(e.target.value)}
                  placeholder="e.g. Nexus AI Labs (defaults to Your Workspace)"
                />
              </div>

              <div className="modal-field">
                <label>Default Portfolio Name (Entity)</label>
                <input
                  type="text"
                  className="text-input"
                  value={regPortfolio}
                  onChange={e => setRegPortfolio(e.target.value)}
                  placeholder="e.g. AI Research & Systems (defaults to Your Portfolio)"
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => setShowRegisterModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-submit-reg"
                  disabled={isRegistering}
                >
                  {isRegistering ? 'Provisioning...' : 'Create & Connect'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
