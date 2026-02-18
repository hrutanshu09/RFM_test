from sqlalchemy import Column, String, Text, ForeignKey
from db.base import Base

class EmployeeFinance(Base):
    __tablename__ = "employee_finance"

    emp_id = Column(
        String(20),
        ForeignKey("employees.emp_id", ondelete="CASCADE"),
        primary_key=True
    )

    bank_details = Column(Text, nullable=True)
    tax_id = Column(String(50), nullable=True)
