import React, { memo } from 'react';

interface CitationItem {
  quote?: string;
  chunkId?: string;
  documentTitle?: string;
}

interface QaCitationListProps {
  citations?: CitationItem[];
}

export const QaCitationList: React.FC<QaCitationListProps> = memo(({ citations }) => {
  if (!citations || citations.length === 0) return null;

  return (
    <div className="qa-citations-box">
      <div className="qa-citations-title">
        📚 Grounded Sources ({citations.length}):
      </div>
      <div className="qa-citations-list">
        {citations.map((c, cIdx) => (
          <div key={cIdx} className="qa-citation-item">
            <span className="qa-citation-badge">Ref [{cIdx + 1}]</span>
            <div className="qa-citation-details">
              {c.quote && <div className="qa-citation-quote">&quot;{c.quote}&quot;</div>}
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
  );
});

QaCitationList.displayName = 'QaCitationList';

