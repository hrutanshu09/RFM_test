from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    Date,
    Boolean,
    Numeric,
    TIMESTAMP,
    CheckConstraint,
    ForeignKey
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from db.base import Base


class Requisition(Base):
    """
    Requisition Header Model
    
    RBM Resource Fulfillment Module — Workflow Specification v1.0.0
    
    Status Values (Section 3.1):
    - Draft: Created but not submitted
    - Pending_Budget: Submitted, awaiting budget/manager approval
    - Pending_HR: Budget approved, awaiting HR approval
    - Active: Fully approved, TA work in progress
    - Fulfilled: All items fulfilled (Terminal)
    - Rejected: Rejected during approval (Terminal)
    - Cancelled: Cancelled by authorized actor (Terminal)
    """
    __tablename__ = "requisitions"

    # --------------------
    # Primary Key
    # --------------------
    req_id = Column(Integer, primary_key=True)

    # --------------------
    # Optimistic Locking
    # --------------------
    version = Column(Integer, nullable=False, default=1, server_default='1')

    # --------------------
    # Ownership
    # --------------------
    raised_by = Column(
        Integer,
        ForeignKey("users.user_id", ondelete="RESTRICT"),
        nullable=False
    )

    assigned_ta = Column(
        Integer,
        ForeignKey("users.user_id", ondelete="RESTRICT"),
        nullable=True
    )

    budget_approved_by = Column(
        Integer,
        ForeignKey("users.user_id", ondelete="RESTRICT"),
        nullable=True
    )

    approved_by = Column(
        Integer,
        ForeignKey("users.user_id", ondelete="RESTRICT"),
        nullable=True
    )

    # --------------------
    # Business Context
    # --------------------
    project_name = Column(String(100), nullable=True)
    client_name = Column(String(100), nullable=True)
    justification = Column(Text, nullable=True)
    manager_notes = Column(Text, nullable=True)
    rejection_reason = Column(Text, nullable=True)
    jd_file_key = Column(Text, nullable=True)

    # --------------------
    # Request Details
    # --------------------
    priority = Column(String(10), nullable=True)
    is_replacement = Column(Boolean, default=False)
    duration = Column(String(50), nullable=True)

    work_mode = Column(String(10), nullable=True)
    office_location = Column(String(100), nullable=True)

    # --------------------
    # Budget & Timeline
    # --------------------
    budget_amount = Column(Numeric(12, 2), nullable=True)
    required_by_date = Column(Date, nullable=True)

    # --------------------
    # Workflow (Specification v1.0.0)
    # --------------------
    overall_status = Column(
        String(30),
        nullable=False,
        default="Draft",  # Specification: Initial state is Draft
        index=True
    )
    approval_history = Column(TIMESTAMP, nullable=True)
    assigned_at = Column(TIMESTAMP, nullable=True)

    # --------------------
    # Relationships
    # --------------------
    items = relationship(
        "RequisitionItem",
        back_populates="requisition",
        cascade="all, delete-orphan",
    )

    # --------------------
    # Computed Budget Properties (NOT persisted)
    # --------------------
    @property
    def total_estimated_budget(self):
        """
        Compute total estimated budget from all items.
        
        This is a computed property - NOT stored in the database.
        Budget totals must always be calculated dynamically from items.
        """
        if not self.items:
            return 0
        return sum(
            float(item.estimated_budget or 0)
            for item in self.items
        )
    
    @property
    def total_approved_budget(self):
        """
        Compute total approved budget from all items.
        
        This is a computed property - NOT stored in the database.
        Budget totals must always be calculated dynamically from items.
        """
        if not self.items:
            return 0
        return sum(
            float(item.approved_budget or 0)
            for item in self.items
        )
    
    @property
    def budget_approval_status(self):
        """
        Compute budget approval status based on items.
        
        Returns:
            'pending': No items have approved budgets
            'partial': Some items have approved budgets
            'approved': All items have approved budgets
            'none': No items exist
        """
        if not self.items:
            return 'none'
        
        approved_count = sum(
            1 for item in self.items
            if item.approved_budget is not None and item.approved_budget > 0
        )
        total_count = len(self.items)
        
        if approved_count == 0:
            return 'pending'
        elif approved_count < total_count:
            return 'partial'
        else:
            return 'approved'

    # --------------------
    # Audit
    # --------------------
    created_at = Column(
        TIMESTAMP,
        server_default=func.now(),
        nullable=False
    )

    # --------------------
    # Constraints (Specification v1.0.0)
    # --------------------
    __table_args__ = (
        CheckConstraint(
            "priority IN ('High', 'Medium', 'Low')",
            name="chk_requisition_priority"
        ),
        CheckConstraint(
            """
            overall_status IN (
                'Draft',
                'Pending_Budget',
                'Pending_HR',
                'Active',
                'Fulfilled',
                'Rejected',
                'Cancelled'
            )
            """,
            name="chk_requisition_status"
        ),
    )
