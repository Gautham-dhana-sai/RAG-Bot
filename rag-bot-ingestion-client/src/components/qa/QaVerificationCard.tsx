import React, { memo, useState, useEffect, useCallback } from 'react';
import { Portal, QAHistoryItem } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { cleanDocCitationTags } from '../../utils/formatters';
import { QaHistoryThread } from './QaHistoryThread';

interface QaVerificationCardProps {
  portal: Portal;
  documentCount: number;
}

export const QaVerificationCard: React.FC<QaVerificationCardProps> = memo(({
  portal,
  documentCount,
}) => {
  const { getClient } = useAuth();
  const [queryText, setQueryText] = useState('What is this portal about and what are its key benefits?');
  const [isQuerying, setIsQuerying] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);

  const [qaHistory, setQaHistory] = useState<QAHistoryItem[]>(() => {
    try {
      localStorage.removeItem('ragbot_qa_history');
      const saved = sessionStorage.getItem('ragbot_qa_session_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      sessionStorage.setItem('ragbot_qa_session_history', JSON.stringify(qaHistory));
    } catch {
      // ignore
    }
  }, [qaHistory]);

  const handleAskQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    const questionToAsk = queryText.trim();
    if (!portal || !questionToAsk || isQuerying) return;

    setIsQuerying(true);
    setPendingQuestion(questionToAsk);
    setQueryText('');

    const itemTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const itemId = `qa-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

    try {
      const client = getClient();
      const res = await client.askQuestion(
        portal.tenantId || '',
        portal.id,
        questionToAsk
      );

      const newItem: QAHistoryItem = {
        id: itemId,
        portalId: portal.id,
        portfolioId: portal.id,
        question: questionToAsk,
        answer: cleanDocCitationTags(res.answer),
        citations: res.citations || [],
        timestamp: itemTimestamp,
        isError: false,
      };

      setQaHistory(prev => [newItem, ...prev]);
    } catch (err: any) {
      const errorItem: QAHistoryItem = {
        id: itemId,
        portalId: portal.id,
        portfolioId: portal.id,
        question: questionToAsk,
        answer: `Query error: ${err.message || 'Failed to generate answer'}`,
        citations: [],
        timestamp: itemTimestamp,
        isError: true,
      };
      setQaHistory(prev => [errorItem, ...prev]);
    } finally {
      setIsQuerying(false);
      setPendingQuestion(null);
    }
  };

  const handleClearHistory = useCallback(() => {
    setQaHistory(prev => prev.filter(item => item.portalId !== portal.id && item.portfolioId !== portal.id));
  }, [portal.id]);

  const handlePickPrompt = useCallback((prompt: string) => {
    setQueryText(prompt);
  }, []);

  const portalHistory = qaHistory.filter(item => (item.portalId || item.portfolioId) === portal.id);

  // Only render when at least one document exists in the portal
  if (documentCount <= 0) return null;

  return (
    <div className="card qa-verification-card">
      <div className="qa-card-header">
        <div>
          <h3>Verify Portal Retrieval</h3>
          <p className="form-hint">
            Ask questions against indexed documents to verify semantic retrieval and grounded answer synthesis.
          </p>
        </div>
        {portalHistory.length > 0 && (
          <button
            type="button"
            className="btn-text btn-clear-history"
            onClick={handleClearHistory}
            title="Clear conversation history for this portal"
          >
            🗑️ Clear History ({portalHistory.length})
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

      {/* Suggestion prompt chips if no history yet */}
      {portalHistory.length === 0 && !isQuerying && (
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
            ⭐ Key benefits &amp; value
          </button>
          <button
            type="button"
            className="prompt-chip"
            onClick={() => handlePickPrompt('What main services, products, or core topics are covered in this portal?')}
          >
            📌 Main services &amp; topics
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

      {/* Conversational Q&A History Thread */}
      <QaHistoryThread
        history={portalHistory}
        isQuerying={isQuerying}
        pendingQuestion={pendingQuestion}
      />
    </div>
  );
});

QaVerificationCard.displayName = 'QaVerificationCard';

