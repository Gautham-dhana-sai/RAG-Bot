import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  Inject,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Request } from 'express';
import { z } from 'zod';
import { PortfoliosService } from './portfolios.service.js';
import { BadRequestError } from '../../shared/errors.js';
import { UploadedFileItem } from '../ingestion/ingestion.types.js';

@ApiTags('Portals & Ingestion')
@Controller(['v1/portals', 'v1/portfolios'])
export class PortfoliosController {
  constructor(
    @Inject(PortfoliosService) private readonly portfoliosService: PortfoliosService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all portfolios owned by the authenticated user' })
  async listPortfolios(@Req() req: Request) {
    return this.portfoliosService.listPortfolios(req.authContext!);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create or register a portfolio by URL' })
  async createPortfolio(@Req() req: Request, @Body() body: any) {
    const schema = z.object({
      url: z.string().min(1, 'Portfolio URL is required'),
      name: z.string().optional(),
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid portfolio payload', parsed.error.format());
    }

    return this.portfoliosService.createPortfolio(req.authContext!, parsed.data);
  }

  @Get(':portfolioReference')
  @ApiOperation({ summary: 'Get details of a portfolio by ID, slug, or normalized URL' })
  async getPortfolio(
    @Req() req: Request,
    @Param('portfolioReference') portfolioReference: string
  ) {
    return this.portfoliosService.getPortfolio(req.authContext!, portfolioReference);
  }

  @Get(':portfolioReference/documents')
  @ApiOperation({ summary: 'List documents for a portfolio' })
  async listDocuments(
    @Req() req: Request,
    @Param('portfolioReference') portfolioReference: string
  ) {
    return this.portfoliosService.listDocuments(req.authContext!, portfolioReference);
  }

  @Post(':portfolioReference/ingestion-jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Upload documents for ingestion into a portfolio' })
  @ApiConsumes('multipart/form-data', 'application/json')
  @UseInterceptors(AnyFilesInterceptor())
  async submitIngestionJob(
    @Req() req: Request,
    @Param('portfolioReference') portfolioReference: string,
    @UploadedFiles() uploadedFiles?: Express.Multer.File[],
    @Body() body?: any
  ) {
    const filesToUpload: UploadedFileItem[] = [];

    // 1. Process multipart files
    if (uploadedFiles && uploadedFiles.length > 0) {
      for (const file of uploadedFiles) {
        filesToUpload.push({
          filename: file.originalname,
          mimeType: file.mimetype || 'text/plain',
          buffer: file.buffer,
          isPublic: true,
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
          isPublic: f.isPublic !== undefined ? f.isPublic : true,
        });
      }
    }

    if (filesToUpload.length === 0) {
      throw new BadRequestError('No files were received in the ingestion request.');
    }

    return this.portfoliosService.submitIngestionJob(req.authContext!, portfolioReference, filesToUpload);
  }

  @Post([':portfolioReference/urls', ':portfolioReference/ingestion-urls'])
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Submit document and image URLs for ingestion into a portfolio' })
  async submitUrls(
    @Req() req: Request,
    @Param('portfolioReference') portfolioReference: string,
    @Body() body: any
  ) {
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

    return this.portfoliosService.submitUrlIngestionJob(
      req.authContext!,
      portfolioReference,
      parsed.data
    );
  }

  @Get(':portfolioReference/ingestion-jobs/:jobId')
  @ApiOperation({ summary: 'Get status of an ingestion job for a portfolio' })
  async getJobStatus(
    @Req() req: Request,
    @Param('portfolioReference') portfolioReference: string,
    @Param('jobId') jobId: string
  ) {
    return this.portfoliosService.getJobStatus(req.authContext!, portfolioReference, jobId);
  }

  @Post(':portfolioReference/ask')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask question and verify portfolio retrieval' })
  async askQuestion(
    @Req() req: Request,
    @Param('portfolioReference') portfolioReference: string,
    @Body() body: any
  ) {
    const question = body?.question || body?.content || (typeof body === 'string' ? body : '');
    if (!question || typeof question !== 'string' || !question.trim()) {
      throw new BadRequestError('Question is required');
    }

    return this.portfoliosService.askQuestion(req.authContext!, portfolioReference, question.trim());
  }

  @Delete(':portfolioReference')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a registered portfolio and all associated files/folders in S3 bucket' })
  async deletePortfolio(
    @Req() req: Request,
    @Param('portfolioReference') portfolioReference: string
  ) {
    return this.portfoliosService.deletePortfolio(req.authContext!, portfolioReference);
  }
}

export const PortalsController = PortfoliosController;
export type PortalsController = PortfoliosController;

