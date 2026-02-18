/**
 * ============================================================================
 * WORKFLOW TYPES — Single Source of Truth
 * ============================================================================
 *
 * Canonical type definitions for the workflow engine.
 * MUST match backend/services/requisition/workflow_matrix.py exactly.
 *
 * RULE: All other files import status types from HERE.
 *       No duplicate enum definitions allowed elsewhere.
 */

// ============================================================================
// REQUISITION STATUS
// ============================================================================

/**
 * Requisition header statuses.
 * Source: backend WorkflowMatrix.REQUISITION_TRANSITIONS
 */
export type RequisitionStatus =
  | "Draft"
  | "Pending_Budget"
  | "Pending_HR"
  | "Active"
  | "Fulfilled"
  | "Rejected"
  | "Cancelled";

/** All valid requisition statuses as an array (for runtime checks). */
export const REQUISITION_STATUSES: readonly RequisitionStatus[] = [
  "Draft",
  "Pending_Budget",
  "Pending_HR",
  "Active",
  "Fulfilled",
  "Rejected",
  "Cancelled",
] as const;

/** Terminal statuses where no further transitions are possible. */
export const TERMINAL_REQUISITION_STATUSES: readonly RequisitionStatus[] = [
  "Fulfilled",
  "Rejected",
  "Cancelled",
] as const;

// ============================================================================
// REQUISITION ITEM STATUS
// ============================================================================

/**
 * Requisition item statuses.
 * Source: backend WorkflowMatrix.ITEM_TRANSITIONS
 */
export type RequisitionItemStatus =
  | "Pending"
  | "Sourcing"
  | "Shortlisted"
  | "Interviewing"
  | "Offered"
  | "Fulfilled"
  | "Cancelled";

/** All valid item statuses as an array. */
export const ITEM_STATUSES: readonly RequisitionItemStatus[] = [
  "Pending",
  "Sourcing",
  "Shortlisted",
  "Interviewing",
  "Offered",
  "Fulfilled",
  "Cancelled",
] as const;

// ============================================================================
// TRANSITION ACTION (for audit trail context)
// ============================================================================

/**
 * Known workflow transition actions.
 * Kept as a union for type-safety; the backend may send additional values.
 */
export type TransitionAction =
  | "submit"
  | "approve_budget"
  | "approve_hr"
  | "reject"
  | "cancel"
  | "reopen"
  | "assign_ta"
  | "start_sourcing"
  | "shortlist"
  | "start_interview"
  | "make_offer"
  | "fulfill"
  | "cancel_item"
  // Item budget actions
  | "edit_item_budget"
  | "approve_item_budget"
  | "reject_item_budget";

// ============================================================================
// ITEM BUDGET STATUS
// ============================================================================

/**
 * Budget approval status for requisition items.
 * This is NOT a workflow status - it tracks budget approval state separately.
 */
export type ItemBudgetStatus = "pending" | "approved" | "rejected";

/** All valid item budget statuses as an array. */
export const ITEM_BUDGET_STATUSES: readonly ItemBudgetStatus[] = [
  "pending",
  "approved",
  "rejected",
] as const;

/** Human-readable labels for item budget statuses. */
export const ITEM_BUDGET_STATUS_LABELS: Record<ItemBudgetStatus, string> = {
  pending: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
};

/** CSS class per item budget status. */
export const ITEM_BUDGET_STATUS_CLASSES: Record<ItemBudgetStatus, string> = {
  pending: "budget-status--pending",
  approved: "budget-status--approved",
  rejected: "budget-status--rejected",
};

// ============================================================================
// REQUISITION ITEM WITH BUDGET
// ============================================================================

/**
 * Requisition item with budget fields.
 * Matches backend schemas/requisition_item.py - RequisitionItemResponse
 */
export interface RequisitionItem {
  item_id: number;
  req_id: number;
  role_position: string;
  skill_level: string | null;
  experience_years: number | null;
  education_requirement: string | null;
  job_description: string;
  requirements: string | null;
  item_status: RequisitionItemStatus;
  replacement_hire: boolean;
  replaced_emp_id: string | null;
  // Budget fields (item-level)
  estimated_budget: number | null;
  approved_budget: number | null;
  currency: string;
  // Assignment
  assigned_ta: number | null;
  assigned_emp_id: string | null;
}

/**
 * Requisition item creation payload with budget.
 * Matches backend schemas/requisition_item.py - RequisitionItemCreate
 */
export interface RequisitionItemCreate {
  role_position: string;
  job_description: string;
  skill_level?: string;
  experience_years?: number;
  education_requirement?: string;
  requirements?: string;
  replacement_hire?: boolean;
  replaced_emp_id?: string;
  // Budget fields (item-level)
  estimated_budget?: number;
  currency?: string;
}

// ============================================================================
// REQUISITION WITH COMPUTED BUDGETS
// ============================================================================

/**
 * Budget approval status for entire requisition.
 */
export type BudgetApprovalStatus = "none" | "pending" | "partial" | "approved";

/**
 * Requisition with computed budget totals.
 * Matches backend schemas/requisition.py - RequisitionResponse
 */
