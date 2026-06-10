import type { OrchestrateResponse } from "../types";

interface OperationsSummaryProps {
    result?: OrchestrateResponse;
    error?: string;
    isSubmitting: boolean;
}

function titleCase(value: string): string {
    return value.replaceAll("_", " ");
}

export function OperationsSummary({
    result,
    error,
    isSubmitting,
}: OperationsSummaryProps) {
    const workflow = result?.workflow;

    return (
        <section className="panel summary-panel">
            <div className="panel-heading">
                <div>
                    <p className="eyebrow">Agent handoff</p>
                    <h2>Operations summary</h2>
                </div>
                <span className="step-number">02</span>
            </div>

            {isSubmitting && (
                <div className="state-card loading-state">
                    <span className="loading-dot" />
                    Evaluating triage, beds, and staff.
                </div>
            )}

            {error && (
                <div className="state-card error-state">
                    <strong>Workflow could not complete.</strong>
                    <span>{error}</span>
                </div>
            )}

            {!isSubmitting && !error && !result && (
                <div className="empty-state">
                    <span className="empty-mark">RH</span>
                    <p>
                        Submit an intake to see the delegated ER workflow
                        decisions here.
                    </p>
                </div>
            )}

            {result && workflow && (
                <div className="summary-content">
                    <div className="decision-grid">
                        <article className="decision-card emphasis-card">
                            <span>Triage</span>
                            <strong>
                                {titleCase(workflow.triage.severity)}
                            </strong>
                            <small>
                                {titleCase(workflow.triage.urgency)} priority
                            </small>
                        </article>
                        <article className="decision-card">
                            <span>Assigned bed</span>
                            <strong>
                                {workflow.bedAssignment.selectedBedId ??
                                    "Pending"}
                            </strong>
                            <small>
                                {titleCase(
                                    workflow.bedAssignment.selectedBedType,
                                )}
                            </small>
                        </article>
                        <article className="decision-card">
                            <span>Staff</span>
                            <strong>
                                {
                                    workflow.staffAssignment.assignedStaffIds
                                        .length
                                }{" "}
                                assigned
                            </strong>
                            <small>
                                {workflow.staffAssignment.assignedRoles
                                    .map(titleCase)
                                    .join(" + ")}
                            </small>
                        </article>
                        <article className="decision-card">
                            <span>Wait estimate</span>
                            <strong>
                                {workflow.bedAssignment.estimatedWaitMinutes}{" "}
                                min
                            </strong>
                            <small>
                                {titleCase(workflow.triage.routingPriority)}
                            </small>
                        </article>
                    </div>

                    <div className="summary-copy">
                        <p className="eyebrow">Reporting agent</p>
                        <p>
                            {workflow.reporting.operationalSummary ||
                                result.response}
                        </p>
                    </div>

                    <div className="assignment-line">
                        <span>Assigned staff</span>
                        <strong>
                                {workflow.staffAssignment.assignedStaffIds
                                    .length
                                    ? workflow.staffAssignment.assignedStaffIds.join(
                                          ", ",
                                      )
                                    : "Pending bed availability"}
                        </strong>
                    </div>

                    {workflow.reporting.criticalAlerts.length > 0 && (
                        <div className="alert-list">
                            {workflow.reporting.criticalAlerts.map((alert) => (
                                <span key={alert}>{alert}</span>
                            ))}
                        </div>
                    )}

                    {result.traceId && (
                        <div className="trace-line">
                            <span>Trace ID</span>
                            <code>{result.traceId}</code>
                        </div>
                    )}
                </div>
            )}

            {result && !workflow && (
                <div className="summary-copy">
                    <p className="eyebrow">Orchestrator response</p>
                    <p>{result.response}</p>
                </div>
            )}
        </section>
    );
}
