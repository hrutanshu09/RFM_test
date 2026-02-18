/**
 * ============================================================================
 * WORKFLOW API - Backend-Driven Workflow Integration
 * ============================================================================
 *
 * This module integrates with the backend workflow engine (V2).
 * The backend is the SINGLE SOURCE OF TRUTH for:
 *   - Allowed transitions
 *   - Role authorization
 *   - Status validation
 *
 * Frontend NEVER decides if a transition is allowed - it only renders
 * what the backend permits.
 */

import { apiClient } from "./client";

// ============================================================================
// BACKEND RESPONSE TYPES (match backend schemas exactly)
// ============================================================================

/**
 * Information about a single allowed transition from the backend.
 * Source: backend/api/workflow_routes.py - TransitionInfo
 */
export interface TransitionInfo {
  target_status: string;
  authorized_roles: string[];
  requires_reason: boolean;
  is_system_only: boolean;
  description?: string;
}

/**
 * Response from GET /allowed-transitions endpoints.
 * Source: backend/api/workflow_routes.py - AllowedTransitionsResponse
 */
export interface AllowedTransitionsResponse {
  entity_type: "requisition" | "requisition_item";
  entity_id: number;
  current_status: string;
  is_terminal: boolean;
  allowed_transitions: TransitionInfo[];
}

/**
 * Response from POST workflow transition endpoints.
 * Source: backend/api/workflow_routes.py - WorkflowTransitionResponse
 */
export interface WorkflowTransitionResponse {
  success: boolean;
  entity_id: number;
  entity_type: string;
  previous_status: string;
  new_status: string;
  transitioned_at: string;
  transitioned_by: number;
}

/**
 * Error response from workflow endpoints.
 * Source: backend/api/workflow_routes.py - WorkflowErrorResponse
 */
export interface WorkflowErrorResponse {
  error: boolean;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ============================================================================
// STATUS TYPES & CONSTANTS
// Re-exported from canonical source: src/types/workflow.ts
// ============================================================================

export type {
  RequisitionStatus,
  RequisitionItemStatus,
  TransitionAction,
} from "../types/workflow";

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
} from "../types/workflow";

// ============================================================================
// REQUISITION WORKFLOW API
// ============================================================================

/**
 * Get allowed transitions for a requisition from the backend.
 * This is the ONLY source of truth for what transitions are allowed.
 */
export async function getRequisitionAllowedTransitions(
  reqId: number,
): Promise<AllowedTransitionsResponse> {
  const response = await apiClient.get<AllowedTransitionsResponse>(
    `/requisitions/${reqId}/workflow/allowed-transitions`,
  );
  return response.data;
}

/**
 * Submit a requisition for budget approval.
 * Transition: Draft → Pending_Budget
 */
export async function submitRequisition(
  reqId: number,
  expectedVersion?: number,
): Promise<WorkflowTransitionResponse> {
  const response = await apiClient.post<WorkflowTransitionResponse>(
    `/requisitions/${reqId}/workflow/submit`,
    { expected_version: expectedVersion },
  );
  return response.data;
}

/**
 * Approve budget for a requisition.
 * Transition: Pending_Budget → Pending_HR
 */
export async function approveBudget(
  reqId: number,
  expectedVersion?: number,
): Promise<WorkflowTransitionResponse> {
  const response = await apiClient.post<WorkflowTransitionResponse>(
    `/requisitions/${reqId}/workflow/approve-budget`,
    { expected_version: expectedVersion },
  );
  return response.data;
}

/**
 * HR approval for a requisition.
 * Transition: Pending_HR → Active
 */
export async function approveHR(
  reqId: number,
  expectedVersion?: number,
): Promise<WorkflowTransitionResponse> {
  const response = await apiClient.post<WorkflowTransitionResponse>(
    `/requisitions/${reqId}/workflow/approve-hr`,
    { expected_version: expectedVersion },
  );
  return response.data;
}

/**
 * Reject a requisition.
 * Transition: Pending_Budget/Pending_HR → Rejected
 */
export async function rejectRequisition(
  reqId: number,
  reason: string,
  expectedVersion?: number,
): Promise<WorkflowTransitionResponse> {
  const response = await apiClient.post<WorkflowTransitionResponse>(
    `/requisitions/${reqId}/workflow/reject`,
    { reason, expected_version: expectedVersion },
  );
  return response.data;
}

/**
 * Cancel a requisition.
 * Transition: Draft/Pending_Budget/Pending_HR/Active → Cancelled
 */
export async function cancelRequisition(
  reqId: number,
  reason: string,
  expectedVersion?: number,
): Promise<WorkflowTransitionResponse> {
  const response = await apiClient.post<WorkflowTransitionResponse>(
    `/requisitions/${reqId}/workflow/cancel`,
    { reason, expected_version: expectedVersion },
  );
  return response.data;
}

/**
 * Reopen a rejected requisition for revision.
 * Transition: Rejected → Draft
 */
