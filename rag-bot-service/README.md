# PersonaRAG Service (`personarag-service`)

> **Enterprise-Ready, Multi-Tenant Retrieval-Augmented Generation (RAG) Service and API**  
> Built with TypeScript, Nest.js, PostgreSQL (pgvector + tsvector), Reciprocal Rank Fusion (RRF), and AWS Serverless Lambda compatibility.

---

## Architecture Overview

PersonaRAG is designed as a **modular monolith** that runs seamlessly as a standalone local Nest.js HTTP server and as an AWS Lambda function behind Amazon API Gateway.

```
                                  ┌───────────────────────────┐
                                  │    Nest.js HTTP Server    │
                                  │            OR             │
                                  │ AWS Lambda / API Gateway  │
                                  └─────────────┬─────────────┘
                                                │
                                    [ Centralized Auth ]
                              Tenant & Entity Scope Enforcement
                                                │
                 ┌──────────────────────────────┴─────────────────────────────┐
                 │                                                            │
    [ Ingestion Pipeline ]                                          [ RAG Retrieval Engine ]
  1. Multiformat Extraction (PDF/DOCX/TXT/MD/OCR)                 1. Query Rewriter (Pronoun resolution)
  2. Recursive Sentence & Boundary Chunking                       2. Dual Search: Dense (pgvector) +
  3. Batch Embeddings Generation                                                  Sparse (tsvector FTS)
  4. Deduplication & Idempotent Indexing                          3. Reciprocal Rank Fusion (RRF)
                 │                                                4. Bounded Context Prompt Generator
                 ▼                                                5. Evidence-Grounded Answer Generation
       [ Storage & Queue Adapters ]                               6. Strict Server-Side Citation Validation
     Local FS / AWS S3 & Local / AWS SQS                                      │
                 │                                                            ▼
                 └──────────────────────────────┬─────────────────────────────┘
                                                │
                                      [ Database Adapter ]
                             PostgreSQL + pgvector / In-Memory Mock
```

---

## Key Features

1. **Strict Tenant & Entity Isolation**:
   - Hierarchy: `Tenant -> Entity -> Document -> Chunk`.
   - Every operation, database query, vector search, citation check, and file storage path is scoped by `tenantId` and `entityId`.
   - Public visitors are restricted exclusively to entities and documents flagged `is_public = true`. Private documents are never exposed.

2. **Advanced Hybrid Retrieval with Reciprocal Rank Fusion (RRF)**:
   - Dense semantic vector similarity (`chunk.embedding <=> query_embedding` via pgvector).
   - Sparse lexical search (`to_tsvector` and `plainto_tsquery` in PostgreSQL).
   - Rank fusion:
     $$RRF(d) = \sum_{m \in \{dense, sparse\}} \frac{1}{k + rank_m(d)} \quad (k = 60)$$

3. **Session-Aware Conversational History**:
   - Multi-turn conversational memory persisted in PostgreSQL.
   - Intelligent Query Rewriter transforms follow-up questions (e.g., *"What were the challenges on that project?"*) into standalone search queries while preserving chat history.

4. **Strict Grounded Generation & Citation Verification**:
   - Answers are strictly anchored to retrieved document chunks.
   - Unsupported or out-of-domain questions receive an explicit, safe abstention: *"Insufficient evidence: I do not have sufficient evidence in the uploaded documents to answer this question."*
   - Server-side citation validation filters out any hallucinated chunk references.

5. **Dual Operating Modes**:
   - **Mock Mode (`AI_PROVIDER=mock`)**: 100% deterministic, zero external paid credentials required. Uses token-hashed normalized vectors and deterministic evidence generation for instant developer testing.
   - **Real AI Mode (`AI_PROVIDER=openai`)**: Connects to OpenAI, Azure OpenAI, Ollama, Groq, or OpenRouter via configurable base URL and API keys.

---

## Directory Structure

```text
personarag-service/
├── src/
│   ├── app.ts                  # Fastify application builder and route registration
│   ├── server.ts               # Local HTTP server entry point
│   ├── lambda.ts               # AWS Lambda entry point (API Gateway + SQS worker)
│   ├── config/env.ts           # Zod-validated environment configuration
│   ├── modules/
│   │   ├── auth/               # Centralized authorization & scope enforcement
│   │   ├── tenants/            # Tenant management
│   │   ├── entities/           # Entity (portfolio) profiles
│   │   ├── documents/          # Document registration & storage
│   │   ├── ingestion/          # Async ingestion pipeline & local worker
│   │   ├── extraction/         # PDF, DOCX, TXT, Markdown, OCR extractors
│   │   ├── chunking/           # Recursive boundary-aware chunking
│   │   ├── embeddings/         # Vector embeddings generator
│   │   ├── retrieval/          # Hybrid search & Reciprocal Rank Fusion
│   │   ├── conversations/      # Sessions, messages & query rewriter
│   │   ├── generation/         # Grounded prompts & LLM generation
│   │   ├── citations/          # Citation extraction & server-side validation
│   │   └── health/             # Health status probe
│   ├── adapters/
│   │   ├── storage/            # Local filesystem & AWS S3 adapters
│   │   ├── queue/              # Local in-memory queue & AWS SQS adapters
│   │   ├── database/           # PostgreSQL (pgvector) & Memory adapters
│   │   └── ai/                 # OpenAI-compatible & Mock AI adapters
│   ├── middleware/             # Rate limiter, tenant context, error handler
│   ├── shared/                 # Errors, logger, utilities (cosine similarity, sha256)
│   └── types/                  # TypeScript domain models
├── migrations/
│   └── 001_init.sql            # PostgreSQL + pgvector schema & indexes
├── scripts/
│   ├── seed.ts                 # Database seed script
│   └── package-lambda.ts       # Bundles standalone Lambda deployment ZIP
├── tests/
│   ├── unit/                   # Chunking, extraction, embeddings, RRF, citations
│   ├── integration/            # Health, ingestion, conversations, Lambda handler
│   └── security/               # Tenant isolation, public/private access, adversarial
├── fixtures/                   # Sample resume, portfolio, and confidential memos
├── Dockerfile                  # Multi-stage production container build
├── docker-compose.yml          # PostgreSQL pgvector + API services
├── template.yaml               # AWS SAM Infrastructure template
└── package.json
```

