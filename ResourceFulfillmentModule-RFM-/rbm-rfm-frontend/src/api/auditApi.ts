/**
 * ============================================================================
 * AUDIT API - Workflow Transition Audit Trail
 * ============================================================================
 *
 * This module provides read-only access to the workflow audit trail.
 * The backend's wf_transition_audit table is the SINGLE SOURCE OF TRUTH.
 *
 * Endpoints:
 *   GET /api/requisitions/{req_id}/audit
 *   GET /api/requisition-items/{item_id}/audit
 */

import { apiClient } from "./client";
import { getWorkflowErrorMessage } from "./workflowApi";

// ============================================================================
// TYPES
// ============================================================================

/**
 * User information embedded in audit records.
 */
export interface AuditPerformedBy {
  user_id: number;
  username: string;
  role: string;
}

/**
 * Single audit record from the wf_transition_audit table.
 * Source: backend wf_transition_audit schema
 */
export interface AuditRecord {
  id: number;
  entity_type: "Requisition" | "RequisitionItem";
  entity_id: number;
  from_status: string | null;
  to_status: string;
  action: string;
  performed_by: AuditPerformedBy;
  reason: string | null;
  version: number;
  created_at: string; // ISO timestamp
}

/**
 * Response from audit endpoints.
 */
export interface AuditResponse {
  entity_type: "Requisition" | "RequisitionItem";
  entity_id: number;
  audit_trail: AuditRecord[];
}

/**
 * Normalized error structure for audit API calls.
 */
