import { useCallback, useEffect, useState } from "react";

import {
    fetchOperationsStatus,
    submitPatientIntake,
} from "./api";
import { IntakeForm } from "./components/IntakeForm";
import { OperationsSummary } from "./components/OperationsSummary";
import { StatusView } from "./components/StatusView";
import type {
    OperationsStatus,
    OrchestrateResponse,
    Severity,
} from "./types";

export default function App() {
    const [result, setResult] = useState<OrchestrateResponse>();
    const [submitError, setSubmitError] = useState<string>();
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [status, setStatus] = useState<OperationsStatus>();
    const [statusError, setStatusError] = useState<string>();
    const [isStatusLoading, setIsStatusLoading] = useState(false);

    const refreshStatus = useCallback(async () => {
        setIsStatusLoading(true);
        setStatusError(undefined);
        try {
            setStatus(await fetchOperationsStatus());
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
        void refreshStatus();
    }, [refreshStatus]);

    async function handleIntake(input: {
        patientId: string;
        age: number;
        chiefComplaint: string;
        symptoms: string[];
        triageLevel: Severity;
    }) {
        setIsSubmitting(true);
        setSubmitError(undefined);
        setResult(undefined);
        try {
            setResult(await submitPatientIntake(input));
            await refreshStatus();
        } catch (error) {
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
                <div className="system-state">
                    <span className="live-dot" />
                    Multi-agent workflow ready
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

            <StatusView
                status={status}
                isLoading={isStatusLoading}
                error={statusError}
                onRefresh={() => void refreshStatus()}
            />
        </main>
    );
}
