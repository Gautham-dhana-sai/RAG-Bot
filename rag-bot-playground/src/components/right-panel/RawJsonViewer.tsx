import React from 'react';
import { CopyButton } from '../common/CopyButton';

interface Props {
  data: any;
  title: string;
}

export const RawJsonViewer: React.FC<Props> = ({ data, title }) => {
  const formatted = typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  return (
    <div className="json-viewer-card">
      <div className="json-viewer-header">
        <span className="json-title">{title}</span>
        <CopyButton textToCopy={formatted} label="Copy JSON" />
      </div>
      <pre className="json-pre-code">
        <code>{formatted || '(Empty)'}</code>
      </pre>
    </div>
  );
};

