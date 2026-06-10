# Cloud Run deployment

The backend uses the Cloud Run service account through Application Default
Credentials. It does not use a Gemini API key.

## Prerequisites

Set the deployment values:

```bash
export PROJECT_ID="your-project-id"
export REGION="us-central1"
export SERVICE="rapid-handoff-er"
export SERVICE_ACCOUNT="rapid-handoff-er"

gcloud config set project "$PROJECT_ID"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  aiplatform.googleapis.com \
  secretmanager.googleapis.com
```

## 1. Deploy the hello-world path

Cloud Run detects the repository `Dockerfile` when deploying from source:

```bash
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated
```

Verify the container and HTTP listener before adding external services:

```bash
SERVICE_URL="$(gcloud run services describe "$SERVICE" \
  --region "$REGION" \
  --format='value(status.url)')"

curl "$SERVICE_URL/health"
# {"ok":true}
```

## 2. Configure Vertex AI and MongoDB

Create a dedicated runtime identity and grant it permission to call Vertex AI:

```bash
gcloud iam service-accounts create "$SERVICE_ACCOUNT" \
  --display-name="Rapid Handoff ER"

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"
```

Store the MongoDB connection string in Secret Manager:

```bash
gcloud secrets create MONGODB_URI --replication-policy=automatic
printf '%s' 'mongodb+srv://...' | \
  gcloud secrets versions add MONGODB_URI --data-file=-

gcloud secrets add-iam-policy-binding MONGODB_URI \
  --member="serviceAccount:${SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Redeploy with the runtime identity, Vertex AI settings, and MongoDB secret:

```bash
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --service-account="${SERVICE_ACCOUNT}@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-env-vars="GOOGLE_GENAI_USE_VERTEXAI=TRUE,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=${REGION},ER_ORCHESTRATOR_MODEL=gemini-2.5-flash" \
  --set-secrets="MONGODB_URI=MONGODB_URI:latest"
```

Invoke the orchestrator:

```bash
curl -X POST "$SERVICE_URL/agent/orchestrate" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Prepare a concise shift briefing and identify the top bottleneck.",
    "context": {
      "shift": "evening"
    }
  }'
```

Direct tool endpoints are also available:

```text
POST /tools/census
POST /tools/bottlenecks
POST /tools/staffing
POST /tools/beds
POST /tools/briefing
```

Each direct route accepts the same JSON arguments as its corresponding ADK
tool. For example:

```bash
curl -X POST "$SERVICE_URL/tools/census" \
  -H "Content-Type: application/json" \
  -d '{"longWaitMinutes": 90}'
```

For a production deployment, remove `--allow-unauthenticated` and grant
`roles/run.invoker` only to approved callers. MongoDB must also permit outbound
connections from the Cloud Run service.
