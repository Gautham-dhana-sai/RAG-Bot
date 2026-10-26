import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IDatabaseAdapter } from '../../adapters/database/database.interface.js';
import { env } from '../../config/env.js';

@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(@Inject('DATABASE_ADAPTER') private readonly db: IDatabaseAdapter) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check probe' })
  async getHealth() {
    let dbStatus = 'healthy';
    try {
      await this.db.getUserById('health-check-probe');
    } catch {
      dbStatus = 'degraded';
    }

    return {
      status: 'UP',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: env.NODE_ENV,
      database: {
        adapter: env.DATABASE_URL ? 'postgresql' : 'memory',
        status: dbStatus,
      },
      storage: {
        adapter: env.STORAGE_ADAPTER,
      },
      queue: {
        adapter: env.QUEUE_ADAPTER,
      },
      ai: {
        provider: env.AI_PROVIDER,
        embeddingModel: env.EMBEDDING_MODEL,
        chatModel: env.CHAT_MODEL,
        dimensions: env.EMBEDDING_DIMENSIONS,
      },
    };
  }
}