---

## Quickstart (Local Development)

### Prerequisites

- Node.js 20+ or 24+
- Docker & Docker Compose (optional for local PostgreSQL)

### 1. Installation

```bash
cd personarag-service
npm install
```

### 2. Environment Setup

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Default settings in `.env` are configured for **Mock Mode** (`AI_PROVIDER=mock`) and **Memory Adapter**, which runs out-of-the-box without requiring database credentials or paid API keys.

To run with PostgreSQL and pgvector:

```bash
# Start PostgreSQL pgvector container
docker compose up -d postgres

# Run database migrations
npm run db:migrate

# Seed sample tenants and entities
npm run db:seed
```

### 3. Start the Local Server

```bash
npm run dev
```

The server starts at: `http://localhost:3000`
- Swagger Documentation: `http://localhost:3000/documentation`
- Health Probe: `http://localhost:3000/health`

---

## Automated Tests

PersonaRAG contains 28 comprehensive automated tests covering unit logic, integration workflows, and security isolation:

```bash
npm run test
```

### Security & Adversarial Tests

Run the security suite explicitly:

```bash
npm run test:security
```

Tests verify:
- Cross-tenant data leakage prevention
- Private document masking against public visitors
- Prompt-injection resistance inside uploaded document bodies
- Citation tampering and hallucinated ID rejection

---

## API Reference

### 1. Health Probe
```bash
GET /health
```

### 2. Create Ingestion Job
```bash
POST /v1/tenants/:tenantId/entities/:entityId/ingestion-jobs
Content-Type: application/json
Authorization: Bearer <AUTH_SECRET>

{
  "files": [
    {
      "filename": "alex-resume.txt",
      "mimeType": "text/plain",
      "content": "Alex Rivera is a Senior Distributed Systems Architect with 12+ years of experience designing multi-tenant RAG systems."
    }
  ]
}
```
*Note: Also supports standard `multipart/form-data` uploads.*

### 3. Ingestion Job Status
```bash
GET /v1/tenants/:tenantId/entities/:entityId/ingestion-jobs/:jobId
```

### 4. Create Conversation
```bash
POST /v1/tenants/:tenantId/entities/:entityId/conversations
Content-Type: application/json

{
  "title": "Career Q&A Session"
}
```

### 5. Send Message & Query Knowledge Base
```bash
POST /v1/tenants/:tenantId/entities/:entityId/conversations/:conversationId/messages
Content-Type: application/json

{
  "content": "What experience does Alex have with distributed systems?"
}
```

**Response Format**:
```json
{
  "answer": "Based on the provided portfolio documents:\n\nAccording to the records: \"Alex Rivera is a Senior Distributed Systems Architect with 12+ years of experience...\" [DOC-2394cba8-1a2f-4db4-b2ef-374e502570d1]",
  "citations": [
    {
      "id": "e5c1dfab-8d99-4c91-b3b3-847290ffea34",
      "chunkId": "2394cba8-1a2f-4db4-b2ef-374e502570d1",
      "documentId": "18d6a171-8077-440a-bfa7-3be3c5b3c4d6",
      "documentTitle": "alex-resume.txt",
      "snippet": "Alex Rivera is a Senior Distributed Systems Architect with 12+ years of experience...",
      "pageNumber": 1,
      "score": 0.0325
    }
  ],
  "insufficientEvidence": false,
  "confidence": 0.95,
  "conversationId": "47a8a0f8-ca96-4bf4-a2f5-412b27696178",
  "messageId": "9b6f3c5c-9992-4092-801b-d279209596cd"
}
```

---

## AWS Lambda & Serverless Packaging

PersonaRAG can be compiled and packaged into a production AWS Lambda bundle:

```bash
npm run build
npm run package:lambda
```

This generates `dist/lambda-bundle.zip`, containing the minified standalone bundle with:
- `lambda.handler`: API Gateway HTTP API entry point
- `lambda.sqsIngestionHandler`: Asynchronous SQS worker trigger

### Deploying with AWS SAM

```bash
sam deploy --guided --template-file template.yaml
```

The SAM template provisions:
- API Gateway HTTP API with CORS configuration
- Lambda Functions (ARM64, Node.js 20.x runtime)
- S3 Bucket with SSE-AES256 and public access block
- SQS FIFO / Standard Ingestion Queue with Dead-Letter Queue (DLQ)
- Least-privilege IAM policies

