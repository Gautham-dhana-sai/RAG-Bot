export type AuthMode = 'bearer' | 'dev_headers' | 'public_anonymous';

export interface RequestConfig {
  baseUrl: string;
  authMode: AuthMode;
  token: string;
  tenantId: string;
  entityId: string;
  conversationId: string;
  userId: string;
  timeoutMs: number;
  persistToken: boolean;
}

export interface ConnectionState {
  status: 'untested' | 'connected' | 'error';
  latencyMs?: number;
  version?: string;
  aiProvider?: string;
  error?: string;
}

