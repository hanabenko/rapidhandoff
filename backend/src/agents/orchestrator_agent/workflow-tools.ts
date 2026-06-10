import { FunctionTool } from "@google/adk";

import {
    assignPatientToBedInputSchema,
    assignStaffToPatientInputSchema,
    getAvailableBedsInputSchema,
    getAvailableStaffInputSchema,
    upsertPatientIntakeInputSchema,
} from "../../mcp/schemas.js";
import {
    getMongoErRepository,
    type MongoErRepository,
} from "./data.js";

type RepositoryProvider = () => MongoErRepository;

export function createMongoWorkflowTools(
    repositoryProvider: RepositoryProvider = getMongoErRepository,
) {
    return [
        new FunctionTool({
            name: "upsert_patient_intake",
            description:
                "Creates or updates an ER patient intake record through MongoDB MCP.",
            parameters: upsertPatientIntakeInputSchema,
            execute: (input) =>
                repositoryProvider().upsertPatientIntake(input),
        }),
        new FunctionTool({
            name: "get_available_beds",
            description:
                "Finds clean available ER beds through MongoDB MCP.",
            parameters: getAvailableBedsInputSchema,
            execute: (input) =>
                repositoryProvider().getAvailableBeds(input),
        }),
        new FunctionTool({
            name: "assign_patient_to_bed",
            description:
                "Conditionally reserves an available bed and records the assignment on the patient through MongoDB MCP.",
            parameters: assignPatientToBedInputSchema,
            execute: (input) =>
                repositoryProvider().assignPatientToBed(input),
        }),
        new FunctionTool({
            name: "get_available_staff",
            description:
                "Finds available ER staff by role and shift through MongoDB MCP.",
            parameters: getAvailableStaffInputSchema,
            execute: (input) =>
                repositoryProvider().getAvailableStaff(input),
        }),
        new FunctionTool({
            name: "assign_staff_to_patient",
            description:
                "Conditionally assigns available staff to a patient through MongoDB MCP.",
            parameters: assignStaffToPatientInputSchema,
            execute: (input) =>
                repositoryProvider().assignStaffToPatient(input),
        }),
    ] as const;
}

export const mongoWorkflowTools = createMongoWorkflowTools();
