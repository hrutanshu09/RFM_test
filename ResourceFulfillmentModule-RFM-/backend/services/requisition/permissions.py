"""
Requisition Permissions - Ownership and Access Control

Handles permission checks for requisition operations:
- Ownership validation
- Role-based access control
- Status-based guards
"""

from typing import List, Set

from db.models.requisition import Requisition


class RequisitionPermissions:
    """
    Centralized permission checks for requisition operations.
    """

    # Status sets for permission checks
    TERMINAL_STATUSES: Set[str] = {
        "Fulfilled",
        "Cancelled",
        # Legacy values (pre-spec) retained for compatibility
        "Closed",
        "Closed (Partially Fulfilled)",
    }

    EDITABLE_STATUSES: Set[str] = {
        "Draft",
        "Pending_Budget",
        "Pending_HR",
        # Legacy values retained for compatibility
        "Pending Budget Approval",
        "Pending HR Approval",
    }

    JD_EDITABLE_STATUSES: Set[str] = {
        "Draft",
        "Pending_Budget",
        "Pending_HR",
        # Legacy values retained for compatibility
        "Pending Budget Approval",
        "Pending HR Approval",
        "Budget Rejected",
    }

    ITEM_BLOCKED_STATUSES: Set[str] = {
        "Rejected",
        "Fulfilled",
        "Cancelled",
        # Legacy values retained for compatibility
        "Closed",
        "Closed (Partially Fulfilled)",
    }

    ITEM_MUTATION_BLOCKED_STATUSES: Set[str] = {
        "Rejected",
        "Cancelled",
        # Legacy values retained for compatibility
        "Closed",
        "Closed (Partially Fulfilled)",
    }

    @staticmethod
    def is_owner(requisition: Requisition, user_id: int) -> bool:
        """
        Check if user is the owner (raised_by) of the requisition.
        """
        return requisition.raised_by == user_id

    @staticmethod
    def is_assigned_ta(requisition: Requisition, user_id: int) -> bool:
        """
        Check if user is the assigned TA for the requisition.
        """
        return requisition.assigned_ta == user_id

    @staticmethod
    def can_edit_requisition(requisition: Requisition, user_id: int) -> bool:
        """
        Check if user can edit the requisition.
        Must be owner and requisition must be in editable status.
        """
        return (
            RequisitionPermissions.is_owner(requisition, user_id)
            and requisition.overall_status in RequisitionPermissions.EDITABLE_STATUSES
        )

    @staticmethod
    def can_edit_jd(requisition: Requisition, user_id: int) -> bool:
        """
        Check if user can edit the JD file.
        Must be owner and requisition must be in JD-editable status.
        """
        return (
            RequisitionPermissions.is_owner(requisition, user_id)
            and requisition.overall_status in RequisitionPermissions.JD_EDITABLE_STATUSES
        )

    @staticmethod
    def can_cancel(
        requisition: Requisition,
        user_id: int,
        user_roles: List[str],
    ) -> tuple[bool, str | None]:
        """
        Check if user can cancel the requisition.
        
        Returns:
            Tuple of (allowed, error_message)
        """
        # Check terminal status first
        if requisition.overall_status in RequisitionPermissions.TERMINAL_STATUSES:
            return (
                False,
                f"Cannot cancel requisition in '{requisition.overall_status}' status",
            )

        # Only HR or the owner can cancel
        is_hr = "HR" in user_roles
        is_owner = RequisitionPermissions.is_owner(requisition, user_id)

        if not (is_hr or is_owner):
            return (
                False,
                "Only HR or the manager who raised this requisition can cancel it",
            )

        return (True, None)

    @staticmethod
    def can_approve_budget(requisition: Requisition) -> tuple[bool, str | None]:
        """
        Check if budget can be approved.
        
        Returns:
            Tuple of (allowed, error_message)
        """
        if requisition.overall_status not in {"Pending_Budget", "Pending Budget Approval"}:
            return (
                False,
                f"Cannot approve budget. Current status: {requisition.overall_status}",
            )
        return (True, None)

    @staticmethod
    def can_approve_hr(requisition: Requisition) -> tuple[bool, str | None]:
        """
        Check if HR can approve the requisition.
        
        Returns:
            Tuple of (allowed, error_message)
        """
        if requisition.overall_status not in {"Pending_HR", "Pending HR Approval"}:
            return (False, "Requisition is not pending HR approval")
        return (True, None)

    @staticmethod
    def can_reject(requisition: Requisition) -> tuple[bool, str | None]:
        """
        Check if requisition can be rejected.
        
        Returns:
            Tuple of (allowed, error_message)
        """
        if requisition.overall_status == "Rejected":
            return (False, "Requisition already rejected")

        if requisition.overall_status != "Pending HR Approval":
            return (False, "Requisition is not pending HR approval")

        return (True, None)

    @staticmethod
    def can_assign_ta(requisition: Requisition) -> tuple[bool, str | None]:
        """
        Check if TA can be assigned to the requisition.
        
        Returns:
            Tuple of (allowed, error_message)
        """
        if requisition.assigned_ta is not None:
            return (False, "Requisition already assigned")

        if requisition.overall_status != "Approved & Unassigned":
            return (False, "Requisition is not ready for TA assignment")

        return (True, None)

    @staticmethod
    def can_modify_items(requisition: Requisition) -> tuple[bool, str | None]:
        """
        Check if items can be modified on this requisition.
        
        Returns:
            Tuple of (allowed, error_message)
        """
        if requisition.overall_status in RequisitionPermissions.ITEM_BLOCKED_STATUSES:
            return (
                False,
                f"Cannot add items to requisition in '{requisition.overall_status}' status",
            )
        return (True, None)

    @staticmethod
    def can_mutate_item(requisition: Requisition) -> tuple[bool, str | None]:
        """
        Check if item status/assignment can be changed on this requisition.
        
        Returns:
            Tuple of (allowed, error_message)
        """
        if requisition.overall_status in RequisitionPermissions.ITEM_MUTATION_BLOCKED_STATUSES:
            return (
                False,
                f"Cannot modify items on requisition in '{requisition.overall_status}' status",
            )
        return (True, None)
