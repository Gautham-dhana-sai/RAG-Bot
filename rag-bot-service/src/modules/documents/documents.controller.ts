import { Controller, Get, Delete, Param, Req, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { DocumentsService } from './documents.service.js';
import { AuthService } from '../auth/auth.service.js';

@ApiTags('Documents')
@Controller('v1/tenants/:tenantId/entities/:entityId/documents')
export class DocumentsController {
  constructor(
    @Inject(DocumentsService) private readonly docsService: DocumentsService,
    @Inject(AuthService) private readonly authService: AuthService
  ) {}

  @Get()
  @ApiOperation({ summary: 'List documents in entity' })
  async listDocuments(
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
    @Param('entityId') entityId: string
  ) {
    await this.authService.authorizeEntityAccess(req.authContext!, tenantId, entityId, false);
    return this.docsService.listDocuments(tenantId, entityId);
  }

  @Get(':documentId')
  @ApiOperation({ summary: 'Get document details' })
  async getDocument(
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
    @Param('entityId') entityId: string,
    @Param('documentId') documentId: string
  ) {
    await this.authService.authorizeEntityAccess(req.authContext!, tenantId, entityId, false);
    return this.docsService.getDocument(tenantId, entityId, documentId);
  }

  @Delete(':documentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete document' })
  async deleteDocument(
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
    @Param('entityId') entityId: string,
    @Param('documentId') documentId: string
  ) {
    await this.authService.authorizeEntityAccess(req.authContext!, tenantId, entityId, true);
    await this.docsService.deleteDocument(tenantId, entityId, documentId);
  }
}
