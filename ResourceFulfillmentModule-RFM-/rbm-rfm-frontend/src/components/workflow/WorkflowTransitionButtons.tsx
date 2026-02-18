/**
 * ============================================================================
 * WORKFLOW TRANSITION BUTTONS - Dynamic Backend-Driven UI
 * ============================================================================
 *
 * This component renders transition buttons based on what the backend allows.
 * No hardcoded workflow logic - purely driven by API response.
 */

import React, { useState } from "react";
import {
  Check,
  X,
  Send,
  RotateCcw,
  AlertTriangle,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { TransitionInfo } from "../../api/workflowApi";
import { WorkflowState } from "../../api/workflowHooks";

// ============================================================================
// TYPES
// ============================================================================

export interface TransitionButtonConfig {
  /** Target status value */
  targetStatus: string;
  /** Display label (optional - defaults to target_status) */
  label?: string;
  /** Icon component */
  icon?: React.ReactNode;
  /** Button variant */
  variant?: "primary" | "secondary" | "danger" | "success";
  /** Requires confirmation dialog */
  requiresConfirmation?: boolean;
  /** Custom class name */
  className?: string;
}

export interface WorkflowTransitionButtonsProps {
  /** Workflow state from useRequisitionWorkflow or useItemWorkflow */
  workflowState: WorkflowState;
  /** Button configurations - defines which transitions to show and how */
  buttonConfigs: TransitionButtonConfig[];
  /** Handler for executing transitions */
  onTransition: (targetStatus: string, reason?: string) => Promise<void>;
  /** Additional class name for container */
  className?: string;
  /** Whether to show as dropdown menu */
  asDropdown?: boolean;
  /** Size variant */
  size?: "sm" | "md" | "lg";
}

// ============================================================================
// BUTTON STYLE MAPPING
// ============================================================================

const VARIANT_CLASSES: Record<string, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  danger: "btn-danger",
  success: "btn-success",
};

const SIZE_CLASSES: Record<string, string> = {
  sm: "btn-sm",
  md: "",
  lg: "btn-lg",
};

// Default button configs for common transitions
export const DEFAULT_REQUISITION_BUTTON_CONFIGS: TransitionButtonConfig[] = [
  {
    targetStatus: "Pending_Budget",
    label: "Submit for Approval",
    icon: <Send size={16} />,
    variant: "primary",
  },
  {
    targetStatus: "Pending_HR",
    label: "Approve Budget",
    icon: <Check size={16} />,
    variant: "success",
  },
  {
    targetStatus: "Active",
    label: "Approve (HR)",
    icon: <Check size={16} />,
    variant: "success",
  },
  {
    targetStatus: "Rejected",
    label: "Reject",
    icon: <X size={16} />,
    variant: "danger",
    requiresConfirmation: true,
  },
  {
    targetStatus: "Cancelled",
    label: "Cancel",
    icon: <X size={16} />,
    variant: "danger",
    requiresConfirmation: true,
  },
  {
    targetStatus: "Draft",
    label: "Reopen for Revision",
    icon: <RotateCcw size={16} />,
    variant: "secondary",
  },
];

export const DEFAULT_ITEM_BUTTON_CONFIGS: TransitionButtonConfig[] = [
  {
    targetStatus: "Sourcing",
    label: "Start Sourcing",
    icon: <Send size={16} />,
    variant: "primary",
  },
  {
    targetStatus: "Shortlisted",
    label: "Shortlist",
    icon: <Check size={16} />,
    variant: "primary",
  },
  {
    targetStatus: "Interviewing",
    label: "Start Interviews",
    icon: <Send size={16} />,
    variant: "primary",
  },
  {
    targetStatus: "Offered",
    label: "Extend Offer",
    icon: <Send size={16} />,
    variant: "primary",
  },
  {
    targetStatus: "Fulfilled",
    label: "Mark Fulfilled",
    icon: <Check size={16} />,
    variant: "success",
  },
  {
    targetStatus: "Cancelled",
    label: "Cancel",
    icon: <X size={16} />,
    variant: "danger",
    requiresConfirmation: true,
  },
];

// ============================================================================
// REASON INPUT MODAL
// ============================================================================

interface ReasonModalProps {
  isOpen: boolean;
  title: string;
  description: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

const ReasonModal: React.FC<ReasonModalProps> = ({
  isOpen,
  title,
  description,
  onConfirm,
  onCancel,
  isLoading,
}) => {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (reason.trim().length < 10) {
      setError("Please provide a reason (at least 10 characters)");
      return;
    }
    setError(null);
    onConfirm(reason.trim());
  };

