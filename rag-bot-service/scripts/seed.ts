import { createNestApp } from '../src/app.js';
import { logger } from '../src/shared/logger.js';
import { hashPassword } from '../src/shared/password.js';

async function seed() {
  logger.info('Starting PersonaRAG Seed script...');
  const { db } = await createNestApp();

  const defaultPassword = 'Password123!';
  const { hash: passwordHash, salt } = hashPassword(defaultPassword);

  // 1. Tenant 1: Acme Cloud Systems
  let tenant1 = await db.getTenantById('0164d75c-ad5a-4a6b-98a9-7ec4aacd0529');
  if (!tenant1) {
    tenant1 = await db.createTenant({
      id: '0164d75c-ad5a-4a6b-98a9-7ec4aacd0529',
      name: 'Acme Cloud Systems',
      slug: 'acme-cloud',
    });
    logger.info(`Created Tenant 1: ${tenant1.name} (${tenant1.id})`);
  } else {
    logger.info(`Tenant 1 already exists: ${tenant1.name}`);
  }

  // User 1: Alex Rivera
  let user1 = await db.getUserByEmail('alex@acme.com');
  if (!user1) {
    user1 = await db.createUser({
      name: 'Alex Rivera',
      email: 'alex@acme.com',
      passwordHash,
      salt,
      isSuperadmin: false,
    });
    logger.info(`Created User 1: ${user1.name} (${user1.id})`);
  }
  const mem1 = await db.getTenantMembership(tenant1.id, user1.id);
  if (!mem1) {
    await db.createTenantMembership(tenant1.id, user1.id, 'owner');
  }

  // User 1b: Alex Chen (Demo profile)
  let user1b = await db.getUserByEmail('alex.chen@acme.example.com');
  if (!user1b) {
    user1b = await db.createUser({
      id: 'a1e0c4e7-0001-4000-8000-000000000001',
      name: 'Alex Chen',
      email: 'alex.chen@acme.example.com',
      passwordHash,
      salt,
      isSuperadmin: true,
    });
    logger.info(`Created User Alex Chen: ${user1b.name}`);
  }
  const mem1b = await db.getTenantMembership(tenant1.id, user1b.id);
  if (!mem1b) {
    await db.createTenantMembership(tenant1.id, user1b.id, 'owner');
  }

  // Public Entity for Alex Rivera
  let entity1 = await db.getEntityByReference(tenant1.id, 'alex-portfolio');
  if (!entity1) {
    entity1 = await db.createEntity({
      tenantId: tenant1.id,
      name: 'Alex Rivera Portfolio',
      slug: 'alex-portfolio',
      description: 'Senior Distributed Systems Architect & Cloud AI Engineer portfolio',
      portfolioUrl: 'https://alexrivera.dev/portfolio',
      isPublic: true,
    });
    logger.info(`Created Entity 1 (Public): ${entity1.name}`);
  }

  // Demo Entity for Alex Chen
  let entity1b = await db.getEntityById(tenant1.id, 'e29fa525-0079-44c0-b5f5-183a8b4e093d');
  if (!entity1b) {
    entity1b = await db.createEntity({
      id: 'e29fa525-0079-44c0-b5f5-183a8b4e093d',
      tenantId: tenant1.id,
      name: 'Alex Chen - Principal Architect',
      slug: 'alex-chen',
      description: 'Lead Distributed Systems & Cloud AI Architect',
      portfolioUrl: 'https://alexchen.cloud/portfolio',
      isPublic: true,
    });
    logger.info(`Created Entity Alex Chen: ${entity1b.name}`);
  }

  // 2. Tenant 2: BioHealth Global
  let tenant2 = await db.getTenantById('8a34d0b1-382a-41e9-a3b0-6fd719cd2091');
  if (!tenant2) {
    tenant2 = await db.createTenant({
      id: '8a34d0b1-382a-41e9-a3b0-6fd719cd2091',
      name: 'BioHealth Global',
      slug: 'biohealth-global',
    });
    logger.info(`Created Tenant 2: ${tenant2.name} (${tenant2.id})`);
  } else {
    logger.info(`Tenant 2 already exists: ${tenant2.name}`);
  }

  // User 2: Sarah Chen
  let user2 = await db.getUserByEmail('sarah@biohealth.com');
  if (!user2) {
    user2 = await db.createUser({
      name: 'Sarah Chen',
      email: 'sarah@biohealth.com',
      passwordHash,
      salt,
      isSuperadmin: false,
    });
    logger.info(`Created User 2: ${user2.name}`);
  }
  const mem2 = await db.getTenantMembership(tenant2.id, user2.id);
  if (!mem2) {
    await db.createTenantMembership(tenant2.id, user2.id, 'owner');
  }

  // User 2b: Dr. Jane Doe (Demo Profile)
  let user2b = await db.getUserByEmail('jane.doe@biohealth.example.com');
  if (!user2b) {
    user2b = await db.createUser({
      id: 'b1e0c4e7-0002-4000-8000-000000000002',
      name: 'Dr. Jane Doe',
      email: 'jane.doe@biohealth.example.com',
      passwordHash,
      salt,
      isSuperadmin: false,
    });
    logger.info(`Created User Jane Doe: ${user2b.name}`);
  }
  const mem2b = await db.getTenantMembership(tenant2.id, user2b.id);
  if (!mem2b) {
    await db.createTenantMembership(tenant2.id, user2b.id, 'owner');
  }

  // Entity for Sarah Chen
  let entity2 = await db.getEntityByReference(tenant2.id, 'sarah-lead');
  if (!entity2) {
    entity2 = await db.createEntity({
      tenantId: tenant2.id,
      name: 'Sarah Chen AI Lead',
      slug: 'sarah-lead',
      description: 'Applied AI & Product Engineering Lead portfolio',
      portfolioUrl: 'https://sarahchen.bio/portfolio',
      isPublic: true,
    });
    logger.info(`Created Entity 2: ${entity2.name}`);
  }

  // Entity for Dr. Jane Doe
  let entity2b = await db.getEntityById(tenant2.id, 'f109bc42-9988-4421-bc11-00aa1234ef01');
  if (!entity2b) {
    entity2b = await db.createEntity({
      id: 'f109bc42-9988-4421-bc11-00aa1234ef01',
      tenantId: tenant2.id,
      name: 'Dr. Jane Doe - AI Therapeutics',
      slug: 'jane-doe',
      description: 'VP of AI Discovery & Computational Biology',
      portfolioUrl: 'https://janedoe.biohealth.com/portfolio',
      isPublic: true,
    });
    logger.info(`Created Entity Jane Doe: ${entity2b.name}`);
  }

  logger.info('----------------------------------------------------');
  logger.info('Database seeded successfully!');
  logger.info(`Default test password for all seeded accounts: ${defaultPassword}`);
  logger.info('Seeded user accounts:');
  logger.info('  1. alex@acme.com / Password123!');
  logger.info('  2. alex.chen@acme.example.com / Password123!');
  logger.info('  3. sarah@biohealth.com / Password123!');
  logger.info('  4. jane.doe@biohealth.example.com / Password123!');
  logger.info('----------------------------------------------------');

  await db.close();
}

seed()
  .then(() => process.exit(0))
  .catch(err => {
    logger.error('Seed script error:', err);
    process.exit(1);
  });
