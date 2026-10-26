import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RETRIEVAL_PRESETS } from '../../src/components/center-panel/RetrievalPresetsBar';
import { loadSavedConfig, saveConfig, defaultConfig } from '../../src/services/storage';

describe('Retrieval Presets & Local Configuration Storage', () => {
  let mockStore: Record<string, string> = {};

  beforeEach(() => {
    mockStore = {};
    (globalThis as any).localStorage = {
      getItem: (key: string) => mockStore[key] || null,
      setItem: (key: string, value: string) => {
        mockStore[key] = value;
      },
      removeItem: (key: string) => {
        delete mockStore[key];
      },
      clear: () => {
        mockStore = {};
      },
    };
  });

  afterEach(() => {
    delete (globalThis as any).localStorage;
  });

  it('provides all standard retrieval test presets with valid parameters', () => {
    expect(RETRIEVAL_PRESETS.length).toBeGreaterThanOrEqual(4);

    const hybridPreset = RETRIEVAL_PRESETS.find(p => p.id === 'default_hybrid');
    expect(hybridPreset).toBeDefined();
    expect(hybridPreset?.retrievalMode).toBe('hybrid');
    expect(hybridPreset?.topK).toBe(10);

    const densePreset = RETRIEVAL_PRESETS.find(p => p.id === 'dense_only');
    expect(densePreset).toBeDefined();
    expect(densePreset?.retrievalMode).toBe('dense');

    const sparsePreset = RETRIEVAL_PRESETS.find(p => p.id === 'sparse_only');
    expect(sparsePreset).toBeDefined();
    expect(sparsePreset?.retrievalMode).toBe('sparse');

    const highPrecisionPreset = RETRIEVAL_PRESETS.find(p => p.id === 'high_precision');
    expect(highPrecisionPreset).toBeDefined();
    expect(highPrecisionPreset?.minScore).toBeGreaterThan(0);
  });

  it('does NOT save bearer token when persistToken is false', () => {
    saveConfig({
      ...defaultConfig,
      token: 'secret-token-to-forget',
      persistToken: false,
    });

    const loaded = loadSavedConfig();
    expect(loaded.token).toBe(defaultConfig.token);
    expect(loaded.persistToken).toBe(false);
  });

  it('persists bearer token when persistToken is explicitly true', () => {
    saveConfig({
      ...defaultConfig,
      token: 'allowed-dev-token-xyz',
      persistToken: true,
    });

    const loaded = loadSavedConfig();
    expect(loaded.token).toBe('allowed-dev-token-xyz');
    expect(loaded.persistToken).toBe(true);
  });

  it('preserves other non-sensitive configuration regardless of opt-in', () => {
    saveConfig({
      ...defaultConfig,
      baseUrl: 'http://custom-host:8080',
      tenantId: 'custom-tenant',
      entityId: 'custom-entity',
      token: 'do-not-save',
      persistToken: false,
    });

    const loaded = loadSavedConfig();
    expect(loaded.baseUrl).toBe('http://custom-host:8080');
    expect(loaded.tenantId).toBe('custom-tenant');
    expect(loaded.entityId).toBe('custom-entity');
    expect(loaded.token).toBe(defaultConfig.token);
  });
});
