/**
 * ============================================================================
 * Requisition Wizard - Complete Single-File Implementation
 * ============================================================================
 *
 * A comprehensive 3-step requisition creation wizard that handles:
 * - Project foundation setup
 * - Resource requirement management with dynamic skill addition
 * - Budget finalization and submission
 * - File uploads with async handling
 * - Replacement hire logic
 */

import React, { useState, useRef, ChangeEvent } from "react";
import {
  Check,
  Plus,
  X,
  Upload,
  DollarSign,
  Calendar,
  Building,
  User,
  Briefcase,
  FileText,
} from "lucide-react";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

interface WizardStep {
  id: string;
  label: string;
  description?: string;
}

interface ResourcePosition {
  id: string;
  roleTitle: string;
  primarySkill: string;
  secondarySkills: string[];
  yearsOfExperience: number;
  quantity: number;
  isReplacement: boolean;
  jobDescriptionUrl?: string;
  jobDescriptionFile?: File | null;
}

interface RequisitionData {
  projectName: string;
  requiredByDate: string;
  clientName: string;
  officeLocation: "Remote" | "Hybrid" | "WFO" | "";
  priority: "Low" | "Medium" | "High" | "";
  businessJustification: string;
  positions: ResourcePosition[];
  estimatedBudget: string;
  projectDuration: string;
}

interface RequisitionWizardProps {
  steps: WizardStep[];
  activeStep: number;
  children: React.ReactNode;
  onStepClick?: (stepIndex: number) => void;
  allowStepNavigation?: boolean;
  completedSteps?: Set<number>;
}

