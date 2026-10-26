import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { RequestConfig, ConnectionState } from './types/config.types';
import { Message } from './types/api.types';
import { InspectorLog, RetrievalPreset, ExperimentRun } from './types/playground.types';
import { loadSavedConfig, saveConfig, clearSavedToken, defaultConfig } from './services/storage';
import { RAGApiClient } from './services/api-client';
import { Header } from './components/Header';
import { ErrorBanner } from './components/common/ErrorBanner';
import { RequestConfigPanel } from './components/left-panel/RequestConfigPanel';
import { ChatPlayground } from './components/center-panel/ChatPlayground';
import { InspectorPanel } from './components/right-panel/InspectorPanel';
import { RETRIEVAL_PRESETS } from './components/center-panel/RetrievalPresetsBar';
import './App.css';

export function App() {
  const [config, setConfig] = useState<RequestConfig>(() => loadSavedConfig());
  const [connection, setConnection] = useState<ConnectionState>({ status: 'untested' });
  const [messages, setMessages] = useState<Message[]>([]);
  const [latestLog, setLatestLog] = useState<InspectorLog | null>(null);
  const [experimentRuns, setExperimentRuns] = useState<ExperimentRun[]>([]);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState('Acme Cloud Systems');
  const [portfolioName, setPortfolioName] = useState('Alex Chen - Principal Architect');

  const [isLoading, setIsLoading] = useState(false);
  const [isCreatingConv, setIsCreatingConv] = useState(false);
  const [isTestingConn, setIsTestingConn] = useState(false);

  // Preset & retrieval tuning state
  const [selectedPreset, setSelectedPreset] = useState<RetrievalPreset>(RETRIEVAL_PRESETS[0]);
  const [topK, setTopK] = useState(10);
  const [retrievalMode, setRetrievalMode] = useState<'hybrid' | 'dense' | 'sparse'>('hybrid');

  const logRef = useRef<InspectorLog | null>(null);
  const handleLog = useCallback((log: InspectorLog) => {
    logRef.current = log;
    setLatestLog(log);
  }, []);

  const apiClient = useMemo(() => {
    return new RAGApiClient(config, handleLog);
  }, [config, handleLog]);

  // Save config on change (excluding sensitive token unless opted in)
  const handleConfigChange = (updated: Partial<RequestConfig>) => {
    setConfig(prev => {
      const next = { ...prev, ...updated };
      saveConfig(next);
      return next;
    });
  };

  const handleClearToken = () => {
    clearSavedToken();
    handleConfigChange({ token: '', persistToken: false });
  };

  // Immediate logout and token cleanup on session expiration
  useEffect(() => {
    const onSessionExpired = () => {
      clearSavedToken();
      handleConfigChange({ token: '', persistToken: false });
      setGeneralError('Your session has expired. Please re-authenticate.');
    };
    window.addEventListener('ragbot:session_expired', onSessionExpired);
    return () => window.removeEventListener('ragbot:session_expired', onSessionExpired);
  }, []);

  const handleResetConfig = () => {
    setConfig({ ...defaultConfig });
    saveConfig(defaultConfig);
    setMessages([]);
    setConnection({ status: 'untested' });
    setGeneralError(null);
  };

  // Connection probe test
  const handleTestConnection = async () => {
    setIsTestingConn(true);
    setGeneralError(null);
    const start = performance.now();
    try {
      const res = await apiClient.checkHealth();
      const latencyMs = Math.round(performance.now() - start);
      setConnection({
        status: 'connected',
        latencyMs,
        version: res.version,
        aiProvider: res.ai?.provider || 'mock',
      });
    } catch (err: any) {
      setConnection({
        status: 'error',
        error: err.message || 'Failed to connect',
      });
      setGeneralError(`Connection to ${config.baseUrl} failed: ${err.message}`);
    } finally {
      setIsTestingConn(false);
    }
  };

  // Auto-test connection on initial load
  useEffect(() => {
    handleTestConnection();
  }, []);

  // Create new conversation
  const handleCreateConversation = async () => {
    if (!config.tenantId || !config.entityId) {
      setGeneralError('Please select a Tenant ID and Entity ID first.');
      return;
    }
    setIsCreatingConv(true);
    setGeneralError(null);
    try {
      const conv = await apiClient.createConversation(
        config.tenantId,
        config.entityId,
        `Session ${new Date().toLocaleTimeString()}`
      );
      handleConfigChange({ conversationId: conv.id });
      setMessages([]);
    } catch (err: any) {
      setGeneralError(`Failed to create conversation: ${err.message}`);
    } finally {
      setIsCreatingConv(false);
    }
  };

  // Send message
  const handleSendMessage = async (text: string) => {
    if (!config.tenantId || !config.entityId) {
      setGeneralError('Tenant ID and Entity ID are required to send a query.');
      return;
    }

    setGeneralError(null);
    setIsLoading(true);

    try {
      // 1. Ensure conversation exists or create one automatically
      let convId = config.conversationId;
      if (!convId) {
        const newConv = await apiClient.createConversation(
          config.tenantId,
          config.entityId,
          `Session ${new Date().toLocaleTimeString()}`
        );
        convId = newConv.id;
        handleConfigChange({ conversationId: convId });
      }

      // Optimistically append user message to local chat view
      const userMessageId = `user-${Date.now()}`;
      const tempUserMsg: Message = {
        id: userMessageId,
        tenantId: config.tenantId,
        entityId: config.entityId,
        conversationId: convId,
        senderRole: 'user',
        content: text,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, tempUserMsg]);

      // 2. Send to backend with active retrieval configuration
      const startTime = performance.now();
      const response = await apiClient.sendMessage(config.tenantId, config.entityId, convId, {
        content: text,
        topK,
        retrievalMode,
        includeDiagnostics: true,
      });
      const durationMs = Math.round(performance.now() - startTime);

      // Append assistant message with validated citations
      const assistantMsg: Message = {
        id: response.messageId,
        tenantId: config.tenantId,
        entityId: config.entityId,
        conversationId: convId,
        senderRole: 'assistant',
        content: response.answer,
        citations: response.citations,
        insufficientEvidence: response.insufficientEvidence,
        confidenceScore: response.confidence,
        rewrittenQuery: response.diagnostics?.rewrittenQuery,
        createdAt: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMsg]);

      // Record in experiment runs for side-by-side comparison
      const run: ExperimentRun = {
        id: `run-${Date.now()}`,
        presetLabel: selectedPreset.label,
        query: text,
        retrievalMode,
        topK,
        minScore: selectedPreset.minScore,
        durationMs,
        answer: response.answer,
        citations: response.citations,
        insufficientEvidence: response.insufficientEvidence,
        confidence: response.confidence,
        retrievedCount: response.diagnostics?.retrievedCount,
        rewrittenQuery: response.diagnostics?.rewrittenQuery,
      };
      setExperimentRuns(prev => [run, ...prev.slice(0, 9)]);
    } catch (err: any) {
      setGeneralError(err.message || 'Query failed');
    } finally {
      setIsLoading(false);
    }
  };

  // Reload persisted messages from backend
  const handleReloadHistory = async () => {
    if (!config.tenantId || !config.entityId || !config.conversationId) return;
    setIsLoading(true);
    setGeneralError(null);
    try {
      const persisted = await apiClient.getMessages(
        config.tenantId,
        config.entityId,
        config.conversationId
      );
      setMessages(persisted);
    } catch (err: any) {
      setGeneralError(`Failed to load history: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectPreset = (preset: RetrievalPreset) => {
    setSelectedPreset(preset);
    setTopK(preset.topK);
    setRetrievalMode(preset.retrievalMode);
  };

  return (
    <div className="playground-app">
      <Header workspaceName={workspaceName} portfolioName={portfolioName} />

      <ErrorBanner message={generalError} onDismiss={() => setGeneralError(null)} />

      <main className="three-panel-layout">
        {/* Left Panel: Request Configuration */}
        <aside className="layout-col col-left">
          <RequestConfigPanel
            config={config}
            apiClient={apiClient}
            onChange={handleConfigChange}
            onReset={handleResetConfig}
            onClearToken={handleClearToken}
            onCreateConversation={handleCreateConversation}
            isCreatingConv={isCreatingConv}
            connection={connection}
            onTestConnection={handleTestConnection}
            isTestingConnection={isTestingConn}
            onActiveNamesChange={({ workspaceName: ws, portfolioName: pf }) => {
              setWorkspaceName(ws);
              setPortfolioName(pf);
            }}
          />
        </aside>

        {/* Center Panel: Interactive Chat Playground */}
        <section className="layout-col col-center">
          <ChatPlayground
            tenantId={config.tenantId}
            entityId={config.entityId}
            conversationId={config.conversationId}
            messages={messages}
            isLoading={isLoading}
            onSendMessage={handleSendMessage}
            onReloadHistory={handleReloadHistory}
            onClearLocalView={() => setMessages([])}
            onCreateConversation={handleCreateConversation}
            selectedPreset={selectedPreset}
            onSelectPreset={handleSelectPreset}
            topK={topK}
            onTopKChange={setTopK}
            retrievalMode={retrievalMode}
            onModeChange={setRetrievalMode}
          />
        </section>

        {/* Right Panel: Request & Response Inspector */}
        <aside className="layout-col col-right">
          <InspectorPanel
            latestLog={latestLog}
            apiClient={apiClient}
            tenantId={config.tenantId}
            entityId={config.entityId}
            experimentRuns={experimentRuns}
            onClearRuns={() => setExperimentRuns([])}
          />
        </aside>
      </main>
    </div>
  );
}

