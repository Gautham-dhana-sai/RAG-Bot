import React from 'react';
import { InspectorLog } from '../../types/playground.types';
import { CopyButton } from '../common/CopyButton';

interface Props {
  log: InspectorLog | null;
}

export const StructuredResponseViewer: React.FC<Props> = ({ log }) => {
  if (!log) {
    return (
      <div className="inspector-empty-state">
        <p>No API requests captured yet. Send a query or click Test Connection.</p>
      </div>
    );
  }

  const isSuccess = log.status >= 200 && log.status < 300;

  return (
    <div className="structured-inspector">
      {/* Overview Status Banner */}
      <div className={`status-summary-bar ${isSuccess ? 'summary-success' : 'summary-error'}`}>
        <div className="summary-left">
          <span className="http-method">{log.method}</span>
          <span className="http-status">HTTP {log.status || 'ERR'}</span>
          <span className="http-duration">{log.durationMs}ms</span>
        </div>
        <div className="summary-right">
          <CopyButton textToCopy={log.curlCommand} label="Copy cURL" />
        </div>
      </div>

      <div className="endpoint-row">
        <label>Endpoint:</label>
        <code>{log.url}</code>
      </div>

      {/* Request Headers (Redacted) */}
      <div className="detail-collapsible">
        <div className="collapsible-header">
          <strong>Request Headers (Sanitized):</strong>
        </div>
        <pre className="code-block">
          <code>{JSON.stringify(log.requestHeaders, null, 2)}</code>
        </pre>
      </div>

      {/* Request Body */}
      {log.requestBody !== undefined && (
        <div className="detail-collapsible">
          <div className="collapsible-header">
            <strong>Request Payload:</strong>
            <CopyButton textToCopy={JSON.stringify(log.requestBody, null, 2)} label="Copy Payload" />
          </div>
          <pre className="code-block">
            <code>{JSON.stringify(log.requestBody, null, 2)}</code>
          </pre>
        </div>
      )}

      {/* Response Body */}
      <div className="detail-collapsible">
        <div className="collapsible-header">
          <strong>Response Body:</strong>
          <CopyButton textToCopy={JSON.stringify(log.responseBody, null, 2)} label="Copy Response" />
        </div>
        <pre className="code-block">
          <code>{JSON.stringify(log.responseBody, null, 2)}</code>
        </pre>
      </div>

      {/* cURL Command */}
      <div className="detail-collapsible">
        <div className="collapsible-header">
          <strong>cURL Command (Safe Placeholder):</strong>
        </div>
        <pre className="code-block curl-block">
          <code>{log.curlCommand}</code>
        </pre>
      </div>
    </div>
  );
};

