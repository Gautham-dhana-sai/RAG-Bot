# PersonaRAG Playground — Retrieval Testing & Debugging UI

A developer-facing testing and diagnostic application for the **PersonaRAG** multi-tenant conversational career retrieval platform.

The playground communicates directly with the real APIs exposed by `personarag-service`. It does **not** reimplement RAG logic or mock production responses.

---

## 1. Key Capabilities

### 🎛️ Three-Panel Diagnostic Layout
- **Left Panel (Configuration & Context)**:
  - Configure API Base URL (`http://localhost:3000` by default).
  - Select Auth Mode: `Bearer Token`, `Dev Headers` (`X-User-Id`, `X-Tenant-Id`), or `Public Anonymous`.
  - Masked Token Input with explicit **Opt-In** local storage toggle and safety warnings.
  - Active Tenant and Entity selection with auto-fetch and live backend health check badge.
  - **Entity-Switch Detachment**: Changing the active entity immediately detaches and clears the current conversation to prevent cross-tenant/cross-entity context leakage.

- **Center Panel (Interactive Playground & Retrieval Experiments)**:
  - **Conversational Chat**: Create sessions, ask career questions, inspect inline verified citations `[1]`, view latency, rewritten queries, and confidence scores.
  - **Side-by-Side Preset Comparison Matrix**: Run identical queries across retrieval strategies (`Hybrid RRF`, `Semantic Only`, `Keyword Only`, `Strict Precision`) and compare answer accuracy, citation relevance, and latency side-by-side.
  - **History Testing Workflow**: Inspect conversation turns, reload session history directly from PostgreSQL, or clear the local view.

- **Right Panel (Real-Time Inspector & Diagnostics)**:
  - **HTTP Inspector**: Inspect real request headers (with `Authorization: Bearer [REDACTED_SECRET_TOKEN]`), HTTP status, duration in milliseconds, response headers, and raw JSON payloads.
  - **Sanitized cURL Export**: One-click copy with safe environment variables (`Authorization: Bearer $RAG_API_TOKEN`) to prevent token leaks in command line logs.
  - **Retrieval Strategy Inspector**: Direct candidate ranking diagnostic tool showing dense semantic rank, sparse BM25/tsvector rank, and Reciprocal Rank Fusion (RRF) scores with chunk snippets.
  - **Ingestion Status Viewer**: Real-time polling of backend document ingestion jobs, chunk counts, and processing errors.

---

## 2. Backward-Compatible Backend Endpoints

To support interactive testing without altering existing business logic, the following backward-compatible endpoints were integrated in `personarag-service`:

1. **`GET /v1/tenants/:tenantId/entities/:entityId/conversations`**:
   - Lists historical conversation sessions for the active entity.
2. **`POST /v1/tenants/:tenantId/entities/:entityId/retrieval/diagnostics`**:
   - Runs hybrid, dense, or sparse retrieval against an entity's indexed documents without generating LLM completions. Returns raw candidate rankings, similarity scores, and reciprocal fusion values.
3. **Optional Query Parameters in `POST .../messages`**:
   - `topK`: Number of chunks to retrieve (default: 10).
   - `retrievalMode`: `'hybrid' | 'dense' | 'sparse'` (default: hybrid).
   - `minScore`: Score threshold cutoff.
   - `includeDiagnostics`: When `true`, returns rewritten query and retrieval execution metrics.

---

## 3. Security & Isolation Safeguards

- **Token Redaction Everywhere**: Secret tokens are masked upon entry (`••••••••`), redacted in inspector headers (`Bearer [REDACTED_SECRET_TOKEN]`), and replaced with `$RAG_API_TOKEN` in copied cURL strings.
- **Opt-In Token Retention**: Tokens are **never** persisted to `localStorage` unless the developer explicitly clicks "Persist token for local dev". A "Clear Token" button immediately deletes it.
- **Strict Entity Separation**: Switching entity IDs detaches the current conversation ID immediately to guarantee zero history contamination.

---

## 4. Getting Started

### Prerequisites
- Node.js LTS (v18+)
- Running `personarag-service` instance (by default at `http://localhost:3000`)

### Installation & Run
```bash
# Navigate to playground directory
cd personarag-playground

# Install dependencies
npm install

# Start development server (runs on http://localhost:5174)
npm run dev

# Run unit and integration tests
npm test

# Build for production
npm run build
```

---

## 5. Environment Configuration

Copy `.env.example` to `.env` if custom defaults are required:

```bash
cp .env.example .env
```

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `VITE_RAG_API_URL` | `http://localhost:3000` | Base URL of the PersonaRAG API service |
| `VITE_DEFAULT_TENANT_ID` | `0164d75c-ad5a-4a6b-98a9-7ec4aacd0529` | Pre-seeded Acme Cloud Systems tenant |
| `VITE_DEFAULT_ENTITY_ID` | `e29fa525-0079-44c0-b5f5-183a8b4e093d` | Pre-seeded Alex Chen entity |

---

## 6. Verification & Test Suite

The test suite validates:
- **Redaction**: Verifies headers and cURL commands never leak raw bearer credentials.
- **Storage Safety**: Asserts tokens are discarded when opt-in persistence is disabled.
- **Entity Detachment**: Tests that switching entities resets the active conversation ID.
- **API Client**: Validates health checks, conversation management, message requests with retrieval modes, and diagnostics endpoints.

