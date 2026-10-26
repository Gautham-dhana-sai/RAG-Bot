import crypto from 'crypto';
import { IDatabaseAdapter } from '../../adapters/database/database.interface.js';
import { AuthContext, Entity, Tenant, User } from '../../types/index.js';
import { ForbiddenError, NotFoundError, UnauthorizedError, BadRequestError } from '../../shared/errors.js';
import { generateUuid, slugify } from '../../shared/utils.js';
import { hashPassword, verifyPassword } from '../../shared/password.js';

export interface TokenPayload {
  userId: string;
  tenantId: string;
  roles: string[];
  isSuperadmin: boolean;
  iat: number;
  exp: number;
  sid: string;
}

export interface UserSession {
  token: string;
  userId: string;
  tenantId: string;
  roles: string[];
  isSuperadmin: boolean;
  createdAt: Date;
}

export interface DemoProfile {
  id: string;
  name: string;
  role: string;
  workspaceName: string;
  portfolioName: string;
  tenantId: string;
  entityId: string;
  token: string;
  isPublic: boolean;
  isGuest?: boolean;
}

export class AuthService {
  private sessions: Map<string, UserSession> = new Map();
  private revokedSessions: Set<string> = new Set();
  private demoProfilesCache: DemoProfile[] | null = null;

  constructor(
    private db: IDatabaseAdapter,
    private authSecret: string
  ) {}

  /**
   * Create an active HMAC-SHA256 signed session token for a user and tenant.
   * Stateless signature survives server restarts and code changes.
   */
  createSession(data: {
    userId: string;
    tenantId: string;
    roles?: string[];
    isSuperadmin?: boolean;
    expiresInSeconds?: number;
  }): string {
    const sid = generateUuid();
    const now = Math.floor(Date.now() / 1000);
    // Default session validity: 7 days
    const exp = now + (data.expiresInSeconds || 7 * 24 * 60 * 60);

    const payload: TokenPayload = {
      userId: data.userId,
      tenantId: data.tenantId,
      roles: data.roles || ['owner'],
      isSuperadmin: Boolean(data.isSuperadmin),
      iat: now,
      exp,
      sid,
    };

    const token = this.signToken(payload);

    const session: UserSession = {
      token,
      userId: data.userId,
      tenantId: data.tenantId,
      roles: data.roles || ['owner'],
      isSuperadmin: Boolean(data.isSuperadmin),
      createdAt: new Date(),
    };
    this.sessions.set(token, session);
    this.sessions.set(sid, session);

    return token;
  }

  private signToken(payload: TokenPayload): string {
    const jsonPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', this.authSecret).update(jsonPayload).digest('base64url');
    return `ragbot_sess_${jsonPayload}.${signature}`;
  }

