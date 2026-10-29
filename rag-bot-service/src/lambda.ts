import { configure } from '@codegenie/serverless-express';
import { createNestApp } from './app.js';
import { logger } from './shared/logger.js';
import { IngestionMessagePayload, UrlDownloadMessagePayload } from './adapters/queue/queue.interface.js';
import { DownloadWorker } from './modules/downloader/download-worker.js';

let serverlessExpressInstance: any = null;
let ingestionServiceInstance: any = null;
let downloadWorkerInstance: any = null;

async function bootstrap() {
  if (!serverlessExpressInstance) {
    logger.info('[BOOTSTRAP] Initializing Nest application in Lambda environment...');
    try {
      const { app, db, storage, queue, ingestionService } = await createNestApp();
      logger.info('[BOOTSTRAP] Calling app.init()...');
      await app.init();
      logger.info('[BOOTSTRAP] app.init() finished. Configuring serverless-express...');
      const expressApp = app.getHttpAdapter().getInstance();
      serverlessExpressInstance = configure({ app: expressApp });
      ingestionServiceInstance = ingestionService;
      downloadWorkerInstance = new DownloadWorker(db, storage, queue);
      logger.info('[BOOTSTRAP] Bootstrap completed successfully.');
    } catch (bootstrapErr: any) {
      logger.error('[BOOTSTRAP_ERROR] Fatal error during bootstrap:', bootstrapErr);
      logger.error(`[BOOTSTRAP_ERROR] Message: ${bootstrapErr?.message || bootstrapErr}`);
      if (bootstrapErr?.stack) {
        logger.error(`[BOOTSTRAP_ERROR] Stack: ${bootstrapErr.stack}`);
      }
      throw bootstrapErr;
    }
  }
  return { serverlessExpressInstance, ingestionServiceInstance, downloadWorkerInstance };
}

function isValidUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * Main Lambda Handler: Pure modern async/await (NO callback parameter to prevent Runtime.CallbackHandlerDeprecated).
 * Automatically routes API Gateway HTTP requests and SQS/SNS message consumption records.
 */
export const handler = async (event: any, context?: any) => {
  if (context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  const remainingMs = context?.getRemainingTimeInMillis ? context.getRemainingTimeInMillis() : 'N/A';
  logger.info(`[LAMBDA_HANDLER] Invoked. RemainingTime: ${remainingMs}ms. Event keys: ${Object.keys(event || {}).join(', ')}`);

  // If this is an SQS or event-driven trigger (consuming messages)
  if (event?.Records && Array.isArray(event.Records)) {
    logger.info(`[LAMBDA_HANDLER] Event contains ${event.Records.length} record(s). Routing to sqsIngestionHandler.`);
    return sqsIngestionHandler(event, context);
  }

  try {
    const { serverlessExpressInstance } = await bootstrap();
    return await serverlessExpressInstance(event, context);
  } catch (httpErr: any) {
    logger.error('[LAMBDA_HANDLER_ERROR] Error handling request:', httpErr);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: 'InternalServerError',
        message: httpErr?.message || 'Lambda execution error',
      }),
    };
  }
};

/**
 * SQS-triggered Lambda Worker Handler for asynchronous document ingestion.
 * Uses pure async/await with 0 or 2 parameters (never 3) to comply with AWS Lambda Node.js requirements.
 */
