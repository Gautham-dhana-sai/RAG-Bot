import { IAIAdapter, ChatMessage } from '../../adapters/ai/ai.interface.js';
import { PromptBuilder } from './prompt-builder.js';
import { ScoredChunk } from '../../types/index.js';

export class GenerationService {
  private promptBuilder = new PromptBuilder();

  constructor(private ai: IAIAdapter) {}

  async generateGroundedAnswer(params: {
    question: string;
    conversationHistory: ChatMessage[];
    retrievedChunks: ScoredChunk[];
  }): Promise<{ answer: string; insufficientEvidence: boolean; confidence: number }> {
    const { question, conversationHistory, retrievedChunks } = params;

    const evidenceContext = this.promptBuilder.buildEvidenceContext(retrievedChunks);
    const systemPrompt = this.promptBuilder.buildSystemPrompt();

    // If no chunks retrieved at all, return explicit abstention immediately
    if (retrievedChunks.length === 0) {
      return {
        answer: 'Insufficient evidence: I do not have sufficient evidence in the uploaded documents to answer this question.',
        insufficientEvidence: true,
        confidence: 0.0,
      };
    }

    const messages: ChatMessage[] = [
      ...conversationHistory.slice(-6),
      { role: 'user', content: question },
    ];

    const result = await this.ai.generateAnswer({
      systemPrompt,
      messages,
      evidenceContext,
      temperature: 0.1,
    });

    const lowerAnswer = result.text.toLowerCase();
    const insufficientEvidence =
      lowerAnswer.includes('insufficient evidence') ||
      lowerAnswer.includes('do not have sufficient') ||
      lowerAnswer.includes('no evidence');

    // Calculate confidence based on average top retrieved chunk score
    const avgScore =
      retrievedChunks.reduce((acc, c) => acc + c.score, 0) / (retrievedChunks.length || 1);
    const confidence = insufficientEvidence ? 0.0 : Math.min(1.0, Math.max(0.1, avgScore * 50));

    return {
      answer: result.text,
      insufficientEvidence,
      confidence: parseFloat(confidence.toFixed(2)),
    };
  }
}
