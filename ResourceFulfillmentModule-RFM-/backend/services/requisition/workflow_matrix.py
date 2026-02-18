"""
============================================================================
WORKFLOW MATRIX - Official Transition Definitions
============================================================================

RBM Resource Fulfillment Module — Workflow Specification v1.0.0

This module contains the authoritative transition matrices, terminal states,
and role authorization rules. All workflow operations MUST validate against
these definitions.

DESIGN PRINCIPLES:
1. Single source of truth for all transitions
2. Strict enum-based state definitions
3. No implicit transitions
4. Clear role authorization boundaries
"""

from enum import Enum
from typing import Set, Dict, FrozenSet


# ============================================================================
# OFFICIAL STATE ENUMS (Appendix A)
# ============================================================================

class RequisitionStatus(str, Enum):
    """
    Official header status enumeration.
    DO NOT modify without workflow specification approval.
    """
    DRAFT = "Draft"
    PENDING_BUDGET = "Pending_Budget"
    PENDING_HR = "Pending_HR"
    ACTIVE = "Active"
    FULFILLED = "Fulfilled"
    REJECTED = "Rejected"
    CANCELLED = "Cancelled"


class RequisitionItemStatus(str, Enum):
    """
    Official item status enumeration.
    DO NOT modify without workflow specification approval.
    """
    PENDING = "Pending"
    SOURCING = "Sourcing"
    SHORTLISTED = "Shortlisted"
    INTERVIEWING = "Interviewing"
    OFFERED = "Offered"
    FULFILLED = "Fulfilled"
    CANCELLED = "Cancelled"


class ItemBudgetStatus(str, Enum):
    """
    Budget status for requisition items.
    
    This is NOT a workflow status - it tracks budget approval state separately.
    """
    PENDING = "pending"           # Budget not yet set or not approved
    SUBMITTED = "submitted"       # estimated_budget > 0, awaiting approval
    APPROVED = "approved"         # approved_budget set
    REJECTED = "rejected"         # Budget rejected, needs revision


class SystemRole(str, Enum):
    """
    Official system roles for authorization.
    """
    MANAGER = "Manager"
    HR = "HR"
    TA = "TA"
    ADMIN = "Admin"
    SYSTEM = "SYSTEM"  # For automatic transitions


# ============================================================================
# HEADER TRANSITION MATRIX (Section 3.2)
# ============================================================================

HEADER_TRANSITIONS: Dict[RequisitionStatus, Set[RequisitionStatus]] = {
    RequisitionStatus.DRAFT: {
        RequisitionStatus.PENDING_BUDGET,
        RequisitionStatus.CANCELLED,
    },
    RequisitionStatus.PENDING_BUDGET: {
        RequisitionStatus.PENDING_HR,
        RequisitionStatus.REJECTED,
        RequisitionStatus.CANCELLED,
    },
    RequisitionStatus.PENDING_HR: {
        RequisitionStatus.ACTIVE,
        RequisitionStatus.REJECTED,
        RequisitionStatus.CANCELLED,
    },
    RequisitionStatus.ACTIVE: {
        RequisitionStatus.FULFILLED,  # SYSTEM only
        RequisitionStatus.CANCELLED,
    },
    # F-004: REJECTED is no longer terminal - can return to DRAFT for resubmission
    RequisitionStatus.REJECTED: {
        RequisitionStatus.DRAFT,  # Allow resubmission after addressing rejection
    },
    # Terminal states - truly final, no outbound transitions
    RequisitionStatus.FULFILLED: set(),
    RequisitionStatus.CANCELLED: set(),
}


# ============================================================================
# HEADER TERMINAL STATES (Section 3.4)
# ============================================================================

# F-004: REJECTED removed from terminal states - can now return to DRAFT
HEADER_TERMINAL_STATES: FrozenSet[RequisitionStatus] = frozenset({
    RequisitionStatus.FULFILLED,
    RequisitionStatus.CANCELLED,
})


# ============================================================================
# ITEM TRANSITION MATRIX (Section 4.2)
# ============================================================================

