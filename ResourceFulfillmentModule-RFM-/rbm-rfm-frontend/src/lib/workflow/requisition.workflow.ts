/**
 * ============================================================================
 * REQUISITION WORKFLOW - State Machine Definition
 * ============================================================================
 *
 * @deprecated This module is superseded by the backend-driven Workflow Engine V2.
 *
 * For new code, use:
 * - api/workflowApi.ts - API functions (approveBudget, approveHR, rejectRequisition, etc.)
 * - api/workflowHooks.ts - React hooks (useRequisitionWorkflow)
 * - components/workflow/ - UI components (WorkflowTransitionButtons)
 *
 * The backend is the SINGLE SOURCE OF TRUTH. Do not use this module to decide
 * if a transition is allowed - fetch allowed transitions from the backend API.
 *
 * See: docs/WORKFLOW_SPECIFICATION.md
 * ============================================================================
 */

import {
  Workflow,
  TransitionContext,
  minLength,
  required,
  when,
} from "./engine";

// ============================================================================
// Status Types
// ============================================================================

/**
 * F-002 FIX: Status values must match backend workflow_matrix.py exactly
 *
 * Backend enum: services/requisition/workflow_matrix.py - RequisitionStatus
 * DB migration: alembic/versions/wf_spec_v1_constraints.py
 *
 * CRITICAL: These values are the spec-compliant format with underscores.
 * The migration wf_spec_v1_constraints.py converts:
 *   - "Pending Budget Approval" → "Pending_Budget"
 *   - "Pending HR Approval" → "Pending_HR"
 *   - "Approved & Unassigned" → merged into "Active"
 *   - "Closed" → renamed to "Fulfilled" or "Cancelled"
 */
export const REQUISITION_STATUSES = [
  "Draft",
  "Pending_Budget", // F-002: Was "Pending Budget Approval"
  "Pending_HR", // F-002: Was "Pending HR Approval"
  "Active", // F-002: "Approved & Unassigned" merged into this
  "Fulfilled", // F-002: Was "Closed"
  "Rejected",
  "Cancelled",
] as const;

export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

// ============================================================================
// Context Type
// ============================================================================

/**
 * Context required for requisition transitions.
 * Components must provide relevant data for validation.
 */
export interface RequisitionContext extends TransitionContext {
  /** Reason for rejection - required when rejecting */
  rejectionReason?: string;
  /** User's role for permission checks */
  userRole?: "hr" | "budget_manager" | "admin" | "requester";
  /** Whether budget has been allocated */
  hasBudget?: boolean;
  /** Whether positions are assigned */
  hasAssignments?: boolean;
  /** Reason for cancellation */
  cancellationReason?: string;
  /** The requisition ID for logging */
  requisitionId?: number;
}

// ============================================================================
// Transition Guards
// ============================================================================

const hasRejectionReason = minLength<RequisitionContext>(
  "rejectionReason",
  10,
  "Rejection reason must be at least 10 characters",
);

const hasCancellationReason = minLength<RequisitionContext>(
  "cancellationReason",
  10,
  "Cancellation reason must be at least 10 characters",
);

const isBudgetManager = when<RequisitionContext>(
  (ctx) => ctx.userRole === "budget_manager" || ctx.userRole === "admin",
  "Only budget managers can approve budget",
);

const isHRUser = when<RequisitionContext>(
  (ctx) => ctx.userRole === "hr" || ctx.userRole === "admin",
  "Only HR users can perform this action",
);

const isRequesterOrAdmin = when<RequisitionContext>(
  (ctx) => ctx.userRole === "requester" || ctx.userRole === "admin",
  "Only the requester can perform this action",
);

const hasBudgetAllocated = when<RequisitionContext>(
  (ctx) => ctx.hasBudget === true,
  "Budget must be allocated before proceeding",
);

const hasPositionsAssigned = when<RequisitionContext>(
  (ctx) => ctx.hasAssignments === true,
  "At least one position must be assigned",
);

