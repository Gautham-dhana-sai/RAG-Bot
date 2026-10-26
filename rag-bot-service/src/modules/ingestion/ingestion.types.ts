export interface UploadedFileItem {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  isPublic?: boolean;
}

export interface IngestionJobResponse {
  jobId: string;
  entityId: string;
  tenantId: string;
  status: string;
  totalDocuments: number;
  statusUrl: string;
  createdAt: string;
}

