import { Controller, Post, Get, Param, Body, Req, HttpCode, HttpStatus, Inject, Optional } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { z } from 'zod';
import { ConversationsService } from './conversations.service.js';
import { QueryRewriter } from './query-rewriter.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { GenerationService } from '../generation/generation.service.js';
import { CitationsService } from '../citations/citations.service.js';
import { AuthService } from '../auth/auth.service.js';
import { AnalyticsService } from '../analytics/analytics.service.js';
import { BadRequestError } from '../../shared/errors.js';
import { env } from '../../config/env.js';
import { executeConversationTurn } from './conversation-chat.helper.js';

@ApiTags('Conversations & RAG Retrieval')
@Controller('v1/tenants/:tenantId/entities/:entityId')
export class ConversationsController {
  constructor(
    @Inject(ConversationsService) private readonly conversationsService: ConversationsService,
    @Inject(QueryRewriter) private readonly queryRewriter: QueryRewriter,
    @Inject(RetrievalService) private readonly retrievalService: RetrievalService,
    @Inject(GenerationService) private readonly generationService: GenerationService,
    @Inject(CitationsService) private readonly citationsService: CitationsService,
    @Inject(AuthService) private readonly authService: AuthService,
    @Optional() @Inject(AnalyticsService) private readonly analyticsService?: AnalyticsService
  ) {}

  @Post('conversations')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new career conversation session' })
  async createConversation(
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
    @Param('entityId') entityId: string,
    @Body() body?: any
  ) {
    const entity = await this.authService.authorizeEntityAccess(req.authContext!, tenantId, entityId, false);
    const effectiveTenantId = entity.tenantId;

    const bodySchema = z.object({
      title: z.string().optional(),
    });
    const parsed = bodySchema.safeParse(body || {});

    return this.conversationsService.createConversation({
      tenantId: effectiveTenantId,
      entityId: entity.id,
      userId: req.authContext?.userId,
      isPublic: entity.isPublic,
      title: parsed.success && parsed.data.title ? parsed.data.title : 'Career Q&A Session',
    });
  }

  @Get('conversations')
  @ApiOperation({ summary: 'List conversation sessions for entity' })
  async listConversations(
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
    @Param('entityId') entityId: string
  ) {
    const entity = await this.authService.authorizeEntityAccess(req.authContext!, tenantId, entityId, false);
    return this.conversationsService.listConversations(entity.tenantId, entity.id);
  }

  @Post('retrieval/diagnostics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inspect dense vs sparse ranking diagnostics directly' })
  async getRetrievalDiagnostics(
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
    @Param('entityId') entityId: string,
    @Body() body: any
  ) {
    const entity = await this.authService.authorizeEntityAccess(req.authContext!, tenantId, entityId, false);
    const effectiveTenantId = entity.tenantId;

    const schema = z.object({
      query: z.string().min(1, 'Query is required'),
      topK: z.number().int().positive().optional().default(10),
      mode: z.enum(['hybrid', 'dense', 'sparse']).optional().default('hybrid'),
      minScore: z.number().optional().default(0.005),
    });

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid retrieval diagnostics payload', parsed.error.format());
    }

    const startTime = Date.now();
    const isPublicOnly = Boolean(req.authContext?.isPublicVisitor && !req.authContext?.isSuperadmin);

    const retrievedChunks = await this.retrievalService.retrieveRelevantChunks({
      tenantId: effectiveTenantId,
      entityId: entity.id,
      query: parsed.data.query,
      isPublicOnly,
      topK: parsed.data.topK,
      mode: parsed.data.mode,
      minScore: parsed.data.minScore,
    });
    const durationMs = Date.now() - startTime;

    return {
      query: parsed.data.query,
      retrievalMode: parsed.data.mode,
      retrievedCount: retrievedChunks.length,
      durationMs,
      appliedFilters: {
        tenantId: effectiveTenantId,
        entityId: entity.id,
        isPublicOnly,
        minScore: parsed.data.minScore,
      },
      candidates: retrievedChunks.map(c => ({
        chunkId: c.chunk.id,
        documentId: c.document.id,
        documentTitle: c.document.originalFilename,
        pageNumber: c.chunk.pageNumber || 1,
        score: c.score,
        denseRank: c.denseRank,
        sparseRank: c.sparseRank,
        snippet: c.chunk.chunkText.length > 250 ? c.chunk.chunkText.substring(0, 250) + '...' : c.chunk.chunkText,
      })),
    };
  }

  @Post('conversations/:conversationId/messages')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Ask question, retrieve evidence, and generate grounded answer with citations' })
  async sendMessage(
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
    @Param('entityId') entityId: string,
    @Param('conversationId') conversationId: string,
    @Body() body: any
  ) {
    const entity = await this.authService.authorizeEntityAccess(req.authContext!, tenantId, entityId, false);
    const effectiveTenantId = entity.tenantId;
    await this.authService.authorizeConversationAccess(req.authContext!, effectiveTenantId, entity.id, conversationId);

    return executeConversationTurn({
      req,
      tenantId: effectiveTenantId,
      entityId: entity.id,
      conversationId,
      body,
      conversationsService: this.conversationsService,
      queryRewriter: this.queryRewriter,
      retrievalService: this.retrievalService,
      generationService: this.generationService,
      citationsService: this.citationsService,
      analyticsService: this.analyticsService,
    });
  }

  @Get('conversations/:conversationId/messages')
  @ApiOperation({ summary: 'Get messages for conversation' })
  async getMessages(
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
    @Param('entityId') entityId: string,
    @Param('conversationId') conversationId: string
  ) {
    await this.authService.authorizeEntityAccess(req.authContext!, tenantId, entityId, false);
    await this.authService.authorizeConversationAccess(req.authContext!, tenantId, entityId, conversationId);

    const messages = await this.conversationsService.getRecentMessages(tenantId, conversationId, 50);

    // Attach citations to assistant messages
    return Promise.all(
      messages.map(async m => {
        if (m.senderRole === 'assistant') {
          const citations = await this.citationsService.getCitationsForMessage(m.id);
          return { ...m, citations };
        }
        return m;
      })
    );
  }
}
