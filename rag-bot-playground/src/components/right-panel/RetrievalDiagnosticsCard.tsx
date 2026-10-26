import React, { useState } from 'react';
import { DiagnosticsResponse } from '../../types/api.types';
import { RAGApiClient } from '../../services/api-client';

interface Props {
  apiClient: RAGApiClient;
  tenantId: string;
  entityId: string;
  lastDiagnostics?: any;
}

export const RetrievalDiagnosticsCard: React.FC<Props> = ({
  apiClient,
  tenantId,
  entityId,
  lastDiagnostics,
}) => {
  const [testQuery, setTestQuery] = useState('distributed systems patents');
  const [topK, setTopK] = useState(10);
  const [mode, setMode] = useState<'hybrid' | 'dense' | 'sparse'>('hybrid');
  const [diagnosticsData, setDiagnosticsData] = useState<DiagnosticsResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runDiagnostics = async () => {
    if (!testQuery.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiClient.getRetrievalDiagnostics(tenantId, entityId, {
        query: testQuery,
        topK,
        mode,
      });
      setDiagnosticsData(res);
    } catch (err: any) {
      setError(err.message || 'Diagnostics request failed');
    } finally {
      setIsLoading(false);
    }
  };

  const currentData = diagnosticsData;

  return (
    <div className="diagnostics-panel">
      <div className="diagnostics-header">
        <h4>🔬 Retrieval Strategy Inspector</h4>
        <p className="hint">
          Inspect dense vector rankings, sparse keyword matches, and Reciprocal Rank Fusion (RRF) scores directly from the search index.
        </p>
      </div>

      <div className="diag-input-row">
        <input
          type="text"
          className="diag-query-input"
          value={testQuery}
          onChange={e => setTestQuery(e.target.value)}
          placeholder="Enter test retrieval query..."
        />
        <select
          className="diag-mode-select"
          value={mode}
          onChange={e => setMode(e.target.value as any)}
        >
          <option value="hybrid">Hybrid RRF</option>
          <option value="dense">Dense Vector</option>
          <option value="sparse">Sparse Lexical</option>
        </select>
        <input
          type="number"
          min={1}
          max={50}
          className="diag-topk-input"
          style={{ width: '60px', padding: '0.4rem', border: '1px solid #cbd5e1', borderRadius: '4px' }}
          value={topK}
          onChange={e => setTopK(parseInt(e.target.value) || 10)}
          title="topK candidate count"
        />
        <button
          type="button"
          className="btn-run-diag"
          onClick={runDiagnostics}
          disabled={isLoading || !tenantId || !entityId}
        >
          {isLoading ? 'Scanning...' : 'Inspect Candidates'}
        </button>
      </div>

      {error && <div className="diag-error">⚠️ {error}</div>}

      {lastDiagnostics && !currentData && (
        <div className="recent-msg-diag-note">
          <strong>Latest Message Retrieval Diagnostics:</strong>
          <ul>
            <li>Rewritten Query: "{lastDiagnostics.rewrittenQuery}"</li>
            <li>Method: {lastDiagnostics.retrievalMode}</li>
            <li>Retrieved Count: {lastDiagnostics.retrievedCount} chunks</li>
            <li>Total Pipeline Latency: {lastDiagnostics.totalDurationMs}ms</li>
          </ul>
        </div>
      )}

      {currentData && (
        <div className="diag-results">
          <div className="diag-metrics-bar">
            <span>Mode: <strong>{currentData.retrievalMode}</strong></span>
            <span>Duration: <strong>{currentData.durationMs}ms</strong></span>
            <span>Matched Chunks: <strong>{currentData.retrievedCount}</strong></span>
          </div>

          <div className="candidates-table-wrap">
            <table className="candidates-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Document</th>
                  <th>RRF Score</th>
                  <th>Dense</th>
                  <th>Sparse</th>
                  <th>Evidence Snippet</th>
                </tr>
              </thead>
              <tbody>
                {currentData.candidates.map((c, i) => (
                  <tr key={c.chunkId}>
                    <td>#{i + 1}</td>
                    <td className="doc-col">{c.documentTitle} (p. {c.pageNumber})</td>
                    <td className="score-col">{c.score.toFixed(5)}</td>
                    <td>{c.denseRank ? `#${c.denseRank}` : '-'}</td>
                    <td>{c.sparseRank ? `#${c.sparseRank}` : '-'}</td>
                    <td className="snippet-col">"{c.snippet}"</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
