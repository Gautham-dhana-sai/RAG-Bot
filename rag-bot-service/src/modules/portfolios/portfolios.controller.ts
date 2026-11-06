import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Inject,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { Request, Response } from 'express';
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

  @Get([':portfolioReference/documents/:documentId/content', ':portfolioReference/documents/:documentId/view'])
  @ApiOperation({ summary: 'View or stream document content securely' })
  async viewDocumentContent(
    @Req() req: Request,
    @Res() res: Response,
    @Param('portfolioReference') portfolioReference: string,
    @Param('documentId') documentId: string
  ) {
    const { document, buffer } = await this.portfoliosService.getDocumentContent(
      req.authContext!,
      portfolioReference,
      documentId
    );
    res.setHeader('Content-Type', document.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(document.originalFilename)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  @Delete(':portfolioReference/documents/:documentId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a single document from a portfolio' })
  async deleteDocument(
    @Req() req: Request,
    @Param('portfolioReference') portfolioReference: string,
    @Param('documentId') documentId: string
  ) {
    return this.portfoliosService.deleteDocument(
      req.authContext!,
      portfolioReference,
      documentId
    );
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

  @Post([':portfolioReference/websites', ':portfolioReference/ingestion-websites'])
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Submit public website URLs for static HTML extraction and vector ingestion into a portfolio' })
  async submitWebsites(
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
      throw new BadRequestError('Request must include a valid "url" string or non-empty "urls" array.');
    }

    const schema = z.array(z.string().url('Each item must be a valid HTTP/HTTPS URL'));
    const parsed = schema.safeParse(rawUrls);
    if (!parsed.success) {
      throw new BadRequestError('Invalid website URLs submitted', parsed.error.format());
    }

    return this.portfoliosService.submitWebsiteIngestionJob(
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

  @Post([':portfolioReference/ask', ':portfolioReference/qa'])
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

  @Post([':portfolioReference/crawls', ':portfolioReference/crawl'])
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Start a multi-page static website crawl for a portfolio' })
  async startCrawl(
    @Req() req: Request,
    @Param('portfolioReference') portfolioReference: string,
    @Body() body: any
  ) {
    const rawUrl = body?.url || body?.rootUrl;
    if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
      throw new BadRequestError('Request must include a valid "url" string.');
    }

    const urlSchema = z.string().url('Must be a valid HTTP or HTTPS URL');
    const parsed = urlSchema.safeParse(rawUrl.trim());
    if (!parsed.success) {
      throw new BadRequestError('Invalid website root URL submitted', parsed.error.format());
    }

    const maxPages = body?.maxPages ? Number(body.maxPages) : undefined;
    const maxDepth = body?.maxDepth ? Number(body.maxDepth) : undefined;
    const selectedUrls = Array.isArray(body?.selectedUrls) ? body.selectedUrls.filter((u: any) => typeof u === 'string' && u.trim().length > 0) : undefined;

    return this.portfoliosService.startWebsiteCrawl(req.authContext!, portfolioReference, {
      url: parsed.data,
      maxPages,
      maxDepth,
      selectedUrls,
    });
  }

  @Get([':portfolioReference/crawls/:crawlJobId', ':portfolioReference/crawl/:crawlJobId'])
  @ApiOperation({ summary: 'Get status and discovered pages of a website crawl job' })
  async getCrawlJob(
    @Req() req: Request,
    @Param('portfolioReference') portfolioReference: string,
    @Param('crawlJobId') crawlJobId: string
  ) {
    return this.portfoliosService.getCrawlJob(req.authContext!, portfolioReference, crawlJobId);
  }

  @Get([':portfolioReference/crawls', ':portfolioReference/crawl'])
  @ApiOperation({ summary: 'List website crawl jobs for a portfolio' })
  async listCrawlJobs(
    @Req() req: Request,
    @Param('portfolioReference') portfolioReference: string
  ) {
    return this.portfoliosService.listCrawlJobs(req.authContext!, portfolioReference);
  }

  @Post([':portfolioReference/crawls/:crawlJobId/retry', ':portfolioReference/crawl/:crawlJobId/retry'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Retry failed or skipped pages within a crawl job' })
  async retryCrawlJob(
    @Req() req: Request,
    @Param('portfolioReference') portfolioReference: string,
    @Param('crawlJobId') crawlJobId: string,
    @Body() body?: any
  ) {
    return this.portfoliosService.retryCrawlJob(
      req.authContext!,
      portfolioReference,
      crawlJobId,
      body?.pageUrl || body?.url
    );
  }

  @Post([':portfolioReference/crawls/:crawlJobId/refetch', ':portfolioReference/crawl/:crawlJobId/refetch'])
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Initiate a content refetch for an existing website crawl' })
  async refetchCrawl(
    @Req() req: Request,
    @Param('portfolioReference') portfolioReference: string,
    @Param('crawlJobId') crawlJobId: string
  ) {
    return this.portfoliosService.refetchCrawl(
      req.authContext!,
      portfolioReference,
      crawlJobId
    );
  }

  @Post(':portfolioReference/check-duplicate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check for duplicate sources before ingestion' })
  async checkDuplicate(
    @Req() req: Request,
    @Param('portfolioReference') portfolioReference: string,
    @Body() body: { url?: string; filename?: string }
  ) {
    return this.portfoliosService.checkDuplicateSource(req.authContext!, portfolioReference, body);
  }

  @Post(':portfolioReference/crawls/discover')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Discover website routes without starting extraction' })
  async discoverRoutes(
    @Req() req: Request,
    @Param('portfolioReference') portfolioReference: string,
    @Body() body: { url: string; maxPages?: number; maxDepth?: number }
  ) {
    return this.portfoliosService.discoverWebsiteRoutes(req.authContext!, portfolioReference, body);
  }

  @Delete([':portfolioReference/crawls/:crawlJobId', ':portfolioReference/crawl/:crawlJobId'])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete an entire website crawl and all associated pages' })
  async deleteCrawl(
    @Req() req: Request,
    @Param('portfolioReference') portfolioReference: string,
    @Param('crawlJobId') crawlJobId: string
  ) {
    return this.portfoliosService.deleteCrawlJob(req.authContext!, portfolioReference, crawlJobId);
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

