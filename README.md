# RAG-BOT: Enterprise Multi-Tenant RAG Platform

> **Production-minded, multi-tenant Retrieval-Augmented Generation (RAG) platform with decoupled ingestion and developer playground.**

---

## Repositories

This workspace contains three independent, decoupled repositories:

1. [`rag-bot-service`](./rag-bot-service) — Modular monolith backend implementing the core RAG API, hybrid retrieval engine (pgvector dense search + tsvector sparse search with Reciprocal Rank Fusion), async ingestion pipeline, user onboarding & registration, conversational history manager, query rewriter, local Nest.js server, and AWS Lambda serverless handler.
2. [`rag-bot-ingestion-client`](./rag-bot-ingestion-client) — Standalone React + TypeScript frontend for selecting entity targets, uploading multiple files with drag-and-drop, tracking async ingestion status, and verifying evidence-backed citations.
3. [`rag-bot-playground`](./rag-bot-playground) — Developer-facing RAG testing and demonstration UI for interactive conversations, multi-strategy retrieval preset comparison, candidate diagnostics, safe cURL export, and 1-click workspace switching.

---

## Architecture Diagram

```text
 ┌──────────────────────────────────┐        ┌──────────────────────────────────┐
 │     rag-bot-ingestion-client     │        │        rag-bot-playground        │
 │   (React + TypeScript + Vite)    │        │   (React + TypeScript + Vite)    │
 └─────────────────┬────────────────┘        └─────────────────┬────────────────┘
                   │                                           │
                   │               REST API / CORS             │
                   └───────────────────────┬───────────────────┘
                                           │
                                           ▼
 ┌──────────────────────────────────────────────────────────────────────────────┐
 │                              rag-bot-service                                 │
 │               (Nest.js Local Server / AWS Lambda API Gateway)                │
 ├──────────────────────────────────────────────────────────────────────────────┤
 │                                                                              │
 │  1. Centralized Authorization & Automated Registration                       │
 │     - User & Tenant Registration (`POST /v1/auth/register`)                  │
 │     - 1-Click Demo Profiles & Auto-Managed Sessions (`/v1/auth/demo-profiles`)│
 │     - Strict Tenant & Entity Scope Validation (Bearer / Dev / Guest)         │
 │                                                                              │
 │  2. Asynchronous Document Ingestion Pipeline                                 │
 │     - Extractors: PDF, DOCX, TXT, Markdown, OCR                              │
 │     - Recursive Boundary Chunking (provenance tracked)                       │
 │     - Embeddings Generation (OpenAI / Mock Provider)                         │
 │     - Deduplication & Idempotent Vector Indexing                             │
 │                                                                              │
 │  3. Hybrid Retrieval & RAG Generation                                        │
 │     - Conversational Query Rewriter (pronoun resolution & entity context)    │
 │     - Dense Search (pgvector cosine similarity)                              │
 │     - Sparse Search (PostgreSQL tsvector FTS)                                │
 │     - Reciprocal Rank Fusion (RRF k=60)                                      │
 │     - Evidence-Grounded Answer Generation                                    │
 │     - Strict Server-Side Citation Validation                                 │
 │     - Candidate Diagnostics & Parameter Tuning (topK, minScore, mode)        │
 │                                                                              │
 │  4. Swappable Infrastructure Adapters                                        │
 │     - Storage: Local Filesystem / Amazon S3                                  │
 │     - Queue: Local In-Memory / Amazon SQS (+ DLQ)                            │
 │     - Database: PostgreSQL (pgvector) / Memory Adapter                       │
 │     - AI: OpenAI-Compatible / Deterministic Mock                             │
 └──────────────────────────────────────────────────────────────────────────────┘
```

---

## Acceptance Criteria Verification Summary

