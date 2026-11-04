export interface IngestionMessagePayload {
  tenantId: string;
  entityId: string;
  jobId: string;
  documentId?: string;
  attempt?: number;
}

export type UrlDownloadAction =
  | 'WEBSITE_CRAWL'
  | 'WEBSITE_PAGE'
  | 'crawl_coordinator'
  | 'process_page';

export interface UrlDownloadMessagePayload {
  tenantId: string;
  entityId: string;
  jobId: string;
  documentId?: string;
  url: string;
  portfolioUrl?: string;
  sourceType?: 'file' | 'website' | 'website_crawl';
  crawlJobId?: string;
  action?: UrlDownloadAction;
  depth?: number;
  attempt?: number;
}

export interface IQueueAdapter {
  enqueueIngestionJob(payload: IngestionMessagePayload): Promise<void>;
  enqueueUrlDownloadJob(payload: UrlDownloadMessagePayload): Promise<void>;
  pollMessages?(limit?: number): Promise<{ messageId: string; receiptHandle: string; payload: IngestionMessagePayload }[]>;
  pollUrlDownloadMessages?(limit?: number): Promise<{ messageId: string; receiptHandle: string; payload: UrlDownloadMessagePayload }[]>;
  deleteMessage?(receiptHandle: string): Promise<void>;
  onMessage?(handler: (payload: IngestionMessagePayload) => Promise<void>): void;
  onUrlDownloadMessage?(handler: (payload: UrlDownloadMessagePayload) => Promise<void>): void;
}
