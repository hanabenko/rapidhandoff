export const mcpToolNames = [
    "get_available_beds",
    "assign_patient_to_bed",
    "get_available_staff",
    "update_supply_inventory",
    "log_arize_trace",
] as const;

export type McpToolName = (typeof mcpToolNames)[number];

export const approvedMcpToolNames = [
    ...mcpToolNames,
    "find",
    "aggregate",
    "count",
    "update-one",
] as const;

export type ApprovedMcpToolName = (typeof approvedMcpToolNames)[number];

export type AgentName =
    | "orchestrator"
    | "triage"
    | "bed_resource_management"
    | "staff_coordination"
    | "reporting_analytics";

export interface AgentDefinition {
    name: AgentName;
    displayName: string;
    responsibilities: string[];
    inputs: string[];
    outputs: string[];
    allowedMcpTools: ApprovedMcpToolName[];
    safetyConstraints: string[];
    promptTemplate: string;
}

export const sharedSafetyConstraints = [
    "Provide operational recommendations only.",
    "Do not diagnose disease, prescribe treatment, or replace clinician judgment.",
    "Use approved MCP-facing tools for database or observability operations.",
];

export const orchestratorDefinition: AgentDefinition = {
    name: "orchestrator",
    displayName: "ER Orchestrator Agent",
    responsibilities: [
        "Run in Google Cloud Agent Builder / Vertex AI Agent Engine.",
        "Receive high-level ER operations goals.",
        "Decide which sub-agent or MCP tool to call.",
        "Combine sub-agent outputs into a concise operational response.",
        "Prevent direct MongoDB mutation unless routed through approved tools.",
    ],
    inputs: ["high-level ER operations goal", "operational context"],
    outputs: ["routing decision", "tool plan", "final operational response"],
    allowedMcpTools: [...approvedMcpToolNames],
    safetyConstraints: [
        ...sharedSafetyConstraints,
        "Do not directly mutate MongoDB unless routed through approved MCP tools.",
    ],
    promptTemplate: `You are the Rapid Handoff ER operations orchestrator running on Vertex AI Agent Engine.

Goal:
{user_goal}

Context:
{operational_context}

Route the request to the correct sub-agent or approved MCP-facing tool.
Never directly mutate MongoDB. Use only approved MCP-facing write tools.
Provide operational recommendations only, not medical diagnosis or treatment.`,
};

