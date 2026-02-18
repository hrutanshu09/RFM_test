/**
 * ============================================================================
 * EMPLOYEE LIFECYCLE WORKFLOW - State Machine Definition
 * ============================================================================
 *
 * Defines all valid status transitions for employee lifecycle management.
 * Covers onboarding, active employment, and offboarding.
 */

import {
  Workflow,
  TransitionContext,
  required,
  hasDate,
  when,
  minLength,
} from "./engine";

// ============================================================================
// Status Types
// ============================================================================

export const EMPLOYEE_LIFECYCLE_STATUSES = [
  "Pre-Onboarding",
  "Onboarding",
  "Active",
  "On Leave",
  "Notice Period",
  "Exited",
  "Terminated",
  "Suspended",
] as const;

export type EmployeeLifecycleStatus =
  (typeof EMPLOYEE_LIFECYCLE_STATUSES)[number];

// ============================================================================
// Onboarding Sub-Status
// ============================================================================

export const ONBOARDING_STATUSES = [
  "Not Started",
  "Documentation Pending",
  "Background Check",
  "IT Setup",
  "Orientation",
  "Completed",
] as const;

export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];

// ============================================================================
// Context Type
// ============================================================================

export interface EmployeeLifecycleContext extends TransitionContext {
  /** Date of joining - required to move to Active */
  dateOfJoining?: string | Date;
  /** Exit date - required for offboarding */
  exitDate?: string | Date;
  /** Last working day - required for notice period */
  lastWorkingDay?: string | Date;
  /** User's role for permission checks */
  userRole?: "hr" | "manager" | "admin";
  /** Whether background check is complete */
  backgroundCheckComplete?: boolean;
  /** Whether IT setup is complete */
  itSetupComplete?: boolean;
  /** Whether all documents are submitted */
  documentsComplete?: boolean;
  /** Reason for termination */
  terminationReason?: string;
  /** Reason for suspension */
  suspensionReason?: string;
  /** Leave type for On Leave status */
  leaveType?: "medical" | "personal" | "maternity" | "paternity" | "sabbatical";
  /** Expected return date for leave */
  expectedReturnDate?: string | Date;
  /** Whether exit interview is complete */
  exitInterviewComplete?: boolean;
  /** Whether handover is complete */
  handoverComplete?: boolean;
}

// ============================================================================
// Transition Guards
// ============================================================================

const hasDateOfJoining = hasDate<EmployeeLifecycleContext>(
  "dateOfJoining",
  "Date of Joining is required to activate employee",
);

const hasExitDate = hasDate<EmployeeLifecycleContext>(
  "exitDate",
  "Exit date is required for offboarding",
);

const hasLastWorkingDay = hasDate<EmployeeLifecycleContext>(
  "lastWorkingDay",
  "Last working day is required",
);

const hasBackgroundCheck = when<EmployeeLifecycleContext>(
  (ctx) => ctx.backgroundCheckComplete === true,
  "Background check must be completed",
);

const hasITSetup = when<EmployeeLifecycleContext>(
  (ctx) => ctx.itSetupComplete === true,
  "IT setup must be completed",
);

const hasDocuments = when<EmployeeLifecycleContext>(
  (ctx) => ctx.documentsComplete === true,
  "All required documents must be submitted",
);

const hasTerminationReason = minLength<EmployeeLifecycleContext>(
  "terminationReason",
  10,
  "Termination reason must be at least 10 characters",
);

const hasSuspensionReason = minLength<EmployeeLifecycleContext>(
  "suspensionReason",
  10,
  "Suspension reason must be at least 10 characters",
);

const hasLeaveDetails = when<EmployeeLifecycleContext>(
  (ctx) => !!ctx.leaveType && !!ctx.expectedReturnDate,
  "Leave type and expected return date are required",
);

const hasExitInterview = when<EmployeeLifecycleContext>(
  (ctx) => ctx.exitInterviewComplete === true,
  "Exit interview must be completed",
);

const hasHandover = when<EmployeeLifecycleContext>(
  (ctx) => ctx.handoverComplete === true,
  "Handover must be completed",
);

const isHRorAdmin = when<EmployeeLifecycleContext>(
  (ctx) => ctx.userRole === "hr" || ctx.userRole === "admin",
  "Only HR can perform this action",
);

