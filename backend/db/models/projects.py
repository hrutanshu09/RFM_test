from sqlalchemy import Column, Integer, String, Text, Boolean, Date, Numeric, TIMESTAMP, ForeignKey, CheckConstraint, func
from db.base import Base

class Project(Base):
    __tablename__ = "projects"
    project_id = Column(Integer, primary_key=True, autoincrement=True)
    project_name = Column(String(200), nullable=False)
    client_name = Column(String(200))
    project_status = Column(String(30), nullable=False)
    description = Column(Text)
    approval_status = Column(String(20), nullable=False, server_default="Pending")
    approved_by_manager_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"))
    approved_at = Column(TIMESTAMP)
    approval_note = Column(Text)
    created_at = Column(TIMESTAMP, server_default=func.now(), nullable=False)

    __table_args__ = (
        CheckConstraint("project_status IN ('Active', 'On Hold', 'Completed', 'Cancelled')", name="chk_project_status"),
        CheckConstraint("approval_status IN ('Pending', 'Approved', 'Rejected')", name="chk_project_approval_status"),
    )

class ProjectManager(Base):
    __tablename__ = "project_managers"
    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("projects.project_id", ondelete="CASCADE"), nullable=False)
    manager_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="RESTRICT"), nullable=False)
    role = Column(String(50), nullable=False)
    assigned_from = Column(Date, nullable=False)
    assigned_to = Column(Date)
    is_active = Column(Boolean, server_default="true", nullable=False)

class ProjectTimeline(Base):
    __tablename__ = "project_timelines"
    timeline_id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("projects.project_id", ondelete="CASCADE"), nullable=False)
    start_date = Column(Date, nullable=False)
    planned_end_date = Column(Date, nullable=False)
    actual_end_date = Column(Date)
    planned_start_date = Column(Date)
    actual_start_date = Column(Date)
    version_number = Column(Integer, server_default="1", nullable=False)
    reason_for_change = Column(Text)
    is_current = Column(Boolean, server_default="true", nullable=False)

class EmployeeProjectAssignment(Base):
    __tablename__ = "employee_project_assignments"
    assignment_id = Column(Integer, primary_key=True, autoincrement=True)
    emp_id = Column(String(20), ForeignKey("employees.emp_id", ondelete="RESTRICT"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.project_id", ondelete="CASCADE"), nullable=False)
    role = Column(String(100))
    allocation_pct = Column(Numeric(5, 2), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date)
    status = Column(String(20), nullable=False)
    approval_status = Column(String(20), nullable=False, server_default="Pending")
    approved_by_manager_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"))
    approved_at = Column(TIMESTAMP)
    approval_note = Column(Text)
    approval_requested_by_user_id = Column(Integer, ForeignKey("users.user_id", ondelete="SET NULL"))
    approval_requested_at = Column(TIMESTAMP)
    
    # --- New Billing Fields ---
    billing_rate = Column(Numeric(10, 2))
    billing_start_date = Column(Date)
    billing_end_date = Column(Date)
    is_billable = Column(Boolean, server_default="true", nullable=False)
    timesheet_required = Column(Boolean, server_default="true", nullable=False)
    client_pm_name = Column(String(200))
    billing_project_id = Column(Integer, ForeignKey("projects.project_id", ondelete="SET NULL"))

    __table_args__ = (
        CheckConstraint("allocation_pct >= 0 AND allocation_pct <= 100", name="chk_allocation_pct"),
        CheckConstraint("status IN ('Planned', 'Active', 'Ended')", name="chk_assignment_status"),
        CheckConstraint(
            "approval_status IN ('Pending', 'Approved', 'Rejected')",
            name="chk_assignment_approval_status",
        ),
    )