| # | Acceptance Criterion | Verification Status | Test Suite Location |
|---|----------------------|---------------------|---------------------|
| 1 | Local server starts and responds to health checks | **PASSED** | `tests/integration/health.test.ts` |
| 2 | Database migrations work from an empty database | **PASSED** | `migrations/001_init.sql`, `migrate.ts` |
| 3 | Multiple files can be submitted in one ingestion job | **PASSED** | `tests/integration/ingestion-flow.test.ts` |
| 4 | Documents are associated with the intended entity | **PASSED** | `tests/integration/ingestion-flow.test.ts` |
| 5 | Document processing is idempotent | **PASSED** | `tests/integration/ingestion-flow.test.ts` |
| 6 | Processing failures are reported and retried safely | **PASSED** | `tests/integration/ingestion-flow.test.ts` |
| 7 | A query retrieves evidence from the correct entity | **PASSED** | `tests/integration/conversations-flow.test.ts` |
| 8 | Follow-up questions use correct conversation history | **PASSED** | `tests/integration/conversations-flow.test.ts` |
| 9 | Citations resolve to real source chunks | **PASSED** | `tests/unit/citations.test.ts` |
| 10 | Unsupported questions receive safe abstention | **PASSED** | `tests/integration/conversations-flow.test.ts` |
| 11 | Tenant cannot retrieve another tenant's chunks | **PASSED** | `tests/security/tenant-isolation.test.ts` |
| 12 | One entity cannot access another entity's private chunks | **PASSED** | `tests/security/tenant-isolation.test.ts` |
| 13 | One user cannot access another user's private conversation | **PASSED** | `tests/security/tenant-isolation.test.ts` |
| 14 | Public visitor cannot retrieve private documents | **PASSED** | `tests/security/public-private-access.test.ts` |
| 15 | Lambda handler invocable with API Gateway event | **PASSED** | `tests/integration/lambda-handler.test.ts` |
| 16 | Lambda ZIP contains configured entry point | **PASSED** | `scripts/package-lambda.ts` (1.72 MB ZIP) |
| 17 | Ingestion client can submit files & poll status | **PASSED** | `rag-bot-ingestion-client/tests/` |
| 18 | Playground tests RAG retrieval, presets & logs | **PASSED** | `rag-bot-playground/tests/` |
| 19 | Registration & 1-click workspace onboarding | **PASSED** | `tests/integration/auth-onboarding.test.ts` |

---

## Getting Started

### Step 1: Start `rag-bot-service` (API & Ingestion Service)

```bash
cd rag-bot-service
npm install
npm test
npm run dev
```

Server runs at `http://localhost:3000` (Swagger docs at `http://localhost:3000/documentation`).

### Step 2: Start `rag-bot-ingestion-client` (Document Upload UI)

In a separate terminal:

```bash
cd rag-bot-ingestion-client
npm install
npm test
npm run dev
```

Ingestion Client runs at `http://localhost:5173`.

### Step 3: Start `rag-bot-playground` (Interactive RAG Testing & Debugging UI)

In a third terminal:

```bash
cd rag-bot-playground
npm install
npm test
npm run dev
```

Playground runs at `http://localhost:5174`.

### Step 4: Run the Full Platform Workflow

1. Open Ingestion Client at `http://localhost:5173` or Playground at `http://localhost:5174`.
2. Connect with **1-click** using pre-configured profiles (`Alex Chen @ Acme Cloud`, `Dr. Jane Doe @ BioHealth Global`), or click **"Register New Workspace"** to provision your own tenant and portfolio. No manual UUIDs or API keys needed!
3. Drag and drop sample files from `rag-bot-service/fixtures` (`sample-resume.txt`, `sample-portfolio.md`) and submit them for indexing.
4. Run side-by-side retrieval preset comparisons (Hybrid RRF vs Dense vs Sparse) and inspect dense/sparse candidate rankings and verified source citations.
5. Inspect the live HTTP Inspector: view sanitized headers (`Authorization: Bearer [REDACTED_SECRET_TOKEN]`) and copy safe cURL commands.

