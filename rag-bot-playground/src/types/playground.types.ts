import { AnswerCitation } from './api.types';

export interface InspectorLog {
  timestamp: string;
  method: string;
  url: string;
  status: number;
  durationMs: number;
  requestHeaders: Record<string, string>;
  requestBody?: any;
  responseHeaders: Record<string, string>;
  responseBody?: any;
  curlCommand: string;
  isError: boolean;
}

export interface RetrievalPreset {
  id: string;
  label: string;
  description: string;
  topK: number;
  retrievalMode: 'hybrid' | 'dense' | 'sparse';
  minScore: number;
}

export interface ExperimentRun {
  id: string;
  presetLabel: string;
  query: string;
  retrievalMode: string;
  topK: number;
  minScore: number;
  durationMs: number;
  answer: string;
  citations: AnswerCitation[];
  insufficientEvidence: boolean;
  confidence: number;
  retrievedCount?: number;
  rewrittenQuery?: string;
}

