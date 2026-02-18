/**
 * ============================================================================
 * TA (Talent Acquisition) TICKET WORKFLOW - State Machine Definition
 * ============================================================================
 *
 * Defines all valid status transitions for talent acquisition tickets.
 * Tracks candidates through the hiring pipeline.
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

export const TA_TICKET_STATUSES = [
  "Open",
  "Screening",
  "Interview Scheduled",
  "Interview Completed",
  "Offer Extended",
  "Offer Accepted",
  "Offer Declined",
  "Hired",
  "On Hold",
  "Rejected",
  "Withdrawn",
] as const;

export type TATicketStatus = (typeof TA_TICKET_STATUSES)[number];

// ============================================================================
// Context Type
// ============================================================================

export interface TATicketContext extends TransitionContext {
  /** User's role */
  userRole?: "ta" | "hiring_manager" | "hr" | "admin";
  /** Interview date - required for scheduling */
  interviewDate?: string | Date;
  /** Interview feedback - required after interview */
  interviewFeedback?: string;
  /** Interview score */
  interviewScore?: number;
  /** Offer details */
  offerAmount?: number;
  /** Joining date on offer */
  proposedJoiningDate?: string | Date;
  /** Rejection reason */
  rejectionReason?: string;
  /** Withdrawal reason */
  withdrawalReason?: string;
  /** Hold reason */
  holdReason?: string;
  /** Whether offer letter is generated */
  offerLetterGenerated?: boolean;
  /** Whether background verification is initiated */
  bgvInitiated?: boolean;
  /** Minimum interview score required (configurable) */
  minInterviewScore?: number;
}

// ============================================================================
// Transition Guards
// ============================================================================

const isTA = when<TATicketContext>(
  (ctx) => ctx.userRole === "ta" || ctx.userRole === "admin",
  "Only TA team can perform this action",
);

const isHiringManager = when<TATicketContext>(
  (ctx) =>
    ctx.userRole === "hiring_manager" ||
    ctx.userRole === "hr" ||
    ctx.userRole === "admin",
  "Only hiring managers can perform this action",
);

const hasInterviewDate = hasDate<TATicketContext>(
  "interviewDate",
  "Interview date is required",
);

const hasInterviewFeedback = minLength<TATicketContext>(
  "interviewFeedback",
  20,
  "Interview feedback must be at least 20 characters",
);

const hasPassingScore = when<TATicketContext>((ctx) => {
  const minScore = ctx.minInterviewScore ?? 3; // Default minimum
  return (ctx.interviewScore ?? 0) >= minScore;
}, "Interview score does not meet minimum requirements");

const hasOfferDetails = when<TATicketContext>(
  (ctx) => !!ctx.offerAmount && !!ctx.proposedJoiningDate,
  "Offer amount and proposed joining date are required",
);

const hasRejectionReason = minLength<TATicketContext>(
  "rejectionReason",
  10,
  "Rejection reason must be at least 10 characters",
);

const hasWithdrawalReason = minLength<TATicketContext>(
  "withdrawalReason",
  10,
  "Withdrawal reason must be at least 10 characters",
);

const hasHoldReason = minLength<TATicketContext>(
  "holdReason",
  10,
  "Hold reason must be at least 10 characters",
);

const hasOfferLetter = when<TATicketContext>(
  (ctx) => ctx.offerLetterGenerated === true,
  "Offer letter must be generated before extending offer",
);

const hasBGVInitiated = when<TATicketContext>(
  (ctx) => ctx.bgvInitiated === true,
  "Background verification must be initiated",
);

// ============================================================================
// Workflow Definition
// ============================================================================

