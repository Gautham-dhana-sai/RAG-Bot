import { Request } from 'express';
import { z } from 'zod';
import { ConversationsService } from './conversations.service.js';
import { QueryRewriter } from './query-rewriter.js';
import { RetrievalService } from '../retrieval/retrieval.service.js';
import { GenerationService } from '../generation/generation.service.js';
import { CitationsService } from '../citations/citations.service.js';
import { AnalyticsService } from '../analytics/analytics.service.js';
import { BadRequestError } from '../../shared/errors.js';
import { env } from '../../config/env.js';

export interface ExecuteConversationTurnParams {
  req: Request;
  tenantId: string;
  entityId: string;
  conversationId: string;
  body: any;
  conversationsService: ConversationsService;
  queryRewriter: QueryRewriter;
  retrievalService: RetrievalService;
  generationService: GenerationService;
  citationsService: CitationsService;
  analyticsService?: AnalyticsService;
}

/**
 * Shared RAG conversation turn execution used by both tenant-scoped
 * (`/v1/tenants/:tenantId/entities/:entityId/conversations/...`) and
 * portal-scoped (`/v1/portals/conversations/...`) controllers.
 */
export async function executeConversationTurn(params: ExecuteConversationTurnParams) {
  const {
    req,
    tenantId,
    entityId,
    conversationId,
    body,
    conversationsService,
    queryRewriter,
    retrievalService,
    generationService,
    citationsService,
    analyticsService,
  } = params;

  const schema = z.object({
    content: z.string().min(1).optional(),
    question: z.string().min(1).optional(),
    topK: z.number().int().positive().optional(),
    retrievalMode: z.enum(['hybrid', 'dense', 'sparse']).optional(),
    minScore: z.number().optional(),
    includeDiagnostics: z.boolean().optional(),
  }).refine(data => Boolean((data.content || data.question || '').trim()), {
    message: 'Message content or question cannot be empty',
  });

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestError('Invalid message body', parsed.error.format());
  }

  const userQuestion = (parsed.data.content || parsed.data.question || '').trim();
  const requestedTopK = parsed.data.topK || env.RETRIEVAL_TOP_K;
  const requestedMode = parsed.data.retrievalMode || 'hybrid';
  const requestedMinScore = parsed.data.minScore !== undefined ? parsed.data.minScore : env.RETRIEVAL_MIN_SCORE;
  const includeDiagnostics = Boolean(parsed.data.includeDiagnostics);

  const startTime = Date.now();

  const origin = analyticsService
    ? analyticsService.resolveRequestOrigin(req, req.authContext)
    : (req.authContext?.isPublicVisitor ? 'EXTERNAL_INTEGRATION' : 'PORTAL_UI');

  if (analyticsService) {
    await analyticsService.recordEvent({
      tenantId,
      entityId,
      eventType: 'CHAT_REQUEST_RECEIVED',
      requestOrigin: origin,
      conversationId,
      metadata: { questionLength: userQuestion.length },
    });
  }

  // 1. Fetch recent conversation history
  const history = await conversationsService.getRecentMessages(tenantId, conversationId, env.MAX_HISTORY_MESSAGES);

  // 2. Query Rewriter to resolve pronouns/references into standalone search query
  const standaloneQuery = await queryRewriter.rewrite(userQuestion, history);

  if (analyticsService && standaloneQuery !== userQuestion) {
    const rwTokens = Math.max(1, Math.ceil((userQuestion.length + 80) / 4));
    await analyticsService.recordTokenLog({
      tenantId,
      entityId,
      requestOrigin: origin,
      operationType: 'QUERY_REWRITE',
      provider: 'openai',
      modelName: 'query-rewriter',
      inputTokens: rwTokens,
      outputTokens: Math.max(1, Math.ceil(standaloneQuery.length / 4)),
      totalTokens: rwTokens + Math.max(1, Math.ceil(standaloneQuery.length / 4)),
      isEstimated: true,
      conversationId,
      durationMs: 40,
    });
  }

  // 3. Save User Message to database
  await conversationsService.saveMessage({
    tenantId,
    entityId,
    conversationId,
    senderRole: 'user',
    content: userQuestion,
    rewrittenQuery: standaloneQuery !== userQuestion ? standaloneQuery : undefined,
  });

  // 4. Hybrid Retrieval (Dense pgvector + Sparse tsvector fused via RRF)
  const isPublicOnly = Boolean(req.authContext?.isPublicVisitor && !req.authContext?.isSuperadmin);
  const retrievedChunks = await retrievalService.retrieveRelevantChunks({
    tenantId,
    entityId,
    query: standaloneQuery,
    isPublicOnly,
    topK: requestedTopK,
    mode: requestedMode,
    minScore: requestedMinScore,
  });

  // 5. Generate Grounded Answer
  const historyChatMessages = history.map(h => ({
    role: h.senderRole === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: h.content,
  }));

  const generation = await generationService.generateGroundedAnswer({
    question: userQuestion,
    conversationHistory: historyChatMessages,
    retrievedChunks,
  });

  // 6. Save initial Assistant Message
  const assistantMessage = await conversationsService.saveMessage({
    tenantId,
    entityId,
    conversationId,
    senderRole: 'assistant',
    content: generation.answer,
    insufficientEvidence: generation.insufficientEvidence,
    confidenceScore: generation.confidence,
  });

  // 7. Strictly Validate and Persist Citations
  const { sanitizedAnswer, verifiedCitations } = await citationsService.processAndPersistCitations({
    tenantId,
    entityId,
    messageId: assistantMessage.id,
    answerText: generation.answer,
    authorizedChunks: retrievedChunks,
  });

  const totalDurationMs = Date.now() - startTime;

  if (analyticsService) {
    if (generation.usage) {
      await analyticsService.recordTokenLog({
        tenantId,
        entityId,
        requestOrigin: origin,
        operationType: 'CHAT_COMPLETION',
        provider: generation.provider || 'openai',
        modelName: generation.model || 'gemini-3.8-flash',
        inputTokens: generation.usage.promptTokens,
        outputTokens: generation.usage.completionTokens,
        totalTokens: generation.usage.totalTokens,
        isEstimated: generation.usage.isEstimated,
        conversationId,
        durationMs: totalDurationMs,
      });
    }

    await analyticsService.recordEvent({
      tenantId,
      entityId,
      eventType: 'CHAT_RESPONSE_COMPLETED',
      requestOrigin: origin,
      conversationId,
      durationMs: totalDurationMs,
      metadata: {
        retrievedCount: retrievedChunks.length,
        insufficientEvidence: generation.insufficientEvidence,
        citationsCount: verifiedCitations.length,
      },
    });
  }

  const cleanAnswerText = sanitizedAnswer
    .replace(/\[[^\]]*\bDOC-[^\]]*\]/gi, '')
    .replace(/\([^)]*\bDOC-[^)]*\)/gi, '')
    .replace(/\[[^\]]*\bCHUNK\b[^\]]*\]/gi, '')
    .replace(/\[\s*DOC-[^\]]*$/gi, '')
    .replace(/\(\s*DOC-[^)]*$/gi, '')
    .replace(/\[\s*CHUNK[^\]]*$/gi, '')
    .replace(/\bDOC-[a-zA-Z0-9_-]+/gi, '')
    .replace(/\bCHUNK-[a-zA-Z0-9_-]+/gi, '')
    .replace(/\[\s*\]/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\[\s*$/g, '')
    .replace(/\(\s*$/g, '')
    .replace(/[ \t]+([.,!?;:])/g, '$1')
    .replace(/[^\S\r\n]{2,}/g, ' ')
    .replace(/([^\n])\s*([•*]|\s-\s)\s*/g, '$1\n• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const responseBody: any = {
    answer: cleanAnswerText,
    citations: verifiedCitations,
    insufficientEvidence: generation.insufficientEvidence,
    confidence: generation.confidence,
    conversationId,
    messageId: assistantMessage.id,
  };

  if (includeDiagnostics) {
    responseBody.diagnostics = {
      rewrittenQuery: standaloneQuery,
      retrievalMode: requestedMode,
      topK: requestedTopK,
      retrievedCount: retrievedChunks.length,
      totalDurationMs,
    };
  }

  return responseBody;
}