export const sqsIngestionHandler = async (event: any, context?: any) => {
  if (context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  const remainingMs = context?.getRemainingTimeInMillis ? context.getRemainingTimeInMillis() : 'N/A';
  const records = event?.Records || [];
  logger.info(`[SQS Worker] Invocation started with ${records.length} record(s). Remaining execution time: ${remainingMs}ms.`);

  let ingestionService: any = null;
  try {
    const bootstrapped = await bootstrap();
    ingestionService = bootstrapped.ingestionServiceInstance;
  } catch (bootErr: any) {
    logger.error('[SQS Worker] Cannot process records because bootstrap failed:', bootErr);
    // Return 200 with error summary to AWS so that SQS doesn't retry infinitely on misconfiguration
    return {
      statusCode: 500,
      error: bootErr?.message || 'Bootstrap failure',
      message: 'Failed to initialize database or dependencies. Check CloudWatch logs for connection diagnostics.',
    };
  }

  for (let idx = 0; idx < records.length; idx++) {
    const record = records[idx];
    const receiveCount = record?.attributes?.ApproximateReceiveCount || '1';
    logger.info(`[SQS Worker] Processing record [${idx + 1}/${records.length}] (MessageId: ${record.messageId}, ReceiveCount: ${receiveCount})`);

    let rawPayload: any;
    try {
      rawPayload = typeof record.body === 'string' ? JSON.parse(record.body) : record.body;

      // Handle SNS-wrapped SQS message bodies
      if (rawPayload && typeof rawPayload.Message === 'string') {
        try {
          rawPayload = JSON.parse(rawPayload.Message);
        } catch {
          // ignore
        }
      }

      // Handle S3 Test Events (e.g. from AWS Console)
      if (rawPayload?.Event === 's3:TestEvent' || rawPayload?.Service === 'Amazon S3') {
        logger.info('[SQS Worker] Received S3 test event ping. Skipping safely.');
        continue;
      }

      // Handle S3 Event Notifications (s3:ObjectCreated)
      if (rawPayload?.Records?.[0]?.eventSource === 'aws:s3' || rawPayload?.Records?.[0]?.s3) {
        for (const s3Record of rawPayload.Records) {
          if (s3Record.s3 && s3Record.s3.object) {
            const rawKey = s3Record.s3.object.key || '';
            const objectKey = decodeURIComponent(rawKey).replace(/\+/g, ' ');
            logger.info(`[SQS Worker] Received S3 ObjectCreated notification for key: "${objectKey}". Invoking ingestion pipeline...`);
            await ingestionService.processS3ObjectCreated(objectKey);
          }
        }
        continue;
      }

      // Handle non-object or empty payload
      if (typeof rawPayload !== 'object' || rawPayload === null) {
        logger.warn(`[SQS Worker] Received non-object SQS message body: "${rawPayload}". Skipping safely to prevent retry loop.`);
        continue;
      }

      // Validate that message is a valid application ingestion job payload
      const payload: IngestionMessagePayload = rawPayload;
      if (!payload.jobId || !isValidUuid(payload.jobId)) {
        logger.warn(`[SQS Worker] SQS message lacks valid UUID jobId (${payload?.jobId}), skipping safely to clear message: ${JSON.stringify(rawPayload)}`);
        continue;
      }

      logger.info(`[SQS Worker] Beginning processing for job ${payload.jobId} (entity: ${payload.entityId}, tenant: ${payload.tenantId})...`);
      await ingestionService.processJob(payload);
      logger.info(`[SQS Worker] Successfully finished processing for job ${payload.jobId}`);
    } catch (err: any) {
      logger.error(`[SQS Worker] Failed to process SQS ingestion record:`, err);
      if (err?.stack) {
        logger.error(`[SQS Worker] Error stack trace: ${err.stack}`);
      }
      // We log the full error stack and acknowledge the message rather than re-throwing.
      // Re-throwing causes AWS SQS to keep the message "in flight" and continuously retry in an infinite loop.
    }
  }

  logger.info(`[SQS Worker] Finished batch of ${records.length} record(s). Returning success to acknowledge and delete message(s).`);
  return { statusCode: 200, message: 'Ingestion records processed successfully' };
};

/**
 * Dedicated SQS-triggered Lambda Worker Handler for asynchronous URL downloading.
 * Downloads file securely, validates content signature/format/size, and uploads to S3.
 * Downstream S3 ObjectCreated event notification then triggers sqsIngestionHandler.
 */
export const downloadWorkerHandler = async (event: any, context?: any) => {
  if (context) {
    context.callbackWaitsForEmptyEventLoop = false;
  }

  const remainingMs = context?.getRemainingTimeInMillis ? context.getRemainingTimeInMillis() : 'N/A';
  const records = event?.Records || [];
  logger.info(`[Download Worker] Invocation started with ${records.length} record(s). Remaining time: ${remainingMs}ms.`);

  let downloadWorker: any = null;
  try {
    const bootstrapped = await bootstrap();
    downloadWorker = bootstrapped.downloadWorkerInstance;
  } catch (bootErr: any) {
    logger.error('[Download Worker] Cannot process records because bootstrap failed:', bootErr);
    return {
      statusCode: 500,
      error: bootErr?.message || 'Bootstrap failure',
      message: 'Failed to initialize database or dependencies. Check CloudWatch logs for connection diagnostics.',
    };
  }

  for (let idx = 0; idx < records.length; idx++) {
    const record = records[idx];
    const receiveCount = record?.attributes?.ApproximateReceiveCount || '1';
    logger.info(`[Download Worker] Processing record [${idx + 1}/${records.length}] (MessageId: ${record.messageId}, ReceiveCount: ${receiveCount})`);

    let rawPayload: any;
    try {
      rawPayload = typeof record.body === 'string' ? JSON.parse(record.body) : record.body;

      if (rawPayload && typeof rawPayload.Message === 'string') {
        try {
          rawPayload = JSON.parse(rawPayload.Message);
        } catch {}
      }

      const payload: UrlDownloadMessagePayload = rawPayload;
      if (!payload.jobId || !payload.url) {
        logger.warn(`[Download Worker] Skipping invalid download message body: ${JSON.stringify(rawPayload)}`);
        continue;
      }

      logger.info(`[Download Worker] Downloading URL for document ${payload.documentId} (job: ${payload.jobId})...`);
      await downloadWorker.processDownloadJob(payload);
      logger.info(`[Download Worker] Finished processing download for document ${payload.documentId}`);
    } catch (err: any) {
      logger.error(`[Download Worker] Failed to process URL download record (docId: ${rawPayload?.documentId}):`, err);
      if (err?.stack) {
        logger.error(`[Download Worker] Error stack trace: ${err.stack}`);
      }
    }
  }

  logger.info(`[Download Worker] Finished batch of ${records.length} record(s).`);
  return { statusCode: 200, message: 'URL download records processed successfully' };
};

// Aliases for flexibility in AWS Lambda console configuration
export const ingestionHandler = sqsIngestionHandler;
export const sqsDownloadHandler = downloadWorkerHandler;
export const urlDownloadHandler = downloadWorkerHandler;
