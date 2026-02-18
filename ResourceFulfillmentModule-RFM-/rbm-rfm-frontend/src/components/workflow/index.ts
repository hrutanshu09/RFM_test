/**
 * ============================================================================
 * WORKFLOW COMPONENTS - Public Exports
 * ============================================================================
 *
 * Central export point for all workflow UI components.
 * Status types now sourced from src/types/workflow.ts (canonical).
 * The backend is the single source of truth for workflow logic.
 */

// ─── Canonical workflow types (single source of truth) ───
export type {
  RequisitionStatus,
  RequisitionItemStatus,
  TransitionAction,
} from "../../types/workflow";

export {
  REQUISITION_STATUSES,
  ITEM_STATUSES,
  TERMINAL_REQUISITION_STATUSES,
  REQUISITION_STATUS_LABELS,
  ITEM_STATUS_LABELS,
  REQUISITION_STATUS_CLASSES,
  ITEM_STATUS_CLASSES,
  LEGACY_STATUS_MAP,
  normalizeStatus,
  getStatusLabel,
  getStatusClass,
  getItemStatusLabel,
  getItemStatusClass,
  isRequisitionStatus,
  isItemStatus,
  isTerminalStatus,
} from "../../types/workflow";

// ─── API types & functions ───
export {
  type TransitionInfo,
  type AllowedTransitionsResponse,
  type WorkflowTransitionResponse,
  type WorkflowErrorResponse,
  type WorkflowErrorCode,
  getRequisitionAllowedTransitions,
  getItemAllowedTransitions,
  submitRequisition,
  approveBudget,
  approveHR,
  rejectRequisition,
  cancelRequisition,
  reopenRequisition,
  assignTA,
  shortlistItem,
  startInterview,
  makeOffer,
  fulfillItem,
  cancelItem,
  WORKFLOW_ERROR_CODES,
  isWorkflowError,
  getWorkflowErrorMessage,
} from "../../api/workflowApi";

// ─── Hooks ───
export {
  useRequisitionWorkflow,
  useItemWorkflow,
  useWorkflowError,
  type WorkflowState,
  type WorkflowActions,
  type ItemWorkflowOptions,
} from "../../api/workflowHooks";

// ─── UI Components ───
export {
  WorkflowTransitionButtons,
  WorkflowErrorAlert,
  /** @deprecated Use StatusBadge from src/components/common instead */
  WorkflowStatusBadge,
  DEFAULT_REQUISITION_BUTTON_CONFIGS,
  DEFAULT_ITEM_BUTTON_CONFIGS,
  type TransitionButtonConfig,
  type WorkflowTransitionButtonsProps,
  type WorkflowErrorAlertProps,
  type WorkflowStatusBadgeProps,
} from "./WorkflowTransitionButtons";
