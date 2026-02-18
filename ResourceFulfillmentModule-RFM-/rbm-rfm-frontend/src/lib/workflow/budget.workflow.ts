/**
 * ============================================================================
 * BUDGET APPROVAL WORKFLOW - State Machine Definition
 * ============================================================================
 *
 * Defines all valid status transitions for budget approval process.
 * Handles budget requests from submission to release.
 */

import {
  Workflow,
  TransitionContext,
  when,
  minLength,
  minValue,
} from "./engine";

// ============================================================================
// Status Types
// ============================================================================

export const BUDGET_STATUSES = [
  "Draft",
  "Submitted",
  "Under Review",
  "Revision Required",
  "Approved",
  "Partially Approved",
  "Rejected",
  "Released",
  "Closed",
] as const;

export type BudgetStatus = (typeof BUDGET_STATUSES)[number];

// ============================================================================
// Context Type
// ============================================================================

export interface BudgetContext extends TransitionContext {
  /** User's role */
  userRole?: "requester" | "budget_manager" | "finance" | "cfo" | "admin";
  /** Requested amount */
  requestedAmount?: number;
  /** Approved amount (may differ from requested) */
  approvedAmount?: number;
  /** Revision notes from reviewer */
  revisionNotes?: string;
  /** Rejection reason */
  rejectionReason?: string;
  /** Approval justification */
  approvalJustification?: string;
  /** Whether all required approvals are obtained */
  hasAllApprovals?: boolean;
  /** Budget period */
  budgetPeriod?: string;
  /** Cost center */
  costCenter?: string;
  /** Whether release authorization is obtained */
  releaseAuthorized?: boolean;
  /** Release reference number */
  releaseReference?: string;
}

// ============================================================================
// Transition Guards
// ============================================================================

const isRequester = when<BudgetContext>(
  (ctx) => ctx.userRole === "requester" || ctx.userRole === "admin",
  "Only the requester can perform this action",
);

const isBudgetManager = when<BudgetContext>(
  (ctx) =>
    ctx.userRole === "budget_manager" ||
    ctx.userRole === "finance" ||
    ctx.userRole === "cfo" ||
    ctx.userRole === "admin",
  "Only budget managers can perform this action",
);

const isFinance = when<BudgetContext>(
  (ctx) =>
    ctx.userRole === "finance" ||
    ctx.userRole === "cfo" ||
    ctx.userRole === "admin",
  "Only finance team can perform this action",
);

const isCFO = when<BudgetContext>(
  (ctx) => ctx.userRole === "cfo" || ctx.userRole === "admin",
  "Only CFO can perform this action",
);

const hasRevisionNotes = minLength<BudgetContext>(
  "revisionNotes",
  10,
  "Revision notes must be at least 10 characters",
);

const hasRejectionReason = minLength<BudgetContext>(
  "rejectionReason",
  10,
  "Rejection reason must be at least 10 characters",
);

const hasApprovedAmount = when<BudgetContext>(
  (ctx) => (ctx.approvedAmount ?? 0) > 0,
  "Approved amount must be specified",
);

const hasApprovalJustification = minLength<BudgetContext>(
  "approvalJustification",
  10,
  "Approval justification must be at least 10 characters",
);

const hasAllApprovals = when<BudgetContext>(
  (ctx) => ctx.hasAllApprovals === true,
  "All required approvals must be obtained",
);

const hasReleaseAuthorization = when<BudgetContext>(
  (ctx) => ctx.releaseAuthorized === true && !!ctx.releaseReference,
  "Release authorization and reference number are required",
);

const isPartialApproval = when<BudgetContext>((ctx) => {
  const requested = ctx.requestedAmount ?? 0;
  const approved = ctx.approvedAmount ?? 0;
  return approved > 0 && approved < requested;
}, "Approved amount must be less than requested for partial approval");

// ============================================================================
// Workflow Definition
// ============================================================================

