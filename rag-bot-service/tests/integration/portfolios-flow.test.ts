import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp, NestAppWithInject } from '../../src/app.js';
import { MemoryDatabaseAdapter } from '../../src/adapters/database/memory.adapter.js';

describe('Portfolios & Auth Management Flow', () => {
  let app: NestAppWithInject;

  beforeAll(async () => {
    const res = await buildApp({ db: new MemoryDatabaseAdapter() });
    app = res.app;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('completes the full user journey: sign up with email+pwd, manage portfolios by URL, upload documents, and enforce isolation', async () => {
    // 1. User A signs up with ONLY email and password
    const signupRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: 'sarah.connor@cyberdyne.org',
        password: 'SuperSecretPassword123!',
      },
    });

    expect(signupRes.statusCode).toBe(201);
    const signupData = JSON.parse(signupRes.body);
    expect(signupData.token).toContain('ragbot_sess_');
    expect(signupData.user.email).toBe('sarah.connor@cyberdyne.org');
    expect(signupData.tenant.id).toBeDefined();

    const userAToken = signupData.token;

    // 2. User A logs in with email and password
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: {
        email: 'sarah.connor@cyberdyne.org',
        password: 'SuperSecretPassword123!',
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const loginData = JSON.parse(loginRes.body);
    expect(loginData.token).toContain('ragbot_sess_');

    // 3. User A lists portfolios
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/portfolios',
      headers: { authorization: `Bearer ${userAToken}` },
    });

    expect(listRes.statusCode).toBe(200);
    const portfolios = JSON.parse(listRes.body);
    expect(Array.isArray(portfolios)).toBe(true);
    expect(portfolios.length).toBe(0);

    // 4. User A registers a new portfolio by URL
    const createPortRes = await app.inject({
      method: 'POST',
      url: '/v1/portfolios',
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        url: 'https://sarahconnor.engineering/portfolio/',
      },
    });

    expect(createPortRes.statusCode).toBe(201);
    const newPortfolio = JSON.parse(createPortRes.body);
    expect(newPortfolio.id).toBeDefined();
    // Normalized URL: trimmed trailing slash
    expect(newPortfolio.portfolioUrl).toBe('https://sarahconnor.engineering/portfolio');

    // 5. Idempotent check: User A re-submits the same URL -> returns existing portfolio
    const dupPortRes = await app.inject({
      method: 'POST',
      url: '/v1/portfolios',
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        url: 'https://sarahconnor.engineering/portfolio',
      },
    });

    expect(dupPortRes.statusCode).toBe(201);
    const dupPortfolio = JSON.parse(dupPortRes.body);
    expect(dupPortfolio.id).toBe(newPortfolio.id);

    // 6. User B signs up and attempts to register the same portfolio URL -> 409 Conflict
    const userBSignup = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: {
        email: 'john.reese@resistance.net',
        password: 'PasswordResistance999!',
      },
    });
    expect(userBSignup.statusCode).toBe(201);
    const userBToken = JSON.parse(userBSignup.body).token;

    const conflictRes = await app.inject({
      method: 'POST',
      url: '/v1/portfolios',
      headers: { authorization: `Bearer ${userBToken}` },
      payload: {
        url: 'https://sarahconnor.engineering/portfolio',
      },
    });

    expect(conflictRes.statusCode).toBe(409);

    // User B cannot access User A's portfolio
    const accessDeniedRes = await app.inject({
      method: 'GET',
      url: `/v1/portfolios/${newPortfolio.id}`,
      headers: { authorization: `Bearer ${userBToken}` },
    });
    expect([403, 404]).toContain(accessDeniedRes.statusCode);

    // 7. User A uploads documents to the portfolio
    const uploadRes = await app.inject({
      method: 'POST',
      url: `/v1/portfolios/${newPortfolio.id}/ingestion-jobs`,
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        files: [
          {
            filename: 'resume.txt',
            mimeType: 'text/plain',
            content: 'Sarah Connor is a seasoned Lead Systems Architect with expertise in autonomous defensive networks and distributed resilience.',
          },
          {
            filename: 'architecture-whitepaper.md',
            mimeType: 'text/markdown',
            content: '# Architecture Overview\nDecentralized failover clusters designed to withstand systemic cyber disruptions.',
          },
        ],
      },
    });

    expect(uploadRes.statusCode).toBe(202);
    const jobData = JSON.parse(uploadRes.body);
    expect(jobData.id || jobData.jobId).toBeDefined();
    expect(jobData.totalDocuments).toBe(2);

    // 8. User A gets job status
    const statusRes = await app.inject({
      method: 'GET',
      url: `/v1/portfolios/${newPortfolio.id}/ingestion-jobs/${jobData.id || jobData.jobId}`,
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(statusRes.statusCode).toBe(200);
    const statusData = JSON.parse(statusRes.body);
    expect(statusData.status).toBe('READY');
    expect(statusData.processedDocuments).toBe(2);

    // 9. User A lists documents for this portfolio
    const docsRes = await app.inject({
      method: 'GET',
      url: `/v1/portfolios/${newPortfolio.id}/documents`,
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(docsRes.statusCode).toBe(200);
    const docs = JSON.parse(docsRes.body);
    expect(docs.length).toBe(2);

    // Portfolio detail now reports document count 2
    const portDetailRes = await app.inject({
      method: 'GET',
      url: `/v1/portfolios/${newPortfolio.id}`,
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(portDetailRes.statusCode).toBe(200);
    const portDetail = JSON.parse(portDetailRes.body);
    expect(portDetail.documentCount).toBe(2);
    expect(portDetail.tenantId).toBeDefined();

    // 9b. Verify Portfolio Retrieval: User A asks a question directly against the portfolio
    const askRes = await app.inject({
      method: 'POST',
      url: `/v1/portfolios/${newPortfolio.id}/ask`,
      headers: { authorization: `Bearer ${userAToken}` },
      payload: {
        question: 'What is Sarah Connor\'s role and core expertise?',
      },
    });
    expect(askRes.statusCode).toBe(200);
    const askData = JSON.parse(askRes.body);
    expect(askData.answer).toBeDefined();
    expect(Array.isArray(askData.citations)).toBe(true);
    expect(askData.portfolioId).toBe(newPortfolio.id);

    // 10. Isolation check: User B cannot delete User A's portfolio
    const unauthorizedDelete = await app.inject({
      method: 'DELETE',
      url: `/v1/portfolios/${newPortfolio.id}`,
      headers: { authorization: `Bearer ${userBToken}` },
    });
    expect([403, 404]).toContain(unauthorizedDelete.statusCode);

    // 11. User A deletes the portfolio and its storage files/folders
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/v1/portfolios/${newPortfolio.id}`,
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(deleteRes.statusCode).toBe(200);
    const deleteData = JSON.parse(deleteRes.body);
    expect(deleteData.success).toBe(true);

    // Portfolio no longer exists
    const deletedGetRes = await app.inject({
      method: 'GET',
      url: `/v1/portfolios/${newPortfolio.id}`,
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(deletedGetRes.statusCode).toBe(404);

    // 12. Logout invalidates the token
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { authorization: `Bearer ${userAToken}` },
    });
    expect(logoutRes.statusCode).toBe(200);

    const loggedOutMeRes = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${userAToken}` },
    });
    // With invalidated token, session resolution treats as unauthenticated public visitor
    const loggedOutData = JSON.parse(loggedOutMeRes.body);
    expect(loggedOutData.isPublicVisitor).toBe(true);
    expect(loggedOutData.user).toBeUndefined();
  });
});
