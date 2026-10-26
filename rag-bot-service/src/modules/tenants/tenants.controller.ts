import { Controller, Post, Get, Param, Body, Req, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Request } from 'express';
import { z } from 'zod';
import { TenantsService } from './tenants.service.js';
import { EntitiesService } from '../entities/entities.service.js';
import { AuthService } from '../auth/auth.service.js';
import { BadRequestError } from '../../shared/errors.js';

@ApiTags('Tenants & Entities')
@Controller('v1/tenants')
export class TenantsController {
  constructor(
    @Inject(TenantsService) private readonly tenantsService: TenantsService,
    @Inject(EntitiesService) private readonly entitiesService: EntitiesService,
    @Inject(AuthService) private readonly authService: AuthService
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new tenant' })
  async createTenant(@Body() body: any) {
    const schema = z.object({
      name: z.string().min(1),
      slug: z.string().min(1),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid tenant body', parsed.error.format());
    }

    return this.tenantsService.createTenant(parsed.data.name, parsed.data.slug);
  }

  @Get(':tenantId')
  @ApiOperation({ summary: 'Get tenant details' })
  async getTenant(@Param('tenantId') tenantId: string) {
    return this.tenantsService.getById(tenantId);
  }

  @Post(':tenantId/entities')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new entity in tenant' })
  async createEntity(@Param('tenantId') tenantId: string, @Body() body: any) {
    await this.tenantsService.getById(tenantId);

    const schema = z.object({
      name: z.string().min(1),
      slug: z.string().min(1),
      description: z.string().optional(),
      isPublic: z.boolean().optional(),
    });
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid entity body', parsed.error.format());
    }

    return this.entitiesService.createEntity({
      tenantId,
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description,
      isPublic: parsed.data.isPublic,
    });
  }

  @Get(':tenantId/entities')
  @ApiOperation({ summary: 'List entities in tenant' })
  async listEntities(@Param('tenantId') tenantId: string) {
    await this.tenantsService.getById(tenantId);
    return this.entitiesService.listEntities(tenantId);
  }

  @Get(':tenantId/entities/:entityId')
  @ApiOperation({ summary: 'Get entity details' })
  async getEntity(
    @Req() req: Request,
    @Param('tenantId') tenantId: string,
    @Param('entityId') entityId: string
  ) {
    return this.authService.authorizeEntityAccess(req.authContext!, tenantId, entityId, false);
  }
}