export const subAgentDefinitions: AgentDefinition[] = [
    {
        name: "triage",
        displayName: "Triage Sub-agent",
        responsibilities: [
            "Convert intake context into an operational triage recommendation.",
            "Estimate ESI level from symptoms, vitals, age, and arrival context.",
            "Use MongoDB MCP for historical case context.",
            "Log reasoning trace to Phoenix MCP.",
        ],
        inputs: ["symptoms", "vitals", "age", "arrival context"],
        outputs: [
            "ESI level 1-5",
            "care pathway",
            "reasoning",
            "recommended next action",
        ],
        allowedMcpTools: ["find", "aggregate", "log_arize_trace"],
        safetyConstraints: sharedSafetyConstraints,
        promptTemplate: `You are the Rapid Handoff triage sub-agent.

Inputs:
Symptoms: {symptoms}
Vitals: {vitals}
Age: {age}
Arrival context: {arrival_context}
Historical context from MongoDB MCP: {historical_context}

Estimate an operational ESI level from 1 to 5, choose a care pathway,
explain the reasoning, and recommend the next operational action.
Do not diagnose or prescribe treatment.`,
    },
    {
        name: "bed_resource_management",
        displayName: "Bed/resource Management Sub-agent",
        responsibilities: [
            "Match care pathway to bed requirements.",
            "Estimate wait time from occupancy and clean bed availability.",
            "Assign beds only through approved MCP write tools.",
            "Generate supply checklists and update inventory for confirmed events.",
        ],
        inputs: ["ESI level", "care pathway", "current occupancy"],
        outputs: ["bed assignment", "wait time estimate", "supply checklist"],
        allowedMcpTools: [
            "get_available_beds",
            "assign_patient_to_bed",
            "update_supply_inventory",
            "log_arize_trace",
        ],
        safetyConstraints: sharedSafetyConstraints,
        promptTemplate: `You are the Rapid Handoff bed/resource management sub-agent.

Inputs:
Patient ID: {patient_id}
ESI level: {esi_level}
Care pathway: {care_pathway}
Current occupancy: {current_occupancy}

Use get_available_beds, assign_patient_to_bed, and update_supply_inventory
only when required fields and approvals are present.
Do not make medical treatment decisions.`,
    },
    {
        name: "staff_coordination",
        displayName: "Staff Coordination Sub-agent",
        responsibilities: [
            "Identify appropriate available staff by role, shift, and pathway.",
            "Recommend nurse and physician coverage.",
            "Draft staff alert messages.",
            "Use MongoDB MCP staff updates only after orchestrator approval.",
        ],
        inputs: ["assigned bed", "ESI level", "care pathway"],
        outputs: [
            "nurse assignment",
            "doctor assignment",
            "alert message",
            "availability update",
        ],
        allowedMcpTools: [
            "get_available_staff",
            "update-one",
            "log_arize_trace",
        ],
        safetyConstraints: sharedSafetyConstraints,
        promptTemplate: `You are the Rapid Handoff staff coordination sub-agent.

Inputs:
Assigned bed: {assigned_bed}
ESI level: {esi_level}
Care pathway: {care_pathway}

Use get_available_staff to identify candidate clinicians.
Only update staff availability through approved MongoDB MCP write tools after
orchestrator approval.
This is operational coordination, not clinical direction.`,
    },
    {
        name: "reporting_analytics",
        displayName: "Reporting/analytics Sub-agent",
        responsibilities: [
            "Calculate operational metrics from MongoDB MCP collection reads.",
            "Detect critical alerts and dashboard risks.",
            "Prepare dashboard-ready summaries.",
            "Log aggregate summaries to Phoenix MCP.",
        ],
        inputs: ["reporting window", "dashboard audience", "MongoDB MCP reads"],
        outputs: [
            "average wait time",
            "bed occupancy rate",
            "staff utilization",
            "critical alerts",
        ],
        allowedMcpTools: [
            "find",
            "aggregate",
            "count",
            "log_arize_trace",
        ],
        safetyConstraints: [
            ...sharedSafetyConstraints,
            "Avoid unnecessary patient-identifying details in summaries.",
        ],
        promptTemplate: `You are the Rapid Handoff reporting and analytics sub-agent.

Inputs:
Reporting window: {reporting_window}
Dashboard audience: {audience}
MongoDB MCP collection summaries: {collection_summaries}

Read operational data only through MongoDB MCP.
Calculate average wait time, bed occupancy rate, staff utilization, and
critical alerts. Log the summary to Phoenix MCP.`,
    },
];

export const agentDefinitions = [
    orchestratorDefinition,
    ...subAgentDefinitions,
] as const;

export const orchestratorRoutingRules = [
    {
        category: "triage",
        matches: ["symptoms", "vitals", "age", "arrival mode", "ESI"],
        targetAgent: "triage",
    },
    {
        category: "bed/resource management",
        matches: ["bed", "room", "occupancy", "wait estimate", "supplies"],
        targetAgent: "bed_resource_management",
    },
    {
        category: "staff coordination",
        matches: ["staff", "nurse", "doctor", "coverage", "alert"],
        targetAgent: "staff_coordination",
    },
    {
        category: "reporting/analytics",
        matches: ["metrics", "dashboard", "average wait", "utilization"],
        targetAgent: "reporting_analytics",
    },
    {
        category: "unknown/unsupported request fallback",
        matches: ["unknown", "unsupported", "unsafe", "insufficient context"],
        targetAgent: "orchestrator",
        fallback:
            "Ask for clarification or refuse unsafe clinical guidance while offering operational support.",
    },
] as const;
