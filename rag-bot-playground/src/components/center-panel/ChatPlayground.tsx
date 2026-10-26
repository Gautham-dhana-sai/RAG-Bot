import React, { useState, useRef, useEffect } from 'react';
import { Message } from '../../types/api.types';
import { RetrievalPreset } from '../../types/playground.types';
import { MessageBubble } from './MessageBubble';
import { RetrievalPresetsBar } from './RetrievalPresetsBar';
import { HistoryTestingWorkflow } from './HistoryTestingWorkflow';

interface Props {
  tenantId: string;
  entityId: string;
  conversationId: string;
  messages: Message[];
  isLoading: boolean;
  onSendMessage: (text: string) => void;
  onReloadHistory: () => void;
  onClearLocalView: () => void;
  onCreateConversation: () => void;
  selectedPreset: RetrievalPreset;
  onSelectPreset: (preset: RetrievalPreset) => void;
  topK: number;
  onTopKChange: (topK: number) => void;
  retrievalMode: 'hybrid' | 'dense' | 'sparse';
  onModeChange: (mode: 'hybrid' | 'dense' | 'sparse') => void;
}

export const ChatPlayground: React.FC<Props> = ({
  tenantId,
  entityId,
  conversationId,
  messages,
  isLoading,
  onSendMessage,
  onReloadHistory,
  onClearLocalView,
  onCreateConversation,
  selectedPreset,
  onSelectPreset,
  topK,
  onTopKChange,
  retrievalMode,
  onModeChange,
}) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || isLoading) return;
    onSendMessage(inputText);
    setInputText('');
  };

  return (
    <div className="panel chat-panel">
      {/* Prominent Active Scope Banner */}
      <div className="chat-scope-banner">
        <div className="scope-col">
          <span className="scope-label">Tenant:</span>
          <code className="scope-val">{tenantId || 'Not Selected'}</code>
        </div>
        <div className="scope-col">
          <span className="scope-label">Entity:</span>
          <code className="scope-val">{entityId || 'Not Selected'}</code>
        </div>
        <div className="scope-col">
          <span className="scope-label">Session:</span>
          <code className="scope-val">{conversationId || '(Unsaved Session)'}</code>
        </div>
      </div>

      {/* Retrieval Presets Configuration */}
      <RetrievalPresetsBar
        selectedPreset={selectedPreset}
        onSelectPreset={onSelectPreset}
        topK={topK}
        onTopKChange={onTopKChange}
        retrievalMode={retrievalMode}
        onModeChange={onModeChange}
      />

      {/* History Testing Sequence */}
      <HistoryTestingWorkflow
        onSendStep={q => onSendMessage(q)}
        disabled={isLoading}
        conversationId={conversationId}
      />

      {/* Conversation Action Toolbar */}
      <div className="chat-toolbar">
        <span className="chat-toolbar-title">
          Messages ({messages.length})
        </span>
        <div className="toolbar-buttons">
          <button
            type="button"
            className="btn-toolbar"
            onClick={onReloadHistory}
            disabled={isLoading || !conversationId}
            title="Fetch persisted messages directly from PostgreSQL"
          >
            ↻ Reload History
          </button>
          <button
            type="button"
            className="btn-toolbar"
            onClick={onClearLocalView}
            title="Clear the view without deleting from database"
          >
            ⌫ Clear View
          </button>
          <button
            type="button"
            className="btn-toolbar btn-toolbar-primary"
            onClick={onCreateConversation}
            disabled={isLoading}
            title="Start fresh conversation session"
          >
            + New Conversation
          </button>
        </div>
      </div>

      {/* Messages Stream Container */}
      <div className="messages-stream">
        {messages.length === 0 ? (
          <div className="empty-messages-placeholder">
            <div className="placeholder-icon">💬</div>
            <h4>Conversation Ready</h4>
            <p>
              Type a question below or click <strong>▶ Run Step 1</strong> in the test sequence above to query the entity's career records.
            </p>
          </div>
        ) : (
          messages.map(msg => <MessageBubble key={msg.id} message={msg} />)
        )}

        {isLoading && (
          <div className="loading-bubble">
            <span className="spinner">⏳</span> Thinking & Retrieving Evidence Chunks...
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* User Input Area */}
      <form onSubmit={handleSubmit} className="chat-input-area">
        <input
          type="text"
          className="chat-text-input"
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          placeholder="Ask a question about this entity's career history..."
          disabled={isLoading || !tenantId || !entityId}
        />
        <button
          type="submit"
          className="btn-send-message"
          disabled={isLoading || !inputText.trim() || !tenantId || !entityId}
        >
          {isLoading ? '...' : 'Send'}
        </button>
      </form>
    </div>
  );
};

