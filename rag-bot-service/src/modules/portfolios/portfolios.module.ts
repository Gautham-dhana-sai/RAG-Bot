import { Module } from '@nestjs/common';
import { PortfoliosController } from './portfolios.controller.js';
import { WebsitesIngestionController } from '../ingestion/websites-ingestion.controller.js';

@Module({
  controllers: [PortfoliosController, WebsitesIngestionController],
})
export class PortfoliosModule {}
