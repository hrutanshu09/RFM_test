// components/hr/OnboardingTracker.tsx
import React from "react";
import { CheckCircle, XCircle, AlertTriangle } from "lucide-react";

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  required: boolean;
}

const onboardingSteps: OnboardingStep[] = [
  {
    id: "core",
    title: "Core Employee Details",
    description: "Basic identity and employment information",
    completed: true,
    required: true,
  },
  {
    id: "contact",
    title: "Contact Details",
    description: "Work, personal, or emergency contact information",
    completed: false,
    required: false,
  },
  {
    id: "skills",
    title: "Skills Profile",
    description: "At least one skill must be added",
    completed: false,
    required: true,
  },
  {
    id: "education",
    title: "Education History",
    description: "Academic qualifications",
    completed: false,
    required: false,
  },
  {
    id: "assignment",
    title: "Initial Assignment",
    description: "Department or manager assignment (optional)",
    completed: false,
    required: false,
  },
];

const OnboardingTracker: React.FC = () => {
  const requiredIncomplete = onboardingSteps.some(
    (step) => step.required && !step.completed,
  );

  return (
    <>
      {/* Page Header
      <div className="manager-header">
        <h2>Onboarding Tracker</h2>
        <p className="subtitle">
          Track onboarding progress and complete employee activation.
        </p>
      </div> */}

      {/* Progress Steps */}
      <div className="master-data-manager">
        {onboardingSteps.map((step) => (
          <div
            key={step.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "16px",
              padding: "16px 0",
              borderBottom: "1px solid var(--border-light)",
            }}
          >
            {/* Status Icon */}
            <div>
              {step.completed ? (
                <CheckCircle size={20} color="var(--success)" />
              ) : step.required ? (
                <XCircle size={20} color="var(--error)" />
              ) : (
                <AlertTriangle size={20} color="var(--warning)" />
              )}
            </div>

            {/* Step Info */}
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontWeight: 600,
                  marginBottom: "4px",
                  color: "var(--text-primary)",
                }}
              >
                {step.title}
                {step.required && (
                  <span
                    style={{
                      fontSize: "11px",
                      marginLeft: "8px",
                      color: "var(--error)",
                    }}
                  >
                    Required
                  </span>
                )}
              </div>

              <div
                style={{
                  fontSize: "13px",
                  color: "var(--text-tertiary)",
                }}
              >
                {step.description}
              </div>
            </div>

            {/* Status Badge */}
            <div>
              {step.completed ? (
                <span className="status-badge active">Completed</span>
              ) : step.required ? (
                <span className="status-badge inactive">Incomplete</span>
              ) : (
                <span className="status-badge">Optional</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Completion Action */}
      <div
        style={{
          marginTop: "24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: "13px", color: "var(--text-tertiary)" }}>
          {requiredIncomplete
            ? "Complete all required steps before activating the employee."
            : "All required steps completed. Employee can be activated."}
        </div>

        <button
          className="action-button primary"
          disabled={requiredIncomplete}
          style={{ opacity: requiredIncomplete ? 0.6 : 1 }}
        >
          Complete Onboarding
        </button>
      </div>
    </>
  );
};

export default OnboardingTracker;