// ============================================================================
// Workflow Definition
// ============================================================================

export const requisitionWorkflow = new Workflow<
  RequisitionStatus,
  RequisitionContext
>(
  {
    name: "Requisition",
    version: "1.0.0",
    description: "Resource requisition approval and fulfillment workflow",
  },
  {
    // F-002 FIX: All status names now match backend workflow_matrix.py

    // Draft state - initial state
    Draft: {
      Pending_Budget: {
        description: "Submit requisition for budget approval",
        guards: [isRequesterOrAdmin],
      },
      Cancelled: {
        description: "Cancel draft requisition",
        guards: [isRequesterOrAdmin],
      },
    },

    // Pending_Budget - waiting for finance
    Pending_Budget: {
      Pending_HR: {
        description: "Approve budget and send to HR",
        guards: [isBudgetManager],
      },
      Rejected: {
        description: "Reject due to budget constraints",
        guards: [isBudgetManager, hasRejectionReason],
      },
      Cancelled: {
        description: "Cancel during budget review",
        guards: [isBudgetManager, hasCancellationReason],
      },
    },

    // Pending_HR - waiting for HR review
    Pending_HR: {
      Active: {
        description: "Approve requisition (transitions to Active)",
        guards: [isHRUser],
      },
      Rejected: {
        description: "Reject due to HR policy",
        guards: [isHRUser, hasRejectionReason],
      },
      Cancelled: {
        description: "Cancel during HR review",
        guards: [isHRUser, hasCancellationReason],
      },
    },

    // Active - hiring in progress
    Active: {
      Fulfilled: {
        description: "Complete when all positions filled (SYSTEM only)",
        guards: [], // SYSTEM-only transition - no user guards
      },
      Cancelled: {
        description: "Cancel active requisition",
        guards: [isHRUser, hasCancellationReason],
      },
    },

    // F-004: Rejected is no longer terminal - can resubmit
    Rejected: {
      Draft: {
        description: "Reopen for revision and resubmission",
        guards: [isRequesterOrAdmin],
      },
    },

    // Terminal states - truly final, no outgoing transitions
    Fulfilled: {},
    Cancelled: {},
  },
);

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Quick check if a status transition is structurally possible.
 */
export function canTransitionRequisition(
  current: RequisitionStatus,
  next: RequisitionStatus,
): boolean {
  return requisitionWorkflow.canTransition(current, next);
}

/**
 * Full validation of a requisition status change.
 */
export function validateRequisitionTransition(
  current: RequisitionStatus,
  next: RequisitionStatus,
  context: RequisitionContext = {},
) {
  return requisitionWorkflow.validate(current, next, context);
}

/**
 * Get all possible next statuses from current state.
 */
export function getRequisitionNextStatuses(
  current: RequisitionStatus,
): RequisitionStatus[] {
  return requisitionWorkflow.getAvailableTransitions(current);
}

/**
 * Check if a status is a terminal state (no outgoing transitions).
 */
export function isTerminalRequisitionStatus(
  status: RequisitionStatus,
): boolean {
  return requisitionWorkflow.getAvailableTransitions(status).length === 0;
}

/**
 * Human-readable status labels for UI display.
 */
export const REQUISITION_STATUS_LABELS: Record<RequisitionStatus, string> = {
  Draft: "Draft",
  Pending_Budget: "Pending Budget Approval",
  Pending_HR: "Pending HR Approval",
  Active: "Active",
  Fulfilled: "Fulfilled",
  Rejected: "Rejected",
  Cancelled: "Cancelled",
};

/**
 * CSS class names for status badges.
 */
export const REQUISITION_STATUS_CLASSES: Record<RequisitionStatus, string> = {
  Draft: "status-draft",
  Pending_Budget: "status-pending-budget",
  Pending_HR: "status-pending-hr",
  Active: "status-active",
  Fulfilled: "status-fulfilled",
  Rejected: "status-rejected",
  Cancelled: "status-cancelled",
};
