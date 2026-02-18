import React from "react";

type Step = {
  id: string;
  title: string;
  description?: string;
};

type StepperProps = {
  steps: Step[];
  currentStep: number;
  progressPercent: number;
  onStepChange: (stepIndex: number) => void;
};

const Stepper: React.FC<StepperProps> = ({
  steps,
  currentStep,
  progressPercent,
  onStepChange,
}) => {
  return (
    <div className="employee-stepper-wrapper">
      <div className="employee-stepper">
        {steps.map((step, index) => {
          const isActive = index === currentStep;
          const isCompleted = index < currentStep;
          return (
            <button
              key={step.id}
              type="button"
              className={`stepper-step ${isActive ? "active" : ""} ${
                isCompleted ? "completed" : ""
              }`}
              onClick={() => onStepChange(index)}
            >
              <div className="step-indicator">{index + 1}</div>
              <div className="step-label">{step.title}</div>
              {step.description && (
                <div className="step-description">{step.description}</div>
              )}
            </button>
          );
        })}
      </div>
      <div className="stepper-progress">
        <progress
          className="stepper-progress-bar"
          value={progressPercent}
          max={100}
        />
        <div className="stepper-progress-label">
          {Math.round(progressPercent)}% Complete
        </div>
      </div>
    </div>
  );
};

export default Stepper;