ITEM_TRANSITIONS: Dict[RequisitionItemStatus, Set[RequisitionItemStatus]] = {
    RequisitionItemStatus.PENDING: {
        RequisitionItemStatus.SOURCING,  # SYSTEM only (TA assigned)
        RequisitionItemStatus.CANCELLED,
    },
    RequisitionItemStatus.SOURCING: {
        RequisitionItemStatus.SHORTLISTED,
        RequisitionItemStatus.CANCELLED,
    },
    RequisitionItemStatus.SHORTLISTED: {
        RequisitionItemStatus.INTERVIEWING,
        RequisitionItemStatus.SOURCING,  # Backward (re-source)
        RequisitionItemStatus.CANCELLED,
    },
    RequisitionItemStatus.INTERVIEWING: {
        RequisitionItemStatus.OFFERED,
        RequisitionItemStatus.SHORTLISTED,  # Backward (return to shortlist)
        RequisitionItemStatus.CANCELLED,
    },
    RequisitionItemStatus.OFFERED: {
        RequisitionItemStatus.FULFILLED,
        RequisitionItemStatus.INTERVIEWING,  # Backward (offer declined)
        RequisitionItemStatus.CANCELLED,
    },
    # Terminal states - no outbound transitions
    RequisitionItemStatus.FULFILLED: set(),
    RequisitionItemStatus.CANCELLED: set(),
}


# ============================================================================
# ITEM TERMINAL STATES (Section 4.4)
# ============================================================================

ITEM_TERMINAL_STATES: FrozenSet[RequisitionItemStatus] = frozenset({
    RequisitionItemStatus.FULFILLED,
    RequisitionItemStatus.CANCELLED,
})


# ============================================================================
# BACKWARD TRANSITIONS (Section 4.5 - Require reason)
# ============================================================================

ITEM_BACKWARD_TRANSITIONS: Dict[RequisitionItemStatus, Set[RequisitionItemStatus]] = {
    RequisitionItemStatus.SHORTLISTED: {RequisitionItemStatus.SOURCING},
    RequisitionItemStatus.INTERVIEWING: {RequisitionItemStatus.SHORTLISTED},
    RequisitionItemStatus.OFFERED: {RequisitionItemStatus.INTERVIEWING},
}


# ============================================================================
# SYSTEM-ONLY TRANSITIONS (Section 5.1, 5.2)
# ============================================================================

HEADER_SYSTEM_ONLY_TRANSITIONS: Dict[RequisitionStatus, Set[RequisitionStatus]] = {
    RequisitionStatus.ACTIVE: {RequisitionStatus.FULFILLED},
}

ITEM_SYSTEM_ONLY_TRANSITIONS: Dict[RequisitionItemStatus, Set[RequisitionItemStatus]] = {
    RequisitionItemStatus.PENDING: {RequisitionItemStatus.SOURCING},
}


# ============================================================================
# ROLE AUTHORIZATION MATRIX - HEADER (Section 5.1)
# ============================================================================

