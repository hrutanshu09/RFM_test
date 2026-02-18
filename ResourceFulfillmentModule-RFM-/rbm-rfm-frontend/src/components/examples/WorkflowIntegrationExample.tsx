// @ts-nocheck
// NOTE: This example file uses legacy status values for illustration purposes.
// The actual implementation has been updated to use the new Workflow Engine V2 status values.
// See src/types/workflow.ts for the canonical status definitions.

/**
 * ============================================================================
 * WORKFLOW INTEGRATION EXAMPLE - Requisition Approval
 * ============================================================================
 *
 * This file demonstrates how to integrate the workflow engine into
 * React components. It shows the recommended patterns for:
 *
 * 1. Validating transitions before showing UI
 * 2. Disabling buttons when transitions are invalid
 * 3. Showing validation errors to users
 * 4. Executing transitions with API calls
 * 5. Handling multi-step flows (like rejection with reason)
 */

import React, { useState, useMemo } from "react";
import {
  requisitionWorkflow,
  validateRequisitionTransition,
  getRequisitionNextStatuses,
  RequisitionStatus,
  RequisitionContext,
  TransitionResult,
  useWorkflowTransition,
} from "../../lib/workflow";

// ============================================================================
// Types
// ============================================================================

interface Requisition {
  id: number;
  title: string;
  status: RequisitionStatus;
  department: string;
  requestedCount: number;
}

interface RequisitionApprovalProps {
  requisition: Requisition;
  userRole: RequisitionContext["userRole"];
  onStatusChange: (newStatus: RequisitionStatus) => void;
}

// ============================================================================
// Example 1: Basic Validation Pattern
// ============================================================================

/**
 * Simple component showing basic workflow validation.
 * Good for simple cases where you just need to enable/disable buttons.
 */
export function BasicApprovalButtons({
  requisition,
  userRole,
  onStatusChange,
}: RequisitionApprovalProps) {
  const currentStatus = requisition.status;

  // Build context for validation
  const context: RequisitionContext = {
    userRole,
    requisitionId: requisition.id,
  };

  // Check which transitions are allowed
  const canApprove = validateRequisitionTransition(
    currentStatus,
    "Approved & Unassigned",
    context,
  ).allowed;

  const canReject = validateRequisitionTransition(
    currentStatus,
    "Rejected",
    { ...context, rejectionReason: "placeholder" }, // Need reason for reject
  ).allowed;

  return (
    <div className="approval-buttons">
      <button
        className="action-button primary"
        disabled={!canApprove}
        onClick={() => onStatusChange("Approved & Unassigned")}
        title={!canApprove ? "Cannot approve in current state" : ""}
      >
        Approve
      </button>
      <button
        className="action-button danger"
        disabled={!canReject}
        onClick={() => {
          /* Would open rejection modal */
        }}
        title={!canReject ? "Cannot reject in current state" : ""}
      >
        Reject
      </button>
    </div>
  );
}

// ============================================================================
// Example 2: With Hook Pattern (Recommended)
// ============================================================================

/**
 * Component using the useWorkflowTransition hook.
 * Recommended for complex workflows with async operations.
 */
