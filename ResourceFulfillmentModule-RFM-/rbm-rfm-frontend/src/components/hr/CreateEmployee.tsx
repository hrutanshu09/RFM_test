import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { apiClient } from "../../api/client";
import "../../styles/hr/create-employee.css";
import Stepper from "./create-employee/Stepper";
import StepCoreProfile from "./create-employee/StepCoreProfile";
import StepSkillsContacts from "./create-employee/StepSkillsContacts";
import StepDeployment from "./create-employee/StepDeployment";
import StepFinance from "./create-employee/StepFinance";
import type {
  CreateEmployeeForm,
  DepartmentOption,
  LocationOption,
  ManagerOption,
  RoleOption,
  SkillOption,
} from "./create-employee/types";
import {
  FormErrorMap,
  validateCoreStep,
  validateDeploymentStep,
  validateFinanceStep,
  validateSkillsContactsStep,
} from "./create-employee/validation";

type StepId = "core" | "skills" | "deployment" | "finance";

const getTodayDate = () =>
  new Date().toISOString().split("T")[0] ?? new Date().toISOString();

const deriveNextEmployeeId = (employees: { emp_id: string }[]) => {
  const numbers = new Set(
    employees
      .map((employee) => employee.emp_id.match(/\d+/)?.[0])
      .map((value) => (value ? Number(value) : 0))
      .filter((value) => Number.isFinite(value) && value > 0),
  );

  let candidate = 6;
  while (numbers.has(candidate)) {
    candidate += 1;
  }

  return `RBM-${String(candidate).padStart(4, "0")}`;
};

