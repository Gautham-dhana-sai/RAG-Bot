import { IQueueAdapter, IngestionMessagePayload } from './queue.interface.js';
import { logger } from '../../shared/logger.js';

export class LocalQueueAdapter implements IQueueAdapter {
  private queue: IngestionMessagePayload[] = [];
  private handlers: Array<(payload: IngestionMessagePayload) => Promise<void>> = [];
  private processing = false;
  private isAutoProcess = true;

  constructor(autoProcess = true) {
    this.isAutoProcess = autoProcess;
  }

  async enqueueIngestionJob(payload: IngestionMessagePayload): Promise<void> {
    logger.debug(`[LocalQueue] Enqueued job: ${payload.jobId} for entity ${payload.entityId}`);
    this.queue.push(payload);
    if (this.isAutoProcess) {
      setImmediate(() => this.processNext());
    }
  }

  onMessage(handler: (payload: IngestionMessagePayload) => Promise<void>): void {
    this.handlers.push(handler);
    if (this.isAutoProcess && this.queue.length > 0) {
      setImmediate(() => this.processNext());
    }
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0 || this.handlers.length === 0) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const payload = this.queue.shift();
        if (!payload) break;

        for (const handler of this.handlers) {
          try {
            await handler(payload);
          } catch (err) {
            logger.error(`[LocalQueue] Error processing job ${payload.jobId}:`, err);
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }

  async pollMessages(limit = 10): Promise<{ messageId: string; receiptHandle: string; payload: IngestionMessagePayload }[]> {
    const messages: { messageId: string; receiptHandle: string; payload: IngestionMessagePayload }[] = [];
    for (let i = 0; i < limit && this.queue.length > 0; i++) {
      const payload = this.queue.shift()!;
      const id = Math.random().toString(36).substring(7);
      messages.push({
        messageId: id,
        receiptHandle: id,
        payload,
      });
    }
    return messages;
  }

  async deleteMessage(_receiptHandle: string): Promise<void> {
    // No-op for in-memory shift
  }
}

