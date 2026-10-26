import React, { useState } from 'react';
import { InspectorLog, ExperimentRun } from '../../types/playground.types';
import { RAGApiClient } from '../../services/api-client';
import { StructuredResponseViewer } from './StructuredResponseViewer';
import { RawJsonViewer } from './RawJsonViewer';
import { RetrievalDiagnosticsCard } from './RetrievalDiagnosticsCard';
import { IngestionStatusViewer } from './IngestionStatusViewer';

interface Props {
  latestLog: InspectorLog | null;
  apiClient: RAGApiClient;
  tenantId: string;
  entityId: string;
  experimentRuns: ExperimentRun[];
  onClearRuns: () => void;
}

export const InspectorPanel: React.FC<Props> = ({
  latestLog,
  apiClient,
  tenantId,
  entityId,
  experimentRuns,
  onClearRuns,
}) => {
  const [activeTab, setActiveTab] = useState<'inspector' | 'raw' | 'diagnostics' | 'experiments' | 'documents'>('inspector');

  const lastDiag = latestLog?.responseBody?.diagnostics;

  return (
    <div className="panel inspector-panel">
      <div className="inspector-tabs">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'inspector' ? 'active' : ''}`}
          onClick={() => setActiveTab('inspector')}
        >
          🔍 Request Inspector
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'diagnostics' ? 'active' : ''}`}
          onClick={() => setActiveTab('diagnostics')}
        >
          🔬 Diagnostics
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'experiments' ? 'active' : ''}`}
          onClick={() => setActiveTab('experiments')}
        >
          ⚖️ Compare ({experimentRuns.length})
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'documents' ? 'active' : ''}`}
          onClick={() => setActiveTab('documents')}
        >
          📁 Index Status
        </button>
        <button
          type="button"
          className={`tab-btn ${activeTab === 'raw' ? 'active' : ''}`}
          onClick={() => setActiveTab('raw')}
        >
          {'{ }'} Raw JSON
        </button>
      </div>

      <div className="inspector-tab-content">
        {activeTab === 'inspector' && (
          <StructuredResponseViewer log={latestLog} />
        )}

        {activeTab === 'diagnostics' && (
          <RetrievalDiagnosticsCard
            apiClient={apiClient}
            tenantId={tenantId}
            entityId={entityId}
            lastDiagnostics={lastDiag}
          />
        )}

        {activeTab === 'experiments' && (
          <div className="experiments-compare-panel">
            <div className="compare-header">
              <h4>Side-by-Side Retrieval Presets Comparison</h4>
              {experimentRuns.length > 0 && (
                <button type="button" className="btn-small" onClick={onClearRuns}>
                  Clear Runs
                </button>
              )}
            </div>

            {experimentRuns.length === 0 ? (
              <p className="hint">
                Send queries using different retrieval presets (Hybrid, Semantic Only, Keyword Only) to compare answers and citation quality side-by-side.
              </p>
            ) : (
              <div className="runs-compare-grid">
                {experimentRuns.map(run => (
                  <div key={run.id} className="run-card">
                    <div className="run-card-header">
                      <strong>{run.presetLabel}</strong>
                      <span className="run-meta">{run.durationMs}ms</span>
                    </div>
                    <div className="run-query">Q: "{run.query}"</div>
                    <div className="run-strategy">
                      Mode: <code>{run.retrievalMode}</code> | Top-K: <code>{run.topK}</code>
                    </div>
                    <div className="run-answer">{run.answer}</div>
                    <div className="run-citations">
                      Citations: <strong>{run.citations.length}</strong> | Confidence: <strong>{run.confidence}</strong>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'documents' && (
          <IngestionStatusViewer
            apiClient={apiClient}
            tenantId={tenantId}
            entityId={entityId}
          />
        )}

        {activeTab === 'raw' && (
          <div className="raw-json-sections">
            <RawJsonViewer data={latestLog?.requestBody} title="Sanitized Request Body" />
            <RawJsonViewer data={latestLog?.responseBody} title="Full Response Payload" />
          </div>
        )}
      </div>
    </div>
  );
};

