import { Module } from '@nestjs/common';
import { IngestionController } from './ingestion.controller.js';

@Module({
  controllers: [IngestionController],
})
export class IngestionModule {}

