import type { OperationsStatus } from "../types";

interface StatusViewProps {
    status?: OperationsStatus;
    isLoading: boolean;
    error?: string;
    onRefresh(): void;
}

function titleCase(value: string): string {
    return value.replaceAll("_", " ");
}

export function StatusView({
    status,
    isLoading,
    error,
    onRefresh,
}: StatusViewProps) {
    return (
        <section className="panel status-panel">
            <div className="panel-heading status-heading">
                <div>
                    <p className="eyebrow">Live operations</p>
                    <h2>Bed and staff status</h2>
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

            <div className="status-columns">
                <div>
                    <div className="list-heading">
                        <h3>Beds</h3>
                        <span>{status?.beds.length ?? 0} total</span>
                    </div>
                    <div className="status-list">
                        {status?.beds.map((bed) => (
                            <article className="status-item" key={bed.bedId}>
                                <span
                                    className={`status-indicator ${bed.status}`}
                                />
                                <div>
                                    <strong>{bed.bedId}</strong>
                                    <small>
                                        {bed.room ?? titleCase(bed.type)}
                                        {bed.hasMonitor ? " / monitor" : ""}
                                    </small>
                                </div>
                                <span className={`status-pill ${bed.status}`}>
                                    {bed.needsCleaning
                                        ? "cleaning"
                                        : bed.status}
                                </span>
                            </article>
                        ))}
                        {!isLoading && !status?.beds.length && (
                            <p className="list-empty">No bed data available.</p>
                        )}
                    </div>
                </div>

                <div>
                    <div className="list-heading">
                        <h3>Staff</h3>
                        <span>{status?.staff.length ?? 0} scheduled</span>
                    </div>
                    <div className="status-list">
                        {status?.staff.map((staff) => (
                            <article
                                className="status-item"
                                key={staff.staffId}
                            >
                                <span
                                    className={`status-indicator ${
                                        staff.available
                                            ? "available"
                                            : "occupied"
                                    }`}
                                />
                                <div>
                                    <strong>
                                        {staff.name ?? staff.staffId}
                                    </strong>
                                    <small>
                                        {titleCase(staff.role)} / {staff.shift}
                                    </small>
                                </div>
                                <span
                                    className={`status-pill ${
                                        staff.available
                                            ? "available"
                                            : "occupied"
                                    }`}
                                >
                                    {staff.available ? "available" : "assigned"}
                                </span>
                            </article>
                        ))}
                        {!isLoading && !status?.staff.length && (
                            <p className="list-empty">
                                No staff data available.
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {status?.capturedAt && (
                <p className="captured-at">
                    Snapshot {new Date(status.capturedAt).toLocaleTimeString()}
                </p>
            )}
        </section>
    );
}