HEADER_TRANSITION_AUTHORITY: Dict[
    tuple[RequisitionStatus, RequisitionStatus],
    FrozenSet[SystemRole]
] = {
    # DRAFT transitions
    (RequisitionStatus.DRAFT, RequisitionStatus.PENDING_BUDGET): frozenset({
        SystemRole.MANAGER,
    }),
    (RequisitionStatus.DRAFT, RequisitionStatus.CANCELLED): frozenset({
        SystemRole.MANAGER,
        SystemRole.ADMIN,
    }),
    
    # PENDING_BUDGET transitions
    (RequisitionStatus.PENDING_BUDGET, RequisitionStatus.PENDING_HR): frozenset({
        SystemRole.MANAGER,
        SystemRole.ADMIN,
        SystemRole.HR,
    }),
    (RequisitionStatus.PENDING_BUDGET, RequisitionStatus.REJECTED): frozenset({
        SystemRole.MANAGER,
        SystemRole.ADMIN,
    }),
    (RequisitionStatus.PENDING_BUDGET, RequisitionStatus.CANCELLED): frozenset({
        SystemRole.MANAGER,
        SystemRole.ADMIN,
    }),
    
    # PENDING_HR transitions
    (RequisitionStatus.PENDING_HR, RequisitionStatus.ACTIVE): frozenset({
        SystemRole.HR,
        SystemRole.ADMIN,
    }),
    (RequisitionStatus.PENDING_HR, RequisitionStatus.REJECTED): frozenset({
        SystemRole.HR,
        SystemRole.ADMIN,
    }),
    (RequisitionStatus.PENDING_HR, RequisitionStatus.CANCELLED): frozenset({
        SystemRole.MANAGER,
        SystemRole.HR,
        SystemRole.ADMIN,
    }),
    
    # ACTIVE transitions
    (RequisitionStatus.ACTIVE, RequisitionStatus.FULFILLED): frozenset({
        SystemRole.SYSTEM,  # ONLY SYSTEM
    }),
    (RequisitionStatus.ACTIVE, RequisitionStatus.CANCELLED): frozenset({
        SystemRole.MANAGER,
        SystemRole.HR,
        SystemRole.ADMIN,
    }),
    
    # F-004: REJECTED transitions (resubmission path)
    (RequisitionStatus.REJECTED, RequisitionStatus.DRAFT): frozenset({
        SystemRole.MANAGER,  # Original requester can resubmit
        SystemRole.ADMIN,
    }),
}


# ============================================================================
# ROLE AUTHORIZATION MATRIX - ITEM (Section 5.2)
# ============================================================================

ITEM_TRANSITION_AUTHORITY: Dict[
    tuple[RequisitionItemStatus, RequisitionItemStatus],
    FrozenSet[SystemRole]
] = {
    # PENDING transitions
    (RequisitionItemStatus.PENDING, RequisitionItemStatus.SOURCING): frozenset({
        SystemRole.SYSTEM,  # ONLY SYSTEM (TA assignment triggers)
    }),
    (RequisitionItemStatus.PENDING, RequisitionItemStatus.CANCELLED): frozenset({
        SystemRole.MANAGER,
        SystemRole.HR,
        SystemRole.ADMIN,
    }),
    
    # SOURCING transitions
    (RequisitionItemStatus.SOURCING, RequisitionItemStatus.SHORTLISTED): frozenset({
        SystemRole.TA,
        SystemRole.ADMIN,
    }),
    (RequisitionItemStatus.SOURCING, RequisitionItemStatus.CANCELLED): frozenset({
        SystemRole.MANAGER,
        SystemRole.HR,
        SystemRole.TA,
        SystemRole.ADMIN,
    }),
    
    # SHORTLISTED transitions
    (RequisitionItemStatus.SHORTLISTED, RequisitionItemStatus.INTERVIEWING): frozenset({
        SystemRole.TA,
        SystemRole.ADMIN,
    }),
    (RequisitionItemStatus.SHORTLISTED, RequisitionItemStatus.SOURCING): frozenset({
        SystemRole.TA,
        SystemRole.ADMIN,
    }),
    (RequisitionItemStatus.SHORTLISTED, RequisitionItemStatus.CANCELLED): frozenset({
        SystemRole.MANAGER,
        SystemRole.HR,
        SystemRole.TA,
        SystemRole.ADMIN,
    }),
    
    # INTERVIEWING transitions
    (RequisitionItemStatus.INTERVIEWING, RequisitionItemStatus.OFFERED): frozenset({
        SystemRole.TA,
        SystemRole.HR,
        SystemRole.ADMIN,
    }),
    (RequisitionItemStatus.INTERVIEWING, RequisitionItemStatus.SHORTLISTED): frozenset({
        SystemRole.TA,
        SystemRole.ADMIN,
    }),
    (RequisitionItemStatus.INTERVIEWING, RequisitionItemStatus.CANCELLED): frozenset({
        SystemRole.MANAGER,
        SystemRole.HR,
        SystemRole.TA,
        SystemRole.ADMIN,
    }),
    
    # OFFERED transitions
    (RequisitionItemStatus.OFFERED, RequisitionItemStatus.FULFILLED): frozenset({
        SystemRole.HR,
        SystemRole.TA,
    }),
    (RequisitionItemStatus.OFFERED, RequisitionItemStatus.INTERVIEWING): frozenset({
        SystemRole.TA,
        SystemRole.HR,
        SystemRole.ADMIN,
    }),
    (RequisitionItemStatus.OFFERED, RequisitionItemStatus.CANCELLED): frozenset({
        SystemRole.MANAGER,
        SystemRole.HR,
        SystemRole.TA,
        SystemRole.ADMIN,
    }),
}


