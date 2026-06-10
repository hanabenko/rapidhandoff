import { useCallback, useEffect, useState } from "react";

import {
    fetchBackendHealth,
    fetchOperationsStatus,
    submitPatientIntake,
} from "./api";
import { IntakeForm } from "./components/IntakeForm";
import { InternalOperations } from "./components/InternalOperations";
import { OperationsSummary } from "./components/OperationsSummary";
import type { OperationsStatus, OrchestrateResponse, Severity } from "./types";

type DashboardView = "intake" | "operations";
type BackendState = "checking" | "online" | "offline";

const latestResultKey = "rapid-handoff.latest-result";

function loadLatestResult(): OrchestrateResponse | undefined {
    try {
        const stored = sessionStorage.getItem(latestResultKey);
        return stored ? (JSON.parse(stored) as OrchestrateResponse) : undefined;
    } catch {
        return undefined;
    }
}

export default function App() {
    const [view, setView] = useState<DashboardView>("intake");
    const [result, setResult] =
        useState<OrchestrateResponse | undefined>(loadLatestResult);
    const [submitError, setSubmitError] = useState<string>();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [status, setStatus] = useState<OperationsStatus>();
    const [statusError, setStatusError] = useState<string>();
    const [isStatusLoading, setIsStatusLoading] = useState(false);
    const [backendState, setBackendState] =
        useState<BackendState>("checking");

    const checkBackendHealth = useCallback(async () => {
        try {
            const health = await fetchBackendHealth();
            setBackendState(health.ok ? "online" : "offline");
        } catch {
            setBackendState("offline");
        }
    }, []);

    const refreshStatus = useCallback(async () => {
        setIsStatusLoading(true);
        setStatusError(undefined);
        try {
            setStatus(await fetchOperationsStatus());
            setBackendState("online");
        } catch (error) {
            setStatusError(
                error instanceof Error
                    ? error.message
                    : "Could not load ER status.",
            );
        } finally {
            setIsStatusLoading(false);
        }
    }, []);

    useEffect(() => {
        void checkBackendHealth();
        void refreshStatus();
    }, [checkBackendHealth, refreshStatus]);

    async function handleIntake(input: {
        patientId: string;
        age: number;
        chiefComplaint: string;
        symptoms: string[];
        triageLevel: Severity;
    }) {
        setIsSubmitting(true);
        setSubmitError(undefined);
        try {
            const nextResult = await submitPatientIntake(input);
            setResult(nextResult);
            sessionStorage.setItem(
                latestResultKey,
                JSON.stringify(nextResult),
            );
            setBackendState("online");
            await refreshStatus();
        } catch (error) {
            void checkBackendHealth();
            setSubmitError(
                error instanceof Error
                    ? error.message
                    : "The ER workflow could not complete.",
            );
        } finally {
            setIsSubmitting(false);
        }
    }

    return (
        <main>
            <header className="app-header">
                <div className="brand-lockup">
                    <span className="brand-mark">RH</span>
                    <div>
                        <p>Rapid Handoff</p>
                        <span>Emergency operations console</span>
                    </div>
                </div>
                <div
                    className={`system-state ${backendState}`}
                    title="Backend API health"
                >
                    <span className="live-dot" />
                    {backendState === "checking"
                        ? "Checking backend"
                        : backendState === "online"
                          ? "Backend connected"
                          : "Backend unavailable"}
                </div>
            </header>

            <section className="hero">
                <p className="eyebrow">ER coordination / live demo</p>
                <h1>From intake to assignment, in one handoff.</h1>
                <p>
                    Reception submits the intake. Specialized agents coordinate
                    triage, bed placement, staffing, and the final operations
                    brief.
                </p>
            </section>

            <nav className="view-tabs" aria-label="Dashboard views">
                <button
                    type="button"
                    className={view === "intake" ? "active" : ""}
                    onClick={() => setView("intake")}
                >
                    Receptionist Intake
                </button>
                <button
                    type="button"
                    className={view === "operations" ? "active" : ""}
                    onClick={() => setView("operations")}
                >
                    Internal Operations
                </button>
            </nav>

            {view === "intake" ? (
                <div className="workflow-grid">
                    <IntakeForm
                        isSubmitting={isSubmitting}
                        onSubmit={handleIntake}
                    />
                    <OperationsSummary
                        result={result}
                        error={submitError}
                        isSubmitting={isSubmitting}
                    />
                </div>
            ) : (
                <InternalOperations
                    status={status}
                    latestResult={result}
                    isLoading={isStatusLoading}
                    error={statusError}
                    onRefresh={() => {
                        void checkBackendHealth();
                        void refreshStatus();
                    }}
                />
            )}
        </main>
    );
}