interface StepIndicatorProps {
  step: WizardStep;
  index: number;
  isActive: boolean;
  isCompleted: boolean;
  isClickable: boolean;
  onClick: () => void;
  totalSteps: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const OFFICE_LOCATIONS = ["Remote", "Hybrid", "WFO"] as const;
const PRIORITIES = ["Low", "Medium", "High"] as const;
const DEFAULT_SKILLS = [
  "React",
  "TypeScript",
  "Node.js",
  "Python",
  "Java",
  "AWS",
  "Docker",
  "Kubernetes",
];

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

const StepIndicator: React.FC<StepIndicatorProps> = ({
  step,
  index,
  isActive,
  isCompleted,
  isClickable,
  onClick,
  totalSteps,
}) => {
  const stepNumber = index + 1;

  return (
    <div
      className="flex items-center"
      style={{ flex: index < totalSteps - 1 ? 1 : "none" }}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={!isClickable}
        aria-current={isActive ? "step" : undefined}
        className={`
          flex items-center gap-3 px-4 py-2 rounded-lg border-none transition-all duration-200
          ${isActive ? "bg-blue-500 text-white" : ""}
          ${isCompleted ? "bg-green-500 text-white" : ""}
          ${!isActive && !isCompleted ? "bg-gray-100 text-gray-600" : ""}
          ${isClickable ? "cursor-pointer" : "cursor-default opacity-70"}
        `}
      >
        <span
          className={`
            w-7 h-7 rounded-full flex items-center justify-center font-semibold text-sm
            ${isActive || isCompleted ? "bg-white bg-opacity-20" : "bg-gray-200"}
          `}
        >
          {isCompleted ? <Check size={14} /> : stepNumber}
        </span>
        <div className="text-left">
          <div className="font-semibold text-sm whitespace-nowrap">
            {step.label}
          </div>
          {step.description && (
            <div className="text-xs opacity-80 whitespace-nowrap">
              {step.description}
            </div>
          )}
        </div>
      </button>

      {index < totalSteps - 1 && (
        <div
          className={`
            flex-1 h-0.5 mx-2 transition-colors duration-300
            ${isCompleted ? "bg-green-500" : "bg-gray-200"}
          `}
        />
      )}
    </div>
  );
};

// ============================================================================
// WIZARD CONTEXT
// ============================================================================

interface WizardContextValue {
  activeStep: number;
  totalSteps: number;
  isFirstStep: boolean;
  isLastStep: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

const WizardContext = React.createContext<WizardContextValue | null>(null);

export function useWizardContext(): WizardContextValue {
  const context = React.useContext(WizardContext);
  if (!context) {
    throw new Error("useWizardContext must be used within RequisitionWizard");
  }
  return context;
}

// ============================================================================
// MAIN WIZARD COMPONENT
// ============================================================================

export const RequisitionWizard: React.FC<RequisitionWizardProps> = ({
  steps,
  activeStep,
  children,
  onStepClick,
  allowStepNavigation = false,
  completedSteps = new Set(),
}) => {
  const handleStepClick = (index: number) => {
    if (!allowStepNavigation || !onStepClick) return;
    if (completedSteps.has(index) || index === activeStep + 1) {
      onStepClick(index);
    }
  };

  const contextValue: WizardContextValue = {
    activeStep,
    totalSteps: steps.length,
    isFirstStep: activeStep === 0,
    isLastStep: activeStep === steps.length - 1,
    canGoBack: activeStep > 0,
    canGoForward: activeStep < steps.length - 1,
  };

  return (
    <WizardContext.Provider value={contextValue}>
      <div className="requisition-wizard">
        <div className="flex items-center mb-8 p-4 bg-gray-50 rounded-xl border border-gray-200">
          {steps.map((step, index) => (
            <StepIndicator
              key={step.id}
              step={step}
              index={index}
              isActive={index === activeStep}
              isCompleted={completedSteps.has(index)}
              isClickable={
                allowStepNavigation &&
                (completedSteps.has(index) || index <= activeStep)
              }
              onClick={() => handleStepClick(index)}
              totalSteps={steps.length}
            />
          ))}
        </div>
        <div className="wizard-content">{children}</div>
      </div>
    </WizardContext.Provider>
  );
};

// ============================================================================
// WIZARD STEP CONTENT WRAPPER
// ============================================================================

interface WizardStepContentProps {
  stepIndex: number;
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
}

export const WizardStepContent: React.FC<WizardStepContentProps> = ({
  stepIndex,
  children,
  title,
  subtitle,
}) => {
  const { activeStep } = useWizardContext();

  if (stepIndex !== activeStep) {
    return null;
  }

  return (
    <div className="wizard-step-content">
      {(title || subtitle) && (
        <div className="mb-6">
          {title && (
            <h2 className="text-2xl font-bold text-gray-900 mb-2">{title}</h2>
          )}
          {subtitle && <p className="text-gray-600">{subtitle}</p>}
        </div>
      )}
      {children}
    </div>
  );
};

// ============================================================================
// WIZARD NAVIGATION BUTTONS
// ============================================================================

interface WizardNavigationProps {
  onBack: () => void;
  onNext: () => void;
  onSubmit: () => void;
  canProceed: boolean;
  isSubmitting: boolean;
  submitLabel?: string;
  nextLabel?: string;
  backLabel?: string;
  renderExtraButtons?: () => React.ReactNode;
}

export const WizardNavigation: React.FC<WizardNavigationProps> = ({
  onBack,
  onNext,
  onSubmit,
  canProceed,
  isSubmitting,
  submitLabel = "Submit for Approval",
  nextLabel,
  backLabel = "Back",
  renderExtraButtons,
}) => {
  const {
    isFirstStep,
    isLastStep,
    activeStep,
    totalSteps: _,
  } = useWizardContext();

  const defaultNextLabel = `Continue to Step ${activeStep + 2}`;

  return (
    <div className="flex justify-between items-center mt-8 pt-6 border-t border-gray-200">
      <button
        type="button"
        onClick={onBack}
        disabled={isFirstStep}
        className="px-6 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        ← {backLabel}
      </button>

      <div className="flex gap-3 items-center">
        {renderExtraButtons?.()}

        {!isLastStep ? (
          <button
            type="button"
            onClick={onNext}
            disabled={!canProceed}
            className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors min-w-[160px]"
          >
            {nextLabel ?? defaultNextLabel} →
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canProceed || isSubmitting}
            className={`
              px-6 py-2 text-white rounded-lg transition-colors min-w-[180px]
              ${canProceed && !isSubmitting ? "bg-green-500 hover:bg-green-600" : "bg-gray-300"}
            `}
          >
            {isSubmitting ? "Submitting..." : submitLabel}
          </button>
        )}
      </div>
    </div>
  );
};

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================

const App: React.FC = () => {
  // Wizard state
  const [activeStep, setActiveStep] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [requisitionData, setRequisitionData] = useState<RequisitionData>({
    projectName: "",
    requiredByDate: "",
    clientName: "",
    officeLocation: "",
    priority: "",
    businessJustification: "",
    positions: [],
    estimatedBudget: "",
    projectDuration: "",
  });

  // Available skills (simulating master skills table)
  const [availableSkills, setAvailableSkills] = useState<string[]>([
    ...DEFAULT_SKILLS,
    "Angular",
    "Vue.js",
    "React Native",
    "Flutter",
    "Swift",
    "Kotlin",
    "Java",
    "Spring Boot",
    "Microservices",
    "GraphQL",
    "PostgreSQL",
    "MongoDB",
    "Redis",
    "Kafka",
    "RabbitMQ",
    "AWS",
    "Azure",
    "GCP",
    "Docker",
    "Kubernetes",
    "CI/CD",
    "Terraform",
    "Jenkins",
    "GitLab",
    "Python",
    "Django",
    "FastAPI",
  ]);

  // New skill input for instant addition
  const [newSkillInputs, setNewSkillInputs] = useState<Record<string, string>>(
    {},
  );

  // File input refs
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Wizard steps
  const steps: WizardStep[] = [
    {
      id: "foundation",
      label: "Project Foundation",
      description: "Set project context",
    },
    {
      id: "resources",
      label: "Resource Requirements",
      description: "Add positions",
    },
    {
      id: "budget",
      label: "Budget & Finalize",
      description: "Review & submit",
    },
  ];

  // Validation helpers
  const isStep1Valid = () => {
    return (
      requisitionData.projectName.trim() !== "" &&
      requisitionData.requiredByDate.trim() !== "" &&
      requisitionData.businessJustification.trim() !== ""
    );
  };

  const isStep2Valid = () => {
    return (
      requisitionData.positions.length > 0 &&
      requisitionData.positions.every(
        (pos) =>
          pos.roleTitle.trim() !== "" &&
          pos.primarySkill.trim() !== "" &&
          pos.yearsOfExperience > 0 &&
          pos.quantity > 0,
      )
    );
  };

  const isStep3Valid = () => {
    return requisitionData.estimatedBudget.trim() !== "";
  };

  // Navigation handlers
  const handleNext = () => {
    if (activeStep === 0 && !isStep1Valid()) return;
    if (activeStep === 1 && !isStep2Valid()) return;

    const newCompleted = new Set(completedSteps);
    newCompleted.add(activeStep);
    setCompletedSteps(newCompleted);

    if (activeStep < steps.length - 1) {
      setActiveStep(activeStep + 1);
    }
  };

  const handleBack = () => {
    if (activeStep > 0) {
      setActiveStep(activeStep - 1);
    }
  };

  const handleStepClick = (stepIndex: number) => {
    if (completedSteps.has(stepIndex) || stepIndex === activeStep + 1) {
      setActiveStep(stepIndex);
    }
  };

  const handleSubmit = async () => {
    if (!isStep3Valid()) return;

    setIsSubmitting(true);

    // Simulate API call
    try {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      console.log("Submitting requisition:", requisitionData);
      alert("Requisition submitted successfully!");
    } catch (error) {
      console.error("Submission error:", error);
      alert("Failed to submit requisition. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Form handlers
  const handleInputChange = (field: keyof RequisitionData, value: string) => {
    setRequisitionData((prev) => ({ ...prev, [field]: value }));
  };

  // Position management
  const addNewPosition = () => {
    const newPosition: ResourcePosition = {
      id: `pos_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      roleTitle: "",
      primarySkill: "",
      secondarySkills: [],
      yearsOfExperience: 3,
      quantity: 1,
      isReplacement: false,
      jobDescriptionFile: null,
    };
    setRequisitionData((prev) => ({
      ...prev,
      positions: [...prev.positions, newPosition],
    }));
  };

  const updatePosition = (
    id: string,
    field: keyof ResourcePosition,
    value: any,
  ) => {
    setRequisitionData((prev) => ({
      ...prev,
      positions: prev.positions.map((pos) =>
        pos.id === id ? { ...pos, [field]: value } : pos,
      ),
    }));
  };

  const removePosition = (id: string) => {
    setRequisitionData((prev) => ({
      ...prev,
      positions: prev.positions.filter((pos) => pos.id !== id),
    }));
  };

  // Skill management
  const addSkillToPosition = (
    positionId: string,
    skill: string,
    type: "primary" | "secondary",
  ) => {
    if (type === "primary") {
      updatePosition(positionId, "primarySkill", skill);
    } else {
      const position = requisitionData.positions.find(
        (pos) => pos.id === positionId,
      );
      if (position && !position.secondarySkills.includes(skill)) {
        updatePosition(positionId, "secondarySkills", [
          ...position.secondarySkills,
          skill,
        ]);
      }
    }
  };

  const removeSecondarySkill = (positionId: string, skill: string) => {
    const position = requisitionData.positions.find(
      (pos) => pos.id === positionId,
    );
    if (position) {
      updatePosition(
        positionId,
        "secondarySkills",
        position.secondarySkills.filter((s) => s !== skill),
      );
    }
  };

  const handleInstantSkillAdd = (
    positionId: string,
    skillType: "primary" | "secondary",
  ) => {
    const skillName = newSkillInputs[`${positionId}_${skillType}`]?.trim();
    if (!skillName) return;

    // Add to available skills if not exists
    if (!availableSkills.includes(skillName)) {
      setAvailableSkills((prev) => [...prev, skillName]);
    }

    // Add to position
    addSkillToPosition(positionId, skillName, skillType);

    // Clear input
    setNewSkillInputs((prev) => ({
      ...prev,
      [`${positionId}_${skillType}`]: "",
    }));

    // Simulate POST /skills/instant-add
    console.log(`Instant adding skill: ${skillName} with is_verified = false`);
  };

  // File upload handling
  const handleFileUpload = (
    positionId: string,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Update position with file
    updatePosition(positionId, "jobDescriptionFile", file);

    // Simulate async upload - in real app, this would upload to storage
    console.log(`Uploading file: ${file.name} for position ${positionId}`);

    // Simulate file URL after upload
    setTimeout(() => {
      const fileUrl = `https://storage.example.com/jd/${positionId}_${file.name}`;
      updatePosition(positionId, "jobDescriptionUrl", fileUrl);
      console.log(`File uploaded successfully: ${fileUrl}`);
    }, 1000);
  };

  const triggerFileInput = (positionId: string) => {
    fileInputRefs.current[positionId]?.click();
  };

  // Add default first position when positions are empty
  React.useEffect(() => {
    if (requisitionData.positions.length === 0) {
      addNewPosition();
    }
  }, []);

  // Determine if current step can proceed
  const canProceed = () => {
    switch (activeStep) {
      case 0:
        return isStep1Valid();
      case 1:
        return isStep2Valid();
      case 2:
        return isStep3Valid();
      default:
        return false;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <Briefcase className="w-8 h-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-900">
              Create New Requisition
            </h1>
          </div>
          <p className="text-gray-600">
            Submit a new hiring requisition for budget approval and processing
          </p>
        </div>

        {/* Wizard */}
        <div className="bg-white rounded-xl shadow-lg p-8">
          <RequisitionWizard
            steps={steps}
            activeStep={activeStep}
            onStepClick={handleStepClick}
            allowStepNavigation={true}
            completedSteps={completedSteps}
          >
            {/* Step 1: Project Foundation */}
            <WizardStepContent
              stepIndex={0}
              title="Project Foundation"
              subtitle="Set the context and basic information for your requisition"
            >
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Project Name <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Briefcase className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                      <input
                        type="text"
                        value={requisitionData.projectName}
                        onChange={(e) =>
                          handleInputChange("projectName", e.target.value)
                        }
                        className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter project name"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Required By Date <span className="text-red-500">*</span>
                    </label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                      <input
                        type="date"
                        value={requisitionData.requiredByDate}
                        onChange={(e) =>
                          handleInputChange("requiredByDate", e.target.value)
                        }
                        className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Client Name (Optional)
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                      <input
                        type="text"
                        value={requisitionData.clientName}
                        onChange={(e) =>
                          handleInputChange("clientName", e.target.value)
                        }
                        className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter client name"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Office Location
                    </label>
                    <div className="relative">
                      <Building className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                      <select
                        value={requisitionData.officeLocation}
                        onChange={(e) =>
                          handleInputChange("officeLocation", e.target.value)
                        }
                        className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none"
                      >
                        <option value="">Select location</option>
                        {OFFICE_LOCATIONS.map((loc) => (
                          <option key={loc} value={loc}>
                            {loc}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Priority Level
                  </label>
                  <div className="flex gap-4">
                    {PRIORITIES.map((priority) => (
                      <label
                        key={priority}
                        className="flex items-center cursor-pointer"
                      >
                        <input
                          type="radio"
                          value={priority}
                          checked={requisitionData.priority === priority}
                          onChange={(e) =>
                            handleInputChange("priority", e.target.value)
                          }
                          className="mr-2 text-blue-500 focus:ring-blue-500"
                        />
                        <span
                          className={`px-3 py-1 rounded-full text-sm font-medium ${
                            priority === "High"
                              ? "bg-red-100 text-red-700"
                              : priority === "Medium"
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-green-100 text-green-700"
                          }`}
                        >
                          {priority}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Business Justification{" "}
                    <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={requisitionData.businessJustification}
                    onChange={(e) =>
                      handleInputChange("businessJustification", e.target.value)
                    }
                    rows={4}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Explain the business need for this requisition..."
                  />
                </div>
              </div>
            </WizardStepContent>

            {/* Step 2: Resource Requirements */}
            <WizardStepContent
              stepIndex={1}
              title="Resource Requirements"
              subtitle="Add specific positions and skill requirements"
            >
              <div className="space-y-4">
                {requisitionData.positions.map((position, index) => (
                  <div
                    key={position.id}
                    className="border border-gray-200 rounded-lg p-6 bg-gray-50"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">
                        Position {index + 1}
                      </h3>
                      <button
                        type="button"
                        onClick={() => removePosition(position.id)}
                        className="text-red-500 hover:text-red-700 transition-colors"
                        disabled={requisitionData.positions.length === 1}
                      >
                        <X size={20} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Role Title <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          value={position.roleTitle}
                          onChange={(e) =>
                            updatePosition(
                              position.id,
                              "roleTitle",
                              e.target.value,
                            )
                          }
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="e.g., Senior React Developer"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Primary Skill <span className="text-red-500">*</span>
                        </label>
                        <div className="flex gap-2">
                          <select
                            value={position.primarySkill}
                            onChange={(e) =>
                              addSkillToPosition(
                                position.id,
                                e.target.value,
                                "primary",
                              )
                            }
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="">Select primary skill</option>
                            {availableSkills.map((skill) => (
                              <option key={skill} value={skill}>
                                {skill}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={
                              newSkillInputs[`${position.id}_primary`] || ""
                            }
                            onChange={(e) =>
                              setNewSkillInputs((prev) => ({
                                ...prev,
                                [`${position.id}_primary`]: e.target.value,
                              }))
                            }
                            placeholder="Add new skill"
                            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            onKeyPress={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleInstantSkillAdd(position.id, "primary");
                              }
                            }}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handleInstantSkillAdd(position.id, "primary")
                            }
                            className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>

                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Secondary Skills
                        </label>
                        <div className="flex gap-2 mb-2">
                          <select
                            onChange={(e) => {
                              if (e.target.value) {
                                addSkillToPosition(
                                  position.id,
                                  e.target.value,
                                  "secondary",
                                );
                                e.target.value = "";
                              }
                            }}
                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="">Select secondary skill</option>
                            {availableSkills.map((skill) => (
                              <option key={skill} value={skill}>
                                {skill}
                              </option>
                            ))}
                          </select>
                          <input
                            type="text"
                            value={
                              newSkillInputs[`${position.id}_secondary`] || ""
                            }
                            onChange={(e) =>
                              setNewSkillInputs((prev) => ({
                                ...prev,
                                [`${position.id}_secondary`]: e.target.value,
                              }))
                            }
                            placeholder="Add new skill"
                            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            onKeyPress={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleInstantSkillAdd(position.id, "secondary");
                              }
                            }}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              handleInstantSkillAdd(position.id, "secondary")
                            }
                            className="px-3 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                          >
                            <Plus size={16} />
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {position.secondarySkills.map((skill) => (
                            <span
                              key={skill}
                              className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm"
                            >
                              {skill}
                              <button
                                type="button"
                                onClick={() =>
                                  removeSecondarySkill(position.id, skill)
                                }
                                className="hover:text-blue-900"
                              >
                                <X size={14} />
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Years of Experience{" "}
                          <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="number"
                          value={position.yearsOfExperience}
                          onChange={(e) =>
                            updatePosition(
                              position.id,
                              "yearsOfExperience",
                              parseInt(e.target.value) || 0,
                            )
                          }
                          min="1"
                          max="20"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Quantity <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="number"
                          value={position.quantity}
                          onChange={(e) =>
                            updatePosition(
                              position.id,
                              "quantity",
                              parseInt(e.target.value) || 1,
                            )
                          }
                          min="1"
                          max="50"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div className="mt-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={position.isReplacement}
                          onChange={(e) =>
                            updatePosition(
                              position.id,
                              "isReplacement",
                              e.target.checked,
                            )
                          }
                          className="text-blue-500 focus:ring-blue-500"
                        />
                        <span className="text-sm font-medium text-gray-700">
                          This is a replacement hire
                        </span>
                      </label>
                    </div>

                    <div className="mt-4">
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Job Description Document
                      </label>
                      <div className="flex items-center gap-4">
                        <input
                          ref={(el) => {
                            fileInputRefs.current[position.id] = el;
                          }}
                          type="file"
                          accept=".pdf,.doc,.docx,.txt"
                          onChange={(e) => handleFileUpload(position.id, e)}
                          className="hidden"
                        />
                        <button
                          type="button"
                          onClick={() => triggerFileInput(position.id)}
                          className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                        >
                          <Upload size={16} />
                          Upload JD
                        </button>
                        {position.jobDescriptionFile && (
                          <span className="text-sm text-gray-600 flex items-center gap-2">
                            <FileText size={16} className="text-green-500" />
                            {position.jobDescriptionFile.name}
                          </span>
                        )}
                        {position.jobDescriptionUrl &&
                          !position.jobDescriptionFile && (
                            <span className="text-sm text-green-600">
                              ✓ File uploaded successfully
                            </span>
                          )}
                      </div>
                    </div>
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addNewPosition}
                  className="w-full py-3 border-2 border-dashed border-blue-300 text-blue-600 rounded-lg hover:bg-blue-50 hover:border-blue-500 transition-colors flex items-center justify-center gap-2 font-medium"
                >
                  <Plus size={20} />
                  Add Another Position
                </button>
              </div>
            </WizardStepContent>

            {/* Step 3: Budget & Finalize */}
            <WizardStepContent
              stepIndex={2}
              title="Budget & Finalize"
              subtitle="Review and submit your requisition for approval"
            >
              <div className="space-y-6">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-blue-900 mb-4 flex items-center gap-2">
                    <DollarSign className="w-5 h-5" />
                    Budget Information
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Estimated Budget <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                        <input
                          type="text"
                          value={requisitionData.estimatedBudget}
                          onChange={(e) =>
                            handleInputChange("estimatedBudget", e.target.value)
                          }
                          className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="e.g., 150000"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Project Duration (Optional)
                      </label>
                      <input
                        type="text"
                        value={requisitionData.projectDuration}
                        onChange={(e) =>
                          handleInputChange("projectDuration", e.target.value)
                        }
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="e.g., 12 months"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Requisition Summary
                  </h3>
                  <div className="space-y-3">
                    <div className="flex justify-between py-2 border-b border-gray-200">
                      <span className="text-gray-600">Project Name:</span>
                      <span className="font-medium text-gray-900">
                        {requisitionData.projectName || "-"}
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-gray-200">
                      <span className="text-gray-600">Required By:</span>
                      <span className="font-medium text-gray-900">
                        {requisitionData.requiredByDate
                          ? new Date(
                              requisitionData.requiredByDate,
                            ).toLocaleDateString()
                          : "-"}
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-gray-200">
                      <span className="text-gray-600">Priority:</span>
                      <span className="font-medium text-gray-900">
                        {requisitionData.priority || "-"}
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-gray-200">
                      <span className="text-gray-600">Total Positions:</span>
                      <span className="font-medium text-gray-900">
                        {requisitionData.positions.length}
                      </span>
                    </div>
                    <div className="flex justify-between py-2 border-b border-gray-200">
                      <span className="text-gray-600">Total Resources:</span>
                      <span className="font-medium text-gray-900">
                        {requisitionData.positions.reduce(
                          (sum, pos) => sum + pos.quantity,
                          0,
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between py-2">
                      <span className="text-gray-600">Estimated Budget:</span>
                      <span className="font-medium text-gray-900">
                        $
                        {parseInt(
                          requisitionData.estimatedBudget || "0",
                        ).toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <div className="text-yellow-600">⚠️</div>
                    <div>
                      <h4 className="font-medium text-yellow-900">
                        Important Notes
                      </h4>
                      <ul className="mt-1 text-sm text-yellow-800 list-disc list-inside">
                        <li>
                          Once submitted, this requisition will be created with
                          status "Pending Budget Approval"
                        </li>
                        <li>
                          All positions and skill requirements will be reviewed
                          by HR
                        </li>
                        <li>
                          You will receive notifications on the approval status
                        </li>
                        <li>
                          Budget approval is required before proceeding to
                          sourcing
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </WizardStepContent>

            {/* Navigation */}
            <WizardNavigation
              onBack={handleBack}
              onNext={handleNext}
              onSubmit={handleSubmit}
              canProceed={canProceed()}
              isSubmitting={isSubmitting}
              nextLabel={
                activeStep === 0
                  ? "Continue to Resource Requirements"
                  : activeStep === 1
                    ? "Continue to Budget & Finalize"
                    : undefined
              }
              submitLabel="Submit Requisition for Approval"
            />
          </RequisitionWizard>
        </div>
      </div>
    </div>
  );
};

export default App;