export async function reopenRequisition(
  reqId: number,
  expectedVersion?: number,
): Promise<WorkflowTransitionResponse> {
  const response = await apiClient.post<WorkflowTransitionResponse>(
    `/requisitions/${reqId}/workflow/reopen`,
    { expected_version: expectedVersion },
  );
  return response.data;
}

/**
 * Assign a TA to a requisition header (self-assign or HR-assign).
 * Also propagates assignment to unassigned non-terminal items.
 * Pending items auto-transition to Sourcing via item workflow rules.
 * Requisition must be in Active status.
 */
export async function assignRequisitionTA(
  reqId: number,
  taUserId: number,
): Promise<{ message: string; assigned_ta: number }> {
  const response = await apiClient.patch<{
    message: string;
    assigned_ta: number;
  }>(`/requisitions/${reqId}/assign-ta`, { ta_user_id: taUserId });
  return response.data;
}

// ============================================================================
// REQUISITION ITEM WORKFLOW API
// ============================================================================

/**
 * Get allowed transitions for a requisition item from the backend.
 */
export async function getItemAllowedTransitions(
  itemId: number,
): Promise<AllowedTransitionsResponse> {
  const response = await apiClient.get<AllowedTransitionsResponse>(
    `/requisition-items/${itemId}/workflow/allowed-transitions`,
  );
  return response.data;
}

/**
 * Assign a TA to a requisition item.
 * Auto-transition: Pending → Sourcing
 */
export async function assignTA(
  itemId: number,
  taUserId: number,
): Promise<WorkflowTransitionResponse> {
  const response = await apiClient.post<WorkflowTransitionResponse>(
    `/requisition-items/${itemId}/workflow/assign-ta`,
    { ta_user_id: taUserId },
  );
  return response.data;
}

/**
 * Move item to shortlisted status.
 * Transition: Sourcing → Shortlisted
 */
export async function shortlistItem(
  itemId: number,
  candidateCount?: number,
): Promise<WorkflowTransitionResponse> {
  const response = await apiClient.post<WorkflowTransitionResponse>(
    `/requisition-items/${itemId}/workflow/shortlist`,
    { candidate_count: candidateCount },
  );
  return response.data;
}

/**
 * Start interviewing for an item.
 * Transition: Shortlisted → Interviewing
 */
export async function startInterview(
  itemId: number,
): Promise<WorkflowTransitionResponse> {
  const response = await apiClient.post<WorkflowTransitionResponse>(
    `/requisition-items/${itemId}/workflow/start-interview`,
    {},
  );
  return response.data;
}

/**
 * Extend an offer for an item.
 * Transition: Interviewing → Offer_Extended
 */
export async function makeOffer(
  itemId: number,
  candidateId?: string,
  offerDetails?: Record<string, unknown>,
): Promise<WorkflowTransitionResponse> {
  const response = await apiClient.post<WorkflowTransitionResponse>(
    `/requisition-items/${itemId}/workflow/make-offer`,
    { candidate_id: candidateId, offer_details: offerDetails },
  );
  return response.data;
}

/**
 * Fulfill an item with an employee assignment.
 * Transition: Offer_Extended → Fulfilled
 */
export async function fulfillItem(
  itemId: number,
  employeeId: string,
): Promise<WorkflowTransitionResponse> {
  const response = await apiClient.post<WorkflowTransitionResponse>(
    `/requisition-items/${itemId}/workflow/fulfill`,
    { employee_id: employeeId },
  );
  return response.data;
}

/**
 * Cancel a requisition item.
 * Transition: Any non-terminal → Cancelled
 */
export async function cancelItem(
  itemId: number,
  reason: string,
): Promise<WorkflowTransitionResponse> {
  const response = await apiClient.post<WorkflowTransitionResponse>(
    `/requisition-items/${itemId}/workflow/cancel`,
    { reason },
  );
  return response.data;
}

// ============================================================================
// ITEM BUDGET WORKFLOW API
// ============================================================================

import type {
  ItemBudgetEditRequest,
  ItemBudgetRejectRequest,
  ItemBudgetResponse,
} from "../types/workflow";

export type {
  ItemBudgetEditRequest,
  ItemBudgetRejectRequest,
  ItemBudgetResponse,
};

/**
 * Edit the estimated budget for an item.
 * Can only be done when header is in DRAFT or PENDING_BUDGET.
 * Cannot be done after budget has been approved.
 */
export async function editItemBudget(
  itemId: number,
  request: ItemBudgetEditRequest,
): Promise<ItemBudgetResponse> {
  const response = await apiClient.post<ItemBudgetResponse>(
    `/requisition-items/${itemId}/workflow/edit-budget`,
    request,
  );
  return response.data;
}

/**
 * Request body for approving item budget.
 * If approved_budget is provided, that amount is set as approved (estimated stays unchanged).
 * If omitted, approved_budget = estimated_budget.
 */
export interface ItemBudgetApproveRequest {
  approved_budget?: number;
}

/**
 * Approve budget for an item.
 * Optional body: { approved_budget?: number }. If provided, that amount is approved (estimated unchanged).
 * If omitted, approved_budget = estimated_budget.
 * Can only be done when header is in PENDING_BUDGET.
 * After all items are approved, header automatically transitions to PENDING_HR.
 */
