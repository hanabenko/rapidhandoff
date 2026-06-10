import type { OperationsStatus, OrchestrateResponse } from "../types";
import { StatusView } from "./StatusView";

interface InternalOperationsProps {
    status?: OperationsStatus;
    latestResult?: OrchestrateResponse;
    isLoading: boolean;
    error?: string;
    onRefresh(): void;
}

function titleCase(value: string): string {
    return value.replaceAll("_", " ");
}

export function InternalOperations({
    status,
    latestResult,
    isLoading,
    error,
    onRefresh,
}: InternalOperationsProps) {
    const workflow = latestResult?.workflow;
    const availableBeds =
        status?.beds.filter((bed) => bed.status === "available").length ?? 0;
    const availableStaff =
        status?.staff.filter((staff) => staff.available).length ?? 0;

    return (
        <div className="internal-view">
            <section className="metric-grid" aria-label="Operations metrics">
                <article className="metric-card">
                    <span>Active queue</span>
                    <strong>{status?.activeQueue.length ?? 0}</strong>
                    <small>waiting or in treatment</small>
                </article>
                <article className="metric-card">
                    <span>Available beds</span>
                    <strong>{availableBeds}</strong>
                    <small>ready for assignment</small>
                </article>
                <article className="metric-card">
                    <span>Available staff</span>
                    <strong>{availableStaff}</strong>
                    <small>on current snapshot</small>
                </article>
                <article className="metric-card">
                    <span>Latest trace</span>
                    <strong>{latestResult?.traceId ? "Captured" : "None"}</strong>
                    <small>current browser session</small>
                </article>
            </section>

            <div className="operations-grid">
                <section className="panel queue-panel">
                    <div className="panel-heading status-heading">
                        <div>
                            <p className="eyebrow">Patient flow</p>
                            <h2>Active queue</h2>
                        </div>
                        <button
                            className="text-button"
                            type="button"
                            onClick={onRefresh}
                            disabled={isLoading}
                        >
                            {isLoading ? "Refreshing..." : "Refresh"}
                        </button>
                    </div>

                    {error && <p className="inline-error">{error}</p>}
                    <div className="queue-list">
                        {status?.activeQueue.map((patient) => (
                            <article
                                className="queue-item"
                                key={patient.patientId}
                            >
                                <div>
                                    <strong>{patient.patientId}</strong>
                                    <small>
                                        Arrived{" "}
                                        {new Date(
                                            patient.arrivalTime,
                                        ).toLocaleTimeString([], {
                                            hour: "2-digit",
                                            minute: "2-digit",
                                        })}
                                    </small>
                                </div>
                                <div className="queue-assignment">
                                    <span>
                                        {patient.assignedBedId ??
                                            "Bed pending"}
                                    </span>
                                    <small>
                                        {patient.assignedStaffIds.length
                                            ? patient.assignedStaffIds.join(
                                                  ", ",
                                              )
                                            : "Staff pending"}
                                    </small>
                                </div>
                                <span
                                    className={`status-pill ${
                                        patient.status === "waiting"
                                            ? "waiting"
                                            : "available"
                                    }`}
                                >
                                    {titleCase(
                                        patient.triageLevel ?? patient.status,
                                    )}
                                </span>
                            </article>
                        ))}
                        {!isLoading && !status?.activeQueue.length && (
                            <div className="compact-empty">
                                No active patients in the current MongoDB
                                snapshot.
                            </div>
                        )}
                    </div>
                </section>

                <section className="panel latest-panel">
                    <div className="panel-heading status-heading">
                        <div>
                            <p className="eyebrow">Latest handoff</p>
                            <h2>Agent decisions</h2>
                        </div>
                    </div>

                    {workflow ? (
                        <div className="latest-content">
                            <dl className="handoff-list">
                                <div>
                                    <dt>Triage</dt>
                                    <dd>
                                        {titleCase(workflow.triage.severity)} /{" "}
                                        {titleCase(workflow.triage.urgency)}
                                    </dd>
                                </div>
                                <div>
                                    <dt>Assigned bed</dt>
                                    <dd>
                                        {
                                            workflow.bedAssignment
                                                .selectedBedId
                                        }
                                    </dd>
                                </div>
                                <div>
                                    <dt>Assigned staff</dt>
                                    <dd>
                                        {workflow.staffAssignment.assignedStaffIds.join(
                                            ", ",
                                        )}
                                    </dd>
                                </div>
                                <div>
                                    <dt>Wait estimate</dt>
                                    <dd>
                                        {
                                            workflow.bedAssignment
                                                .estimatedWaitMinutes
                                        }{" "}
                                        min
                                    </dd>
                                </div>
                            </dl>
                            <div className="summary-copy">
                                <p className="eyebrow">Reporting agent</p>
                                <p>
                                    {
                                        workflow.reporting
                                            .operationalSummary
                                    }
                                </p>
                            </div>
                            <div className="trace-line">
                                <span>Trace / workflow ID</span>
                                <code>
                                    {latestResult.traceId ??
                                        workflow.reporting.patientId}
                                </code>
                            </div>
                        </div>
                    ) : (
                        <div className="compact-empty">
                            Complete an intake in this browser session to show
                            the latest delegated workflow decisions.
                        </div>
                    )}
                </section>
            </div>

            <StatusView
                status={status}
                isLoading={isLoading}
                error={error}
                onRefresh={onRefresh}
            />
        </div>
    );
}
