import { IDatabaseAdapter } from '../../adapters/database/database.interface.js';
import { Entity } from '../../types/index.js';
import { NotFoundError } from '../../shared/errors.js';

export class EntitiesService {
  constructor(private db: IDatabaseAdapter) {}

  async getEntity(tenantId: string, entityId: string): Promise<Entity> {
    const entity = await this.db.getEntityById(tenantId, entityId);
    if (!entity) throw new NotFoundError('Entity', entityId);
    return entity;
  }

  async listEntities(tenantId: string): Promise<Entity[]> {
    return this.db.getEntitiesByTenant(tenantId);
  }

  async createEntity(data: {
    tenantId: string;
    name: string;
    slug: string;
    description?: string;
    isPublic?: boolean;
  }): Promise<Entity> {
    return this.db.createEntity(data);
  }
}

