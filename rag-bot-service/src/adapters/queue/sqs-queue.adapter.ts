import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
} from '@aws-sdk/client-sqs';
import { IQueueAdapter, IngestionMessagePayload, UrlDownloadMessagePayload } from './queue.interface.js';
import { logger } from '../../shared/logger.js';

export class SqsQueueAdapter implements IQueueAdapter {
  private client: SQSClient;
  private queueUrl: string;
  private urlDownloadQueueUrl: string;

  constructor(queueUrl: string, region: string, urlDownloadQueueUrl = '') {
    this.queueUrl = queueUrl;
    this.urlDownloadQueueUrl = urlDownloadQueueUrl;
    this.client = new SQSClient({ region });
  }

  async enqueueIngestionJob(payload: IngestionMessagePayload): Promise<void> {
    const isFifo = this.queueUrl.endsWith('.fifo');
    const cmd = new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(payload),
      ...(isFifo
        ? {
            MessageGroupId: `${payload.tenantId}-${payload.entityId}`,
            MessageDeduplicationId: `${payload.jobId}-${payload.documentId || 'all'}-${Date.now()}`,
          }
        : {}),
    });

    await this.client.send(cmd);
    logger.info(`[SQS] Sent ingestion message for job: ${payload.jobId}`);
  }

  async enqueueUrlDownloadJob(payload: UrlDownloadMessagePayload): Promise<void> {
    const targetQueueUrl = this.urlDownloadQueueUrl || this.queueUrl;
    const isFifo = targetQueueUrl.endsWith('.fifo');
    const cmd = new SendMessageCommand({
      QueueUrl: targetQueueUrl,
      MessageBody: JSON.stringify(payload),
      ...(isFifo
        ? {
            MessageGroupId: `${payload.tenantId}-${payload.entityId}`,
            MessageDeduplicationId: `${payload.jobId}-${payload.documentId}-${Date.now()}`,
          }
        : {}),
    });

    await this.client.send(cmd);
    logger.info(`[SQS] Sent URL download message for job: ${payload.jobId} (doc: ${payload.documentId})`);
  }

  async pollMessages(limit = 10): Promise<{ messageId: string; receiptHandle: string; payload: IngestionMessagePayload }[]> {
    const cmd = new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: Math.min(limit, 10),
      WaitTimeSeconds: 5,
    });

    const res = await this.client.send(cmd);
    if (!res.Messages || res.Messages.length === 0) return [];

    return res.Messages.map(m => ({
      messageId: m.MessageId || '',
      receiptHandle: m.ReceiptHandle || '',
      payload: JSON.parse(m.Body || '{}') as IngestionMessagePayload,
    }));
  }

  async pollUrlDownloadMessages(limit = 10): Promise<{ messageId: string; receiptHandle: string; payload: UrlDownloadMessagePayload }[]> {
    const targetQueueUrl = this.urlDownloadQueueUrl || this.queueUrl;
    const cmd = new ReceiveMessageCommand({
      QueueUrl: targetQueueUrl,
      MaxNumberOfMessages: Math.min(limit, 10),
      WaitTimeSeconds: 5,
    });

    const res = await this.client.send(cmd);
    if (!res.Messages || res.Messages.length === 0) return [];

    return res.Messages.map(m => ({
      messageId: m.MessageId || '',
      receiptHandle: m.ReceiptHandle || '',
      payload: JSON.parse(m.Body || '{}') as UrlDownloadMessagePayload,
    }));
  }

  async deleteMessage(receiptHandle: string): Promise<void> {
    const cmd = new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    });
    await this.client.send(cmd);
  }
}

