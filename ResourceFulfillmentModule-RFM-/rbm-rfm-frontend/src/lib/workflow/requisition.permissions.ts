/**
 * ============================================================================
 * REQUISITION PERMISSIONS - Spec-Compliant Status Definitions
 * ============================================================================
 *
 * @deprecated This module is superseded by the backend-driven Workflow Engine V2.
 *
 * For new code, use api/workflowApi.ts which provides:
 * - getRequisitionAllowedTransitions() - fetches allowed transitions from backend
 * - normalizeStatus() - converts legacy status values
 * - isWorkflowError() - error handling utilities
 *
 * The backend is the SINGLE SOURCE OF TRUTH. Do not use this module to decide
 * if a transition is allowed - the backend returns authorized_roles and
 * allowed transitions dynamically.
 *
 * See: docs/WORKFLOW_SPECIFICATION.md
 * ============================================================================
 */

// Import from canonical source
import {
  RequisitionStatus,
  REQUISITION_STATUSES,
  canTransitionRequisition,
} from "./requisition.workflow";

// Re-export for compatibility
export type { RequisitionStatus };
export { REQUISITION_STATUSES };

/**
 * TERMINAL STATES - no outbound transitions allowed
 * Source: workflow_matrix.py HEADER_TERMINAL_STATES
 *
 * F-004: REJECTED removed from terminal states - can now reopen to Draft
 */
export const TERMINAL_STATUSES: readonly RequisitionStatus[] = [
  "Fulfilled",
  "Cancelled",
] as const;

/**
 * States where requisition can be edited by Manager
 * Source: workflow_matrix.py + permissions logic
 */
export const EDITABLE_STATUSES: readonly RequisitionStatus[] = [
  "Draft",
] as const;

export const canEditRequisition = (status: RequisitionStatus): boolean => {
  return EDITABLE_STATUSES.includes(
    status as (typeof EDITABLE_STATUSES)[number],
  );
};

export const canSubmitRequisition = (status: RequisitionStatus): boolean => {
  // Can only submit from Draft
  return status === "Draft";
};

export const canCancelRequisition = (status: RequisitionStatus): boolean => {
  // Can cancel from non-terminal states
  return !TERMINAL_STATUSES.includes(
    status as (typeof TERMINAL_STATUSES)[number],
  );
};

/**
 * Get allowed target statuses for a given current status.
 *
 * PREFERRED: Use requisitionWorkflow.getAvailableTransitions() instead
 * for full guard validation.
 */
export const getNextAllowedStatuses = (
  currentStatus: RequisitionStatus,
  _userRole?: "manager" | "finance" | "hr", // Deprecated - use workflow guards
): RequisitionStatus[] => {
  // Use the workflow engine for accurate transitions
  return REQUISITION_STATUSES.filter(
    (target) =>
      target !== currentStatus &&
      canTransitionRequisition(currentStatus, target),
  );
};

/**
 * Check if a status is terminal (no further transitions possible)
 */
export const isTerminalStatus = (status: RequisitionStatus): boolean => {
  return TERMINAL_STATUSES.includes(
    status as (typeof TERMINAL_STATUSES)[number],
  );
};

/**
 * Check if transition is allowed structurally
 * (Does not check guards - use workflow engine for full validation)
 */
export const isTransitionAllowed = canTransitionRequisition;
