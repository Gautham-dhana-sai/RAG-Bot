import { createNestApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './shared/logger.js';

async function startServer() {
  try {
    const { app } = await createNestApp();

    await app.listen(env.PORT, env.HOST);

    logger.info(`PersonaRAG Nest.js Server running at http://${env.HOST}:${env.PORT}`);
    logger.info(`Swagger documentation available at http://${env.HOST}:${env.PORT}/documentation`);
    logger.info(`Health check probe: http://${env.HOST}:${env.PORT}/health`);
  } catch (err) {
    logger.error('Failed to start Nest.js server:', err);
    process.exit(1);
  }
}

startServer();