export interface AuditError {
  code: "FETCH_ERROR" | "NOT_FOUND" | "FORBIDDEN" | "UNKNOWN";
  message: string;
  status?: number;
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * Normalize axios errors to AuditError structure.
 * Reuses workflowApi error message logic.
 */
export function normalizeAuditError(error: unknown): AuditError {
  const axiosError = error as {
    response?: { status?: number };
    message?: string;
  };

  const status = axiosError.response?.status;
  const message = getWorkflowErrorMessage(error);

  let code: AuditError["code"] = "UNKNOWN";

  if (status === 404) {
    code = "NOT_FOUND";
  } else if (status === 403) {
    code = "FORBIDDEN";
  } else if (status) {
    code = "FETCH_ERROR";
  }

  return { code, message, status };
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Get audit trail for a requisition.
 * Returns records sorted by created_at DESC (most recent first).
 *
 * @param reqId - Requisition ID
 * @returns Promise resolving to sorted audit records
 * @throws AuditError on failure
 */
export async function getRequisitionAudit(
  reqId: number,
): Promise<AuditRecord[]> {
  try {
    const response = await apiClient.get<AuditResponse>(
      `/requisitions/${reqId}/audit`,
    );

    const records = response.data.audit_trail ?? [];

    // Sort by created_at DESC (most recent first)
    return sortAuditRecords(records);
  } catch (error) {
    throw normalizeAuditError(error);
  }
}

/**
 * Get audit trail for a requisition item.
 * Returns records sorted by created_at DESC (most recent first).
 *
 * @param itemId - Requisition item ID
 * @returns Promise resolving to sorted audit records
 * @throws AuditError on failure
 */
export async function getItemAudit(itemId: number): Promise<AuditRecord[]> {
  try {
    const response = await apiClient.get<AuditResponse>(
      `/requisition-items/${itemId}/audit`,
    );

    const records = response.data.audit_trail ?? [];

    // Sort by created_at DESC (most recent first)
    return sortAuditRecords(records);
  } catch (error) {
    throw normalizeAuditError(error);
  }
}

// ============================================================================
// UTILITIES
// ============================================================================

/**
 * Sort audit records by created_at in descending order (newest first).
 */
function sortAuditRecords(records: AuditRecord[]): AuditRecord[] {
  return [...records].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

/**
 * Format timestamp for display.
 * Returns human-readable format: "Feb 6, 2026 at 2:30 PM"
 */
export function formatAuditTimestamp(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);

  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Format timestamp as relative time (e.g., "2 hours ago").
 */
export function formatRelativeAuditTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return formatAuditTimestamp(isoTimestamp);
}

/**
 * Action type classification for icon/color mapping.
 * Phase 6 compliant - supports all timeline event types:
 * - Creation, Budget edits, Budget clearance, HR approval
 * - Assignments, Shortlists, Interviews, Rejections
 * - Reassignments, Fulfillment, Cancellations
 */
export type AuditActionType =
  | "approve"
  | "reject"
  | "cancel"
  | "reopen"
  | "submit"
  | "create"
  | "fulfill"
  | "assign"
  | "reassign"
  | "update"
  | "shortlist"
  | "interview"
  | "offer"
  | "budget"
  | "unknown";

/**
 * Classify an action string into a known action type.
 * Used for icon and color selection.
 * Phase 6: Supports all timeline event types.
 */
export function classifyAction(action: string): AuditActionType {
  const normalized = action.toLowerCase();

  // Phase 6: Budget-related actions
  if (
    normalized.includes("budget") ||
    normalized.includes("financial")
  ) {
    if (normalized.includes("approve") || normalized.includes("clear")) {
      return "approve";
    }
    return "budget";
  }

  // Phase 6: Item workflow actions
  if (normalized.includes("shortlist")) {
    return "shortlist";
  }
  if (normalized.includes("interview")) {
    return "interview";
  }
  if (normalized.includes("offer")) {
    return "offer";
  }

  // Phase 6: Reassignment
  if (normalized.includes("reassign") || normalized.includes("swap") || normalized.includes("transfer")) {
    return "reassign";
  }

  // Standard workflow actions
  if (normalized.includes("approve") || normalized.includes("accept")) {
    return "approve";
  }
  if (normalized.includes("reject")) {
    return "reject";
  }
  if (normalized.includes("cancel")) {
    return "cancel";
  }
  if (normalized.includes("reopen") || normalized.includes("re-open")) {
    return "reopen";
  }
  if (normalized.includes("submit")) {
    return "submit";
  }
  if (normalized.includes("create")) {
    return "create";
  }
  if (normalized.includes("fulfill") || normalized.includes("complete")) {
    return "fulfill";
  }
  if (normalized.includes("assign")) {
    return "assign";
  }
  if (normalized.includes("update") || normalized.includes("edit")) {
    return "update";
  }

  return "unknown";
}

/**
 * Get CSS class for audit action type.
 * Phase 6: Supports all timeline event styling.
 */
export function getActionClass(action: string): string {
  const type = classifyAction(action);

  const classMap: Record<AuditActionType, string> = {
    approve: "audit-action--approved",
    reject: "audit-action--rejected",
    cancel: "audit-action--cancelled",
    reopen: "audit-action--reopened",
    submit: "audit-action--submitted",
    create: "audit-action--created",
    fulfill: "audit-action--fulfilled",
    assign: "audit-action--assigned",
    reassign: "audit-action--reassigned",
    update: "audit-action--updated",
    shortlist: "audit-action--shortlisted",
    interview: "audit-action--interviewing",
    offer: "audit-action--offered",
    budget: "audit-action--budget",
    unknown: "audit-action--unknown",
  };

  return classMap[type];
}

/**
 * Get CSS class for status badge.
 */
export function getStatusBadgeClass(status: string): string {
  const normalized = status.toLowerCase().replace(/[_\s]/g, "-");

  // Map to semantic classes
  if (
    normalized.includes("approved") ||
    normalized.includes("active") ||
    normalized.includes("fulfilled")
  ) {
    return "status--approved";
  }
  if (normalized.includes("rejected")) {
    return "status--rejected";
  }
  if (normalized.includes("cancelled") || normalized.includes("canceled")) {
    return "status--cancelled";
  }
  if (normalized.includes("pending")) {
    return "status--pending";
  }
  if (normalized.includes("draft")) {
    return "status--draft";
  }

  return "status--default";
}
