import React from 'react';

interface HeaderProps {
  ingestionClientUrl?: string;
  workspaceName?: string;
  portfolioName?: string;
}

export const Header: React.FC<HeaderProps> = ({
  ingestionClientUrl = 'http://localhost:5173',
  workspaceName,
  portfolioName,
}) => {
  return (
    <header className="playground-header">
      <div className="header-left">
        <span className="logo-badge">🤖 RAG-BOT</span>
        <h2>Playground & Retrieval Inspector</h2>
        {workspaceName && (
          <div className="header-active-workspace">
            <span className="badge-ws">🏢 {workspaceName}</span>
            {portfolioName && <span className="badge-portfolio">👤 {portfolioName}</span>}
          </div>
        )}
      </div>
      <div className="header-right">
        <a
          href={ingestionClientUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="nav-link"
          title="Open separate Ingestion Client to upload new files"
        >
          📂 Open Ingestion Client ↗
        </a>
        <a
          href="http://localhost:3000/documentation"
          target="_blank"
          rel="noopener noreferrer"
          className="nav-link"
        >
          📖 API Docs ↗
        </a>
      </div>
    </header>
  );
};

