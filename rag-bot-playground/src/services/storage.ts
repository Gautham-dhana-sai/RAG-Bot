import { RequestConfig } from '../types/config.types';

const STORAGE_KEY_CONFIG = 'personarag_playground_config_v1';
const STORAGE_KEY_TOKEN = 'personarag_playground_token_optin_v1';

export const defaultConfig: RequestConfig = {
  baseUrl: 'http://localhost:3000',
  authMode: 'bearer',
  token: 'dev-persona-rag-secret-token-change-in-prod',
  tenantId: '0164d75c-ad5a-4a6b-98a9-7ec4aacd0529',
  entityId: 'e29fa525-0079-44c0-b5f5-183a8b4e093d',
  conversationId: '',
  userId: 'alex-admin-user',
  timeoutMs: 15000,
  persistToken: false, // Never persist tokens by default
};

function getStorage(): Storage | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis !== 'undefined' && (globalThis as any).localStorage) {
    return (globalThis as any).localStorage;
  }
  return null;
}

export function loadSavedConfig(): RequestConfig {
  try {
    const storage = getStorage();
    if (!storage) return { ...defaultConfig };

    const raw = storage.getItem(STORAGE_KEY_CONFIG);
    const parsed = raw ? JSON.parse(raw) : {};

    // Only load token from storage if explicitly opted in
    let savedToken = defaultConfig.token;
    const persistToken = parsed.persistToken === true;
    if (persistToken) {
      savedToken = storage.getItem(STORAGE_KEY_TOKEN) || defaultConfig.token;
    }

    return {
      ...defaultConfig,
      ...parsed,
      token: savedToken,
      persistToken,
    };
  } catch {
    return { ...defaultConfig };
  }
}

export function saveConfig(config: RequestConfig): void {
  try {
    const storage = getStorage();
    if (!storage) return;

    // Strip sensitive token from general config object
    const { token, ...safeConfig } = config;
    storage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(safeConfig));

    if (config.persistToken && token) {
      storage.setItem(STORAGE_KEY_TOKEN, token);
    } else {
      storage.removeItem(STORAGE_KEY_TOKEN);
    }
  } catch (err) {
    console.warn('Failed to save config to localStorage:', err);
  }
}

export function clearSavedToken(): void {
  const storage = getStorage();
  storage?.removeItem(STORAGE_KEY_TOKEN);
}

export function clearAllSavedConfig(): void {
  const storage = getStorage();
  storage?.removeItem(STORAGE_KEY_CONFIG);
  storage?.removeItem(STORAGE_KEY_TOKEN);
}
