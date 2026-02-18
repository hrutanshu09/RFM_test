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
 *
 * WORKFLOW ENGINE V2 COMPLIANCE:
 * 1. POST /api/requisitions creates requisition in DRAFT status ONLY
 * 2. POST /api/requisitions/{id}/workflow/submit transitions to Pending_Budget
 * 3. No client-side status mutations - backend is single source of truth
 */

import React, {
  useState,
  useRef,
  useEffect,
  ChangeEvent,
  useMemo,
} from "react";
import {
  Check,
  Plus,
  X,
  Upload,
  DollarSign,
  Calendar,
  Building,
  MapPin,
  User,
  Briefcase,
  FileText,
} from "lucide-react";
import { apiClient } from "../../api/client";
import {
  submitRequisition,
  getWorkflowErrorMessage,
  WorkflowTransitionResponse,
} from "../../api/workflowApi";

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
  primarySkills: string[];
  secondarySkills: string[];
  education: string;
  yearsOfExperience: number;
  quantity: number;
  isReplacement: boolean;
  replacedEmpId: string; // Required when isReplacement is true (employee being replaced)
  jobDescriptionUrl?: string;
  jobDescriptionFile?: File | null;
  // Item-level budget fields
  estimatedBudget: string;
  currency: string;
}

interface RequisitionData {
  projectName: string;
  requiredByDate: string;
  clientName: string;
  officeLocation: string;
  workMode: "Remote" | "Hybrid" | "WFO" | "";
  priority: "Low" | "Medium" | "High" | "";
  businessJustification: string;
  managerNotes: string;
  positions: ResourcePosition[];
  // REMOVED: Header-level budget - now item-level only
  // estimatedBudget: string;
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

interface SkillResponse {
  skill_id: number;
  skill_name: string;
}

interface LocationResponse {
  location_id: number;
  city?: string | null;
  country?: string | null;
}

interface EmployeeOption {
  emp_id: string;
  full_name: string;
}

/** HR employee profile (skills + education) for auto-fill when selecting replaced employee */
interface HREmployeeProfileResponse {
  employee: { emp_id: string; full_name: string };
  skills: Array<{
    skill_id: number;
    proficiency_level?: string | null;
    years_experience?: number | null;
  }>;
  education: Array<{ qualification: string; specialization?: string | null }>;
}

interface RequisitionItemPayload {
  role_position: string;
  job_description: string;
  skill_level: string;
  experience_years: number;
  education_requirement?: string;
  requirements?: string;
  replacement_hire: boolean;
  replaced_emp_id: string | null;
  // Item-level budget fields
  estimated_budget: number;
  currency: string;
}

interface SubmitNotice {
  type: "success" | "error";
  title: string;
  lines: string[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const WORK_MODES = ["Remote", "Hybrid", "WFO"] as const;
const PRIORITIES = ["Low", "Medium", "High"] as const;

// Currency options for item-level budgets
const CURRENCIES = [
  { code: "INR", label: "INR - Indian Rupee", symbol: "₹" },
  { code: "USD", label: "USD - US Dollar", symbol: "$" },
  { code: "EUR", label: "EUR - Euro", symbol: "€" },
  { code: "GBP", label: "GBP - British Pound", symbol: "£" },
  { code: "AUD", label: "AUD - Australian Dollar", symbol: "A$" },
  { code: "SGD", label: "SGD - Singapore Dollar", symbol: "S$" },
] as const;

const DEFAULT_CURRENCY = "INR";

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
  const [submitNotice, setSubmitNotice] = useState<SubmitNotice | null>(null);

  // Form state
  const [requisitionData, setRequisitionData] = useState<RequisitionData>({
    projectName: "",
    requiredByDate: "",
    clientName: "",
    officeLocation: "",
    workMode: "",
    priority: "",
    businessJustification: "",
    managerNotes: "",
    positions: [],
    // REMOVED: Header-level budget - now item-level only
    projectDuration: "",
  });

  // Available skills fetched from backend (names for dropdown)
  const [availableSkills, setAvailableSkills] = useState<string[]>([]);
  // skill_id -> skill_name for resolving employee profile skills when auto-filling
  const [skillIdToName, setSkillIdToName] = useState<Record<number, string>>(
    {},
  );

  // New skill input for instant addition
  const [newSkillInputs, setNewSkillInputs] = useState<Record<string, string>>(
    {},
  );

  // File input refs
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [officeLocations, setOfficeLocations] = useState<LocationResponse[]>(
    [],
  );

  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);

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

