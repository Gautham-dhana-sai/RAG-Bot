import { IDatabaseAdapter } from '../../adapters/database/database.interface.js';
import { Tenant } from '../../types/index.js';
import { NotFoundError } from '../../shared/errors.js';

export class TenantsService {
  constructor(private db: IDatabaseAdapter) {}

  async getById(id: string): Promise<Tenant> {
    const tenant = await this.db.getTenantById(id);
    if (!tenant) throw new NotFoundError('Tenant', id);
    return tenant;
  }

  async createTenant(name: string, slug: string): Promise<Tenant> {
    return this.db.createTenant({ name, slug });
  }
}