export interface Requisition {
  req_id: number;
  project_name: string | null;
  client_name: string | null;
  office_location: string | null;
  work_mode: string | null;
  required_by_date: string | null;
  priority: string | null;
  justification: string | null;
  // DEPRECATED: Header-level budget - use computed totals
  budget_amount: number | null;
  duration: string | null;
  is_replacement: boolean | null;
  manager_notes: string | null;
  rejection_reason: string | null;
  jd_file_key: string | null;
  overall_status: RequisitionStatus;
  raised_by: number;
  assigned_ta: number | null;
  budget_approved_by: number | null;
  approved_by: number | null;
  approval_history: string | null;
  assigned_at: string | null;
  created_at: string | null;
  items: RequisitionItem[];
  // Progress tracking
  total_items: number | null;
  fulfilled_items: number | null;
  cancelled_items: number | null;
  active_items: number | null;
  progress_ratio: number | null;
  progress_text: string | null;
  // Computed budget totals (from items)
  total_estimated_budget: number | null;
  total_approved_budget: number | null;
  budget_approval_status: BudgetApprovalStatus | null;
}

// ============================================================================
// ITEM BUDGET API TYPES
// ============================================================================

/**
 * Request to edit item budget.
 */
export interface ItemBudgetEditRequest {
  estimated_budget: number;
  currency: string;
}

/**
 * Request to reject item budget.
 */
export interface ItemBudgetRejectRequest {
  reason: string;
}

/**
 * Response from item budget operations.
 */
export interface ItemBudgetResponse {
  success: boolean;
  item_id: number;
  estimated_budget: number;
  approved_budget: number | null;
  currency: string;
  budget_status: ItemBudgetStatus;
  header_status?: RequisitionStatus;
}

// ============================================================================
// DISPLAY LABELS
// ============================================================================

/** Human-readable labels for requisition statuses. */
export const REQUISITION_STATUS_LABELS: Record<RequisitionStatus, string> = {
  Draft: "Draft",
  Pending_Budget: "Pending Budget",
  Pending_HR: "Pending HR",
  Active: "Active",
  Fulfilled: "Fulfilled",
  Rejected: "Rejected",
  Cancelled: "Cancelled",
};

/** Human-readable labels for item statuses. */
export const ITEM_STATUS_LABELS: Record<RequisitionItemStatus, string> = {
  Pending: "Pending",
  Sourcing: "Sourcing",
  Shortlisted: "Shortlisted",
  Interviewing: "Interviewing",
  Offered: "Offer Extended",
  Fulfilled: "Fulfilled",
  Cancelled: "Cancelled",
};

// ============================================================================
// CSS CLASS MAPPINGS
// ============================================================================

/** CSS class per requisition status — used by StatusBadge. */
export const REQUISITION_STATUS_CLASSES: Record<RequisitionStatus, string> = {
  Draft: "status--draft",
  Pending_Budget: "status--pending",
  Pending_HR: "status--pending",
  Active: "status--active",
  Fulfilled: "status--fulfilled",
  Rejected: "status--rejected",
  Cancelled: "status--cancelled",
};

/** CSS class per item status. */
export const ITEM_STATUS_CLASSES: Record<RequisitionItemStatus, string> = {
  Pending: "status--pending",
  Sourcing: "status--sourcing",
  Shortlisted: "status--shortlisted",
  Interviewing: "status--interviewing",
  Offered: "status--offered",
  Fulfilled: "status--fulfilled",
  Cancelled: "status--cancelled",
};

// ============================================================================
// LEGACY NORMALIZATION
// ============================================================================

/**
 * Maps legacy/display status values to spec-compliant values.
 * Used to handle data from older database records.
 */
export const LEGACY_STATUS_MAP: Record<string, RequisitionStatus> = {
  "Pending Budget Approval": "Pending_Budget",
  "Pending HR Approval": "Pending_HR",
  "Approved & Unassigned": "Active",
  "In Progress": "Active",
  "In-Progress": "Active",
  Closed: "Fulfilled",
  "Closed (Partially Fulfilled)": "Fulfilled",
};

/**
 * Normalize any status string to a spec-compliant RequisitionStatus.
 * Handles both current and legacy values.
 */
export function normalizeStatus(status: string): RequisitionStatus {
  if (REQUISITION_STATUSES.includes(status as RequisitionStatus)) {
    return status as RequisitionStatus;
  }

  const mapped = LEGACY_STATUS_MAP[status];
  if (mapped) {
    return mapped;
  }

  // Fallback for truly unknown values — don't crash, surface in UI
  return status as RequisitionStatus;
}

/**
 * Get display label for a requisition status (handles legacy values).
 */
export function getStatusLabel(status: string): string {
  const normalized = normalizeStatus(status);
  return REQUISITION_STATUS_LABELS[normalized] ?? status;
}

/**
 * Get CSS class for a requisition status (handles legacy values).
 */
export function getStatusClass(status: string): string {
  const normalized = normalizeStatus(status);
  return REQUISITION_STATUS_CLASSES[normalized] ?? "status--unknown";
}

/**
 * Get display label for an item status.
 */
export function getItemStatusLabel(status: string): string {
  return ITEM_STATUS_LABELS[status as RequisitionItemStatus] ?? status;
}

/**
 * Get CSS class for an item status.
 */
export function getItemStatusClass(status: string): string {
  return (
    ITEM_STATUS_CLASSES[status as RequisitionItemStatus] ?? "status--unknown"
  );
}

// ============================================================================
// TYPE GUARDS
// ============================================================================

export function isRequisitionStatus(value: string): value is RequisitionStatus {
  return REQUISITION_STATUSES.includes(value as RequisitionStatus);
}

export function isItemStatus(value: string): value is RequisitionItemStatus {
  return ITEM_STATUSES.includes(value as RequisitionItemStatus);
}

export function isTerminalStatus(status: RequisitionStatus): boolean {
  return TERMINAL_REQUISITION_STATUSES.includes(status);
}