# ============================================================================
# ITEM BUDGET WORKFLOW AUTHORITY
# ============================================================================

# Roles authorized to edit item estimated_budget
ITEM_BUDGET_EDIT_AUTHORITY: FrozenSet[SystemRole] = frozenset({
    SystemRole.MANAGER,
    SystemRole.HR,
    SystemRole.ADMIN,
})

# Roles authorized to approve item budget
ITEM_BUDGET_APPROVE_AUTHORITY: FrozenSet[SystemRole] = frozenset({
    SystemRole.MANAGER,
    SystemRole.HR,
    SystemRole.ADMIN,
})

# Roles authorized to reject item budget
ITEM_BUDGET_REJECT_AUTHORITY: FrozenSet[SystemRole] = frozenset({
    SystemRole.MANAGER,
    SystemRole.HR,
    SystemRole.ADMIN,
})

# Roles authorized to cancel item budget
ITEM_BUDGET_CANCEL_AUTHORITY: FrozenSet[SystemRole] = frozenset({
    SystemRole.MANAGER,
    SystemRole.HR,
    SystemRole.ADMIN,
})

# Header states where item budget can be edited/approved
ITEM_BUDGET_EDITABLE_HEADER_STATES: FrozenSet[RequisitionStatus] = frozenset({
    RequisitionStatus.DRAFT,
    RequisitionStatus.PENDING_BUDGET,
})

# Header states where item budget can be approved
ITEM_BUDGET_APPROVABLE_HEADER_STATES: FrozenSet[RequisitionStatus] = frozenset({
    RequisitionStatus.PENDING_BUDGET,
})


# ============================================================================
# FIELD EDIT AUTHORITY (Section 5.3)
# ============================================================================

# Header fields that cannot be directly edited via API
HEADER_FORBIDDEN_FIELDS: FrozenSet[str] = frozenset({
    "overall_status",
    "budget_amount",       # PHASE 2 GATEKEEPER: Header budget derived from item totals
    "budget_approved_at",
    "budget_approved_by",
    "hr_approved_at",
    "hr_approved_by",
    "created_at",
    "created_by",
})

# Item fields that cannot be directly edited via API
ITEM_FORBIDDEN_FIELDS: FrozenSet[str] = frozenset({
    "item_status",
    "assigned_employee_id",  # Only via workflow/fulfill
    "approved_budget",       # Only via workflow/approve-budget
    "created_at",
})


# ============================================================================
# HEADER STATES WHERE ITEM MODIFICATION IS BLOCKED (Section 6.4)
# ============================================================================

ITEM_MODIFICATION_BLOCKED_HEADER_STATES: FrozenSet[RequisitionStatus] = frozenset({
    RequisitionStatus.PENDING_BUDGET,
    RequisitionStatus.PENDING_HR,
    RequisitionStatus.FULFILLED,
    RequisitionStatus.REJECTED,
    RequisitionStatus.CANCELLED,
})

ITEM_STATUS_CHANGE_ALLOWED_HEADER_STATES: FrozenSet[RequisitionStatus] = frozenset({
    RequisitionStatus.ACTIVE,
})


# ============================================================================
# VALIDATION HELPERS
# ============================================================================

def is_valid_header_transition(
    from_status: RequisitionStatus,
    to_status: RequisitionStatus,
) -> bool:
    """Check if a header transition is defined in the matrix."""
    allowed = HEADER_TRANSITIONS.get(from_status, set())
    return to_status in allowed


