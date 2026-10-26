export interface IngestionMessagePayload {
  tenantId: string;
  entityId: string;
  jobId: string;
  documentId?: string;
  attempt?: number;
}

export interface IQueueAdapter {
  enqueueIngestionJob(payload: IngestionMessagePayload): Promise<void>;
  pollMessages?(limit?: number): Promise<{ messageId: string; receiptHandle: string; payload: IngestionMessagePayload }[]>;
  deleteMessage?(receiptHandle: string): Promise<void>;
  onMessage?(handler: (payload: IngestionMessagePayload) => Promise<void>): void;
}