export const taTicketWorkflow = new Workflow<TATicketStatus, TATicketContext>(
  {
    name: "TA Ticket",
    version: "1.0.0",
    description: "Talent acquisition candidate tracking workflow",
  },
  {
    // Open - new candidate
    Open: {
      Screening: {
        description: "Start screening candidate",
        guards: [isTA],
      },
      Rejected: {
        description: "Reject at initial stage",
        guards: [isTA, hasRejectionReason],
      },
      "On Hold": {
        description: "Put on hold",
        guards: [isTA, hasHoldReason],
      },
      Withdrawn: {
        description: "Candidate withdraws application",
        guards: [hasWithdrawalReason],
      },
    },

    // Screening - reviewing resume/profile
    Screening: {
      "Interview Scheduled": {
        description: "Schedule interview",
        guards: [isTA, hasInterviewDate],
      },
      Rejected: {
        description: "Reject after screening",
        guards: [isTA, hasRejectionReason],
      },
      "On Hold": {
        description: "Put on hold",
        guards: [isTA, hasHoldReason],
      },
      Withdrawn: {
        description: "Candidate withdraws",
        guards: [hasWithdrawalReason],
      },
    },

    // Interview Scheduled - waiting for interview
    "Interview Scheduled": {
      "Interview Completed": {
        description: "Mark interview as completed",
        guards: [hasInterviewFeedback],
      },
      Rejected: {
        description: "Candidate no-show or pre-reject",
        guards: [hasRejectionReason],
      },
      Withdrawn: {
        description: "Candidate withdraws",
        guards: [hasWithdrawalReason],
      },
    },

    // Interview Completed - decision pending
    "Interview Completed": {
      "Offer Extended": {
        description: "Extend offer to candidate",
        guards: [
          isHiringManager,
          hasPassingScore,
          hasOfferDetails,
          hasOfferLetter,
        ],
      },
      Rejected: {
        description: "Reject after interview",
        guards: [isHiringManager, hasRejectionReason],
      },
      "Interview Scheduled": {
        description: "Schedule another round",
        guards: [hasInterviewDate],
      },
      "On Hold": {
        description: "Put on hold",
        guards: [hasHoldReason],
      },
      Withdrawn: {
        description: "Candidate withdraws",
        guards: [hasWithdrawalReason],
      },
    },

    // Offer Extended - waiting for response
    "Offer Extended": {
      "Offer Accepted": {
        description: "Candidate accepts offer",
        guards: [],
      },
      "Offer Declined": {
        description: "Candidate declines offer",
        guards: [],
      },
      Withdrawn: {
        description: "Offer withdrawn by company",
        guards: [isHiringManager, hasWithdrawalReason],
      },
    },

    // Offer Accepted - pre-joining
    "Offer Accepted": {
      Hired: {
        description: "Candidate joins as employee",
        guards: [isTA, hasBGVInitiated],
      },
      Withdrawn: {
        description: "Candidate backs out",
        guards: [hasWithdrawalReason],
      },
    },

    // On Hold - temporarily paused
    "On Hold": {
      Open: {
        description: "Reopen ticket",
        guards: [isTA],
      },
      Screening: {
        description: "Resume screening",
        guards: [isTA],
      },
      Rejected: {
        description: "Reject while on hold",
        guards: [isTA, hasRejectionReason],
      },
      Withdrawn: {
        description: "Candidate withdraws while on hold",
        guards: [hasWithdrawalReason],
      },
    },

    // Terminal states
    "Offer Declined": {},
    Hired: {},
    Rejected: {},
    Withdrawn: {},
  },
);

// ============================================================================
// Convenience Functions
// ============================================================================

export function canTransitionTATicket(
  current: TATicketStatus,
  next: TATicketStatus,
): boolean {
  return taTicketWorkflow.canTransition(current, next);
}

export function validateTATicketTransition(
  current: TATicketStatus,
  next: TATicketStatus,
  context: TATicketContext = {},
) {
  return taTicketWorkflow.validate(current, next, context);
}

export function getTATicketNextStatuses(
  current: TATicketStatus,
): TATicketStatus[] {
  return taTicketWorkflow.getAvailableTransitions(current);
}

export function isTerminalTAStatus(status: TATicketStatus): boolean {
  return taTicketWorkflow.getAvailableTransitions(status).length === 0;
}

export const TA_TICKET_STATUS_LABELS: Record<TATicketStatus, string> = {
  Open: "Open",
  Screening: "Screening",
  "Interview Scheduled": "Interview Scheduled",
  "Interview Completed": "Interview Completed",
  "Offer Extended": "Offer Extended",
  "Offer Accepted": "Offer Accepted",
  "Offer Declined": "Offer Declined",
  Hired: "Hired",
  "On Hold": "On Hold",
  Rejected: "Rejected",
  Withdrawn: "Withdrawn",
};

export const TA_TICKET_STATUS_CLASSES: Record<TATicketStatus, string> = {
  Open: "status-open",
  Screening: "status-screening",
  "Interview Scheduled": "status-scheduled",
  "Interview Completed": "status-completed",
  "Offer Extended": "status-offer",
  "Offer Accepted": "status-accepted",
  "Offer Declined": "status-declined",
  Hired: "status-hired",
  "On Hold": "status-hold",
  Rejected: "status-rejected",
  Withdrawn: "status-withdrawn",
};