export const budgetWorkflow = new Workflow<BudgetStatus, BudgetContext>(
  {
    name: "Budget Approval",
    version: "1.0.0",
    description: "Budget request and approval workflow",
  },
  {
    // Draft - initial state
    Draft: {
      Submitted: {
        description: "Submit budget request for review",
        guards: [isRequester],
      },
    },

    // Submitted - waiting for review
    Submitted: {
      "Under Review": {
        description: "Begin reviewing budget request",
        guards: [isBudgetManager],
      },
      Rejected: {
        description: "Reject incomplete submission",
        guards: [isBudgetManager, hasRejectionReason],
      },
      Draft: {
        description: "Return to requester",
        guards: [isBudgetManager],
      },
    },

    // Under Review - being evaluated
    "Under Review": {
      Approved: {
        description: "Approve full budget request",
        guards: [isBudgetManager, hasApprovedAmount, hasApprovalJustification],
      },
      "Partially Approved": {
        description: "Approve partial budget",
        guards: [
          isBudgetManager,
          hasApprovedAmount,
          isPartialApproval,
          hasApprovalJustification,
        ],
      },
      "Revision Required": {
        description: "Request revisions from requester",
        guards: [isBudgetManager, hasRevisionNotes],
      },
      Rejected: {
        description: "Reject budget request",
        guards: [isBudgetManager, hasRejectionReason],
      },
    },

    // Revision Required - needs updates
    "Revision Required": {
      Submitted: {
        description: "Resubmit after revisions",
        guards: [isRequester],
      },
      Draft: {
        description: "Save as draft for later",
        guards: [isRequester],
      },
    },

    // Approved - ready for release
    Approved: {
      Released: {
        description: "Release approved budget",
        guards: [isFinance, hasAllApprovals, hasReleaseAuthorization],
      },
      Closed: {
        description: "Close without release",
        guards: [isCFO],
      },
    },

    // Partially Approved - ready for partial release
    "Partially Approved": {
      Released: {
        description: "Release partial budget",
        guards: [isFinance, hasAllApprovals, hasReleaseAuthorization],
      },
      "Under Review": {
        description: "Request full approval review",
        guards: [isRequester],
      },
      Closed: {
        description: "Close without release",
        guards: [isCFO],
      },
    },

    // Released - budget is live
    Released: {
      Closed: {
        description: "Close budget period",
        guards: [isFinance],
      },
    },

    // Terminal states
    Rejected: {},
    Closed: {},
  },
);

// ============================================================================
// Convenience Functions
// ============================================================================

export function canTransitionBudget(
  current: BudgetStatus,
  next: BudgetStatus,
): boolean {
  return budgetWorkflow.canTransition(current, next);
}

export function validateBudgetTransition(
  current: BudgetStatus,
  next: BudgetStatus,
  context: BudgetContext = {},
) {
  return budgetWorkflow.validate(current, next, context);
}

export function getBudgetNextStatuses(current: BudgetStatus): BudgetStatus[] {
  return budgetWorkflow.getAvailableTransitions(current);
}

export function isTerminalBudgetStatus(status: BudgetStatus): boolean {
  return budgetWorkflow.getAvailableTransitions(status).length === 0;
}

/**
 * Check if budget can be edited (only in certain states).
 */
export function canEditBudget(status: BudgetStatus): boolean {
  const editableStates: BudgetStatus[] = ["Draft", "Revision Required"];
  return editableStates.includes(status);
}

/**
 * Check if budget is in a final/locked state.
 */
export function isBudgetLocked(status: BudgetStatus): boolean {
  const lockedStates: BudgetStatus[] = ["Approved", "Released", "Closed"];
  return lockedStates.includes(status);
}

export const BUDGET_STATUS_LABELS: Record<BudgetStatus, string> = {
  Draft: "Draft",
  Submitted: "Submitted",
  "Under Review": "Under Review",
  "Revision Required": "Revision Required",
  Approved: "Approved",
  "Partially Approved": "Partially Approved",
  Rejected: "Rejected",
  Released: "Released",
  Closed: "Closed",
};

export const BUDGET_STATUS_CLASSES: Record<BudgetStatus, string> = {
  Draft: "status-draft",
  Submitted: "status-submitted",
  "Under Review": "status-review",
  "Revision Required": "status-revision",
  Approved: "status-approved",
  "Partially Approved": "status-partial",
  Rejected: "status-rejected",
  Released: "status-released",
  Closed: "status-closed",
};
