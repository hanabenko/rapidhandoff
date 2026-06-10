import { useState, type FormEvent } from "react";

import type { Severity } from "../types";

interface IntakeFormProps {
    isSubmitting: boolean;
    onSubmit(input: {
        patientId: string;
        age: number;
        chiefComplaint: string;
        symptoms: string[];
        triageLevel: Severity;
    }): Promise<void>;
}

function buildPatientId(label: string): string {
    const cleanLabel = label
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 16);
    const suffix = Date.now().toString(36).toUpperCase().slice(-5);
    return `DEMO-${cleanLabel || "PATIENT"}-${suffix}`;
}

export function IntakeForm({
    isSubmitting,
    onSubmit,
}: IntakeFormProps) {
    const [patientLabel, setPatientLabel] = useState("");
    const [age, setAge] = useState("42");
    const [chiefComplaint, setChiefComplaint] = useState("");
    const [symptoms, setSymptoms] = useState("");
    const [triageLevel, setTriageLevel] =
        useState<Severity>("urgent");

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        await onSubmit({
            patientId: buildPatientId(patientLabel),
            age: Number.parseInt(age, 10),
            chiefComplaint: chiefComplaint.trim(),
            symptoms: symptoms
                .split(",")
                .map((symptom) => symptom.trim())
                .filter(Boolean),
            triageLevel,
        });
    }

    return (
        <section className="panel intake-panel">
            <div className="panel-heading">
                <div>
                    <p className="eyebrow">Reception</p>
                    <h2>New patient intake</h2>
                </div>
                <span className="step-number">01</span>
            </div>

            <form onSubmit={handleSubmit}>
                <label>
                    Patient initials or label
                    <input
                        value={patientLabel}
                        onChange={(event) =>
                            setPatientLabel(event.target.value)
                        }
                        placeholder="e.g. JB or Walk-in 7"
                        maxLength={40}
                    />
                </label>

                <div className="form-row">
                    <label>
                        Age
                        <input
                            type="number"
                            value={age}
                            onChange={(event) => setAge(event.target.value)}
                            min="0"
                            max="130"
                            required
                        />
                    </label>
                    <label>
                        Intake severity
                        <select
                            value={triageLevel}
                            onChange={(event) =>
                                setTriageLevel(
                                    event.target.value as Severity,
                                )
                            }
                        >
                            <option value="critical">Critical</option>
                            <option value="emergent">Emergent</option>
                            <option value="urgent">Urgent</option>
                            <option value="less_urgent">Less urgent</option>
                            <option value="non_urgent">Non-urgent</option>
                        </select>
                    </label>
                </div>

                <label>
                    Chief complaint
                    <textarea
                        value={chiefComplaint}
                        onChange={(event) =>
                            setChiefComplaint(event.target.value)
                        }
                        placeholder="Brief operational intake note"
                        rows={3}
                        required
                    />
                </label>

                <label>
                    Symptoms
                    <input
                        value={symptoms}
                        onChange={(event) => setSymptoms(event.target.value)}
                        placeholder="shortness of breath, dizziness"
                    />
                    <span className="field-hint">Separate with commas.</span>
                </label>

                <button
                    className="primary-button"
                    type="submit"
                    disabled={isSubmitting}
                >
                    {isSubmitting
                        ? "Coordinating ER workflow..."
                        : "Submit and coordinate"}
                </button>
            </form>
        </section>
    );
}