export async function approveItemBudget(
  itemId: number,
  body: ItemBudgetApproveRequest = {},
): Promise<ItemBudgetResponse> {
  const response = await apiClient.post<ItemBudgetResponse>(
    `/requisition-items/${itemId}/workflow/approve-budget`,
    body,
  );
  return response.data;
}

/**
 * Reject budget for an item.
 * Clears approved_budget. Manager must revise estimated_budget.
 * Requires reason (min 10 characters).
 */
export async function rejectItemBudget(
  itemId: number,
  request: ItemBudgetRejectRequest,
): Promise<ItemBudgetResponse> {
  const response = await apiClient.post<ItemBudgetResponse>(
    `/requisition-items/${itemId}/workflow/reject-budget`,
    request,
  );
  return response.data;
}

// ============================================================================
// TA REASSIGNMENT API (Phase 7)
// ============================================================================

/**
 * Item-level reassignment response.
 */
export interface ReassignItemResponse {
  success: boolean;
  item_id: number;
  role_position: string;
  old_ta_id: number | null;
  new_ta_id: number;
}

/**
 * Reassign the TA for a single requisition item.
 * Endpoint: POST /requisition-items/{itemId}/reassign
 * Authorized: HR, Admin
 */
export async function reassignItemTA(
  itemId: number,
  newTaId: number,
  reason: string,
): Promise<ReassignItemResponse> {
  const response = await apiClient.post<ReassignItemResponse>(
    `/requisition-items/${itemId}/reassign`,
    { new_ta_id: newTaId, reason },
  );
  return response.data;
}

/**
 * Response type for bulk reassignment.
 */
export interface BulkReassignItemResult {
  item_id: number;
  role_position: string;
  old_ta_id: number | null;
  new_ta_id: number;
}

export interface BulkReassignResponse {
  success: boolean;
  reassigned_count: number;
  req_id: number;
  items: BulkReassignItemResult[];
}

export interface BulkReassignRequest {
  old_ta_id: number;
  new_ta_id: number;
  reason: string;
  item_ids?: number[];
}

/**
 * Bulk reassign items from one TA to another within a requisition.
 * Atomic server-side transaction — all items or none.
 * Endpoint: POST /requisitions/{reqId}/bulk-reassign
 * Authorized: HR, Admin
 */
export async function bulkReassignTA(
  reqId: number,
  payload: BulkReassignRequest,
): Promise<BulkReassignResponse> {
  const response = await apiClient.post<BulkReassignResponse>(
    `/requisitions/${reqId}/bulk-reassign`,
    payload,
  );
  return response.data;
}

// ============================================================================
// ERROR HANDLING UTILITIES
// ============================================================================

/**
 * Error codes from the backend workflow engine.
 */
export const WORKFLOW_ERROR_CODES = {
  INVALID_TRANSITION: "INVALID_TRANSITION",
  TERMINAL_STATE: "TERMINAL_STATE",
  AUTHORIZATION_DENIED: "AUTHORIZATION_DENIED",
  CONCURRENCY_CONFLICT: "CONCURRENCY_CONFLICT",
  ENTITY_LOCKED: "ENTITY_LOCKED",
  VALIDATION_FAILED: "VALIDATION_FAILED",
  PREREQUISITE_NOT_MET: "PREREQUISITE_NOT_MET",
  ENTITY_NOT_FOUND: "ENTITY_NOT_FOUND",
  SYSTEM_ONLY: "SYSTEM_ONLY",
  REASON_REQUIRED: "REASON_REQUIRED",
} as const;

export type WorkflowErrorCode =
  (typeof WORKFLOW_ERROR_CODES)[keyof typeof WORKFLOW_ERROR_CODES];

/**
 * Check if an error is a workflow error with a specific code.
 */
export function isWorkflowError(
  error: unknown,
  code?: WorkflowErrorCode,
): boolean {
  if (!error || typeof error !== "object") return false;

  // Axios error structure
  const axiosError = error as {
    response?: { data?: WorkflowErrorResponse };
  };

  const errorData = axiosError.response?.data;
  if (!errorData?.error) return false;

  if (code) {
    return errorData.code === code;
  }

  return true;
}

/**
 * Get user-friendly error message for workflow errors.
 */
export function getWorkflowErrorMessage(error: unknown): string {
  const axiosError = error as {
    response?: { data?: WorkflowErrorResponse; status?: number };
    message?: string;
  };

  const status = axiosError.response?.status;
  const errorData = axiosError.response?.data;

  // Handle specific HTTP status codes
  if (status === 409) {
    return "This record has been modified. Please refresh and try again.";
  }

  if (status === 403) {
    return "You are not authorized to perform this action.";
  }

  if (status === 404) {
    return "The requested record was not found.";
  }

  // Use backend error message if available
  if (errorData?.message) {
    return errorData.message;
  }

  // Fallback
  return axiosError.message ?? "An unexpected error occurred.";
}
