import {
    MongoErMcpAdapter,
    type Bed,
    type ErEvent,
    type ErSnapshot,
    type MongoErRepository,
    type Patient,
    type PatientStatus,
    type StaffMember,
    type TriageLevel,
} from "../../mcp/mongodb.js";

let repository: MongoErRepository | undefined;

export function getMongoErRepository(): MongoErRepository {
    repository ??= new MongoErMcpAdapter();
    return repository;
}

export function loadErSnapshot(
    source: Pick<MongoErRepository, "loadSnapshot"> = getMongoErRepository(),
): Promise<ErSnapshot> {
    return source.loadSnapshot();
}

export type {
    Bed,
    ErEvent,
    ErSnapshot,
    MongoErRepository,
    Patient,
    PatientStatus,
    StaffMember,
    TriageLevel,
};
