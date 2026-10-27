import fs from 'fs';
import path from 'path';
import { IStorageAdapter } from './storage.interface.js';
import { logger } from '../../shared/logger.js';

export class LocalStorageAdapter implements IStorageAdapter {
  private baseDir: string;

  constructor(baseDir: string) {
    const isLambda = Boolean(process.env.LAMBDA_TASK_ROOT || process.env.AWS_LAMBDA_FUNCTION_NAME);
    let resolved = path.resolve(baseDir);
    // In AWS Lambda, /var/task is read-only; redirect local storage to writable /tmp
    if (isLambda && (resolved.startsWith('/var/task') || !resolved.startsWith('/tmp'))) {
      resolved = path.join('/tmp', 'data', 'storage');
    }
    this.baseDir = resolved;
    if (!fs.existsSync(this.baseDir)) {
      try {
        fs.mkdirSync(this.baseDir, { recursive: true });
      } catch (err: any) {
        logger.warn(`Could not create local storage directory at ${this.baseDir}: ${err.message}`);
      }
    }
    logger.info(`LocalStorageAdapter initialized at: ${this.baseDir}`);
  }

  private getFilePath(key: string): string {
    // Prevent path traversal
    const safeKey = key.replace(/(\.\.[\/\\])+/g, '');
    return path.join(this.baseDir, safeKey);
  }

  async uploadFile(key: string, buffer: Buffer, _contentType: string): Promise<string> {
    const fullPath = this.getFilePath(key);
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(fullPath, buffer);
    return key;
  }

  async downloadFile(key: string): Promise<Buffer> {
    const fullPath = this.getFilePath(key);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Local file not found at: ${fullPath}`);
    }
    return fs.readFileSync(fullPath);
  }

  async deleteFile(key: string): Promise<void> {
    const fullPath = this.getFilePath(key);
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }
  }

  async deleteFolder(prefix: string): Promise<void> {
    if (!prefix || prefix.trim() === '' || prefix === '/') {
      return;
    }
    const safePrefix = prefix.replace(/(\.\.[\/\\])+/g, '').replace(/^\/+|\/+$/g, '');
    const folderPath = path.join(this.baseDir, safePrefix);
    if (fs.existsSync(folderPath)) {
      try {
        fs.rmSync(folderPath, { recursive: true, force: true });
        logger.info(`Deleted local folder: ${folderPath}`);
      } catch (err: any) {
        logger.error(`Failed to delete local folder ${folderPath}: ${err.message}`);
      }
    }
  }

  async getPresignedUploadUrl(key: string, _contentType: string): Promise<{ uploadUrl: string; key: string }> {
    // For local development, return a local upload endpoint
    return {
      uploadUrl: `/v1/local-storage/upload?key=${encodeURIComponent(key)}`,
      key,
    };
  }
}

