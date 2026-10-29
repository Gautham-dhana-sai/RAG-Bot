import {
  Controller,
  Post,
  Get,
  Param,
  Req,
  Body,
  UseInterceptors,
  UploadedFiles,
  HttpCode,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Request } from 'express';
import { z } from 'zod';
import { IngestionService } from './ingestion.service.js';
import { AuthService } from '../auth/auth.service.js';
import { UploadedFileItem } from './ingestion.types.js';
import { BadRequestError } from '../../shared/errors.js';

@ApiTags('Ingestion')
@Controller('v1/tenants/:tenantId/entities/:entityId/ingestion-jobs')
export class IngestionController {
  constructor(
    @Inject(IngestionService) private readonly ingestionService: IngestionService,
    @Inject(AuthService) private readonly authService: AuthService
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Submit files for asynchronous document ingestion' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(AnyFilesInterceptor())
  async submitIngestionJob(
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
    @Param('entityId') entityId: string,
    @UploadedFiles() uploadedFiles?: Express.Multer.File[],
    @Body() body?: any
  ) {
    const entity = await this.authService.authorizeEntityAccess(req.authContext!, tenantId, entityId, true);
    const filesToUpload: UploadedFileItem[] = [];

    // 1. Process multipart files if present
    if (uploadedFiles && uploadedFiles.length > 0) {
      for (const file of uploadedFiles) {
        filesToUpload.push({
          filename: file.originalname,
          mimeType: file.mimetype || 'text/plain',
          buffer: file.buffer,
          isPublic: entity.isPublic,
        });
      }
    }

    // 2. Process JSON payload with base64 / text files if present
    const payloadFiles = body?.files;
    if (Array.isArray(payloadFiles) && payloadFiles.length > 0) {
      const schema = z.object({
        files: z.array(
          z.object({
            filename: z.string(),
            mimeType: z.string().optional().default('text/plain'),
            content: z.string().optional(),
            contentBase64: z.string().optional(),
            isPublic: z.boolean().optional(),
          })
        ),
      });

      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        throw new BadRequestError('Invalid file payload format', parsed.error.format());
      }

      for (const f of parsed.data.files) {
        let buf: Buffer;
        if (f.contentBase64) {
          buf = Buffer.from(f.contentBase64, 'base64');
        } else if (f.content !== undefined) {
          buf = Buffer.from(f.content, 'utf-8');
        } else {
          continue;
        }

        filesToUpload.push({
          filename: f.filename,
          mimeType: f.mimeType,
          buffer: buf,
          isPublic: f.isPublic !== undefined ? f.isPublic : entity.isPublic,
        });
      }
    }

    if (filesToUpload.length === 0) {
      throw new BadRequestError('No files were received in the ingestion request.');
    }

    return this.ingestionService.submitIngestionJob({
      tenantId,
      entityId,
      files: filesToUpload,
    });
  }

  @Post('urls')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Submit document and image URLs for ingestion' })
  async submitUrls(
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
    @Param('entityId') entityId: string,
    @Body() body: any
  ) {
    const entity = await this.authService.authorizeEntityAccess(req.authContext!, tenantId, entityId, true);
    const rawUrls = Array.isArray(body)
      ? body
      : Array.isArray(body?.urls)
        ? body.urls
        : body?.url
          ? [body.url]
          : [];

    if (!Array.isArray(rawUrls) || rawUrls.length === 0) {
      throw new BadRequestError('Request must include a non-empty "urls" array.');
    }

    const schema = z.array(z.string().url('Each item must be a valid HTTP/HTTPS URL'));
    const parsed = schema.safeParse(rawUrls);
    if (!parsed.success) {
      throw new BadRequestError('Invalid URLs submitted', parsed.error.format());
    }

    return this.ingestionService.submitUrlIngestionJob({
      tenantId,
      entityId,
      urls: parsed.data,
      portfolioUrl: entity.portfolioUrl || entity.slug,
    });
  }

  @Get(':jobId')
  @ApiOperation({ summary: 'Get ingestion job status' })
  async getJobStatus(
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
    @Param('entityId') entityId: string,
    @Param('jobId') jobId: string
  ) {
    await this.authService.authorizeEntityAccess(req.authContext!, tenantId, entityId, false);
    const job = await this.ingestionService.getJob(tenantId, entityId, jobId);

    return {
      id: job.id,
      tenantId: job.tenantId,
      entityId: job.entityId,
      status: job.status,
      totalDocuments: job.totalDocuments,
      processedDocuments: job.processedDocuments,
      failedDocuments: job.failedDocuments,
      errorSummary: job.errorSummary,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    };
  }

  @Get(':jobId/documents')
  @ApiOperation({ summary: 'Get documents processed under an ingestion job' })
  async getJobDocuments(
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
    @Param('entityId') entityId: string,
    @Param('jobId') jobId: string
  ) {
    await this.authService.authorizeEntityAccess(req.authContext!, tenantId, entityId, false);
    return this.ingestionService.getJobDocuments(tenantId, entityId, jobId);
  }
}
