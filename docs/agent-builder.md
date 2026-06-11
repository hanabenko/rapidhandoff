# Agent Builder integration

## Current state

The production backend already uses the Google ADK `LlmAgent` runtime and
Vertex-hosted Gemini models. It is not currently deployed as a managed Vertex
AI Agent Engine resource. The public orchestration surface is the Cloud Run
`POST /agent/orchestrate` endpoint.

The integration contract in
[`agent-builder-openapi.yaml`](agent-builder-openapi.yaml) allows an Agent
Builder or Agent Engine shell to invoke that production workflow as an
authenticated OpenAPI tool. This keeps Agent Builder responsible for the
top-level user interaction while the backend remains responsible for the
typed ER transaction.

## Invocation path

1. Agent Builder receives an ER coordination request.
2. Its instruction requires structured patient workflow data and selects the
   `coordinateErWorkflow` OpenAPI operation.
3. Agent Builder sends one authenticated request to
   `POST /agent/orchestrate`.
4. The backend ADK orchestrator delegates to triage, bed management, staff
   coordination, and reporting agents.
5. Deterministic guardrails validate each Gemini proposal.
6. MongoDB MCP repository tools read and mutate operational state.
7. OpenTelemetry exports the nested workflow to Phoenix/Arize.
8. The response returns the agent timeline, write evidence, workflow ID, and
   trace ID to Agent Builder.

Agent Builder does not call MongoDB directly and does not receive database
credentials.

## Registration

1. Deploy the backend using [`cloud-run.md`](cloud-run.md).
2. Replace `https://YOUR_CLOUD_RUN_SERVICE_URL` in
   `agent-builder-openapi.yaml` with the deployed service URL.
3. In Vertex AI Agent Builder, create or open the root ER operations agent.
4. Add an OpenAPI tool and import `agent-builder-openapi.yaml`.
5. Configure bearer authentication using a Google-signed ID token for the
   Cloud Run audience. Grant the Agent Builder runtime service account
   `roles/run.invoker` on the service.
6. Use this root instruction:

   > For structured ER intake and resource coordination, call
   > `coordinateErWorkflow`. Do not invent bed or staff assignments. Present
   > the returned agent timeline and execution evidence as the authoritative
   > operational result.

7. Test with a non-sensitive demo patient label and verify:
   - the Agent Builder tool invocation succeeds;
   - MongoDB state changes;
   - the response contains five timeline steps;
   - the trace ID is visible in Phoenix.

Official platform references:

- [Vertex AI Agent Builder](https://cloud.google.com/products/agent-builder)
- [Vertex AI Agent Engine overview](https://cloud.google.com/vertex-ai/generative-ai/docs/agent-engine/overview)
- [Cloud Run service-to-service authentication](https://cloud.google.com/run/docs/authenticating/service-to-service)

Do not describe the project as deployed to Agent Engine until the resource is
actually registered and the invocation test above passes.
