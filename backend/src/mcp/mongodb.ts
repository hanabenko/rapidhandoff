import { RemoteMcpClient } from "./client.js";
import { getMongoMcpConfig } from "./config.js";
import {
    assignPatientToBedInputSchema,
    getAvailableBedsInputSchema,
    getAvailableStaffInputSchema,
    updateSupplyInventoryInputSchema,
    type AssignPatientToBedInput,
    type GetAvailableBedsInput,
    type GetAvailableStaffInput,
    type UpdateSupplyInventoryInput,
} from "./schemas.js";

export class MongoErMcpAdapter {
    constructor(
        private readonly client = new RemoteMcpClient(
            "mongodb",
            getMongoMcpConfig(),
        ),
    ) {}

    getAvailableBeds(input: GetAvailableBedsInput): Promise<unknown> {
        return this.client.callTool(
            "get_available_beds",
            getAvailableBedsInputSchema.parse(input),
        );
    }

    assignPatientToBed(input: AssignPatientToBedInput): Promise<unknown> {
        return this.client.callTool(
            "assign_patient_to_bed",
            assignPatientToBedInputSchema.parse(input),
        );
    }

    getAvailableStaff(input: GetAvailableStaffInput): Promise<unknown> {
        return this.client.callTool(
            "get_available_staff",
            getAvailableStaffInputSchema.parse(input),
        );
    }

    updateSupplyInventory(
        input: UpdateSupplyInventoryInput,
    ): Promise<unknown> {
        return this.client.callTool(
            "update_supply_inventory",
            updateSupplyInventoryInputSchema.parse(input),
        );
    }

    close(): Promise<void> {
        return this.client.close();
    }
}
