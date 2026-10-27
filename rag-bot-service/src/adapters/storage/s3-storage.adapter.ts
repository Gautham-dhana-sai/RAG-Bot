import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import { IStorageAdapter } from './storage.interface.js';
import { Readable } from 'stream';
import { logger } from '../../shared/logger.js';

export class S3StorageAdapter implements IStorageAdapter {
  private client: S3Client;
  private bucket: string;

  constructor(
    bucket: string,
    region: string,
    credentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
  ) {
    this.bucket = bucket;
    const clientConfig: any = { region };
    if (credentials?.accessKeyId && credentials?.secretAccessKey) {
      clientConfig.credentials = {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        ...(credentials.sessionToken ? { sessionToken: credentials.sessionToken } : {}),
      };
    }
    this.client = new S3Client(clientConfig);
    logger.info(`S3StorageAdapter initialized for bucket "${this.bucket}" (region: ${region})`);
  }

  async uploadFile(key: string, buffer: Buffer, contentType: string): Promise<string> {
    const cmd = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });
    await this.client.send(cmd);
    logger.info(`Successfully uploaded to S3: s3://${this.bucket}/${key} (${buffer.length} bytes)`);
    return key;
  }

  async downloadFile(key: string): Promise<Buffer> {
    const cmd = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const res = await this.client.send(cmd);
    if (!res.Body) {
      throw new Error(`S3 object body empty for key: ${key}`);
    }

    const stream = res.Body as Readable;
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
      stream.on('error', err => reject(err));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  async deleteFile(key: string): Promise<void> {
    const cmd = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.client.send(cmd);
    logger.info(`Deleted from S3: s3://${this.bucket}/${key}`);
  }

  async deleteFolder(prefix: string): Promise<void> {
    if (!prefix || prefix.trim() === '' || prefix === '/') {
      return;
    }
    // S3 prefixes should not start with leading slash
    const cleanPrefix = prefix.replace(/^\/+/, '');
    logger.info(`Deleting folder prefix from S3: s3://${this.bucket}/${cleanPrefix}`);

    try {
      let continuationToken: string | undefined = undefined;
      do {
        const listCmd: ListObjectsV2Command = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: cleanPrefix,
          ContinuationToken: continuationToken,
        });
        const listRes: ListObjectsV2CommandOutput = await this.client.send(listCmd);
        const objects = listRes.Contents?.map((item: any) => ({ Key: item.Key! })).filter((item: any) => Boolean(item.Key)) || [];

        if (objects.length > 0) {
          const deleteCmd = new DeleteObjectsCommand({
            Bucket: this.bucket,
            Delete: {
              Objects: objects,
              Quiet: true,
            },
          });
          await this.client.send(deleteCmd);
          logger.info(`Deleted ${objects.length} objects from S3 under prefix "${cleanPrefix}"`);
        }

        continuationToken = listRes.IsTruncated ? listRes.NextContinuationToken : undefined;
      } while (continuationToken);
    } catch (err: any) {
      logger.error(`Error deleting folder prefix "${cleanPrefix}" from S3: ${err.message}`, err);
      throw err;
    }
  }
}
