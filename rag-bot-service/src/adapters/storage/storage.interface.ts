export interface IStorageAdapter {
  uploadFile(key: string, buffer: Buffer, contentType: string): Promise<string>;
  downloadFile(key: string): Promise<Buffer>;
  deleteFile(key: string): Promise<void>;
  deleteFolder?(prefix: string): Promise<void>;
  getPresignedUploadUrl?(key: string, contentType: string, expiresInSeconds?: number): Promise<{ uploadUrl: string; key: string }>;
}

