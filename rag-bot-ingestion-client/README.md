# PersonaRAG Ingestion Client (`personarag-ingestion-client`)

> **Minimal Multi-Tenant Document Ingestion Frontend for PersonaRAG**  
> Built with React, TypeScript, and Vite.

---

## Overview

The `personarag-ingestion-client` is a lightweight, decoupled frontend application for uploading professional documents (resumes, portfolios, research papers, clinical records) directly into a selected PersonaRAG entity.

### How it Communicates with the RAG Service

```
┌─────────────────────────────────┐                 ┌─────────────────────────────────┐
│   Ingestion Client (React/Vite) │                 │   PersonaRAG Service (Fastify)  │
└────────────────┬────────────────┘                 └────────────────┬────────────────┘
                 │                                                   │
                 │ 1. POST /v1/tenants/:t/entities/:e/ingestion-jobs │
                 ├──────────────────────────────────────────────────>│
                 │    (multipart/form-data with documents)           │
                 │                                                   │
                 │ 2. Returns jobId, statusUrl, totalDocuments       │
                 │<──────────────────────────────────────────────────┤
                 │                                                   │
                 │ 3. Polls GET .../ingestion-jobs/:jobId            │
                 ├──────────────────────────────────────────────────>│ (Checks processing status)
                 │    Status: PROCESSING / READY                     │
                 │<──────────────────────────────────────────────────┤
                 │                                                   │
                 │ 4. GET .../ingestion-jobs/:jobId/documents        │
                 ├──────────────────────────────────────────────────>│ (Fetches per-document status)
                 │    Document status breakdown & errors             │
                 │<──────────────────────────────────────────────────┤
                 │                                                   │
                 │ 5. Optional Q&A: POST .../conversations/:c/messages│
                 ├──────────────────────────────────────────────────>│ (Immediate retrieval verification)
                 │    Answer + Verified evidence citations           │
                 │<──────────────────────────────────────────────────┤
```

---

## Features

1. **Target Environment & Entity Scope**:
   - Configurable RAG API Base URL (defaults to `http://localhost:3000`).
   - Tenant ID and Entity ID selection (strict isolation: files never mix across entities).
   - Optional bearer authorization token for secure upload access.

2. **Drag & Drop Multiple File Upload**:
   - Drag and drop or browse multiple documents simultaneously.
   - Real-time file list with size formatting and MIME type detection.
   - Supports PDF, DOCX, TXT, Markdown, and images.

3. **Real-Time Ingestion Job Polling**:
   - Displays Job ID, Entity ID, returned Status URL, and overall Status (`PENDING`, `PROCESSING`, `READY`, `FAILED`).
   - Auto-polls every 1.5 seconds until indexing finishes.
   - Manual refresh and retry controls.

4. **Per-Document Status & Error Breakdown**:
   - Table detailing each document's processing state.
   - Shows actionable error messages if a file is unparseable or corrupted.

5. **Instant Grounded Q&A Verification**:
   - Integrated test query bar to test retrieval and evidence citations immediately after indexing completes.

---

## Setup & Running Locally

### Prerequisites

- Node.js 20+ or 24+
- `personarag-service` running at `http://localhost:3000`

### 1. Installation

```bash
cd personarag-ingestion-client
npm install
```

### 2. Development Mode

```bash
npm run dev
```

The frontend will start at: `http://localhost:5173`.

### 3. Build for Production

```bash
npm run build
npm run preview
```

### 4. Running Automated Tests

```bash
npm run test
```

---

## Security & CORS Notice

The client runs completely unprivileged:
- It contains **no AWS credentials** and **no database credentials**.
- All interaction occurs through the authenticated REST API.
- CORS is enforced server-side through an allowlist (default: `http://localhost:5173`).

