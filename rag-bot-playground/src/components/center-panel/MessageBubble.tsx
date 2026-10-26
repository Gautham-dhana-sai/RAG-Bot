import React from 'react';
import { Message } from '../../types/api.types';

interface Props {
  message: Message;
}

export const MessageBubble: React.FC<Props> = ({ message }) => {
  const isUser = message.senderRole === 'user';

  return (
    <div className={`message-row ${isUser ? 'user-row' : 'assistant-row'}`}>
      <div className={`message-bubble ${isUser ? 'bubble-user' : 'bubble-assistant'}`}>
        <div className="message-sender-tag">
          {isUser ? '👤 User' : '🤖 PersonaRAG Assistant'}
        </div>

        <div className="message-text">{message.content}</div>

        {message.rewrittenQuery && (
          <div className="rewritten-query-note">
            🔍 <em>Rewritten Standalone Query:</em> "{message.rewrittenQuery}"
          </div>
        )}

        {message.insufficientEvidence && (
          <div className="abstention-badge">
            ⚠️ <strong>Insufficient Verified Evidence:</strong> The question exceeds the verified facts in the portfolio documents.
          </div>
        )}

        {message.citations && message.citations.length > 0 && (
          <div className="message-citations">
            <span className="citations-header">Verified Sources ({message.citations.length}):</span>
            <div className="citation-tags-container">
              {message.citations.map((c, i) => (
                <div key={i} className="citation-card" title={c.snippet}>
                  <div className="citation-top">
                    📄 <strong>{c.documentTitle || 'Document'}</strong>
                    {c.pageNumber && <span className="citation-page"> (p. {c.pageNumber})</span>}
                    {c.score !== undefined && (
                      <span className="citation-score"> score: {c.score.toFixed(4)}</span>
                    )}
                  </div>
                  <div className="citation-snippet-preview">"{c.snippet}"</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