  verifyToken(token: string): { valid: boolean; expired?: boolean; payload?: TokenPayload } {
    if (!token.startsWith('ragbot_sess_')) return { valid: false };
    const rest = token.substring('ragbot_sess_'.length);
    const parts = rest.split('.');
    if (parts.length !== 2) {
      return { valid: false };
    }

    const [jsonPayload, signature] = parts;
    const expectedSig = crypto.createHmac('sha256', this.authSecret).update(jsonPayload).digest('base64url');
    if (expectedSig !== signature) {
      return { valid: false };
    }

    try {
      const payload: TokenPayload = JSON.parse(Buffer.from(jsonPayload, 'base64url').toString('utf-8'));
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && now > payload.exp) {
        return { valid: false, expired: true, payload };
      }
      return { valid: true, payload };
    } catch {
      return { valid: false };
    }
  }

  /**
   * Parse Authorization header or development headers.
   * Format: "Bearer <token>" or "x-user-id: <id>"
   */
  async resolveAuthContext(headers: Record<string, string | string[] | undefined>): Promise<AuthContext> {
    const authHeader = (headers['authorization'] || headers['Authorization']) as string | undefined;
    const userIdHeader = (headers['x-user-id'] || headers['X-User-Id']) as string | undefined;
    const tenantIdHeader = (headers['x-tenant-id'] || headers['X-Tenant-Id']) as string | undefined;

    // 1. Check Bearer token
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7).trim();

      // Master admin token bypass
      if (token === this.authSecret || token === 'admin-secret' || token === 'dev-persona-rag-secret-token-change-in-prod') {
        return {
          userId: userIdHeader || 'admin-user',
          tenantId: tenantIdHeader,
          roles: ['admin', 'owner'],
          isSuperadmin: true,
          isPublicVisitor: false,
        };
      }

      // 1a. Verify HMAC signed session token (stateless & persistent across restarts/code changes)
      const verified = this.verifyToken(token);
      if (verified.expired) {
        return {
          roles: ['visitor'],
          isSuperadmin: false,
          isPublicVisitor: true,
        };
      }

      if (verified.valid && verified.payload) {
        if (this.revokedSessions.has(verified.payload.sid) || this.revokedSessions.has(token)) {
          return {
            roles: ['visitor'],
            isSuperadmin: false,
            isPublicVisitor: true,
          };
        }

        return {
          userId: verified.payload.userId,
          tenantId: tenantIdHeader || verified.payload.tenantId,
          roles: verified.payload.roles,
          isSuperadmin: verified.payload.isSuperadmin,
          isPublicVisitor: false,
        };
      }

      // 1b. Check in-memory session (fallback for plain tokens or tests)
      const session = this.sessions.get(token);
      if (session) {
        return {
          userId: session.userId,
          tenantId: tenantIdHeader || session.tenantId,
          roles: session.roles,
          isSuperadmin: session.isSuperadmin,
          isPublicVisitor: false,
        };
      }

      // Provided token was invalid or expired - treat as unauthenticated public visitor
      return {
        roles: ['visitor'],
        isSuperadmin: false,
        isPublicVisitor: true,
      };
    }

    // 2. Dev Headers
    if (userIdHeader) {
      const user = await this.db.getUserById(userIdHeader);
      if (user) {
        return {
          userId: user.id,
          tenantId: tenantIdHeader,
          roles: ['member'],
          isSuperadmin: user.isSuperadmin,
          isPublicVisitor: false,
        };
      }
    }

    // 3. Default to unauthenticated public visitor
    return {
      roles: ['visitor'],
      isSuperadmin: false,
      isPublicVisitor: true,
    };
  }

  /**
   * Register a new user, workspace (tenant), and default portfolio (entity)
   * in one simple, automated onboarding step.
   * Supports email + password registration without requiring other fields.
   */
  async register(data: {
    name?: string;
    email: string;
    password?: string;
    workspaceName?: string;
    portfolioName?: string;
  }): Promise<{
    token: string;
    user: User;
    tenant: Tenant;
    activeEntity: Entity | null;
    entities: Entity[];
  }> {
    if (!data.email) {
      throw new BadRequestError('Email is required for registration');
    }

    const normalizedEmail = data.email.trim().toLowerCase();
    const displayName = data.name?.trim() || normalizedEmail.split('@')[0];

    // Check if user already exists
    let user = await this.db.getUserByEmail(normalizedEmail);
    if (user) {
      if (user.passwordHash && data.password) {
        if (!verifyPassword(data.password, user.passwordHash, user.salt || '')) {
          throw new BadRequestError('A user with this email already exists');
        }
      }
      // Re-use user if found
    } else {
      let passwordHash: string | undefined;
      let salt: string | undefined;

      if (data.password) {
        if (data.password.length < 6) {
          throw new BadRequestError('Password must be at least 6 characters');
        }
        const hashed = hashPassword(data.password);
        passwordHash = hashed.hash;
        salt = hashed.salt;
      }

      user = await this.db.createUser({
        name: displayName,
        email: normalizedEmail,
        passwordHash,
        salt,
        isSuperadmin: false,
      });
    }

    // Check if user already has a tenant membership
    let tenantMembership = await this.db.getUserTenantMembership(user.id);
    let tenant: Tenant | null = null;
    let entities: Entity[] = [];

    if (tenantMembership) {
      tenant = await this.db.getTenantById(tenantMembership.tenantId);
      if (tenant) {
        entities = await this.db.getEntitiesByTenant(tenant.id);
      }
    }

    if (!tenant) {
      // 2. Create Tenant (Workspace)
      const rawWorkspace = data.workspaceName?.trim() || `${displayName}'s Workspace`;
      tenant = await this.db.createTenant({
        name: rawWorkspace,
        slug: slugify(rawWorkspace),
      });

      // 3. Assign User as Owner
      await this.db.createTenantMembership(tenant.id, user.id, 'owner');

      // 4. Create Initial Entity ONLY if explicitly requested with a portfolio name
      if (data.portfolioName?.trim()) {
        const rawPortfolio = data.portfolioName.trim();
        const entity = await this.db.createEntity({
          tenantId: tenant.id,
          name: rawPortfolio,
          slug: slugify(rawPortfolio),
          description: `Career portfolio for ${displayName}`,
          isPublic: true,
        });
        entities = [entity];
      }
    }

    const activeEntity = entities[0] || null;

    // 5. Issue session token
    const token = this.createSession({
      userId: user.id,
      tenantId: tenant.id,
      roles: ['owner'],
      isSuperadmin: false,
    });

    return {
      token,
      user,
      tenant,
      activeEntity,
      entities,
    };
  }

  /**
   * Sign in by email and password, or demo profile
   */
  async login(data: { email: string; password?: string }): Promise<{
    token: string;
    user: User;
    tenant: Tenant;
    activeEntity: Entity | null;
    entities: Entity[];
  }> {
    if (!data.email) {
      throw new BadRequestError('Email is required to sign in');
    }

    const normalizedEmail = data.email.trim().toLowerCase();
    const user = await this.db.getUserByEmail(normalizedEmail);
    if (!user) {
      throw new UnauthorizedError('Invalid email or password');
    }

    // Verify password if user has passwordHash set
    if (user.passwordHash && user.salt) {
      if (!data.password || !verifyPassword(data.password, user.passwordHash, user.salt)) {
        throw new UnauthorizedError('Invalid email or password');
      }
    }

    // Find user's tenant
    let tenantMembership = await this.db.getUserTenantMembership(user.id);
    let tenant: Tenant | null = null;
    let entities: Entity[] = [];

    if (tenantMembership) {
      tenant = await this.db.getTenantById(tenantMembership.tenantId);
      if (tenant) {
        entities = await this.db.getEntitiesByTenant(tenant.id);
      }
    }

    if (!tenant) {
      // Get demo profiles or register fallback workspace
      const demoProfiles = await this.getDemoProfiles();
      const matchingProfile = demoProfiles.find(p => p.name.toLowerCase() === user.name.toLowerCase() || p.id === user.id);

      if (matchingProfile) {
        tenant = await this.db.getTenantById(matchingProfile.tenantId);
        entities = await this.db.getEntitiesByTenant(matchingProfile.tenantId);
      } else {
        const defaultTenant = await this.db.createTenant({
          name: `${user.name}'s Workspace`,
          slug: slugify(`${user.name}-workspace`),
        });
        await this.db.createTenantMembership(defaultTenant.id, user.id, 'owner');
        tenant = defaultTenant;
        entities = [];
      }
    }

    const activeEntity = entities[0] || null;
    const token = this.createSession({
      userId: user.id,
      tenantId: tenant!.id,
      roles: ['owner'],
    });

    return {
      token,
      user,
      tenant: tenant!,
      activeEntity,
      entities,
    };
  }

  /**
   * Log out and delete active session
   */
  logout(token: string): boolean {
    const verified = this.verifyToken(token);
    if (verified.payload?.sid) {
      this.revokedSessions.add(verified.payload.sid);
    }
    this.revokedSessions.add(token);
    this.sessions.delete(token);
    return true;
  }

  /**
   * Return pre-seeded demo profiles for 1-click workspace switching
   */
  async getDemoProfiles(): Promise<DemoProfile[]> {
    if (this.demoProfilesCache && this.demoProfilesCache.length > 0) {
      return this.demoProfilesCache;
    }

    // 1. Ensure Acme Cloud Systems exists
    let acmeTenant = await this.db.getTenantById('0164d75c-ad5a-4a6b-98a9-7ec4aacd0529');
    if (!acmeTenant) {
      acmeTenant = await this.db.createTenant({
        id: '0164d75c-ad5a-4a6b-98a9-7ec4aacd0529',
        name: 'Acme Cloud Systems',
        slug: 'acme-cloud',
      });
    }

    let alexUser = await this.db.getUserByEmail('alex.chen@acme.example.com');
    if (!alexUser) {
      alexUser = await this.db.createUser({
        id: 'a1e0c4e7-0001-4000-8000-000000000001',
        name: 'Alex Chen',
        email: 'alex.chen@acme.example.com',
      });
    }
    await this.db.createTenantMembership(acmeTenant.id, alexUser.id, 'owner');

    let alexEntity = await this.db.getEntityById(acmeTenant.id, 'e29fa525-0079-44c0-b5f5-183a8b4e093d');
    if (!alexEntity) {
      alexEntity = await this.db.createEntity({
        id: 'e29fa525-0079-44c0-b5f5-183a8b4e093d',
        tenantId: acmeTenant.id,
        name: 'Alex Chen - Principal Architect',
        slug: 'alex-chen',
        description: 'Lead Distributed Systems & Cloud AI Architect',
        isPublic: true,
      });
    }

    // 2. Ensure BioHealth Global exists
    let bioTenant = await this.db.getTenantById('8a34d0b1-382a-41e9-a3b0-6fd719cd2091');
    if (!bioTenant) {
      bioTenant = await this.db.createTenant({
        id: '8a34d0b1-382a-41e9-a3b0-6fd719cd2091',
        name: 'BioHealth Global',
        slug: 'biohealth-global',
      });
    }

    let janeUser = await this.db.getUserByEmail('jane.doe@biohealth.example.com');
    if (!janeUser) {
      janeUser = await this.db.createUser({
        id: 'b1e0c4e7-0002-4000-8000-000000000002',
        name: 'Dr. Jane Doe',
        email: 'jane.doe@biohealth.example.com',
      });
    }
    await this.db.createTenantMembership(bioTenant.id, janeUser.id, 'owner');

    let janeEntity = await this.db.getEntityById(bioTenant.id, 'f109bc42-9988-4421-bc11-00aa1234ef01');
    if (!janeEntity) {
      janeEntity = await this.db.createEntity({
        id: 'f109bc42-9988-4421-bc11-00aa1234ef01',
        tenantId: bioTenant.id,
        name: 'Dr. Jane Doe - AI Therapeutics',
        slug: 'jane-doe',
        description: 'VP of AI Discovery & Computational Biology',
        isPublic: true,
      });
    }

    // Create session tokens for the demo profiles
    const alexToken = this.createSession({
      userId: alexUser.id,
      tenantId: acmeTenant.id,
      roles: ['owner'],
    });

    const janeToken = this.createSession({
      userId: janeUser.id,
      tenantId: bioTenant.id,
      roles: ['owner'],
    });

    this.demoProfilesCache = [
      {
        id: 'alex-acme',
        name: 'Alex Chen',
        role: 'Principal Cloud Architect',
        workspaceName: 'Acme Cloud Systems',
        portfolioName: 'Alex Chen - Principal Architect',
        tenantId: acmeTenant.id,
        entityId: alexEntity.id,
        token: alexToken,
        isPublic: true,
      },
      {
        id: 'jane-biohealth',
        name: 'Dr. Jane Doe',
        role: 'VP AI Discovery',
        workspaceName: 'BioHealth Global',
        portfolioName: 'Dr. Jane Doe - AI Therapeutics',
        tenantId: bioTenant.id,
        entityId: janeEntity.id,
        token: janeToken,
        isPublic: true,
      },
      {
        id: 'public-visitor',
        name: 'Public Visitor',
        role: 'Unauthenticated Guest',
        workspaceName: 'Acme Cloud Systems (Public)',
        portfolioName: 'Alex Chen - Principal Architect',
        tenantId: acmeTenant.id,
        entityId: alexEntity.id,
        token: '',
        isPublic: true,
        isGuest: true,
      },
    ];

    return this.demoProfilesCache;
  }

  /**
   * Get current authenticated user session details
   */
  async getCurrentSession(auth: AuthContext): Promise<{
    user?: User;
    tenant?: Tenant;
    entities: Entity[];
    isSuperadmin: boolean;
    isPublicVisitor: boolean;
  }> {
    if (auth.isPublicVisitor || !auth.userId) {
      return {
        isPublicVisitor: true,
        isSuperadmin: false,
        entities: [],
      };
    }

    const user = await this.db.getUserById(auth.userId);
    let tenant: Tenant | null = null;
    let entities: Entity[] = [];

    if (auth.tenantId) {
      tenant = await this.db.getTenantById(auth.tenantId);
      entities = await this.db.getEntitiesByTenant(auth.tenantId);
    }

    return {
      user: user || undefined,
      tenant: tenant || undefined,
      entities,
      isSuperadmin: auth.isSuperadmin,
      isPublicVisitor: false,
    };
  }

  /**
   * Authorize access to a specific tenant and entity.
   * If write=true, public visitors are forbidden.
   */
  async authorizeEntityAccess(
    auth: AuthContext,
    tenantId: string,
    entityId: string,
    writeRequired = false
  ): Promise<Entity> {
    const effectiveTenantId = (tenantId === 'default' && auth.tenantId) ? auth.tenantId : tenantId;
    let entity = await this.db.getEntityById(effectiveTenantId, entityId);
    if (!entity && auth.tenantId && auth.tenantId !== effectiveTenantId) {
      entity = await this.db.getEntityById(auth.tenantId, entityId);
    }
    if (!entity) {
      throw new NotFoundError('Entity', entityId);
    }

    // Superadmin bypass
    if (auth.isSuperadmin) {
      return entity;
    }

    // Public read access check
    if (!writeRequired && entity.isPublic) {
      return entity;
    }

    // Write actions or private entity access require authenticated user
    if (auth.isPublicVisitor || !auth.userId) {
      throw new UnauthorizedError('Authentication required to access this entity');
    }

    // Check tenant membership
    const membership = await this.db.getTenantMembership(tenantId, auth.userId);
    if (membership) {
      if (['owner', 'admin'].includes(membership.role)) return entity;
      if (membership.role === 'member') {
        const entityMem = await this.db.getEntityMembership(tenantId, entityId, auth.userId);
        if (!entityMem || (writeRequired && entityMem.role !== 'editor')) {
          return entity;
        }
        return entity;
      }
    }

    throw new ForbiddenError(`User is not authorized for tenant '${tenantId}' or entity '${entityId}'`);
  }

  /**
   * Verify conversation access
   */
  async authorizeConversationAccess(
    auth: AuthContext,
    tenantId: string,
    entityId: string,
    conversationId: string
  ): Promise<void> {
    const effectiveTenantId = (tenantId === 'default' && auth.tenantId) ? auth.tenantId : tenantId;
    let conversation = await this.db.getConversationById(effectiveTenantId, entityId, conversationId);
    if (!conversation && auth.tenantId && auth.tenantId !== effectiveTenantId) {
      conversation = await this.db.getConversationById(auth.tenantId, entityId, conversationId);
    }
    if (!conversation) {
      throw new NotFoundError('Conversation', conversationId);
    }

    if (auth.isSuperadmin) return;

    if (conversation.isPublic) return;

    if (auth.isPublicVisitor) {
      throw new UnauthorizedError('Authentication required to access private conversation');
    }

    if (conversation.userId && conversation.userId !== auth.userId) {
      throw new ForbiddenError('You do not own this conversation');
    }
  }
}
