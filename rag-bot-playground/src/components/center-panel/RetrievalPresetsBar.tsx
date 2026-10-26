import React from 'react';
import { RetrievalPreset } from '../../types/playground.types';

export const RETRIEVAL_PRESETS: RetrievalPreset[] = [
  {
    id: 'default_hybrid',
    label: 'Hybrid (Dense + FTS)',
    description: 'pgvector semantic search + full-text search with Reciprocal Rank Fusion',
    topK: 10,
    retrievalMode: 'hybrid',
    minScore: 0.005,
  },
  {
    id: 'dense_only',
    label: 'Semantic Only',
    description: 'Pure pgvector cosine similarity ranking',
    topK: 10,
    retrievalMode: 'dense',
    minScore: 0.005,
  },
  {
    id: 'sparse_only',
    label: 'Keyword Only',
    description: 'Pure PostgreSQL tsvector full-text search',
    topK: 10,
    retrievalMode: 'sparse',
    minScore: 0.005,
  },
  {
    id: 'high_recall',
    label: 'Expanded Candidates (topK=20)',
    description: 'Larger candidate pool with lower score threshold',
    topK: 20,
    retrievalMode: 'hybrid',
    minScore: 0.001,
  },
  {
    id: 'high_precision',
    label: 'Strict Precision (topK=5)',
    description: 'Higher relevance threshold with top 5 candidates',
    topK: 5,
    retrievalMode: 'hybrid',
    minScore: 0.02,
  },
];

interface Props {
  selectedPreset: RetrievalPreset;
  onSelectPreset: (preset: RetrievalPreset) => void;
  topK: number;
  onTopKChange: (topK: number) => void;
  retrievalMode: 'hybrid' | 'dense' | 'sparse';
  onModeChange: (mode: 'hybrid' | 'dense' | 'sparse') => void;
}

export const RetrievalPresetsBar: React.FC<Props> = ({
  selectedPreset,
  onSelectPreset,
  topK,
  onTopKChange,
  retrievalMode,
  onModeChange,
}) => {
  return (
    <div className="presets-bar">
      <div className="presets-header">
        <span className="presets-title">Retrieval Presets:</span>
        <div className="preset-pill-list">
          {RETRIEVAL_PRESETS.map(preset => (
            <button
              key={preset.id}
              type="button"
              className={`preset-pill ${selectedPreset.id === preset.id ? 'active' : ''}`}
              onClick={() => onSelectPreset(preset)}
              title={preset.description}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="presets-custom-row">
        <span className="custom-label">Active Strategy:</span>
        <select
          className="mode-select"
          value={retrievalMode}
          onChange={e => onModeChange(e.target.value as any)}
        >
          <option value="hybrid">Hybrid (pgvector + FTS)</option>
          <option value="dense">Dense Vector Only</option>
          <option value="sparse">Sparse Keyword Only</option>
        </select>

        <span className="custom-label">Top-K:</span>
        <input
          type="number"
          className="topk-input"
          value={topK}
          onChange={e => onTopKChange(Math.max(1, parseInt(e.target.value) || 10))}
          min={1}
          max={50}
        />
      </div>
    </div>
  );
};

