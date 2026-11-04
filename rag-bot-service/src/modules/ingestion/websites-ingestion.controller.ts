import { Controller, Post, Get, Body, Req, Param, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { z } from 'zod';
import { PortfoliosService } from '../portfolios/portfolios.service.js';
import { BadRequestError } from '../../shared/errors.js';

@ApiTags('Websites Ingestion')
@Controller(['api/ingestion/websites', 'v1/ingestion/websites'])
export class WebsitesIngestionController {
  constructor(
    @Inject(PortfoliosService) private readonly portfoliosService: PortfoliosService
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Submit a public website URL for static extraction and vector ingestion' })
  async submitWebsite(
    @Req() req: Request,
    @Body() body: any
  ) {
    const portfolioReference =
      body?.portfolioId ||
      body?.portfolioReference ||
      body?.portalId ||
      body?.entityId;

    if (!portfolioReference || typeof portfolioReference !== 'string') {
      throw new BadRequestError('Request must include "portfolioId" identifying the target portfolio.');
    }

    const rawUrl = body?.url;
    if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
      throw new BadRequestError('Request must include a valid "url" string.');
    }

    const urlSchema = z.string().url('Must be a valid HTTP or HTTPS URL');
    const parsed = urlSchema.safeParse(rawUrl.trim());
    if (!parsed.success) {
      throw new BadRequestError('Invalid website URL submitted', parsed.error.format());
    }

    return this.portfoliosService.submitWebsiteIngestionJob(
      req.authContext!,
      portfolioReference,
      [parsed.data]
    );
  }

  @Post(['crawls', 'crawl'])
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Start a multi-page static website crawl' })
  async startCrawl(
    @Req() req: Request,
    @Body() body: any
  ) {
    const portfolioReference =
      body?.portfolioId ||
      body?.portfolioReference ||
      body?.portalId ||
      body?.entityId;

    if (!portfolioReference || typeof portfolioReference !== 'string') {
      throw new BadRequestError('Request must include "portfolioId" identifying the target portfolio.');
    }

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

    return this.portfoliosService.startWebsiteCrawl(req.authContext!, portfolioReference, {
      url: parsed.data,
      maxPages,
      maxDepth,
    });
  }

  @Get('crawls/:crawlJobId')
  @ApiOperation({ summary: 'Get status of a website crawl job' })
  async getCrawl(
    @Req() req: Request,
    @Param('crawlJobId') crawlJobId: string
  ) {
    const portfolioReference = (req.query?.portfolioId || req.query?.portalId || req.query?.entityId) as string;
    if (!portfolioReference) {
      throw new BadRequestError('Query param "portfolioId" is required');
    }
    return this.portfoliosService.getCrawlJob(req.authContext!, portfolioReference, crawlJobId);
  }
}
