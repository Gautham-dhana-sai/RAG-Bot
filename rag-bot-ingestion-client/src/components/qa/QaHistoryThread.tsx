import React, { memo, useState } from 'react';
import { QAHistoryItem } from '../../types';
import { cleanDocCitationTags, formatAnswerParagraph } from '../../utils/formatters';
import { QaCitationList } from './QaCitationList';

interface QaHistoryThreadProps {
  history: QAHistoryItem[];
  isQuerying: boolean;
  pendingQuestion: string | null;
}

export const QaHistoryThread: React.FC<QaHistoryThreadProps> = memo(({
  history,
  isQuerying,
  pendingQuestion,
}) => {
  const [showAllQuestions, setShowAllQuestions] = useState(false);

  const visibleHistory = showAllQuestions ? history : history.slice(0, 2);
  const hiddenCount = history.length - 2;

  return (
    <div className="qa-history-feed">
      {/* Pending Query State at Top */}
      {isQuerying && pendingQuestion && (
        <div className="qa-history-thread-item qa-thread-pending">
          <div className="qa-bubble qa-question-bubble">
            <div className="qa-bubble-header">
              <span className="qa-bubble-role">
                <span className="qa-role-icon">👤</span> Pending Question #{history.length + 1}
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
                <span>Searching vector chunks with Gemini round-robin &amp; synthesizing answer...</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {visibleHistory.map((item) => {
        const absoluteIndex = history.findIndex(h => h.id === item.id);
        const questionNum = history.length - (absoluteIndex >= 0 ? absoluteIndex : 0);
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
                  <div key={pIdx} className="qa-paragraph">
                    {formatAnswerParagraph(paragraph)}
                  </div>
                ))}

                <QaCitationList citations={item.citations} />
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
    </div>
  );
});

QaHistoryThread.displayName = 'QaHistoryThread';

