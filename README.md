# Rapid Handoff

**Multi-agent ER coordination system** — automates triage, bed assignment, and nurse dispatch in real time using Google ADK + Gemini on Vertex AI.

Built by Laasya Aki and Hana Benko for the [Google Cloud Rapid Agent Hackathon](https://googlecloudmultiagents.devpost.com/) (June 2026).

**Live demo:** https://er-dashboard-813180115279.us-central1.run.app

---

## The Problem

The average ER visit takes 2.5 to 4 hours — not because of treatment time, but coordination overhead. Beds sit dirty blocking admissions. Critical patients wait while nurses are manually paged. Rapid Handoff automates that entire pipeline with a multi-agent AI system.

Traditional check-in makes this worse: patients are asked for blood pressure, heart rate, oxygen levels — readings that require equipment they don't have. Rapid Handoff's check-in form only asks questions a patient can answer themselves: pain level, when symptoms started, yes/no flags for breathing trouble, chest pain, bleeding, and confusion. No equipment required — and no blocking on missing vitals.

---

## How It Works

### Patient Check-In (`/waiting-room.html`)

A patient fills out the symptom form and submits. A multi-agent pipeline runs automatically and streams its reasoning live to the screen:

1. **Triage agent** — assigns an ESI level (1–5), recommends a bed type, and flags escalation concerns based on symptoms alone
2. **Orchestrator** — registers the patient in MongoDB, queries available beds, and assigns one
3. **Staff coordinator** — finds available nurses and physicians matching the acuity level and assigns them

The result: patient registered, triaged, bed assigned, care team notified — in under 60 seconds.

### Receptionist Dashboard (`/receptionist.html`)

The receptionist's view shows the full ER state, updated every 30 seconds from MongoDB:

- **Room map** — color-coded: green (clean, ready), amber (needs cleaning, blocking admissions), blue (occupied)
- **Patient queue** — all active patients sorted by triage priority
- **Next Actions** — the system surfaces the highest-priority tasks automatically: rooms that need cleaning, critical patients with no nurse assigned, staff past shift limits

Clicking **Handle** on any action sends a prompt to the orchestrator and streams its reasoning inline. For a cleaning action, the orchestrator marks the bed clean, finds the highest-priority waiting patient, and assigns them — one click, full bed turnover. For a nurse page, it queries available staff and assigns one. The room map flashes and a toast confirms when the action completes.

---

## Architecture

```
Waiting Room (check-in form)
        │  POST /agent/orchestrate/stream (SSE)
        ▼
  Express Backend (Cloud Run)
        │
        ▼
  ER Orchestrator  ←─────────────── analytical tools (census, bottlenecks,
  (LlmAgent / ADK)                  staffing, bed capacity, shift briefing)
        │
        ├──► er_triage_agent (AgentTool)
        │         pure text-output, ESI 1-5 assessment
        │
        ├──► er_staff_coordinator (AgentTool)
        │         queries available staff, matches roles to acuity
        │
        └──► Action tools (FunctionTool → MongoDB)
                  intake_patient, get_available_beds, assign_patient_to_bed,
                  assign_staff_to_patient, mark_bed_cleaned, get_waiting_patients

MongoDB Atlas  ←──  patients, beds, staff, supplies, events
Arize Phoenix  ←──  OTel traces for every agent call and tool invocation

Receptionist Dashboard ──► /api/er-status (polls every 30s)
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Agent framework | [Google ADK](https://google.github.io/adk-docs/) (`@google/adk` v1.2.0) |
| LLM | Gemini 2.5 Flash via Vertex AI |
| Backend | Node.js + Express + TypeScript |
| Database | MongoDB Atlas |
| Observability | Arize Phoenix (OTel tracing) |
| Deploy | Google Cloud Run |
| Frontend | Vanilla HTML/CSS/JS (no build step) |

---

## Setup

### Prerequisites

- Node.js 22+, pnpm
- Google Cloud project with Vertex AI API enabled
- MongoDB Atlas cluster
- `gcloud auth application-default login`

### Environment Variables

Copy `.env.example` to `.env`:

| Variable | Description |
|---|---|
| `GOOGLE_CLOUD_PROJECT` | Your GCP project ID |
| `GOOGLE_CLOUD_LOCATION` | Vertex AI region (e.g. `us-central1`) |
| `GOOGLE_GENAI_USE_VERTEXAI` | Set to `TRUE` — uses Vertex AI, no Gemini API key needed |
| `MONGODB_URI` | MongoDB Atlas SRV connection string |
| `ER_ORCHESTRATOR_MODEL` | Gemini model ID (default: `gemini-2.5-flash`) |
| `ENABLE_PHOENIX` | Set to `true` to enable Arize tracing |
| `PHOENIX_COLLECTOR_ENDPOINT` | Arize Phoenix OTLP endpoint |

### Run Locally

```bash
pnpm install
pnpm seed    # populate MongoDB with demo ER scenario
pnpm dev     # start Express + agent on http://localhost:8080
```

Open two tabs:
- `http://localhost:8080/waiting-room.html` — patient check-in form
- `http://localhost:8080/receptionist.html` — receptionist dashboard

### Seed Demo Data

```bash
pnpm seed
```

Populates 12 patients (ESI 1–5), 12 beds (4 occupied, 3 awaiting cleaning, 5 ready), and 10 staff — designed to surface all dashboard action types: bed cleaning + patient assignment, nurse paging, and shift alerts.

The check-in form is pre-filled with a demo patient (Daniel Kim, 58, thunderclap headache with confusion — a classic ESI 2 presentation) so you can submit immediately.

### Deploy to Cloud Run

```bash
gcloud run deploy er-dashboard \
  --source . \
  --region us-central1 \
  --project YOUR_PROJECT_ID
```

---

## Agent Tests

```bash
pnpm test:triage   # 5 ESI scenarios (chest pain, fever, laceration, etc.)
pnpm test:staff    # 4 staff coordination scenarios
```
