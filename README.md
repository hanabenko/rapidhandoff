# Rapid Handoff

**Multi-agent ER coordination system** — automates triage, bed assignment, and nurse dispatch in real time using Google ADK + Gemini on Vertex AI.

Built by Laasya Aki and Hana Benko for the [Google Cloud Rapid Agent Hackathon](https://googlecloudmultiagents.devpost.com/) (June 2026).

**Live demo:** https://er-dashboard-813180115279.us-central1.run.app

---

## What It Does

When a patient arrives, a receptionist submits their symptoms through the waiting room check-in form. A multi-agent pipeline runs automatically:

1. **Triage agent** — assesses ESI level (1–5), care pathway, recommended bed type, and escalation flags from symptoms alone (no staff-measured vitals required)
2. **Orchestrator** — registers the patient in MongoDB, queries available beds, assigns one, then delegates to the staff coordinator
3. **Staff coordinator** — finds available nurses/physicians matching the acuity level and assigns them
4. **Live streaming** — every agent step streams back to the UI in real time via Server-Sent Events

The **receptionist dashboard** shows all active patients, a live room map, and an interactive Next Actions panel. Clicking Handle on a cleaning action calls the orchestrator to mark the bed clean, find the highest-priority waiting patient, and assign them — all with live agent reasoning shown inline. Nurse paging works the same way.

---

## Architecture

```
Waiting Room (check-in form)
        │  POST /agent/orchestrate/stream
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
Arize Phoenix  ←──  OTel traces for every agent call

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

- `http://localhost:8080/waiting-room.html` — patient check-in form
- `http://localhost:8080/receptionist.html` — receptionist dashboard

### Deploy to Cloud Run

```bash
gcloud run deploy er-dashboard \
  --source . \
  --region us-central1 \
  --project YOUR_PROJECT_ID
```

### Re-seed Demo Data

```bash
pnpm seed
```

Populates 12 patients (ESI 1–5), 12 beds (4 occupied, 3 awaiting cleaning, 5 ready), 10 staff — designed to surface all dashboard action types.

---

## Agent Tests

```bash
pnpm test:triage   # 5 ESI scenarios (chest pain, fever, laceration, etc.)
pnpm test:staff    # 4 staff coordination scenarios
```