def is_valid_item_transition(
    from_status: RequisitionItemStatus,
    to_status: RequisitionItemStatus,
) -> bool:
    """Check if an item transition is defined in the matrix."""
    allowed = ITEM_TRANSITIONS.get(from_status, set())
    return to_status in allowed


def is_header_terminal(status: RequisitionStatus) -> bool:
    """Check if a header status is terminal."""
    return status in HEADER_TERMINAL_STATES


def is_item_terminal(status: RequisitionItemStatus) -> bool:
    """Check if an item status is terminal."""
    return status in ITEM_TERMINAL_STATES


def is_backward_item_transition(
    from_status: RequisitionItemStatus,
    to_status: RequisitionItemStatus,
) -> bool:
    """Check if an item transition is a backward transition (requires reason)."""
    backward = ITEM_BACKWARD_TRANSITIONS.get(from_status, set())
    return to_status in backward


def is_system_only_header_transition(
    from_status: RequisitionStatus,
    to_status: RequisitionStatus,
) -> bool:
    """Check if a header transition is system-only."""
    system_only = HEADER_SYSTEM_ONLY_TRANSITIONS.get(from_status, set())
    return to_status in system_only


def is_system_only_item_transition(
    from_status: RequisitionItemStatus,
    to_status: RequisitionItemStatus,
) -> bool:
    """Check if an item transition is system-only."""
    system_only = ITEM_SYSTEM_ONLY_TRANSITIONS.get(from_status, set())
    return to_status in system_only


def get_header_authorized_roles(
    from_status: RequisitionStatus,
    to_status: RequisitionStatus,
) -> FrozenSet[SystemRole]:
    """Get the roles authorized for a header transition."""
    return HEADER_TRANSITION_AUTHORITY.get((from_status, to_status), frozenset())


def get_item_authorized_roles(
    from_status: RequisitionItemStatus,
    to_status: RequisitionItemStatus,
) -> FrozenSet[SystemRole]:
    """Get the roles authorized for an item transition."""
    return ITEM_TRANSITION_AUTHORITY.get((from_status, to_status), frozenset())


# ============================================================================
# BUDGET WORKFLOW HELPERS
# ============================================================================

def can_edit_item_budget(
    header_status: RequisitionStatus,
    user_roles: list,
) -> bool:
    """
    Check if item budget can be edited in current header state.
    
    Budget can only be edited when header is in DRAFT or PENDING_BUDGET.
    """
    if header_status not in ITEM_BUDGET_EDITABLE_HEADER_STATES:
        return False
    
    user_system_roles = {
        SystemRole(r) for r in user_roles
        if r in [sr.value for sr in SystemRole]
    }
    return bool(user_system_roles.intersection(ITEM_BUDGET_EDIT_AUTHORITY))


def can_approve_item_budget(
    header_status: RequisitionStatus,
    user_roles: list,
) -> bool:
    """
    Check if item budget can be approved in current header state.
    
    Budget can only be approved when header is in PENDING_BUDGET.
    """
    if header_status not in ITEM_BUDGET_APPROVABLE_HEADER_STATES:
        return False
    
    user_system_roles = {
        SystemRole(r) for r in user_roles
        if r in [sr.value for sr in SystemRole]
    }
    return bool(user_system_roles.intersection(ITEM_BUDGET_APPROVE_AUTHORITY))


def get_budget_edit_authorized_roles() -> FrozenSet[SystemRole]:
    """Get roles authorized to edit item budgets."""
    return ITEM_BUDGET_EDIT_AUTHORITY


def get_budget_approve_authorized_roles() -> FrozenSet[SystemRole]:
    """Get roles authorized to approve item budgets."""
    return ITEM_BUDGET_APPROVE_AUTHORITY


def get_budget_reject_authorized_roles() -> FrozenSet[SystemRole]:
    """Get roles authorized to reject item budgets."""
    return ITEM_BUDGET_REJECT_AUTHORITY