  const handleCancel = () => {
    setReason("");
    setError(null);
    onCancel();
  };

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
        </div>
        <div className="modal-body">
          <p className="text-sm text-muted mb-3">{description}</p>
          <textarea
            className="form-input w-full"
            rows={4}
            placeholder="Enter reason (minimum 10 characters)..."
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              if (error && e.target.value.trim().length >= 10) {
                setError(null);
              }
            }}
            disabled={isLoading}
            autoFocus
          />
          {error && (
            <p className="text-sm text-error mt-2">
              <AlertTriangle size={14} className="inline mr-1" />
              {error}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button
            className="btn btn-secondary"
            onClick={handleCancel}
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            className="btn btn-danger"
            onClick={handleSubmit}
            disabled={isLoading || reason.trim().length < 10}
          >
            {isLoading ? (
              <>
                <Loader2 size={16} className="animate-spin mr-1" />
                Processing...
              </>
            ) : (
              "Confirm"
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const WorkflowTransitionButtons: React.FC<
  WorkflowTransitionButtonsProps
> = ({
  workflowState,
  buttonConfigs,
  onTransition,
  className = "",
  asDropdown = false,
  size = "md",
}) => {
  const [reasonModal, setReasonModal] = useState<{
    isOpen: boolean;
    targetStatus: string;
    title: string;
  } | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const { allowedTransitions, isTransitioning, isTerminal } = workflowState;

  // Filter buttons to only show those allowed by backend
  const visibleButtons = buttonConfigs.filter((config) =>
    allowedTransitions.some(
      (t) => t.target_status === config.targetStatus && !t.is_system_only,
    ),
  );

  // No buttons to show
  if (visibleButtons.length === 0) {
    if (isTerminal) {
      return (
        <div className={`workflow-terminal-state ${className}`}>
          <span className="text-muted text-sm">
            No further actions available
          </span>
        </div>
      );
    }
    return null;
  }

  const handleButtonClick = (config: TransitionButtonConfig) => {
    const transitionInfo = allowedTransitions.find(
      (t) => t.target_status === config.targetStatus,
    );

    // If requires reason, show modal
    if (transitionInfo?.requires_reason || config.requiresConfirmation) {
      setReasonModal({
        isOpen: true,
        targetStatus: config.targetStatus,
        title: config.label || `Confirm ${config.targetStatus}`,
      });
      setDropdownOpen(false);
      return;
    }

    // Execute directly
    onTransition(config.targetStatus);
    setDropdownOpen(false);
  };

  const handleReasonConfirm = (reason: string) => {
    if (reasonModal) {
      onTransition(reasonModal.targetStatus, reason);
      setReasonModal(null);
    }
  };

  // Render as dropdown
  if (asDropdown && visibleButtons.length > 1) {
    return (
      <div className={`workflow-dropdown ${className}`}>
        <button
          className={`btn btn-primary ${SIZE_CLASSES[size]}`}
          onClick={() => setDropdownOpen(!dropdownOpen)}
          disabled={isTransitioning}
        >
          {isTransitioning ? (
            <Loader2 size={16} className="animate-spin mr-1" />
          ) : (
            "Actions"
          )}
          <ChevronDown size={16} className="ml-1" />
        </button>

        {dropdownOpen && (
          <div className="dropdown-menu">
            {visibleButtons.map((config) => (
              <button
                key={config.targetStatus}
                className={`dropdown-item ${config.variant === "danger" ? "text-error" : ""}`}
                onClick={() => handleButtonClick(config)}
                disabled={isTransitioning}
              >
                {config.icon && <span className="mr-2">{config.icon}</span>}
                {config.label || config.targetStatus}
              </button>
            ))}
          </div>
        )}

        <ReasonModal
          isOpen={reasonModal?.isOpen ?? false}
          title={reasonModal?.title ?? ""}
          description="Please provide a reason for this action."
          onConfirm={handleReasonConfirm}
          onCancel={() => setReasonModal(null)}
          isLoading={isTransitioning}
        />
      </div>
    );
  }

  // Render as button group
  return (
    <div className={`workflow-buttons ${className}`}>
      {visibleButtons.map((config) => (
        <button
          key={config.targetStatus}
          className={`btn ${VARIANT_CLASSES[config.variant || "secondary"]} ${SIZE_CLASSES[size]} ${config.className || ""}`}
          onClick={() => handleButtonClick(config)}
          disabled={isTransitioning}
        >
          {isTransitioning ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <>
              {config.icon && <span className="mr-1">{config.icon}</span>}
              {config.label || config.targetStatus}
            </>
          )}
        </button>
      ))}

      <ReasonModal
        isOpen={reasonModal?.isOpen ?? false}
        title={reasonModal?.title ?? ""}
        description="Please provide a reason for this action."
        onConfirm={handleReasonConfirm}
        onCancel={() => setReasonModal(null)}
        isLoading={isTransitioning}
      />
    </div>
  );
};

// ============================================================================
// WORKFLOW ERROR ALERT
// ============================================================================

export interface WorkflowErrorAlertProps {
  error: string | null;
  isConflict?: boolean;
  onDismiss?: () => void;
  onRefresh?: () => void;
}

export const WorkflowErrorAlert: React.FC<WorkflowErrorAlertProps> = ({
  error,
  isConflict,
  onDismiss,
  onRefresh,
}) => {
  if (!error) return null;

  return (
    <div
      className={`alert ${isConflict ? "alert-warning" : "alert-error"} mb-4`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center">
          <AlertTriangle size={18} className="mr-2" />
          <span>{error}</span>
        </div>
        <div className="flex gap-2">
          {isConflict && onRefresh && (
            <button className="btn btn-sm btn-secondary" onClick={onRefresh}>
              <RotateCcw size={14} className="mr-1" />
              Refresh
            </button>
          )}
          {onDismiss && (
            <button
              className="btn btn-sm btn-ghost"
              onClick={onDismiss}
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// STATUS BADGE COMPONENT
// ============================================================================
//
// DEPRECATED: Use <StatusBadge /> from src/components/common/StatusBadge.tsx
// This is kept temporarily for backward compatibility.
//

import { getStatusLabel, getStatusClass } from "../../types/workflow";

export interface WorkflowStatusBadgeProps {
  status: string;
  className?: string;
}

/**
 * @deprecated Use `<StatusBadge />` from `src/components/common/StatusBadge.tsx` instead.
 */
export const WorkflowStatusBadge: React.FC<WorkflowStatusBadgeProps> = ({
  status,
  className = "",
}) => {
  const cssClass = getStatusClass(status);
  const label = getStatusLabel(status);

  return (
    <span className={`status-badge ${cssClass} ${className}`}>{label}</span>
  );
};

export default WorkflowTransitionButtons;