export function HookBasedApproval({
  requisition,
  userRole,
  onStatusChange,
}: RequisitionApprovalProps) {
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);

  // Use the workflow hook
  const {
    currentStatus,
    validationResult,
    isTransitioning,
    apiError,
    canTransitionTo,
    validateTransition,
    executeTransition,
    getAvailableTransitions,
    clearError,
  } = useWorkflowTransition(requisitionWorkflow, requisition.status);

  // Build context
  const baseContext: RequisitionContext = {
    userRole,
    requisitionId: requisition.id,
  };

  // Handle approve action
  const handleApprove = async () => {
    const success = await executeTransition(
      "Approved & Unassigned",
      baseContext,
      async () => {
        // Your API call here
        // await apiClient.put(`/api/requisitions/${requisition.id}/approve`);
        console.log("API: Approve requisition", requisition.id);
      },
    );

    if (success) {
      onStatusChange("Approved & Unassigned");
    }
  };

  // Handle reject action
  const handleReject = async () => {
    const context: RequisitionContext = {
      ...baseContext,
      rejectionReason,
    };

    // Validate first
    const result = validateTransition("Rejected", context);
    if (!result.allowed) {
      return; // Error will be shown via validationResult
    }

    const success = await executeTransition("Rejected", context, async () => {
      // Your API call here
      // await apiClient.put(`/api/requisitions/${requisition.id}/reject`, { reason: rejectionReason });
      console.log("API: Reject requisition", requisition.id, rejectionReason);
    });

    if (success) {
      setShowRejectModal(false);
      setRejectionReason("");
      onStatusChange("Rejected");
    }
  };

  // Check what actions are available
  const availableStatuses = getAvailableTransitions();

  return (
    <div className="approval-section">
      {/* Status info */}
      <div className="current-status">
        <strong>Current Status:</strong> {currentStatus}
      </div>

      {/* Available transitions info */}
      <div className="available-transitions">
        <strong>Can transition to:</strong>{" "}
        {availableStatuses.length > 0
          ? availableStatuses.join(", ")
          : "No transitions available"}
      </div>

      {/* Error display */}
      {(validationResult?.error || apiError) && (
        <div className="error-message">
          {validationResult?.error || apiError}
          <button onClick={clearError}>×</button>
        </div>
      )}

      {/* Action buttons */}
      <div className="approval-buttons">
        <button
          className="action-button primary"
          disabled={
            !canTransitionTo("Approved & Unassigned") || isTransitioning
          }
          onClick={handleApprove}
        >
          {isTransitioning ? "Processing..." : "Approve"}
        </button>

        <button
          className="action-button danger"
          disabled={!canTransitionTo("Rejected") || isTransitioning}
          onClick={() => setShowRejectModal(true)}
        >
          Reject
        </button>
      </div>

      {/* Rejection Modal */}
      {showRejectModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Reject Requisition</h3>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="Enter rejection reason (minimum 10 characters)"
              rows={4}
            />

            {/* Real-time validation feedback */}
            {rejectionReason.length > 0 && rejectionReason.length < 10 && (
              <div className="validation-hint">
                {10 - rejectionReason.length} more characters required
              </div>
            )}

            <div className="modal-actions">
              <button
                className="action-button danger"
                disabled={rejectionReason.length < 10 || isTransitioning}
                onClick={handleReject}
              >
                Confirm Rejection
              </button>
              <button
                className="action-button secondary"
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectionReason("");
                  clearError();
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Example 3: Dynamic Action Buttons
// ============================================================================

/**
 * Dynamically generate action buttons based on workflow state.
 * Useful when actions change based on status.
 */
export function DynamicActionButtons({
  requisition,
  userRole,
}: RequisitionApprovalProps & { onAction: (action: string) => void }) {
  const currentStatus = requisition.status;

  // Define all possible actions
  const allActions = useMemo(
    () => [
      {
        targetStatus: "Pending HR Approval" as RequisitionStatus,
        label: "Approve Budget",
        variant: "primary" as const,
        roles: ["budget_manager", "admin"],
      },
      {
        targetStatus: "Approved & Unassigned" as RequisitionStatus,
        label: "Approve",
        variant: "primary" as const,
        roles: ["hr", "admin"],
      },
      {
        targetStatus: "Rejected" as RequisitionStatus,
        label: "Reject",
        variant: "danger" as const,
        roles: ["hr", "budget_manager", "admin"],
      },
      {
        targetStatus: "Pending Budget Approval" as RequisitionStatus,
        label: "Return to Budget",
        variant: "secondary" as const,
        roles: ["hr", "admin"],
      },
      {
        targetStatus: "Draft" as RequisitionStatus,
        label: "Return to Requester",
        variant: "secondary" as const,
        roles: ["budget_manager", "admin"],
      },
    ],
    [],
  );

  // Filter to only valid actions
  const validActions = useMemo(() => {
    return allActions.filter((action) => {
      // Check role permission
      if (!action.roles.includes(userRole || "")) {
        return false;
      }

      // Check workflow allows transition
      const result = validateRequisitionTransition(
        currentStatus,
        action.targetStatus,
        { userRole },
      );

      // For reject, we need to check without reason requirement
      if (action.targetStatus === "Rejected") {
        return requisitionWorkflow.canTransition(
          currentStatus,
          action.targetStatus,
        );
      }

      return result.allowed;
    });
  }, [allActions, currentStatus, userRole]);

  if (validActions.length === 0) {
    return <div className="no-actions">No actions available</div>;
  }

  return (
    <div className="dynamic-actions">
      {validActions.map((action) => (
        <button
          key={action.targetStatus}
          className={`action-button ${action.variant}`}
          onClick={() => {
            /* Handle action */
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

// ============================================================================
// Example 4: Status Change Dropdown
// ============================================================================

/**
 * Dropdown showing only valid target statuses.
 * Useful for admin/debug interfaces.
 */
export function StatusChangeDropdown({
  requisition,
  userRole,
  onStatusChange,
}: RequisitionApprovalProps) {
  const [selectedStatus, setSelectedStatus] = useState<RequisitionStatus | "">(
    "",
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const currentStatus = requisition.status;
  const availableStatuses = getRequisitionNextStatuses(currentStatus);

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value as RequisitionStatus;
    setSelectedStatus(newStatus);

    if (newStatus) {
      const result = validateRequisitionTransition(currentStatus, newStatus, {
        userRole,
      });
      setValidationError(result.error || null);
    } else {
      setValidationError(null);
    }
  };

  const handleSubmit = () => {
    if (!selectedStatus) return;

    const result = validateRequisitionTransition(
      currentStatus,
      selectedStatus,
      {
        userRole,
      },
    );

    if (result.allowed) {
      onStatusChange(selectedStatus);
      setSelectedStatus("");
    } else {
      setValidationError(result.error || "Transition not allowed");
    }
  };

  return (
    <div className="status-dropdown">
      <select value={selectedStatus} onChange={handleChange}>
        <option value="">Select new status...</option>
        {availableStatuses.map((status) => (
          <option key={status} value={status}>
            {status}
          </option>
        ))}
      </select>

      {validationError && (
        <div className="validation-error">{validationError}</div>
      )}

      <button
        className="action-button primary"
        disabled={!selectedStatus || !!validationError}
        onClick={handleSubmit}
      >
        Change Status
      </button>
    </div>
  );
}

// ============================================================================
// Example 5: Workflow Indicator Component
// ============================================================================

/**
 * Visual workflow indicator showing current position and possible paths.
 */
export function WorkflowIndicator({
  requisition,
}: {
  requisition: Requisition;
}) {
  const allStatuses: RequisitionStatus[] = [
    "Draft",
    "Pending Budget Approval",
    "Pending HR Approval",
    "Approved & Unassigned",
    "Active",
    "Closed",
  ];

  const currentIndex = allStatuses.indexOf(requisition.status);
  const isRejected = requisition.status === "Rejected";
  const isCancelled = requisition.status === "Cancelled";

  if (isRejected || isCancelled) {
    return (
      <div className="workflow-indicator terminal">
        <span
          className={`status-badge ${isRejected ? "rejected" : "cancelled"}`}
        >
          {requisition.status}
        </span>
      </div>
    );
  }

  return (
    <div className="workflow-indicator">
      {allStatuses.map((status, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;
        const isPending = index > currentIndex;

        return (
          <React.Fragment key={status}>
            <div
              className={`workflow-step ${
                isCompleted ? "completed" : isCurrent ? "current" : "pending"
              }`}
            >
              <div className="step-dot" />
              <span className="step-label">{status}</span>
            </div>
            {index < allStatuses.length - 1 && (
              <div
                className={`workflow-connector ${isCompleted ? "completed" : ""}`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}
