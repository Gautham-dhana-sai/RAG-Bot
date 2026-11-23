import { Controller, Get, Param, Query, Req, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { z } from 'zod';
import { AnalyticsService } from './analytics.service.js';
import { BadRequestError } from '../../shared/errors.js';
import { AnalyticsFilterParams } from '../../types/index.js';

const filterQuerySchema = z.object({
  period: z.enum(['today', '7d', '30d', '90d', 'custom']).optional().default('30d'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  origin: z.enum(['PORTAL_UI', 'EXTERNAL_INTEGRATION']).optional(),
  sourceCategory: z.enum(['FILE', 'LINK', 'WEBSITE']).optional(),
});

@ApiTags('Portal Analytics & Performance')
@Controller(['v1/portals', 'v1/portfolios'])
export class AnalyticsController {
  constructor(
    @Inject(AnalyticsService) private readonly analyticsService: AnalyticsService
  ) {}

  private parseParams(query: any): AnalyticsFilterParams {
    const parsed = filterQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestError('Invalid analytics filter parameters', parsed.error.format());
    }
    return parsed.data;
  }

  @Get(':portalReference/analytics/overview')
  @ApiOperation({ summary: 'Get overview analytics for a portal' })
  async getOverview(
    @Req() req: Request,
    @Param('portalReference') portalReference: string,
    @Query() query: any
  ) {
    const params = this.parseParams(query);
    return this.analyticsService.getOverview(req.authContext!, portalReference, params);
  }

  @Get(':portalReference/analytics/sources')
  @ApiOperation({ summary: 'Get source and ingestion analytics for a portal' })
  async getSourceAnalytics(
    @Req() req: Request,
    @Param('portalReference') portalReference: string,
    @Query() query: any
  ) {
    const params = this.parseParams(query);
    return this.analyticsService.getSourceAnalytics(req.authContext!, portalReference, params);
  }

  @Get(':portalReference/analytics/performance')
  @ApiOperation({ summary: 'Get business-friendly processing performance metrics' })
  async getProcessingPerformance(
    @Req() req: Request,
    @Param('portalReference') portalReference: string,
    @Query() query: any
  ) {
    const params = this.parseParams(query);
    return this.analyticsService.getProcessingPerformance(req.authContext!, portalReference, params);
  }

  @Get(':portalReference/analytics/tokens')
  @ApiOperation({ summary: 'Get AI token consumption by origin and model' })
  async getAITokenConsumption(
    @Req() req: Request,
    @Param('portalReference') portalReference: string,
    @Query() query: any
  ) {
    const params = this.parseParams(query);
    return this.analyticsService.getAITokenConsumption(req.authContext!, portalReference, params);
  }

  @Get(':portalReference/analytics/chat')
  @ApiOperation({ summary: 'Get chatbot usage and response performance' })
  async getChatUsage(
    @Req() req: Request,
    @Param('portalReference') portalReference: string,
    @Query() query: any
  ) {
    const params = this.parseParams(query);
    return this.analyticsService.getChatUsage(req.authContext!, portalReference, params);
  }

  @Get(':portalReference/analytics/activity')
  @ApiOperation({ summary: 'Get paginated source activity and update history' })
  async getSourceActivity(
    @Req() req: Request,
    @Param('portalReference') portalReference: string,
    @Query() query: any
  ) {
    const params = this.parseParams(query);
    return this.analyticsService.getSourceActivity(req.authContext!, portalReference, params);
  }

  @Get(':portalReference/analytics/failures')
  @ApiOperation({ summary: 'Get failure categories and detailed failure logs' })
  async getFailureAnalytics(
    @Req() req: Request,
    @Param('portalReference') portalReference: string,
    @Query() query: any
  ) {
    const params = this.parseParams(query);
    return this.analyticsService.getFailureAnalytics(req.authContext!, portalReference, params);
  }
}

