import { Module } from '@nestjs/common';
import { PortfoliosController } from './portfolios.controller.js';

@Module({
  controllers: [PortfoliosController],
})
export class PortfoliosModule {}