const extractErrorMessage = (error: unknown) => {
  if (axios.isCancel(error)) {
    return "canceled";
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: string }).code;
    if (code === "ERR_CANCELED") {
      return "canceled";
    }
  }
  if (error && typeof error === "object" && "response" in error) {
    const response = (
      error as { response?: { status?: number; data?: { detail?: string } } }
    ).response;
    const status = response?.status ? ` (${response.status})` : "";
    const detail = response?.data?.detail;
    if (typeof detail === "string") {
      return `${detail}${status}`;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown error";
};

const isCanceledError = (error: unknown) =>
  axios.isCancel(error) ||
  (error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "ERR_CANCELED");

const initialFormData: CreateEmployeeForm = {
  core: {
    empId: "",
    fullName: "",
    departmentId: "",
    roleId: "",
    dob: "",
    gender: "",
    doj: "",
  },
  contacts: [{ type: "work", email: "", phone: "", address: "" }],
  skills: [],
  education: [],
  deployment: {
    availabilityPct: 100,
    effectiveFrom: getTodayDate(),
    managerId: "",
    locationId: "",
  },
  finance: {
    bankDetails: "",
    taxId: "",
  },
};

const CreateEmployee: React.FC = () => {
  const [formData, setFormData] = useState<CreateEmployeeForm>(initialFormData);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [skillsCatalog, setSkillsCatalog] = useState<SkillOption[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [managers, setManagers] = useState<ManagerOption[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [errors, setErrors] = useState<FormErrorMap>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [issuedEmpId, setIssuedEmpId] = useState<string>("");
  const submitInFlight = useRef(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isConfirmed, setIsConfirmed] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  const steps = useMemo(
    () => [
      {
        id: "core",
        title: "Core Profile",
        description: "Identity & role",
      },
      {
        id: "skills",
        title: "Skills & Contacts",
        description: "Qualifications",
      },
      {
        id: "deployment",
        title: "Deployment",
        description: "Availability",
      },
      {
        id: "finance",
        title: "Financial",
        description: "Restricted",
      },
    ],
    [],
  );

  const currentStepId = steps[currentStep]?.id as StepId | undefined;
  const progressPercent =
    steps.length === 0 ? 0 : ((currentStep + 1) / steps.length) * 100;
  const isLastStep = currentStep === steps.length - 1;

  useEffect(() => {
    const controller = new AbortController();

    const loadData = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const results = await Promise.allSettled([
          apiClient.get<{ emp_id: string }>("/employees/next-id", {
            signal: controller.signal,
          }),
          apiClient.get<DepartmentOption[]>("/departments/", {
            signal: controller.signal,
          }),
          apiClient.get<RoleOption[]>("/company-roles", {
            signal: controller.signal,
          }),
          apiClient.get<SkillOption[]>("/skills/", {
            signal: controller.signal,
          }),
          apiClient.get<LocationOption[]>("/locations/", {
            signal: controller.signal,
          }),
          apiClient.get<ManagerOption[]>("/employees/employees", {
            signal: controller.signal,
          }),
        ]);

        const [
          nextIdResult,
          departmentsResult,
          rolesResult,
          skillsResult,
          locationsResult,
          managersResult,
        ] = results;

        const loadIssues: string[] = [];

        if (nextIdResult.status === "fulfilled") {
          const nextId = nextIdResult.value.data?.emp_id ?? "";
          setIssuedEmpId(nextId);
          setFormData((prev) => ({
            ...prev,
            core: {
              ...prev.core,
              empId: nextId,
            },
          }));
        } else if (!isCanceledError(nextIdResult.reason)) {
          try {
            const fallback = await apiClient.get<{ emp_id: string }[]>(
              "/employees/employees",
              { signal: controller.signal },
            );
            const nextId = deriveNextEmployeeId(fallback.data ?? []);
            setIssuedEmpId(nextId);
            setFormData((prev) => ({
              ...prev,
              core: {
                ...prev.core,
                empId: nextId,
              },
            }));
          } catch (fallbackError) {
            if (!isCanceledError(fallbackError)) {
              loadIssues.push(
                `Employee ID (${extractErrorMessage(nextIdResult.reason)})`,
              );
              loadIssues.push(
                `Fallback ID (${extractErrorMessage(fallbackError)})`,
              );
            }
          }
        }

        if (departmentsResult.status === "fulfilled") {
          setDepartments(departmentsResult.value.data ?? []);
        } else if (!isCanceledError(departmentsResult.reason)) {
          loadIssues.push(
            `Departments (${extractErrorMessage(departmentsResult.reason)})`,
          );
        }

        if (rolesResult.status === "fulfilled") {
          setRoles(
            (rolesResult.value.data ?? []).filter(
              (role) => role.is_active !== false,
            ),
          );
        } else if (!isCanceledError(rolesResult.reason)) {
          loadIssues.push(`Roles (${extractErrorMessage(rolesResult.reason)})`);
        }

        if (skillsResult.status === "fulfilled") {
          setSkillsCatalog(skillsResult.value.data ?? []);
        } else if (!isCanceledError(skillsResult.reason)) {
          loadIssues.push(
            `Skills (${extractErrorMessage(skillsResult.reason)})`,
          );
        }

        if (locationsResult.status === "fulfilled") {
          setLocations(locationsResult.value.data ?? []);
        } else if (!isCanceledError(locationsResult.reason)) {
          loadIssues.push(
            `Locations (${extractErrorMessage(locationsResult.reason)})`,
          );
        }

        if (managersResult.status === "fulfilled") {
          setManagers(managersResult.value.data ?? []);
        } else if (!isCanceledError(managersResult.reason)) {
          loadIssues.push(
            `Managers (${extractErrorMessage(managersResult.reason)})`,
          );
        }

        if (loadIssues.length > 0) {
          setError(`Failed to load: ${loadIssues.join(", ")}.`);
        }
      } finally {
        setIsLoading(false);
      }
    };

    loadData();
    return () => controller.abort();
  }, []);

  const handleConfirmSubmit = () => {
    setIsConfirmed(true);
    setShowConfirmModal(false);
    setTimeout(() => {
      formRef.current?.requestSubmit();
    }, 0);
  };

  const handleCancelConfirm = () => {
    setShowConfirmModal(false);
    setIsConfirmed(false);
  };

  useEffect(() => {
    // Step state tracked for form navigation
  }, [currentStep, steps.length, isLastStep]);

  const updateCoreField = (
    field: keyof CreateEmployeeForm["core"],
    value: string,
  ) => {
    setFormData((prev) => ({
      ...prev,
      core: {
        ...prev.core,
        [field]: value,
      },
    }));
  };

  const updateDeploymentField = (
    field: keyof CreateEmployeeForm["deployment"],
    value: string | number,
  ) => {
    setFormData((prev) => ({
      ...prev,
      deployment: {
        ...prev.deployment,
        [field]: value,
      },
    }));
  };

  const updateFinanceField = (
    field: keyof CreateEmployeeForm["finance"],
    value: string,
  ) => {
    setFormData((prev) => ({
      ...prev,
      finance: {
        ...prev.finance,
        [field]: value,
      },
    }));
  };

  const validateStep = (stepId: StepId) => {
    switch (stepId) {
      case "core":
        return validateCoreStep(formData, roles.length > 0);
      case "skills":
        return validateSkillsContactsStep(formData);
      case "deployment":
        return validateDeploymentStep(formData);
      case "finance":
        return validateFinanceStep(formData);
      default:
        return { isValid: true, errors: {} };
    }
  };

  const currentStepValidation = currentStepId
    ? validateStep(currentStepId)
    : { isValid: false, errors: {} };

  const scrollToFirstError = () => {
    setTimeout(() => {
      const firstError = document.querySelector(
        "[data-error='true']",
      ) as HTMLElement | null;
      if (!firstError) return;
      firstError.scrollIntoView({ behavior: "smooth", block: "center" });
      const input = firstError.querySelector(
        "input, select, textarea",
      ) as HTMLElement | null;
      input?.focus();
    }, 0);
  };

  const handleNext = () => {
    if (isSubmitting) return;

    if (!currentStepId) return;
    const validation = validateStep(currentStepId);
    if (!validation.isValid) {
      setErrors(validation.errors);
      scrollToFirstError();
      return;
    }
    setErrors({});
    setCurrentStep((prev) => {
      const next = Math.min(prev + 1, steps.length - 1);
      return next;
    });
  };

  const handlePrevious = () => {
    setErrors({});
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  const handleStepChange = (index: number) => {
    if (index <= currentStep) {
      setErrors({});
      setCurrentStep(index);
    }
  };

  const handleFormKeyDown = (event: React.KeyboardEvent<HTMLFormElement>) => {
    if (event.key === "Enter" && !isLastStep) {
      event.preventDefault();
      handleNext();
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitInFlight.current || isSubmitting) {
      return;
    }
    setError(null);
    setSuccess(null);

    if (!isLastStep) {
      return;
    }

    if (!isConfirmed) {
      setShowConfirmModal(true);
      return;
    }

    const validations = steps.map((step) => ({
      id: step.id as StepId,
      ...validateStep(step.id as StepId),
    }));
    const firstInvalid = validations.find((item) => !item.isValid);
    if (firstInvalid) {
      setErrors(firstInvalid.errors);
      const stepIndex = steps.findIndex((step) => step.id === firstInvalid.id);
      setCurrentStep(stepIndex >= 0 ? stepIndex : 0);
      scrollToFirstError();
      return;
    }

    if (!issuedEmpId || issuedEmpId !== formData.core.empId) {
      setError("Employee ID is out of date. Please refresh to get a new ID.");
      return;
    }

    const workContact = formData.contacts.find((item) => item.type === "work");
    const workEmail = workContact?.email?.trim();
    if (!workEmail) {
      setError("Work email is required.");
      return;
    }

    try {
      submitInFlight.current = true;
      setIsSubmitting(true);
      const payload = {
        emp_id: formData.core.empId,
        full_name: formData.core.fullName.trim(),
        rbm_email: workEmail,
        company_role_id: formData.core.roleId
          ? Number(formData.core.roleId)
          : null,
        dob: formData.core.dob || null,
        gender: formData.core.gender || null,
        doj: formData.core.doj || null,
        contacts: formData.contacts.map((contact) => ({
          type: contact.type,
          email: contact.email.trim() || undefined,
          phone: contact.phone.trim() || undefined,
          address: contact.address.trim() || undefined,
        })),
        skills: formData.skills.map((skill) => ({
          skill_id: skill.skill_id,
          proficiency_level: skill.proficiency_level,
          years_experience: skill.years_experience,
        })),
        education: formData.education.map((edu) => ({
          qualification: edu.qualification.trim() || undefined,
          specialization: edu.specialization.trim() || undefined,
          institution: edu.institution.trim() || undefined,
          year_completed: edu.year_completed
            ? Number(edu.year_completed)
            : undefined,
        })),
        availability: {
          availability_pct: formData.deployment.availabilityPct,
          effective_from: formData.deployment.effectiveFrom,
        },
        finance:
          formData.finance.bankDetails || formData.finance.taxId
            ? {
                bank_details: formData.finance.bankDetails,
                tax_id: formData.finance.taxId,
              }
            : null,
      };

      await apiClient.post("/employees/onboard", payload);

      try {
        await apiClient.post(`/employees/${formData.core.empId}/assignments`, {
          department_id: Number(formData.core.departmentId),
          manager_id: formData.deployment.managerId || null,
          location_id: formData.deployment.locationId
            ? Number(formData.deployment.locationId)
            : null,
          start_date: formData.deployment.effectiveFrom,
          end_date: null,
        });
      } catch (assignmentError) {
        const message =
          assignmentError instanceof Error
            ? assignmentError.message
            : "Employee created, but assignment failed.";
        setError(message);
      }

      setSuccess(`Employee ${formData.core.empId} onboarded successfully.`);
      const nextIdRes = await apiClient.get<{ emp_id: string }>(
        "/employees/next-id",
      );
      const nextId = nextIdRes.data?.emp_id ?? "";
      setIssuedEmpId(nextId);
      setFormData({
        ...initialFormData,
        core: { ...initialFormData.core, empId: nextId },
        deployment: {
          ...initialFormData.deployment,
          effectiveFrom: getTodayDate(),
        },
      });
      setErrors({});
      setCurrentStep(0);
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Failed to onboard employee. Please try again.";
      setError(message);
    } finally {
      submitInFlight.current = false;
      setIsSubmitting(false);
      setIsConfirmed(false);
    }
  };

  if (isLoading) {
    return (
      <div className="create-employee-container">
        <div className="form-loading-overlay">
          <div className="spinner"></div>
          <p>Loading onboarding data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="create-employee-container">
      <div className="create-employee-header">
        <h1>Create New Employee</h1>
        <p>Configure core details, skills, and deployment information.</p>
      </div>

      {error && (
        <div className="validation-message error form-banner">{error}</div>
      )}
      {success && (
        <div className="validation-message success form-banner">{success}</div>
      )}

      <Stepper
        steps={steps}
        currentStep={currentStep}
        progressPercent={progressPercent}
        onStepChange={handleStepChange}
      />

      <form
        ref={formRef}
        className="employee-form-container"
        onSubmit={handleSubmit}
        onKeyDown={handleFormKeyDown}
      >
        <div
          className={`form-section ${currentStepId === "core" ? "active" : ""}`}
        >
          <div className="section-header">
            <h2>
              <span className="section-icon">1</span> Core Profile
            </h2>
            <p className="section-subtitle">Employee identity & role.</p>
          </div>
          <StepCoreProfile
            formData={formData}
            departments={departments}
            roles={roles}
            errors={errors}
            onChange={updateCoreField}
            isDisabled={isSubmitting}
          />
        </div>

        <div
          className={`form-section ${currentStepId === "skills" ? "active" : ""}`}
        >
          <div className="section-header">
            <h2>
              <span className="section-icon">2</span> Skills & Contacts
            </h2>
            <p className="section-subtitle">Skills, contacts, and education.</p>
          </div>
          <StepSkillsContacts
            formData={formData}
            skillsCatalog={skillsCatalog}
            errors={errors}
            onContactsChange={(contacts) =>
              setFormData((prev) => ({ ...prev, contacts }))
            }
            onSkillsChange={(skills) =>
              setFormData((prev) => ({ ...prev, skills }))
            }
            onEducationChange={(education) =>
              setFormData((prev) => ({ ...prev, education }))
            }
            isDisabled={isSubmitting}
          />
        </div>

        <div
          className={`form-section ${currentStepId === "deployment" ? "active" : ""}`}
        >
          <div className="section-header">
            <h2>
              <span className="section-icon">3</span> Deployment
            </h2>
            <p className="section-subtitle">
              Availability & assignment details.
            </p>
          </div>
          <StepDeployment
            formData={formData}
            locations={locations}
            managers={managers}
            errors={errors}
            onChange={updateDeploymentField}
            isDisabled={isSubmitting}
          />
        </div>

        <div
          className={`form-section ${currentStepId === "finance" ? "active" : ""}`}
        >
          <div className="section-header">
            <h2>
              <span className="section-icon">4</span> Financial
            </h2>
            <p className="section-subtitle">Restricted financial data.</p>
          </div>
          <StepFinance
            formData={formData}
            errors={errors}
            onChange={updateFinanceField}
            isDisabled={isSubmitting}
          />
        </div>

        <div className="form-actions">
          <div className="stepper-buttons">
            {currentStep > 0 && (
              <button
                type="button"
                className="previous-button"
                onClick={handlePrevious}
                disabled={isSubmitting}
              >
                ← Previous
              </button>
            )}

            {currentStep < steps.length - 1 ? (
              <button
                type="button"
                className="next-button"
                onClick={handleNext}
                disabled={!currentStepValidation.isValid || isSubmitting}
              >
                Next Step →
              </button>
            ) : (
              <button
                type="submit"
                className="submit-button"
                disabled={isSubmitting || !currentStepValidation.isValid}
              >
                {isSubmitting ? "Creating Employee..." : "Create Employee"}
              </button>
            )}
          </div>

          <div className="progress-info">
            <span>
              Step {currentStep + 1} of {steps.length}
            </span>
            <span className="progress-divider">•</span>
            <span>{Math.round(progressPercent)}% Complete</span>
          </div>
        </div>
      </form>

      {showConfirmModal && (
        <div
          className="confirm-modal-overlay"
          role="presentation"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(15, 23, 42, 0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-create-title"
            className="confirm-modal"
            style={{
              background: "var(--bg-primary)",
              borderRadius: "16px",
              padding: "24px",
              width: "min(420px, 90vw)",
              boxShadow: "0 24px 60px rgba(15, 23, 42, 0.25)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <h3
              id="confirm-create-title"
              style={{ margin: "0 0 8px", fontSize: "18px" }}
            >
              Confirm employee creation
            </h3>
            <p style={{ margin: "0 0 20px", color: "var(--text-secondary)" }}>
              Are you sure you want to create this employee?
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "12px",
              }}
            >
              <button
                type="button"
                className="action-button"
                onClick={handleCancelConfirm}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                type="button"
                className="action-button primary"
                onClick={handleConfirmSubmit}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Submitting..." : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CreateEmployee;
