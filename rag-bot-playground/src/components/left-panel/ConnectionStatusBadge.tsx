import React from 'react';
import { ConnectionState } from '../../types/config.types';

interface Props {
  connection: ConnectionState;
  onTest: () => void;
  isLoading: boolean;
}

export const ConnectionStatusBadge: React.FC<Props> = ({ connection, onTest, isLoading }) => {
  return (
    <div className="connection-box">
      <div className="connection-header">
        <span className="connection-title">API Connection</span>
        <button
          type="button"
          className="btn-test-conn"
          onClick={onTest}
          disabled={isLoading}
        >
          {isLoading ? 'Pinging...' : 'Test Connection'}
        </button>
      </div>

      <div className={`status-indicator status-${connection.status}`}>
        {connection.status === 'connected' && (
          <span>
            🟢 Connected ({connection.latencyMs}ms) • AI: {connection.aiProvider || 'mock'}
          </span>
        )}
        {connection.status === 'error' && (
          <span>🔴 Offline: {connection.error || 'Connection refused'}</span>
        )}
        {connection.status === 'untested' && <span>⚪ Untested</span>}
      </div>
    </div>
  );
};