// ============================================================================
// Workflow Definition
// ============================================================================

export const employeeLifecycleWorkflow = new Workflow<
  EmployeeLifecycleStatus,
  EmployeeLifecycleContext
>(
  {
    name: "Employee Lifecycle",
    version: "1.0.0",
    description: "Employee lifecycle from hire to exit",
  },
  {
    // Pre-Onboarding - offer accepted, not yet started
    "Pre-Onboarding": {
      Onboarding: {
        description: "Begin onboarding process",
        guards: [isHRorAdmin, hasDocuments],
      },
    },

    // Onboarding - employee is being onboarded
    Onboarding: {
      Active: {
        description: "Complete onboarding and activate",
        guards: [isHRorAdmin, hasDateOfJoining, hasBackgroundCheck, hasITSetup],
      },
      "Pre-Onboarding": {
        description: "Return to pre-onboarding if issues found",
        guards: [isHRorAdmin],
      },
    },

    // Active - regular employment
    Active: {
      "On Leave": {
        description: "Employee goes on leave",
        guards: [hasLeaveDetails],
      },
      "Notice Period": {
        description: "Employee resignation or notice given",
        guards: [isHRorAdmin, hasLastWorkingDay],
      },
      Terminated: {
        description: "Immediate termination",
        guards: [isHRorAdmin, hasTerminationReason],
      },
      Suspended: {
        description: "Suspend employee",
        guards: [isHRorAdmin, hasSuspensionReason],
      },
    },

    // On Leave - temporary absence
    "On Leave": {
      Active: {
        description: "Return from leave",
        guards: [],
      },
      "Notice Period": {
        description: "Resign while on leave",
        guards: [isHRorAdmin, hasLastWorkingDay],
      },
    },

    // Notice Period - working through notice
    "Notice Period": {
      Exited: {
        description: "Complete exit process",
        guards: [isHRorAdmin, hasExitDate, hasExitInterview, hasHandover],
      },
      Active: {
        description: "Withdrawal of resignation (if accepted)",
        guards: [isHRorAdmin],
      },
    },

    // Suspended - temporary suspension
    Suspended: {
      Active: {
        description: "Reinstate employee",
        guards: [isHRorAdmin],
      },
      Terminated: {
        description: "Terminate suspended employee",
        guards: [isHRorAdmin, hasTerminationReason],
      },
    },

    // Terminal states
    Exited: {},
    Terminated: {},
  },
);

// ============================================================================
// Convenience Functions
// ============================================================================

export function canTransitionEmployee(
  current: EmployeeLifecycleStatus,
  next: EmployeeLifecycleStatus,
): boolean {
  return employeeLifecycleWorkflow.canTransition(current, next);
}

export function validateEmployeeTransition(
  current: EmployeeLifecycleStatus,
  next: EmployeeLifecycleStatus,
  context: EmployeeLifecycleContext = {},
) {
  return employeeLifecycleWorkflow.validate(current, next, context);
}

export function getEmployeeNextStatuses(
  current: EmployeeLifecycleStatus,
): EmployeeLifecycleStatus[] {
  return employeeLifecycleWorkflow.getAvailableTransitions(current);
}

export function isTerminalEmployeeStatus(
  status: EmployeeLifecycleStatus,
): boolean {
  return employeeLifecycleWorkflow.getAvailableTransitions(status).length === 0;
}

export const EMPLOYEE_STATUS_LABELS: Record<EmployeeLifecycleStatus, string> = {
  "Pre-Onboarding": "Pre-Onboarding",
  Onboarding: "Onboarding",
  Active: "Active",
  "On Leave": "On Leave",
  "Notice Period": "Notice Period",
  Exited: "Exited",
  Terminated: "Terminated",
  Suspended: "Suspended",
};

export const EMPLOYEE_STATUS_CLASSES: Record<EmployeeLifecycleStatus, string> =
  {
    "Pre-Onboarding": "status-pre-onboarding",
    Onboarding: "status-onboarding",
    Active: "status-active",
    "On Leave": "status-on-leave",
    "Notice Period": "status-notice",
    Exited: "status-exited",
    Terminated: "status-terminated",
    Suspended: "status-suspended",
  };