  // Fetch skills and locations from backend on mount
  useEffect(() => {
    const fetchSkills = async () => {
      try {
        const response = await apiClient.get<SkillResponse[]>("/skills/");
        const list = response.data ?? [];
        const names = list
          .map((s) => s.skill_name)
          .filter((name) => name.trim() !== "");
        setAvailableSkills(Array.from(new Set(names)));
        const idToName: Record<number, string> = {};
        list.forEach((s) => {
          idToName[s.skill_id] = s.skill_name;
        });
        setSkillIdToName(idToName);
      } catch {
        // Silently fail - use default skills
      }
    };

    const fetchLocations = async () => {
      try {
        const response = await apiClient.get<LocationResponse[]>("/locations/");
        setOfficeLocations(response.data);
      } catch {
        // Silently fail - keep dropdown empty
      }
    };

    const fetchEmployees = async () => {
      try {
        const response = await apiClient.get<EmployeeOption[]>(
          "/employees/employees",
        );
        setEmployeeOptions(
          (response.data ?? []).map((e) => ({
            emp_id: e.emp_id,
            full_name: e.full_name ?? e.emp_id,
          })),
        );
      } catch {
        // Silently fail - keep dropdown empty
      }
    };

    fetchSkills();
    fetchLocations();
    fetchEmployees();
  }, []);

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
          pos.primarySkills.length > 0 &&
          pos.yearsOfExperience > 0 &&
          pos.quantity > 0 &&
          // Budget validation: estimated_budget must be > 0
          pos.estimatedBudget.trim() !== "" &&
          parseFloat(pos.estimatedBudget.replace(/,/g, "")) > 0 &&
          pos.currency.trim() !== "" &&
          // Replacement: when replacement hire, replaced employee ID is required
          (!pos.isReplacement || pos.replacedEmpId?.trim() !== ""),
      )
    );
  };

  // Compute total estimated budget from all positions
  const computedTotalBudget = useMemo(() => {
    return requisitionData.positions.reduce((sum, pos) => {
      const budgetValue =
        parseFloat(pos.estimatedBudget.replace(/,/g, "")) || 0;
      return sum + budgetValue * pos.quantity;
    }, 0);
  }, [requisitionData.positions]);

  // Step 3 is now valid if positions have budgets (validated in Step 2)
  const isStep3Valid = () => {
    // All budget validation is now done in Step 2
    return isStep2Valid();
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

  // Build payload for API (requirements is a single text field; we store "Primary Skill: A, B, C | Secondary Skills: ...")
  const buildItemsPayload = (): RequisitionItemPayload[] => {
    return requisitionData.positions.flatMap((pos) => {
      const requirementParts = [
        pos.primarySkills.length
          ? `Primary Skill: ${pos.primarySkills.join(", ")}`
          : "",
        pos.secondarySkills.length
          ? `Secondary Skills: ${pos.secondarySkills.join(", ")}`
          : "",
      ].filter(Boolean);

      const requirementsText = requirementParts.join(" | ") || undefined;

      // Parse budget value from string
      const budgetValue =
        parseFloat(pos.estimatedBudget.replace(/,/g, "")) || 0;

      const payloadItem: RequisitionItemPayload = {
        role_position: pos.roleTitle.trim(),
        job_description: `${pos.roleTitle} position requiring ${pos.yearsOfExperience}+ years experience`,
        skill_level:
          pos.yearsOfExperience >= 20
            ? "Lead"
            : pos.yearsOfExperience >= 15
              ? "Senior"
              : pos.yearsOfExperience >= 10
                ? "Mid"
                : pos.yearsOfExperience >= 5
                  ? "Junior"
                  : "Fresher",
        experience_years: pos.yearsOfExperience,
        education_requirement: pos.education?.trim()
          ? pos.education.trim()
          : undefined,
        requirements: requirementsText,
        replacement_hire: pos.isReplacement,
        replaced_emp_id:
          pos.isReplacement && pos.replacedEmpId?.trim()
            ? pos.replacedEmpId.trim()
            : null,
        // Item-level budget fields
        estimated_budget: budgetValue,
        currency: pos.currency || DEFAULT_CURRENCY,
      };

      const quantity = Math.max(pos.quantity || 1, 1);
      return Array.from({ length: quantity }, () => payloadItem);
    });
  };

  const buildPayload = (): FormData => {
    const itemsPayload = buildItemsPayload();

    const workModePayload =
      requisitionData.workMode === "Remote" ? "WFH" : requisitionData.workMode;

    const payload = new FormData();
    payload.append("project_name", requisitionData.projectName || "");
    payload.append("client_name", requisitionData.clientName.trim() || "");
    payload.append("office_location", requisitionData.officeLocation || "");
    payload.append("work_mode", workModePayload || "");
    payload.append("required_by_date", requisitionData.requiredByDate || "");
    payload.append("priority", requisitionData.priority || "");
    payload.append(
      "justification",
      requisitionData.businessJustification || "",
    );
    payload.append("duration", requisitionData.projectDuration.trim() || "");
    payload.append(
      "is_replacement",
      requisitionData.positions.some((p) => p.isReplacement) ? "true" : "false",
    );
    payload.append("manager_notes", requisitionData.managerNotes?.trim() || "");
    payload.append("items_json", JSON.stringify(itemsPayload));

    // JD is uploaded per item after create (item-level JD only, no header-level)

    // NOTE: Header-level budget_amount is NO LONGER sent.
    // Budget is now at item-level and included in items_json.

    return payload;
  };

  const handleSubmit = async () => {
    if (!isStep3Valid()) return;

    setIsSubmitting(true);
    setSubmitNotice(null);

    try {
      // Step 1: Create requisition (DRAFT status) – no jd_file here; we upload per item after
      const payload = buildPayload();
      const createResponse = await apiClient.post<{
        req_id: number;
        items: Array<{ item_id: number }>;
      }>("/requisitions/", payload, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const reqId = createResponse.data.req_id;
      const createdItems = createResponse.data.items || [];

      // Step 2: Upload JD PDF per position to the corresponding item(s) (item-level JD)
      // Order of createdItems matches buildItemsPayload() (flatMap by position and quantity)
      let itemIndex = 0;
      for (let posIndex = 0; posIndex < requisitionData.positions.length; posIndex++) {
        const position = requisitionData.positions[posIndex];
        const quantity = Math.max(position?.quantity ?? 1, 1);
        const file = position?.jobDescriptionFile;
        if (file instanceof File && createdItems.length >= itemIndex + quantity) {
          for (let q = 0; q < quantity; q++) {
            const itemId = createdItems[itemIndex + q]?.item_id;
            if (itemId != null) {
              const formData = new FormData();
              formData.append("jd_file", file);
              await apiClient.post(`/requisitions/items/${itemId}/jd`, formData, {
                headers: { "Content-Type": "multipart/form-data" },
              });
            }
          }
        }
        itemIndex += quantity;
      }

      // Step 3: Submit via workflow endpoint (DRAFT → Pending_Budget)
      const transitionResult: WorkflowTransitionResponse =
        await submitRequisition(reqId);

      if (
        transitionResult.success &&
        transitionResult.new_status === "Pending_Budget"
      ) {
        setSubmitNotice({
          type: "success",
          title: `Requisition #${reqId} submitted successfully`,
          lines: [
            `Status: ${transitionResult.new_status}`,
            "It is now pending budget approval.",
          ],
        });
        // Reset form
        setRequisitionData({
          projectName: "",
          requiredByDate: "",
          clientName: "",
          officeLocation: "",
          workMode: "",
          priority: "",
          businessJustification: "",
          managerNotes: "",
          positions: [],
          // REMOVED: Header-level budget
          projectDuration: "",
        });
        setActiveStep(0);
        setCompletedSteps(new Set());
      } else {
        throw new Error(
          `Unexpected workflow response: ${JSON.stringify(transitionResult)}`,
        );
      }
    } catch (error) {
      console.error("Submission error:", error);
      const errorMessage = getWorkflowErrorMessage(error);
      setSubmitNotice({
        type: "error",
        title: "Failed to submit requisition",
        lines: [errorMessage],
      });
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
      primarySkills: [],
      secondarySkills: [],
      education: "",
      yearsOfExperience: 3,
      quantity: 1,
      isReplacement: false,
      replacedEmpId: "",
      jobDescriptionFile: null,
      // Item-level budget with defaults
      estimatedBudget: "",
      currency: DEFAULT_CURRENCY,
    };
    setRequisitionData((prev) => ({
      ...prev,
      positions: [...prev.positions, newPosition],
    }));
  };

  const updatePosition = (
    id: string,
    field: keyof ResourcePosition,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    const position = requisitionData.positions.find(
      (pos) => pos.id === positionId,
    );
    if (!position) return;

    if (type === "primary") {
      if (!position.primarySkills.includes(skill)) {
        updatePosition(positionId, "primarySkills", [
          ...position.primarySkills,
          skill,
        ]);
      }
    } else {
      if (!position.secondarySkills.includes(skill)) {
        updatePosition(positionId, "secondarySkills", [
          ...position.secondarySkills,
          skill,
        ]);
      }
    }
  };

  const removePrimarySkill = (positionId: string, skill: string) => {
    const position = requisitionData.positions.find(
      (pos) => pos.id === positionId,
    );
    if (position) {
      updatePosition(
        positionId,
        "primarySkills",
        position.primarySkills.filter((s) => s !== skill),
      );
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

  /** When user selects a replaced employee, fetch their profile and auto-fill role, skills, experience, education */
  const fillPositionFromEmployeeProfile = async (
    positionId: string,
    empId: string,
  ) => {
    if (!empId) return;
    try {
      const res = await apiClient.get<HREmployeeProfileResponse>(
        `/hr/employees/${empId}`,
      );
      const profile = res.data;
      if (!profile) return;

      const skillNames = (profile.skills ?? [])
        .map((s) => skillIdToName[s.skill_id])
        .filter(Boolean) as string[];
      const educationStr = (profile.education ?? [])
        .map((e) => e.qualification)
        .filter(Boolean)
        .join(", ");
      const yearsList = (profile.skills ?? [])
        .map((s) => s.years_experience ?? 0)
        .filter((n) => n > 0);
      const maxYears =
        yearsList.length > 0 ? Math.round(Math.max(...yearsList)) : 0;
      const roleTitle = `Replacement for ${profile.employee.full_name}`;

      setRequisitionData((prev) => ({
        ...prev,
        positions: prev.positions.map((p) =>
          p.id === positionId
            ? {
                ...p,
                roleTitle,
                primarySkills:
                  skillNames.length > 0 ? skillNames : p.primarySkills,
                education: educationStr || p.education,
                yearsOfExperience: maxYears || p.yearsOfExperience,
              }
            : p,
        ),
      }));
    } catch {
      // Silently fail - user can fill manually
    }
  };

  const handleInstantSkillAdd = async (
    positionId: string,
    skillType: "primary" | "secondary",
  ) => {
    const skillName = newSkillInputs[`${positionId}_${skillType}`]?.trim();
    if (!skillName) return;

    try {
      const response = await apiClient.post<SkillResponse>(
        "/skills/instant-add",
        { name: skillName },
      );
      const savedName = response.data.skill_name?.trim();
      if (!savedName) return;

      setAvailableSkills((prev) =>
        prev.includes(savedName) ? prev : [...prev, savedName],
      );

      addSkillToPosition(positionId, savedName, skillType);

      setNewSkillInputs((prev) => ({
        ...prev,
        [`${positionId}_${skillType}`]: "",
      }));
    } catch (error) {
      console.error("Failed to save skill:", error);
    }
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
  useEffect(() => {
    if (requisitionData.positions.length === 0) {
      addNewPosition();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      {submitNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div
            className="w-full max-w-md rounded-2xl bg-white shadow-2xl border border-gray-200 p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-notice-title"
          >
            <h3
              id="submit-notice-title"
              className={`text-lg font-semibold mb-3 ${
                submitNotice.type === "success"
                  ? "text-gray-900"
                  : "text-red-700"
              }`}
            >
              {submitNotice.title}
            </h3>
            <div className="space-y-1 text-sm text-gray-700 mb-6">
              {submitNotice.lines.map((line, idx) => (
                <p key={`${line}-${idx}`}>{line}</p>
              ))}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setSubmitNotice(null)}
                className={`px-5 py-2 rounded-lg text-sm font-semibold text-white transition-colors ${
                  submitNotice.type === "success"
                    ? "bg-indigo-600 hover:bg-indigo-700"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

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
                        {officeLocations.map((location) => {
                          const label = [location.city, location.country]
                            .filter(Boolean)
                            .join(", ");
                          return (
                            <option
                              key={location.location_id}
                              value={
                                label || `Location ${location.location_id}`
                              }
                            >
                              {label || `Location ${location.location_id}`}
                            </option>
                          );
                        })}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Work Mode
                    </label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                      <select
                        value={requisitionData.workMode}
                        onChange={(e) =>
                          handleInputChange("workMode", e.target.value)
                        }
                        className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 appearance-none"
                      >
                        <option value="">Select work mode</option>
                        {WORK_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode}
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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Manager Notes (Optional)
                  </label>
                  <textarea
                    value={requisitionData.managerNotes}
                    onChange={(e) =>
                      handleInputChange("managerNotes", e.target.value)
                    }
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Internal notes for HR/TA (not visible to candidates)..."
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

                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Primary Skills <span className="text-red-500">*</span>
                        </label>
                        <div className="flex gap-2 mb-2">
                          <select
                            onChange={(e) => {
                              if (e.target.value) {
                                addSkillToPosition(
                                  position.id,
                                  e.target.value,
                                  "primary",
                                );
                                e.target.value = "";
                              }
                            }}
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
                        <div className="flex flex-wrap gap-2">
                          {position.primarySkills.map((skill) => (
                            <span
                              key={skill}
                              className="inline-flex items-center gap-1 px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm font-medium"
                            >
                              {skill}
                              <button
                                type="button"
                                onClick={() =>
                                  removePrimarySkill(position.id, skill)
                                }
                                className="hover:text-indigo-900"
                              >
                                <X size={14} />
                              </button>
                            </span>
                          ))}
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
                          Education (Optional)
                        </label>
                        <input
                          type="text"
                          value={position.education}
                          onChange={(e) =>
                            updatePosition(
                              position.id,
                              "education",
                              e.target.value,
                            )
                          }
                          maxLength={100}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="e.g. B.Tech, MCA, B.E"
                        />
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

                    {/* Item-Level Budget Section */}
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <h4 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-green-600" />
                        Budget for this Position
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Estimated Budget (per resource){" "}
                            <span className="text-red-500">*</span>
                          </label>
                          <div className="relative">
                            <span className="absolute left-3 top-2 text-gray-500">
                              {CURRENCIES.find(
                                (c) => c.code === position.currency,
                              )?.symbol || "₹"}
                            </span>
                            <input
                              type="text"
                              value={position.estimatedBudget}
                              onChange={(e) => {
                                // Allow only numbers and commas
                                const value = e.target.value.replace(
                                  /[^0-9,]/g,
                                  "",
                                );
                                updatePosition(
                                  position.id,
                                  "estimatedBudget",
                                  value,
                                );
                              }}
                              className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                              placeholder="e.g., 50,000"
                            />
                          </div>
                          {position.quantity > 1 &&
                            position.estimatedBudget && (
                              <p className="text-xs text-gray-500 mt-1">
                                Total for {position.quantity} resources:{" "}
                                <span className="font-medium">
                                  {
                                    CURRENCIES.find(
                                      (c) => c.code === position.currency,
                                    )?.symbol
                                  }
                                  {(
                                    parseFloat(
                                      position.estimatedBudget.replace(
                                        /,/g,
                                        "",
                                      ),
                                    ) * position.quantity
                                  ).toLocaleString()}
                                </span>
                              </p>
                            )}
                        </div>

                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Currency <span className="text-red-500">*</span>
                          </label>
                          <select
                            value={position.currency}
                            onChange={(e) =>
                              updatePosition(
                                position.id,
                                "currency",
                                e.target.value,
                              )
                            }
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          >
                            {CURRENCIES.map((curr) => (
                              <option key={curr.code} value={curr.code}>
                                {curr.label}
                              </option>
                            ))}
                          </select>
                        </div>
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

                    {position.isReplacement && (
                      <div className="mt-3 ml-6">
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Replaced Employee{" "}
                          <span className="text-red-500">*</span>
                        </label>
                        <select
                          value={position.replacedEmpId}
                          onChange={(e) => {
                            const empId = e.target.value;
                            updatePosition(position.id, "replacedEmpId", empId);
                            if (empId) {
                              fillPositionFromEmployeeProfile(
                                position.id,
                                empId,
                              );
                            }
                          }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        >
                          <option value="">
                            Select employee being replaced
                          </option>
                          {employeeOptions.map((emp) => (
                            <option key={emp.emp_id} value={emp.emp_id}>
                              {emp.full_name} ({emp.emp_id})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

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
                          accept="application/pdf,.pdf"
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
              title="Review & Finalize"
              subtitle="Review your requisition before submission"
            >
              <div className="space-y-6">
                {/* Budget Summary - Computed from Items */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-green-900 mb-4 flex items-center gap-2">
                    <DollarSign className="w-5 h-5" />
                    Budget Summary (Computed from Items)
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-white rounded-lg p-4 border border-green-100">
                      <div className="text-sm text-gray-600 mb-1">
                        Total Estimated Budget
                      </div>
                      <div className="text-2xl font-bold text-green-700">
                        ₹{computedTotalBudget.toLocaleString()}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Sum of all item budgets
                      </div>
                    </div>
                    <div className="bg-white rounded-lg p-4 border border-green-100">
                      <div className="text-sm text-gray-600 mb-1">
                        Project Duration (Optional)
                      </div>
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

                {/* Per-Item Budget Breakdown */}
                <div className="bg-white border border-gray-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    Item Budget Breakdown
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium text-gray-700">
                            Position
                          </th>
                          <th className="text-center px-4 py-2 font-medium text-gray-700">
                            Qty
                          </th>
                          <th className="text-right px-4 py-2 font-medium text-gray-700">
                            Budget/Resource
                          </th>
                          <th className="text-right px-4 py-2 font-medium text-gray-700">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {requisitionData.positions.map((pos, idx) => {
                          const perResource =
                            parseFloat(pos.estimatedBudget.replace(/,/g, "")) ||
                            0;
                          const total = perResource * pos.quantity;
                          const currSymbol =
                            CURRENCIES.find((c) => c.code === pos.currency)
                              ?.symbol || "₹";
                          return (
                            <tr key={pos.id} className="hover:bg-gray-50">
                              <td className="px-4 py-2">
                                <span className="font-medium">
                                  {pos.roleTitle || `Position ${idx + 1}`}
                                </span>
                                <span className="text-gray-500 text-xs ml-2">
                                  (
                                  {pos.primarySkills.length > 0
                                    ? pos.primarySkills.join(", ")
                                    : "No skills"}
                                  )
                                </span>
                              </td>
                              <td className="px-4 py-2 text-center">
                                {pos.quantity}
                              </td>
                              <td className="px-4 py-2 text-right">
                                {currSymbol}
                                {perResource.toLocaleString()}
                              </td>
                              <td className="px-4 py-2 text-right font-medium">
                                {currSymbol}
                                {total.toLocaleString()}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-gray-50 font-semibold">
                        <tr>
                          <td className="px-4 py-2">Total</td>
                          <td className="px-4 py-2 text-center">
                            {requisitionData.positions.reduce(
                              (sum, pos) => sum + pos.quantity,
                              0,
                            )}
                          </td>
                          <td className="px-4 py-2"></td>
                          <td className="px-4 py-2 text-right text-green-700">
                            ₹{computedTotalBudget.toLocaleString()}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>

                {/* Requisition Summary */}
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
                      <span className="text-gray-600">
                        Total Estimated Budget:
                      </span>
                      <span className="font-bold text-green-700 text-lg">
                        ₹{computedTotalBudget.toLocaleString()}
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
                          <strong>
                            Each item's budget must be approved individually
                          </strong>{" "}
                          by HR before proceeding
                        </li>
                        <li>
                          You will receive notifications on the approval status
                        </li>
                        <li>
                          Budget approval for all items is required before
                          proceeding to sourcing
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
